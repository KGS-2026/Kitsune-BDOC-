// LIVE WIRE owner gate tests. node --test tests/wire-owner.test.js
// owner.mjs is the only thing between a stranger and the live feed, so the ways it
// says no matter more than the way it says yes. Every case that must not reach
// Supabase asserts that it did not. Global fetch is mocked: CI has no network
// access to Supabase and no npm install.
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const OWNER_PATH = path.join(__dirname, '..', 'netlify', 'functions', '_lib', 'owner.mjs');
const load = () => import(pathToFileURL(OWNER_PATH).href);

const OWNER = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const ENV = { BDOC_OWNER_IDS: OWNER, supabase: 'anon-key' };

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

// Unique on every call. The gate caches by token for 60 s, so a shared token would
// let one test answer for another.
let serial = 0;
const jwt = (claims = {}) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'user', n: ++serial, ...claims })}.c2lnbmF0dXJl`;
const auth = (token) => `Bearer ${token}`;

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function mockFetch(respond) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(url, init);
  };
  return calls;
}
const user = (id) => () => new Response(JSON.stringify({ id, email: 'someone@example.com' }), { status: 200 });

test('the owner passes, and the lookup uses the anon key and the caller token', async () => {
  const { checkOwner } = await load();
  const calls = mockFetch(user(OWNER));
  const token = jwt();
  const r = await checkOwner(auth(token), { env: { ...ENV, SUPABASE_URL: 'https://sb.example' } });
  assert.deepEqual(r, { ok: true, status: 200, id: OWNER });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://sb.example/auth/v1/user');
  assert.equal(calls[0].init.headers.apikey, 'anon-key');
  assert.equal(calls[0].init.headers.Authorization, auth(token));
});

test('the default project URL is used when SUPABASE_URL is unset (it is, on Netlify)', async () => {
  const { checkOwner } = await load();
  const calls = mockFetch(user(OWNER));
  await checkOwner(auth(jwt()), { env: ENV });
  assert.equal(calls[0].url, 'https://ulgxbqhbgbyxlzoyxcus.supabase.co/auth/v1/user');
});

test('a valid user who is not on the list gets 403', async () => {
  const { checkOwner } = await load();
  mockFetch(user(OTHER));
  const r = await checkOwner(auth(jwt()), { env: ENV });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test('no BDOC_OWNER_IDS means nobody is the owner', async () => {
  const { checkOwner } = await load();
  mockFetch(user(OWNER));
  assert.equal((await checkOwner(auth(jwt()), { env: { supabase: 'anon-key' } })).status, 403);
  assert.equal((await checkOwner(auth(jwt()), { env: { ...ENV, BDOC_OWNER_IDS: '' } })).status, 403);
  assert.equal((await checkOwner(auth(jwt()), { env: { ...ENV, BDOC_OWNER_IDS: ' , ,' } })).status, 403);
});

test('an unset BDOC_OWNER_IDS does not change what a forged token sees', async () => {
  const { checkOwner } = await load();
  mockFetch(() => new Response('{}', { status: 401 }));
  const r = await checkOwner(auth(jwt()), { env: { supabase: 'anon-key' } });
  assert.equal(r.status, 401, 'a 403 here would tell a stranger the env var is missing');
});

test('no anon key cannot verify anyone: 503, no network call', async () => {
  const { checkOwner } = await load();
  const calls = mockFetch(user(OWNER));
  const r = await checkOwner(auth(jwt()), { env: { BDOC_OWNER_IDS: OWNER } });
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
  assert.equal(calls.length, 0);
});

test('malformed tokens are rejected before any network call', async () => {
  const { checkOwner } = await load();
  const calls = mockFetch(user(OWNER));
  const anonKeyIsAJwtToo = `${b64({ alg: 'HS256' })}.${b64({ role: 'anon', iss: 'supabase' })}.c2ln`;
  const bad = [
    undefined, null, '', 'Bearer', 'Bearer ', 'not-a-header',
    'Basic dXNlcjpwYXNz',
    'Bearer not-a-real-jwt',
    'Bearer a.b',
    'Bearer a.b.c',                        // right shape, payload is not JSON
    'Bearer a.b.c.d',
    `Bearer ${b64({ sub: 'x' })}.${b64([1, 2, 3])}.c2ln`,
    `Bearer ${jwt()} trailing`,
    'Bearer ' + jwt({ pad: 'x'.repeat(9000) }),
    'Bearer ' + anonKeyIsAJwtToo
  ];
  for (const h of bad) {
    const r = await checkOwner(h, { env: ENV });
    assert.equal(r.status, 401, `expected 401 for ${String(h).slice(0, 40)}`);
  }
  assert.equal(calls.length, 0, 'a malformed token reached Supabase');
});

test('a token Supabase refuses is 401, whichever refusal it uses', async () => {
  const { checkOwner } = await load();
  for (const status of [400, 401, 403, 404]) {
    mockFetch(() => new Response('{"msg":"invalid JWT"}', { status }));
    const r = await checkOwner(auth(jwt()), { env: ENV });
    assert.equal(r.status, 401, `Supabase ${status}`);
  }
});

test('Supabase being unreachable fails closed as 503, not as "signed out"', async () => {
  const { checkOwner } = await load();
  const outages = [
    () => { throw new Error('ECONNRESET'); },
    () => new Response('bad gateway', { status: 502 }),
    () => new Response('rate limited', { status: 429 }),
    () => new Response('<html>not json</html>', { status: 200 }),
    () => new Response('{"email":"owner@example.com"}', { status: 200 }),
    () => new Response('null', { status: 200 })
  ];
  for (const respond of outages) {
    mockFetch(respond);
    const r = await checkOwner(auth(jwt()), { env: ENV });
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
  }
});

test('an outage is not cached: the same token works as soon as Supabase returns', async () => {
  const { checkOwner } = await load();
  const token = jwt();
  mockFetch(() => { throw new Error('down'); });
  assert.equal((await checkOwner(auth(token), { env: ENV })).status, 503);
  mockFetch(user(OWNER));
  assert.equal((await checkOwner(auth(token), { env: ENV })).status, 200);
});

test('verdicts are cached for 60 s, then re-checked', async () => {
  const { checkOwner } = await load();
  const calls = mockFetch(user(OWNER));
  const token = jwt();
  const at = (ms) => ({ env: ENV, now: () => 1_000_000 + ms });
  assert.equal((await checkOwner(auth(token), at(0))).status, 200);
  assert.equal((await checkOwner(auth(token), at(59_999))).status, 200);
  assert.equal(calls.length, 1, 'second call inside the window should be served from cache');
  assert.equal((await checkOwner(auth(token), at(60_000))).status, 200);
  assert.equal(calls.length, 2, 'the window must expire');
});

test('a cached refusal stays a refusal and does not spend another lookup', async () => {
  const { checkOwner } = await load();
  const calls = mockFetch(() => new Response('{}', { status: 401 }));
  const token = jwt();
  assert.equal((await checkOwner(auth(token), { env: ENV })).status, 401);
  assert.equal((await checkOwner(auth(token), { env: ENV })).status, 401);
  assert.equal(calls.length, 1);
});

test('the owner list is applied on every call, even on a cache hit', async () => {
  const { checkOwner } = await load();
  mockFetch(user(OWNER));
  const token = jwt();
  assert.equal((await checkOwner(auth(token), { env: ENV })).status, 200);
  assert.equal((await checkOwner(auth(token), { env: { ...ENV, BDOC_OWNER_IDS: OTHER } })).status, 403);
});

test('the cache never holds the raw token', () => {
  const src = fs.readFileSync(OWNER_PATH, 'utf8');
  assert.match(src, /createHash\('sha256'\)\.update\(token\)/);
  assert.match(src, /cache\.get\(key\)/);
  assert.ok(!/cache\.(get|set)\(token/.test(src), 'cache keyed by the raw token');
});

test('the list is matched on id, never on email', async () => {
  const { checkOwner } = await load();
  mockFetch(() => new Response(JSON.stringify({ id: OTHER, email: 'owner@example.com' }), { status: 200 }));
  const r = await checkOwner(auth(jwt()), { env: { ...ENV, BDOC_OWNER_IDS: 'owner@example.com' } });
  assert.equal(r.status, 403);
});

test('BDOC_OWNER_IDS tolerates spaces, case and several ids', async () => {
  const { checkOwner, ownerIds } = await load();
  assert.deepEqual([...ownerIds({ BDOC_OWNER_IDS: ` ${OTHER} ,, ${OWNER.toUpperCase()} ` })], [OTHER, OWNER]);
  assert.deepEqual([...ownerIds({})], []);
  mockFetch(user(OWNER));
  const r = await checkOwner(auth(jwt()), { env: { ...ENV, BDOC_OWNER_IDS: `${OTHER}, ${OWNER.toUpperCase()}` } });
  assert.equal(r.status, 200);
});

test('a wildcard in BDOC_OWNER_IDS is just a string that matches nobody', async () => {
  const { checkOwner } = await load();
  mockFetch(user(OWNER));
  const r = await checkOwner(auth(jwt()), { env: { ...ENV, BDOC_OWNER_IDS: '*' } });
  assert.equal(r.status, 403);
});

test('owner.mjs stays standalone: no CommonJS, no SDK (spec section 3)', () => {
  const src = fs.readFileSync(OWNER_PATH, 'utf8');
  assert.ok(!/\brequire\(/.test(src), 'esbuild shims require in ESM and it throws at call time');
  assert.ok(!/from ['"][^'"]*(guard|_supabase|supabase-js)/.test(src));
});
