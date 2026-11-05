// ============================================================
// gps-interference.mjs — serves the GPS jamming layer (p167).
//   GET /.netlify/functions/gps-interference
//   -> { updated, hours, regions, cells: [{ lat, lon, bad, total, pct, level }] }
// lat/lon is the south-west corner of a 1-degree cell. Counts cover the last 24 hours
// of samples written by gps-interference-tick.mjs.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
import { getStore } from '@netlify/blobs';
import lib from './_lib/gps-interference.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export async function build({ now = Date.now(), store = getStore('gps-interference') } = {}) {
  const merged = {};
  let hours = 0;
  await Promise.all(lib.windowKeys(now).map(async (k) => {
    const h = await store.get(k, { type: 'json' });
    if (h) { hours++; lib.addInto(merged, h); }
  }));
  const meta = (await store.get('meta', { type: 'json' })) || {};
  return {
    updated: meta.updated || null,
    hours,
    cellDeg: lib.CELL_DEG,
    minAircraft: lib.MIN_AIRCRAFT,
    cells: lib.summarize(merged)
  };
}

export default async () => {
  try {
    const body = await build();
    return new Response(JSON.stringify(body), {
      status: 200,
      // Changes every 15 minutes at most; the CDN absorbs everyone else.
      headers: { ...CORS, 'Cache-Control': 'public, max-age=300', 'Netlify-CDN-Cache-Control': 'public, max-age=600' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: CORS });
  }
};

export const config = { path: '/.netlify/functions/gps-interference' };
