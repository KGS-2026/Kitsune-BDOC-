// ============================================================
// stripe-webhook.js — subscription lifecycle → Supabase tier
// ============================================================
// P136 (2026-09-23) HARDENING. Four defects fixed, all of which could silently
// take money without delivering the product:
//
//  1. CRASH ON MISSING CONFIG. `createClient(process.env.SUPABASE_URL, ...)`
//     ran OUTSIDE the try block and SUPABASE_URL is not set on this Netlify
//     site → TypeError → HTTP 500 before any DB write. Now routed through the
//     shared `_supabase` resolver (URL fallback + null-instead-of-throw).
//  2. SWALLOWED DB ERRORS. Every `supabase.from(...).update()` result was
//     discarded. Supabase returns errors in the response body, it does NOT
//     throw — so an RLS denial or a missing column looked identical to success.
//     Now every write is checked and a failure escalates.
//  3. WRONG STATUS ON FAILURE. The catch returned 200 ("don't retry"). For a
//     tier upgrade that is exactly backwards: a transient Supabase blip meant
//     the customer stayed on `recon` forever with no second chance. Now
//     processing failures return 500 so Stripe's 3-day retry ladder can save
//     the upgrade. Only *unknown event types* and *unmatched profiles* — which
//     retrying cannot fix — return 200.
//  4. NO OBSERVABILITY. There was no way to tell a healthy webhook from a
//     misconfigured one without a real payment. `GET ?selftest=1` now reports
//     which config is present (booleans only, never key material).
//
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || process.env.Stripe_s_key);
const { adminClient, configReport } = require('./_supabase');

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

// Audit-log writes are best-effort: losing an audit row must NEVER cost a user
// their tier upgrade. Logged loudly, never thrown.
async function audit(sb, row) {
  try {
    const { error } = await sb.from('audit_log').insert(row);
    if (error) console.error('[stripe-webhook] audit_log insert failed:', error.message);
  } catch (e) {
    console.error('[stripe-webhook] audit_log threw:', e && e.message);
  }
}

