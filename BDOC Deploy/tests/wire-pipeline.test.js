// LIVE WIRE pipeline and publisher tests. node --test tests/wire-pipeline.test.js
// Everything runs with a fake clock and no network. The tests at the top are the
// promises the owner was made: rumor stays rumor, confirmation is earned, backlog
// stays quiet, and no failure downstream stops the collector.

const { test, after } = require('node:test');

// publish.js unrefs its retry timers so they can never hold a shutdown open. In the daemon
// a socket keeps the loop alive; here nothing would, and Node 20 and 22 then end the run
// mid-test. Node 24 waits, which is how this passed on the laptop and failed in CI.
const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

const assert = require('node:assert');
const path = require('path');

const lib = path.join(__dirname, '..', 'tools', 'wire', 'lib');
const { Pipeline, Ring } = require(path.join(lib, 'pipeline.js'));
const { Pager } = require(path.join(lib, 'alert.js'));
const { MemoryStore } = require(path.join(lib, 'store.js'));
const { Publisher, SnapshotPoster, MAX_PAYLOAD } = require(path.join(lib, 'publish.js'));
const { BUCKETS, setCustomTerms } = require(path.join(lib, 'classify.js'));

const NOW = Date.UTC(2026, 10, 3, 18, 0, 0);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

let seq = 0;

function raw(h, o) {
  seq++;
  return Object.assign({
    sid: 'src' + seq, sn: 'Outlet ' + seq, cls: 'wire', guid: 'g' + seq, h, x: '',
    u: 'https://outlet' + seq + '.com/a', pt: NOW - MIN, pub: 'outlet' + seq + '.com', firstPoll: false, off: false
  }, o);
}

function rig(o) {
  const clock = { t: NOW };
  const published = [];
  const upds = [];
  const sends = [];
  const fetchImpl = async (url, init) => { sends.push(JSON.parse(init.body).text); return { ok: true, status: 200 }; };
  const pager = new Pager(Object.assign({
    token: 't', chatId: 'c', fetchImpl, now: () => clock.t, startedAt: NOW - HOUR, pause: async () => {}
  }, o && o.pager));
  const p = new Pipeline(Object.assign({
    store: new MemoryStore(),
    publisher: { publish: (i) => published.push(i), update: (u) => upds.push(u) },
    pager,
    now: () => clock.t
  }, o && o.pipeline));
  return { p, clock, published, upds, sends, pager };
}

function quiet(fn) {
  const orig = process.stdout.write;
  process.stdout.write = () => true;
  try { return fn(); } finally { process.stdout.write = orig; }
}

const reuters = (h, o) => raw(h, Object.assign({ pub: 'reuters.com', sn: 'Reuters' }, o));
const bbc = (h, o) => raw(h, Object.assign({ pub: 'bbc.co.uk', sn: 'BBC' }, o));
const post = (h, o) => raw(h, Object.assign({ sid: 'bsky', sn: 'Bluesky', cls: 'social', pub: 'bsky.app' }, o));

// ── The promises ──────────────────────────────────────────────────────────────
test('a lone social post stays unverified, sev <= 1, and never pages', async () => {
  const { p, sends, pager } = rig();
  const it = quiet(() => p.ingest(post('Trump invokes Insurrection Act')));
  assert.equal(it.st, 'unverified');
  assert.ok(it.sev <= 1);
  await pager.settle();
  assert.equal(sends.length, 0);
});

test('a thousand copies of one rumor never page either', async () => {
  const { p, sends, pager } = rig();
  quiet(() => { for (let i = 0; i < 1000; i++) p.ingest(post('Trump invokes Insurrection Act', { pub: 'site' + i + '.net', cls: 'osint' })); });
  await pager.settle();
  assert.equal(sends.length, 0);
});

test('the same story from two publishers is corroborated, emits an upd, and pages once', async () => {
  const { p, published, upds, sends, pager } = rig();
  const a = quiet(() => p.ingest(reuters('Trump invokes Insurrection Act')));
  assert.equal(a.st, 'reported');
  assert.equal(a.sev, 3);
  assert.equal(upds.length, 0);
  assert.equal(sends.length, 0, 'one outlet does not page');

  const b = quiet(() => p.ingest(bbc('President Trump invokes the Insurrection Act')));
  assert.equal(b.c, a.c);
  assert.equal(b.st, 'corroborated');
  assert.equal(b.n, 2);
  assert.deepEqual(upds, [{ c: a.c, st: 'corroborated', n: 2, sev: 3 }]);
  assert.equal(published.length, 2);

  quiet(() => p.ingest(raw('Trump invokes the Insurrection Act', { pub: 'apnews.com' })));
  assert.equal(upds[1].n, 3, 'a third outlet is a change the client should see');
  await pager.settle();
  assert.equal(sends.length, 1, 'one story, one page');
  assert.match(sends[0], /^BDOC WIRE — CRITICAL · CORROBORATED \(2 outlets\)\n/);
});

