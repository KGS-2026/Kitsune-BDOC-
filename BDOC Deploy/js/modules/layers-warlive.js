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

  // ── 0. P101: ESCALATION TREND — 7-day media-volume curve per theater.
  // Compares last-24h mean vs prior-6d mean → ▲ ESCALATING / ▼ DE-ESCALATING / ► STEADY.
  // Turns the dots into a forecast signal — no competitor at this tier has trend arrows.
  // NON-BLOCKING: markers render immediately; badges patch onto anchor entities when
  // each trend resolves (sequential fetches, GDELT limits to 1 req/5s per IP).
  // Cached 1h in sessionStorage — refresh cycles reuse it, so arrows are instant after first load.
  const trends = window._warTrends = window._warTrends || {};
  const anchorEnts = {};   // theater id → anchor entity (label patched when trend lands)
  const applyTrend = (id) => {
    const tr = trends[id], ent = anchorEnts[id];
    if (!tr || !ent) return;
    try {
      if (ent.label && tr.arrow) {
        const cur = ent.label.text && ent.label.text.getValue ? ent.label.text.getValue() : '';
        if (cur && !/^[▲▼]/.test(cur)) ent.label.text = tr.arrow + ' ' + cur;
        if (tr.delta > 0.15) ent.label.fillColor = Cesium.Color.fromCssColorString('#ff4444');
      }
      const desc = ent.description && ent.description.getValue ? String(ent.description.getValue()) : '';
      if (desc && desc.indexOf('7-DAY TREND') === -1) {
        ent.description = desc.replace('<div style="font-size:8px;color:#8b949e;letter-spacing:1px;margin-bottom:10px">',
          '<div style="font-size:10px;margin-bottom:6px">7-DAY TREND: ' + tr.badge + ' <span style="color:#4a5068;font-size:8px">(' + (tr.src || 'media volume, last 24h vs prior 6d') + ')</span></div>' +
          '<div style="font-size:8px;color:#8b949e;letter-spacing:1px;margin-bottom:10px">');
      }
    } catch (_) {}
  };
  (async () => {
    try {
      const CK = 'bdoc_war_trends_v2'; // v2: v1 could cache an EMPTY result for 1h (all-source failure) — never cache empties again
      try {
        const c = JSON.parse(sessionStorage.getItem(CK) || 'null');
        if (c && Date.now() - c.at < 3600e3 && c.trends && Object.keys(c.trends).length) {
          Object.assign(trends, c.trends); WAR_THEATERS.forEach(z => applyTrend(z.id)); return;
        }
      } catch (_) {}
      const tq = { ukraine: '(ukraine OR kyiv OR kharkiv)', gaza: '(gaza OR israel OR hezbollah)', sudan: '(sudan OR khartoum OR darfur)', redsea: '(yemen OR houthi OR "red sea")', myanmar: '(myanmar OR burma)', sahel: '(mali OR niger OR "burkina faso")' };
      // TERTIARY source (p103): Wikipedia pageviews REST API — CORS *, no IP throttle,
      // works from datacenter AND residential. Public attention on the conflict article
      // is a proven escalation proxy (spikes on major offensives). Daily granularity.
      const WIKI = { ukraine: 'Russian_invasion_of_Ukraine', gaza: 'Gaza_war', sudan: 'Sudanese_civil_war_(2023–present)', redsea: 'Red_Sea_crisis', myanmar: 'Myanmar_civil_war_(2021–present)', sahel: 'Insurgency_in_the_Sahel' };
      const mkTrend = (delta, src) => ({ delta, src,
        badge: delta > 0.15 ? '<span style="color:#DA3633;font-weight:700">▲ ESCALATING +' + Math.round(delta * 100) + '%</span>'
             : delta < -0.15 ? '<span style="color:#3FB950;font-weight:700">▼ DE-ESCALATING ' + Math.round(delta * 100) + '%</span>'
             : '<span style="color:#E8B339;font-weight:700">► STEADY</span>',
        arrow: delta > 0.15 ? '▲' : delta < -0.15 ? '▼' : '' });
      // GDELT throttles datacenter IPs → Netlify Lambda gets 'fetch failed' (verified in prod),
      // while residential browsers pass. So: browser-direct PRIMARY, proxy fallback, wiki tertiary.
      let gdeltOk = true; // when GDELT direct fails once, it'll fail for the whole session — skip the 5.5s pacing
      const fetchTrend = async (z) => {
        if (gdeltOk) {
          const direct = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(tq[z.id] || z.id) + '&mode=timelinevol&format=json&timespan=7d';
          try {
            const r = await fetch(direct, { signal: AbortSignal.timeout(10000) });
            const d = await r.json();
            const pts = (d && d.timeline && d.timeline[0] && d.timeline[0].data) || [];
            if (pts.length) return pts.map(p => ({ t: p.date, v: p.value }));
            gdeltOk = false;
          } catch (_) { gdeltOk = false; }
          try {
            const r = await fetch('/.netlify/functions/proxy-gdelt?mode=timelinevol&timespan=7d&query=' + encodeURIComponent(tq[z.id] || z.id), { signal: AbortSignal.timeout(15000) });
            const d = await r.json();
            if (d.points && d.points.length) return d.points;
          } catch (_) {}
        }
        return [];
      };
      const fetchWikiTrend = async (z) => {
        // last 8 complete days (today's count is partial → end at yesterday)
        const art = WIKI[z.id]; if (!art) return null;
        const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '') + '00';
        const end = new Date(Date.now() - 864e5), start = new Date(Date.now() - 8 * 864e5);
        try {
          const r = await fetch('https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/' +
            encodeURIComponent(art) + '/daily/' + fmt(start) + '/' + fmt(end), { signal: AbortSignal.timeout(10000) });
          if (!r.ok) return null;
          const d = await r.json();
          const vs = ((d && d.items) || []).map(i => i.views).filter(v => typeof v === 'number');
          if (vs.length < 5) return null;
          const prior = vs.slice(0, -1), last = vs[vs.length - 1];
          const pm = prior.reduce((s, v) => s + v, 0) / prior.length;
          return pm > 0 ? (last - pm) / pm : 0;
        } catch (_) { return null; }
      };
      for (const z of WAR_THEATERS) {
        const pts = await fetchTrend(z);
        if (pts.length >= 20) {
          const cut = pts.length - Math.max(4, Math.round(pts.length / 7));
          const mean = a => a.reduce((s, p) => s + p.v, 0) / (a.length || 1);
          const prior = mean(pts.slice(0, cut)), last = mean(pts.slice(cut));
          trends[z.id] = mkTrend(prior > 0 ? (last - prior) / prior : 0, 'media volume, last 24h vs prior 6d');
          applyTrend(z.id);
        } else {
          const wd = await fetchWikiTrend(z);
          if (wd !== null) { trends[z.id] = mkTrend(wd, 'public attention (Wikipedia), last 24h vs prior 7d'); applyTrend(z.id); }
        }
        await new Promise(res => setTimeout(res, gdeltOk ? 5500 : 400));
      }
      if (Object.keys(trends).length) {
        try { sessionStorage.setItem(CK, JSON.stringify({ at: Date.now(), trends })); } catch (_) {}
      }
    } catch (e) { console.warn('[WarLive trends]', e); }
  })();

  // ── 1. GDELT live war reporting (single request, zone-matched) ──
  // p103b: fetch in its own try so a throttled/failed GDELT artlist can't kill
  // the anchor loop — theaters must always render (trend badge + card need a home).
  const byZone = {};
  try {
    const q = encodeURIComponent('(strike OR shelling OR offensive OR drone OR missile OR airstrike OR frontline OR casualties)');
    const url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + q + '&mode=artlist&format=json&timespan=24h&maxrecords=200&sort=datedesc';
    const res = await safeFetch('warlive', 'conflicts', url, { feedType: 'news', staleOk: true });
    const d = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const arts = (d && d.articles) || [];
    // bucket articles into theaters by title match
    arts.forEach(a => {
      const t = a.title || '';
      for (const z of WAR_THEATERS) {
        if (z.rx.test(t)) { (byZone[z.id] = byZone[z.id] || []).push(a); break; }
      }
    });
  } catch (e) { console.warn('[WarLive GDELT artlist]', e); }
  try {
    const jit = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return ((h % 1000) / 1000 - 0.5) * 3.5; };
    for (const z of WAR_THEATERS) {
      const items = (byZone[z.id] || []).slice(0, 15);
      // p103b: anchor renders UNCONDITIONALLY — GDELT artlist is throttled for many
      // IPs (datacenter, some ISPs); without an anchor the trend badge has nowhere
      // to live and the theater vanishes from the picture entirely.
      const list = items.length ? items.map(a =>
        '<div style="margin-bottom:7px;padding-bottom:6px;border-bottom:1px solid #1e2436">' +
        '<a href="' + esc(a.url || '#') + '" target="_blank" rel="noopener" style="color:#c8ccd6;text-decoration:none;font-size:10px;font-weight:600">' + esc((a.title || '').slice(0, 110)) + '</a>' +
        '<div style="font-size:8px;color:#4a5068;margin-top:2px">' + esc(a.domain || '') + ' · ' + esc((a.seendate || '').slice(0, 8)) + '</div></div>').join('')
        : '<div style="font-size:9px;color:#8b949e">Live headline feed unavailable from this network (GDELT throttle) — trend + kinetic event dots still live.</div>';
      warliveEnts.push(V.entities.add({
        position: Cesium.Cartesian3.fromDegrees(z.lon, z.lat),
        billboard: undefined,
        point: { pixelSize: 11, color: Cesium.Color.fromCssColorString('#DA3633').withAlpha(0.95), outlineColor: Cesium.Color.fromCssColorString('#ff6b6b'), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: (trends[z.id] ? trends[z.id].arrow + ' ' : '') + '⚡ ' + z.name + ' — ' + items.length + ' RPT/24H', font: '10px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString(trends[z.id] && trends[z.id].delta > 0.15 ? '#ff4444' : '#ff6b6b'), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:12px;color:#c8ccd6;background:#0a0e14;border:1px solid #DA3633;max-width:420px">' +
          '<div style="font-size:13px;font-weight:700;color:#DA3633;margin-bottom:4px">⚡ LIVE SITREP — ' + z.name + '</div>' +
          (trends[z.id] ? '<div style="font-size:10px;margin-bottom:6px">7-DAY TREND: ' + trends[z.id].badge + ' <span style="color:#4a5068;font-size:8px">(' + (trends[z.id].src || 'media volume, last 24h vs prior 6d') + ')</span></div>' : '') +
          '<div style="font-size:8px;color:#8b949e;letter-spacing:1px;margin-bottom:10px">GDELT OSINT · LAST 24H · ' + items.length + ' REPORTS · AUTO-REFRESH 15MIN</div>' +
          list +
          '<div style="font-size:8px;color:#4a5068;margin-top:4px">Source: GDELT Project — live global news monitoring</div></div>',
        show: layers.warlive
      }));
      anchorEnts[z.id] = warliveEnts[warliveEnts.length - 1];
      applyTrend(z.id); // cached/early trend → badge on immediately
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
