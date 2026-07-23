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
  _CACHE_TTL: 7 * 24 * 3600 * 1000, // default 7 days — HIFLD/EIA infra is near-static

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

  // P85: in-flight request dedupe. Two consumers hitting the same cacheKey
  // concurrently (e.g. NIFC auto-load + fireperims layer, both WFIGS) would
  // otherwise double-fetch on a cold cache and 429 each other — WFIGS has a
  // shared global per-minute quota. Same cacheKey in flight → share the promise.
  _inflight: {},

  // Fetch one layer as GeoJSON with pagination + localStorage cache.
  // cacheKey: short string; pages: max pages of `count` records (default 3).
  async fetchGeoJSON(serviceUrl, opts) {
    opts = opts || {};
    const dedupeKey = 'bdoc_arcgis_' + (opts.cacheKey || serviceUrl.slice(-40));
    if (this._inflight[dedupeKey]) return this._inflight[dedupeKey];
    const p = this._fetchGeoJSON(serviceUrl, opts, dedupeKey);
    this._inflight[dedupeKey] = p;
    try { return await p; } finally { delete this._inflight[dedupeKey]; }
  },

  async _fetchGeoJSON(serviceUrl, opts, cacheKey) {
    const ttl = opts.ttl != null ? opts.ttl : this._CACHE_TTL; // per-layer TTL: live feeds pass short ttl
    // cache hit? (keep stale copy around as a fallback if the live fetch 429s/fails)
    let stale = null;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const c = JSON.parse(raw);
        if (c.d && c.d.features) {
          if (Date.now() - c.t < ttl) return c.d;
          stale = c.d; // expired but usable in an emergency
        }
      }
    } catch (_) {}

    const count = opts.count || 1000;
    const maxPages = opts.pages || 3;
    const all = { type: 'FeatureCollection', features: [] };
    // P84: retry each page up to 2 extra times with backoff. Prod smoke tests
    // showed transient 'Failed to fetch' on first load (cold DNS/TLS or brief
    // arcgis.com hiccup) killing whole layers (powerplants EIA, gridinfra)
    // while identical requests succeeded seconds later.
    const fetchPage = async (url) => {
      let lastErr;
      for (let att = 0; att < 3; att++) {
        // P94: 429s (shared per-minute quotas on public services like WFIGS)
        // need a longer backoff than transient network errors — quota resets
        // per minute, so 1.5s retries just burn attempts.
        if (att) await new Promise(r => setTimeout(r, /Too many requests|429/i.test(String(lastErr && lastErr.message)) ? att * 12000 : att * 1500));
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
          if (!res.ok) throw new Error('ArcGIS HTTP ' + res.status);
          const d = await res.json();
          if (d.error) throw new Error('ArcGIS: ' + (d.error.message || 'query error'));
          return d;
        } catch (e) { lastErr = e; }
      }
      throw lastErr;
    };
    try {
      for (let page = 0; page < maxPages; page++) {
        const url = this.buildUrl(serviceUrl, Object.assign({}, opts, { count: count, offset: page * count }));
        const d = await fetchPage(url);
        const feats = d.features || [];
        all.features.push.apply(all.features, feats);
        if (feats.length < count) break; // last page
      }
    } catch (e) {
      // Upstream 429/outage: serve the stale cache rather than an empty layer
      // (WFIGS et al. are shared public services with per-minute global quotas)
      if (stale) { console.warn('[ARCGIS] live fetch failed, serving stale cache for', cacheKey, e.message); return stale; }
      throw e;
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

// ═══ METAR SURFACE OBSERVATIONS (NOAA/Esri live, ~15 min refresh) ═══
// 5,500+ global weather stations: wind barb direction, speed, gusts, temp, pressure.
// The layer pilots/EMs check before anything else. TTL 15 min.
window.loadMetar = async function () {
  metarEnts.forEach(e => V.entities.remove(e)); metarEnts = [];
  try {
    const fc = await ARCGIS.fetchGeoJSON(
      'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/NOAA_METAR_current_wind_speed_direction_v1/FeatureServer/0', {
        where: 'WIND_SPEED IS NOT NULL', outFields: 'ICAO,STATION_NAME,COUNTRY,TEMP,WIND_DIRECT,WIND_SPEED,WIND_GUST,VISIBILITY,PRESSURE,WEATHER',
        precision: 2, count: 2000, pages: 1, cacheKey: 'metar', ttl: 15 * 60 * 1000
      });
    let n = 0;
    const windColor = s => s >= 35 ? '#DA3633' : s >= 22 ? '#FF8C00' : s >= 12 ? '#E8B339' : '#3FB950';
    fc.features.forEach(f => {
      const g = f.geometry; if (!g || g.type !== 'Point') return;
      const pr = f.properties || {};
      const spd = pr.WIND_SPEED || 0;
      const col = windColor(spd);
      const clr = Cesium.Color.fromCssColorString(col);
      metarEnts.push(V.entities.add({
        position: Cesium.Cartesian3.fromDegrees(g.coordinates[0], g.coordinates[1]),
        point: { pixelSize: spd >= 22 ? 6 : 4, color: clr.withAlpha(0.85), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, disableDepthTestDistance: 5e6, scaleByDistance: new Cesium.NearFarScalar(5e5, 1.1, 1e7, 0.35) },
        description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:10px;color:#c8ccd6;background:#0d1117;border:1px solid ' + col + '">' +
          '<div style="font-size:12px;font-weight:700;color:' + col + ';margin-bottom:6px">🌬 METAR — ' + esc(pr.ICAO || '?') + '</div>' +
          '<div style="font-size:11px;font-weight:600">' + esc(pr.STATION_NAME || 'Station') + '</div>' +
          '<div style="font-size:10px;margin-top:4px">Wind: <b>' + esc(String(pr.WIND_DIRECT || 0)) + '° @ ' + spd + ' kt' + (pr.WIND_GUST ? ' G' + pr.WIND_GUST : '') + '</b></div>' +
          (pr.TEMP != null ? '<div style="font-size:10px">Temp: ' + pr.TEMP + '°F</div>' : '') +
          (pr.PRESSURE ? '<div style="font-size:10px">Pressure: ' + pr.PRESSURE + ' hPa</div>' : '') +
          (pr.WEATHER ? '<div style="font-size:10px">Wx: ' + esc(pr.WEATHER) + '</div>' : '') +
          '<div style="font-size:8px;color:#8b949e;margin-top:6px">Source: NOAA METAR via Esri Living Atlas — live</div></div>',
        show: layers.metar
      }));
      n++;
    });
    af('#3FB950', 'METAR: ' + n + ' live surface observations loaded (NOAA)'); us(1);
  } catch (e) { console.warn('[METAR]', e); af('var(--yl)', 'METAR: feed unavailable — ' + e.message); }
};

// ═══ DART TSUNAMI BUOYS (NOAA NCEI) ═══
// Deep-ocean Assessment and Reporting of Tsunamis — the actual sensor net that
// detects tsunamis in open ocean. 62 stations. Pairs with the GDACS tsunami layer.
window.loadDartBuoys = async function () {
  dartEnts.forEach(e => V.entities.remove(e)); dartEnts = [];
  try {
    const fc = await ARCGIS.fetchGeoJSON(
      'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/Current_DARTs_and_Retrospective_BPR_Deployments/FeatureServer/0', {
        outFields: 'STATION,DESCRIPTION,DEPLOYED,DATA_URL', precision: 2, pages: 1, cacheKey: 'dart', ttl: 24 * 3600 * 1000
      });
    let n = 0;
    fc.features.forEach(f => {
      const g = f.geometry; if (!g || g.type !== 'Point') return;
      const pr = f.properties || {};
      const live = pr.DEPLOYED === 'Y';
      const col = live ? '#00ddff' : '#4a5068';
      const clr = Cesium.Color.fromCssColorString(col);
      dartEnts.push(V.entities.add({
        position: Cesium.Cartesian3.fromDegrees(g.coordinates[0], g.coordinates[1]),
        point: { pixelSize: 7, color: clr.withAlpha(0.9), outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5, disableDepthTestDistance: 5e6 },
        label: { text: '🌊 ' + esc(String(pr.STATION || '')), font: '9px JetBrains Mono', fillColor: clr, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, 14), disableDepthTestDistance: 5e6, scaleByDistance: new Cesium.NearFarScalar(1e6, 1, 2e7, 0) },
        description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:10px;color:#c8ccd6;background:#0d1117;border:1px solid ' + col + '">' +
          '<div style="font-size:12px;font-weight:700;color:' + col + ';margin-bottom:6px">🌊 DART TSUNAMI BUOY ' + esc(String(pr.STATION || '')) + '</div>' +
          '<div style="font-size:10px">' + esc(pr.DESCRIPTION || '') + '</div>' +
          '<div style="font-size:10px;margin-top:4px">Status: <b style="color:' + col + '">' + (live ? 'DEPLOYED — REPORTING' : 'RETROSPECTIVE/BPR') + '</b></div>' +
          (pr.DATA_URL ? '<div style="font-size:9px;margin-top:4px"><a href="' + esc(pr.DATA_URL) + '" target="_blank" style="color:#00ddff">Live station data →</a></div>' : '') +
          '<div style="font-size:8px;color:#8b949e;margin-top:6px">Source: NOAA NCEI — the real tsunami sensor net</div></div>',
        show: layers.dartbuoys
      }));
      n++;
    });
    af('#00ddff', 'DART: ' + n + ' tsunami buoys loaded (NOAA NCEI)'); us(1);
  } catch (e) { console.warn('[DART]', e); af('var(--yl)', 'DART buoys: feed unavailable — ' + e.message); }
};

