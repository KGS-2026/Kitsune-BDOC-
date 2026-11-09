// Watch-zone phone alerts (p165): which hazards page a phone, which never do, and
// that a phone is paged once per event, not once per run.
//
// The decision rules are pure (netlify/functions/_lib/zone-alerts.js) and tested
// directly. The scheduled run is loaded with the same stubs push-activation.test.js
// uses (Blobs and web-push are not installed in CI), plus a fake fetch for the feeds.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'netlify', 'functions');
const LIB_PATH = path.join(FN, '_lib', 'zone-alerts.js');
const lib = require(LIB_PATH);
const SUBSCRIBE_SRC = fs.readFileSync(path.join(FN, 'push-subscribe.mjs'), 'utf8');
const TICK_SRC = fs.readFileSync(path.join(FN, 'zone-alerts-tick.mjs'), 'utf8');

const NOW = Date.parse('2026-11-05T15:00:00Z');
const HOME = { id: 'wzhome', name: 'Home', lat: 34.05, lon: -118.24, radKm: 50 };
const KYIV = { id: 'wzkyiv', name: 'Kyiv', lat: 50.45, lon: 30.52, radKm: 50 };
const SERIOUS = lib.cleanPrefs({});
const ALL = lib.cleanPrefs({ level: 'all' });

const quake = (id, mag, lat, lon, ageMin) => ({
  id, geometry: { coordinates: [lon, lat, 10] },
  properties: { mag, time: NOW - ageMin * 60000, place: 'near ' + id }
});
const nws = (id, severity, extra = {}) => ({
  id: 'https://api.weather.gov/alerts/' + id,
  properties: { id, event: 'Tornado Warning', severity, status: 'Actual', messageType: 'Alert', headline: 'Tornado Warning issued', expires: new Date(NOW + 3600000).toISOString(), ...extra }
});
const csv = (rows) => 'latitude,longitude,acq_date,acq_time,frp\n' + rows.map(([la, lo, frp]) => `${la},${lo},2026-11-05,1400,${frp}`).join('\n');

// ── Input cleaning ─────────────────────────────────────────────────────────

test('zones: bad coordinates dropped, radius clamped, names cleaned, at most 10', () => {
  const raw = [
    { id: 'a', name: 'Home\u0007', lat: 34.051234567, lon: -118.24, radKm: 2 },
    { id: 'b', lat: 91, lon: 0 },
    { id: 'c', lat: 'x', lon: 0 },
    { id: 'a', lat: 1, lon: 1 },                 // duplicate id
    { id: 'd<script>', lat: 10, lon: 10, radKm: 9999 },
    ...Array.from({ length: 20 }, (_, i) => ({ id: 'z' + i, lat: i, lon: i }))
  ];
  const z = lib.cleanZones(raw);
  assert.equal(z.length, 10);
  assert.deepEqual(z[0], { id: 'a', name: 'Home', lat: 34.0512, lon: -118.24, radKm: 5 });
  assert.deepEqual(z[1], { id: 'dscript', name: '10.00, 10.00', lat: 10, lon: 10, radKm: 500 });
  assert.equal(z[2].radKm, 100, 'missing radius means 100 km, like the map menu');
  assert.deepEqual(lib.cleanZones('nope'), []);
});

test('prefs: default is serious-only with every category on', () => {
  assert.deepEqual(lib.cleanPrefs(undefined), { level: 'serious', quake: true, weather: true, fire: true, national: true });
  assert.deepEqual(lib.cleanPrefs({ level: 'loud', fire: false }), { level: 'serious', quake: true, weather: true, fire: false, national: true });
});

// ── Earthquakes ────────────────────────────────────────────────────────────

test('quakes: serious mode pages for M4+, everything mode from M2.5', () => {
  const geo = { features: [quake('q1', 4.2, 34.1, -118.3, 20), quake('q2', 3.1, 34.0, -118.2, 20)] };
  assert.deepEqual(lib.quakeEvents([HOME], SERIOUS, geo, NOW).map(e => e.key), ['eq:q1']);
  assert.deepEqual(lib.quakeEvents([HOME], ALL, geo, NOW).map(e => e.key), ['eq:q1', 'eq:q2']);
});

