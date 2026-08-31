// ============================================================
// BDOC MOTION MODEL: Render-behind interpolation + discontinuity absorption
// Ported from God's Eye View (Bilawal Sidhu, MIT License)
// https://github.com/bilawalsidhu/gods-eye-view
// 
// Core techniques:
//  1. Render-behind smoothing: display at now-RENDER_DELAY_SEC so positions
//     interpolate BETWEEN two known fixes instead of extrapolating ahead.
//     Trades 30s latency for zero extrapolation error and smooth motion.
//  2. Dead-reckon with arc integration: extrapolate with turn-rate-aware
//     arc math, not straight-line tangent.
//  3. Discontinuity absorber: absorb position steps into a correction offset
//     that decays linearly to zero over 900ms, eliminating visible jumps.
//
// Usage in layers-air.js:
//   const displayPos = motionModel.displayPosition(hex, aircraft);
//   entity.position = displayPos;   // use this for rendering, not raw sensor pos
//
// (c) 2026 Kitsune Global Solutions LLC / Bilawal Sidhu
// ============================================================

// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════

const RENDER_DELAY_SEC = 30;          // render at now - 30s (= one poll interval for aircraft feeds)
const DR_CORRECTION_MS = 900;         // decay discontinuity correction over 900ms
const HISTORY_MAX = 8;                // ring buffer size per aircraft
const DR_CORRECTION_PLAUSIBLE_M = 25; // baseline plausibility window (m)

// ═══════════════════════════════════════════════════════════
// STATE: Per-aircraft motion history + discontinuity tracking
// ═══════════════════════════════════════════════════════════

const _motionHistory = new Map();     // hex -> ringbuffer of {time:JD, epochMs, pos:C3, vel:m/s, track:deg}
const _drCorrection = new Map();      // hex -> {vector:C3, startMs, prevRaw:C3, prevDisplay:C3}

// ═══════════════════════════════════════════════════════════
// MATH: Angle interpolation + turn-rate arc integration
// ═══════════════════════════════════════════════════════════

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function norm360(deg) {
  let d = deg % 360;
  return d < 0 ? d + 360 : d;
}

function lerpAngleDeg(from, to, t) {
  // Shortest angular path interpolation
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return norm360(from + d * t);
}

function courseBetweenCartesians(a, b) {
  // Compute geodetic bearing (course) from Cartesian a to b
  // Uses Cesium ellipsoid WGS84
  if (!Cesium || !a || !b) return null;
  
  const aCart = Cesium.Cartographic.fromCartesian(a);
  const bCart = Cesium.Cartographic.fromCartesian(b);
  
  const dLon = bCart.longitude - aCart.longitude;
  const y = Math.sin(dLon) * Math.cos(bCart.latitude);
  const x = Math.cos(aCart.latitude) * Math.sin(bCart.latitude) -
            Math.sin(aCart.latitude) * Math.cos(bCart.latitude) * Math.cos(dLon);
  
  return norm360(Math.atan2(y, x) * RAD);
}

function speedRamp(groundSpeedMps) {
  // Weight to blend reported track vs. chord course
  // Chord is unreliable at low speed (GPS jitter dominates)
  // At helicopter speeds (~20 m/s), reported track is more trustworthy
  const speedKt = groundSpeedMps * 1.94384;  // m/s -> knots
  if (speedKt < 20) return 0;      // pure reported track
  if (speedKt > 200) return 1;     // pure chord course
  return (speedKt - 20) / 180;     // linear blend 20-200 kt
}

// Arc offset in ENU (East-North-Up) coordinates
// Integrates a constant-rate turn arc, not a straight tangent
// Ported from skylight (cpaczek/skylight, MIT)
function arcOffsetEnu(speedMps, trackDeg, turnRateDps, dtSec) {
  // Returns {east, north, endCourseDeg}
  const tr = trackDeg * DEG;
  const w = (turnRateDps || 0) * DEG;  // rad/s
  
  const result = { east: 0, north: 0, endCourseDeg: trackDeg };
  
  if (Math.abs(w) < 1e-4) {
    // Straight line
    result.east = speedMps * Math.sin(tr) * dtSec;
    result.north = speedMps * Math.cos(tr) * dtSec;
    result.endCourseDeg = norm360(trackDeg);
    return result;
  }
  
  // Circular arc integration
  const rho = speedMps / w;  // radius of curvature
  result.east = rho * (Math.cos(tr) - Math.cos(tr + w * dtSec));
  result.north = rho * (Math.sin(tr + w * dtSec) - Math.sin(tr));
  result.endCourseDeg = norm360(trackDeg + turnRateDps * dtSec);
  
  return result;
}