test('wire outlets lift a rumor: unverified sev 1 becomes reported sev 3 with an upd', () => {
  const { p, upds } = rig();
  const a = quiet(() => p.ingest(post('Trump invokes Insurrection Act')));
  const b = quiet(() => p.ingest(reuters('President Trump invokes Insurrection Act')));
  assert.equal(b.c, a.c);
  assert.equal(b.st, 'reported');
  assert.equal(b.sev, 3);
  assert.deepEqual(upds, [{ c: a.c, st: 'reported', n: 1, sev: 3 }]);
});

test('two different stories sharing the words National Guard do NOT merge', async () => {
  const { p, sends, pager } = rig();
  const a = quiet(() => p.ingest(reuters('Colorado National Guard rescues 50 people amid flooding')));
  const b = quiet(() => p.ingest(bbc('National Guard deployed to Chicago after riots')));
  assert.notEqual(a.c, b.c);
  assert.equal(b.st, 'reported');
  await pager.settle();
  assert.equal(sends.length, 0);
});

test('a factcheck joining marks the story disputed, emits an upd, and blocks a page', async () => {
  const { p, upds, sends, pager } = rig();
  const a = quiet(() => p.ingest(reuters('Trump declares martial law in Chicago', { firstPoll: false })));
  const fc = quiet(() => p.ingest(raw('Fact Check: Trump declares martial law in Chicago', { cls: 'factcheck', pub: 'snopes.com', sn: 'Snopes' })));
  assert.equal(fc.c, a.c);
  assert.equal(fc.st, 'disputed');
  assert.equal(upds[0].st, 'disputed');

  const b = quiet(() => p.ingest(bbc('Trump declares martial law across Chicago')));
  assert.equal(b.c, a.c);
  assert.equal(b.st, 'disputed', 'disputed outranks corroborated');
  await pager.settle();
  assert.equal(sends.length, 0);
});

test('first-poll items never page, even corroborated', async () => {
  const { p, sends, pager } = rig();
  quiet(() => {
    p.ingest(reuters('Trump invokes Insurrection Act', { firstPoll: true }));
    p.ingest(bbc('President Trump invokes Insurrection Act', { firstPoll: true }));
    p.ingest(raw('Trump invokes the Insurrection Act', { firstPoll: true, pub: 'apnews.com' }));
  });
  await pager.settle();
  assert.equal(sends.length, 0);
});

test('a live item on top of backlog does not page until two live outlets stand behind it', async () => {
  const { p, sends, pager } = rig();
  quiet(() => {
    p.ingest(reuters('Trump invokes Insurrection Act', { firstPoll: true }));
    p.ingest(bbc('President Trump invokes Insurrection Act', { firstPoll: false }));
  });
  await pager.settle();
  assert.equal(sends.length, 0, 'one live outlet leaning on backlog');
  quiet(() => p.ingest(raw('Trump invokes the Insurrection Act', { pub: 'apnews.com' })));
  await pager.settle();
  assert.equal(sends.length, 1, 'second live outlet makes it real');
});

test('uptime under 5 minutes never pages', async () => {
  const { p, sends, pager } = rig({ pager: { startedAt: NOW - 4 * MIN } });
  quiet(() => {
    p.ingest(reuters('Trump invokes Insurrection Act'));
    p.ingest(bbc('President Trump invokes Insurrection Act'));
  });
  await pager.settle();
  assert.equal(sends.length, 0);
  assert.equal(pager.lastBlocked, 'daemon up under 5 min');
});

test('an old corroborated story does not page: the newest item must be fresh', async () => {
  const { p, sends, pager } = rig();
  quiet(() => {
    p.ingest(reuters('Trump invokes Insurrection Act', { pt: NOW - HOUR }));
    p.ingest(bbc('President Trump invokes Insurrection Act', { pt: NOW - HOUR }));
  });
  await pager.settle();
  assert.equal(sends.length, 0);
  assert.equal(pager.lastBlocked, 'newest item not fresh');
});

