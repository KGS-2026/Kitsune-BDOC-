// ============================================================
// BDOC MODULE: signals.js
// SIGNALS (SIGINT group) — public signals data in one layer and one panel:
//   - HF radio conditions: NOAA radio blackout (R), solar radiation (S), geomagnetic storm (G), now + 3 days
//   - emergency squawks worldwide: aircraft broadcasting 7500 / 7600 / 7700, pinned and alerted
//   - public KiwiSDR shortwave receivers on the globe; LISTEN opens the nearest free one on a chosen frequency
// Created 2026-11-05 (p170). Lazy-loaded on first toggle of layer 'signals'.
// Data: /.netlify/functions/proxy-signals?source=hf|squawk|sdr
// Legal boundary: transponder broadcasts, receivers their owners made public, public-domain NOAA data.
// Nothing here decodes or records private communications.
// Depends on (resolved at call time): V, Cesium, layers, esc, safeUrl, af, EventLog
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

var SIGNALS_CFG = {
  // Well-known public HF channels. Most of the time they are quiet or carry routine traffic.
  presets: [
    { f: 8992,  m: 'usb', name: 'HFGCS 8992 kHz — US Air Force global HF network', note: 'Emergency Action Messages are read on this net' },
    { f: 11175, m: 'usb', name: 'HFGCS 11175 kHz — US Air Force global HF network', note: 'The other main HFGCS channel' },
    { f: 4625,  m: 'usb', name: '"The Buzzer" 4625 kHz — Russian military (UVB-76)', note: 'A steady buzz, with rare voice messages' },
    { f: 5505,  m: 'usb', name: 'Shannon VOLMET 5505 kHz — aviation weather', note: 'Weather for European airports, read in a loop' },
    { f: 6604,  m: 'usb', name: 'New York VOLMET 6604 kHz — aviation weather', note: 'Weather for North American airports' },
    { f: 10000, m: 'am',  name: 'WWV / WWVH 10000 kHz — time signal', note: 'A good test: audible on most receivers' }
  ],
  squawkMs: 60000,
  hfMs: 600000,
  sdrMaxAgeMs: 21600000,
  storeKey: 'bdoc.signals.v1'
};

