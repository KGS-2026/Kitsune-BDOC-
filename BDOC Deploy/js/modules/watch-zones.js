// ============================================================
// BDOC P118 MODULE: watch-zones.js
// USER-DEFINED WATCH ZONES — pin + radius, persistent monitoring
//
// Right-click anywhere → "⌖ Watch This Area" → BDOC sweeps that
// circle every 5 minutes across FOUR live event classes:
//   1. SEISMIC  — USGS M2.5+ (last day feed, one shared fetch)
//   2. WEATHER  — NWS active alerts at zone center (US only)
//   3. FIRE     — NASA FIRMS VIIRS detections inside the bbox
//   4. KINETIC  — War Room events (warliveEnts) inside the radius
//   5. OUTAGE   — OutageWatch active infra outages inside radius
// New events fire: intel-feed line + EventLog + browser
// Notification + pulsing marker at the event location.
// Zones persist in localStorage and re-arm on reload.
//
// Depends on shared lexical env: V, Cesium, esc, af, EventLog,
// BDOC.LazyLoader (all declared in index.html).
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

(function () {
  var LS_ZONES = 'bdoc_watch_zones';
  var LS_SEEN = 'bdoc_wz_seen';
  var POLL_MS = 5 * 60 * 1000;
  var AMBER = '#E8B349';

  var WZ = window.WatchZones = {
    zones: [],        // {id,name,lat,lon,radKm,ts}
    seen: {},         // eventId → ts (pruned >72h)
    _ents: {},        // zoneId → [zone entities]
    _hitEnts: {},     // zoneId → [event marker entities]
    timer: null
  };

  function save() {
    try { localStorage.setItem(LS_ZONES, JSON.stringify(WZ.zones)); } catch (_) {}
  }
  function saveSeen() {
    try {
      var cut = Date.now() - 72 * 3600 * 1000;
      Object.keys(WZ.seen).forEach(function (k) { if (WZ.seen[k] < cut) delete WZ.seen[k]; });
      localStorage.setItem(LS_SEEN, JSON.stringify(WZ.seen));
    } catch (_) {}
  }
  function km(la1, lo1, la2, lo2) {
    var R = 6371, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180;
    var a = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function bboxOf(z) { // lon1,lat1,lon2,lat2 (FIRMS area order)
    var dLat = z.radKm / 111;
    var dLon = z.radKm / (111 * Math.max(0.2, Math.cos(z.lat * Math.PI / 180)));
    return [
      Math.max(-180, z.lon - dLon), Math.max(-90, z.lat - dLat),
      Math.min(180, z.lon + dLon), Math.min(90, z.lat + dLat)
    ];
  }

  function plotZone(z) {
    try {
      if (typeof V === 'undefined' || WZ._ents[z.id]) return;
      var ents = [];
      ents.push(V.entities.add({
        position: Cesium.Cartesian3.fromDegrees(z.lon, z.lat),
        ellipse: {
          semiMajorAxis: z.radKm * 1000, semiMinorAxis: z.radKm * 1000,
          material: Cesium.Color.fromCssColorString(AMBER).withAlpha(0.05),
          outline: true, outlineColor: Cesium.Color.fromCssColorString(AMBER).withAlpha(0.55),
          height: 0
        },
        description: zoneDesc(z)
      }));
      ents.push(V.entities.add({
        position: Cesium.Cartesian3.fromDegrees(z.lon, z.lat),
        point: { pixelSize: 7, color: Cesium.Color.fromCssColorString(AMBER), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: '⌖ WATCH: ' + z.name.toUpperCase(), font: '10px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString(AMBER), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -16), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        description: zoneDesc(z)
      }));
      WZ._ents[z.id] = ents;
    } catch (e) { console.warn('[WatchZones plot]', e); }
  }

  function zoneDesc(z) {
    return '<div style="font-family:\'JetBrains Mono\',monospace;padding:12px;color:#c8ccd6;background:#0a0e14;border:1px solid ' + AMBER + ';max-width:380px">' +
      '<div style="font-size:13px;font-weight:700;color:' + AMBER + '">⌖ WATCH ZONE — ' + esc(z.name) + '</div>' +
      '<div style="font-size:8px;color:#8b949e;letter-spacing:1px;margin:4px 0 8px">' + z.lat.toFixed(4) + '°, ' + z.lon.toFixed(4) + '° · RADIUS ' + z.radKm + ' KM · 5-MIN SWEEP</div>' +
      '<div style="font-size:10px">Monitoring: seismic (USGS M2.5+) · weather (NWS) · fire (FIRMS VIIRS) · kinetic (War Room) · infra outages (OutageWatch)</div>' +
      '<div style="font-size:9px;color:#8b949e;margin-top:6px">New events fire an intel-feed alert, browser notification, and a pulsing marker at the event site.</div>' +
      '<div style="font-size:8px;color:#4a5068;margin-top:6px">Right-click inside the circle → "✕ Remove Watch Zone" to disarm.</div></div>';
  }

  function alertHit(z, id, cls, title, detail, sev, elat, elon) {
    if (WZ.seen[id]) return;
    WZ.seen[id] = Date.now(); saveSeen();
    var color = sev === 'crit' ? 'var(--rd)' : AMBER;
    try { af(color, '⌖ WATCH ZONE [' + z.name + '] ' + cls + ': ' + title); } catch (_) {}
    try { if (typeof EventLog !== 'undefined') EventLog.add(sev === 'crit' ? 'alert' : 'warn', 'WATCH ZONE ' + z.name + ' — ' + cls + ': ' + title + (detail ? ' — ' + detail : '')); } catch (_) {}
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification('BDOC WATCH ZONE: ' + z.name, { body: cls + ': ' + title + (detail ? '\n' + detail : ''), icon: '/android-chrome-192x192.png', tag: id }); } catch (_) {}
    // pulsing marker at the event location
    try {
      if (typeof V !== 'undefined' && elat != null && elon != null) {
        if (!WZ._hitEnts[z.id]) WZ._hitEnts[z.id] = [];
        var t0 = Date.now();
        WZ._hitEnts[z.id].push(V.entities.add({
          position: Cesium.Cartesian3.fromDegrees(elon, elat),
          point: {
            pixelSize: new Cesium.CallbackProperty(function () { return 8 + 4 * Math.abs(Math.sin((Date.now() - t0) / 400)); }, false),
            color: Cesium.Color.fromCssColorString(sev === 'crit' ? '#DA3633' : AMBER).withAlpha(0.95),
            outlineColor: Cesium.Color.WHITE, outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          label: { text: cls + ' · ' + title.slice(0, 40), font: '9px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString('#ffd7a1'), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -14), disableDepthTestDistance: Number.POSITIVE_INFINITY },
          description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:10px;color:#c8ccd6;background:#0a0e14;border:1px solid ' + AMBER + '">' +
            '<div style="font-weight:700;color:' + AMBER + '">⌖ ' + esc(cls) + ' — WATCH ZONE ' + esc(z.name) + '</div>' +
            '<div style="font-size:10px;margin-top:4px">' + esc(title) + '</div>' +
            (detail ? '<div style="font-size:9px;color:#8b949e;margin-top:3px">' + esc(detail) + '</div>' : '') + '</div>'
        }));
      }
    } catch (_) {}
  }

  // ── sweep sources ─────────────────────────────────────────────
  function fetchJson(url, ms) {
    return fetch(url, { signal: AbortSignal.timeout(ms || 12000) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.offline === true) throw new Error('sw-offline'); return d; });
  }

  async function sweepQuakes() {
    if (!WZ.zones.length) return;
    try {
      var d = await fetchJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
      if (!d || !Array.isArray(d.features)) return;
      d.features.forEach(function (f) {
        var c = f.geometry && f.geometry.coordinates; if (!c) return;
        WZ.zones.forEach(function (z) {
          var dist = km(z.lat, z.lon, c[1], c[0]);
          if (dist <= z.radKm) {
            var m = f.properties.mag;
            alertHit(z, 'wz:eq:' + f.id, 'SEISMIC', 'M' + m + ' quake ' + Math.round(dist) + ' km from center', f.properties.place || '', m >= 5.5 ? 'crit' : 'warn', c[1], c[0]);
          }
        });
      });
    } catch (_) {}
  }

  async function sweepNWS(z) {
    try {
      var d = await fetchJson('https://api.weather.gov/alerts/active?point=' + z.lat.toFixed(4) + ',' + z.lon.toFixed(4));
      if (!d || !Array.isArray(d.features)) return;
      d.features.forEach(function (f) {
        var p = f.properties || {};
        var sev = (p.severity === 'Extreme' || p.severity === 'Severe') ? 'crit' : 'warn';
        alertHit(z, 'wz:nws:' + f.id, 'WEATHER', (p.event || 'Weather alert'), (p.areaDesc || '').slice(0, 70), sev, z.lat, z.lon);
      });
    } catch (_) {}
  }

  async function sweepFires(z) {
    try {
      var bb = bboxOf(z);
      var r = await fetch('/.netlify/functions/proxy-firms?mode=area&area=' + bb.join(',') + '&days=1', { signal: AbortSignal.timeout(15000) });
      var text = await r.text();
      if (!text || text.charAt(0) === '{') return; // JSON = error/offline sentinel, not CSV
      var lines = text.split('\n');
      if (lines.length < 2) return;
      var hdr = lines[0].split(',');
      var iLat = hdr.indexOf('latitude'), iLon = hdr.indexOf('longitude'), iDate = hdr.indexOf('acq_date'), iTime = hdr.indexOf('acq_time'), iFrp = hdr.indexOf('frp');
      if (iLat < 0 || iLon < 0) return;
      var fresh = [], maxFrp = 0;
      for (var i = 1; i < lines.length; i++) {
        var cols = lines[i].split(',');
        var fla = parseFloat(cols[iLat]), flo = parseFloat(cols[iLon]);
        if (isNaN(fla) || isNaN(flo)) continue;
        if (km(z.lat, z.lon, fla, flo) > z.radKm) continue;
        var fid = 'wz:fire:' + z.id + ':' + fla.toFixed(2) + ',' + flo.toFixed(2) + ':' + (cols[iDate] || '');
        if (WZ.seen[fid]) continue;
        WZ.seen[fid] = Date.now();
        fresh.push({ lat: fla, lon: flo, frp: parseFloat(cols[iFrp]) || 0, t: (cols[iDate] || '') + ' ' + (cols[iTime] || '') });
        if ((parseFloat(cols[iFrp]) || 0) > maxFrp) maxFrp = parseFloat(cols[iFrp]) || 0;
      }
      saveSeen();
      if (fresh.length) {
        // aggregate: one alert per sweep, marker at strongest detection
        var strongest = fresh.reduce(function (a, b) { return b.frp > a.frp ? b : a; }, fresh[0]);
        var aggId = 'wz:fireagg:' + z.id + ':' + Date.now();
        WZ.seen[aggId] = Date.now();
        var sev = (fresh.length >= 10 || maxFrp >= 50) ? 'crit' : 'warn';
        try { af(sev === 'crit' ? 'var(--rd)' : AMBER, '⌖ WATCH ZONE [' + z.name + '] FIRE: ' + fresh.length + ' new VIIRS detection(s), max FRP ' + maxFrp.toFixed(0) + ' MW'); } catch (_) {}
        try { if (typeof EventLog !== 'undefined') EventLog.add(sev === 'crit' ? 'alert' : 'warn', 'WATCH ZONE ' + z.name + ' — FIRE: ' + fresh.length + ' new detections'); } catch (_) {}
        try { if ('Notification' in window && Notification.permission === 'granted') new Notification('BDOC WATCH ZONE: ' + z.name, { body: 'FIRE: ' + fresh.length + ' new thermal detections (VIIRS)', icon: '/android-chrome-192x192.png', tag: aggId }); } catch (_) {}
        try {
          if (typeof V !== 'undefined') {
            if (!WZ._hitEnts[z.id]) WZ._hitEnts[z.id] = [];
            WZ._hitEnts[z.id].push(V.entities.add({
              position: Cesium.Cartesian3.fromDegrees(strongest.lon, strongest.lat),
              point: { pixelSize: 10, color: Cesium.Color.ORANGERED.withAlpha(0.95), outlineColor: Cesium.Color.WHITE, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
              label: { text: 'FIRE · ' + fresh.length + ' det.', font: '9px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString('#ffb98a'), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -14), disableDepthTestDistance: Number.POSITIVE_INFINITY },
              description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:10px;color:#c8ccd6;background:#0a0e14;border:1px solid #DA3633"><div style="font-weight:700;color:#ff6b3d">🔥 FIRE — WATCH ZONE ' + esc(z.name) + '</div><div style="font-size:10px;margin-top:4px">' + fresh.length + ' new VIIRS detections in zone · strongest FRP ' + maxFrp.toFixed(0) + ' MW · ' + esc(strongest.t) + ' UTC</div></div>'
            }));
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  function sweepKinetic() {
    // scan War Room entities already on the globe (no fetch) — only if layer armed
    try {
      if (typeof V === 'undefined' || typeof warliveEnts === 'undefined' || !warliveEnts.length || !WZ.zones.length) return;
      var now = Cesium.JulianDate.now();
      warliveEnts.forEach(function (e) {
        try {
          if (!e.position) return;
          var p = e.position.getValue(now); if (!p) return;
          var carto = Cesium.Cartographic.fromCartesian(p);
          var ela = Cesium.Math.toDegrees(carto.latitude), elo = Cesium.Math.toDegrees(carto.longitude);
          WZ.zones.forEach(function (z) {
            if (km(z.lat, z.lon, ela, elo) <= z.radKm) {
              var title = (e.label && e.label.text && e.label.text.getValue ? e.label.text.getValue(now) : e.name) || 'kinetic event';
              alertHit(z, 'wz:kin:' + e.id, 'KINETIC', String(title).slice(0, 70), '', 'crit', ela, elo);
            }
          });
        } catch (_) {}
      });
    } catch (_) {}
  }

  function sweepOutages() {
    try {
      var ow = window.OutageWatch; if (!ow || !ow.active || !WZ.zones.length) return;
      var now = (typeof Cesium !== 'undefined') ? Cesium.JulianDate.now() : null;
      Object.keys(ow.active).forEach(function (id) {
        var a = ow.active[id]; if (!a || !a.ent || !a.ent.position || !now) return;
        try {
          var p = a.ent.position.getValue(now); if (!p) return;
          var carto = Cesium.Cartographic.fromCartesian(p);
          var ela = Cesium.Math.toDegrees(carto.latitude), elo = Cesium.Math.toDegrees(carto.longitude);
          WZ.zones.forEach(function (z) {
            if (km(z.lat, z.lon, ela, elo) <= z.radKm) {
              alertHit(z, 'wz:out:' + id + ':' + (a.firstSeen || ''), 'OUTAGE', (a.name || id) + ' infrastructure outage', (a.count || 0) + ' reports/1h', 'crit', ela, elo);
            }
          });
        } catch (_) {}
      });
    } catch (_) {}
  }

  async function poll() {
    if (!WZ.zones.length) return;
    sweepKinetic();
    sweepOutages();
    await sweepQuakes();
    for (var i = 0; i < WZ.zones.length; i++) {
      var z = WZ.zones[i];
      // NWS only useful for CONUS/AK/HI/territories — cheap check, still harmless elsewhere (404s silently)
      if (z.lat > 15 && z.lat < 72 && z.lon > -180 && z.lon < -60) await sweepNWS(z);
      await sweepFires(z);
    }
  }

  // ── public API ────────────────────────────────────────────────
  WZ.add = function (lat, lon, radKm, name) {
    radKm = Math.min(Math.max(radKm || 100, 5), 500);
    var z = {
      id: 'wz' + Date.now().toString(36),
      name: (name && name.trim()) || (lat.toFixed(2) + ', ' + lon.toFixed(2)),
      lat: lat, lon: lon, radKm: radKm, ts: Date.now()
    };
    WZ.zones.push(z); save(); plotZone(z);
    try { af(AMBER, '⌖ WATCH ZONE ARMED — "' + z.name + '" · ' + radKm + ' km radius · seismic/weather/fire/kinetic/outage sweep every 5 min'); } catch (_) {}
    try { if (typeof EventLog !== 'undefined') EventLog.add('info', 'WATCH ZONE armed: ' + z.name + ' (' + radKm + ' km)'); } catch (_) {}
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (_) {}
    ensureTimer();
    setTimeout(function () { poll(); }, 1500); // baseline sweep — current hazards alert once
    try { if (typeof plausible === 'function') plausible('Watch Zone Armed', { props: { radius_km: radKm } }); } catch (_) {}
    return z;
  };

  WZ.removeAt = function (lat, lon) {
    // remove the zone whose circle contains the point, else nearest within 2x radius
    var best = null, bestD = Infinity;
    WZ.zones.forEach(function (z) {
      var d = km(lat, lon, z.lat, z.lon);
      if (d <= z.radKm * 2 && d < bestD) { best = z; bestD = d; }
    });
    if (!best) { try { af('var(--t3)', 'No watch zone at that location'); } catch (_) {} return false; }
    WZ.remove(best.id);
    return true;
  };

  WZ.remove = function (id) {
    var idx = WZ.zones.findIndex(function (z) { return z.id === id; });
    if (idx < 0) return;
    var z = WZ.zones[idx];
    WZ.zones.splice(idx, 1); save();
    try {
      (WZ._ents[id] || []).forEach(function (e) { V.entities.remove(e); });
      (WZ._hitEnts[id] || []).forEach(function (e) { V.entities.remove(e); });
    } catch (_) {}
    delete WZ._ents[id]; delete WZ._hitEnts[id];
    try { af('var(--t2)', '⌖ Watch zone "' + z.name + '" disarmed'); } catch (_) {}
    try { if (typeof EventLog !== 'undefined') EventLog.add('info', 'WATCH ZONE disarmed: ' + z.name); } catch (_) {}
    if (!WZ.zones.length && WZ.timer) { clearInterval(WZ.timer); WZ.timer = null; }
  };

  WZ.clearAll = function () {
    WZ.zones.slice().forEach(function (z) { WZ.remove(z.id); });
  };

  function ensureTimer() {
    if (!WZ.timer) WZ.timer = setInterval(poll, POLL_MS);
  }

  // ── init: restore persisted zones ─────────────────────────────
  try {
    var saved = JSON.parse(localStorage.getItem(LS_ZONES) || '[]');
    if (Array.isArray(saved)) WZ.zones = saved.filter(function (z) { return z && typeof z.lat === 'number' && typeof z.lon === 'number'; });
    var seen = JSON.parse(localStorage.getItem(LS_SEEN) || '{}');
    if (seen && typeof seen === 'object') WZ.seen = seen;
  } catch (_) {}

  if (WZ.zones.length) {
    // V may not exist yet if loaded very early — retry plot until viewer ready
    var tries = 0;
    (function plotWhenReady() {
      if (typeof V !== 'undefined' && V) {
        WZ.zones.forEach(plotZone);
        ensureTimer();
        setTimeout(poll, 4000);
        try { af(AMBER, '⌖ ' + WZ.zones.length + ' watch zone(s) re-armed from previous session'); } catch (_) {}
      } else if (++tries < 40) setTimeout(plotWhenReady, 500);
    })();
  }

  console.log('[WatchZones] module loaded —', WZ.zones.length, 'persisted zone(s)');
})();
