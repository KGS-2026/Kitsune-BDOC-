// BDOC — LIVE WIRE owner gate (p160)
//
// WHY THIS EXISTS: the wire is one person's feed, and the Realtime topic this
// function hands out is the only thing between the public internet and it. So
// "is this caller the owner?" is answered here on the server, and every way of
// not knowing the answer counts as no.
//
// DESIGN NOTES
// - Matched on the Supabase user ID, which is immutable. Never on email (its
//   holder can change it) or tier (Stripe can change it).
// - The token is judged by Supabase, not by us: /auth/v1/user with the anon key.
//   Decoding a JWT here would prove nothing without the signing key. Plain Node
//   18 fetch, no SDK, because supabase-js v2 throws at import (CLAUDE.md rule 4).
// - Stands alone instead of reusing _lib/guard.js and _supabase.js. Those are
//   CommonJS, Blobs forces wire.mjs to be Functions v2 ESM, and esbuild's
//   `require` shim throws at call time. The env names and default URL below are
//   copied from _supabase.js on purpose: the site has no SUPABASE_URL set, and
//   the anon key env var really is named `supabase`.
// - Three kinds of no. 401 is a bad token, 403 is somebody else's token, and 503
//   is "we could not find out". The last is not a 401 because telling the owner's
//   browser it was signed out during a Supabase blip would cost the owner the feed at
//   exactly the wrong moment. All three withhold everything.

import { createHash } from 'node:crypto';

const DEFAULT_URL = 'https://ulgxbqhbgbyxlzoyxcus.supabase.co';

// Same window as guard.js, and short enough that a revoked session dies quickly.
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 1000;
const TOKEN_MAX = 8192;

// Shorter than guard.js's 8 s: the Blobs read still has to fit in the same request.
const LOOKUP_TIMEOUT_MS = 6000;

const BAD_TOKEN = { ok: false, status: 401, error: 'unauthorized' };
const NOT_OWNER = { ok: false, status: 403, error: 'forbidden' };
const UNKNOWN = { ok: false, status: 503, error: 'unavailable' };

// Keyed by a hash so a heap dump or a stray log line never yields a live token.
const cache = new Map();

function supabaseUrl(env) {
  return env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_URL;
}

function anonKey(env) {
  return env.supabase || env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY ||
         env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

export function ownerIds(env) {
  return new Set(String(env.BDOC_OWNER_IDS || '').split(',')
    .map(s => s.trim().toLowerCase()).filter(Boolean));
}

export function bearerToken(header) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(header || '').trim());
  return m ? m[1] : '';
}

// Shape only, and it can only ever reject. Its job is to keep garbage off
// Supabase, so anyone hammering this endpoint cannot make us do outbound work
// for free. `sub` is required because a user session always has one and the
// public anon key, which is also a JWT, does not.
export function isWellFormedJwt(token) {
  if (typeof token !== 'string' || token.length > TOKEN_MAX) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return false;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return !!claims && typeof claims.sub === 'string' && claims.sub.length > 0;
  } catch (_) {
    return false;
  }
}

// Resolves to the user id, '' when Supabase refused the token, or null when
// Supabase gave no usable answer. Null is never cached: an outage must end the
// moment Supabase comes back, not up to a minute later.
async function lookupUser(token, env) {
  const key = anonKey(env);
  if (!key) return null;

  let res;
  try {
    res = await fetch(`${supabaseUrl(env)}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
    });
  } catch (_) {
    return null;
  }

  if (res.status === 429 || res.status >= 500) return null;
  if (!res.ok) return '';

  // A 200 can still be serving garbage (CLAUDE.md, verification standard).
  try {
    const user = await res.json();
    return user && typeof user.id === 'string' && user.id ? user.id : null;
  } catch (_) {
    return null;
  }
}

/**
 * checkOwner(authorizationHeader, { env, now })
 * -> { ok:true, status:200, id } or { ok:false, status:401|403|503, error }
 *
 * The owner list is the last step and runs on every call, cache hit or not.
 * Skipping the Supabase lookup when BDOC_OWNER_IDS is unset would be cheaper, but
 * a forged token would then get 403 instead of 401 and tell a stranger the env
 * var is missing.
 */
export async function checkOwner(header, opts = {}) {
  const env = opts.env || process.env;
  const now = (opts.now || Date.now)();

  const token = bearerToken(header);
  if (!isWellFormedJwt(token)) return BAD_TOKEN;

  const key = createHash('sha256').update(token).digest('base64');
  let hit = cache.get(key);
  if (!hit || hit.exp <= now) {
    const id = await lookupUser(token, env);
    if (id === null) return UNKNOWN;
    hit = { id, exp: now + CACHE_TTL_MS };
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, hit);
  }

  if (!hit.id) return BAD_TOKEN;
  if (!ownerIds(env).has(hit.id.toLowerCase())) return NOT_OWNER;
  return { ok: true, status: 200, id: hit.id };
}