var SignalsWatch = {
  on: false, panel: null, timers: [], ents: { sq: [], sdr: [] }, sq: [], sdr: [], sdrAt: 0, hf: null,
  alerted: new Map(), preset: 0, minimized: false, pos: null, sqAt: '', sqErr: '', _gen: 0,

  // ── lifecycle ─────────────────────────────────────────────
  start() {
    if (!V || this.on) return;
    this.on = true;
    this._restore();
    this._buildPanel();
    const gen = ++this._gen;
    this.loadHf(); this.loadSquawks(); this.loadSdr();
    this.timers.push(setInterval(() => { if (!document.hidden && gen === this._gen) this.loadSquawks(); }, SIGNALS_CFG.squawkMs));
    this.timers.push(setInterval(() => { if (!document.hidden && gen === this._gen) this.loadHf(); }, SIGNALS_CFG.hfMs));
    EventLog.add('info', 'Signals layer armed');
  },
  stop() {
    this.on = false; this._gen++;
    this.timers.forEach(clearInterval); this.timers = [];
    Object.keys(this.ents).forEach(k => this._clear(k));
    if (this.panel) this.panel.style.display = 'none';
    this._kick();
  },
  _kick() { try { if (window.BDOCRender) window.BDOCRender.kick(); else if (V) V.scene.requestRender(); } catch (_) {} },
  async _j(source) {
    const r = await fetch('/.netlify/functions/proxy-signals?source=' + source, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) { let m = 'HTTP ' + r.status; try { m = (await r.json()).error || m; } catch (_) {} throw new Error(m); }
    return r.json();
  },

  // ── data ──────────────────────────────────────────────────
  async loadHf() {
    try { this.hf = await this._j('hf'); } catch (e) { this.hf = { error: e.message }; }
    if (this.on) this._renderHf();
  },
  async loadSquawks() {
    const gen = this._gen;
    try { const j = await this._j('squawk'); if (gen !== this._gen) return; this.sq = j.aircraft || []; this.sqErr = ''; this.sqAt = j.fetched || new Date().toISOString(); }
    catch (e) { if (gen !== this._gen) return; this.sqErr = e.message; }
    if (!this.on) return;
    this._alertNew();
    this._drawSquawks();
    this._renderSquawks();
  },
  async loadSdr() {
    const gen = this._gen;
    if (!this.sdr.length || Date.now() - this.sdrAt > SIGNALS_CFG.sdrMaxAgeMs) {
      try { const j = await this._j('sdr'); if (gen !== this._gen) return; this.sdr = j.receivers || []; this.sdrAt = Date.now(); this.sdrErr = ''; }
      catch (e) { if (gen !== this._gen) return; this.sdrErr = e.message; }
    }
    if (!this.on) return;
    this._drawSdr();
    this._renderListen();
  },

  // ── squawk alerts ─────────────────────────────────────────
  _label(a) { return a.flight || a.reg || a.hex.toUpperCase(); },
  _alt(a) { return a.alt === 'ground' ? 'on the ground' : typeof a.alt === 'number' ? (a.alt >= 18000 ? 'FL' + Math.round(a.alt / 100) : a.alt.toLocaleString() + ' ft') : 'altitude unknown'; },
  _alertNew() {
    const now = Date.now();
    for (const [k, t] of this.alerted) if (now - t > 7200000) this.alerted.delete(k); // forget after 2 h
    this.sq.forEach(a => {
      const k = a.hex + ':' + a.squawk;
      if (this.alerted.has(k)) return;
      this.alerted.set(k, now);
      const col = a.squawk === '7600' ? '#ff6600' : '#DA3633';
      // af() renders into innerHTML without escaping, and callsigns come from a third-party feed
      af(col, esc(`SQUAWK ${a.squawk} ${a.meaning.toUpperCase()}: ${this._label(a)}${a.type ? ' (' + a.type + ')' : ''} · ${this._alt(a)} · ${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}`));
      EventLog.add('warn', `Squawk ${a.squawk} (${a.meaning}): ${this._label(a)} ${a.type || ''} at ${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}`);
    });
  },

  // ── globe ─────────────────────────────────────────────────
  _clear(k) { (this.ents[k] || []).forEach(e => V.entities.remove(e)); this.ents[k] = []; },
  _planeIcon(col) {
    return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><circle cx="13" cy="13" r="12" fill="#14060a" stroke="${col}" stroke-width="2"/><path d="M13 4l2 7 6 3v2l-6-1.5-.5 4 2 1.5v1.5l-3.5-1-3.5 1V20l2-1.5-.5-4L5 16v-2l6-3z" fill="${col}"/></svg>`);
  },
  _radioIcon() {
    return 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#06121a" stroke="#00ccff" stroke-width="1.3"/><path d="M5 11V7.5h6V11z M6 6.5l4-2" stroke="#00ccff" stroke-width="1.2" fill="none"/></svg>');
  },
  _drawSquawks() {
    this._clear('sq');
    this.sq.forEach(a => {
      const col = a.squawk === '7600' ? '#ff6600' : '#DA3633';
      const h = typeof a.alt === 'number' ? a.alt * 0.3048 : 0;
      const ent = V.entities.add({
        id: 'signals-sq-' + a.hex,
        name: `Squawk ${a.squawk} — ${this._label(a)}`,
        position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, h),
        billboard: { image: this._planeIcon(col), width: 26, height: 26, verticalOrigin: Cesium.VerticalOrigin.CENTER, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: `${a.squawk} ${this._label(a)}`, font: 'bold 10px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString(col), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -20), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        description: `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:360px;background:#0a0e14;padding:12px;border-radius:2px;border:1px solid ${col}55;color:#c8ccd6">
          <div style="color:${col};font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:6px">✈ SQUAWK ${esc(a.squawk)} — ${esc(a.meaning.toUpperCase())}</div>
          <table style="width:100%;font-size:10px;border-collapse:collapse">
            <tr><td style="color:#5C636B;padding:2px 0">Callsign</td><td>${esc(a.flight || '—')}</td></tr>
            <tr><td style="color:#5C636B;padding:2px 0">Registration</td><td>${esc(a.reg || '—')}</td></tr>
            <tr><td style="color:#5C636B;padding:2px 0">Aircraft</td><td>${esc([a.type, a.desc].filter(Boolean).join(' · ') || '—')}</td></tr>
            <tr><td style="color:#5C636B;padding:2px 0">Altitude</td><td>${esc(this._alt(a))}${typeof a.gs === 'number' ? ' · ' + Math.round(a.gs) + ' kt' : ''}</td></tr>
            <tr><td style="color:#5C636B;padding:2px 0">ICAO hex</td><td>${esc(a.hex.toUpperCase())}</td></tr>
            ${a.emergency && a.emergency !== 'none' ? `<tr><td style="color:#5C636B;padding:2px 0">ADS-B status</td><td>${esc(a.emergency)}</td></tr>` : ''}
          </table>
          <div style="color:#E8B339;font-size:9px;margin-top:6px">Crews sometimes set these codes by mistake. Treat it as a lead and watch the track.</div>
          <a href="${safeUrl('https://globe.adsb.lol/?icao=' + a.hex)}" target="_blank" rel="noopener noreferrer" style="display:block;margin-top:8px;padding:6px;border:1px solid ${col}55;color:${col};text-decoration:none;font-size:10px;text-align:center">Live track on adsb.lol ↗</a>
          <div style="margin-top:8px;font-size:7px;color:#1e2436;letter-spacing:1px;text-align:right">KITSUNE BDOC — SIGNALS</div></div>`,
        show: !!layers.signals
      });
      this.ents.sq.push(ent);
    });
    this._kick();
  },
  _inBand(r, p) { return p.f >= r.lo && p.f <= r.hi; },
  _khz(k) { return k < 1000 ? k + ' kHz' : +(k / 1000).toFixed(1) + ' MHz'; },
  // most owners already put the place in the receiver name; only add it when they did not
  _where(r) { return r.loc && !String(r.name || '').toLowerCase().includes(String(r.loc).toLowerCase()) ? r.loc : ''; },
  _tuneUrl(r, p) { return `${r.url}/?f=${p.f}${p.m}`; },
  _drawSdr() {
    this._clear('sdr');
    const icon = this._radioIcon();
    this.sdr.forEach(r => {
      const tunes = SIGNALS_CFG.presets.filter(p => this._inBand(r, p)).map(p =>
        `<a href="${safeUrl(this._tuneUrl(r, p))}" target="_blank" rel="noopener noreferrer" style="display:block;padding:3px 0;color:#00ccff;text-decoration:none;font-size:9.5px">▸ ${esc(p.name)}</a>`).join('');
      this.ents.sdr.push(V.entities.add({
        name: String(r.name || 'KiwiSDR receiver').slice(0, 80),
        position: Cesium.Cartesian3.fromDegrees(r.lon, r.lat),
        billboard: { image: icon, width: 14, height: 14, verticalOrigin: Cesium.VerticalOrigin.CENTER, scaleByDistance: new Cesium.NearFarScalar(2e5, 1.3, 1.2e7, 0.55), disableDepthTestDistance: 5e6 },
        description: `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:380px;background:#0a0e14;padding:12px;border-radius:2px;border:1px solid #00ccff33;color:#c8ccd6">
          <div style="color:#00ccff;font-size:12px;font-weight:700;margin-bottom:6px">📻 ${esc(r.name || 'KiwiSDR receiver')}</div>
          <div style="color:#7a8194;font-size:10px;line-height:1.6">${this._where(r) ? esc(this._where(r)) + '<br>' : ''}${r.antenna ? 'Antenna: ' + esc(r.antenna) + '<br>' : ''}
          Covers ${this._khz(r.lo)} – ${this._khz(r.hi)} · ${r.users}/${r.max} listening${typeof r.snr === 'number' ? ' · SNR ' + r.snr + ' dB' : ''}</div>
          <a href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer" style="display:block;margin-top:10px;padding:7px;background:#06202a;color:#00ccff;border:1px solid #00ccff44;border-radius:2px;text-decoration:none;font-size:10px;letter-spacing:1px;font-weight:600;text-align:center">▸ OPEN THIS RECEIVER</a>
          ${tunes ? `<div style="margin-top:8px;font-size:9px;color:#5C636B">Tune straight to:</div>${tunes}` : ''}
          <div style="margin-top:8px;font-size:8.5px;color:#5C636B">A public shortwave receiver run by its owner. Listening is free: use one tab and close it when you are done, so others get a slot.</div></div>`,
        show: !!layers.signals
      }));
    });
    this._kick();
  },

  // ── listen: nearest free receiver to the middle of the view ──
  _viewCenter() {
    try {
      const c = V.scene.canvas, p = V.camera.pickEllipsoid(new Cesium.Cartesian2(c.clientWidth / 2, c.clientHeight / 2), V.scene.globe.ellipsoid);
      const g = p ? Cesium.Cartographic.fromCartesian(p) : V.camera.positionCartographic;
      return { lat: Cesium.Math.toDegrees(g.latitude), lon: Cesium.Math.toDegrees(g.longitude) };
    } catch (_) { return { lat: 0, lon: 0 }; }
  },
  _km(a, b) {
    const R = 6371, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  },
  nearest(p, at) {
    return this.sdr.filter(r => this._inBand(r, p) && r.users < r.max)
      .map(r => ({ r, km: this._km(at, r) })).sort((x, y) => x.km - y.km)[0] || null;
  },
  listen() {
    const p = SIGNALS_CFG.presets[this.preset] || SIGNALS_CFG.presets[0], at = this._viewCenter(), n = this.nearest(p, at);
    const out = this.panel.querySelector('.sg-ln');
    if (!n) { out.textContent = this.sdr.length ? 'No receiver covering this frequency has a free slot right now.' : 'Receivers are still loading.'; return; }
    out.innerHTML = `Opened <b>${esc(n.r.name.slice(0, 60))}</b>${this._where(n.r) ? ' — ' + esc(this._where(n.r)) : ''} (${Math.round(n.km).toLocaleString()} km from the middle of the view). ${esc(p.note)}.`;
    window.open(this._tuneUrl(n.r, p), '_blank', 'noopener');
  },

  // ── panel ─────────────────────────────────────────────────
  _restore() {
    let s = null; try { s = JSON.parse(localStorage.getItem(SIGNALS_CFG.storeKey) || 'null'); } catch (_) {}
    this.preset = s && Number.isInteger(s.preset) && s.preset >= 0 && s.preset < SIGNALS_CFG.presets.length ? s.preset : 0;
    this.minimized = !!(s && s.minimized === true);
    this.pos = s && s.pos && isFinite(s.pos.x) && isFinite(s.pos.y) ? s.pos : null;
  },
  _save() { try { localStorage.setItem(SIGNALS_CFG.storeKey, JSON.stringify({ preset: this.preset, minimized: this.minimized, pos: this.pos })); } catch (_) {} },
  _buildPanel() {
    if (!this.panel) {
      const css = document.createElement('style');
      css.textContent = '#signalsPanel{position:fixed;right:calc(var(--rw,360px) + 16px);bottom:70px;z-index:56;width:320px;max-height:calc(100vh - 190px);overflow-y:auto;background:rgba(8,12,20,0.97);border:1px solid rgba(0,204,255,0.3);border-radius:4px;font-family:var(--m,monospace);color:#c8ccd6;box-shadow:0 4px 24px rgba(0,0,0,0.55)}'
        + '#signalsPanel .sg-hd{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:move;user-select:none;position:sticky;top:0;background:rgba(8,12,20,0.98)}'
        + '#signalsPanel.sg-min .sg-body{display:none}'
        + '#signalsPanel button{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:2px;color:#9BA1A8;cursor:pointer;font-family:inherit;font-size:8px;padding:2px 6px;flex:none}'
        + '#signalsPanel .sg-sec{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.05)}'
        + '#signalsPanel .sg-h{font-size:8px;letter-spacing:1.2px;color:#00ccff;font-weight:700;margin-bottom:6px;display:flex;justify-content:space-between}'
        + '#signalsPanel .sg-k{display:flex;gap:8px;align-items:baseline;font-size:9.5px;line-height:1.45;margin:3px 0}#signalsPanel .sg-k b{flex:0 0 26px;font-size:12px}'
        + '#signalsPanel .sg-o{font-size:8.5px;color:#7a8194;line-height:1.6;margin-top:4px}'
        + '#signalsPanel .sg-row{display:flex;width:100%;gap:6px;align-items:center;text-align:left;font-size:9px;padding:4px 6px;margin:2px 0;color:#c8ccd6}'
        + '#signalsPanel .sg-bd{flex:none;padding:1px 4px;border-radius:2px;color:#000;font-weight:700;font-size:8.5px}'
        + '#signalsPanel select{width:100%;background:#0a0e14;color:#c8ccd6;border:1px solid rgba(255,255,255,0.12);border-radius:2px;font-family:inherit;font-size:9px;padding:3px;margin-bottom:5px}'
        + '#signalsPanel .sg-go{width:100%;padding:6px;color:#00ccff;border-color:#00ccff55;font-size:9px;letter-spacing:1px;font-weight:700}'
        + '#signalsPanel .sg-ln,#signalsPanel .sg-note{font-size:8.5px;color:#7a8194;line-height:1.5;margin-top:5px}'
        + '#signalsPanel .sg-ft{padding:6px 10px 8px;font-size:7.5px;color:#5C636B;line-height:1.5}'
        + '#signalsPanel.sg-drag{opacity:.92}'
        + '@media(max-width:767px){#signalsPanel{left:4px;right:4px;width:auto;top:calc(56px + var(--bnh,0px));bottom:auto;max-height:55vh}#signalsPanel .sg-hd{cursor:default}}';
      document.head.appendChild(css);
      const p = document.createElement('div');
      p.id = 'signalsPanel';
      p.innerHTML = `<div class="sg-hd"><span style="width:7px;height:7px;border-radius:50%;background:#00ccff;box-shadow:0 0 6px #00ccff"></span>
          <span style="flex:1;font-size:9.5px;font-weight:700;letter-spacing:1.4px;color:#00ccff">📡 SIGNALS</span>
          <button data-sg="min" title="Minimize"></button><button data-sg="close" title="Turn off Signals">×</button></div>
        <div class="sg-body">
          <div class="sg-sec"><div class="sg-h"><span>HF RADIO CONDITIONS</span><span class="sg-hft" style="color:#5C636B;font-weight:400"></span></div><div class="sg-hf">Loading NOAA scales…</div></div>
          <div class="sg-sec"><div class="sg-h"><span>EMERGENCY SQUAWKS · WORLDWIDE</span><span class="sg-sqn"></span></div><div class="sg-sq">Checking…</div>
            <div class="sg-note">7500 hijack · 7600 radio failure · 7700 emergency. Crews sometimes set these by mistake: treat each one as a lead.</div></div>
          <div class="sg-sec"><div class="sg-h"><span>LISTEN · PUBLIC SHORTWAVE RECEIVERS</span><span class="sg-rn"></span></div>
            <select data-sg="preset" aria-label="Frequency">${SIGNALS_CFG.presets.map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join('')}</select>
            <button class="sg-go" data-sg="listen">▸ OPEN THE NEAREST FREE RECEIVER</button>
            <div class="sg-ln">Opens the closest receiver to the middle of the view that covers the frequency and has a free slot, in a new tab.</div></div>
          <div class="sg-ft">NOAA SWPC (public domain) · aircraft from adsb.lol (ODbL) and adsb.fi · receivers from the kiwisdr.com public list via rx.linkfanel.net · only public broadcasts and receivers their owners share; nothing private is decoded.</div>
        </div>`;
      p.addEventListener('click', e => {
        const b = e.target.closest('[data-sg]'); if (!b || b.tagName === 'SELECT') return;
        const act = b.dataset.sg;
        if (act === 'min') { this.minimized = !this.minimized; this._save(); this._applyMin(); }
        else if (act === 'close') { const ly = document.querySelector('.ly[data-layer="signals"]'); if (ly) ly.click(); }
        else if (act === 'listen') this.listen();
        else if (act.startsWith('sq:')) this._flyTo(act.slice(3));
      });
      p.addEventListener('change', e => {
        if (e.target.dataset.sg === 'preset') { this.preset = +e.target.value || 0; this._save(); this.panel.querySelector('.sg-ln').textContent = SIGNALS_CFG.presets[this.preset].note + '.'; }
      });
      this._drag(p);
      document.body.appendChild(p);
      this.panel = p;
    }
    this.panel.style.display = 'block';
    this.panel.querySelector('[data-sg="preset"]').value = String(this.preset);
    this._placeSaved();
    this._applyMin();
    this._renderHf(); this._renderSquawks(); this._renderListen();
  },
  _applyMin() {
    this.panel.classList.toggle('sg-min', this.minimized);
    this.panel.querySelector('[data-sg="min"]').textContent = this.minimized ? '+' : '–';
  },
  _flyTo(hex) {
    const a = this.sq.find(x => x.hex === hex); if (!a) return;
    const ent = this.ents.sq.find(e => e.id === 'signals-sq-' + hex);
    try {
      V.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 600000), duration: 1.4 });
      if (ent) V.selectedEntity = ent;
    } catch (_) {}
  },
  _lvl(n) { return n == null ? '#5C636B' : n >= 3 ? '#DA3633' : n >= 1 ? '#E8B339' : '#3FB950'; },
  _renderHf() {
    if (!this.panel) return;
    const box = this.panel.querySelector('.sg-hf'), h = this.hf;
    if (!h) return;
    if (h.error) { box.innerHTML = `<div class="sg-o" style="color:#E8B339">NOAA scales unavailable (${esc(h.error)}).</div>`; return; }
    const n = h.now || {};
    const R = n.r ? `HF radio degraded or lost on the sunlit side of Earth (${esc(n.rText || 'R' + n.r)})` : 'No radio blackout: HF is normal on the day side';
    const S = n.s ? `Solar radiation storm: HF blackout over the poles (S${n.s})` : 'No solar radiation storm';
    const G = n.g ? `Geomagnetic storm (${esc(n.gText || 'G' + n.g)}): HF unreliable at high latitudes, GPS accuracy can drop` : 'No geomagnetic storm';
    const day = d => `${esc(String(d.date).slice(5))}: R1–2 ${d.rMinor == null ? '?' : d.rMinor + '%'} · R3+ ${d.rMajor == null ? '?' : d.rMajor + '%'} · S1+ ${d.sProb == null ? '?' : d.sProb + '%'} · ${d.g ? 'G' + d.g : 'G0'}`;
    box.innerHTML = `<div class="sg-k"><b style="color:${this._lvl(n.r)}">R${n.r == null ? '?' : n.r}</b><span>${R}</span></div>`
      + `<div class="sg-k"><b style="color:${this._lvl(n.s)}">S${n.s == null ? '?' : n.s}</b><span>${S}</span></div>`
      + `<div class="sg-k"><b style="color:${this._lvl(n.g)}">G${n.g == null ? '?' : n.g}</b><span>${G}</span></div>`
      + `<div class="sg-o">Outlook (NOAA): ${(h.outlook || []).map(day).join('<br>')}</div>`;
    this.panel.querySelector('.sg-hft').textContent = n.date ? `${n.date.slice(5)} ${String(n.time || '').slice(0, 5)}Z` : '';
  },
  _renderSquawks() {
    if (!this.panel) return;
    const box = this.panel.querySelector('.sg-sq'), at = this.sqAt ? String(this.sqAt).slice(11, 19) + 'Z' : '';
    this.panel.querySelector('.sg-sqn').textContent = this.sq.length ? this.sq.length + ' NOW' : '';
    this.panel.querySelector('.sg-sqn').style.color = this.sq.length ? '#DA3633' : '';
    if (this.sqErr && !this.sq.length) { box.innerHTML = `<div class="sg-o" style="color:#E8B339">Squawk feed unavailable (${esc(this.sqErr)}). Retrying every minute.</div>`; return; }
    if (!this.sq.length) { box.innerHTML = `<div class="sg-o">None right now${at ? ' · checked ' + at : ''}.</div>`; return; }
    box.innerHTML = this.sq.map(a => {
      const col = a.squawk === '7600' ? '#ff6600' : '#DA3633';
      return `<button class="sg-row" data-sg="sq:${esc(a.hex)}" title="Fly to this aircraft"><span class="sg-bd" style="background:${col}">${esc(a.squawk)}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(this._label(a))}${a.type ? ' · ' + esc(a.type) : ''} · ${esc(this._alt(a))}</span></button>`;
    }).join('') + `<div class="sg-o">Checked ${at} · refreshes every minute.</div>`;
  },
  _renderListen() {
    if (!this.panel) return;
    this.panel.querySelector('.sg-rn').textContent = this.sdr.length ? this.sdr.length + ' ON GLOBE' : (this.sdrErr ? 'UNAVAILABLE' : '');
    if (this.sdrErr && !this.sdr.length) this.panel.querySelector('.sg-ln').textContent = 'Receiver list unavailable (' + this.sdrErr + ').';
  },
  _placeSaved() {
    if (!this.pos || innerWidth <= 767) return;
    const x = Math.min(Math.max(0, this.pos.x), innerWidth - 120), y = Math.min(Math.max(0, this.pos.y), innerHeight - 40);
    Object.assign(this.panel.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
  },
  _drag(p) {
    let sx, sy, ox, oy, on = false;
    p.addEventListener('pointerdown', e => {
      if (innerWidth <= 767 || !e.target.closest('.sg-hd') || e.target.closest('button,select')) return;
      const r = p.getBoundingClientRect(); on = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      p.classList.add('sg-drag'); p.setPointerCapture(e.pointerId);
    });
    p.addEventListener('pointermove', e => {
      if (!on) return;
      const x = Math.min(Math.max(0, ox + e.clientX - sx), innerWidth - 120), y = Math.min(Math.max(0, oy + e.clientY - sy), innerHeight - 40);
      Object.assign(p.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    });
    const end = () => { if (!on) return; on = false; p.classList.remove('sg-drag'); const r = p.getBoundingClientRect(); this.pos = { x: Math.round(r.left), y: Math.round(r.top) }; this._save(); };
    p.addEventListener('pointerup', end); p.addEventListener('pointercancel', end);
  }
};
window.SignalsWatch = SignalsWatch;
