// Tests for tools/wire/lib/fetcher.js.
//
// Time is a fake clock and the network is a fake fetch, so backoff and per-host gaps can
// be checked exactly and the suite does not sit waiting on real minutes. Polls are driven
// through _tick(), which launches whatever is due and waits for those polls to finish.
// One test at the end runs the real start()/stop() loop.

'use strict';

const test = require('node:test');

// The scheduler unrefs its timeout timers so they can never hold a shutdown open. In the
// daemon a socket keeps the loop alive; here nothing would, and Node 20 and 22 then end the
// run mid-test. Node 24 waits, which is how this passed on the laptop and failed in CI.
const keepAlive = setInterval(() => {}, 1000);
test.after(() => clearInterval(keepAlive));

const assert = require('node:assert');

const { Scheduler, HOST_GAPS } = require('../tools/wire/lib/fetcher');

const FEED = `<rss><channel>
  <item><title>Item one</title><link>https://example.com/1</link><guid>g1</guid><pubDate>Fri, 30 Oct 2026 12:00:00 GMT</pubDate></item>
  <item><title>Item two</title><link>https://example.com/2</link><guid>g2</guid><pubDate>Fri, 30 Oct 2026 11:00:00 GMT</pubDate></item>
</channel></rss>`;

const T0 = Date.UTC(2026, 9, 30, 12, 30, 0);

function fakeClock(start) {
  let t = start || T0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const source = (over) => Object.assign({
  id: 'a', name: 'Source A', cls: 'wire', kind: 'rss', url: 'https://feeds.example.com/a.xml', every: 60
}, over);

const respond = (body, init) => new Response(body, init || { status: 200 });

// random: 0.5 makes the jitter factor exactly 1, so timings can be asserted exactly.
function build(opts) {
  const clock = opts.clock || fakeClock();
  const calls = [];
  const fetchImpl = opts.fetchImpl || (async (url, init) => {
    calls.push({ url, init, t: clock.now() });
    return respond(FEED);
  });
  const got = [];
  const sched = new Scheduler(Object.assign({
    onItems: (items, src) => { got.push({ items, src }); },
    isFirstPoll: () => false,
    markPolled: () => {},
    fetchImpl,
    now: clock.now,
    random: () => 0.5
  }, opts, { fetchImpl }));
  return { sched, clock, calls, got };
}

const row = (sched, id) => sched.health().find((h) => h.id === id);
const nextIn = (sched, id, clock) => sched.states.get(id).nextAt - clock.now();

// ── basic poll ──────────────────────────────────────────────────────────────

test('a poll fetches, parses, hands over items and reports health', async () => {
  const { sched, got, calls, clock } = build({ sources: [source()] });
  await sched._tick();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].src.id, 'a');
  assert.deepStrictEqual(got[0].items.map((i) => i.h), ['Item one', 'Item two']);
  const h = row(sched, 'a');
  assert.deepStrictEqual(
    Object.keys(h).filter((k) => k !== 'stale').sort(),
    ['c1h', 'c24h', 'cls', 'err', 'every', 'fails', 'id', 'kind', 'lastErr', 'lastOk', 'n', 'newest', 'ok'].sort()
  );
  assert.strictEqual(h.ok, true);
  assert.strictEqual(h.n, 'Source A');
  assert.strictEqual(h.cls, 'wire');
  assert.strictEqual(h.kind, 'rss');
  assert.strictEqual(h.every, 60);
  assert.strictEqual(h.lastOk, clock.now());
  assert.strictEqual(h.lastErr, null);
  assert.strictEqual(h.err, null);
  assert.strictEqual(h.fails, 0);
  assert.strictEqual(h.newest, Date.UTC(2026, 9, 30, 12, 0, 0));
});

test('a source that was never polled is not reported as ok', () => {
  const { sched } = build({ sources: [source()] });
  const h = row(sched, 'a');
  assert.strictEqual(h.ok, false);
  assert.strictEqual(h.lastOk, null);
  assert.strictEqual(h.newest, null);
});

test('the honest UA goes out, with a per-source override and a kind-specific Accept', async () => {
  const { sched, calls, clock } = build({
    sources: [
      source(),
      source({ id: 'nws', kind: 'nws', url: 'https://api.weather.gov/alerts', ua: 'Custom/1.0' }),
      source({ id: 'tg', kind: 'telegram', url: 'https://t.me/s/x' })
    ],
    fetchImpl: async () => respond('{}')
  });
  void clock;
  sched.fetchImpl = async (url, init) => { calls.push({ url, init }); return respond('{"features":[]}'); };
  await sched._tick();
  const byUrl = new Map(calls.map((c) => [c.url, c.init.headers]));
  assert.strictEqual(byUrl.get('https://feeds.example.com/a.xml')['User-Agent'], 'KitsuneBDOC-Wire/1.0 (+https://kgsbdoc.netlify.app)');
  const nws = byUrl.get('https://api.weather.gov/alerts');
  assert.strictEqual(nws['User-Agent'], 'Custom/1.0');
  assert.match(nws.Accept, /^application\/geo\+json/, 'NWS negotiates: Atom first would get Atom back');
  assert.match(byUrl.get('https://t.me/s/x').Accept, /^text\/html/);
});

