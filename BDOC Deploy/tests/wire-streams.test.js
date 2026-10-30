// Tests for tools/wire/lib/streams.js and tools/wire/lib/gdelt.js.
//
// The WebSocket is a fake and the Jetstream payload is the shape captured live on
// 2026-10-30, including the `cursor` field that must NOT be resumed from. Wikimedia is
// driven through a real ReadableStream, chopped at awkward byte boundaries, because
// chunk boundaries are the entire risk in an SSE parser.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');

const { Jetstream, WikiStream, SseParser, RateWindow, JETSTREAM_HOSTS } = require('../tools/wire/lib/streams');
const { Gdelt, bestLoc, unzipFirst, clockStamp, MAX_ROWS } = require('../tools/wire/lib/gdelt');

const T0 = Date.UTC(2026, 9, 30, 16, 43, 0);

function fakeClock(start) {
  let t = start || T0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const tick = () => new Promise((r) => setImmediate(r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms) {
  const end = Date.now() + (ms || 1000);
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(2);
  }
  return false;
}

// ── fake WebSocket ──────────────────────────────────────────────────────────

function fakeWsClass() {
  const made = [];
  class FakeWs {
    constructor(url) {
      this.url = url;
      this.closed = 0;
      made.push(this);
    }
    close() {
      this.closed++;
      if (this.onclose) this.onclose({});
    }
    serverOpen() { this.onopen({}); }
    serverSend(obj) { this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
    serverClose() { if (this.onclose) this.onclose({}); }
    serverError() { if (this.onerror) this.onerror({}); }
  }
  FakeWs.made = made;
  return FakeWs;
}

let seq = 0;

// The field layout is copied from the live capture in the sample set.
function post(text, over) {
  const o = over || {};
  seq++;
  const record = { $type: 'app.bsky.feed.post', createdAt: '2026-10-30T16:43:30.559Z', text };
  if (o.record) Object.assign(record, o.record);
  return {
    did: o.did || 'did:plc:r2qnlf2ih4v7jzhfimx3uoqw',
    time_us: o.time_us || (T0 * 1000 + seq * 1000),
    cursor: 26605979634,
    kind: 'commit',
    commit: {
      rev: '3mz47zuvx2b2y',
      operation: o.operation || 'create',
      collection: o.collection || 'app.bsky.feed.post',
      rkey: o.rkey || '3mz47zuvu4j2y' + seq,
      record,
      cid: 'bafyreiho3274vtsasnfeyzba3lsjrqgwia7jkgkzwdifvsazaxavjghdg4'
    }
  };
}

const HIT = 'National Guard deployed near the polling place';
const prefilter = (t) => /national guard|martial law|polling/i.test(t);

function jet(opts) {
  const o = opts || {};
  const clock = o.clock || fakeClock();
  const WS = fakeWsClass();
  const items = [];
  const j = new Jetstream(Object.assign({
    prefilter,
    onItem: (r) => items.push(r),
    wsImpl: WS,
    now: clock.now,
    reconnectBaseMs: 1,
    random: () => 1
  }, o));
  return { j, WS, items, clock };
}

async function connected(opts) {
  const ctx = jet(opts);
  ctx.j.start();
  await tick();
  const ws = ctx.WS.made[ctx.WS.made.length - 1];
  ws.serverOpen();
  return Object.assign(ctx, { ws });
}

// ── Jetstream ───────────────────────────────────────────────────────────────

test('jetstream: subscribes to post records on the first host', async () => {
  const { j, ws } = await connected();
  assert.strictEqual(ws.url, 'wss://jetstream1.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post');
  j.stop();
});

test('jetstream: there are four hosts across two regions', () => {
  assert.deepStrictEqual(JETSTREAM_HOSTS, [
    'jetstream1.us-east.bsky.network', 'jetstream2.us-east.bsky.network',
    'jetstream1.us-west.bsky.network', 'jetstream2.us-west.bsky.network'
  ]);
});

test('jetstream: a prefilter hit becomes a raw social item', async () => {
  const { j, ws, items } = await connected();
  const m = post(HIT, { rkey: '3mz47zuvu4j2y' });
  ws.serverSend(m);
  assert.strictEqual(items.length, 1);
  const r = items[0];
  assert.strictEqual(r.sid, 'bsky');
  assert.strictEqual(r.sn, 'Bluesky');
  assert.strictEqual(r.cls, 'social');
  assert.strictEqual(r.h, HIT);
  assert.strictEqual(r.u, 'https://bsky.app/profile/did:plc:r2qnlf2ih4v7jzhfimx3uoqw/post/3mz47zuvu4j2y');
  assert.strictEqual(r.guid, 'did:plc:r2qnlf2ih4v7jzhfimx3uoqw/3mz47zuvu4j2y');
  assert.strictEqual(r.pub, 'bsky.app');
  assert.strictEqual(r.firstPoll, false);
  assert.strictEqual(r.off, false);
  j.stop();
});

test('jetstream: the time comes from the relay, not the poster-set createdAt', async () => {
  const { j, ws, items } = await connected();
  ws.serverSend(post(HIT, { time_us: 1793378621563016, record: { createdAt: '2099-01-01T00:00:00Z' } }));
  assert.strictEqual(items[0].pt, 1793378621563);
  j.stop();
});

test('jetstream: a miss is counted but never stored', async () => {
  const { j, ws, items } = await connected();
  for (let i = 0; i < 5; i++) ws.serverSend(post('cat pictures'));
  ws.serverSend(post(HIT));
  assert.strictEqual(items.length, 1);
  assert.strictEqual(j.status().perMin, 6);
  j.stop();
});

test('jetstream: replies are ignored, and still counted', async () => {
  const { j, ws, items } = await connected();
  ws.serverSend(post(HIT, { record: { reply: { root: {}, parent: {} } } }));
  assert.strictEqual(items.length, 0);
  assert.strictEqual(j.status().perMin, 1);
  j.stop();
});

test('jetstream: English or unset languages only', async () => {
  const { j, ws, items } = await connected();
  ws.serverSend(post(HIT, { record: { langs: ['ja'] } }));
  ws.serverSend(post(HIT, { record: { langs: ['de', 'fr'] } }));
  ws.serverSend(post(HIT, { did: 'did:plc:a', record: { langs: ['en'] } }));
  ws.serverSend(post(HIT, { did: 'did:plc:b', record: { langs: ['en-US'] } }));
  ws.serverSend(post(HIT, { did: 'did:plc:c', record: { langs: ['ja', 'en'] } }));
  ws.serverSend(post(HIT, { did: 'did:plc:d', record: { langs: [] } }));
  ws.serverSend(post(HIT, { did: 'did:plc:e' }));
  assert.strictEqual(items.length, 5);
  assert.strictEqual(j.status().perMin, 7);
  j.stop();
});

test('jetstream: only post creates count', async () => {
  const { j, ws, items } = await connected();
  ws.serverSend(post(HIT, { operation: 'delete' }));
  ws.serverSend(post(HIT, { operation: 'update' }));
  ws.serverSend(post(HIT, { collection: 'app.bsky.feed.like' }));
  ws.serverSend({ did: 'did:plc:x', time_us: 1, kind: 'identity', identity: {} });
  ws.serverSend({ did: 'did:plc:x', time_us: 2, kind: 'account', account: {} });
  assert.strictEqual(items.length, 0);
  assert.strictEqual(j.status().perMin, 0);
  j.stop();
});

test('jetstream: per-DID cap of 10 an hour, and only hits use it up', async () => {
  const { j, ws, items, clock } = await connected();
  const did = 'did:plc:spammer';
  for (let i = 0; i < 50; i++) ws.serverSend(post('cat pictures', { did }));
  for (let i = 0; i < 15; i++) ws.serverSend(post(HIT + ' ' + i, { did }));
  assert.strictEqual(items.length, 10);
  ws.serverSend(post(HIT, { did: 'did:plc:someone-else' }));
  assert.strictEqual(items.length, 11, 'the cap is per account');
  clock.advance(3600000);
  ws.serverSend(post(HIT, { did }));
  assert.strictEqual(items.length, 12, 'the window resets');
  j.stop();
});

test('jetstream: the link embed title helps a post hit, and hostile text is cleaned', async () => {
  const { j, ws, items } = await connected();
  ws.serverSend(post('Look at this', { record: { embed: { external: { title: 'Martial law declared in Testland', uri: 'https://x.example' } } } }));
  ws.serverSend(post('<img src=x onerror=alert(1)>' + HIT, { did: 'did:plc:b' }));
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].h, 'Look at this');
  assert.strictEqual(items[0].x, 'Martial law declared in Testland');
  assert.strictEqual(items[1].h, HIT);
  j.stop();
});

