// Netlify function: adsbdb aircraft enrichment (no auth required)
// GET /.netlify/functions/proxy-adsbdb?hex=A835AF
//
// v2 (Turn 24 audit fix): v1 called a nonexistent domain (adsbdb.org) with an
// invented API shape and returned errors on every request. This version is
// built against the REAL API, verified live 2026-08-31:
//   GET https://api.adsbdb.com/v0/aircraft/{MODE_S_HEX}
//   -> { "response": { "aircraft": { type, icao_type, manufacturer, mode_s,
//        registration, registered_owner, registered_owner_country_iso_name,
//        registered_owner_operator_flag_code, url_photo, url_photo_thumbnail } } }
//   Unknown hex -> { "response": "unknown aircraft" } with 404 status.

exports.handler = async (event) => {
  const hex = (event.queryStringParameters?.hex || '').trim().toUpperCase();

  if (!hex || !/^[0-9A-F]{6}$/.test(hex)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'hex must be a 6-char Mode-S hex code' })
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`https://api.adsbdb.com/v0/aircraft/${hex}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    clearTimeout(timeout);

    if (res.status === 404) {
      // Unknown airframe — cache the miss so we don't hammer the API
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ hex, error: 'unknown aircraft' })
      };
    }

    if (!res.ok) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: `adsbdb returned ${res.status}` })
      };
    }

    const data = await res.json();
    const ac = data?.response?.aircraft;

    if (!ac || typeof ac !== 'object') {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ hex, error: 'no aircraft record' })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400', // airframe metadata is stable
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        hex,
        type: ac.type || null,                       // e.g. "G650 ER"
        icao_type: ac.icao_type || null,             // e.g. "G650"
        manufacturer: ac.manufacturer || null,
        registration: ac.registration || null,
        owner: ac.registered_owner || null,
        owner_country: ac.registered_owner_country_iso_name || null,
        flag_code: ac.registered_owner_operator_flag_code || null,
        photo: ac.url_photo || null,
        photo_thumb: ac.url_photo_thumbnail || null,
        source: 'adsbdb.com'
      })
    };
  } catch (err) {
    console.error('[proxy-adsbdb]', err.message);
    return {
      statusCode: 504,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'adsbdb request failed', message: err.message })
    };
  }
};
