// proxy-cfradar.js — Cloudflare Radar API proxy
// Cloudflare Radar blocks browser CORS on the /api/v1/ endpoints.
// Whitelisted endpoints: attacks L3 origins/targets, outage annotations.
// No API key required for these public data endpoints. Phase 20a (2026-05-18)

const ALLOWED = {
  'attacks_origins': '/api/v1/attacks/layer3/top/locations/origin',
  'attacks_targets': '/api/v1/attacks/layer3/top/locations/target',
  'attacks_layer7':  '/api/v1/attacks/layer7/top/locations/origin',
  'outages':         '/api/v1/annotations/outages'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: '' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=120', // 2 min — attack data updates frequently
    'Access-Control-Allow-Origin': '*'
  };

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

  const url = `https://radar.cloudflare.com${path}?${qs.toString()}`;

  try {
    const res = await fetch(url, {
      signal:  AbortSignal.timeout(6000),
      headers: {
        'Accept':     'application/json',
        'User-Agent': 'KitsuneGlobal/BDOC-8.0'
      }
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
