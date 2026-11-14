// p186 — the page side of js/bdoc-float.js, run for real in a small fake page (tests/helpers/fake-dom.js).
// p178 tested only the arithmetic and pinned the rest as source text, so two bugs shipped that a run
// would have shown: the FEMA alert banner (added in p181) could be dragged off the top like any box,
// and one press on a panel above the top bar lifted it over the banner. The fake page was first
// checked against the real browser on those two bugs (same z 2147483001, same 100,288 position).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createPage } = require('./helpers/fake-dom.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/bdoc-float.js'), 'utf8').replace(/\r\n/g, '\n');

// The globe with Cesium's info box inside it, as the page is before bdoc-float.js adopts the box.
// Returns a stand-in for the viewer object V (only what the glue reads).
function globe(win) {
  const cc = win.document.createElement('div'); cc.id = 'cesiumContainer';
  cc.css = { position: 'absolute', 'z-index': '1' };
  win.document.body.appendChild(cc);
  const viewer = win.addChild(cc, 'div', { x: 0, y: 0, w: win.innerWidth, h: win.innerHeight }); viewer.className = 'cesium-viewer';
  const holder = win.addChild(viewer, 'div', { x: 0, y: 0, w: 0, h: 0 }); holder.className = 'cesium-viewer-infoBoxContainer';
  const ib = win.document.createElement('div'); ib.className = 'cesium-infoBox';
  ib.css = { position: 'absolute', top: '60px', right: '390px', width: '400px' }; ib.contentH = 254;
  holder.appendChild(ib);
  ib.title = win.addChild(ib, 'div', { x: 1, y: 1, w: 398, h: 41 }); ib.title.className = 'cesium-infoBox-title';
  const frameDoc = { listeners: [], addEventListener(type, fn) { this.listeners.push({ type, fn }); } };
  const V = {
    loads: [], selected: [],
    infoBox: { frame: { contentDocument: frameDoc, addEventListener(type, fn) { V.loads.push({ type, fn }); } } },
    selectedEntityChanged: { addEventListener(fn) { V.selected.push(fn); } },
  };
  return { cc, ib, frameDoc, V };
}
// the stylesheet the glue injects, applied by hand (the fake page has no CSS engine)
function applyInfoBoxRule(win, ib) {
  const css = win.document.head.children.find(s => s.id === 'bdocFloatCss').textContent;
  const m = /\.cesium-infoBox\.bdoc-float-ib\{position:fixed!important;z-index:(\d+)\}/.exec(css);
  assert.ok(m, 'the info box rule is in the injected stylesheet');
  if (ib.classList.contains('bdoc-float-ib')) { ib.css.position = 'fixed !important'; ib.css['z-index'] = m[1]; }
  return +m[1];
}

// A desktop page with the app's real shapes: top bar, a data panel, the info box, the camera viewer.
function page(opts) {
  const win = createPage(Object.assign({ width: 1600, height: 1000 }, opts));
  if (opts && opts.before) opts.before(win);
  const tb = win.addBox('', { top: '0px', left: '0px', right: '0px', height: '56px', 'z-index': '100' }); tb.className = 'tb';
  const aoi = win.addBox('aoiWatchPanel', { top: '110px', right: '376px', width: '340px', 'z-index': '56' }, { h: 480 });
  const aoiHead = win.addChild(aoi, 'div', { x: 1, y: 1, w: 338, h: 68 });
  const aoiBtn = win.addChild(aoi, 'button', { x: 300, y: 8, w: 30, h: 22 });
  const aoiBody = win.addChild(aoi, 'div', { x: 1, y: 70, w: 338, h: 400 });
  vm.runInContext(SRC, vm.createContext(win), { filename: 'bdoc-float.js' });
  const z = el => win.getComputedStyle(el).zIndex;
  const at = el => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
  const press = (target, x, y, more) => win.fire('pointerdown', Object.assign({ target, clientX: x, clientY: y, buttons: 1 }, more));
  const move = (target, x, y, more) => win.fire('pointermove', Object.assign({ target, clientX: x, clientY: y, buttons: 1 }, more));
  const up = (target, x, y, more) => win.fire('pointerup', Object.assign({ target, clientX: x, clientY: y, buttons: 0 }, more));
  // press at (x, y), move through the points, release at the last one
  const drag = (target, from, ...to) => { press(target, from[0], from[1]); to.forEach(p => move(target, p[0], p[1])); const l = to[to.length - 1]; return up(target, l[0], l[1]); };
  return { win, F: win.BDOCFloat, tb, aoi, aoiHead, aoiBtn, aoiBody, z, at, press, move, up, drag };
}
const banner = win => win.addBox('bdocGovAlert', { top: '0px', left: '0px', right: '0px', 'z-index': '2147483000' }, { h: 95 });
const camera = win => { const c = win.addBox('camPanel', { top: '0px', right: '0px', bottom: '0px', width: '480px', 'z-index': '10500' }); c.body = win.addChild(c, 'div', { x: 0, y: 60, w: 480, h: 900 }); c.head = win.addChild(c, 'div', { x: 0, y: 0, w: 480, h: 40 }); return c; };

