// p206b (W1.1 chunk B) — off-screen culling: geometry, what may be culled, the hidden-parent trick,
// aircraft regions on screen only, and the wiring.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/bdoc-layer-cull.js'), 'utf8');
const METER = fs.readFileSync(path.join(ROOT, 'js/bdoc-layer-meter.js'), 'utf8');
const AIR = fs.readFileSync(path.join(ROOT, 'js/modules/layers-air.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');

// A tiny stand-in for the bits of Cesium the culler uses. Entity.isShowing follows Cesium's rule:
// own show AND parent's isShowing.
class Entity {
  constructor(o = {}) { Object.assign(this, { show: true, parent: undefined }, o); }
  get isShowing() { return this.show !== false && (!this.parent || this.parent.isShowing); }
}
const R = Math.PI / 180;
function ecef(lon, lat) { const c = Math.cos(lat * R); return { x: c * Math.cos(lon * R), y: c * Math.sin(lon * R), z: Math.sin(lat * R) }; }
function pt(lon, lat, extra) { const p = ecef(lon, lat); return new Entity(Object.assign({ position: { isConstant: true, getValue: () => p }, billboard: {} }, extra)); }

function load({ rect, layers, ents, search = '', store = {} }) {
  const timers = [];
  const camListeners = [];
  const view = rect ? { west: rect[0] * R, south: rect[1] * R, east: rect[2] * R, north: rect[3] * R } : undefined;
  const V = {
    scene: { globe: { ellipsoid: {} } },
    camera: { computeViewRectangle: () => view, moveEnd: { addEventListener: f => camListeners.push(f) } },
    clock: { currentTime: 0 },
    entities: { values: [], suspendEvents() {}, resumeEvents() {} },
    selectedEntity: null, trackedEntity: null
  };
  const sandbox = {
    console, Math, JSON, Set, WeakMap, Array, Object, Date, Number, String, RegExp,
    setInterval: f => { timers.push(f); return 0; }, setTimeout: f => { f(); return 0; }, clearTimeout() {},
    location: { search },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: { hidden: false },
    Cesium: { Entity },
    V, layers,
    BDOCLayerMeter: { layerKeys: () => Object.keys(ents), collections: ly => [ents[ly]] }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { C: sandbox.BDOCCull, V, timers, camListeners, store };
}

test('page loads the culler right after the meter; service worker caches it', () => {
  const m = HTML.indexOf('<script src="js/bdoc-layer-meter.js?v=p206"></script>');
  const c = HTML.indexOf('<script src="js/bdoc-layer-cull.js?v=p206"></script>');
  assert.ok(m > 0 && c > m, 'cull must load after the meter (it reads BDOCLayerMeter.collections)');
  assert.ok(SW.includes("'/js/bdoc-layer-cull.js?v=p206'"));
  assert.match(METER, /collections,\n\s*layerKeys:/);
});

test('geometry: view box, antimeridian, boxes and circles', () => {
  const { C } = load({ rect: null, layers: {}, ents: {} });
  const { inViewOf, boxInViewOf, circleInViewOf, lonRangesOverlap } = C._test;
  const eu = { w: -10, s: 35, e: 30, n: 60 };
  assert.ok(inViewOf(eu, 2, 48));
  assert.ok(!inViewOf(eu, -74, 40));
  assert.ok(inViewOf(null, -74, 40), 'no view = everything counts as on screen');
  const pac = { w: 170, s: -10, e: -170, n: 10 }; // crosses the antimeridian
  assert.ok(inViewOf(pac, 179, 0) && inViewOf(pac, -179, 0));
  assert.ok(!inViewOf(pac, 0, 0));
  assert.ok(boxInViewOf(eu, [25, 40, 45, 50]), 'partly overlapping box');
  assert.ok(!boxInViewOf(eu, [100, 0, 120, 20]));
  assert.ok(boxInViewOf(pac, [175, -5, 178, 5]));
  assert.ok(lonRangesOverlap(170, -170, -175, -172));
  assert.ok(circleInViewOf(eu, 50, 15, 200 / 60), 'EUCOM aircraft region');
  assert.ok(!circleInViewOf(eu, -25, 135, 250 / 60), 'AUSTRALIA region');
});

test('what may be culled: points yes; lines, areas and circles no', () => {
  const { C } = load({ rect: null, layers: {}, ents: {} });
  const { cullable } = C._test;
  assert.ok(cullable(pt(0, 0)));
  assert.ok(!cullable(new Entity({ polyline: {} })), 'no position');
  assert.ok(!cullable(pt(0, 0, { ellipse: {} })), 'circle around a point crosses the edge');
  assert.ok(!cullable(pt(0, 0, { polygon: {} })));
  assert.ok(!cullable(pt(0, 0, { parent: new Entity() })), "someone else's parent: leave it");
});

test('off-screen points hang under a hidden parent; show is never touched', () => {
  const inView = pt(10, 50), outView = pt(-100, 40), line = new Entity({ polyline: {} }), filtered = pt(-100, 41, { show: false });
  const { C, timers } = load({ rect: [0, 40, 30, 60], layers: { eq: true }, ents: { eq: [inView, outView, line, filtered] } });
  timers.forEach(f => f()); // first tick: layer state changed → full pass
  assert.strictEqual(inView.parent, undefined);
  assert.ok(outView.parent && outView.parent.show === false, 'off screen → hidden parent');
  assert.strictEqual(outView.show, true, 'own show untouched');
  assert.strictEqual(outView.isShowing, false);
  assert.strictEqual(line.parent, undefined);
  assert.strictEqual(filtered.show, false, "a layer's own filter stays as it was");
  assert.strictEqual(C.stats().eq.culled, 2);
});

test('camera comes back → point is drawn again; layer off → culler lets go', () => {
  const far = pt(-100, 40);
  const L = { eq: true };
  const env = load({ rect: [0, 40, 30, 60], layers: L, ents: { eq: [far] } });
  env.timers.forEach(f => f());
  assert.ok(far.parent);
  // Pan to North America: rebuild the sandbox camera rect and run a pass
  env.V.camera.computeViewRectangle = () => ({ west: -120 * R, south: 25 * R, east: -80 * R, north: 50 * R });
  env.C.pass(true);
  assert.strictEqual(far.parent, undefined);
  env.V.camera.computeViewRectangle = () => ({ west: 0, south: 40 * R, east: 30 * R, north: 60 * R });
  env.C.pass(true);
  assert.ok(far.parent);
  L.eq = false;
  env.C.pass(true);
  assert.strictEqual(far.parent, undefined, 'a layer that is off is not managed');
});

test('whole globe in view, or looking at the sky → nothing is culled', () => {
  const far = pt(-100, 40);
  const sky = load({ rect: null, layers: { eq: true }, ents: { eq: [far] } });
  sky.C.pass(true);
  assert.strictEqual(far.parent, undefined);
  const globe = load({ rect: [-180, -80, 180, 80], layers: { eq: true }, ents: { eq: [far] } });
  globe.C.pass(true);
  assert.strictEqual(far.parent, undefined);
});

test('selected and tracked entities are never culled; satellites are skipped', () => {
  const sel = pt(-100, 40), sat = pt(-100, 40);
  const env = load({ rect: [0, 40, 30, 60], layers: { eq: true, sat: true }, ents: { eq: [sel], sat: [sat] } });
  env.V.selectedEntity = sel;
  env.C.pass(true);
  assert.strictEqual(sel.parent, undefined);
  assert.strictEqual(sat.parent, undefined);
});

test('off switch: ?cull=0, or setEnabled(false) unhides everything and is remembered', () => {
  const far = pt(-100, 40);
  const off = load({ rect: [0, 40, 30, 60], layers: { eq: true }, ents: { eq: [far] }, search: '?cull=0' });
  off.C.pass(true);
  assert.strictEqual(far.parent, undefined);
  assert.strictEqual(off.C.isEnabled(), false);
  const far2 = pt(-100, 40);
  const on = load({ rect: [0, 40, 30, 60], layers: { eq: true }, ents: { eq: [far2] } });
  on.C.pass(true);
  assert.ok(far2.parent);
  on.C.setEnabled(false);
  assert.strictEqual(far2.parent, undefined);
  assert.strictEqual(on.store.bdoc_cull, '0');
  assert.strictEqual(on.C.boxInView([100, 0, 120, 20]), true, 'off = everything counts as on screen');
});

test('view-change listeners fire after the camera settles', () => {
  const env = load({ rect: [0, 40, 30, 60], layers: {}, ents: {} });
  env.timers.forEach(f => f()); // hooks camera.moveEnd
  let got = null;
  env.C.onViewChange(v => { got = v; });
  env.V.camera.computeViewRectangle = () => ({ west: -120 * R, south: 25 * R, east: -80 * R, north: 50 * R });
  env.camListeners.forEach(f => f());
  assert.ok(got && got.w < -120 && got.e > -80, 'view includes the margin');
});

test('aircraft poll only the regions on screen (all of them while Force Track is on)', () => {
  assert.match(AIR, /function _airRegionsInView\(\)\{/);
  assert.match(AIR, /if\(!C\|\|!C\.isEnabled\(\)\|\|layers\.forcetrack\)return CFG\.regions\.slice\(\);/);
  assert.match(AIR, /Promise\.allSettled\(_regions\.map\(async reg=>\{/);
  assert.ok(!/Promise\.allSettled\(CFG\.regions\.map/.test(AIR), 'loadAircraft no longer fetches every region');
  assert.match(AIR, /if\(!_regions\.length\)return;/);
  assert.match(AIR, /BDOCCull\.onViewChange\(/);
  assert.match(AIR, /AIRCRAFT FEED: all '\+_regions\.length\+' regions returned 0/);
});

test('meter counts drawn by isShowing (respects the hidden parent) and loaded by show', () => {
  assert.match(METER, /const isDrawn = e => \(typeof e\.isShowing === 'boolean' \? e\.isShowing : e\.show !== false\);/);
  assert.match(METER, /Off-screen culling: /);
});
