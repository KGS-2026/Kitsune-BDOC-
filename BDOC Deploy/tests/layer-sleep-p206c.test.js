// p206c (W1.1 chunk C) — sleeping layers and clean start.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/bdoc-layer-cull.js'), 'utf8');
const METER = fs.readFileSync(path.join(ROOT, 'js/bdoc-layer-meter.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const DEEP = fs.readFileSync(path.join(ROOT, 'js/deeplink.js'), 'utf8');
const AUTH = fs.readFileSync(path.join(ROOT, 'js/auth.js'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'css/bdoc-layer-meter.css'), 'utf8');

class Entity {
  constructor(o = {}) { Object.assign(this, { show: true, parent: undefined, entityCollection: undefined }, o); }
  get isShowing() { return this.show !== false && (!this.parent || this.parent.isShowing); }
}
const R = Math.PI / 180;
function pt(lon, lat) {
  const c = Math.cos(lat * R), p = { x: c * Math.cos(lon * R), y: c * Math.sin(lon * R), z: Math.sin(lat * R) };
  return new Entity({ position: { isConstant: true, getValue: () => p }, billboard: {} });
}
function rectOf(w, s, e, n) { return { west: w * R, south: s * R, east: e * R, north: n * R }; }

function load({ layers, ents }) {
  const clock = { t: 1e6 };
  const coll = new Set();
  const timers = [];
  const rows = {};
  const V = {
    scene: { globe: { ellipsoid: {} } },
    camera: { computeViewRectangle: () => rectOf(0, 40, 30, 60), moveEnd: { addEventListener() {} } },
    clock: { currentTime: 0 },
    entities: {
      get values() { return [...coll]; },
      contains: e => coll.has(e), add: e => { coll.add(e); e.entityCollection = V.entities; return e; },
      remove: e => { const had = coll.delete(e); if (had) e.entityCollection = undefined; return had; },
      suspendEvents() {}, resumeEvents() {}
    },
    selectedEntity: null, trackedEntity: null
  };
  Object.values(ents).flat().forEach(e => V.entities.add(e));
  const el = ly => rows[ly] || (rows[ly] = { dataset: { layer: ly }, classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); } } });
  const sandbox = {
    console, Math, JSON, Set, WeakMap, Array, Object, Number, String, RegExp,
    Date: { now: () => clock.t },
    setInterval: f => { timers.push(f); return 0; }, setTimeout: f => { f(); return 0; }, clearTimeout() {},
    location: { search: '' },
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      hidden: false,
      querySelectorAll: sel => (sel === '.ly.ly-asleep' ? Object.values(rows).filter(r => r.classList.contains('ly-asleep')) : []),
      querySelector: sel => { const m = /data-layer="([^"]+)"/.exec(sel); return m ? el(m[1]) : null; }
    },
    Cesium: { Entity }, V, layers,
    BDOCLayerMeter: { layerKeys: () => Object.keys(ents), collections: ly => [ents[ly]] }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const tick = () => timers.forEach(f => f());
  return { C: sandbox.BDOCCull, V, clock, tick, el, coll };
}

test('a layer entirely off screen for 2 minutes sleeps: its points leave the collection', () => {
  const a = pt(-100, 40), b = pt(-90, 35);
  const env = load({ layers: { eq: true }, ents: { eq: [a, b] } });
  env.tick();
  assert.ok(a.parent, 'culled first');
  assert.strictEqual(env.C.sleeping('eq'), false);
  env.clock.t += 60000; env.tick();
  assert.strictEqual(env.C.sleeping('eq'), false, 'not yet: 1 minute');
  assert.ok(env.V.entities.contains(a));
  env.clock.t += 61000; env.tick(); // tick runs a pass when the sleep timer is due
  assert.strictEqual(env.C.sleeping('eq'), true);
  assert.ok(!env.V.entities.contains(a) && !env.V.entities.contains(b), 'taken off the globe');
  assert.strictEqual(a.show, true, 'own show untouched');
  assert.ok(env.el('eq').classList.contains('ly-asleep'), 'row marked sleeping');
});

test('a layer with one point on screen never sleeps', () => {
  const a = pt(-100, 40), here = pt(10, 50);
  const env = load({ layers: { eq: true }, ents: { eq: [a, here] } });
  env.tick();
  env.clock.t += 300000; env.C.pass(true);
  assert.strictEqual(env.C.sleeping('eq'), false);
  assert.ok(env.V.entities.contains(a), 'off-screen point is hidden, not removed');
});

