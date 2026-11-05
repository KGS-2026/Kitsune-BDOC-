// ============================================================
// BDOC MODULE: aoi-watch.js
// AOI WATCH — live multi-feed watch zones. Two zones armed together:
//   NATANZ / PICKAXE MTN (Kuh-e Kolang Gaz La)   — added 2026-11-02
//   STRAIT OF HORMUZ / QESHM                       — added 2026-11-03 after the Qeshm strike
// Lazy-loaded on first toggle of layer 'aoiwatch' (CONFLICTS group). Panel has one tab per zone.
// Feeds (all public / open data — no access to anything not published):
//   /.netlify/functions/proxy-watch   EMSC+USGS seismic, RIPE Atlas probes, IODA connectivity,
//                                     Copernicus Sentinel-1/2 catalogue, adsb.lol military ADS-B,
//                                     GDELT news (incl. Al Jazeera via domain filter), Polymarket, Open-Meteo
//   /.netlify/functions/proxy-firms   NASA FIRMS VIIRS thermal anomalies
//   /.netlify/functions/proxy-celestrak  imaging-satellite TLEs → SGP4 pass prediction (satellite.js)
//   /.netlify/functions/proxy-gnews   news fallback when GDELT is rate-limited
// Depends on (resolved at call time): V, Cesium, layers, esc, safeUrl, af, EventLog, satellite
// p168p: ported to main from the stale OneDrive copy (built there 2026-11-02/03 on Cesium 1.104).
//   Changes for main: one-shot BDOCRender.kick() after each feed update (main renders on demand),
//   proxy-firms now caps days at 5 (FIRMS area API maximum), toggle sits in the CONFLICTS group.
//   The object is AOIZoneWatch, not AOIWatch: main's index.html already has a top-level
//   `const AOIWatch` (P69, the NEAR ME home-AOI alerts), and a second declaration kills this script.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

var AOI_ZONES = [
  {
    id: 'natanz', name: 'NATANZ / PICKAXE MTN', tab: 'NATANZ', site: 'Pickaxe Mtn',
    lat: 33.69, lon: 51.72, alt: 1.4, view: 160000,
    rings: [{ km: 5, col: '#DA3633' }, { km: 25, col: '#E8B339' }, { km: 100, col: '#4A9EFF' }],
    firmsArea: '50.7,32.9,52.7,34.5',          // W,S,E,N — ~100 km box
    firmsAlertKm: 25, firmsNearKm: 100, firmsMaxKm: 150,
    seismicDeg: 3, seismicKm: 400, seisAlertKm: 50,
    ripeKm: 250, ripeCountry: 'IR', country: 'IR',
    iodaRegion: '1824', iodaRegionName: 'Esfahan',
    newsQuery: '(natanz OR "pickaxe mountain" OR "kolang gaz la")',
    gnewsQuery: 'Natanz OR "Pickaxe Mountain"',
    links: []
  },
  {
    id: 'hormuz', name: 'STRAIT OF HORMUZ / QESHM', tab: 'HORMUZ', site: 'Qeshm',
    lat: 26.75, lon: 55.85, alt: 0.05, view: 420000,
    // 60 km ring covers all of Qeshm Island plus Bandar Abbas, Larak and Hormuz islands
    rings: [{ km: 20, col: '#DA3633' }, { km: 60, col: '#E8B339' }, { km: 150, col: '#4A9EFF' }],
    firmsArea: '54.3,25.6,57.6,28.0',
    firmsAlertKm: 60, firmsNearKm: 150, firmsMaxKm: 200,
    seismicDeg: 2, seismicKm: 250, seisAlertKm: 20, // Zagros/Hormozgan quakes are routine — tight alert radius
    // No live Iranian RIPE probes near Qeshm (all abandoned) — watch every probe in range, mostly UAE side:
    // catches Gulf cable cuts and strikes on UAE infrastructure
    ripeKm: 300, ripeCountry: '', country: 'IR',
    iodaRegion: '1835', iodaRegionName: 'Hormozgan',
    newsQuery: '(qeshm OR "strait of hormuz" OR "bandar abbas" OR "bandar lengeh")',
    gnewsQuery: 'Qeshm OR "Strait of Hormuz"',
    links: [['UKMTO', 'https://www.ukmto.org/'], ['MarineTraffic', 'https://www.marinetraffic.com/en/ais/home/centerx:56.3/centery:26.6/zoom:9']]
  }
];
var AOI_THEATER = {
  milBox: { lamin: 12, lamax: 42, lomin: 32, lomax: 65 }, // CENTCOM AOR core
  ajQuery: 'iran'
};