test('the next poll comes one interval later', async () => {
  const { sched, clock } = build({ sources: [source({ every: 90 })] });
  await sched._tick();
  assert.strictEqual(nextIn(sched, 'a', clock), 90000);
});

// ── first poll ──────────────────────────────────────────────────────────────

test('firstPoll is set on raw items and the source is marked polled', async () => {
  const polled = [];
  let isNew = true;
  const { sched, got, clock } = build({
    sources: [source()],
    isFirstPoll: () => isNew,
    markPolled: (id) => { polled.push(id); isNew = false; }
  });
  await sched._tick();
  assert.ok(got[0].items.every((i) => i.firstPoll === true));
  assert.deepStrictEqual(polled, ['a']);
  clock.advance(60000);
  await sched._tick();
  assert.ok(got[1].items.every((i) => i.firstPoll === false));
  assert.deepStrictEqual(polled, ['a'], 'only once');
});

test('a failed first poll does not count as polled, so the backlog stays flagged', async () => {
  const polled = [];
  const { sched } = build({
    sources: [source()],
    isFirstPoll: () => true,
    markPolled: (id) => polled.push(id),
    fetchImpl: async () => respond('nope', { status: 500 })
  });
  await sched._tick();
  assert.deepStrictEqual(polled, []);
});

test('an empty first poll counts as polled: the first NTAS bulletin must be able to page', async () => {
  const polled = [];
  let isNew = true;
  const seen = [];
  let body = '<alerts></alerts>';
  const { sched, clock } = build({
    sources: [source({ id: 'ntas', kind: 'ntas', url: 'https://www.dhs.gov/ntas/1.1/alerts.xml' })],
    isFirstPoll: () => isNew,
    markPolled: (id) => { polled.push(id); isNew = false; },
    onItems: (items) => seen.push(...items),
    fetchImpl: async () => respond(body)
  });
  await sched._tick();
  assert.deepStrictEqual(polled, ['ntas']);
  body = '<alerts><alert type="Bulletin" start="2026/10/30 12:00"></alert></alerts>';
  clock.advance(120000);
  await sched._tick();
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].firstPoll, false);
  assert.strictEqual(seen[0].sev0, 3);
});

// ── backoff ─────────────────────────────────────────────────────────────────

test('backoff doubles per failure and is capped at 900 s', async () => {
  const { sched, clock } = build({ sources: [source({ every: 60 })], fetchImpl: async () => respond('x', { status: 500 }) });
  const waits = [];
  for (let i = 0; i < 6; i++) {
    await sched._tick();
    waits.push(nextIn(sched, 'a', clock));
    assert.strictEqual(row(sched, 'a').fails, i + 1);
    clock.advance(waits[i]);
  }
  assert.deepStrictEqual(waits, [120000, 240000, 480000, 900000, 900000, 900000]);
  assert.strictEqual(row(sched, 'a').err, 'HTTP 500');
  assert.strictEqual(row(sched, 'a').ok, false);
});

test('a source that fails is not polled again until its backoff is over', async () => {
  const { sched, clock } = build({ sources: [source({ every: 60 })] });
  let hits = 0;
  sched.fetchImpl = async () => { hits++; return respond('x', { status: 503 }); };
  await sched._tick();
  assert.strictEqual(hits, 1);
  clock.advance(119999);
  await sched._tick();
  assert.strictEqual(hits, 1);
  clock.advance(1);
  await sched._tick();
  assert.strictEqual(hits, 2);
});

