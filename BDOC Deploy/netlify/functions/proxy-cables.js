// Proxy for TeleGeography Submarine Cable Map API
// Avoids CORS issues when fetching cable GeoJSON from client
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: '' };
  }
  const type = (event.queryStringParameters || {}).type || 'cables';

  const urls = {
    cables: 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
    landings: 'https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json'
  };

  const url = urls[type] || urls.cables;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`SubmarineCableMap returned ${res.status}`);
    const data = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      },
      body: data
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
