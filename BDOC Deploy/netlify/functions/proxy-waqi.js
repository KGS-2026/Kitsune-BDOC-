// Proxy for WAQI (World Air Quality Index) API
// Injects token server-side
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const token = process.env.WAQI_TOKEN || 'demo';

  let url;
  if (params.feed) {
    // Per-station detail: /feed/geo:lat;lon/
    // Validate feed is a safe "lat;lon" numeric pair before interpolating into URL
    if (!/^-?\d+(\.\d+)?;-?\d+(\.\d+)?$/.test(params.feed)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid feed parameter' }) };
    }
    url = `https://api.waqi.info/feed/geo:${params.feed}/?token=${token}`;
  } else {
    // Map bounds query — validate four comma-separated floats (lat1,lon1,lat2,lon2)
    // to prevent query-string injection via latlng=... &extra_param=injected
    const latlng = params.latlng || '-60,-180,70,180';
    if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(latlng)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid latlng parameter (expected lat1,lon1,lat2,lon2)' }) };
    }
    url = `https://api.waqi.info/v2/map/bounds/?latlng=${latlng}&networks=all&token=${token}`;
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`WAQI API returned ${res.status}`);
    const data = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      },
      body: data
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