test('a network error backs off like an HTTP error', async () => {
  const { sched, clock } = build({ sources: [source()], fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  await sched._tick();
  assert.strictEqual(nextIn(sched, 'a', clock), 120000);
  assert.strictEqual(row(sched, 'a').err, 'ECONNRESET');
  assert.strictEqual(row(sched, 'a').lastErr, clock.now());
});

test('recovery resets the failure count and the interval', async () => {
  let fail = true;
  const { sched, clock } = build({
    sources: [source()],
    fetchImpl: async () => (fail ? respond('x', { status: 500 }) : respond(FEED))
  });
  await sched._tick();
  clock.advance(120000);
  await sched._tick();
  assert.strictEqual(row(sched, 'a').fails, 2);
  fail = false;
  clock.advance(240000);
  await sched._tick();
  const h = row(sched, 'a');
  assert.strictEqual(h.fails, 0);
  assert.strictEqual(h.ok, true);
  assert.strictEqual(h.err, null);
  assert.ok(h.lastErr != null, 'the last error time stays visible');
  assert.strictEqual(nextIn(sched, 'a', clock), 60000);
});

test('a feed slower than the backoff cap never polls faster for being broken', async () => {
  const { sched, clock } = build({ sources: [source({ every: 1800 })], fetchImpl: async () => respond('x', { status: 500 }) });
  await sched._tick();
  assert.strictEqual(nextIn(sched, 'a', clock), 1800000);
});

// ── Retry-After ─────────────────────────────────────────────────────────────

test('Retry-After in seconds beats a shorter backoff', async () => {
  const { sched, clock } = build({
    sources: [source()],
    fetchImpl: async () => respond('x', { status: 429, headers: { 'Retry-After': '600' } })
  });
  await sched._tick();
  assert.strictEqual(nextIn(sched, 'a', clock), 600000);
});

test('Retry-After as an HTTP date is honoured', async () => {
  const clock = fakeClock();
  const when = new Date(clock.now() + 300000).toUTCString();
  const { sched } = build({
    clock,
    sources: [source()],
    fetchImpl: async () => respond('x', { status: 503, headers: { 'Retry-After': when } })
  });
  await sched._tick();
  assert.strictEqual(nextIn(sched, 'a', clock), 300000);
});

test('a shorter Retry-After does not cut the backoff', async () => {
  const { sched, clock } = build({
    sources: [source()],
    fetchImpl: async () => respond('x', { status: 503, headers: { 'Retry-After': '5' } })
  });
  await sched._tick();
  assert.strictEqual(nextIn(sched, 'a', clock), 120000);
});

test('a nonsense Retry-After cannot blind a source for days', async () => {
  const { sched, clock } = build({
    sources: [source()],
    fetchImpl: async () => respond('x', { status: 429, headers: { 'Retry-After': '999999' } })
  });
  await sched._tick();
  assert.strictEqual(nextIn(sched, 'a', clock), 3600000);
});

test('a 429 holds the whole host, so sibling sources do not walk into it', async () => {
  const hits = [];
  const { sched, clock } = build({
    sources: [
      source({ id: 'g1', url: 'https://news.google.com/rss/a' }),
      source({ id: 'g2', url: 'https://news.google.com/rss/b' }),
      source({ id: 'other', url: 'https://other.example/rss' })
    ],
    fetchImpl: async (url) => {
      hits.push(url);
      return url.endsWith('/a') ? respond('x', { status: 429, headers: { 'Retry-After': '120' } }) : respond(FEED);
    }
  });
  await sched._tick();
  assert.deepStrictEqual(hits, ['https://news.google.com/rss/a', 'https://other.example/rss']);
  clock.advance(119999);
  await sched._tick();
  assert.ok(!hits.includes('https://news.google.com/rss/b'), 'g2 waits out the hold');
  clock.advance(1);
  await sched._tick();
  assert.ok(hits.includes('https://news.google.com/rss/b'));
  assert.strictEqual(row(sched, 'g2').fails, 0, 'waiting is not a failure');
});

test('a 429 with no Retry-After still holds the host for a minute', async () => {
  const hits = [];
  const { sched, clock } = build({
    sources: [source({ id: 'g1', url: 'https://x.example/a' }), source({ id: 'g2', url: 'https://x.example/b' })],
    fetchImpl: async (url) => { hits.push(url); return respond('x', { status: 429 }); }
  });
  await sched._tick();
  clock.advance(59999);
  await sched._tick();
  assert.strictEqual(hits.length, 1);
  clock.advance(1);
  await sched._tick();
  assert.strictEqual(hits.length, 2);
});

// ── conditional GET ─────────────────────────────────────────────────────────

test('ETag and Last-Modified go back on the next request, and a 304 is healthy', async () => {
  const requests = [];
  let parsed = 0;
  const { sched, clock } = build({
    sources: [source()],
    onItems: () => { parsed++; },
    fetchImpl: async (url, init) => {
      requests.push(init.headers);
      if (requests.length === 1) {
        return respond(FEED, { status: 200, headers: { ETag: '"abc"', 'Last-Modified': 'Fri, 30 Oct 2026 12:00:00 GMT' } });
      }
      return new Response(null, { status: 304 });
    }
  });
  await sched._tick();
  assert.strictEqual(requests[0]['If-None-Match'], undefined);
  assert.strictEqual(requests[0]['If-Modified-Since'], undefined);
  clock.advance(60000);
  await sched._tick();
  assert.strictEqual(requests[1]['If-None-Match'], '"abc"');
  assert.strictEqual(requests[1]['If-Modified-Since'], 'Fri, 30 Oct 2026 12:00:00 GMT');
  assert.strictEqual(parsed, 1, 'a 304 hands over nothing');
  const h = row(sched, 'a');
  assert.strictEqual(h.ok, true);
  assert.strictEqual(h.lastOk, clock.now());
  assert.strictEqual(h.newest, Date.UTC(2026, 9, 30, 12, 0, 0), 'newest is kept');
  assert.strictEqual(nextIn(sched, 'a', clock), 60000);

  clock.advance(60000);
  await sched._tick();
  assert.strictEqual(requests[2]['If-None-Match'], '"abc"', 'a 304 keeps the validators');
});

test('validators are not kept when the body fails to parse, or the bad copy sticks', async () => {
  const requests = [];
  const { sched, clock } = build({
    sources: [source()],
    fetchImpl: async (url, init) => {
      requests.push(init.headers);
      return requests.length === 1
        ? respond('<html>oops</html>', { status: 200, headers: { ETag: '"bad"' } })
        : respond(FEED, { status: 200, headers: { ETag: '"good"' } });
    }
  });
  await sched._tick();
  assert.strictEqual(row(sched, 'a').ok, false);
  clock.advance(120000);
  await sched._tick();
  assert.strictEqual(requests[1]['If-None-Match'], undefined);
  assert.strictEqual(row(sched, 'a').ok, true);
});

test('validators are not kept when the pipeline fails, so the items are offered again', async () => {
  const requests = [];
  let boom = true;
  const handed = [];
  const { sched, clock } = build({
    sources: [source()],
    onItems: (items) => {
      if (boom) throw new Error('sqlite is locked');
      handed.push(...items);
    },
    fetchImpl: async (url, init) => {
      requests.push(init.headers);
      return respond(FEED, { status: 200, headers: { ETag: '"e"' } });
    }
  });
  await sched._tick();
  assert.strictEqual(row(sched, 'a').ok, false);
  assert.match(row(sched, 'a').err, /sqlite is locked/);
  boom = false;
  clock.advance(120000);
  await sched._tick();
  assert.strictEqual(requests[1]['If-None-Match'], undefined);
  assert.strictEqual(handed.length, 2);
  assert.strictEqual(row(sched, 'a').c24h, 2, 'the retry is not counted twice');
});

// ── per-host gap and concurrency ────────────────────────────────────────────

test('per-host gap: 250 ms by default', async () => {
  const hits = [];
  const { sched, clock } = build({
    sources: [source({ id: 'a' }), source({ id: 'b', url: 'https://feeds.example.com/b.xml' })],
    fetchImpl: async (url) => { hits.push({ url, t: clock.now() }); return respond(FEED); }
  });
  await sched._tick();
  assert.strictEqual(hits.length, 1);
  clock.advance(249);
  await sched._tick();
  assert.strictEqual(hits.length, 1);
  clock.advance(1);
  await sched._tick();
  assert.strictEqual(hits.length, 2);
  assert.strictEqual(hits[1].t - hits[0].t, 250);
});

test('per-host gap: 1.5 s for news.google.com and 3 s for t.me', async () => {
  assert.strictEqual(HOST_GAPS.get('news.google.com'), 1500);
  assert.strictEqual(HOST_GAPS.get('t.me'), 3000);
  for (const [host, gap] of [['news.google.com', 1500], ['t.me', 3000]]) {
    const hits = [];
    const { sched, clock } = build({
      sources: [
        source({ id: 'a', url: `https://${host}/a` }),
        source({ id: 'b', url: `https://${host}/b` }),
        source({ id: 'c', url: `https://${host}/c` })
      ],
      fetchImpl: async (url) => { hits.push(clock.now()); return respond(FEED); }
    });
    for (let i = 0; i < 12; i++) {
      await sched._tick();
      clock.advance(gap / 4);
    }
    assert.strictEqual(hits.length, 3, host);
    assert.strictEqual(hits[1] - hits[0], gap, host);
    assert.strictEqual(hits[2] - hits[1], gap, host);
  }
});

test('the gap is per host: different hosts go together', async () => {
  const hits = [];
  const { sched } = build({
    sources: [source({ id: 'a', url: 'https://one.example/a' }), source({ id: 'b', url: 'https://two.example/b' })],
    fetchImpl: async (url) => { hits.push(url); return respond(FEED); }
  });
  await sched._tick();
  assert.strictEqual(hits.length, 2);
});

test('global concurrency stops at 8', async () => {
  const release = [];
  let peak = 0;
  let active = 0;
  const sources = [];
  for (let i = 0; i < 20; i++) sources.push(source({ id: 's' + i, url: `https://host${i}.example/f` }));
  const { sched } = build({
    sources,
    fetchImpl: async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => release.push(r));
      active--;
      return respond(FEED);
    }
  });
  sched._launch();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(active, 8);
  sched._launch();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(active, 8, 'a second tick must not exceed it');
  while (release.length) release.shift()();
  await Promise.allSettled([...sched.inflight]);
  assert.strictEqual(peak, 8);
});

