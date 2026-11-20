// p206 (master plan W1.1 chunk A): layer-load meter.
//
// Shows what the layers that are on cost: things drawn on the globe, network requests and data per
// minute, and how fast the globe is drawing. A strip sits at the top of the layer list; tap it for
// a per-layer breakdown with an off switch on each row.
//
// It only watches. It never changes a layer itself (the off switch calls the page's own togLy).
// Chunks B (viewport culling) and C (hibernation) will read the same registry: BDOCLayerMeter.snapshot().
//
// How it counts:
//  - Things drawn: the page keeps each layer's entities in a top-level array (eqEnts, fireEnts, ...).
//    ENTS below says which arrays belong to which layer. Getters, because loaders reassign the arrays.
//    Only entities with show !== false count. A name that doesn't exist yet (lazy module not loaded)
//    just counts as 0.
//  - Network: the browser's Resource Timing list (no fetch wrapping). NET_RULES maps a URL to the
//    layer(s) that call it. A URL several layers share is split evenly between the ones that are on.
//    Anything unmatched is shown as "Map and app" (basemap tiles, terrain, app files).
//  - Drawing: frames per second from Cesium's postRender while the globe is animating. The globe
//    renders on demand when nothing moves (p119 BDOCRender), so a low number while idle is normal.
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  // ── Which entity arrays belong to which layer ──────────────────────────────────────────────
  // Each getter returns an array of collections (arrays, Sets, or Cesium DataSources).
  /* eslint-disable no-undef */
  const ENTS = {
    eq: () => [eqEnts],
    fire: () => [fireEnts, firePerimEnts],
    conf: () => [confEnts],
    warlive: () => [warliveEnts],
    air: () => [airEnts, milEnts],
    // FORCE TRACK shows the military subset of AIR; count it only when AIR itself is off.
    forcetrack: () => (layers.air ? [] : [milEnts]),
    cable: () => [cableEnts],
    landings: () => [landingEnts],
    chokepoints: () => [chokepointEnts],
    sat: () => [satEnts],
    territory: () => [territoryEnts],
    imint: () => [imintEnts],
    news: () => [newsEnts],
    headlines: () => [headlineEnts],
    spaceweather: () => [spwxEnts],
    mesh: () => [meshEnts],
    community: () => [communityEnts],
    floods: () => [floodEnts],
    tsunamis: () => [tsunamiEnts],
    volcanoes: () => [volcanoEnts],
    nucranges: () => [nucRangeEnts],
    alliances: () => [allianceEnts, _allianceDS],
    powerplants: () => [powerplantEnts],
    gridinfra: () => [gridinfraEnts],
    substations: () => [substationEnts],
    pipelines: () => [pipelineEnts],
    metar: () => [metarEnts],
    dartbuoys: () => [dartEnts],
    fireperims: () => [fireperimEnts],
    oilgas: () => [oilgasEnts],
    sanctions: () => [sanctionEnts, _sanctionDS],
    embassies: () => [embassyEnts],
    wireshark: () => [wiresharkEnts],
    vegetation: () => [vegEnts],
    darkships: () => [darkshipEnts],
    ioc: () => [iocEnts],
    fallout: () => [falloutEnts, _falloutDS],
    hurricanes: () => [hurricaneEnts],
    alerts: () => [alertEnts],
    lightning: () => [lightningEnts],
    vessels: () => [vesselEnts],
    cyber: () => [cyberEnts],
    outages: () => [outageEnts],
    downdetect: () => [downEnts],
    webcams: () => [webcamEnts],
    radio: () => [radioEnts],
    airquality: () => [aqiEnts],
    deflock: () => [deflockEnts],
    celltowers: () => [cellTowerEnts],
    milbases: () => [milbaseEnts],
    milairfields: () => [milairfieldEnts],
    nukes: () => [nukeEnts]
  };
  /* eslint-enable no-undef */

  // ── Which URLs belong to which layer ───────────────────────────────────────────────────────
  // [pattern, layers]. First match wins. Several layers = shared feed, split between those on.
  const NET_RULES = [
    [/earthquake\.usgs\.gov/, ['eq']],
    [/proxy-firms/, ['fire', 'warlive', 'aoiwatch']],
    [/proxy-adsb|proxy-opensky|proxy-flightradar24|adsb\.lol|adsb\.fi|opensky-network/, ['air', 'forcetrack']],
    [/proxy-celestrak|celestrak\.org/, ['sat', 'aoiwatch']],
    [/proxy-cables/, ['cable']],
    [/proxy-cfradar/, ['internet', 'landings']],
    [/proxy-gdeltevents|proxy-newsgeo/, ['warlive']],
    [/proxy-gdelt/, ['news', 'conf', 'warlive', 'milbases']],
    [/proxy-news\b|proxy-news\?/, ['headlines']],
    [/proxy-maritime|\/api\/ais|digitraffic\.fi|aisstream/, ['vessels', 'darkships']],
    [/proxy-waqi|air-quality-api\.open-meteo/, ['airquality']],
    [/proxy-spaceweather|proxy-swpc|swpc\.noaa\.gov/, ['spaceweather']],
    [/proxy-weather|api\.weather\.gov/, ['alerts', 'hurricanes', 'lightning']],
    [/proxy-gdacs|gdacs\.org/, ['floods', 'tsunamis']],
    [/proxy-owm|openweathermap\.org/, ['weather', 'clouds', 'temp', 'wind']],
    [/proxy-tomorrow|tomorrow\.io/, ['forecastradar']],
    [/rainviewer/, ['weather', 'forecastradar']],
    [/proxy-outages/, ['outages']],
    [/proxy-status|discordstatus|metastatus/, ['downdetect']],
    [/proxy-cams\b|proxy-cams\?/, ['webcams']],
    [/proxy-mecams|windy\.com|webcams\.travel/, ['camwall', 'webcams']],
    [/proxy-ip2location/, ['cyber']],
    [/proxy-overpass|overpass-api|overpass\.kumi/, ['deflock', 'celltowers']],
    [/proxy-signals|kiwisdr/, ['signals']],
    [/proxy-eu\b|proxy-eu\?/, ['euwarn', 'cems']],
    [/proxy-meshworld/, ['meshworld']],
    [/gps-interference/, ['gpsjam']],
    [/incidents-recent/, ['incidents']],
    [/proxy-watch|proxy-gnews/, ['aoiwatch']],
    [/proxy-aw\b|proxy-aw\?/, ['milbases', 'milairfields']],
    [/proxy-hazardbio/, ['hazardbio']],
    [/sentinel|copernicus/, ['sentinel']],
    [/services\d*\.arcgis\.com|arcgis\.com\/arcgis\/rest|\/FeatureServer|\/MapServer\/\d/, ['volcanoes', 'gridinfra', 'substations', 'pipelines', 'metar', 'dartbuoys', 'fireperims', 'powerplants', 'oilgas']]
  ];
  const OTHER = '_other';

  const WINDOW_MS = 60000; // network figures are "per minute": a rolling 60 s window
  const TICK_MS = 2000;

  function on() { try { return typeof layers === 'object' && layers ? layers : {}; } catch (_) { return {}; } } // eslint-disable-line no-undef

  // "Drawn" = Cesium will actually draw it: its own show AND its parent's (p206b culling hangs off-screen
  // points under a hidden parent). "Loaded" = the layer has it switched on, on screen or not.
  const isDrawn = e => (typeof e.isShowing === 'boolean' ? e.isShowing : e.show !== false);
  const isLoaded = e => e.show !== false;
  function countColl(c, test) {
    test = test || isDrawn;
    if (!c) return 0;
    try {
      if (Array.isArray(c)) { let n = 0; for (let i = 0; i < c.length; i++) { const e = c[i]; if (e && test(e)) n++; } return n; }
      if (c instanceof Set) { let n = 0; c.forEach(e => { if (e && test(e)) n++; }); return n; }
      if (c.entities && c.entities.values) return c.show === false ? 0 : c.entities.values.length; // DataSource
    } catch (_) {}
    return 0;
  }

  function collections(ly) {
    const g = ENTS[ly];
    if (!g) return [];
    try { return g().filter(Boolean); } catch (_) { return []; } // array not declared yet (lazy module not loaded)
  }
  function drawnFor(ly, test) {
    if (!ENTS[ly]) return null; // tile / module layer: we don't know its entity count
    let n = 0;
    for (const c of collections(ly)) n += countColl(c, test);
    return n;
  }

  // Which layer(s) a URL belongs to, given what's on. Returns [[layer, share], ...].
  function attribute(url, active) {
    for (const [re, lys] of NET_RULES) {
      if (!re.test(url)) continue;
      const live = lys.filter(l => active[l]);
      if (!live.length) return [[OTHER, 1]];
      return live.map(l => [l, 1 / live.length]);
    }
    return [[OTHER, 1]];
  }

  // ── Network window ─────────────────────────────────────────────────────────────────────────
  const net = []; // {t, url, bytes}
  function addEntry(e) {
    if (!e || !e.name || e.name.startsWith('data:') || e.name.startsWith('blob:')) return;
    const bytes = e.transferSize || e.encodedBodySize || 0;
    net.push({ t: performance.timeOrigin + e.startTime, url: e.name, bytes });
  }
  function trimNet(now) { while (net.length && now - net[0].t > WINDOW_MS) net.shift(); if (net.length > 5000) net.splice(0, net.length - 5000); }
  try {
    const po = new PerformanceObserver(list => list.getEntries().forEach(addEntry));
    po.observe({ type: 'resource', buffered: true });
    // The buffer holds 250 entries by default; a busy globe fills it in minutes and new entries stop.
    if (performance.setResourceTimingBufferSize) performance.setResourceTimingBufferSize(2000);
    performance.addEventListener && performance.addEventListener('resourcetimingbufferfull', () => { try { performance.clearResourceTimings(); } catch (_) {} });
  } catch (_) { /* old browser: network figures stay at 0 */ }

  // ── Frame rate ─────────────────────────────────────────────────────────────────────────────
  const frames = [];
  let fpsHooked = false;
  function hookFps() {
    if (fpsHooked) return;
    try {
      const V = window.V || (typeof viewer !== 'undefined' ? viewer : null); // eslint-disable-line no-undef
      if (!V || !V.scene) return;
      V.scene.postRender.addEventListener(() => { const t = performance.now(); frames.push(t); while (frames.length && t - frames[0] > 3000) frames.shift(); });
      fpsHooked = true;
    } catch (_) {}
  }
  function fps() {
    const t = performance.now();
    while (frames.length && t - frames[0] > 3000) frames.shift();
    return Math.round(frames.length / 3);
  }

  // ── Cost per layer ─────────────────────────────────────────────────────────────────────────
  // Light / medium / heavy. Thresholds picked from what makes the globe stutter on the laptop:
  // a few thousand billboards, or a feed pulling MBs a minute.
  function grade(drawn, reqMin, kbMin) {
    const d = drawn || 0;
    if (d > 3000 || kbMin > 1500 || reqMin > 60) return 'heavy';
    if (d > 500 || kbMin > 250 || reqMin > 12) return 'medium';
    return 'light';
  }
  // One number for the whole page, 0–100, for the strip's bar.
  function loadScore(totalDrawn, totalKbMin, totalReqMin) {
    const s = totalDrawn / 150 + totalKbMin / 60 + totalReqMin / 3; // ~15k things or ~6 MB/min alone fills it
    return Math.max(0, Math.min(100, Math.round(s)));
  }

  function layerName(ly) {
    try {
      const el = document.querySelector('.ly[data-layer="' + ly + '"] .ly-n');
      if (el && el.textContent.trim()) return el.textContent.trim();
    } catch (_) {}
    return ly;
  }

  function snapshot() {
    const active = on();
    const now = performance.timeOrigin + performance.now();
    trimNet(now);
    const rows = {};
    Object.keys(active).filter(k => active[k]).forEach(k => { rows[k] = { layer: k, drawn: drawnFor(k), loaded: drawnFor(k, isLoaded), req: 0, bytes: 0 }; });
    rows[OTHER] = { layer: OTHER, drawn: null, req: 0, bytes: 0 };
    for (const n of net) {
      for (const [ly, share] of attribute(n.url, active)) {
        const r = rows[ly] || rows[OTHER];
        r.req += share; r.bytes += n.bytes * share;
      }
    }
    // Totals are the layers' own cost. "Map and app" (basemap, terrain, app files) is its own row:
    // right after a load it is many MB and would drown out what the layers cost.
    let totalDrawn = 0, totalLoaded = 0, totalKb = 0, totalReq = 0, otherKb = 0, otherReq = 0;
    const list = Object.values(rows).map(r => {
      const reqMin = Math.round(r.req * 10) / 10, kbMin = Math.round(r.bytes / 1024);
      if (r.layer === OTHER) { otherKb = kbMin; otherReq = reqMin; }
      else { totalDrawn += r.drawn || 0; totalLoaded += r.loaded || 0; totalKb += kbMin; totalReq += reqMin; }
      return { layer: r.layer, name: r.layer === OTHER ? 'Map and app' : layerName(r.layer), drawn: r.drawn, loaded: r.loaded == null ? null : r.loaded, reqMin, kbMin, cost: grade(r.drawn, reqMin, kbMin) };
    });
    const rank = { heavy: 3, medium: 2, light: 1 };
    list.sort((a, b) => (a.layer === OTHER) - (b.layer === OTHER) || rank[b.cost] - rank[a.cost] || (b.drawn || 0) - (a.drawn || 0) || b.kbMin - a.kbMin);
    let globeEnts = null;
    try { globeEnts = window.V && window.V.entities ? window.V.entities.values.length : null; } catch (_) {}
    let heapMb = null;
    try { if (performance.memory) heapMb = Math.round(performance.memory.usedJSHeapSize / 1048576); } catch (_) {}
    return {
      layersOn: list.filter(r => r.layer !== OTHER).length,
      drawn: totalDrawn, loaded: totalLoaded, kbMin: totalKb, reqMin: Math.round(totalReq), otherKbMin: otherKb, otherReqMin: Math.round(otherReq),
      fps: fps(), globeEnts, heapMb,
      score: loadScore(totalDrawn, totalKb, totalReq),
      rows: list
    };
  }

  // ── UI ─────────────────────────────────────────────────────────────────────────────────────
  const fmtN = n => n == null ? '—' : n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  const fmtKb = kb => kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let root = null, open = false;
  function mount() {
    if (root && document.contains(root)) return root;
    const lpB = document.querySelector('.lp-b');
    if (!lpB) return null;
    root = document.getElementById('lyMeter');
    if (!root) {
      root = document.createElement('div');
      root.id = 'lyMeter';
      root.className = 'lym';
      root.innerHTML =
        '<button type="button" class="lym-strip" aria-expanded="false" aria-controls="lymList" title="What the layers that are on cost. Tap for each layer.">' +
          '<span class="lym-lbl">LOAD</span><span class="lym-bar"><i></i></span><span class="lym-txt"></span></button>' +
        '<div class="lym-list" id="lymList" hidden></div>';
      lpB.insertBefore(root, lpB.firstChild);
      root.querySelector('.lym-strip').addEventListener('click', () => {
        open = !open;
        root.querySelector('.lym-strip').setAttribute('aria-expanded', String(open));
        root.querySelector('.lym-list').hidden = !open;
        render();
      });
      root.querySelector('.lym-list').addEventListener('click', ev => {
        const cb = ev.target.closest('[data-cull]');
        if (cb && window.BDOCCull) { ev.stopPropagation(); window.BDOCCull.setEnabled(cb.getAttribute('data-cull') === '1'); setTimeout(render, 50); return; }
        const b = ev.target.closest('[data-off]');
        if (!b) return;
        ev.stopPropagation();
        const el = document.querySelector('.ly[data-layer="' + b.getAttribute('data-off') + '"]');
        if (el && el.classList.contains('on') && typeof window.togLy === 'function') window.togLy(el);
        setTimeout(render, 50);
      });
    }
    return root;
  }

  function visible() {
    if (!root || !document.contains(root) || document.hidden) return false;
    return root.getClientRects().length > 0; // panel shut (display:none somewhere above) → skip the work
  }

  function render() {
    if (!mount()) return;
    hookFps();
    if (!visible()) return;
    const s = snapshot();
    const lvl = s.score >= 70 ? 'heavy' : s.score >= 35 ? 'medium' : 'light';
    root.setAttribute('data-level', lvl);
    root.querySelector('.lym-bar i').style.width = Math.max(s.layersOn ? 4 : 0, s.score) + '%';
    root.querySelector('.lym-txt').textContent = s.layersOn
      ? s.layersOn + ' on · ' + fmtN(s.drawn) + ' drawn · ' + fmtKb(s.kbMin) + '/min'
      : 'No layers on';
    if (!open) return;
    const fpsTxt = s.fps ? s.fps + ' fps' : 'idle (draws on demand)';
    let h = '<div class="lym-sum">Globe: ' + esc(fpsTxt) + ' · ' + fmtN(s.globeEnts) + ' objects' +
      (s.heapMb ? ' · ' + s.heapMb + ' MB memory' : '') + ' · layers ' + s.reqMin + ' requests/min</div>';
    const C = window.BDOCCull;
    if (C) h += '<div class="lym-sum"><button type="button" class="lym-cull" data-cull="' + (C.isEnabled() ? '0' : '1') + '" aria-pressed="' + C.isEnabled() + '">Off-screen culling: ' + (C.isEnabled() ? 'ON' : 'OFF') + '</button>' +
      (C.isEnabled() && s.loaded > s.drawn ? ' ' + fmtN(s.loaded - s.drawn) + ' off screen, not drawn' : '') + '</div>';
    // Two lines per layer: the panel is ~220 px wide, so names get the full width and numbers sit under them.
    for (const r of s.rows) {
      if (r.layer === OTHER && !r.kbMin && !r.reqMin) continue;
      const parts = [];
      if (r.drawn != null) parts.push(fmtN(r.drawn) + ' drawn' + (r.loaded > r.drawn ? ' of ' + fmtN(r.loaded) : ''));
      else if (r.layer !== OTHER) parts.push('map tiles');
      if (r.kbMin) parts.push(fmtKb(r.kbMin) + '/min');
      else if (r.reqMin) parts.push('<span title="This source does not report its size to the browser">size n/a</span>');
      if (r.reqMin) parts.push(r.reqMin + ' req/min');
      if (!r.kbMin && !r.reqMin && r.layer !== OTHER) parts.push('no traffic');
      h += '<div class="lym-row" data-cost="' + r.cost + '"><span class="lym-dot" title="' + r.cost + '"></span>' +
        '<div class="lym-main"><div class="lym-n" title="' + esc(r.name) + '">' + esc(r.name) + '</div>' +
        '<div class="lym-sub">' + parts.join(' · ') + '</div></div>' +
        (r.layer === OTHER ? '<span></span>' : '<button type="button" class="lym-off" data-off="' + esc(r.layer) + '" title="Turn off ' + esc(r.name) + '" aria-label="Turn off ' + esc(r.name) + '">✕</button>') +
        '</div>';
    }
    if (!s.layersOn) h += '<div class="lym-empty">Turn on a layer to see what it costs.</div>';
    root.querySelector('.lym-list').innerHTML = h;
  }

  function start() {
    mount();
    setInterval(render, TICK_MS);
    render();
  }

  window.BDOCLayerMeter = {
    snapshot,
    render,
    collections,
    layerKeys: () => Object.keys(ENTS),
    _test: { attribute, grade, loadScore, countColl, isLoaded, NET_RULES, ENTS, OTHER, addEntry, net }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
