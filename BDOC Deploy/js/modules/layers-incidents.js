// ============================================================
// BDOC MODULE: layers-incidents.js
// INCIDENT ARCHIVE — every located violent event GDELT coded since 2026-02-28.
//
// War Room shows a rolling few hours. This keeps the whole record: static shards in
// /data/incidents plus whatever incidents-tick has gathered since they were built.
// Tens of thousands of dots would stall the entity API, so these are drawn in one
// PointPrimitiveCollection and cards are built only when a dot is clicked.
//
// A dot is a cluster of news reports at one place on one day. It is not a confirmed
// strike, and the panel and card both say so.
// Depends on shared lexical env: V, Cesium, layers, esc, af, us.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

(function () {
  const BASE = '/data/incidents/';
  const LIVE = '/.netlify/functions/incidents-recent';
  const DEFAULT_THEATERS = ['iran', 'levant', 'ukraine', 'redsea', 'sudan', 'sahel', 'myanmar'];

  const typeOf = (code) => {
    const c = String(code), root = c.slice(0, 2);
    if (root === '20') return { label: 'MASS VIOLENCE', color: '#ff2d78' };
    if (c.startsWith('195')) return { label: 'AIR / DRONE STRIKE', color: '#ff6b35' };
    if (c === '194') return { label: 'NAVAL / BLOCKADE', color: '#00b4d8' };
    if (c === '193') return { label: 'GROUND CLASH', color: '#DA3633' };
    if (c === '196') return { label: 'WMD / CBRN', color: '#ff2d78' };
    if (c === '186') return { label: 'ASSASSINATION', color: '#E8B339' };
    if (c.startsWith('183')) return { label: 'BOMBING / IED', color: '#ff6b35' };
    if (root === '18') return { label: 'ASSAULT / ATTACK', color: '#E8B339' };
    return { label: 'ARMED ENGAGEMENT', color: '#DA3633' };
  };

  const st = window.BDOCIncidents = {
    index: null, loaded: {}, points: null, handler: null, panel: null,
    filter: { theater: 'iran', days: 0, multiOnly: false }, all: []
  };

  const ymdNum = (ms) => +new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

  async function loadShard(id) {
    if (st.loaded[id]) return st.loaded[id];
    // The service worker is cache-first here, so a rebuild needs a new URL to be seen.
    const r = await fetch(BASE + id + '.json?v=' + encodeURIComponent(st.index.generated));
    if (!r.ok) throw new Error('shard ' + id + ' ' + r.status);
    const d = await r.json();
    const rows = d.rows.map(x => {
      const [place, cc] = d.places[x[4]].split('\u0001');
      return { day: x[0], lat: x[1], lon: x[2], code: d.codes[x[3]], place, cc,
               city: !!x[5], a: x[6], m: x[7], s: x[8], url: x[9], th: id };
    });
    st.loaded[id] = rows;
    return rows;
  }

  async function loadRecent() {
    try {
      const r = await fetch(LIVE + '?since=' + st.index.to, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return [];
      const d = await r.json();
      st.liveUpdated = d.updated;
      const out = [];
      const boxes = st.index.theaters.filter(t => t.box);
      Object.entries(d.days || {}).forEach(([ymd, rows]) => {
        if (+ymd <= +st.index.to) return;   // already in the shards
        rows.forEach(e => {
          const t = boxes.find(b => e.lon >= b.box[0] && e.lon <= b.box[2] && e.lat >= b.box[1] && e.lat <= b.box[3]);
          out.push({ day: +ymd, lat: e.lat, lon: e.lon, code: e.code, place: e.place, cc: e.cc,
                     city: e.prec === 'city', a: e.a, m: e.m, s: e.s, url: e.url, th: t ? t.id : 'world' });
        });
      });
      return out;
    } catch (_) { return []; }
  }

  function visible() {
    const f = st.filter;
    const cut = f.days ? ymdNum(Date.now() - f.days * 864e5) : 0;
    return st.all.filter(e =>
      (f.theater === 'all' || e.th === f.theater) &&
      e.day >= cut && (!f.multiOnly || e.a >= 2));
  }

  function draw() {
    if (st.points) { V.scene.primitives.remove(st.points); st.points = null; }
    const rows = visible();
    const pts = st.points = V.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    const colors = {};
    rows.forEach(e => {
      const t = typeOf(e.code);
      const col = colors[t.color] = colors[t.color] || Cesium.Color.fromCssColorString(t.color).withAlpha(0.8);
      const p = pts.add({
        position: Cesium.Cartesian3.fromDegrees(e.lon, e.lat),
        pixelSize: e.a >= 5 ? 7 : e.a >= 2 ? 5 : 4,
        color: col,
        scaleByDistance: new Cesium.NearFarScalar(3e5, 1.4, 1.5e7, 0.5),
        disableDepthTestDistance: 5e6
      });
      p.bdocIncident = e;
    });
    renderPanel(rows);
    V.scene.requestRender();
    us(1);
  }

  function card(e) {
    const t = typeOf(e.code);
    const d = String(e.day);
    const when = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
    const link = /^https?:\/\//i.test(e.url || '') ? e.url : '';
    return '<div style="font-family:\'JetBrains Mono\',monospace;background:#0a0e14;border:1px solid ' + t.color + ';max-width:430px;color:#c8ccd6;padding:10px 12px">' +
      '<div style="display:flex;justify-content:space-between;font-size:9px;font-weight:700;color:' + t.color + ';letter-spacing:1.5px;margin-bottom:7px"><span>' + esc(t.label) + '</span><span style="color:#8b949e">' + esc(when) + '</span></div>' +
      '<div style="font-size:11.5px;font-weight:700;color:#e6edf3;margin-bottom:6px">📍 ' + esc(e.place || 'Location unknown') + '</div>' +
      '<div style="font-size:8.5px;color:#8b949e;margin-bottom:7px">' + (e.city ? 'CITY' : 'PROVINCE') + '-LEVEL GEOCODE · ' + e.a + (e.a === 1 ? ' article' : ' articles') + ' · ' + e.m + ' mentions</div>' +
      (e.a >= 2 ? '' : '<div style="font-size:8.5px;color:#E8B339;margin-bottom:7px">SINGLE ARTICLE: unconfirmed</div>') +
      (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;font-size:9px;color:#00ddff;text-decoration:none;border:1px solid #00ddff55;padding:3px 8px;margin-bottom:7px">READ SOURCE ARTICLE →</a>' : '') +
      '<div style="font-size:8px;color:#4a5068;border-top:1px solid #21262d;padding-top:6px">Machine-coded from news by GDELT. One dot is a cluster of reports at one place on one day, not a confirmed strike. Location can be wrong. CAMEO ' + esc(e.code) + '</div></div>';
  }

  function onClick(click) {
    const hit = V.scene.pick(click.position);
    const e = hit && hit.primitive && hit.primitive.bdocIncident;
    if (!e) return;
    // The viewer clears its selection on a non-entity pick, so this runs after it.
    setTimeout(() => {
      V.selectedEntity = new Cesium.Entity({
        name: typeOf(e.code).label + ' · ' + (e.place || ''),
        position: Cesium.Cartesian3.fromDegrees(e.lon, e.lat),
        description: card(e)
      });
    }, 0);
  }

  function dayBars(rows) {
    const byDay = {};
    rows.forEach(e => { byDay[e.day] = (byDay[e.day] || 0) + 1; });
    const keys = Object.keys(byDay).sort();
    const max = Math.max(1, ...Object.values(byDay));
    return keys.map(k => '<i title="' + k + ': ' + byDay[k] + '" style="flex:1;min-width:1px;background:#DA3633;height:' +
      Math.max(2, Math.round(byDay[k] / max * 34)) + 'px"></i>').join('');
  }

  function renderPanel(rows) {
    const el = st.panel;
    if (!el) return;
    const types = {};
    rows.forEach(e => { const l = typeOf(e.code).label; types[l] = (types[l] || 0) + 1; });
    const multi = rows.filter(e => e.a >= 2).length;
    const opt = (v, l, cur) => '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
    const f = st.filter;
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="color:#ff6b6b;letter-spacing:1px">INCIDENT ARCHIVE</b>' +
      '<button data-x style="background:none;border:0;color:#8b949e;cursor:pointer;font:inherit">✕</button></div>' +
      '<select data-th style="width:100%;margin-bottom:4px;background:#0a0e14;color:#c8ccd6;border:1px solid #1e2436;font:inherit">' +
        st.index.theaters.map(t => opt(t.id, t.name, f.theater)).join('') + opt('all', 'ALL THEATERS', f.theater) + '</select>' +
      '<div style="display:flex;gap:4px;margin-bottom:6px"><select data-days style="flex:1;background:#0a0e14;color:#c8ccd6;border:1px solid #1e2436;font:inherit">' +
        opt(0, 'Since Feb 28', f.days) + opt(30, 'Last 30 days', f.days) + opt(7, 'Last 7 days', f.days) + opt(1, 'Last 24 hours', f.days) + '</select>' +
      '<label style="display:flex;gap:3px;align-items:center;white-space:nowrap"><input data-multi type="checkbox"' + (f.multiOnly ? ' checked' : '') + '>2+ articles</label></div>' +
      '<div style="font-size:18px;font-weight:700;color:#e6edf3">' + rows.length.toLocaleString() + '</div>' +
      '<div style="color:#8b949e;margin-bottom:5px">report clusters · ' + multi.toLocaleString() + ' with 2+ articles</div>' +
      '<div style="display:flex;align-items:flex-end;gap:0;height:36px;margin-bottom:6px">' + dayBars(rows) + '</div>' +
      Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
        '<div style="display:flex;justify-content:space-between"><span>' + esc(k) + '</span><b>' + v.toLocaleString() + '</b></div>').join('') +
      '<div style="color:#E8B339;margin-top:6px;line-height:1.4">These count news report clusters, not confirmed strikes. Use them for where and when, not as a strike total.</div>' +
      '<div style="color:#4a5068;margin-top:4px">GDELT · archive to ' + esc(st.index.to) + (st.liveUpdated ? ' · live ' + esc(st.liveUpdated.slice(11, 16)) + 'Z' : ' · live feed not yet reporting') + '</div>';
    el.querySelector('[data-x]').onclick = () => { const b = document.querySelector('.ly[data-layer="incidents"]'); if (b) togLy(b); };
    el.querySelector('[data-th]').onchange = async (ev) => {
      f.theater = ev.target.value;
      await ensureLoaded();
      draw();
    };
    el.querySelector('[data-days]').onchange = (ev) => { f.days = +ev.target.value; draw(); };
    el.querySelector('[data-multi]').onchange = (ev) => { f.multiOnly = ev.target.checked; draw(); };
  }

  async function ensureLoaded() {
    const want = st.filter.theater === 'all' ? DEFAULT_THEATERS.concat('world') : [st.filter.theater];
    await Promise.all(want.map(loadShard));
    const recent = st.recent || [];
    st.all = Object.values(st.loaded).flat().concat(recent);
  }

  window.loadIncidents = async function () {
    if (!st.index) {
      const r = await fetch(BASE + 'index.json?t=' + Math.floor(Date.now() / 216e5));
      if (!r.ok) throw new Error('incident index ' + r.status);
      st.index = await r.json();
    }
    if (!st.panel) {
      const el = st.panel = document.createElement('div');
      // Desktop sits beside the layer rail, clear of the middle of the globe.
      // p168: on desktop, under the top-bar menus (100) and the map menu (200) so they open over it.
      const place = window.innerWidth >= 900 ? 'left:220px;top:96px;z-index:60;' : 'left:16px;bottom:64px;z-index:900;';
      el.style.cssText = 'position:fixed;' + place + 'width:min(300px,calc(100vw - 32px));max-height:60vh;overflow:auto;padding:10px 12px;background:rgba(10,14,20,.94);border:1px solid #DA363366;font:10px "JetBrains Mono",monospace;color:#c8ccd6';
      document.body.appendChild(el);
    }
    st.panel.style.display = 'block';
    st.recent = await loadRecent();
    await ensureLoaded();
    draw();
    if (!st.handler) {
      st.handler = new Cesium.ScreenSpaceEventHandler(V.scene.canvas);
      st.handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }
    if (!window.loadIncidents._interval) {
      window.loadIncidents._interval = setInterval(async () => {
        if (!layers.incidents) return;
        st.recent = await loadRecent();
        await ensureLoaded();
        draw();
      }, 5 * 60 * 1000);
    }
    af('#DA3633', 'INCIDENT ARCHIVE: ' + visible().length.toLocaleString() + ' report clusters plotted');
  };

  window.unloadIncidents = function () {
    if (st.points) { V.scene.primitives.remove(st.points); st.points = null; }
    if (st.panel) st.panel.style.display = 'none';
    if (st.handler) { st.handler.destroy(); st.handler = null; }
    if (window.loadIncidents._interval) { clearInterval(window.loadIncidents._interval); window.loadIncidents._interval = null; }
    V.scene.requestRender();
  };
})();
