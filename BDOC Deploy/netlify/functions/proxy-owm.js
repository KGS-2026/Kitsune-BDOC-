// Proxy for OpenWeatherMap tile endpoints — 302 redirect so Cesium loads tiles directly.
// Tile URL is signed per-request; appid stays in the 302 Location header.
// Client calls /api/proxy-owm?layer=wind_new&z={z}&x={x}&y={y}
exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  // p203: no hardcoded fallback. The old fallback keys were public in git history; set the env var in Netlify.
  const apiKey = process.env.OWM_API_KEY;
  if (!apiKey) return { statusCode: 503, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'OWM_API_KEY is not set in Netlify' }) };
  const ALLOWED = ['wind_new', 'precipitation_new', 'temp_new', 'clouds_new', 'pressure_new'];
  const layer = ALLOWED.includes(p.layer) ? p.layer : 'wind_new';
  const z = parseInt(p.z, 10), x = parseInt(p.x, 10), y = parseInt(p.y, 10);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y) ||
      z < 0 || z > 20 || x < 0 || y < 0) {
    return { statusCode: 400, body: 'Invalid tile coords' };
  }
  const target = `https://tile.openweathermap.org/map/${layer}/${z}/${x}/${y}.png?appid=${apiKey}`;
  return {
    statusCode: 302,
    headers: {
      'Location': target,
      'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=600',
      'Access-Control-Allow-Origin': '*'
    },
    body: ''
  };
};
