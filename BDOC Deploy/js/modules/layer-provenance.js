// ============================================================
// BDOC LAYER PROVENANCE v2: Per-layer source truth + attribution
// Turn 24 audit fixes:
//  - v1 recordFetch()/recordError() were never called by any feed path, so
//    every layer showed 'idle / ?s ago' forever. v2 READS LIVE STATE from the
//    existing Health monitor (js/data.js) via a layer->feed mapping instead
//    of requiring instrumentation in every loader. Zero-drift by design.
//  - v1 invented sources that BDOC does not use (ACLED, n2yo) and described
//    the 'weather' toggle as NWS alerts when it is actually RainViewer radar.
//    All metadata below now matches the real fetch code.
// Depends on: Health (js/data.js), esc (optional)
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

(function(){
'use strict';

// Map layer toggle id -> Health feed name(s) actually used by that layer's loader.
// Feed names verified against Health.ok() call sites in index.html / js/modules/*.
const LAYER_SOURCES = {
  'air': {
    healthFeeds: ['adsb_lol', 'opensky'],
    sources: [
      { name: 'adsb.lol (ADS-B)', attribution: 'api.adsb.lol/v2 — community ADS-B aggregation', license: 'ODbL', refreshRate: '60s poll' },
      { name: 'OpenSky Network', attribution: 'opensky-network.org', license: 'CC-BY-SA (research/non-commercial)', refreshRate: 'fallback source',
        legal: 'GATED: OpenSky terms restrict use to research & non-commercial purposes. Commercial licensing requires an agreement with OpenSky Network.' }
    ],
    disclaimer: 'Positions render ~30s behind real time (interpolation window). Displayed positions between fixes are interpolated, not measured. Some military/blocked aircraft are absent from public feeds.'
  },
  'fire': {
    healthFeeds: ['nasa_firms'],
    sources: [
      { name: 'NASA FIRMS', attribution: 'NASA VIIRS/MODIS active fire detections (firms.modaps.eosdis.nasa.gov)', license: 'Public Domain (attribution appreciated)', refreshRate: '~3h satellite revisit' }
    ],
    disclaimer: 'Thermal anomaly detections, not confirmed fires. VIIRS pixel ≈375m, MODIS ≈1km — a detection marks a pixel footprint, not a point. Smoke, clouds and flare stacks cause misses/false positives.'
  },
  'eq': {
    healthFeeds: ['usgs'],
    sources: [
      { name: 'USGS Earthquake Hazards', attribution: 'earthquake.usgs.gov GeoJSON feed (M4.5+ / 24h)', license: 'Public Domain', refreshRate: '~5min poll' }
    ],
    disclaimer: 'Preliminary magnitudes and depths are frequently revised in the first hours after an event. Reporting delay is typically 2–10 minutes.'
  },
  'weather': {
    healthFeeds: ['weather'],
    sources: [
      { name: 'RainViewer', attribution: 'api.rainviewer.com composite radar tiles', license: 'Free tier — attribution required', refreshRate: '~10min frames' }
    ],
    disclaimer: 'Radar composite from volunteer/national networks; coverage is sparse over oceans and parts of Africa/Asia. Frame timestamps are the scan time, not current time.'
  },
  'conf': {
    healthFeeds: ['conflicts', 'gdelt'],
    sources: [
      { name: 'GDELT Project', attribution: 'gdeltproject.org event extraction from world news', license: 'Free for any use with attribution', refreshRate: '15min' }
    ],
    disclaimer: 'Machine-extracted from news reporting — locations can be off by tens of km (country-centroid fallback can be off by hundreds). Density reflects media coverage, not ground truth.'
  },
  'cable': {
    healthFeeds: ['telegeography'],
    sources: [
      { name: 'TeleGeography', attribution: 'submarinecablemap.com cable geometry', license: '© TeleGeography — attribution required', refreshRate: 'static (monthly-ish upstream)' }
    ],
    disclaimer: 'Routes are schematic, not surveyed positions. Recent cuts, repairs and new systems may not be reflected.'
  },
  'sat': {
    healthFeeds: ['celestrak'],
    sources: [
      { name: 'CelesTrak', attribution: 'celestrak.org TLE catalog', license: 'Public data', refreshRate: 'TLEs ~daily; positions re-propagated every 30s' }
    ],
    disclaimer: 'Positions are SGP4 propagations from TLEs — accuracy degrades with TLE age (km-scale within days). Maneuvers appear only after a new TLE is published.'
  }
};

function feedState(layer) {
  // Pull live status from Health for the first mapped feed that has been exercised
  if (typeof Health === 'undefined' || !Health.feeds) return null;
  let best = null;
  for (const fname of (layer.healthFeeds || [])) {
    const f = Health.feeds[fname];
    if (!f) continue;
    if (!best || (f.lastOk || 0) > (best.lastOk || 0)) best = f;
  }
  return best;
}

window.LayerProvenance = {
  _config: LAYER_SOURCES,

  getFreshness(layerId) {
    const cfg = LAYER_SOURCES[layerId];
    if (!cfg) return null;
    const f = feedState(cfg);
    return (f && f.lastOk) ? (Date.now() - f.lastOk) : null;
  },

  getAttribution(layerId) {
    const cfg = LAYER_SOURCES[layerId];
    if (!cfg) return '';
    const f = feedState(cfg);

    let statusTxt, statusColor;
    if (!f || f.status === 'unknown') { statusTxt = 'IDLE — not fetched yet'; statusColor = '#8b949e'; }
    else if (f.status === 'healthy')  { statusTxt = '✓ LIVE'; statusColor = '#3fb950'; }
    else if (f.status === 'degraded') { statusTxt = '⚠ DEGRADED'; statusColor = '#d29922'; }
    else                              { statusTxt = '✗ DOWN'; statusColor = '#f85149'; }

    const age = (f && f.lastOk) ? Math.round((Date.now() - f.lastOk) / 1000) : null;

    let html = `<div style="font-family:monospace;font-size:11px;color:#c8ccd6;line-height:1.6;max-width:440px">`;
    html += `<div style="font-size:13px;margin-bottom:6px"><b>${layerId.toUpperCase()}</b> <span style="color:${statusColor}">[${statusTxt}]</span></div>`;
    if (age !== null) html += `Last successful fetch: ${age < 120 ? age + 's' : Math.round(age/60) + 'min'} ago`;
    if (f && f.dataCount) html += ` · ${f.dataCount} items`;
    if (f && f.responseMs) html += ` · ${f.responseMs}ms`;
    html += `<br><br><b>Sources</b><br>`;

    cfg.sources.forEach(src => {
      html += `<div style="margin:4px 0 8px 0">• <b>${src.name}</b><br>`;
      html += `&nbsp;&nbsp;${src.attribution}<br>`;
      html += `&nbsp;&nbsp;License: <span style="color:#a371f7">${src.license}</span> · Refresh: ${src.refreshRate}`;
      if (src.legal) html += `<br>&nbsp;&nbsp;<span style="color:#f85149">⚠ ${src.legal}</span>`;
      html += `</div>`;
    });

    html += `<b>Read this before acting on the layer</b><br>`;
    html += `<span style="color:#d29922">${cfg.disclaimer}</span>`;
    html += `</div>`;
    return html;
  },

  getState() {
    const out = {};
    for (const id of Object.keys(LAYER_SOURCES)) {
      const f = feedState(LAYER_SOURCES[id]);
      out[id] = { status: f ? f.status : 'idle', lastOk: f ? f.lastOk : null, items: f ? f.dataCount : 0 };
    }
    return out;
  }
};
})();
