// ============================================================
// snapshot.js — shared helper for the root.json pointer pattern
// ============================================================
// TECHNIQUE SOURCE: Google Earth Web recon (§4.2).
// mw1.gstatic.com/mw-weather/clouds-cubemap/root.json is 83 BYTES and contains
// exactly one field — a baseUrl pointing at a DATED IMMUTABLE snapshot dir:
//
//   { "baseUrl": ".../clouds-cubemap/20260407_2000/" }
//
// That tiny file is the ENTIRE cache-invalidation strategy:
//   - root.json          → max-age=60      (hit it constantly, costs nothing)
//   - everything under baseUrl → immutable  (never revalidated, cached forever
//                                            by the browser AND every CDN edge)
//
// Why this matters for BDOC specifically: we run 40+ polling proxy functions.
// Every client poll today is a function invocation and a latency floor. With
// this pattern a client polls an 83-byte pointer and fetches payloads straight
// from edge cache — origin invocations collapse to one writer per interval,
// regardless of how many people are watching.
//
// THE PROPERTY THAT MATTERS MOST is not the cost saving. A dated immutable
// snapshot directory IS the offline bundle. Cache the last-known-good baseUrl
// and the app degrades to "last good snapshot, timestamped 14 min ago" instead
// of "broken" — which is exactly the behaviour a grid-down operator needs, and
// it's the same data model Meshtastic sync wants (request everything after
// timestamp T, reconcile by key).
//
// Storage is Netlify Blobs (already a dependency). Keys are content-addressed
// by timestamp so they are never mutated, only added.

const { getStore } = require('@netlify/blobs');

const STORE = 'bdoc-snapshots';

// Cache headers. These two lines are the whole trick — do not "tidy" them.
const POINTER_HEADERS = {
  'Content-Type': 'application/json',
  // Short TTL: this is the only thing that ever expires.
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=600',
  'Access-Control-Allow-Origin': '*'
};
const IMMUTABLE_HEADERS = {
  'Content-Type': 'application/json',
  // One year, immutable. A dated key's bytes never change, so revalidation is
  // pure waste. This is what lets the CDN serve every client from the edge.
  'Cache-Control': 'public, max-age=31536000, immutable',
  'Access-Control-Allow-Origin': '*'
};

// UTC stamp, minute resolution: 20260828_1435. Sorts lexicographically, which
// makes "latest" and "prune everything older than N" trivial string ops.
function stamp(d) {
  d = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
         '_' + p(d.getUTCHours()) + p(d.getUTCMinutes());
}

function store() {
  // Netlify auto-configures Blobs for functions at runtime. When that implicit
  // wiring is absent (some deploy contexts, or local dev) getStore() throws
  // "The environment has not been configured to use Netlify Blobs". Try the
  // zero-config path first and only fall back to explicit credentials, so we
  // never pass undefined siteID/token and break the working case.
  try {
    return getStore(STORE);
  } catch (_) {
    const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN ||
                   process.env.NETLIFY_AUTH_TOKEN;
    if (!siteID || !token) {
      throw new Error('Netlify Blobs unavailable: set NETLIFY_BLOBS_TOKEN (or NETLIFY_API_TOKEN) + SITE_ID in site env vars');
    }
    return getStore({ name: STORE, siteID, token });
  }
}

// Write an immutable dated snapshot + rewrite the tiny pointer.
async function publish(layer, payload) {
  const s = store();
  const ts = stamp();
  const key = `${layer}/${ts}.json`;
  const body = JSON.stringify(payload);

  await s.set(key, body);
  // The pointer is deliberately minimal — mirroring Google's 83-byte root.json.
  // `generated` and `bytes` are the only additions, and they exist so the client
  // can render honest staleness ("last good snapshot, 14 min ago") offline.
  await s.setJSON(`${layer}/root.json`, {
    baseUrl: `/.netlify/functions/layer-snap?k=${encodeURIComponent(key)}`,
    key,
    generated: new Date().toISOString(),
    bytes: Buffer.byteLength(body)
  });
  return { key, bytes: Buffer.byteLength(body) };
}

async function readPointer(layer) {
  try { return await store().get(`${layer}/root.json`, { type: 'json' }); }
  catch (_) { return null; }
}

async function readSnapshot(key) {
  try { return await store().get(key); } catch (_) { return null; }
}

// Keep the last N snapshots per layer. History is a feature (scrubbing a
// timeline = fetching older keys from the same prefix, identical code path as
// live — the WeatherWise dir.list property) but it isn't free, so it's bounded.
async function prune(layer, keep) {
  keep = keep || 24;
  try {
    const s = store();
    const { blobs } = await s.list({ prefix: layer + '/' });
    const snaps = blobs
      .map(b => b.key)
      .filter(k => !k.endsWith('root.json'))
      .sort();                                  // lexicographic === chronological
    const doomed = snaps.slice(0, Math.max(0, snaps.length - keep));
    for (const k of doomed) { try { await s.delete(k); } catch (_) {} }
    return doomed.length;
  } catch (_) { return 0; }
}

module.exports = {
  stamp, publish, readPointer, readSnapshot, prune,
  POINTER_HEADERS, IMMUTABLE_HEADERS, STORE
};
