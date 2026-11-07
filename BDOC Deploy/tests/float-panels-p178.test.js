// p178 — Travon: "I need the boxes to be able to be dragged like the global threat box ... for all
// boxes and all pop-ups, because other boxes pop up on top of the one I'm looking at". js/bdoc-float.js
// makes every floating box drag by its title bar and brings a covered box to the front when pressed;
// the map's info box comes out of the globe's stacking layer so it can be in front at all.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const SRC = read('js/bdoc-float.js'), HTML = read('index.html'), SW = read('service-worker.js');
const CSS = ['css/bdoc.css', 'css/bdoc-p154.css', 'css/bdoc-p159.css', 'css/bdoc-wire.css'].map(read).join('\n');
const MODS = fs.readdirSync(path.join(ROOT, 'js/modules')).filter(f => f.endsWith('.js')).map(f => read('js/modules/' + f)).join('\n');
const ALL = [HTML, CSS, MODS, read('js/cesium-init.js')].join('\n');

// node has no DOM: the file must load, export its pure core, and touch nothing else
function load() {
  const ctx = vm.createContext({ console });
  vm.runInContext(SRC, ctx, { filename: 'bdoc-float.js' });
  return ctx.BDOCFloat.core;
}
const C = load();
const R = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });

test('loads without a DOM and exposes only the pure core', () => {
  assert.ok(Object.isFrozen(C));
  for (const f of ['layerCap', 'overlaps', 'planRaise', 'compactPlan', 'clampRect', 'inHandle']) assert.equal(typeof C[f], 'function', f);
  assert.equal(C.HANDLE_PX, 36); assert.equal(C.THRESHOLD, 4); assert.equal(C.MIN_DESKTOP, 768); assert.equal(C.INFOBOX_Z, 61);
});

test('layers: data panels stay under the tickers (80) and the top bar (100)', () => {
  assert.equal(C.layerCap(56), 79); assert.equal(C.layerCap(61), 79); assert.equal(C.layerCap(79), 79);
  assert.equal(C.layerCap(80), 99); assert.equal(C.layerCap(99), 99);
  assert.equal(C.layerCap(100), Infinity); assert.equal(C.layerCap(10500), Infinity);
  // the moved info box sits above the data panels (56-60) and inside their layer
  assert.ok(C.INFOBOX_Z > 60 && C.INFOBOX_Z < 80);
});

test('raise: only when another box in the same layer covers it', () => {
  const me = { z: 56, natural: 56, order: 5, rect: R(884, 110, 340, 500) };
  assert.equal(C.planRaise(me, []), null);
  // the info box (61) over the AOI panel (56): go just above it
  assert.deepEqual(C.planRaise(me, [{ z: 61, order: 90, rect: R(810, 60, 400, 254) }]), { z: 62, compact: false });
  // not overlapping: nothing to do
  assert.equal(C.planRaise(me, [{ z: 61, order: 90, rect: R(10, 10, 100, 100) }]), null);
  // already above it
  assert.equal(C.planRaise(me, [{ z: 50, order: 1, rect: R(900, 120, 50, 50) }]), null);
  // same z: the later one in the page is drawn on top, so only a later box covers
  assert.deepEqual(C.planRaise(me, [{ z: 56, order: 9, rect: R(904, 466, 320, 464) }]), { z: 57, compact: false });
  assert.equal(C.planRaise(me, [{ z: 56, order: 2, rect: R(904, 466, 320, 464) }]), null);
  // a box in a higher layer (camera viewer 10500, threat box 999) stays above: no climbing over modals
  assert.equal(C.planRaise(me, [{ z: 10500, order: 9, rect: R(1000, 0, 480, 1000) }, { z: 999, order: 9, rect: R(900, 500, 200, 76) }]), null);
  // the highest cover wins
  assert.deepEqual(C.planRaise(me, [{ z: 57, order: 9, rect: R(800, 400, 660, 500) }, { z: 61, order: 90, rect: R(810, 60, 400, 254) }]), { z: 62, compact: false });
});

test('raise: a full layer asks for renumbering instead of passing its ceiling', () => {
  const me = { z: 60, natural: 56, order: 5, rect: R(0, 0, 100, 100) };
  assert.deepEqual(C.planRaise(me, [{ z: 79, order: 9, rect: R(50, 50, 100, 100) }]), { z: 79, compact: true });
  assert.deepEqual(C.planRaise(me, [{ z: 78, order: 9, rect: R(50, 50, 100, 100) }]), { z: 79, compact: false });
  // high layer: no ceiling
  const hi = { z: 10500, natural: 10500, order: 1, rect: R(0, 0, 100, 100) };
  assert.deepEqual(C.planRaise(hi, [{ z: 10500, order: 2, rect: R(50, 50, 100, 100) }]), { z: 10501, compact: false });
});

