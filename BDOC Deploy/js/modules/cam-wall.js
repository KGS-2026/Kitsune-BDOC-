// ============================================================
// BDOC MODULE: cam-wall.js
// CAM WALL — Middle East live video wall (2×2 tiles) + city and Windy webcam pins on the globe.
// Created 2026-11-03. Lazy-loaded on first toggle of layer 'camwall' (CONFLICTS group).
// Sources (official embeddable players only — no restreams, no private / unsecured cameras):
//   /.netlify/functions/proxy-mecams?source=yt&city=…   YouTube Data API live search (needs YOUTUBE_API_KEY)
//   /.netlify/functions/proxy-mecams?source=windy       Windy Webcams API v3 (needs WINDY_API_KEY)
//   youtube.com/embed/live_stream?channel=…             24/7 news channels — no key needed
// Depends on (resolved at call time): V, Cesium, layers, esc, safeUrl, af, EventLog
// p168p: ported to main from the stale OneDrive copy (built there 2026-11-03). Changes for main:
//   - proxy renamed proxy-cams → proxy-mecams: main's proxy-cams is the p159g US traffic-cam index.
//   - popup buttons: main has no InfoBoxActions registry, so this module listens on the InfoBox frame
//     document itself (data-cw-act). Works with main's allow-scripts sandbox and keeps working if
//     allow-scripts is ever removed (HANDOFF §2 N #18).
//   - one-shot BDOCRender.kick() after pin updates (main renders on demand).
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

var CAM_WALL = {
  // fallbacks: channels shown when a city has no live search results — first playable one wins
  cities: [
    { id: 'telaviv',   name: 'Tel Aviv',  lat: 32.08, lon: 34.78, fallbacks: ['aje'] },
    { id: 'jerusalem', name: 'Jerusalem', lat: 31.78, lon: 35.22, fallbacks: ['aja', 'alarabiya'] },
    { id: 'haifa',     name: 'Haifa',     lat: 32.80, lon: 34.99, fallbacks: ['trt'] },
    { id: 'amman',     name: 'Amman',     lat: 31.95, lon: 35.93, fallbacks: ['roya', 'mamlaka'] },
    { id: 'tehran',    name: 'Tehran',    lat: 35.70, lon: 51.39, fallbacks: ['iranintl', 'skyar'] }
  ],
  // embed/live_stream?channel= plays whatever the channel has live right now — no key needed.
  // IDs, live status and embedding verified 2026-11-03. event: true = goes live mainly during major events.
  // resolve: true = YouTube's channel embed shows "This video is unavailable" for this channel (verified 2026-11-03);
  //   proxy-mecams source=ytch looks up the live video id instead, which needs YOUTUBE_API_KEY.
  channels: [
    { id: 'aje',       name: 'Al Jazeera English',        ch: 'UCNye-wNBqNL5ZzHSJj3l8Bg' },
    { id: 'aja',       name: 'Al Jazeera Arabic',         ch: 'UCfiwzLy-8yKzIbsmZTzxDgw', resolve: true },
    { id: 'alarabiya', name: 'Al Arabiya',                ch: 'UCahpxixMCwoANAftn6IxkTg' },
    { id: 'skyar',     name: 'Sky News Arabia',           ch: 'UCIJXOvggjKtCagMfxvcCzAA' },
    { id: 'trt',       name: 'TRT World',                 ch: 'UC7fWeaHhqgM4Ry-RMpM2YYw' },
    { id: 'roya',      name: 'Roya News (Jordan)',        ch: 'UCsDQbVxQjBuFOa98vxRlbVQ' },
    { id: 'mamlaka',   name: 'Al Mamlaka (Jordan)',       ch: 'UC0jiFAzTgl17k7awGbuoYew' },
    { id: 'iranintl',  name: 'Iran International (Persian)', ch: 'UCat6bC0Wrqq9Bcq7EkH_yQw', resolve: true },
    { id: 'i24',       name: 'i24NEWS English',           ch: 'UCvHDpsWKADrDia0c99X37vg', event: true },
    { id: 'kan11',     name: 'Kan 11 (Israel)',           ch: 'UCKqFqiCe1dCUxRe0_YNZ6gg', event: true },
    { id: 'n12',       name: 'N12 (Israel)',              ch: 'UCZH1ZFHSLSZEh_Ek2L-vrgA', event: true }
  ],
  defaults: ['city:telaviv', 'city:jerusalem', 'city:amman', 'city:tehran'],
  storeKey: 'bdoc.camwall.v1'
};