test('a source already in flight is not polled a second time', async () => {
  let hits = 0;
  let release;
  const { sched, clock } = build({
    sources: [source()],
    fetchImpl: async () => {
      hits++;
      await new Promise((r) => { release = r; });
      return respond(FEED);
    }
  });
  sched._launch();
  await new Promise((r) => setImmediate(r));
  clock.advance(600000);
  sched._launch();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(hits, 1);
  release();
  await Promise.allSettled([...sched.inflight]);
});

// ── jitter ──────────────────────────────────────────────────────────────────

test('jitter stays within 10 percent either way', async () => {
  for (const [r, expected] of [[0, 54000], [0.5, 60000], [1, 66000]]) {
    const { sched, clock } = build({ sources: [source()], random: () => r });
    await sched._tick();
    assert.ok(Math.abs(nextIn(sched, 'a', clock) - expected) < 1e-6, 'random ' + r);
  }
});

test('jitter applies to backoff, but Retry-After remains a floor', async () => {
  const { sched, clock } = build({
    sources: [source()],
    random: () => 0,
    fetchImpl: async () => respond('x', { status: 429, headers: { 'Retry-After': '120' } })
  });
  await sched._tick();
  assert.strictEqual(nextIn(sched, 'a', clock), 120000, 'jitter must not sneak under the server\'s wait');
});

