// proxy-status.js — proxies Atlassian Statuspage "status.json" feeds.
// WHY: several status pages (e.g. metastatus.com) don't send Access-Control-Allow-Origin,
// so direct browser fetches are CORS-blocked. This proxies them server-side with CORS.
// SECURITY: strictly allowlisted to known status domains — NOT an open proxy (no SSRF).
// Kitsune Global Solutions LLC — Phase 26 (2026-06-01)

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const j = (code, obj) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

// Allowlisted hosts (exact). Add new status domains here as needed.
const ALLOWED_HOSTS = new Set([
  'www.cloudflarestatus.com', 'www.githubstatus.com', 'discordstatus.com',
  'metastatus.com', 'status.datadoghq.com', 'status.twilio.com',
  'www.redditstatus.com', 'status.dropbox.com', 'status.digitalocean.com',
  'www.vercel-status.com', 'www.netlifystatus.com', 'status.openai.com',
  'status.slack.com', 'status.zoom.us', 'status.cloud.google.com',
]);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const url = (event.queryStringParameters || {}).url || '';
  let host;
  try { host = new URL(url).host; } catch (_) { return j(400, { error: 'invalid url' }); }
  if (!ALLOWED_HOSTS.has(host)) return j(403, { error: 'host not allowed: ' + host });

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'KitsuneGlobal/BDOC', 'Accept': 'application/json' }
    });
    const body = await res.text();
    return {
      statusCode: res.ok ? 200 : res.status,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
      body: body || '{}'
    };
  } catch (e) {
    return j(502, { error: e.message });
  }
};