test('an official bulletin pages by itself, and a drill never does', async () => {
  const { p, sends, pager } = rig();
  quiet(() => p.ingest(raw('NTAS Bulletin issued for the homeland', { cls: 'official', sn: 'DHS NTAS', pub: 'dhs.gov', sev0: 3, off: true })));
  await pager.settle();
  assert.equal(sends.length, 1);
  assert.match(sends[0], /CRITICAL · OFFICIAL \(1 outlet\)/);

  const drill = rig();
  quiet(() => drill.p.ingest(raw('Emergency alert test of the Tsunami Warning system', { cls: 'official', pub: 'weather.gov', sev0: 3 })));
  await drill.pager.settle();
  assert.equal(drill.sends.length, 0);
});

test('page rate limits hold through the pipeline', async () => {
  const { p, sends, pager } = rig();
  quiet(() => {
    for (let i = 0; i < 12; i++) p.ingest(raw(`Magnitude 7.${i} earthquake strikes island${i}`, { cls: 'official', pub: 'usgs' + i + '.gov', sev0: 3 }));
  });
  await pager.settle();
  assert.equal(sends.length, 6);
});

// ── Age rules ─────────────────────────────────────────────────────────────────
test('older than 72 h is dropped and not even marked seen', () => {
  const { p } = rig();
  const r = reuters('Old news', { pt: NOW - 73 * HOUR });
  assert.equal(p.ingest(r), null);
  assert.equal(p.c.tooOld, 1);
  assert.equal(p.store.seen.size, 0);
});

test('between 6 and 72 h is marked seen, not stored and not published', () => {
  const { p, published } = rig();
  const r = reuters('Yesterday news', { pt: NOW - 7 * HOUR });
  assert.equal(p.ingest(r), null);
  assert.equal(p.c.aged, 1);
  assert.equal(p.store.seen.size, 1);
  assert.equal(p.store.items.length, 0);
  assert.equal(published.length, 0);
  assert.equal(p.ingest(r), null);
  assert.equal(p.c.dup, 1, 'second sight is a dup');
});

test('just inside 6 h is stored', () => {
  const { p } = rig();
  assert.ok(p.ingest(reuters('Recent news', { pt: NOW - 6 * HOUR + 1000 })));
});

test('an undated item skips the age rules', () => {
  const { p } = rig();
  const it = p.ingest(reuters('Undated news', { pt: null }));
  assert.equal(it.pt, null);
  assert.equal(it.t, NOW);
});

// ── t, pt, fresh ──────────────────────────────────────────────────────────────
test('a live item is timed when we saw it, published time clamped to it', () => {
  const { p } = rig();
  const it = p.ingest(reuters('A', { pt: NOW - 10 * MIN }));
  assert.equal(it.t, NOW);
  assert.equal(it.pt, NOW - 10 * MIN);
  assert.equal(it.fresh, true);
  const fut = p.ingest(bbc('B', { pt: NOW + 2 * HOUR }));
  assert.equal(fut.pt, NOW);
  assert.equal(fut.fresh, false, 'a future date is not evidence of freshness');
});

test('fresh ends at 45 minutes', () => {
  const { p } = rig();
  assert.equal(p.ingest(reuters('A', { pt: NOW - 44 * MIN })).fresh, true);
  assert.equal(p.ingest(bbc('B', { pt: NOW - 46 * MIN })).fresh, false);
});

test('first-poll backfill takes t = pt so history sorts right, and is not broadcast', () => {
  const { p, published } = rig();
  const it = p.ingest(reuters('A', { pt: NOW - 3 * HOUR, firstPoll: true }));
  assert.equal(it.t, NOW - 3 * HOUR);
  assert.equal(it.fresh, false);
  assert.equal(published.length, 0);
  assert.equal(p.selectSnapshot().length, 1, 'but the snapshot carries it');
  assert.equal(p.stats().items1m, 0, 'and it is not counted as live traffic');
});

test('first-poll with no date falls back to now and is not fresh', () => {
  const { p } = rig();
  const it = p.ingest(reuters('A', { pt: null, firstPoll: true }));
  assert.equal(it.t, NOW);
  assert.equal(it.fresh, false);
});

test('an undated live item on a followed source is fresh', () => {
  const { p } = rig();
  assert.equal(p.ingest(reuters('A', { pt: null })).fresh, true);
});

