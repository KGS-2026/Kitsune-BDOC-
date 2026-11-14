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
// every script the page can load: boxes are also created by the top-level js/*.js files (the FEMA banner is)
const TOP = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js') && f !== 'bdoc-float.js').map(f => read('js/' + f)).join('\n');
const ALL = [HTML, CSS, MODS, TOP].join('\n');

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
  for (const f of ['layerCap', 'overlaps', 'planRaise', 'settlePlan', 'clampRect', 'inHandle']) assert.equal(typeof C[f], 'function', f);
  assert.equal(C.HANDLE_PX, 36); assert.equal(C.THRESHOLD, 4); assert.equal(C.MIN_DESKTOP, 768); assert.equal(C.INFOBOX_Z, 61);
});

test('p186: one stack for every box, under the alert banners and the open menus', () => {
  // p178 had three layers (under 80, 80-99, and the rest with no ceiling): a data panel under the
  // Watchlist (z 200) could not come forward, and a pressed camera viewer went over the FEMA alert
  assert.equal(C.ALERT_Z, 99000);
  for (const z of [0, 56, 61, 79, 80, 99, 100, 200, 10500, 98999]) assert.equal(C.layerCap(z), C.PANEL_TOP, 'z ' + z);
  assert.equal(C.layerCap(99000), Infinity); assert.equal(C.layerCap(99990), Infinity); assert.equal(C.layerCap(2147483000), Infinity);
  assert.ok(C.PANEL_TOP < C.MODAL_Z && C.MODAL_Z < C.MENU_Z && C.MENU_Z < C.ALERT_Z, 'boxes < blocking dialogs < open menus < alerts');
  // the moved info box opens above the data panels (56-60)
  assert.ok(C.INFOBOX_Z > 60 && C.INFOBOX_Z < 80);
});

test('p186: alerts are never raised and never count as covering a panel', () => {
  const fema = { z: 2147483000, order: 99, rect: R(0, 0, 1600, 95) }, outage = { z: 99990, order: 98, rect: R(590, 52, 420, 66) };
  const cam = { z: 10500, natural: 10500, order: 5, rect: R(1120, 0, 480, 1000) };
  assert.equal(C.planRaise(cam, [fema, outage]), null, 'the camera viewer is not lifted over the alerts above it');
  assert.equal(C.planRaise({ z: 99990, natural: 99990, order: 98, rect: outage.rect }, [fema]), null, 'an alert is never re-ordered');
  assert.equal(C.planRaise({ z: 99991, natural: 99991, order: 1, rect: R(0, 0, 500, 500) }, [{ z: 99999, order: 2, rect: R(10, 10, 100, 100) }]), null);
  // the top of the stack: never into the menu or alert range
  assert.deepEqual(C.planRaise({ z: 500, natural: 500, order: 1, rect: R(0, 0, 100, 100) }, [{ z: C.PANEL_TOP, order: 2, rect: R(50, 50, 100, 100) }]), { z: C.PANEL_TOP });
});

test('raise: only when another box covers it, and just above the highest one', () => {
  const me = { z: 56, natural: 56, order: 5, rect: R(884, 110, 340, 500) };
  assert.equal(C.planRaise(me, []), null);
  // the info box (61) over the AOI panel (56): go just above it
  assert.deepEqual(C.planRaise(me, [{ z: 61, order: 90, rect: R(810, 60, 400, 254) }]), { z: 62 });
  // not overlapping: nothing to do
  assert.equal(C.planRaise(me, [{ z: 61, order: 90, rect: R(10, 10, 100, 100) }]), null);
  // already above it
  assert.equal(C.planRaise(me, [{ z: 50, order: 1, rect: R(900, 120, 50, 50) }]), null);
  // same z: the later one in the page is drawn on top, so only a later box covers
  assert.deepEqual(C.planRaise(me, [{ z: 56, order: 9, rect: R(904, 466, 320, 464) }]), { z: 57 });
  assert.equal(C.planRaise(me, [{ z: 56, order: 2, rect: R(904, 466, 320, 464) }]), null);
  // p186: a tool panel (Watchlist 200) or the camera viewer (10500) over a data panel no longer blocks it
  assert.deepEqual(C.planRaise(me, [{ z: 200, order: 9, rect: R(938, 110, 282, 110) }]), { z: 201 });
  assert.deepEqual(C.planRaise(me, [{ z: 10500, order: 9, rect: R(1000, 0, 480, 1000) }, { z: 999, order: 9, rect: R(900, 500, 200, 76) }]), { z: 10501 });
  // the highest cover wins
  assert.deepEqual(C.planRaise(me, [{ z: 57, order: 9, rect: R(800, 400, 660, 500) }, { z: 61, order: 90, rect: R(810, 60, 400, 254) }]), { z: 62 });
});

