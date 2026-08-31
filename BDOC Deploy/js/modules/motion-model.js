// ============================================================
// BDOC MOTION MODEL v2: Render-behind interpolation (per-frame)
// Technique from God's Eye View (Bilawal Sidhu, MIT License)
//
// v2 fixes (Turn 24 audit):
//  - CRITICAL: designed for per-frame evaluation via CallbackProperty.
//    v1 was called once per poll and assigned a static position — aircraft
//    still snapped. Now layers-air.js wires entity.position to a
//    CallbackProperty that calls displayPosition(hex) every frame.
//  - CRITICAL: spd from both feeds (adsb.lol .gs, OpenSky converted) is in
//    KNOTS. v1 treated it as m/s (~2x error) and speedRamp double-converted.
//    All speeds converted to m/s exactly once, at ingestion (updateFix).
//  - extrapolation now uses the fix's stored track (v1 read the nonexistent
//    Cartographic.heading — always 0 — so coasting always went due north).
//  - removed dead course-blending math, fixed always-60 coast cap expression,
//    proper Cesium scratch objects instead of bare {}.
//
// API:
//   motionModel.updateFix(hex, ac)      — call once per poll per aircraft
//   motionModel.displayPosition(hex)    — call per frame (CallbackProperty)
//   motionModel.pruneStaleAircraft(set) — call after entity cleanup
//
// (c) 2026 Kitsune Global Solutions LLC. Interpolation approach adapted
// from God's Eye View (MIT).
// ============================================================