test('renumbering keeps the order, packs low, never goes under a box\'s own z', () => {
  const boxes = [{ z: 78, order: 1, natural: 56 }, { z: 79, order: 0, natural: 56 }, { z: 70, order: 2, natural: 61 }];
  assert.deepEqual(C.compactPlan(boxes), [62, 63, 61]);
  // ties go by page order
  assert.deepEqual(C.compactPlan([{ z: 70, order: 4, natural: 56 }, { z: 70, order: 3, natural: 56 }]), [57, 56]);
  // 40 boxes still fit only if they must: values are distinct and increasing in stacking order
  const many = Array.from({ length: 12 }, (_, i) => ({ z: 79 - (i % 3), order: i, natural: 56 }));
  const out = C.compactPlan(many);
  assert.equal(new Set(out).size, out.length);
  assert.ok(Math.max(...out) <= 56 + many.length - 1);
});

test('dragging keeps the title bar on screen and below the top bar', () => {
  const vw = 1600, vh = 1000, top = 56;
  assert.deepEqual(C.clampRect(500, 300, 340, 500, vw, vh, top), { left: 500, top: 300 });
  assert.deepEqual(C.clampRect(-5000, 300, 340, 500, vw, vh, top), { left: 80 - 340, top: 300 });   // 80 px stays visible
  assert.deepEqual(C.clampRect(5000, 300, 340, 500, vw, vh, top), { left: vw - 80, top: 300 });
  assert.deepEqual(C.clampRect(500, -200, 340, 500, vw, vh, top), { left: 500, top: 56 });         // not under the top bar
  assert.deepEqual(C.clampRect(500, 5000, 340, 500, vw, vh, top), { left: 500, top: vh - 36 });    // title bar still visible
  assert.deepEqual(C.clampRect(-500, 300, 60, 40, vw, vh, 0), { left: 0, top: 300 });              // narrow box stays whole
  assert.deepEqual(C.clampRect(500, 300, 340, 500, 300, 20, 56), { left: 220, top: 56 });          // tiny window: min wins
});

test('the drag strip is the top 36 px of a box', () => {
  const r = R(100, 200, 300, 400);
  assert.equal(C.inHandle(r, 150, 200), true);
  assert.equal(C.inHandle(r, 150, 236), true);
  assert.equal(C.inHandle(r, 150, 237), false);
  assert.equal(C.inHandle(r, 99, 210), false);
  assert.equal(C.inHandle(r, 150, 199), false);
});