// ═══ WILDFIRE PERIMETERS (WFIGS Interagency, live) ═══
// Actual burn footprints as polygons — not just hotspots. The layer wildland
// firefighters and EMs actually plan evacuations from. TTL 1h.
window.loadFirePerims = async function () {
  fireperimEnts.forEach(e => V.entities.remove(e)); fireperimEnts = [];
  try {
    // P94: use the _Current VIEW (active incidents only, ~166 feats) with a
    // trivial where — the full historical table + timestamp WHERE cost ~45k
    // ArcGIS request units against a 28.8k/min shared quota → guaranteed 429.
    const fc = await ARCGIS.fetchGeoJSON(
      'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0', {
        // NB: containment lives under attr_PercentContained (poly_PercentContained was removed upstream)
        outFields: 'poly_IncidentName,poly_GISAcres,attr_PercentContained,poly_DateCurrent',
        precision: 4, maxOffset: 0.001, count: 500, pages: 1, cacheKey: 'wfigs', ttl: 3600 * 1000
      });
    let n = 0;
    fc.features.forEach(f => {
      const g = f.geometry; if (!g) return;
      const polys = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : []);
      const pr = f.properties || {};
      const contained = pr.attr_PercentContained || 0;
      // fresh + uncontained = hot red; mostly contained = amber
      const col = contained >= 75 ? '#E8B339' : '#DA3633';
      const clr = Cesium.Color.fromCssColorString(col);
      const desc = '<div style="font-family:\'JetBrains Mono\',monospace;padding:10px;color:#c8ccd6;background:#0d1117;border:1px solid ' + col + '">' +
        '<div style="font-size:12px;font-weight:700;color:' + col + ';margin-bottom:6px">🔥 FIRE PERIMETER — ' + esc(pr.poly_IncidentName || 'Incident') + '</div>' +
        '<div style="font-size:10px">Size: <b>' + Math.round(pr.poly_GISAcres || 0).toLocaleString() + ' acres</b></div>' +
        '<div style="font-size:10px">Containment: <b>' + contained + '%</b></div>' +
        (pr.poly_DateCurrent ? '<div style="font-size:10px">Updated: ' + new Date(pr.poly_DateCurrent).toISOString().slice(0, 16).replace('T', ' ') + 'Z</div>' : '') +
        '<div style="font-size:8px;color:#8b949e;margin-top:6px">Source: WFIGS Interagency — live federal data</div></div>';
      polys.forEach(rings => {
        if (!rings || !rings[0] || rings[0].length < 3) return;
        const flat = [];
        rings[0].forEach(pt => { flat.push(pt[0], pt[1]); });
        fireperimEnts.push(V.entities.add({
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(flat),
            material: clr.withAlpha(0.28),
            outline: false, // outline unsupported on ground-clamped polygons; separate polyline below
          },
          description: desc,
          show: layers.fireperims
        }));
        fireperimEnts.push(V.entities.add({
          polyline: { positions: Cesium.Cartesian3.fromDegreesArray(flat), width: 1.6, material: clr.withAlpha(0.9), clampToGround: true },
          description: desc,
          show: layers.fireperims
        }));
        n++;
      });
    });
    af('#DA3633', 'FIRE PERIMETERS: ' + n + ' active burn footprints loaded (WFIGS, 60-day window)'); us(1);
  } catch (e) { console.warn('[FirePerims]', e); af('var(--yl)', 'Fire perimeters: WFIGS feed unavailable — ' + e.message); }
};

