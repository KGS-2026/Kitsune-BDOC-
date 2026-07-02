// Creates a Stripe Checkout Session for subscription purchases
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || process.env.Stripe_s_key);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { userId, email, tier, annual, promoCode } = body;
    let { priceId } = body;

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
    const PROMO_WHITELIST = ['MILITARY50', 'VETERAN50', 'GWOT50'];
    if (promoCode && PROMO_WHITELIST.includes(String(promoCode).toUpperCase())) {
      try {
        const found = await stripe.promotionCodes.list({ code: String(promoCode).toUpperCase(), active: true, limit: 1 });
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
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ url: session.url, sessionId: session.id })
    };
  } catch (e) {
    console.error('[stripe-checkout] Error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
