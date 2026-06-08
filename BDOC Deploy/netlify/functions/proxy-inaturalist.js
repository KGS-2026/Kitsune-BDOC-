// Proxy for iNaturalist — injects the bearer token server-side.
// Accepts any valid observations query via `path` + forwarded `search`.
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  // Phase 25 (2026-05-30): removed hardcoded fallback JWT — it expired 2026-04-09 and an
  // expired Bearer token causes 401s. iNaturalist v1 GET endpoints (observations/taxa/places)
  // are public and work unauthenticated, so we only attach Authorization when a real key is set.
  // To raise rate limits, set INATURALIST_API_KEY in Netlify env (token at inaturalist.org/users/api_token).
  const apiKey = process.env.INATURALIST_API_KEY || '';

  // Whitelist a small set of paths we actually call.
  const path = String(params.path || 'observations');
  const allowed = new Set(['observations', 'taxa', 'places']);
  if (!allowed.has(path)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'path not allowed: ' + path }) };
  }

  // Pass through whitelisted query params only.
  const passThrough = ['lat', 'lng', 'radius', 'per_page', 'order', 'order_by', 'quality_grade', 'iconic_taxa', 'q', 'id', 'taxon_id'];
  const qs = new URLSearchParams();
  for (const k of passThrough) if (params[k] != null) qs.set(k, String(params[k]));

  const url = `https://api.inaturalist.org/v1/${path}?${qs.toString()}`;

  try {
    const headers = {};
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(12000)
    });
    const body = await res.text();
    return {
      statusCode: res.ok ? 200 : res.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      },
      body
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