// ── Item shape and hostile input ──────────────────────────────────────────────
test('item shape matches the contract, and ids hash the canonical url', () => {
  const { p } = rig();
  const it = p.ingest(reuters('Riots erupt in Chicago', { sid: 'reuters', x: 'Details here', u: 'https://reuters.com/a?utm_source=x#top' }));
  assert.deepEqual(Object.keys(it).sort(), ['c', 'cat', 'cls', 'fresh', 'geo', 'h', 'id', 'n', 'pt', 'sev', 'sn', 'src', 'st', 't', 'u', 'w', 'x'].sort());
  assert.match(it.id, /^[0-9a-f]{16}$/);
  assert.equal(it.c, it.id);
  assert.equal(it.src, 'reuters');
  assert.equal(it.geo.p, 'Chicago, IL');

  const same = p.ingest(bbc('Different headline, same canonical url', { u: 'https://reuters.com/a' }));
  assert.equal(same, null, 'the tracker does not make it a new article');
});

test('no url and no pt: identity falls back to source and guid', () => {
  const { p } = rig();
  const a = p.ingest(reuters('A', { sid: 'faa', guid: 'g-1', u: '', pt: null }));
  const b = p.ingest(reuters('A again', { sid: 'faa', guid: 'g-1', u: '', pt: null }));
  assert.ok(a);
  assert.equal(b, null);
});

test('parser geo is kept, and an item with no place simply has none', () => {
  const { p } = rig();
  const geo = { p: 'Kern County, CA', lat: 35.3, lon: -118.7, r: 40000, cc: 'US' };
  assert.deepEqual(p.ingest(reuters('Quake felt', { geo })).geo, geo);
  assert.equal('geo' in p.ingest(bbc('Nothing placed here')), false);
});

test('hostile feeds: markup, bad urls and oversized text come out clean', () => {
  const { p } = rig();
  const it = p.ingest(reuters('<img src=x onerror=alert(1)>Real &amp;amp; headline' + 'y'.repeat(400), {
    x: '<script>alert(1)</script>' + 'z'.repeat(1000), u: 'javascript:alert(1)'
  }));
  assert.equal(it.u, '');
  assert.ok(!/[<>]/.test(it.h));
  assert.ok(it.h.length <= 240);
  assert.ok(it.x.length <= 280);
  assert.ok(!it.x.includes('alert'));
});

test('garbage in does not throw', () => {
  const { p } = rig();
  assert.equal(p.ingest(null), null);
  assert.equal(p.ingest({}), null);
  assert.equal(p.ingest({ h: '   ', sid: 'x', guid: 'y' }), null);
  assert.equal(p.ingest({ h: '<b></b>', sid: 'x', guid: 'z' }), null);
  assert.equal(p.c.bad, 4);
});

// ── Firehose ──────────────────────────────────────────────────────────────────
test('a Bluesky post that classifies to nothing is dropped, one that matters is kept', () => {
  const { p } = rig();
  assert.equal(p.ingest(post('My dog got a shot at the vet today')), null);
  assert.equal(p.c.firehoseDropped, 1);
  assert.equal(p.store.seen.size, 0, 'a dropped candidate costs no storage');
  assert.ok(p.ingest(post('Protesters are blocking the bridge downtown right now')));
});

test('noise on the firehose is dropped, the same noise on a polled source is kept in ALL', () => {
  const { p } = rig();
  assert.equal(p.ingest(post('Book club meets Nov. 4')), null);
  const it = p.ingest(reuters('Planning and Zoning Commission to meet Nov. 4'));
  assert.equal(it.sev, 0);
  assert.deepEqual(it.w, []);
});

// ── Failure isolation ─────────────────────────────────────────────────────────
test('a store that throws does not stop publishing', () => {
  const store = new MemoryStore();
  store.saveItem = () => { throw new Error('disk full'); };
  store.saveCluster = () => { throw new Error('disk full'); };
  const { p, published } = rig({ pipeline: { store } });
  const it = quiet(() => p.ingest(reuters('Still flows')));
  assert.ok(it);
  assert.equal(published.length, 1);
  assert.ok(p.c.sideErrors >= 2);
});

test('a publisher that throws does not stop storing or paging', async () => {
  const publisher = { publish() { throw new Error('down'); }, update() { throw new Error('down'); } };
  const { p, sends, pager } = rig({ pipeline: { publisher } });
  quiet(() => {
    p.ingest(reuters('Trump invokes Insurrection Act'));
    p.ingest(bbc('President Trump invokes Insurrection Act'));
  });
  assert.equal(p.store.items.length, 2);
  await pager.settle();
  assert.equal(sends.length, 1);
});

