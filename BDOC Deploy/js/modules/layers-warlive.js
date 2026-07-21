// ============================================================
// BDOC P80 MODULE: layers-warlive.js
// LIVE WAR ROOM — real-time conflict intelligence
//
// Two fused live sources per active theater:
//  1. GDELT DOC 2.0 (browser-direct; GDELT throttles datacenter
//     IPs but serves residential fine) — last-24h war reporting,
//     zone-matched by keyword, plotted at theater anchors.
//  2. NASA FIRMS thermal detections INSIDE conflict AOI boxes —
//     the standard OSINT strike-detection technique: satellite
//     fire pixels in an active war zone are shelling/strike
//     candidates (power plants, fuel dumps, artillery fires).
//
// Depends on shared lexical env: V, Cesium, layers, esc, af, us,
// safeFetch, warliveEnts (declared in index.html).
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

// Active theaters: anchor point + AOI bbox [W,S,E,N] + GDELT match regex
window.WAR_THEATERS = [
  { id: 'ukraine', name: 'UKRAINE THEATER', lat: 48.5, lon: 35.5, bbox: [22, 44, 41, 53],
    rx: /ukrain|kyiv|kharkiv|donetsk|luhansk|zaporizh|kherson|crimea|bakhmut|avdiivka|kursk|russia.*(strike|drone|missile|offensiv)|shahed/i },
  { id: 'gaza', name: 'GAZA / ISRAEL / LEBANON', lat: 31.9, lon: 35.0, bbox: [34, 29.3, 36.7, 34.7],
    rx: /gaza|israel|idf|hamas|hezbollah|rafah|khan younis|west bank|lebanon|beirut/i },
  { id: 'sudan', name: 'SUDAN CIVIL WAR', lat: 14.5, lon: 30.5, bbox: [21.8, 8.7, 39, 23],
    rx: /sudan|khartoum|darfur|rsf|el fasher|rapid support/i },
  { id: 'redsea', name: 'YEMEN / RED SEA', lat: 15.0, lon: 45.0, bbox: [41, 11, 55, 19.5],
    rx: /yemen|houthi|red sea|bab.el.mandeb|hodeidah|sanaa/i },
  { id: 'myanmar', name: 'MYANMAR CIVIL WAR', lat: 21.0, lon: 96.5, bbox: [92, 9.5, 102, 28.6],
    rx: /myanmar|burma|junta|tatmadaw|kachin|karen|rakhine|arakan/i },
  { id: 'sahel', name: 'SAHEL INSURGENCY', lat: 14.5, lon: 2.0, bbox: [-6, 10, 16, 18],
    rx: /sahel|mali|niger|burkina|jnim|wagner|azawad/i }
];