test('jetstream: long posts stay inside the contract lengths', async () => {
  const { j, ws, items } = await connected();
  ws.serverSend(post('national guard ' + 'word '.repeat(500)));
  assert.ok(items[0].h.length <= 240);
  assert.ok(items[0].x.length <= 280);
  j.stop();
});

test('jetstream: a hostile did or rkey cannot shape the link', async () => {
  const { j, ws, items } = await connected();
  ws.serverSend(post(HIT, { did: 'javascript:alert(1)//' }));
  ws.serverSend(post(HIT, { rkey: '../../evil?x=1' }));
  ws.serverSend(post(HIT, { did: 'did:plc:good', rkey: 'abc' }));
  assert.deepStrictEqual(items.map((i) => i.guid), ['did:plc:good/abc']);
  j.stop();
});

test('jetstream: garbage frames and consumer errors do not kill the stream', async () => {
  const { j, ws, items } = await connected({ onItem: () => { throw new Error('consumer bug'); } });
  ws.serverSend('not json');
  ws.serverSend('null');
  ws.serverSend('42');
  ws.serverSend(post(HIT));
  assert.strictEqual(items.length, 0);
  assert.strictEqual(j.status().ok, true);
  j.stop();
});

test('jetstream: a prefilter that throws counts as a miss', async () => {
  const { j, ws, items } = await connected({ prefilter: () => { throw new Error('bad regex'); } });
  ws.serverSend(post(HIT));
  assert.strictEqual(items.length, 0);
  assert.strictEqual(j.status().perMin, 1);
  j.stop();
});

test('jetstream: a replaced prefilter applies with no restart', async () => {
  const { j, ws, items } = await connected({ prefilter: () => false });
  ws.serverSend(post('Long Beach strike'));
  assert.strictEqual(items.length, 0);
  j.prefilter = (t) => /long beach/i.test(t);
  ws.serverSend(post('Long Beach strike'));
  assert.strictEqual(items.length, 1);
  j.stop();
});

test('jetstream: status tells the truth', async () => {
  const { j, ws, clock } = await connected();
  assert.deepStrictEqual(j.status(), { ok: false, lastEvent: null, perMin: 0 }, 'open but no event proves nothing');
  ws.serverSend(post('x'));
  assert.deepStrictEqual(j.status(), { ok: true, lastEvent: clock.now(), perMin: 1 });
  clock.advance(31000);
  assert.strictEqual(j.status().ok, false, 'an old event is not a heartbeat');
  j.stop();
  assert.strictEqual(j.status().ok, false);
});

