// Creates a Stripe Customer Portal session for subscription self-service.
//
// ══ p158 SECURITY FIX — IDOR on another customer's billing ══════════════════
// Before: this accepted `customerId` from the REQUEST BODY with no
// authentication and no ownership check, then opened a Stripe billing portal
// for it. Anyone who learned or guessed a `cus_...` id could open a portal
// session for that customer and see their invoices, payment-method details
// and subscription — and cancel it. Stripe customer ids also appear in
// receipts and support emails, so they are not secret.
//
// After: the caller MUST present a valid Supabase JWT. The customer id is
// looked up from THEIR OWN profile row, server-side. Nothing the client sends
// is trusted. A client-supplied customerId is now ignored entirely.
//
// Node 18 on Netlify: no @supabase/supabase-js (it throws at import, needs
// Node 20 WebSocket). PostgREST over fetch via _supabase.js — CLAUDE.md rule 4.

'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || process.env.Stripe_s_key);
const { supabaseUrl, anonKey, serviceKey } = require('./_supabase');

const ALLOWED_ORIGINS = (process.env.BDOC_ALLOWED_ORIGINS || 'https://kgsbdoc.netlify.app')
  .split(',').map(s => s.trim()).filter(Boolean);

function cors(origin) {
  const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  }
  return h;
}

// Verify the Supabase JWT and return the user. Never trust a client-sent id.
async function callerFromToken(token) {
  if (!token) return null;
  const base = supabaseUrl(), key = anonKey();
  if (!base || !key) return null;
  const r = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

exports.handler = async (event) => {
  const hdr = {};
  for (const [k, v] of Object.entries(event.headers || {})) hdr[k.toLowerCase()] = v;
  const origin = hdr['origin'] || '';

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(origin), body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors(origin), body: JSON.stringify({ error: 'method not allowed' }) };
  }
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return { statusCode: 403, headers: cors(origin), body: JSON.stringify({ error: 'origin not allowed' }) };
  }

  try {
    const m = /^Bearer\s+(.+)$/i.exec(hdr['authorization'] || '');
    const user = m ? await callerFromToken(m[1]) : null;
    if (!user) {
      return { statusCode: 401, headers: cors(origin), body: JSON.stringify({ error: 'sign in required' }) };
    }

    // Service key here is correct and necessary: we are reading a billing
    // column the user is NOT permitted to read or write themselves. The row
    // is pinned to their verified id, so this cannot read anyone else.
    const base = supabaseUrl();
    const sk = serviceKey();
    const p = await fetch(
      `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=stripe_customer_id`,
      { headers: { apikey: sk, Authorization: `Bearer ${sk}` }, signal: AbortSignal.timeout(8000) }
    );
    const rows = p.ok ? await p.json() : [];
    const customerId = Array.isArray(rows) && rows[0] && rows[0].stripe_customer_id;

    if (!customerId) {
      // Known gap: the webhook is not yet writing stripe_customer_id back to
      // the profile, so this is currently the common path for real customers.
      // Returning 404 is still correct — we will not open a portal for an
      // account we cannot prove owns a Stripe customer.
      return {
        statusCode: 404,
        headers: cors(origin),
        body: JSON.stringify({ error: 'no billing account linked to this login' })
      };
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: process.env.URL || 'https://kgsbdoc.netlify.app'
    });

    return { statusCode: 200, headers: cors(origin), body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    // Detail to the logs, nothing useful to the caller.
    console.error('[stripe-portal]', e && e.stack || e);
    return { statusCode: 502, headers: cors(origin), body: JSON.stringify({ error: 'portal unavailable' }) };
  }
};
