// Shared GDELT 2.0 export parsing for the incident archive.
// Used by tools/incidents/backfill.js (history) and incidents-tick.mjs (live).
// (c) 2026 Kitsune Global Solutions LLC

const zlib = require('zlib');

// Theaters are checked in order, so the first box that holds a point wins.
// Boxes are [W,S,E,N]. Anything outside every box lands in the 'world' shard.
const THEATERS = [
  { id: 'iran', name: 'IRAN / GULF / HORMUZ', box: [44, 23, 63.5, 40] },
  { id: 'levant', name: 'ISRAEL / GAZA / LEBANON / SYRIA', box: [34, 29, 42.5, 37.5] },
  { id: 'ukraine', name: 'UKRAINE / RUSSIA', box: [22, 44, 50, 57] },
  { id: 'redsea', name: 'YEMEN / RED SEA', box: [32, 10, 60, 23] },
  { id: 'sudan', name: 'SUDAN', box: [21.8, 8.7, 32, 23] },
  { id: 'sahel', name: 'SAHEL', box: [-17, 8, 21.8, 24] },
  { id: 'myanmar', name: 'MYANMAR', box: [92, 9.5, 102, 28.6] }
];

function theaterOf(lat, lon) {
  for (const t of THEATERS) {
    const [w, s, e, n] = t.box;
    if (lon >= w && lon <= e && lat >= s && lat <= n) return t.id;
  }
  return 'world';
}

// GDELT export zips hold exactly one CSV.
function unzipFirst(buf) {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip');
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + compSize);
  return method === 8 ? zlib.inflateRawSync(data) : data;
}

const exportUrl = stamp =>
  `https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/${stamp}.export.CSV.zip`;

function ymdToMs(ymd) {
  return Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
}

// One row becomes one report, or null if it is not a located violent event.
// Columns: 1 SQLDATE, 26 EventCode, 28 EventRootCode, 30 Goldstein, 31 NumMentions,
// 32 NumSources, 33 NumArticles, 51 ActionGeo_Type, 52 FullName, 53 CountryCode,
// 56 Lat, 57 Long, 60 SourceURL.
function parseRow(line, fileDay) {
  const c = line.split('\t');
  if (c.length < 61) return null;
  const root = c[28];
  if (root !== '18' && root !== '19' && root !== '20') return null;
  if ((parseFloat(c[30]) || 0) >= 0) return null;
  // Geo type: 1 country, 2 US state, 3 US city, 4 world city, 5 world state.
  // Country and state centroids are not incident locations, so they are dropped.
  const geo = parseInt(c[51], 10) || 0;
  if (geo !== 3 && geo !== 4 && geo !== 5) return null;
  const lat = parseFloat(c[56]), lon = parseFloat(c[57]);
  if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) return null;
  // GDELT also codes retrospective mentions ("a year ago"). Those are not new events.
  if (Math.abs(ymdToMs(fileDay) - ymdToMs(c[1])) > 3 * 864e5) return null;
  return {
    code: c[26], lat: +lat.toFixed(2), lon: +lon.toFixed(2),
    prec: geo === 5 ? 'region' : 'city',
    place: c[52] || '', cc: c[53] || '',
    m: parseInt(c[31], 10) || 0, s: parseInt(c[32], 10) || 0,
    url: c[60] || ''
  };
}

// Reports of the same type at the same place on the same day collapse into one
// incident cluster. `a` counts distinct article URLs, the corroboration signal.
function addReport(day, r) {
  const key = r.code + '|' + r.lat + '|' + r.lon;
  const ex = day.get(key);
  if (!ex) {
    day.set(key, {
      code: r.code, lat: r.lat, lon: r.lon, prec: r.prec, place: r.place, cc: r.cc,
      m: r.m, s: r.s, top: r.m, url: r.url, urls: new Set(r.url ? [r.url] : [])
    });
    return;
  }
  ex.m += r.m;
  ex.s = Math.max(ex.s, r.s);
  if (r.url) ex.urls.add(r.url);
  if (r.m > ex.top) { ex.top = r.m; ex.url = r.url; }
}

function finishDay(day) {
  return [...day.values()].map(({ urls, top, ...e }) => ({ ...e, a: urls.size }));
}

module.exports = { THEATERS, theaterOf, unzipFirst, exportUrl, parseRow, addReport, finishDay };