test('quakes: outside the zone, older than 3 hours, or turned off never page', () => {
  const geo = { features: [quake('far', 6, 40, -118.24, 5), quake('old', 6, 34.05, -118.24, 200)] };
  assert.deepEqual(lib.quakeEvents([HOME], SERIOUS, geo, NOW), []);
  const off = { ...SERIOUS, quake: false };
  assert.deepEqual(lib.quakeEvents([HOME], off, { features: [quake('q', 6, 34.05, -118.24, 5)] }, NOW), []);
});

test('quakes: M5.5+ is critical, and one quake in two zones is one push', () => {
  const near = { ...HOME, id: 'wzwork', name: 'Work', lat: 34.06 };
  const ev = lib.quakeEvents([HOME, near], SERIOUS, { features: [quake('big', 5.8, 34.05, -118.24, 5)] }, NOW);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].severity, 'critical');
  assert.equal(ev[0].tag, 'wz:eq:big', 'same tag as the open tab, so the phone collapses them');
  assert.match(ev[0].title, /^Home: M5\.8 earthquake$/);
  assert.match(ev[0].url, /^\/#v=1&c=-118\.240,34\.050,\d+$/);
});

// ── NWS ────────────────────────────────────────────────────────────────────

test('weather: serious mode keeps Severe and Extreme, everything mode keeps the rest', () => {
  const geo = { features: [nws('a', 'Extreme'), nws('b', 'Severe'), nws('c', 'Moderate'), nws('d', 'Minor')] };
  assert.deepEqual(lib.nwsEvents(HOME, SERIOUS, geo, NOW).map(e => e.severity), ['critical', 'high']);
  assert.equal(lib.nwsEvents(HOME, ALL, geo, NOW).length, 4);
});

test('weather: tests, cancellations and expired alerts never page', () => {
  const geo = { features: [
    nws('t', 'Extreme', { status: 'Test' }),
    nws('x', 'Extreme', { messageType: 'Cancel' }),
    nws('e', 'Extreme', { expires: new Date(NOW - 1000).toISOString() })
  ] };
  assert.deepEqual(lib.nwsEvents(HOME, ALL, geo, NOW), []);
});

test('weather: an update to a warning shares the original warning\'s key', () => {
  const orig = nws('urn:1', 'Severe');
  const upd = nws('urn:2', 'Severe', { messageType: 'Update', references: [{ identifier: 'urn:1' }] });
  const [a] = lib.nwsEvents(HOME, SERIOUS, { features: [orig] }, NOW);
  const [b] = lib.nwsEvents(HOME, SERIOUS, { features: [upd] }, NOW);
  assert.equal(a.key, b.key);
});

// ── Fires ──────────────────────────────────────────────────────────────────

test('fires: a few small detections page only in everything mode', () => {
  const few = csv([[34.05, -118.24, 5], [34.06, -118.25, 7]]);
  assert.equal(lib.fireEvent(HOME, SERIOUS, few), null);
  const e = lib.fireEvent(HOME, ALL, few);
  assert.match(e.body, /^2 satellite fire detections in the last 24 h, strongest 7 MW$/);
});

test('fires: ten detections or one hot one is serious; outside the circle does not count', () => {
  const ten = csv(Array.from({ length: 10 }, (_, i) => [34.05 + i * 0.01, -118.24, 3]));
  assert.ok(lib.fireEvent(HOME, SERIOUS, ten));
  const hot = csv([[34.05, -118.24, 80]]);
  assert.equal(lib.fireEvent(HOME, SERIOUS, hot).severity, 'high');
  const outside = csv([[36, -118.24, 500]]);
  assert.equal(lib.fireEvent(HOME, ALL, outside), null);
  assert.equal(lib.fireEvent(HOME, ALL, '{"error":"firms down"}'), null);
});

// ── Dedupe and caps ────────────────────────────────────────────────────────