test('a pager that throws changes nothing about the item', () => {
  const { p, published } = rig({ pipeline: { pager: { consider() { throw new Error('boom'); } } } });
  const it = quiet(() => p.ingest(reuters('Trump invokes Insurrection Act')));
  assert.ok(it);
  assert.equal(published.length, 1);
});

// ── Stats and snapshot ────────────────────────────────────────────────────────
test('Ring reads oldest first, rolls quiet minutes to zero, and wraps', () => {
  const r = new Ring(4);
  r.add(100);
  r.add(100);
  r.add(101);
  assert.deepEqual(r.toArray(101), [0, 0, 2, 1]);
  assert.deepEqual(r.toArray(103), [2, 1, 0, 0]);
  assert.deepEqual(r.toArray(110), [0, 0, 0, 0]);
  assert.equal(r.sum(110), 0);
});

test('perMin covers every bucket with 60 ints and counts watch hits', () => {
  const { p, clock } = rig();
  p.ingest(reuters('Strike deadline at LA-LB ports expected to be delayed to Nov. 4: PMA'));
  clock.t += 60000;
  p.ingest(bbc('Riots erupt in Chicago'));
  const s = p.stats();
  assert.deepEqual(Object.keys(s.perMin).sort(), [...BUCKETS].sort());
  for (const b of BUCKETS) assert.equal(s.perMin[b].length, 60, b);
  assert.equal(s.perMin.nov4[58], 1);
  assert.equal(s.perMin.ports[58], 1);
  assert.equal(s.perMin.unrest[59], 1);
  assert.equal(s.items1h, 2);
});

test('items1m is a rolling 60 seconds, not a calendar minute', () => {
  const { p, clock } = rig();
  p.ingest(reuters('A'));
  clock.t += 30000;
  p.ingest(bbc('B'));
  assert.equal(p.stats().items1m, 2);
  clock.t += 31000;
  assert.equal(p.stats().items1m, 1);
});

test('custom terms get their own bucket', () => {
  try {
    setCustomTerms(['Dryden County']);
    const { p } = rig();
    const it = p.ingest(reuters('Quiet day in Dryden County'));
    assert.deepEqual(it.w, ['custom:Dryden County']);
    assert.equal(p.stats().perMin['custom:Dryden County'][59], 1);
  } finally {
    setCustomTerms([]);
  }
});

test('official state comes from the shared parser context', () => {
  const official = { ntas: { active: false, title: null }, usgs: { m6p24h: 2 } };
  const { p } = rig({ pipeline: { official: () => official } });
  assert.deepEqual(p.stats().official, official);
});

test('snapshot: notable items first, topped up by recency, capped at 600, newest first', () => {
  const { p, clock } = rig();
  for (let i = 0; i < 500; i++) {
    clock.t = NOW - 2 * HOUR + i * 1000;
    p.ingest(reuters(`Protest ${i} downtown today`, { pub: 'p' + i + '.com', pt: clock.t }));
  }
  for (let i = 0; i < 900; i++) {
    clock.t = NOW - HOUR + i * 1000;
    p.ingest(reuters(`Weather note ${i}`, { pub: 'q' + i + '.com', pt: clock.t }));
  }
  const snap = p.selectSnapshot();
  assert.equal(snap.length, 600);
  assert.equal(snap.filter(i => i.sev >= 1).length, 450);
  assert.equal(snap.filter(i => i.sev === 0).length, 150);
  for (let i = 1; i < snap.length; i++) assert.ok(snap[i - 1].t >= snap[i].t);
});

test('snapshot: sev 3 survives a flood of sev 1', () => {
  const { p, clock } = rig();
  const crit = quiet(() => p.ingest(reuters('Trump invokes Insurrection Act', { pt: NOW - MIN })));
  for (let i = 0; i < 600; i++) {
    clock.t = NOW + i * 1000;
    p.ingest(bbc(`Protest ${i} downtown today`, { pub: 'p' + i + '.com', pt: clock.t }));
  }
  assert.ok(p.selectSnapshot().some(i => i.id === crit.id));
});

