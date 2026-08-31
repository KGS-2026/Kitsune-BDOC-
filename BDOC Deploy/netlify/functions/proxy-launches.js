// Netlify function: Launch Library 2 space launches proxy (no auth required)
// GET /.netlify/functions/proxy-launches?days=30
//
// v2 (Turn 24 audit fix): v1 used deprecated LL 2.0.0 and an invented field
// shape (rocket.name, image.image_url, integer status). Verified live
// 2026-08-31 against 2.2.0:
//   - status is an OBJECT: {id, name, abbrev, description}
//   - rocket name lives at rocket.configuration.name / .family
//   - image is a plain URL string in list mode
//   - pad.latitude/longitude are STRINGS
// LL free tier is ~15 req/hr — cache 30 min at the edge so BDOC clients
// share one origin hit instead of burning the budget.

exports.handler = async (event) => {
  let days = parseInt(event.queryStringParameters?.days || '30', 10);
  if (isNaN(days) || days < 1) days = 30;
  days = Math.min(days, 90);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const now = new Date();
    const lte = new Date(now.getTime() + days * 86400000).toISOString().split('T')[0];

    const res = await fetch(
      `https://ll.thespacedevs.com/2.2.0/launch/upcoming/?format=json&mode=list&limit=100&net__lte=${lte}&ordering=net`,
      { signal: controller.signal, headers: { 'Accept': 'application/json' } }
    );

    clearTimeout(timeout);

    if (res.status === 429) {
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Launch Library rate limit hit — retry later' })
      };
    }

    if (!res.ok) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: `Launch Library returned ${res.status}` })
      };
    }

    const data = await res.json();

    const launches = (data.results || []).map(l => ({
      id: l.id,
      name: l.name,
      net: l.net,                                    // ISO 8601
      net_precision: l.net_precision?.name || null,  // e.g. "Hour"
      status: l.status?.abbrev || null,              // "Go" | "TBD" | "Hold" ...
      status_name: l.status?.name || null,
      rocket: l.rocket?.configuration?.name || null,
      rocket_family: l.rocket?.configuration?.family || null,
      provider: l.launch_service_provider?.name || null,
      pad: l.pad?.name || null,
      pad_location: l.pad?.location?.name || null,
      country: l.pad?.location?.country_code || null,
      // pad coords arrive as strings — parse for direct Cesium use
      lat: l.pad?.latitude != null ? parseFloat(l.pad.latitude) : null,
      lon: l.pad?.longitude != null ? parseFloat(l.pad.longitude) : null,
      mission: l.mission?.name || null,
      mission_type: l.mission?.type || null,
      mission_desc: l.mission?.description || null,
      image: (typeof l.image === 'string') ? l.image : (l.image?.image_url || null),
      webcast_live: !!l.webcast_live,
      probability: l.probability ?? null
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // 30 min shared cache: launch NETs rarely move faster, and LL free
        // tier (~15 req/hr) can't survive per-client fetches.
        'Cache-Control': 'public, max-age=1800',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        count: launches.length,
        window_days: days,
        launches,
        source: 'Launch Library 2 (thespacedevs.com)'
      })
    };
  } catch (err) {
    console.error('[proxy-launches]', err.message);
    return {
      statusCode: 504,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Launch Library request failed', message: err.message })
    };
  }
};
