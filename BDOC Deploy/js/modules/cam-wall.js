// ============================================================
// BDOC MODULE: cam-wall.js
// CAM WALL — stationary city cameras by region (2×2 tiles), camera pins on the globe, operator anomaly log.
// Created 2026-11-03. Lazy-loaded on first toggle of layer 'camwall' (CONFLICTS group).
// Sources (official embeddable players only — no restreams, no news channels, no private / unsecured cameras):
//   /.netlify/functions/proxy-mecams?source=cams&region=…    curated stationary cams streamed by their operators
//   /.netlify/functions/proxy-mecams?source=windy&region=…   Windy Webcams API v3 (needs WINDY_API_KEY)
// Depends on (resolved at call time): V, Cesium, layers, esc, safeUrl, af, EventLog
// p168p: ported to main from the stale OneDrive copy. Popup buttons use data-cw-act and one listener on the
//   InfoBox frame document (works with or without allow-scripts, HANDOFF §2 N #18).
// p169: region dropdown (Middle East, Ukraine & Russia, Taiwan Strait, Korean Peninsula); news channels and
//   open YouTube search removed (aggregator restreams were the copyright risk); only the selected tile plays
//   live, the others show a still that refreshes every 5 min (four YouTube players at once was the lag);
//   ⚠ LOG records an anomaly seen on a camera and pins it on the globe (saved on this device only).
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

var CAM_WALL = {
  // view: lon, lat, camera height (m) for the fly-to on a region change
  regions: {
    me: { name: 'Middle East',      view: [44.5, 29.5, 3.6e6], none: 'Iran has no public stationary cameras we can embed.' },
    ua: { name: 'Ukraine & Russia', view: [33.5, 50.0, 2.6e6], none: 'Ukraine asked owners to switch public street cameras off in wartime; every "live cam" stream found was an aggregator restream, which BDOC does not show.' },
    tw: { name: 'Taiwan Strait',    view: [120.6, 24.2, 1.1e6], none: '' },
    kr: { name: 'Korean Peninsula', view: [127.6, 37.6, 1.2e6], none: '' }
  },
  kinds: ['Flash', 'Explosion', 'Smoke plume', 'Fire or glow', 'Other'],
  storeKey: 'bdoc.camwall.v2',
  anomKey: 'bdoc.camwall.anomalies.v1',
  stillMs: 300000,
  maxWindyOptions: 120
};