test('jetstream: failover walks all four hosts and wraps around', async () => {
  const { j, WS } = jet();
  j.start();
  const hosts = [];
  for (let i = 0; i < 5; i++) {
    await until(() => WS.made.length === i + 1);
    hosts.push(new URL(WS.made[i].url).hostname);
    WS.made[i].serverClose();
  }
  assert.deepStrictEqual(hosts, [...JETSTREAM_HOSTS, JETSTREAM_HOSTS[0]]);
  j.stop();
});

test('jetstream: a socket error fails over once, not twice', async () => {
  const { j, WS } = jet();
  j.start();
  await tick();
  const ws = WS.made[0];
  ws.serverError();
  ws.serverClose();
  await until(() => WS.made.length >= 2);
  await wait(20);
  assert.strictEqual(WS.made.length, 2);
  assert.strictEqual(new URL(WS.made[1].url).hostname, JETSTREAM_HOSTS[1]);
  j.stop();
});

test('jetstream: a constructor that throws still schedules a reconnect', async () => {
  let n = 0;
  class Throws {
    constructor() {
      n++;
      if (n === 1) throw new Error('bad url');
      this.close = () => {};
    }
  }
  const j = new Jetstream({ wsImpl: Throws, reconnectBaseMs: 1, random: () => 1 });
  j.start();
  assert.ok(await until(() => n >= 2));
  j.stop();
});

test('jetstream: no WebSocket at all fails soft and does not throw at import or start', async () => {
  const saved = globalThis.WebSocket;
  delete globalThis.WebSocket;
  try {
    const j = new Jetstream({ reconnectBaseMs: 1000 });
    j.start();
    await tick();
    assert.strictEqual(j.status().ok, false);
    j.stop();
  } finally {
    if (saved) globalThis.WebSocket = saved;
  }
});

test('jetstream: 30 s of silence is a stall and moves to the next host', async () => {
  const { j, ws, WS, clock } = await connected();
  ws.serverSend(post('x'));
  clock.advance(29999);
  j._watchdog();
  assert.strictEqual(WS.made.length, 1, 'not yet');
  assert.strictEqual(ws.closed, 0);
  clock.advance(1);
  j._watchdog();
  assert.ok(ws.closed >= 1, 'the stalled socket is closed');
  assert.ok(await until(() => WS.made.length === 2));
  assert.strictEqual(new URL(WS.made[1].url).hostname, JETSTREAM_HOSTS[1]);
  j.stop();
});

test('jetstream: messages keep the watchdog quiet', async () => {
  const { j, ws, WS, clock } = await connected();
  for (let i = 0; i < 10; i++) {
    clock.advance(20000);
    ws.serverSend(post('x'));
    j._watchdog();
  }
  assert.strictEqual(WS.made.length, 1);
  j.stop();
});

test('jetstream: a connect that hangs before opening is a stall too', async () => {
  const { j, WS, clock } = jet();
  j.start();
  await tick();
  clock.advance(30000);
  j._watchdog();
  assert.ok(await until(() => WS.made.length === 2));
  j.stop();
});

test('jetstream: a late close from an old socket does not disturb the new one', async () => {
  const { j, WS } = jet();
  j.start();
  await tick();
  const first = WS.made[0];
  first.serverClose();
  await until(() => WS.made.length === 2);
  first.serverClose();
  await wait(10);
  assert.strictEqual(WS.made.length, 2);
  j.stop();
});

test('jetstream: resumes from time_us with a rewind, never from the cursor field', async () => {
  const { j, WS, ws, clock } = await connected();
  const timeUs = clock.now() * 1000;
  ws.serverSend(post('x', { time_us: timeUs }));
  ws.serverClose();
  assert.ok(await until(() => WS.made.length === 2));
  const url = new URL(WS.made[1].url);
  assert.strictEqual(url.searchParams.get('cursor'), String(timeUs - 5000000));
  assert.strictEqual(url.searchParams.get('wantedCollections'), 'app.bsky.feed.post');
  assert.notStrictEqual(url.searchParams.get('cursor'), '26605979634');
  j.stop();
});

test('jetstream: a persisted cursor is loaded at start and saved on a throttle', async () => {
  const clock = fakeClock();
  const saved = [];
  const stored = clock.now() * 1000 - 60000000;
  const { j, ws } = await connected({
    clock,
    getCursor: async () => stored,
    setCursor: (v) => { saved.push(v); }
  });
  assert.strictEqual(new URL(ws.url).searchParams.get('cursor'), String(stored - 5000000));
  ws.serverSend(post('a', { time_us: 111 }));
  ws.serverSend(post('b', { time_us: 222 }));
  assert.deepStrictEqual(saved, [111], 'not on every message');
  clock.advance(5000);
  ws.serverSend(post('c', { time_us: 333 }));
  assert.deepStrictEqual(saved, [111, 333]);
  j.stop();
});

test('jetstream: a cursor stored as text still resumes, and a junk one is ignored', async () => {
  const clock = fakeClock();
  const stored = clock.now() * 1000 - 60000000;
  const text = await connected({ clock, getCursor: () => String(stored) });
  assert.strictEqual(new URL(text.ws.url).searchParams.get('cursor'), String(stored - 5000000));
  text.j.stop();
  const none = await connected({ clock, getCursor: () => null });
  assert.strictEqual(new URL(none.ws.url).searchParams.has('cursor'), false);
  none.j.stop();
  const junk = await connected({ clock, getCursor: () => 'not a number' });
  assert.strictEqual(new URL(junk.ws.url).searchParams.has('cursor'), false);
  junk.j.stop();
});

test('jetstream: a cursor from long ago is dropped so a restart cannot replay hours', async () => {
  const clock = fakeClock();
  const { j, ws } = await connected({ clock, getCursor: () => (clock.now() - 3600000) * 1000 });
  assert.strictEqual(new URL(ws.url).searchParams.has('cursor'), false);
  j.stop();
});

