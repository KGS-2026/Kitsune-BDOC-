// Proxy for Digitraffic AIS Maritime API
// Adds required Digitraffic-User header.
// IMPORTANT: the raw /locations feed is >6MB (every AIS target in the Baltic) which
// exceeds Netlify's 6MB function-response cap → 502 ResponseSizeTooLarge and the
// vessels layer dies. We parse and trim server-side: essential fields only, capped
// feature count, newest-first. (Fixed 2026-07-02, was piping raw body through.)
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const type = params.type || 'locations';
  // Client may cap results; default keeps payload well under the limit.
  const limit = Math.min(parseInt(params.limit, 10) || 3000, 8000);

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
    const raw = await res.json();

    let body;
    if (type === 'locations') {
      // GeoJSON FeatureCollection — keep coords + the properties the layer actually uses.
      const feats = (raw.features || []).slice(0, limit).map(f => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          mmsi: f.properties?.mmsi,
          sog: f.properties?.sog,     // speed over ground
          cog: f.properties?.cog,     // course over ground
          heading: f.properties?.heading,
          navStat: f.properties?.navStat,
          timestampExternal: f.properties?.timestampExternal
        }
      }));
      body = JSON.stringify({ type: 'FeatureCollection', features: feats, _total: (raw.features || []).length, _returned: feats.length });
    } else {
      // vessels metadata array — trim to naming/type fields used by popups.
      const rows = (Array.isArray(raw) ? raw : []).slice(0, limit).map(v => ({
        mmsi: v.mmsi, name: v.name, shipType: v.shipType,
        callSign: v.callSign, destination: v.destination, draught: v.draught
      }));
      body = JSON.stringify(rows);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=30',
        'Access-Control-Allow-Origin': '*'
      },
      body
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message, source: 'Digitraffic AIS' })
    };
  }
};
