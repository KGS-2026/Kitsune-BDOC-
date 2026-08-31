// ============================================================
// BDOC LAYER PROVENANCE: Per-layer source tracking + attribution
// Turn 23 Task 5: honest per-layer source states + safety disclaimer
// Depends on: Health (js/telemetry.js), EventLog
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

// Layer source metadata: { source, attribution, ttl_ms, license, disclaimer }
const LAYER_SOURCES = {
  // Air layer
  'air': {
    sources: [
      { name: 'ADS-B Exchange', attribution: 'api.adsb.lol/v2 (ODbL)', ttl: 30000, license: 'ODbL', refreshRate: '~5s' },
      { name: 'OpenSky Network', attribution: 'api.opensky-network.org (research non-commercial)', ttl: 15000, license: 'CC-BY', refreshRate: '~2s', legal: 'GATED: Research/academic use only. Commercial use requires licensing agreement.' }
    ],
    sourceOrder: 'adsb-then-opensky',
    disclaimer: 'Aircraft positions interpolated 30s behind real-time. Military aircraft filtered per international agreements. OpenSky data is restricted to research/non-commercial use — commercial plans require a license from OpenSky Network.',
    lastUpdate: null,
    status: 'idle'
  },
  // Fire layer
  'fire': {
    sources: [
      { name: 'FIRMS VIIRS', attribution: '375m thermal pixels (NASA MODIS/VIIRS)', ttl: 180000, license: 'Public Domain', refreshRate: '~3min', coverage: '±38.4° equatorial' },
      { name: 'FIRMS MODIS', attribution: '1km thermal pixels (NASA MODIS)', ttl: 180000, license: 'Public Domain', refreshRate: '~5min', coverage: '±38.4° equatorial' }
    ],
    sourceOrder: 'viirs-primary-modis-fallback',
    disclaimer: 'Thermal detections only. Low confidence in dense smoke, vegetation type misclassification, or cloud cover. VIIRS 375m±188m, MODIS 1km±500m (show as uncertainty circles).',
    lastUpdate: null,
    status: 'idle'
  },
  // Earthquake layer
  'eq': {
    sources: [
      { name: 'USGS Earthquake Hazards', attribution: 'earthquake.usgs.gov/earthquakes/feed/v1.0/summary', ttl: 300000, license: 'Public Domain', refreshRate: '~5min', threshold: '4.5+ magnitude' },
      { name: 'GDACS', attribution: 'www.gdacs.org API', ttl: 600000, license: 'CC-BY', refreshRate: '~10min', threshold: '5.0+' }
    ],
    sourceOrder: 'usgs-primary-gdacs-secondary',
    disclaimer: 'Preliminary magnitudes subject to revision. Depth estimates vary by region. No real-time network; 2–10min reporting delay typical.',
    lastUpdate: null,
    status: 'idle'
  },
  // Weather alerts
  'weather': {
    sources: [
      { name: 'NWS Alerts (US)', attribution: 'api.weather.gov/alerts/active (public domain)', ttl: 120000, license: 'Public Domain', refreshRate: '~2min', coverage: 'US only' },
      { name: '511GA Closures', attribution: '511ga.org/api/v2 (free tier)', ttl: 120000, license: 'Terms of Service', refreshRate: '~2min', coverage: 'Georgia only' }
    ],
    sourceOrder: 'us-alerts-primary-ga-closures-secondary',
    disclaimer: 'NWS alerts are official U.S. government warnings. 511GA reflects Georgia DOT/PD data; coverage gaps exist in rural areas.',
    lastUpdate: null,
    status: 'idle'
  },
  // Conflict/war layer
  'conf': {
    sources: [
      { name: 'GDELT Project', attribution: 'gdeltproject.org (Creative Commons)', ttl: 900000, license: 'CC-BY', refreshRate: '~15min', scope: 'Event reports (sources vary)' },
      { name: 'ACLED', attribution: 'acleddata.com', ttl: 1800000, license: 'CC-BY', refreshRate: '~30min', scope: 'Africa/Middle East/Asia (curated)' }
    ],
    sourceOrder: 'gdelt-primary-acled-secondary',
    disclaimer: 'Conflict data from news reports; accuracy depends on source quality. GDELT sources vary globally (sparse in remote regions). ACLED is curated but ~1 month review lag.',
    lastUpdate: null,
    status: 'idle'
  },
  // Cable layer
  'cable': {
    sources: [
      { name: 'TeleGeography Submarine Cables', attribution: 'submarinecablemap.com (attribution required)', ttl: 2592000000, license: 'Copyright TeleGeography', refreshRate: 'Monthly', coverage: 'Global' }
    ],
    sourceOrder: 'telegeography-only',
    disclaimer: 'Submarine cable routes are approximate. Cable damage, maintenance outages, and new deployments may not be reflected. Data is 1–3 months behind operational reality.',
    lastUpdate: null,
    status: 'idle'
  },
  // Satellite layer
  'sat': {
    sources: [
      { name: 'CelesTrak', attribution: 'celestrak.org (public TLE)', ttl: 86400000, license: 'Public Domain', refreshRate: '~1day', coverage: 'All tracked satellites' },
      { name: 'NORAD TLE', attribution: 'n2yo.com relay (public)', ttl: 86400000, license: 'Public Domain', refreshRate: '~1day', coverage: 'All tracked satellites' }
    ],
    sourceOrder: 'celestrak-primary-norad-fallback',
    disclaimer: 'Satellite positions propagated from TLEs (Two-Line Elements). 24–48h orbital decay lag. Real-time tracking requires NORAD re-broadcast.',
    lastUpdate: null,
    status: 'idle'
  }
};

