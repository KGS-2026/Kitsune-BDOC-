// Proxy for OpenSky Network ADS-B API
// Optionally injects Basic Auth for higher rate limits
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const { lamin, lomin, lamax, lomax } = params;

  if (!lamin || !lomin || !lamax || !lomax) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing bounding box params: lamin, lomin, lamax, lomax' }) };
  }
  // Parse to numbers before URL construction — prevents query-string injection (e.g. lamin=1&extra=x)
  const laMinN = parseFloat(lamin), loMinN = parseFloat(lomin), laMaxN = parseFloat(lamax), loMaxN = parseFloat(lomax);
  if (!Number.isFinite(laMinN) || !Number.isFinite(loMinN) || !Number.isFinite(laMaxN) || !Number.isFinite(loMaxN)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bounding box params must be numeric' }) };
  }

  const url = `https://opensky-network.org/api/states/all?lamin=${laMinN}&lomin=${loMinN}&lamax=${laMaxN}&lomax=${loMaxN}`;

  const headers = {};
  const user = process.env.OPENSKY_USER;
  const pass = process.env.OPENSKY_PASS;
  if (user && pass) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  }

  try {
    // 7s — must complete before Netlify's 10s hard kill leaves time for response serialization
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(7000) });
    if (!res.ok) throw new Error(`OpenSky API returned ${res.status}`);
    const data = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=10',
        'Access-Control-Allow-Origin': '*'
      },
      body: data
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message, source: 'OpenSky Network' })
    };
  }
};
