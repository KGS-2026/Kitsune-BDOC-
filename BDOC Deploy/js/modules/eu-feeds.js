// ============================================================
// BDOC MODULE: eu-feeds.js
// EUROPEAN OPEN DATA (ENVIRONMENT group), three layers:
//   euwarn     — Meteoalarm official weather warnings, 39 countries (CC BY 4.0, EUMETNET national services)
//   cems       — Copernicus EMS rapid mapping activations worldwide, last 120 days (© European Union, Copernicus EMS)
//   firedanger — GWIS fire danger forecast (Fire Weather Index, ECMWF-based), worldwide, today + 6 days (CC BY 4.0)
// Created 2026-11-05 (p171). Lazy-loaded on the first toggle of any of the three.
// Data: /.netlify/functions/proxy-eu?source=warnings|cems; the fire danger map is a WMS the browser loads directly.
// Depends on (resolved at call time): V, Cesium, layers, esc, safeUrl, af, EventLog
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

var EU_FEEDS_CFG = {
  levels: { 2: { name: 'Yellow', col: '#E8C531' }, 3: { name: 'Orange', col: '#FF8C1A' }, 4: { name: 'Red', col: '#E5383B' } },
  cemsCols: { Flood: '#3A8DDE', Wildfire: '#FF5A1F', Earthquake: '#C9A227', Storm: '#8F6BFF', 'Volcanic activity': '#D6336C', Other: '#9BA1A8' },
  fwiUrl: 'https://maps.effis.emergency.copernicus.eu/gwis',
  fwiLayer: 'ecmwf.fwi',
  fwiDays: 7,
  warnMs: 600000,
  cemsMs: 1800000,
  storeKey: 'bdoc.eufeeds.v1'
};

