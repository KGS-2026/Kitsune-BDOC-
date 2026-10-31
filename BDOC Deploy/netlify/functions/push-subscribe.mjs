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
//   GET  /.netlify/functions/push-subscribe              -> { publicKey, count, stale, sendReady }
//   POST /.netlify/functions/push-subscribe  {subscription, vapid?, tier?, label?}
//   POST /.netlify/functions/push-subscribe  {unsubscribe:true, endpoint}

import { createECDH } from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const STORE = 'bdoc-push';

// p140 public key. Its private half never reached Netlify, so nothing was ever
// sent with it. Subscriptions from before p161 are bound to it and carry no
// `vapid` field; once a new key is set, naming those is all this is for.
const P140_PUBLIC = 'BPWhkfr5e-I2RFVf7t12MvhnIRXaPu4-XZNlqUVVRVlSOctwVYq2JXhzDrAgMcIOO_rDsBSarEjhwYvS1h7JSwo';

// The public key is derived, never configured. Two values set apart can drift,
// and a mismatched pair passes every check here and then fails at the push
// service on the first real alert. Only VAPID_PRIVATE_KEY lives in env.
function derivePublic(priv) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(priv || '')) return null;
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(priv, 'base64url'));
    return ecdh.getPublicKey('base64url');
  } catch (_) { return null; }
}

// Null means nothing can be signed. VAPID_PUBLIC is set either way, because a
// browser can arm push before the server half is configured.
export const SIGNING_PUBLIC = derivePublic(process.env.VAPID_PRIVATE_KEY);
export const VAPID_PUBLIC = SIGNING_PUBLIC || P140_PUBLIC;

// A subscription is bound to the key that created it, and push services refuse
// anything signed with another. It cannot receive again until the device
// re-keys, which bdoc-push.js does silently on its next open.
export const isStale = (rec) => (rec.vapid || P140_PUBLIC) !== VAPID_PUBLIC;

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

// ── Subscriber index ────────────────────────────────────────────────────────
// Measured on prod: get() is immediately consistent, but list() lags ~60s in
// BOTH directions even with consistency:'strong' — new keys are invisible and
// deleted keys linger. A fan-out that enumerates via list() would therefore
// miss anyone who armed push in the last minute, which is exactly the moment
// someone arms it (they just saw a crisis banner). So the authoritative roster
// is a single index blob read with get(): immediate, one round trip, no lag.
// list() is kept only as a repair path for an index that got out of sync.
const INDEX_KEY = 'index.json';

export async function readIndex(st) {
  try {
    const idx = await st.get(INDEX_KEY, { type: 'json', consistency: 'strong' });
    return (idx && Array.isArray(idx.keys)) ? idx.keys : [];
  } catch (_) { return []; }
}

async function writeIndex(st, keys) {
  try { await st.setJSON(INDEX_KEY, { keys, updated: new Date().toISOString() }); }
  catch (_) {}
}

export async function indexAdd(st, key) {
  const keys = await readIndex(st);
  if (!keys.includes(key)) { keys.push(key); await writeIndex(st, keys); }
}

export async function indexRemove(st, key) {
  const keys = await readIndex(st);
  const next = keys.filter(k => k !== key);
  if (next.length !== keys.length) await writeIndex(st, next);
}

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

    let count = 0, stale = 0, storeErr = null;
    try {
      const st = store();
      const keys = await readIndex(st);
      // Read each back: the index is the roster, but a record can still be
      // gone. A count that overstates reach is the same class of lie as a
      // stale map that looks live.
      const recs = await Promise.all(keys.map(async k => {
        try { return await st.get(k, { type: 'json', consistency: 'strong' }); }
        catch (_) { return null; }
      }));
      const held = recs.filter(Boolean);
      stale = held.filter(isStale).length;
      count = held.length - stale;
    } catch (e) { storeErr = String(e && e.message).slice(0, 140); }
    return J({
      publicKey: VAPID_PUBLIC,
      count,
      stale,
      sendReady: !!(SIGNING_PUBLIC && process.env.PUSH_SEND_KEY),
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
    const k = keyFor(body.endpoint);
    try { await st.delete(k); } catch (_) {}
    await indexRemove(st, k);
    return J({ ok: true, unsubscribed: true });
  }

  const sub = body.subscription;
  const rec = {
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    // Reported by the device, not assumed from VAPID_PUBLIC: a device still on
    // old code re-posts its old subscription on every boot.
    vapid: body.vapid ? String(body.vapid).slice(0, 100) : undefined,
    tier: body.tier || 'recon',
    label: String(body.label || '').slice(0, 80),
    ua: (req.headers.get('user-agent') || '').slice(0, 160),
    created: new Date().toISOString()
  };

  const k = keyFor(sub.endpoint);
  try { await st.setJSON(k, rec); }
  catch (e) { return J({ error: 'store write failed: ' + String(e && e.message).slice(0, 160) }, 503); }
  await indexAdd(st, k);

  return J({ ok: true, key: k });
};

export const config = { path: '/.netlify/functions/push-subscribe' };
