// p168p: AOI Watch (proxy-watch) and Cam Wall (proxy-mecams), ported from the stale OneDrive copy,
// plus the proxy-firms day cap. Upstreams are stubbed; these pin the whitelists and the wiring.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FN = (n) => path.join(ROOT, 'netlify', 'functions', n);
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
const AOI_SRC = fs.readFileSync(path.join(ROOT, 'js', 'modules', 'aoi-watch.js'), 'utf8');
const CAM_SRC = fs.readFileSync(path.join(ROOT, 'js', 'modules', 'cam-wall.js'), 'utf8');

function fresh(file) { delete require.cache[require.resolve(file)]; return require(file); }

// Stub global fetch; every call is recorded, the reply comes from reply(url, opts).
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

test('proxy-watch refuses an unknown source without calling out', async () => {
  const w = fresh(FN('proxy-watch.js'));
  await withFetch(() => ({}), async (calls) => {
    const r = await call(w, { source: 'http://evil.example/' });
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(calls.length, 0);
  });
});

test('proxy-watch news: GDELT syntax only, domain filter only from the whitelist', async () => {
  const w = fresh(FN('proxy-watch.js'));
  await withFetch(() => ({ body: { articles: [{ title: 't', url: 'https://x', domain: 'aljazeera.com' }] } }), async (calls) => {
    await call(w, { source: 'news', q: 'natanz&apikey=steal', domain: 'aljazeera.com' });
    await call(w, { source: 'news', q: '(qeshm OR "strait of hormuz")', domain: 'evil.example' });
    const q0 = new URL(calls[0].url).searchParams.get('query'), q1 = new URL(calls[1].url).searchParams.get('query');
    assert.strictEqual(q0, '(natanz OR "pickaxe mountain") domainis:aljazeera.com', 'bad characters fall back to the default query');
    assert.strictEqual(q1, '(qeshm OR "strait of hormuz")', 'unlisted domain is ignored');
    assert.ok(calls.every(c => c.url.startsWith('https://api.gdeltproject.org/')));
  });
});

test('proxy-watch news: a GDELT 429 is a 200 with rateLimited, so the client can fall back', async () => {
  const w = fresh(FN('proxy-watch.js'));
  await withFetch(() => ({ status: 429, body: 'slow down' }), async () => {
    const r = await call(w, { source: 'news' });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(JSON.parse(r.body).rateLimited, true);
  });
});

test('proxy-watch ripe: country code is sanitized, far and abandoned probes are dropped', async () => {
  const w = fresh(FN('proxy-watch.js'));
  const probe = (id, s, lat, lon) => ({ id, status: { name: s, since: '2026-11-01T00:00:00Z' }, geometry: { coordinates: [lon, lat] }, asn_v4: 1, country_code: 'IR' });
  await withFetch(() => ({ body: { results: [probe(1, 'Connected', 33.7, 51.7), probe(2, 'Abandoned', 33.7, 51.7), probe(3, 'Connected', 40, 60)], next: null } }), async (calls) => {
    const r = JSON.parse((await call(w, { source: 'ripe', lat: '33.69', lon: '51.72', km: '250', country: 'ir' })).body);
    assert.deepStrictEqual(r.probes.map(p => p.id), [1]);
    assert.match(calls[0].url, /country_code=IR/);
    await call(w, { source: 'ripe', country: '../x' });
    assert.doesNotMatch(calls[1].url, /country_code=/);
  });
});

// p169 replaced proxy-mecams' YouTube search and news-channel sources; their tests are in camwall-p169.test.js.