test('the glue loads in the fake page and finds the boxes', () => {
  const p = page();
  assert.deepEqual(Object.keys(p.F).sort(), ['boxOf', 'core', 'isBox', 'raise', 'reset']);
  assert.equal(p.F.isBox(p.aoi), true);
  assert.equal(p.F.isBox(p.tb), false, 'the top bar is docked');
  assert.equal(p.F.boxOf(p.aoiBody), p.aoi);
  assert.ok(p.win.document.head.children.some(s => s.id === 'bdocFloatCss'));
  assert.deepEqual(p.at(p.aoi), [884, 110, 340, 480]);
});

test('a title-bar drag moves the box exactly and swallows the click that follows', () => {
  const p = page();
  const ev = p.drag(p.aoiHead, [1000, 120], [1010, 125], [700, 300]);
  assert.deepEqual(p.at(p.aoi), [584, 290, 340, 480]);
  assert.equal(p.aoi.style.getPropertyPriority('left'), 'important');
  assert.equal(p.aoi.style.getPropertyValue('right'), 'auto');
  assert.equal(p.win.document.documentElement.classList.contains('bdoc-float-drag'), false, 'drag class cleared');
  assert.equal(p.win.captured, null, 'pointer capture released');
  assert.equal(ev.type, 'pointerup');
  assert.equal(p.win.fire('click', { target: p.aoiHead }).stopped, true, 'the click after a drag is swallowed');
  p.win.runTimers();
  assert.equal(p.win.fire('click', { target: p.aoiHead }).stopped, false, 'only that one click');
});

test('a press that barely moves is a click, and title-bar controls keep theirs', () => {
  const p = page();
  p.drag(p.aoiHead, [1000, 120], [1002, 122]);                        // under the 4 px threshold
  assert.deepEqual(p.at(p.aoi), [884, 110, 340, 480]);
  assert.equal(p.win.fire('click', { target: p.aoiHead }).stopped, false);
  p.drag(p.aoiBtn, [1190, 125], [900, 400]);                          // starts on a button in the strip
  assert.deepEqual(p.at(p.aoi), [884, 110, 340, 480]);
  p.drag(p.aoiBody, [1000, 300], [700, 500]);                         // starts below the 36 px strip
  assert.deepEqual(p.at(p.aoi), [884, 110, 340, 480]);
});

test('no drag on touch, with another button, or at phone width', () => {
  const p = page();
  p.press(p.aoiHead, 1000, 120, { pointerType: 'touch' }); p.move(p.aoiHead, 700, 300, { pointerType: 'touch' }); p.up(p.aoiHead, 700, 300, { pointerType: 'touch' });
  p.press(p.aoiHead, 1000, 120, { button: 2, buttons: 2 }); p.move(p.aoiHead, 700, 300, { buttons: 2 }); p.up(p.aoiHead, 700, 300, { button: 2 });
  assert.deepEqual(p.at(p.aoi), [884, 110, 340, 480]);
  const q = page({ width: 700, height: 900 });
  q.drag(q.aoiHead, [100, 120], [300, 400]);
  assert.equal(q.aoi.style.cssText, '', 'nothing pinned below 768 px');
});

test('pinning keeps a box where it is and its size: both-edge anchors and centred strips', () => {
  const p = page();
  const cam = camera(p.win);
  assert.deepEqual(p.at(cam), [1120, 0, 480, 1000]);
  p.drag(cam.head, [1300, 10], [1280, 30], [1000, 200]);
  assert.deepEqual(p.at(cam), [820, 190, 480, 1000], 'height held after bottom:auto');
  const strip = p.win.addBox('outageBanner', { top: '52px', left: '50%', transform: 'translateX(-50%)', width: '420px', 'z-index': '99990' }, { h: 66 });
  assert.deepEqual(p.at(strip), [590, 52, 420, 66]);
  p.drag(strip, [700, 60], [710, 70], [800, 160]);
  assert.deepEqual(p.at(strip), [690, 152, 420, 66], 'moved by exactly the drag, no jump when the transform went');
});

test('a box cannot be dragged under the top bar, off the bottom, or off the sides', () => {
  const p = page();
  p.drag(p.aoiHead, [1000, 120], [1000, 100], [1000, -400]);
  assert.equal(p.at(p.aoi)[1], 56, 'stops at the top bar');
  p.drag(p.aoiHead, [1000, 66], [1000, 90], [1000, 5000]);
  assert.equal(p.at(p.aoi)[1], 1000 - 36, 'title bar stays on screen');
  p.drag(p.aoiHead, [1000, 970], [900, 970], [-5000, 970]);
  assert.equal(p.at(p.aoi)[0], 80 - 340, '80 px stays visible');
});

test('p186: the FEMA banner is not a box, and nothing is lifted over it', () => {
  const p = page();
  const b = banner(p.win), head = p.win.addChild(b, 'span', { x: 300, y: 8, w: 400, h: 20 });
  const cam = camera(p.win);
  assert.equal(p.F.isBox(b), false);
  assert.equal(p.F.boxOf(head), null);
  p.drag(head, [400, 12], [420, 60], [500, 300]);
  assert.deepEqual(p.at(b), [0, 0, 1600, 95], 'the banner stays across the top');
  assert.equal(b.style.cssText, '', 'and is never restyled');
  p.press(cam.body, 1320, 500); p.up(cam.body, 1320, 500);
  assert.equal(p.z(cam), '10500', 'a press on the camera viewer under the banner leaves it under the banner');
  assert.equal(p.z(b), '2147483000');
});

