// FEMA national alerts (p181): the banner and the push read FEMA's public IPAWS feed.
//
// The fixtures are real: tests/fixtures/ipaws-npt-2023.xml and ipaws-ean-2023.xml are
// the 2023-10-04 nationwide test messages as FEMA archived them (OpenFEMA
// IpawsArchivedAlerts.originalMessage). ipaws-recent-local.xml and ipaws-eas-feed.xml
// are the live public feed and EAS feed as fetched on 2026-11-09.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'netlify', 'functions');
const lib = require(path.join(FN, '_lib', 'ipaws.js'));
const zoneLib = require(path.join(FN, '_lib', 'zone-alerts.js'));
const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const NPT = fx('ipaws-npt-2023.xml');
const EAN = fx('ipaws-ean-2023.xml');
const LOCAL = fx('ipaws-recent-local.xml');
const EAS_FEED = fx('ipaws-eas-feed.xml');

const T_NPT = Date.parse('2023-10-04T18:20:03Z');
const DURING = T_NPT + 2 * 60e3;            // 2:22 pm ET, test on air
const AFTER = Date.parse('2023-10-04T18:51:00Z');
const wrap = (...alerts) => '<?xml version="1.0"?><ns1:alerts xmlns:ns1="http://gov.fema.ipaws.services/feed">' + alerts.join('') + '</ns1:alerts>';

test('the 2023 nationwide test parses: FEMA sender, NPT, English and Spanish, audio, 30 minutes', () => {
  const [a] = lib.parseCap(NPT);
  assert.equal(a.sender, 'ipaws@fema.dhs.gov');
  assert.equal(a.status, 'Actual', 'FEMA sends the test as Actual');
  assert.equal(a.info.length, 2);
  assert.deepEqual(a.info[0].codes, ['NPT']);
  assert.equal(a.info[0].severity, 'Extreme', 'and as Extreme, so severity cannot tell a test apart');

  const n = lib.nationalOf(a, DURING);
  assert.equal(n.code, 'NPT');
  assert.equal(n.kind, 'test');
  assert.equal(n.langs.en.headline, 'National Periodic Test');
  assert.match(n.langs.en.text, /This is only a test\. No action is required/);
  assert.equal(n.langs.es.headline, 'Prueba Periódica Nacional', 'UTF-8 accents survive');
  assert.match(n.langs.en.audio, /^https:\/\/.+NPT_2023_en-US\.mp3$/);
  assert.equal(n.sent, '2023-10-04T18:20:03.000Z');
  assert.equal(n.expires, '2023-10-04T18:50:03.000Z');
  assert.equal(lib.nationalOf(a, AFTER), null, 'gone once it expires');
});

test('the 2023 phone test was EAN with "THIS IS A TEST": a test, not a national emergency', () => {
  const [a] = lib.parseCap(EAN);
  const n = lib.nationalOf(a, DURING);
  assert.equal(n.code, 'EAN');
  assert.equal(n.presidential, true);
  assert.equal(n.kind, 'test');
  assert.match(n.langs.en.text, /^THIS IS A TEST of the National Wireless Emergency Alert System/, 'CMAM text fills in when there is no description');
  assert.equal(lib.titleOf(n), 'NATIONAL ALERT TEST · FEMA');
});

test('an EAN without test wording is an emergency', () => {
  const real = EAN.replace(/THIS IS A TEST of/g, 'ATTENTION:').replace(/No action is (?:needed|required by the public)\./g, 'Follow official instructions.')
    .replace(/ESTA ES UNA PRUEBA del/g, 'ATENCION:');
  const n = lib.nationalOf(lib.parseCap(real)[0], DURING);
  assert.equal(n.kind, 'emergency');
  assert.equal(lib.titleOf(n), 'PRESIDENTIAL ALERT · FEMA');
  assert.equal(JSON.parse(lib.pushPayload(n, DURING)).severity, 'critical');
});

test('a national code from anyone but FEMA, or a drill, never banners', () => {
  const spoof = NPT.replace('<sender>ipaws@fema.dhs.gov</sender>', '<sender>ops@county.example.gov</sender>');
  assert.equal(lib.nationalOf(lib.parseCap(spoof)[0], DURING), null);
  assert.equal(lib.nationalOf(lib.parseCap(NPT.replace('<status>Actual</status>', '<status>Exercise</status>'))[0], DURING), null);
  assert.equal(lib.nationalOf(lib.parseCap(NPT.replace('<scope>Public</scope>', '<scope>Restricted</scope>'))[0], DURING), null);
});

test('local alerts in the public feed are not national', () => {
  const alerts = lib.parseCap(LOCAL);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].sender, /ilogcorp/);
  assert.deepEqual(alerts[0].info[0].codes, ['LAE']);
  assert.deepEqual(lib.nationalList(alerts, Date.parse(alerts[0].sent) + 60e3), []);
});

