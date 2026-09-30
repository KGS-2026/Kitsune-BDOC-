// BDOC — Web Push subscription registry (p140)
//
// Stores PushSubscription objects in Netlify Blobs so push-send can fan out
// crisis/outage alerts to phones with the tab CLOSED. This is the half of the
// alerting story the browser cannot do on its own: OutageWatch's in-page
// Notification() only fires while BDOC is open.
//
// Endpoints:
//   GET  /.netlify/functions/push-subscribe              -> { publicKey, count }
//   POST /.netlify/functions/push-subscribe  {subscription, tier?, label?}
//   POST /.netlify/functions/push-subscribe  {unsubscribe:true, endpoint}
//
// The VAPID PUBLIC key is baked in as a constant on purpose — it is public by
// definition (the browser ships it in every subscribe call). Only the PRIVATE
// key lives in env (VAPID_PRIVATE_KEY), and only push-send reads it.

const { getStore } = require('@netlify/blobs');

const STORE = 'bdoc-push';

// p140 VAPID keypair. Public half is safe to publish.
const VAPID_PUBLIC = 'BPWhkfr5e-I2RFVf7t12MvhnIRXaPu4-XZNlqUVVRVlSOctwVYq2JXhzDrAgMcIOO_rDsBSarEjhwYvS1h7JSwo';

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

// Same zero-config-first pattern as _snapshot.js — never pass undefined creds.
function store() {
  try {
    return getStore(STORE);
  } catch (_) {
    const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN ||
                   process.env.NETLIFY_AUTH_TOKEN;
    if (!siteID || !token) throw new Error('Netlify Blobs unavailable');
    return getStore({ name: STORE, siteID, token });
  }
}

// Endpoint URLs are long and contain '/', which Blobs keys tolerate poorly.
// Hash to a stable short key so re-subscribing overwrites instead of duplicating.
function keyFor(endpoint) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < endpoint.length; i++) {
    h1 = ((h1 ^ endpoint.charCodeAt(i)) * 0x01000193) >>> 0;
    h2 = ((h2 + endpoint.charCodeAt(i) * (i + 7)) * 16777619) >>> 0;
  }
  return 'sub_' + h1.toString(16) + h2.toString(16);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };

  if (event.httpMethod === 'GET') {
    let count = 0;
    try {
      const { blobs } = await store().list({ prefix: 'sub_' });
      count = blobs.length;
    } catch (_) { /* Blobs unwired — publicKey is still useful to the client */ }
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ publicKey: VAPID_PUBLIC, count, sendReady: !!process.env.VAPID_PRIVATE_KEY })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'bad json' }) }; }

  // Validate the payload BEFORE touching storage: a malformed body is a 400
  // regardless of whether Blobs happens to be wired, and mixing the two makes
  // client-side debugging a guessing game.
  if (!body.unsubscribe) {
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'invalid subscription' }) };
    }
  } else if (!body.endpoint) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'endpoint required' }) };
  }

  let s;
  try { s = store(); }
  catch (e) { return { statusCode: 503, headers: HEADERS, body: JSON.stringify({ error: e.message }) }; }

  if (body.unsubscribe) {
    try { await s.delete(keyFor(body.endpoint)); } catch (_) {}
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, unsubscribed: true }) };
  }

  const sub = body.subscription;
  const rec = {
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    tier: body.tier || 'recon',
    label: (body.label || '').slice(0, 80),
    ua: (event.headers['user-agent'] || '').slice(0, 160),
    created: new Date().toISOString()
  };

  try {
    await s.setJSON(keyFor(sub.endpoint), rec);
  } catch (e) {
    return { statusCode: 503, headers: HEADERS, body: JSON.stringify({ error: 'store write failed: ' + e.message }) };
  }

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, key: keyFor(sub.endpoint) }) };
};

exports._internal = { store, keyFor, VAPID_PUBLIC, STORE };
