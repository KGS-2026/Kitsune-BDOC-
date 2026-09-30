// BDOC — Web Push fan-out (p142, Functions v2)
//
// POST /.netlify/functions/push-send?key=<PUSH_SEND_KEY>
//   { "title": "...", "body": "...", "url": "/?...", "severity": "critical|high|info",
//     "tag": "outage-verizon", "minTier": "recon" }
//
// Called by the droplet sentinel (bdoc_sentinel.py) so alerts reach phones with
// the BDOC tab closed. Gated by PUSH_SEND_KEY — without it this is an open
// spam cannon pointed at our own users.
//
// Dead subscriptions (410/404 from the push service) are pruned inline; a push
// endpoint that has expired will never come back, and leaving them in the store
// makes every future send slower and the subscriber count a lie.
//
// .mjs is required for Netlify Blobs auto-wiring — see push-subscribe.mjs.

import webpush from 'web-push';
import { store, keyFor, VAPID_PUBLIC } from './push-subscribe.mjs';

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,x-push-key',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

const TIER_RANK = { recon: 0, analyst: 1, operator: 2, enterprise: 3 };

const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: HEADERS });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: HEADERS });
  if (req.method !== 'POST') return J({ error: 'method not allowed' }, 405);

  const gate = process.env.PUSH_SEND_KEY;
  const given = new URL(req.url).searchParams.get('key') || req.headers.get('x-push-key');
  if (!gate || given !== gate) return J({ error: 'forbidden' }, 403);

  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) return J({ error: 'VAPID_PRIVATE_KEY not set in site env — push signing unavailable' }, 503);

  let body;
  try { body = await req.json(); }
  catch (_) { return J({ error: 'bad json' }, 400); }
  body = body || {};

  if (!body.title) return J({ error: 'title required' }, 400);

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@kgsbdoc.netlify.app',
    VAPID_PUBLIC,
    priv
  );

  const payload = JSON.stringify({
    title: String(body.title).slice(0, 120),
    body: String(body.body || '').slice(0, 400),
    url: body.url || '/',
    severity: body.severity || 'info',
    tag: body.tag || ('bdoc-' + Date.now()),
    ts: Date.now()
  });

  const minRank = TIER_RANK[body.minTier] || 0;

  let st;
  try { st = store(); }
  catch (e) { return J({ error: 'blobs unavailable: ' + String(e && e.message).slice(0, 160) }, 503); }

  let blobs = [];
  try { ({ blobs } = await st.list({ prefix: 'sub_' })); }
  catch (e) { return J({ error: 'list failed: ' + String(e && e.message).slice(0, 160) }, 503); }

  // dryRun lets the pipe be verified end-to-end (gate, VAPID signing, store
  // enumeration) without actually paging real users.
  const dry = !!body.dryRun;

  let sent = 0, pruned = 0, failed = 0, skipped = 0;
  const errors = [];

  for (const b of blobs) {
    let rec;
    try { rec = await st.get(b.key, { type: 'json' }); } catch (_) { continue; }
    if (!rec || !rec.subscription) continue;
    if ((TIER_RANK[rec.tier] || 0) < minRank) { skipped++; continue; }
    if (dry) { skipped++; continue; }

    try {
      await webpush.sendNotification(rec.subscription, payload, {
        TTL: 3600,
        urgency: body.severity === 'critical' ? 'high' : 'normal'
      });
      sent++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) {
        try { await st.delete(b.key); pruned++; } catch (_) {}
      } else {
        failed++;
        if (errors.length < 3) errors.push(String(code || (e && e.message)).slice(0, 80));
      }
    }
  }

  return J({ ok: true, dryRun: dry, subscribers: blobs.length, sent, pruned, failed, skipped, errors });
};

export const config = { path: '/.netlify/functions/push-send' };
