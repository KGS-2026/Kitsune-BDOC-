// Proxy for Digitraffic AIS Maritime API
// Adds required Digitraffic-User header
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const type = params.type || 'locations';

  let url;
  switch (type) {
    case 'vessels':
      url = 'https://meri.digitraffic.fi/api/ais/v1/vessels';
      break;
    case 'locations':
      url = 'https://meri.digitraffic.fi/api/ais/v1/locations';
      break;
    default:
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown maritime type: ' + type }) };
  }

  try {
    // 7s — must complete before Netlify's 10s hard kill
    const res = await fetch(url, {
      headers: {
        'Digitraffic-User': 'KitsuneGlobal/BDOC-8.0',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) throw new Error(`Digitraffic API returned ${res.status}`);
    const data = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30',
        'Access-Control-Allow-Origin': '*'
      },
      body: data
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message, source: 'Digitraffic AIS' })
    };
  }
};
