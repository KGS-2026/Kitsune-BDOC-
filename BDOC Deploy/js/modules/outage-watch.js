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

  function plot(w, a) {
    try {
      if (typeof V === 'undefined' || a.ent) return;
      a.ent = V.entities.add({
        position: Cesium.Cartesian3.fromDegrees(w.lon, w.lat),
        point: { pixelSize: 12, color: Cesium.Color.fromCssColorString('#DA3633').withAlpha(0.95), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: '⛔ ' + w.name.toUpperCase() + ' OUTAGE', font: '11px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString('#ff4444'), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -20), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:12px;color:#c8ccd6;background:#0a0e14;border:1px solid #DA3633;max-width:420px">' +
          '<div style="font-size:13px;font-weight:700;color:#DA3633">⛔ INFRASTRUCTURE OUTAGE — ' + esc(w.name) + '</div>' +
          '<div style="font-size:8px;color:#8b949e;letter-spacing:1px;margin:4px 0 8px">' + esc(w.kind) + ' · ' + esc(w.hq) + ' · NEWS-DETECTED · LAST 60 MIN</div>' +
          '<div style="font-size:10px;margin-bottom:6px">Reports: <b>' + a.count + '</b> in last hour</div>' +
          a.titles.slice(0, 6).map(function (t) { return '<div style="margin-bottom:5px;font-size:10px"><a href="' + esc(t.u || '#') + '" target="_blank" rel="noopener" style="color:#c8ccd6">' + esc(t.t.slice(0, 100)) + '</a></div>'; }).join('') +
          '<div style="font-size:8px;color:#4a5068;margin-top:6px">Source: GDELT 1-hour news monitoring · OutageWatch sentinel</div></div>'
      });
    } catch (e) { console.warn('[OutageWatch plot]', e); }
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
