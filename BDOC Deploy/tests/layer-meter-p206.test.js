// p206 (W1.1 chunk A) — layer-load meter: wiring, the entity map, URL attribution, grading.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/bdoc-layer-meter.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'css/bdoc-layer-meter.css'), 'utf8');

function allJs(dir) {
  let out = '';
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'vendor') out += allJs(p); }
    else if (f.name.endsWith('.js') && f.name !== 'bdoc-layer-meter.js') out += fs.readFileSync(p, 'utf8') + '\n';
  }
  return out;
}
const PAGE_CODE = HTML + '\n' + allJs(path.join(ROOT, 'js'));

// Load the module in a bare sandbox: no DOM work happens until start(), and start() tolerates no panel.
function load() {
  const listeners = {};
  const sandbox = {
    console,
    performance: { timeOrigin: 0, now: () => 1000, addEventListener() {}, setResourceTimingBufferSize() {}, clearResourceTimings() {} },
    PerformanceObserver: class { observe() {} },
    setInterval: () => 0, setTimeout: () => 0,
    document: { readyState: 'complete', querySelector: () => null, getElementById: () => null, addEventListener: (k, f) => { listeners[k] = f; }, contains: () => false, hidden: false },
    layers: { eq: true, fire: true, air: false, news: true, conf: false, warlive: false, aoiwatch: false },
    eqEnts: [{ show: true }, { show: true }, { show: false }],
    fireEnts: [{}, {}], firePerimEnts: [{}],
    Set, Array, Object, Math, String, RegExp, JSON
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox;
}

test('page loads the meter script and stylesheet, and the service worker caches both (v194)', () => {
  assert.match(HTML, /<script src="js\/bdoc-layer-meter\.js\?v=p206"><\/script>/);
  assert.match(HTML, /<link rel="stylesheet" href="css\/bdoc-layer-meter\.css\?v=p206">/);
  assert.ok(SW.includes("'/js/bdoc-layer-meter.js?v=p206'"));
  assert.ok(SW.includes("'/css/bdoc-layer-meter.css?v=p206'"));
  assert.match(SW, /const SW_VERSION = 'bdoc-v194';/);
  assert.match(SW, /\/\/ \(prev\) const SW_VERSION = 'bdoc-v193';/);
});

test('meter loads after the layer code it reads (index.html inline script + togLy override)', () => {
  const meterAt = HTML.indexOf('js/bdoc-layer-meter.js');
  assert.ok(meterAt > HTML.indexOf('const _origTogLy = togLy;'), 'meter must load after the togLy override');
  assert.ok(meterAt > HTML.indexOf('let eqEnts=[]'));
});

test('every entity array the meter reads exists somewhere in the page code', () => {
  const body = SRC.slice(SRC.indexOf('const ENTS = {'), SRC.indexOf('/* eslint-enable no-undef */'));
  const names = new Set();
  for (const m of body.matchAll(/\[([^\]]*)\]/g)) {
    m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(n => names.add(n));
  }
  assert.ok(names.size >= 50, 'expected the full map, got ' + names.size);
  const missing = [...names].filter(n => !new RegExp('\\b' + n.replace('$', '\\$') + '\\s*=').test(PAGE_CODE) &&
    !new RegExp('(let|var|const)\\s+' + n + '\\b').test(PAGE_CODE));
  assert.deepStrictEqual(missing, []);
});

test('every layer key in the meter maps is a real layer toggle', () => {
  const s = load();
  const { ENTS, NET_RULES } = s.BDOCLayerMeter._test;
  const keys = new Set(Object.keys(ENTS));
  NET_RULES.forEach(([, lys]) => lys.forEach(l => keys.add(l)));
  // Most rows are markup; landings and chokepoints are built in script (dataset.layer='…').
  const missing = [...keys].filter(k => !HTML.includes('data-layer="' + k + '"') && !HTML.includes("dataset.layer='" + k + "'"));
  assert.deepStrictEqual(missing, []);
});

