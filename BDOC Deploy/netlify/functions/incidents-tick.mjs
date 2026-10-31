// ============================================================
// incidents-tick.mjs — keeps the incident archive current.
//
// The static shards in /data/incidents stop on the day they were built. This runs
// every 15 minutes, reads any GDELT export slice from the last 24 hours it has not
// merged yet, and keeps one blob per day. incidents-recent.mjs serves those blobs,
// because a scheduled function cannot be called by URL.
//
// Storage: Netlify Blobs (store 'incidents', keys 'day-YYYYMMDD', 'done', 'meta').
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
import { getStore } from '@netlify/blobs';
import lib from './_lib/incidents.js';

const { unzipFirst, exportUrl, parseRow, addReport, finishDay } = lib;

function recentStamps(n) {
  const slot = 15 * 60 * 1000;
  let t = Date.now() - 20 * 60 * 1000;
  t -= t % slot;
  return Array.from({ length: n }, (_, i) =>
    new Date(t - i * slot).toISOString().replace(/[-:T]/g, '').slice(0, 14));
}

// A cluster seen in an earlier slice of the same day grows instead of doubling.
function mergeDay(stored, fresh) {
  const key = e => e.code + '|' + e.lat + '|' + e.lon;
  const byKey = new Map(stored.map(e => [key(e), e]));
  for (const e of fresh) {
    const ex = byKey.get(key(e));
    if (!ex) { byKey.set(key(e), e); continue; }
    ex.a += e.a;
    ex.m += e.m;
    ex.s = Math.max(ex.s, e.s);
  }
  return [...byKey.values()];
}

export default async () => {
  const store = getStore('incidents');
  const done = new Set((await store.get('done', { type: 'json' })) || []);
  const todo = recentStamps(96).filter(s => !done.has(s));
  const byDay = {};

  await Promise.all(todo.map(async (stamp) => {
    try {
      const r = await fetch(exportUrl(stamp), { signal: AbortSignal.timeout(12000) });
      if (!r.ok) return;
      const text = unzipFirst(Buffer.from(await r.arrayBuffer())).toString('utf8');
      const ymd = stamp.slice(0, 8);
      const day = byDay[ymd] = byDay[ymd] || new Map();
      for (const line of text.split('\n')) {
        const rep = parseRow(line, ymd);
        if (rep) addReport(day, rep);
      }
      done.add(stamp);
    } catch (_) { /* left out of done, so the next tick retries it */ }
  }));

  for (const [ymd, day] of Object.entries(byDay)) {
    const stored = (await store.get('day-' + ymd, { type: 'json' })) || [];
    await store.setJSON('day-' + ymd, mergeDay(stored, finishDay(day)));
  }
  await store.setJSON('done', [...done].sort().slice(-400));
  await store.setJSON('meta', { updated: new Date().toISOString(), merged: todo.length });
};

export const config = { schedule: '*/15 * * * *' };