var CamWall = {
  on: false, panel: null, timers: [], ents: { windy: [], cities: [] }, live: {}, chLive: {}, keys: null, windy: [],
  tiles: [], focus: 0, layout: 4, minimized: false, pos: null,

  // ── lifecycle ─────────────────────────────────────────────
  start() {
    if (!V || this.on) return;
    this.on = true;
    this._restore();
    this._buildPanel();
    this._bindInfoBox();
    this._boot();
  },
  // Popup buttons carry data-cw-act="city"/"windy". One click listener on the InfoBox frame document
  // (same origin) runs them in this window, so no inline onclick is needed inside entity descriptions.
  _bindInfoBox() {
    const bind = () => {
      try {
        const doc = V.infoBox && V.infoBox.frame && V.infoBox.frame.contentDocument;
        if (!doc || doc.__bdocCamWall) return;
        doc.__bdocCamWall = true;
        doc.addEventListener('click', e => {
          const b = e.target && e.target.closest && e.target.closest('[data-cw-act]');
          if (!b || !this.on) return;
          e.preventDefault();
          if (b.dataset.cwAct === 'city') this.playCity(b.dataset.city, +b.dataset.k || 0);
          else if (b.dataset.cwAct === 'windy') this.playWindy(b.dataset.id);
        });
      } catch (_) {}
    };
    bind();
    // the frame document can be replaced (main reloads it once to change the sandbox), so re-check on use
    if (!this._unSel && V.selectedEntityChanged) this._unSel = V.selectedEntityChanged.addEventListener(() => setTimeout(bind, 0));
    if (!this._frameLoad && V.infoBox && V.infoBox.frame) { this._frameLoad = true; V.infoBox.frame.addEventListener('load', bind); }
  },
  _kick() { try { if (window.BDOCRender) window.BDOCRender.kick(); else if (V) V.scene.requestRender(); } catch (_) {} },
  async _boot() {
    try { this.keys = await this._j('status'); } catch (_) { this.keys = { youtube: false, windy: false }; }
    if (!this.on) return;
    await this.refreshCities();
    if (!this.on) return;
    this.tiles.forEach((_, i) => this._loadTile(i));
    await this.loadWindy();
    if (!this.on) return;
    this.timers.push(setInterval(() => { if (!document.hidden) this.refreshCities(); }, 1800000));
    this.timers.push(setInterval(() => { if (!document.hidden) this.loadWindy(); }, 540000)); // Windy image tokens expire after 10 min
    const n = Object.values(this.live).reduce((a, l) => a + ((l && l.videos) || []).length, 0);
    af('#00ccaa', `CAM WALL: ${this.keys.youtube ? n + ' live city streams' : 'YouTube search off'} · ${this.keys.windy ? this.windy.length + ' Windy webcams' : 'Windy off'} · ${CAM_WALL.channels.length} news channels`);
    EventLog.add('info', 'Cam Wall armed');
  },
  stop() {
    this.on = false;
    this.timers.forEach(clearInterval); this.timers = [];
    if (this.panel) { this.panel.querySelectorAll('iframe').forEach(f => { f.src = 'about:blank'; f.dataset.url = ''; }); this.panel.style.display = 'none'; }
    Object.keys(this.ents).forEach(k => this._clear(k));
    if (this._unSel) { this._unSel(); this._unSel = null; }
    this._kick();
  },

  // ── data ──────────────────────────────────────────────────
  async _j(source, params) {
    const qs = new URLSearchParams(Object.assign({ source }, params || {}));
    const r = await fetch('/.netlify/functions/proxy-mecams?' + qs.toString(), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  },
  async refreshCities() {
    if (!this.keys || !this.keys.youtube) CAM_WALL.cities.forEach(c => { this.live[c.id] = { configured: false, videos: [] }; });
    else await Promise.all(CAM_WALL.cities.map(c => this._j('yt', { city: c.id })
      .then(j => { this.live[c.id] = j; })
      .catch(e => { this.live[c.id] = { configured: true, videos: [], error: e.message }; }))
      .concat(CAM_WALL.channels.filter(c => c.resolve).map(c => this._j('ytch', { ch: c.id })
        .then(j => { this.chLive[c.id] = j; })
        .catch(e => { this.chLive[c.id] = { configured: true, videos: [], error: e.message }; }))));
    if (!this.on) return;
    this.tiles.forEach((_, i) => this._loadTile(i));
    this._renderSelects();
    this._drawCities();
    this._renderFoot();
  },
  async loadWindy() {
    if (!this.keys || !this.keys.windy) { this.windy = []; this._renderFoot(); return; }
    try { const j = await this._j('windy'); this.windy = j.webcams || []; }
    catch (e) { console.warn('[Cam Wall windy]', e); }
    if (!this.on) return;
    this._drawWindy();
    this._renderFoot();
  },

  // ── tile resolution ───────────────────────────────────────
  _city(id) { return CAM_WALL.cities.find(c => c.id === id); },
  _chan(id) { return CAM_WALL.channels.find(c => c.id === id) || CAM_WALL.channels[0]; },
  _vidEmbed(id) { return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0`; },
  // How to play a channel right now: resolved live video id → channel live embed → null (needs the YouTube key)
  _chPlay(c) {
    const v = ((this.chLive[c.id] || {}).videos || []).find(x => /^[A-Za-z0-9_-]{11}$/.test(x.id));
    if (v) return { url: this._vidEmbed(v.id), pop: 'https://www.youtube.com/watch?v=' + v.id };
    if (!c.resolve) return { url: `https://www.youtube.com/embed/live_stream?channel=${c.ch}&autoplay=1&mute=1&playsinline=1`, pop: `https://www.youtube.com/channel/${c.ch}/live` };
    return null;
  },
  _resolve(i) {
    const t = this.tiles[i];
    if (t.src.startsWith('city:')) {
      const c = this._city(t.src.slice(5)) || CAM_WALL.cities[0], L = this.live[c.id];
      const vids = ((L && L.videos) || []).filter(v => /^[A-Za-z0-9_-]{11}$/.test(v.id));
      if (vids.length) {
        const k = ((t.idx % vids.length) + vids.length) % vids.length, v = vids[k];
        return { url: this._vidEmbed(v.id), pop: 'https://www.youtube.com/watch?v=' + v.id,
          cap: `${c.name.toUpperCase()} ${k + 1}/${vids.length} · ${v.title} — ${v.channel}`, nav: vids.length > 1 };
      }
      const why = !L ? 'searching…' : !L.configured ? 'YouTube search off (add YOUTUBE_API_KEY)' : L.error ? (/quota/i.test(L.error) ? 'YouTube quota used up for today' : 'YouTube search failed') : `no live ${c.name} streams right now`;
      for (const id of c.fallbacks) {
        const fb = this._chan(id), pl = this._chPlay(fb);
        if (pl) return { url: pl.url, pop: pl.pop, cap: `${c.name.toUpperCase()}: ${why} — showing ${fb.name}`, nav: false, warn: true };
      }
      return { url: '', pop: '', cap: `${c.name.toUpperCase()}: ${why}`, msg: why, nav: false, warn: true };
    }
    if (t.src.startsWith('windy:')) {
      const w = this.windy.find(x => 'windy:' + x.id === t.src) || t.w;
      const url = w && (w.live || w.player);
      if (url && /^https:\/\/([a-z0-9-]+\.)*windy\.com\//i.test(url)) {
        return { url, pop: w.detail || url, cap: `WINDY${w.live ? ' LIVE' : ' TIMELAPSE'} · ${w.title} · ${[w.city, w.country].filter(Boolean).join(', ')}`, nav: false };
      }
      t.src = 'ch:aje';
    }
    const c = this._chan(t.src.slice(3)), pl = this._chPlay(c);
    if (!pl) {
      const r = this.chLive[c.id], why = !this.keys || !this.keys.youtube ? `${c.name} needs YOUTUBE_API_KEY — YouTube blocks its auto-live embed` : r && r.error ? `${c.name}: live lookup failed (${r.error})` : `${c.name} is not live right now`;
      return { url: '', pop: `https://www.youtube.com/channel/${c.ch}/live`, cap: why, msg: why, nav: false, warn: true };
    }
    return { url: pl.url, pop: pl.pop, cap: `${c.name}${c.event ? ' — live mainly during major events; YouTube shows an error when off air' : ' — 24/7 live'}`, nav: false };
  },
  _loadTile(i) {
    if (!this.panel) return;
    const tile = this.panel.querySelector(`.cw-tile[data-i="${i}"]`); if (!tile) return;
    const f = tile.querySelector('iframe'), r = this._resolve(i);
    tile.querySelector('.cw-cap').textContent = r.cap;
    tile.querySelector('.cw-cap').style.color = r.warn ? '#E8B339' : '#7a8194';
    tile.querySelectorAll('[data-cw^="prev:"],[data-cw^="next:"]').forEach(b => { b.style.visibility = r.nav ? 'visible' : 'hidden'; });
    tile.dataset.pop = r.pop;
    const m = tile.querySelector('.cw-msg'); m.textContent = r.msg || ''; m.style.display = r.msg ? 'flex' : 'none';
    const sel = tile.querySelector('select'); if (sel && sel.value !== this.tiles[i].src) this._renderSelects();
    tile.classList.toggle('cw-focus', i === this.focus);
    const hidden = this.minimized || (this.layout === 1 && i > 0);
    const want = hidden ? '' : r.url;
    if (f.dataset.url !== want) { f.dataset.url = want; f.src = want || 'about:blank'; } // only reload when the source changed
  },
  _setTile(i, src, idx) {
    this.tiles[i] = { src, idx: idx || 0 };
    this._save(); this._renderSelects(); this._loadTile(i);
  },

  // ── globe: city pins + Windy pins ─────────────────────────
  _clear(k) { (this.ents[k] || []).forEach(e => V.entities.remove(e)); this.ents[k] = []; },
  _icon(col) {
    return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="#0a1a2a" stroke="${col}" stroke-width="1.5"/><path d="M6 7h6v6H6z M12 9l3-2v6l-3-2z" fill="${col}"/></svg>`);
  },
  _drawCities() {
    this._clear('cities');
    CAM_WALL.cities.forEach(c => {
      const vids = ((this.live[c.id] || {}).videos || []);
      const rows = vids.slice(0, 8).map((v, k) => `<tr><td style="padding:3px 0;color:#c8ccd6">${esc(v.title)}<div style="color:#5C636B;font-size:9px">${esc(v.channel)}</div></td><td style="text-align:right;vertical-align:top"><button data-cw-act="city" data-city="${esc(c.id)}" data-k="${k}" style="background:#0a2a2a;color:#00ccaa;border:1px solid #00ccaa44;border-radius:2px;cursor:pointer;font-family:monospace;font-size:9px;padding:2px 6px">▸ PLAY</button></td></tr>`).join('');
      this.ents.cities.push(V.entities.add({
        name: c.name + ' — live streams',
        position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat),
        billboard: { image: this._icon('#00ccaa'), width: 20, height: 20, verticalOrigin: Cesium.VerticalOrigin.CENTER, disableDepthTestDistance: 5e6 },
        label: { text: `${c.name.toUpperCase()} · ${vids.length} LIVE`, font: 'bold 9px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString('#00ccaa'), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -18), scaleByDistance: new Cesium.NearFarScalar(2e5, 1, 8e6, 0.5), disableDepthTestDistance: 5e6 },
        description: `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:380px;background:#0a0e14;padding:12px;border-radius:2px;border:1px solid #00ccaa33;color:#c8ccd6">
          <div style="color:#00ccaa;font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:8px">📹 ${esc(c.name.toUpperCase())} — LIVE STREAMS</div>
          ${rows ? `<table style="width:100%;border-collapse:collapse;font-size:10px">${rows}</table>` : `<div style="color:#7a8194;font-size:10px">${this.keys && this.keys.youtube ? 'No live streams found right now.' : 'YouTube search is off — add YOUTUBE_API_KEY in Netlify.'}</div>`}
          <button data-cw-act="city" data-city="${esc(c.id)}" data-k="0" style="display:block;width:100%;margin-top:10px;padding:7px;background:#0a2a2a;color:#00ccaa;border:1px solid #00ccaa44;border-radius:2px;cursor:pointer;font-family:monospace;font-size:10px;letter-spacing:1px;font-weight:600">▸ SHOW ${esc(c.name.toUpperCase())} IN CAM WALL</button>
          <div style="margin-top:8px;font-size:7px;color:#1e2436;letter-spacing:1px;text-align:right">KITSUNE BDOC — CAM WALL</div></div>`,
        show: !!layers.camwall
      }));
    });
    this._kick();
  },
  _drawWindy() {
    this._clear('windy');
    this.windy.forEach(w => {
      const id = String(w.id).replace(/\D/g, ''); if (!id) return;
      this.ents.windy.push(V.entities.add({
        name: String(w.title || 'Windy webcam').slice(0, 80),
        position: Cesium.Cartesian3.fromDegrees(w.lon, w.lat),
        billboard: { image: this._icon('#2dd4bf'), width: 14, height: 14, verticalOrigin: Cesium.VerticalOrigin.CENTER, scaleByDistance: new Cesium.NearFarScalar(5e4, 1.2, 6e6, 0.4), disableDepthTestDistance: 5e6 },
        description: `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:380px;background:#0a0e14;padding:12px;border-radius:2px;border:1px solid #2dd4bf33;color:#c8ccd6">
          <div style="color:#2dd4bf;font-size:12px;font-weight:700;margin-bottom:6px">📷 ${esc(w.title)}</div>
          <div style="color:#7a8194;font-size:10px">${esc([w.city, w.country].filter(Boolean).join(', '))}${w.updated ? ' · updated ' + esc(String(w.updated).slice(0, 16).replace('T', ' ')) + 'Z' : ''}</div>
          ${w.preview ? `<img src="${safeUrl(w.preview)}" alt="" style="display:block;width:100%;margin-top:8px;border:1px solid #2dd4bf33">` : ''}
          <button data-cw-act="windy" data-id="${id}" style="display:block;width:100%;margin-top:10px;padding:7px;background:#0a2a2a;color:#2dd4bf;border:1px solid #2dd4bf44;border-radius:2px;cursor:pointer;font-family:monospace;font-size:10px;letter-spacing:1px;font-weight:600">▸ PLAY ${w.live ? 'LIVE' : 'TIMELAPSE'} IN CAM WALL</button>
          <a href="${safeUrl(w.detail || 'https://www.windy.com/webcams')}" target="_blank" rel="noopener noreferrer" style="display:block;margin-top:6px;padding:5px;border:1px solid #2dd4bf33;color:#2dd4bf;text-decoration:none;font-size:9px;text-align:center">Webcam by Windy.com ↗</a></div>`,
        show: !!layers.camwall
      }));
    });
    this._kick();
  },
  playCity(id, k) { if (!this._city(id)) return; this._unmin(); this._setTile(this.focus, 'city:' + id, k || 0); },
  playWindy(id) {
    const w = this.windy.find(x => String(x.id) === String(id)); if (!w) return;
    this._unmin(); this.tiles[this.focus] = { src: 'windy:' + w.id, idx: 0, w }; this._save(); this._renderSelects(); this._loadTile(this.focus);
  },
  _unmin() { if (this.minimized) { this.minimized = false; this._applyLayout(); } },

  // ── persistence (per-viewer convenience only) ─────────────
  _restore() {
    let s = null; try { s = JSON.parse(localStorage.getItem(CAM_WALL.storeKey) || 'null'); } catch (_) {}
    const ok = v => typeof v === 'string' && (/^city:/.test(v) ? !!this._city(v.slice(5)) : /^ch:/.test(v) && CAM_WALL.channels.some(c => 'ch:' + c.id === v));
    this.tiles = CAM_WALL.defaults.map((d, i) => ({ src: s && ok(s.tiles && s.tiles[i]) ? s.tiles[i] : d, idx: 0 }));
    this.layout = s && (s.layout === 1 || s.layout === 4) ? s.layout : (innerWidth <= 767 ? 1 : 4);
    this.pos = s && s.pos && isFinite(s.pos.x) && isFinite(s.pos.y) ? s.pos : null;
  },
  _save() {
    try { localStorage.setItem(CAM_WALL.storeKey, JSON.stringify({ tiles: this.tiles.map(t => t.src.startsWith('windy:') ? 'ch:aje' : t.src), layout: this.layout, pos: this.pos })); } catch (_) {}
  },

  // ── panel ─────────────────────────────────────────────────
  _buildPanel() {
    if (!this.panel) {
      const css = document.createElement('style');
      css.textContent = '#camWallPanel{position:fixed;left:calc(var(--lw,248px) + 16px);bottom:70px;z-index:57;width:min(660px,calc(100vw - var(--lw,248px) - 40px));background:rgba(8,12,20,0.97);border:1px solid rgba(0,204,170,0.3);border-radius:4px;font-family:var(--m,monospace);color:#c8ccd6;box-shadow:0 4px 24px rgba(0,0,0,0.55)}'
        + '#camWallPanel .cw-hd{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:move;user-select:none}'
        + '#camWallPanel .cw-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px}'
        + '#camWallPanel.cw-one .cw-grid{grid-template-columns:1fr}#camWallPanel.cw-one .cw-tile:not([data-i="0"]){display:none}'
        + '#camWallPanel.cw-min .cw-grid,#camWallPanel.cw-min .cw-ft{display:none}'
        + '#camWallPanel .cw-tile{border:1px solid rgba(255,255,255,0.06);border-radius:2px;min-width:0}#camWallPanel .cw-tile.cw-focus{border-color:rgba(0,204,170,0.55)}'
        + '#camWallPanel .cw-th{display:flex;gap:3px;padding:3px;align-items:center}'
        + '#camWallPanel select{flex:1;min-width:0;background:#0a0e14;color:#c8ccd6;border:1px solid rgba(255,255,255,0.12);border-radius:2px;font-family:inherit;font-size:9px;padding:2px}'
        + '#camWallPanel button{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:2px;color:#9BA1A8;cursor:pointer;font-family:inherit;font-size:8px;padding:2px 6px;flex:none}'
        + '#camWallPanel .cw-body{position:relative;aspect-ratio:16/9;background:#000}#camWallPanel iframe{position:absolute;inset:0;width:100%;height:100%;border:0}'
        + '#camWallPanel.cw-drag iframe{pointer-events:none}'
        + '#camWallPanel .cw-msg{position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:12px;font-size:9px;line-height:1.5;color:#E8B339;background:#05080d}'
        + '#camWallPanel .cw-cap{font-size:8px;padding:3px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
        + '#camWallPanel .cw-ft{padding:5px 10px 7px;font-size:7.5px;color:#5C636B;letter-spacing:.4px;line-height:1.5}#camWallPanel .cw-ft a{color:#2dd4bf}'
        + '@media(max-width:767px){#camWallPanel{left:4px;right:4px;width:auto;top:calc(56px + var(--bnh,0px));bottom:auto;max-height:55vh;overflow-y:auto}#camWallPanel .cw-grid{grid-template-columns:1fr}#camWallPanel .cw-hd{cursor:default}}';
      document.head.appendChild(css);
      const p = document.createElement('div');
      p.id = 'camWallPanel';
      p.innerHTML = `<div class="cw-hd"><span style="width:7px;height:7px;border-radius:50%;background:#00ccaa;box-shadow:0 0 6px #00ccaa"></span>
          <span style="flex:1;font-size:9.5px;font-weight:700;letter-spacing:1.4px;color:#00ccaa">📹 CAM WALL — MIDDLE EAST</span>
          <button data-cw="layout" title="Switch 1 / 4 tiles"></button><button data-cw="refresh" title="Re-search live streams">↻</button><button data-cw="min" title="Minimize (pauses video)">–</button><button data-cw="close" title="Turn off Cam Wall">×</button></div>
        <div class="cw-grid">${this.tiles.map((_, i) => `<div class="cw-tile" data-i="${i}">
          <div class="cw-th"><select data-cw="sel:${i}" aria-label="Feed for tile ${i + 1}"></select><button data-cw="prev:${i}" title="Previous live stream">◀</button><button data-cw="next:${i}" title="Next live stream">▶</button><button data-cw="pop:${i}" title="Open on YouTube / Windy">↗</button></div>
          <div class="cw-body"><iframe title="Live feed ${i + 1}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" src="about:blank"></iframe><div class="cw-msg"></div></div>
          <div class="cw-cap"></div></div>`).join('')}</div>
        <div class="cw-ft"></div>`;
      p.addEventListener('click', e => {
        const tile = e.target.closest('.cw-tile');
        if (tile) { this.focus = +tile.dataset.i; this.panel.querySelectorAll('.cw-tile').forEach(t => t.classList.toggle('cw-focus', +t.dataset.i === this.focus)); }
        const b = e.target.closest('button[data-cw]'); if (!b) return;
        const [act, n] = b.dataset.cw.split(':'), i = +n;
        if (act === 'layout') { this.layout = this.layout === 4 ? 1 : 4; this._save(); this._applyLayout(); }
        else if (act === 'refresh') this.refreshCities();
        else if (act === 'min') { this.minimized = !this.minimized; this._applyLayout(); }
        else if (act === 'close') { const ly = document.querySelector('.ly[data-layer="camwall"]'); if (ly) ly.click(); }
        else if (act === 'prev' || act === 'next') { this.tiles[i].idx += act === 'next' ? 1 : -1; this._loadTile(i); }
        else if (act === 'pop') { const u = this.panel.querySelector(`.cw-tile[data-i="${i}"]`).dataset.pop; if (/^https:\/\//.test(u || '')) window.open(u, '_blank', 'noopener'); }
      });
      p.addEventListener('change', e => {
        const s = e.target.closest('select[data-cw]'); if (!s) return;
        const i = +s.dataset.cw.split(':')[1];
        if (s.value.startsWith('windy:')) return; // windy tiles are set from a globe pin
        this.focus = i; this._setTile(i, s.value, 0);
      });
      this._drag(p);
      document.body.appendChild(p);
      this.panel = p;
    }
    this.panel.style.display = 'block';
    this._placeSaved();
    this._renderSelects();
    this._applyLayout();
    this._renderFoot();
  },
  _applyLayout() {
    if (!this.panel) return;
    this.panel.classList.toggle('cw-one', this.layout === 1);
    this.panel.classList.toggle('cw-min', this.minimized);
    this.panel.querySelector('[data-cw="layout"]').textContent = this.layout === 4 ? '▢ 1' : '▦ 4';
    this.panel.querySelector('[data-cw="min"]').textContent = this.minimized ? '+' : '–';
    this.tiles.forEach((_, i) => this._loadTile(i));
  },
  _renderSelects() {
    if (!this.panel) return;
    const cityOpts = CAM_WALL.cities.map(c => { const L = this.live[c.id]; const n = L && L.configured ? ` (${(L.videos || []).length} live)` : ''; return `<option value="city:${c.id}">${esc(c.name)} — live search${n}</option>`; }).join('');
    const noKey = !this.keys || !this.keys.youtube;
    const chOpts = CAM_WALL.channels.map(c => `<option value="ch:${c.id}">${esc(c.name)}${c.event ? ' (events)' : ''}${c.resolve && noKey ? ' (needs YT key)' : ''}</option>`).join('');
    this.panel.querySelectorAll('select[data-cw]').forEach(s => {
      const i = +s.dataset.cw.split(':')[1], t = this.tiles[i];
      const w = t.src.startsWith('windy:') && (this.windy.find(x => 'windy:' + x.id === t.src) || t.w);
      s.innerHTML = `<optgroup label="City cams (YouTube live search)">${cityOpts}</optgroup><optgroup label="24/7 news channels">${chOpts}</optgroup>`
        + (w ? `<optgroup label="Windy webcam"><option value="${esc(t.src)}">${esc(String(w.title).slice(0, 40))}</option></optgroup>` : '');
      s.value = t.src;
    });
  },
  _renderFoot() {
    if (!this.panel) return;
    const k = this.keys || {};
    const chip = (on, t) => `<b style="color:${on ? '#3FB950' : '#E8B339'}">${t}</b>`;
    this.panel.querySelector('.cw-ft').innerHTML = `${chip(k.youtube, k.youtube ? 'YT SEARCH ON' : 'YT SEARCH OFF — add YOUTUBE_API_KEY')} · ${chip(k.windy, k.windy ? 'WINDY ' + this.windy.length + ' CAMS ON GLOBE' : 'WINDY OFF — add WINDY_API_KEY')}<br>`
      + `Official YouTube and Windy players only · videos start muted, click a tile to unmute · click a tile, then a globe pin, to play it there · city searches refresh every 30 min · <a href="https://www.windy.com/webcams" target="_blank" rel="noopener noreferrer">Webcams by Windy.com</a>`;
  },
  _placeSaved() {
    if (!this.pos || innerWidth <= 767) return;
    const x = Math.min(Math.max(0, this.pos.x), innerWidth - 120), y = Math.min(Math.max(0, this.pos.y), innerHeight - 40);
    Object.assign(this.panel.style, { left: x + 'px', top: y + 'px', bottom: 'auto' });
  },
  _drag(p) {
    let sx, sy, ox, oy, on = false;
    p.addEventListener('pointerdown', e => {
      if (innerWidth <= 767 || !e.target.closest('.cw-hd') || e.target.closest('button,select')) return;
      const r = p.getBoundingClientRect(); on = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      p.classList.add('cw-drag'); p.setPointerCapture(e.pointerId);
    });
    p.addEventListener('pointermove', e => {
      if (!on) return;
      const x = Math.min(Math.max(0, ox + e.clientX - sx), innerWidth - 120), y = Math.min(Math.max(0, oy + e.clientY - sy), innerHeight - 40);
      Object.assign(p.style, { left: x + 'px', top: y + 'px', bottom: 'auto' });
    });
    const end = () => { if (!on) return; on = false; p.classList.remove('cw-drag'); const r = p.getBoundingClientRect(); this.pos = { x: Math.round(r.left), y: Math.round(r.top) }; this._save(); };
    p.addEventListener('pointerup', end); p.addEventListener('pointercancel', end);
  }
};
window.CamWall = CamWall;