// ── timeout and body cap ────────────────────────────────────────────────────

test('a request that never answers times out and backs off', async () => {
  const { sched, clock } = build({ sources: [source()], timeoutMs: 20, fetchImpl: () => new Promise(() => {}) });
  await sched._tick();
  const h = row(sched, 'a');
  assert.strictEqual(h.ok, false);
  assert.match(h.err, /timeout/);
  assert.strictEqual(nextIn(sched, 'a', clock), 120000);
});

test('the timeout passes an abort signal to fetch', async () => {
  let signal;
  const { sched } = build({
    sources: [source()],
    timeoutMs: 20,
    fetchImpl: (url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    }
  });
  await sched._tick();
  assert.strictEqual(signal.aborted, true);
});

test('a body that stalls halfway also times out', async () => {
  const stream = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('<rss><channel>')); }
  });
  const { sched } = build({ sources: [source()], timeoutMs: 20, fetchImpl: async () => new Response(stream) });
  await sched._tick();
  assert.match(row(sched, 'a').err, /timeout/);
});

test('reading stops at the body cap and a cut feed still gives its items', async () => {
  const item = '<item><title>Item</title><link>https://e.com/x</link></item>';
  let pulled = 0;
  const encoded = new TextEncoder().encode('<rss><channel>' + item.repeat(2000));
  const stream = new ReadableStream({
    pull(c) {
      pulled++;
      if (pulled > 1000) { c.close(); return; }
      c.enqueue(encoded);
    }
  });
  const cap = encoded.length * 2 + 100;
  const got = [];
  const { sched } = build({
    sources: [source()],
    bodyCap: cap,
    onItems: (items) => got.push(...items),
    fetchImpl: async () => new Response(stream)
  });
  await sched._tick();
  assert.ok(pulled < 10, 'stopped reading early, pulled ' + pulled);
  assert.ok(got.length > 0);
  assert.strictEqual(row(sched, 'a').ok, true);
});

test('the default body cap is 8 MB and the default timeout 15 s', () => {
  const { sched } = build({ sources: [] });
  assert.strictEqual(sched.bodyCap, 8 * 1024 * 1024);
  assert.strictEqual(sched.timeoutMs, 15000);
  assert.strictEqual(sched.concurrency, 8);
});

test('a non-UTF-8 feed is decoded by its declared charset', async () => {
  const bytes = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><item><title>Café</title><link>https://e.com/1</link></item></channel></rss>', 'latin1');
  const got = [];
  const { sched } = build({
    sources: [source()],
    onItems: (items) => got.push(...items),
    fetchImpl: async () => new Response(bytes)
  });
  await sched._tick();
  assert.strictEqual(got[0].h, 'Café');
});

// ── isolation ───────────────────────────────────────────────────────────────

test('one source failing to parse does not stop the others', async () => {
  const got = [];
  const { sched } = build({
    sources: [
      source({ id: 'bad', url: 'https://bad.example/f' }),
      source({ id: 'good', url: 'https://good.example/f' }),
      source({ id: 'bad2', kind: 'nws', url: 'https://bad2.example/f' })
    ],
    onItems: (items, src) => got.push(src.id),
    fetchImpl: async (url) => respond(url.includes('good') ? FEED : '<html>not a feed</html>')
  });
  await sched._tick();
  assert.deepStrictEqual(got, ['good']);
  assert.strictEqual(row(sched, 'bad').ok, false);
  assert.match(row(sched, 'bad').err, /not a feed/);
  assert.strictEqual(row(sched, 'bad2').ok, false);
  assert.match(row(sched, 'bad2').err, /not JSON/);
  assert.strictEqual(row(sched, 'good').ok, true);
});

