// ============================================================
// gps-interference-tick.mjs — samples aircraft GPS quality for the GPS jamming layer (p167).
//
// Every 15 minutes: fetch a quarter of the sample regions from adsb.lol (the same
// source the aircraft layer uses), count per 1-degree cell how many aircraft report
// degraded GPS out of all that report, and add the counts to this hour's blob.
// gps-interference.mjs serves the last 24 hours, because a scheduled function
// cannot be called by URL. Rules live in _lib/gps-interference.js.
//
// Storage: Netlify Blobs, store 'gps-interference', keys 'h-YYYYMMDDHH' and 'meta'.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
import { getStore } from '@netlify/blobs';
import lib from './_lib/gps-interference.js';

const UA = 'KitsuneBDOC/7.0 (+https://kgsbdoc.netlify.app; contact via site)';
const GAP_MS = 1500;      // between calls: adsb.lol rate-limits bursts
const BUDGET_MS = 22000;  // scheduled functions stop at 30 s

export async function run({ now = Date.now(), store = getStore('gps-interference'), pause = (ms) => new Promise(r => setTimeout(r, ms)), clock = Date.now } = {}) {
  const t0 = clock();
  const out = { regions: [], aircraft: 0, cells: 0, errors: [] };
  const lists = [];

  for (const r of lib.regionsFor(now)) {
    if (clock() - t0 > BUDGET_MS) { out.errors.push('out of time'); break; }
    if (lists.length || out.errors.length) await pause(GAP_MS);
    try {
      const res = await fetch(`https://api.adsb.lol/v2/lat/${r.lat}/lon/${r.lon}/dist/${lib.DIST_NM}`,
        { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      const text = await res.text();
      // adsb.lol answers a rate limit with a plain-text body. Stop here; the rest of
      // this quarter's regions wait for next hour rather than making it worse.
      if (res.status === 429 || /rate limit/i.test(text.slice(0, 80))) { out.errors.push(r.name + ': rate limited'); break; }
      if (!res.ok) { out.errors.push(r.name + ': ' + res.status); continue; }
      const ac = JSON.parse(text).ac;
      if (!Array.isArray(ac)) { out.errors.push(r.name + ': bad shape'); continue; }
      lists.push(ac);
      out.regions.push(r.name);
      out.aircraft += ac.length;
    } catch (e) {
      out.errors.push(r.name + ': ' + (e && e.message ? e.message : 'failed'));
    }
  }

  const cells = lib.tally(lists);
  out.cells = Object.keys(cells).length;
  if (out.cells) {
    const key = lib.hourKey(now);
    const hour = (await store.get(key, { type: 'json' })) || {};
    await store.setJSON(key, lib.addInto(hour, cells));
    // The window is 24 h. Drop the hour that just fell out of it (and one before,
    // in case a run was missed) so the store stays small.
    for (const old of [lib.hourKey(now - 25 * 3600e3), lib.hourKey(now - 26 * 3600e3)]) {
      try { await store.delete(old); } catch (_) {}
    }
  }
  await store.setJSON('meta', { updated: new Date(now).toISOString(), regions: out.regions, errors: out.errors.slice(0, 8) });
  return out;
}

export default async () => {
  const out = await run();
  console.log('[gps-interference]', JSON.stringify(out));
};

export const config = { schedule: '*/15 * * * *' };