test('snapshot: items past 24 h are not notable any more, and stories show their latest state', () => {
  const { p, clock } = rig();
  const a = quiet(() => p.ingest(reuters('Trump invokes Insurrection Act')));
  quiet(() => p.ingest(bbc('President Trump invokes Insurrection Act')));
  const s = p.selectSnapshot().find(i => i.id === a.id);
  assert.equal(s.st, 'corroborated', 'the first item shows what the story became');
  assert.equal(s.n, 2);
  clock.t += 25 * HOUR;
  assert.equal(p.selectSnapshot().filter(i => i.sev >= 1 && i.t >= clock.t - 24 * HOUR).length, 0);
});

test('restore puts stories and rings back, so a restart keeps the feed whole', () => {
  const store = new MemoryStore();
  const a = rig({ pipeline: { store } });
  const it = quiet(() => a.p.ingest(reuters('Trump invokes Insurrection Act')));
  const b = rig({ pipeline: { store } });
  const r = b.p.restore();
  assert.equal(r.items, 1);
  assert.equal(r.clusters, 1);
  assert.equal(b.p.selectSnapshot()[0].id, it.id);
  assert.equal(b.p.clusters.get(it.c).st, 'reported');
});

// ── Publisher ─────────────────────────────────────────────────────────────────
function fakeRealtime(status) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const s = typeof status === 'function' ? status(calls.length) : (status || 202);
    if (s instanceof Error) throw s;
    return { ok: s >= 200 && s < 300, status: s };
  };
  fn.calls = calls;
  return fn;
}

function publisher(fetchImpl, o) {
  return new Publisher(Object.assign({
    supabaseUrl: 'https://x.supabase.co/', key: 'anon-key', topic: 'secret-topic', fetchImpl, backoffMs: 0, now: () => NOW
  }, o));
}

const it0 = (id, sev) => ({ id, c: id, sev: sev || 0, h: 'H' + id });

test('the broadcast call is the exact one proven to return 202', async () => {
  const fetchImpl = fakeRealtime(202);
  const pub = publisher(fetchImpl);
  pub.publish(it0('a'));
  pub.update({ c: 'z', st: 'corroborated', n: 2, sev: 1 });
  await pub.flush();
  assert.equal(fetchImpl.calls.length, 1);
  const { url, headers, body } = fetchImpl.calls[0];
  assert.equal(url, 'https://x.supabase.co/realtime/v1/api/broadcast');
  assert.equal(headers.apikey, 'anon-key');
  assert.equal(headers.Authorization, 'Bearer anon-key');
  assert.deepEqual(body, { messages: [{
    topic: 'secret-topic', event: 'b', private: false,
    payload: { items: [it0('a')], upd: [{ c: 'z', st: 'corroborated', n: 2, sev: 1 }] }
  }] });
  assert.equal(pub.stats().items, 1);
  assert.equal(pub.stats().lastOk, NOW);
});

test('flush rules: ordinary items wait for the tick, sev >= 2 goes at once', async () => {
  const fetchImpl = fakeRealtime(202);
  const pub = publisher(fetchImpl);
  pub.publish(it0('quiet', 1));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetchImpl.calls.length, 0, 'no flush without the timer');
  pub.publish(it0('loud', 2));
  await new Promise(resolve => setImmediate(resolve));
  await pub.flushing;
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].body.messages[0].payload.items.length, 2, 'the urgent flush carries what was waiting');
});

test('a burst of sev 2 items in one tick is one POST', async () => {
  const fetchImpl = fakeRealtime(202);
  const pub = publisher(fetchImpl);
  for (let i = 0; i < 20; i++) pub.publish(it0('n' + i, 3));
  await new Promise(resolve => setImmediate(resolve));
  await pub.flushing;
  assert.equal(fetchImpl.calls.length, 1);
});

test('an update that raises sev to 2 goes at once too', async () => {
  const fetchImpl = fakeRealtime(202);
  const pub = publisher(fetchImpl);
  pub.update({ c: 'a', st: 'reported', n: 1, sev: 2 });
  await new Promise(resolve => setImmediate(resolve));
  await pub.flushing;
  assert.equal(fetchImpl.calls.length, 1);
});

test('repeated updates to one story send only the latest', async () => {
  const fetchImpl = fakeRealtime(202);
  const pub = publisher(fetchImpl);
  pub.update({ c: 'a', st: 'reported', n: 1, sev: 1 });
  pub.update({ c: 'a', st: 'corroborated', n: 2, sev: 1 });
  await pub.flush();
  assert.deepEqual(fetchImpl.calls[0].body.messages[0].payload.upd, [{ c: 'a', st: 'corroborated', n: 2, sev: 1 }]);
});

