// ============================================================
// gov-alert-tick.mjs — FEMA national alerts to phones with BDOC closed (p181).
//
// Every minute: read FEMA's public IPAWS feeds (gov-alert.js collect()), and push
// each national alert or test that has not gone out yet to every armed device
// that has not turned "FEMA national alerts" off in Settings > Alerts.
// Watch zones are not needed: a national alert covers everyone.
//
// Store key 'gov_alert_seen' remembers what went out, so one alert is one push.
// The tag 'gov:<id>' makes a repeat replace the earlier notification instead of
// stacking. An alert sent more than 45 minutes ago never pages anyone (first
// deploy, or the scheduler coming back after an outage).
// A scheduled function cannot be called by URL, so run() is exported for tests.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
import webpush from 'web-push';
import { store, VAPID_PUBLIC, SIGNING_PUBLIC, isStale, readIndex, indexRemove } from './push-subscribe.mjs';
import lib from './_lib/ipaws.js';
import zones from './_lib/zone-alerts.js';
import gov from './gov-alert.js';

const SEEN = 'gov_alert_seen';
const FRESH_MS = 45 * 60e3;
const KEEP_MS = 3 * 86400e3;
// Scheduled functions stop at 30 s. Stop starting new work well before that.
const BUDGET_MS = 22000;

function wasSent(seen, n) {
  if (seen[n.id]) return true;
  // The EAS-feed stand-in and the full message are one broadcast under two ids.
  return Object.values(seen).some(s => s && s.code && lib.sameBroadcast(s, n));
}

export async function run({ now = Date.now(), clock = Date.now, fetchImpl = globalThis.fetch } = {}) {
  const t0 = clock();
  const out = { national: 0, fresh: 0, devices: 0, sent: 0, pruned: 0, failed: 0 };
  if (!SIGNING_PUBLIC) { out.skipped = 'VAPID_PRIVATE_KEY missing'; return out; }

  const got = await gov.collect({ now, fetchImpl });
  out.sources = got.sources;
  out.national = got.national.length;

  const st = store();
  let seen = {};
  try { seen = (await st.get(SEEN, { type: 'json', consistency: 'strong' })) || {}; } catch (_) {}
  let dirty = false;
  for (const [k, v] of Object.entries(seen)) {
    if (!v || !(now - v.at < KEEP_MS)) { delete seen[k]; dirty = true; }
  }

  const fresh = got.national.filter(n => now - Date.parse(n.sent) < FRESH_MS && !wasSent(seen, n));
  out.fresh = fresh.length;

  if (fresh.length) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@kgsbdoc.netlify.app', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
    const devices = [];
    for (const k of await readIndex(st)) {
      let rec;
      try { rec = await st.get(k, { type: 'json', consistency: 'strong' }); } catch (_) { continue; }
      if (!rec || !rec.subscription || isStale(rec)) continue;
      if (!zones.cleanPrefs(rec.prefs).national) continue;
      devices.push({ k, rec });
    }
    out.devices = devices.length;

    const gone = new Set();
    for (const n of fresh) {
      const ttl = Math.max(60, Math.min(3600, Math.round((Date.parse(n.expires) - now) / 1000)));
      const opts = { TTL: ttl, urgency: n.kind === 'emergency' ? 'high' : 'normal' };
      const payload = lib.pushPayload(n, now);
      let finished = true;
      for (const d of devices) {
        if (gone.has(d.k)) continue;
        if (clock() - t0 > BUDGET_MS) { out.outOfTime = true; finished = false; break; }
        try {
          await webpush.sendNotification(d.rec.subscription, payload, opts);
          out.sent++;
        } catch (e) {
          const code = e && e.statusCode;
          // Same rule as push-send: only 404/410 means the endpoint is gone for good.
          if (code === 404 || code === 410) gone.add(d.k);
          else out.failed++;
        }
      }
      // Out of time: not marked, so the next tick sends it again (the tag collapses repeats).
      if (finished) { seen[n.id] = { code: n.code, sent: n.sent, at: now }; dirty = true; }
    }

    for (const k of gone) {
      try { await st.delete(k); } catch (_) {}
      try { await st.delete('seen_' + k); } catch (_) {}
      await indexRemove(st, k);
      out.pruned++;
    }
  }

  if (dirty) { try { await st.setJSON(SEEN, seen); } catch (_) {} }
  return out;
}

export default async () => {
  const out = await run();
  console.log('[gov-alert]', JSON.stringify(out));
};

export const config = { schedule: '* * * * *' };
