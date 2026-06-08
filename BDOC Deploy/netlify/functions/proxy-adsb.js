// Proxy for adsb.lol ADS-B Exchange API
// Pass-through proxy (no key needed, but hides client IP and enables server-side caching)
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const { lat, lon, dist } = params;

  if (!lat || !lon || !dist) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing params: lat, lon, dist' }) };
  }
  // Validate numeric before interpolating into the URL path — prevents path traversal (e.g. ../../admin)
  if (!/^-?\d+(\.\d+)?$/.test(lat) || !/^-?\d+(\.\d+)?$/.test(lon) || !/^\d+(\.\d+)?$/.test(dist)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid params: lat/lon/dist must be numeric' }) };
  }

  const url = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`adsb.lol API returned ${res.status}`);
    const data = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=10',
        'Access-Control-Allow-Origin': '*'
      },
      body: data
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
