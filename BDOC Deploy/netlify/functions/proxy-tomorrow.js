// Proxy for Tomorrow.io v4 weather — keeps key server-side.
// Modes:
//   ?mode=tile&layer=temperature&z=X&x=Y&y=Z&ts=123...   → fetch PNG tile + return (cached by Netlify CDN)
//   ?mode=forecast&lat=X&lon=Y&units=imperial            → JSON forecast
// Phase 15c (2026-05-23): tile mode changed from 302 redirect to direct fetch so Netlify CDN
// caches tiles (max-age=600) and prevents Tomorrow.io 429 rate-limit floods on page load.
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const mode = params.mode || 'forecast';
  // Phase 15b (2026-05-13): hardcoded fallback authorized by operator. Netlify env TOMORROW_API_KEY overrides if set.
  // Rotate at app.tomorrow.io/development/keys if you want to invalidate the chat-exposed version.
  const apiKey = process.env.TOMORROW_API_KEY || 'j8oydmQTUIfy67xyJi342AJreV4tEGZQ';
  // Note: !apiKey guard removed — hardcoded fallback makes it unreachable dead code

  if (mode === 'tile') {
    const layer = String(params.layer || 'temperature').replace(/[^a-zA-Z0-9_]/g, '');
    const z = parseInt(params.z, 10), x = parseInt(params.x, 10), y = parseInt(params.y, 10);
    const ts = String(params.ts || '').replace(/[^0-9]/g, '');
    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y) || !ts) {
      return { statusCode: 400, body: JSON.stringify({ error: 'tile needs z,x,y,ts,layer' }) };
    }
    const url = `https://api.tomorrow.io/v4/map/tile/${z}/${x}/${y}/${layer}/${ts}?apikey=${apiKey}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        return { statusCode: res.status, body: JSON.stringify({ error: `Tomorrow.io tile ${res.status}` }) };
      }
      const buf = await res.arrayBuffer();
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=600',
          'Access-Control-Allow-Origin': '*'
        },
        body: Buffer.from(buf).toString('base64'),
        isBase64Encoded: true
      };
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (mode === 'forecast') {
    const lat = parseFloat(params.lat), lon = parseFloat(params.lon);
    const units = params.units === 'metric' ? 'metric' : 'imperial';
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'forecast needs lat,lon' }) };
    }
    const url = `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&apikey=${apiKey}&units=${units}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const body = await res.text();
      return {
        statusCode: res.ok ? 200 : res.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=600',
          'Access-Control-Allow-Origin': '*'
        },
        body
      };
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'unknown mode: ' + mode }) };
};