test('counts only things that are shown, and survives arrays that do not exist yet', () => {
  const s = load();
  const snap = s.BDOCLayerMeter.snapshot();
  const eq = snap.rows.find(r => r.layer === 'eq');
  const fire = snap.rows.find(r => r.layer === 'fire');
  const news = snap.rows.find(r => r.layer === 'news');
  assert.strictEqual(eq.drawn, 2, 'hidden entity not counted');
  assert.strictEqual(fire.drawn, 3, 'fire counts hotspots + perimeters');
  assert.strictEqual(news.drawn, 0, 'newsEnts not declared in the sandbox → 0, no throw');
  assert.strictEqual(snap.layersOn, 3);
  assert.strictEqual(snap.drawn, 5);
  const { countColl } = s.BDOCLayerMeter._test;
  assert.strictEqual(countColl(new Set([{ show: true }, { show: false }])), 1);
  assert.strictEqual(countColl({ show: true, entities: { values: [1, 2, 3] } }), 3);
  assert.strictEqual(countColl({ show: false, entities: { values: [1, 2, 3] } }), 0);
  assert.strictEqual(countColl(null), 0);
});

test('a shared feed is split between the layers that are on; unknown URLs go to "Map and app"', () => {
  const s = load();
  const { attribute, OTHER } = s.BDOCLayerMeter._test;
  const toPlain = a => JSON.parse(JSON.stringify(a));
  assert.deepStrictEqual(toPlain(attribute('https://x/.netlify/functions/proxy-firms?a=1', { fire: true })), [['fire', 1]]);
  assert.deepStrictEqual(toPlain(attribute('https://x/.netlify/functions/proxy-firms', { fire: true, warlive: true })), [['fire', 0.5], ['warlive', 0.5]]);
  assert.deepStrictEqual(toPlain(attribute('https://x/.netlify/functions/proxy-firms', {})), [[OTHER, 1]]);
  assert.deepStrictEqual(toPlain(attribute('https://earthquake.usgs.gov/feed.geojson', { eq: true })), [['eq', 1]]);
  assert.deepStrictEqual(toPlain(attribute('https://tile.arcgisonline.com/x/1/2/3', { eq: true })), [[OTHER, 1]]);
  // proxy-gdeltevents must not be swallowed by the broader proxy-gdelt rule
  assert.deepStrictEqual(toPlain(attribute('/.netlify/functions/proxy-gdeltevents', { warlive: true, news: true })), [['warlive', 1]]);
});

test('network figures land on the right layer in the snapshot', () => {
  const s = load();
  const { addEntry } = s.BDOCLayerMeter._test;
  addEntry({ name: 'https://earthquake.usgs.gov/a', startTime: 900, transferSize: 4096 });
  addEntry({ name: 'https://kgsbdoc.netlify.app/.netlify/functions/proxy-firms', startTime: 950, transferSize: 2048 });
  addEntry({ name: 'data:image/png;base64,xx', startTime: 950, transferSize: 99999 });
  const snap = s.BDOCLayerMeter.snapshot();
  const eq = snap.rows.find(r => r.layer === 'eq');
  const fire = snap.rows.find(r => r.layer === 'fire');
  assert.strictEqual(eq.kbMin, 4); assert.strictEqual(eq.reqMin, 1);
  assert.strictEqual(fire.kbMin, 2); assert.strictEqual(fire.reqMin, 1);
  assert.strictEqual(snap.kbMin, 6, 'data: URIs are not network');
  addEntry({ name: 'https://tile.arcgisonline.com/1/2/3', startTime: 960, transferSize: 10240 });
  const snap2 = s.BDOCLayerMeter.snapshot();
  assert.strictEqual(snap2.kbMin, 6, 'basemap tiles are not counted against the layers');
  assert.strictEqual(snap2.otherKbMin, 10);
  assert.strictEqual(snap.rows[snap.rows.length - 1].layer, '_other', '"Map and app" sorts last');
});

test('grading: light / medium / heavy, and the page score is capped 0–100', () => {
  const s = load();
  const { grade, loadScore } = s.BDOCLayerMeter._test;
  assert.strictEqual(grade(10, 1, 5), 'light');
  assert.strictEqual(grade(800, 1, 5), 'medium');
  assert.strictEqual(grade(10, 20, 5), 'medium');
  assert.strictEqual(grade(5000, 0, 0), 'heavy');
  assert.strictEqual(grade(null, 0, 2000), 'heavy');
  assert.strictEqual(loadScore(0, 0, 0), 0);
  assert.strictEqual(loadScore(1e6, 1e6, 1e6), 100);
});

test('meter is glass styled and the off buttons are labelled', () => {
  assert.match(CSS, /backdrop-filter:var\(--glass-blur/);
  assert.match(SRC, /aria-label="Turn off /);
  assert.match(SRC, /aria-expanded/);
});
