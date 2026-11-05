// p172 — Travon's tier call: the GWIS fire danger forecast opens to Operator; Signals, Cam Wall,
// AOI Watch, EU warnings and Copernicus EMS stay Analyst. Every locked-layer surface (hover badge,
// command palette, preset message, upgrade screen) now names the plan that really unlocks the layer;
// before this, Analyst-only layers told Recon users to buy Operator, which still left them locked.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const AUTH = read('js/auth.js'), HTML = read('index.html'), CSS = read('css/bdoc.css'), SW = read('service-worker.js');

function load() {
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = { window: {}, document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: ls, sessionStorage: ls, console: { log() {}, warn() {}, info() {}, error() {} }, setTimeout,
    location: { search: '', href: '' }, history: { replaceState() {} }, URLSearchParams };
  vm.createContext(ctx);
  vm.runInContext(AUTH + ';this.__A=BDOC_Auth;', ctx);
  return ctx.__A;
}
const STAY_ANALYST = ['signals', 'camwall', 'aoiwatch', 'euwarn', 'cems'];
const TOGGLES = [...new Set([...HTML.matchAll(/class="ly[^"]*" data-layer="([^"]+)"/g)].map(m => m[1]))];

test('fire danger opens to Operator; the other new layers stay Analyst', () => {
  const A = load();
  assert.equal(A.minTier('firedanger'), 'operator');
  for (const ly of STAY_ANALYST) assert.equal(A.minTier(ly), 'analyst', ly);
  A.tier = 'operator';
  assert.equal(A.canAccess('firedanger'), true);
  for (const ly of STAY_ANALYST) assert.equal(A.canAccess(ly), false, ly);
  A.tier = 'recon';
  assert.equal(A.canAccess('firedanger'), false);
  A.tier = 'analyst';
  for (const ly of ['firedanger', ...STAY_ANALYST]) assert.equal(A.canAccess(ly), true, ly);
});

test('minTier agrees with canAccess for every toggle and every tier', () => {
  const A = load();
  assert.ok(TOGGLES.length > 60, 'found the layer toggles');
  const order = ['recon', 'operator', 'analyst', 'enterprise'];
  for (const ly of [...TOGGLES, 'replay', 'pdf', 'google3d', 'netbuilder']) {
    const min = A.minTier(ly);
    assert.ok(['recon', 'operator', 'analyst'].includes(min), ly);
    for (const t of order) { A.tier = t; assert.equal(A.canAccess(ly), order.indexOf(t) >= order.indexOf(min), `${ly} @ ${t}`); }
  }
  A.tier = 'nonsense'; assert.equal(A.canAccess('firedanger'), false, 'unknown tier falls back to recon');
  assert.equal(A.minTier('replay'), 'analyst');
  assert.equal(A.minTier('alerts'), 'recon');
});

test('markLockedLayers tags each locked toggle with the plan that unlocks it, and clears it when unlocked', () => {
  const A = load();
  const mk = ly => { const sw = { style: {} }, cls = new Set(['on']);
    return { dataset: { layer: ly }, classList: { add: c => cls.add(c), remove: c => cls.delete(c), has: c => cls.has(c) }, querySelector: () => sw, cls }; };
  const els = ['firedanger', 'signals', 'alerts'].map(mk);
  const doc = { getElementById: () => null, querySelectorAll: () => els, addEventListener() {} };
  const ctx = vm.createContext({ window: {}, document: doc, layers: { firedanger: true, signals: true, alerts: true },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console, setTimeout, location: { search: '', href: '' }, history: { replaceState() {} }, URLSearchParams });
  vm.runInContext(AUTH + ';this.__A=BDOC_Auth;', ctx);
  const B = ctx.__A;
  B.tier = 'recon'; B.markLockedLayers();
  assert.deepEqual(els.map(e => e.dataset.tier), ['operator', 'analyst', undefined]);
  assert.deepEqual(els.map(e => e.cls.has('locked')), [true, true, false]);
  B.tier = 'operator'; B.markLockedLayers();
  assert.deepEqual(els.map(e => e.dataset.tier), [undefined, 'analyst', undefined]);
  assert.deepEqual(els.map(e => e.cls.has('locked')), [false, true, false]);
  assert.equal(A.minTier('firedanger'), 'operator'); // separate instance unaffected
});

test('every locked surface names the right plan', () => {
  // hover badge
  assert.match(CSS, /\.ly\.locked:hover::after\{content:'\\21D2 Operator \$9\.99\/mo'/);
  assert.match(CSS, /\.ly\.locked\[data-tier="analyst"\]:hover::after\{content:'\\21D2 Analyst \$29\.99\/mo'\}/);
  // command palette
  assert.match(HTML, /sub:isLocked\?\(el\.dataset\.tier==='analyst'\?'🔒 Analyst \$29\.99\/mo':'🔒 Operator \$9\.99\/mo'\)/);
  // preset message counts Analyst-only layers apart
  assert.match(HTML, /if\(el\.classList\.contains\('locked'\)\)\{lockedN\+\+;if\(el\.dataset\.tier==='analyst'\)lockedA\+\+;return\}/);
  assert.match(HTML, /lockedN-lockedA\?`\$\{lockedN-lockedA\} more with Operator \(\$9\.99\/mo\)`:'',lockedA\?`\$\{lockedA\} more with Analyst \(\$29\.99\/mo\)`/);
  assert.doesNotMatch(HTML, /`· \$\{lockedN\} more with Operator/);
  // upgrade screen asks minTier and names unnamed layers from their toggle
  assert.match(HTML, /const requiredTier = triggerLayer \? \(LAYER_TIER\[triggerLayer\] \|\| \(typeof BDOC_Auth!=='undefined'&&typeof BDOC_Auth\.minTier==='function'&&BDOC_Auth\.minTier\(triggerLayer\)==='analyst'\?'analyst':'operator'\)\)/);
  assert.match(HTML, /document\.querySelector\('\.ly\[data-layer="'\+CSS\.escape\(triggerLayer\)\+'"\] \.ly-n'\)/);
  assert.match(HTML, /canAccess\('replay'\)\)\{showMo\('replay'\);return\}/);
  assert.match(HTML, /canAccess\('pdf'\)\)\{showMo\('pdf'\);return\}/);
});

test('upgrade screen picks the Analyst card for Analyst-only layers (run in a stub DOM)', () => {
  const src = HTML.match(/function showMo\(triggerLayer\)\{[\s\S]*?\n\}\nfunction hideMo/)[0].replace(/\nfunction hideMo$/, '');
  const run = (ly, tier) => {
    const A = load(); A.tier = tier;
    const cards = [0, 1, 2, 3].map(() => ({ style: {} })), h2 = { textContent: '' };
    const ctx = vm.createContext({ BDOC_Auth: A, CSS: { escape: s => s },
      document: { querySelector: s => s === '#moBg h2' ? h2 : (s.includes('signals') ? { textContent: 'Signals: squawks, HF, receivers' } : null),
        querySelectorAll: () => cards, getElementById: () => ({ classList: { add() {} } }) } });
    vm.runInContext(src + ';showMo(' + JSON.stringify(ly) + ')', ctx);
    return { h2: h2.textContent, card: cards.findIndex(c => c.style.outline) };
  };
  assert.deepEqual(run('signals', 'recon'), { h2: '🔒 Signals: squawks, HF, receivers — ANALYST TIER', card: 2 });
  assert.equal(run('firedanger', 'recon').card, 1);
  assert.match(run('firedanger', 'recon').h2, /OPERATOR TIER$/);
  assert.equal(run('replay', 'operator').card, 2);
});

test('versions: auth.js and bdoc.css bumped together in the page and the service worker', () => {
  assert.match(SW, /^const SW_VERSION = 'bdoc-v174';  \/\/ p172:/m);
  assert.match(SW, /^\/\/ \(prev\) const SW_VERSION = 'bdoc-v173';/m);
  const av = HTML.match(/<script src="js\/auth\.js\?v=(\w+)"><\/script>/)[1];
  const cv = HTML.match(/href="css\/bdoc\.css\?v=(\w+)"/)[1];
  assert.equal(av, 'p172'); assert.equal(cv, 'p172');
  assert.ok(SW.includes(`'/js/auth.js?v=${av}',`)); assert.ok(SW.includes(`'/css/bdoc.css?v=${cv}',`));
  assert.ok(!SW.includes("'/js/auth.js?v=p167',") && !SW.includes("'/css/bdoc.css?v=p154',"));
});