test('seen events are not sent again; a fire re-alerts only after its cooldown', () => {
  const seen = {};
  const q = { key: 'eq:1', severity: 'high', title: 't' };
  const f = { key: 'fire:z', cooldownMs: lib.FIRE_COOLDOWN_MS.serious, severity: 'high', title: 'f' };
  assert.equal(lib.selectToSend([q, f], seen, NOW).length, 2);
  assert.equal(lib.selectToSend([q, f], seen, NOW + 60000).length, 0);
  const later = lib.selectToSend([q, f], seen, NOW + lib.FIRE_COOLDOWN_MS.serious + 1);
  assert.deepEqual(later.map(e => e.key), ['fire:z']);
});

test('a bad night is at most 3 notifications, the last one a summary', () => {
  const evs = Array.from({ length: 7 }, (_, i) => ({ key: 'k' + i, severity: i === 5 ? 'critical' : 'high', title: 't' + i }));
  const seen = {};
  const out = lib.selectToSend(evs, seen, NOW);
  assert.equal(out.length, 3);
  assert.equal(out[0].key, 'k5', 'critical first');
  assert.equal(out[2].title, '5 more alerts in your watch zones');
  assert.equal(out[2].covers.length, 5);
  assert.equal(Object.keys(seen).length, 7);
});

test('seen entries expire after 72 hours', () => {
  assert.deepEqual(lib.pruneSeen({ a: NOW - 1000, b: NOW - 73 * 3600000, c: 'x' }, NOW), { a: NOW - 1000 });
});

// ── The scheduled run ──────────────────────────────────────────────────────

function newKey() {
  const priv = crypto.randomBytes(32);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(priv);
  return { priv: priv.toString('base64url'), pub: ecdh.getPublicKey('base64url') };
}
const dataUrl = (src) => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');

function fakeStore(records = {}) {
  const m = new Map(Object.entries(records).map(([k, v]) => [k, JSON.stringify(v)]));
  m.set('index.json', JSON.stringify({ keys: Object.keys(records) }));
  return {
    m,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    roster() { return JSON.parse(m.get('index.json')).keys; },
    json(k) { return m.has(k) ? JSON.parse(m.get(k)) : undefined; }
  };
}

function fakeWebpush(statusFor = () => 0) {
  const sent = [];
  return {
    sent,
    setVapidDetails() {},
    async sendNotification(sub, payload, opts) {
      const code = statusFor(sub.endpoint, sent.length);
      if (code) throw Object.assign(new Error('refused'), { statusCode: code });
      sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload), urgency: opts.urgency });
    }
  };
}

function feeds({ quakes = [], weather = [], fire = csv([]) } = {}) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const ok = (body, text) => ({ ok: true, status: 200, json: async () => body, text: async () => text });
    if (url.includes('earthquake.usgs.gov')) return ok({ features: quakes });
    if (url.includes('api.weather.gov')) return ok({ features: weather });
    if (url.includes('proxy-firms')) return ok(null, fire);
    throw new Error('unexpected fetch ' + url);
  };
  return { fetch, calls };
}

const device = (endpoint, vapid, zones, prefs) => ({
  subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } }, vapid, tier: 'recon',
  ...(zones ? { zones, prefs } : {})
});

let loads = 0;
async function load(t, { env = {}, store = fakeStore(), webpush = fakeWebpush(), net = feeds() } = {}) {
  const keys = ['VAPID_PRIVATE_KEY', 'PUSH_SEND_KEY'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) { if (k in env) process.env[k] = env[k]; else delete process.env[k]; }
  const realFetch = globalThis.fetch;
  globalThis.fetch = net.fetch;
  globalThis.__zaStore = store;
  globalThis.__zaPush = webpush;
  t.after(() => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    globalThis.fetch = realFetch;
    delete globalThis.__zaStore;
    delete globalThis.__zaPush;
  });
  const libUrl = pathToFileURL(LIB_PATH).href;
  const blobs = dataUrl('export const getStore = () => globalThis.__zaStore;');
  const wp = dataUrl('export default new Proxy({}, { get: (_, k) => globalThis.__zaPush[k] });');
  const subUrl = dataUrl(SUBSCRIBE_SRC
    .replace("from '@netlify/blobs'", `from ${JSON.stringify(blobs)}`)
    .replace("from './_lib/zone-alerts.js'", `from ${JSON.stringify(libUrl)}`) + `\n// load ${++loads}`);
  const tickSrc = TICK_SRC
    .replace("from 'web-push'", `from ${JSON.stringify(wp)}`)
    .replace("from './push-subscribe.mjs'", `from ${JSON.stringify(subUrl)}`)
    .replace("from './_lib/zone-alerts.js'", `from ${JSON.stringify(libUrl)}`);
  assert.ok(!/from '[.@w]/.test(tickSrc), 'imports changed, update this test');
  return { tick: await import(dataUrl(tickSrc)), sub: await import(subUrl), store, webpush, net };
}