test('a payload over 200 KB is split, and every item arrives once', async () => {
  const fetchImpl = fakeRealtime(202);
  const pub = publisher(fetchImpl);
  const big = 'x'.repeat(1000);
  for (let i = 0; i < 500; i++) pub.publish({ id: 'i' + i, c: 'i' + i, sev: 0, h: big });
  await pub.flush();
  assert.ok(fetchImpl.calls.length >= 3);
  const seen = [];
  for (const c of fetchImpl.calls) {
    assert.ok(Buffer.byteLength(JSON.stringify(c.body)) <= MAX_PAYLOAD, 'each POST is within the limit');
    seen.push(...c.body.messages[0].payload.items.map(i => i.id));
  }
  assert.equal(seen.length, 500);
  assert.equal(new Set(seen).size, 500);
  assert.equal(seen[0], 'i0', 'order kept');
});

test('queue overflow drops oldest and counts it', async () => {
  const fetchImpl = fakeRealtime(202);
  const pub = publisher(fetchImpl, { maxQueue: 5 });
  for (let i = 0; i < 8; i++) pub.publish(it0('i' + i));
  assert.equal(pub.stats().queued, 5);
  assert.equal(pub.stats().dropped, 3);
  await pub.flush();
  assert.deepEqual(fetchImpl.calls[0].body.messages[0].payload.items.map(i => i.id), ['i3', 'i4', 'i5', 'i6', 'i7']);
});

test('the default queue bound is 5000 and updates are bounded as well', () => {
  const pub = publisher(fakeRealtime(202));
  assert.equal(pub.maxQueue, 5000);
  for (let i = 0; i < 5100; i++) pub.update({ c: 'c' + i, st: 'reported', n: 1, sev: 0 });
  assert.equal(pub.stats().updQueued, 5000);
  assert.equal(pub.stats().dropped, 100);
});

test('a 500 from Realtime does not throw: retried, then dropped and counted', async () => {
  const fetchImpl = fakeRealtime(500);
  const pub = publisher(fetchImpl);
  pub.publish(it0('a'));
  await quiet(() => pub.flush());
  await pub.flush();
  assert.equal(fetchImpl.calls.length, 3, 'tried three times');
  assert.equal(pub.stats().failed, 1);
  assert.equal(pub.stats().droppedFailed, 1);
  assert.equal(pub.stats().queued, 0, 'the snapshot path carries it now');
  assert.equal(pub.stats().lastErr, 'HTTP 500');
});

test('a retry that succeeds counts as success', async () => {
  const fetchImpl = fakeRealtime((n) => (n < 3 ? 503 : 202));
  const pub = publisher(fetchImpl);
  pub.publish(it0('a'));
  await quiet(() => pub.flush());
  assert.equal(pub.stats().items, 1);
  assert.equal(pub.stats().failed, 0);
});

test('a network error does not throw, and a 401 is not retried', async () => {
  const net = fakeRealtime(() => new Error('ECONNRESET'));
  const a = publisher(net);
  a.publish(it0('a'));
  await quiet(() => a.flush());
  assert.equal(a.stats().failed, 1);

  const denied = fakeRealtime(401);
  const b = publisher(denied);
  b.publish(it0('a'));
  await quiet(() => b.flush());
  assert.equal(denied.calls.length, 1);
});

test('an unconfigured publisher counts failures and does not throw', async () => {
  const pub = new Publisher({ backoffMs: 0 });
  pub.publish(it0('a'));
  await quiet(() => pub.flush());
  assert.equal(pub.stats().failed, 1);
});

test('nothing secret reaches the log', async () => {
  const lines = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  try {
    const pub = publisher(fakeRealtime(500), { attempts: 1 });
    pub.publish(it0('a'));
    await pub.flush();
  } finally {
    process.stdout.write = orig;
  }
  assert.ok(lines.length > 0);
  const text = lines.join('');
  assert.ok(!text.includes('secret-topic'));
  assert.ok(!text.includes('anon-key'));
});

test('heartbeat is its own event with the payload it was given', async () => {
  const fetchImpl = fakeRealtime(202);
  const hb = { ts: NOW, up: 60, ok: 100, total: 115, items1m: 4, official: {} };
  const pub = publisher(fetchImpl, { heartbeat: () => hb });
  assert.equal(await pub.beat(), true);
  const m = fetchImpl.calls[0].body.messages[0];
  assert.equal(m.event, 'hb');
  assert.deepEqual(m.payload, hb);
});