var EUFeeds = {
  async _j(source) {
    const r = await fetch('/.netlify/functions/proxy-eu?source=' + source, { signal: AbortSignal.timeout(25000) });
    if (!r.ok) { let m = 'HTTP ' + r.status; try { m = (await r.json()).error || m; } catch (_) {} throw new Error(m); }
    return r.json();
  },
  _kick() { try { if (window.BDOCRender) window.BDOCRender.kick(); else if (V) V.scene.requestRender(); } catch (_) {} },
  _t(iso) {
    const d = new Date(iso); if (!iso || isNaN(d)) return '—';
    return d.toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + 'Z';
  },
  _box(col, inner) {
    return `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:380px;background:#0a0e14;padding:12px;border-radius:2px;border:1px solid ${col}55;color:#c8ccd6">${inner}</div>`;
  },
  _store(patch) {
    let s = {}; try { s = JSON.parse(localStorage.getItem(EU_FEEDS_CFG.storeKey) || '{}') || {}; } catch (_) {}
    if (patch) { Object.assign(s, patch); try { localStorage.setItem(EU_FEEDS_CFG.storeKey, JSON.stringify(s)); } catch (_) {} }
    return s;
  },

  // ── Meteoalarm warnings ─────────────────────────────────
  warnings: {
    on: false, ents: [], timer: null, gen: 0, data: null, lastSummary: '',
    start() {
      if (!V || this.on) return;
      this.on = true; const gen = ++this.gen;
      this.load(gen);
      this.timer = setInterval(() => { if (!document.hidden && gen === this.gen) this.load(gen); }, EU_FEEDS_CFG.warnMs);
    },
    stop() {
      this.on = false; this.gen++;
      clearInterval(this.timer); this.timer = null;
      this.clear(); EUFeeds._kick();
    },
    clear() { this.ents.forEach(e => V.entities.remove(e)); this.ents = []; },
    async load(gen) {
      let j;
      try { j = await EUFeeds._j('warnings'); }
      catch (e) { if (gen === this.gen && this.on) af('var(--yl)', 'EU weather warnings unavailable: ' + esc(e.message)); return; }
      if (gen !== this.gen || !this.on) return;
      this.data = j;
      this.draw();
      this.summary();
    },
    summary() {
      const j = this.data, n = { 2: 0, 3: 0, 4: 0 };
      j.warnings.forEach(w => { if (n[w.level] != null) n[w.level]++; });
      const withW = j.countries.filter(c => c.count > 0).length;
      const parts = [4, 3, 2].filter(l => n[l]).map(l => n[l] + ' ' + EU_FEEDS_CFG.levels[l].name.toLowerCase());
      const text = 'EU weather warnings (Meteoalarm): ' + (parts.length ? parts.join(', ') + ' in ' + withW + ' of ' + j.countries.length + ' countries' : 'none at yellow or above in ' + j.countries.length + ' countries')
        + (j.failed && j.failed.length ? ' · not answering: ' + j.failed.join(', ') : '');
      if (text === this.lastSummary) return;
      this.lastSummary = text;
      af(n[4] ? '#E5383B' : n[3] ? '#FF8C1A' : 'var(--gn)', esc(text));
      EventLog.add(n[4] ? 'warn' : 'info', text);
    },
    _line(w) {
      const L = EU_FEEDS_CFG.levels[w.level] || EU_FEEDS_CFG.levels[2];
      const when = w.onset && Date.parse(w.onset) > Date.now() ? 'from ' + EUFeeds._t(w.onset) + ' ' : '';
      const body = `<span style="color:${L.col};font-weight:700">${L.name}</span> · ${esc(w.type)} · ${esc(w.area)} <span style="color:#5C636B">${when}until ${esc(EUFeeds._t(w.expires))}</span>`;
      return w.url ? `<a href="${safeUrl(w.url)}" target="_blank" rel="noopener noreferrer" style="display:block;padding:2px 0;color:#c8ccd6;text-decoration:none">${body}</a>` : `<div style="padding:2px 0">${body}</div>`;
    },
    _badge(cc, count, col) {
      const text = `${cc} ${count}`, w = 14 + text.length * 7;
      return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="18"><rect x="1" y="1" width="${w - 2}" height="16" rx="3" fill="#0a0e14" stroke="${col}" stroke-width="2"/><text x="${w / 2}" y="13" font-family="monospace" font-size="11" font-weight="700" fill="${col}" text-anchor="middle">${text}</text></svg>`);
    },
    draw() {
      this.clear();
      const j = this.data, show = !!layers.euwarn;
      // outlines, where the national service sends them
      j.warnings.filter(w => w.poly).forEach(w => {
        const L = EU_FEEDS_CFG.levels[w.level] || EU_FEEDS_CFG.levels[2], col = Cesium.Color.fromCssColorString(L.col);
        const desc = EUFeeds._box(L.col, `<div style="color:${L.col};font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:6px">⚠ ${L.name.toUpperCase()} WARNING — ${esc(w.type)}</div>
          <div style="font-size:10px;line-height:1.6">${esc(w.area)}<br><span style="color:#7a8194">${esc(w.event)}${w.severity ? ' · ' + esc(w.severity) : ''}</span><br>
          ${w.onset ? 'From ' + esc(EUFeeds._t(w.onset)) + ' · ' : ''}until ${esc(EUFeeds._t(w.expires))}</div>
          ${w.url ? `<a href="${safeUrl(w.url)}" target="_blank" rel="noopener noreferrer" style="display:block;margin-top:8px;padding:6px;border:1px solid ${L.col}55;color:${L.col};text-decoration:none;font-size:10px;text-align:center">Official warning on meteoalarm.org ↗</a>` : ''}
          <div style="margin-top:8px;font-size:8px;color:#5C636B">MeteoAlarm (CC BY 4.0), from the national weather service</div>`);
        w.poly.forEach((ring, i) => {
          this.ents.push(V.entities.add({
            name: `${L.name} warning — ${w.type}`,
            polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(ring.flatMap(p => [p[1], p[0]])), height: 0, material: col.withAlpha(0.28), outline: true, outlineColor: col.withAlpha(0.9) },
            description: desc, show
          }));
        });
      });
      // one badge per country with warnings, listing all of them
      j.countries.filter(c => c.count > 0 && /^[A-Z]{2}$/.test(c.cc)).forEach(c => {
        const list = j.warnings.filter(w => w.cc === c.cc);
        const L = EU_FEEDS_CFG.levels[c.max] || EU_FEEDS_CFG.levels[2];
        const byType = {}; list.forEach(w => { byType[w.type] = (byType[w.type] || 0) + 1; });
        const desc = EUFeeds._box(L.col, `<div style="color:${L.col};font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:4px">⚠ ${esc(c.name.toUpperCase())} — ${list.length} WARNING${list.length === 1 ? '' : 'S'}</div>
          <div style="font-size:9.5px;color:#7a8194;margin-bottom:6px">${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, k]) => esc(t) + ' ' + k).join(' · ')}</div>
          <div style="font-size:9.5px;line-height:1.45;max-height:260px;overflow-y:auto">${list.slice(0, 60).map(w => this._line(w)).join('')}${list.length > 60 ? `<div style="color:#5C636B;padding-top:4px">…and ${list.length - 60} more</div>` : ''}</div>
          <a href="${safeUrl('https://meteoalarm.org?region=' + c.cc)}" target="_blank" rel="noopener noreferrer" style="display:block;margin-top:8px;padding:6px;border:1px solid ${L.col}55;color:${L.col};text-decoration:none;font-size:10px;text-align:center">${esc(c.name)} on meteoalarm.org ↗</a>
          <div style="margin-top:8px;font-size:8px;color:#5C636B">MeteoAlarm (CC BY 4.0). Yellow: be aware · Orange: be prepared · Red: take action.</div>`);
        this.ents.push(V.entities.add({
          name: `${c.name}: ${list.length} weather warning${list.length === 1 ? '' : 's'}`,
          position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat),
          billboard: { image: this._badge(c.cc, list.length, L.col), verticalOrigin: Cesium.VerticalOrigin.CENTER, disableDepthTestDistance: 5e6 },
          description: desc, show
        }));
      });
      EUFeeds._kick();
    }
  },

  // ── Copernicus EMS activations ──────────────────────────
  cems: {
    on: false, ents: [], timer: null, gen: 0, data: null, announced: false,
    start() {
      if (!V || this.on) return;
      this.on = true; const gen = ++this.gen;
      this.load(gen);
      this.timer = setInterval(() => { if (!document.hidden && gen === this.gen) this.load(gen); }, EU_FEEDS_CFG.cemsMs);
    },
    stop() {
      this.on = false; this.gen++; this.announced = false;
      clearInterval(this.timer); this.timer = null;
      this.clear(); EUFeeds._kick();
    },
    clear() { this.ents.forEach(e => V.entities.remove(e)); this.ents = []; },
    async load(gen) {
      let j;
      try { j = await EUFeeds._j('cems'); }
      catch (e) { if (gen === this.gen && this.on) af('var(--yl)', 'Copernicus EMS activations unavailable: ' + esc(e.message)); return; }
      if (gen !== this.gen || !this.on) return;
      this.data = j;
      this.draw();
      if (!this.announced) {
        this.announced = true;
        const a = j.activations[0];
        const text = `Copernicus EMS: ${j.activations.length} satellite mapping activations in the last 120 days` + (a ? ` · newest ${a.code}: ${a.name} (${EUFeeds._t(a.activationTime)})` : '');
        af('var(--gn)', esc(text)); EventLog.add('info', text);
      }
    },
    _icon(col, recent) {
      return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">${recent ? `<circle cx="12" cy="12" r="11" fill="none" stroke="${col}" stroke-width="1.5" stroke-dasharray="3 2"/>` : ''}<rect x="6" y="6" width="12" height="12" rx="2" fill="#0a0e14" stroke="${col}" stroke-width="2"/><path d="M9 15l2-4 2 2 2-4" stroke="${col}" stroke-width="1.6" fill="none"/></svg>`);
    },
    draw() {
      this.clear();
      const show = !!layers.cems, now = Date.now();
      this.data.activations.forEach(a => {
        if (!/^EMSR\d{1,5}$/.test(a.code)) return;
        const col = EU_FEEDS_CFG.cemsCols[a.category] || EU_FEEDS_CFG.cemsCols.Other;
        const recent = a.activationTime && now - Date.parse(a.activationTime) < 14 * 864e5;
        const row = (k, v) => `<tr><td style="color:#5C636B;padding:2px 8px 2px 0;white-space:nowrap">${k}</td><td>${v}</td></tr>`;
        this.ents.push(V.entities.add({
          name: `${a.code} — ${a.name}`,
          position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat),
          billboard: { image: this._icon(col, recent), width: 24, height: 24, verticalOrigin: Cesium.VerticalOrigin.CENTER, disableDepthTestDistance: 5e6 },
          label: { text: a.code, font: 'bold 9px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString(col), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -18), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4e6) },
          description: EUFeeds._box(col, `<div style="color:${col};font-size:12px;font-weight:700;margin-bottom:6px">🛰 ${esc(a.code)} — ${esc(a.name)}</div>
            <table style="width:100%;font-size:10px;border-collapse:collapse">
              ${row('Type', esc(a.category))}${row('Countries', esc(a.countries.join(', ') || '—'))}
              ${row('Event', esc(EUFeeds._t(a.eventTime)))}${row('Activated', esc(EUFeeds._t(a.activationTime)))}${row('Updated', esc(EUFeeds._t(a.lastUpdate)))}
              ${row('Status', a.closed ? 'Closed (maps delivered)' : '<span style="color:#3FB950;font-weight:700">OPEN — mapping in progress</span>')}
              ${a.products != null ? row('Output', `${Number(a.aois) || 0} areas · ${Number(a.products) || 0} map products`) : ''}
            </table>
            <a href="${safeUrl('https://mapping.emergency.copernicus.eu/activations/' + a.code + '/')}" target="_blank" rel="noopener noreferrer" style="display:block;margin-top:10px;padding:7px;background:#06141f;color:${col};border:1px solid ${col}55;border-radius:2px;text-decoration:none;font-size:10px;letter-spacing:1px;font-weight:600;text-align:center">▸ DAMAGE / FLOOD MAPS ON COPERNICUS</a>
            <div style="margin-top:8px;font-size:8px;color:#5C636B">Satellite maps made by the EU on request of national civil protection. © European Union, Copernicus Emergency Management Service.</div>`),
          show
        }));
      });
      EUFeeds._kick();
    }
  },

  // ── GWIS fire danger forecast (WMS) ─────────────────────
  fireDanger: {
    on: false, layer: null, panel: null, day: 0, minimized: false,
    days() {
      const out = [], t0 = Date.now();
      for (let i = 0; i < EU_FEEDS_CFG.fwiDays; i++) {
        const d = new Date(t0 + i * 864e5);
        out.push({ date: d.toISOString().slice(0, 10), label: i === 0 ? 'Today' : d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }) });
      }
      return out;
    },
    start() {
      if (!V || this.on) return;
      this.on = true;
      const s = EUFeeds._store();
      this.day = 0; // a saved day would point at a stale date; start on today
      this.minimized = s.fwiMin === true;
      this._panel();
      this.show(this.day);
    },
    stop() {
      this.on = false;
      if (this.layer) { try { V.imageryLayers.remove(this.layer); } catch (_) {} this.layer = null; }
      if (this.panel) this.panel.style.display = 'none';
      EUFeeds._kick();
    },
    show(i) {
      const d = this.days()[i] || this.days()[0];
      this.day = i;
      if (this.layer) { try { V.imageryLayers.remove(this.layer); } catch (_) {} this.layer = null; }
      const provider = new Cesium.WebMapServiceImageryProvider({
        url: EU_FEEDS_CFG.fwiUrl, layers: EU_FEEDS_CFG.fwiLayer,
        parameters: { transparent: true, format: 'image/png', time: d.date },
        enablePickFeatures: false, maximumLevel: 7,
        credit: 'Fire danger forecast: © European Union, Copernicus EMS / GWIS (CC BY 4.0)'
      });
      this.layer = V.imageryLayers.addImageryProvider(provider);
      this.layer.alpha = 0.62;
      if (this.panel) {
        this.panel.querySelectorAll('[data-fd-day]').forEach(b => b.classList.toggle('on', +b.dataset.fdDay === i));
        this.panel.querySelector('.fd-when').textContent = d.date;
      }
      EUFeeds._kick();
    },
    _panel() {
      if (!this.panel) {
        const css = document.createElement('style');
        css.textContent = '#fireDangerPanel{position:fixed;left:calc(var(--lw,248px) + 16px);bottom:70px;z-index:56;width:268px;background:rgba(8,12,20,0.97);border:1px solid rgba(255,120,40,0.35);border-radius:4px;font-family:var(--m,monospace);color:#c8ccd6;box-shadow:0 4px 24px rgba(0,0,0,0.55)}'
          + '#fireDangerPanel .fd-hd{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid rgba(255,255,255,0.06)}'
          + '#fireDangerPanel.fd-min .fd-body{display:none}'
          + '#fireDangerPanel button{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:2px;color:#9BA1A8;cursor:pointer;font-family:inherit;font-size:8.5px;padding:3px 6px;flex:none}'
          + '#fireDangerPanel .fd-days{display:flex;flex-wrap:wrap;gap:4px;padding:8px 10px 4px}'
          + '#fireDangerPanel .fd-days button.on{color:#ff7828;border-color:#ff782888;background:rgba(255,120,40,0.1)}'
          + '#fireDangerPanel .fd-lg{padding:4px 10px}#fireDangerPanel .fd-lg img{display:block;background:#e8eaed;border-radius:2px;padding:4px 6px}'
          + '#fireDangerPanel .fd-ft{padding:6px 10px 8px;font-size:7.5px;color:#5C636B;line-height:1.5}'
          + '@media(max-width:767px){#fireDangerPanel{left:4px;right:4px;width:auto;top:calc(56px + var(--bnh,0px));bottom:auto}}';
        document.head.appendChild(css);
        const p = document.createElement('div');
        p.id = 'fireDangerPanel';
        // GWIS's own legend, so the classes always match the map (black text: needs a light tile)
        const legend = EU_FEEDS_CFG.fwiUrl + '?language=eng&version=1.3.0&service=WMS&request=GetLegendGraphic&sld_version=1.1.0&layer=' + EU_FEEDS_CFG.fwiLayer + '&format=image/png&STYLE=default';
        p.innerHTML = `<div class="fd-hd"><span style="flex:1;font-size:9.5px;font-weight:700;letter-spacing:1.3px;color:#ff7828">🔥 FIRE DANGER FORECAST</span>
            <span class="fd-when" style="font-size:8px;color:#5C636B"></span><button data-fd="min" title="Minimize"></button><button data-fd="close" title="Turn off">×</button></div>
          <div class="fd-body">
            <div class="fd-days">${this.days().map((d, i) => `<button data-fd-day="${i}">${esc(d.label)}</button>`).join('')}</div>
            <div class="fd-lg"><img src="${safeUrl(legend)}" alt="Fire Weather Index classes: Low under 11.2, Moderate 11.2 to 21.3, High 21.3 to 38, Very high 38 to 50, Extreme 50 to 70, Very extreme over 70" width="146" height="95"></div>
            <div class="fd-ft">Fire Weather Index from ECMWF forecasts: how easily a fire would start and spread, worldwide. It is weather, not a map of fires (Active Fires shows those). On the night side the globe's shading dims the colours: switch off Day/Night cycle in Settings to read them at full strength. © European Union, Copernicus EMS / GWIS, CC BY 4.0.</div>
          </div>`;
        p.addEventListener('click', e => {
          const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.fdDay != null) this.show(+b.dataset.fdDay);
          else if (b.dataset.fd === 'min') { this.minimized = !this.minimized; EUFeeds._store({ fwiMin: this.minimized }); this._applyMin(); }
          else if (b.dataset.fd === 'close') { const ly = document.querySelector('.ly[data-layer="firedanger"]'); if (ly) ly.click(); }
        });
        document.body.appendChild(p);
        this.panel = p;
      } else {
        // dates move on at midnight UTC: rebuild the labels
        this.panel.querySelector('.fd-days').innerHTML = this.days().map((d, i) => `<button data-fd-day="${i}">${esc(d.label)}</button>`).join('');
      }
      this.panel.style.display = 'block';
      this._applyMin();
    },
    _applyMin() {
      this.panel.classList.toggle('fd-min', this.minimized);
      this.panel.querySelector('[data-fd="min"]').textContent = this.minimized ? '+' : '–';
    }
  }
};
window.EUFeeds = EUFeeds;