test('a quake in a watch zone reaches the phone once, not every five minutes', async (t) => {
  const k = newKey();
  const store = fakeStore({ s1: device('https://push/phone', k.pub, [HOME], SERIOUS) });
  const net = feeds({ quakes: [quake('ci123', 4.6, 34.06, -118.25, 30)] });
  const m = await load(t, { env: { VAPID_PRIVATE_KEY: k.priv }, store, net });

  const first = await m.tick.run({ now: NOW });
  assert.equal(first.sent, 1);
  assert.equal(m.webpush.sent[0].tag, 'wz:eq:ci123');
  assert.equal(m.webpush.sent[0].title, 'Home: M4.6 earthquake');
  assert.equal(m.webpush.sent[0].ts, NOW);
  assert.ok(store.json('seen_s1')['eq:ci123']);

  const second = await m.tick.run({ now: NOW + 300000 });
  assert.equal(second.sent, 0);
  assert.equal(m.webpush.sent.length, 1);
});

test('feeds are fetched once per run and shared between people watching the same place', async (t) => {
  const k = newKey();
  const store = fakeStore({
    a: device('https://push/a', k.pub, [HOME], SERIOUS),
    b: device('https://push/b', k.pub, [HOME], SERIOUS)
  });
  const net = feeds({ weather: [nws('urn:w', 'Extreme')] });
  const m = await load(t, { env: { VAPID_PRIVATE_KEY: k.priv }, store, net });
  const out = await m.tick.run({ now: NOW });
  assert.equal(out.sent, 2);
  assert.equal(net.calls.filter(u => u.includes('usgs')).length, 1);
  assert.equal(net.calls.filter(u => u.includes('weather.gov')).length, 1);
  assert.equal(net.calls.filter(u => u.includes('proxy-firms')).length, 1);
  assert.equal(m.webpush.sent[0].urgency, 'high', 'an Extreme warning is sent as urgent');
});

test('no zones, no work: devices without zones cost zero feed requests', async (t) => {
  const k = newKey();
  const store = fakeStore({ a: device('https://push/a', k.pub) });
  const net = feeds();
  const m = await load(t, { env: { VAPID_PRIVATE_KEY: k.priv }, store, net });
  const out = await m.tick.run({ now: NOW });
  assert.deepEqual([out.devices, out.sent, net.calls.length], [0, 0, 0]);
});

test('NWS is asked only about US zones', async (t) => {
  const k = newKey();
  const store = fakeStore({ a: device('https://push/a', k.pub, [KYIV], SERIOUS) });
  const net = feeds();
  const m = await load(t, { env: { VAPID_PRIVATE_KEY: k.priv }, store, net });
  await m.tick.run({ now: NOW });
  assert.equal(net.calls.filter(u => u.includes('weather.gov')).length, 0);
});

test('a device on a retired key and a server with no key are both left alone', async (t) => {
  const k = newKey(), old = newKey();
  const store = fakeStore({ a: device('https://push/a', old.pub, [HOME], SERIOUS) });
  const net = feeds({ quakes: [quake('q', 5, 34.05, -118.24, 5)] });
  let m = await load(t, { env: { VAPID_PRIVATE_KEY: k.priv }, store, net });
  assert.equal((await m.tick.run({ now: NOW })).devices, 0);
  m = await load(t, { env: {}, store, net });
  assert.equal((await m.tick.run({ now: NOW })).skipped, 'VAPID_PRIVATE_KEY missing');
  assert.equal(net.calls.length, 0);
});