function estimateTurnRateDps(trackDeg0, trackDeg1, dtSec) {
  // Estimate turn rate (deg/s) from two track samples
  if (!Number.isFinite(trackDeg0) || !Number.isFinite(trackDeg1) || dtSec <= 0) {
    return 0;
  }
  let delta = trackDeg1 - trackDeg0;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta / dtSec;
}

// ═══════════════════════════════════════════════════════════
// HISTORY RING BUFFER
// ═══════════════════════════════════════════════════════════

function getHistory(hex) {
  if (!_motionHistory.has(hex)) {
    _motionHistory.set(hex, []);
  }
  return _motionHistory.get(hex);
}

function pushFix(hex, position, velocity, track, epochMs) {
  // position: Cesium.Cartesian3
  // velocity: m/s (ground speed)
  // track: degrees (heading / true course)
  // epochMs: Date.now()
  
  if (!Cesium || !position) return;
  
  const h = getHistory(hex);
  const time = Cesium.JulianDate.fromDate(new Date(epochMs));
  
  h.push({
    time: time,
    epochMs: epochMs,
    position: Cesium.Cartesian3.clone(position),
    velocity: velocity || 0,
    track: track
  });
  
  if (h.length > HISTORY_MAX) {
    h.shift();
  }
}

// ═══════════════════════════════════════════════════════════
// DEAD RECKON: Interpolate between two fixes or extrapolate fallback
// ═══════════════════════════════════════════════════════════

function extrapolateFixForward(newest, velocity, turnRateDps, dtSec, out) {
  // Extrapolate NEWEST fix FORWARD by dtSec at given velocity and turn rate
  if (!Cesium || !newest || dtSec <= 0) {
    return Cesium.Cartesian3.clone(newest, out);
  }
  
  // Convert to geodetic, apply ENU offset, convert back
  const cart = Cesium.Cartographic.fromCartesian(newest);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(newest, Cesium.Ellipsoid.WGS84);
  
  const arc = arcOffsetEnu(velocity || 0, cart.heading || 0, turnRateDps || 0, dtSec);
  
  const offset = Cesium.Cartesian3.fromElements(arc.east, arc.north, 0);
  Cesium.Matrix4.multiplyByPointAsVector(enu, offset, offset);
  
  const result = Cesium.Cartesian3.add(newest, offset, out);
  return result;
}

function extrapolateFixBackward(oldest, velocity, turnRateDps, dtSec, out) {
  // Extrapolate OLDEST fix BACKWARD by dtSec
  return extrapolateFixForward(oldest, velocity, -turnRateDps, -dtSec, out);
}

// ═══════════════════════════════════════════════════════════
// MAIN: Display position at render-delay with discontinuity absorption
// ═══════════════════════════════════════════════════════════

