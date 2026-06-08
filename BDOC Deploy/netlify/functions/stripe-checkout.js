// Creates a Stripe Checkout Session for subscription purchases
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { priceId, userId, email } = JSON.parse(event.body);

    if (!priceId || !userId || !email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing priceId, userId, or email' }) };
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

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.URL || 'https://kgsbdoc.netlify.app'}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: process.env.URL || 'https://kgsbdoc.netlify.app',
      metadata: { userId },
      subscription_data: {
        metadata: { userId }
      },
      allow_promotion_codes: true
    });

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