test('p186: any bar stretched edge to edge by its own CSS is docked, whatever it is called', () => {
  const p = page();
  const bar = p.win.addBox('someNewStrip', { bottom: '0px', left: '0px', right: '0px', 'z-index': '70' }, { h: 40 });
  assert.equal(p.F.isBox(bar), false);
  p.drag(bar, [400, 970], [400, 900], [400, 500]);
  assert.equal(bar.style.cssText, '');
  // it does not push a data panel up either
  const low = p.win.addBox('lowPanel', { bottom: '10px', left: '300px', width: '300px', 'z-index': '56' }, { h: 200 });
  p.press(low, 400, 900); p.up(low, 400, 900);
  assert.equal(p.z(low), '56');
  // but a wide box the user dragged against both edges is still a box and can be dragged back
  const q = page({ width: 800, height: 900 });
  const wide = q.win.addBox('widePanel', { top: '200px', left: '100px', width: '800px', 'z-index': '56' }, { h: 300 });
  q.drag(wide, [400, 210], [380, 210], [300, 210]);
  assert.deepEqual(q.at(wide), [0, 200, 800, 300]);
  assert.equal(q.F.isBox(wide), true, 'spans the window now, yet still a box');
  q.drag(wide, [400, 210], [420, 210], [460, 260]);
  assert.deepEqual(q.at(wide), [60, 250, 800, 300]);
});

test('p186: alerts keep their own order: never raised, never a reason to raise', () => {
  const p = page();
  const cam = camera(p.win);
  const outage = p.win.addBox('outageBanner', { top: '52px', left: '1100px', width: '420px', 'z-index': '99990' }, { h: 66 });
  const update = p.win.addBox('bdocUpdateBanner', { top: '80px', left: '1150px', width: '300px', 'z-index': '100000' }, { h: 60 });
  p.press(cam.body, 1320, 500); p.up(cam.body, 1320, 500);
  assert.equal(p.z(cam), '10500', 'the outage banner over the viewer does not pull the viewer up');
  p.press(outage, 1120, 100); p.up(outage, 1120, 100);
  assert.equal(p.z(outage), '99990', 'an alert under another alert stays where its code put it');
  assert.equal(outage.style.getPropertyValue('z-index'), '');
  // alerts still drag (the small ones are ordinary boxes for that)
  p.drag(outage, [1120, 60], [1100, 80], [900, 300]);
  assert.deepEqual(p.at(outage), [880, 292, 420, 66]);
});

test('panels above the top bar still order among themselves, under the alerts', () => {
  const p = page();
  const cam = camera(p.win);
  const hud = p.win.addBox('cyberHud', { bottom: '60px', right: '14px', width: '310px', 'z-index': '200' }, { h: 400 });
  p.press(hud, 1400, 700); p.up(hud, 1400, 700);
  assert.equal(p.z(hud), '10501', 'the Cyber panel comes in front of the camera viewer');
  p.press(cam.body, 1200, 300); p.up(cam.body, 1200, 300);
  assert.equal(p.z(cam), '10502');
  assert.ok(+p.z(cam) < p.F.core.ALERT_Z);
});

test('pressing a covered box brings it forward, and z settles instead of creeping', () => {
  const p = page();
  const ib = p.win.addBox('', { top: '60px', right: '390px', width: '400px', 'z-index': '61' }, { h: 254 }); ib.className = 'cesium-infoBox';
  const sig = p.win.addBox('signalsPanel', { top: '466px', right: '376px', width: '320px', 'z-index': '56' }, { h: 464 });
  p.press(p.aoiBody, 1000, 300); p.up(p.aoiBody, 1000, 300);
  assert.equal(p.z(p.aoi), '62', 'just above the info box that covered it');
  let peak = 0;
  for (let i = 0; i < 60; i++) { const el = [p.aoi, sig, ib][i % 3]; p.F.raise(el); peak = Math.max(peak, +p.z(p.aoi), +p.z(sig), +p.z(ib)); }
  assert.ok(peak <= 64, '60 presses in turn stay within a few steps of the panels own z: peak ' + peak);
  p.F.raise(sig);
  assert.ok(+p.z(sig) > +p.z(p.aoi), 'the last one pressed is on top of the panel it overlaps');
});

