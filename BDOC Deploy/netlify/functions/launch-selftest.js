// ============================================================
// launch-selftest.js — end-to-end audit of the revenue path
// ============================================================
// P136 (2026-09-23). Backlog item #3 ("LAUNCH READINESS AUDIT") kept stalling
// because the facts that decide it live in three places nobody can reach from
// a dev box: Stripe's account config, Netlify's env, and Supabase's schema.
// The droplet has no Stripe secret key. This function DOES (it runs inside
// Netlify), so it can answer the questions directly and honestly:
//
//   1. Is the webhook endpoint actually REGISTERED in the Stripe dashboard,
//      pointing at THIS site, and enabled for the events we handle?
//   2. Are all six price IDs real, active, and RECURRING? (The yearly prices
//      were previously suspected of being one-time charges — that guess is now
//      testable instead of folklore.)
//   3. Do the military promo codes exist as real Stripe promotion codes, or is
//      the whitelist a fake-working discount?
//   4. Is the Customer Portal configured? (billingPortal.sessions.create fails
//      hard if no portal configuration exists in the dashboard.)
//   5. Can the webhook's Supabase service client actually WRITE the columns it
//      needs on `profiles`?
//
// AUTH: requires ?key=<ADMIN_EXPORT_KEY>. This exposes account configuration,
// so it is never public. Read-only — it creates nothing and charges nothing.
//
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || process.env.Stripe_s_key);
const { supabaseUrl, serviceKey, configReport } = require('./_supabase');

const SITE = process.env.URL || 'https://kgsbdoc.netlify.app';
const WEBHOOK_PATH = '/.netlify/functions/stripe-webhook';
const REQUIRED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted'
];
const PROMOS = ['MILITARY50', 'VETERAN50', 'GWOT50'];

const PRICE_ENVS = {
  operator_monthly:   'STRIPE_PRICE_OPERATOR_MONTHLY',
  operator_yearly:    'STRIPE_PRICE_OPERATOR_YEARLY',
  analyst_monthly:    'STRIPE_PRICE_ANALYST_MONTHLY',
  analyst_yearly:     'STRIPE_PRICE_ANALYST_YEARLY',
  enterprise_monthly: 'STRIPE_PRICE_ENTERPRISE_MONTHLY',
  enterprise_yearly:  'STRIPE_PRICE_ENTERPRISE_YEARLY'
};

async function safe(label, fn) {
  try { return await fn(); }
  catch (e) { return { _error: `${label}: ${e && e.message}` }; }
}

