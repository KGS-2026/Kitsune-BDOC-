// Proxy for OSRM Open-Source Routing Machine
// router.project-osrm.org rate-limits / blocks browser-origin requests from production domains.
// This proxy routes the same calls server-side so CORS is never an issue.
// Phase 16d (2026-05-14)
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const profile = params.profile || 'driving';
  const coords  = params.coords;  // "lon1,lat1;lon2,lat2"

  // Whitelist routing profiles
  const PROFILES = ['driving', 'walking', 'cycling'];
  if (!PROFILES.includes(profile)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid profile. Use: driving|walking|cycling' }) };
  }

  // Strict coord string validation — only digits, dots, minus, semicolons, commas
  if (!coords || !/^[-\d.,;]+$/.test(coords)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid or missing coords parameter' }) };
  }

  const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=true`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'KitsuneGlobal/BDOC-8.0',
        'Referer': 'https://www.bdoc.app/'
      }
    });
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',  // 5 min — routes don't change often
        'Access-Control-Allow-Origin': '*'
      },
      body: data
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message, source: 'OSRM Routing API' }) };
  }
};
