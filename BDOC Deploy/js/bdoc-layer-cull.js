// p206b (master plan W1.1 chunk B): viewport culling.
//
// Points that are off screen (outside the camera's view plus a margin) stop being drawn. When the
// camera comes back they reappear. Only point-like things are culled: an entity with a position and
// no line / polygon / circle. Lines and areas cross the screen edge, so they are left alone.
//
// How it hides without fighting the layers: every layer turns its own entities on and off with
// entity.show (toggles, filters, the aircraft refresh sets show on every update). The culler never
// touches show. It hangs an off-screen entity under one hidden parent entity instead; Cesium draws
// an entity only when it AND its parent are showing. Back on screen → parent removed. So a layer
// toggle, a filter, or a refresh can't be undone by the culler and can't undo it.
//
// Also exposed for the layers that poll by area (aircraft regions, AIS ship stream):
//   BDOCCull.view()                  → {w,s,e,n} in degrees incl. margin, or null (whole globe / sky)
//   BDOCCull.inView(lon, lat)
//   BDOCCull.boxInView([w,s,e,n])
//   BDOCCull.circleInView(lat, lon, radiusDeg)
//   BDOCCull.onViewChange(fn)        → fn(view) after the camera settles
// Off switch: ?cull=0 in the URL, or the "Off-screen culling" button in the LOAD breakdown
// (remembered in localStorage bdoc_cull=0).
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const MARGIN = 0.25;        // add a quarter of the view's width/height on every side
  const MIN_MARGIN_DEG = 2;   // ...but at least 2°, so zoomed-in views still pre-load the edges
  const MOVING = ['air', 'forcetrack', 'vessels', 'darkships']; // positions change: re-check every few s
  const SKIP = { sat: 1 };    // satellites move ~7 km/s and carry orbit lines; culling them would flicker
  const PASS_MS = 1000;       // light check each second; full pass when something changed
  const MOVING_PASS_MS = 5000;

  let enabled = true;
  try { if (/[?&]cull=0\b/.test(location.search) || localStorage.getItem('bdoc_cull') === '0') enabled = false; } catch (_) {}

  let HIDE = null;            // the hidden parent
  let lastView = null;
  let lastSig = '';
  let lastFull = 0;
  const listeners = [];
  const stats = {};           // layer → {culled, considered}
  const posCache = new WeakMap(); // entity → [lon, lat] for entities whose position never changes

  function viewer() { return window.V && window.V.scene ? window.V : null; }
  function layersOn() { try { return typeof layers === 'object' && layers ? layers : {}; } catch (_) { return {}; } } // eslint-disable-line no-undef

  // ── Geometry (degrees; west > east means the box crosses the antimeridian) ─────────────────
  const D = 180 / Math.PI;
  function computeView() {
    const v = viewer();
    if (!v) return null;
    let r;
    try { r = v.camera.computeViewRectangle(v.scene.globe.ellipsoid); } catch (_) { return null; }
    if (!r) return null; // looking at the sky
    let w = r.west * D, s = r.south * D, e = r.east * D, n = r.north * D;
    const width = e >= w ? e - w : 360 - w + e;
    const height = n - s;
    if (width >= 300) return null; // whole globe in view: nothing to cull
    const mx = Math.max(MIN_MARGIN_DEG, width * MARGIN), my = Math.max(MIN_MARGIN_DEG, height * MARGIN);
    if (width + 2 * mx >= 360) return null;
    s = Math.max(-90, s - my); n = Math.min(90, n + my);
    w -= mx; e += mx;
    if (w < -180) w += 360;
    if (e > 180) e -= 360;
    // Near a pole the lon span is meaningless: treat a view that reaches a pole as all longitudes.
    if (s <= -89.9 || n >= 89.9) { w = -180; e = 180; }
    return { w, s, e, n };
  }
  function lonIn(lon, w, e) { return w <= e ? lon >= w && lon <= e : lon >= w || lon <= e; }
  function inViewOf(view, lon, lat) {
    if (!view) return true;
    return lat >= view.s && lat <= view.n && lonIn(lon, view.w, view.e);
  }
  function lonRangesOverlap(aw, ae, bw, be) {
    const split = (w, e) => (w <= e ? [[w, e]] : [[w, 180], [-180, e]]);
    for (const [a1, a2] of split(aw, ae)) for (const [b1, b2] of split(bw, be)) if (a1 <= b2 && b1 <= a2) return true;
    return false;
  }
  function boxInViewOf(view, box) {
    if (!view) return true;
    const [w, s, e, n] = box;
    if (n < view.s || s > view.n) return false;
    return lonRangesOverlap(w, e, view.w, view.e);
  }
  function circleInViewOf(view, lat, lon, rDeg) {
    if (!view) return true;
    const c = Math.cos(Math.min(89, Math.abs(lat)) / D);
    const rLon = Math.min(180, rDeg / Math.max(0.05, c));
    let w = lon - rLon, e = lon + rLon;
    if (rLon >= 180) { w = -180; e = 180; }
    else { if (w < -180) w += 360; if (e > 180) e -= 360; }
    return boxInViewOf(view, [w, Math.max(-90, lat - rDeg), e, Math.min(90, lat + rDeg)]);
  }

  // ── Which entities can be culled ──────────────────────────────────────────────────────────
  function cullable(e) {
    if (!e || !e.position) return false;
    if (e.polyline || e.polygon || e.ellipse || e.corridor || e.rectangle || e.wall || e.polylineVolume) return false;
    if (e.parent && e.parent !== HIDE) return false; // someone else's hierarchy: leave it
    return true;
  }
  function lonLat(e, time) {
    const c = posCache.get(e);
    if (c) return c;
    let p;
    try { p = e.position.getValue(time); } catch (_) { return null; }
    if (!p) return null;
    const m = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    if (!m) return null;
    // Spherical lat is within ~0.2° of geodetic: plenty for a box with a 2°+ margin, and no allocation.
    const ll = [Math.atan2(p.y, p.x) * D, Math.asin(p.z / m) * D];
    if (e.position.isConstant) posCache.set(e, ll);
    return ll;
  }

  function setHidden(e, hide) {
    if (hide) { if (e.parent !== HIDE) e.parent = HIDE; }
    else if (e.parent === HIDE) e.parent = undefined;
  }

  function eachLayerEntity(fn) {
    const M = window.BDOCLayerMeter;
    if (!M || !M.collections) return;
    const on = layersOn();
    for (const ly of M.layerKeys()) {
      for (const c of M.collections(ly)) {
        const list = Array.isArray(c) ? c : c instanceof Set ? Array.from(c) : null; // DataSources: areas, skip
        if (!list) continue;
        for (let i = 0; i < list.length; i++) if (list[i]) fn(ly, list[i], !!on[ly]);
      }
    }
  }

  function unhideAll() {
    eachLayerEntity((ly, e) => { if (e.parent === HIDE) setHidden(e, false); });
    Object.keys(stats).forEach(k => delete stats[k]);
  }

  function pass(force) {
    const v = viewer();
    if (!v || typeof Cesium === 'undefined') return;
    if (!HIDE) { try { HIDE = new Cesium.Entity({ id: '__bdoc_cull_hidden__', show: false }); } catch (_) { return; } }
    if (!enabled) return;
    const view = computeView();
    const time = v.clock ? v.clock.currentTime : undefined;
    const keep = new Set([v.selectedEntity, v.trackedEntity].filter(Boolean));
    Object.keys(stats).forEach(k => delete stats[k]);
    let changed = 0;
    const suspend = v.entities && v.entities.suspendEvents;
    if (suspend) v.entities.suspendEvents();
    try {
      eachLayerEntity((ly, e, isOn) => {
        if (SKIP[ly] || !isOn || !cullable(e)) { if (e.parent === HIDE) { setHidden(e, false); changed++; } return; }
        let hide = false;
        if (view && !keep.has(e)) {
          const ll = lonLat(e, time);
          hide = !!ll && !inViewOf(view, ll[0], ll[1]);
        }
        const was = e.parent === HIDE;
        if (hide !== was) { setHidden(e, hide); changed++; }
        const st = stats[ly] || (stats[ly] = { culled: 0, considered: 0 });
        st.considered++; if (hide) st.culled++;
      });
    } finally { if (suspend) v.entities.resumeEvents(); }
    if (changed && window.BDOCRender) { try { window.BDOCRender.kick(); } catch (_) {} }
    lastFull = Date.now();
    return changed;
  }

  function signature() {
    const on = layersOn();
    let n = 0;
    try { n = window.V && window.V.entities ? window.V.entities.values.length : 0; } catch (_) {}
    return Object.keys(on).filter(k => on[k]).join(',') + '|' + n;
  }

  function tick() {
    if (document.hidden) return;
    const sig = signature();
    const on = layersOn();
    const moving = MOVING.some(k => on[k]);
    if (sig !== lastSig || (moving && Date.now() - lastFull > MOVING_PASS_MS)) { lastSig = sig; pass(); }
  }

  let moveT = null;
  function onMoveEnd() {
    clearTimeout(moveT);
    moveT = setTimeout(() => {
      pass(true);
      const view = computeView();
      const same = JSON.stringify(view) === JSON.stringify(lastView);
      lastView = view;
      if (!same) listeners.forEach(fn => { try { fn(view); } catch (e) { console.warn('[BDOCCull] listener', e); } });
    }, 150);
  }

  let hooked = false;
  function hook() {
    if (hooked) return;
    const v = viewer();
    if (!v) return;
    try { v.camera.moveEnd.addEventListener(onMoveEnd); hooked = true; lastView = computeView(); } catch (_) {}
  }

  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem('bdoc_cull', enabled ? '1' : '0'); } catch (_) {}
    if (enabled) pass(true); else unhideAll();
    listeners.forEach(fn => { try { fn(enabled ? computeView() : null); } catch (_) {} });
  }

  window.BDOCCull = {
    view: () => (enabled ? computeView() : null),
    inView: (lon, lat) => inViewOf(enabled ? computeView() : null, lon, lat),
    boxInView: box => boxInViewOf(enabled ? computeView() : null, box),
    circleInView: (lat, lon, rDeg) => circleInViewOf(enabled ? computeView() : null, lat, lon, rDeg),
    onViewChange: fn => { if (typeof fn === 'function') listeners.push(fn); },
    isEnabled: () => enabled,
    setEnabled,
    stats: () => JSON.parse(JSON.stringify(stats)),
    pass,
    _test: { inViewOf, boxInViewOf, circleInViewOf, lonRangesOverlap, cullable }
  };

  setInterval(() => { hook(); tick(); }, PASS_MS);
})();
