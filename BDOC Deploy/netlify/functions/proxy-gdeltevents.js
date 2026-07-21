// P90: GDELT 2.0 EVENTS proxy — geocoded kinetic conflict events
// Pulls the last N 15-minute GDELT export files, unzips server-side,
// filters to CAMEO root codes 18 (ASSAULT), 19 (FIGHT), 20 (MASS VIOLENCE)
// with valid ActionGeo coordinates, dedupes, returns compact JSON.
// This gives BDOC event-level conflict plotting at REAL coordinates —
// the thing Liveuamap charges $500+/mo for via their API.
// (c) 2026 Kitsune Global Solutions LLC

const zlib = require('zlib');

// Minimal single-entry ZIP extractor (GDELT export zips contain exactly one CSV)
function unzipFirst(buf) {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip');
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const data = buf.slice(start, start + compSize);
  return method === 8 ? zlib.inflateRawSync(data) : data;
}

// Build the last N file timestamps (15-min cadence, UTC), anchored ~30min back
// to allow GDELT publish lag.
function recentStamps(n) {
  const out = [];
  let t = Date.now() - 30 * 60 * 1000;
  t = t - (t % (15 * 60 * 1000)); // snap to 15-min boundary
  for (let i = 0; i < n; i++) {
    const d = new Date(t - i * 15 * 60 * 1000);
    const p = (x) => String(x).padStart(2, '0');
    out.push('' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
      p(d.getUTCHours()) + p(d.getUTCMinutes()) + '00');
  }
  return out;
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  // files: how many 15-min slices to fuse (default 8 = 2 hours; max 16 = 4h to stay inside Lambda limits)
  const files = Math.min(Math.max(parseInt(params.files, 10) || 8, 1), 16);

  const stamps = recentStamps(files);
  const results = await Promise.allSettled(stamps.map(async (s) => {
    // NOTE: data.gdeltproject.org serves a bare GCS-bucket cert (CN=*.storage.googleapis.com)
    // → TLS fails on strict clients. Hit the bucket via storage.googleapis.com (valid cert).
    const url = `https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/${s}.export.CSV.zip`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('' + res.status);
    return Buffer.from(await res.arrayBuffer());
  }));

  // GDELT 2.0 export column indexes (61-col TSV):
  // 0 GlobalEventID, 1 Day, 26 EventCode, 28 EventRootCode, 29 QuadClass,
  // 30 GoldsteinScale, 31 NumMentions, 34 AvgTone,
  // 51 ActionGeo_Type, 52 ActionGeo_FullName, 53 ActionGeo_CountryCode,
  // 56 ActionGeo_Lat, 57 ActionGeo_Long, 60 SourceURL
  const seen = new Set();
  const events = [];
  let filesOk = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    let text;
    try { text = unzipFirst(r.value).toString('utf8'); } catch (e) { continue; }
    filesOk++;
    for (const line of text.split('\n')) {
      const c = line.split('\t');
      if (c.length < 61) continue;
      const root = c[28];
      if (root !== '18' && root !== '19' && root !== '20') continue;
      // geo precision: 1=country centroid, 2=ADM1 centroid → too coarse, creates
      // misleading dots (and celebrity-"fight" noise geocodes there). Require 3+ (ADM2/city/landmark).
      const geoType = parseInt(c[51], 10) || 0;
      if (geoType < 3) continue;
      // require genuinely conflictual signal: negative Goldstein
      if ((parseFloat(c[30]) || 0) >= 0) continue;
      const lat = parseFloat(c[56]), lon = parseFloat(c[57]);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      // dedupe: same event code at same rounded location = one dot
      const key = c[26] + '|' + lat.toFixed(1) + '|' + lon.toFixed(1);
      if (seen.has(key)) {
        // bump mention count on the existing event instead of dropping info
        const ex = events.find(e => e.k === key);
        if (ex) ex.m += parseInt(c[31], 10) || 0;
        continue;
      }
      seen.add(key);
      events.push({
        k: key,
        code: c[26],            // full CAMEO code (e.g. 190, 193, 202)
        root,                    // 18 assault / 19 fight / 20 mass violence
        g: parseFloat(c[30]) || 0,       // Goldstein scale (negative = conflictual)
        m: parseInt(c[31], 10) || 0,     // num mentions (salience)
        tone: Math.round((parseFloat(c[34]) || 0) * 10) / 10,
        place: c[52] || '',
        cc: c[53] || '',
        lat, lon,
        url: c[60] || ''
      });
    }
  }

  // rank by salience, cap payload
  events.sort((a, b) => b.m - a.m);
  const capped = events.slice(0, 900).map(({ k, ...rest }) => rest);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Netlify-Vary': 'query',
      'Cache-Control': 'public, max-age=600',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({ generated: new Date().toISOString(), filesRequested: files, filesOk, count: capped.length, events: capped })
  };
};
