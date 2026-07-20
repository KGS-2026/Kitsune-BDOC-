// ════════════════════════════════════════════════════════════════════════════
//  proxy-feed.js — GENERIC, ALLOWLIST-DRIVEN API PROXY
//  Kitsune Global Solutions LLC
// ────────────────────────────────────────────────────────────────────────────
//  PURPOSE: add a NEW keyed REST/GET feed WITHOUT writing a new function file.
//  To plug in a new API:
//     1) Add ONE entry to the FEEDS map below (copy the EXAMPLE block).
//     2) In Netlify → Site configuration → Environment variables, add the key
//        named in `keyEnv`. (The key value lives ONLY in Netlify — never here.)
//     3) Call it from the app:  /api/proxy-feed?feed=NAME&<your params>
//
//  The real key is injected server-side; the browser never sees it.
//
//  SECURITY: this is STRICTLY allowlisted. It will only call URLs defined below.
//  It is NOT an open proxy — unknown `feed` names are rejected, so it can't be
//  abused to fetch arbitrary URLs (no SSRF).
// ════════════════════════════════════════════════════════════════════════════

const FEEDS = {
  // ─── EXAMPLE — copy this whole block, rename "example", edit the fields ────
  // example: {
  //   url:    'https://api.example.com/v1/data', // upstream base URL (NO key in it)
  //   keyEnv: 'EXAMPLE_API_KEY',                 // env-var NAME you set in Netlify
  //   keyIn:  'query',                           // 'query' | 'header' | 'none'
  //   keyName:'apikey',                          // query param OR header name for the key
  //   keyPrefix: '',                             // e.g. 'Bearer ' for header auth (optional)
  //   params: ['lat', 'lon', 'limit'],           // client params allowed to pass through
  //   ttl:    300                                // cache seconds (optional, default 300)
  // },

  // Add real feeds below this line ↓↓↓

  // ─── Trefle — botanical plant database ────────────────────────────────────
  // Netlify env var: Trefle  (set in Site configuration → Environment variables)
  // Docs: https://trefle.io/reference  |  Free tier: 100 req/day
  // Usage: /api/proxy-feed?feed=trefle-search&q=oak
  //        /api/proxy-feed?feed=trefle-plants&id=123456
  'trefle-search': {
    url:     'https://trefle.io/api/v1/plants/search',
    keyEnv:  'Trefle',
    keyIn:   'query',
    keyName: 'token',
    params:  ['q', 'page', 'filter', 'filter_not', 'range', 'order'],
    ttl:     3600   // plant data barely changes — cache 1 hour
  },
  'trefle-plants': {
    url:     'https://trefle.io/api/v1/plants',
    keyEnv:  'Trefle',
    keyIn:   'query',
    keyName: 'token',
    params:  ['page', 'filter', 'range', 'order', 'q'],
    ttl:     3600
  },
  'trefle-species': {
    url:     'https://trefle.io/api/v1/species',
    keyEnv:  'Trefle',
    keyIn:   'query',
    keyName: 'token',
    params:  ['q', 'page', 'filter', 'range', 'order'],
    ttl:     3600
  },
};

// ─── plumbing (you shouldn't need to touch anything past here) ───────────────
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const p = event.queryStringParameters || {};
  const feed = String(p.feed || '');
  const cfg = FEEDS[feed];
  if (!cfg) return json(400, { error: 'unknown feed: ' + feed, available: Object.keys(FEEDS) });

  // Resolve the key from Netlify env (never hardcoded here)
  const key = cfg.keyEnv ? (process.env[cfg.keyEnv] || '') : '';
  if (cfg.keyEnv && cfg.keyIn !== 'none' && !key) {
    return json(503, { error: 'feed "' + feed + '" not configured — set ' + cfg.keyEnv + ' in Netlify env vars', feed });
  }

  // Build the upstream URL: only allowlisted params pass through
  let url;
  try { url = new URL(cfg.url); } catch (_) { return json(500, { error: 'bad feed url config', feed }); }
  for (const k of (cfg.params || [])) if (p[k] != null) url.searchParams.set(k, String(p[k]));

  // Inject the key the way this upstream expects it
  const headers = { 'User-Agent': 'KitsuneGlobal/BDOC' };
  if (key) {
    if (cfg.keyIn === 'header') headers[cfg.keyName || 'Authorization'] = (cfg.keyPrefix || '') + key;
    else if (cfg.keyIn !== 'none') url.searchParams.set(cfg.keyName || 'key', key); // default: query param
  }

  try {
    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(10000) });
    const body = await res.text();
    return {
      statusCode: res.ok ? 200 : res.status,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Netlify-Vary': 'query', 'Cache-Control': `public, max-age=${cfg.ttl || 300}` },
      body
    };
  } catch (e) {
    return json(502, { error: e.message, feed });
  }
};
