// ============================================================
// BDOC MODULE: county-brief.js
// COUNTY BRIEF — one click, one county, everything an emergency manager needs (p168).
//
// Pick a spot (map menu, Tools menu, or MY COUNTY under Near Me). The server
// (/.netlify/functions/county-brief) finds the U.S. county under it and gathers,
// for that county only: NWS warnings, river gauges at action stage or above,
// tropical storms nearby, satellite fire detections, quakes, open FEMA shelters
// and the forecast. This draws the county line, marks flooding gauges and open
// shelters, and shows the brief with one overall level. Print SITREP gives the
// one-page version for the morning brief; Watch This County arms a watch zone
// over it, which can reach the coordinator's phone.
// Depends on shared lexical env: V, Cesium, esc, af, _bdocCopy, BDOC.LazyLoader.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

(function () {
  const URL_ = '/.netlify/functions/county-brief';
  const LEVEL = {
    SEVERE:   { color: '#DA3633', note: 'Act now: a severe hazard is in or near the county.' },
    ELEVATED: { color: '#E8B339', note: 'Watch closely: something is building.' },
    NORMAL:   { color: '#3FB950', note: 'Nothing active in the feeds BDOC checks.' }
  };
  const FLOOD = { 4: ['#B37FEB', 'major flood'], 3: ['#DA3633', 'moderate flood'], 2: ['#E8B339', 'minor flood'], 1: ['#D29922', 'action stage'] };
  const FLOOD_WORDS = { major: 'major flood', moderate: 'moderate flood', minor: 'minor flood', action: 'action stage', no_flooding: 'below flood stage' };
  const SEV_COLOR = { Extreme: '#B37FEB', Severe: '#DA3633', Moderate: '#E8B339', Minor: '#58A6FF', Unknown: '#8b949e' };

  const st = window.BDOCCountyBrief = { data: null, ds: null, panel: null, ctrl: null, spot: null };
  const E = (v) => esc(String(v == null ? '' : v));
  const hhmm = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toISOString().slice(11, 16) + 'Z' : ''; };

  // ---- globe: county line + markers ----
  function clearGlobe() {
    if (st.ds) { try { V.dataSources.remove(st.ds, true); } catch (_) {} st.ds = null; }
    try { V.scene.requestRender(); } catch (_) {}
  }

  function point(ds, lat, lon, color, label, name, html) {
    ds.entities.add({
      name,
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: { pixelSize: 11, color: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: label, font: '600 11px "JetBrains Mono",monospace', fillColor: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -16), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 400000) },
      description: html
    });
  }

  const card = (color, title, rows) => '<div style="font-family:\'JetBrains Mono\',monospace;background:#0a0e14;border:1px solid ' + color + ';color:#c8ccd6;padding:10px 12px;max-width:380px">' +
    '<div style="font-size:9px;font-weight:700;color:' + color + ';letter-spacing:1.5px;margin-bottom:6px">' + title + '</div>' + rows + '</div>';

  function drawGlobe(b) {
    clearGlobe();
    const ds = st.ds = new Cesium.CustomDataSource('county-brief');
    V.dataSources.add(ds);
    const lv = LEVEL[b.level.level] || LEVEL.NORMAL;
    for (const ring of b.county.outline || []) {
      if (!ring || ring.length < 3) continue;
      const flat = [];
      for (const [x, y] of ring) flat.push(x, y);
      ds.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flat),
          width: 3, clampToGround: true,
          material: Cesium.Color.fromCssColorString(lv.color).withAlpha(0.95)
        }
      });
    }
    for (const g of (b.gauges && b.gauges.flooding) || []) {
      const [color, words] = FLOOD[g.rank] || FLOOD[1];
      point(ds, g.lat, g.lon, color, g.lid || 'GAUGE', g.name,
        card(color, 'RIVER GAUGE · ' + words.toUpperCase(),
          '<div style="font-size:12px;color:#e6edf3;font-weight:700;margin-bottom:4px">' + E(g.name) + '</div>' +
          '<div style="font-size:10px">Now: ' + E(FLOOD_WORDS[g.observed] || 'n/a') + (g.stage !== null ? ' (' + E(g.stage) + ' ' + E(g.unit) + ')' : '') + '</div>' +
          (g.forecast ? '<div style="font-size:10px">Forecast: ' + E(FLOOD_WORDS[g.forecast] || g.forecast) + '</div>' : '') +
          '<div style="font-size:8px;color:#4a5068;margin-top:6px">NOAA National Water Prediction Service · ' + E(g.lid) + '</div>'));
    }
    for (const s of b.shelters || []) {
      point(ds, s.lat, s.lon, '#58A6FF', 'SHELTER', s.name,
        card('#58A6FF', 'OPEN SHELTER · FEMA',
          '<div style="font-size:12px;color:#e6edf3;font-weight:700;margin-bottom:4px">' + E(s.name) + '</div>' +
          '<div style="font-size:10px">' + E(s.city) + (s.status ? ' · ' + E(s.status) : '') + '</div>' +
          (s.capacity ? '<div style="font-size:10px">Occupancy ' + E(s.population == null ? '?' : s.population) + ' of ' + E(s.capacity) + '</div>' : '') +
          '<div style="font-size:10px">' + (s.pets ? 'Pets accepted' : 'Pets: not listed') + (s.ada ? ' · ADA' : '') + '</div>'));
    }
    for (const q of b.quakes || []) {
      point(ds, q.lat, q.lon, '#E8B339', 'M' + q.mag, 'M' + q.mag + ' earthquake',
        card('#E8B339', 'EARTHQUAKE · USGS', '<div style="font-size:12px;color:#e6edf3;font-weight:700">M' + E(q.mag) + '</div><div style="font-size:10px">' + E(q.place) + '</div>'));
    }
    V.scene.requestRender();
  }

  function flyTo(c) {
    const [w, s, e, n] = c.bbox;
    const padLon = Math.max((e - w) * 0.25, 0.05), padLat = Math.max((n - s) * 0.25, 0.05);
    try { V.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(w - padLon, s - padLat, e + padLon, n + padLat), duration: 1.8 }); } catch (_) {}
  }

  // ---- panel ----
  function ensurePanel() {
    if (st.panel) return st.panel;
    const el = st.panel = document.createElement('div');
    el.id = 'countyBriefPanel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'County brief');
    // Above the map and the Situations panel (51), under the top bar and its menus (100), the
    // layers drawer (100) and the map menu (200), so those still open over the brief. On narrow
    // screens the layers drawer is a bottom sheet, so the brief is a top sheet that ends above it.
    const place = window.innerWidth >= 900
      ? 'left:220px;top:96px;width:360px;max-height:calc(100vh - 140px);z-index:60;'
      : 'right:8px;top:64px;width:min(400px,calc(100vw - 16px));max-height:calc(58vh - 64px);z-index:99;';
    el.style.cssText = 'position:fixed;' + place + 'overflow:auto;padding:12px 14px;background:rgba(10,14,20,.96);border:1px solid #30363d;font:11px/1.45 "JetBrains Mono",monospace;color:#c8ccd6;box-shadow:0 8px 28px rgba(0,0,0,.5)';
    document.body.appendChild(el);
    return el;
  }

  // Sticky, so close stays in reach while a long brief scrolls.
  const head = (title) => '<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:-12px;z-index:1;margin:-12px -14px 8px;padding:10px 14px 6px;background:rgba(10,14,20,.98)">' +
    '<b style="color:#E8B339;letter-spacing:1.5px;font-size:10px">' + title + '</b>' +
    '<button data-x aria-label="Close county brief" style="background:none;border:0;color:#8b949e;cursor:pointer;font:inherit;font-size:13px;padding:2px 6px">✕</button></div>';

  function wireClose(el) { const x = el.querySelector('[data-x]'); if (x) x.onclick = close; }

  function showMessage(title, msg, color) {
    const el = ensurePanel();
    el.style.display = 'block';
    el.innerHTML = head(title) + '<div style="color:' + (color || '#c8ccd6') + '">' + msg + '</div>';
    wireClose(el);
  }

  function section(title, srcOk, body) {
    return '<div style="margin-top:9px"><div style="color:#8b949e;font-size:9px;letter-spacing:1.2px;margin-bottom:3px">' + title + '</div>' +
      (srcOk ? body : '<div style="color:#6e7681">Not available right now. Check the source directly.</div>') + '</div>';
  }

  function renderPanel(b) {
    const el = ensurePanel();
    el.style.display = 'block';
    const c = b.county, lv = LEVEL[b.level.level] || LEVEL.NORMAL, ok = (k) => b.sources && b.sources[k] === 'ok';
    const none = (t) => '<div style="color:#6e7681">' + t + '</div>';
    const row = (color, main, sub) => '<div style="border-left:2px solid ' + color + ';padding:2px 0 2px 7px;margin:3px 0"><div style="color:#e6edf3">' + main + '</div>' + (sub ? '<div style="color:#8b949e;font-size:10px">' + sub + '</div>' : '') + '</div>';

    const alerts = !b.alerts || !b.alerts.length ? none('No NWS warnings, watches or advisories in effect.') :
      b.alerts.map(a => row(SEV_COLOR[a.severity] || '#8b949e',
        E(a.event) + (a.where ? ' · ' + E(a.where) : '') + (a.ends ? ' <span style="color:#8b949e">until ' + E(hhmm(a.ends)) + '</span>' : ''), E(a.headline))).join('');
    const g = b.gauges;
    const rivers = !g ? '' : (g.flooding.length
      ? g.flooding.map(x => row((FLOOD[x.rank] || FLOOD[1])[0], E(x.name), 'Now ' + E(FLOOD_WORDS[x.observed] || 'n/a') + (x.forecast ? ' · forecast ' + E(FLOOD_WORDS[x.forecast] || x.forecast) : '') + (x.stage !== null ? ' · ' + E(x.stage) + ' ' + E(x.unit) : ''))).join('') +
        none(g.reporting + ' gauge' + (g.reporting === 1 ? '' : 's') + ' reporting in all.')
      : none(g.reporting + ' gauge' + (g.reporting === 1 ? '' : 's') + ' reporting, none at action stage or above.'));
    const storms = !b.storms || !b.storms.length ? none('No active storm within 1,500 km.') :
      b.storms.map(s => row(s.distanceKm <= 300 ? '#DA3633' : s.distanceKm <= 1000 ? '#E8B339' : '#8b949e', E(s.classification + ' ' + s.name) + ' · ' + E(s.distanceKm.toLocaleString()) + ' km',
        (s.intensityKt ? E(s.intensityKt) + ' kt' : '') + (s.movement ? ' · moving ' + E(s.movement) : '') + (s.advisory ? ' · <a href="' + E(s.advisory) + '" target="_blank" rel="noopener" style="color:#58A6FF">advisory</a>' : ''))).join('');
    const fires = !b.fires ? '' : (b.fires.count
      ? row(b.fires.count >= 25 || b.fires.maxFrp >= 100 ? '#DA3633' : b.fires.count >= 3 || b.fires.maxFrp >= 20 ? '#E8B339' : '#8b949e',
          b.fires.count + ' satellite detection' + (b.fires.count === 1 ? '' : 's'), b.fires.maxFrp >= 1 ? 'Strongest ' + b.fires.maxFrp + ' MW' : '')
      : none('No detections in the last 24 hours.'));
    const quakes = !b.quakes || !b.quakes.length ? none('None M2.5+ in the last 24 hours.') :
      b.quakes.map(q => row(q.mag >= 5 ? '#DA3633' : q.mag >= 3.5 ? '#E8B339' : '#8b949e', 'M' + E(q.mag), E(q.place))).join('');
    const shelters = !b.shelters || !b.shelters.length ? none('None open in the county.') :
      b.shelters.map(s => row('#58A6FF', E(s.name), E(s.city) + (s.capacity ? ' · ' + E(s.population == null ? '?' : s.population) + '/' + E(s.capacity) : '') + (s.pets ? ' · pets' : '') + (s.ada ? ' · ADA' : ''))).join('');
    const fc = !b.forecast || !b.forecast.length ? '' :
      b.forecast.map(f => '<div style="display:flex;gap:8px;margin:2px 0"><span style="min-width:96px;color:#8b949e">' + E(f.name) + '</span><span>' + E(f.short) + (f.temp !== null ? ', ' + E(f.temp) + '°' + E(f.unit) : '') + '</span></div>').join('');

    const failed = Object.keys(b.sources || {}).filter(k => b.sources[k] !== 'ok');
    el.innerHTML = head('COUNTY BRIEF') +
      '<div style="font-size:15px;font-weight:700;color:#e6edf3">' + E(c.name) + ', ' + E(c.state) + '</div>' +
      '<div style="color:#6e7681;font-size:9px;margin-bottom:8px">FIPS ' + E(c.geoid) + ' · as of ' + E(hhmm(b.asOf)) + '</div>' +
      '<div style="border:1px solid ' + lv.color + ';background:' + lv.color + '1f;padding:7px 9px">' +
        '<div style="color:' + lv.color + ';font-weight:700;letter-spacing:2px;font-size:13px">' + E(b.level.level) + '</div>' +
        '<div style="color:#c8ccd6;font-size:10px">' + lv.note + '</div>' +
        (b.level.reasons.length ? '<ul style="margin:5px 0 0 16px;padding:0">' + b.level.reasons.map(r => '<li>' + E(r) + '</li>').join('') + '</ul>' : '') +
      '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:9px">' +
        btn('print', 'PRINT SITREP', '#E8B339') + btn('copy', 'COPY', '#c8ccd6') + btn('watch', 'WATCH THIS COUNTY', '#3FB950') + btn('refresh', 'REFRESH', '#8b949e') +
      '</div>' +
      section('WARNINGS · NWS', ok('nws_alerts'), alerts) +
      section('RIVERS · NOAA GAUGES', ok('nwps_gauges'), rivers) +
      section('TROPICAL · NHC', ok('nhc_storms'), storms) +
      section('FIRE · NASA FIRMS 24 H', ok('nasa_firms'), fires) +
      section('EARTHQUAKES · USGS 24 H', ok('usgs_quakes'), quakes) +
      section('SHELTERS · FEMA', ok('fema_shelters'), shelters) +
      section('FORECAST · NWS, COUNTY CENTRE', ok('nws_forecast') && !!fc, fc) +
      (failed.length ? '<div style="margin-top:9px;color:#D29922;font-size:9px">' + failed.length + ' source' + (failed.length === 1 ? '' : 's') + ' did not answer: ' + E(failed.join(', ')) + '. Missing data is shown as missing, never as all clear.</div>' : '') +
      '<div style="margin-top:9px;color:#4a5068;font-size:9px;line-height:1.4">U.S. government data: NWS, NOAA, NHC, NASA, USGS, FEMA, Census. Updates every 2 minutes at most. Verify before acting.</div>';
    wireClose(el);
    el.querySelector('[data-b="print"]').onclick = () => printSitrep(b);
    el.querySelector('[data-b="copy"]').onclick = () => copySitrep(b);
    el.querySelector('[data-b="watch"]').onclick = () => watchCounty(b);
    el.querySelector('[data-b="refresh"]').onclick = () => open_(st.spot.lat, st.spot.lon, { refresh: true });
  }

  const btn = (k, label, color) => '<button data-b="' + k + '" style="background:transparent;border:1px solid ' + color + '66;color:' + color + ';font:600 9px \'JetBrains Mono\',monospace;letter-spacing:1px;padding:6px 8px;cursor:pointer;min-height:30px">' + label + '</button>';

  const sitrepText = (b) => (b.sitrep || []).join('\n');

  function copySitrep(b) {
    const text = sitrepText(b);
    if (typeof _bdocCopy === 'function') _bdocCopy(text, 'SITREP copied: ' + b.county.name + ', ' + b.county.state);
    else { try { navigator.clipboard.writeText(text); af('#3FB950', 'SITREP copied'); } catch (_) {} }
  }

  function printSitrep(b) {
    const lines = b.sitrep || [];
    const w = window.open('', '_blank');
    if (!w) { copySitrep(b); af('#E8B339', 'Pop-up blocked, so the SITREP was copied instead'); return; }
    const lv = LEVEL[b.level.level] || LEVEL.NORMAL;
    w.document.open();
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + E(lines[0] || 'SITREP') + '</title>' +
      '<style>body{font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;margin:28px;color:#000;background:#fff}' +
      'h1{font-size:16px;margin:0 0 2px}.lv{display:inline-block;border:2px solid ' + lv.color + ';color:' + lv.color + ';padding:2px 8px;font-weight:700;letter-spacing:2px;margin:6px 0}' +
      'pre{white-space:pre-wrap;font:inherit;margin:10px 0}.ft{color:#555;font-size:10px;border-top:1px solid #ccc;padding-top:6px}@media print{body{margin:12mm}}</style></head><body>' +
      '<h1>' + E(lines[0] || '') + '</h1><div class="lv">' + E(b.level.level) + '</div>' +
      '<pre>' + lines.slice(1).map(E).join('\n') + '</pre>' +
      '<div class="ft">Kitsune BDOC · kgsbdoc.netlify.app · Printed ' + E(new Date().toISOString().slice(0, 16).replace('T', ' ')) + 'Z</div></body></html>');
    w.document.close();
    try { w.focus(); setTimeout(() => { try { w.print(); } catch (_) {} }, 250); } catch (_) {}
  }

  // A watch zone is a circle: the smallest one from the county centre that covers the whole line.
  function coverRadiusKm(c) {
    const R = 6371, r = Math.PI / 180;
    let max = 5;
    for (const ring of c.outline || []) {
      const step = Math.max(1, Math.floor(ring.length / 400));
      for (let i = 0; i < ring.length; i += step) {
        const [x, y] = ring[i];
        const dLa = (y - c.lat) * r, dLo = (x - c.lon) * r;
        const a = Math.sin(dLa / 2) ** 2 + Math.cos(c.lat * r) * Math.cos(y * r) * Math.sin(dLo / 2) ** 2;
        max = Math.max(max, 2 * R * Math.asin(Math.sqrt(a)));
      }
    }
    return Math.ceil(max / 5) * 5;
  }

  function watchCounty(b) {
    const c = b.county;
    const rad = coverRadiusKm(c);
    BDOC.LazyLoader.load('watch-zones')
      .then(() => window.WatchZones.add(c.lat, c.lon, rad, c.name + ', ' + c.state))
      .catch(() => af('var(--rd)', 'Watch zones failed to load'));
  }

  // ---- open / close ----
  async function open_(lat, lon, opts) {
    opts = opts || {};
    if (!(Number.isFinite(lat) && Number.isFinite(lon))) return;
    st.spot = { lat, lon };
    if (st.ctrl) { try { st.ctrl.abort(); } catch (_) {} }
    const ctrl = st.ctrl = new AbortController();
    if (!opts.refresh) showMessage('COUNTY BRIEF', 'Finding the county and checking warnings, rivers, storms, fire, quakes and shelters…');
    else af('var(--kf)', 'Refreshing county brief…');
    const q = '?lat=' + (Math.round(lat * 1000) / 1000) + '&lon=' + (Math.round(lon * 1000) / 1000);
    let r, body;
    try {
      const t = setTimeout(() => ctrl.abort(), 20000);
      r = await fetch(URL_ + q, { signal: ctrl.signal });
      clearTimeout(t);
      body = await r.json().catch(() => ({}));
    } catch (e) {
      if (ctrl !== st.ctrl) return; // a newer request replaced this one
      showMessage('COUNTY BRIEF', navigator.onLine === false ? 'You are offline. The county brief needs a connection.' : 'The county brief took too long. Try again in a minute.', '#D29922');
      return;
    }
    if (ctrl !== st.ctrl) return;
    if (r.status === 404) { clearGlobe(); showMessage('COUNTY BRIEF', E(body.error || 'No U.S. county here.') + '<div style="color:#8b949e;margin-top:6px">Pick a spot inside the United States.</div>'); return; }
    if (!r.ok || !body || !body.county) { showMessage('COUNTY BRIEF', E(body.error || 'County brief is unavailable right now. Try again in a minute.'), '#D29922'); return; }
    st.data = body;
    renderPanel(body);
    drawGlobe(body);
    if (!opts.refresh) flyTo(body.county);
    const lv = LEVEL[body.level.level] || LEVEL.NORMAL;
    af(lv.color, 'COUNTY BRIEF: ' + body.county.name + ', ' + body.county.state + ' · ' + body.level.level);
    try { if (typeof EventLog !== 'undefined') EventLog.add(body.level.level === 'SEVERE' ? 'warn' : 'info', 'County brief: ' + body.county.name + ', ' + body.county.state + ' ' + body.level.level); } catch (_) {}
    try { if (typeof plausible === 'function') plausible('County Brief', { props: { level: body.level.level, state: body.county.state } }); } catch (_) {}
  }

  function close() {
    if (st.ctrl) { try { st.ctrl.abort(); } catch (_) {} st.ctrl = null; }
    if (st.panel) st.panel.style.display = 'none';
    clearGlobe();
  }

  window.openCountyBrief = open_;
  window.closeCountyBrief = close;
})();
