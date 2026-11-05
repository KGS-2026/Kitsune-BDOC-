// ============================================================
// zone-alerts-tick.mjs — watch-zone alerts to phones with BDOC closed (p165).
//
// Watch zones used to be checked only by the open tab (js/modules/watch-zones.js),
// so a quake or tornado warning near home reached nobody whose BDOC was closed.
// Now a device that armed push sends its zones with its push subscription, and
// this runs every 5 minutes:
//   1. read the subscriber roster (push-subscribe.mjs) and keep devices with zones
//   2. fetch each feed once: USGS quakes for everyone, NWS alerts per US zone,
//      FIRMS fire detections per zone (through our own proxy, which holds the key)
//   3. push only what that device has not had yet (store key 'seen_<sub key>')
//
// The Sentinel's crisis broadcast (push-send.mjs) is separate and unchanged.
// Decisions live in _lib/zone-alerts.js; this file only fetches, stores and sends.
// A scheduled function cannot be called by URL, so run() is exported for tests.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
import webpush from 'web-push';
import { store, VAPID_PUBLIC, SIGNING_PUBLIC, isStale, readIndex, indexRemove } from './push-subscribe.mjs';
import lib from './_lib/zone-alerts.js';

const USGS = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
const UA = 'KitsuneGlobal/BDOC (kgsbdoc.netlify.app)';
// Scheduled functions stop at 30 s. Stop starting new work well before that.
const BUDGET_MS = 22000;

async function getJson(url, ms) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/geo+json, application/json' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

async function getText(url, ms) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(String(r.status));
  return r.text();
}

export async function run({ now = Date.now(), site = process.env.URL || 'https://kgsbdoc.netlify.app', clock = Date.now } = {}) {
  const t0 = clock();
  const out = { devices: 0, zones: 0, sent: 0, pruned: 0, failed: 0, feedErrors: [] };
  if (!SIGNING_PUBLIC) { out.skipped = 'VAPID_PRIVATE_KEY missing'; return out; }

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@kgsbdoc.netlify.app', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
  const st = store();

  const devices = [];
  for (const k of await readIndex(st)) {
    let rec;
    try { rec = await st.get(k, { type: 'json', consistency: 'strong' }); } catch (_) { continue; }
    if (!rec || !rec.subscription || isStale(rec)) continue;
    const zones = lib.cleanZones(rec.zones);
    if (!zones.length) continue;
    devices.push({ k, rec, zones, prefs: lib.cleanPrefs(rec.prefs) });
  }
  out.devices = devices.length;
  if (!devices.length) return out;

  let quakes = null;
  if (devices.some(d => d.prefs.quake)) {
    try { quakes = await getJson(USGS, 8000); } catch (e) { out.feedErrors.push('usgs ' + e.message); }
  }

  // Two people watching the same town share one request per feed.
  const nwsCache = new Map(), fireCache = new Map();
  const nws = (z) => {
    const id = z.lat.toFixed(2) + ',' + z.lon.toFixed(2);
    if (!nwsCache.has(id)) {
      nwsCache.set(id, getJson('https://api.weather.gov/alerts/active?point=' + z.lat.toFixed(4) + ',' + z.lon.toFixed(4), 6000)
        .catch(e => { out.feedErrors.push('nws ' + e.message); return null; }));
    }
    return nwsCache.get(id);
  };
  const fires = (z) => {
    const area = lib.bbox(z).map(n => n.toFixed(3)).join(',');
    if (!fireCache.has(area)) {
      fireCache.set(area, getText(site + '/.netlify/functions/proxy-firms?mode=area&area=' + area + '&days=1', 8000)
        .catch(e => { out.feedErrors.push('firms ' + e.message); return null; }));
    }
    return fireCache.get(area);
  };

  const opts = (sev) => ({ TTL: 3600, urgency: sev === 'critical' ? 'high' : 'normal' });

  for (const d of devices) {
    if (clock() - t0 > BUDGET_MS) { out.outOfTime = true; break; }
    out.zones += d.zones.length;

    const events = lib.quakeEvents(d.zones, d.prefs, quakes, now);
    for (const z of d.zones) {
      if (d.prefs.weather && lib.isUS(z)) events.push(...lib.nwsEvents(z, d.prefs, await nws(z), now));
      if (d.prefs.fire) { const f = lib.fireEvent(z, d.prefs, await fires(z)); if (f) events.push(f); }
    }

    const seenKey = 'seen_' + d.k;
    let seen = {};
    try { seen = (await st.get(seenKey, { type: 'json', consistency: 'strong' })) || {}; } catch (_) {}
    seen = lib.pruneSeen(seen, now);
    const before = JSON.stringify(seen);
    const msgs = lib.selectToSend(events, seen, now);

    let gone = false;
    for (const m of msgs) {
      try {
        await webpush.sendNotification(d.rec.subscription, lib.payloadOf(m, now), opts(m.severity));
        out.sent++;
      } catch (e) {
        const code = e && e.statusCode;
        // Same rule as push-send: only 404/410 means the endpoint is gone for good.
        if (code === 404 || code === 410) { gone = true; break; }
        out.failed++;
        // Not delivered, so not seen: the next tick tries again.
        for (const k of (m.covers || [m.key])) delete seen[k];
      }
    }

    if (gone) {
      try { await st.delete(d.k); } catch (_) {}
      try { await st.delete(seenKey); } catch (_) {}
      await indexRemove(st, d.k);
      out.pruned++;
    } else if (JSON.stringify(seen) !== before) {
      try { await st.setJSON(seenKey, seen); } catch (_) {}
    }
  }
  return out;
}

export default async () => {
  const out = await run();
  console.log('[zone-alerts]', JSON.stringify(out));
};

export const config = { schedule: '*/5 * * * *' };