test('p186: a data panel or the map info box under a tool panel comes forward, then settles back', () => {
  const p = page();
  // the Watchlist opens at z 200 right over AOI Watch (both sit at top 110 px, right of centre)
  const wl = p.win.addBox('watchlistPanel', { top: '110px', right: '380px', width: '282px', 'z-index': '200' }, { h: 110 });
  assert.deepEqual(p.at(wl), [938, 110, 282, 110]);
  p.press(p.aoiBody, 900, 400); p.up(p.aoiBody, 900, 400);
  assert.equal(p.z(p.aoi), '201', 'p178 left it under the Watchlist (its layer stopped at 79)');
  p.press(wl, 1000, 150); p.up(wl, 1000, 150);
  assert.equal(p.z(wl), '202', 'and the Watchlist can come back over it');
  p.press(p.aoiBody, 900, 400); p.up(p.aoiBody, 900, 400);
  assert.equal(p.z(p.aoi), '201', 'pressed in turn, the two swap without climbing');
  assert.equal(p.z(wl), '200');
  assert.equal(wl.style.getPropertyValue('z-index'), '', 'the Watchlist is back on its own z, nothing left inline');
  // the Watchlist closes: at the next press AOI Watch goes back to its own z
  wl.style.setProperty('display', 'none');
  const far = p.win.addBox('farPanel', { top: '700px', left: '300px', width: '200px', 'z-index': '56' }, { h: 100 });
  p.press(far, 350, 750); p.up(far, 350, 750);
  assert.equal(p.z(p.aoi), '56');
  assert.equal(p.aoi.style.getPropertyValue('z-index'), '');
  // the camera viewer (z 10500) is part of the same stack
  const cam = camera(p.win);
  const east = p.win.addBox('eastPanel', { top: '300px', right: '20px', width: '300px', 'z-index': '56' }, { h: 200 });
  p.press(east, 1400, 400); p.up(east, 1400, 400);
  assert.equal(p.z(east), '10501');
  assert.equal(p.z(cam), '10500');
});

test('p186: closing the panel a box was lifted over lets it settle at the next key or click', () => {
  const p = page();
  const wl = p.win.addBox('watchlistPanel', { top: '110px', right: '380px', width: '282px', 'z-index': '200' }, { h: 110 });
  p.press(p.aoiBody, 900, 400); p.up(p.aoiBody, 900, 400);
  assert.equal(p.z(p.aoi), '201');
  p.win.runTimers();
  assert.equal(p.z(p.aoi), '201', 'settling changes nothing while the Watchlist is still there');
  // W closes the Watchlist, W opens it again: it must not come up underneath AOI Watch
  wl.style.setProperty('display', 'none');
  const idle = p.win.pendingTimers();                                  // the wait for the globe (this page has none)
  p.win.fire('keyup', { target: p.win.document.body });
  assert.equal(p.win.pendingTimers(), idle + 1, 'one settle is queued');
  p.win.fire('keyup', { target: p.win.document.body });
  assert.equal(p.win.pendingTimers(), idle + 1, 'and only one');
  p.win.runTimers();
  assert.equal(p.z(p.aoi), '56');
  wl.style.removeProperty('display');
  assert.equal(p.z(wl), '200');
  assert.ok(+p.z(wl) > +p.z(p.aoi), 'reopened, the Watchlist is on top again');
  // with nothing raised, keys and clicks queue nothing at all
  p.win.fire('keyup', { target: p.win.document.body }); p.win.fire('pointerup', { target: p.win.document.body });
  assert.equal(p.win.pendingTimers(), idle);
});

test('p186: a raised box that is closed goes back to its own z', () => {
  const p = page();
  const ib = p.win.addBox('', { top: '60px', right: '390px', width: '400px', 'z-index': '61' }, { h: 254 }); ib.className = 'cesium-infoBox';
  p.press(p.aoiBody, 1000, 300); p.up(p.aoiBody, 1000, 300);
  assert.equal(p.aoi.style.getPropertyValue('z-index'), '62');
  p.aoi.style.setProperty('display', 'none');                           // the layer was switched off
  p.press(ib, 900, 200); p.up(ib, 900, 200);
  assert.equal(p.aoi.style.getPropertyValue('z-index'), '', 'reopened, it starts where its own code puts it');
});

test('p186: menus draw over every box and are never boxes themselves', () => {
  const p = page();
  const css = p.win.document.head.children.find(s => s.id === 'bdocFloatCss').textContent;
  const M = p.F.core.MENU_Z;
  assert.equal(M, 98950);
  assert.ok(css.includes('.tb:has(.menu-drop.show),.tb:has(#searchBar:focus){z-index:' + M + '!important}'), 'the top bar rises with an open menu or the search list');
  assert.ok(css.includes('#battle-ctx{z-index:' + M + '!important}'), 'the right-click menu too');
  const menu = p.win.addBox('battle-ctx', { top: '300px', left: '900px', width: '200px', 'z-index': '200' }, { h: 260 });
  const tip = p.win.addBox('battle-tooltip', { top: '500px', left: '900px', width: '200px', 'z-index': '190' }, { h: 60 });
  assert.equal(p.F.isBox(menu), false); assert.equal(p.F.isBox(tip), false);
  const item = p.win.addChild(menu, 'div', { x: 0, y: 4, w: 200, h: 26 });
  p.drag(item, [950, 315], [960, 330], [700, 600]);
  assert.equal(menu.style.cssText, '', 'a press that slips on the first menu item does not drag the menu away');
  // and a menu never pushes a panel up
  p.press(p.aoiBody, 950, 400); p.up(p.aoiBody, 950, 400);
  assert.equal(p.z(p.aoi), '56');
});

