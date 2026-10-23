// CSP violation collector (p158).
//
// Receives reports while Content-Security-Policy-Report-Only is active, so we
// learn what a strict policy WOULD break before enforcing it and blanking the
// app on a 767 KB inline script.
//
// Security notes:
//  - Unauthenticated by necessity (the browser posts these with no session),
//    so it is rate-limited and size-capped. An open logging endpoint is a free
//    log-flooding primitive otherwise.
//  - Writes nothing to a database. Netlify function logs only. A CSP report
//    contains the blocked URI and a source-file snippet, which can include
//    fragments of page content — that is not something to persist next to
//    user records.
//  - Always answers 204 regardless of outcome. A report endpoint that returns
//    errors tells an attacker their probe landed.

'use strict';

const MAX_BODY = 16 * 1024;          // a real report is < 2 KB
const buckets = new Map();           // ip -> {n, reset}

function rateLimited(ip, max = 30, windowSec = 60) {
  const now = Date.now(), win = windowSec * 1000;
  const b = buckets.get(ip) || { n: 0, reset: now + win };
  if (now > b.reset) { b.n = 0; b.reset = now + win; }
  b.n++; buckets.set(ip, b);
  if (buckets.size > 5000) buckets.clear();
  return b.n > max;
}

const NO_CONTENT = { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return NO_CONTENT;

    const h = {};
    for (const [k, v] of Object.entries(event.headers || {})) h[k.toLowerCase()] = v;
    const ip = h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || 'unknown';
    if (rateLimited(ip)) return NO_CONTENT;

    const raw = event.body || '';
    if (raw.length > MAX_BODY) return NO_CONTENT;

    let r;
    try {
      const j = JSON.parse(raw);
      r = j['csp-report'] || (Array.isArray(j) ? (j[0] && j[0].body) : null) || j;
    } catch (_) { return NO_CONTENT; }
    if (!r || typeof r !== 'object') return NO_CONTENT;

    const pick = (...keys) => {
      for (const k of keys) if (r[k] != null) return String(r[k]).slice(0, 300);
      return '';
    };

    // One line per violation so the Netlify log is greppable:
    //   [csp] directive=connect-src blocked=https://evil.example doc=/ line=0
    console.log('[csp]',
      'directive=' + (pick('effective-directive', 'effectiveDirective', 'violated-directive') || '?'),
      'blocked=' + (pick('blocked-uri', 'blockedURL') || '?'),
      'doc=' + (pick('document-uri', 'documentURL') || '?'),
      'line=' + (pick('line-number', 'lineNumber') || '0'),
      'src=' + (pick('source-file', 'sourceFile') || '-')
    );

    return NO_CONTENT;
  } catch (e) {
    // Never surface anything: a report sink that errors is an oracle.
    return NO_CONTENT;
  }
};
