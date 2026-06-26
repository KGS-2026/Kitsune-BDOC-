// Handles Stripe webhook events for subscription lifecycle
// Updates user tier in Supabase when subscription changes
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || process.env.Stripe_s_key);
const { createClient } = require('@supabase/supabase-js');

// Map Stripe price IDs to tier names
function mapPriceToTier(priceId) {
  // Guard: if priceId is falsy (null/undefined), always return 'recon' — never a paid tier.
  // Also skip any env-var key that is undefined (unset) to prevent [undefined]→'enterprise'
  // privilege escalation when Stripe price env vars aren't configured.
  if (!priceId) return 'recon';
  const entries = [
    [process.env.STRIPE_PRICE_OPERATOR_MONTHLY,  'operator'],
    [process.env.STRIPE_PRICE_OPERATOR_YEARLY,   'operator'],
    [process.env.STRIPE_PRICE_ANALYST_MONTHLY,   'analyst'],
    [process.env.STRIPE_PRICE_ANALYST_YEARLY,    'analyst'],
    [process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,'enterprise'],
    [process.env.STRIPE_PRICE_ENTERPRISE_YEARLY, 'enterprise'],
  ];
  for (const [envKey, tier] of entries) {
    if (envKey && envKey === priceId) return tier;
  }
  return 'recon';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sig = event.headers['stripe-signature'];
  // Phase 22: Netlify may base64-encode the raw body; Stripe signature verification
  // requires the exact original bytes. Decode before passing to constructEvent.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  let webhookEvent;

  try {
    webhookEvent = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    console.error('[stripe-webhook] Signature verification failed:', e.message);
    return { statusCode: 400, body: `Webhook Error: ${e.message}` };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    switch (webhookEvent.type) {
      case 'checkout.session.completed': {
        const session = webhookEvent.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          const priceId = sub.items.data[0]?.price?.id;
          const tier = mapPriceToTier(priceId);
          const userId = session.metadata?.userId;

          if (userId) {
            await supabase.from('profiles').update({
              tier,
              stripe_customer_id: session.customer,
              stripe_subscription_id: session.subscription,
              updated_at: new Date().toISOString()
            }).eq('id', userId);

            // Audit log
            await supabase.from('audit_log').insert({
              user_id: userId,
              action: 'subscription_created',
              metadata: { tier, priceId, subscriptionId: session.subscription }
            });
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = webhookEvent.data.object;
        const priceId = sub.items.data[0]?.price?.id;
        const tier = mapPriceToTier(priceId);

        const { data: profile } = await supabase.from('profiles')
          .select('id')
          .eq('stripe_subscription_id', sub.id)
          .single();

        if (profile) {
          await supabase.from('profiles').update({
            tier,
            updated_at: new Date().toISOString()
          }).eq('id', profile.id);

          await supabase.from('audit_log').insert({
            user_id: profile.id,
            action: 'subscription_updated',
            metadata: { tier, priceId, status: sub.status }
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = webhookEvent.data.object;

        const { data: profile } = await supabase.from('profiles')
          .select('id, tier') // Phase 22: include tier so previousTier in audit log is populated
          .eq('stripe_subscription_id', sub.id)
          .single();

        if (profile) {
          await supabase.from('profiles').update({
            tier: 'recon',
            stripe_subscription_id: null,
            updated_at: new Date().toISOString()
          }).eq('id', profile.id);

          await supabase.from('audit_log').insert({
            user_id: profile.id,
            action: 'subscription_cancelled',
            metadata: { previousTier: profile.tier }
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = webhookEvent.data.object;
        const subId = invoice.subscription;

        const { data: profile } = await supabase.from('profiles')
          .select('id')
          .eq('stripe_subscription_id', subId)
          .single();

        if (profile) {
          await supabase.from('audit_log').insert({
            user_id: profile.id,
            action: 'payment_failed',
            metadata: { invoiceId: invoice.id, amount: invoice.amount_due }
          });
        }
        break;
      }
    }
  } catch (e) {
    console.error('[stripe-webhook] Processing error:', e.message);
    // Still return 200 to acknowledge receipt — don't retry on processing errors
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
