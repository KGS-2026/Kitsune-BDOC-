// p168: county brief for emergency managers. The rules were checked against live feeds on
// 5 Nov 2026 (Hillsborough FL ELEVATED on the Alafia River at action stage, Seminole FL SEVERE
// on a Flood Warning for the St. Johns River, Norton KS NORMAL, London: no county).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const LIB_PATH = path.join(ROOT, 'netlify', 'functions', '_lib', 'county-brief.js');
const lib = require(LIB_PATH);
const FN_SRC = fs.readFileSync(path.join(ROOT, 'netlify', 'functions', 'county-brief.mjs'), 'utf8');
const CLIENT_SRC = fs.readFileSync(path.join(ROOT, 'js', 'modules', 'county-brief.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const NOW = Date.UTC(2026, 10, 5, 15, 0);
const iso = (ms) => new Date(ms).toISOString();

// A square "Hillsborough County" with a lake cut out of it, as TIGERweb returns it (outSR 4326).
const SQUARE = [[-82.6, 27.6], [-82.0, 27.6], [-82.0, 28.2], [-82.6, 28.2], [-82.6, 27.6]];
const LAKE = [[-82.35, 27.85], [-82.25, 27.85], [-82.25, 27.95], [-82.35, 27.95], [-82.35, 27.85]];
const TIGER_FEATURE = { attributes: { GEOID: '12057', NAME: 'Hillsborough County', BASENAME: 'Hillsborough', CENTLAT: '+27.9000', CENTLON: '-082.3000' }, geometry: { rings: [SQUARE, LAKE] } };
const county = lib.countyFrom(TIGER_FEATURE);

test('the county comes from TIGERweb: name, state, FIPS, centre, box and NWS zone', () => {
  assert.strictEqual(county.name, 'Hillsborough County');
  assert.strictEqual(county.state, 'FL');
  assert.strictEqual(county.geoid, '12057');
  assert.strictEqual(county.lat, 27.9);
  assert.strictEqual(county.lon, -82.3);
  assert.deepStrictEqual(county.bbox, [-82.6, 27.6, -82, 28.2]);
  assert.strictEqual(lib.nwsZone(county), 'FLC057');
});

test('no county for open ocean, a foreign answer or a broken feature', () => {
  assert.strictEqual(lib.countyFrom(undefined), null);
  assert.strictEqual(lib.countyFrom({ attributes: { GEOID: '12057' }, geometry: { rings: [] } }), null);
  assert.strictEqual(lib.countyFrom({ attributes: { GEOID: 'abc' }, geometry: { rings: [SQUARE] } }), null);
  assert.strictEqual(lib.countyFrom({ attributes: { GEOID: '99001' }, geometry: { rings: [SQUARE] } }), null, 'unknown state FIPS');
});

test('inside the county means inside the line, not just the box, and lakes are holes', () => {
  assert.ok(lib.inCounty(county, 27.7, -82.5));
  assert.ok(!lib.inCounty(county, 27.9, -82.3), 'in the lake');
  assert.ok(!lib.inCounty(county, 28.5, -82.3), 'north of the county');
});

test('alerts: real ones only, an update chain shown once, expired and cancelled dropped, worst first', () => {
  const f = (p) => ({ properties: { status: 'Actual', messageType: 'Alert', ends: iso(NOW + 3600e3), ...p } });
  const geo = { features: [
    f({ id: 'a1', event: 'Flood Advisory', severity: 'Minor', headline: 'Flood Advisory issued by NWS Tampa Bay' }),
    f({ id: 'w2', event: 'Flood Warning', severity: 'Severe', references: [{ identifier: 'w1' }], headline: 'Flood Warning issued…', parameters: { NWSheadline: ['FLOOD WARNING REMAINS IN EFFECT FOR THE ALAFIA RIVER'] } }),
    f({ id: 'w3', event: 'Flood Warning', severity: 'Severe', references: [{ identifier: 'w1' }] }),   // same chain
    f({ id: 't1', event: 'Test Message', status: 'Test' }),
    f({ id: 'c1', event: 'Flood Warning', messageType: 'Cancel' }),
    f({ id: 'x1', event: 'Heat Advisory', severity: 'Moderate', ends: iso(NOW - 60e3) })
  ] };
  const out = lib.alertsOf(geo, NOW);
  assert.deepStrictEqual(out.map(a => a.event), ['Flood Warning', 'Flood Advisory']);
  assert.strictEqual(out[0].headline, 'FLOOD WARNING REMAINS IN EFFECT FOR THE ALAFIA RIVER', 'NWSheadline names the river');
  assert.deepStrictEqual(lib.alertsOf(null, NOW), []);
});

// The real wording of an NWS Tampa Bay river warning, 5 Nov 2026 (one message, four rivers, three counties).
const MULTI_RIVER = '...The Flood Warning is extended for the following rivers in\nFlorida...\n\nPeace River At Zolfo Springs at SR 17 affecting Hardee County.\n\n' +
  '...The Flood Warning continues for the following rivers in Florida...\n\nHorse Creek Near Arcadia at SR 72 affecting DeSoto County.\n\n' +
  'Alafia River At Lithia affecting Hillsborough County.\n\nPeace River At Arcadia at SR 70 affecting DeSoto County.\n\n' +
  '.Recent heavy rain across portions of west central Florida has\nresulted in several rivers across the region remaining in flood stage.\n\n* WHAT...Minor flooding is occurring.';

test('river warnings name this county\'s river, not the neighbours\' in the same message', () => {
  assert.deepStrictEqual(lib.riversOf(MULTI_RIVER, county), ['Alafia River At Lithia']);
  assert.deepStrictEqual(lib.riversOf(MULTI_RIVER, { basename: 'DeSoto' }), ['Horse Creek Near Arcadia at SR 72', 'Peace River At Arcadia at SR 70']);
  // A line the forecaster wrapped still counts.
  assert.deepStrictEqual(lib.riversOf('...continues...\n\nSt Johns River Near Astor affecting Lake and\nVolusia Counties.\n', { basename: 'Volusia' }), ['St Johns River Near Astor']);
  // No county named: list what the message lists. Not a river warning: nothing.
  assert.strictEqual(lib.riversOf(MULTI_RIVER, { basename: 'Pinellas' }).length, 3);
  assert.deepStrictEqual(lib.riversOf('* WHAT...Winds 40 mph.', county), []);
  assert.strictEqual(county.basename, 'Hillsborough');
});

test('a river warning with no end says so, instead of showing when the message is reissued', () => {
  const geo = { features: [{ properties: { status: 'Actual', event: 'Flood Warning', severity: 'Severe', ends: null, expires: iso(NOW + 8 * 3600e3),
    description: MULTI_RIVER, parameters: { NWSheadline: ['FLOOD WARNING REMAINS IN EFFECT UNTIL FURTHER NOTICE'] } } }] };
  const [a] = lib.alertsOf(geo, NOW, county);
  assert.strictEqual(a.ends, null, 'expires is not an end time');
  assert.strictEqual(a.where, 'Alafia River At Lithia');
  const b = { county, alerts: [a], gauges: { reporting: 1, flooding: [] }, storms: [], quakes: [], fires: { count: 0, maxFrp: 0 }, shelters: [], forecast: [] };
  b.level = lib.levelOf(b);
  assert.deepStrictEqual(b.level.reasons, ['Flood Warning: Alafia River At Lithia']);
  assert.ok(lib.sitrep(b, NOW).includes('   - Flood Warning, Alafia River At Lithia [Severe]: FLOOD WARNING REMAINS IN EFFECT UNTIL FURTHER NOTICE'));
  // Still dropped once the message itself has lapsed without a reissue.
  assert.deepStrictEqual(lib.alertsOf(geo, NOW + 9 * 3600e3, county), []);
});

test('river gauges: action stage and up are listed, observed or forecast, inside the county only', () => {
  const g = (lid, lat, lon, obs, fc, primary = 10) => ({ lid, name: lid + ' River', latitude: lat, longitude: lon, status: { observed: { floodCategory: obs, primary, primaryUnit: 'ft' }, forecast: { floodCategory: fc } } });
  const out = lib.gaugesOf({ gauges: [
    g('ALAF1', 27.86, -82.2, 'action', 'no_flooding', 12.4),
    g('HILL1', 28.1, -82.5, 'no_flooding', 'moderate'),
    g('OKAY1', 27.7, -82.4, 'no_flooding', 'no_flooding'),
    g('LAKE1', 27.9, -82.3, 'major', 'major'),                // in the lake hole
    g('AWAY1', 30.0, -82.3, 'major', 'major'),                // outside
    g('DEAD1', 27.7, -82.1, 'not_defined', '', -999)          // reports nothing usable
  ] }, county);
  assert.strictEqual(out.reporting, 3);
  assert.deepStrictEqual(out.flooding.map(x => [x.lid, x.rank]), [['HILL1', 3], ['ALAF1', 1]]);
  assert.strictEqual(out.flooding[1].stage, 12.4);
  assert.strictEqual(out.flooding[0].forecast, 'moderate');
});

test('quakes: last 24 hours inside the county, biggest first', () => {
  const q = (mag, lat, lon, ageH) => ({ geometry: { coordinates: [lon, lat, 5] }, properties: { mag, place: 'near Tampa', time: NOW - ageH * 3600e3 } });
  const out = lib.quakesOf({ features: [q(2.6, 27.7, -82.5, 2), q(3.9, 28.1, -82.1, 5), q(4.5, 27.7, -82.5, 30), q(5.1, 35, -118, 1)] }, county, NOW);
  assert.deepStrictEqual(out.map(x => x.mag), [3.9, 2.6]);
});

test('fires: FIRMS CSV counted inside the county; an error body is "not available", not "no fires"', () => {
  const csv = 'latitude,longitude,bright_ti4,frp\n27.7,-82.5,330,12.5\n28.1,-82.1,340,41.2\n29.5,-82.3,350,300\n';
  assert.deepStrictEqual(lib.firesOf(csv, county), { count: 2, maxFrp: 41 });
  assert.strictEqual(lib.firesOf('{"error":"Invalid MAP_KEY"}', county), null);
  assert.strictEqual(lib.firesOf('', county), null);
  assert.deepStrictEqual(lib.firesOf('latitude,longitude,frp\n', county), { count: 0, maxFrp: 0 });
});

test('storms: within 1,500 km of the county centre, nearest first, advisory link only if https', () => {
  const s = (name, lat, lon, url) => ({ name, classification: 'HU', intensity: '85', latitudeNumeric: lat, longitudeNumeric: lon, movementDir: 315, movementSpeed: 12, publicAdvisory: { url } });
  const out = lib.stormsNear({ activeStorms: [s('Far', 10, -40, 'https://nhc.noaa.gov/a'), s('Near', 26.5, -84, 'javascript:alert(1)'), s('Mid', 22, -80, 'https://nhc.noaa.gov/b')] }, county);
  assert.deepStrictEqual(out.map(x => x.name), ['Near', 'Mid']);
  assert.strictEqual(out[0].advisory, null);
  assert.strictEqual(out[1].advisory, 'https://nhc.noaa.gov/b');
  assert.strictEqual(out[0].intensityKt, 85);
  assert.match(out[0].movement, /315° at 12 mph/);
});

test('shelters: open FEMA shelters inside the county', () => {
  const sh = (name, lat, lon, extra = {}) => ({ attributes: { shelter_name: name, city: 'Tampa', latitude: lat, longitude: lon, shelter_status: 'OPEN', evacuation_capacity: 400, total_population: 120, pet_accommodations_code: 'PETS ALLOWED', ada_compliant: 'YES', ...extra } });
  const out = lib.sheltersOf({ features: [sh('Middle School', 27.7, -82.5), sh('Across the line', 29.5, -82.3)] }, county);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual([out[0].name, out[0].capacity, out[0].population, out[0].pets, out[0].ada], ['Middle School', 400, 120, true, true]);
});

test('level: one word with its reasons', () => {
  const base = { alerts: [], gauges: { reporting: 4, flooding: [] }, storms: [], quakes: [], fires: { count: 0, maxFrp: 0 }, shelters: [] };
  assert.deepStrictEqual(lib.levelOf(base), { level: 'NORMAL', reasons: [] });
  assert.strictEqual(lib.levelOf({ ...base, alerts: [{ event: 'Flood Warning', severity: 'Severe' }] }).level, 'SEVERE');
  assert.strictEqual(lib.levelOf({ ...base, alerts: [{ event: 'Wind Advisory', severity: 'Moderate' }] }).level, 'ELEVATED');
  const action = lib.levelOf({ ...base, gauges: { reporting: 4, flooding: [{ name: 'Alafia River', rank: 1 }] } });
  assert.deepStrictEqual(action, { level: 'ELEVATED', reasons: ['Alafia River: action stage'] });
  assert.strictEqual(lib.levelOf({ ...base, gauges: { reporting: 4, flooding: [{ name: 'St. Johns', rank: 3 }] } }).level, 'SEVERE');
  assert.strictEqual(lib.levelOf({ ...base, storms: [{ name: 'Milton', distanceKm: 250 }] }).level, 'SEVERE');
  assert.strictEqual(lib.levelOf({ ...base, storms: [{ name: 'Milton', distanceKm: 900 }] }).level, 'ELEVATED');
  assert.strictEqual(lib.levelOf({ ...base, storms: [{ name: 'Milton', distanceKm: 1400 }] }).level, 'NORMAL', 'listed, not raised');
  assert.strictEqual(lib.levelOf({ ...base, fires: { count: 1, maxFrp: 6 } }).level, 'NORMAL', 'one small detection is usually a farm or a flare');
  assert.strictEqual(lib.levelOf({ ...base, fires: { count: 30, maxFrp: 60 } }).level, 'SEVERE');
  assert.strictEqual(lib.levelOf({ ...base, quakes: [{ mag: 5.2 }] }).level, 'SEVERE');
  assert.strictEqual(lib.levelOf({ ...base, shelters: [{ name: 'School' }] }).level, 'ELEVATED');
  // Missing sources never raise or lower anything on their own.
  assert.strictEqual(lib.levelOf({ alerts: undefined, gauges: undefined, storms: undefined, quakes: undefined, fires: undefined, shelters: undefined }).level, 'NORMAL');
});

test('SITREP: numbered sections, missing sources say so, never "none"', () => {
  const b = { county, alerts: [], gauges: undefined, storms: [], quakes: [], fires: { count: 0, maxFrp: 0 }, shelters: [], forecast: [{ name: 'Tonight', short: 'Clear', temp: 64, unit: 'F', wind: '5 mph N' }] };
  b.level = lib.levelOf(b);
  const L = lib.sitrep(b, NOW);
  assert.strictEqual(L[0], 'SITREP: Hillsborough County, FL (FIPS 12057)');
  assert.match(L[1], /As of 2026-11-05 15:00Z · Overall: NORMAL/);
  const text = L.join('\n');
  assert.match(text, /1\. WEATHER WARNINGS \(NWS\)\n {3}None in effect\./);
  assert.match(text, /2\. RIVERS \(NOAA gauges\)\n {3}Not available\./);
  assert.match(text, /4\. FIRE \(NASA FIRMS, 24 h\)\n {3}No detections\./);
  assert.match(text, /Tonight: Clear, 64°F, wind 5 mph N/);
  assert.match(L[L.length - 1], /Verify before acting\.$/);
});

// ---- the function, with the network faked ----
const dataUrl = (src) => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
async function loadFn() {
  const code = FN_SRC.replace("from './_lib/county-brief.js'", `from ${JSON.stringify(pathToFileURL(LIB_PATH).href)}`);
  assert.ok(!/from '[.@]/.test(code), 'imports changed, update this test');
  return import(dataUrl(code));
}
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
function net(t, routes) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    for (const [re, fn] of routes) if (re.test(url)) return fn(url);
    throw new Error('unexpected ' + url);
  };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}
const FEEDS = [
  [/tigerweb\.geo\.census\.gov/, () => reply(200, { features: [TIGER_FEATURE] })],
  [/api\.weather\.gov\/alerts\/active\?zone=FLC057$/, () => reply(200, { features: [{ properties: { status: 'Actual', event: 'Flood Warning', severity: 'Severe', ends: iso(NOW + 3600e3) } }] })],
  [/api\.weather\.gov\/points\/27\.9000,-82\.3000$/, () => reply(200, { properties: { forecast: 'https://api.weather.gov/gridpoints/TBW/70,98/forecast' } })],
  [/gridpoints\/TBW/, () => reply(200, { properties: { periods: [{ name: 'Tonight', temperature: 64, temperatureUnit: 'F', windSpeed: '5 mph', windDirection: 'N', shortForecast: 'Clear' }] } })],
  [/api\.water\.noaa\.gov\/nwps\/v1\/gauges\?bbox\.xmin=-82\.6&bbox\.ymin=27\.6&bbox\.xmax=-82&bbox\.ymax=28\.2/, () => reply(200, { gauges: [] })],
  [/earthquake\.usgs\.gov/, () => reply(200, { features: [] })],
  [/^https:\/\/site\.test\/\.netlify\/functions\/proxy-firms\?mode=area&area=-82\.6,27\.6,-82,28\.2&days=1$/, () => reply(200, 'latitude,longitude,frp\n')],
  [/nhc\.noaa\.gov\/CurrentStorms\.json/, () => reply(200, { activeStorms: [] })],
  [/gis\.fema\.gov/, () => reply(200, { features: [] })]
];

test('brief() frames every feed to the county and records each source', async (t) => {
  const fn = await loadFn();
  const calls = net(t, FEEDS);
  const b = await fn.brief({ lat: 27.7, lon: -82.5, now: NOW, site: 'https://site.test' });
  assert.strictEqual(calls.length, 9, 'TIGER, alerts, points, forecast and the six other feeds');
  assert.ok(Object.values(b.sources).every(v => v === 'ok'), JSON.stringify(b.sources));
  assert.strictEqual(Object.keys(b.sources).length, 7);
  assert.strictEqual(b.level.level, 'SEVERE');
  assert.deepStrictEqual(b.level.reasons, ['Flood Warning']);
  assert.strictEqual(b.forecast[0].short, 'Clear');
  assert.strictEqual(b.asOf, iso(NOW));
  assert.ok(Array.isArray(b.sitrep) && b.sitrep[0].startsWith('SITREP: Hillsborough County, FL'));
});

test('a feed that fails is reported as failed and "Not available", and the rest still arrive', async (t) => {
  const fn = await loadFn();
  net(t, FEEDS.map(([re, f]) => [re, /nwps|fema/.test(re.source) ? () => reply(503, 'down') : f]));
  const b = await fn.brief({ lat: 27.7, lon: -82.5, now: NOW, site: 'https://site.test' });
  assert.strictEqual(b.sources.nwps_gauges, 'failed');
  assert.strictEqual(b.sources.fema_shelters, 'failed');
  assert.strictEqual(b.sources.nws_alerts, 'ok');
  assert.strictEqual(b.gauges, undefined);
  assert.match(b.sitrep.join('\n'), /2\. RIVERS \(NOAA gauges\)\n {3}Not available\./);
  assert.match(b.sitrep.join('\n'), /6\. SHELTERS \(FEMA open shelters\)\n {3}Not available\./);
});

test('FIRMS answering with an error body counts as failed, not as "no fires"', async (t) => {
  const fn = await loadFn();
  net(t, FEEDS.map(([re, f]) => [re, /proxy-firms/.test(re.source) ? () => reply(200, '{"error":"rate limited"}') : f]));
  const b = await fn.brief({ lat: 27.7, lon: -82.5, now: NOW, site: 'https://site.test' });
  assert.strictEqual(b.sources.nasa_firms, 'failed');
  assert.strictEqual(b.fires, undefined);
});

test('the endpoint: 400 without a spot, 404 outside the U.S., 200 cached briefly', async (t) => {
  const fn = await loadFn();
  const r400 = await fn.default(new Request('https://x.test/.netlify/functions/county-brief?lat=abc&lon=1'));
  assert.strictEqual(r400.status, 400);
  const rMissing = await fn.default(new Request('https://x.test/.netlify/functions/county-brief?lat=27'));
  assert.strictEqual(rMissing.status, 400);

  net(t, [[/tigerweb/, () => reply(200, { features: [] })]]);
  const r404 = await fn.default(new Request('https://x.test/.netlify/functions/county-brief?lat=51.5&lon=-0.12'));
  assert.strictEqual(r404.status, 404);
  assert.match((await r404.json()).error, /No U\.S\. county here/);
});

test('the endpoint rounds the spot so nearby clicks share the CDN cache', async (t) => {
  const fn = await loadFn();
  // The handler uses the site's own URL for proxy-firms, so match it on any host here.
  const calls = net(t, FEEDS.concat([[/\/\.netlify\/functions\/proxy-firms\?/, () => reply(200, 'latitude,longitude,frp\n')]]));
  const r = await fn.default(new Request('https://x.test/.netlify/functions/county-brief?lat=27.70049&lon=-82.50012'));
  assert.strictEqual(r.status, 200);
  assert.match(calls[0], /geometry=-82\.5,27\.7&/);
  assert.match(r.headers.get('Netlify-CDN-Cache-Control'), /max-age=120/);
  assert.strictEqual(r.headers.get('Netlify-Vary'), 'query');
});

test('the function holds no key (the repo is public): FIRMS goes through proxy-firms', () => {
  assert.doesNotMatch(FN_SRC, /MAP_KEY|api_key|apikey|process\.env\.(?!URL\b)/i);
  assert.match(FN_SRC, /\/\.netlify\/functions\/proxy-firms\?mode=area/);
});

// ---- the app ----
test('County Brief is on the map menu, the Tools menu and under NEAR ME', () => {
  assert.match(HTML, /class="ctx-item" onclick="ctxAction\('countybrief'\)"/);
  assert.match(HTML, /class="menu-drop-item" onclick="ctxAction\('countybrief'\);closeMenus\(\)"/);
  assert.match(HTML, /onclick="bdocMyCounty\(\)"/);
  assert.match(HTML, /case 'countybrief':[\s\S]{0,120}bdocCountyBrief\(lat,lon\)/);
  assert.match(HTML, /countybrief:'COUNTY BRIEF: pick a spot in the county'/, 'menus with no spot arm a map pick');
  assert.match(HTML, /LazyLoader\.load\('county-brief'\)\.then\(\(\)=>window\.openCountyBrief\(lat,lon\)\)/);
});

// Run the real client module in a sandbox with just enough browser and Cesium to draw.
function clientSandbox(fetchBody, status = 200) {
  const vm = require('vm');
  const html = { panel: null, entities: [], toasts: [] };
  const el = () => ({ style: {}, setAttribute() {}, querySelector: () => ({}), querySelectorAll: () => [], innerHTML: '' });
  const Color = { fromCssColorString: () => ({ withAlpha() { return this; } }), BLACK: {} };
  class CustomDataSource { constructor() { this.entities = { add: (e) => { html.entities.push(e); return e; } }; } }
  const ctx = {
    window: { innerWidth: 1200 }, navigator: { onLine: true },
    document: { createElement: () => (html.panel = el()), body: { appendChild() {} } },
    esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    af: (c, m) => html.toasts.push(m), setTimeout, clearTimeout, AbortController, console,
    fetch: async () => ({ status, ok: status === 200, json: async () => fetchBody }),
    V: { dataSources: { add() {}, remove() {} }, scene: { requestRender() {} }, camera: { flyTo() {} } },
    Cesium: { CustomDataSource, Color, Cartesian3: { fromDegrees: () => ({}), fromDegreesArray: () => [] }, Cartesian2: function () {}, DistanceDisplayCondition: function () {},
      Rectangle: { fromDegrees: () => ({}) }, HeightReference: {}, LabelStyle: {} },
    BDOC: { LazyLoader: { load: async () => true } }
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(CLIENT_SRC.replace(/window\./g, 'window.'), ctx);
  return { open: (lat, lon) => ctx.window.openCountyBrief(lat, lon), html };
}

test('the panel and globe escape everything the feeds say', async () => {
  const X = '<img src=x onerror=alert(1)>';
  const b = {
    county: { ...county, name: X }, asOf: iso(NOW),
    alerts: [{ event: X, severity: 'Severe', headline: X, ends: iso(NOW + 3600e3) }],
    gauges: { reporting: 1, flooding: [{ lid: X, name: X, lat: 27.7, lon: -82.5, stage: 3, unit: X, observed: 'action', forecast: X, rank: 1 }] },
    storms: [{ name: X, classification: X, distanceKm: 200, intensityKt: 80, movement: X, advisory: 'https://nhc.noaa.gov/"><script>' }],
    fires: { count: 2, maxFrp: 30 }, quakes: [{ mag: 4, place: X, lat: 27.7, lon: -82.5 }],
    shelters: [{ name: X, city: X, status: X, lat: 27.7, lon: -82.5, capacity: 10, population: X, pets: true, ada: false }],
    forecast: [{ name: X, short: X, temp: 60, unit: X, wind: X }],
    sources: { nws_alerts: 'ok', nwps_gauges: 'ok', nhc_storms: 'ok', nasa_firms: 'ok', usgs_quakes: 'ok', fema_shelters: 'ok', nws_forecast: 'ok' },
    level: { level: 'SEVERE', reasons: [X] }, sitrep: [X]
  };
  const sb = clientSandbox(b);
  await sb.open(27.7, -82.5);
  const panel = sb.html.panel.innerHTML;
  assert.match(panel, /&lt;img src=x onerror=alert\(1\)&gt;/, 'the hostile text is shown, as text');
  assert.doesNotMatch(panel, /<img|<script/i);
  assert.ok(sb.html.entities.length >= 4, 'county line plus gauge, shelter and quake markers');
  for (const e of sb.html.entities) if (e.description) assert.doesNotMatch(e.description, /<img|<script/i);
});

test('a failed source is shown as not available, never as all clear', async () => {
  const b = { county, asOf: iso(NOW), alerts: undefined, gauges: { reporting: 2, flooding: [] }, storms: [], fires: undefined, quakes: [], shelters: [], forecast: [],
    sources: { nws_alerts: 'failed', nwps_gauges: 'ok', nhc_storms: 'ok', nasa_firms: 'failed', usgs_quakes: 'ok', fema_shelters: 'ok', nws_forecast: 'failed' },
    level: { level: 'NORMAL', reasons: [] }, sitrep: [] };
  const sb = clientSandbox(b);
  await sb.open(27.7, -82.5);
  const panel = sb.html.panel.innerHTML;
  assert.strictEqual((panel.match(/Not available right now/g) || []).length, 3, 'warnings, fire and forecast');
  assert.doesNotMatch(panel, /No NWS warnings/, 'a failed warnings feed must not read as "no warnings"');
  assert.match(panel, /3 sources did not answer \(NWS warnings, NASA fire detections, NWS forecast\)/);
  // 5 Nov, live: a slow NOAA gauge feed made Hillsborough read NORMAL, "nothing active".
  assert.doesNotMatch(panel, /Nothing active in the feeds BDOC checks/);
  assert.match(panel, /Nothing active in the feeds that answered\./);
  assert.match(panel, /<b>Not checked:<\/b> NWS warnings, NASA fire detections, NWS forecast\. The level may be higher\./);
});

test('the level badge: plain NORMAL when every feed answered, no "may be higher" when already SEVERE', async () => {
  const all = { nws_alerts: 'ok', nwps_gauges: 'ok', nhc_storms: 'ok', nasa_firms: 'ok', usgs_quakes: 'ok', fema_shelters: 'ok', nws_forecast: 'ok' };
  const base = { county, asOf: iso(NOW), alerts: [], gauges: { reporting: 2, flooding: [] }, storms: [], fires: { count: 0, maxFrp: 0 }, quakes: [], shelters: [], forecast: [], sitrep: [] };
  let sb = clientSandbox({ ...base, sources: all, level: { level: 'NORMAL', reasons: [] } });
  await sb.open(27.7, -82.5);
  assert.match(sb.html.panel.innerHTML, /Nothing active in the feeds BDOC checks\./);
  assert.doesNotMatch(sb.html.panel.innerHTML, /Not checked/);
  sb = clientSandbox({ ...base, gauges: undefined, sources: { ...all, nwps_gauges: 'failed' }, level: { level: 'SEVERE', reasons: ['Flood Warning'] } });
  await sb.open(27.7, -82.5);
  assert.match(sb.html.panel.innerHTML, /<b>Not checked:<\/b> river gauges\.<\/div>/);
  assert.doesNotMatch(sb.html.panel.innerHTML, /may be higher/);
});

test('SITREP says which feeds were not checked and that the level may be higher', () => {
  const b = { county, alerts: [], gauges: undefined, storms: [], quakes: [], fires: { count: 0, maxFrp: 0 }, shelters: [], forecast: [],
    sources: { nws_alerts: 'ok', nwps_gauges: 'failed', nhc_storms: 'ok', nasa_firms: 'ok', usgs_quakes: 'ok', fema_shelters: 'ok', nws_forecast: 'ok' } };
  b.level = lib.levelOf(b);
  assert.strictEqual(lib.sitrep(b, NOW)[2], 'NOT CHECKED: river gauges did not answer, so the level may be higher.');
  b.sources.nwps_gauges = 'ok';
  assert.strictEqual(lib.sitrep(b, NOW)[2], '', 'no line when everything answered');
  b.sources.fema_shelters = 'failed';
  b.level = { level: 'SEVERE', reasons: ['Flood Warning'] };
  assert.strictEqual(lib.sitrep(b, NOW)[2], 'NOT CHECKED: FEMA shelters did not answer.');
  // The panel uses the same words.
  for (const [k, v] of Object.entries(lib.SOURCE_NAMES)) assert.ok(CLIENT_SRC.includes(k + ": '" + v + "'"), 'client names ' + k + ' as ' + v);
});

test('floating panels open under the top-bar menus and the map menu on desktop', () => {
  // 5 Nov 2026: at z-index 900 the GPS and incident panels hid the Tools menu and the
  // right-click menu wherever they overlapped.
  const css = fs.readFileSync(path.join(ROOT, 'css', 'bdoc.css'), 'utf8');
  const z = (re) => Number((css.match(re) || [])[1]);
  const menus = Math.min(z(/\.tb\{[^}]*z-index:(\d+)/), z(/#battle-ctx\{[^}]*z-index:(\d+)/));
  assert.ok(menus >= 100, 'found the menu z-indexes');
  for (const f of ['county-brief.js', 'layers-gpsjam.js', 'layers-incidents.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'modules', f), 'utf8');
    const m = src.match(/innerWidth >= 900\s*\?\s*'[^']*z-index:(\d+);/);
    assert.ok(m, f + ': desktop placement sets its own z-index');
    assert.ok(Number(m[1]) < menus, f + ': desktop panel must sit under the menus (' + m[1] + ' vs ' + menus + ')');
    assert.doesNotMatch(src, /overflow:auto;z-index:9\d\d;/, f + ': no fixed z-index after the placement');
  }
});

test('outside the U.S. the panel says so and draws nothing', async () => {
  const sb = clientSandbox({ error: 'No U.S. county here. County briefs cover the 50 states, DC and territories.' }, 404);
  await sb.open(51.5, -0.12);
  assert.match(sb.html.panel.innerHTML, /No U\.S\. county here/);
  assert.strictEqual(sb.html.entities.length, 0);
});