test('the FEMA feed wrapper with several alerts: national ones only, most urgent first', () => {
  const realEan = EAN.replace(/THIS IS A TEST of/g, 'ATTENTION:').replace(/ESTA ES UNA PRUEBA del/g, 'ATENCION:')
    .replace(/No action is (?:needed|required by the public)\./g, '').replace(/AS-DC-[0-9a-f-]+/, 'REAL-EAN-1');
  const list = lib.mergeNational(lib.nationalList(lib.parseCap(wrap(LOCAL.replace(/^<\?xml[^>]*>/, ''), NPT, realEan)), DURING));
  assert.deepEqual(list.map(n => n.kind), ['emergency', 'test']);
});

test('a FEMA Cancel takes the alert down', () => {
  const [a] = lib.parseCap(NPT);
  const cancel = `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>CANCEL-1</identifier><sender>ipaws@fema.dhs.gov</sender><sent>2023-10-04T12:25:00-06:00</sent><status>Actual</status><msgType>Cancel</msgType><scope>Public</scope><references>ipaws@fema.dhs.gov,${a.identifier},2023-10-04T12:20:03-06:00</references><info><event>National Periodic Test</event><eventCode><valueName>SAME</valueName><value>NPT</value></eventCode></info></alert>`;
  assert.deepEqual(lib.nationalList(lib.parseCap(wrap(NPT, cancel)), DURING), []);
  const fake = cancel.replace('<sender>ipaws@fema.dhs.gov</sender>', '<sender>x@example.com</sender>');
  assert.equal(lib.nationalList(lib.parseCap(wrap(NPT, fake)), DURING).length, 1, 'only FEMA can cancel FEMA');
});

test('feed text is decoded as text: entities, CDATA, no markup carried as HTML', () => {
  const x = NPT.replace('<headline>National Periodic Test</headline>', '<headline>&lt;img src=x onerror=alert(1)&gt; A &amp; B</headline>')
    .replace(/<description>[^<]*<\/description>/, '<description><![CDATA[Line <b>one</b>]]></description>');
  const n = lib.nationalOf(lib.parseCap(x)[0], DURING);
  assert.equal(n.langs.en.headline, '<img src=x onerror=alert(1)> A & B', 'kept as literal text; the page sets it with textContent');
  assert.equal(n.langs.en.text, 'Line <b>one</b>');
  const bad = NPT.replace(/https:\/\/d3dwz1i7gt1v2y\.cloudfront\.net\/NPT_2023_en-US\.mp3/, 'javascript:alert(1)');
  assert.equal(lib.nationalOf(lib.parseCap(bad)[0], DURING).langs.en.audio, '', 'only https audio links');
});

test('the EAS feed names the code; an NPT entry stands in until the full message is readable', () => {
  const entries = lib.parseEasFeed(EAS_FEED);
  assert.deepEqual(entries.map(e => e.code), ['LAE', 'ADR', 'MEP']);
  assert.ok(entries.every(e => lib.isEasUrl(e.url)));
  assert.equal(entries[0].statefips, '16');
  assert.equal(lib.fromEasEntry(entries[0], Date.parse(entries[0].updated)), null, 'LAE is not national');

  const npt = { url: lib.BASE + '/eas/300200000001', code: 'NPT', statefips: '00', updated: '2023-10-04T18:20:05.000Z' };
  const p = lib.fromEasEntry(npt, DURING);
  assert.equal(p.kind, 'test');
  assert.equal(p.partial, true);
  assert.equal(lib.fromEasEntry({ ...npt, url: 'https://evil.example/eas/1' }, DURING), null, 'only FEMA URLs');
  const full = lib.nationalOf(lib.parseCap(NPT)[0], DURING);
  assert.deepEqual(lib.mergeNational([p, full]).map(n => n.id), [full.id], 'the full message replaces the stand-in');
});

// ── gov-alert function, with FEMA stubbed ───────────────────────────────────
function femaStub({ recent = wrap(), feed = '<feed xmlns="http://www.w3.org/2005/Atom"></feed>', eas = {}, fail = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const ok = (text) => ({ ok: true, status: 200, text: async () => text });
    if (fail.some(f => url.includes(f))) return { ok: false, status: 503, text: async () => '' };
    if (url.includes('/rest/public/recent/')) return ok(recent);
    if (url.endsWith('/rest/feed')) return ok(feed);
    const m = url.match(/\/rest\/eas\/(\d+)$/);
    if (m && eas[m[1]]) return ok(eas[m[1]]);
    if (m) return { ok: false, status: 403, text: async () => '{"message":"already expired"}' };
    throw new Error('unexpected fetch ' + url);
  };
  return { fetchImpl, calls };
}

const gov = require(path.join(FN, 'gov-alert.js'));

