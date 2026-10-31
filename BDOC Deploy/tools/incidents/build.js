// Turns the backfill cache into the static shards the site serves.
//   node build.js <cacheDir> <outDir>
// Each shard is { fields, codes, places, rows }, with shared strings indexed to keep
// it small. index.json carries per-theater, per-day counts for the counters and chart.

const fs = require('fs');
const path = require('path');
const { THEATERS, theaterOf } = require('../../netlify/functions/_lib/incidents.js');

const [cacheDir, outDir] = process.argv.slice(2);
// The 'world' shard keeps only clusters with more than one article, or it would be
// mostly single-article noise from every city on Earth.
const keep = (t, e) => t !== 'world' || e.a >= 2;

const shards = {};
const ids = THEATERS.map(t => t.id).concat('world');
for (const id of ids) shards[id] = { codes: [], codeIx: {}, places: [], placeIx: {}, rows: [], days: {} };

const intern = (list, ix, v) => {
  if (ix[v] === undefined) { ix[v] = list.length; list.push(v); }
  return ix[v];
};

const files = fs.readdirSync(cacheDir).filter(f => /^\d{8}\.json$/.test(f)).sort();
for (const f of files) {
  const { day, incidents } = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8'));
  for (const e of incidents) {
    const t = theaterOf(e.lat, e.lon);
    if (!keep(t, e)) continue;
    const s = shards[t];
    s.rows.push([
      +day, e.lat, e.lon, intern(s.codes, s.codeIx, e.code),
      intern(s.places, s.placeIx, e.place + '\u0001' + e.cc),
      e.prec === 'city' ? 1 : 0, e.a, e.m, e.s, e.url
    ]);
    s.days[day] = (s.days[day] || 0) + 1;
  }
}

fs.mkdirSync(outDir, { recursive: true });
const index = {
  generated: new Date().toISOString(),
  from: files[0].slice(0, 8), to: files[files.length - 1].slice(0, 8),
  theaters: []
};
for (const id of ids) {
  const s = shards[id];
  const meta = THEATERS.find(t => t.id === id) || { name: 'REST OF WORLD', box: null };
  const body = JSON.stringify({
    fields: ['day', 'lat', 'lon', 'code', 'place', 'city', 'articles', 'mentions', 'sources', 'url'],
    codes: s.codes, places: s.places, rows: s.rows
  });
  fs.writeFileSync(path.join(outDir, id + '.json'), body);
  index.theaters.push({
    id, name: meta.name, box: meta.box, count: s.rows.length,
    multi: s.rows.filter(r => r[6] >= 2).length, days: s.days,
    bytes: body.length
  });
  console.log(id, s.rows.length, 'clusters', (body.length / 1048576).toFixed(1) + 'MB');
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
