// Payment-endpoint authorization tests (p158).
// These cover two IDOR/identity-spoofing holes found during the CISO pass:
//   stripe-portal  accepted a customerId from the body -> opened ANY
//                  customer's billing portal, unauthenticated.
//   stripe-checkout accepted a userId from the body -> the webhook upgrades
//                  whatever id it finds, so a caller could name someone else.
// Both now require a verified Supabase JWT and ignore client-sent identity.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FN = path.join(__dirname, '..', 'netlify', 'functions');
const portalSrc = fs.readFileSync(path.join(FN, 'stripe-portal.js'), 'utf8');
const checkoutSrc = fs.readFileSync(path.join(FN, 'stripe-checkout.js'), 'utf8');
const authSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth.js'), 'utf8');

test('stripe-portal no longer reads customerId from the request body', () => {
  assert.ok(!/const\s*\{\s*customerId\s*\}\s*=\s*JSON\.parse/.test(portalSrc),
    'customerId is still destructured from the body — the IDOR is open');
});

test('stripe-portal requires an Authorization bearer token', () => {
  assert.match(portalSrc, /Bearer/, 'no bearer token check');
  assert.match(portalSrc, /401/, 'no 401 path for unauthenticated callers');
});

test('stripe-portal looks the customer up from the caller profile', () => {
  assert.match(portalSrc, /stripe_customer_id/);
  assert.match(portalSrc, /id=eq\.\$\{encodeURIComponent\(user\.id\)\}/,
    'customer must be pinned to the VERIFIED user id');
});

test('stripe-checkout no longer takes userId/email from the body', () => {
  assert.ok(!/const\s*\{[^}]*\buserId\b[^}]*\}\s*=\s*body/.test(checkoutSrc),
    'userId still destructured from body — identity can be spoofed');
  assert.match(checkoutSrc, /const userId = caller\.id/);
  assert.match(checkoutSrc, /const email = caller\.email/);
});

test('stripe-checkout requires a bearer token and 401s without one', () => {
  assert.match(checkoutSrc, /Bearer/);
  assert.match(checkoutSrc, /sign in required/);
});

test('both payment functions enforce an origin allowlist (no wildcard CORS)', () => {
  for (const [name, src] of [['portal', portalSrc], ['checkout', checkoutSrc]]) {
    assert.match(src, /ALLOWED_ORIGINS/, `${name} has no origin allowlist`);
    assert.ok(!/'Access-Control-Allow-Origin':\s*'\*'/.test(src),
      `${name} still sends wildcard CORS`);
  }
});

test('client no longer sends userId or customerId to the payment endpoints', () => {
  assert.ok(!/userId:this\.user\.id/.test(authSrc),
    'auth.js still sends userId to stripe-checkout');
  assert.ok(!/customerId:this\.profile\.stripe_customer_id/.test(authSrc),
    'auth.js still sends customerId to stripe-portal');
});

test('stripe-checkout keeps its priceId allowlist (regression guard)', () => {
  assert.match(checkoutSrc, /VALID_PRICES/,
    'price allowlist disappeared — arbitrary prices could be charged');
});

test('payment functions never echo raw error text to the caller', () => {
  // Leaking e.message from Stripe can disclose customer ids and internal state.
  assert.ok(!/error:\s*e\.message/.test(portalSrc),
    'stripe-portal leaks raw error text');
});