test('collect: the public feed carries the test, asked with a 6-hour window', async () => {
  const s = femaStub({ recent: wrap(NPT) });
  const out = await gov.collect({ now: DURING, fetchImpl: s.fetchImpl });
  assert.equal(out.ok, true);
  assert.deepEqual(out.national.map(n => n.code), ['NPT']);
  assert.ok(s.calls[0].endsWith('/rest/public/recent/2023-10-04T12:22:03Z'), s.calls[0]);
});

test('collect: public feed down, the EAS feed still raises the banner', async () => {
  const feed = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="text">NPT</title><link href="' + lib.BASE + '/eas/300200000001"/><id>x</id><updated>2023-10-04T18:20:05.000Z</updated><category term="00" label="statefips"/><category term="NPT" label="event"/></entry></feed>';
  const withFull = await gov.collect({ now: DURING, fetchImpl: femaStub({ feed, fail: ['/public/recent/'], eas: { 300200000001: NPT } }).fetchImpl });
  assert.equal(withFull.sources.public, 'HTTP 503');
  assert.deepEqual(withFull.national.map(n => [n.code, !!n.partial]), [['NPT', false]], 'full CAP from the EAS entry');
  const standIn = await gov.collect({ now: DURING, fetchImpl: femaStub({ feed, fail: ['/public/recent/'] }).fetchImpl });
  assert.deepEqual(standIn.national.map(n => [n.code, !!n.partial]), [['NPT', true]], 'entry unreadable: stand-in');
});

test('handler: 200 with a 20 s shared CDN cache; 502 when FEMA is unreachable', async (t) => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = femaStub({ recent: LOCAL }).fetchImpl;
  const ok = await gov.handler({ httpMethod: 'GET' });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers['Netlify-CDN-Cache-Control'], /durable, s-maxage=20/);
  assert.deepEqual(JSON.parse(ok.body).national, []);
  globalThis.fetch = femaStub({ fail: ['/rest/'] }).fetchImpl;
  const down = await gov.handler({ httpMethod: 'GET' });
  assert.equal(down.statusCode, 502);
  assert.equal(JSON.parse(down.body).ok, false);
  assert.equal((await gov.handler({ httpMethod: 'POST' })).statusCode, 405);
});

test('the push setting defaults to on and can be turned off', () => {
  assert.equal(zoneLib.cleanPrefs({}).national, true);
  assert.equal(zoneLib.cleanPrefs(null).national, true);
  assert.equal(zoneLib.cleanPrefs({ national: false }).national, false);
});

// ── gov-alert-tick, with Blobs, web-push and FEMA stubbed ───────────────────
const dataUrl = (src) => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
const SUBSCRIBE_SRC = fs.readFileSync(path.join(FN, 'push-subscribe.mjs'), 'utf8');
const TICK_SRC = fs.readFileSync(path.join(FN, 'gov-alert-tick.mjs'), 'utf8');

function vapid() {
  const priv = crypto.randomBytes(32);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(priv);
  return { priv: priv.toString('base64url'), pub: ecdh.getPublicKey('base64url') };
}

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
      const code = statusFor(sub.endpoint);
      if (code) throw Object.assign(new Error('refused'), { statusCode: code });
      sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload), urgency: opts.urgency, TTL: opts.TTL });
    }
  };
}

const device = (endpoint, vapidPub, prefs) => ({ subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } }, vapid: vapidPub, tier: 'recon', ...(prefs ? { prefs } : {}) });

let loads = 0;
async function loadTick(t, { env = {}, store = fakeStore(), webpush = fakeWebpush() } = {}) {
  const keys = ['VAPID_PRIVATE_KEY', 'PUSH_SEND_KEY'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) { if (k in env) process.env[k] = env[k]; else delete process.env[k]; }
  globalThis.__gaStore = store;
  globalThis.__gaPush = webpush;
  t.after(() => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    delete globalThis.__gaStore;
    delete globalThis.__gaPush;
  });
  const href = (p) => JSON.stringify(pathToFileURL(path.join(FN, p)).href);
  const blobs = dataUrl('export const getStore = () => globalThis.__gaStore;');
  const wp = dataUrl('export default new Proxy({}, { get: (_, k) => globalThis.__gaPush[k] });');
  const subUrl = dataUrl(SUBSCRIBE_SRC
    .replace("from '@netlify/blobs'", `from ${JSON.stringify(blobs)}`)
    .replace("from './_lib/zone-alerts.js'", `from ${href('_lib/zone-alerts.js')}`) + `\n// gov load ${++loads}`);
  const src = TICK_SRC
    .replace("from 'web-push'", `from ${JSON.stringify(wp)}`)
    .replace("from './push-subscribe.mjs'", `from ${JSON.stringify(subUrl)}`)
    .replace("from './_lib/ipaws.js'", `from ${href('_lib/ipaws.js')}`)
    .replace("from './_lib/zone-alerts.js'", `from ${href('_lib/zone-alerts.js')}`)
    .replace("from './gov-alert.js'", `from ${href('gov-alert.js')}`);
  assert.ok(!/from '[.@w]/.test(src), 'imports changed, update this test');
  return { tick: await import(dataUrl(src)), store, webpush };
}