test('an expired push address (410) is removed with its zones and history', async (t) => {
  const k = newKey();
  const store = fakeStore({ a: device('https://push/a', k.pub, [HOME], SERIOUS), b: device('https://push/b', k.pub, [HOME], SERIOUS) });
  const webpush = fakeWebpush((ep) => ep === 'https://push/a' ? 410 : 0);
  const net = feeds({ quakes: [quake('q', 5, 34.05, -118.24, 5)] });
  const m = await load(t, { env: { VAPID_PRIVATE_KEY: k.priv }, store, webpush, net });
  const out = await m.tick.run({ now: NOW });
  assert.deepEqual([out.pruned, out.sent], [1, 1]);
  assert.deepEqual(store.roster(), ['b']);
  assert.equal(store.json('a'), undefined);
  assert.equal(store.json('seen_a'), undefined);
});

test('a temporary push failure is retried on the next run instead of lost', async (t) => {
  const k = newKey();
  const store = fakeStore({ a: device('https://push/a', k.pub, [HOME], SERIOUS) });
  let fail = true;
  const webpush = fakeWebpush(() => fail ? 500 : 0);
  const net = feeds({ quakes: [quake('q', 5, 34.05, -118.24, 5)] });
  const m = await load(t, { env: { VAPID_PRIVATE_KEY: k.priv }, store, webpush, net });
  const first = await m.tick.run({ now: NOW });
  assert.deepEqual([first.sent, first.failed], [0, 1]);
  fail = false;
  const second = await m.tick.run({ now: NOW + 300000 });
  assert.equal(second.sent, 1);
});

test('a broken feed costs that feed only', async (t) => {
  const k = newKey();
  const store = fakeStore({ a: device('https://push/a', k.pub, [HOME], SERIOUS) });
  const base = feeds({ weather: [nws('urn:w', 'Severe')] });
  const net = { calls: base.calls, fetch: async (u) => { if (u.includes('usgs')) { base.calls.push(u); return { ok: false, status: 503 }; } return base.fetch(u); } };
  const m = await load(t, { env: { VAPID_PRIVATE_KEY: k.priv }, store, net });
  const out = await m.tick.run({ now: NOW });
  assert.equal(out.sent, 1);
  assert.deepEqual(out.feedErrors, ['usgs 503']);
});

// ── Storing zones with the subscription ────────────────────────────────────

test('subscribe stores cleaned zones and choices; unsubscribe deletes them with the history', async (t) => {
  const k = newKey();
  const store = fakeStore();
  const m = await load(t, { env: { VAPID_PRIVATE_KEY: k.priv }, store });
  const post = (body) => m.sub.default(new Request('https://kgsbdoc.netlify.app/.netlify/functions/push-subscribe', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  }));
  const endpoint = 'https://push/x';
  const r = await (await post({
    subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } }, vapid: k.pub,
    zones: [HOME, { lat: 999, lon: 0 }], prefs: { level: 'all', fire: false }
  })).json();
  const rec = store.json(r.key);
  assert.deepEqual(rec.zones, [HOME]);
  assert.deepEqual(rec.prefs, { level: 'all', quake: true, weather: true, fire: false, national: true });

  const status = await (await m.sub.default(new Request('https://kgsbdoc.netlify.app/.netlify/functions/push-subscribe'))).json();
  assert.deepEqual([status.count, status.zoned], [1, 1]);

  await store.setJSON('seen_' + r.key, { 'eq:1': NOW });
  await post({ unsubscribe: true, endpoint });
  assert.equal(store.json(r.key), undefined);
  assert.equal(store.json('seen_' + r.key), undefined);
});

test('a device that removes its last zone stops being watched', async (t) => {
  const k = newKey();
  const store = fakeStore();
  const m = await load(t, { env: { VAPID_PRIVATE_KEY: k.priv }, store });
  const post = (zones) => m.sub.default(new Request('https://kgsbdoc.netlify.app/.netlify/functions/push-subscribe', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: { endpoint: 'https://push/y', keys: { p256dh: 'p', auth: 'a' } }, vapid: k.pub, zones })
  }));
  const { key } = await (await post([HOME])).json();
  assert.equal(store.json(key).zones.length, 1);
  await post([]);
  assert.equal(store.json(key).zones, undefined);
});
