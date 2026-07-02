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

const BAS = [
  'CISO','ERCO','MISO','PJM','SWPP','ISNE','NYIS','BPAT','AZPS','SRP','TVA',
  'SOCO','FPL','DUK','CPLE','PACE','PACW','PSCO','NEVP','WACM','AECI','LDWP',
  'SCL','PGE','IPCO','EPE','SC','PNM','TEPC','FMPP','JEA','TAL','SEC','GVL',
  'NWMT','WAUW','PSEI','AVA','CHPD','DOPD','GCPD','BANC','TIDC','IID','WALC'
];

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=600', // EIA updates hourly
    'Access-Control-Allow-Origin': '*'
  };

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
  try {
    const now = new Date();
    const fmt = (d) => {
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${d.getUTCFullYear()} ${p(d.getUTCHours())}:00:00`;
    };
    const start = fmt(new Date(now.getTime() - 6 * 3600e3)); // 6h lookback — data lags 1-2h
    const end = fmt(now);

    const q = BAS.map((b, i) => `respondent%5B${i}%5D=${b}`);
    q.push('type%5B0%5D=D', 'type%5B1%5D=DF');
    q.push('start=' + encodeURIComponent(start), 'end=' + encodeURIComponent(end));

    const [seriesRes, respRes] = await Promise.all([
      fetch('https://www.eia.gov/electricity/930-api/region_data/series_data?' + q.join('&'), {
        signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
      }),
      fetch('https://www.eia.gov/electricity/930-api/respondents/data?type%5B0%5D=BA', {
        signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
      })
    ]);
    if (!seriesRes.ok) throw new Error('EIA series ' + seriesRes.status);
    if (!respRes.ok) throw new Error('EIA respondents ' + respRes.status);

    const seriesJson = await seriesRes.json();
    const respJson = await respRes.json();

    // Respondent metadata → coords + size
    const meta = {};
    for (const grp of (Array.isArray(respJson) ? respJson : [])) {
      for (const r of (grp.data || [])) {
        if (r && r.id) meta[r.id] = { name: r.name, lat: r.lat, lon: r.lon, radius: r.radius || 0 };
      }
    }

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
    console.warn('[proxy-outages] EIA tier failed:', e.message);
  }

  // Tier 3: graceful empty — client shows utility-map fallback links
  return { statusCode: 200, headers: { ...headers, 'X-Source-Tier': 'unavailable' }, body: JSON.stringify([]) };
};