var CamWall = {
  on: false, panel: null, timers: [], ents: { cams: [], windy: [], anoms: [] }, keys: null,
  region: 'me', cams: [], windy: [], camsErr: '', perRegion: {}, tiles: [], focus: 0, layout: 4,
  minimized: false, pos: null, allLive: false, anoms: [], _gen: 0, _pending: null, _pickH: null,

  // ── lifecycle ─────────────────────────────────────────────
  start() {
    if (!V || this.on) return;
    this.on = true;
    this._restore();
    this._buildPanel();
    this._bindInfoBox();
    this._drawAnoms();
    this._boot();
  },
  // Popup buttons carry data-cw-act. One click listener on the InfoBox frame document (same origin) runs them
  // in this window, so no inline onclick is needed inside entity descriptions.
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
          if (b.dataset.cwAct === 'cam') this.playSrc('yt:' + b.dataset.id);
          else if (b.dataset.cwAct === 'windy') this.playSrc('windy:' + b.dataset.id);
          else if (b.dataset.cwAct === 'anomrm') this.removeAnomaly(b.dataset.id);
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
    await this.loadRegion(this.region, false);
    if (!this.on) return;
    // stills: new frame every 5 min; Windy image tokens expire after 10 min; curated list re-checked hourly
    this.timers.push(setInterval(() => { if (!document.hidden) this._loadAll(); }, CAM_WALL.stillMs));
    this.timers.push(setInterval(() => { if (!document.hidden) this.loadWindy(); }, 540000));
    this.timers.push(setInterval(() => { if (!document.hidden) this.loadCams(); }, 3600000));
    EventLog.add('info', 'Cam Wall armed');
  },
  stop() {
    this.on = false;
    this._gen++;
    this._endPick();
    this.timers.forEach(clearInterval); this.timers = [];
    if (this.panel) {
      this.panel.querySelectorAll('iframe').forEach(f => { f.src = 'about:blank'; f.dataset.url = ''; });
      this.panel.querySelectorAll('.cw-still img').forEach(i => { i.removeAttribute('src'); i.dataset.url = ''; });
      this._showLog(false);
      this.panel.style.display = 'none';
    }
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
  async loadRegion(r, fly) {
    if (!CAM_WALL.regions[r]) r = 'me';
    const gen = ++this._gen;
    this._endPick();
    this.region = r; this.cams = []; this.windy = []; this.camsErr = ''; this.tiles = [];
    this._clear('cams'); this._clear('windy');
    this._save();
    if (this.panel) {
      this.panel.querySelector('[data-cw="region"]').value = r;
      this.panel.querySelectorAll('.cw-tile').forEach((_, i) => { this.tiles[i] = { src: '' }; });
      this._renderSelects(); this._loadAll(); this._renderFoot();
    }
    if (fly) this._fly(r);
    await Promise.all([this.loadCams(gen), this.loadWindy(gen)]);
    if (gen !== this._gen || !this.on) return;
    this._pickTiles();
    this._renderSelects(); this._loadAll(); this._renderFoot();
    const ok = this.cams.filter(c => this._playable(c)).length;
    af('#00ccaa', `CAM WALL · ${CAM_WALL.regions[r].name.toUpperCase()}: ${ok} stationary cam${ok === 1 ? '' : 's'} · ${this.keys && this.keys.windy ? this.windy.length + ' Windy webcams' : 'Windy off'}`);
  },
  async loadCams(gen) {
    gen = gen || this._gen;
    const r = this.region;
    try { const j = await this._j('cams', { region: r }); if (gen === this._gen && r === this.region) { this.cams = j.cams || []; this.camsErr = ''; } }
    catch (e) { if (gen === this._gen) this.camsErr = e.message; console.warn('[Cam Wall cams]', e); }
    if (gen !== this._gen || !this.on) return;
    this._drawCams();
    if (this.tiles.some(t => t.src)) { this._renderSelects(); this._loadAll(); this._renderFoot(); }
  },
  async loadWindy(gen) {
    gen = gen || this._gen;
    const r = this.region;
    if (!this.keys || !this.keys.windy) { this.windy = []; this._renderFoot(); return; }
    try { const j = await this._j('windy', { region: r }); if (gen === this._gen && r === this.region) this.windy = j.webcams || []; }
    catch (e) { console.warn('[Cam Wall windy]', e); }
    if (gen !== this._gen || !this.on) return;
    this._drawWindy();
    if (this.tiles.some(t => t.src)) { this._renderSelects(); this._loadAll(); this._renderFoot(); }
  },
  _playable(c) { return c && c.state !== 'blocked' && c.state !== 'gone' && /^[A-Za-z0-9_-]{11}$/.test(c.v || ''); },
  _windyOk(w) { return w && /^https:\/\/([a-z0-9-]+\.)*windy\.com\//i.test(w.live || w.player || ''); },
  // every source this region can play, best first: operator cams, then Windy live, then Windy timelapse
  _sources() {
    return this.cams.filter(c => this._playable(c)).map(c => 'yt:' + c.id)
      .concat(this.windy.filter(w => this._windyOk(w) && w.live).map(w => 'windy:' + w.id))
      .concat(this.windy.filter(w => this._windyOk(w) && !w.live).map(w => 'windy:' + w.id));
  },
  _pickTiles() {
    const avail = this._sources(), saved = (this.perRegion[this.region] || []).filter(s => avail.includes(s));
    const n = this.panel ? this.panel.querySelectorAll('.cw-tile').length : 4;
    const pick = saved.slice(0, n);
    for (const s of avail) { if (pick.length >= n) break; if (!pick.includes(s)) pick.push(s); }
    this.tiles = Array.from({ length: n }, (_, i) => ({ src: pick[i] || '' }));
    if (this.focus >= n) this.focus = 0;
  },

  // ── tile resolution ───────────────────────────────────────
  _cam(id) { return this.cams.find(c => c.id === id); },
  _win(id) { return this.windy.find(w => String(w.id) === String(id)); },
  _vidEmbed(id) { return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0`; },
  // what a tile source is, for captions, pins and the anomaly log
  _info(src) {
    if (!src) return null;
    if (src.startsWith('yt:')) { const c = this._cam(src.slice(3)); return c && { src, name: `${c.city} · ${c.name}`, lat: c.lat, lon: c.lon, by: c.by }; }
    if (src.startsWith('windy:')) { const w = this._win(src.slice(6)); return w && { src, name: String(w.title).slice(0, 80), lat: w.lat, lon: w.lon, by: 'Windy.com' }; }
    return null;
  },
  _resolve(i) {
    const t = this.tiles[i] || { src: '' }, R = CAM_WALL.regions[this.region];
    if (t.src.startsWith('yt:')) {
      const c = this._cam(t.src.slice(3));
      if (c && this._playable(c)) {
        const bucket = Math.floor(Date.now() / CAM_WALL.stillMs);
        return { url: this._vidEmbed(c.v), still: `https://i.ytimg.com/vi/${c.v}/hqdefault_live.jpg?b=${bucket}`, pop: 'https://www.youtube.com/watch?v=' + c.v,
          cap: `${c.city.toUpperCase()} · ${c.name} — ${c.by}${c.state === 'unknown' ? ' (embed check failed, may be offline)' : ''}`, warn: c.state === 'unknown' };
      }
      const why = c ? 'This stream is offline or no longer embeddable.' : 'This camera is not in the list any more.';
      return { url: '', cap: why, msg: why, warn: true };
    }
    if (t.src.startsWith('windy:')) {
      const w = this._win(t.src.slice(6));
      if (this._windyOk(w)) {
        return { url: w.live || w.player, still: /^https:\/\//.test(w.preview || '') ? w.preview : '', pop: w.detail || w.live || w.player,
          cap: `WINDY ${w.live ? 'LIVE' : 'TIMELAPSE'} · ${w.title} · ${[w.city, w.country].filter(Boolean).join(', ')}` };
      }
      return { url: '', cap: 'Windy webcam unavailable', msg: 'This Windy webcam is unavailable right now.', warn: true };
    }
    // empty tile: say why, and what fixes it
    let msg;
    if (this.camsErr && !this.windy.length) msg = 'Could not load the camera list (' + this.camsErr + '). ↻ to retry.';
    else if (!this._sources().length) msg = (R.none ? R.none + ' ' : 'No stationary cameras here yet. ') + (this.keys && this.keys.windy ? 'Windy has no public webcams in this region either.' : 'Add a free WINDY_API_KEY in Netlify to load licensed Windy webcams for this region.');
    else msg = 'Pick a camera above.';
    return { url: '', cap: R.name.toUpperCase(), msg, warn: true };
  },
  _loadAll() { this.tiles.forEach((_, i) => this._loadTile(i)); },
  _loadTile(i) {
    if (!this.panel) return;
    const tile = this.panel.querySelector(`.cw-tile[data-i="${i}"]`); if (!tile) return;
    const f = tile.querySelector('iframe'), still = tile.querySelector('.cw-still'), img = still.querySelector('img'), r = this._resolve(i);
    const cap = tile.querySelector('.cw-cap');
    cap.textContent = r.cap; cap.style.color = r.warn ? '#E8B339' : '#7a8194';
    tile.dataset.pop = r.pop || '';
    const m = tile.querySelector('.cw-msg'); m.textContent = r.msg || ''; m.style.display = r.msg ? 'flex' : 'none';
    tile.classList.toggle('cw-focus', i === this.focus);
    const hidden = this.minimized || (this.layout === 1 && i > 0);
    // Only the selected tile plays live unless ▶ ALL is on: four YouTube players at once made the globe stutter.
    const live = !hidden && !!r.url && (this.allLive || this.layout === 1 || i === this.focus);
    const wantF = live ? r.url : '';
    if (f.dataset.url !== wantF) { f.dataset.url = wantF; f.src = wantF || 'about:blank'; } // only reload when the source changed
    f.style.visibility = live ? 'visible' : 'hidden';
    const showStill = !hidden && !live && !!r.url, wantImg = showStill ? (r.still || '') : '';
    still.style.display = showStill ? 'flex' : 'none';
    if (img.dataset.url !== wantImg) { img.dataset.url = wantImg; img.style.visibility = 'hidden'; if (wantImg) img.src = wantImg; else img.removeAttribute('src'); }
  },
  _setTile(i, src) {
    this.tiles[i] = { src };
    this.perRegion[this.region] = this.tiles.map(t => t.src);
    this._save(); this._renderSelects(); this._loadTile(i);
  },
  _setFocus(i) {
    if (i === this.focus) return;
    this.focus = i; this._loadAll();
  },
  playSrc(src) {
    if (!this._info(src)) return;
    this._unmin(); this._setTile(this.focus, src); this._loadAll();
  },
  _step(i, d) {
    const all = this._sources(); if (!all.length) return;
    const k = all.indexOf(this.tiles[i].src);
    this._setTile(i, all[((k < 0 ? 0 : k + d) % all.length + all.length) % all.length]);
  },
  _unmin() { if (this.minimized) { this.minimized = false; this._applyLayout(); } },
  _fly(r) {
    try { const v = CAM_WALL.regions[r].view; V.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(v[0], v[1], v[2]), duration: 1.6 }); } catch (_) {}
  },

  // ── globe: camera pins + Windy pins + anomalies ───────────
  _clear(k) { (this.ents[k] || []).forEach(e => V.entities.remove(e)); this.ents[k] = []; },
  _icon(col) {
    return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="#0a1a2a" stroke="${col}" stroke-width="1.5"/><path d="M6 7h6v6H6z M12 9l3-2v6l-3-2z" fill="${col}"/></svg>`);
  },
  _btn(col, attrs, text) {
    return `<button ${attrs} style="display:block;width:100%;margin-top:10px;padding:7px;background:#0a2a2a;color:${col};border:1px solid ${col}44;border-radius:2px;cursor:pointer;font-family:monospace;font-size:10px;letter-spacing:1px;font-weight:600">${text}</button>`;
  },
  _drawCams() {
    this._clear('cams');
    this.cams.forEach(c => {
      const ok = this._playable(c), col = ok ? '#00ccaa' : '#5C636B';
      this.ents.cams.push(V.entities.add({
        name: `${c.city} — ${c.name}`,
        position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat),
        billboard: { image: this._icon(col), width: 18, height: 18, verticalOrigin: Cesium.VerticalOrigin.CENTER, scaleByDistance: new Cesium.NearFarScalar(5e4, 1.2, 6e6, 0.5), disableDepthTestDistance: 5e6 },
        label: { text: c.name.toUpperCase(), font: 'bold 9px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString(col), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -16), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4e5), disableDepthTestDistance: 5e6 },
        description: `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:380px;background:#0a0e14;padding:12px;border-radius:2px;border:1px solid ${col}33;color:#c8ccd6">
          <div style="color:${col};font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:6px">📹 ${esc(c.name.toUpperCase())}</div>
          <div style="color:#7a8194;font-size:10px">${esc(c.city)} · stationary camera streamed by ${esc(c.by)}</div>
          <div style="color:#5C636B;font-size:9px;margin-top:4px">Pin marks the area the camera shows, not its exact position.${ok ? '' : ' <b style="color:#E8B339">Offline or not embeddable right now.</b>'}</div>
          ${ok ? `<img src="https://i.ytimg.com/vi/${esc(c.v)}/hqdefault_live.jpg" alt="" style="display:block;width:100%;margin-top:8px;border:1px solid ${col}33">` : ''}
          ${ok ? this._btn(col, `data-cw-act="cam" data-id="${esc(c.id)}"`, '▸ WATCH IN CAM WALL') : ''}
          <a href="${safeUrl('https://www.youtube.com/watch?v=' + c.v)}" target="_blank" rel="noopener noreferrer" style="display:block;margin-top:6px;padding:5px;border:1px solid ${col}33;color:${col};text-decoration:none;font-size:9px;text-align:center">Open on YouTube ↗</a>
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
          ${this._btn('#2dd4bf', `data-cw-act="windy" data-id="${id}"`, `▸ PLAY ${w.live ? 'LIVE' : 'TIMELAPSE'} IN CAM WALL`)}
          <a href="${safeUrl(w.detail || 'https://www.windy.com/webcams')}" target="_blank" rel="noopener noreferrer" style="display:block;margin-top:6px;padding:5px;border:1px solid #2dd4bf33;color:#2dd4bf;text-decoration:none;font-size:9px;text-align:center">Webcam by Windy.com ↗</a></div>`,
        show: !!layers.camwall
      }));
    });
    this._kick();
  },

  // ── anomaly log (operator reports, saved on this device) ──
  _hhmmss(iso) { return String(iso).slice(11, 19); },
  _logStart() {
    const info = this._info((this.tiles[this.focus] || {}).src);
    this._pending = { t: new Date().toISOString(), cam: info ? { name: info.name, src: info.src, lat: info.lat, lon: info.lon } : null };
    this._unmin();
    this._showLog(true);
  },
  _showLog(on) {
    if (!this.panel) return;
    const box = this.panel.querySelector('.cw-log');
    box.style.display = on ? 'block' : 'none';
    if (!on) { this._pending = null; return; }
    const p = this._pending;
    box.querySelector('.cw-log-t').textContent = `⚠ SEEN ${this._hhmmss(p.t)}Z ON ${p.cam ? p.cam.name.toUpperCase() : 'NO CAMERA SELECTED'} — what was it, and where?`;
    box.querySelector('[data-cw="atcam"]').disabled = !p.cam;
    box.querySelector('[data-cw="pin"]').textContent = '📍 PIN ON GLOBE';
    const note = box.querySelector('[data-cw-note]'); note.value = ''; note.focus();
  },
  _pickOnGlobe() {
    if (!this._pending || this._pickH) return;
    const btn = this.panel.querySelector('[data-cw="pin"]');
    btn.textContent = 'CLICK THE GLOBE · ESC CANCELS';
    const h = new Cesium.ScreenSpaceEventHandler(V.scene.canvas);
    this._pickH = h;
    h.setInputAction(click => {
      let c = null;
      try { if (V.scene.pickPositionSupported) c = V.scene.pickPosition(click.position); } catch (_) {}
      if (!c) c = V.camera.pickEllipsoid(click.position, V.scene.globe.ellipsoid);
      if (!c) return; // clicked empty space: keep waiting
      const g = Cesium.Cartographic.fromCartesian(c);
      const lat = Cesium.Math.toDegrees(g.latitude), lon = Cesium.Math.toDegrees(g.longitude);
      if (!isFinite(lat) || !isFinite(lon)) return;
      this._endPick();
      this._logSave(lat, lon, 'globe');
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this._escH = e => { if (e.key === 'Escape') { this._endPick(); btn.textContent = '📍 PIN ON GLOBE'; } };
    document.addEventListener('keydown', this._escH);
    V.scene.canvas.style.cursor = 'crosshair';
  },
  _endPick() {
    if (this._pickH) { try { this._pickH.destroy(); } catch (_) {} this._pickH = null; }
    if (this._escH) { document.removeEventListener('keydown', this._escH); this._escH = null; }
    try { V.scene.canvas.style.cursor = ''; } catch (_) {}
  },
  _logSave(lat, lon, at) {
    const p = this._pending; if (!p) return;
    const box = this.panel.querySelector('.cw-log');
    const kind = CAM_WALL.kinds.includes(box.querySelector('[data-cw-k]').value) ? box.querySelector('[data-cw-k]').value : 'Other';
    const note = box.querySelector('[data-cw-note]').value.replace(/\s+/g, ' ').trim().slice(0, 140);
    const a = { id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: p.t, kind, note, at, lat: +lat.toFixed(5), lon: +lon.toFixed(5), cam: p.cam };
    this.anoms.unshift(a); this.anoms = this.anoms.slice(0, 100);
    this._saveAnoms(); this._drawAnoms(); this._showLog(false); this._renderFoot();
    const where = at === 'globe' ? `${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}` : 'at the camera';
    EventLog.add('warn', `Cam Wall anomaly: ${kind} ${this._hhmmss(a.t)}Z, ${where}${a.cam ? ' — seen on ' + a.cam.name : ''}`);
    af('#ff6b35', `ANOMALY LOGGED: ${kind.toUpperCase()} · ${this._hhmmss(a.t)}Z · ${where}`);
  },
  removeAnomaly(id) {
    this.anoms = this.anoms.filter(a => a.id !== id);
    this._saveAnoms(); this._drawAnoms(); this._renderFoot();
    try { V.selectedEntity = undefined; } catch (_) {}
  },
  _drawAnoms() {
    this._clear('anoms');
    const col = Cesium.Color.fromCssColorString('#ff6b35');
    const icon = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M11 1l2.6 6.2L20 5l-3.4 5.6L21 14l-6.4.4L13 21l-2-5.6L9 21l-1.6-6.6L1 14l4.4-3.4L2 5l6.4 2.2z" fill="#ff6b35" stroke="#000" stroke-width="1"/></svg>');
    this.anoms.forEach(a => {
      const desc = `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:380px;background:#0a0e14;padding:12px;border-radius:2px;border:1px solid #ff6b3555;color:#c8ccd6">
        <div style="color:#ff6b35;font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:6px">⚠ ${esc(a.kind.toUpperCase())} — OPERATOR REPORT</div>
        <div style="font-size:10px;line-height:1.6">Seen <b>${esc(a.t.slice(0, 19).replace('T', ' '))}Z</b>${a.cam ? ` on <b>${esc(a.cam.name)}</b>` : ''}<br>
        ${a.at === 'globe' ? `Placed at ${a.lat.toFixed(4)}, ${a.lon.toFixed(4)} (operator's estimate)` : 'Placed at the camera: direction and distance unknown'}${a.note ? `<br>Note: ${esc(a.note)}` : ''}</div>
        <div style="color:#E8B339;font-size:9px;margin-top:6px">Unconfirmed. Saved on this device only.</div>
        ${this._btn('#ff6b35', `data-cw-act="anomrm" data-id="${esc(a.id)}"`, 'REMOVE THIS REPORT')}</div>`;
      this.ents.anoms.push(V.entities.add({
        name: `Anomaly: ${a.kind} ${this._hhmmss(a.t)}Z`,
        position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat),
        billboard: { image: icon, width: 22, height: 22, verticalOrigin: Cesium.VerticalOrigin.CENTER, disableDepthTestDistance: 5e6 },
        label: { text: `⚠ ${a.kind.toUpperCase()} ${this._hhmmss(a.t).slice(0, 5)}Z`, font: 'bold 9px JetBrains Mono', fillColor: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -18), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2e6), disableDepthTestDistance: 5e6 },
        description: desc,
        show: !!layers.camwall
      }));
      // dashed sight line from the camera to the estimated spot
      if (a.at === 'globe' && a.cam && isFinite(a.cam.lat) && isFinite(a.cam.lon)) {
        this.ents.anoms.push(V.entities.add({
          polyline: { positions: Cesium.Cartesian3.fromDegreesArray([a.cam.lon, a.cam.lat, a.lon, a.lat]), width: 1.5, clampToGround: true,
            material: new Cesium.PolylineDashMaterialProperty({ color: col.withAlpha(0.8), dashLength: 12 }) },
          show: !!layers.camwall
        }));
      }
    });
    this._kick();
  },
  _logText() {
    return this.anoms.map(a => [a.t.slice(0, 19) + 'Z', a.kind, a.at === 'globe' ? `${a.lat.toFixed(4)},${a.lon.toFixed(4)}` : 'at camera', a.cam ? 'camera: ' + a.cam.name : 'no camera', a.note].filter(Boolean).join(' | ')).join('\n');
  },

  // ── persistence (per-viewer convenience only) ─────────────
  _restore() {
    let s = null; try { s = JSON.parse(localStorage.getItem(CAM_WALL.storeKey) || 'null'); } catch (_) {}
    this.region = s && CAM_WALL.regions[s.region] ? s.region : 'me';
    this.perRegion = {};
    if (s && s.perRegion && typeof s.perRegion === 'object') {
      Object.keys(CAM_WALL.regions).forEach(r => {
        const a = s.perRegion[r];
        if (Array.isArray(a)) this.perRegion[r] = a.filter(v => typeof v === 'string' && /^(yt|windy):[\w-]{1,40}$/.test(v)).slice(0, 4);
      });
    }
    this.layout = s && (s.layout === 1 || s.layout === 4) ? s.layout : (innerWidth <= 767 ? 1 : 4);
    this.allLive = !!(s && s.allLive === true);
    this.pos = s && s.pos && isFinite(s.pos.x) && isFinite(s.pos.y) ? s.pos : null;
    this.tiles = [0, 1, 2, 3].map(() => ({ src: '' }));
    let a = []; try { a = JSON.parse(localStorage.getItem(CAM_WALL.anomKey) || '[]'); } catch (_) {}
    this.anoms = (Array.isArray(a) ? a : []).filter(x => x && typeof x.id === 'string' && typeof x.t === 'string' && CAM_WALL.kinds.includes(x.kind)
      && isFinite(x.lat) && isFinite(x.lon) && Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180).slice(0, 100)
      .map(x => ({ id: x.id.slice(0, 20), t: x.t.slice(0, 24), kind: x.kind, note: String(x.note || '').slice(0, 140), at: x.at === 'globe' ? 'globe' : 'camera', lat: +x.lat, lon: +x.lon,
        cam: x.cam && typeof x.cam.name === 'string' && isFinite(x.cam.lat) && isFinite(x.cam.lon) ? { name: x.cam.name.slice(0, 90), src: String(x.cam.src || '').slice(0, 50), lat: +x.cam.lat, lon: +x.cam.lon } : null }));
  },
  _save() {
    try { localStorage.setItem(CAM_WALL.storeKey, JSON.stringify({ region: this.region, perRegion: this.perRegion, layout: this.layout, pos: this.pos, allLive: this.allLive })); } catch (_) {}
  },
  _saveAnoms() { try { localStorage.setItem(CAM_WALL.anomKey, JSON.stringify(this.anoms)); } catch (_) {} },

  // ── panel ─────────────────────────────────────────────────
  _buildPanel() {
    if (!this.panel) {
      const css = document.createElement('style');
      css.textContent = '#camWallPanel{position:fixed;left:calc(var(--lw,248px) + 16px);bottom:70px;z-index:57;width:min(660px,calc(100vw - var(--lw,248px) - 40px));background:rgba(8,12,20,0.97);border:1px solid rgba(0,204,170,0.3);border-radius:4px;font-family:var(--m,monospace);color:#c8ccd6;box-shadow:0 4px 24px rgba(0,0,0,0.55)}'
        + '#camWallPanel .cw-hd{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:move;user-select:none}'
        + '#camWallPanel .cw-hd select{flex:0 1 150px;font-size:9.5px;color:#00ccaa;font-weight:700}'
        + '#camWallPanel .cw-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px}'
        + '#camWallPanel.cw-one .cw-grid{grid-template-columns:1fr}#camWallPanel.cw-one .cw-tile:not([data-i="0"]){display:none}'
        + '#camWallPanel.cw-min .cw-grid,#camWallPanel.cw-min .cw-ft,#camWallPanel.cw-min .cw-log{display:none!important}'
        + '#camWallPanel .cw-tile{border:1px solid rgba(255,255,255,0.06);border-radius:2px;min-width:0;cursor:pointer}#camWallPanel .cw-tile.cw-focus{border-color:rgba(0,204,170,0.55)}'
        + '#camWallPanel .cw-th{display:flex;gap:3px;padding:3px;align-items:center}'
        + '#camWallPanel select{flex:1;min-width:0;background:#0a0e14;color:#c8ccd6;border:1px solid rgba(255,255,255,0.12);border-radius:2px;font-family:inherit;font-size:9px;padding:2px}'
        + '#camWallPanel button{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:2px;color:#9BA1A8;cursor:pointer;font-family:inherit;font-size:8px;padding:2px 6px;flex:none}'
        + '#camWallPanel button:disabled{opacity:.35;cursor:default}#camWallPanel button.cw-warn{color:#ff6b35;border-color:#ff6b3566}'
        + '#camWallPanel .cw-body{position:relative;aspect-ratio:16/9;background:#000}#camWallPanel iframe{position:absolute;inset:0;width:100%;height:100%;border:0}'
        + '#camWallPanel .cw-still{position:absolute;inset:0;display:none;align-items:flex-end;justify-content:flex-start;background:#05080d}'
        + '#camWallPanel .cw-still img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}'
        + '#camWallPanel .cw-still span{position:relative;margin:6px;padding:2px 6px;background:rgba(0,0,0,.7);border:1px solid #00ccaa55;border-radius:2px;color:#00ccaa;font-size:8px;letter-spacing:.6px}'
        + '#camWallPanel.cw-drag iframe{pointer-events:none}'
        + '#camWallPanel .cw-msg{position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:12px;font-size:9px;line-height:1.5;color:#E8B339;background:#05080d}'
        + '#camWallPanel .cw-cap{font-size:8px;padding:3px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
        + '#camWallPanel .cw-log{display:none;padding:7px 10px;border-bottom:1px solid rgba(255,107,53,0.3);background:rgba(255,107,53,0.06)}'
        + '#camWallPanel .cw-log-t{font-size:8.5px;color:#ff6b35;letter-spacing:.5px;margin-bottom:5px}'
        + '#camWallPanel .cw-log-r{display:flex;gap:4px;margin-top:4px}'
        + '#camWallPanel .cw-log input{flex:1;min-width:0;background:#0a0e14;color:#c8ccd6;border:1px solid rgba(255,255,255,0.12);border-radius:2px;font-family:inherit;font-size:9px;padding:3px 5px}'
        + '#camWallPanel .cw-log select{flex:0 0 110px}'
        + '#camWallPanel .cw-ft{padding:5px 10px 7px;font-size:7.5px;color:#5C636B;letter-spacing:.4px;line-height:1.5}#camWallPanel .cw-ft a{color:#2dd4bf}#camWallPanel .cw-ft button{font-size:7.5px;padding:1px 5px}'
        + '@media(max-width:767px){#camWallPanel{left:4px;right:4px;width:auto;top:calc(56px + var(--bnh,0px));bottom:auto;max-height:55vh;overflow-y:auto}#camWallPanel .cw-grid{grid-template-columns:1fr}#camWallPanel .cw-hd{cursor:default;flex-wrap:wrap;row-gap:5px}#camWallPanel .cw-hd .cw-sp{display:none}#camWallPanel .cw-hd select{flex:1 1 120px}#camWallPanel .cw-hd button{padding:3px 7px}}';
      document.head.appendChild(css);
      const p = document.createElement('div');
      p.id = 'camWallPanel';
      const regionOpts = Object.entries(CAM_WALL.regions).map(([k, r]) => `<option value="${k}">${esc(r.name)}</option>`).join('');
      p.innerHTML = `<div class="cw-hd"><span style="width:7px;height:7px;border-radius:50%;background:#00ccaa;box-shadow:0 0 6px #00ccaa;flex:none"></span>
          <span style="font-size:9.5px;font-weight:700;letter-spacing:1.4px;color:#00ccaa;flex:none">📹 CAM WALL</span>
          <select data-cw="region" aria-label="Region">${regionOpts}</select><span class="cw-sp" style="flex:1"></span>
          <button data-cw="all" title="Play every tile live (heavier) or only the selected tile"></button><button data-cw="layout" title="Switch 1 / 4 tiles"></button><button data-cw="log" class="cw-warn" title="Log an anomaly seen on the selected camera">⚠ LOG</button><button data-cw="refresh" title="Reload the camera list">↻</button><button data-cw="min" title="Minimize (stops video)">–</button><button data-cw="close" title="Turn off Cam Wall">×</button></div>
        <div class="cw-log"><div class="cw-log-t"></div>
          <div class="cw-log-r"><select data-cw-k aria-label="What was seen">${CAM_WALL.kinds.map(k => `<option>${k}</option>`).join('')}</select><input data-cw-note maxlength="140" placeholder="What did you see? (optional)" aria-label="Note"></div>
          <div class="cw-log-r"><button data-cw="pin" class="cw-warn">📍 PIN ON GLOBE</button><button data-cw="atcam" title="Pin it on the camera when you can't tell where it was">AT CAMERA</button><button data-cw="logx">CANCEL</button></div></div>
        <div class="cw-grid">${this.tiles.map((_, i) => `<div class="cw-tile" data-i="${i}">
          <div class="cw-th"><select data-cw="sel:${i}" aria-label="Camera for tile ${i + 1}"></select><button data-cw="prev:${i}" title="Previous camera">◀</button><button data-cw="next:${i}" title="Next camera">▶</button><button data-cw="pop:${i}" title="Open on YouTube / Windy">↗</button></div>
          <div class="cw-body"><iframe title="Camera ${i + 1}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" src="about:blank"></iframe><div class="cw-still"><img alt="" referrerpolicy="no-referrer"><span>▶ CLICK TO WATCH LIVE</span></div><div class="cw-msg"></div></div>
          <div class="cw-cap"></div></div>`).join('')}</div>
        <div class="cw-ft"></div>`;
      // still frames fade in only once they load (YouTube answers 404 for a stream that has ended)
      p.querySelectorAll('.cw-still img').forEach(img => { img.addEventListener('load', () => { img.style.visibility = 'visible'; }); img.addEventListener('error', () => { img.style.visibility = 'hidden'; }); });
      p.addEventListener('click', e => {
        const b = e.target.closest('button[data-cw]');
        const tile = e.target.closest('.cw-tile');
        if (tile && !(b && /^pop:/.test(b.dataset.cw)) && !e.target.closest('select')) this._setFocus(+tile.dataset.i);
        if (!b) return;
        const [act, n] = b.dataset.cw.split(':'), i = +n;
        if (act === 'layout') { this.layout = this.layout === 4 ? 1 : 4; this._save(); this._applyLayout(); }
        else if (act === 'all') { this.allLive = !this.allLive; this._save(); this._applyLayout(); }
        else if (act === 'refresh') this.loadRegion(this.region, false);
        else if (act === 'min') { this.minimized = !this.minimized; this._applyLayout(); }
        else if (act === 'close') { const ly = document.querySelector('.ly[data-layer="camwall"]'); if (ly) ly.click(); }
        else if (act === 'log') this._logStart();
        else if (act === 'pin') this._pickOnGlobe();
        else if (act === 'atcam') { const c = this._pending && this._pending.cam; if (c) { this._endPick(); this._logSave(c.lat, c.lon, 'camera'); } }
        else if (act === 'logx') { this._endPick(); this._showLog(false); }
        else if (act === 'copylog') { const t = this._logText(); try { navigator.clipboard.writeText(t).then(() => { b.textContent = 'COPIED'; setTimeout(() => this._renderFoot(), 1500); }); } catch (_) {} }
        else if (act === 'prev' || act === 'next') this._step(i, act === 'next' ? 1 : -1);
        else if (act === 'pop') { const u = this.panel.querySelector(`.cw-tile[data-i="${i}"]`).dataset.pop; if (/^https:\/\//.test(u || '')) window.open(u, '_blank', 'noopener'); }
      });
      p.addEventListener('change', e => {
        const s = e.target.closest('select[data-cw]'); if (!s) return;
        if (s.dataset.cw === 'region') { this.perRegion[this.region] = this.tiles.map(t => t.src); this.loadRegion(s.value, true); return; }
        const i = +s.dataset.cw.split(':')[1];
        this.focus = i; this._setTile(i, s.value); this._loadAll();
      });
      this._drag(p);
      document.body.appendChild(p);
      this.panel = p;
    }
    this.panel.style.display = 'block';
    this.panel.querySelector('[data-cw="region"]').value = this.region;
    this._placeSaved();
    this._renderSelects();
    this._applyLayout();
    this._renderFoot();
  },
  _applyLayout() {
    if (!this.panel) return;
    if (this.layout === 1) this.focus = 0; // the only visible tile is the one ⚠ LOG and globe pins act on
    this.panel.classList.toggle('cw-one', this.layout === 1);
    this.panel.classList.toggle('cw-min', this.minimized);
    this.panel.querySelector('[data-cw="layout"]').textContent = this.layout === 4 ? '▢ 1' : '▦ 4';
    const all = this.panel.querySelector('[data-cw="all"]');
    all.textContent = this.allLive ? 'LIVE: ALL' : 'LIVE: 1';
    all.style.display = this.layout === 1 ? 'none' : '';
    this.panel.querySelector('[data-cw="min"]').textContent = this.minimized ? '+' : '–';
    this._loadAll();
  },
  _renderSelects() {
    if (!this.panel) return;
    const camOpts = this.cams.map(c => `<option value="yt:${esc(c.id)}"${this._playable(c) ? '' : ' disabled'}>${esc(c.city)} · ${esc(c.name)}${this._playable(c) ? '' : ' (offline)'}</option>`).join('');
    const byCountry = {};
    this.windy.filter(w => this._windyOk(w)).slice(0, CAM_WALL.maxWindyOptions).forEach(w => { (byCountry[w.country || 'Other'] = byCountry[w.country || 'Other'] || []).push(w); });
    const windyOpts = Object.keys(byCountry).sort().map(k => `<optgroup label="Windy · ${esc(k)}">${byCountry[k].map(w => `<option value="windy:${esc(w.id)}">${w.live ? '● ' : ''}${esc(String(w.title).slice(0, 48))}</option>`).join('')}</optgroup>`).join('');
    const html = (camOpts ? `<optgroup label="Stationary cams (streamed by their owners)">${camOpts}</optgroup>` : '') + windyOpts + '<option value="">— no camera —</option>';
    this.panel.querySelectorAll('select[data-cw^="sel:"]').forEach(s => {
      const i = +s.dataset.cw.split(':')[1];
      s.innerHTML = html;
      s.value = (this.tiles[i] || {}).src || '';
    });
  },
  _renderFoot() {
    if (!this.panel) return;
    const k = this.keys || {}, ok = this.cams.filter(c => this._playable(c)).length;
    const chip = (on, t) => `<b style="color:${on ? '#3FB950' : '#E8B339'}">${t}</b>`;
    this.panel.querySelector('.cw-ft').innerHTML = `${chip(ok > 0, ok + ' STATIONARY CAM' + (ok === 1 ? '' : 'S'))} · ${chip(k.windy, k.windy ? 'WINDY ' + this.windy.length + ' WEBCAMS' : 'WINDY OFF — add WINDY_API_KEY')} · ${chip(k.youtube, k.youtube ? 'STREAM IDS AUTO-REFRESH' : 'STREAM IDS FIXED (YOUTUBE_API_KEY refreshes them)')}`
      + ` · <b style="color:#ff6b35">${this.anoms.length} ANOMAL${this.anoms.length === 1 ? 'Y' : 'IES'} ON THIS DEVICE</b>${this.anoms.length ? ' <button data-cw="copylog" title="Copy the anomaly log as text">COPY LOG</button>' : ''}<br>`
      + `Only the selected tile plays live (LIVE: ALL plays every tile, heavier) · stills refresh every 5 min · streams play in YouTube's player and belong to their channels · no news channels or restreams · <a href="https://www.windy.com/webcams" target="_blank" rel="noopener noreferrer">Webcams by Windy.com</a>`;
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
