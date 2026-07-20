// Proxy for AviationWeather.gov METAR / TAF / SIGMET API
// Military bases use the same METAR/TAF data as DoD pilots & 557th Weather Wing feeds.
// SIGMET type returns volcanic ash (hazard=VA) aviation advisories — no ICAO needed.
// No API key required. CORS not consistently supported upstream, so proxy is essential.
// Phase 19c (2026-05-15)
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const type = (params.type || 'metar').toLowerCase();

  const VALID_TYPES = ['metar', 'taf', 'sigmet'];
  if (!VALID_TYPES.includes(type)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'valid type required: metar, taf, sigmet' }) };
  }

  // SIGMET does not use station IDs — it returns polygons globally
  let url;
  if (type === 'sigmet') {
    const hazard = ((params.hazard || 'VA').toUpperCase().replace(/[^A-Z]/g, '') || 'VA').slice(0, 4);
    url = `https://aviationweather.gov/api/data/sigmet?format=json&hazard=${hazard}`;
  } else {
    // Sanitize ICAO: 4-char alphanum, comma-separated list, max 20 stations
    const raw = (params.icao || '').toUpperCase().replace(/[^A-Z0-9,]/g, '');
    const icao = raw.split(',').slice(0, 20).join(',');
    if (!icao) {
      return { statusCode: 400, body: JSON.stringify({ error: 'icao required for metar/taf' }) };
    }
    url = `https://aviationweather.gov/api/data/${type}?ids=${icao}&format=json&hours=3`;
  }

  // Cache: 5 min for METAR (updates every 20-60 min), 10 min for TAF/SIGMET
  const maxAge = type === 'metar' ? 300 : 600;
  const headers = {
    'Content-Type': 'application/json',
    'Netlify-Vary': 'query', 'Cache-Control': `public, max-age=${maxAge}`,
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/json', 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
    });
    if (!res.ok) throw new Error(`AviationWeather ${res.status}`);
    const data = await res.text();
    // Validate JSON — AW can return HTML on error
    try { JSON.parse(data); } catch (_) {
      return { statusCode: 200, headers, body: JSON.stringify([]) };
    }
    return { statusCode: 200, headers, body: data };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: e.message, source: 'AviationWeather', upstream: url })
    };
  }
};
