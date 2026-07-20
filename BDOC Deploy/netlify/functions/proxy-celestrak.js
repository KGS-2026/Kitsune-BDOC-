// Proxy for CelesTrak satellite TLE data
// Pass-through proxy — CelesTrak supports CORS but some browsers block third-party tile/api calls
// Phase 15 (2026-05-13)
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const group = params.group || 'stations';
  const format = params.format || 'json';

  // Allow any GROUP (stations, visual, active, weather, gps-ops, military, etc.)
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=${encodeURIComponent(format)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`CelesTrak returned ${res.status}`);
    const data = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': format === 'json' ? 'application/json' : 'text/plain',
        'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=600',
        'Access-Control-Allow-Origin': '*'
      },
      body: data
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
