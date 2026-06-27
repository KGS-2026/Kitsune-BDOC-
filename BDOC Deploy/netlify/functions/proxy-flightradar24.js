// proxy-flightradar24.js — FlightRadar24 Business API proxy
// Explorer plan: live-flight-positions/full (origin/dest/airline/aircraft type)
// Env var: FlightRadar (set in Netlify → Site configuration → Environment variables)
// Phase 26 (2026-05-30) — KGS BDOC / Kitsune Global Solutions LLC

const FR24_BASE = 'https://fr24api.flightradar24.com';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const key = process.env.FlightRadar;
  if (!key) {
    return {
      statusCode: 503,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'FlightRadar env var not configured in Netlify', hint: 'Set variable named "FlightRadar" in Netlify → Site configuration → Environment variables' })
    };
  }

  const params = event.queryStringParameters || {};
  const { lamin, lomin, lamax, lomax } = params;
  if (!lamin || !lomin || !lamax || !lomax) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Required: lamin, lomin, lamax, lomax (bounding box)' })
    };
  }

  // Validate numeric — prevents query-string injection
  const la1 = parseFloat(lamin), lo1 = parseFloat(lomin);
  const la2 = parseFloat(lamax), lo2 = parseFloat(lomax);
  if ([la1, lo1, la2, lo2].some(v => !Number.isFinite(v))) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Bounding box values must be numeric' })
    };
  }

  // FR24 bounds format: north,south,west,east (lat_max,lat_min,lon_min,lon_max)
  // per FR24 docs — latitude_north MUST come before latitude_south or the box
  // inverts and the API returns an empty data array with HTTP 200.
  const bounds = `${la2.toFixed(4)},${la1.toFixed(4)},${lo1.toFixed(4)},${lo2.toFixed(4)}`;
  const url = `${FR24_BASE}/api/live/flight-positions/full?bounds=${bounds}`;

  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json',
        'Accept-Version': 'v1',
        'User-Agent': 'KitsuneGlobal/BDOC-8.0'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      // Surface the FR24 error body so the operator can see quota/auth messages
      const errText = await res.text().catch(() => '');
      console.error(`[proxy-flightradar24] FR24 returned ${res.status}: ${errText.slice(0, 300)}`);
      return {
        statusCode: res.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `FR24 API ${res.status}`, detail: errText.slice(0, 200) })
      };
    }

    const body = await res.text();
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        // Short cache — live positions change every ~30s
        'Cache-Control': 'public, max-age=30'
      },
      body
    };
  } catch (e) {
    console.error('[proxy-flightradar24] fetch error:', e.message);
    return {
      statusCode: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message, source: 'proxy-flightradar24' })
    };
  }
};
