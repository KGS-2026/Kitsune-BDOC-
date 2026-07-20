// proxy-cfradar.js — Cloudflare Radar API proxy
// UPDATE 2026-07-02: radar.cloudflare.com/api/v1 (the old keyless internal API) now
// returns 403 — Cloudflare closed it. The supported path is api.cloudflare.com/client/v4/radar
// which requires a free API token (create at dash.cloudflare.com → My Profile → API Tokens
// → "Read Radar data" template). Set it in Netlify as CLOUDFLARE_API_TOKEN.
// Without the token this returns 500 with a clear config message instead of a mystery 403.

const ALLOWED = {
  'attacks_origins': '/radar/attacks/layer3/top/locations/origin',
  'attacks_targets': '/radar/attacks/layer3/top/locations/target',
  'attacks_layer7':  '/radar/attacks/layer7/top/locations/origin',
  'outages':         '/radar/annotations/outages'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: '' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=120', // 2 min — attack data updates frequently
    'Access-Control-Allow-Origin': '*'
  };

  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.Cloudflare_api_token;
  if (!token) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'CLOUDFLARE_API_TOKEN not configured — create a free "Read Radar data" token at dash.cloudflare.com and add it in Netlify env vars.' })
    };
  }

  const params = event.queryStringParameters || {};
  const ep = params.endpoint || 'attacks_origins';
  const path = ALLOWED[ep];
  if (!path) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Unknown endpoint. Allowed: ' + Object.keys(ALLOWED).join(', ') })
    };
  }

  // Forward whitelisted query params from caller
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k !== 'endpoint') qs.set(k, v);
  }
  if (!qs.has('format')) qs.set('format', 'json');
  if (!qs.has('limit'))  qs.set('limit',  '10');

  const url = `https://api.cloudflare.com/client/v4${path}?${qs.toString()}`;

  try {
    // 7s — must complete before Netlify's 10s hard kill
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) throw new Error(`Cloudflare Radar ${res.status}`);
    const data = await res.text();
    return { statusCode: 200, headers, body: data };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: e.message, source: 'Cloudflare Radar API' })
    };
  }
};