test('p186 drag: over every other box, covering it or not; alerts apart; settling brings it back down', () => {
  const me = { z: 56, natural: 56, order: 5, rect: R(884, 110, 340, 500) };
  const far = { z: 200, order: 9, rect: R(10, 700, 282, 110) }, tie = { z: 56, order: 9, rect: R(10, 10, 100, 100) };
  assert.equal(C.planRaise(me, [far]), null, 'a press: the Watchlist is nowhere near');
  assert.deepEqual(C.planRaise(me, [far], true), { z: 201 }, 'a drag: over it before it gets there');
  assert.deepEqual(C.planRaise(me, [tie], true), { z: 57 }, 'a later box at the same z counts');
  assert.equal(C.planRaise(me, [{ z: 56, order: 2, rect: tie.rect }, { z: 40, order: 9, rect: tie.rect }], true), null, 'already over them all');
  assert.equal(C.planRaise(me, [{ z: 99999, order: 9, rect: me.rect }], true), null, 'never over an alert');
  assert.deepEqual(C.planRaise(me, [{ z: C.PANEL_TOP, order: 9, rect: tie.rect }], true), { z: C.PANEL_TOP }, 'and never past the ceiling');
  assert.equal(C.planRaise({ z: 99990, natural: 99990, order: 1, rect: me.rect }, [far], true), null, 'an alert is not re-ordered by a drag either');
  // dropped on open map, it settles to its own z; dropped on the Watchlist, just above it
  const boxes = at => [{ z: 201, order: 5, natural: 56, raised: true, rect: at }, { z: 200, order: 9, natural: 200, raised: false, rect: far.rect }];
  assert.deepEqual(C.settlePlan(boxes(R(884, 110, 340, 500))), [56, 200]);
  assert.deepEqual(C.settlePlan(boxes(R(100, 650, 340, 500))), [201, 200]);
});

test('p186 settle: raised boxes drop to the lowest z that keeps what is drawn over what', () => {
  const A = R(0, 0, 100, 100), B = R(50, 50, 100, 100), FAR = R(500, 500, 100, 100);
  // two data panels pressed in turn do not creep: the one underneath goes back to its own z
  assert.deepEqual(C.settlePlan([
    { z: 57, order: 1, natural: 56, raised: true, rect: A },      // pressed earlier
    { z: 58, order: 2, natural: 56, raised: true, rect: B },      // pressed last, on top
  ]), [56, 57]);
  // a panel lifted over the Watchlist (200) stays over it while the Watchlist is there …
  assert.deepEqual(C.settlePlan([
    { z: 200, order: 9, natural: 200, raised: false, rect: B },
    { z: 201, order: 1, natural: 56, raised: true, rect: A },
  ]), [200, 201]);
  // … and comes back down once it is gone (hidden boxes are not in the list)
  assert.deepEqual(C.settlePlan([{ z: 201, order: 1, natural: 56, raised: true, rect: A }]), [56]);
  // never under its own z, never above where it is now, and boxes it does not overlap are ignored
  assert.deepEqual(C.settlePlan([
    { z: 300, order: 1, natural: 300, raised: false, rect: FAR },
    { z: 900, order: 2, natural: 61, raised: true, rect: A },
  ]), [300, 61]);
  // unraised boxes keep their z whatever happens
  assert.deepEqual(C.settlePlan([
    { z: 56, order: 3, natural: 56, raised: false, rect: A },
    { z: 56, order: 4, natural: 56, raised: false, rect: B },
    { z: 70, order: 1, natural: 56, raised: true, rect: A },
  ]), [56, 56, 57]);
  // a chain keeps its order: C over B over A, each just above the one below
  assert.deepEqual(C.settlePlan([
    { z: 500, order: 1, natural: 56, raised: true, rect: A },
    { z: 700, order: 2, natural: 56, raised: true, rect: A },
    { z: 900, order: 3, natural: 60, raised: true, rect: A },
  ]), [56, 57, 60]);
  // same z, later in the page: it stays on top by page order, and settling never raises it
  assert.deepEqual(C.settlePlan([
    { z: 57, order: 1, natural: 57, raised: false, rect: A },
    { z: 57, order: 2, natural: 56, raised: true, rect: A },
  ]), [57, 57]);
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
  // raising happens for every pointer type, before the drag checks (p186 notes a box that drags
  // itself in between, so it can be lifted over the others once it moves)
  assert.match(SRC, /if \(!box\) return;\s*try \{ raise\(box\); \} catch \(_\) \{\}\s*(?:\/\/[^\n]*\n\s*)*S\.own = box\.matches\(OWN_DRAG\) \? \{ box, id: e\.pointerId, sx: e\.clientX, sy: e\.clientY \} : null;\s*if \(e\.pointerType === 'touch'/);
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
  // p178 or later: a later build that changes the file bumps its ?v= (p186 did)
  const tags = [...HTML.matchAll(/<script src="js\/bdoc-float\.js\?v=(p1(?:7[89]|[89]\d)\w*)"><\/script>/g)];
  assert.equal(tags.length, 1);
  assert.ok(HTML.indexOf('js/bdoc-float.js?v=' + tags[0][1]) > HTML.indexOf('js/cesium-init.js'), 'after the globe is set up');
  assert.ok(SW.includes(`'/js/bdoc-float.js?v=${tags[0][1]}',`), 'precached at the same ?v=');
  // live line while p178 is newest; a "(prev)" line once a later build ships
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