test('an actual parser exception is contained the same way', async () => {
  const got = [];
  const { sched } = build({
    sources: [
      source({ id: 'broken', kind: 'no-such-parser', url: 'https://bad.example/f' }),
      source({ id: 'good', url: 'https://good.example/f' })
    ],
    onItems: (items, src) => got.push(src.id),
    fetchImpl: async () => respond(FEED)
  });
  await sched._tick();
  assert.deepStrictEqual(got, ['good']);
  assert.match(row(sched, 'broken').err, /unknown kind/);
});

test('onItems throwing for one source leaves the others alone', async () => {
  const got = [];
  const { sched } = build({
    sources: [source({ id: 'x', url: 'https://x.example/f' }), source({ id: 'y', url: 'https://y.example/f' })],
    onItems: async (items, src) => {
      if (src.id === 'x') throw new Error('pipeline bug');
      got.push(src.id);
    },
    fetchImpl: async () => respond(FEED)
  });
  await sched._tick();
  assert.deepStrictEqual(got, ['y']);
  assert.strictEqual(row(sched, 'x').ok, false);
  assert.strictEqual(row(sched, 'y').ok, true);
});

test('an error message cannot inject a newline into a health row', async () => {
  const { sched } = build({ sources: [source()], fetchImpl: async () => { throw new Error('bad\nsecond line'); } });
  await sched._tick();
  assert.strictEqual(row(sched, 'a').err, 'bad second line');
});

// ── parser context ──────────────────────────────────────────────────────────

test('ctx.official and FAA memory persist across polls through the scheduler', async () => {
  const faa = '<AIRPORT_STATUS_INFORMATION><Update_Time>Fri Oct 30 12:00:00 2026 GMT</Update_Time><Delay_type><Name>Ground Stops</Name><Ground_Stop_List><Program><ARPT>JFK</ARPT><Reason>weather</Reason></Program></Ground_Stop_List></Delay_type></AIRPORT_STATUS_INFORMATION>';
  const handed = [];
  const { sched, clock } = build({
    sources: [source({ id: 'faa', kind: 'faa', url: 'https://nasstatus.faa.gov/api/x' })],
    onItems: (items) => handed.push(...items),
    fetchImpl: async () => respond(faa)
  });
  await sched._tick();
  clock.advance(60000);
  await sched._tick();
  assert.strictEqual(handed.length, 1, 'announced once');
  assert.strictEqual(sched.ctx.official.faa.stops, 1);
});

test('a caller can share its own ctx', async () => {
  const ctx = { official: {} };
  const { sched } = build({
    sources: [source({ id: 'ntas', kind: 'ntas', url: 'https://www.dhs.gov/ntas/1.1/alerts.xml' })],
    ctx,
    fetchImpl: async () => respond('<alerts></alerts>')
  });
  await sched._tick();
  assert.strictEqual(sched.ctx, ctx);
  assert.deepStrictEqual(ctx.official.ntas, { active: false, title: null });
});

// ── rolling counts and newest ───────────────────────────────────────────────

const feedOf = (rows) => '<rss><channel>' + rows.map(([g, t]) =>
  `<item><title>T ${g}</title><link>https://e.com/${g}</link><guid>${g}</guid><pubDate>${new Date(t).toUTCString()}</pubDate></item>`).join('') + '</channel></rss>';

test('rolling counts see each guid once, and only inside their window', async () => {
  const clock = fakeClock();
  const now = clock.now();
  let body = feedOf([['recent', now - 600000], ['today', now - 5 * 3600000], ['old', now - 30 * 3600000]]);
  const { sched } = build({ clock, sources: [source()], fetchImpl: async () => respond(body) });
  await sched._tick();
  let h = row(sched, 'a');
  assert.strictEqual(h.c1h, 1);
  assert.strictEqual(h.c24h, 2);

  clock.advance(60000);
  await sched._tick();
  h = row(sched, 'a');
  assert.strictEqual(h.c1h, 1, 'a repeat on the next poll is not a new item');
  assert.strictEqual(h.c24h, 2);

  body = feedOf([['fresh', clock.now() - 1000], ['recent', now - 600000]]);
  clock.advance(60000);
  await sched._tick();
  assert.strictEqual(row(sched, 'a').c1h, 2);

  clock.advance(2 * 3600000);
  assert.strictEqual(row(sched, 'a').c1h, 0, 'the window rolls with no polls at all');
  assert.strictEqual(row(sched, 'a').c24h, 3);
});