test('a heartbeat that fails or cannot be built does not throw', async () => {
  const a = publisher(fakeRealtime(500));
  assert.equal(await quiet(() => a.beat()), false);
  assert.equal(a.stats().hbFail, 1);
  const b = publisher(fakeRealtime(202), { heartbeat: () => { throw new Error('nope'); } });
  assert.equal(await quiet(() => b.beat()), false);
});

test('dry mode writes one line per item and sends nothing', async () => {
  const fetchImpl = fakeRealtime(202);
  const lines = [];
  const pub = publisher(fetchImpl, { dry: true, out: (s) => lines.push(s) });
  pub.publish({ id: 'a', c: 'a', sev: 2, st: 'reported', n: 1, cls: 'wire', src: 'bbc-us', cat: ['unrest'], w: ['nov4'], h: 'Riots erupt' });
  pub.update({ c: 'a', st: 'corroborated', n: 2, sev: 2 });
  await pub.beat();
  await pub.flush();
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'DRY item sev=2 st=reported n=1 cls=wire src=bbc-us tags=unrest,nov4 | Riots erupt\n');
  assert.ok(lines.every(l => l.endsWith('\n') && l.indexOf('\n') === l.length - 1));
});

// ── Snapshot ──────────────────────────────────────────────────────────────────
function fakeFn(reply, status) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (reply instanceof Error) throw reply;
    return { ok: (status || 200) < 300, status: status || 200, json: async () => reply };
  };
  fn.calls = calls;
  return fn;
}

test('snapshot posts with the ingest key and hands the watch list back', async () => {
  const fetchImpl = fakeFn({ ok: true, watch: ['Long Beach'] });
  const got = [];
  const s = new SnapshotPoster({ site: 'https://site.example/', key: 'ingest-key', build: () => ({ v: 1, items: [] }), onWatch: (w) => got.push(w), fetchImpl });
  assert.equal(await s.post(), true);
  assert.equal(fetchImpl.calls[0].url, 'https://site.example/.netlify/functions/wire');
  assert.equal(fetchImpl.calls[0].headers['x-wire-key'], 'ingest-key');
  assert.deepEqual(got, [['Long Beach']]);
});

test('no watch list in the reply is not an empty watch list', async () => {
  const got = [];
  const s = new SnapshotPoster({ site: 'https://s', key: 'k', onWatch: (w) => got.push(w), fetchImpl: fakeFn({ ok: true }) });
  await s.post();
  const bad = new SnapshotPoster({ site: 'https://s', key: 'k', onWatch: (w) => got.push(w), fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }) });
  await bad.post();
  assert.deepEqual(got, []);
});

test('a failed snapshot resolves false and never throws', async () => {
  for (const f of [fakeFn(null, 503), fakeFn(new Error('down'))]) {
    const s = new SnapshotPoster({ site: 'https://s', key: 'k', fetchImpl: f });
    assert.equal(await quiet(() => s.post()), false);
    assert.equal(s.stats().failed, 1);
  }
  const boom = new SnapshotPoster({ site: 'https://s', key: 'k', build: () => { throw new Error('boom'); }, fetchImpl: fakeFn({}) });
  assert.equal(await quiet(() => boom.post()), false);
  const noKey = new SnapshotPoster({ site: 'https://s', fetchImpl: fakeFn({}) });
  assert.equal(await quiet(() => noKey.post()), false);
});

test('a watch callback that throws cannot fail the post', async () => {
  const s = new SnapshotPoster({ site: 'https://s', key: 'k', onWatch: () => { throw new Error('boom'); }, fetchImpl: fakeFn({ watch: [] }) });
  assert.equal(await quiet(() => s.post()), true);
});

test('dry snapshot builds and measures but sends nothing', async () => {
  const fetchImpl = fakeFn({});
  const s = new SnapshotPoster({ dry: true, build: () => ({ items: [1, 2] }), fetchImpl });
  assert.equal(await quiet(() => s.post()), true);
  assert.equal(fetchImpl.calls.length, 0);
  assert.ok(s.stats().lastBytes > 0);
});

test('a slow post is not overlapped by the next tick', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async () => { await gate; return { ok: true, status: 200, json: async () => ({}) }; };
  const s = new SnapshotPoster({ site: 'https://s', key: 'k', fetchImpl });
  const first = s.post();
  assert.equal(await s.post(), false);
  release();
  assert.equal(await first, true);
});