test('docked UI is never dragged; boxes with their own drag keep it; title-bar controls stay clickable', () => {
  const ex = C.EXCLUDE.split(','), own = C.OWN_DRAG.split(','), inter = C.INTERACTIVE.split(',');
  for (const s of ['.tb', '#lp', '#rp', '#sitPanel', '#nav-widget', '#cesiumContainer', '.mo-bg', '#mob-ov', '#settingsOverlay', '#bdocTicker', '#intel-ticker']) assert.ok(ex.includes(s), s);
  for (const s of ['#gtaWidget', '#battlePanel', '#coaPanel', '#camWallPanel', '#signalsPanel', '#tz-bar', '#cursorCoords']) assert.ok(own.includes(s), s);
  for (const s of ['a', 'button', 'input', 'select', 'textarea', 'iframe', 'video', 'canvas', '[role="tab"]', '[data-nodrag]']) assert.ok(inter.includes(s), s);
  // every id / class named here still exists, so a rename can't silently turn a list entry into a no-op
  for (const s of [...ex, ...own]) {
    const name = s.replace(/^[#.]/, '');
    assert.ok(new RegExp(`(id=["'\`]|id\\s*=\\s*["'\`]|[#.]|class=["'][^"']*\\b|className\\s*=\\s*["'][^"']*\\b|classList\\.add\\(["'])${name.replace(/[-]/g, '\\-')}\\b`).test(ALL), s);
  }
  // the panels that drag themselves really do (their own handle code)
  assert.match(MODS, /_drag\(p\) \{[\s\S]{0,200}\.cw-hd/);
  assert.match(MODS, /_drag\(p\) \{[\s\S]{0,200}\.sg-hd/);
  assert.match(HTML, /function _initBattleDrag\(/);
  assert.match(HTML, /handle=document\.getElementById\('coa-drag-handle'\)/);
});

test('drag: mouse and pen at desktop width only; a drag never turns into a click', () => {
  assert.match(SRC, /if \(e\.pointerType === 'touch' \|\| root\.innerWidth < MIN_DESKTOP \|\| box\.matches\(OWN_DRAG\)\) return;/);
  assert.match(SRC, /if \(!inHandle\(box\.getBoundingClientRect\(\), e\.clientX, e\.clientY\)\) return;/);
  assert.match(SRC, /const hit = t\.closest\(INTERACTIVE\);\s*if \(hit && hit !== box && box\.contains\(hit\)\) return;/);
  assert.match(SRC, /Math\.abs\(d\.x - d\.sx\) < THRESHOLD && Math\.abs\(d\.y - d\.sy\) < THRESHOLD/);
  assert.match(SRC, /root\.addEventListener\('click', eat, true\);/);
  // raising happens for every pointer type, before the drag checks
  assert.match(SRC, /if \(!box\) return;\s*try \{ raise\(box\); \} catch \(_\) \{\}\s*if \(e\.pointerType === 'touch'/);
  // presses on the globe cost one closest() call and nothing else
  assert.match(SRC, /if \(!t \|\| t\.nodeType !== 1 \|\| t\.closest\('#cesiumContainer'\)\) return null;/);
  // all listeners passive or capture-phase; nothing is stopped on the way to the page's own handlers
  assert.doesNotMatch(SRC.replace(/const eat = ev => \{ ev\.stopPropagation\(\); ev\.preventDefault\(\); \};/, ''), /stopPropagation|stopImmediatePropagation/);
  // phone width puts the boxes back on their own layouts
  assert.match(SRC, /const phone = root\.innerWidth < MIN_DESKTOP;[\s\S]{0,200}if \(phone\) \{ restore\(el, POS\); continue; \}/);
});

test('no HTML is built from page text, nothing is evaluated', () => {
  const code = SRC.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|setTimeout\(['"`]/);
});

test('the map info box leaves the globe layer once, and nothing styles it through the globe', () => {
  assert.match(SRC, /doc\.querySelector\('\.cesium-viewer \.cesium-infoBox'\)/);
  assert.match(SRC, /doc\.body\.appendChild\(ib\);/);
  assert.match(SRC, /'\.cesium-infoBox\.bdoc-float-ib\{position:fixed!important;z-index:' \+ INFOBOX_Z \+ '\}'/);
  assert.match(SRC, /if \(doc\.querySelector\('\.bdoc-float-ib'\) \|\| adoptInfoBox\(\)\) return;/);
  // CSS for the info box must not depend on it sitting inside the globe container
  assert.doesNotMatch(CSS + HTML, /(#cesiumContainer|\.cesium-viewer|\.cesium-widget)[^{}]*\.cesium-infoBox/);
  // the globe container is its own stacking layer at z 1, which is why the box had to move
  assert.match(CSS + HTML, /#cesiumContainer\{[^}]*z-index:\s*1\b|id="cesiumContainer"[^>]*z-index:\s*1\b|#cesiumContainer[^{]*\{[^}]*z-index:\s*1\b/);
  // code that reads the info box goes through V.infoBox (frame / viewModel), never its parent
  assert.doesNotMatch(ALL, /\.cesium-infoBox['"]\)\.parent|infoBoxContainer/);
});

test('page wiring and release versions (HANDOFF rule 3)', () => {
  assert.equal((HTML.match(/<script src="js\/bdoc-float\.js\?v=p178"><\/script>/g) || []).length, 1);
  assert.ok(HTML.indexOf('js/bdoc-float.js?v=p178') > HTML.indexOf('js/cesium-init.js'), 'after the globe is set up');
  assert.ok(SW.includes("'/js/bdoc-float.js?v=p178',"));
  // live line while p178 is newest; a "(prev)" line once a later build ships (p179 = v181)
  assert.match(SW, /^(?:\/\/ \(prev\) )?const SW_VERSION = 'bdoc-v180';  \/\/ p178: every floating box/m);
  assert.equal((SW.match(/^const SW_VERSION = /gm) || []).length, 1, 'one live SW_VERSION line');
  assert.match(SW, /^\/\/ \(prev\) const SW_VERSION = 'bdoc-v177';  \/\/ p175:/m);
  // shipped after p176 (v178) and p177 (v179): both stay as (prev) lines, newest first
  assert.match(SW, /^(?:\/\/ \(prev\) )?const SW_VERSION = 'bdoc-v180';[^\n]*\n\/\/ \(prev\) const SW_VERSION = 'bdoc-v179';  \/\/ p177:[^\n]*\n\/\/ \(prev\) const SW_VERSION = 'bdoc-v178';  \/\/ p176:/m);
  // no js/modules change: LazyLoader keeps its build, and it must equal every module ?v=
  const lz = /_version:\s*'([^']+)'/.exec(HTML)[1];
  const mods = [...SW.matchAll(/'\/js\/modules\/[^'?]+\?v=([^']+)'/g)].map(m => m[1]);
  assert.ok(mods.length > 5);
  for (const v of mods) assert.equal(v, lz);
});