var AOIZoneWatch = {
  on: false, timers: [], state: {}, ents: {}, fired: {}, open: {}, ripeBase: {}, panel: null, minimized: false,
  zones: AOI_ZONES, sel: AOI_ZONES[0].id, ajLast: null, _gq: Promise.resolve(),
  // scope: 'zone' = polled per zone · 'theater' = polled once, shown in every tab · 'multi' = polled once, result per zone
  FEEDS: [
    { id: 'firms', label: 'THERMAL',    src: 'NASA FIRMS VIIRS',            every: 600000,  scope: 'zone' },
    { id: 'seis',  label: 'SEISMIC',    src: 'EMSC + USGS',                 every: 300000,  scope: 'zone' },
    { id: 'nodes', label: 'NET NODES',  src: 'RIPE Atlas probes',           every: 300000,  scope: 'zone' },
    { id: 'ioda',  label: 'NET SIGNAL', src: 'IODA (Georgia Tech)',         every: 300000,  scope: 'zone' },
    { id: 'mil',   label: 'MIL AIR',    src: 'adsb.lol military',           every: 60000,   scope: 'theater' },
    { id: 'img',   label: 'IMAGERY',    src: 'Copernicus Sentinel',         every: 1800000, scope: 'zone' },
    { id: 'pass',  label: 'SAT PASSES', src: 'CelesTrak + SGP4',            every: 1800000, scope: 'multi' },
    { id: 'wx',    label: 'WEATHER',    src: 'Open-Meteo',                  every: 900000,  scope: 'zone' },
    { id: 'news',  label: 'NEWS',       src: 'GDELT (GNews fallback)',      every: 1800000, scope: 'zone' },
    { id: 'aj',    label: 'AL JAZEERA', src: 'GDELT · aljazeera.com',       every: 900000,  scope: 'theater' },
    { id: 'mkt',   label: 'MARKETS',    src: 'Polymarket',                  every: 600000,  scope: 'theater' }
  ],

  // ── lifecycle ─────────────────────────────────────────────
  start() {
    if (!V || this.on) return;
    this.on = true;
    this.zones.forEach(z => this._drawRings(z));
    this._buildPanel();
    this.FEEDS.forEach(f => {
      this.zones.forEach(z => { const k = this._key(z.id, f); this.state[k] = this.state[k] || { lvl: -2, sum: 'loading…', ts: 0 }; });
      const runAll = () => f.scope === 'zone' ? this.zones.forEach(z => this._run(f, z)) : this._run(f);
      runAll();
      this.timers.push(setInterval(() => { if (!document.hidden) runAll(); }, f.every));
    });
    this.render();
    af('var(--rd)', `AOI WATCH armed: ${this.zones.map(z => z.tab).join(' + ')} — ${this.FEEDS.length} live feeds per zone`);
    EventLog.add('info', 'AOI Watch armed: ' + this.zones.map(z => z.name).join(', '));
  },
  stop() {
    this.on = false;
    this.timers.forEach(clearInterval); this.timers = [];
    Object.keys(this.ents).forEach(k => this._clear(k));
    if (this.panel) this.panel.style.display = 'none';
    this._kick();
  },
  // main renders on demand (cesium-init.js RenderGovernor) — ask for one frame after entity changes
  _kick() { try { if (window.BDOCRender) window.BDOCRender.kick(); else if (V) V.scene.requestRender(); } catch (_) {} },
  refresh() { this.FEEDS.forEach(f => f.scope === 'zone' ? this.zones.forEach(z => this._run(f, z)) : this._run(f)); },
  zoom() {
    const z = this._zone();
    if (V) V.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(z.lon, z.lat - z.view / 180000, z.view), orientation: { heading: 0, pitch: Cesium.Math.toRadians(-55), roll: 0 }, duration: 1.5 });
  },

  async _run(f, z) {
    try { await this['poll_' + f.id](z); }
    catch (e) {
      const msg = 'unavailable — ' + (e.message || 'error');
      if (f.scope === 'multi') this.zones.forEach(zz => this._set(this._key(zz.id, f), -1, msg));
      else this._set(this._key(z ? z.id : '_', f), -1, msg);
      console.warn('[AOI Watch ' + f.id + (z ? ':' + z.id : '') + ']', e);
    }
    if (!this.on) { Object.keys(this.ents).forEach(k => this._clear(k)); this._kick(); return; } // turned off mid-poll
    this.render();
    this._kick();
  },

  // ── helpers ───────────────────────────────────────────────
  _zone() { return this.zones.find(z => z.id === this.sel) || this.zones[0]; },
  _key(zid, f) { return f.scope === 'theater' ? '_:' + f.id : zid + ':' + f.id; },
  async _get(url, ms) {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms || 12000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  },
  async _w(source, params) {
    const qs = new URLSearchParams(Object.assign({ source }, params || {}));
    return (await this._get('/.netlify/functions/proxy-watch?' + qs.toString())).json();
  },
  // GDELT allows one request per 5 s — queue every GDELT call from this page with a 6 s gap
  _gdelt(params) {
    const run = this._gq.then(() => this._w('news', params));
    this._gq = run.catch(() => {}).then(() => new Promise(r => setTimeout(r, 6000)));
    return run;
  },
  _km(lat, lon, z) {
    const r = Math.PI / 180, d1 = (lat - z.lat) * r, d2 = (lon - z.lon) * r;
    const x = Math.sin(d1 / 2) ** 2 + Math.cos(z.lat * r) * Math.cos(lat * r) * Math.sin(d2 / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(x));
  },
  _nearest(lat, lon) {
    return this.zones.map(z => ({ z, km: this._km(lat, lon, z) })).sort((a, b) => a.km - b.km)[0];
  },
  _ago(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    return s < 90 ? Math.round(s) + 's' : s < 5400 ? Math.round(s / 60) + 'm' : s < 172800 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd';
  },
  _in(ms) { const m = Math.round((ms - Date.now()) / 60000); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm'; },
  _z(iso) { return esc(String(iso).slice(5, 16).replace('T', ' ')) + 'Z'; },
  _set(key, lvl, sum, detail) { this.state[key] = { lvl, sum, detail: detail || '', ts: Date.now() }; },
  _clear(key) { (this.ents[key] || []).forEach(e => V.entities.remove(e)); this.ents[key] = []; },
  // p168p: entities with a popup get a name (the InfoBox title bar showed the raw entity id).
  // _popup() runs while opts is being built, so _lastTitle is this entity's popup title.
  _add(key, opts) {
    if (opts.description && !opts.name && this._lastTitle) opts.name = this._lastTitle;
    (this.ents[key] = this.ents[key] || []).push(V.entities.add(Object.assign(opts, { show: !!layers.aoiwatch })));
  },
  // Alerts fire once per key; lvl 2 = ALERT (red + crit log), 1 = ACTIVITY, 0 = info
  _raise(key, lvl, msg) {
    if (this.fired[key]) return;
    this.fired[key] = Date.now();
    const col = lvl >= 2 ? 'var(--rd)' : lvl === 1 ? 'var(--yl)' : 'var(--bl)';
    af(col, (lvl >= 2 ? '▲ AOI ALERT: ' : 'AOI WATCH: ') + esc(msg)); // rf() renders feed items as raw HTML
    EventLog.add(lvl >= 2 ? 'crit' : lvl === 1 ? 'warn' : 'info', 'AOI Watch: ' + msg);
  },
  _popup(title, col, rows, link) {
    this._lastTitle = String(title);
    return `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:380px;background:#0a0e14;padding:12px;border-radius:2px;border:1px solid ${col}33;color:#c8ccd6">
      <div style="color:${col};font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:8px">${esc(title)}</div>
      <table style="width:100%;border-collapse:collapse;font-size:10px;color:#9BA1A8">${rows.map(([k, v]) => `<tr><td style="padding:2px 0;width:38%;color:#5C636B">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
      ${link ? `<a href="${safeUrl(link)}" target="_blank" rel="noopener noreferrer" style="display:block;margin-top:8px;padding:5px;border:1px solid ${col}33;color:${col};text-decoration:none;font-size:9px;text-align:center">OPEN SOURCE →</a>` : ''}
      <div style="margin-top:8px;font-size:7px;color:#1e2436;letter-spacing:1px;text-align:right">KITSUNE BDOC — AOI WATCH</div></div>`;
  },

  // ── map: watch rings ──────────────────────────────────────
  _drawRings(z) {
    const k = z.id + ':rings';
    this._clear(k);
    z.rings.forEach((ring, i) => {
      const pts = [];
      for (let a = 0; a <= 360; a += 4) {
        const b = a * Math.PI / 180, dLat = (ring.km / 111.32) * Math.cos(b);
        const dLon = (ring.km / (111.32 * Math.cos(z.lat * Math.PI / 180))) * Math.sin(b);
        pts.push(z.lon + dLon, z.lat + dLat);
      }
      const col = Cesium.Color.fromCssColorString(ring.col);
      this._add(k, { polyline: { positions: Cesium.Cartesian3.fromDegreesArray(pts), width: i === 0 ? 2.5 : 1.5, clampToGround: true,
        material: i === 2 ? new Cesium.PolylineDashMaterialProperty({ color: col.withAlpha(0.7), dashLength: 14 }) : col.withAlpha(0.85) } });
      this._add(k, { position: Cesium.Cartesian3.fromDegrees(z.lon, z.lat + ring.km / 111.32), label: { text: ring.km + ' km', font: '9px JetBrains Mono', fillColor: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, ring.km * 40000), disableDepthTestDistance: 5e6 } });
    });
    this._add(k, { position: Cesium.Cartesian3.fromDegrees(z.lon, z.lat), label: { text: '◎ AOI WATCH — ' + z.name, font: 'bold 10px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString('#DA3633'), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -30), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.55), disableDepthTestDistance: 5e6 } });
  },

  // ── feeds ─────────────────────────────────────────────────
  async poll_firms(z) {
    const srcs = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'];
    // 5 days (FIRMS area API max) — the older days are the baseline for spotting persistent industrial heat
    const texts = await Promise.all(srcs.map(s => this._get(`/.netlify/functions/proxy-firms?mode=area&source=${s}&area=${z.firmsArea}&days=5`, 20000).then(r => r.text()).catch(() => '')));
    if (texts.every(t => !t)) throw new Error('FIRMS proxy down');
    const hits = [];
    texts.forEach(t => {
      const lines = t.trim().split('\n'); const hdr = (lines.shift() || '').split(',');
      const ix = k => hdr.indexOf(k);
      lines.forEach(l => {
        const c = l.split(','); const lat = +c[ix('latitude')], lon = +c[ix('longitude')];
        if (!isFinite(lat) || !isFinite(lon) || this._km(lat, lon, z) > z.firmsMaxKm) return; // Electron proxy ignores area → returns global
        const tm = c[ix('acq_time')] || '0000';
        const when = Date.parse(`${c[ix('acq_date')]}T${tm.padStart(4, '0').slice(0, 2)}:${tm.padStart(4, '0').slice(2)}:00Z`);
        hits.push({ lat, lon, when, date: c[ix('acq_date')], frp: c[ix('frp')], conf: c[ix('confidence')], sat: c[ix('satellite')], dn: c[ix('daynight')], km: this._km(lat, lon, z) });
      });
    });
    // Refineries, steel plants and gas flares light up the same ~2 km cell day after day. A detection whose
    // 3×3-cell neighbourhood also burned on another date in the 5-day window is tagged INDUSTRIAL and does
    // not alert — unless it is 3× hotter (FRP) than anything seen there on those other dates. A strike fire
    // still alerts on its first detection; only its later days are treated as known heat.
    const cell = (la, lo) => Math.round(la * 50) + ':' + Math.round(lo * 50); // 0.02° ≈ 2 km
    const hist = {};
    hits.forEach(h => { const c = cell(h.lat, h.lon), d = (hist[c] = hist[c] || {}); d[h.date] = Math.max(d[h.date] || 0, +h.frp || 0); });
    hits.forEach(h => {
      const i = Math.round(h.lat * 50), j = Math.round(h.lon * 50), other = {};
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const d = hist[(i + a) + ':' + (j + b)]; if (!d) continue;
        Object.keys(d).forEach(dt => { if (dt !== h.date) other[dt] = Math.max(other[dt] || 0, d[dt]); });
      }
      const dates = Object.keys(other);
      h.ind = dates.length >= 1 && !(+h.frp > 3 * Math.max(...dates.map(dt => other[dt])));
    });
    const k = z.id + ':firms';
    this._clear(k);
    hits.forEach(h => {
      const col = h.ind ? '#9BA1A8' : h.km <= z.firmsAlertKm ? '#DA3633' : '#ff7a00';
      this._add(k, { position: Cesium.Cartesian3.fromDegrees(h.lon, h.lat), point: { pixelSize: h.ind ? 5 : h.km <= z.firmsAlertKm ? 10 : 7, color: Cesium.Color.fromCssColorString(col), outlineColor: Cesium.Color.WHITE.withAlpha(0.6), outlineWidth: 1, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 5e6 },
        description: this._popup('THERMAL ANOMALY — FIRMS' + (h.ind ? ' (PERSISTENT / INDUSTRIAL)' : ''), col, [['Detected', new Date(h.when).toISOString().slice(0, 16) + 'Z'], ['Distance', h.km.toFixed(1) + ' km from ' + z.site], ['FRP', h.frp + ' MW'], ['Confidence', h.conf], ['Sensor', 'VIIRS ' + h.sat + (h.dn === 'N' ? ' (night)' : ' (day)')], ['Pattern', h.ind ? 'Same spot burned on another day — likely industrial / known heat' : 'New heat source in 5-day window']], `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${h.lon.toFixed(3)},${h.lat.toFixed(3)},12.00z`) });
    });
    const live = hits.filter(h => !h.ind);
    const close = live.filter(h => h.km <= z.firmsAlertKm && Date.now() - h.when < 86400000);
    const near = live.filter(h => h.km <= z.firmsNearKm && Date.now() - h.when < 172800000);
    const ind = hits.length - live.length;
    close.forEach(h => this._raise('firms:' + h.lat + ',' + h.lon + ':' + h.when, 2, `${z.tab}: new thermal hit ${h.km.toFixed(1)} km from ${z.site} (FRP ${h.frp} MW, ${this._ago(h.when)} ago)`));
    const lvl = close.length ? 2 : near.length ? 1 : 0;
    this._set(k, lvl, `${near.length} new hotspot${near.length === 1 ? '' : 's'} ≤${z.firmsNearKm} km / 48h` + (close.length ? ` — ${close.length} ≤${z.firmsAlertKm} km` : '') + (ind ? ` · ${ind} industrial filtered` : ''),
      near.sort((a, b) => b.when - a.when).slice(0, 6).map(h => `${this._z(new Date(h.when).toISOString())} · ${h.km.toFixed(0)} km · FRP ${esc(h.frp)}`).join('<br>')
      + (near.length ? '<br>' : '') + `Grey dots = known heat (refineries, flares) — the same spot also burned on another of the last 5 days; they don't alert unless 3× hotter than usual.`);
  },

  async poll_seis(z) {
    const [em, us] = await Promise.all([
      this._w('emsc', { lat: z.lat, lon: z.lon, radius: z.seismicDeg, days: 30 }).catch(() => ({ events: null })),
      this._w('usgs', { lat: z.lat, lon: z.lon, km: z.seismicKm, days: 30 }).catch(() => ({ events: null }))
    ]);
    if (!em.events && !us.events) throw new Error('EMSC + USGS down');
    const evs = (em.events || []).slice();
    (us.events || []).forEach(u => { if (!evs.some(e => Math.abs(Date.parse(e.t) - Date.parse(u.t)) < 60000)) evs.push(u); });
    evs.forEach(e => { e.km = this._km(e.lat, e.lon, z); e.ms = Date.parse(e.t); });
    evs.sort((a, b) => b.ms - a.ms);
    const k = z.id + ':seis';
    this._clear(k);
    evs.forEach(e => {
      const fresh = Date.now() - e.ms < 86400000 * 3, col = e.km <= z.seisAlertKm && fresh ? '#DA3633' : fresh ? '#E8B339' : '#9BA1A8';
      this._add(k, { position: Cesium.Cartesian3.fromDegrees(e.lon, e.lat), point: { pixelSize: 6 + Math.max(0, (e.mag || 0) - 2) * 4, color: Cesium.Color.fromCssColorString(col).withAlpha(0.55), outlineColor: Cesium.Color.fromCssColorString(col), outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 5e6 },
        description: this._popup('SEISMIC EVENT — ' + e.src, col, [['Time', e.t.slice(0, 19) + 'Z'], ['Magnitude', `${e.mag} ${e.magtype || ''}`], ['Depth', (e.depth != null ? Math.abs(e.depth) : '?') + ' km'], ['Distance', e.km.toFixed(0) + ' km from ' + z.site], ['Region', e.region || ''], ['Network', e.auth || e.src]], e.url || `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(e.id)}`) });
    });
    const close = evs.filter(e => e.km <= z.seisAlertKm && Date.now() - e.ms < 86400000 * 3);
    const recent = evs.filter(e => e.km <= 300 && Date.now() - e.ms < 86400000);
    close.forEach(e => this._raise('seis:' + e.id, 2, `${z.tab}: M${e.mag} seismic event ${e.km.toFixed(0)} km from ${z.site}, depth ${Math.abs(e.depth)} km — check for strike / underground blast`));
    recent.forEach(e => this._raise('seis:' + e.id, 1, `${z.tab}: M${e.mag} quake ${e.km.toFixed(0)} km from ${z.site} (${e.region})`));
    this._set(k, close.length ? 2 : recent.length ? 1 : 0,
      `${evs.length} event${evs.length === 1 ? '' : 's'} / 30d` + (evs[0] ? ` · last M${evs[0].mag} ${evs[0].km.toFixed(0)} km, ${this._ago(evs[0].ms)} ago` : ''),
      evs.slice(0, 6).map(e => `${this._z(e.t)} · M${e.mag} · ${e.km.toFixed(0)} km · ${esc(e.region || '')}`).join('<br>'));
  },

  async poll_nodes(z) {
    const j = await this._w('ripe', { lat: z.lat, lon: z.lon, km: z.ripeKm, country: z.ripeCountry });
    const probes = j.probes || [];
    const up = probes.filter(p => p.s === 'Connected');
    const dropped = probes.filter(p => p.s === 'Disconnected' && Date.now() - Date.parse(p.since) < 6 * 3600000);
    if (this.ripeBase[z.id] == null) this.ripeBase[z.id] = up.length;
    const base = this.ripeBase[z.id], k = z.id + ':nodes';
    this._clear(k);
    probes.forEach(p => {
      const col = p.s === 'Connected' ? '#3FB950' : dropped.includes(p) ? '#DA3633' : '#5C636B';
      this._add(k, { position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat), point: { pixelSize: 6, color: Cesium.Color.fromCssColorString(col), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 5e6 },
        description: this._popup('RIPE ATLAS PROBE #' + p.id, col, [['Status', p.s], ['Since', String(p.since).slice(0, 16) + 'Z'], ['Country', p.cc || '?'], ['ASN', p.asn ? 'AS' + p.asn : '?'], ['Distance', p.km + ' km from ' + z.site], ['Host note', p.desc || '—']], `https://atlas.ripe.net/probes/${p.id}/`) });
    });
    const lostVsBase = base ? (base - up.length) / base : 0;
    const lvl = (dropped.length >= 5 || lostVsBase >= 0.2) ? 2 : dropped.length ? 1 : 0;
    if (lvl === 2) this._raise('nodes:' + z.id + ':' + new Date().toISOString().slice(0, 13), 2, `${z.tab}: ${dropped.length} RIPE Atlas probes near ${z.site} went dark in 6h (${up.length} still up) — possible internet/power cut`);
    else if (lvl === 1) this._raise('nodes:' + dropped.map(p => p.id).join(','), 1, `${z.tab}: ${dropped.length} RIPE probe(s) near ${z.site} disconnected in last 6h`);
    const ccs = [...new Set(up.map(p => p.cc).filter(Boolean))].join('/');
    this._set(k, lvl, `${up.length} up / ${probes.length - up.length} down ≤${z.ripeKm} km${ccs ? ' (' + esc(ccs) + ')' : ''} · ${dropped.length} dropped 6h`,
      dropped.length ? 'Dropped: ' + dropped.map(p => `#${p.id} (${p.km} km, AS${esc(p.asn || '?')})`).join(', ') : 'No probes lost in the last 6h. Green = online, grey = offline > 6h, red = dropped < 6h.');
  },

  async poll_ioda(z) {
    const [reg, nat, alN, alR] = await Promise.all([
      this._w('ioda', { entityType: 'region', code: z.iodaRegion, hours: 24 }),
      this._w('ioda', { entityType: 'country', code: z.country, hours: 24 }),
      this._w('iodaalerts', { entityType: 'country', code: z.country, hours: 24 }).catch(() => ({ alerts: [] })),
      this._w('iodaalerts', { entityType: 'region', code: z.iodaRegion, hours: 24 }).catch(() => ({ alerts: [] }))
    ]);
    // Only BGP + active probing are compared to the 24h median — telescope (merit-nt) and Google traffic
    // swing with the day/night cycle and false-alarm at night.
    const pct = s => s && s.ratio != null ? Math.round(s.ratio * 100) + '%' : '—';
    let lvl = 0; const notes = [];
    [[z.iodaRegionName, reg.signals], ['Iran', nat.signals]].forEach(([nm, sg]) => {
      ['bgp', 'ping-slash24'].forEach(ds => {
        const s = sg && sg[ds]; if (!s || s.ratio == null) return;
        if (s.ratio < 0.7) { lvl = 2; notes.push(`${nm} ${ds} at ${pct(s)} of 24h median`); }
        else if (s.ratio < 0.9) { lvl = Math.max(lvl, 1); notes.push(`${nm} ${ds} at ${pct(s)}`); }
      });
    });
    const alerts = (alN.alerts || []).concat(alR.alerts || []).filter(a => a.level !== 'normal');
    if (alerts.some(a => a.level === 'critical')) lvl = 2; else if (alerts.length) lvl = Math.max(lvl, 1);
    // national notes/alerts repeat in both zones — keys without the zone id so they fire once
    notes.forEach(n => this._raise('ioda:' + n.split(' at')[0] + ':' + new Date().toISOString().slice(0, 13), lvl, 'connectivity drop — ' + n));
    alerts.forEach(a => this._raise('iodaA:' + a.t + a.ds + a.entity, a.level === 'critical' ? 2 : 1, `IODA ${a.level} outage alert — ${a.entity} (${a.ds})`));
    const r = reg.signals || {}, n = nat.signals || {};
    this._set(z.id + ':ioda', lvl, `${z.iodaRegionName} BGP ${pct(r.bgp)} · probe ${pct(r['ping-slash24'])} | Iran BGP ${pct(n.bgp)} · probe ${pct(n['ping-slash24'])}`,
      (notes.length ? esc(notes.join(' · ')) + '<br>' : '') + `${alerts.length} IODA outage alert(s) in 24h. % = latest vs 24h median.`);
  },

  async poll_mil() {
    const j = await this._w('milair', AOI_THEATER.milBox);
    const ac = j.aircraft || [];
    const role = t => /^K35|^KC|^K46/i.test(t) ? 'TANKER' : /^R135|^E3|^E6|^P8|^GLHK|^Q4/i.test(t) ? 'ISR' : /^B52|^B1|^B2$/i.test(t) ? 'BOMBER' : /^C17|^C5|^C130|^C30J|^A400/i.test(t) ? 'AIRLIFT' : /^B762/i.test(t) ? 'TANKER?' : '';
    this._clear('_:mil');
    ac.forEach(a => {
      const rl = role(a.t), col = rl === 'BOMBER' ? '#DA3633' : rl ? '#E8B339' : '#4A9EFF', nz = this._nearest(a.lat, a.lon);
      this._add('_:mil', { position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, Math.max(0, (+a.alt || 0) * 0.3048)), point: { pixelSize: 8, color: Cesium.Color.fromCssColorString(col), outlineColor: Cesium.Color.WHITE, outlineWidth: 1, disableDepthTestDistance: 5e6 },
        label: { text: (a.flight || a.hex) + (a.t ? ' ' + a.t : ''), font: '9px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString(col), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -12), disableDepthTestDistance: 5e6 },
        description: this._popup('MIL TRANSPONDER ' + (a.flight || a.hex), col, [['Type', (a.t || '?') + (rl ? ' (' + rl + ')' : '')], ['Reg', a.r || '?'], ['ICAO hex', a.hex], ['Altitude', a.alt + ' ft'], ['Speed', a.gs ? Math.round(a.gs) + ' kt' : '?'], ['Nearest AOI', nz.km.toFixed(0) + ' km from ' + nz.z.site]], `https://adsb.lol/?icao=${encodeURIComponent(a.hex)}`) });
    });
    const flagged = ac.filter(a => role(a.t));
    flagged.forEach(a => { const nz = this._nearest(a.lat, a.lon); this._raise('mil:' + a.hex + ':' + new Date().toISOString().slice(0, 10), role(a.t) === 'BOMBER' ? 2 : 1, `${role(a.t)} ${a.flight || a.r || a.hex} (${a.t}) transmitting in theater, ${nz.km.toFixed(0)} km from ${nz.z.site}`); });
    this._set('_:mil', flagged.some(a => role(a.t) === 'BOMBER') ? 2 : flagged.length ? 1 : 0,
      `${ac.length} mil transponder${ac.length === 1 ? '' : 's'} in theater` + (flagged.length ? ` · ${flagged.length} tanker/ISR/bomber` : ''),
      (ac.length ? ac.slice(0, 10).map(a => { const nz = this._nearest(a.lat, a.lon); return `${esc(a.flight || a.r || a.hex)} · ${esc(a.t || '?')} ${role(a.t) ? '<b>' + role(a.t) + '</b> ' : ''}· ${nz.km.toFixed(0)} km ${esc(nz.z.site)}`; }).join('<br>') + '<br>' : '') + 'Only aircraft broadcasting ADS-B appear. Strike packages usually fly dark, and there is no receiver coverage over central Iran.');
  },

  async poll_img(z) {
    const [s2, s1] = await Promise.all([
      this._w('imagery', { collection: 'S2', lat: z.lat, lon: z.lon, days: 20 }),
      this._w('imagery', { collection: 'S1', lat: z.lat, lon: z.lon, days: 20 }).catch(() => ({ scenes: [] }))
    ]);
    const a = s2.scenes || [], b = s1.scenes || [];
    [a[0], b[0]].forEach(s => { if (s && Date.now() - Date.parse(s.t) < 86400000) this._raise('img:' + s.name, 0, `${z.tab}: fresh ${s.sat} scene over ${z.site} (${this._z(s.t)}${s.cloud != null ? ', cloud ' + s.cloud + '%' : ''}) — open Copernicus Browser`); });
    const fmt = s => `${esc(s.sat)} ${this._z(s.t)}` + (s.cloud != null ? ` ☁${s.cloud}%` : '');
    this._set(z.id + ':img', 0, (a[0] ? 'S2 ' + fmt(a[0]) : 'no S2 / 20d') + ' · ' + (b[0] ? 'S1 ' + fmt(b[0]) : 'no S1 / 20d'),
      'Sentinel-2 (optical): ' + (a.slice(0, 5).map(fmt).join(', ') || 'none') + '<br>Sentinel-1 (radar, sees through cloud): ' + (b.slice(0, 4).map(fmt).join(', ') || 'none'));
  },

  // One SGP4 propagation per time step, look angles computed for every zone
  async poll_pass() {
    if (typeof satellite === 'undefined') throw new Error('satellite.js not loaded');
    let txt = await (await this._get('/.netlify/functions/proxy-celestrak?group=resource&format=tle', 20000)).text();
    if (txt.charAt(0) === '"') { try { txt = JSON.parse(txt); } catch (_) {} } // Electron proxy JSON-wraps text bodies
    const L = txt.split(/\r?\n/).map(s => s.trimEnd()).filter(Boolean);
    const want = /WORLDVIEW|PLEIADES|SKYSAT|SENTINEL-[12]|LANDSAT|SPOT|KOMPSAT|ARIRANG|GAOFEN|JILIN|SUPERVIEW|ICEYE|CAPELLA|UMBRA|LEGION|PNEO|BLACKSKY/i;
    const sats = [];
    // mean motion < 5 rev/day = geostationary / high orbit (e.g. GAOFEN-4) — always "overhead", not a pass
    for (let i = 0; i + 2 < L.length; i++) if (L[i + 1].startsWith('1 ') && L[i + 2].startsWith('2 ')) { if (want.test(L[i]) && parseFloat(L[i + 2].slice(52, 63)) >= 5) sats.push({ name: L[i].trim(), l1: L[i + 1], l2: L[i + 2] }); i += 2; }
    const obs = this.zones.map(z => ({ z, o: { latitude: satellite.degreesToRadians(z.lat), longitude: satellite.degreesToRadians(z.lon), height: z.alt }, passes: [] }));
    const t0 = Date.now(), STEP = 60000, SPAN = 12 * 3600000;
    for (const s of sats) {
      let rec; try { rec = satellite.twoline2satrec(s.l1, s.l2); } catch (_) { continue; }
      obs.forEach(ob => { ob.cur = null; });
      for (let t = t0; t <= t0 + SPAN; t += STEP) {
        const d = new Date(t), pv = satellite.propagate(rec, d);
        if (!pv || !pv.position || typeof pv.position === 'boolean') { obs.forEach(ob => { ob.cur = null; }); continue; }
        const ecf = satellite.eciToEcf(pv.position, satellite.gstime(d));
        obs.forEach(ob => {
          const el = satellite.ecfToLookAngles(ob.o, ecf).elevation * 180 / Math.PI;
          if (el > 0) { if (!ob.cur) ob.cur = { name: s.name, aos: t, max: el, tca: t }; else if (el > ob.cur.max) { ob.cur.max = el; ob.cur.tca = t; } }
          else if (ob.cur) { if (ob.cur.max >= 25) ob.passes.push(ob.cur); ob.cur = null; }
        });
      }
      obs.forEach(ob => { if (ob.cur && ob.cur.max >= 25) ob.passes.push(ob.cur); });
      await new Promise(r => setTimeout(r, 0)); // yield so the globe keeps rendering
    }
    obs.forEach(({ z, passes }) => {
      passes.sort((a, b) => a.tca - b.tca);
      const n = passes[0];
      this._set(z.id + ':pass', 0, n ? `next: ${esc(n.name)} in ${this._in(n.tca)} (${Math.round(n.max)}°) · ${passes.length} passes / 12h` : `no passes ≥25° in 12h (${sats.length} sats tracked)`,
        passes.slice(0, 10).map(p => `${new Date(p.tca).toISOString().slice(11, 16)}Z · ${esc(p.name)} · max ${Math.round(p.max)}°`).join('<br>') + `<br>${sats.length} imaging sats from CelesTrak "resource" group. Elevation ≥25° means the site is inside the satellite's normal imaging reach.`);
    });
  },

  async poll_wx(z) {
    const j = await this._w('meteo', { lat: z.lat, lon: z.lon });
    const c = j.current || {};
    ['cloud_cover', 'visibility', 'wind_speed_10m', 'wind_direction_10m', 'temperature_2m'].forEach(k => { c[k] = +c[k] || 0; });
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], dir = dirs[Math.round((c.wind_direction_10m || 0) / 45) % 8];
    const clear = (j.hourly || []).find(h => h.cc <= 20);
    const cond = c.cloud_cover <= 20 ? 'CLEAR — good optical imaging' : c.cloud_cover <= 60 ? 'PARTLY CLOUDY' : 'OVERCAST — radar (S1) only';
    this._set(z.id + ':wx', 0, `☁ ${c.cloud_cover}% · vis ${Math.round((c.visibility || 0) / 1000)} km · wind ${Math.round(c.wind_speed_10m || 0)} km/h ${dir} · ${Math.round(c.temperature_2m)}°C`,
      `${cond}<br>` + (clear ? `Next clear window (≤20% cloud): ${this._z(clear.t)}` : 'No clear window in the next 24h'));
  },

  _artList(arts) {
    return arts.slice(0, 8).map(a => `<a href="${safeUrl(a.url)}" target="_blank" rel="noopener noreferrer" style="color:#9BA1A8;text-decoration:none">→ ${esc(String(a.title).slice(0, 110))}</a> <span style="color:#5C636B">${esc(a.domain || '')}</span>`).join('<br>');
  },

  async poll_news(z) {
    let arts = [], via = 'GDELT';
    try { const j = await this._gdelt({ q: z.newsQuery, timespan: '24h', max: 25 }); arts = j.articles || []; if (j.rateLimited) throw new Error('rate-limited'); }
    catch (e) {
      // Fallback: operator's GNews key via existing proxy
      const r = await fetch('/.netlify/functions/proxy-gnews?q=' + encodeURIComponent(z.gnewsQuery) + '&max=10', { signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error('GDELT + GNews unavailable');
      const g = await r.json(); via = 'GNews';
      arts = (g.articles || []).map(a => ({ title: a.title, url: a.url, domain: a.source && a.source.name, seen: a.publishedAt }));
    }
    const lvl = arts.length >= 20 ? 1 : 0;
    if (lvl) this._raise('news:' + z.id + ':' + new Date().toISOString().slice(0, 13), 1, `${z.tab}: news spike — ${arts.length}+ articles in 24h`);
    this._set(z.id + ':news', lvl, `${arts.length}${arts.length >= 25 ? '+' : ''} article${arts.length === 1 ? '' : 's'} / 24h` + (arts[0] ? ' · ' + esc(String(arts[0].title).slice(0, 60)) : ''),
      (this._artList(arts) || 'No coverage in the last 24h.') + `<br><span style="color:#5C636B">via ${via}</span>`);
  },

  // Al Jazeera via GDELT's domain filter (open index — no scraping of aljazeera.com)
  async poll_aj() {
    const j = await this._gdelt({ q: AOI_THEATER.ajQuery, domain: 'aljazeera.com', timespan: '24h', max: 15 });
    let arts = j.articles || [], note = '';
    if (j.rateLimited) {
      if (!this.ajLast) throw new Error('GDELT rate-limited — retrying in 15 min');
      arts = this.ajLast.arts; note = ` (GDELT busy — showing ${this._ago(this.ajLast.ts)} old)`;
    } else this.ajLast = { arts, ts: Date.now() };
    const place = /qeshm|hormuz|bandar|natanz|pickaxe|isfahan|fordow/i, act = /strike|attack|explos|blast|missile|drone|hit|bomb/i;
    const hot = arts.filter(a => place.test(a.title || '') && act.test(a.title || ''));
    hot.forEach(a => this._raise('aj:' + a.url, 1, 'Al Jazeera: ' + String(a.title).slice(0, 140)));
    this._set('_:aj', hot.length ? 1 : 0, `${arts.length}${arts.length >= 15 ? '+' : ''} Iran stor${arts.length === 1 ? 'y' : 'ies'} / 24h` + (hot.length ? ` · ${hot.length} on a watched site` : '') + note,
      (this._artList(arts) || 'No Al Jazeera Iran coverage indexed in the last 24h.') + '<br><span style="color:#5C636B">GDELT indexes Al Jazeera with ~15 min lag. Yellow = headline names a watched site plus a strike/attack word.</span>');
  },

  async poll_mkt() {
    const j = await this._w('markets');
    const m = j.markets || [];
    this._set('_:mkt', 0, m[0] ? `${m[0].yes}% · ${esc(String(m[0].title).slice(0, 52))}` : 'no open Iran markets',
      m.map(x => `<a href="${safeUrl('https://polymarket.com/event/' + encodeURIComponent(x.slug))}" target="_blank" rel="noopener noreferrer" style="color:#9BA1A8;text-decoration:none"><b style="color:#E6E8EB">${x.yes != null ? x.yes + '%' : '?'}</b> ${esc(x.question || x.title)}</a>`).join('<br>'));
  },

  // ── panel ─────────────────────────────────────────────────
  _buildPanel() {
    if (!this.panel) {
      const css = document.createElement('style');
      css.textContent = '#aoiWatchPanel{position:fixed;top:calc(110px + var(--bnh,0px));right:calc(var(--rw,360px) + 16px);z-index:56;width:340px;max-height:calc(100vh - 200px);overflow-y:auto;background:rgba(8,12,20,0.96);border:1px solid rgba(218,54,51,0.3);border-radius:4px;font-family:var(--m,monospace);color:#c8ccd6;box-shadow:0 4px 24px rgba(0,0,0,0.5)}'
        + '@media(max-width:767px){#aoiWatchPanel{left:4px;right:4px;width:auto;top:auto;bottom:60px;max-height:45vh}}';
      document.head.appendChild(css);
      const p = document.createElement('div');
      p.id = 'aoiWatchPanel';
      p.addEventListener('click', e => {
        const b = e.target.closest('[data-aoi]'); if (!b) return;
        const act = b.dataset.aoi;
        if (act === 'zoom') this.zoom(); else if (act === 'refresh') this.refresh();
        else if (act === 'min') { this.minimized = !this.minimized; this.render(); }
        else if (act === 'close') { const ly = document.querySelector('.ly[data-layer="aoiwatch"]'); if (ly) ly.click(); }
        else if (act.startsWith('zone:')) { this.sel = act.slice(5); this.render(); }
        else if (act.startsWith('row:')) { const id = act.slice(4); this.open[id] = !this.open[id]; this.render(); }
      });
      document.body.appendChild(p);
      this.panel = p;
    }
    this.panel.style.display = 'block';
  },
  _zoneLvl(zid) { return Math.max(0, ...this.FEEDS.map(f => (this.state[this._key(zid, f)] || {}).lvl).filter(l => l >= 0)); },
  render() {
    if (!this.panel || !this.on) return;
    const LV = { '-2': ['#5C636B', 'LOADING'], '-1': ['#5C636B', 'NO DATA'], 0: ['#3FB950', 'QUIET'], 1: ['#E8B339', 'ACTIVITY'], 2: ['#DA3633', 'ALERT'] };
    const z = this._zone();
    const [tc, tl] = LV[this._zoneLvl(z.id)];
    const btn = (a, t, tip) => `<button data-aoi="${a}" title="${tip}" style="background:none;border:1px solid rgba(255,255,255,0.1);border-radius:2px;color:#9BA1A8;cursor:pointer;font-family:inherit;font-size:8px;padding:2px 6px;letter-spacing:.5px">${t}</button>`;
    let h = `<div style="position:sticky;top:0;background:rgba(8,12,20,0.98);z-index:1"><div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:6px">
      <span style="width:7px;height:7px;border-radius:50%;background:${tc};box-shadow:0 0 6px ${tc}"></span>
      <span style="flex:1;font-size:9.5px;font-weight:700;letter-spacing:1.4px;color:#DA3633">◎ AOI WATCH — ${esc(z.name)}</span>
      <span style="font-size:8px;font-weight:700;color:${tc};border:1px solid ${tc}55;padding:1px 5px;border-radius:2px">${tl}</span>
      ${btn('zoom', '◎', 'Fly to this zone')}${btn('refresh', '↻', 'Refresh all feeds')}${btn('min', this.minimized ? '+' : '–', 'Minimize')}${btn('close', '×', 'Turn off AOI Watch')}</div>
      <div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.06)">${this.zones.map(zz => {
        const [c] = LV[this._zoneLvl(zz.id)], on = zz.id === z.id;
        return `<button data-aoi="zone:${zz.id}" style="flex:1;background:${on ? 'rgba(218,54,51,0.10)' : 'none'};border:none;border-bottom:2px solid ${on ? '#DA3633' : 'transparent'};color:${on ? '#E6E8EB' : '#9BA1A8'};cursor:pointer;font-family:inherit;font-size:8.5px;font-weight:700;letter-spacing:1px;padding:5px 4px;display:flex;align-items:center;justify-content:center;gap:5px"><span style="width:6px;height:6px;border-radius:50%;background:${c}"></span>${esc(zz.tab)}</button>`;
      }).join('')}</div></div>`;
    if (!this.minimized) {
      this.FEEDS.forEach(f => {
        const s = this.state[this._key(z.id, f)] || { lvl: -2, sum: '' }, [c] = LV[s.lvl];
        h += `<div data-aoi="row:${f.id}" style="padding:5px 10px;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;font-size:8.5px;line-height:1.45">
          <div style="display:flex;gap:6px;align-items:baseline"><span style="width:6px;height:6px;border-radius:50%;background:${c};flex:none;transform:translateY(-1px)"></span>
          <span style="color:${c};font-weight:700;letter-spacing:.8px;width:70px;flex:none">${f.label}</span>
          <span style="flex:1;color:#c8ccd6">${s.sum}</span>
          <span style="color:#5C636B;flex:none">${s.ts ? this._ago(s.ts) : ''}</span></div>
          ${this.open[f.id] && s.detail ? `<div style="margin:5px 0 2px 12px;color:#9BA1A8;font-size:8px">${s.detail}<div style="color:#5C636B;margin-top:3px">src: ${esc(f.src)} · every ${Math.round(f.every / 60000)} min${f.scope === 'theater' ? ' · theater-wide, same in every tab' : ''}</div></div>` : ''}</div>`;
      });
      const lat = z.lat, lon = z.lon;
      const links = [
        ['Copernicus', `https://browser.dataspace.copernicus.eu/?zoom=14&lat=${lat}&lng=${lon}`],
        ['Worldview', `https://worldview.earthdata.nasa.gov/?v=${lon - 0.5},${lat - 0.4},${lon + 0.5},${lat + 0.4}`],
        ['Esri Wayback', `https://livingatlas.arcgis.com/wayback/#mapCenter=${lon}%2C${lat}%2C15`],
        ['FIRMS map', `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lon},${lat},10.00z`],
        ['IODA Iran', 'https://ioda.inetintel.cc.gatech.edu/country/IR'],
        ['GPS jam', `https://gpsjam.org/?lat=${lat}&lon=${lon}&z=6`],
        ['adsb.lol', `https://adsb.lol/?lat=${lat}&lon=${lon}&zoom=6`],
        ['Al Jazeera', 'https://www.aljazeera.com/where/iran/'],
        ['Google News', 'https://news.google.com/search?q=' + encodeURIComponent(z.gnewsQuery)]
      ].concat(z.links);
      h += `<div style="padding:7px 10px;display:flex;flex-wrap:wrap;gap:4px">${links.map(([t, u]) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer" style="font-size:8px;color:#4A9EFF;border:1px solid rgba(74,158,255,0.25);border-radius:2px;padding:2px 6px;text-decoration:none">${esc(t)} ↗</a>`).join('')}</div>
        <div style="padding:0 10px 7px;font-size:7px;color:#5C636B;letter-spacing:.5px">Both zones are polled all the time — tabs only switch the view · click a row for detail · polling pauses when the tab is hidden · open data only</div>`;
    }
    this.panel.innerHTML = h;
  }
};
window.AOIZoneWatch = AOIZoneWatch;