test('camera comes back → the layer wakes and its points return', () => {
  const a = pt(-100, 40);
  const env = load({ layers: { eq: true }, ents: { eq: [a] } });
  env.tick(); env.clock.t += 121000; env.tick();
  assert.strictEqual(env.C.sleeping('eq'), true);
  env.V.camera.computeViewRectangle = () => rectOf(-120, 25, -80, 50);
  env.C.pass(true);
  assert.strictEqual(env.C.sleeping('eq'), false);
  assert.ok(env.V.entities.contains(a));
  assert.strictEqual(a.parent, undefined, 'on screen again: drawn');
  assert.ok(!env.el('eq').classList.contains('ly-asleep'));
});

test('points a poll adds while the layer sleeps are put to sleep too', () => {
  const a = pt(-100, 40);
  const arr = [a];
  const env = load({ layers: { eq: true }, ents: { eq: arr } });
  env.tick(); env.clock.t += 121000; env.tick();
  const fresh = pt(-95, 38);
  arr.push(fresh); env.V.entities.add(fresh);
  env.C.pass(true);
  assert.ok(!env.V.entities.contains(fresh));
  assert.strictEqual(env.C.sleeping('eq'), true);
});

test('switching a sleeping layer off leaves its points alone; switching it on brings them back', () => {
  const a = pt(-100, 40);
  const L = { eq: true };
  const env = load({ layers: L, ents: { eq: [a] } });
  env.tick(); env.clock.t += 121000; env.tick();
  L.eq = false; env.C.pass(true);
  assert.ok(!env.V.entities.contains(a), 'an off layer is not touched (its code may have removed them on purpose)');
  assert.strictEqual(env.C.sleeping('eq'), false);
  L.eq = true; env.C.pass(true);
  assert.ok(env.V.entities.contains(a), 'rehydrated on toggle');
  assert.ok(a.parent, '...and culled again, since it is still off screen');
});

test('turning culling off wakes every sleeping layer', () => {
  const a = pt(-100, 40);
  const env = load({ layers: { eq: true }, ents: { eq: [a] } });
  env.tick(); env.clock.t += 121000; env.tick();
  env.C.setEnabled(false);
  assert.ok(env.V.entities.contains(a));
  assert.strictEqual(a.parent, undefined);
  assert.strictEqual(env.C.sleeping('eq'), false);
});

test('meter: sleeping label, asleep count, restore offer', () => {
  assert.match(METER, /C\.sleeping\(r\.layer\)\) parts\.push\('<span class="lym-zz"/);
  assert.match(METER, /' asleep\)'/);
  assert.match(METER, /Restore last layers \('/);
  assert.match(METER, /window\._bdocRestoreArmed = true;/);
  assert.match(METER, /window\.bdocRestoreLayers\(false\)/);
  assert.match(METER, /if \(s\.layersOn > 0\) restoreDismissed = true;/);
  assert.match(CSS, /\.ly\.on\.ly-asleep \.ly-n::after\{content:"  sleeping"/);
});

test('clean start: no automatic restore, no War Room auto-arm, no layers from the address bar on reload', () => {
  assert.match(HTML, /window\._bdocCleanStart=true;/);
  assert.match(HTML, /window\.bdocIsReload=function\(\)\{/);
  assert.ok(!HTML.includes('setTimeout(()=>{window._bdocRestoreArmed=true;bdocRestoreLayers()},2500);'), 'boot no longer restores layers by itself');
  assert.match(HTML, /if\(window\._bdocCleanStart\)return; \/\/ p206c: sessions start clean; War Room/);
  assert.match(HTML, /const layerList=\(window\.bdocIsReload&&bdocIsReload\(\)\)\?\[\]:/);
  assert.match(DEEP, /if \(!\(window\.bdocIsReload && window\.bdocIsReload\(\)\)\) applyLayers\(st\.layers\);/);
  // p188 re-offer only fires once someone asked for a restore
  assert.match(AUTH, /if\(window\._bdocRestoreArmed&&window\.bdocRestoreLayers\)/);
  // layers are still saved, so the restore button has something to offer
  assert.match(HTML, /localStorage\.setItem\('bdoc_layers_on'/);
  assert.match(HTML, /<script src="js\/deeplink\.js\?v=p206c"><\/script>/);
  assert.ok(SW.includes("'/js/deeplink.js?v=p206c'"));
});

test('bdocIsReload reads the navigation type', () => {
  const m = /window\.bdocIsReload=(function\(\)\{[^\n]*\}\});?/.exec(HTML) || /window\.bdocIsReload=(function\(\)\{.*?\}\};)/.exec(HTML);
  const src = /window\.bdocIsReload=(function\(\)\{[\s\S]*?return false\}\})/.exec(HTML)[1];
  const mk = type => vm.runInNewContext('(' + src + ')()', { performance: { getEntriesByType: () => [{ type }] } });
  assert.strictEqual(mk('reload'), true);
  assert.strictEqual(mk('back_forward'), true);
  assert.strictEqual(mk('navigate'), false, 'a fresh visit or a shared link still applies its layers');
  assert.ok(m || src);
});