test('tick: the nationwide test reaches every armed device once, even with no watch zones', async (t) => {
  const k = vapid();
  const store = fakeStore({ a: device('https://push/a', k.pub), b: device('https://push/b', k.pub, { national: false }), c: device('https://push/c', k.pub, { quake: false }) });
  const m = await loadTick(t, { env: { VAPID_PRIVATE_KEY: k.priv }, store });
  const fetchImpl = femaStub({ recent: wrap(NPT) }).fetchImpl;

  const first = await m.tick.run({ now: DURING, fetchImpl });
  assert.equal(first.fresh, 1);
  assert.deepEqual(m.webpush.sent.map(s => s.endpoint).sort(), ['https://push/a', 'https://push/c'], 'b turned FEMA alerts off');
  const msg = m.webpush.sent[0];
  assert.equal(msg.title, 'NATIONWIDE TEST · FEMA');
  assert.match(msg.body, /^National Periodic Test · This is a nationwide test/);
  assert.equal(msg.url, '/#govalert');
  assert.equal(msg.severity, 'info', 'a test does not demand interaction');
  assert.equal(msg.urgency, 'normal');
  assert.ok(msg.TTL > 60 && msg.TTL <= 1680, 'push expires with the alert');

  const again = await m.tick.run({ now: DURING + 60e3, fetchImpl });
  assert.equal(again.fresh, 0);
  assert.equal(m.webpush.sent.length, 2, 'one alert is one push, not one a minute');
});

test('tick: the EAS stand-in and the full message are one broadcast, one push', async (t) => {
  const k = vapid();
  const m = await loadTick(t, { env: { VAPID_PRIVATE_KEY: k.priv }, store: fakeStore({ a: device('https://push/a', k.pub) }) });
  const feed = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="text">NPT</title><link href="' + lib.BASE + '/eas/300200000001"/><updated>2023-10-04T18:20:05.000Z</updated><category term="NPT" label="event"/></entry></feed>';
  await m.tick.run({ now: DURING, fetchImpl: femaStub({ feed, fail: ['/public/recent/'] }).fetchImpl });
  await m.tick.run({ now: DURING + 60e3, fetchImpl: femaStub({ recent: wrap(NPT), feed }).fetchImpl });
  assert.equal(m.webpush.sent.length, 1);
});

test('tick: never pages for an old alert, prunes a dead device, skips without a key', async (t) => {
  const k = vapid();
  const store = fakeStore({ a: device('https://push/a', k.pub), gone: device('https://push/gone', k.pub) });
  const webpush = fakeWebpush((ep) => ep === 'https://push/gone' ? 410 : 0);
  const m = await loadTick(t, { env: { VAPID_PRIVATE_KEY: k.priv }, store, webpush });

  const longer = NPT.replace(/<expires>2023-10-04T12:50:03-06:00<\/expires>/g, '<expires>2023-10-04T14:20:03-06:00</expires>');
  const late = await m.tick.run({ now: T_NPT + 46 * 60e3, fetchImpl: femaStub({ recent: wrap(longer) }).fetchImpl });
  assert.equal(late.national, 1);
  assert.equal(late.fresh, 0, 'sent 46 minutes ago: shown on the banner, not pushed');

  const out = await m.tick.run({ now: DURING, fetchImpl: femaStub({ recent: wrap(NPT) }).fetchImpl });
  assert.equal(out.sent, 1);
  assert.equal(out.pruned, 1);
  assert.deepEqual(store.roster(), ['a']);

  const m2 = await loadTick(t, { env: {}, store: fakeStore({ a: device('https://push/a', k.pub) }) });
  assert.equal((await m2.tick.run({ now: DURING, fetchImpl: femaStub({ recent: wrap(NPT) }).fetchImpl })).skipped, 'VAPID_PRIVATE_KEY missing');
});

test('the page loads the banner script and the service worker precaches it', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  const v = (html.match(/js\/bdoc-gov-alert\.js\?v=(\w+)/) || [])[1];
  assert.ok(v, 'index.html loads bdoc-gov-alert.js');
  assert.ok(sw.includes(`'/js/bdoc-gov-alert.js?v=${v}'`), 'precached with the same ?v=');
  assert.ok(html.includes('id="setPushNational"'), 'Settings > Alerts has the FEMA switch');
  const src = fs.readFileSync(path.join(ROOT, 'js', 'bdoc-gov-alert.js'), 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(src), 'feed text never becomes HTML');
});
