// BDOC — Web Push subscription registry (p142, Functions v2)
//
// Stores PushSubscription objects in Netlify Blobs so push-send can fan out
// crisis/outage alerts to phones with the tab CLOSED. This is the half of the
// alerting story the browser cannot do on its own: OutageWatch's in-page
// Notification() only fires while BDOC is open.
//
// WHY .mjs: Netlify only auto-wires Blobs credentials for Functions v2
// (ESM + `export default`). The v1 CJS form gets siteID but no token and
// every write fails with "The environment has not been configured to use
// Netlify Blobs" — verified live on p140/p141. sentinel.mjs is the working
// precedent; do not port this back to exports.handler.
//
// Endpoints:
//   GET  /.netlify/functions/push-subscribe              -> { publicKey, count }
//   POST /.netlify/functions/push-subscribe  {subscription, tier?, label?}
//   POST /.netlify/functions/push-subscribe  {unsubscribe:true, endpoint}

import { getStore } from '@netlify/blobs';

export const STORE = 'bdoc-push';

// p140 VAPID keypair. The public half is public by definition — the browser
// ships it in every subscribe call. Only VAPID_PRIVATE_KEY lives in env.
export const VAPID_PUBLIC = 'BPWhkfr5e-I2RFVf7t12MvhnIRXaPu4-XZNlqUVVRVlSOctwVYq2JXhzDrAgMcIOO_rDsBSarEjhwYvS1h7JSwo';

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

export function store() {
  return getStore(STORE);
}

// Endpoint URLs are long and contain '/', which Blobs keys tolerate poorly.
// Hash to a stable short key so re-subscribing overwrites instead of duplicating.
export function keyFor(endpoint) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < endpoint.length; i++) {
    h1 = ((h1 ^ endpoint.charCodeAt(i)) * 0x01000193) >>> 0;
    h2 = ((h2 + endpoint.charCodeAt(i) * (i + 7)) * 16777619) >>> 0;
  }
  return 'sub_' + h1.toString(16) + h2.toString(16);
}

const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: HEADERS });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: HEADERS });

  if (req.method === 'GET') {
    const qs = new URL(req.url).searchParams;

    // Diagnostic: read back ONE known subscription by endpoint. This separates
    // "the write never landed" from "list() is eventually consistent" — two
    // failures that look identical from a count of zero.
    const probe = qs.get('probe');
    if (probe) {
      try {
        const rec = await store().get(keyFor(probe), { type: 'json', consistency: 'strong' });
        return J({ probe: keyFor(probe), found: !!rec, created: rec && rec.created });
      } catch (e) {
        return J({ probe: keyFor(probe), found: false, err: String(e && e.message).slice(0, 160) });
      }
    }

    let count = 0, storeErr = null;
    try {
      // Netlify Blobs list() lags reality in BOTH directions — verified live:
      // a fresh write is invisible for a while, and a deleted key keeps
      // appearing after get() already returns null. Strong consistency fixes
      // the write lag; only reading each key back fixes the delete lag. A
      // subscriber count that reports ghosts is exactly the "stale picture
      // that looks live" failure, so pay the reads — this call is rare.
      const { blobs } = await store().list({ prefix: 'sub_', consistency: 'strong' });
      const st = store();
      const live = await Promise.all(blobs.map(async b => {
        try { return !!(await st.get(b.key, { type: 'json', consistency: 'strong' })); }
        catch (_) { return false; }
      }));
      count = live.filter(Boolean).length;
    } catch (e) { storeErr = String(e && e.message).slice(0, 140); }
    return J({
      publicKey: VAPID_PUBLIC,
      count,
      sendReady: !!process.env.VAPID_PRIVATE_KEY,
      storeErr
    });
  }

  if (req.method !== 'POST') return J({ error: 'method not allowed' }, 405);

  let body;
  try { body = await req.json(); }
  catch (_) { return J({ error: 'bad json' }, 400); }
  body = body || {};

  // Validate BEFORE touching storage: a malformed body is a 400 regardless of
  // whether Blobs happens to be wired, and mixing the two makes client-side
  // debugging a guessing game.
  if (body.unsubscribe) {
    if (!body.endpoint) return J({ error: 'endpoint required' }, 400);
  } else {
    const s = body.subscription;
    if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) {
      return J({ error: 'invalid subscription' }, 400);
    }
  }

  let st;
  try { st = store(); }
  catch (e) { return J({ error: 'blobs unavailable: ' + String(e && e.message).slice(0, 160) }, 503); }

  if (body.unsubscribe) {
    try { await st.delete(keyFor(body.endpoint)); } catch (_) {}
    return J({ ok: true, unsubscribed: true });
  }

  const sub = body.subscription;
  const rec = {
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    tier: body.tier || 'recon',
    label: String(body.label || '').slice(0, 80),
    ua: (req.headers.get('user-agent') || '').slice(0, 160),
    created: new Date().toISOString()
  };

  try { await st.setJSON(keyFor(sub.endpoint), rec); }
  catch (e) { return J({ error: 'store write failed: ' + String(e && e.message).slice(0, 160) }, 503); }

  return J({ ok: true, key: keyFor(sub.endpoint) });
};

export const config = { path: '/.netlify/functions/push-subscribe' };