// ═══ US TRANSMISSION SUBSTATIONS (HIFLD, ≥345kV) ═══
// The nodes of the grid — where the 345/500kV backbone terminates and steps
// down. Pairs with gridinfra (the lines). HIFLD national dataset hosted by
// Oregon Explorer (79,687 total; ≥345kV filter → ~2,213 strategic sites).
// Static infrastructure: TTL 7 days.
window.loadSubstations = async function () {
  substationEnts.forEach(e => V.entities.remove(e)); substationEnts = [];
  try {
    const fc = await ARCGIS.fetchGeoJSON(
      'https://services1.arcgis.com/CD5mKowwN6nIaqd8/arcgis/rest/services/project_renewable_us_substations_2022/FeatureServer/10', {
        where: 'MAX_VOLT >= 345', outFields: 'NAME,CITY,STATE,MAX_VOLT,MIN_VOLT,STATUS,LINES',
        precision: 3, count: 2000, pages: 2, cacheKey: 'subst345'
      });
    let n = 0;
    fc.features.forEach(f => {
      const g = f.geometry; if (!g || g.type !== 'Point') return;
      const pr = f.properties || {};
      const kv = pr.MAX_VOLT || 0;
      const ehv = kv >= 500;
      const col = ehv ? '#DA3633' : '#E8B339'; // matches gridinfra line tiers: 500kV+ red, 345kV amber
      const clr = Cesium.Color.fromCssColorString(col);
      const nm = (pr.NAME && !/^UNKNOWN\d*$/i.test(pr.NAME)) ? pr.NAME : ((pr.CITY || 'UNNAMED') + ' SUBSTATION');
      substationEnts.push(V.entities.add({
        position: Cesium.Cartesian3.fromDegrees(g.coordinates[0], g.coordinates[1]),
        point: { pixelSize: ehv ? 7 : 5, color: clr.withAlpha(0.9), outlineColor: Cesium.Color.BLACK, outlineWidth: 1.2, disableDepthTestDistance: 5e6, scaleByDistance: new Cesium.NearFarScalar(5e5, 1.1, 8e6, 0.4) },
        name: '⚡ ' + esc(nm),
        description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:10px;color:#c8ccd6;background:#0d1117;border:1px solid ' + col + '">' +
          '<div style="font-size:12px;font-weight:700;color:' + col + ';margin-bottom:6px">⚡ ' + (ehv ? 'EHV ' : '') + 'TRANSMISSION SUBSTATION</div>' +
          '<div style="font-size:11px;font-weight:600">' + esc(nm) + '</div>' +
          '<div style="font-size:10px;margin-top:4px">Voltage: <b>' + esc(String(kv)) + ' kV</b>' + (pr.MIN_VOLT && pr.MIN_VOLT > 0 ? ' (steps to ' + esc(String(pr.MIN_VOLT)) + ' kV)' : '') + '</div>' +
          (pr.LINES ? '<div style="font-size:10px">Connected lines: <b>' + esc(String(pr.LINES)) + '</b></div>' : '') +
          ((pr.CITY || pr.STATE) ? '<div style="font-size:10px">Location: ' + esc((pr.CITY || '?') + ', ' + (pr.STATE || '?')) + '</div>' : '') +
          (pr.STATUS && pr.STATUS !== 'IN SERVICE' ? '<div style="font-size:10px;color:#FF8C00">Status: ' + esc(pr.STATUS) + '</div>' : '') +
          '<div style="font-size:8px;color:#8b949e;margin-top:6px">Source: HIFLD / DHS — national substation dataset</div></div>',
        show: layers.substations
      }));
      n++;
    });
    af('#E8B339', 'SUBSTATIONS: ' + n + ' HV transmission substations loaded (HIFLD, 345kV+)'); us(1);
    try { EventLog.add('info', 'Substations: ' + n + ' sites (HIFLD)'); } catch (_) {}
  } catch (e) { console.warn('[Substations]', e); af('var(--yl)', 'Substations: HIFLD feed unavailable — ' + e.message); }
};
