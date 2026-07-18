// ============================================================
// BDOC P77 MODULE: layers-arcgis.js
// Generic ArcGIS FeatureServer → Cesium adapter + HIFLD/EIA
// infrastructure layers (grid, pipelines) fed by LIVE public
// federal feature services — the same sourcing pattern S2
// Underground uses, minus the Esri stack.
//
// Adapter: ARCGIS.fetchGeoJSON(serviceUrl, opts) — any public
// FeatureServer layer becomes a config line, not an integration.
// Services queried browser-direct (services2.arcgis.com sends
// Access-Control-Allow-Origin:* — no proxy needed), results
// cached in localStorage for 7 days (infrastructure is static).
//
// Depends on shared lexical env at call time: V, Cesium, layers,
// esc, af, us, EventLog + ent arrays declared in index.html:
//   gridinfraEnts, pipelineEnts
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

// ═══ GENERIC ADAPTER ═══
window.ARCGIS = {
  _CACHE_TTL: 7 * 24 * 3600 * 1000, // 7 days — HIFLD/EIA infra is near-static

  // Build a FeatureServer query URL. opts: where, outFields, precision,
  // maxOffset (line generalization, degrees), count (resultRecordCount), offset
  buildUrl(serviceUrl, opts) {
    opts = opts || {};
    const p = new URLSearchParams({
      where: opts.where || '1=1',
      outFields: opts.outFields || '*',
      f: 'geojson',
      geometryPrecision: String(opts.precision != null ? opts.precision : 3),
      outSR: '4326'
    });
    if (opts.maxOffset) p.set('maxAllowableOffset', String(opts.maxOffset));
    if (opts.count) p.set('resultRecordCount', String(opts.count));
    if (opts.offset) p.set('resultOffset', String(opts.offset));
    return serviceUrl.replace(/\/+$/, '') + '/query?' + p.toString();
  },

  // Fetch one layer as GeoJSON with pagination + localStorage cache.
  // cacheKey: short string; pages: max pages of `count` records (default 3).
  async fetchGeoJSON(serviceUrl, opts) {
    opts = opts || {};
    const cacheKey = 'bdoc_arcgis_' + (opts.cacheKey || serviceUrl.slice(-40));
    // cache hit?
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const c = JSON.parse(raw);
        if (Date.now() - c.t < this._CACHE_TTL && c.d && c.d.features) return c.d;
      }
    } catch (_) {}

    const count = opts.count || 1000;
    const maxPages = opts.pages || 3;
    const all = { type: 'FeatureCollection', features: [] };
    for (let page = 0; page < maxPages; page++) {
      const url = this.buildUrl(serviceUrl, Object.assign({}, opts, { count: count, offset: page * count }));
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error('ArcGIS HTTP ' + res.status);
      const d = await res.json();
      if (d.error) throw new Error('ArcGIS: ' + (d.error.message || 'query error'));
      const feats = d.features || [];
      all.features.push.apply(all.features, feats);
      if (feats.length < count) break; // last page
    }
    // cache (best-effort — payload may exceed quota; that's fine)
    try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d: all })); } catch (_) {}
    return all;
  }
};

const _HIFLD = 'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services';

