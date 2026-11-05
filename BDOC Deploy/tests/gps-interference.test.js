// p167: GPS jamming layer. The rules were tuned on live adsb.lol data on 5 Nov 2026:
// near Kaliningrad 17 % of jets reported degraded GPS, over Western Europe 0.6 %.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const FN = path.join(__dirname, '..', 'netlify', 'functions');
const LIB_PATH = path.join(FN, '_lib', 'gps-interference.js');
const lib = require(LIB_PATH);
const TICK_SRC = fs.readFileSync(path.join(FN, 'gps-interference-tick.mjs'), 'utf8');
const SERVE_SRC = fs.readFileSync(path.join(FN, 'gps-interference.mjs'), 'utf8');

// A healthy airliner, as adsb.lol reports it.
const jet = (over = {}) => ({ hex: 'a1', type: 'adsb_icao', category: 'A3', version: 2, alt_baro: 35000, lat: 54.9, lon: 20.4, nic: 8, nac_p: 10, sil: 3, ...over });

test('a healthy jet is counted and is not degraded', () => {
  assert.strictEqual(lib.degraded(jet()), false);
});

test('a jet with low NIC, low NACp or a lost GPS fix is degraded', () => {
  assert.strictEqual(lib.degraded(jet({ nic: 0, nac_p: 0 })), true);
  assert.strictEqual(lib.degraded(jet({ nic: 5, nac_p: 8 })), true);
  assert.strictEqual(lib.degraded(jet({ nic: 8, nac_p: 7 })), true);
  assert.strictEqual(lib.degraded(jet({ gpsOkBefore: 1762300000 })), true);
});

test('a jammed jet located by the ground network (MLAT) still counts', () => {
  // Kaliningrad, 5 Nov: 13 of 16 degraded jets were MLAT, several reporting SIL 0.
  assert.strictEqual(lib.degraded(jet({ type: 'mlat', nic: 0, nac_p: 0, sil: 0 })), true);
});

test('light aircraft with uncertified GPS are left out, so they cannot fake jamming', () => {
  assert.strictEqual(lib.degraded(jet({ category: 'A1', nic: 3, nac_p: 9, sil: 0, alt_baro: 1700 })), null);
  assert.strictEqual(lib.degraded(jet({ category: 'B4', nic: 6 })), null);
  assert.strictEqual(lib.degraded(jet({ category: 'A7', nic: 0 })), null);
  // No category: only counted at altitudes light aircraft don't reach.
  assert.strictEqual(lib.degraded(jet({ category: undefined, alt_baro: 9000, nic: 0 })), null);
  assert.strictEqual(lib.degraded(jet({ category: undefined, alt_baro: 36000, nic: 0 })), true);
});

test('reports that say nothing about GPS are skipped', () => {
  assert.strictEqual(lib.degraded(jet({ version: 0, nic: 0 })), null, 'version 0 sends NUCp, not NIC');
  assert.strictEqual(lib.degraded(jet({ version: undefined, type: 'mlat', nic: 0 })), null, 'Mode S only');
  assert.strictEqual(lib.degraded(jet({ type: 'tisb_icao' })), null);
  assert.strictEqual(lib.degraded(jet({ alt_baro: 'ground', nic: 0 })), null);
  assert.strictEqual(lib.degraded(jet({ nic: undefined, nac_p: undefined })), null);
  assert.strictEqual(lib.degraded(null), null);
});

test('tally counts each aircraft once per sample, in its 1-degree cell', () => {
  const cells = lib.tally([
    [jet({ hex: 'a' }), jet({ hex: 'b', nic: 0 }), jet({ hex: 'c', lat: -33.5, lon: 151.2 })],
    [jet({ hex: 'a' }), jet({ hex: 'b', nic: 0 })],            // overlapping region: same aircraft again
    [jet({ hex: 'd', lat: undefined, lon: undefined, gpsOkBefore: 1, gpsOkLat: 54.1, gpsOkLon: 20.9 })]
  ]);
  assert.deepStrictEqual(cells, { '54,20': [2, 3], '-34,151': [0, 1] });
});

test('cells need 20 reports before they get a colour, then use the gpsjam bands', () => {
  assert.strictEqual(lib.level(1, 19), null);
  assert.strictEqual(lib.level(0, 20), 'low');
  assert.strictEqual(lib.level(1, 100), 'low');
  assert.strictEqual(lib.level(2, 100), 'medium');
  assert.strictEqual(lib.level(10, 100), 'medium');
  assert.strictEqual(lib.level(11, 100), 'high');
  const rows = lib.summarize({ '54,20': [30, 100], '50,5': [0, 200], '1,1': [5, 6] });
  assert.deepStrictEqual(rows.map(r => [r.lat, r.lon, r.pct, r.level]), [[54, 20, 30, 'high'], [50, 5, 0, 'low']]);
});

