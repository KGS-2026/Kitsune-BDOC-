// Proxy for OpenStreetMap Overpass API
// Used for DeFlock surveillance layer and cell tower queries
// p208: the two-mirror serial failover was dead from Netlify egress (every POST
// came back "Overpass returned 429" in <1 s, and no User-Agent was sent), so
// every query fell through to the browser-direct fallback. Now: identify
// ourselves, race four public mirrors in parallel, return the first good answer,
// and report every mirror's failure in the 502 body.
const UA = 'KitsuneBDOC/8.0 (+https://kgsbdoc.netlify.app)';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const CORS = { 'Access-Control-Allow-Origin': '*' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }

  let body = event.body || '';
  if (event.isBase64Encoded && body) body = Buffer.from(body, 'base64').toString('utf8');
  // GET ?data=... (diagnostics / curl) is accepted too
  if (!body && event.queryStringParameters && event.queryStringParameters.data) {
    body = 'data=' + encodeURIComponent(event.queryStringParameters.data);
  }
  if (!body) {
    return { statusCode: 400, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS), body: JSON.stringify({ error: 'POST an Overpass query as data=...' }) };
  }

  const errors = {};
  const ctl = ENDPOINTS.map(() => new AbortController());
  const attempt = (endpoint, i) => (async () => {
    const t = setTimeout(() => ctl[i].abort(), 8500);   // Netlify kills sync functions at 10 s
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body,
        signal: ctl[i].signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.text();
      // Overpass can answer 200 with an HTML/XML error page on runtime errors
      if (!data || (data.charAt(0) !== '{' && data.charAt(0) !== '[')) throw new Error('non-JSON body');
      return { data, endpoint, i };
    } catch (e) {
      errors[new URL(endpoint).host] = e.name === 'AbortError' ? 'timeout' : String(e.message || e).slice(0, 80);
      throw e;
    } finally { clearTimeout(t); }
  })();

  try {
    const win = await Promise.any(ENDPOINTS.map(attempt));
    ctl.forEach((c, i) => { if (i !== win.i) try { c.abort(); } catch (_) {} });
    return {
      statusCode: 200,
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'X-Overpass-Endpoint': new URL(win.endpoint).host
      }, CORS),
      body: win.data
    };
  } catch (_) {
    return {
      statusCode: 502,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS),
      body: JSON.stringify({ error: 'All Overpass mirrors failed', mirrors: errors })
    };
  }
};
