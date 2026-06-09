# Payment Wiring — hermes/overnight-2026-06-09

## BLUF
The correct subscription backend **already existed** but was **orphaned**: nothing in the
frontend called it. `BDOC_Auth.subscribe()` redirected to bare Stripe Payment Links
(`buy.stripe.com/...`, auth.js old line 332), which carry **no userId**, so the
`stripe-webhook` could never tie a payment to a Supabase account and upgrade the tier.
**That is the real revenue blocker.** This branch rewires the frontend to the existing
Checkout function so `userId` rides along as metadata end-to-end.

## What was already in the repo (good, just disconnected)
- `netlify/functions/stripe-checkout.js` — creates a Stripe Checkout Session with
  `metadata.userId` AND `subscription_data.metadata.userId`, price whitelisting.
- `netlify/functions/stripe-webhook.js` — on `checkout.session.completed`, retrieves the
  subscription, maps priceId→tier, and updates `profiles.tier` + writes `audit_log` in
  Supabase. Also handles `customer.subscription.updated`.
- `netlify/functions/stripe-portal.js` — billing portal.

## What this branch changed
1. **js/auth.js — `subscribe(tierName, annual)`** rewritten:
   - Now `async`. Requires a signed-in user (`this.user.id`); if not signed in, prompts
     sign-in instead of sending an anonymous payment.
   - POSTs `{tier, annual, userId, email}` to `/.netlify/functions/stripe-checkout` and
     redirects to the returned `data.url`.
   - The bare `STRIPE_*_LINK` constants (index.html:1413-1418) are now unused by this path.
2. **netlify/functions/stripe-checkout.js** extended to accept a `tier` name + `annual`
   flag and map it server-side to the configured price env vars (still whitelisted).
   Backwards-compatible: a raw `priceId` still works.

## Environment variables Travon must set in Netlify (TEST keys first)
None were invented. Set these in Netlify → Site settings → Environment variables:

- `STRIPE_SECRET_KEY` = `<PLACEHOLDER: sk_test_...>`
- `STRIPE_WEBHOOK_SECRET` = `<PLACEHOLDER: whsec_...>` (from the Stripe CLI/dashboard webhook)
- `STRIPE_PRICE_OPERATOR_MONTHLY` = `<PLACEHOLDER: price_...>`
- `STRIPE_PRICE_OPERATOR_YEARLY` = `<PLACEHOLDER: price_...>`
- `STRIPE_PRICE_ANALYST_MONTHLY` = `<PLACEHOLDER: price_...>`
- `STRIPE_PRICE_ANALYST_YEARLY` = `<PLACEHOLDER: price_...>`
- `STRIPE_PRICE_ENTERPRISE_MONTHLY` = `<PLACEHOLDER: price_...>`
- `STRIPE_PRICE_ENTERPRISE_YEARLY` = `<PLACEHOLDER: price_...>`
- `SUPABASE_URL` = `<PLACEHOLDER>`
- `SUPABASE_SERVICE_KEY` = `<PLACEHOLDER: service_role key>`

Register the webhook endpoint in Stripe pointing at
`https://<deploy-preview>/.netlify/functions/stripe-webhook` and subscribe to
`checkout.session.completed` and `customer.subscription.updated`.

## Click-path Travon must test at 09:00 (Stripe TEST mode)
1. Open the deploy preview. Sign in (or create an account) so `BDOC_Auth.user.id` exists.
2. Open the pricing modal, click **SUBSCRIBE — Operator $9.99/mo**.
3. Confirm you land on a `checkout.stripe.com` page (NOT `buy.stripe.com`).
4. Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC.
5. After redirect back, confirm in Supabase `profiles` that the row for your user.id now
   has `tier='operator'` and `stripe_subscription_id` populated, and `audit_log` has a
   `subscription_created` row.
6. If tier did not change: check Netlify function logs for `stripe-webhook` signature
   errors (usually `STRIPE_WEBHOOK_SECRET` mismatch or base64 body — the handler already
   decodes base64).

## Note on the military promo
The old path appended `prefilled_promo_code` to the Payment Link URL. With Checkout
Sessions, `allow_promotion_codes:true` is already set in stripe-checkout.js, so testers
can enter the code on the Stripe Checkout page. Auto-prefill of the promo into Checkout
can be added later via `discounts`/coupon mapping — left as a follow-up, not blocking.
