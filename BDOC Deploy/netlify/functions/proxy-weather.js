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
      // p157: this returned ZERO features during an actual Cat-3 landfall.
      // NWS `event=` is an EXACT match against the alert's event name. There is
      // no alert literally named "Hurricane" — the real names are "Hurricane
      // Warning", "Storm Surge Warning", "Tropical Storm Warning", etc. The old
      // query (event=Hurricane,Tropical Storm,Typhoon) therefore matched nothing,
      // every time, and the layer rendered empty while badging LIVE.
      // Verified 2026-10-09 with Hurricane Isaias at 28.7N 87.1W / 105kt:
      //   old query -> 0 features
      //   this query -> 183 features (28 Hurricane Warning, 22 Storm Surge
      //                 Warning, 126 Tropical Storm Warning, 5 TS Watch, ...)
      url = 'https://api.weather.gov/alerts/active?event=' + encodeURIComponent([
        'Hurricane Warning',
        'Hurricane Watch',
        'Hurricane Force Wind Warning',
        'Hurricane Local Statement',
        'Tropical Storm Warning',
        'Tropical Storm Watch',
        'Storm Surge Warning',
        'Storm Surge Watch',
        'Typhoon Warning',
        'Typhoon Watch',
        'Typhoon Local Statement',
        'Tropical Cyclone Statement',
        'Extreme Wind Warning'
      ].join(','));
      cacheTime = 600;
      break;
    case 'storms':
      // p157: live storm POSITIONS from the National Hurricane Center.
      // The `hurricanes` case above returns warning POLYGONS (where the danger
      // is); this returns the storm itself — eye position, intensity, pressure,
      // movement — which is what an emergency-management coordinator reads first.
      url = 'https://www.nhc.noaa.gov/CurrentStorms.json';
      cacheTime = 300;
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
  // NWS and NHC both require a User-Agent; NWS also wants an explicit Accept.
  // (nhc.noaa.gov is a different host from api.weather.gov — the old check
  //  missed it, and anonymous datacenter calls get refused.)
  if (url.includes('weather.gov') || url.includes('noaa.gov')) {
    headers['User-Agent'] = 'KITSUNE-BDOC/8.0 (kgsbdoc.netlify.app)';
    headers['Accept'] = url.includes('api.weather.gov')
      ? 'application/geo+json'
      : 'application/json';
  }

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Weather API returned ${res.status}`);
    const data = await res.text();

    // p157: attach provenance WITHOUT changing the existing shape.
    // Callers read `.features` / `.activeStorms` as before; `_bdoc` is additive.
    // Why this matters: on 2026-10-09 this endpoint returned 0 features during a
    // live Cat-3 landfall (broken query) and on 2026-10-10 it returned 0 features
    // because there genuinely were no tropical alerts. Byte-identical responses,
    // opposite meanings. Without `_bdoc` the UI badges "LIVE" for both.
    let body = data;
    try {
      const j = JSON.parse(data);
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        const count = Array.isArray(j.features) ? j.features.length
                    : Array.isArray(j.activeStorms) ? j.activeStorms.length
                    : null;
        j._bdoc = {
          source: new URL(url).host,
          type,
          fetched_at: new Date().toISOString(),
          upstream_status: res.status,
          count,
          degraded: false
        };
        body = JSON.stringify(j);
      }
    } catch (_) { /* non-JSON upstream (shouldn't happen here) — pass through */ }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Netlify-Vary': 'query', 'Cache-Control': `public, max-age=${cacheTime}`,
        'Access-Control-Allow-Origin': '*'
      },
      body
    };
  } catch (e) {
    // Honest failure: say which source died and when, so the UI can show
    // "last good 14:02, retrying" instead of an empty map badged LIVE.
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: e.message,
        _bdoc: {
          source: (() => { try { return new URL(url).host; } catch (_) { return 'unknown'; } })(),
          type,
          fetched_at: new Date().toISOString(),
          upstream_status: null,
          count: null,
          degraded: true
        }
      })
    };
  }
};
