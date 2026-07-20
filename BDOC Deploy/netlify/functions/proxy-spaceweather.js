// Proxy for NOAA Space Weather Prediction Center (SWPC)
// SWPC sometimes lacks CORS headers, blocking browser fetches.
// Phase 16 (2026-05-13)
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const type = params.type || 'kp';

  // Whitelist endpoints — prevent arbitrary URL injection
  const ENDPOINTS = {
    kp:           'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
    kp_forecast:  'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json',
    solar_wind:   'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json',
    xray:         'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json',
    proton:       'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json',
    aurora:       'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
    alerts:       'https://services.swpc.noaa.gov/products/alerts.json',
    solar_flares: 'https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json'
  };

  const url = ENDPOINTS[type];
  if (!url) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown space weather type: ' + type + '. Allowed: ' + Object.keys(ENDPOINTS).join(',') }) };
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
    });
    if (!res.ok) throw new Error(`SWPC ${res.status}`);
    const data = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=600',
        'Access-Control-Allow-Origin': '*'
      },
      body: data
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message, source: 'NOAA SWPC' }) };
  }
};