test('jetstream: a broken cursor store does not stop the stream', async () => {
  const { j, ws, items } = await connected({
    getCursor: async () => { throw new Error('db gone'); },
    setCursor: () => { throw new Error('db gone'); }
  });
  ws.serverSend(post(HIT));
  assert.strictEqual(items.length, 1);
  j.stop();
});

test('jetstream: backoff grows on repeat failures and resets after a healthy run', async () => {
  const clock = fakeClock();
  const { j, WS } = jet({ clock, reconnectBaseMs: 1 });
  j.start();
  await tick();
  WS.made[0].serverClose();
  assert.strictEqual(j.attempt, 1);
  await until(() => WS.made.length === 2);
  WS.made[1].serverClose();
  assert.strictEqual(j.attempt, 2);
  await until(() => WS.made.length === 3);
  WS.made[2].serverOpen();
  clock.advance(31000);
  WS.made[2].serverClose();
  assert.strictEqual(j.attempt, 0, 'a good long run forgives the earlier failures');
  j.stop();
});

test('jetstream: stop closes the socket and stays down', async () => {
  const { j, ws, WS } = await connected();
  j.stop();
  assert.ok(ws.closed >= 1);
  await wait(10);
  assert.strictEqual(WS.made.length, 1);
  j.start();
  await until(() => WS.made.length === 2);
  j.stop();
});

test('rolling count forgets after a minute', () => {
  const clock = fakeClock();
  const r = new RateWindow(clock.now);
  for (let i = 0; i < 30; i++) { r.hit(); clock.advance(1000); } // hits at seconds 0..29
  assert.strictEqual(r.perMin(), 30);
  clock.advance(45000); // now second 75: the 60-second window is seconds 16..75
  assert.strictEqual(r.perMin(), 14);
  clock.advance(120000);
  assert.strictEqual(r.perMin(), 0);
});

// ── SSE parser ──────────────────────────────────────────────────────────────

function collectSse(chunks) {
  const events = [];
  const p = new SseParser((e) => events.push(e));
  for (const c of chunks) p.push(c);
  return events;
}

test('sse: the capture format, with its :ok comment and id line', () => {
  const events = collectSse([':ok\n\nevent: message\nid: [{"topic":"eqiad.mediawiki.recentchange","partition":0,"offset":-1}]\ndata: {"a":1}\n\n']);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event, 'message');
  assert.strictEqual(events[0].data, '{"a":1}');
  assert.strictEqual(events[0].id, '[{"topic":"eqiad.mediawiki.recentchange","partition":0,"offset":-1}]');
});

test('sse: a split at every possible position gives the same events', () => {
  const stream = ':ok\n\nevent: message\nid: 7\ndata: {"a":1}\n\ndata: first\ndata: second\n\nevent: other\ndata: {"b":2}\r\n\r\n';
  const whole = collectSse([stream]);
  assert.strictEqual(whole.length, 3);
  assert.strictEqual(whole[1].data, 'first\nsecond');
  assert.strictEqual(whole[2].event, 'other');
  for (let i = 1; i < stream.length; i++) {
    assert.deepStrictEqual(collectSse([stream.slice(0, i), stream.slice(i)]), whole, 'split at ' + i);
  }
  assert.deepStrictEqual(collectSse([...stream]), whole, 'one character at a time');
});

test('sse: CRLF and bare CR line endings work, including a CR at a chunk edge', () => {
  assert.deepStrictEqual(collectSse(['data: a\r\n\r\n']).map((e) => e.data), ['a']);
  assert.deepStrictEqual(collectSse(['data: a\r', '\n\r', '\n']).map((e) => e.data), ['a']);
  // A CR that ends a chunk may be half of a CRLF, so it waits for the next byte.
  assert.deepStrictEqual(collectSse(['data: a\r\r']).map((e) => e.data), []);
  assert.deepStrictEqual(collectSse(['data: a\r\r', 'data: b\r\r\n']).map((e) => e.data), ['a', 'b']);
});

test('sse: an event needs its blank line, and an id survives between events', () => {
  const p = [];
  const sse = new SseParser((e) => p.push(e));
  sse.push('id: 9\ndata: partial');
  assert.strictEqual(p.length, 0);
  sse.push('\n\ndata: next\n\n');
  assert.deepStrictEqual(p.map((e) => [e.id, e.data]), [['9', 'partial'], ['9', 'next']]);
});

test('sse: a line that never ends cannot eat the memory', () => {
  const sse = new SseParser(() => {});
  sse.push('data: ' + 'x'.repeat(1100000));
  assert.strictEqual(sse.buf.length, 0);
});

// ── WikiStream ──────────────────────────────────────────────────────────────

const change = (over) => Object.assign({
  $schema: '/mediawiki/recentchange/1.0.0',
  meta: { uri: 'https://en.wikipedia.org/wiki/2026_Long_Beach_port_strike', domain: 'en.wikipedia.org' },
  id: 1,
  type: 'edit',
  namespace: 0,
  title: '2026 Long Beach port strike',
  title_url: 'https://en.wikipedia.org/wiki/2026_Long_Beach_port_strike',
  comment: 'update',
  timestamp: Math.floor(T0 / 1000),
  user: 'Alice',
  bot: false,
  server_name: 'en.wikipedia.org',
  wiki: 'enwiki'
}, over);

const sse = (obj, id) => 'event: message\nid: ' + (id || '[{"offset":1}]') + '\ndata: ' + JSON.stringify(obj) + '\n\n';

const wikiPrefilter = (t) => /strike|riot|attack/i.test(t);

function wiki(opts) {
  const clock = (opts && opts.clock) || fakeClock();
  const items = [];
  const w = new WikiStream(Object.assign({
    prefilter: wikiPrefilter,
    onItem: (r) => items.push(r),
    now: clock.now,
    reconnectBaseMs: 1,
    fetchImpl: async () => { throw new Error('unused'); }
  }, opts));
  return { w, items, clock };
}

