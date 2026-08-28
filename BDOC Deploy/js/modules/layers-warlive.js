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
      // P120: GDELT's API is now fully dead (see the source-swap note below), so the
      // first attempt is guaranteed to fail. Timeout cut 10s→3s so the circuit
      // breaker trips fast instead of stalling the trend badges for 10 seconds on
      // every single page load. The wiki-pageview tertiary path still works.
      let gdeltOk = true; // when GDELT direct fails once, it'll fail for the whole session — skip the 5.5s pacing
      const fetchTrend = async (z) => {
        if (gdeltOk) {
          const direct = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(tq[z.id] || z.id) + '&mode=timelinevol&format=json&timespan=7d';
          try {
            const r = await fetch(direct, { signal: AbortSignal.timeout(3000) });
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
  // P120: SOURCE SWAP — GDELT's API is dead (verified 2026-06-09: connection
  // accepted, zero bytes returned, >30s, from both this droplet and Netlify egress,
  // while www.gdeltproject.org 301s fine). Every call returned an empty article
  // list, so this layer plotted nothing and the operator correctly reported "no
  // live feed". Replaced with proxy-newsgeo: 7 major outlets, multi-source failure
  // isolation, cross-outlet corroboration, gazetteer geocoding with an honest
  // uncertainty radius, and — the part GDELT never had — a real IMAGE per event.
  const byZone = {};
  let mediaEvents = [];
  let feedStatus = 'down';
  try {
    const res = await safeFetch('warlive', 'conflicts',
      '/.netlify/functions/proxy-newsgeo?max=160', { feedType: 'news', staleOk: true });
    const d = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const feats = (d && d.features) || [];
    feedStatus = (d && d._status) || 'down';
    mediaEvents = feats.map(f => ({
      title: f.properties.name,
      url: f.properties.url,
      domain: f.properties.domain,
      img: f.properties.img,
      video: f.properties.video,
      cat: f.properties.cat,
      place: f.properties.place,
      radius: f.properties.radius,
      precision: f.properties.precision,
      corroboration: f.properties.corroboration,
      sources: f.properties.sources || [],
      ts: f.properties.ts,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1]
    }));
    // Bucket into theaters for the SITREP anchors (unchanged contract downstream).
    mediaEvents.forEach(a => {
      for (const z of WAR_THEATERS) {
        if (z.rx.test(a.title || '')) { (byZone[z.id] = byZone[z.id] || []).push(a); break; }
      }
    });
    console.log('[WarLive] newsgeo ' + feedStatus + ' — ' + mediaEvents.length +
                ' events, ' + mediaEvents.filter(e => e.img).length + ' with media');
  } catch (e) { console.warn('[WarLive newsgeo]', e); }
  try {
    const jit = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return ((h % 1000) / 1000 - 0.5) * 3.5; };

    // ── P120: MEDIA CARD RENDERER ─────────────────────────────
    // The operator requirement: click an event, see the PHOTO, the video if there
    // is one, and every outlet reporting it. Structure follows liveuamap's venue
    // card (image on top, headline, source chips) and WeatherWise's text-first
    // load order — the <img> is last in the DOM and has an onerror that removes
    // its own container, so a dead hotlink degrades to a clean text card instead
    // of a broken-image icon. Hotlinked outlet CDNs 403 sometimes; that must not
    // look like a bug.
    const CAT_COLOR = {
      strike: '#ff3b30', attack: '#ff6b35', casualty: '#DA3633',
      military: '#4a9eff', escalation: '#ffb020', cyber: '#bf5af2',
      disaster: '#ff9500', unrest: '#ffd60a'
    };
    const relTime = ts => {
      if (!ts) return '';
      const m = Math.floor((Date.now() - ts) / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return m + 'm ago';
      const h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h / 24) + 'd ago';
    };
    function mediaCard(a, theaterName) {
      const col = CAT_COLOR[a.cat] || '#DA3633';
      const cid = 'im' + Math.random().toString(36).slice(2, 9);
      let h = '<div style="font-family:\'JetBrains Mono\',monospace;background:#0a0e14;border:1px solid ' + col +
              ';max-width:430px;color:#c8ccd6;overflow:hidden">';
      // header strip: category + freshness
      h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:' + col + '18;border-bottom:1px solid ' + col + '55">' +
           '<span style="font-size:9px;font-weight:700;color:' + col + ';letter-spacing:1.5px">' + esc((a.cat || 'event').toUpperCase()) + '</span>' +
           '<span style="font-size:8px;color:#8b949e">' + esc(relTime(a.ts)) + '</span></div>';
      // MEDIA — the thing that was missing entirely
      if (a.img) {
        h += '<div id="' + cid + '" style="width:100%;background:#05080d;line-height:0">' +
             '<img src="' + esc(a.img) + '" alt="" referrerpolicy="no-referrer" ' +
             'style="width:100%;max-height:210px;object-fit:cover;display:block" ' +
             'onerror="var e=document.getElementById(\'' + cid + '\');if(e)e.remove()">' +
             '</div>';
      }
      h += '<div style="padding:10px 12px 12px">';
      h += '<div style="font-size:11.5px;font-weight:700;color:#e6edf3;line-height:1.45;margin-bottom:7px">' +
           esc(String(a.title || '').slice(0, 190)) + '</div>';
      // provenance: WHERE, and how precisely we actually know it
      if (a.place) {
        const pr = a.precision === 'city' ? 'CITY' : a.precision === 'region' ? 'REGION' : 'COUNTRY';
        h += '<div style="font-size:8.5px;color:#8b949e;margin-bottom:6px">' +
             '📍 ' + esc(String(a.place).toUpperCase()) +
             ' <span style="color:#4a5068">· ' + pr + '-LEVEL GEOCODE · ±' +
             Math.round((a.radius || 0) / 1000) + 'km</span></div>';
      }
      // corroboration — multi-outlet agreement is the real signal
      if (a.corroboration > 1) {
        h += '<div style="font-size:8.5px;color:#3fb950;margin-bottom:7px;font-weight:600">' +
             '✓ CORROBORATED — ' + a.corroboration + ' independent outlets reporting</div>';
      }
      if (a.video) {
        h += '<a href="' + esc(a.video) + '" target="_blank" rel="noopener" ' +
             'style="display:inline-block;font-size:9px;color:#0a0e14;background:' + col +
             ';padding:4px 9px;text-decoration:none;font-weight:700;margin-bottom:7px">▶ VIDEO</a><br>';
      }
      // every source as its own link (liveuamap moreSources)
      const srcs = (a.sources && a.sources.length ? a.sources : [{ src: a.domain, url: a.url }]);
      h += '<div style="border-top:1px solid #1e2436;padding-top:7px">';
      srcs.slice(0, 5).forEach(s => {
        if (!s || !s.url) return;
        h += '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" ' +
             'style="display:block;font-size:9px;color:#58a6ff;text-decoration:none;margin-bottom:3px">' +
             '↗ ' + esc(s.src || 'source') + '</a>';
      });
      h += '</div>';
      if (theaterName) {
        h += '<div style="font-size:7.5px;color:#4a5068;margin-top:6px;letter-spacing:1px">THEATER: ' +
             esc(theaterName) + '</div>';
      }
      h += '</div></div>';
      return h;
    }
    // expose so other layers can render the same card shape
    window.BDOCMediaCard = mediaCard;

    for (const z of WAR_THEATERS) {
      const items = (byZone[z.id] || []).slice(0, 15);
      // p103b: anchor renders UNCONDITIONALLY — GDELT artlist is throttled for many
      // IPs (datacenter, some ISPs); without an anchor the trend badge has nowhere
      // to live and the theater vanishes from the picture entirely.
      // P120: SITREP list now carries a thumbnail per headline (text-first order:
      // the 44px thumb is a sibling AFTER the text so a slow/blocked image never
      // delays the headline paint).
      const list = items.length ? items.map(a =>
        '<div style="display:flex;gap:8px;margin-bottom:8px;padding-bottom:7px;border-bottom:1px solid #1e2436">' +
        '<div style="flex:1;min-width:0">' +
        '<a href="' + esc(a.url || '#') + '" target="_blank" rel="noopener" style="color:#c8ccd6;text-decoration:none;font-size:10px;font-weight:600;line-height:1.4">' + esc((a.title || '').slice(0, 110)) + '</a>' +
        '<div style="font-size:8px;color:#4a5068;margin-top:3px">' + esc(a.domain || '') +
          (a.corroboration > 1 ? ' <span style="color:#3fb950">· ✓' + a.corroboration + ' outlets</span>' : '') +
          (a.place ? ' · ' + esc(String(a.place).toUpperCase()) : '') + '</div></div>' +
        (a.img ? '<img src="' + esc(a.img) + '" alt="" referrerpolicy="no-referrer" style="width:52px;height:40px;object-fit:cover;flex-shrink:0;border:1px solid #1e2436" onerror="this.remove()">' : '') +
        '</div>').join('')
        : '<div style="font-size:9px;color:#8b949e">No matching reports for this theater in the current window.</div>';
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
      // P120: theater-bucketed dots keep the jittered fan around the anchor, but
      // now render the full media card on click.
      items.forEach(a => {
        warliveEnts.push(V.entities.add({
          position: Cesium.Cartesian3.fromDegrees(z.lon + jit(a.url || ''), z.lat + jit(a.title || '')),
          point: { pixelSize: 4, color: Cesium.Color.fromCssColorString('#ff8888').withAlpha(0.7), disableDepthTestDistance: 5e6, scaleByDistance: new Cesium.NearFarScalar(5e5, 1.2, 1e7, 0.4) },
          description: mediaCard(a, z.name),
          show: layers.warlive
        }));
        newsN++;
      });
    }
    // ── P120: GLOBAL EVENT PLOT WITH HONEST UNCERTAINTY ────────
    // Previously only events matching one of the 5 theater regexes appeared, and
    // they were jittered around a theater anchor — i.e. the position was fiction.
    // Now every geocoded event is plotted at its OWN coordinate, and the marker
    // carries an uncertainty circle sized from the gazetteer radius.
    //
    // This is the meshmap.net position-precision finding applied to news geocoding:
    // a country-centroid geocode drawn as a sharp pin is a lie that an analyst
    // will catch, and once they catch it they discount every other number on the
    // screen. City-level (<=20km) gets a tight dot; country-level gets a large
    // translucent ellipse that visibly says "we know the country, not the street".
    const PREC_STYLE = {
      city:    { px: 9, alpha: 0.30, ring: true  },
      region:  { px: 7, alpha: 0.16, ring: true  },
      country: { px: 5, alpha: 0.07, ring: false }
    };
    const theaterMatched = new Set();
    for (const z of WAR_THEATERS) (byZone[z.id] || []).forEach(a => theaterMatched.add(a.title));

    let plottedN = 0;
    mediaEvents.forEach(a => {
      if (a.lon == null || a.lat == null) return;
      if (theaterMatched.has(a.title)) return;   // already drawn in its theater fan
      const col = CAT_COLOR[a.cat] || '#ff8888';
      const ps = PREC_STYLE[a.precision] || PREC_STYLE.country;
      const card = mediaCard(a, null);
      // uncertainty footprint — drawn first so the dot sits on top of it
      if (a.radius && a.radius > 8000) {
        warliveEnts.push(V.entities.add({
          position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat),
          ellipse: {
            semiMajorAxis: a.radius, semiMinorAxis: a.radius,
            material: Cesium.Color.fromCssColorString(col).withAlpha(ps.alpha * 0.5),
            outline: ps.ring,
            outlineColor: Cesium.Color.fromCssColorString(col).withAlpha(0.45),
            height: 0
          },
          description: card,
          show: layers.warlive
        }));
      }
      warliveEnts.push(V.entities.add({
        position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat),
        point: {
          pixelSize: ps.px + (a.corroboration > 1 ? 2 : 0),
          color: Cesium.Color.fromCssColorString(col).withAlpha(0.92),
          // corroborated events get a green ring — multi-outlet agreement is signal
          outlineColor: a.corroboration > 1
            ? Cesium.Color.fromCssColorString('#3fb950')
            : Cesium.Color.fromCssColorString('#0a0e14'),
          outlineWidth: a.corroboration > 1 ? 2 : 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(5e5, 1.25, 2e7, 0.55)
        },
        description: card,
        show: layers.warlive
      }));
      plottedN++; newsN++;
    });
    console.log('[WarLive] plotted ' + plottedN + ' global events at real coordinates (+' +
                theaterMatched.size + ' in theater fans)');
  } catch (e) { console.warn('[WarLive render]', e); }

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
    // P122: POINTER-FIRST FETCH (Google Earth root.json pattern).
    // Was: every client hit proxy-gdeltevents directly — N viewers = N origin
    // invocations, ~7s each, and a blank layer whenever GDELT hiccuped.
    // Now: poll a ~160-byte pointer, pull the immutable dated snapshot from
    // edge/SW cache, and on total upstream failure fall back to the last good
    // snapshot with an honest age instead of rendering nothing.
    const LIVE_EVENTS = '/.netlify/functions/proxy-gdeltevents?files=12&img=150';
    let d = null, prov = '';
    if (window.BDOCSnap) {
      const r = await window.BDOCSnap.fetchLayer('events', LIVE_EVENTS);
      d = r.data;
      prov = window.BDOCSnap.provenance(r);
      if (r.stale) af('#E8B339', 'War Room events: ' + prov + ' — upstream unreachable, showing last good snapshot');
    } else {
      const res = await fetch(LIVE_EVENTS, { signal: AbortSignal.timeout(25000) });
      d = res.ok ? await res.json() : null;
      prov = 'LIVE · direct';
    }
    if (d) {
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
          // P121: MEDIA CARD — photo first, numbers second.
          // The old card led with Goldstein/tone, which reads as a database dump.
          // The og:image resolved server-side is placed directly under the header
          // so the very first thing you see on click is the actual news photo of
          // the incident. Image is LAST in the DOM string but visually second via
          // order of markup, and its onerror removes its own container so a dead
          // or hotlink-protected CDN degrades to a clean text card, never a broken
          // image icon. Numbers are demoted to a compact footer row.
          description: (function () {
            const mid = 'ge' + Math.random().toString(36).slice(2, 9);
            // P121: GDELT event records carry a source URL but NO image, so ev.img
            // was almost always undefined and this card rendered text-only — the
            // exact complaint. Fall back to resolving the source article's
            // og:image server-side via proxy-ogimage, which 302s to the outlet
            // CDN. Plain <img src>, no client JS, no await. Measured 5/6 hit rate
            // at ~0.1s on live event URLs. onload guards the 1x1 miss-pixel.
            const imgSrc = ev.img
              ? esc(ev.img)
              : (ev.url ? location.origin + '/.netlify/functions/proxy-ogimage?url=' + encodeURIComponent(ev.url) : '');
            const media = imgSrc
              ? '<div id="' + mid + '" style="width:100%;background:#05080d;line-height:0;border-bottom:1px solid ' + t.color + '55">' +
                '<img src="' + imgSrc + '" alt="" referrerpolicy="no-referrer" loading="lazy" ' +
                'style="width:100%;max-height:190px;object-fit:cover;display:block" ' +
                'onerror="var n=document.getElementById(\'' + mid + '\');if(n)n.remove()" ' +
                'onload="if(this.naturalWidth<=2){var n=document.getElementById(\'' + mid + '\');if(n)n.remove()}"></div>'
              : '';
            return '<div style="font-family:\'JetBrains Mono\',monospace;background:#0a0e14;border:1px solid ' + t.color + ';max-width:430px;color:#c8ccd6;overflow:hidden">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:' + t.color + '18;border-bottom:1px solid ' + t.color + '55">' +
                '<span style="font-size:9px;font-weight:700;color:' + t.color + ';letter-spacing:1.5px">' + t.icon + ' ' + t.label + '</span>' +
                (salient ? '<span style="font-size:8px;color:' + t.color + ';font-weight:700">MAJOR</span>' : '') +
              '</div>' +
              media +
              '<div style="padding:9px 10px">' +
                '<div style="font-size:11px;color:#e6edf3;font-weight:600;margin-bottom:6px">📍 ' + esc(ev.place || 'Location unknown') + '</div>' +
                (ev.url
                  ? '<a href="' + esc(ev.url) + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;font-size:9px;color:#00ddff;text-decoration:none;border:1px solid #00ddff55;padding:3px 8px;margin-bottom:7px">READ SOURCE ARTICLE →</a>'
                  : '') +
                '<div style="display:flex;gap:10px;font-size:8px;color:#8b949e;border-top:1px solid #21262d;padding-top:6px;flex-wrap:wrap">' +
                  '<span>' + ev.m + ' mentions</span>' +
                  '<span>Goldstein ' + ev.g + '</span>' +
                  '<span>Tone ' + ev.tone + '</span>' +
                  '<span>CAMEO ' + esc(ev.code) + '</span>' +
                '</div>' +
                '<div style="font-size:8px;color:#4a5068;margin-top:5px">GDELT 2.0 · last 3h · machine-geocoded' + (ev.img ? ' · photo from source article' : '') + '</div>' +
              '</div></div>';
          })(),
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
