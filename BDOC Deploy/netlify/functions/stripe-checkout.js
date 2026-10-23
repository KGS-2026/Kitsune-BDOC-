// Creates a Stripe Checkout Session for subscription purchases
//
// ══ p158 SECURITY FIX — client-supplied identity ════════════════════════════
// Before: `userId` and `email` came straight from the request body and were
// written into the Stripe session metadata. The webhook then upgrades whatever
// userId it finds there. So an unauthenticated caller could start a checkout
// naming SOMEONE ELSE's Supabase id — paying to upgrade another account, or
// more usefully, pairing a victim's id with a promo/test flow. Identity must
// never arrive from the client.
//
// After: a valid Supabase JWT is REQUIRED, and the userId + email written into
// metadata come from the verified token. Anything the body claims is ignored.
// priceId was already allowlisted against VALID_PRICES — that part was right.
'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || process.env.Stripe_s_key);
const { supabaseUrl, anonKey } = require('./_supabase');

const ALLOWED_ORIGINS = (process.env.BDOC_ALLOWED_ORIGINS || 'https://kgsbdoc.netlify.app')
  .split(',').map(s => s.trim()).filter(Boolean);

// Verify the Supabase JWT. Returns {id,email} or null. Never trusts the body.
async function callerFromToken(token) {
  if (!token) return null;
  const base = supabaseUrl(), key = anonKey();
  if (!base || !key) return null;
  try {
    const r = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch (_) { return null; }
}

exports.handler = async (event) => {
  const hdr = {};
  for (const [k, v] of Object.entries(event.headers || {})) hdr[k.toLowerCase()] = v;
  const origin = hdr['origin'] || '';

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0], 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'origin not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { tier, annual, promoCode } = body;
    let { priceId } = body;

    // p158: identity comes from the verified token ONLY. Any userId/email in
    // the body is deliberately discarded.
    const m = /^Bearer\s+(.+)$/i.exec(hdr['authorization'] || '');
    const caller = m ? await callerFromToken(m[1]) : null;
    if (!caller) {
      return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'sign in required' }) };
    }
    const userId = caller.id;
    const email = caller.email;


    // hermes/overnight-2026-06-09: frontend now sends a tier name (operator|analyst|enterprise)
    // + annual flag instead of a raw priceId, so the user's Supabase id always rides along as
    // metadata (bare Payment Links could not do this). Map tier -> configured price env var.
    if (!priceId && tier) {
      const TIER_PRICE_MAP = {
        operator:   annual ? process.env.STRIPE_PRICE_OPERATOR_YEARLY   : process.env.STRIPE_PRICE_OPERATOR_MONTHLY,
        analyst:    annual ? process.env.STRIPE_PRICE_ANALYST_YEARLY    : process.env.STRIPE_PRICE_ANALYST_MONTHLY,
        enterprise: annual ? process.env.STRIPE_PRICE_ENTERPRISE_YEARLY : process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
      };
      priceId = TIER_PRICE_MAP[tier];
    }

    if (!priceId || !userId || !email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing priceId/tier, userId, or email' }) };
    }

    // Whitelist: only accept price IDs we have configured. Prevents a user from passing
    // a cheaper price ID (e.g., a promotional/free price) to bypass the intended pricing.
    const VALID_PRICES = new Set([
      process.env.STRIPE_PRICE_OPERATOR_MONTHLY,
      process.env.STRIPE_PRICE_OPERATOR_YEARLY,
      process.env.STRIPE_PRICE_ANALYST_MONTHLY,
      process.env.STRIPE_PRICE_ANALYST_YEARLY,
      process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
      process.env.STRIPE_PRICE_ENTERPRISE_YEARLY,
    ].filter(Boolean));
    if (!VALID_PRICES.has(priceId)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid price selection' }) };
    }

    // Resolve the client-side promo code (MILITARY50/VETERAN50/GWOT50) to an active
    // Stripe promotion code. Whitelisted to prevent arbitrary code probing. Non-fatal:
    // on any failure we fall back to manual promo entry on the Checkout page.
    let resolvedPromo = null;
    const PROMO_WHITELIST = ['MILITARY50', 'VETERAN50', 'GWOT50', 'YUT50'];
    // normalize "YUT/50" / "YUT 50" -> "YUT50" before whitelist check + Stripe lookup
    const normalizedPromo = promoCode ? String(promoCode).toUpperCase().replace(/[\s/\\-]+/g, '') : '';
    if (normalizedPromo && PROMO_WHITELIST.includes(normalizedPromo)) {
      try {
        const found = await stripe.promotionCodes.list({ code: normalizedPromo, active: true, limit: 1 });
        if (found.data.length) resolvedPromo = found.data[0].id;
      } catch (e) { console.warn('[stripe-checkout] promo lookup failed:', e.message); }
    }

    const session = await stripe.checkout.sessions.create((() => {
      const cfg = {
        mode: 'subscription',
        customer_email: email,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.URL || 'https://kgsbdoc.netlify.app'}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: process.env.URL || 'https://kgsbdoc.netlify.app',
        metadata: { userId },
        subscription_data: {
          metadata: { userId }
        }
      };
      // Military promo: if the client applied a promo code (MILITARY50 etc.), attach the
      // matching Stripe promotion code directly so the discount is pre-applied. Falls back
      // to allow_promotion_codes (manual entry) when lookup fails or no code was sent.
      // NOTE: 'discounts' and 'allow_promotion_codes' are mutually exclusive in Stripe.
      if (resolvedPromo) {
        cfg.discounts = [{ promotion_code: resolvedPromo }];
      } else {
        cfg.allow_promotion_codes = true;
      }
      return cfg;
    })());

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0], 'Cache-Control': 'no-store', 'Vary': 'Origin' },
      body: JSON.stringify({ url: session.url, sessionId: session.id })
    };
  } catch (e) {
    console.error('[stripe-checkout] Error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
