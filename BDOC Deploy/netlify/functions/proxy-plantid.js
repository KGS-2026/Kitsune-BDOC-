// Proxy for Plant.id v3 — POST with JSON body, returns identification or health assessment.
// Client passes ?mode=identify or ?mode=health.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }
  const apiKey = process.env.PLANTID_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'PLANTID_API_KEY not configured' }) };
  }
  const mode = (event.queryStringParameters || {}).mode === 'health' ? 'health_assessment' : 'identification';
  const url = `https://plant.id/api/v3/${mode}`;

  // Size guard — a single base64 image shouldn't exceed ~8 MB.
  if (event.body && event.body.length > 9_000_000) {
    return { statusCode: 413, body: JSON.stringify({ error: 'Payload too large' }) };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: event.body || '{}',
      signal: AbortSignal.timeout(30000)
    });
    const body = await res.text();
    return {
      statusCode: res.ok ? 200 : res.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