// Global provenance state
window.LayerProvenance = {
  _state: { ...LAYER_SOURCES },
  
  // Record a successful fetch for a layer
  recordFetch(layerId, sourceId, itemCount, responseTimeMs) {
    if (!this._state[layerId]) return;
    const layer = this._state[layerId];
    layer.lastUpdate = Date.now();
    layer.status = 'live';
    layer._lastFetchMs = responseTimeMs;
    layer._lastItemCount = itemCount;
    if (typeof EventLog !== 'undefined') {
      EventLog.add('info', `Layer ${layerId}: ${itemCount} items from ${sourceId} (${responseTimeMs}ms)`);
    }
  },
  
  // Record a fetch error
  recordError(layerId, error) {
    if (!this._state[layerId]) return;
    const layer = this._state[layerId];
    layer.status = 'error';
    layer._lastError = error;
    if (typeof EventLog !== 'undefined') {
      EventLog.add('warn', `Layer ${layerId}: fetch failed — ${error}`);
    }
  },
  
  // Get freshness (age in ms)
  getFreshness(layerId) {
    if (!this._state[layerId] || !this._state[layerId].lastUpdate) return null;
    return Date.now() - this._state[layerId].lastUpdate;
  },
  
  // Check if a layer is stale (based on its TTL)
  isStale(layerId) {
    if (!this._state[layerId]) return false;
    const layer = this._state[layerId];
    if (!layer.lastUpdate || !layer.sources || layer.sources.length === 0) return true;
    const ttl = layer.sources[0].ttl || 300000; // default 5min
    const age = Date.now() - layer.lastUpdate;
    return age > ttl * 1.5; // 1.5x TTL = stale
  },
  
  // Get attribution HTML for a layer (for lightbox/tooltip)
  getAttribution(layerId) {
    if (!this._state[layerId]) return '';
    const layer = this._state[layerId];
    const freshness = this.getFreshness(layerId);
    const age = freshness ? Math.round(freshness / 1000) : '?';
    const status = this.isStale(layerId) ? '⚠ STALE' : '✓ LIVE';
    
    let html = `<div style="font-family:monospace;font-size:11px;background:#0d1117;color:#c8ccd6;padding:10px;max-width:400px;line-height:1.5">`;
    html += `<b>${layerId.toUpperCase()}</b> <span style="color:#8b949e">[${status}]</span><br>`;
    html += `Last update: ${age}s ago<br><br>`;
    html += `<b>Sources:</b><br>`;
    
    layer.sources.forEach(src => {
      html += `• <b>${src.name}</b>`;
      if (src.legal) {
        html += ` <span style="color:#f85149">⚠ ${src.legal}</span>`;
      }
      html += `<br>`;
      html += `  Attribution: ${src.attribution}<br>`;
      html += `  License: <span style="color:#a371f7">${src.license}</span><br>`;
      html += `  Refresh: ${src.refreshRate}${src.coverage ? ' (' + src.coverage + ')' : ''}<br>`;
    });
    
    html += `<br><b>Disclaimer:</b><br>`;
    html += `<span style="color:#f85149">${layer.disclaimer}</span><br>`;
    
    if (layer._lastFetchMs) {
      html += `<br><span style="color:#8b949e">Last fetch: ${layer._lastFetchMs}ms | Items: ${layer._lastItemCount || 0}</span>`;
    }
    
    html += `</div>`;
    return html;
  },
  
  // Render a badge showing layer status
  getStatusBadge(layerId) {
    if (!this._state[layerId]) return '';
    const layer = this._state[layerId];
    const isStale = this.isStale(layerId);
    const age = this.getFreshness(layerId);
    const ageMin = age ? Math.round(age / 60000) : '?';
    
    let color = isStale ? '#f85149' : '#3fb950'; // red if stale, green if live
    if (layer.status === 'error') color = '#d29922'; // orange on error
    if (layer.status === 'idle') color = '#8b949e'; // gray if idle
    
    return `<span style="display:inline-block;padding:2px 6px;background:${color};color:#fff;font-size:9px;border-radius:2px;font-weight:bold">${ageMin}min</span>`;
  },
  
  // Get full state snapshot
  getState() {
    return { ...this._state };
  }
};

// Expose globally
window.LayerProvenance = window.LayerProvenance || {};
