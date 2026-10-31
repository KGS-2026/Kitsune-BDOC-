// Downloads GDELT 2.0 export files day by day and caches located violent events.
// Resumable: a finished day is one JSON file and is never fetched twice.
//   node backfill.js <cacheDir> [YYYYMMDD start] [YYYYMMDD end]

const fs = require('fs');
const path = require('path');
const { unzipFirst, exportUrl, parseRow, addReport, finishDay } =
  require('../../netlify/functions/_lib/incidents.js');

const cacheDir = process.argv[2];
const start = process.argv[3] || '20260228';
const end = process.argv[4] || new Date(Date.now() - 864e5).toISOString().slice(0, 10).replace(/-/g, '');
const CONCURRENCY = 16;

function daysBetween(a, b) {
  const out = [];
  const p = s => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  for (let t = p(a); t <= p(b); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10).replace(/-/g, ''));
  return out;
}

function stampsOf(ymd) {
  const out = [];
  for (let h = 0; h < 24; h++) for (const m of ['00', '15', '30', '45']) out.push(ymd + String(h).padStart(2, '0') + m + '00');
  return out;
}

async function fetchFile(stamp) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(exportUrl(stamp), { signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;   // GDELT skips the odd slice
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return unzipFirst(Buffer.from(await r.arrayBuffer())).toString('utf8');
    } catch (_) {
      await new Promise(res => setTimeout(res, 1000 * (i + 1)));
    }
  }
  throw new Error('gave up on ' + stamp);
}

async function backfillDay(ymd) {
  const stamps = stampsOf(ymd);
  const day = new Map();
  let cursor = 0, files = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < stamps.length) {
      const text = await fetchFile(stamps[cursor++]);
      if (text === null) continue;
      files++;
      for (const line of text.split('\n')) {
        const r = parseRow(line, ymd);
        if (r) addReport(day, r);
      }
    }
  }));
  return { files, incidents: finishDay(day) };
}

(async () => {
  fs.mkdirSync(cacheDir, { recursive: true });
  const days = daysBetween(start, end);
  let done = 0;
  for (const ymd of days) {
    const out = path.join(cacheDir, ymd + '.json');
    done++;
    if (fs.existsSync(out)) continue;
    try {
      const res = await backfillDay(ymd);
      fs.writeFileSync(out, JSON.stringify({ day: ymd, ...res }));
      console.log(done + '/' + days.length, ymd, 'files', res.files, 'incidents', res.incidents.length);
    } catch (e) {
      // Left unwritten, so the next run retries this day.
      console.log('FAILED', ymd, e.message);
    }
  }
  console.log('DONE');
})();
