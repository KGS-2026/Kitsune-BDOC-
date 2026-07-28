// ============================================================
// BDOC P105: sentinel.mjs — real-time feed relay (Functions v2)
//
// THE ARCHITECTURE FIX: browsers can't collect 24/7 and Lambdas
// are IP-blocked by GDELT. The always-on HERMES droplet runs a
// collector every 2 minutes and POSTs its findings here; every
// BDOC client polls GET every 60s. Server collects, clients
// display — how a real BDOC works.
//
//   POST /.netlify/functions/sentinel   (x-sentinel-key required)
//   GET  /.netlify/functions/sentinel   (public, CORS open)
//
// Storage: Netlify Blobs (store 'sentinel', key 'feed').
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
import { getStore } from '@netlify/blobs';

// Shared secret. Env SENTINEL_KEY overrides; hardcoded fallback follows the
// FIRMS-key precedent (operator-authorized, private repo). Rotate via Netlify env.
const KEY = process.env.SENTINEL_KEY || 'kgs-bdoc-sentinel-7f3a9c2e8b1d4f60';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,x-sentinel-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });

  const store = getStore('sentinel');

  if (req.method === 'POST') {
    if (req.headers.get('x-sentinel-key') !== KEY) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: CORS }); }
    body._received = new Date().toISOString();
    await store.set('feed', JSON.stringify(body));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // GET — serve latest feed
  const raw = await store.get('feed');
  if (!raw) return new Response(JSON.stringify({ generated: null, outages: [], statuspages: {}, stale: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } });
  return new Response(raw, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } });
};

export const config = { path: '/.netlify/functions/sentinel' };