// Controllable body: chunks pushed from the test, ending when the test says so.
function streamBody() {
  let ctl;
  const enc = new TextEncoder();
  const body = new ReadableStream({ start(c) { ctl = c; } });
  return {
    body,
    send: (s) => ctl.enqueue(typeof s === 'string' ? enc.encode(s) : s),
    end: () => ctl.close()
  };
}

function wikiWithServer(opts) {
  const connections = [];
  const ctx = wiki(Object.assign({
    fetchImpl: async (url, init) => {
      const s = streamBody();
      connections.push(Object.assign(s, { url, init }));
      return new Response(s.body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
  }, opts));
  return Object.assign(ctx, { connections });
}

const feed = (w, obj, id) => w._event({ event: 'message', data: JSON.stringify(obj), id: id || '' });

test('wiki: a new article whose title hits becomes a signal item', () => {
  const { w, items } = wiki();
  feed(w, change({ type: 'new', comment: 'Created page' }));
  assert.strictEqual(items.length, 1);
  const r = items[0];
  assert.strictEqual(r.sid, 'wiki');
  assert.strictEqual(r.cls, 'signal');
  assert.strictEqual(r.h, 'New Wikipedia article: 2026 Long Beach port strike');
  assert.strictEqual(r.u, 'https://en.wikipedia.org/wiki/2026_Long_Beach_port_strike');
  assert.strictEqual(r.pt, Math.floor(T0 / 1000) * 1000);
  assert.strictEqual(r.pub, 'wikipedia.org');
});

test('wiki: everything is counted, only an enwiki main-space hit is emitted', () => {
  const { w, items } = wiki();
  feed(w, change({ type: 'new', wiki: 'dewiki' }));
  feed(w, change({ type: 'new', wiki: 'commonswiki', namespace: 6 }));
  feed(w, change({ type: 'new', namespace: 1 }));
  feed(w, change({ type: 'new', title: 'Cat breeds' }));
  feed(w, change({ type: 'new', bot: true }));
  feed(w, change({ type: 'log' }));
  assert.strictEqual(items.length, 0);
  assert.strictEqual(w.status().perMin, 6);
});

test('wiki: a redirect created at a matching title is not a new article', () => {
  const { w, items } = wiki();
  feed(w, change({ type: 'new', comment: 'Redirected page to [[Port strike]]' }));
  assert.strictEqual(items.length, 0);
});

test('wiki: an edit surge needs 12 edits by 6 users in 10 minutes', () => {
  const { w, items } = wiki();
  const t0 = Math.floor(T0 / 1000);
  for (let i = 0; i < 11; i++) feed(w, change({ user: 'U' + (i % 6), timestamp: t0 + i }));
  assert.strictEqual(items.length, 0, '11 edits is not enough');
  feed(w, change({ user: 'U0', timestamp: t0 + 12 }));
  assert.strictEqual(items.length, 1);
  const r = items[0];
  assert.strictEqual(r.h, 'Wikipedia edit surge: 2026 Long Beach port strike');
  assert.strictEqual(r.x, '12 edits by 6 editors in 10 minutes');
  assert.match(r.u, /^https:\/\/en\.wikipedia\.org\/w\/index\.php\?title=2026_Long_Beach_port_strike&action=history&wire=\d+$/);
});

test('wiki: 5 editors making 50 edits is an edit war, not a surge', () => {
  const { w, items } = wiki();
  const t0 = Math.floor(T0 / 1000);
  for (let i = 0; i < 50; i++) feed(w, change({ user: 'U' + (i % 5), timestamp: t0 + i }));
  assert.strictEqual(items.length, 0);
});

test('wiki: edits spread past 10 minutes do not add up', () => {
  const { w, items } = wiki();
  const t0 = Math.floor(T0 / 1000);
  for (let i = 0; i < 40; i++) feed(w, change({ user: 'U' + (i % 8), timestamp: t0 + i * 60 }));
  assert.strictEqual(items.length, 0);
});

test('wiki: a surge fires once per title per 6 hours', () => {
  const { w, items } = wiki();
  let t = Math.floor(T0 / 1000);
  const burst = () => {
    for (let i = 0; i < 20; i++) feed(w, change({ user: 'U' + (i % 7), timestamp: t + i }));
  };
  burst();
  assert.strictEqual(items.length, 1);
  t += 1800;
  burst();
  assert.strictEqual(items.length, 1, 'still inside 6 h');
  t += 6 * 3600;
  burst();
  assert.strictEqual(items.length, 2);
  assert.notStrictEqual(items[0].u, items[1].u, 'the second surge needs its own identity');
});

test('wiki: a surge and the new-article item for one page have different urls', () => {
  const { w, items } = wiki();
  const t0 = Math.floor(T0 / 1000);
  feed(w, change({ type: 'new', user: 'U0', timestamp: t0 }));
  for (let i = 1; i < 14; i++) feed(w, change({ user: 'U' + (i % 7), timestamp: t0 + i }));
  assert.strictEqual(items.length, 2);
  assert.notStrictEqual(items[0].u, items[1].u, 'otherwise the surge dedupes against the article');
});

test('wiki: a surge on a title that misses the prefilter is never emitted', () => {
  const { w, items } = wiki();
  const t0 = Math.floor(T0 / 1000);
  for (let i = 0; i < 30; i++) feed(w, change({ title: 'Popular Singer', user: 'U' + (i % 9), timestamp: t0 + i }));
  assert.strictEqual(items.length, 0);
  assert.strictEqual(w.titles.size, 0, 'and it costs no memory');
  assert.strictEqual(w.status().perMin, 30);
});

test('wiki: bad data and a consumer exception are contained', () => {
  const { w } = wiki({ onItem: () => { throw new Error('consumer bug'); } });
  w._event({ event: 'message', data: 'not json', id: '' });
  feed(w, change({ type: 'new' }));
  assert.strictEqual(w.status().lastEvent != null, true);
});

test('wiki: reads a real stream with chunks cut through a multi-byte character', async () => {
  const { w, items, connections } = wikiWithServer();
  w.start();
  assert.ok(await until(() => connections.length === 1));
  assert.strictEqual(connections[0].url, 'https://stream.wikimedia.org/v2/stream/recentchange');
  assert.strictEqual(connections[0].init.headers.Accept, 'text/event-stream');
  assert.match(connections[0].init.headers['User-Agent'], /^KitsuneBDOC-Wire/);

  const bytes = new TextEncoder().encode(':ok\n\n' + sse(change({ type: 'new', title: 'Attack on São Paulo \u{1F525}', comment: 'new' })));
  const cut = bytes.indexOf(0xC3) + 1; // between the two bytes of a-tilde
  assert.ok(cut > 0);
  connections[0].send(bytes.subarray(0, cut));
  await wait(5);
  connections[0].send(bytes.subarray(cut));
  assert.ok(await until(() => items.length === 1));
  assert.strictEqual(items[0].h, 'New Wikipedia article: Attack on São Paulo \u{1F525}');
  assert.strictEqual(w.status().ok, true);
  await w.stop();
  assert.strictEqual(w.status().ok, false);
});

test('wiki: a closed stream reconnects and resumes from the last event id', async () => {
  const { w, connections } = wikiWithServer();
  w.start();
  await until(() => connections.length === 1);
  connections[0].send(sse(change({}), '[{"topic":"t","offset":42}]'));
  await until(() => w.lastId !== '');
  connections[0].end();
  assert.ok(await until(() => connections.length === 2));
  assert.strictEqual(connections[1].init.headers['Last-Event-ID'], '[{"topic":"t","offset":42}]');
  await w.stop();
});

test('wiki: a failed connection retries', async () => {
  let calls = 0;
  const { w } = wiki({
    fetchImpl: async () => {
      calls++;
      return new Response('nope', { status: 503 });
    }
  });
  w.start();
  assert.ok(await until(() => calls >= 3));
  await w.stop();
  assert.strictEqual(w.status().ok, false);
});

test('wiki: 30 s with no event aborts the connection and reconnects', async () => {
  const clock = fakeClock();
  const { w, connections } = wikiWithServer({ clock });
  w.start();
  await until(() => connections.length === 1);
  connections[0].send(sse(change({})));
  await until(() => w.lastEvent != null);
  clock.advance(29999);
  w._watchdog();
  await wait(5);
  assert.strictEqual(connections.length, 1);
  clock.advance(1);
  w._watchdog();
  assert.ok(connections[0].init.signal.aborted, 'the stalled request is aborted');
  assert.ok(await until(() => connections.length === 2));
  await w.stop();
});

test('wiki: a connect that hangs is a stall too', async () => {
  const clock = fakeClock();
  let calls = 0;
  const { w } = wiki({
    clock,
    fetchImpl: () => {
      calls++;
      return new Promise(() => {});
    }
  });
  w.start();
  await until(() => calls === 1);
  clock.advance(30000);
  w._watchdog();
  assert.ok(await until(() => calls === 2));
  await w.stop();
});

test('wiki: stop ends a stream cleanly and does not reconnect', async () => {
  const { w, connections } = wikiWithServer();
  w.start();
  await until(() => connections.length === 1);
  await w.stop();
  await wait(10);
  assert.strictEqual(connections.length, 1);
});

// ── GDELT ───────────────────────────────────────────────────────────────────

function gkgRow(i, title, over) {
  const o = over || {};
  const c = new Array(27).fill('');
  c[0] = '20261030171500-' + i;
  c[1] = '20261030171500';
  c[2] = '1';
  c[3] = o.domain || 'kktv.com';
  c[4] = o.url || 'https://www.kktv.com/news/' + i;
  c[9] = '3#Colorado Springs, Colorado, United States#US#USCO#38.8339#-104.821#204#';
  c[10] = o.v2 !== undefined ? o.v2 : '1#United States#US#US##39.8282#-98.5795#US#100;3#Colorado Springs, Colorado, United States#US#USCO#USCO041#38.8339#-104.821#204#44';
  c[26] = title === null ? '' : '<PAGE_PRECISEPUBTIMESTAMP>20261030170000</PAGE_PRECISEPUBTIMESTAMP><PAGE_TITLE>' + title + '</PAGE_TITLE>';
  return c.join('\t');
}

function zipOf(text, name) {
  const data = Buffer.from(text, 'utf8');
  const packed = zlib.deflateRawSync(data);
  const fileName = Buffer.from(name || '20261030171500.gkg.csv');
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(0, 6);
  h.writeUInt16LE(8, 8);
  h.writeUInt32LE(packed.length, 18);
  h.writeUInt32LE(data.length, 22);
  h.writeUInt16LE(fileName.length, 26);
  return Buffer.concat([h, fileName, packed]);
}

const LAST_UPDATE = (stamp) => `84014 371f http://data.gdeltproject.org/gdeltv2/${stamp}.export.CSV.zip
137904 0c19 http://data.gdeltproject.org/gdeltv2/${stamp}.mentions.CSV.zip
6297199 dc3e http://data.gdeltproject.org/gdeltv2/${stamp}.gkg.csv.zip
`;

function gdeltServer(state) {
  const log = [];
  const fetchImpl = async (url) => {
    log.push(url);
    if (url.endsWith('lastupdate.txt')) {
      if (state.indexDown) throw new Error('index down');
      return new Response(LAST_UPDATE(state.stamp));
    }
    if (state.zipStatus) return new Response('x', { status: state.zipStatus });
    return new Response(state.zip);
  };
  return { fetchImpl, log };
}

const gdeltPrefilter = (t) => /strike|riot|attack/i.test(t);

function gdelt(state, opts) {
  const server = gdeltServer(state);
  const batches = [];
  const g = new Gdelt(Object.assign({
    prefilter: gdeltPrefilter,
    onItems: (raws) => batches.push(raws),
    fetchImpl: server.fetchImpl
  }, opts));
  return { g, batches, log: server.log };
}

test('gdelt: bestLoc reads V2Locations and prefers the most precise place', () => {
  const v2 = '1#United States#US#US##39.8282#-98.5795#US#100;2#Colorado, United States#US#USCO##39.0#-105.5#CO#200;3#Colorado Springs, Colorado, United States#US#USCO#USCO041#38.8339#-104.821#204#44';
  const loc = bestLoc(v2);
  assert.strictEqual(loc.name, 'Colorado Springs, Colorado, United States');
  assert.strictEqual(loc.lat, 38.8339, 'lat is index 5 in V2, not index 4 as in V1');
  assert.strictEqual(loc.lon, -104.821);
  assert.strictEqual(bestLoc(''), null);
  assert.strictEqual(bestLoc('garbage;1#short'), null);
});

test('gdelt: unzipFirst handles deflate, stored, and rejects junk', async () => {
  const inflated = await unzipFirst(zipOf('hello gdelt'));
  assert.strictEqual(inflated.toString(), 'hello gdelt');
  assert.ok(Buffer.isBuffer(inflated));
  await assert.rejects(() => unzipFirst(Buffer.from('<Error><Code>NoSuchKey</Code></Error>'.padEnd(40))), /not a zip/);
  await assert.rejects(() => unzipFirst(Buffer.alloc(4)), /not a zip/);
  const stored = zipOf('x');
  stored.writeUInt16LE(99, 8);
  await assert.rejects(() => unzipFirst(stored), /unsupported method/);
});

test('gdelt: unzipFirst survives a streamed zip with sizes only in the central directory', async () => {
  const body = zlib.deflateRawSync(Buffer.from('streamed'));
  const zip = zipOf('streamed');
  const local = Buffer.from(zip.subarray(0, 30 + 22));
  local.writeUInt16LE(0x08, 6);
  local.writeUInt32LE(0, 18);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(body.length, 20);
  assert.strictEqual((await unzipFirst(Buffer.concat([local, body, central]))).toString(), 'streamed');
});

test('gdelt: clockStamp is on a 15-minute boundary and allows for publishing delay', () => {
  assert.strictEqual(clockStamp(Date.UTC(2026, 9, 30, 17, 44, 12)), '20261030171000'.replace('1710', '1700'));
  assert.strictEqual(clockStamp(Date.UTC(2026, 9, 30, 17, 46, 0)), '20261030171500');
});

test('gdelt: emits only titles that hit the prefilter, as aggregator items with geo', async () => {
  const csv = [
    gkgRow(1, 'Port strike shuts Long Beach terminals'),
    gkgRow(2, 'Local bakery wins award'),
    gkgRow(3, null),
    gkgRow(4, 'Riot reported downtown', { domain: 'bbc.co.uk', url: 'https://www.bbc.co.uk/news/1', v2: '1#United Kingdom#UK#UK##54#-2#UK#10' })
  ].join('\n');
  const { g, batches } = gdelt({ stamp: '20261030171500', zip: zipOf(csv) });
  const raws = await g.pollOnce();
  assert.strictEqual(raws.length, 2);
  assert.strictEqual(batches.length, 1);
  const [a, b] = raws;
  assert.strictEqual(a.sid, 'gdelt');
  assert.strictEqual(a.cls, 'aggregator');
  assert.strictEqual(a.sn, 'kktv.com');
  assert.strictEqual(a.pub, 'kktv.com');
  assert.strictEqual(a.h, 'Port strike shuts Long Beach terminals');
  assert.strictEqual(a.u, 'https://www.kktv.com/news/1');
  assert.strictEqual(a.guid, '20261030171500-1');
  assert.strictEqual(a.pt, Date.UTC(2026, 9, 30, 17, 15, 0));
  assert.deepStrictEqual(a.geo, { p: 'Colorado Springs, Colorado, United States', lat: 38.8339, lon: -104.821, r: 15000, cc: 'US' });
  assert.strictEqual(b.pub, 'bbc.co.uk');
  assert.strictEqual(b.geo.r, 400000, 'a country match is not a pin');
  assert.strictEqual(b.geo.cc, undefined, 'UK is a FIPS code here, not ISO');
  const st = g.status();
  assert.strictEqual(st.ok, true);
  assert.strictEqual(st.rows, 4);
  assert.strictEqual(st.hits, 2);
  assert.strictEqual(st.stamp, '20261030171500');
});

test('gdelt: at most 200 rows from a file, with duplicates removed', async () => {
  const rows = [];
  for (let i = 0; i < 500; i++) rows.push(gkgRow(i, 'Port strike update ' + i));
  rows.unshift(gkgRow(9000, 'Port strike duplicate', { url: 'https://dup.example/1' }));
  rows.unshift(gkgRow(9001, 'Port strike duplicate', { url: 'https://dup.example/1' }));
  const { g } = gdelt({ stamp: '20261030171500', zip: zipOf(rows.join('\n')) });
  const raws = await g.pollOnce();
  assert.strictEqual(MAX_ROWS, 200);
  assert.strictEqual(raws.length, 200);
  assert.strictEqual(raws.filter((r) => r.u === 'https://dup.example/1').length, 1);
  assert.strictEqual(g.status().hits, 502, 'the count still sees everything');
});

test('gdelt: hostile titles and urls are cleaned', async () => {
  const csv = [
    gkgRow(1, '&lt;script&gt;alert(1)&lt;/script&gt;Riot &amp; fire'),
    gkgRow(2, 'Strike at a non-web source', { url: 'BBC Monitoring' }),
    gkgRow(3, 'Attack link', { url: 'javascript:alert(1)' })
  ].join('\n');
  const { g } = gdelt({ stamp: '20261030171500', zip: zipOf(csv) });
  const raws = await g.pollOnce();
  assert.deepStrictEqual(raws.map((r) => r.h), ['Riot & fire']);
});

test('gdelt: the same stamp is not downloaded twice, a new one is', async () => {
  const state = { stamp: '20261030171500', zip: zipOf(gkgRow(1, 'Port strike')) };
  const { g, log, batches } = gdelt(state);
  await g.pollOnce();
  await g.pollOnce();
  assert.strictEqual(log.filter((u) => u.endsWith('.zip')).length, 1);
  state.stamp = '20261030173000';
  await g.pollOnce();
  assert.strictEqual(log.filter((u) => u.endsWith('.zip')).length, 2);
  assert.ok(log.includes('https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/20261030173000.gkg.csv.zip'));
  assert.strictEqual(batches.length, 2);
});

test('gdelt: the first file after a start is firstPoll, later ones are not', async () => {
  const state = { stamp: '20261030171500', zip: zipOf(gkgRow(1, 'Port strike')) };
  const { g } = gdelt(state);
  assert.strictEqual((await g.pollOnce())[0].firstPoll, true);
  state.stamp = '20261030173000';
  assert.strictEqual((await g.pollOnce())[0].firstPoll, false);
});

test('gdelt: if the index is down the stamp comes from the clock', async () => {
  const now = Date.UTC(2026, 9, 30, 17, 46, 0);
  const { g, log } = gdelt({ indexDown: true, stamp: 'x', zip: zipOf(gkgRow(1, 'Port strike')) }, { now: () => now });
  const raws = await g.pollOnce();
  assert.strictEqual(raws.length, 1);
  assert.ok(log.some((u) => u.endsWith('/20261030171500.gkg.csv.zip')));
});

test('gdelt: a missing file is a status line, never a crash, and it retries', async () => {
  const state = { stamp: '20261030171500', zipStatus: 404, zip: zipOf(gkgRow(1, 'Port strike')) };
  const { g, log } = gdelt(state);
  assert.deepStrictEqual(await g.pollOnce(), []);
  assert.strictEqual(g.status().ok, false);
  assert.strictEqual(g.status().err, 'HTTP 404');
  state.zipStatus = 0;
  const raws = await g.pollOnce();
  assert.strictEqual(raws.length, 1);
  assert.strictEqual(raws[0].firstPoll, true, 'nothing was delivered yet, so this is still the backlog');
  assert.strictEqual(g.status().ok, true);
  assert.strictEqual(log.filter((u) => u.endsWith('.zip')).length, 2);
});

test('gdelt: a garbage body does not count as read', async () => {
  const state = { stamp: '20261030171500', zip: Buffer.from('<Error><Code>NoSuchKey</Code></Error>'.padEnd(64)) };
  const { g } = gdelt(state);
  assert.deepStrictEqual(await g.pollOnce(), []);
  assert.match(g.status().err, /not a zip/);
  assert.strictEqual(g.lastStamp, null);
});

test('gdelt: if the pipeline throws, the file is retried', async () => {
  let boom = true;
  const state = { stamp: '20261030171500', zip: zipOf(gkgRow(1, 'Port strike')) };
  const { g } = gdelt(state, {
    onItems: () => {
      if (boom) throw new Error('sqlite locked');
    }
  });
  await g.pollOnce();
  assert.strictEqual(g.lastStamp, null);
  boom = false;
  assert.strictEqual((await g.pollOnce()).length, 1);
});

test('gdelt: a prefilter that throws counts as a miss', async () => {
  const { g } = gdelt({ stamp: '20261030171500', zip: zipOf(gkgRow(1, 'Port strike')) }, {
    prefilter: () => { throw new Error('bad'); }
  });
  assert.deepStrictEqual(await g.pollOnce(), []);
  assert.strictEqual(g.status().ok, true);
});

test('gdelt: status goes false when files stop arriving', async () => {
  const clock = fakeClock();
  const { g } = gdelt({ stamp: '20261030171500', zip: zipOf(gkgRow(1, 'Port strike')) }, { now: clock.now });
  assert.strictEqual(g.status().ok, false, 'nothing has arrived yet');
  await g.pollOnce();
  assert.strictEqual(g.status().ok, true);
  clock.advance(36 * 60000);
  assert.strictEqual(g.status().ok, false);
});

test('gdelt: start and stop run a real poll and end cleanly', async () => {
  const { g, batches } = gdelt({ stamp: '20261030171500', zip: zipOf(gkgRow(1, 'Port strike')) }, { pollMs: 5 });
  g.start();
  g.start();
  assert.ok(await until(() => batches.length === 1));
  await g.stop();
  assert.strictEqual(g.running, false);
});

test('gdelt: a row with no title tag costs nothing even in a huge file', () => {
  const { rowsFrom } = require('../tools/wire/lib/gdelt');
  const noTitles = gkgRow(1, null);
  const csv = new Array(20000).fill(noTitles).join('\n');
  const started = Date.now();
  const out = rowsFrom(csv + '\n' + gkgRow(2, 'Port strike'), gdeltPrefilter, false);
  assert.strictEqual(out.raws.length, 1);
  assert.ok(Date.now() - started < 2000, 'took ' + (Date.now() - started) + ' ms');
});
