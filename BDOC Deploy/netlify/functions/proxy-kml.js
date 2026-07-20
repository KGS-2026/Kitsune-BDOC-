// Proxy for Google My Maps KML — Cold War Fallout Shelter data
// Google My Maps does not serve CORS headers for direct browser fetch.
// Phase 23 (2026-05-21): Georgia fallout shelter layer
exports.handler = async (event) => {
  // Public KML export for map mid=1iEX75wVP1GVOyFXfPjOqMbrnORM (Fallout Shelters in Georgia)
  // forcekml=1 requests flat KML instead of KMZ (ZIP)
  const KML_URL = 'https://www.google.com/maps/d/kml?forcekml=1&mid=1iEX75wVP1GVOyFXfPjOqMbrnORM';

  const headers = {
    'Content-Type': 'text/xml; charset=utf-8',
    'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=86400', // 24 hrs — static historical data, rarely changes
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const res = await fetch(KML_URL, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'KitsuneGlobal/BDOC-8.0',
        'Accept': 'application/vnd.google-earth.kml+xml, application/xml, */*'
      }
    });
    if (!res.ok) throw new Error(`Google Maps KML ${res.status}`);
    const data = await res.text();
    if (!data.includes('<kml') && !data.includes('<Placemark')) {
      throw new Error('Response does not appear to be valid KML');
    }
    return { statusCode: 200, headers, body: data };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message, source: 'proxy-kml', upstream: KML_URL })
    };
  }
};
