// BDOC function guard — server-side auth, tier, origin lock, rate limit.
//
// WHY THIS EXISTS (p157, from the 2026-10-08 external review, finding #14):
// Tier gating lived ONLY in the browser (Auth.canAccess / markLockedLayers).
// Two consequences, both exploitable with no skill:
//   1. DevTools: `Auth.tier='enterprise'; Auth.markLockedLayers()` unlocked
//      every paid layer.
//   2. Every /.netlify/functions/proxy-* was callable directly with no account
//      at all, so paid data was free and our upstream API quotas (FIRMS, OWM,
//      AIS, NewsAPI) could be burned by any scraper.
// The browser cannot be the security boundary. This moves the decision here.
//
// DESIGN NOTES
// - Reads tier with the CALLER'S OWN JWT, not the service key. Under the
//   `profiles_select_own` RLS policy a user can only ever read their own row,
//   so even a bug here cannot leak another account. (Service key would bypass
//   RLS entirely — strictly worse.)
// - Uses this repo's `_supabase.js` for config: the Netlify env var is named
//   `supabase` (anon) and there is NO `SUPABASE_URL`. Hardcoding either name
//   breaks in production — see _supabase.js header.
// - Node 18 on Netlify: @supabase/supabase-js v2 throws at import (needs Node
//   20 WebSocket). PostgREST over plain fetch only. See CLAUDE.md rule 4.
// - FAILS CLOSED on gated layers, OPEN on recon layers: a control-plane outage
//   must never hand out paid data, but must also not break the free map.

'use strict';

// NOTE: guard.js lives in netlify/functions/_lib/, so _supabase.js is one level up.
const { supabaseUrl, anonKey } = require('../_supabase');

const ALLOWED_ORIGINS = (process.env.BDOC_ALLOWED_ORIGINS ||
  'https://kgsbdoc.netlify.app')
  .split(',').map(s => s.trim()).filter(Boolean);

const INTERNAL_SECRET = process.env.BDOC_INTERNAL_SECRET || '';

// Mirror of Auth.canAccess() in js/auth.js. Server is now the source of truth;
// if these drift, the server wins and the client just shows a lock.
const RECON = ['eq', 'conf', 'warlive', 'cable', 'news', 'spaceweather',
  'community', 'borders', 'alerts', 'fire'];

const TIER_RANK = { recon: 0, operator: 1, analyst: 2, enterprise: 3 };

function isReconLayer(layer) { return !layer || RECON.includes(layer); }

// ── token -> {user, tier} with a short cache ───────────────────────────────
// 60s is short enough that a Stripe upgrade lands quickly, long enough that a
// map panning session doesn't hammer /auth/v1/user on every tile request.
const tokenCache = new Map();

