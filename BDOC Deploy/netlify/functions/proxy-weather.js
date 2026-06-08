// Proxy for weather APIs: RainViewer and NWS
// Centralizes weather data fetching and adds caching headers
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const type = params.type || 'maps';

  let url;
  let cacheTime = 300; // 5 min default

  switch (type) {
    case 'maps':
      // RainViewer weather maps (radar frames list)
      url = 'https://api.rainviewer.com/public/weather-maps.json';
      cacheTime = 120;
      break;
    case 'hurricanes':
      url = 'https://api.weather.gov/alerts/active?event=Hurricane,Tropical%20Storm,Typhoon';
      cacheTime = 600;
      break;
    case 'alerts':
      url = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';
      // Optional `events` filter (comma-separated alert event names like "Severe Thunderstorm Warning,Tornado Warning")
      if (params.events) url += '&event=' + encodeURIComponent(params.events.replace(/\+/g, ' '));
      cacheTime = 300;
      break;
    case 'lightning':
      // Lightning proxy: NWS thunderstorm/tornado warnings as proxy for active lightning regions
      url = 'https://api.weather.gov/alerts/active?status=actual&event=' + encodeURIComponent('Severe Thunderstorm Warning,Tornado Warning,Special Marine Warning');
      cacheTime = 300;
      break;
    default:
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown weather type: ' + type }) };
  }

  const headers = {};
  // NWS requires User-Agent and Accept headers
  if (url.includes('weather.gov')) {
    headers['User-Agent'] = 'KITSUNE-BDOC/8.0 (kgsbdoc.netlify.app)';
    headers['Accept'] = 'application/geo+json';
  }

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Weather API returned ${res.status}`);
    const data = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${cacheTime}`,
        'Access-Control-Allow-Origin': '*'
      },
      body: data
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
