// p173 — three fixes from Travon's screenshots (6 Nov 2026):
//  1. KR07, a PZL W-3 Sokol (ICAO type W3), drew as a jet with "NARROW-BODY JET" on its card.
//  2. With the AI panel collapsed or closed, the parked compass sat on the info box's close button.
//  3. The floating UNDO button sat on the MAP STYLE buttons; it moves under the coordinate bar, red.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'); // checkouts may be CRLF
const AIR = read('js/modules/layers-air.js'), HTML = read('index.html'), SW = read('service-worker.js');
const CSS = read('css/bdoc.css'), P154 = read('css/bdoc-p154.css'), P159 = read('css/bdoc-p159.css');

// The classifier is plain code: the type table, the extra rotorcraft lists, resolveAircraftClass and
// classifyAircraftType. Run exactly that slice of the module.
function classifier() {
  const a = AIR.indexOf('const AC_TYPE_TABLE = {');
  const f = AIR.indexOf('function classifyAircraftType(desc){');
  const end = AIR.indexOf("\n  return 'jet';\n}", f);
  assert.ok(a > 0 && f > a && end > f, 'found the classifier slice');
  const ctx = vm.createContext({});
  vm.runInContext(AIR.slice(a, end) + "\n  return 'jet';\n}\nthis.R=resolveAircraftClass;this.C=classifyAircraftType;this.T=AC_TYPE_TABLE;", ctx);
  return ctx;
}

test('the W-3 Sokol and the other added rotorcraft codes classify as helicopters', () => {
  const { R, T } = classifier();
  assert.equal(R({ t: 'W3' }), 'heli');
  assert.equal(R({ t: 'w3 ' }), 'heli');
  assert.equal(R({ t: 'W3', category: 'A3' }), 'heli', 'type code wins over a wrong non-rotor category');
  for (const c of ['W3', 'B105', 'FREL', 'S55', 'S58', 'H2', 'KA25', 'WG30']) assert.equal(T[c], 'heli', c);
});

test('helicopter names in the description fall back to heli', () => {
  const { R } = classifier();
  for (const desc of ['PZL-SWIDNIK W-3 SOKOL', 'PZL SWIDNIK W-3A SOKOL', 'LEONARDO AW169', 'LEONARDO AW-139', 'MBB BO-105', 'MBB-KAWASAKI BK-117',
    'WESTLAND LYNX AH7', 'AEROSPATIALE SA-342 GAZELLE', 'AEROSPATIALE AS-350 ECUREUIL', 'KAMAN K-1200', 'GUIMBAL CABRI G2', 'HAL DHRUV', 'NH INDUSTRIES NH-90'])
    assert.equal(R({ desc }), 'heli', desc);
});

test('planes keep their classes (no new false helicopters)', () => {
  const { R } = classifier();
  const want = { A320: 'jet', B738: 'jet', GLF5: 'bizjet', C172: 'prop', B212: 'heli', MQ9: 'drone', KC135: 'tanker', B52H: 'bomber' };
  for (const [t, c] of Object.entries(want)) assert.equal(R({ t }), c, t);
  for (const desc of ['PZL-MIELEC M-28 SKYTRUCK', 'PZL-104 WILGA', 'DE HAVILLAND TIGER MOTH', 'BOEING 737-800', 'AIRBUS A320', 'KR07'])
    assert.notEqual(R({ desc }), 'heli', desc);
});

test('the aircraft card reads the same classifier, so a helicopter card says HELICOPTER', () => {
  assert.match(AIR, /const type=resolveAircraftClass\(a\);\n\s*const typeMap=\{heli:'HELICOPTER'/);
});

test('info box moves left of the parked compass (AI panel collapsed or closed)', () => {
  assert.match(CSS, /body:has\(#nav-widget\.nw-parked\.rp-mini\) \.cesium-infoBox\{right:150px !important\}/);
  assert.match(CSS, /body:has\(#nav-widget\.nw-parked\.rp-closed\) \.cesium-infoBox\{right:108px !important\}/);
  // The offsets are sized from the parked compass: right 54px (mini) / 12px (closed), ~94px wide unscaled,
  // shown at 0.62 and 0.9 on hover from the top-right corner. Measured in the dev server: 12px gap at hover.
  assert.match(P154, /#nav-widget\.nw-parked\{\s*top:56px!important;bottom:auto!important;right:12px!important;\s*transform:scale\(0\.62\);transform-origin:top right/);
  assert.match(P154, /#nav-widget\.nw-parked\.rp-mini\{right:54px!important\}/);
  assert.match(P154, /#nav-widget\.nw-parked:hover\{transform:scale\(0\.9\)/);
  const W = 94, hover = 0.9;
  assert.ok(150 > 54 + W * hover + 6 && 108 > 12 + W * hover + 6, 'box clears the hovered compass');
  // the open-panel position is unchanged
  assert.match(CSS, /body\.ai-open \.cesium-infoBox\{right:390px !important\}/);
});

test('UNDO sits under the coordinate bar, red, and no longer jumps over the INTEL panel', () => {
  const rule = P154.match(/#bdocUndoBtn\{[^}]*\}/)[0];
  assert.match(rule, /left:calc\(var\(--lw,248px\) \+ 14px\);top:calc\(var\(--tbh,56px\) \+ 46px\);bottom:auto/);
  assert.match(rule, /background:#B42B28/);
  assert.match(rule, /color:#fff/);
  assert.match(P154, /#bdocUndoBtn:hover\{background:#DA3633/);
  assert.doesNotMatch(P154, /body:has\(\.lp\.shut\) #bdocUndoBtn/, 'the rule that moved it onto the INTEL panel is gone');
  assert.match(P154, /@media\(max-width:767px\)\{#bdocUndoBtn\{left:12px;top:auto;bottom:72px\}\}/);
  // aligned with the coordinate bar it sits under (26px tall at var(--tbh)+12px)
  assert.match(P159, /#cursorCoords\{top:calc\(var\(--tbh\) \+ 12px\)!important;left:calc\(var\(--lw,248px\) \+ 14px\)!important/);
  assert.match(HTML, /<button id="bdocUndoBtn" onclick="BDOCUndo\.undo\(\)"/);
});

test('versions: module, stylesheets and service worker bumped together', () => {
  assert.match(SW, /const SW_VERSION = 'bdoc-v175';  \/\/ p173:/);
  assert.match(SW, /^\/\/ \(prev\) const SW_VERSION = 'bdoc-v174';/m);
  const ver = /_version:\s*'([^']+)'/.exec(HTML)[1];
  const num = v => Number(String(v).replace(/^p/, '').replace(/\D.*$/, ''));
  assert.ok(num(ver) >= 173, `LazyLoader ${ver}`);
  assert.ok(SW.includes(`'/js/modules/layers-air.js?v=${ver}'`), 'layers-air precached at the LazyLoader version');
  for (const f of ['bdoc.css', 'bdoc-p154.css']) {
    const v = HTML.match(new RegExp(`href="css/${f.replace('.', '\\.')}\\?v=(\\w+)"`))[1];
    assert.ok(num(v) >= 173, `${f} ?v=${v}`);
    assert.ok(SW.includes(`'/css/${f}?v=${v}',`), `${f} precached at ${v}`);
  }
});
