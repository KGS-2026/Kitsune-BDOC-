// ============================================================
// BDOC MODULE: layers-gpsjam.js
// GPS INTERFERENCE — where aircraft report degraded GPS, last 24 hours (p167).
//
// Every ADS-B jet reports its own position quality. gps-interference-tick samples
// 32 regions an hour from adsb.lol and counts, per 1-degree cell, how many report
// degraded GPS. This draws those cells: green under 2 %, amber 2-10 %, red over
// 10 % (the gpsjam.org bands). Red means GPS is being jammed or spoofed somewhere
// near that airspace. It does not show where the jammer is, and cells outside the
// sampled regions are simply blank.
// Depends on shared lexical env: V, Cesium, layers, esc, af, togLy.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

(function () {
  const URL_ = '/.netlify/functions/gps-interference';
  const STYLE = {
    high:   { color: '#DA3633', alpha: 0.55, label: 'HIGH',   note: 'over 10 % of aircraft' },
    medium: { color: '#E8B339', alpha: 0.42, label: 'MEDIUM', note: '2-10 % of aircraft' },
    low:    { color: '#2ea043', alpha: 0.16, label: 'LOW',    note: 'under 2 % of aircraft' }
  };
  const st = window.BDOCGpsJam = { data: null, prim: null, handler: null, panel: null, timer: null };

  const deg = (v, pos, neg) => Math.abs(v) + '°' + (v >= 0 ? pos : neg);
  const cellName = (c, size) => deg(c.lat, 'N', 'S') + '–' + deg(c.lat + size, 'N', 'S') + ', ' + deg(c.lon, 'E', 'W') + '–' + deg(c.lon + size, 'E', 'W');

  function draw() {
    if (st.prim) { V.scene.primitives.remove(st.prim); st.prim = null; }
    const d = st.data;
    if (!d || !d.cells || !d.cells.length) { V.scene.requestRender(); return; }
    const size = d.cellDeg || 1;
    const instances = d.cells.map((c) => new Cesium.GeometryInstance({
      geometry: new Cesium.RectangleGeometry({
        rectangle: Cesium.Rectangle.fromDegrees(c.lon, c.lat, c.lon + size, c.lat + size),
        height: 9000,  // above terrain everywhere jets fly, so it never sinks into mountains
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
      }),
      id: { bdocGpsJam: c },
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.fromCssColorString(STYLE[c.level].color).withAlpha(STYLE[c.level].alpha))
      }
    }));
    st.prim = V.scene.primitives.add(new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, closed: false }),
      asynchronous: true
    }));
    V.scene.requestRender();
  }

  function card(c, size) {
    const s = STYLE[c.level];
    return '<div style="font-family:\'JetBrains Mono\',monospace;background:#0a0e14;border:1px solid ' + s.color + ';max-width:400px;color:#c8ccd6;padding:10px 12px">' +
      '<div style="font-size:9px;font-weight:700;color:' + s.color + ';letter-spacing:1.5px;margin-bottom:7px">GPS INTERFERENCE · ' + s.label + '</div>' +
      '<div style="font-size:20px;font-weight:700;color:#e6edf3">' + esc(String(c.pct)) + ' %</div>' +
      '<div style="font-size:10px;margin-bottom:7px">' + c.bad.toLocaleString() + ' of ' + c.total.toLocaleString() + ' aircraft reports showed degraded GPS in the last 24 h</div>' +
      '<div style="font-size:9px;color:#8b949e;margin-bottom:7px">Cell ' + esc(cellName(c, size)) + '</div>' +
      '<div style="font-size:8px;color:#4a5068;border-top:1px solid #21262d;padding-top:6px;line-height:1.5">From the aircraft\'s own ADS-B accuracy reports (NIC / NACp), jets and larger only, sampled hourly from adsb.lol. ' +
      'High readings mean GPS jamming or spoofing affected aircraft in this airspace. They do not show where the jammer is.</div></div>';
  }

  function onClick(click) {
    const hit = V.scene.pick(click.position);
    const c = hit && hit.id && hit.id.bdocGpsJam;
    if (!c) return;
    const size = (st.data && st.data.cellDeg) || 1;
    setTimeout(() => {
      V.selectedEntity = new Cesium.Entity({
        name: 'GPS interference · ' + c.pct + ' %',
        position: Cesium.Cartesian3.fromDegrees(c.lon + size / 2, c.lat + size / 2, 9000),
        description: card(c, size)
      });
    }, 0);
  }

  function renderPanel() {
    const el = st.panel;
    if (!el) return;
    const d = st.data || {};
    const cells = d.cells || [];
    const by = (lv) => cells.filter(c => c.level === lv).length;
    const worst = cells.filter(c => c.level !== 'low').slice(0, 6);
    const size = d.cellDeg || 1;
    const collecting = !d.hours;
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="color:#E8B339;letter-spacing:1px">GPS INTERFERENCE · 24 H</b>' +
      '<button data-x aria-label="Close" style="background:none;border:0;color:#8b949e;cursor:pointer;font:inherit">✕</button></div>' +
      (collecting
        ? '<div style="color:#c8ccd6;line-height:1.5">Collecting. The first samples arrive within 15 minutes, and the full 24-hour picture builds over a day.</div>'
        : '<div style="display:flex;gap:10px;margin-bottom:6px">' +
            ['high', 'medium', 'low'].map(lv => '<div><span style="display:inline-block;width:9px;height:9px;background:' + STYLE[lv].color + ';margin-right:4px"></span><b>' + by(lv) + '</b> ' + STYLE[lv].label.toLowerCase() + '</div>').join('') +
          '</div>' +
          (worst.length
            ? '<div style="color:#8b949e;margin-bottom:3px">Worst cells</div>' + worst.map(c =>
                '<div data-fly="' + c.lat + ',' + c.lon + '" style="display:flex;justify-content:space-between;cursor:pointer;padding:1px 0"><span>' + esc(cellName(c, size)) + '</span><b style="color:' + STYLE[c.level].color + '">' + c.pct + ' %</b></div>').join('')
            : '<div style="color:#2ea043">No cell above 2 % in the last 24 hours.</div>')) +
      '<div style="color:#8b949e;margin-top:6px;line-height:1.4">Share of jets reporting degraded GPS. Red means jamming or spoofing nearby, not where the jammer is. Blank areas were not sampled.</div>' +
      '<div style="color:#4a5068;margin-top:4px">adsb.lol · ' + (d.hours || 0) + ' of 24 hours sampled' + (d.updated ? ' · updated ' + esc(String(d.updated).slice(11, 16)) + 'Z' : '') + '</div>';
    el.querySelector('[data-x]').onclick = () => { const b = document.querySelector('.ly[data-layer="gpsjam"]'); if (b) togLy(b); };
    el.querySelectorAll('[data-fly]').forEach(row => {
      row.onclick = () => {
        const [lat, lon] = row.getAttribute('data-fly').split(',').map(Number);
        V.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon + size / 2, lat + size / 2, 900000), duration: 1.5 });
      };
    });
  }

  async function fetchData() {
    const r = await fetch(URL_, { cache: 'no-store' });
    if (!r.ok) throw new Error('gps-interference ' + r.status);
    st.data = await r.json();
  }

  window.loadGpsJam = async function () {
    if (!st.panel) {
      const el = st.panel = document.createElement('div');
      // p168: on desktop, under the top-bar menus (100) and the map menu (200) so they open over it.
      const place = window.innerWidth >= 900 ? 'left:220px;top:96px;z-index:60;' : 'left:16px;bottom:64px;z-index:900;';
      el.style.cssText = 'position:fixed;' + place + 'width:min(300px,calc(100vw - 32px));max-height:60vh;overflow:auto;padding:10px 12px;background:rgba(10,14,20,.94);border:1px solid #E8B33966;font:10px "JetBrains Mono",monospace;color:#c8ccd6';
      document.body.appendChild(el);
    }
    st.panel.style.display = 'block';
    await fetchData();
    if (!layers.gpsjam) return; // turned off while loading
    draw();
    renderPanel();
    if (!st.handler) {
      st.handler = new Cesium.ScreenSpaceEventHandler(V.scene.canvas);
      st.handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }
    if (!st.timer) {
      st.timer = setInterval(async () => {
        if (!layers.gpsjam) return;
        try { await fetchData(); draw(); renderPanel(); } catch (_) { /* keep the last picture */ }
      }, 10 * 60 * 1000);
    }
    const d = st.data;
    const red = (d.cells || []).filter(c => c.level === 'high').length;
    af('#E8B339', d.hours ? 'GPS INTERFERENCE: ' + red + ' cell' + (red === 1 ? '' : 's') + ' over 10 % in the last 24 h' : 'GPS INTERFERENCE: collecting first samples');
  };

  window.unloadGpsJam = function () {
    if (st.prim) { V.scene.primitives.remove(st.prim); st.prim = null; }
    if (st.panel) st.panel.style.display = 'none';
    if (st.handler) { st.handler.destroy(); st.handler = null; }
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    V.scene.requestRender();
  };
})();
