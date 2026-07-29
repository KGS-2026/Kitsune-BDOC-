// ============================================================
// BDOC P102 MODULE: outage-watch.js
// ALWAYS-ON INFRASTRUCTURE OUTAGE SENTINEL
//
// Born 2026-07-27: T-Mobile went down nationwide and BDOC said
// nothing. Root cause: carriers have NO public status APIs, the
// service layer was toggle-only, and GTA refreshed every 3h.
//
// This module runs ALWAYS (armed at boot, no toggle needed):
//  1. NEWS-DETECT (every 3 min): GDELT DOC last-1h reporting,
//     browser-direct, query (outage OR down OR disruption) —
//     titles matched against a watchlist of critical infra
//     (carriers, clouds, payment rails, GPS). N+ distinct
//     reports in the window = OUTAGE ALERT.
//  2. STATUSPAGE SWEEP (every 2 min): the ~15 services with real
//     status APIs — any non-'none' indicator = instant alert.
//  Alerts: red banner + intel feed entry + globe marker at HQ +
//  GTA "infra" component bump + browser notification (if allowed).
//
// Depends on shared lexical env: V, Cesium, esc, af (intel feed).
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

(function () {
  // ── watchlist: critical infrastructure matched in news titles ──
  // rx must be specific enough to avoid false hits ("down" gated by context words in query)
  var WATCH = [
    { id: 'tmobile', name: 'T-Mobile', rx: /t[- ]?mobile/i, kind: 'CARRIER', lat: 47.61, lon: -122.20, hq: 'Bellevue WA' },
    { id: 'att', name: 'AT&T', rx: /\bat&t\b|\batt\b.{0,12}(outage|down|service)/i, kind: 'CARRIER', lat: 32.78, lon: -96.80, hq: 'Dallas TX' },
    { id: 'verizon', name: 'Verizon', rx: /verizon/i, kind: 'CARRIER', lat: 40.71, lon: -74.01, hq: 'New York NY' },
    { id: 'comcast', name: 'Comcast/Xfinity', rx: /comcast|xfinity/i, kind: 'ISP', lat: 39.95, lon: -75.17, hq: 'Philadelphia PA' },
    { id: 'spectrum', name: 'Charter/Spectrum', rx: /\bspectrum\b.{0,20}(outage|down|internet)|charter communications/i, kind: 'ISP', lat: 41.77, lon: -72.67, hq: 'Stamford CT' },
    { id: 'starlink', name: 'Starlink', rx: /starlink/i, kind: 'SATCOM', lat: 25.99, lon: -97.19, hq: 'Boca Chica TX' },
    { id: 'aws', name: 'AWS', rx: /\baws\b|amazon web services/i, kind: 'CLOUD', lat: 38.96, lon: -77.35, hq: 'us-east-1 VA' },
    { id: 'azure', name: 'Microsoft Azure/365', rx: /\bazure\b|microsoft 365|office 365|teams outage/i, kind: 'CLOUD', lat: 47.64, lon: -122.13, hq: 'Redmond WA' },
    { id: 'gcp', name: 'Google Cloud/Workspace', rx: /google cloud|gmail.{0,12}(outage|down)|google.{0,10}(outage|down)/i, kind: 'CLOUD', lat: 37.42, lon: -122.08, hq: 'Mountain View CA' },
    { id: 'cloudflare', name: 'Cloudflare', rx: /cloudflare/i, kind: 'CDN', lat: 37.78, lon: -122.39, hq: 'San Francisco CA' },
    { id: 'visa', name: 'Visa/Mastercard rails', rx: /\bvisa\b.{0,16}(outage|down)|mastercard.{0,16}(outage|down)|card payments?.{0,10}(outage|down|fail)/i, kind: 'PAYMENTS', lat: 38.95, lon: -77.36, hq: 'Ashburn VA' },
    { id: 'zelle', name: 'Zelle/Banking apps', rx: /zelle|bank of america.{0,12}(outage|down)|chase.{0,12}(outage|down)|wells fargo.{0,12}(outage|down)/i, kind: 'BANKING', lat: 40.71, lon: -74.01, hq: 'New York NY' },
    { id: 'gps', name: 'GPS/GNSS', rx: /\bgps\b.{0,18}(outage|jam|spoof|disrupt)|gnss/i, kind: 'NAVIGATION', lat: 38.80, lon: -104.52, hq: 'Schriever SFB CO' },
    { id: 'faa', name: 'FAA/ATC systems', rx: /\bfaa\b.{0,20}(outage|ground stop|system)|ground stop/i, kind: 'AVIATION', lat: 38.89, lon: -77.02, hq: 'Washington DC' },
    { id: 'power', name: 'Power grid (mass outage)', rx: /(power|grid|electricity).{0,22}(outage|blackout|down).{0,30}(thousand|million|widespread|state|city)|blackout.{0,20}(hits|across)/i, kind: 'GRID', lat: 39.5, lon: -98.35, hq: 'CONUS' }
  ];

  // statuspage sweep set (real APIs, CORS-friendly directly or via proxy-status)
  var STATUSPAGES = [
    { name: 'Cloudflare', url: 'https://www.cloudflarestatus.com/api/v2/status.json' },
    { name: 'GitHub', url: 'https://www.githubstatus.com/api/v2/status.json' },
    { name: 'Discord', url: 'https://discordstatus.com/api/v2/status.json' },
    { name: 'Meta', url: 'https://metastatus.com/api/v2/status.json' },
    { name: 'Twilio', url: 'https://status.twilio.com/api/v2/status.json' },
    { name: 'Reddit', url: 'https://www.redditstatus.com/api/v2/status.json' },
    { name: 'DigitalOcean', url: 'https://status.digitalocean.com/api/v2/status.json' },
    { name: 'Netlify', url: 'https://www.netlifystatus.com/api/v2/status.json' },
    { name: 'OpenAI', url: 'https://status.openai.com/api/v2/status.json' },
    { name: 'Slack', url: 'https://status.slack.com/api/v2/status.json' },
    { name: 'Zoom', url: 'https://status.zoom.us/api/v2/status.json' }
  ];

  var state = window.OutageWatch = {
    active: {},          // id → {name, kind, count, firstSeen, lastSeen, titles:[{t,u}], ent}
    statuspage: {},      // name → indicator
    lastNewsPoll: 0, lastStatusPoll: 0,
    newsOk: false,       // whether GDELT is reachable from this client
    score: 0             // 0-25 GTA infra component
  };

  function banner(html, color) {
    var b = document.getElementById('outageBanner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'outageBanner';
      b.style.cssText = 'position:fixed;top:52px;left:50%;transform:translateX(-50%);z-index:99990;max-width:720px;width:calc(100% - 40px);font-family:"JetBrains Mono",monospace;font-size:11px;padding:10px 36px 10px 14px;background:#16090b;border:1px solid #DA3633;border-left:4px solid #DA3633;color:#ffd7d7;box-shadow:0 8px 24px rgba(0,0,0,.55);display:none';
      var x = document.createElement('div');
      x.textContent = '×'; x.style.cssText = 'position:absolute;top:6px;right:10px;cursor:pointer;font-size:15px;color:#8b949e';
      x.onclick = function () { b.style.display = 'none'; };
      b.appendChild(x);
      var inner = document.createElement('div'); inner.id = 'outageBannerMsg';
      b.appendChild(inner);
      document.body.appendChild(b);
    }
    var m = document.getElementById('outageBannerMsg');
    if (m) m.innerHTML = html;
    b.style.borderColor = color || '#DA3633'; b.style.borderLeftColor = color || '#DA3633';
    b.style.display = 'block';
  }

  function notify(title, body) {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') new Notification(title, { body: body, icon: '/android-chrome-192x192.png' });
    } catch (_) {}
  }

  function buildDesc(w, a) {
    var fusionHtml = '';
    if (a.fusion) {
      var f = a.fusion;
      var col = f.cause === 'UNDETERMINED' ? '#8b949e' : (f.confidence === 'HIGH' ? '#DA3633' : '#E8B339');
      fusionHtml = '<div style="margin:8px 0;padding:8px;border:1px solid ' + col + ';background:rgba(0,0,0,.3)">' +
        '<div style="font-size:11px;font-weight:700;color:' + col + '">◈ PROBABLE CAUSE: ' + esc(f.cause) + (f.cause !== 'UNDETERMINED' ? ' <span style="font-size:9px">(' + esc(f.confidence) + ' confidence)</span>' : '') + '</div>' +
        '<div style="font-size:9px;color:#c8ccd6;margin-top:3px">' + esc(f.why) + '</div>' +
        (f.evidence || []).slice(0, 4).map(function (e2) {
          return '<div style="font-size:9px;margin-top:3px">↳ ' + (e2.u ? '<a href="' + esc(e2.u) + '" target="_blank" rel="noopener" style="color:#7aa2f7">' + esc(e2.t.slice(0, 90)) + '</a>' : esc(e2.t.slice(0, 90))) + '</div>';
        }).join('') +
        '</div>';
    } else {
      fusionHtml = '<div style="margin:8px 0;font-size:9px;color:#8b949e">◈ Causal fusion running — correlating cyber / weather / seismic / space-weather / kinetic layers…</div>';
    }
    return '<div style="font-family:\'JetBrains Mono\',monospace;padding:12px;color:#c8ccd6;background:#0a0e14;border:1px solid #DA3633;max-width:420px">' +
      '<div style="font-size:13px;font-weight:700;color:#DA3633">⛔ INFRASTRUCTURE OUTAGE — ' + esc(w.name) + '</div>' +
      '<div style="font-size:8px;color:#8b949e;letter-spacing:1px;margin:4px 0 8px">' + esc(w.kind) + ' · ' + esc(w.hq) + ' · NEWS-DETECTED · LAST 60 MIN</div>' +
      '<div style="font-size:10px;margin-bottom:6px">Reports: <b>' + a.count + '</b> in last hour</div>' +
      a.titles.slice(0, 6).map(function (t) { return '<div style="margin-bottom:5px;font-size:10px"><a href="' + esc(t.u || '#') + '" target="_blank" rel="noopener" style="color:#c8ccd6">' + esc(t.t.slice(0, 100)) + '</a></div>'; }).join('') +
      fusionHtml +
      '<div style="font-size:8px;color:#4a5068;margin-top:6px">Source: GDELT 1-hour news monitoring · OutageWatch sentinel + Causal Fusion Engine</div></div>';
  }

  function plot(w, a) {
    try {
      if (typeof V === 'undefined' || a.ent) return;
      a.ent = V.entities.add({
        position: Cesium.Cartesian3.fromDegrees(w.lon, w.lat),
        point: { pixelSize: 12, color: Cesium.Color.fromCssColorString('#DA3633').withAlpha(0.95), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: '⛔ ' + w.name.toUpperCase() + ' OUTAGE', font: '11px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString('#ff4444'), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -20), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        description: buildDesc(w, a)
      });
    } catch (e) { console.warn('[OutageWatch plot]', e); }
  }

  // ══════════════════════════════════════════════════════════════
  // CAUSAL FUSION ENGINE (P106) — when an outage is detected,
  // correlate against live intel layers within a time/space window
  // and attribute a probable cause. Gotham-class fusion, v1.
  //   CYBER   — GDELT 24h cyberattack reporting on the org +
  //             CISA KEV additions (7d) matching the vendor
  //   WEATHER — NWS active alerts covering the org's HQ/region
  //   SEISMIC — USGS M4.5+ within 300 km of HQ in last 24h
  //   SPACE   — NOAA SWPC scales (G/R storms) for GPS/SATCOM/grid
  //   KINETIC — HQ inside an active War Room theater bbox
  // Every fetch is data-gated (SW offline sentinel returns 200s).
  // ══════════════════════════════════════════════════════════════
  var SEVERE_WX = /tornado warning|hurricane warning|extreme heat|excessive heat|ice storm|blizzard|high wind warning|severe thunderstorm warning|extreme wind|flash flood emergency|winter storm warning/i;
  var MILD_WX = /heat advisory|wind advisory|flood (warning|watch)|winter weather|red flag/i;

  function fetchJson(url, ms) {
    return fetch(url, { signal: AbortSignal.timeout(ms || 10000) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.offline === true) throw new Error('sw-offline-sentinel'); return d; });
  }

  async function fuseCause(w, a) {
    var cand = []; // {cause, weight, why, evidence:[{t,u}]}
    var orgWord = w.name.split('/')[0].trim(); // 'Comcast/Xfinity' → 'Comcast'

    var jobs = [
      // CYBER a — GDELT: org + attack terms, last 24h (browser-direct; throttled on some IPs → best-effort)
      fetchJson('https://api.gdeltproject.org/api/v2/doc/doc?query=' +
        encodeURIComponent('"' + orgWord + '" (cyberattack OR ransomware OR hacked OR "denial of service" OR ddos OR breach)') +
        '&mode=artlist&format=json&timespan=24h&maxrecords=30&sort=datedesc', 12000)
        .then(function (d) {
          if (!Array.isArray(d.articles) || !d.articles.length) return;
          var seen = {}, arts = [];
          d.articles.forEach(function (x) {
            var k = (x.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 60);
            if (!k || seen[k]) return; seen[k] = 1;
            if (w.rx.test(x.title || '')) arts.push({ t: x.title, u: x.url || '' });
          });
          if (arts.length >= 2) cand.push({ cause: 'CYBER', weight: arts.length >= 3 ? 5 : 4, why: arts.length + ' independent reports of cyberattack/ransomware targeting ' + w.name + ' in last 24h (GDELT)', evidence: arts });
          else if (arts.length === 1) cand.push({ cause: 'CYBER', weight: 2, why: '1 report of cyberattack on ' + w.name + ' in last 24h (GDELT, unconfirmed)', evidence: arts });
        }).catch(function () {}),

      // CYBER b — CISA KEV additions in last 7d matching the vendor
      fetchJson('/.netlify/functions/proxy-cisa', 15000)
        .then(function (d) {
          if (!d || !Array.isArray(d.vulnerabilities)) return;
          var cutoff = Date.now() - 7 * 864e5;
          var hits = d.vulnerabilities.filter(function (v2) {
            if (!v2.dateAdded || new Date(v2.dateAdded).getTime() < cutoff) return false;
            var hay = (v2.vendorProject || '') + ' ' + (v2.product || '');
            return w.rx.test(hay) || hay.toLowerCase().indexOf(orgWord.toLowerCase()) !== -1;
          });
          if (hits.length) cand.push({
            cause: 'CYBER', weight: 3,
            why: hits.length + ' actively-exploited CVE(s) affecting ' + w.name + ' added to CISA KEV in last 7d (' + hits.map(function (h) { return h.cveID; }).slice(0, 3).join(', ') + ')',
            evidence: hits.slice(0, 3).map(function (h) { return { t: h.cveID + ' — ' + (h.vulnerabilityName || h.shortDescription || '').slice(0, 70), u: 'https://nvd.nist.gov/vuln/detail/' + h.cveID }; })
          });
        }).catch(function () {}),

      // WEATHER — NWS active alerts at HQ point (all watchlist HQs are US)
      fetchJson('https://api.weather.gov/alerts/active?point=' + w.lat + ',' + w.lon, 10000)
        .then(function (d) {
          if (!d || !Array.isArray(d.features) || !d.features.length) return;
          var sev = [], mild = [];
          d.features.forEach(function (f) {
            var ev2 = (f.properties && f.properties.event) || '';
            var item = { t: ev2 + ' — ' + ((f.properties && f.properties.areaDesc) || '').slice(0, 60), u: (f.properties && f.properties.uri) || '' };
            if (SEVERE_WX.test(ev2)) sev.push(item); else if (MILD_WX.test(ev2)) mild.push(item);
          });
          if (sev.length) cand.push({ cause: 'WEATHER', weight: 4, why: sev.length + ' severe weather alert(s) active over ' + w.hq + ' (NWS): ' + sev[0].t.split(' — ')[0], evidence: sev });
          else if (mild.length) cand.push({ cause: 'WEATHER', weight: 2, why: 'Weather advisory active over ' + w.hq + ' (NWS): ' + mild[0].t.split(' — ')[0], evidence: mild });
        }).catch(function () {}),

      // SEISMIC — USGS M4.5+ within 300 km of HQ, last 24h
      fetchJson('https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=' + w.lat + '&longitude=' + w.lon + '&maxradiuskm=300&minmagnitude=4.5&starttime=' + new Date(Date.now() - 864e5).toISOString(), 10000)
        .then(function (d) {
          if (!d || !Array.isArray(d.features) || !d.features.length) return;
          var big = d.features.filter(function (f) { return f.properties.mag >= 6; });
          var q = d.features[0];
          cand.push({
            cause: 'SEISMIC', weight: big.length ? 5 : 3,
            why: 'M' + q.properties.mag.toFixed(1) + ' earthquake ' + (q.properties.place || 'near ' + w.hq) + ' within 300 km of HQ in last 24h (USGS)',
            evidence: d.features.slice(0, 3).map(function (f) { return { t: 'M' + f.properties.mag.toFixed(1) + ' — ' + (f.properties.place || ''), u: f.properties.url || '' }; })
          });
        }).catch(function () {}),

      // SPACE WEATHER — NOAA SWPC scales; weighted for GPS/SATCOM/GRID/AVIATION
      fetchJson('https://services.swpc.noaa.gov/products/noaa-scales.json', 10000)
        .then(function (d) {
          var cur = d && d['0']; if (!cur) return;
          var g = parseInt((cur.G && cur.G.Scale) || 0, 10) || 0;
          var r2 = parseInt((cur.R && cur.R.Scale) || 0, 10) || 0;
          var s2 = parseInt((cur.S && cur.S.Scale) || 0, 10) || 0;
          var max = Math.max(g, r2, s2);
          if (max < 3) return;
          var spaceKind = (w.kind === 'NAVIGATION' || w.kind === 'SATCOM' || w.kind === 'GRID' || w.kind === 'AVIATION');
          cand.push({
            cause: 'SPACE WEATHER', weight: spaceKind ? (max >= 4 ? 5 : 3) : 1,
            why: 'Active geomagnetic/radio storm — G' + g + '/R' + r2 + '/S' + s2 + ' (NOAA SWPC)' + (spaceKind ? ' — ' + w.kind + ' directly susceptible' : ''),
            evidence: [{ t: 'NOAA Space Weather Scales: G' + g + ' R' + r2 + ' S' + s2, u: 'https://www.swpc.noaa.gov/noaa-scales-explanation' }]
          });
        }).catch(function () {})
    ];

    await Promise.allSettled(jobs);

    // KINETIC — HQ inside an active War Room theater bbox (local, no fetch)
    try {
      var th = (window.WAR_THEATERS || []).find(function (t) {
        return w.lon >= t.bbox[0] && w.lat >= t.bbox[1] && w.lon <= t.bbox[2] && w.lat <= t.bbox[3];
      });
      if (th) cand.push({ cause: 'KINETIC', weight: 3, why: w.hq + ' lies inside active conflict theater: ' + th.name, evidence: [{ t: th.name, u: '' }] });
    } catch (_) {}

    cand.sort(function (x, y) { return y.weight - x.weight; });
    var top = cand[0];
    var f;
    if (top && top.weight >= 3) {
      f = { cause: top.cause, confidence: top.weight >= 5 ? 'HIGH' : 'MEDIUM', why: top.why, evidence: top.evidence, candidates: cand, at: Date.now() };
    } else if (top) {
      f = { cause: top.cause, confidence: 'LOW', why: top.why + ' — weak signal, treat as unconfirmed', evidence: top.evidence, candidates: cand, at: Date.now() };
    } else {
      f = { cause: 'UNDETERMINED', confidence: '—', why: 'No correlated cyber / weather / seismic / space-weather / kinetic signal in the time-space window. Likely internal technical failure (config change, software fault, fiber cut).', evidence: [], candidates: [], at: Date.now() };
    }
    a.fusion = f;

    // patch UI everywhere the outage surfaces
    try { if (a.ent) a.ent.description = buildDesc(w, a); } catch (_) {}
    if (f.cause !== 'UNDETERMINED') {
      var fCol = f.confidence === 'HIGH' ? '#DA3633' : '#E8B339';
      banner('<b>⛔ ' + esc(w.name.toUpperCase()) + ' OUTAGE — PROBABLE CAUSE: ' + esc(f.cause) + '</b> (' + esc(f.confidence) + ' confidence)<br>' +
        esc(f.why).slice(0, 160) +
        '<br><span style="color:#8b949e;font-size:9px">Causal Fusion Engine · click the ⛔ marker for evidence links</span>', fCol);
      try { af(fCol, '◈ FUSION: ' + w.name + ' outage → PROBABLE CAUSE: ' + f.cause + ' (' + f.confidence + ')'); } catch (_) {}
      try { if (typeof EventLog !== 'undefined') EventLog.add('crit', 'FUSION: ' + w.name + ' → ' + f.cause + ' (' + f.confidence + ')'); } catch (_) {}
    } else {
      try { af('#8b949e', '◈ FUSION: ' + w.name + ' outage — no external cause correlated; likely internal technical failure'); } catch (_) {}
    }
    console.log('[OutageWatch FUSION]', w.id, '→', f.cause, f.confidence, '| candidates:', cand.map(function (c) { return c.cause + ':' + c.weight; }).join(' '));
    return f;
  }

  function raiseAlert(w, a, isNew) {
    if (isNew) {
      try { af('#DA3633', '⛔ OUTAGE DETECTED: ' + w.name + ' (' + w.kind + ') — ' + a.count + ' reports in last hour'); } catch (_) {}
      banner('<b>⛔ INFRASTRUCTURE OUTAGE — ' + esc(w.name.toUpperCase()) + '</b> (' + esc(w.kind) + ')<br>' +
        a.count + ' news reports in the last hour. Latest: ' + esc((a.titles[0] || {}).t || '').slice(0, 110) +
        '<br><span style="color:#8b949e;font-size:9px">OutageWatch · click the ⛔ marker on the globe for sources</span>');
      notify('BDOC: ' + w.name + ' outage detected', a.count + ' reports in last hour');
      plot(w, a);
      try { if (typeof EventLog !== 'undefined') EventLog.add('crit', 'OUTAGE: ' + w.name + ' — ' + a.count + ' rpts/1h'); } catch (_) {}
      // fire the causal fusion engine — correlate this outage against cyber/weather/seismic/space/kinetic layers
      setTimeout(function () { fuseCause(w, a).catch(function (e) { console.warn('[OutageWatch fusion]', e); }); }, 1200);
    }
  }

  function recomputeScore() {
    // GTA infra component 0-25: each active news-detected outage = 6 (carrier/grid/gps) or 4 (other);
    // each degraded statuspage = 2, major = 4.
    var s = 0;
    Object.keys(state.active).forEach(function (id) {
      var w = WATCH.find(function (x) { return x.id === id; });
      s += (w && (w.kind === 'CARRIER' || w.kind === 'GRID' || w.kind === 'NAVIGATION' || w.kind === 'AVIATION')) ? 6 : 4;
    });
    Object.keys(state.statuspage).forEach(function (n) {
      var ind = state.statuspage[n];
      if (ind === 'minor') s += 2; else if (ind === 'major' || ind === 'critical') s += 4;
    });
    state.score = Math.min(s, 25);
    // push GTA refresh so the pill reacts NOW, not in 3 hours
    try { if (state.score > 0 && typeof updateGTA === 'function') updateGTA(); } catch (_) {}
  }

  // ── 1. news-detect poll ──
  async function pollNews() {
    state.lastNewsPoll = Date.now();
    var q = encodeURIComponent('(outage OR "is down" OR "goes down" OR blackout OR "service disruption" OR "network down")');
    var url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + q + '&mode=artlist&format=json&timespan=1h&maxrecords=100&sort=datedesc';
    var arts = [];
    try {
      var r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      var d = await r.json();
      if (Array.isArray(d.articles)) { arts = d.articles; state.newsOk = true; }
    } catch (_) { state.newsOk = false; }
    if (!arts.length) return;

    var now = Date.now();
    WATCH.forEach(function (w) {
      var hits = [];
      var seen = {};
      arts.forEach(function (a) {
        var t = a.title || '';
        if (!w.rx.test(t)) return;
        var k = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 70);
        if (seen[k]) return; seen[k] = 1;
        hits.push({ t: t, u: a.url || '' });
      });
      var a = state.active[w.id];
      if (hits.length >= 2) {              // 2+ distinct outlets in 1h = real signal
        var isNew = !a;
        if (!a) a = state.active[w.id] = { name: w.name, kind: w.kind, firstSeen: now, titles: [], count: 0 };
        a.lastSeen = now; a.count = hits.length; a.titles = hits;
        raiseAlert(w, a, isNew);
      } else if (a && now - a.lastSeen > 90 * 60e3) {
        // no reports for 90 min → clear
        try { if (a.ent) V.entities.remove(a.ent); } catch (_) {}
        delete state.active[w.id];
        try { af('#3FB950', '✓ OUTAGE CLEARED: ' + w.name + ' — no new reports for 90 min'); } catch (_) {}
      }
    });
    recomputeScore();
  }

  // ── 2. statuspage sweep ──
  async function pollStatus() {
    state.lastStatusPoll = Date.now();
    var results = await Promise.allSettled(STATUSPAGES.map(function (s) {
      return fetch(s.url, { signal: AbortSignal.timeout(8000) })
        .catch(function () { return fetch('/.netlify/functions/proxy-status?url=' + encodeURIComponent(s.url), { signal: AbortSignal.timeout(8000) }); })
        .then(function (r) { return r.json(); })
        .then(function (d) { return { name: s.name, ind: (d.status && d.status.indicator) || 'none', desc: (d.status && d.status.description) || '' }; });
    }));
    results.forEach(function (r) {
      if (r.status !== 'fulfilled') return;
      var v = r.value, prev = state.statuspage[v.name] || 'none';
      if (v.ind !== 'none' && prev === 'none') {
        try { af('#E8B339', '⚠ SERVICE DEGRADED: ' + v.name + ' — ' + v.desc); } catch (_) {}
        if (v.ind === 'major' || v.ind === 'critical') {
          banner('<b>⚠ MAJOR SERVICE OUTAGE — ' + esc(v.name.toUpperCase()) + '</b><br>' + esc(v.desc) + '<br><span style="color:#8b949e;font-size:9px">Official statuspage · OutageWatch</span>', '#ff6600');
          notify('BDOC: ' + v.name + ' major outage', v.desc);
        }
        try { if (typeof EventLog !== 'undefined') EventLog.add(v.ind === 'major' || v.ind === 'critical' ? 'crit' : 'warn', 'STATUS: ' + v.name + ' → ' + v.ind); } catch (_) {}
      } else if (v.ind === 'none' && prev !== 'none') {
        try { af('#3FB950', '✓ SERVICE RESTORED: ' + v.name); } catch (_) {}
      }
      state.statuspage[v.name] = v.ind;
    });
    recomputeScore();
  }

  // ── boot ──
  // Simulation hook: exercise the full pipeline (banner → marker → fusion) for any watchlist id.
  // Console: OutageWatch.simulate('att')  — marked SIMULATED, clears via normal 90-min silence path.
  window.OutageWatch.simulate = function (id) {
    var w = WATCH.find(function (x) { return x.id === id; });
    if (!w) { console.warn('[OutageWatch] unknown id. Valid:', WATCH.map(function (x) { return x.id; }).join(', ')); return; }
    var a = state.active[w.id] = {
      name: w.name, kind: w.kind, firstSeen: Date.now(), lastSeen: Date.now(), count: 3,
      titles: [{ t: '[SIMULATED] ' + w.name + ' outage drill — fusion engine test', u: '' },
               { t: '[SIMULATED] Users report ' + w.name + ' service disruption', u: '' }]
    };
    raiseAlert(w, a, true);
    recomputeScore();
    return a;
  };
  window.OutageWatch.fuse = fuseCause; // expose for diagnostics
  window.OutageWatch.start = function () {
    if (window.OutageWatch._started) return; window.OutageWatch._started = true;
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (_) {}
    setTimeout(pollNews, 4000);                       // first news poll 4s after boot
    setTimeout(pollStatus, 9000);                     // first status sweep 9s after boot
    setInterval(function () { if (!document.hidden) pollNews(); }, 180e3);   // every 3 min
    setInterval(function () { if (!document.hidden) pollStatus(); }, 120e3); // every 2 min
    console.log('[OutageWatch] Sentinel armed — 15 infra targets (news-detect 3min) + 11 statuspages (2min)');
    try { af('#2D72D2', 'OUTAGE WATCH armed — carriers/clouds/payments/GPS/grid monitored in real time'); } catch (_) {}
  };

  window.OutageWatch.start();
})();