test('each 15-minute run samples a quarter of the regions, all of them every hour', () => {
  const hour = Date.UTC(2026, 10, 5, 14, 0);
  const seen = [];
  for (const m of [0, 15, 30, 45]) {
    const rs = lib.regionsFor(hour + m * 60e3 + 5000);
    assert.ok(rs.length <= lib.PER_RUN);
    seen.push(...rs.map(r => r.name));
  }
  assert.strictEqual(new Set(seen).size, lib.REGIONS.length);
  assert.strictEqual(seen.length, lib.REGIONS.length);
});

test('hour keys and the 24-hour window', () => {
  const now = Date.UTC(2026, 10, 5, 14, 37);
  assert.strictEqual(lib.hourKey(now), 'h-2026110514');
  const w = lib.windowKeys(now);
  assert.strictEqual(w.length, 24);
  assert.strictEqual(w[0], 'h-2026110514');
  assert.strictEqual(w[23], 'h-2026110415');
});

// ---- the two functions, with Blobs and the network faked ----
const dataUrl = (src) => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
function fakeStore(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    m,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    json(k) { return m.has(k) ? JSON.parse(m.get(k)) : undefined; }
  };
}
async function loadFn(src) {
  const code = src
    .replace("from '@netlify/blobs'", `from ${JSON.stringify(dataUrl('export const getStore = () => { throw new Error("pass a store"); };'))}`)
    .replace("from './_lib/gps-interference.js'", `from ${JSON.stringify(pathToFileURL(LIB_PATH).href)}`);
  assert.ok(!/from '[.@]/.test(code), 'imports changed, update this test');
  return import(dataUrl(code));
}
function net(t, answer) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(url); return answer(url, calls.length); };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const NOW = Date.UTC(2026, 10, 5, 14, 2);

test('a run samples its regions politely and adds to this hour', async (t) => {
  const tick = await loadFn(TICK_SRC);
  const calls = net(t, () => reply(200, { ac: [jet({ hex: 'x1' }), jet({ hex: 'x2', nic: 0, nac_p: 0 })] }));
  const store = fakeStore({ 'h-2026110514': { '54,20': [1, 4] }, 'h-2026110413': { old: true } });
  const pauses = [];
  const out = await tick.run({ now: NOW, store, pause: async (ms) => { pauses.push(ms); } });
  assert.strictEqual(calls.length, lib.regionsFor(NOW).length);
  assert.ok(calls.every(u => u.startsWith('https://api.adsb.lol/v2/lat/') && u.endsWith('/dist/250')));
  assert.ok(pauses.length === calls.length - 1 && pauses.every(ms => ms >= 1000), 'spaced out');
  assert.deepStrictEqual(store.json('h-2026110514'), { '54,20': [2, 6] }, 'same aircraft across regions counted once');
  assert.strictEqual(store.json('h-2026110413'), undefined, 'hour that left the window is dropped');
  assert.deepStrictEqual(out.errors, []);
});

test('a rate-limit reply stops the run instead of hammering adsb.lol', async (t) => {
  const tick = await loadFn(TICK_SRC);
  const calls = net(t, (url, n) => (n === 2 ? reply(200, 'rate limit exceeded\n') : reply(200, { ac: [jet({ hex: 'h' + n })] })));
  const store = fakeStore();
  const out = await tick.run({ now: NOW, store, pause: async () => {} });
  assert.strictEqual(calls.length, 2);
  assert.match(out.errors[0], /rate limited/);
  assert.deepStrictEqual(store.json('h-2026110514'), { '54,20': [0, 1] }, 'what was gathered is kept');
});

test('a failed region does not lose the others, and nothing is written when nothing came back', async (t) => {
  const tick = await loadFn(TICK_SRC);
  net(t, () => { throw new Error('timeout'); });
  const store = fakeStore();
  const out = await tick.run({ now: NOW, store, pause: async () => {} });
  assert.strictEqual(out.errors.length, lib.regionsFor(NOW).length);
  assert.strictEqual(store.json('h-2026110514'), undefined);
  assert.ok(store.json('meta').errors.length > 0);
});

test('the endpoint merges the last 24 hours and leaves older hours out', async () => {
  const serve = await loadFn(SERVE_SRC);
  const store = fakeStore({
    'h-2026110514': { '54,20': [8, 30] },
    'h-2026110415': { '54,20': [4, 20], '50,5': [0, 40] },
    'h-2026110414': { '54,20': [99, 99] },           // 25 hours old
    meta: { updated: '2026-11-05T14:02:00.000Z' }
  });
  const body = await serve.build({ now: NOW, store });
  assert.strictEqual(body.hours, 2);
  assert.strictEqual(body.updated, '2026-11-05T14:02:00.000Z');
  assert.deepStrictEqual(body.cells.map(c => [c.lat, c.lon, c.bad, c.total, c.level]), [[54, 20, 12, 50, 'high'], [50, 5, 0, 40, 'low']]);
});
