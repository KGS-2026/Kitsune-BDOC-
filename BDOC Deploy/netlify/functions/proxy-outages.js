// Power grid layer — EIA Form 930 real-time grid monitor (hourly demand vs forecast)
// HISTORY: originally PowerOutage.us county outages. That upstream died twice:
//   Tier 1 county endpoint went key-only (paid), then the public state endpoint
//   (/api/web/stats/StateGeoCount) 404'd after their .us→.com migration (2026-06).
// REPLACEMENT (2026-07, bug-hunt pass 2): US EIA Grid Monitor 930 API — free, no
// key, government source, CORS-blocked from browsers (hence this proxy).
//   - /930-api/respondents/data?type[0]=BA  → BA name, lat/lon, size (radius)
//   - /930-api/region_data/series_data      → hourly Demand (D) + Day-ahead
//     forecast (DF) per balancing authority. Time format: "MMDDYYYY HH24:MI:SS".
// Output: array of grid-node objects {_grid:true, id, name, lat, lon, demandMW,
// forecastMW, stressPct, sizeMW, asOf}. Front-end (loadPowerOutages) renders
// stress-colored grid nodes. Legacy county shape no longer produced.
//
// If POWEROUTAGE_KEY is ever set, Tier 1 county-level outages still take priority.

// Static BA metadata (name/coords/size) — baked in from
// /930-api/respondents/data?type[0]=BA (2026-07-02). Stable reference data;
// baking it removes one of two upstream fetches (both fetches from AWS Lambda
// were blowing Netlify's 10s kill limit — EIA responds slower from AWS).
const BA_META = {
  SWPP:{name:'Southwest Power Pool',lat:37.762,lon:-98.83,radius:28991},
  AECI:{name:'Associated Electric Cooperative, Inc.',lat:38.412,lon:-92.407,radius:2474},
  MISO:{name:'Midcontinent Independent System Operator, Inc.',lat:41.534,lon:-91.808,radius:68805},
  BANC:{name:'Balancing Authority of Northern California',lat:39.24,lon:-121.732,radius:1424},
  CISO:{name:'California Independent System Operator',lat:36.944,lon:-119.534,radius:17733},
  IID:{name:'Imperial Irrigation District',lat:33.231,lon:-115.56,radius:628},
  LDWP:{name:'Los Angeles Department of Water and Power',lat:35.691,lon:-117.672,radius:2571},
  TIDC:{name:'Turlock Irrigation District',lat:37.77,lon:-121.131,radius:201},
  FMPP:{name:'Florida Municipal Power Pool',lat:28.18,lon:-81.355,radius:1869},
  FPL:{name:'Florida Power & Light Co.',lat:27.08,lon:-81.072,radius:13782},
  GVL:{name:'Gainesville Regional Utilities',lat:29.827,lon:-82.583,radius:194},
  JEA:{name:'JEA',lat:30.279,lon:-81.68,radius:1219},
  SEC:{name:'Seminole Electric Cooperative',lat:28.63,lon:-82.38,radius:1153},
  TAL:{name:'City of Tallahassee',lat:30.334,lon:-84.279,radius:304},
  AVA:{name:'Avista Corporation',lat:47.433,lon:-117.323,radius:776},
  BPAT:{name:'Bonneville Power Administration',lat:44.914,lon:-119.671,radius:12459},
  CHPD:{name:'Public Utility District No. 1 of Chelan County',lat:48.569,lon:-120.619,radius:1051},
  DOPD:{name:'PUD No. 1 of Douglas County',lat:48.235,lon:-119.252,radius:510},
  GCPD:{name:'Public Utility District No. 2 of Grant County, Washington',lat:46.78,lon:-118.596,radius:1161},
  IPCO:{name:'Idaho Power Company',lat:43.543,lon:-114.771,radius:1584},
  NEVP:{name:'Nevada Power Company',lat:39.232,lon:-116.598,radius:3305},
  NWMT:{name:'NorthWestern Corporation',lat:46.451,lon:-110.248,radius:2411},
  PACE:{name:'PacifiCorp East',lat:41.039,lon:-110.18,radius:5625},
  PACW:{name:'PacifiCorp West',lat:43.435,lon:-121.406,radius:1866},
  PGE:{name:'Portland General Electric Company',lat:44.863,lon:-123.016,radius:666},
  PSCO:{name:'Public Service Company of Colorado',lat:38.073,lon:-104.299,radius:4504},
  PSEI:{name:'Puget Sound Energy, Inc.',lat:47.315,lon:-121.424,radius:1807},
  SCL:{name:'Seattle City Light',lat:47.822,lon:-123.023,radius:707},
  WACM:{name:'Western Area Power Administration - Rocky Mountain Region',lat:40.361,lon:-104.974,radius:4370},
  WAUW:{name:'Western Area Power Administration - Upper Great Plains West',lat:48.106,lon:-107.683,radius:59},
  AZPS:{name:'Arizona Public Service Company',lat:34.612,lon:-111.714,radius:5910},
  EPE:{name:'El Paso Electric Company',lat:32.15,lon:-106.079,radius:485},
  PNM:{name:'Public Service Company of New Mexico',lat:34.698,lon:-106.603,radius:1746},
  SRP:{name:'Salt River Project Agricultural Improvement and Power District',lat:33.477,lon:-111.505,radius:4390},
  TEPC:{name:'Tucson Electric Power',lat:31.873,lon:-110.175,radius:1012},
  WALC:{name:'Western Area Power Administration - Desert Southwest Region',lat:35.983,lon:-114.005,radius:788},
  PJM:{name:'PJM Interconnection, LLC',lat:39.392,lon:-80.522,radius:90304},
  CPLE:{name:'Duke Energy Progress East',lat:35.145,lon:-77.5,radius:7114},
  DUK:{name:'Duke Energy Carolinas',lat:35.244,lon:-81.002,radius:11763},
  SC:{name:'South Carolina Public Service Authority',lat:33.901,lon:-79.767,radius:1930},
  SOCO:{name:'Southern Company Services, Inc. - Trans',lat:32.336,lon:-85.28,radius:26514},
  ISNE:{name:'ISO New England',lat:44.056,lon:-70.915,radius:11387},
  NYIS:{name:'New York Independent System Operator',lat:42.952,lon:-75.517,radius:14907},
  TVA:{name:'Tennessee Valley Authority',lat:35.353,lon:-86.719,radius:17616},
  ERCO:{name:'Electric Reliability Council of Texas, Inc.',lat:30.896,lon:-99.325,radius:39494}
};
const BAS = Object.keys(BA_META);

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=600', // EIA updates hourly
    'Access-Control-Allow-Origin': '*'
  };

  // ?diag=1 — probe EIA reachability from this Lambda (timing + status), no parsing.
  if (event.queryStringParameters?.diag) {
    const probes = {};
    const tryFetch = async (label, url, hdrs) => {
      const t0 = Date.now();
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: hdrs });
        const txt = await r.text();
        probes[label] = { status: r.status, ms: Date.now() - t0, bytes: txt.length };
      } catch (e) { probes[label] = { error: e.message, ms: Date.now() - t0 }; }
    };
    await tryFetch('respondents-basic', 'https://www.eia.gov/electricity/930-api/respondents/data?type%5B0%5D=BA', { 'User-Agent': 'KitsuneGlobal/BDOC-8.0' });
    await tryFetch('respondents-browser', 'https://www.eia.gov/electricity/930-api/respondents/data?type%5B0%5D=BA', {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.eia.gov/electricity/gridmonitor/'
    });
    return { statusCode: 200, headers, body: JSON.stringify(probes) };
  }

  // Tier 1: keyed county-level outages (only if a paid key is configured)
  const key = process.env.POWEROUTAGE_KEY;
  if (key) try {
    const res = await fetch(`https://poweroutage.us/api/web/counties?key=${key}&countryid=us`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.text();
      try {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return { statusCode: 200, headers: { ...headers, 'X-Source-Tier': 'poweroutage-county' }, body: data };
        }
      } catch (_) {}
    }
  } catch (e) { console.warn('[proxy-outages] Tier 1 failed:', e.message); }

  // Tier 2: EIA 930 grid stress (free, no key)
  let eiaError = null;
  try {
    const now = new Date();
    const fmt = (d) => {
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${d.getUTCFullYear()} ${p(d.getUTCHours())}:00:00`;
    };
    // ?hours= override for diagnostics; default 3h (data lags 1-2h upstream).
    // Smaller window = smaller EIA response = faster from AWS (EIA's CDN is
    // slow to serve AWS-origin requests; 6h window timed out in prod).
    const hours = Math.min(Math.max(parseInt(event.queryStringParameters?.hours, 10) || 3, 1), 12);
    const start = fmt(new Date(now.getTime() - hours * 3600e3));
    const end = fmt(now);

    const q = BAS.map((b, i) => `respondent%5B${i}%5D=${b}`);
    q.push('type%5B0%5D=D', 'type%5B1%5D=DF');
    q.push('start=' + encodeURIComponent(start), 'end=' + encodeURIComponent(end));

    // Single upstream fetch (metadata baked in as BA_META) — 8.5s budget
    // inside Netlify's 10s hard limit.
    const seriesRes = await fetch('https://www.eia.gov/electricity/930-api/region_data/series_data?' + q.join('&'), {
      signal: AbortSignal.timeout(8500), headers: { 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
    });
    if (!seriesRes.ok) throw new Error('EIA series ' + seriesRes.status);
    const seriesJson = await seriesRes.json();
    const meta = BA_META;

    // Latest non-null demand (D) and matching-hour forecast (DF) per BA
    const demand = {}, forecast = {}, asOfMap = {};
    for (const grp of (Array.isArray(seriesJson) ? seriesJson : [])) {
      for (const s of (grp.data || [])) {
        const dates = s.VALUES?.DATES || [], vals = s.VALUES?.DATA || [];
        // walk backwards to last non-null value
        for (let i = vals.length - 1; i >= 0; i--) {
          if (vals[i] == null) continue;
          if (s.TYPE_ID === 'D') { demand[s.RESPONDENT_ID] = { v: vals[i], t: dates[i] }; }
          else if (s.TYPE_ID === 'DF') { forecast[s.RESPONDENT_ID] = forecast[s.RESPONDENT_ID] || {}; forecast[s.RESPONDENT_ID][dates[i]] = vals[i]; }
          if (s.TYPE_ID === 'D') break; // demand: only need latest
        }
        // for DF keep the whole map (we match demand's timestamp)
        if (s.TYPE_ID === 'DF') {
          const fm = {};
          for (let i = 0; i < dates.length; i++) if (vals[i] != null) fm[dates[i]] = vals[i];
          forecast[s.RESPONDENT_ID] = fm;
        }
      }
    }

    const nodes = [];
    for (const [id, d] of Object.entries(demand)) {
      const m = meta[id];
      if (!m || !isFinite(m.lat) || !isFinite(m.lon)) continue;
      const f = forecast[id] ? forecast[id][d.t] : null;
      let stress = (f && f > 0) ? Math.round((d.v / f) * 1000) / 10 : null;
      // Sanity clamp: EIA DF series occasionally carries junk (partial-hour or
      // mis-scaled values → 789% "stress"). Real demand/forecast ratios live in
      // ~60-130%. Outside 40-160% ⇒ treat forecast as unreliable, null it out.
      if (stress !== null && (stress < 40 || stress > 160)) stress = null;
      nodes.push({
        _grid: true, id, name: m.name || id,
        lat: m.lat, lon: m.lon,
        demandMW: d.v, forecastMW: f || null,
        stressPct: stress,          // >100 = demand exceeding day-ahead forecast
        sizeMW: m.radius || d.v,    // relative BA size for marker scaling
        asOf: d.t
      });
    }

    if (!nodes.length) throw new Error('EIA returned no usable series');
    return { statusCode: 200, headers: { ...headers, 'X-Source-Tier': 'eia-930' }, body: JSON.stringify(nodes) };
  } catch (e) {
    eiaError = e.message;
    console.warn('[proxy-outages] EIA tier failed:', e.message);
  }

  // Tier 3: graceful empty — client shows utility-map fallback links
  return { statusCode: 200, headers: { ...headers, 'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=60', 'X-Source-Tier': 'unavailable', 'X-EIA-Error': String(eiaError || '').slice(0, 140) }, body: JSON.stringify([]) };
};
