// ============================================================
// incidents-recent.mjs — serves what incidents-tick has gathered.
//   GET /.netlify/functions/incidents-recent?since=YYYYMMDD
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
import { getStore } from '@netlify/blobs';
import lib from './_lib/incidents.js';

const { theaterOf } = lib;

const KEEP_DAYS = 45;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

const ymdOf = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

export default async (req) => {
  const store = getStore('incidents');
  const url = new URL(req.url);
  const floor = ymdOf(Date.now() - KEEP_DAYS * 864e5);
  const asked = /^\d{8}$/.test(url.searchParams.get('since') || '') ? url.searchParams.get('since') : floor;
  const since = asked > floor ? asked : floor;

  const ymds = [];
  for (let t = Date.now(); ymdOf(t) >= since; t -= 864e5) ymds.push(ymdOf(t));
  const days = {};
  await Promise.all(ymds.map(async (ymd) => {
    const rows = await store.get('day-' + ymd, { type: 'json' });
    // Same rule as the static 'world' shard: single-article clusters outside a theater are noise.
    if (rows) days[ymd] = rows.filter(e => e.a >= 2 || theaterOf(e.lat, e.lon) !== 'world');
  }));
  const meta = (await store.get('meta', { type: 'json' })) || {};
  return new Response(JSON.stringify({ updated: meta.updated || null, merged: meta.merged, days }), {
    status: 200, headers: { ...CORS, 'Cache-Control': 'public, max-age=120' }
  });
};

export const config = { path: '/.netlify/functions/incidents-recent' };