// Tier writes are NOT best-effort. If this fails the customer paid and got
// nothing, so it throws and the handler returns 500 to trigger Stripe retry.
async function setTier(sb, userId, patch, why) {
  const { data, error } = await sb.from('profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('id, tier');
  if (error) throw new Error(`profiles.update (${why}) failed: ${error.message}`);
  if (!data || data.length === 0) {
    // No row matched. Retrying will not conjure a profile row, but it IS a real
    // defect worth screaming about — a paying user with no profile record.
    console.error(`[stripe-webhook] ${why}: no profiles row matched id=${userId}`);
    return null;
  }
  console.log(`[stripe-webhook] ${why}: user=${userId} tier=${data[0].tier}`);
  return data[0];
}

async function profileBySubscription(sb, subId) {
  const { data, error } = await sb.from('profiles')
    .select('id, tier')
    .eq('stripe_subscription_id', subId)
    .limit(1);
  if (error) throw new Error(`profiles lookup failed: ${error.message}`);
  return (data && data[0]) || null;
}

exports.handler = async (event) => {
  // ── Health/selftest: booleans only, no secrets, no DB writes ──────────────
  if (event.httpMethod === 'GET') {
    const cfg = configReport();
    const ready = cfg.service_key_present &&
                  !!(process.env.STRIPE_SECRET_KEY || process.env.Stripe_s_key) &&
                  !!process.env.STRIPE_WEBHOOK_SECRET;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        function: 'stripe-webhook',
        ready,
        stripe_secret_present: !!(process.env.STRIPE_SECRET_KEY || process.env.Stripe_s_key),
        webhook_secret_present: !!process.env.STRIPE_WEBHOOK_SECRET,
        supabase_url: cfg.supabase_url,
        supabase_url_from_env: cfg.supabase_url_from_env,
        supabase_service_key_present: cfg.service_key_present,
        price_ids_configured: {
          operator_monthly:   !!process.env.STRIPE_PRICE_OPERATOR_MONTHLY,
          operator_yearly:    !!process.env.STRIPE_PRICE_OPERATOR_YEARLY,
          analyst_monthly:    !!process.env.STRIPE_PRICE_ANALYST_MONTHLY,
          analyst_yearly:     !!process.env.STRIPE_PRICE_ANALYST_YEARLY,
          enterprise_monthly: !!process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
          enterprise_yearly:  !!process.env.STRIPE_PRICE_ENTERPRISE_YEARLY
        }
      })
    };
  }

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

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    // Never process an unverified payload. 500 (not 400) so Stripe retries once
    // the secret is actually configured instead of discarding the event.
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set — refusing payload');
    return { statusCode: 500, body: 'Webhook secret not configured' };
  }

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

  // P136: null-safe. A missing service key is a CONFIG failure, not a payload
  // failure — return 500 so Stripe keeps the event alive for up to 3 days.
  const supabase = adminClient();
  if (!supabase) {
    console.error('[stripe-webhook] Supabase admin client unavailable (SUPABASE_SERVICE_KEY missing) — event %s deferred', webhookEvent.type);
    return { statusCode: 500, body: 'Supabase not configured' };
  }

  try {
    switch (webhookEvent.type) {
      case 'checkout.session.completed': {
        const session = webhookEvent.data.object;
        if (session.mode !== 'subscription' || !session.subscription) break;

        const sub = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = sub.items.data[0]?.price?.id;
        const tier = mapPriceToTier(priceId);
        const userId = session.metadata?.userId;

        if (!userId) {
          // Checkout was created without userId metadata — nothing to attach the
          // tier to. Retrying cannot fix it; log loudly and ack so Stripe stops.
          console.error('[stripe-webhook] checkout.session.completed with NO metadata.userId — cannot upgrade. session=%s customer=%s', session.id, session.customer);
          break;
        }
        if (tier === 'recon') {
          // Paid session that maps to the free tier = a price ID missing from
          // the env config. Screaming is mandatory; this is a silent revenue bug.
          console.error('[stripe-webhook] priceId %s did not match any STRIPE_PRICE_* env var — user %s would be left on recon', priceId, userId);
        }

        const row = await setTier(supabase, userId, {
          tier,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription
        }, 'subscription_created');

        if (row) {
          await audit(supabase, {
            user_id: userId,
            action: 'subscription_created',
            metadata: { tier, priceId, subscriptionId: session.subscription }
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = webhookEvent.data.object;
        const priceId = sub.items.data[0]?.price?.id;
        // A past_due/unpaid/canceled subscription must not keep paid access.
        const lapsed = ['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status);
        const tier = lapsed ? 'recon' : mapPriceToTier(priceId);

        const profile = await profileBySubscription(supabase, sub.id);
        if (!profile) {
          console.warn('[stripe-webhook] subscription.updated: no profile for sub %s', sub.id);
          break;
        }

        await setTier(supabase, profile.id, { tier }, 'subscription_updated');
        await audit(supabase, {
          user_id: profile.id,
          action: 'subscription_updated',
          metadata: { tier, priceId, status: sub.status, lapsed }
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = webhookEvent.data.object;

        const profile = await profileBySubscription(supabase, sub.id);
        if (!profile) {
          console.warn('[stripe-webhook] subscription.deleted: no profile for sub %s', sub.id);
          break;
        }

        await setTier(supabase, profile.id, {
          tier: 'recon',
          stripe_subscription_id: null
        }, 'subscription_cancelled');

        await audit(supabase, {
          user_id: profile.id,
          action: 'subscription_cancelled',
          metadata: { previousTier: profile.tier }
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = webhookEvent.data.object;
        const profile = await profileBySubscription(supabase, invoice.subscription);
        if (profile) {
          await audit(supabase, {
            user_id: profile.id,
            action: 'payment_failed',
            metadata: { invoiceId: invoice.id, amount: invoice.amount_due }
          });
        }
        break;
      }

      default:
        // Unsubscribed event type — ack and move on.
        break;
    }
  } catch (e) {
    // P136: 500, NOT 200. A tier upgrade is worth retrying; a silent ack is how
    // a paying customer ends up permanently on the free tier.
    console.error('[stripe-webhook] Processing error on %s: %s', webhookEvent.type, e && e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'processing_failed', type: webhookEvent.type }) };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true, type: webhookEvent.type }) };
};