function displayPosition(hex, aircraftData) {
  // aircraftData: { hex, lat, lon, alt, spd, hdg, ... }
  // Returns: Cesium.Cartesian3 for rendering
  
  if (!Cesium || !aircraftData) return null;
  
  const now = Date.now();
  const nowMs = now;
  
  // Update history with current fix
  {
    const pos = Cesium.Cartesian3.fromDegrees(
      aircraftData.lon,
      aircraftData.lat,
      (aircraftData.alt || 0) * 0.3048  // feet -> meters
    );
    const vel = aircraftData.spd || 0;  // already in m/s from ADS-B
    const track = aircraftData.hdg !== undefined ? aircraftData.hdg : 0;
    pushFix(hex, pos, vel, track, nowMs);
  }
  
  const h = getHistory(hex);
  if (!h || h.length === 0) return null;
  
  // Render at delayed time
  const renderTime = Cesium.JulianDate.addSeconds(
    Cesium.JulianDate.now(),
    -RENDER_DELAY_SEC,
    {}  // scratch JulianDate
  );
  
  let raw = null;
  
  // Try to find bracketing pair
  for (let i = h.length - 1; i >= 1; i--) {
    const a = h[i - 1];
    const b = h[i];
    
    if (Cesium.JulianDate.lessThanOrEquals(a.time, renderTime) &&
        Cesium.JulianDate.lessThanOrEquals(renderTime, b.time)) {
      // Interpolate between a and b
      const span = Cesium.JulianDate.secondsDifference(b.time, a.time);
      const t = span > 0 ? Cesium.JulianDate.secondsDifference(renderTime, a.time) / span : 1.0;
      
      // Blend courses, weight by ground speed
      const chordLen = Cesium.Cartesian3.distance(a.position, b.position);
      const segSpeed = span > 0 ? chordLen / span : (a.velocity || 0);
      const trackFrom = Number.isFinite(a.track) ? a.track : 0;
      const trackTo = Number.isFinite(b.track) ? b.track : trackFrom;
      const trackCourse = lerpAngleDeg(trackFrom, trackTo, t);
      const w = speedRamp(segSpeed);
      const chordCourse = courseBetweenCartesians(a.position, b.position);
      const blendedCourse = chordCourse != null ? lerpAngleDeg(trackCourse, chordCourse, w) : trackCourse;
      
      raw = Cesium.Cartesian3.lerp(a.position, b.position, t, {});
      break;
    }
  }
  
  // No bracket: warm-up (extrapolate oldest backward) or coast (extrapolate newest forward, capped)
  if (!raw) {
    const oldest = h[0];
    const newest = h[h.length - 1];
    const lookbackSec = Cesium.JulianDate.secondsDifference(oldest.time, renderTime);
    
    if (lookbackSec > 0) {
      // Render time is before all history: extrapolate oldest backward (warm-up)
      raw = extrapolateFixBackward(
        oldest.position,
        oldest.velocity,
        0,  // no turn rate for backward extrapolation
        Math.min(lookbackSec, 60),
        {}
      );
    } else {
      // Render time is after all history: coast forward capped at 5 min
      const coastLimitSec = Math.min(300, 60);  // grace 1 min, cap 5 min
      const aheadSec = Cesium.JulianDate.secondsDifference(renderTime, newest.time);
      raw = extrapolateFixForward(
        newest.position,
        newest.velocity,
        0,  // no turn rate estimation for coast
        Math.min(aheadSec, coastLimitSec),
        {}
      );
    }
  }
  
  if (!raw) {
    raw = h[h.length - 1].position;
  }
  
  // ═══════════════════════════════════════════════════════════
  // DISCONTINUITY ABSORBER: Detect step, re-anchor correction, decay
  // ═══════════════════════════════════════════════════════════
  
  let correction = _drCorrection.get(hex);
  if (!correction) {
    correction = {
      vector: new Cesium.Cartesian3(0, 0, 0),
      startMs: now,
      prevRaw: Cesium.Cartesian3.clone(raw),
      prevDisplay: Cesium.Cartesian3.clone(raw)
    };
    _drCorrection.set(hex, correction);
  }
  
  // Detect implausible jump: velocity × Δt × 4× slack + 25 m base
  const velocity = aircraftData.spd || 0;
  const dtSec = Math.max(0.001, (now - (correction._lastUpdateMs || now)) / 1000);
  const plausible = velocity * dtSec * 4 + DR_CORRECTION_PLAUSIBLE_M;
  const distSq = Cesium.Cartesian3.distanceSquared(raw, correction.prevRaw);
  
  if (distSq > plausible * plausible) {
    // Re-anchor correction to DISPLAYED position (the thing on screen)
    Cesium.Cartesian3.subtract(correction.prevDisplay, raw, correction.vector);
    correction.startMs = now;
  }
  
  // Decay the correction
  const elapsed = now - correction.startMs;
  const factor = elapsed >= DR_CORRECTION_MS ? 0 : 1 - elapsed / DR_CORRECTION_MS;
  
  const display = Cesium.Cartesian3.multiplyByScalar(
    correction.vector,
    factor,
    {}
  );
  Cesium.Cartesian3.add(raw, display, display);
  
  // Remember state for next frame
  correction.prevRaw = Cesium.Cartesian3.clone(raw);
  correction.prevDisplay = Cesium.Cartesian3.clone(display);
  correction._lastUpdateMs = now;
  
  return display;
}

// ═══════════════════════════════════════════════════════════
// CLEANUP: Remove stale aircraft from history
// ═══════════════════════════════════════════════════════════

function pruneStaleAircraft(activeHexSet) {
  // activeHexSet: Set of hex codes currently in the feed
  // Remove history for aircraft no longer in the feed
  
  for (const hex of _motionHistory.keys()) {
    if (!activeHexSet.has(hex)) {
      _motionHistory.delete(hex);
      _drCorrection.delete(hex);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════

const motionModel = {
  displayPosition,
  pushFix,
  pruneStaleAircraft,
  getHistory,
  // Expose constants for testing / tuning
  RENDER_DELAY_SEC,
  DR_CORRECTION_MS,
  HISTORY_MAX,
  // Expose math for testing
  arcOffsetEnu,
  estimateTurnRateDps,
  lerpAngleDeg,
  courseBetweenCartesians
};

// If using ES6 modules (unlikely for this project):
// export default motionModel;
// If using classic scripts, expose to window:
window.motionModel = motionModel;
