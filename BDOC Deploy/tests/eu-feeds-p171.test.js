// p171: European open data — Meteoalarm warnings, Copernicus EMS activations, GWIS fire danger forecast.
// Upstreams are stubbed; these pin the source whitelist, the Atom parsing rules, CEMS times and links, and the wiring.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'netlify', 'functions', 'proxy-eu.js');
const FN_SRC = fs.readFileSync(FN, 'utf8');
const EU_SRC = fs.readFileSync(path.join(ROOT, 'js', 'modules', 'eu-feeds.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function fresh() { delete require.cache[require.resolve(FN)]; return require(FN); }
async function withFetch(reply, fn) {
  const real = global.fetch, calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    const r = reply(String(url), opts) || {};
    const status = r.status || 200, body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body || {});
    return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body), text: async () => body };
  };
  try { return await fn(calls); } finally { global.fetch = real; }
}
const call = (mod, qs) => mod.handler({ httpMethod: 'GET', queryStringParameters: qs, headers: {} });
const body = (r) => JSON.parse(r.body);
const H = 3600e3;
const isoIn = (ms) => new Date(Date.now() + ms).toISOString().replace('.000Z', '+00:00');

function entry({ title, area = 'Area', event = 'wind', expires = isoIn(6 * H), onset = isoIn(-H), type = 'Alert', id = 'id1', poly, emma = 'XX001', link }) {
  return `<entry>${poly ? `<cap:polygon>${poly}</cap:polygon>` : `<cap:geocode><valueName>EMMA_ID</valueName><value>${emma}</value></cap:geocode>`}
    <link title="${area}" href="${link || 'https://meteoalarm.org?geocode=EMMA_ID:' + emma}" hreflang="en"/>
    <cap:areaDesc>${area}</cap:areaDesc><cap:event>${event}</cap:event><cap:expires>${expires}</cap:expires><cap:onset>${onset}</cap:onset>
    <cap:severity>Moderate</cap:severity><cap:message_type>${type}</cap:message_type><cap:status>Actual</cap:status><cap:identifier>${id}</cap:identifier>
    <title>${title}</title></entry>`;
}
const feed = (...entries) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries.join('')}</feed>`;

test('only warnings and cems answer; anything else, prototype names included, is a 400 with no upstream call', async () => {
  const m = fresh();
  await withFetch(() => ({}), async (calls) => {
    for (const s of [undefined, '', 'fwi', 'constructor', '__proto__', 'toString']) {
      assert.strictEqual((await call(m, s === undefined ? {} : { source: s })).statusCode, 400, String(s));
    }
    assert.strictEqual(calls.length, 0);
  });
});

test('Atom parsing: yellow and up only, cancelled / expired / second-language copies dropped, outlines kept and cut down', () => {
  const { parseAtom, COUNTRIES } = fresh()._test;
  assert.strictEqual(Object.keys(COUNTRIES).length, 39);
  const big = Array.from({ length: 300 }, (_, i) => `${(31 + Math.sin(i / 48) * 0.4).toFixed(5)},${(34.5 + Math.cos(i / 48) * 0.4).toFixed(5)}`).join(' ');
  const xml = feed(
    entry({ title: 'Orange Rain-flood Warning issued for France - Gard', area: 'Gard', event: 'Severe rain-flood warning', id: 'a' }),
    entry({ title: 'Orange Rain-flood Warning issued for France - Gard', area: 'Gard', event: 'Alerte pluie', id: 'a' }), // same warning, other language
    entry({ title: 'Yellow Coastalevent Warning issued for Israel - Sea - South', area: 'Sea &amp; Shore &lt;b&gt;', id: 'b', poly: big }),
    entry({ title: 'Green Wind Warning issued for X', id: 'c' }),
    entry({ title: 'Red Thunderstorm Warning issued for X', id: 'd', type: 'Cancel' }),
    entry({ title: 'Red Thunderstorm Warning issued for X', id: 'e', expires: isoIn(-H) }),
    entry({ title: 'Red Thunderstorm Warning issued for X', id: 'f', link: 'javascript:alert(1)' }),
    entry({ title: 'MeteoAlarm', id: 'g' })
  );
  const out = parseAtom(xml, 'france', Date.now());
  assert.deepStrictEqual(out.map(w => [w.level, w.type, w.area]), [[3, 'Rain / flood', 'Gard'], [2, 'Coastal event', 'Sea & Shore <b>'], [4, 'Thunderstorm', 'Area']]);
  assert.ok(out.every(w => w.cc === 'FR'));
  assert.strictEqual(out[0].url, 'https://meteoalarm.org?geocode=EMMA_ID:XX001');
  assert.strictEqual(out[2].url, undefined, 'a non-meteoalarm link is dropped');
  const ring = out[1].poly[0];
  assert.ok(ring.length <= 82 && ring.length >= 4, 'outline cut to about 80 points: ' + ring.length);
  assert.deepStrictEqual(ring[0], ring[ring.length - 1], 'ring closed');
  assert.ok(ring.every(([a, b]) => Math.abs(a - 31) < 1 && Math.abs(b - 34.5) < 1), 'lat,lon order kept');
  assert.ok(out.every(w => /T.*Z$/.test(w.expires)));
});

test('warnings: all 39 feeds read in parallel; a country that fails is named, not silently counted as calm', async () => {
  const m = fresh();
  await withFetch((url) => {
    if (url.endsWith('-germany')) return { body: feed(entry({ title: 'Yellow Low-temperature Warning issued for Germany - Heilbronn', area: 'Heilbronn' })) };
    if (url.endsWith('-israel')) return { status: 503 };
    return { body: feed() };
  }, async (calls) => {
    const r = await call(m, { source: 'warnings' });
    assert.strictEqual(r.statusCode, 200);
    const j = body(r);
    assert.strictEqual(calls.length, 39);
    assert.ok(calls.every(c => /^https:\/\/feeds\.meteoalarm\.org\/feeds\/meteoalarm-legacy-atom-[a-z-]+$/.test(c.url)));
    assert.deepStrictEqual(j.failed, ['Israel']);
    const de = j.countries.find(c => c.cc === 'DE'), il = j.countries.find(c => c.cc === 'IL');
    assert.deepStrictEqual([de.ok, de.count, de.max], [true, 1, 2]);
    assert.deepStrictEqual([il.ok, il.count], [false, 0]);
    assert.strictEqual(j.warnings[0].type, 'Low temperature');
    assert.match(r.headers['Netlify-CDN-Cache-Control'], /s-maxage=\d+/);
  });
  const m2 = fresh();
  await withFetch(() => ({ status: 500 }), async () => {
    const r = await call(m2, { source: 'warnings' });
    assert.strictEqual(r.statusCode, 502, 'every feed down is an error, not "no warnings"');
  });
});

test('cems: zone-less times are UTC, 120-day window plus open ones, codes and centroids validated', async () => {
  const day = 864e5, t = (ms) => new Date(Date.now() - ms).toISOString().slice(0, 19); // no zone, like CEMS
  const results = [
    { code: 'EMSR935', name: 'Flood in Valencia', countries: ['Spain'], category: 'Flood', centroid: 'POINT (0.023 38.816)', eventTime: '2026-10-19T03:10:00', activationTime: t(10 * day), lastUpdate: t(2 * day), closed: true, n_aois: 2, n_products: 2 },
    { code: 'EMSR900', name: 'Old closed', centroid: 'POINT (1 1)', activationTime: t(200 * day), closed: true },
    { code: 'EMSR899', name: 'Old but still open', centroid: 'POINT (2 2)', activationTime: t(200 * day), closed: false },
    { code: '<script>', name: 'bad code', centroid: 'POINT (3 3)', activationTime: t(day), closed: false },
    { code: 'EMSR898', name: 'bad centroid', centroid: 'POLYGON ((1 1, 2 2))', activationTime: t(day), closed: false }
  ];
  const m = fresh();
  await withFetch(() => ({ body: { count: 268, results } }), async (calls) => {
    const j = body(await call(m, { source: 'cems' }));
    assert.match(calls[0].url, /^https:\/\/rapidmapping\.emergency\.copernicus\.eu\/backend\/dashboard-api\/public-activations-info\/\?limit=\d+/);
    assert.deepStrictEqual(j.activations.map(a => a.code), ['EMSR935', 'EMSR899']);
    const a = j.activations[0];
    assert.strictEqual(a.eventTime, '2026-10-19T03:10:00.000Z', 'read as UTC whatever the server clock zone');
    assert.deepStrictEqual([a.lat, a.lon, a.aois, a.products, a.total], [38.816, 0.023, 2, 2, undefined]);
    assert.strictEqual(j.total, 268);
  });
});

test('fire danger: seven UTC days starting today, and the WMS layer is the GWIS one with picking off', () => {
  const ctx = { window: {}, console };
  vm.runInNewContext(EU_SRC, ctx, { filename: 'eu-feeds.js' });
  const days = ctx.window.EUFeeds.fireDanger.days();
  assert.strictEqual(days.length, 7);
  assert.strictEqual(days[0].label, 'Today');
  assert.strictEqual(days[0].date, new Date().toISOString().slice(0, 10));
  for (let i = 1; i < 7; i++) assert.strictEqual(Date.parse(days[i].date) - Date.parse(days[i - 1].date), 864e5);
  assert.strictEqual(ctx.EU_FEEDS_CFG.fwiUrl, 'https://maps.effis.emergency.copernicus.eu/gwis');
  assert.strictEqual(ctx.EU_FEEDS_CFG.fwiLayer, 'ecmwf.fwi');
  assert.match(EU_SRC, /enablePickFeatures: false/, 'clicks on the map must not fire WMS GetFeatureInfo');
  assert.match(EU_SRC, /request=GetLegendGraphic/, 'the legend is GWIS\'s own image, not hand-picked colours');
});

test('index.html wires the three toggles to one lazy module, and the module stays inside its lane', () => {
  for (const ly of ['euwarn', 'cems', 'firedanger']) assert.match(HTML, new RegExp(`<div class="ly" data-layer="${ly}" onclick="togLy\\(this\\)">`));
  assert.match(HTML, /const layers=\{[^}]*signals:false,euwarn:false,cems:false,firedanger:false/);
  assert.match(HTML, /\{euwarn:'warnings',cems:'cems',firedanger:'fireDanger'\}\[ly\][^\n]*LazyLoader\.load\('eu-feeds'\)[^\n]*window\.EUFeeds\[EU\]\.stop\(\)/);
  assert.deepStrictEqual([...EU_SRC.matchAll(/fetch\('([^'?]+)/g)].map(x => x[1]), ['/.netlify/functions/proxy-eu']);
  assert.doesNotMatch(EU_SRC, /onclick=/i);
  for (const a of EU_SRC.match(/<a href=[^>]+>/g)) {
    assert.match(a, /href="\$\{safeUrl\(/, 'every link goes through safeUrl: ' + a);
    assert.match(a, /rel="noopener noreferrer"/, a);
  }
  // af() renders into innerHTML unescaped: every call passes escaped text
  for (const m of EU_SRC.matchAll(/\baf\(([^;]+)\);/g)) assert.match(m[1], /,\s*(?:'[^']*'\s*\+\s*)?esc\(/, 'af text escaped: ' + m[1]);
  assert.doesNotMatch(FN_SRC, /\beval\s*\(|new\s+Function|Function\s*\(|require\(['"]vm['"]\)/);
});

test('eu-feeds.js declares no top-level name that index.html or another script already declares', () => {
  const top = (src) => [...src.matchAll(/^(?:var|let|const|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  const others = [HTML].concat(fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')))
    .concat(fs.readdirSync(path.join(ROOT, 'js', 'modules')).filter(f => f.endsWith('.js') && f !== 'eu-feeds.js').map(f => fs.readFileSync(path.join(ROOT, 'js', 'modules', f), 'utf8')));
  const taken = new Set(others.flatMap(top).concat(others.flatMap(s => [...s.matchAll(/(?:^|[\s;{}])(?:let|const|class|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]))));
  const mine = top(EU_SRC);
  assert.deepStrictEqual(mine.sort(), ['EUFeeds', 'EU_FEEDS_CFG']);
  assert.deepStrictEqual(mine.filter(n => taken.has(n)), []);
});

test('desktop app, sources page and versions keep up', () => {
  const srv = fs.readFileSync(path.join(ROOT, 'electron', 'server.js'), 'utf8');
  assert.ok(/for \(const fn of \[[^\]]*'proxy-eu'[^\]]*\]\)/.test(srv));
  assert.ok(srv.indexOf("'proxy-eu'") < srv.indexOf("app.all('/.netlify/functions/*'"));
  const s = fs.readFileSync(path.join(ROOT, 'sources.html'), 'utf8');
  assert.match(s, /meteoalarm\.org[\s\S]{0,300}CC BY 4\.0/);
  assert.match(s, /Copernicus Emergency Management Service/);
  assert.match(s, /gwis\.jrc\.ec\.europa\.eu/);
  assert.match(fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8'), /const SW_VERSION = 'bdoc-v173'/);
});
