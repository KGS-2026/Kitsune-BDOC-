// LIVE WIRE function + app integration tests. node --test tests/wire-function.test.js
//
// Three groups: handle() from _lib/wire-core.mjs against a fake Blobs store, the
// real service worker and top-bar boot script run in a fake browser, and the
// surgical edits to netlify.toml and index.html. CI has no node_modules, so
// @netlify/blobs is faked and global fetch stands in for Supabase.
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'netlify', 'functions');
const CORE = path.join(FN, '_lib', 'wire-core.mjs');
const load = () => import(pathToFileURL(CORE).href);

const SITE = 'https://kgsbdoc.netlify.app';
const URL_ = `${SITE}/.netlify/functions/wire`;
const OWNER = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const TOPIC = 'wire-secret-topic-name';
const DEFAULTS = ['No Kings', 'Local 26', 'grand jury subpoena', 'false flag', 'Insurrection Act', 'day after the election'];
const KEY = 'correct-ingest-key-for-tests';
const ENV = { BDOC_OWNER_IDS: OWNER, WIRE_INGEST_KEY: KEY, WIRE_TOPIC: TOPIC, supabase: 'anon-key' };

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

// Unique on every call: owner.mjs caches verdicts by token for 60 s.
let serial = 0;
const jwt = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'user', n: ++serial })}.c2lnbmF0dXJl`;

const snapshot = (over = {}) => ({
  v: 1, ts: 1_800_000_000_000, generated: '2027-01-15T08:00:00.000Z', items: [], health: {}, stats: {}, ...over
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// Supabase stand-in. tokens: { token: userId }. Anything else is refused.
function supabase(tokens = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    const id = tokens[String(init.headers.Authorization).replace('Bearer ', '')];
    return id
      ? new Response(JSON.stringify({ id }), { status: 200 })
      : new Response('{"msg":"invalid JWT"}', { status: 401 });
  };
  return calls;
}

function ownerToken() { const t = jwt(); return { token: t, tokens: { [t]: OWNER } }; }
function otherToken() { const t = jwt(); return { token: t, tokens: { [t]: OTHER } }; }

function fakeStore(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    reads: [],
    async get(key, opts) {
      this.reads.push({ key, opts });
      const v = data.get(key);
      if (v === undefined) return null;
      return opts && opts.type === 'json' ? JSON.parse(v) : v;
    },
    async set(key, value) { data.set(key, String(value)); },
    async setJSON(key, value) { data.set(key, JSON.stringify(value)); }
  };
}

// Runs one request. The store is always handed over as a factory, like wire.mjs does.
async function call({ method = 'GET', query = '', headers = {}, body, env = ENV, store, now } = {}) {
  const { handle } = await load();
  const st = store || fakeStore();
  const req = new Request(URL_ + query, { method, headers, body });
  const res = await handle(req, { store: typeof st === 'function' ? st : () => st, env, now });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, headers: res.headers, text, json, store: st };
}

const bearer = (token) => ({ authorization: `Bearer ${token}` });
const ingestKey = (key) => ({ 'x-wire-key': key });

// ── auth ────────────────────────────────────────────────────────────────────

test('no env at all fails closed on every path', async () => {
  const { token, tokens } = ownerToken();
  supabase(tokens);
  const seeded = () => fakeStore({ snapshot: JSON.stringify(snapshot()) });

  const read = await call({ env: {}, headers: bearer(token), store: seeded() });
  assert.notEqual(read.status, 200);
  assert.ok(!read.text.includes('items'), 'no snapshot may leave');

  const probe = await call({ env: {}, query: '?probe=1', headers: bearer(token) });
  assert.notEqual(probe.status, 200);

  const st = fakeStore();
  const ingest = await call({ env: {}, method: 'POST', headers: ingestKey('anything'), body: JSON.stringify(snapshot()), store: st });
  assert.equal(ingest.status, 401);
  assert.equal(st.data.size, 0);

  const blankKey = await call({ env: {}, method: 'POST', headers: ingestKey(''), body: JSON.stringify(snapshot()) });
  assert.equal(blankKey.status, 401);
});

test('unset BDOC_OWNER_IDS: a real Supabase user is still refused', async () => {
  const { token, tokens } = ownerToken();
  supabase(tokens);
  const { BDOC_OWNER_IDS, ...env } = ENV;
  const r = await call({ env, headers: bearer(token), store: fakeStore({ snapshot: JSON.stringify(snapshot()) }) });
  assert.equal(r.status, 403);
  assert.ok(!r.text.includes(TOPIC));
});

test('unset WIRE_INGEST_KEY: ingest is refused but the owner can still read', async () => {
  const { WIRE_INGEST_KEY, ...env } = ENV;
  const st = fakeStore({ snapshot: JSON.stringify(snapshot()) });

  const ingest = await call({ env, method: 'POST', headers: ingestKey('undefined'), body: JSON.stringify(snapshot({ ts: 1 })), store: st });
  assert.equal(ingest.status, 401);
  assert.equal(JSON.parse(st.data.get('snapshot')).ts, snapshot().ts, 'snapshot was overwritten');

  const { token, tokens } = ownerToken();
  supabase(tokens);
  assert.equal((await call({ env, headers: bearer(token), store: st })).status, 200);
});

test('no token -> 401', async () => {
  const calls = supabase();
  const r = await call();
  assert.equal(r.status, 401);
  assert.deepEqual(r.json, { error: 'unauthorized' });
  assert.equal(calls.length, 0);
});

test('garbage token -> 401 with no network call', async () => {
  const calls = supabase();
  for (const value of ['Bearer not-a-real-jwt', 'Bearer a.b.c', 'Bearer ', 'Basic abc', 'garbage']) {
    const r = await call({ headers: { authorization: value } });
    assert.equal(r.status, 401, value);
  }
  assert.equal(calls.length, 0, 'garbage reached Supabase');
});

test('well-formed token that Supabase refuses -> 401', async () => {
  const calls = supabase();
  const r = await call({ headers: bearer(jwt()) });
  assert.equal(r.status, 401);
  assert.equal(calls.length, 1);
});

test('valid non-owner -> 403, and the response contains no topic and no data', async () => {
  const st = fakeStore({
    snapshot: JSON.stringify(snapshot({ items: [{ id: 'abc', h: 'SECRET HEADLINE' }] })),
    watch: JSON.stringify({ terms: ['secret term'] })
  });
  const { token, tokens } = otherToken();
  supabase(tokens);
  const r = await call({ query: '', headers: bearer(token), store: st });
  assert.equal(r.status, 403);
  assert.deepEqual(r.json, { error: 'forbidden' });
  for (const secret of [TOPIC, 'SECRET HEADLINE', 'secret term', 'topic', 'snapshot', 'owner']) {
    assert.ok(!r.text.includes(secret), `leaked: ${secret}`);
  }

  // The probe says no with a 200, so a customer's console stays clean, and says only no.
  const p = await call({ query: '?probe=1', headers: bearer(token), store: st });
  assert.equal(p.status, 200);
  assert.deepEqual(p.json, { owner: false });
  assert.equal(st.reads.length, 0, 'Blobs must not be read for a non-owner');
});

test('a probe with no token or a bad token is still a 401, never {owner:false}', async () => {
  assert.equal((await call({ query: '?probe=1' })).status, 401);
  assert.equal((await call({ query: '?probe=1', headers: bearer('garbage') })).status, 401);
});

test('every denial has the same shape', async () => {
  const { token, tokens } = otherToken();
  supabase(tokens);
  const denials = [
    await call(),
    await call({ headers: bearer(token) }),
    await call({ method: 'POST', headers: ingestKey('wrong'), body: '{}' }),
    await call({ method: 'POST', query: '?action=watch', body: '{}' })
  ];
  for (const r of denials) assert.deepEqual(Object.keys(r.json), ['error']);
});

test('Supabase outage -> 503, closed, and not reported as signed out', async () => {
  globalThis.fetch = async () => { throw new Error('connect ETIMEDOUT'); };
  const st = fakeStore({ snapshot: JSON.stringify(snapshot()) });
  const r = await call({ headers: bearer(jwt()), store: st });
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { error: 'unavailable' });
  assert.equal(st.reads.length, 0);
});

// ── owner read ──────────────────────────────────────────────────────────────

test('owner probe -> {owner:true} with no Blobs read', async () => {
  const { token, tokens } = ownerToken();
  supabase(tokens);
  const st = fakeStore({ snapshot: JSON.stringify(snapshot()) });
  const r = await call({ query: '?probe=1', headers: bearer(token), store: st });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { owner: true });
  assert.equal(st.reads.length, 0);
});

test('a probe survives Blobs being completely broken', async () => {
  const { token, tokens } = ownerToken();
  supabase(tokens);
  const r = await call({
    query: '?probe=1',
    headers: bearer(token),
    store: () => { throw new Error('The environment has not been configured to use Netlify Blobs'); }
  });
  assert.equal(r.status, 200);
});

test('owner gets topic + snapshot + watch + ageSec, read with strong consistency', async () => {
  const { token, tokens } = ownerToken();
  supabase(tokens);
  const snap = snapshot({ items: [{ id: 'abc', h: 'Headline' }] });
  const st = fakeStore({ snapshot: JSON.stringify(snap), watch: JSON.stringify({ terms: ['long beach'] }) });
  const r = await call({ headers: bearer(token), store: st, now: () => snap.ts + 42_000 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { owner: true, topic: TOPIC, snapshot: snap, watch: ['long beach'], ageSec: 42 });
  assert.deepEqual(st.reads.map(x => x.key).sort(), ['snapshot', 'watch']);
  for (const read of st.reads) assert.equal(read.opts.consistency, 'strong');
});

test('owner read before the first snapshot is an honest empty, not an error', async () => {
  const { token, tokens } = ownerToken();
  supabase(tokens);
  const r = await call({ headers: bearer(token) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { owner: true, topic: TOPIC, snapshot: null, watch: DEFAULTS, ageSec: null });
});

test('ageSec never goes negative when the droplet clock runs ahead', async () => {
  const { token, tokens } = ownerToken();
  supabase(tokens);
  const snap = snapshot();
  const r = await call({
    headers: bearer(token),
    store: fakeStore({ snapshot: JSON.stringify(snap) }),
    now: () => snap.ts - 5000
  });
  assert.equal(r.json.ageSec, 0);
});

test('unset WIRE_TOPIC -> null topic, so the client polls instead of joining a bad channel', async () => {
  const { token, tokens } = ownerToken();
  supabase(tokens);
  const { WIRE_TOPIC, ...env } = ENV;
  const r = await call({ env, headers: bearer(token) });
  assert.equal(r.status, 200);
  assert.equal(r.json.topic, null);
});

// ── ingest ──────────────────────────────────────────────────────────────────

test('wrong ingest key -> 401 and nothing stored, right key stores', async () => {
  const st = fakeStore();
  const body = JSON.stringify(snapshot({ items: [{ id: 'abc' }] }));

  for (const headers of [{}, ingestKey('wrong'), ingestKey('')]) {
    const bad = await call({ method: 'POST', headers, body, store: st });
    assert.equal(bad.status, 401);
    assert.deepEqual(bad.json, { error: 'unauthorized' });
    assert.equal(st.data.size, 0);
  }

  const good = await call({ method: 'POST', headers: ingestKey(KEY), body, store: st });
  assert.equal(good.status, 200);
  assert.deepEqual(good.json, { ok: true, watch: DEFAULTS });
  assert.equal(st.data.get('snapshot'), body);
});

test('the owner emptying the list is respected, not refilled with defaults', async () => {
  const st = fakeStore({ watch: JSON.stringify({ terms: [] }) });
  const r = await call({ method: 'POST', headers: ingestKey(KEY), body: JSON.stringify(snapshot()), store: st });
  assert.deepEqual(r.json, { ok: true, watch: [] });
});

test('a bearer token never substitutes for the ingest key', async () => {
  const { token, tokens } = ownerToken();
  supabase(tokens);
  const r = await call({ method: 'POST', headers: bearer(token), body: JSON.stringify(snapshot()) });
  assert.equal(r.status, 401);
});

test('ingest key compare handles different lengths without throwing', async () => {
  const { keyMatches } = await load();
  assert.equal(keyMatches(KEY, KEY), true);
  for (const wrong of ['x', KEY.slice(0, -1), KEY + 'x', KEY + KEY, 'x'.repeat(10_000)]) {
    assert.equal(keyMatches(wrong, KEY), false);
    const r = await call({ method: 'POST', headers: ingestKey(wrong), body: '{}' });
    assert.equal(r.status, 401);
  }
  assert.equal(keyMatches('', ''), false);
  assert.equal(keyMatches('anything', undefined), false);
  assert.equal(keyMatches(null, KEY), false);
});

test('ingest compares in constant time, and checks the key before the body', async () => {
  const src = fs.readFileSync(CORE, 'utf8');
  assert.match(src, /timingSafeEqual\(/);
  assert.ok(!/x-wire-key'\)\s*(!==|===)/.test(src), 'plain string compare on the ingest key');

  // A wrong key with an unreadable body must still be a clean 401.
  const r = await call({ method: 'POST', headers: ingestKey('wrong'), body: 'not json at all' });
  assert.equal(r.status, 401);
});

test('oversize snapshot is rejected and the last good one survives', async () => {
  const { MAX_SNAPSHOT_BYTES } = await load();
  assert.equal(MAX_SNAPSHOT_BYTES, 2 * 1024 * 1024);

  const before = JSON.stringify(snapshot());
  const st = fakeStore({ snapshot: before });

  const big = JSON.stringify(snapshot({ pad: 'x'.repeat(MAX_SNAPSHOT_BYTES) }));
  const r = await call({ method: 'POST', headers: ingestKey(KEY), body: big, store: st });
  assert.equal(r.status, 413);

  // Trusting Content-Length alone would let a liar through.
  const lied = await call({ method: 'POST', headers: { ...ingestKey(KEY), 'content-length': '10' }, body: big, store: st });
  assert.equal(lied.status, 413);

  // The limit is bytes, not characters: 1.5 M characters here is 3 MB on the wire.
  const wide = JSON.stringify(snapshot({ pad: String.fromCharCode(0x20ac).repeat(1_500_000) }));
  assert.ok(wide.length < MAX_SNAPSHOT_BYTES);
  const multibyte = await call({ method: 'POST', headers: ingestKey(KEY), body: wide, store: st });
  assert.equal(multibyte.status, 413);

  assert.equal(st.data.get('snapshot'), before);
});

test('a snapshot right at the limit is accepted', async () => {
  const { MAX_SNAPSHOT_BYTES } = await load();
  const shell = JSON.stringify(snapshot({ pad: '' }));
  const body = JSON.stringify(snapshot({ pad: 'x'.repeat(MAX_SNAPSHOT_BYTES - shell.length) }));
  assert.equal(Buffer.byteLength(body), MAX_SNAPSHOT_BYTES);
  const r = await call({ method: 'POST', headers: ingestKey(KEY), body });
  assert.equal(r.status, 200);
});

test('a declared Content-Length over the limit is refused without reading the body', async () => {
  const { handle, MAX_SNAPSHOT_BYTES } = await load();
  const req = {
    method: 'POST',
    url: URL_,
    headers: new Headers({ ...ingestKey(KEY), 'content-length': String(MAX_SNAPSHOT_BYTES + 1) }),
    text() { throw new Error('body was read'); }
  };
  const res = await handle(req, { store: () => fakeStore(), env: ENV });
  assert.equal(res.status, 413);
});

test('malformed snapshots are rejected and never overwrite the last good one', async () => {
  const before = JSON.stringify(snapshot());
  const st = fakeStore({ snapshot: before });
  const bad = [
    'not json', '', 'null', '[]', '"text"', '42', '{}',
    JSON.stringify(snapshot({ v: 2 })),
    JSON.stringify(snapshot({ ts: 'yesterday' })),
    JSON.stringify(snapshot({ ts: null })),
    JSON.stringify(snapshot({ items: 'none' })),
    JSON.stringify({ v: 1, ts: 1 })
  ];
  for (const body of bad) {
    const r = await call({ method: 'POST', headers: ingestKey(KEY), body, store: st });
    assert.equal(r.status, 400, `body: ${body.slice(0, 40)}`);
  }
  assert.equal(st.data.get('snapshot'), before);
});

test('the ingest response carries the watch list, which is how the daemon learns it', async () => {
  const st = fakeStore({ watch: JSON.stringify({ terms: ['one term', 'two terms'] }) });
  const r = await call({ method: 'POST', headers: ingestKey(KEY), body: JSON.stringify(snapshot()), store: st });
  assert.deepEqual(r.json, { ok: true, watch: ['one term', 'two terms'] });
});

// ── watch ───────────────────────────────────────────────────────────────────

function ownerPost(body, store) {
  const { token, tokens } = ownerToken();
  supabase(tokens);
  return call({
    method: 'POST', query: '?action=watch', headers: bearer(token),
    body: typeof body === 'string' ? body : JSON.stringify(body), store
  });
}

test('owner replaces the terms, and they reach both the reader and the daemon', async () => {
  const st = fakeStore({ watch: JSON.stringify({ terms: ['old term'] }) });
  const r = await ownerPost({ terms: ['Long Beach', 'ILWU Local 13'] }, st);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, watch: ['Long Beach', 'ILWU Local 13'] });

  const { token, tokens } = ownerToken();
  supabase(tokens);
  assert.deepEqual((await call({ headers: bearer(token), store: st })).json.watch, ['Long Beach', 'ILWU Local 13']);

  const ingest = await call({ method: 'POST', headers: ingestKey(KEY), body: JSON.stringify(snapshot()), store: st });
  assert.deepEqual(ingest.json.watch, ['Long Beach', 'ILWU Local 13']);
});

test('an empty list clears every custom term', async () => {
  const st = fakeStore({ watch: JSON.stringify({ terms: ['old term'] }) });
  const r = await ownerPost({ terms: [] }, st);
  assert.deepEqual(r.json, { ok: true, watch: [] });
});

test('POST watch by a non-owner -> 403 whatever the body, and nothing changes', async () => {
  const st = fakeStore({ watch: JSON.stringify({ terms: ['keep me'] }) });
  for (const body of [JSON.stringify({ terms: ['hijack'] }), JSON.stringify({ terms: 'nope' }), 'not json']) {
    const { token, tokens } = otherToken();
    supabase(tokens);
    const r = await call({ method: 'POST', query: '?action=watch', headers: bearer(token), body, store: st });
    assert.equal(r.status, 403);
    assert.deepEqual(r.json, { error: 'forbidden' });
  }
  assert.deepEqual(JSON.parse(st.data.get('watch')).terms, ['keep me']);
});

test('POST watch with no token -> 401, and the ingest key does not unlock it', async () => {
  const st = fakeStore();
  const body = JSON.stringify({ terms: ['hijack'] });
  assert.equal((await call({ method: 'POST', query: '?action=watch', body, store: st })).status, 401);
  assert.equal((await call({ method: 'POST', query: '?action=watch', headers: ingestKey(KEY), body, store: st })).status, 401);
  assert.equal(st.data.size, 0);
});

test('watch validation: too many terms', async () => {
  const st = fakeStore();
  const r = await ownerPost({ terms: Array.from({ length: 41 }, (_, i) => `term ${i}`) }, st);
  assert.equal(r.status, 400);
  assert.equal(st.data.size, 0);

  const atLimit = await ownerPost({ terms: Array.from({ length: 40 }, (_, i) => `term ${i}`) }, st);
  assert.equal(atLimit.status, 200);
  assert.equal(atLimit.json.watch.length, 40);
});

test('watch validation: too long and too short', async () => {
  const st = fakeStore();
  for (const term of ['x'.repeat(65), 'x', '', '   ']) {
    const r = await ownerPost({ terms: [term] }, st);
    assert.equal(r.status, 400, JSON.stringify(term));
  }
  assert.equal(st.data.size, 0);
  assert.equal((await ownerPost({ terms: ['x'.repeat(64)] }, st)).status, 200);
  assert.equal((await ownerPost({ terms: ['xx'] }, st)).status, 200);
});

test('watch validation: control characters are stripped before the length check', async () => {
  const st = fakeStore();
  const c = String.fromCharCode;
  const sneaky = [
    `bomb${c(0)} threat`,
    `port${c(0x7f)} strike`,
    `grid${c(0x85)} down`,
    `black${c(0x200b)}out`,                // zero-width space
    `${c(0x202e)}riot`,                    // right-to-left override
    `line${c(0x2028)}break`,
    `${c(0xfeff)}curfew\r\n`
  ];
  const r = await ownerPost({ terms: sneaky }, st);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.watch, ['bomb threat', 'port strike', 'grid down', 'blackout', 'riot', 'linebreak', 'curfew']);
  assert.deepEqual(JSON.parse(st.data.get('watch')).terms, r.json.watch);

  // Over the limit raw, inside it once cleaned.
  const padded = await ownerPost({ terms: ['x'.repeat(64) + c(1).repeat(10)] }, st);
  assert.equal(padded.status, 200);

  // Nothing but control characters is not a term.
  const empty = await ownerPost({ terms: [c(1) + c(2) + c(3)] }, st);
  assert.equal(empty.status, 400);
});

test('watch validation: non-array, non-string and bad json', async () => {
  const st = fakeStore();
  const bodies = [
    {}, { terms: 'long beach' }, { terms: null }, { terms: { a: 1 } }, { terms: 7 },
    { terms: ['ok term', 7] }, { terms: [null] }, { terms: [['nested']] },
    [], 'null', 'not json'
  ];
  for (const body of bodies) {
    const r = await ownerPost(body, st);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(Object.keys(r.json), ['error']);
  }
  assert.equal(st.data.size, 0);
});

test('terms stay literal, and duplicates collapse', async () => {
  const st = fakeStore();
  const r = await ownerPost({ terms: ['.*', '(a|b)+', '<img src=x>', 'Riot', 'riot', '  RIOT '] }, st);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.watch, ['.*', '(a|b)+', '<img src=x>', 'Riot']);
});

// ── Blobs unavailable ───────────────────────────────────────────────────────

const noBlobs = () => { throw new Error('The environment has not been configured to use Netlify Blobs'); };
const failingStore = () => ({
  async get() { throw new Error('blobs read failed'); },
  async set() { throw new Error('blobs write failed'); },
  async setJSON() { throw new Error('blobs write failed'); }
});

test('Blobs unavailable -> honest 503 on read, ingest and watch', async () => {
  for (const store of [noBlobs, failingStore]) {
    const { token, tokens } = ownerToken();
    supabase(tokens);
    const read = await call({ headers: bearer(token), store });
    assert.equal(read.status, 503);
    assert.deepEqual(read.json, { error: 'storage unavailable' });

    const ingest = await call({ method: 'POST', headers: ingestKey(KEY), body: JSON.stringify(snapshot()), store });
    assert.equal(ingest.status, 503);

    const watch = await ownerPost({ terms: ['term'] }, store);
    assert.equal(watch.status, 503);
  }
});

test('a Blobs failure is never answered as an empty watch list', async () => {
  // The daemon drops every custom source if it reads [] here.
  const st = fakeStore();
  st.get = async () => { throw new Error('blobs read failed'); };
  const r = await call({ method: 'POST', headers: ingestKey(KEY), body: JSON.stringify(snapshot()), store: st });
  assert.equal(r.status, 503);
  assert.equal(r.json.watch, undefined);
});

test('a Blobs error message never reaches the client', async () => {
  const { token, tokens } = ownerToken();
  supabase(tokens);
  const store = () => { throw new Error('token=SECRET siteID=abc'); };
  const errors = [];
  const real = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const r = await call({ headers: bearer(token), store });
    assert.ok(!r.text.includes('SECRET'));
  } finally { console.error = real; }
});

// ── transport ───────────────────────────────────────────────────────────────

test('every response is no-store, and JSON unless it has no body', async () => {
  const { token, tokens } = ownerToken();
  const other = otherToken();
  supabase({ ...tokens, ...other.tokens });
  const hugeBody = JSON.stringify(snapshot({ pad: 'x'.repeat(2 * 1024 * 1024) }));
  const seeded = fakeStore({ snapshot: JSON.stringify(snapshot()) });
  const responses = {
    '200 owner read': await call({ headers: bearer(token), store: seeded }),
    '200 probe': await call({ query: '?probe=1', headers: bearer(token) }),
    '200 ingest': await call({ method: 'POST', headers: ingestKey(KEY), body: JSON.stringify(snapshot()) }),
    '200 watch': await call({ method: 'POST', query: '?action=watch', headers: bearer(token), body: '{"terms":[]}' }),
    '204 preflight': await call({ method: 'OPTIONS', headers: { origin: SITE } }),
    '400 bad snapshot': await call({ method: 'POST', headers: ingestKey(KEY), body: 'x' }),
    '400 bad watch': await call({ method: 'POST', query: '?action=watch', headers: bearer(token), body: '{}' }),
    '401 no token': await call(),
    '401 bad key': await call({ method: 'POST', headers: ingestKey('x'), body: '{}' }),
    '403 non-owner': await call({ headers: bearer(other.token) }),
    '405 method': await call({ method: 'PUT', body: '{}' }),
    '413 oversize': await call({ method: 'POST', headers: ingestKey(KEY), body: hugeBody }),
    '503 storage': await call({ headers: bearer(token), store: noBlobs })
  };
  for (const [name, r] of Object.entries(responses)) {
    const expected = Number(name.slice(0, 3));
    assert.equal(r.status, expected, name);
    assert.equal(r.headers.get('cache-control'), 'no-store', name);
    if (expected !== 204) assert.match(r.headers.get('content-type'), /^application\/json/, name);
  }
});

test('an unexpected crash still answers no-store and reveals nothing', async () => {
  const { handle } = await load();
  const req = {
    method: 'GET',
    url: 'not a url',
    headers: new Headers({ authorization: 'Bearer x' })
  };
  const real = console.error;
  console.error = () => {};
  try {
    const res = await handle(req, { store: () => fakeStore(), env: ENV });
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { error: 'server error' });
  } finally { console.error = real; }
});

test('CORS is restricted to the site origin', async () => {
  const site = await call({ headers: { origin: SITE } });
  assert.equal(site.headers.get('access-control-allow-origin'), SITE);

  for (const origin of ['https://evil.example', `${SITE}.evil.example`, 'null', 'http://kgsbdoc.netlify.app']) {
    const r = await call({ headers: { origin } });
    assert.equal(r.headers.get('access-control-allow-origin'), null, origin);
    const pre = await call({ method: 'OPTIONS', headers: { origin } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), null, origin);
    assert.equal(pre.headers.get('access-control-allow-headers'), null, origin);
  }

  const none = await call();
  assert.equal(none.headers.get('access-control-allow-origin'), null);
});

test('a browser is never invited to send the ingest key', async () => {
  const pre = await call({ method: 'OPTIONS', headers: { origin: SITE } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/i);
  assert.ok(!/x-wire-key/i.test(pre.headers.get('access-control-allow-headers')));
});

test('methods outside the contract -> 405', async () => {
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const r = await call({ method, body: method === 'DELETE' ? undefined : '{}' });
    assert.equal(r.status, 405, method);
  }
});

test('wire.mjs really wires handle() to the wire Blobs store', async () => {
  // It cannot be imported as it stands, because @netlify/blobs is not installed in
  // CI. Swapping the two import lines runs the real shell against a stub.
  const stub = 'export function getStore(name) { globalThis.__wireStoreName = name; return globalThis.__wireStore; }';
  const src = fs.readFileSync(path.join(FN, 'wire.mjs'), 'utf8');
  const patched = src
    .replace("from '@netlify/blobs'", `from ${JSON.stringify('data:text/javascript,' + encodeURIComponent(stub))}`)
    .replace("from './_lib/wire-core.mjs'", `from ${JSON.stringify(pathToFileURL(CORE).href)}`);
  assert.ok(!/from '/.test(patched), 'wire.mjs imports changed, update this test');

  const mod = await import('data:text/javascript;base64,' + Buffer.from(patched).toString('base64'));
  assert.equal(mod.config.path, '/.netlify/functions/wire');

  const saved = { ...process.env };
  Object.assign(process.env, ENV);
  globalThis.__wireStore = fakeStore({ snapshot: JSON.stringify(snapshot()) });
  try {
    const { token, tokens } = ownerToken();
    supabase(tokens);
    const res = await mod.default(new Request(URL_, { headers: bearer(token) }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).topic, TOPIC);
    assert.equal(globalThis.__wireStoreName, 'wire');
  } finally {
    for (const k of Object.keys(ENV)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    delete globalThis.__wireStore;
    delete globalThis.__wireStoreName;
  }
});

test('the function imports nothing CommonJS (spec section 3)', () => {
  for (const f of ['wire.mjs', path.join('_lib', 'wire-core.mjs')]) {
    const src = fs.readFileSync(path.join(FN, f), 'utf8');
    assert.ok(!/\brequire\(/.test(src), `${f}: esbuild shims require in ESM and it throws at call time`);
    assert.ok(!/from ['"][^'"]*(guard|_supabase)/.test(src), f);
  }
});

// ── service worker ──────────────────────────────────────────────────────────

// Runs the real file, so this breaks if the exception moves below a route that
// would catch the request first. A grep would not notice that.
function serviceWorker() {
  const handlers = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8'), {
    self: { addEventListener(type, fn) { handlers[type] = fn; }, location: { origin: SITE } },
    URL, console
  });
  return (url, init = {}) => {
    let handled = false;
    handlers.fetch({
      request: { url, method: init.method || 'GET', mode: init.mode || 'cors' },
      respondWith(p) { handled = true; if (p && p.catch) p.catch(() => {}); }
    });
    return handled;
  };
}

test('service worker never touches the wire endpoint', () => {
  const sw = serviceWorker();
  assert.equal(sw(URL_), false, 'wire went through the service worker, so it can land in Cache Storage');
  assert.equal(sw(`${URL_}?probe=1`), false);
  assert.equal(sw(`${SITE}/api/wire`), false, 'same function through the /api/* rewrite');
  assert.equal(sw(`${SITE}/.netlify/functions/ping`), false);
});

test('the bypass is exact: other functions still go through the service worker', () => {
  const sw = serviceWorker();
  assert.equal(sw(`${SITE}/.netlify/functions/proxy-news`), true);
  assert.equal(sw(`${SITE}/.netlify/functions/wired`), true);
  assert.equal(sw(`${SITE}/api/proxy-news`), true);
  assert.equal(sw('https://elsewhere.example/.netlify/functions/wire'), true);
});

test('SW_VERSION is bumped with the previous line kept', () => {
  const src = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  assert.match(src, /^const SW_VERSION = 'bdoc-v162';/m);
  assert.match(src, /^\/\/ \(prev\) const SW_VERSION = 'bdoc-v160';/m);
});

// ── netlify.toml ────────────────────────────────────────────────────────────

const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8').replace(/\r\n/g, '\n');

test('netlify.toml has the /wire rewrite, above the /*.md rule', () => {
  const m = /\[\[redirects\]\]\n\s*from = "\/wire"\n\s*to = "\/wire\.html"\n\s*status = 200\n/.exec(toml);
  assert.ok(m, '/wire rewrite missing');
  assert.ok(m.index < toml.indexOf('from = "/*.md"'), 'must come before the /*.md rule');
});

test('/wire is not swallowed by a 404 block', () => {
  const blocked = [...toml.matchAll(/from\s*=\s*"([^"]+)"[^[]*?status\s*=\s*404/g)].map(m => m[1]);
  assert.ok(!blocked.includes('/wire') && !blocked.includes('/wire.html'));
});

test('the /wire page is noindex with a short cache', () => {
  for (const route of ['/wire.html', '/wire']) {
    const m = new RegExp(`for = "${route.replace('.', '\\.')}"\\n\\s*\\[headers\\.values\\]\\n([^[]*)`).exec(toml);
    assert.ok(m, `no headers block for ${route}`);
    assert.match(m[1], /X-Robots-Tag = "noindex, ?nofollow"/, route);
    assert.match(m[1], /Cache-Control = "public, ?max-age=60, ?must-revalidate"/, route);
  }
});

// ── index.html ──────────────────────────────────────────────────────────────

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

test('index.html loads the boot script right after bdoc-auth-fetch', () => {
  assert.match(html, /<script src="js\/bdoc-auth-fetch\.js\?v=[^"]+"><\/script>\n<script src="js\/bdoc-wire-boot\.js\?v=p160" defer><\/script>\n/);
  assert.equal(html.match(/bdoc-wire-boot\.js/g).length, 1, 'loaded twice');
});

test('the visible build pill says p160', () => {
  assert.match(html, /id="bdocBuildPill"[^>]*>BUILD p160<\/span>/);
});

test('the top bar still has the anchor the boot script inserts before', () => {
  assert.match(html, /<div class="tb-r">\n(?:<div class="st">.*\n)*<div class="st" id="clk">/);
});

// ── boot script, run in a fake browser ──────────────────────────────────────

const BOOT = fs.readFileSync(path.join(ROOT, 'js', 'bdoc-wire-boot.js'), 'utf8');
const SESSION = { access_token: 'the-access-token', user: { id: OWNER } };

function element(tag) {
  return {
    tagName: tag.toUpperCase(), children: [], parentNode: null, style: {}, attrs: {}, listeners: {},
    textContent: '', className: '', id: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.parentNode = this;
      this.children.splice(this.children.indexOf(ref), 0, c);
      return c;
    },
    remove() {
      if (!this.parentNode) return;
      const sibs = this.parentNode.children;
      sibs.splice(sibs.indexOf(this), 1);
      this.parentNode = null;
    },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    fire(type, ev = {}) { (this.listeners[type] || []).forEach(fn => fn(ev)); }
  };
}

function browser({ session = null, initialized = true, hasClient = true, respond } = {}) {
  const bar = element('div');
  const live = bar.appendChild(element('div'));
  const clk = bar.appendChild(element('div'));
  clk.id = 'clk';
  const head = element('head');

  const b = {
    session, bar, live, clk, head, timers: [], fetches: [], sessionCalls: 0, logged: [],
    authCallback: null,
    respond: respond || (() => ({ status: 200, json: async () => ({ owner: true }) }))
  };

  const client = {
    auth: {
      async getSession() { b.sessionCalls++; return { data: { session: b.session } }; },
      onAuthStateChange(cb) { b.authCallback = cb; return { data: { subscription: {} } }; }
    }
  };
  b.client = client;
  b.window = { BDOC_Auth: { _initialized: initialized, client: hasClient ? client : null } };

  const log = (...a) => b.logged.push(a);
  vm.runInNewContext(BOOT, {
    window: b.window,
    document: {
      head,
      createElement: element,
      createTextNode: (text) => ({ nodeType: 3, textContent: text }),
      querySelector: (sel) => (sel === '.tb-r #clk' ? clk : null)
    },
    fetch: async (url, init) => { b.fetches.push({ url, init }); return b.respond(); },
    setTimeout: (fn, ms) => { b.timers.push({ fn, ms }); },
    console: { log, info: log, warn: log, error: log, debug: log }
  });

  b.item = () => bar.children.find(c => c.id === 'bdocWireItem');

  // Lets pending promises finish, then runs timers due within `upTo`, repeatedly.
  b.settle = async (upTo = 0) => {
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setImmediate(r));
      const due = b.timers.filter(t => t.ms <= upTo);
      b.timers = b.timers.filter(t => !due.includes(t));
      due.forEach(t => t.fn());
    }
    await new Promise(r => setImmediate(r));
  };
  return b;
}

const denied = (status) => () => ({ status, json: async () => ({ error: 'no' }) });

test('guest: no probe, no item, no console output', async () => {
  const b = browser();
  await b.settle();
  assert.equal(b.fetches.length, 0);
  assert.equal(b.item(), undefined);
  assert.deepEqual(b.logged, []);
});

test('owner: one probe with an explicit token, and the item lands just before #clk', async () => {
  const b = browser({ session: SESSION });
  await b.settle();

  assert.equal(b.fetches.length, 1, 'load plus INITIAL_SESSION must still be one probe');
  assert.equal(b.fetches[0].url, '/.netlify/functions/wire?probe=1');
  assert.equal(b.fetches[0].init.headers.Authorization, 'Bearer the-access-token');

  const item = b.item();
  assert.ok(item, 'owner item missing');
  assert.equal(item.className, 'st');
  assert.equal(b.bar.children.indexOf(item), b.bar.children.indexOf(b.clk) - 1);
  assert.equal(item.children.filter(c => c.className === 'dt').length, 1, 'needs a status dot');
  assert.deepEqual(b.logged, []);
});

test('the dot makes no health claim: a green dot here would read as "live"', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  const dot = b.item().children.find(c => (c.className || '').startsWith('dt'));
  assert.ok(!/dt-g/.test(dot.className));
});

test('non-owner: 403 is final, silent and never retried', async () => {
  const b = browser({ session: SESSION, respond: denied(403) });
  await b.settle(120_000);
  assert.equal(b.fetches.length, 1);
  assert.equal(b.item(), undefined);
  assert.deepEqual(b.logged, []);
});

test('401 and 404 are also final (the desktop app has no wire function)', async () => {
  for (const status of [401, 404]) {
    const b = browser({ session: SESSION, respond: denied(status) });
    await b.settle(120_000);
    assert.equal(b.fetches.length, 1, String(status));
    assert.equal(b.item(), undefined);
  }
});

test('a 200 that does not say owner:true draws nothing', async () => {
  const bodies = [
    async () => ({ owner: false }),
    async () => ({}),
    async () => null,
    async () => { throw new SyntaxError('html, not json'); }
  ];
  for (const json of bodies) {
    const b = browser({ session: SESSION, respond: () => ({ status: 200, json }) });
    await b.settle();
    assert.equal(b.item(), undefined);
    assert.deepEqual(b.logged, []);
  }
});

test('a transient failure is retried, so an outage at load does not lose the owner his button', async () => {
  let n = 0;
  const b = browser({
    session: SESSION,
    respond: () => {
      n++;
      if (n === 1) return { status: 503, json: async () => ({}) };
      if (n === 2) throw new TypeError('Failed to fetch');
      return { status: 200, json: async () => ({ owner: true }) };
    }
  });
  await b.settle();
  assert.equal(b.fetches.length, 1, 'retries must wait for their backoff');
  await b.settle(120_000);
  assert.equal(b.fetches.length, 3);
  assert.ok(b.item());
});

test('retries are bounded', async () => {
  const b = browser({ session: SESSION, respond: denied(500) });
  await b.settle(120_000);
  assert.equal(b.fetches.length, 4);
  assert.equal(b.timers.length, 0);
  assert.equal(b.item(), undefined);
});

test('after the retries run out, the next auth event asks again', async () => {
  const b = browser({ session: SESSION, respond: denied(500) });
  await b.settle(120_000);
  assert.equal(b.fetches.length, 4);

  // An outage longer than the retry window must not cost the owner his button until
  // he reloads. Tab refocus fires SIGNED_IN, so it comes back on its own.
  b.respond = () => ({ status: 200, json: async () => ({ owner: true }) });
  b.authCallback('SIGNED_IN', SESSION);
  await b.settle();
  assert.equal(b.fetches.length, 5);
  assert.ok(b.item());
});

test('a late failure for the previous user cannot wipe the new user\'s verdict', async () => {
  let release, n = 0;
  const held = new Promise(r => { release = r; });
  const b = browser({
    session: { access_token: 'first', user: { id: OTHER } },
    respond: () => (++n < 4 ? { status: 500, json: async () => ({}) } : held)
  });
  await b.settle(120_000);
  assert.equal(b.fetches.length, 4);

  b.respond = () => ({ status: 200, json: async () => ({ owner: true }) });
  b.session = SESSION;
  b.authCallback('SIGNED_IN', SESSION);
  await b.settle();
  assert.equal(b.fetches.length, 5);
  assert.ok(b.item());

  release({ status: 500, json: async () => ({}) });
  await b.settle();
  b.authCallback('SIGNED_IN', SESSION);
  await b.settle();
  assert.equal(b.fetches.length, 5, 'a stale failure cleared the current verdict');
  assert.ok(b.item());
});

test('waits for BDOC_Auth to finish initializing', async () => {
  const b = browser({ session: SESSION, initialized: false });
  await b.settle(1000);
  await b.settle(1000);
  assert.equal(b.fetches.length, 0);
  b.window.BDOC_Auth._initialized = true;
  await b.settle(1000);
  assert.equal(b.fetches.length, 1);
  assert.ok(b.item());
});

test('stops waiting eventually instead of polling forever', async () => {
  const b = browser({ initialized: false, session: SESSION });
  for (let i = 0; i < 80; i++) await b.settle(1000);
  assert.equal(b.timers.length, 0, 'still polling after the cap');
  assert.equal(b.fetches.length, 0);
});

test('no Supabase client (guest mode, dev key): nothing happens', async () => {
  const b = browser({ hasClient: false, session: SESSION });
  await b.settle(1000);
  assert.equal(b.fetches.length, 0);
  assert.equal(b.authCallback, null);
  assert.deepEqual(b.logged, []);
});

test('the auth callback never touches Supabase inline (p157 deadlock)', async () => {
  const b = browser();
  await b.settle();
  assert.equal(typeof b.authCallback, 'function');
  const before = b.sessionCalls;
  b.session = SESSION;
  const returned = b.authCallback('SIGNED_IN', SESSION);
  assert.equal(returned, undefined, 'an async callback would hold the supabase-js lock');
  await Promise.resolve();
  assert.equal(b.sessionCalls, before, 'getSession ran inside the callback');
  assert.equal(b.timers.filter(t => t.ms === 0).length, 1, 'must defer with setTimeout(0)');
  assert.equal(b.fetches.length, 0);
});

test('a login after load draws the item', async () => {
  const b = browser();
  await b.settle();
  assert.equal(b.item(), undefined);
  b.session = SESSION;
  b.authCallback('SIGNED_IN', SESSION);
  await b.settle();
  assert.equal(b.fetches.length, 1);
  assert.ok(b.item());
});

test('SIGNED_IN on tab refocus and TOKEN_REFRESHED do not probe again', async () => {
  const b = browser({ session: SESSION, respond: denied(403) });
  await b.settle();
  for (const evt of ['SIGNED_IN', 'TOKEN_REFRESHED', 'SIGNED_IN']) {
    b.authCallback(evt, SESSION);
    await b.settle();
  }
  assert.equal(b.fetches.length, 1);
});

test('sign-out removes the item and closes the panel', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  assert.ok(b.item());

  let closed = 0;
  b.window.BDOCWire = { open() {}, close() { closed++; } };
  b.session = null;
  b.authCallback('SIGNED_OUT', null);
  await b.settle();
  assert.equal(b.item(), undefined);
  assert.equal(closed, 1);
});

test('sign-out survives a panel that has no close()', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  b.window.BDOCWire = { open() {} };
  b.session = null;
  b.authCallback('SIGNED_OUT', null);
  await b.settle();
  assert.equal(b.item(), undefined);
  assert.deepEqual(b.logged, []);
});

test('signing back in after a sign-out probes again', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  b.session = null;
  b.authCallback('SIGNED_OUT', null);
  await b.settle();
  b.session = SESSION;
  b.authCallback('SIGNED_IN', SESSION);
  await b.settle();
  assert.equal(b.fetches.length, 2);
  assert.ok(b.item());
});

test('switching to a different user drops the old verdict', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  assert.ok(b.item());

  b.respond = denied(403);
  b.session = { access_token: 'someone-else', user: { id: OTHER } };
  b.authCallback('SIGNED_IN', b.session);
  await b.settle();
  assert.equal(b.fetches.length, 2);
  assert.equal(b.fetches[1].init.headers.Authorization, 'Bearer someone-else');
  assert.equal(b.item(), undefined);
});

test('a probe that resolves after sign-out draws nothing', async () => {
  let release;
  const held = new Promise(r => { release = r; });
  const b = browser({ session: SESSION, respond: () => held });
  await b.settle();
  assert.equal(b.fetches.length, 1);

  b.session = null;
  b.authCallback('SIGNED_OUT', null);
  await b.settle();
  release({ status: 200, json: async () => ({ owner: true }) });
  await b.settle();
  assert.equal(b.item(), undefined, 'the feed button appeared for a signed-out user');
});

test('a retry scheduled for a user who signed out is abandoned', async () => {
  const b = browser({ session: SESSION, respond: denied(500) });
  await b.settle();
  assert.equal(b.fetches.length, 1);
  b.session = null;
  b.authCallback('SIGNED_OUT', null);
  await b.settle(120_000);
  assert.equal(b.fetches.length, 1);
});

test('a retry left over from the previous user does not run under the new one', async () => {
  const b = browser({ session: SESSION, respond: denied(500) });
  await b.settle();
  b.respond = denied(403);
  b.session = { access_token: 'someone-else', user: { id: OTHER } };
  b.authCallback('SIGNED_IN', b.session);
  await b.settle();
  assert.equal(b.fetches.length, 2);
  await b.settle(120_000);
  assert.equal(b.fetches.length, 2, 'one probe per user, and 403 is final');
});

test('clicking WIRE lazy-loads the panel at p160 and opens it embedded', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  assert.equal(b.head.children.length, 0, 'the panel must not load for nothing');

  b.item().fire('click');
  await b.settle();
  const [css, js] = b.head.children;
  assert.equal(css.rel, 'stylesheet');
  assert.equal(css.href, 'css/bdoc-wire.css?v=p160');
  assert.equal(js.src, 'js/bdoc-wire.js?v=p160');

  const opened = [];
  b.window.BDOCWire = { open(o) { opened.push(o); } };
  js.onload();
  await b.settle();
  assert.equal(opened.length, 0, 'the panel must wait for its stylesheet');
  css.onload();
  await b.settle();
  assert.equal(opened.length, 1);
  assert.equal(opened[0].client, b.client);
  assert.equal(opened[0].embedded, true);
});

test('a stalled stylesheet delays the panel but cannot block it', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  b.item().fire('click');
  await b.settle();
  const opened = [];
  b.window.BDOCWire = { open(o) { opened.push(o); } };
  b.head.children[1].onload();
  await b.settle();
  assert.equal(opened.length, 0);
  await b.settle(2000);
  assert.equal(opened.length, 1, 'the feed must open without its CSS');
});

test('a failed stylesheet still opens the panel and leaves the module free to retry it', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  b.item().fire('click');
  await b.settle();
  const [css, js] = b.head.children;
  const opened = [];
  b.window.BDOCWire = { open(o) { opened.push(o); } };
  js.onload();
  css.onerror();
  await b.settle();
  assert.equal(opened.length, 1);
  assert.ok(!b.head.children.includes(css), 'ensureCss() skips the load if a dead link is still there');
});

test('a second click reuses the loaded panel', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  b.item().fire('click');
  b.item().fire('click');
  await b.settle();
  assert.equal(b.head.children.length, 2, 'double click loaded the panel twice');

  const opened = [];
  b.window.BDOCWire = { open(o) { opened.push(o); } };
  const [css, js] = b.head.children;
  css.onload();
  js.onload();
  await b.settle();
  assert.equal(opened.length, 2);

  b.item().fire('click');
  await b.settle();
  assert.equal(opened.length, 3);
  assert.equal(b.head.children.length, 2);
});

test('a failed panel load is silent and the next click retries cleanly', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  b.item().fire('click');
  await b.settle();
  b.head.children[1].onerror();
  await b.settle();
  assert.equal(b.head.children.length, 0, 'failed tags should be cleaned up');
  assert.deepEqual(b.logged, []);

  b.item().fire('click');
  await b.settle();
  assert.equal(b.head.children.length, 2);
});

test('the count follows the module, is hidden at zero, and caps at 99+', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  b.item().fire('click');
  await b.settle();

  const subscribers = [];
  b.window.BDOCWire = { open() {}, onCount(fn) { subscribers.push(fn); fn(0); return () => {}; } };
  const [css, js] = b.head.children;
  css.onload();
  js.onload();
  await b.settle();
  assert.equal(subscribers.length, 1);

  const count = b.item().children[b.item().children.length - 1];
  assert.equal(count.style.display, 'none', 'zero shows nothing');
  subscribers[0](7);
  assert.equal(count.textContent, '7');
  assert.equal(count.style.display, '');
  subscribers[0](1500);
  assert.equal(count.textContent, '99+');
  subscribers[0](0);
  assert.equal(count.style.display, 'none');

  b.item().fire('click');
  await b.settle();
  assert.equal(subscribers.length, 1, 'subscribed twice');
});

test('a count arriving after sign-out is ignored', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  b.item().fire('click');
  await b.settle();
  let emit;
  b.window.BDOCWire = { open() {}, onCount(fn) { emit = fn; return () => {}; } };
  const [css, js] = b.head.children;
  css.onload();
  js.onload();
  await b.settle();

  b.session = null;
  b.authCallback('SIGNED_OUT', null);
  await b.settle();
  emit(5);
  assert.equal(b.item(), undefined);
  assert.deepEqual(b.logged, []);
});

test('the same subscription still feeds the count after signing back in', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  b.item().fire('click');
  await b.settle();
  let emit, subscribed = 0;
  b.window.BDOCWire = { open() {}, close() {}, onCount(fn) { subscribed++; emit = fn; return () => {}; } };
  const [css, js] = b.head.children;
  css.onload();
  js.onload();
  await b.settle();

  b.session = null;
  b.authCallback('SIGNED_OUT', null);
  await b.settle();
  b.session = SESSION;
  b.authCallback('SIGNED_IN', SESSION);
  await b.settle();

  const fresh = b.item();
  assert.ok(fresh);
  emit(3);
  assert.equal(fresh.children[fresh.children.length - 1].textContent, '3');
  fresh.fire('click');
  await b.settle();
  assert.equal(subscribed, 1);
});

test('a module without onCount still opens', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  b.item().fire('click');
  await b.settle();
  const opened = [];
  b.window.BDOCWire = { open(o) { opened.push(o); } };
  const [css, js] = b.head.children;
  css.onload();
  js.onload();
  await b.settle();
  assert.equal(opened.length, 1);
});

test('the panel module exposes everything the boot script calls', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'bdoc-wire.js'), 'utf8');
  assert.match(src, /window\.BDOCWire\s*=/);
  for (const name of ['open', 'close', 'onCount']) {
    assert.match(src, new RegExp(`^\\s*${name}\\b`, 'm'), `BDOCWire.${name} is gone`);
  }
});

test('the item works from the keyboard', async () => {
  const b = browser({ session: SESSION });
  await b.settle();
  const item = b.item();
  assert.equal(item.attrs.role, 'button');
  assert.equal(item.tabIndex, 0);
  let prevented = 0;
  item.fire('keydown', { key: 'Enter', preventDefault() { prevented++; } });
  await b.settle();
  assert.equal(prevented, 1);
  assert.equal(b.head.children.length, 2);
  item.fire('keydown', { key: 'Tab', preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
});
