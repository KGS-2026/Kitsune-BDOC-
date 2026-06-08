// Proxy for NASA FIRMS (Fire Information for Resource Management System)
// Injects API key server-side so it's never exposed to the client
// Phase 15 (2026-05-13): added 'area' mode for global coverage (was country-only)
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const mode = params.mode || 'area';            // 'area' (global bbox) or 'country' (legacy)
  // Phase 15b (2026-05-13): hardcoded fallback after operator authorized + accepted exposure risk.
  // Netlify env var NASA_FIRMS_KEY still overrides if set. Rotate this key via firms.modaps.eosdis.nasa.gov/api if you want to invalidate the chat-exposed version.
  const key = process.env.NASA_FIRMS_KEY || '49ac78cde379b5007fed0e7a4aa13da2';
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
  // days: integer 1-10
  const days = Math.min(Math.max(parseInt(params.days, 10) || 1, 1), 10);

  const url = mode === 'country'
    ? `https://firms.modaps.eosdis.nasa.gov/api/country/csv/${key}/${source}/${country}/${days}`
    : `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${area}/${days}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`FIRMS API returned ${res.status}`);
    const text = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'public, max-age=600',
        'Access-Control-Allow-Origin': '*'
      },
      body: text
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