// Found in the real page: with the Watchlist or the COA panel open, the pricing dialog came up with
// those panels drawn across it. All three blocking dialogs (pricing #moBg, PACE #paceBg, sign-in
// #authBg) share the backdrop class .mo-bg at z 200, the z of the tool panels, which come later in
// the page; and the threat widget (999), the camera viewer (10500) and any raised box were over it.
test('p186: the sign-in, pricing and PACE dialogs draw over every box, under what must stay above them', () => {
  const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const CSS = fs.readFileSync(path.join(ROOT, 'css/bdoc.css'), 'utf8');
  const p = page();
  const css = p.win.document.head.children.find(s => s.id === 'bdocFloatCss').textContent;
  const D = p.F.core.MODAL_Z;
  assert.equal(D, 98920);
  assert.ok(css.includes('.mo-bg{z-index:' + D + '!important}'), 'the rule is in the injected stylesheet');
  // what it overrides, and the three dialogs it covers
  assert.match(CSS, /\.mo-bg\{position:fixed;inset:0;z-index:200;/, 'css/bdoc.css still gives the backdrop z 200 (drop the override if this moves)');
  for (const id of ['moBg', 'paceBg', 'authBg']) assert.match(HTML, new RegExp('<div class="mo-bg" id="' + id + '"'), id);
  // no box reaches it: the highest z a pressed or dragged box can get is below
  assert.ok(p.F.core.PANEL_TOP < D);
  const cam = p.win.addBox('camPanel', { top: '0px', left: '1000px', width: '480px', 'z-index': '10500' }, { h: 1000 });
  const top = p.win.addBox('x', { top: '100px', left: '100px', width: '300px', 'z-index': String(p.F.core.PANEL_TOP) }, { h: 200 });
  p.press(p.aoiHead, 1000, 120); p.move(p.aoiHead, 600, 300);
  assert.equal(p.z(p.aoi), String(p.F.core.PANEL_TOP), 'a dragged box stops at the ceiling');
  p.up(p.aoiHead, 600, 300);
  assert.ok(+p.z(p.aoi) < D && +p.z(cam) < D && +p.z(top) < D);
  // a dialog is never a box (never dragged, never a reason to raise)
  const dlg = p.win.addBox('moBg', { top: '0px', left: '0px', right: '0px', bottom: '0px', 'z-index': String(D) }); dlg.className = 'mo-bg show';
  assert.equal(p.F.isBox(dlg), false);
  // above it by their own z: the promo-code dialog the pricing dialog opens, the thank-you after
  // checkout, the outage / update banners, the FEMA alert
  for (const id of ['promoBg', 'stripeThanksBg']) {
    const m = new RegExp("\\.id='" + id + "';\\s*\\w+\\.style\\.cssText='position:fixed;inset:0;[^']*z-index:(\\d+)").exec(HTML);
    assert.ok(m, id + ' found'); assert.ok(+m[1] > D, id + ' at ' + m[1]);
  }
  assert.ok(p.F.core.ALERT_Z > D && p.F.core.MENU_Z > D);
});

test('boxes that drag themselves are raised but never dragged by this code', () => {
  const p = page();
  const cw = p.win.addBox('camWallPanel', { bottom: '70px', left: '264px', width: '660px', 'z-index': '57' }, { h: 545 });
  const ib = p.win.addBox('', { top: '300px', left: '500px', width: '400px', 'z-index': '61' }, { h: 300 }); ib.className = 'cesium-infoBox';
  p.drag(cw, [400, 395], [420, 420], [600, 600]);
  assert.equal(cw.style.getPropertyValue('left'), '', 'position untouched: Cam Wall moves itself');
  assert.equal(p.z(cw), '62', 'but it did come to the front');
});

// Found in the real page while checking p186: the Watchlist dragged on to the COA panel (same z, later
// in the page) ended up underneath it. A press lifts a box only over what covers it at that moment,
// which is nothing when the drag starts on open map. Live since p178.
test('p186: a box dragged across another is over it while it moves and where it lands', () => {
  const p = page();
  const sig = p.win.addBox('signalsPanel', { top: '110px', left: '100px', width: '320px', 'z-index': '56' }, { h: 400 });       // same z as AOI Watch, later in the page
  const wl = p.win.addBox('watchlistPanel', { top: '700px', left: '900px', width: '282px', 'z-index': '200' }, { h: 110 });
  const toast = p.win.addBox('alertToast', { top: '400px', left: '600px', width: '300px', 'z-index': '99999' }, { h: 60 });   // an alert: never part of this
  assert.deepEqual(p.at(p.aoi), [884, 110, 340, 480]);
  p.press(p.aoiHead, 1000, 120);
  assert.equal(p.aoi.style.getPropertyValue('z-index'), '', 'a press on a box nothing covers changes nothing');
  p.move(p.aoiHead, 1001, 121);
  assert.equal(p.aoi.style.getPropertyValue('z-index'), '', 'nor does a move under the drag threshold');
  p.move(p.aoiHead, 900, 125);
  assert.equal(p.z(p.aoi), '201', 'the drag starts: over every other box, alerts apart');
  p.move(p.aoiHead, 300, 160); p.win.runFrames();
  assert.equal(p.z(p.aoi), '201');
  // dropped on the Signals panel: stays over it, at the lowest z that does so
  p.up(p.aoiHead, 300, 160);
  assert.deepEqual(p.at(p.aoi), [184, 150, 340, 480]);
  assert.equal(p.z(p.aoi), '57', 'p178 left it at 56, under the panel it was dropped on');
  assert.equal(p.z(sig), '56'); assert.equal(p.z(wl), '200'); assert.equal(p.z(toast), '99999');
  // dragged on to the Watchlist, far above its own z
  p.drag(p.aoiHead, [300, 160], [400, 200], [966, 660]);
  assert.deepEqual(p.at(p.aoi), [850, 650, 340, 480]);
  assert.equal(p.z(p.aoi), '201', 'over the Watchlist it now lies on');
  // and dropped on open map: its own z again, nothing left behind
  p.drag(p.aoiHead, [966, 660], [900, 600], [616, 210]);
  assert.deepEqual(p.at(p.aoi), [500, 200, 340, 480]);
  assert.equal(p.aoi.style.getPropertyValue('z-index'), '', 'back on its own z');
  assert.equal(p.z(p.aoi), '56');
  p.win.runTimers();
  assert.equal(p.z(p.aoi), '56'); assert.equal(p.z(wl), '200'); assert.equal(p.z(sig), '56');
});

test('p186: a drag that ends by losing the window still settles the box', () => {
  const p = page();
  const wl = p.win.addBox('watchlistPanel', { top: '800px', left: '100px', width: '282px', 'z-index': '200' }, { h: 110 });
  p.press(p.aoiHead, 1000, 120); p.move(p.aoiHead, 900, 300);
  assert.equal(p.z(p.aoi), '201');
  p.win.fire('blur');
  assert.deepEqual(p.at(p.aoi), [784, 290, 340, 480]);
  assert.equal(p.aoi.style.getPropertyValue('z-index'), '', 'no box under it where it stopped: its own z');
  assert.equal(p.z(wl), '200');
  // and one that stops on a box stays over it
  p.press(p.aoiHead, 900, 300); p.move(p.aoiHead, 300, 700);
  p.win.fire('blur');
  assert.deepEqual(p.at(p.aoi), [184, 690, 340, 480]);
  assert.equal(p.z(p.aoi), '201', 'it stopped on the Watchlist');
});

test('p186: a box that drags itself goes over the others once it moves, and settles after the release', () => {
  const p = page();
  const cw = p.win.addBox('camWallPanel', { bottom: '70px', left: '264px', width: '660px', 'z-index': '57' }, { h: 545 });
  const wl = p.win.addBox('watchlistPanel', { top: '110px', left: '1300px', width: '282px', 'z-index': '200' }, { h: 110 });
  assert.deepEqual(p.at(cw), [264, 385, 660, 545]);
  p.press(cw, 400, 395);
  assert.equal(cw.style.getPropertyValue('z-index'), '', 'press: nothing covers it');
  p.move(cw, 402, 396);
  assert.equal(cw.style.getPropertyValue('z-index'), '', 'a move under the threshold is not a drag');
  p.move(cw, 420, 420);
  assert.equal(p.z(cw), '201', 'moving: over every other box');
  assert.equal(cw.style.getPropertyValue('left'), '', 'where it goes is still its own business');
  p.move(cw, 500, 500);
  assert.equal(p.z(cw), '201');
  // a key pressed during the drag (Shift, an arrow) must not drop it back under the others
  p.win.fire('keyup'); p.win.runTimers();
  assert.equal(p.z(cw), '201', 'still lifted while the button is down');
  // released where it started (its own code did not move it): back to its own z
  p.up(cw, 500, 500); p.win.runTimers();
  assert.equal(cw.style.getPropertyValue('z-index'), '');
  // moved by its own code on to the Watchlist: it stays over it
  p.press(cw, 400, 395); p.move(cw, 1036, 90);
  cw.style.setProperty('left', '900px'); cw.style.setProperty('top', '80px'); cw.style.setProperty('bottom', 'auto');
  p.up(cw, 1036, 90); p.win.runTimers();
  assert.deepEqual(p.at(cw), [900, 80, 660, 545]);
  assert.equal(p.z(cw), '201', 'just above the Watchlist it was dropped on');
  // a press that only clicks (no movement) never lifts anything
  const sig = p.win.addBox('signalsPanel', { top: '700px', left: '100px', width: '320px', 'z-index': '56' }, { h: 200 }); sig.className = 'x';
  p.press(sig, 150, 710); p.up(sig, 150, 710); p.win.runTimers();
  assert.equal(sig.style.getPropertyValue('z-index'), '');
  // the mouse button came up where the page could not see it: the next move is not a drag
  cw.style.setProperty('left', '264px'); cw.style.setProperty('top', '385px'); p.win.fire('keyup'); p.win.runTimers();
  assert.equal(cw.style.getPropertyValue('z-index'), '', 'moved off the Watchlist by its own code: settled at the next key');
  p.press(cw, 400, 395); p.move(cw, 600, 600, { buttons: 0 });
  assert.equal(cw.style.getPropertyValue('z-index'), '');
  p.move(cw, 700, 700);
  assert.equal(cw.style.getPropertyValue('z-index'), '', 'the watch ended with the press');
});

test('p186: a drag ends when the button is already up or the window loses focus', () => {
  const p = page();
  // armed but not started: the release was never seen, then the mouse moves with no button held
  p.press(p.aoiHead, 1000, 120);
  p.win.fire('pointermove', { target: p.aoiHead, clientX: 700, clientY: 400, buttons: 0 });
  assert.deepEqual(p.at(p.aoi), [884, 110, 340, 480], 'the box does not follow a mouse with no button held');
  p.move(p.aoiHead, 600, 300);                                         // later moves with a button held are a new gesture, not this drag
  assert.deepEqual(p.at(p.aoi), [884, 110, 340, 480]);
  // started, then the button comes up out of sight: the box stays where it was last placed
  p.press(p.aoiHead, 1000, 120); p.move(p.aoiHead, 950, 150);
  p.win.fire('pointermove', { target: p.aoiHead, clientX: 200, clientY: 800, buttons: 0 });
  assert.deepEqual(p.at(p.aoi), [834, 140, 340, 480]);
  assert.equal(p.win.document.documentElement.classList.contains('bdoc-float-drag'), false);
  assert.equal(p.win.fire('click', { target: p.aoiHead }).stopped, false, 'no click is swallowed after a cancelled drag');
  // window blur mid-drag
  p.press(p.aoiHead, 950, 150); p.move(p.aoiHead, 900, 200);
  p.win.fire('blur');
  p.move(p.aoiHead, 100, 900);
  assert.deepEqual(p.at(p.aoi), [784, 190, 340, 480]);
  assert.equal(p.win.document.documentElement.classList.contains('bdoc-float-drag'), false);
});

test('p186: with the alert banner up, no title bar can be parked under it', () => {
  const p = page();
  banner(p.win);
  const cam = camera(p.win);
  p.drag(p.aoiHead, [1000, 120], [1000, 100], [1000, -300]);
  assert.equal(p.at(p.aoi)[1], 95, 'a data panel stops under the banner (the banner covers the top bar)');
  p.drag(cam.head, [1300, 10], [1280, 40], [1000, -300]);
  assert.equal(p.at(cam)[1], 95, 'and so does a panel that normally may sit over the top bar');
  // no banner: every box stops at the top bar, the camera viewer included (it opens over the bar,
  // but once dragged its title bar stays reachable under it)
  const q = page();
  const c2 = camera(q.win);
  q.drag(c2.head, [1300, 10], [1280, 40], [1000, -300]);
  assert.equal(q.at(c2)[1], 56);
  // Clean View hides the top bar (opacity 0): nothing to stay under
  q.tb.style.setProperty('opacity', '0');
  q.drag(q.aoiHead, [1000, 120], [1000, 100], [1000, -300]);
  assert.equal(q.at(q.aoi)[1], 0);
});

test('reset() and phone width put a box back exactly, z-index included', () => {
  const p = page();
  const ib = p.win.addBox('', { top: '60px', right: '390px', width: '400px', 'z-index': '61' }, { h: 254 }); ib.className = 'cesium-infoBox';
  p.aoi.style.setProperty('display', 'block');                          // the panel's own inline style must survive
  p.drag(p.aoiHead, [1000, 120], [1010, 125], [700, 300]);
  assert.equal(p.z(p.aoi), '62');
  p.F.reset();
  assert.deepEqual(p.at(p.aoi), [884, 110, 340, 480]);
  assert.equal(p.z(p.aoi), '56');
  assert.equal(p.aoi.style.cssText, 'display: block;');
  // phone width: position back to the panel's own layout, on resize
  p.drag(p.aoiHead, [1000, 120], [1010, 125], [700, 300]);
  p.win.resize(700, 900); p.win.runTimers();
  assert.equal(p.aoi.style.getPropertyValue('left'), '');
  assert.equal(p.aoi.style.getPropertyValue('top'), '');
});

test('p186: Reset Panel Positions also sends home the boxes that drag themselves', () => {
  const p = page();
  // the Battle Tracker panel: its own mousedown code rewrites left / top / transform after our pointerdown
  const bp = p.win.addBox('battlePanel', { top: '120px', left: '50%', transform: 'translateX(-50%)', width: '500px', 'z-index': '100' }, { h: 300 });
  bp.style.setProperty('display', 'flex');
  assert.deepEqual(p.at(bp), [550, 120, 500, 300]);
  p.press(bp, 700, 130);
  bp.style.setProperty('transform', 'none'); bp.style.setProperty('left', '200px'); bp.style.setProperty('top', '400px'); bp.style.setProperty('bottom', 'auto'); bp.style.setProperty('right', 'auto');
  p.up(bp, 350, 410);
  assert.deepEqual(p.at(bp), [200, 400, 500, 300]);
  // the coordinate readout drags itself too and is too small to be a box here (26 px high)
  const cc = p.win.addBox('cursorCoords', { top: '68px', left: '262px', width: '281px', 'z-index': '55' }, { h: 26 });
  assert.equal(p.F.isBox(cc), false);
  p.press(cc, 300, 80); cc.style.setProperty('left', '900px'); cc.style.setProperty('top', '500px'); p.up(cc, 940, 512);
  // Cam Wall, Signals and the time-zone bar keep their own saved places
  const cw = p.win.addBox('camWallPanel', { bottom: '70px', left: '264px', width: '660px', 'z-index': '57' }, { h: 545 });
  cw.style.setProperty('left', '40px'); cw.style.setProperty('top', '90px'); cw.style.setProperty('bottom', 'auto');   // _placeSaved at open
  let saves = 0;
  p.win.CamWall = { pos: { x: 40, y: 90 }, panel: cw, _save() { saves++; } };
  p.win.SignalsWatch = { pos: null, panel: null, _save() { saves += 100; } };
  const tz = p.win.addBox('tz-bar', { top: '52px', right: '14px', width: '300px', 'z-index': '150' }, { h: 28 });
  tz.style.setProperty('top', '300px'); tz.style.setProperty('right', '500px');
  p.win.localStorage.setItem('bdoc_tzbar_pos', '{"top":300,"right":500}');
  p.drag(p.aoiHead, [1000, 120], [1010, 125], [700, 300]);

  p.F.reset();
  assert.deepEqual(p.at(bp), [550, 120, 500, 300], 'Battle Tracker panel back on its own CSS');
  assert.equal(bp.style.cssText, 'display: flex;', 'only what the drag wrote is undone');
  assert.deepEqual(p.at(cc), [262, 68, 281, 26]);
  assert.deepEqual(p.at(cw), [264, 385, 660, 545]);
  assert.equal(p.win.CamWall.pos, null); assert.equal(saves, 1, 'Cam Wall saved its cleared place; Signals had none');
  assert.deepEqual(p.at(tz), [1286, 52, 300, 28]);
  assert.equal(p.win.localStorage.getItem('bdoc_tzbar_pos'), null);
  assert.deepEqual(p.at(p.aoi), [884, 110, 340, 480]);
  // a second reset with nothing moved changes nothing and does not throw
  assert.doesNotThrow(() => p.F.reset());
  assert.deepEqual(p.at(bp), [550, 120, 500, 300]);
});

test('a smaller window pulls a dragged box back into reach', () => {
  const p = page();
  p.drag(p.aoiHead, [1000, 120], [1010, 125], [1500, 900]);
  assert.deepEqual(p.at(p.aoi), [1384, 890, 340, 480]);
  p.win.resize(1000, 700); p.win.runTimers();
  assert.deepEqual(p.at(p.aoi), [920, 664, 340, 480], '80 px and the title bar stay on screen');
});

test('the map info box leaves the globe layer for <body>, drags, and comes forward when opened', () => {
  let g;
  const p = page({ before: win => { g = globe(win); win.V = g.V; } });
  assert.equal(g.ib.parentElement, p.win.document.body, 'adopted on the first look, the viewer was ready');
  assert.equal(g.ib.classList.contains('bdoc-float-ib'), true);
  assert.equal(applyInfoBoxRule(p.win, g.ib), 61);
  assert.equal(p.F.isBox(g.ib), true);
  assert.deepEqual(p.at(g.ib), [810, 60, 400, 254]);
  assert.equal(p.F.boxOf(g.cc), null, 'the globe itself is never a box');
  // listeners: one on frame load, one on selection, one inside the frame document (bound once per document)
  assert.equal(g.V.loads.length, 1); assert.equal(g.V.loads[0].type, 'load');
  assert.equal(g.V.selected.length, 1);
  assert.equal(g.frameDoc.listeners.length, 1); assert.equal(g.frameDoc.listeners[0].type, 'pointerdown');
  g.V.loads[0].fn();
  assert.equal(g.frameDoc.listeners.length, 1, 'the same frame document is not bound twice');
  // AOI Watch overlaps the box: pressing AOI raises it over the box; opening a map item raises the box back
  p.press(p.aoiBody, 1000, 300); p.up(p.aoiBody, 1000, 300);
  assert.equal(p.z(p.aoi), '62');
  p.win.runTimers();                                                    // the settle that follows a click
  g.V.selected[0](undefined); assert.equal(p.win.pendingTimers(), 0, 'closing the box schedules nothing');
  g.V.selected[0]({ id: 'entity' }); p.win.runTimers();
  assert.equal(p.z(g.ib), '63', 'the box you just opened is in front');
  // a press inside the description frame raises it too
  p.press(p.aoiBody, 1000, 300); p.up(p.aoiBody, 1000, 300);
  assert.equal(p.z(p.aoi), '62', 'settled: the two swap, they do not climb');
  assert.equal(p.z(g.ib), '61');
  g.frameDoc.listeners[0].fn();
  assert.equal(p.z(g.ib), '63');
  // and it drags by its title bar like any box
  p.drag(g.ib.title, [1000, 75], [990, 90], [600, 400]);
  assert.deepEqual(p.at(g.ib), [410, 385, 400, 254]);
});

test('the info box is adopted later if the globe is not ready when the page loads', () => {
  let g;
  const p = page({ before: win => { g = globe(win); } });              // no V yet
  assert.notEqual(g.ib.parentElement, p.win.document.body);
  assert.equal(p.win.pendingTimers(), 1, 'one poll is waiting');
  p.win.runTimers();
  assert.notEqual(g.ib.parentElement, p.win.document.body, 'still no viewer: keep waiting');
  p.win.V = g.V;
  p.win.runTimers();
  assert.equal(g.ib.parentElement, p.win.document.body);
  assert.equal(p.win.pendingTimers(), 0, 'the poll stops once the box is adopted');
});

test('a box removed mid-drag does not break the page', () => {
  const p = page();
  p.press(p.aoiHead, 1000, 120); p.move(p.aoiHead, 900, 200);
  p.aoi.remove();
  assert.doesNotThrow(() => { p.move(p.aoiHead, 800, 300); p.win.runFrames(); p.up(p.aoiHead, 800, 300); p.win.runTimers(); });
  assert.equal(p.win.document.documentElement.classList.contains('bdoc-float-drag'), false);
  assert.doesNotThrow(() => { p.win.resize(1200, 800); p.win.runTimers(); });
});
