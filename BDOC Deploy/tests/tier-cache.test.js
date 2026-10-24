// p158e — field audit S2: a paying user who loses signal must not be silently
// dropped to recon (Battle Tracker locks). auth.js caches the server-confirmed
// tier for 30 days and reads it ONLY when the profile fetch fails.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

function load(store) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth.js'), 'utf8');
  const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const ctx = { window: {}, document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: ls, sessionStorage: ls, console: { log() {}, warn() {}, info() {}, error() {} }, setTimeout, location: { search: '', href: '' }, history: { replaceState() {} }, URLSearchParams };
  vm.createContext(ctx);
  vm.runInContext(src + ';this.__A=BDOC_Auth;', ctx);
  const A = ctx.__A; A.updateUI = () => {}; return A;
}
const client = res => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => { if (res instanceof Error) throw res; return res; } }) }) }) });

test('successful load writes cache', async () => {
  const s = {}; const A = load(s); A.user = { id: 'u1' }; A.client = client({ data: { tier: 'analyst' } });
  await A.loadProfile(); assert.equal(A.tier, 'analyst');
  assert.equal(JSON.parse(s.bdoc_tier_cache).tier, 'analyst');
});
test('offline (null data) uses cached paid tier', async () => {
  const s = { bdoc_tier_cache: JSON.stringify({ uid: 'u1', tier: 'analyst', exp: Date.now() + 1e6 }) };
  const A = load(s); A.user = { id: 'u1' }; A.client = client({ data: null, error: { message: 'fetch failed' } });
  await A.loadProfile(); assert.equal(A.tier, 'analyst');
});
test('offline (throw) uses cached paid tier', async () => {
  const s = { bdoc_tier_cache: JSON.stringify({ uid: 'u1', tier: 'operator', exp: Date.now() + 1e6 }) };
  const A = load(s); A.user = { id: 'u1' }; A.client = client(new Error('net'));
  await A.loadProfile(); assert.equal(A.tier, 'operator');
});
test('expired cache is ignored', async () => {
  const s = { bdoc_tier_cache: JSON.stringify({ uid: 'u1', tier: 'analyst', exp: Date.now() - 1 }) };
  const A = load(s); A.user = { id: 'u1' }; A.client = client({ data: null });
  await A.loadProfile(); assert.equal(A.tier, 'recon');
});
test("another user's cache is ignored", async () => {
  const s = { bdoc_tier_cache: JSON.stringify({ uid: 'other', tier: 'enterprise', exp: Date.now() + 1e6 }) };
  const A = load(s); A.user = { id: 'u1' }; A.client = client({ data: null });
  await A.loadProfile(); assert.equal(A.tier, 'recon');
});
test('forged unknown tier is ignored', async () => {
  const s = { bdoc_tier_cache: JSON.stringify({ uid: 'u1', tier: 'god', exp: Date.now() + 1e6 }) };
  const A = load(s); A.user = { id: 'u1' }; A.client = client({ data: null });
  await A.loadProfile(); assert.equal(A.tier, 'recon');
});
test('logout clears the cache', async () => {
  const s = { bdoc_tier_cache: '{}' }; const A = load(s); A.client = null; A.markLockedLayers = () => {};
  await A.logout(); assert.ok(!('bdoc_tier_cache' in s));
});