// ═══ US POWER GRID INFRASTRUCTURE (HIFLD live) ═══
// High-voltage transmission backbone ≥345kV. This is the grid-down /
// resilience layer: what fails, where it fails, what it feeds.
window.loadGridInfra = async function () {
  gridinfraEnts.forEach(e => V.entities.remove(e)); gridinfraEnts = [];
  try {
    const [tl500, tl345] = await Promise.all([
      ARCGIS.fetchGeoJSON(_HIFLD + '/US_Electric_Power_Transmission_Lines/FeatureServer/0', {
        where: 'VOLTAGE >= 500', outFields: 'VOLTAGE,OWNER,VOLT_CLASS,SUB_1,SUB_2',
        maxOffset: 0.01, cacheKey: 'tl500', pages: 2
      }),
      ARCGIS.fetchGeoJSON(_HIFLD + '/US_Electric_Power_Transmission_Lines/FeatureServer/0', {
        where: 'VOLTAGE >= 345 AND VOLTAGE < 500', outFields: 'VOLTAGE,OWNER,SUB_1,SUB_2',
        maxOffset: 0.02, cacheKey: 'tl345', pages: 3
      })
    ]);
    let n = 0;
    const addLines = (fc, color, width, tier) => {
      const clr = Cesium.Color.fromCssColorString(color);
      fc.features.forEach(f => {
        const g = f.geometry; if (!g) return;
        const paths = g.type === 'LineString' ? [g.coordinates] : (g.type === 'MultiLineString' ? g.coordinates : []);
        const pr = f.properties || {};
        paths.forEach(path => {
          if (!path || path.length < 2) return;
          const flat = [];
          for (let i = 0; i < path.length; i++) { flat.push(path[i][0], path[i][1]); }
          gridinfraEnts.push(V.entities.add({
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(flat),
              width: width, material: clr.withAlpha(0.75), clampToGround: true
            },
            description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:10px;color:#c8ccd6;background:#0d1117;border:1px solid ' + color + '">' +
              '<div style="font-size:12px;font-weight:700;color:' + color + ';margin-bottom:6px">⚡ ' + tier + ' TRANSMISSION LINE</div>' +
              '<div style="font-size:10px">Voltage: <b>' + esc(String(pr.VOLTAGE || '?')) + ' kV</b></div>' +
              (pr.OWNER && pr.OWNER !== 'NOT AVAILABLE' ? '<div style="font-size:10px">Owner: ' + esc(pr.OWNER) + '</div>' : '') +
              (pr.SUB_1 && pr.SUB_1 !== 'NOT AVAILABLE' ? '<div style="font-size:10px">Route: ' + esc(pr.SUB_1) + ' → ' + esc(pr.SUB_2 || '?') + '</div>' : '') +
              '<div style="font-size:8px;color:#8b949e;margin-top:6px">Source: HIFLD / DHS — live federal data</div></div>',
            show: layers.gridinfra
          }));
          n++;
        });
      });
    };
    addLines(tl500, '#DA3633', 2.2, 'EHV 500kV+'); // extra-high voltage = red, the strategic backbone
    addLines(tl345, '#E8B339', 1.3, '345kV');       // amber = high-voltage regional
    af('#E8B339', 'GRID: ' + n + ' HV transmission segments loaded (HIFLD live, 345kV+)'); us(1);
    try { EventLog.add('info', 'Grid infra: ' + n + ' segments (HIFLD)'); } catch (_) {}
  } catch (e) {
    console.warn('[GridInfra]', e);
    af('var(--yl)', 'Grid infrastructure: HIFLD feed unavailable — ' + e.message);
  }
};

// ═══ US ENERGY PIPELINES (EIA live) ═══
// Hydrocarbon gas liquids + petroleum product pipelines — the fuel arteries.
window.loadPipelines = async function () {
  pipelineEnts.forEach(e => V.entities.remove(e)); pipelineEnts = [];
  try {
    const [hgl, petro] = await Promise.all([
      ARCGIS.fetchGeoJSON(_HIFLD + '/Hydrocarbon_Gas_Liquids_Pipelines_1/FeatureServer/0', {
        outFields: 'Opername,Pipename', maxOffset: 0.02, cacheKey: 'hgl', pages: 1
      }),
      ARCGIS.fetchGeoJSON(_HIFLD + '/Petroleum_Products_Pipelines_1/FeatureServer/0', {
        outFields: 'Opername,Pipename', maxOffset: 0.02, cacheKey: 'petro', pages: 1
      })
    ]);
    let n = 0;
    const addPipes = (fc, color, label) => {
      const clr = Cesium.Color.fromCssColorString(color);
      fc.features.forEach(f => {
        const g = f.geometry; if (!g) return;
        const paths = g.type === 'LineString' ? [g.coordinates] : (g.type === 'MultiLineString' ? g.coordinates : []);
        const pr = f.properties || {};
        paths.forEach(path => {
          if (!path || path.length < 2) return;
          const flat = [];
          for (let i = 0; i < path.length; i++) { flat.push(path[i][0], path[i][1]); }
          pipelineEnts.push(V.entities.add({
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(flat),
              width: 1.6, material: new Cesium.PolylineDashMaterialProperty({ color: clr.withAlpha(0.8), dashLength: 12 }),
              clampToGround: true
            },
            description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:10px;color:#c8ccd6;background:#0d1117;border:1px solid ' + color + '">' +
              '<div style="font-size:12px;font-weight:700;color:' + color + ';margin-bottom:6px">' + label + '</div>' +
              (pr.Pipename ? '<div style="font-size:11px;font-weight:600">' + esc(pr.Pipename) + '</div>' : '') +
              (pr.Opername ? '<div style="font-size:10px;margin-top:4px">Operator: ' + esc(pr.Opername) + '</div>' : '') +
              '<div style="font-size:8px;color:#8b949e;margin-top:6px">Source: EIA via HIFLD — live federal data</div></div>',
            show: layers.pipelines
          }));
          n++;
        });
      });
    };
    addPipes(hgl, '#FF8C00', '⛽ HGL PIPELINE (NGL/propane)');
    addPipes(petro, '#c084fc', '🛢 PETROLEUM PRODUCTS PIPELINE');
    af('#FF8C00', 'PIPELINES: ' + n + ' segments loaded (EIA live — HGL + petroleum products)'); us(1);
    try { EventLog.add('info', 'Pipelines: ' + n + ' segments (EIA)'); } catch (_) {}
  } catch (e) {
    console.warn('[Pipelines]', e);
    af('var(--yl)', 'Pipelines: EIA feed unavailable — ' + e.message);
  }
};