test('a future-dated item cannot pose as fresh', async () => {
  const clock = fakeClock();
  const future = clock.now() + 7 * 24 * 3600000;
  const { sched } = build({ clock, sources: [source()], fetchImpl: async () => respond(feedOf([['maint', future]])) });
  await sched._tick();
  const seenAt = clock.now();
  assert.strictEqual(row(sched, 'a').newest, seenAt, 'dated when we saw it, not next week');
  clock.advance(60000);
  await sched._tick();
  assert.strictEqual(row(sched, 'a').newest, seenAt, 'and it does not refresh itself every poll');
});

test('an undated item is dated when first seen and not re-dated', async () => {
  const clock = fakeClock();
  const body = '<rss><channel><item><title>T</title><link>https://e.com/1</link><guid>g</guid></item></channel></rss>';
  const { sched } = build({ clock, sources: [source()], fetchImpl: async () => respond(body) });
  await sched._tick();
  const seenAt = clock.now();
  clock.advance(120000);
  await sched._tick();
  assert.strictEqual(row(sched, 'a').newest, seenAt);
});

// ── honest health ───────────────────────────────────────────────────────────

// The CNN and WSJ World case from the spec: 200, valid feed, content years old.
test('a 200 serving old content is not reported healthy', async () => {
  const clock = fakeClock();
  const old = clock.now() - 3 * 365 * 24 * 3600000;
  const body = feedOf([['a', old], ['b', old - 3600000], ['c', old - 7200000], ['d', old - 10800000]]);
  const { sched } = build({ clock, sources: [source()], fetchImpl: async () => respond(body) });
  await sched._tick();
  const h = row(sched, 'a');
  assert.strictEqual(h.ok, false);
  assert.strictEqual(h.stale, true);
  assert.strictEqual(h.err, 'stale');
  assert.strictEqual(h.fails, 0, 'the fetch itself worked');
  assert.ok(h.lastOk != null);
  assert.strictEqual(h.newest, old);
});

test('a feed goes stale when it stops moving, at 3x its own rhythm', async () => {
  const clock = fakeClock();
  const t = clock.now();
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(['g' + i, t - i * 3 * 3600000]); // one item every 3 h
  const { sched } = build({ clock, sources: [source()], fetchImpl: async () => respond(feedOf(rows)) });
  await sched._tick();
  assert.strictEqual(row(sched, 'a').ok, true);
  clock.advance(8 * 3600000);
  await sched._tick();
  assert.strictEqual(row(sched, 'a').ok, true, '8 h is under 3x a 3 h rhythm');
  clock.advance(2 * 3600000);
  await sched._tick();
  const h = row(sched, 'a');
  assert.strictEqual(h.ok, false);
  assert.strictEqual(h.stale, true);
});

test('a busy feed is not called stale during a quiet few hours overnight', async () => {
  const clock = fakeClock();
  const t = clock.now();
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(['g' + i, t - i * 300000]); // one item every 5 min
  const { sched } = build({ clock, sources: [source()], fetchImpl: async () => respond(feedOf(rows)) });
  await sched._tick();
  clock.advance(5 * 3600000);
  await sched._tick();
  assert.strictEqual(row(sched, 'a').ok, true);
  clock.advance(2 * 3600000);
  await sched._tick();
  assert.strictEqual(row(sched, 'a').ok, false, 'past the floor it is called');
});

test('stale clears as soon as a new item arrives', async () => {
  const clock = fakeClock();
  const t = clock.now();
  let body = feedOf([['a', t - 10 * 86400000], ['b', t - 10.5 * 86400000], ['c', t - 11 * 86400000]]);
  const { sched } = build({ clock, sources: [source()], fetchImpl: async () => respond(body) });
  await sched._tick();
  assert.strictEqual(row(sched, 'a').stale, true);
  body = feedOf([['new', clock.now()], ['a', t - 10 * 86400000], ['b', t - 10.5 * 86400000]]);
  clock.advance(60000);
  await sched._tick();
  assert.strictEqual(row(sched, 'a').ok, true);
  assert.strictEqual(row(sched, 'a').stale, false);
});

test('a quiet source (NTAS, status pages) is not stale for having nothing new', async () => {
  const clock = fakeClock();
  const t = clock.now();
  const body = feedOf([['a', t - 30 * 86400000], ['b', t - 31 * 86400000]]);
  const { sched } = build({ clock, sources: [source({ quiet: true })], fetchImpl: async () => respond(body) });
  await sched._tick();
  assert.strictEqual(row(sched, 'a').ok, true);
  assert.strictEqual(row(sched, 'a').stale, false);
});