window.loadWarLive = async function () {
  warliveEnts.forEach(e => V.entities.remove(e)); warliveEnts = [];
  let newsN = 0, thermalN = 0;

  // ── 1. GDELT live war reporting (single request, zone-matched) ──
  try {
    const q = encodeURIComponent('(strike OR shelling OR offensive OR drone OR missile OR airstrike OR frontline OR casualties)');
    const url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + q + '&mode=artlist&format=json&timespan=24h&maxrecords=200&sort=datedesc';
    const res = await safeFetch('warlive', 'conflicts', url, { feedType: 'news', staleOk: true });
    const d = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const arts = (d && d.articles) || [];
    // bucket articles into theaters by title match
    const byZone = {};
    arts.forEach(a => {
      const t = a.title || '';
      for (const z of WAR_THEATERS) {
        if (z.rx.test(t)) { (byZone[z.id] = byZone[z.id] || []).push(a); break; }
      }
    });
    const jit = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return ((h % 1000) / 1000 - 0.5) * 3.5; };
    for (const z of WAR_THEATERS) {
      const items = (byZone[z.id] || []).slice(0, 15);
      if (!items.length) continue;
      // theater intel card: latest headlines list
      const list = items.map(a =>
        '<div style="margin-bottom:7px;padding-bottom:6px;border-bottom:1px solid #1e2436">' +
        '<a href="' + esc(a.url || '#') + '" target="_blank" rel="noopener" style="color:#c8ccd6;text-decoration:none;font-size:10px;font-weight:600">' + esc((a.title || '').slice(0, 110)) + '</a>' +
        '<div style="font-size:8px;color:#4a5068;margin-top:2px">' + esc(a.domain || '') + ' · ' + esc((a.seendate || '').slice(0, 8)) + '</div></div>').join('');
      warliveEnts.push(V.entities.add({
        position: Cesium.Cartesian3.fromDegrees(z.lon, z.lat),
        billboard: undefined,
        point: { pixelSize: 11, color: Cesium.Color.fromCssColorString('#DA3633').withAlpha(0.95), outlineColor: Cesium.Color.fromCssColorString('#ff6b6b'), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: '⚡ ' + z.name + ' — ' + items.length + ' RPT/24H', font: '10px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString('#ff6b6b'), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:12px;color:#c8ccd6;background:#0a0e14;border:1px solid #DA3633;max-width:420px">' +
          '<div style="font-size:13px;font-weight:700;color:#DA3633;margin-bottom:4px">⚡ LIVE SITREP — ' + z.name + '</div>' +
          '<div style="font-size:8px;color:#8b949e;letter-spacing:1px;margin-bottom:10px">GDELT OSINT · LAST 24H · ' + items.length + ' REPORTS · AUTO-REFRESH 15MIN</div>' +
          list +
          '<div style="font-size:8px;color:#4a5068;margin-top:4px">Source: GDELT Project — live global news monitoring</div></div>',
        show: layers.warlive
      }));
      // individual event dots jittered around anchor
      items.forEach(a => {
        warliveEnts.push(V.entities.add({
          position: Cesium.Cartesian3.fromDegrees(z.lon + jit(a.url || ''), z.lat + jit(a.title || '')),
          point: { pixelSize: 4, color: Cesium.Color.fromCssColorString('#ff8888').withAlpha(0.7), disableDepthTestDistance: 5e6, scaleByDistance: new Cesium.NearFarScalar(5e5, 1.2, 1e7, 0.4) },
          description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:10px;color:#c8ccd6;background:#0a0e14;border:1px solid #DA363355;max-width:380px">' +
            '<div style="font-size:11px;font-weight:700;color:#ff8888;margin-bottom:6px">' + esc((a.title || '').slice(0, 130)) + '</div>' +
            '<div style="font-size:9px;color:#8b949e">' + esc(a.domain || '') + ' · ' + esc(z.name) + '</div>' +
            (a.url ? '<a href="' + esc(a.url) + '" target="_blank" rel="noopener" style="color:#00ddff;font-size:9px">Read source →</a>' : '') + '</div>',
          show: layers.warlive
        }));
        newsN++;
      });
    }
  } catch (e) { console.warn('[WarLive GDELT]', e); }

  // ── 2. FIRMS thermal anomalies inside war-zone AOIs = kinetic candidates ──
  try {
    // one proxy call per theater, small areas keep CSV light; run in parallel
    const results = await Promise.allSettled(WAR_THEATERS.map(z =>
      fetch('/.netlify/functions/proxy-firms?mode=area&area=' + z.bbox.join(',') + '&source=VIIRS_SNPP_NRT&days=1', { signal: AbortSignal.timeout(15000) }).then(r => r.text()).then(t => ({ z, t }))));
    results.forEach(rs => {
      if (rs.status !== 'fulfilled') return;
      const { z, t } = rs.value;
      const lines = (t || '').trim().split('\n');
      if (lines.length < 2 || !/^lat/i.test(lines[0])) return;
      const hdr = lines[0].split(',');
      const iLat = hdr.indexOf('latitude'), iLon = hdr.indexOf('longitude'), iFrp = hdr.indexOf('frp'), iTime = hdr.indexOf('acq_time');
      // cap per zone so Ukraine's agricultural burns don't flood the globe; sort by FRP (intensity)
      const rows = lines.slice(1).map(l => l.split(',')).filter(c => c.length > iFrp)
        .sort((a, b) => parseFloat(b[iFrp] || 0) - parseFloat(a[iFrp] || 0)).slice(0, 80);
      rows.forEach(c => {
        const la = parseFloat(c[iLat]), lo = parseFloat(c[iLon]), frp = parseFloat(c[iFrp] || 0);
        if (isNaN(la) || isNaN(lo)) return;
        warliveEnts.push(V.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lo, la),
          point: { pixelSize: frp > 50 ? 7 : 5, color: Cesium.Color.fromCssColorString('#FF4500').withAlpha(0.85), outlineColor: Cesium.Color.fromCssColorString('#DA3633'), outlineWidth: 1.5, disableDepthTestDistance: 5e6, scaleByDistance: new Cesium.NearFarScalar(3e5, 1.3, 8e6, 0.45) },
          description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:10px;color:#c8ccd6;background:#0d1117;border:1px solid #FF4500">' +
            '<div style="font-size:12px;font-weight:700;color:#FF4500;margin-bottom:6px">🔥 THERMAL ANOMALY — WAR ZONE</div>' +
            '<div style="font-size:10px">Theater: <b>' + esc(z.name) + '</b></div>' +
            '<div style="font-size:10px">Radiative power: <b>' + frp.toFixed(1) + ' MW</b>' + (frp > 50 ? ' <span style="color:#DA3633">— HIGH INTENSITY</span>' : '') + '</div>' +
            '<div style="font-size:10px">Detected: ' + esc(String(c[iTime] || '')) + 'Z (VIIRS)</div>' +
            '<div style="font-size:9px;color:#E8B339;margin-top:6px">⚠ Satellite fire pixel inside active conflict AOI — possible strike/shelling/kinetic activity. Verify with reporting before acting.</div>' +
            '<div style="font-size:8px;color:#8b949e;margin-top:4px">Source: NASA FIRMS VIIRS — OSINT strike-detection technique</div></div>',
          show: layers.warlive
        }));
        thermalN++;
      });
    });
  } catch (e) { console.warn('[WarLive FIRMS]', e); }

  // ── 3. P90: GDELT 2.0 EVENTS — geocoded kinetic events, typed by CAMEO code ──
  // This is event-level plotting at REAL coordinates (city/landmark precision),
  // the capability Liveuamap sells for $500+/mo. Served by proxy-gdeltevents
  // which fuses the last 3h of GDELT 15-min export files server-side.
  let eventN = 0;
  try {
    const res = await fetch('/.netlify/functions/proxy-gdeltevents?files=12', { signal: AbortSignal.timeout(25000) });
    if (res.ok) {
      const d = await res.json();
      // CAMEO taxonomy → display type. root 18=assault, 19=fight, 20=mass violence
      const typeOf = (code, root) => {
        if (root === '20') return { icon: '☢', label: 'MASS VIOLENCE', color: '#ff2d78' };
        if (code === '195' || code === '1951' || code === '1952') return { icon: '✈', label: 'AIR / DRONE STRIKE', color: '#ff6b35' };
        if (code === '194') return { icon: '⚓', label: 'NAVAL / BLOCKADE', color: '#00b4d8' };
        if (code === '193') return { icon: '⚔', label: 'GROUND CLASH', color: '#DA3633' };
        if (code === '196') return { icon: '☣', label: 'WMD / CBRN', color: '#ff2d78' };
        if (code === '186') return { icon: '🎯', label: 'ASSASSINATION ATTEMPT', color: '#E8B339' };
        if (code === '183' || code === '1831' || code === '1832' || code === '1833') return { icon: '💣', label: 'BOMBING / IED', color: '#ff6b35' };
        if (root === '18') return { icon: '✖', label: 'ASSAULT / ATTACK', color: '#E8B339' };
        return { icon: '⚔', label: 'ARMED ENGAGEMENT', color: '#DA3633' };
      };
      (d.events || []).forEach(ev => {
        const t = typeOf(ev.code, ev.root);
        const salient = ev.m >= 20; // widely-reported events get labels
        warliveEnts.push(V.entities.add({
          position: Cesium.Cartesian3.fromDegrees(ev.lon, ev.lat),
          point: { pixelSize: salient ? 8 : 5, color: Cesium.Color.fromCssColorString(t.color).withAlpha(0.9), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new Cesium.NearFarScalar(5e5, 1.3, 1.2e7, 0.5) },
          label: salient ? { text: t.icon + ' ' + t.label, font: '9px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString(t.color), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -14), disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8e6) } : undefined,
          description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:12px;color:#c8ccd6;background:#0a0e14;border:1px solid ' + t.color + ';max-width:400px">' +
            '<div style="font-size:12px;font-weight:700;color:' + t.color + ';margin-bottom:4px">' + t.icon + ' ' + t.label + '</div>' +
            '<div style="font-size:8px;color:#8b949e;letter-spacing:1px;margin-bottom:8px">GDELT EVENT ' + esc(ev.code) + ' · LAST 3H · GEOCODED</div>' +
            '<div style="font-size:10px;margin-bottom:3px">Location: <b>' + esc(ev.place || 'unknown') + '</b></div>' +
            '<div style="font-size:10px;margin-bottom:3px">Media salience: <b>' + ev.m + ' mentions</b>' + (salient ? ' <span style="color:' + t.color + '">— MAJOR EVENT</span>' : '') + '</div>' +
            '<div style="font-size:10px;margin-bottom:3px">Conflict intensity (Goldstein): <b>' + ev.g + '</b> · Tone: ' + ev.tone + '</div>' +
            (ev.url ? '<a href="' + esc(ev.url) + '" target="_blank" rel="noopener" style="color:#00ddff;font-size:9px">Read source →</a>' : '') +
            '<div style="font-size:8px;color:#4a5068;margin-top:6px">Source: GDELT 2.0 Event Database — CAMEO-coded, machine-geocoded from global media</div></div>',
          show: layers.warlive
        }));
        eventN++;
      });
    }
  } catch (e) { console.warn('[WarLive GDELT-Events]', e); }

  af('#DA3633', 'WAR ROOM: ' + eventN + ' geocoded kinetic events (3h) + ' + newsN + ' theater reports + ' + thermalN + ' thermal anomalies (24h)'); us(1);
  // auto-refresh every 15 min while armed
  if (!window.loadWarLive._interval) {
    window.loadWarLive._interval = setInterval(() => { if (layers.warlive) window.loadWarLive(); }, 15 * 60 * 1000);
  }
};
