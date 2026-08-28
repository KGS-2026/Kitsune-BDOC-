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

  // ── P121: OG:IMAGE ENRICHMENT ────────────────────────────────
  // GDELT gives us a SOURCEURL per event but no media. A pin that opens a
  // wall of Goldstein/tone numbers reads like a database dump; the same pin
  // with the actual news photo reads like intelligence. Every OSINT map worth
  // anything (liveuamap's `picture`/`twitpic`/`images` fields) treats media as
  // a first-class field on the event record, so we resolve it server-side.
  //
  // Why server-side: the browser CANNOT do this. Cross-origin news sites don't
  // send CORS headers, so a client-side fetch of the article HTML is blocked.
  // The function has no such restriction.
  //
  // Budget discipline — this runs inside a 10s Netlify function:
  //  - only the top N most-salient events (the ones a user actually clicks)
  //  - 8-way concurrency, 2.5s per-article timeout, hard 6s wall-clock ceiling
  //  - Range header so we pull ~48KB of <head>, not whole 2MB articles
  //  - module-scope cache survives warm invocations, so repeat polls are free
  //  - every failure is silent: no image just means no image, never an error
  const ogCache = (globalThis.__ogCache = globalThis.__ogCache || new Map());
  const OG_TTL = 6 * 3600 * 1000;

  function pickOg(html) {
    // og:image / twitter:image, attribute order agnostic (content= can precede property=)
    const pats = [
      /<meta[^>]+(?:property|name)=["']og:image(?::secure_url|:url)?["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::secure_url|:url)?["']/i,
      /<meta[^>]+(?:property|name)=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']twitter:image(?::src)?["']/i
    ];
    for (const re of pats) {
      const m = html.match(re);
      if (m && m[1]) {
        let u = m[1].trim().replace(/&amp;/g, '&');
        if (u.startsWith('//')) u = 'https:' + u;
        if (/^https:\/\//i.test(u) && u.length < 500) return u;   // https only — page is https
      }
    }
    return null;
  }

  async function ogFor(link) {
    if (!link || !/^https?:\/\//i.test(link)) return null;
    const hit = ogCache.get(link);
    if (hit && Date.now() - hit.t < OG_TTL) return hit.v;
    try {
      const r = await fetch(link, {
        signal: AbortSignal.timeout(2500),
        redirect: 'follow',
        headers: {
          // Identify honestly; many outlets 403 an unknown agent.
          'User-Agent': 'Mozilla/5.0 (compatible; BDOC/1.0; +https://kgsbdoc.netlify.app)',
          'Accept': 'text/html,application/xhtml+xml',
          'Range': 'bytes=0-49152'      // <head> is always in the first 48KB
        }
      });
      if (!r.ok && r.status !== 206) { ogCache.set(link, { v: null, t: Date.now() }); return null; }
      const v = pickOg(await r.text());
      ogCache.set(link, { v, t: Date.now() });
      return v;
    } catch (_) {
      ogCache.set(link, { v: null, t: Date.now() });   // cache the failure too
      return null;
    }
  }

  const wantImg = Math.min(parseInt(params.img, 10) || 120, capped.length);
  const targets = capped.slice(0, wantImg);
  const deadline = Date.now() + 6000;
  let imgN = 0, cursor = 0;

  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < targets.length && Date.now() < deadline) {
      const ev = targets[cursor++];
      const img = await ogFor(ev.url);
      if (img) { ev.img = img; imgN++; }
    }
  }));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Netlify-Vary': 'query',
      // stale-while-revalidate so the NEXT user gets an instant cached response
      // while the edge refreshes in the background — og scraping is the slow part.
      'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      generated: new Date().toISOString(),
      filesRequested: files, filesOk,
      count: capped.length,
      withImage: imgN,
      events: capped
    })
  };
};
