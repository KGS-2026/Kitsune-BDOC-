// Proxy for OpenStreetMap Overpass API
// Used for DeFlock surveillance layer and cell tower queries
// Handles POST body forwarding with automatic failover to mirror
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }

  const body = event.body || '';
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  let lastError;
  for (const endpoint of endpoints) {
    try {
      // 4s per endpoint — two attempts fit within Netlify's 10s hard kill limit.
      // Previous value (20s) exceeded the limit so the failover endpoint was unreachable.
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body,
        signal: AbortSignal.timeout(4000)
      });
      if (!res.ok) throw new Error(`Overpass returned ${res.status}`);
      const data = await res.text();
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*'
        },
        body: data
      };
    } catch (e) {
      lastError = e;
      // Try next endpoint
    }
  }

  return { statusCode: 502, body: JSON.stringify({ error: lastError?.message || 'All Overpass endpoints failed' }) };
};