test('a search that came back empty is not a stale feed', async () => {
  const clock = fakeClock();
  const t = clock.now();
  let body = feedOf([['a', t - 3600000], ['b', t - 7200000], ['c', t - 10800000]]);
  const { sched } = build({ clock, sources: [source()], fetchImpl: async () => respond(body) });
  await sched._tick();
  body = '<rss><channel></channel></rss>';
  clock.advance(24 * 3600000);
  await sched._tick();
  const h = row(sched, 'a');
  assert.strictEqual(h.ok, true, 'a when:1h query with no hits has found nothing, it has not died');
  assert.strictEqual(h.newest, t - 3600000, 'and the truth is still exposed');
});

test('newest is exposed even for a source that is failing', async () => {
  let fail = false;
  const { sched, clock } = build({ sources: [source()], fetchImpl: async () => (fail ? respond('x', { status: 500 }) : respond(FEED)) });
  await sched._tick();
  fail = true;
  clock.advance(60000);
  await sched._tick();
  const h = row(sched, 'a');
  assert.strictEqual(h.ok, false);
  assert.strictEqual(h.newest, Date.UTC(2026, 9, 30, 12, 0, 0));
  assert.ok(h.lastOk < h.lastErr);
});

// ── add / remove / start / stop ─────────────────────────────────────────────

test('add puts a new source on the schedule, a duplicate id is refused', async () => {
  const { sched, calls } = build({ sources: [source()] });
  assert.strictEqual(sched.add(source({ id: 'custom:x', url: 'https://other.example/f' })), true);
  assert.strictEqual(sched.add(source({ id: 'a' })), false);
  await sched._tick();
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(sched.health().length, 2);
});

test('remove takes a source off the schedule and out of health', async () => {
  const { sched, clock, calls } = build({ sources: [source()] });
  await sched._tick();
  assert.strictEqual(sched.remove('a'), true);
  assert.strictEqual(sched.remove('a'), false);
  clock.advance(600000);
  await sched._tick();
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(sched.health(), []);
});

test('a source removed mid-flight hands over nothing', async () => {
  let release;
  const got = [];
  const { sched } = build({
    sources: [source()],
    onItems: (items) => got.push(...items),
    fetchImpl: async () => {
      await new Promise((r) => { release = r; });
      return respond(FEED);
    }
  });
  sched._launch();
  await new Promise((r) => setImmediate(r));
  sched.remove('a');
  release();
  await Promise.allSettled([...sched.inflight]);
  assert.deepStrictEqual(got, []);
});

test('start polls for real and stop ends the loop and in-flight work', async () => {
  const hits = [];
  const sched = new Scheduler({
    sources: [source({ id: 'a' }), source({ id: 'hung', url: 'https://hung.example/f' })],
    onItems: () => {},
    fetchImpl: async (url, init) => {
      hits.push(url);
      if (url.includes('hung')) {
        return new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason));
        });
      }
      return respond(FEED);
    },
    random: () => 0,
    // Pinned to the fixture. On the real clock FEED goes stale 6 h after its own date, and
    // health() is right to say so, which failed this test from 18:00 UTC on 2026-10-30.
    now: () => Date.parse('Fri, 30 Oct 2026 12:30:00 GMT')
  });
  sched.start();
  sched.start(); // idempotent
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(hits.length, 2);
  await sched.stop();
  assert.strictEqual(sched.inflight.size, 0);
  assert.strictEqual(sched.health().find((h) => h.id === 'a').ok, true);
});

test('the loop survives a tick that throws', async () => {
  let ticks = 0;
  const sched = new Scheduler({
    sources: [],
    sleep: async () => { await new Promise((r) => setImmediate(r)); },
    fetchImpl: async () => respond(FEED)
  });
  const realLaunch = sched._launch.bind(sched);
  sched._launch = () => {
    ticks++;
    if (ticks === 1) throw new Error('tick exploded');
    realLaunch();
  };
  sched.start();
  await new Promise((r) => setTimeout(r, 30));
  await sched.stop();
  assert.ok(ticks > 1, 'ticks ' + ticks);
});

test('a start after real polls does not push established sources back', async () => {
  const { sched, clock } = build({ sources: [source()] });
  await sched._tick();
  const next = sched.states.get('a').nextAt;
  sched.sleep = async () => { await new Promise((r) => setImmediate(r)); };
  sched.start();
  assert.strictEqual(sched.states.get('a').nextAt, next);
  void clock;
  await sched.stop();
});

test('start spreads the first polls instead of firing everything at once', () => {
  const sources = [];
  for (let i = 0; i < 50; i++) sources.push(source({ id: 's' + i, url: `https://h${i}.example/f` }));
  const clock = fakeClock();
  let r = 0;
  const { sched } = build({ clock, sources, random: () => { r = (r + 0.13) % 1; return r; } });
  sched.sleep = () => new Promise(() => {});
  sched.running = false;
  sched.start();
  const offsets = [...sched.states.values()].map((s) => s.nextAt - clock.now());
  assert.ok(Math.max(...offsets) > 3000);
  assert.ok(Math.min(...offsets) >= 0);
  sched.running = false;
});