async function verifyUser(token) {
  if (!token) return null;
  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return hit;

  const base = supabaseUrl();
  const key = anonKey();
  if (!base || !key) return null;

  const u = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000)
  });
  if (!u.ok) return null;
  const user = await u.json();
  if (!user || !user.id) return null;

  // Caller's own token — RLS restricts this to their row.
  const p = await fetch(
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=tier`,
    { headers: { apikey: key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000) }
  );
  const rows = p.ok ? await p.json() : [];
  const entry = {
    user,
    tier: (Array.isArray(rows) && rows[0] && rows[0].tier) || 'recon',
    exp: Date.now() + 60_000
  };
  tokenCache.set(token, entry);
  if (tokenCache.size > 5000) tokenCache.clear();
  return entry;
}

function tierAllows(tier, layer) {
  if (isReconLayer(layer)) return true;
  const rank = TIER_RANK[tier];
  if (rank === undefined) return false;
  // analyst / enterprise = all layers; operator = everything except nothing
  // special today, but kept explicit so adding an analyst-only layer is a
  // one-line change instead of a rewrite.
  return rank >= TIER_RANK.operator;
}

// ── per-instance rate limit (speed bump, not a guarantee) ──────────────────
// Netlify spins many instances; this stops a single scraper on one warm
// instance. A durable limit needs the bdoc_rate_hit() SQL function.
const buckets = new Map();
function rateLimited(key, max, windowSec) {
  const now = Date.now(), win = windowSec * 1000;
  const b = buckets.get(key) || { n: 0, reset: now + win };
  if (now > b.reset) { b.n = 0; b.reset = now + win; }
  b.n++; buckets.set(key, b);
  if (buckets.size > 20000) buckets.clear();
  return b.n > max;
}

function timingSafeEqual(a, b) {
  const crypto = require('crypto');
  const A = Buffer.from(String(a || '')), B = Buffer.from(String(b || ''));
  return A.length > 0 && A.length === B.length && crypto.timingSafeEqual(A, B);
}

function corsHeaders(origin) {
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin, Authorization'
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, X-BDOC-Internal';
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  }
  return h;
}

function deny(status, error, origin, extra) {
  return {
    statusCode: status,
    headers: { ...corsHeaders(origin), 'Cache-Control': 'no-store', ...(extra || {}) },
    body: JSON.stringify({ error, _bdoc: { degraded: true, at: new Date().toISOString() } })
  };
}

/**
 * wrap(opts, innerHandler) — add auth/tier/rate to an EXISTING v1 handler
 * without rewriting it.
 *
 *   const { wrap } = require('./_lib/guard');
 *   const inner = async (event) => { ...existing body... };
 *   exports.handler = wrap({ layer: 'vessels' }, inner);
 *
 * After auth, the inner handler can read event.bdocUser / event.bdocTier.
 * NEVER trust a userId sent by the client.
 *
 * opts:
 *   layer    — layer id, or (event) => id for multi-layer proxies.
 *              Recon layers stay open to guests; anything else needs a tier.
 *   auth     — override: 'user' | 'internal' | 'none'
 *   rate     — [maxRequests, windowSeconds] per IP. Default [120, 60].
 *   methods  — allowed HTTP methods. Default ['GET'].
 *   name     — label for rate-limit bucketing and logs.
 */
function wrap(opts, inner) {
  const o = { rate: [120, 60], methods: ['GET', 'OPTIONS'], sameOrigin: true, ...opts };

  return async (event, context) => {
    const hdr = {};
    for (const [k, v] of Object.entries(event.headers || {})) hdr[k.toLowerCase()] = v;
    const origin = hdr['origin'] || '';
    const method = event.httpMethod || 'GET';
    const ip = hdr['x-nf-client-connection-ip'] || hdr['x-forwarded-for'] || 'unknown';

    try {
      if (method === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders(origin), body: '' };
      }
      if (!o.methods.includes(method)) return deny(405, 'method not allowed', origin);

      // Cross-site browser calls: refuse. Non-browser clients send no Origin,
      // so curl/scripts still work but still face auth below.
      if (o.sameOrigin && origin && !ALLOWED_ORIGINS.includes(origin)) {
        return deny(403, 'origin not allowed', origin);
      }
      const site = hdr['sec-fetch-site'];
      if (o.sameOrigin && site && !['same-origin', 'none'].includes(site)) {
        return deny(403, 'cross-site request', origin);
      }

      const layer = typeof o.layer === 'function' ? o.layer(event) : o.layer;
      const bucket = `${ip}:${o.name || layer || 'fn'}`;
      if (rateLimited(bucket, o.rate[0], o.rate[1])) {
        return deny(429, 'rate limit', origin, { 'Retry-After': String(o.rate[1]) });
      }

      const mode = o.auth || (isReconLayer(layer) ? 'none' : 'user');

      if (mode === 'internal') {
        if (!INTERNAL_SECRET || !timingSafeEqual(hdr['x-bdoc-internal'], INTERNAL_SECRET)) {
          return deny(401, 'authentication required', origin);
        }
      } else if (mode === 'user') {
        const m = /^Bearer\s+(.+)$/i.exec(hdr['authorization'] || '');
        const who = m ? await verifyUser(m[1]) : null;
        if (!who) return deny(401, 'sign in required', origin);
        if (!tierAllows(who.tier, layer)) {
          return deny(402, 'upgrade required', origin);
        }
        event.bdocUser = who.user;
        event.bdocTier = who.tier;
      }

      return await inner(event, context);
    } catch (e) {
      // Full detail stays in Netlify logs; the client learns nothing useful.
      console.error(`[guard:${o.name || 'fn'}]`, (e && e.stack) || e);
      return deny(502, 'upstream error', origin);
    }
  };
}

module.exports = { wrap, verifyUser, tierAllows, isReconLayer, ALLOWED_ORIGINS, RECON, TIER_RANK };
