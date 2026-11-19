// BDOC p205 (item 1b chunk E): site canaries.
//
// Decoy URLs no real visitor ever reaches. They're advertised only where someone snooping
// would look: robots.txt "Disallow: /kgs-ops-console/", an HTML comment in 404.html, and a
// fake credentials file on the droplet that points at /ops/auth. Any hit pings the
// Healthchecks check HC_SITE_CANARY (Netlify env) with /fail, and Healthchecks pages Travon
// on Telegram with who it was (IP, place, browser). canary-rearm.mjs sends an OK ping once a
// day, so a later hit alerts again.
//
// Generic scanner paths (/.env, /wp-login.php, /admin…) are deliberately NOT here: bots hit
// those every few minutes on every site, and paging on them would bury the real signal. They
// keep getting the static 404.
//
// Never stores anything the visitor submits (no passwords, no bodies).
import crypto from 'node:crypto';

// sha256 of the decoy token in the droplet's fake credentials file. The token itself lives only
// on the droplet, so a match means someone read that file and is trying it.
const DROPLET_DECOY_SHA256 = '4be7da005fd3def4cbaa74c7f2e165f817aee6fecfc8e4417ddd7e2a547cd376';

const MIN_GAP_MS = 20_000; // one ping per 20 s per instance; Healthchecks alerts once per DOWN anyway
let lastPing = 0;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const clip = (s, n) => String(s || '').replace(/[\r\n\t]+/g, ' ').slice(0, n);

export function classify(req) {
  const url = new URL(req.url);
  const auth = req.headers.get('authorization') || '';
  const presented = url.searchParams.get('k') || url.searchParams.get('key') || auth.replace(/^Bearer\s+/i, '');
  const tokenUsed = !!presented && sha(presented) === DROPLET_DECOY_SHA256;
  if (tokenUsed) return { kind: 'DROPLET DECOY CREDENTIAL USED', severe: true, path: url.pathname };
  if (url.pathname.startsWith('/ops/')) return { kind: 'decoy ops endpoint', severe: false, path: url.pathname };
  return { kind: 'decoy ops console', severe: false, path: url.pathname };
}

export function describe(req, context, c) {
  const geo = (context && context.geo) || {};
  const where = [geo.city, geo.subdivision && geo.subdivision.code, geo.country && geo.country.code].filter(Boolean).join(', ');
  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  const lines = [
    `SITE CANARY: ${c.kind}`,
    `${req.method} ${clip(c.path, 200)}`,
    `from ${ip}${where ? ' (' + where + ')' : ''}`,
    `browser: ${clip(req.headers.get('user-agent'), 300) || '-'}`,
    `referer: ${clip(req.headers.get('referer'), 300) || '-'}`,
  ];
  if (c.severe) lines.push('The token only exists in a decoy file on the droplet: treat the droplet as compromised.');
  return lines.join('\n');
}

const PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<title>401 · Unauthorized</title><style>body{background:#0E1116;color:#9aa4b2;font:14px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}</style>
</head><body><div>401 · Unauthorized</div></body></html>`;

export default async (req, context) => {
  const c = classify(req);
  const text = describe(req, context, c);
  console.log(text.replace(/\n/g, ' | '));

  const hc = process.env.HC_SITE_CANARY;
  const now = Date.now();
  if (hc && (c.severe || now - lastPing > MIN_GAP_MS)) {
    lastPing = now;
    try {
      await fetch(`${hc.replace(/\/$/, '')}/fail`, { method: 'POST', body: text, signal: AbortSignal.timeout(5000) });
    } catch (e) {
      console.log('canary ping failed:', e && e.message);
    }
  }
  return new Response(PAGE, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
};

export const config = { path: ['/kgs-ops-console', '/kgs-ops-console/*', '/ops/auth', '/ops/auth/*'] };
