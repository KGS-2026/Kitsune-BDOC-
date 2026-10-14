// ============================================================
// embed-check — can this URL be shown inside an <iframe> on BDOC?
// ============================================================
// WHY THIS EXISTS (P154, Travon bug #18 "live video feed is broke")
// Every curated webcam page (webcamtaxi.com, tw.live) answers with
// `X-Frame-Options: SAMEORIGIN`, so the in-app LIVE FEED panel showed Chrome's
// "refused to connect" page 100% of the time. The panel's fallback never fired
// because Chrome still raises `load` on a blocked frame — the browser gives
// page JavaScript no way to tell. The only reliable signal is the response
// header, which only a server can read. This function reads it.
//
// GET ?url=<http(s) url>  →  { embeddable: bool, reason: string }
// Headers only: the body is cancelled as soon as headers arrive.
// Cached 6 h at the edge — providers don't flip framing policy often.

const OK_CACHE = 'public, max-age=3600, s-maxage=21600';

function json(code, obj, cache) {
  return {
    statusCode: code,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cache || 'public, max-age=300',
      'Netlify-Vary': 'query',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(obj)
  };
}

exports.handler = async (event) => {
  const target = (event.queryStringParameters || {}).url || '';
  let u;
  try { u = new URL(target); } catch { return json(400, { embeddable: false, reason: 'bad-url' }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return json(400, { embeddable: false, reason: 'bad-proto' });
  // SSRF guard (same rules as proxy-ogimage): public hosts only.
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' ||
      /^(?:127|10|0)\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
      /^\[?(?:fc|fd|fe80)/i.test(host) ||
      /\.internal$|\.local$/.test(host)) {
    return json(400, { embeddable: false, reason: 'private-host' });
  }

  try {
    const res = await fetch(u.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BDOC/1.0; +https://kgsbdoc.netlify.app)' }
    });
    try { if (res.body && res.body.cancel) res.body.cancel(); } catch (_) {}
    if (!res.ok) return json(200, { embeddable: false, reason: 'http-' + res.status });
    const xfo = (res.headers.get('x-frame-options') || '').toLowerCase();
    if (xfo.includes('deny') || xfo.includes('sameorigin')) {
      return json(200, { embeddable: false, reason: 'x-frame-options: ' + xfo }, OK_CACHE);
    }
    const csp = (res.headers.get('content-security-policy') || '').toLowerCase();
    const fa = /frame-ancestors([^;]*)/.exec(csp);
    if (fa) {
      const v = fa[1].trim();
      const allowsUs = v.includes('*') || v.includes('kgsbdoc.netlify.app') || v.includes('https:');
      if (!allowsUs) return json(200, { embeddable: false, reason: 'csp frame-ancestors ' + v.slice(0, 80) }, OK_CACHE);
    }
    return json(200, { embeddable: true, reason: 'ok' }, OK_CACHE);
  } catch (e) {
    return json(200, { embeddable: false, reason: 'fetch-failed: ' + String(e.message || e).slice(0, 80) });
  }
};
