// BDOC — Web Push fan-out (p140)
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
// makes every future send slower and the count a lie.

const webpush = require('web-push');
const subscribeFn = require('./push-subscribe');

const { store, VAPID_PUBLIC } = subscribeFn._internal;

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*'
};

const TIER_RANK = { recon: 0, analyst: 1, operator: 2, enterprise: 3 };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const gate = process.env.PUSH_SEND_KEY;
  const given = (event.queryStringParameters || {}).key || event.headers['x-push-key'];
  if (!gate || given !== gate) {
    return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'forbidden' }) };
  }

  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) {
    return {
      statusCode: 503,
      headers: HEADERS,
      body: JSON.stringify({ error: 'VAPID_PRIVATE_KEY not set in site env — push signing unavailable' })
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'bad json' }) }; }

  if (!body.title) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'title required' }) };
  }

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

  let s;
  try { s = store(); }
  catch (e) { return { statusCode: 503, headers: HEADERS, body: JSON.stringify({ error: e.message }) }; }

  let blobs = [];
  try { ({ blobs } = await s.list({ prefix: 'sub_' })); }
  catch (e) { return { statusCode: 503, headers: HEADERS, body: JSON.stringify({ error: 'list failed: ' + e.message }) }; }

  let sent = 0, pruned = 0, failed = 0, skipped = 0;
  const errors = [];

  for (const b of blobs) {
    let rec;
    try { rec = await s.get(b.key, { type: 'json' }); } catch (_) { continue; }
    if (!rec || !rec.subscription) continue;
    if ((TIER_RANK[rec.tier] || 0) < minRank) { skipped++; continue; }

    try {
      await webpush.sendNotification(rec.subscription, payload, { TTL: 3600, urgency: body.severity === 'critical' ? 'high' : 'normal' });
      sent++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) {
        try { await s.delete(b.key); pruned++; } catch (_) {}
      } else {
        failed++;
        if (errors.length < 3) errors.push(String(code || (e && e.message)).slice(0, 80));
      }
    }
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ ok: true, subscribers: blobs.length, sent, pruned, failed, skipped, errors })
  };
};
