// ============================================================
// _supabase.js — single source of truth for Supabase connection config
// ============================================================
// WHY THIS EXISTS (P136, 2026-09-23 — launch blocker, found by audit):
//
// The Netlify site has NO `SUPABASE_URL` environment variable set. Only
// `SUPABASE_SERVICE_KEY` and `supabase` (anon) exist. Functions in this repo
// handled that inconsistently:
//
//   admin-user.js / export-contacts.js  → had a hardcoded project-URL fallback → WORKED
//   config.js                           → had the fallback                     → WORKED
//   mesh-nodes / entity-preview / proxy-supabase → returned an honest 503      → degraded
//   stripe-webhook.js                   → createClient(undefined, key) OUTSIDE
//                                         try/catch → THREW → HTTP 500
//
// That last one is the money path. A real customer pays, Stripe fires
// `checkout.session.completed`, the function 500s before it can touch the DB,
// and `profiles.tier` is NEVER upgraded. The customer is charged and receives
// nothing. Stripe retries for 3 days against the same broken config and then
// drops the event permanently.
//
// Fix doctrine: resolve the URL through ONE chain that every function shares,
// and make "unconfigured" a reported state, not an exception.
//
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

// Canonical project URL. This is a PUBLIC endpoint (it is already shipped to
// every browser by netlify/functions/config.js) — it is not a secret. Having it
// here means a missing env var degrades to "correct default" instead of "crash".
const DEFAULT_URL = 'https://ulgxbqhbgbyxlzoyxcus.supabase.co';

function supabaseUrl() {
  return process.env.SUPABASE_URL ||
         process.env.NEXT_PUBLIC_SUPABASE_URL ||
         DEFAULT_URL;
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_KEY ||
         process.env.SUPABASE_SERVICE_ROLE_KEY ||
         '';
}

function anonKey() {
  return process.env.supabase ||
         process.env.SUPABASE_ANON_KEY ||
         process.env.SUPABASE_PUBLISHABLE_KEY ||
         process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
         '';
}

// Booleans only — never echo key material. Used by the /selftest endpoints so a
// config gap is detectable from a curl instead of from a lost customer payment.
function configReport() {
  return {
    supabase_url: supabaseUrl(),
    supabase_url_from_env: !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
    service_key_present: !!serviceKey(),
    anon_key_present: !!anonKey()
  };
}

// Create an admin client or return null. Callers MUST handle null — that is the
// whole point. Never let a missing env var become a thrown exception on a
// payment webhook.
function adminClient() {
  const key = serviceKey();
  if (!key) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    return createClient(supabaseUrl(), key, { auth: { persistSession: false } });
  } catch (e) {
    console.error('[_supabase] createClient failed:', e && e.message);
    return null;
  }
}

module.exports = { DEFAULT_URL, supabaseUrl, serviceKey, anonKey, configReport, adminClient };
