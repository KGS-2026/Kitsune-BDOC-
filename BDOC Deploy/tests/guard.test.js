// Guard unit tests. node --test tests/guard.test.js
// These matter more than usual: a bug here either locks out paying customers
// or hands paid data to anyone. Run before every deploy that touches guard.js.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.BDOC_ALLOWED_ORIGINS = 'https://kgsbdoc.netlify.app';
process.env.BDOC_INTERNAL_SECRET = 'test-secret-value-12345';

const guardPath = path.join(__dirname, '..', 'netlify', 'functions', '_lib', 'guard.js');
const { wrap, tierAllows, isReconLayer, RECON } = require(guardPath);

const OK = async () => ({ statusCode: 200, body: JSON.stringify({ data: 'payload' }) });
const ev = (o = {}) => ({
  httpMethod: o.method || 'GET',
  headers: o.headers || {},
  queryStringParameters: o.query || {}
});

test('recon layer is open to guests (free map must not break)', async () => {
  const h = wrap({ layer: 'eq' }, OK);
  const r = await h(ev(), {});
  assert.equal(r.statusCode, 200);
});

test('gated layer with no token -> 401', async () => {
  const h = wrap({ layer: 'vessels' }, OK);
  const r = await h(ev(), {});
  assert.equal(r.statusCode, 401);
});

test('gated layer with garbage token -> 401 (not 200)', async () => {
  const h = wrap({ layer: 'vessels' }, OK);
  const r = await h(ev({ headers: { authorization: 'Bearer not-a-real-jwt' } }), {});
  assert.equal(r.statusCode, 401);
});

test('cross-origin browser request -> 403', async () => {
  const h = wrap({ layer: 'eq' }, OK);
  const r = await h(ev({ headers: { origin: 'https://evil.example' } }), {});
  assert.equal(r.statusCode, 403);
});

test('cross-site Sec-Fetch-Site -> 403', async () => {
  const h = wrap({ layer: 'eq' }, OK);
  const r = await h(ev({ headers: { 'sec-fetch-site': 'cross-site' } }), {});
  assert.equal(r.statusCode, 403);
});

test('allowed origin passes', async () => {
  const h = wrap({ layer: 'eq' }, OK);
  const r = await h(ev({ headers: { origin: 'https://kgsbdoc.netlify.app', 'sec-fetch-site': 'same-origin' } }), {});
  assert.equal(r.statusCode, 200);
});

test('OPTIONS preflight -> 204', async () => {
  const h = wrap({ layer: 'eq' }, OK);
  const r = await h(ev({ method: 'OPTIONS' }), {});
  assert.equal(r.statusCode, 204);
});

test('disallowed method -> 405', async () => {
  const h = wrap({ layer: 'eq', methods: ['GET', 'OPTIONS'] }, OK);
  const r = await h(ev({ method: 'DELETE' }), {});
  assert.equal(r.statusCode, 405);
});

test('internal auth: wrong secret -> 401, right secret -> 200', async () => {
  const h = wrap({ name: 'push', auth: 'internal', methods: ['POST', 'OPTIONS'] }, OK);
  const bad = await h(ev({ method: 'POST', headers: { 'x-bdoc-internal': 'wrong' } }), {});
  assert.equal(bad.statusCode, 401);
  const good = await h(ev({ method: 'POST', headers: { 'x-bdoc-internal': 'test-secret-value-12345' } }), {});
  assert.equal(good.statusCode, 200);
});

test('internal auth: empty header never passes', async () => {
  const h = wrap({ name: 'push', auth: 'internal', methods: ['POST', 'OPTIONS'] }, OK);
  const r = await h(ev({ method: 'POST', headers: {} }), {});
  assert.equal(r.statusCode, 401);
});

test('rate limit fires and returns Retry-After', async () => {
  const h = wrap({ name: 'rl-test', layer: 'eq', rate: [3, 60] }, OK);
  const e = ev({ headers: { 'x-nf-client-connection-ip': '10.0.0.9' } });
  for (let i = 0; i < 3; i++) assert.equal((await h(e, {})).statusCode, 200);
  const limited = await h(e, {});
  assert.equal(limited.statusCode, 429);
  assert.ok(limited.headers['Retry-After']);
});

test('inner handler throwing -> 502, never leaks the stack', async () => {
  const boom = async () => { throw new Error('secret internal detail xyz'); };
  const h = wrap({ layer: 'eq' }, boom);
  const r = await h(ev(), {});
  assert.equal(r.statusCode, 502);
  assert.ok(!r.body.includes('secret internal detail'));
});

test('tierAllows: recon layers open to everyone', () => {
  for (const l of RECON) assert.equal(tierAllows('recon', l), true);
});

test('tierAllows: recon user blocked from paid layer', () => {
  assert.equal(tierAllows('recon', 'vessels'), false);
});

test('tierAllows: operator and above get paid layers', () => {
  assert.equal(tierAllows('operator', 'vessels'), true);
  assert.equal(tierAllows('analyst', 'vessels'), true);
  assert.equal(tierAllows('enterprise', 'vessels'), true);
});

test('tierAllows: unknown/garbage tier is refused (fails closed)', () => {
  assert.equal(tierAllows('COMMAND', 'vessels'), false);
  assert.equal(tierAllows(undefined, 'vessels'), false);
  assert.equal(tierAllows('', 'vessels'), false);
});

test('isReconLayer: no layer specified is treated as free', () => {
  assert.equal(isReconLayer(undefined), true);
});

test('layer can be a function of the request (multi-layer proxies)', async () => {
  const h = wrap({ name: 'gdacs', layer: (e) => e.queryStringParameters.eventtype === 'EQ' ? 'eq' : 'vessels' }, OK);
  assert.equal((await h(ev({ query: { eventtype: 'EQ' } }), {})).statusCode, 200);   // recon
  assert.equal((await h(ev({ query: { eventtype: 'XX' } }), {})).statusCode, 401);   // gated
});
