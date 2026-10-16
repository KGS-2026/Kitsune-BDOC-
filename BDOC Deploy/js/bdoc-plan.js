// js/bdoc-plan.js — P156e: the battle plan survives a reload, exports real shapes, and
// saves/opens as a .bdoc.json file (field-resilience audit S3 + S5, EOC eval deploy-blocker).
//
// Every drawing tool (units, notes, polygons, circles, rectangles, lines, PL/FEBA/FSCL/MSR,
// EA/minefield, range rings, bullseye, measure, arrows, CASEVAC, …) ends in plain Cesium
// entities pushed into window.battleEntities — single entities, or arrays for grouped items.
// Instead of touching each tool, this module serializes those entities generically: every
// graphics property is read at "now", encoded as JSON, and rebuilt with V.entities.add().
// battleMeta (label/comment/type/color) and a CASEVAC card's CoT XML travel with them.
//
//   Autosave → IndexedDB 'bdoc-offline' / store 'meta' / key 'battle_plan_v1', ~0.8 s after
//   any add, remove (push/splice/clear) or edit (entity.definitionChanged). Restored on boot.
//   beforeunload warns only while a change is not yet confirmed saved.
//   Exports: GeoJSON with real Point/LineString/Polygon, CoT with ATAK drawing shapes,
//   and a full-fidelity .bdoc.json (open = append to the current plan, sanitized).
(function () {
  'use strict';
  const FORMAT = 'bdoc-plan', VERSION = 1, IDB_KEY = 'battle_plan_v1';
  const GFX = {
    billboard: ['image', 'width', 'height', 'scale', 'color', 'rotation', 'sizeInMeters', 'heightReference', 'verticalOrigin', 'horizontalOrigin',
      'pixelOffset', 'eyeOffset', 'scaleByDistance', 'translucencyByDistance', 'pixelOffsetScaleByDistance', 'distanceDisplayCondition', 'disableDepthTestDistance', 'show'],
    label: ['text', 'font', 'style', 'scale', 'fillColor', 'outlineColor', 'outlineWidth', 'showBackground', 'backgroundColor', 'backgroundPadding', 'pixelOffset',
      'eyeOffset', 'horizontalOrigin', 'verticalOrigin', 'heightReference', 'translucencyByDistance', 'pixelOffsetScaleByDistance', 'scaleByDistance',
      'distanceDisplayCondition', 'disableDepthTestDistance', 'show'],
    point: ['pixelSize', 'color', 'outlineColor', 'outlineWidth', 'heightReference', 'scaleByDistance', 'translucencyByDistance', 'distanceDisplayCondition',
      'disableDepthTestDistance', 'show'],
    polyline: ['positions', 'width', 'material', 'clampToGround', 'arcType', 'granularity', 'depthFailMaterial', 'zIndex', 'classificationType', 'distanceDisplayCondition', 'show'],
    polygon: ['hierarchy', 'material', 'outline', 'outlineColor', 'outlineWidth', 'height', 'heightReference', 'extrudedHeight', 'perPositionHeight', 'fill',
      'stRotation', 'granularity', 'arcType', 'zIndex', 'classificationType', 'show'],
    ellipse: ['semiMajorAxis', 'semiMinorAxis', 'material', 'outline', 'outlineColor', 'outlineWidth', 'height', 'heightReference', 'extrudedHeight', 'rotation',
      'stRotation', 'fill', 'granularity', 'numberOfVerticalLines', 'zIndex', 'classificationType', 'show'],
    rectangle: ['coordinates', 'material', 'outline', 'outlineColor', 'outlineWidth', 'height', 'heightReference', 'extrudedHeight', 'rotation', 'stRotation', 'fill', 'zIndex', 'show'],
  };
  const MATS = ['PolylineDashMaterialProperty', 'PolylineGlowMaterialProperty', 'PolylineArrowMaterialProperty', 'PolylineOutlineMaterialProperty', 'ImageMaterialProperty'];

  const hasV = () => typeof V !== 'undefined' && V && V.entities;
  const tNow = () => (hasV() && V.clock) ? V.clock.currentTime : Cesium.JulianDate.now();
  const metaMap = () => (typeof battleMeta !== 'undefined' ? battleMeta : null);
  const toast = (c, m) => { try { if (typeof af === 'function') af(c, m); } catch (_) {} };
  const val = (p, t) => { try { return p && typeof p.getValue === 'function' ? p.getValue(t) : p; } catch (_) { return undefined; } };

  // ── value codec ─────────────────────────────────────────────────────────────
  function enc(v) {
    if (v === undefined || typeof v === 'function') return undefined;
    if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    if (v instanceof Cesium.Color) return { _t: 'Color', v: [v.red, v.green, v.blue, v.alpha] };
    if (v instanceof Cesium.Cartesian3) return { _t: 'C3', v: [v.x, v.y, v.z] };
    if (v instanceof Cesium.Cartesian2) return { _t: 'C2', v: [v.x, v.y] };
    if (v instanceof Cesium.NearFarScalar) return { _t: 'NFS', v: [v.near, v.nearValue, v.far, v.farValue] };
    if (v instanceof Cesium.DistanceDisplayCondition) return { _t: 'DDC', v: [v.near, v.far] };
    if (v instanceof Cesium.Rectangle) return { _t: 'Rect', v: [v.west, v.south, v.east, v.north] };
    if (v instanceof Cesium.PolygonHierarchy) return { _t: 'PH', p: (v.positions || []).map(enc), h: (v.holes || []).map(enc) };
    if (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement) { try { return { _t: 'img', v: v.toDataURL('image/png') }; } catch (_) { return undefined; } }
    if (typeof HTMLImageElement !== 'undefined' && v instanceof HTMLImageElement) return { _t: 'img', v: v.src };
    if (Array.isArray(v)) return v.map(enc);
    if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) { const e = enc(v[k]); if (e !== undefined) o[k] = e; } return o; }
    return undefined;
  }
  function dec(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(dec);
    switch (v._t) {
      case 'DDTD': return 5e6;   // the P154 merge() patch swaps this back to the live horizon value
      case 'Color': return new Cesium.Color(v.v[0], v.v[1], v.v[2], v.v[3]);
      case 'C3': return new Cesium.Cartesian3(v.v[0], v.v[1], v.v[2]);
      case 'C2': return new Cesium.Cartesian2(v.v[0], v.v[1]);
      case 'NFS': return new Cesium.NearFarScalar(v.v[0], v.v[1], v.v[2], v.v[3]);
      case 'DDC': return new Cesium.DistanceDisplayCondition(v.v[0], v.v[1]);
      case 'Rect': return new Cesium.Rectangle(v.v[0], v.v[1], v.v[2], v.v[3]);
      case 'PH': return new Cesium.PolygonHierarchy((v.p || []).map(dec), (v.h || []).map(dec));
      case 'img': return v.v;
      case 'mat': {
        const C = Cesium[v.cls]; if (!C || !MATS.includes(v.cls)) return undefined;
        const o = dec(v.v) || {};
        return v.cls === 'PolylineArrowMaterialProperty' ? new C(o.color) : new C(o);
      }
    }
    const o = {}; for (const k of Object.keys(v)) o[k] = dec(v[k]); return o;
  }
  function encMat(prop, t) {
    if (!prop) return undefined;
    if (prop instanceof Cesium.ColorMaterialProperty) { const c = val(prop.color, t); return c ? enc(c) : undefined; }
    for (const cls of MATS) if (Cesium[cls] && prop instanceof Cesium[cls]) return { _t: 'mat', cls, v: enc(prop.getValue(t)) };
    return undefined;
  }

  // ── entity ⇄ spec ───────────────────────────────────────────────────────────
  function serEntity(ent, t) {
    const s = { id: ent.id };
    if (ent.name) s.name = ent.name;
    if (ent.show === false) s.show = false;
    const d = val(ent.description, t); if (d) s.description = String(d);
    const p = val(ent.position, t); if (p) s.position = enc(p);
    if (ent.properties) { const pv = val(ent.properties, t); if (pv && Object.keys(pv).length) s.properties = enc(pv); }
    for (const g of Object.keys(GFX)) {
      const gfx = ent[g]; if (!gfx) continue;
      const o = {};
      for (const k of GFX[g]) {
        const prop = gfx[k]; if (prop === undefined) continue;
        let e;
        if (k === 'material' || k === 'depthFailMaterial') e = encMat(prop, t);
        else if (prop === window.BDOC_DDTD) e = { _t: 'DDTD' };
        else e = enc(val(prop, t));
        if (e !== undefined) o[k] = e;
      }
      s[g] = o;
    }
    const mm = metaMap(); if (mm) { const m = mm.get(ent); if (m) s.meta = enc(m); }
    if (s.description && window._cotStore) {          // CASEVAC card → keep its CoT for the EXPORT button
      const x = s.description.match(/_downloadCotXml\('([^']+)'\)/);
      if (x && window._cotStore.has(x[1])) s.cot = { uid: x[1], xml: window._cotStore.get(x[1]) };
    }
    return s;
  }

  // Imported files come from other people: their HTML lands in the InfoBox iframe and in
  // buildEntityPopup(), so strip script/handlers, keep colors to hex, images to data: URIs.
  function sanitizeSpec(s) {
    const clean = h => (typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(String(h)) : String(h).replace(/[<>]/g, ''));
    const hex = c => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : undefined);
    const out = JSON.parse(JSON.stringify(s));
    if (out.description) out.description = clean(out.description);
    if (out.billboard && out.billboard.image) {
      const im = out.billboard.image; const u = typeof im === 'string' ? im : (im && im.v);
      if (!(typeof u === 'string' && /^data:image\//.test(u))) delete out.billboard;
    }
    if (out.meta && typeof out.meta === 'object') {
      if ('popupExtras' in out.meta) out.meta.popupExtras = clean(out.meta.popupExtras || '');
      if ('color' in out.meta) out.meta.color = hex(out.meta.color);
      for (const k of Object.keys(out.meta)) if (typeof out.meta[k] === 'object' && out.meta[k] !== null) delete out.meta[k];
    }
    if (out.cot && (typeof out.cot.uid !== 'string' || typeof out.cot.xml !== 'string')) delete out.cot;
    return out;
  }

  function optsFrom(s, keepId) {
    const o = {};
    if (keepId && s.id && !V.entities.getById(s.id)) o.id = s.id;
    if (s.name) o.name = String(s.name);
    if (s.show === false) o.show = false;
    if (s.description) o.description = s.description;
    if (s.position) o.position = dec(s.position);
    if (s.properties) o.properties = dec(s.properties);
    for (const g of Object.keys(GFX)) if (s[g]) {
      const go = {};
      for (const k of GFX[g]) if (k in s[g]) { const dv = dec(s[g][k]); if (dv !== undefined) go[k] = dv; }
      o[g] = go;
    }
    return o;
  }
  function addSpec(s, keepId, trusted) {
    if (!trusted) s = sanitizeSpec(s);
    const ent = V.entities.add(optsFrom(s, keepId));
    const mm = metaMap(); if (s.meta && mm) mm.set(ent, dec(s.meta));
    if (s.cot && window._cotStore) window._cotStore.set(s.cot.uid, s.cot.xml);
    return ent;
  }
  function addItem(it, keepId, trusted) {
    if (Array.isArray(it.group)) { const g = it.group.map(s => addSpec(s, keepId, trusted)); battleEntities.push(g); return g; }
    if (it.e) { const e = addSpec(it.e, keepId, trusted); battleEntities.push(e); return [e]; }
    return [];
  }
  function toDoc() {
    const t = tNow(), items = [];
    for (const x of battleEntities) {
      try {
        if (Array.isArray(x)) {
          const g = x.flat(Infinity).filter(e => e && V.entities.contains(e)).map(e => serEntity(e, t));
          if (g.length) items.push({ group: g });
        } else if (x && V.entities.contains(x)) items.push({ e: serEntity(x, t) });
      } catch (e) { console.warn('[plan] skipped an item:', e && e.message); }
    }
    const b = document.getElementById('bdocBuildPill');
    return { format: FORMAT, version: VERSION, saved: new Date().toISOString(), build: b ? b.textContent.trim() : '', items };
  }

  // ── IndexedDB autosave ──────────────────────────────────────────────────────
  async function idbPut(doc) {
    const store = window.BDOCOfflineStore; if (!store) throw new Error('offline store not loaded');
    const db = await store.open(); if (!db) throw new Error('IndexedDB unavailable');
    await new Promise((res, rej) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ k: IDB_KEY, v: doc });
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('aborted'));
    });
  }
  async function idbGet() { const store = window.BDOCOfflineStore; return store ? store.getMeta(IDB_KEY) : null; }

  let ready = false, restoring = false, dirty = false, timer = null, saving = null, lastErr = null;
  let lastSaved = 0, savedCount = 0, lastLen = 0, warnedErr = false;
  function markDirty() {
    if (!ready || restoring) return;
    dirty = true; clearTimeout(timer); timer = setTimeout(saveNow, 800);
  }
  async function saveNow() {
    clearTimeout(timer); timer = null;
    if (!ready || !hasV()) return false;
    if (saving) { try { await saving; } catch (_) {} if (!dirty) return !lastErr; }
    dirty = false;
    let doc;
    try { doc = toDoc(); } catch (e) { lastErr = e; dirty = true; return false; }
    saving = idbPut(doc).then(() => { lastErr = null; warnedErr = false; lastSaved = Date.now(); savedCount = doc.items.length; })
      .catch(e => {
        lastErr = e; dirty = true;
        console.warn('[plan] autosave failed:', e && e.message);
        if (!warnedErr) { warnedErr = true; toast('var(--rd)', 'Battle plan NOT saved on this device (' + ((e && e.name) || 'storage error') + '). Use SAVE FILE before closing.'); }
      });
    try { await saving; } finally { saving = null; }
    return !lastErr;
  }
  function hasUnsaved() { return ready && !!(dirty || saving || lastErr) && (battleEntities.length > 0 || savedCount > 0); }

  const watched = new WeakSet();
  function watch(x) {
    const list = Array.isArray(x) ? x.flat(Infinity) : [x];
    for (const e of list) {
      if (!e || watched.has(e) || !e.definitionChanged) continue;
      watched.add(e); e.definitionChanged.addEventListener(markDirty);   // note edits, recolor, moves
    }
  }
  function hookArray() {
    const a = window.battleEntities; if (!a || a.__planHooked) return;
    const push = a.push;   // keeps the BDOCUndo.record() wrapper from _bdocTrackedArray
    Object.defineProperty(a, 'push', { value: function () { const r = push.apply(this, arguments); for (const x of arguments) watch(x); markDirty(); return r; }, writable: true, configurable: true });
    Object.defineProperty(a, 'splice', { value: function () { const r = Array.prototype.splice.apply(this, arguments); markDirty(); return r; }, writable: true, configurable: true });
    Object.defineProperty(a, '__planHooked', { value: true });
  }

  async function restore() {
    let doc = null;
    try { doc = await idbGet(); } catch (_) {}
    if (!doc || doc.format !== FORMAT || !Array.isArray(doc.items)) return 0;
    savedCount = doc.items.length;
    if (!doc.items.length) return 0;
    restoring = true; let n = 0;
    try { for (const it of doc.items) { try { if (addItem(it, true, true).length) n++; } catch (e) { console.warn('[plan] restore item failed:', e && e.message); } } }
    finally { restoring = false; }
    try { V.scene.requestRender(); } catch (_) {}
    if (n) toast('var(--bl)', `Battle plan restored from this device: ${n} item${n === 1 ? '' : 's'} (saved ${String(doc.saved).slice(11, 16)}Z)`);
    return n;
  }

  // ── shapes for export ───────────────────────────────────────────────────────
  const matColor = (prop, t) => { const v = val(prop, t); return v instanceof Cesium.Color ? v : (v && v.color instanceof Cesium.Color ? v.color : null); };
  function shapeOf(ent, t) {
    if (ent.polygon) {
      const h = val(ent.polygon.hierarchy, t);
      if (h && h.positions && h.positions.length >= 3)
        return { kind: 'polygon', rings: [h.positions].concat((h.holes || []).map(x => x.positions)), fill: matColor(ent.polygon.material, t), stroke: val(ent.polygon.outlineColor, t) || matColor(ent.polyline && ent.polyline.material, t), width: val(ent.polygon.outlineWidth, t) };
    }
    if (ent.ellipse) {
      const c = val(ent.position, t), r = val(ent.ellipse.semiMajorAxis, t);
      if (c && r) return { kind: 'circle', center: c, radius: r, fill: matColor(ent.ellipse.material, t), stroke: val(ent.ellipse.outlineColor, t) || matColor(ent.polyline && ent.polyline.material, t), width: val(ent.ellipse.outlineWidth, t) };
    }
    if (ent.rectangle) {
      const rc = val(ent.rectangle.coordinates, t);
      if (rc) return { kind: 'polygon', rings: [Cesium.Cartesian3.fromRadiansArray([rc.west, rc.south, rc.east, rc.south, rc.east, rc.north, rc.west, rc.north])], fill: matColor(ent.rectangle.material, t), stroke: val(ent.rectangle.outlineColor, t) };
    }
    if (ent.polyline) {
      const ps = val(ent.polyline.positions, t);
      if (ps && ps.length >= 2) return { kind: 'line', positions: ps, stroke: matColor(ent.polyline.material, t), width: val(ent.polyline.width, t) };
    }
    const p = val(ent.position, t);
    if (p) return { kind: 'point', position: p, labelOnly: !!ent.label && !ent.point && !ent.billboard, color: val(ent.point && ent.point.color, t) || val(ent.label && ent.label.fillColor, t) };
    return null;
  }
  const ll = c3 => { const c = Cesium.Cartographic.fromCartesian(c3); return [+Cesium.Math.toDegrees(c.longitude).toFixed(7), +Cesium.Math.toDegrees(c.latitude).toFixed(7)]; };
  const hex = c => (c instanceof Cesium.Color ? c.toCssHexString().slice(0, 7) : undefined);
  const closeRing = r => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? r.concat([r[0]]) : r);
  function labelText(ent, t) { const x = val(ent.label && ent.label.text, t); return x ? String(x) : ''; }
  function entries() {   // [{ent, group}] flattened, alive only
    const out = []; let gi = 0;
    for (const x of battleEntities) {
      if (Array.isArray(x)) { gi++; for (const e of x.flat(Infinity)) if (e && V.entities.contains(e)) out.push({ ent: e, group: gi }); }
      else if (x && V.entities.contains(x)) out.push({ ent: x, group: 0 });
    }
    return out;
  }

  function toGeoJSON() {
    const t = tNow(), features = [];
    for (const { ent, group } of entries()) {
      const s = shapeOf(ent, t); if (!s) continue;
      const mm = metaMap(); const m = (mm && mm.get(ent)) || {};
      const lbl = labelText(ent, t);
      const props = { name: m.label || lbl.split('\n')[0] || ent.name || 'Marker', comment: m.comment || '', type: m.type || s.kind, label: lbl };
      if (group) props.group = group;
      let geometry;
      if (s.kind === 'polygon') geometry = { type: 'Polygon', coordinates: s.rings.map(r => closeRing(r.map(ll))) };
      else if (s.kind === 'circle') {
        const [lon, lat] = ll(s.center);
        const ring = (typeof _ringPositions === 'function') ? _ringPositions(lon, lat, s.radius, 64) : [s.center];
        geometry = { type: 'Polygon', coordinates: [closeRing(ring.map(ll))] };
        Object.assign(props, { shape: 'circle', radius_m: +s.radius.toFixed(1), center: [lon, lat] });
      } else if (s.kind === 'line') geometry = { type: 'LineString', coordinates: s.positions.map(ll) };
      else { geometry = { type: 'Point', coordinates: ll(s.position) }; if (s.labelOnly) props.role = 'label'; }
      // simplestyle-spec, so geojson.io / QGIS / Felt draw it in the right colours
      const stroke = hex(s.stroke) || hex(s.color) || m.color;
      if (stroke) props[s.kind === 'point' ? 'marker-color' : 'stroke'] = stroke;
      if (s.width) props['stroke-width'] = s.width;
      if (s.fill) { props.fill = hex(s.fill); props['fill-opacity'] = +s.fill.alpha.toFixed(2); }
      features.push({ type: 'Feature', properties: props, geometry });
    }
    return { type: 'FeatureCollection', bdoc: { format: 'bdoc-plan-geojson', exported: new Date().toISOString() }, features };
  }

  // ATAK colours are signed 32-bit ARGB ints
  function argb(c) {
    if (!(c instanceof Cesium.Color)) return -1;
    const b = x => Math.max(0, Math.min(255, Math.round(x * 255)));
    return ((b(c.alpha) << 24) | (b(c.red) << 16) | (b(c.green) << 8) | b(c.blue)) | 0;
  }
  function cotEvents(pickCoT) {
    const t = tNow(), events = []; let n = 0;
    const rnd = () => Math.random().toString(36).slice(2, 7).toUpperCase();
    for (const { ent, group } of entries()) {
      const s = shapeOf(ent, t); if (!s) continue;
      const mm = metaMap(); const m = (mm && mm.get(ent)) || {};
      const lbl = labelText(ent, t);
      const callsign = (m.label || lbl.split('\n')[0] || ent.name || 'Marker').slice(0, 40);
      const uid = 'BDOC-BP-' + (++n) + '-' + rnd();
      if (s.kind === 'point') {
        if (s.labelOnly && group) continue;   // ring / degree labels are decoration, not TAK markers
        const d = val(ent.description, t);
        const x = d && window._cotStore && String(d).match(/_downloadCotXml\('([^']+)'\)/);
        if (x && window._cotStore.has(x[1])) { events.push(window._cotStore.get(x[1]).replace(/<\?xml[^>]*\?>\s*/, '')); continue; }   // full CASEVAC 9-line
        const c = Cesium.Cartographic.fromCartesian(s.position);
        events.push(buildCoT({ cotType: pickCoT(m), uid, lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude),
          hae: c.height || 0, callsign, remarks: m.comment || '', staleMs: 3600000 }).replace(/<\?xml[^>]*\?>\s*/, ''));
        continue;
      }
      // ATAK drawing shapes: u-d-f freehand polyline/polygon (link points), u-d-c-c circle
      let type, anchor, extra = '';
      if (s.kind === 'circle') {
        type = 'u-d-c-c'; anchor = ll(s.center);
        extra += `<shape><ellipse major="${s.radius.toFixed(1)}" minor="${s.radius.toFixed(1)}" angle="360"/></shape>`;
      } else {
        type = 'u-d-f';
        const pts = (s.kind === 'polygon' ? closeRing(s.rings[0].map(ll)) : s.positions.map(ll));
        anchor = pts[0];
        extra += pts.map(([lo, la]) => `<link point="${la.toFixed(7)},${lo.toFixed(7)}"/>`).join('');
      }
      extra += `<strokeColor value="${argb(s.stroke)}"/><strokeWeight value="${(s.width || 3).toFixed(1)}"/>`;
      if (s.kind !== 'line') extra += `<fillColor value="${argb(s.fill)}"/>`;
      extra += '<labels_on value="true"/>';
      events.push(buildCoT({ cotType: type, uid, lat: anchor[1], lon: anchor[0], callsign, remarks: m.comment || lbl, staleMs: 3600000, extra })
        .replace(/<\?xml[^>]*\?>\s*/, ''));
    }
    return events;
  }

  // ── files ───────────────────────────────────────────────────────────────────
  function download(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  function exportGeoJSON() {
    const gj = toGeoJSON();
    if (!gj.features.length) { toast('var(--t3)', 'No battle markers to export'); return null; }
    download('BDOC-BattlePlan-' + stamp() + '.geojson', JSON.stringify(gj, null, 2), 'application/geo+json');
    const k = gj.features.reduce((a, f) => { a[f.geometry.type] = (a[f.geometry.type] || 0) + 1; return a; }, {});
    toast('var(--bl)', 'Battle plan exported: ' + Object.keys(k).map(x => k[x] + ' ' + x).join(', '));
    return gj;
  }
  function saveFile() {
    const doc = toDoc();
    if (!doc.items.length) { toast('var(--t3)', 'No battle markers to save'); return null; }
    download('BDOC-Plan-' + stamp() + '.bdoc.json', JSON.stringify(doc), 'application/json');
    toast('var(--bl)', `Plan saved to file: ${doc.items.length} item${doc.items.length === 1 ? '' : 's'} (.bdoc.json — open it with OPEN FILE)`);
    return doc;
  }
  function importDoc(doc) {
    if (!doc || doc.format !== FORMAT || !Array.isArray(doc.items)) throw new Error('not a BDOC plan (.bdoc.json) file');
    if (doc.version > VERSION) throw new Error('this plan was saved by a newer BDOC (format v' + doc.version + ')');
    const added = []; let bad = 0;
    for (const it of doc.items) { try { added.push(...addItem(it, false, false)); } catch (e) { bad++; console.warn('[plan] import item failed:', e && e.message); } }
    markDirty();
    try { if (added.length) V.flyTo(added, { duration: 1.2 }); else V.scene.requestRender(); } catch (_) {}
    return { items: doc.items.length - bad, failed: bad };
  }
  function openFile() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,.bdoc.json,application/json';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      try {
        const r = importDoc(JSON.parse(await f.text()));
        toast('var(--bl)', `Opened plan "${f.name.replace(/[<>&"]/g, '')}": ${r.items} item${r.items === 1 ? '' : 's'} added` + (r.failed ? ` (${r.failed} could not be drawn)` : ''));
      } catch (e) { toast('var(--rd)', 'Could not open plan: ' + String(e && e.message || e).replace(/[<>&"]/g, '')); }
    };
    inp.click();
  }

  // ── boot ────────────────────────────────────────────────────────────────────
  async function init() {
    for (let i = 0; i < 300 && !(hasV() && window.battleEntities && metaMap()); i++) await new Promise(r => setTimeout(r, 100));
    if (!(hasV() && window.battleEntities)) { console.warn('[plan] globe/battle code not ready — autosave off'); return; }
    hookArray();
    battleEntities.forEach(watch);
    const drawnBeforeRestore = battleEntities.length;
    await restore();
    ready = true;
    lastLen = battleEntities.length;
    if (drawnBeforeRestore) markDirty();
    setInterval(() => { if (battleEntities.length !== lastLen) { lastLen = battleEntities.length; markDirty(); } }, 4000);  // catches length=0 clears
    window.addEventListener('beforeunload', e => {
      if (!hasUnsaved()) return;
      saveNow();
      e.preventDefault(); e.returnValue = ''; return '';
    });
    window.addEventListener('pagehide', () => { if (dirty) saveNow(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) saveNow(); });
    try { window.BDOCOfflineStore && window.BDOCOfflineStore.requestPersistence && window.BDOCOfflineStore.requestPersistence(); } catch (_) {}
  }

  window.BDOCPlan = {
    markDirty, saveNow, hasUnsaved, toDoc, importDoc, toGeoJSON, cotEvents, exportGeoJSON, saveFile, openFile,
    get status() { return { ready, dirty, saving: !!saving, lastError: lastErr ? String(lastErr.message || lastErr) : null, lastSaved, savedCount }; },
    _restore: restore,
  };
  init();
})();
