// Proxy for NASA FIRMS (Fire Information for Resource Management System)
// Injects API key server-side so it's never exposed to the client
// Phase 15 (2026-05-13): added 'area' mode for global coverage (was country-only)
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const mode = params.mode || 'area';            // 'area' (global bbox) or 'country' (legacy)
  // p203: no hardcoded fallback. The old fallback keys were public in git history; set the env var in Netlify.
  // NASA_FIRMS_Map_key is the name the key was saved under in Netlify (2026-11-19); either works.
  const key = process.env.NASA_FIRMS_KEY || process.env.NASA_FIRMS_Map_key;
  if (!key) return { statusCode: 503, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'NASA_FIRMS_KEY is not set in Netlify' }) };
  // Validate params before interpolating into URL path — prevents path traversal
  // source: whitelist to known FIRMS NRT/SP products
  const ALLOWED_SOURCES = [
    'VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'MODIS_NRT', 'MODIS_SP',
    'VIIRS_SNPP_SP', 'VIIRS_NOAA20_SP', 'LANDSAT_NRT'
  ];
  const source = ALLOWED_SOURCES.includes(params.source) ? params.source : 'VIIRS_SNPP_NRT';
  // country: ISO 2-3 uppercase letters only
  const rawCountry = (params.country || 'USA').toUpperCase();
  const country = /^[A-Z]{2,3}$/.test(rawCountry) ? rawCountry : 'USA';
  // area: four comma-separated floats — lon1,lat1,lon2,lat2
  const areaRaw = params.area || '-180,-90,180,90';
  const area = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(areaRaw) ? areaRaw : '-180,-90,180,90';
  // days: integer 1-5. p168p: was 1-10, but FIRMS answers 400 "Invalid day range. Expects [1..5]"
  // above 5 (checked 2026-11-05 against the area API).
  const days = Math.min(Math.max(parseInt(params.days, 10) || 1, 1), 5);

  const build = (src) => mode === 'country'
    ? `https://firms.modaps.eosdis.nasa.gov/api/country/csv/${key}/${src}/${country}/${days}`
    : `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/${area}/${days}`;
  // p158f: just after 00:00 UTC, VIIRS_SNPP_NRT days=1 returns the CSV HEADER ONLY
  // (measured 2026-10-24 03:46Z: SNPP 1 line, NOAA-20 1,006 rows). The fire layer
  // went blank every night. Same sensor family, same columns -> fall through the
  // sister satellites when the requested one is empty. NRT sources only.
  const chain = [source];
  if (/_NRT$/.test(source)) for (const s of ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'VIIRS_SNPP_NRT']) if (!chain.includes(s)) chain.push(s);
  const CORS = { 'Access-Control-Allow-Origin': '*' };
  let lastErr = 'no data', text = '', used = source;
  for (const src of chain) {
    try {
      const res = await fetch(build(src), { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'KitsuneBDOC/7.0 (+https://kgsbdoc.netlify.app)' } });
      if (!res.ok) { lastErr = `FIRMS ${src} returned ${res.status}`; continue; }
      const t = await res.text();
      if (!text) text = t;                       // keep the header in case all are empty
      if (t.trim().split('\n').length > 1) { text = t; used = src; break; }
      lastErr = `FIRMS ${src} empty`;
    } catch (e) { lastErr = e.message; }
  }
  if (!text) return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: lastErr }) };
  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'text/plain', 'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=600', 'X-BDOC-Source': used },
    body: text
  };
};