(function(){
'use strict';

// ── CONFIG ──────────────────────────────────────────────────
const RENDER_DELAY_MS   = 30000;  // render 30s behind live: interpolate between known fixes
const DR_CORRECTION_MS  = 900;    // discontinuity absorber decay window
const HISTORY_MAX       = 8;      // fixes kept per aircraft
const PLAUSIBLE_BASE_M  = 25;     // baseline jump-detection slack (m)
const COAST_CAP_SEC     = 60;     // max forward extrapolation past newest fix
const WARMUP_CAP_SEC    = 60;     // max backward extrapolation before oldest fix
const KT_TO_MPS         = 0.514444;

// ── STATE ───────────────────────────────────────────────────
const _hist = new Map();  // hex -> [{epochMs, pos:Cartesian3, velMps, track}]
const _corr = new Map();  // hex -> {vector, startMs, prevRaw, prevDisplay}

// Scratch objects (allocated once, reused per frame)
const _scratchC3a = new (window.Cesium ? Cesium.Cartesian3 : Object)();
const _scratchC3b = new (window.Cesium ? Cesium.Cartesian3 : Object)();

// ── MATH ────────────────────────────────────────────────────
const DEG = Math.PI / 180;

function norm360(d){ d = d % 360; return d < 0 ? d + 360 : d; }

// ENU offset for constant-rate turn arc (straight line when turn rate ~0)
function arcOffsetEnu(speedMps, trackDeg, turnRateDps, dtSec){
  const tr = trackDeg * DEG;
  const w  = (turnRateDps || 0) * DEG;
  if (Math.abs(w) < 1e-4) {
    return { east: speedMps * Math.sin(tr) * dtSec,
             north: speedMps * Math.cos(tr) * dtSec };
  }
  const rho = speedMps / w;
  return { east:  rho * (Math.cos(tr) - Math.cos(tr + w * dtSec)),
           north: rho * (Math.sin(tr + w * dtSec) - Math.sin(tr)) };
}

// Extrapolate a fix by dtSec (negative dtSec = backward) along its track
function extrapolateFix(fix, dtSec, out){
  if (!fix || !Number.isFinite(dtSec) || dtSec === 0) {
    return Cesium.Cartesian3.clone(fix.pos, out);
  }
  const arc = arcOffsetEnu(fix.velMps || 0, Number.isFinite(fix.track) ? fix.track : 0, 0, dtSec);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(fix.pos, Cesium.Ellipsoid.WGS84);
  const offset = new Cesium.Cartesian3(arc.east, arc.north, 0);
  Cesium.Matrix4.multiplyByPointAsVector(enu, offset, offset);
  return Cesium.Cartesian3.add(fix.pos, offset, out || new Cesium.Cartesian3());
}

// ── INGESTION (once per poll per aircraft) ──────────────────
// ac: {lat, lon, alt(ft), spd(KNOTS), hdg(deg)}
function updateFix(hex, ac){
  if (!window.Cesium || !ac || !Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) return;
  let h = _hist.get(hex);
  if (!h) { h = []; _hist.set(hex, h); }
  const last = h[h.length - 1];
  const now = Date.now();
  // Skip duplicate fixes (same feed row re-polled): identical position within 1s window
  if (last && Math.abs(now - last.epochMs) < 1000) return;
  h.push({
    epochMs: now,
    pos: Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, (ac.alt || 0) * 0.3048),
    velMps: (ac.spd || 0) * KT_TO_MPS,          // knots -> m/s, ONCE, here
    track: Number.isFinite(ac.hdg) ? ac.hdg : 0
  });
  if (h.length > HISTORY_MAX) h.shift();
}

// ── DISPLAY (per frame via CallbackProperty) ────────────────
function displayPosition(hex, result){
  if (!window.Cesium) return null;
  const h = _hist.get(hex);
  if (!h || h.length === 0) return null;

  const now = Date.now();
  const renderMs = now - RENDER_DELAY_MS;
  let raw = null;

  // Bracketed interpolation between two fixes spanning renderMs
  for (let i = h.length - 1; i >= 1; i--) {
    const a = h[i - 1], b = h[i];
    if (a.epochMs <= renderMs && renderMs <= b.epochMs) {
      const span = b.epochMs - a.epochMs;
      const t = span > 0 ? (renderMs - a.epochMs) / span : 1.0;
      raw = Cesium.Cartesian3.lerp(a.pos, b.pos, t, _scratchC3a);
      break;
    }
  }

  if (!raw) {
    const oldest = h[0], newest = h[h.length - 1];
    if (renderMs < oldest.epochMs) {
      // Warm-up: render time predates history — extrapolate oldest backward (capped)
      const backSec = Math.min((oldest.epochMs - renderMs) / 1000, WARMUP_CAP_SEC);
      raw = extrapolateFix(oldest, -backSec, _scratchC3a);
    } else {
      // Coast: render time is past newest fix — extrapolate forward (capped)
      const aheadSec = Math.min((renderMs - newest.epochMs) / 1000, COAST_CAP_SEC);
      raw = extrapolateFix(newest, aheadSec, _scratchC3a);
    }
  }

  // ── Discontinuity absorber: fold position steps into a decaying offset ──
  let c = _corr.get(hex);
  if (!c) {
    c = { vector: new Cesium.Cartesian3(0,0,0), startMs: now,
          prevRaw: Cesium.Cartesian3.clone(raw), prevDisplay: Cesium.Cartesian3.clone(raw),
          lastMs: now };
    _corr.set(hex, c);
  }
  const newest = h[h.length - 1];
  const dtSec = Math.max(0.001, (now - c.lastMs) / 1000);
  const plausible = (newest.velMps || 0) * dtSec * 4 + PLAUSIBLE_BASE_M;
  if (Cesium.Cartesian3.distanceSquared(raw, c.prevRaw) > plausible * plausible) {
    // Re-anchor: correction = what's on screen minus new raw, then decay to 0
    Cesium.Cartesian3.subtract(c.prevDisplay, raw, c.vector);
    c.startMs = now;
  }
  const elapsed = now - c.startMs;
  const factor = elapsed >= DR_CORRECTION_MS ? 0 : 1 - elapsed / DR_CORRECTION_MS;

  const out = result || new Cesium.Cartesian3();
  Cesium.Cartesian3.multiplyByScalar(c.vector, factor, _scratchC3b);
  Cesium.Cartesian3.add(raw, _scratchC3b, out);

  Cesium.Cartesian3.clone(raw, c.prevRaw);
  Cesium.Cartesian3.clone(out, c.prevDisplay);
  c.lastMs = now;
  return out;
}

// ── CLEANUP ─────────────────────────────────────────────────
function pruneStaleAircraft(activeHexSet){
  for (const hex of _hist.keys()) {
    if (!activeHexSet.has(hex)) { _hist.delete(hex); _corr.delete(hex); }
  }
}

window.motionModel = {
  updateFix,
  displayPosition,
  pruneStaleAircraft,
  RENDER_DELAY_MS, DR_CORRECTION_MS, HISTORY_MAX
};
})();