test('proxy-mecams windy: inactive cams and cams without coordinates are dropped', async () => {
  const saved = process.env.WINDY_API_KEY;
  process.env.WINDY_API_KEY = 'WKEY';
  try {
    const m = fresh(FN('proxy-mecams.js'));
    const cam = (id, extra) => Object.assign({ webcamId: id, title: 'c' + id, status: 'active', location: { latitude: 32, longitude: 35 }, player: { day: 'https://webcams.windy.com/x' } }, extra);
    await withFetch(() => ({ body: { total: 3, webcams: [cam(1), cam(2, { status: 'inactive' }), cam(3, { location: {} })] } }), async (calls) => {
      const r = JSON.parse((await call(m, { source: 'windy', region: 'me' })).body);
      assert.deepStrictEqual(r.webcams.map(w => w.id), ['1']);
      assert.ok(calls.every(c => c.opts.headers['x-windy-api-key'] === 'WKEY'), 'key goes in a header, not the URL');
      assert.ok(calls.every(c => !c.url.includes('WKEY')));
    });
  } finally {
    if (saved === undefined) delete process.env.WINDY_API_KEY; else process.env.WINDY_API_KEY = saved;
  }
});

test('proxy-firms never asks FIRMS for more than 5 days (it answers 400 above that)', async () => {
  const f = fresh(FN('proxy-firms.js'));
  await withFetch(() => ({ body: 'latitude,longitude\n1,2' }), async (calls) => {
    await call(f, { mode: 'area', area: '54.3,25.6,57.6,28.0', source: 'VIIRS_NOAA20_NRT', days: '10' });
    assert.match(calls[0].url, /\/54\.3,25\.6,57\.6,28\.0\/5$/);
  });
});

test('index.html wires both layers and keeps module versions in step with the service worker', () => {
  assert.match(HTML, /data-layer="aoiwatch"/);
  assert.match(HTML, /data-layer="camwall"/);
  assert.match(HTML, /const layers=\{[^}]*aoiwatch:false,camwall:false/);
  assert.match(HTML, /if\(ly==='aoiwatch'\)/);
  assert.match(HTML, /if\(ly==='camwall'\)/);
  const ver = /_version:\s*'([^']+)'/.exec(HTML)[1];
  const swMods = [...SW.matchAll(/'\/js\/modules\/[a-z-]+\.js\?v=([^']+)'/g)].map(m => m[1]);
  assert.ok(swMods.length > 0);
  assert.ok(swMods.every(v => v === ver), 'every precached module ?v= matches LazyLoader._version');
});

test('the ported modules declare no top-level name that index.html or another module already declares', () => {
  // A classic <script> that re-declares a global lexical name (main's P69 `const AOIWatch`) throws
  // "Identifier has already been declared" and never runs. Caught in the browser on 5 Nov 2026.
  const top = (src) => [...src.matchAll(/^(?:var|let|const|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  const others = [HTML].concat(fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')))
    .concat(fs.readdirSync(path.join(ROOT, 'js', 'modules')).filter(f => f.endsWith('.js') && !['aoi-watch.js', 'cam-wall.js'].includes(f)).map(f => fs.readFileSync(path.join(ROOT, 'js', 'modules', f), 'utf8')));
  const taken = new Set(others.flatMap(top).concat(others.flatMap(s => [...s.matchAll(/(?:^|[\s;{}])(?:let|const|class)\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]))));
  for (const [file, src] of [['aoi-watch.js', AOI_SRC], ['cam-wall.js', CAM_SRC]]) {
    const clash = top(src).filter(n => taken.has(n));
    assert.deepStrictEqual(clash, [], file + ' re-declares ' + clash.join(', '));
  }
  assert.match(HTML, /window\.AOIZoneWatch/, 'the toggle calls the renamed object');
});

test('Cam Wall talks to proxy-mecams (main\'s proxy-cams is the US traffic-cam index) and no popup uses inline onclick', () => {
  assert.match(CAM_SRC, /\/\.netlify\/functions\/proxy-mecams\?/);
  assert.doesNotMatch(CAM_SRC, /functions\/proxy-cams\?/);
  assert.doesNotMatch(CAM_SRC, /onclick=/i);
  assert.doesNotMatch(AOI_SRC, /onclick=/i);
  assert.doesNotMatch(CAM_SRC, /InfoBoxActions\s*[.[]/, 'main has no InfoBoxActions registry');
  assert.match(fs.readFileSync(FN('proxy-cams.js'), 'utf8'), /Caltrans/, 'main\'s proxy-cams is untouched');
});