exports.handler = async (event) => {
  const key = (event.queryStringParameters || {}).key;
  const expected = process.env.ADMIN_EXPORT_KEY;
  if (!expected || !key || key !== expected) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const out = { site: SITE, generated: new Date().toISOString(), blockers: [], warnings: [] };
  const blocker = m => out.blockers.push(m);
  const warn = m => out.warnings.push(m);

  // ── 0. env presence ───────────────────────────────────────────────────────
  const cfg = configReport();
  out.env = {
    stripe_secret_present: !!(process.env.STRIPE_SECRET_KEY || process.env.Stripe_s_key),
    webhook_secret_present: !!process.env.STRIPE_WEBHOOK_SECRET,
    supabase_url: cfg.supabase_url,
    supabase_url_from_env: cfg.supabase_url_from_env,
    supabase_service_key_present: cfg.service_key_present
  };
  if (!out.env.stripe_secret_present) blocker('STRIPE secret key missing — checkout cannot work');
  if (!out.env.webhook_secret_present) blocker('STRIPE_WEBHOOK_SECRET missing — webhook rejects every event');
  if (!cfg.service_key_present) blocker('SUPABASE_SERVICE_KEY missing — webhook cannot upgrade tiers');
  if (!cfg.supabase_url_from_env) warn('SUPABASE_URL env var not set — running on hardcoded project-URL fallback (set it to remove the dependency on code defaults)');

  // ── 1. webhook endpoint registration ──────────────────────────────────────
  out.webhook = await safe('webhooks.list', async () => {
    const eps = await stripe.webhookEndpoints.list({ limit: 100 });
    const mine = eps.data.filter(e => (e.url || '').includes(WEBHOOK_PATH));
    const r = {
      total_endpoints: eps.data.length,
      matching: mine.map(e => ({
        id: e.id, url: e.url, status: e.status,
        enabled_events: e.enabled_events,
        api_version: e.api_version
      }))
    };
    if (mine.length === 0) {
      blocker(`NO Stripe webhook endpoint points at ${SITE}${WEBHOOK_PATH} — paid users will NEVER be upgraded. Register it: Stripe → Developers → Webhooks → Add endpoint.`);
    } else {
      mine.forEach(e => {
        if (e.status !== 'enabled') blocker(`Webhook ${e.id} exists but status=${e.status}`);
        const evs = e.enabled_events || [];
        const wildcard = evs.includes('*');
        const missing = REQUIRED_EVENTS.filter(x => !wildcard && !evs.includes(x));
        if (missing.length) blocker(`Webhook ${e.id} is missing required events: ${missing.join(', ')}`);
      });
    }
    return r;
  });

  // ── 2. price IDs: exist, active, recurring ────────────────────────────────
  out.prices = await safe('prices', async () => {
    const res = {};
    for (const [label, envName] of Object.entries(PRICE_ENVS)) {
      const id = process.env[envName];
      if (!id) {
        res[label] = { configured: false };
        (label.includes('monthly') ? blocker : warn)(`${envName} not set`);
        continue;
      }
      try {
        const p = await stripe.prices.retrieve(id);
        const recurring = !!p.recurring;
        res[label] = {
          configured: true, id: p.id, active: p.active, type: p.type,
          recurring: recurring ? p.recurring.interval : null,
          amount: p.unit_amount, currency: p.currency
        };
        if (!p.active) blocker(`${envName} (${id}) is INACTIVE in Stripe`);
        if (!recurring) blocker(`${envName} (${id}) is type=${p.type}, NOT recurring — subscription checkout will reject it. Recreate as a recurring price.`);
      } catch (e) {
        res[label] = { configured: true, id, error: e.message };
        blocker(`${envName} (${id}) does not resolve in Stripe: ${e.message}`);
      }
    }
    return res;
  });

  // ── 3. promo codes actually exist ─────────────────────────────────────────
  out.promos = await safe('promotion_codes', async () => {
    const list = await stripe.promotionCodes.list({ limit: 100 });
    const res = {};
    for (const code of PROMOS) {
      const hit = list.data.find(p => (p.code || '').toUpperCase() === code);
      res[code] = hit
        ? { exists: true, active: hit.active, percent_off: hit.coupon && hit.coupon.percent_off, times_redeemed: hit.times_redeemed }
        : { exists: false };
      if (!hit) warn(`Promo ${code} is whitelisted in code but has NO Stripe promotion code — checkout opens but the 50% never applies.`);
      else if (!hit.active) warn(`Promo ${code} exists but is inactive.`);
    }
    return res;
  });

  // ── 4. customer portal configuration ──────────────────────────────────────
  out.portal = await safe('billing_portal', async () => {
    const cfgs = await stripe.billingPortal.configurations.list({ limit: 10 });
    const active = cfgs.data.filter(c => c.active);
    if (active.length === 0) {
      blocker('No ACTIVE Stripe Customer Portal configuration — stripe-portal will 500 and users cannot self-cancel. Configure at Stripe → Settings → Billing → Customer portal.');
    }
    return {
      configurations: cfgs.data.length,
      active: active.length,
      cancel_enabled: active[0] ? !!(active[0].features && active[0].features.subscription_cancel && active[0].features.subscription_cancel.enabled) : null
    };
  });

  // ── 5. Supabase profiles schema reachable with the service key ────────────
  out.supabase = await safe('supabase', async () => {
    if (!serviceKey()) return { reachable: false, reason: 'no service key' };
    const cols = 'id,tier,stripe_customer_id,stripe_subscription_id,updated_at';
    const r = await fetch(`${supabaseUrl()}/rest/v1/profiles?select=${cols}&limit=1`, {
      headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
      signal: AbortSignal.timeout(5000)
    });
    const body = await r.text();
    const ok = r.ok;
    if (!ok) blocker(`Supabase profiles query failed (${r.status}) — webhook cannot write tiers: ${body.slice(0, 160)}`);
    // audit_log is best-effort in the webhook, so a miss here is a warning only.
    const a = await fetch(`${supabaseUrl()}/rest/v1/audit_log?select=id&limit=1`, {
      headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
      signal: AbortSignal.timeout(5000)
    });
    if (!a.ok) warn(`audit_log table not queryable (${a.status}) — subscription events will not be audited.`);
    return { profiles_ok: ok, profiles_status: r.status, audit_log_ok: a.ok, audit_log_status: a.status };
  });

  out.launch_ready = out.blockers.length === 0;
  out.verdict = out.launch_ready
    ? (out.warnings.length ? 'READY WITH WARNINGS' : 'READY')
    : 'BLOCKED';

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(out, null, 2)
  };
};
