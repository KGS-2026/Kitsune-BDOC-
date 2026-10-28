// Proxy for GDELT live conflict/news feed.
//
// HISTORY
// 2026-06 (Hermes): GEO 2.0 retired → moved to DOC 2.0 artlist, converted to GeoJSON.
// P77/P78/P119: paren-wrapped OR queries, no-store on failure, stale-while-error.
// 2026-10-28 (p159i, Hermes): api.gdeltproject.org now answers HTTP 429 to
//   essentially EVERY call from datacenter IPs (verified: droplet 429 after a
//   6 s pause; Netlify egress "operation was aborted due to timeout" → every
//   prod call returned _gdelt_status:'down', 0 features; GTA lost its 22-pt
//   GDELT component; OutageWatch fusion lost its CYBER-a leg).
//
//   FIX: the raw GDELT 2.0 **GKG** 15-minute files on storage.googleapis.com are
//   NOT rate-limited (same bucket proxy-gdeltevents already uses; 8.5 MB zip,
//   ~0.2 s download, ~0.35 s inflate+parse measured). Each GKG row carries the
//   article URL, <PAGE_TITLE>, V2Themes (CYBER_ATTACK, ARMEDCONFLICT, …) and
//   V2Locations with REAL lat/lon + precision — strictly better than the DOC
//   artlist, which only gave us sourcecountry → country-centroid dots.
//
//   Order: DOC API (5 s, keeps the true 24 h window when it answers) → GKG
//   (last N 15-min files, default 4 = 1 h, max 8 = 2 h) → warm-container
//   stale → empty. Query grammar supported for GKG: groups separated by
//   whitespace are AND-ed, "a OR b" (parens optional) inside a group is OR-ed,
//   quoted phrases ok. A term matches on title/URL text OR a mapped GKG theme
//   mentioned ≥3× in the article body.
//
//   ?format=articles → DOC-compatible {articles:[{title,url,domain,
//   sourcecountry,seendate,lat,lon}]} so browser-direct callers (OutageWatch
//   news-detect + causal fusion) can fall back here with zero reshaping.
//   NEVER throws a 5xx.

const zlib = require('zlib');

// Country centroid lookup (lon,lat) — DOC path only (artlist has no coordinates).
const CENTROIDS = {
  'United States':[-98.6,39.8],'Russia':[105.3,61.5],'Ukraine':[31.2,48.4],
  'Israel':[34.8,31.0],'Palestinian Territory':[35.2,31.9],'Iran':[53.7,32.4],
  'Iraq':[43.7,33.2],'Syria':[38.0,35.0],'Lebanon':[35.9,33.9],'Yemen':[48.5,15.6],
  'Saudi Arabia':[45.1,23.9],'Turkey':[35.2,38.9],'China':[104.2,35.9],
  'Taiwan':[121.0,23.7],'North Korea':[127.5,40.3],'South Korea':[127.8,36.4],
  'Japan':[138.3,36.2],'India':[78.9,20.6],'Pakistan':[69.3,30.4],
  'Afghanistan':[67.7,33.9],'Sudan':[30.2,12.9],'South Sudan':[31.3,6.9],
  'Ethiopia':[39.8,9.1],'Somalia':[46.2,5.2],'Nigeria':[8.7,9.1],
  'Mali':[-3.5,17.6],'Niger':[8.1,17.6],'Libya':[17.2,26.3],'Egypt':[30.8,26.8],
  'United Kingdom':[-1.5,52.4],'France':[2.2,46.2],'Germany':[10.5,51.2],
  'Poland':[19.1,51.9],'Myanmar':[95.9,21.9],'Thailand':[101.0,15.9],
  'Cambodia':[104.9,12.6],'Vietnam':[108.3,14.1],'Philippines':[122.9,12.9],
  'Venezuela':[-66.6,6.4],'Colombia':[-74.3,4.6],'Mexico':[-102.6,23.6],
  'Democratic Republic of the Congo':[23.6,-2.9],'Congo':[15.8,-0.7]
};

// ── GKG path ────────────────────────────────────────────────────────────────
// query term → GKG V2Themes that mean the same thing (body-level signal when the
// headline is oblique). Keep this list conservative: a wrong mapping = noise dots.
const THEME = {
  war:['ARMEDCONFLICT','WB_2433_CONFLICT_AND_VIOLENCE'], conflict:['ARMEDCONFLICT','WB_2433_CONFLICT_AND_VIOLENCE'],
  battle:['ARMEDCONFLICT'], offensive:['ARMEDCONFLICT'], airstrike:['ARMEDCONFLICT'], troops:['MILITARY'], military:['MILITARY'],
  bombing:['TERROR','ARMEDCONFLICT'], missile:['ARMEDCONFLICT','WB_2433_CONFLICT_AND_VIOLENCE'], attack:['TERROR','ARMEDCONFLICT','CYBER_ATTACK'],
  terror:['TERROR'], terrorism:['TERROR'],
  cyberattack:['CYBER_ATTACK'], 'cyber attack':['CYBER_ATTACK'], ransomware:['CYBER_ATTACK'], hacked:['CYBER_ATTACK'], ddos:['CYBER_ATTACK'], breach:['CYBER_ATTACK'], cyber:['CYBER_ATTACK'],
  outage:['POWER_OUTAGE'], blackout:['POWER_OUTAGE'],
  disaster:['NATURAL_DISASTER'], earthquake:['NATURAL_DISASTER_EARTHQUAKE'], flood:['NATURAL_DISASTER_FLOOD'], wildfire:['NATURAL_DISASTER_WILDFIRE'], hurricane:['NATURAL_DISASTER_HURRICANE'],
  nuclear:['WB_1127_NUCLEAR'], protest:['PROTEST'], refugee:['REFUGEES'], refugees:['REFUGEES'], famine:['FOOD_SECURITY']
};

function stripOuter(q) {
  // "(a (b OR c))" → "a (b OR c)" — only when the first paren closes at the very end
  q = q.trim();
  while (q[0] === '(') {
    let depth = 0, closesAtEnd = false;
    for (let i = 0; i < q.length; i++) {
      if (q[i] === '(') depth++;
      else if (q[i] === ')') { depth--; if (depth === 0) { closesAtEnd = (i === q.length - 1); break; } }
    }
    if (!closesAtEnd) break;
    q = q.slice(1, -1).trim();
  }
  return q;
}
function parseQuery(q) {
  q = stripOuter(q);
  const groups = []; let cur = '', depth = 0, inQ = false;
  for (const ch of q) {
    if (ch === '"') inQ = !inQ;
    if (!inQ && ch === '(') depth++;
    if (!inQ && ch === ')') depth--;
    if (!inQ && depth === 0 && /\s/.test(ch)) { if (cur) groups.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) groups.push(cur);
  // bare "a OR b OR c" (no parens) arrives as [a, OR, b, OR, c] → one OR-group
  if (groups.some(g => /^or$/i.test(g))) return [groups.filter(g => !/^or$/i.test(g)).join('|')];
  return groups.map(g => g.replace(/^\(|\)$/g, '').split(/\s+OR\s+/i).join('|'));
}
function compileGroup(g) {
  const terms = g.split('|').map(t => t.replace(/^"|"$/g, '').trim().toLowerCase()).filter(Boolean);
  const themes = []; terms.forEach(t => (THEME[t] || []).forEach(x => { if (themes.indexOf(x) === -1) themes.push(x); }));
  // word-boundary match: "war" must not hit "warning", "attack" must not hit "attacker"? (it may — fine), "is down" phrase ok
  const rx = terms.length ? new RegExp('\\b(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i') : null;
  return { terms, themes, rx };
}
function themeCount(v2themes, t) {
  let n = 0, i = 0;
  while ((i = v2themes.indexOf(t + ',', i)) !== -1) { n++; i += t.length; }
  return n;
}
function matches(groups, rec) {
  return groups.every(g => (g.rx && g.rx.test(rec.hay)) || g.themes.some(t => themeCount(rec.themes, t) >= 3));
}
function bestLoc(v2) {
  // V2Locations (col 10): type#name#cc#adm1#adm2#lat#lon#fid#offset;… type 1=country 2=state 3+=city/landmark
  // (col 9 is V1Locations with NO adm2 — lat sits at p[4] there; do not mix them up)
  let best = null;
  for (const l of v2.split(';')) {
    const p = l.split('#'); if (p.length < 9) continue;
    const t = parseInt(p[0], 10) || 0, lat = parseFloat(p[5]), lon = parseFloat(p[6]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const score = t >= 3 ? 3 : t;
    if (!best || score > best.score) best = { score, name: p[1], cc: p[2], lat, lon };
    if (best.score === 3) break;
  }
  return best;
}
function unzipFirst(buf) {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip');
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const data = buf.slice(start, start + compSize);
  return method === 8 ? zlib.inflateRawSync(data) : data;
}
function recentStamps(n) {
  const out = [];
  let t = Date.now() - 30 * 60 * 1000;            // GDELT publishes ~15–25 min behind
  t = t - (t % (15 * 60 * 1000));
  for (let i = 0; i < n; i++) {
    const d = new Date(t - i * 15 * 60 * 1000);
    const p = (x) => String(x).padStart(2, '0');
    out.push('' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + '00');
  }
  return out;
}
// Parsed GKG slices survive warm invocations: one download per 15-min file per
// container, regardless of how many distinct queries hit us.
const gkgCache = (globalThis.__gkgCache = globalThis.__gkgCache || new Map());
async function gkgSlice(stamp) {
  if (gkgCache.has(stamp)) return gkgCache.get(stamp);
  const url = `https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/${stamp}.gkg.csv.zip`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error('gkg ' + res.status);
  const text = unzipFirst(Buffer.from(await res.arrayBuffer())).toString('utf8');
  const recs = [];
  for (const line of text.split('\n')) {
    const c = line.split('\t'); if (c.length < 27) continue;
    const tm = (c[26] || '').match(/<PAGE_TITLE>([^<]*)<\/PAGE_TITLE>/);
    const title = tm ? tm[1].trim() : ''; if (!title) continue;
    const loc = bestLoc(c[10] || ''); if (!loc) continue;
    const url = c[4] || '';
    recs.push({
      title, url, domain: c[3] || '', loc,
      themes: c[8] || '',
      hay: (title + ' ' + url.replace(/[-_/]+/g, ' ')).toLowerCase(),
      tone: Math.round((parseFloat((c[15] || '').split(',')[0]) || 0) * 10) / 10,
      seendate: c[1].slice(0, 8) + 'T' + c[1].slice(8, 14) + 'Z'
    });
  }
  if (gkgCache.size >= 10) gkgCache.delete(gkgCache.keys().next().value);
  gkgCache.set(stamp, recs);
  return recs;
}
async function gkgSearch(query, files, max) {
  const groups = parseQuery(query).map(compileGroup);
  const stamps = recentStamps(files);
  const got = await Promise.allSettled(stamps.map(gkgSlice));
  let filesOk = 0; const seen = new Set(); const out = [];
  for (const r of got) {
    if (r.status !== 'fulfilled') continue;
    filesOk++;
    for (const rec of r.value) {
      if (!matches(groups, rec)) continue;
      const k = rec.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 60);
      if (seen.has(k)) continue; seen.add(k);
      out.push(rec);
    }
  }
  // newest first, city-precision before country-precision
  out.sort((a, b) => (b.seendate > a.seendate ? 1 : b.seendate < a.seendate ? -1 : b.loc.score - a.loc.score));
  return { recs: out.slice(0, max), filesOk, filesRequested: files };
}
const CC_NAME = { US:'United States', RS:'Russia', UP:'Ukraine', IS:'Israel', WE:'Palestinian Territory', GZ:'Palestinian Territory', IR:'Iran', IZ:'Iraq', SY:'Syria', LE:'Lebanon', YM:'Yemen', SA:'Saudi Arabia', TU:'Turkey', CH:'China', TW:'Taiwan', KN:'North Korea', KS:'South Korea', JA:'Japan', IN:'India', PK:'Pakistan', AF:'Afghanistan', SU:'Sudan', ET:'Ethiopia', SO:'Somalia', NI:'Nigeria', LY:'Libya', EG:'Egypt', UK:'United Kingdom', FR:'France', GM:'Germany', PL:'Poland', BM:'Myanmar', RP:'Philippines', VE:'Venezuela', CO:'Colombia', MX:'Mexico', CG:'Democratic Republic of the Congo' };

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  let query = params.query || 'war OR airstrike OR missile OR offensive OR military OR conflict OR attack';
  if (/\sOR\s/i.test(query) && !/^\(.*\)$/.test(query.trim())) query = `(${query})`;
  const maxrecords = Math.min(Math.max(parseInt(params.maxpoints || params.maxrecords, 10) || 75, 1), 250);
  const timespan = /^\d+[hdwm]$/.test(params.timespan || '') ? params.timespan : '24h';
  const wantArticles = params.format === 'articles';
  const gkgFiles = Math.min(Math.max(parseInt(params.gkgfiles, 10) || 4, 1), 8);
  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  // P101: timelinevol passthrough (DOC only — no GKG equivalent; degrades to empty)
  if (params.mode === 'timelinevol') {
    const tlUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=timelinevol&format=json&timespan=${/^\d+[hdwm]$/.test(params.timespan || '') ? params.timespan : '7d'}`;
    try {
      const res = await fetch(tlUrl, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'BDOC/1.0 (intelligence dashboard)' } });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = null; }
      const pts = (data && data.timeline && data.timeline[0] && data.timeline[0].data) || [];
      return { statusCode: 200, headers: { ...CORS, 'Netlify-Vary': 'query', 'Cache-Control': pts.length ? 'public, max-age=3600' : 'no-store' }, body: JSON.stringify({ points: pts.map(p => ({ t: p.date, v: p.value })) }) };
    } catch (e) {
      return { statusCode: 200, headers: { ...CORS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ points: [], _warn: e.message }) };
    }
  }

  const respond = (features, articles, meta, cache) => ({
    statusCode: 200,
    headers: { ...CORS, 'Netlify-Vary': 'query', 'Cache-Control': cache || 'no-store' },
    body: JSON.stringify(wantArticles
      ? { articles, ...meta }
      : { type: 'FeatureCollection', features, ...meta })
  });
  const stale = (warn) => {
    const c = globalThis.__gdeltLastGood;
    if (c && c.features && c.features.length) {
      return respond(c.features, c.articles || [], { _gdelt_status: 'stale', _stale: true, _stale_age_sec: Math.round((Date.now() - c.t) / 1000), _gdelt_warning: warn || null });
    }
    return respond([], [], { _gdelt_status: 'down', _gdelt_warning: warn || null });
  };
  const remember = (features, articles) => { try { globalThis.__gdeltLastGood = { features, articles, t: Date.now() }; } catch (_) {} };

  // ── 1. DOC 2.0 (true timespan window; usually 429/timeout from a datacenter) ──
  // A failed DOC call is remembered for 10 min on the warm container so we don't
  // burn 4 s of the 10 s function budget re-proving it's dead on every poll.
  let docWarn = null;
  const docDeadUntil = globalThis.__gdeltDocDeadUntil || 0;
  try {
    if (Date.now() < docDeadUntil) throw new Error('DOC skipped (failed ' + Math.round((600000 - (docDeadUntil - Date.now())) / 1000) + 's ago)');
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=${maxrecords}&format=json&timespan=${timespan}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'BDOC/1.0 (intelligence dashboard)' } });
    if (!res.ok) throw new Error(`GDELT DOC returned ${res.status}`);
    let data; try { data = JSON.parse(await res.text()); } catch { throw new Error('GDELT returned non-JSON'); }
    const articles = Array.isArray(data.articles) ? data.articles : [];
    const features = [];
    const j = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return ((h % 1000) / 1000 - 0.5) * 6; };
    for (const a of articles) {
      const c = CENTROIDS[a.sourcecountry]; if (!c) continue;
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [c[0] + j(a.url || ''), c[1] + j(a.title || '')] },
        properties: { name: a.title || 'Untitled', html: `<b>${(a.title || '').replace(/</g, '&lt;')}</b><br>${a.domain || ''} · ${a.sourcecountry || ''}`, url: a.url || '', domain: a.domain || '', country: a.sourcecountry || '', seendate: a.seendate || '', precision: 'country' } });
    }
    if (articles.length) {
      remember(features, articles);
      return respond(features, articles, { _gdelt_count: articles.length, _gdelt_status: 'live', _gdelt_source: 'doc', _gdelt_window: timespan }, 'public, max-age=600');
    }
    docWarn = 'DOC returned 0 articles';
  } catch (e) {
    docWarn = e.message;
    if (!/skipped/.test(docWarn)) globalThis.__gdeltDocDeadUntil = Date.now() + 600000;
  }

  // ── 2. GKG raw files (not rate-limited; real coordinates) ──
  try {
    const t0 = Date.now();
    const g = await gkgSearch(query, gkgFiles, maxrecords);
    if (g.filesOk) {
      const features = g.recs.map(r => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [r.loc.lon, r.loc.lat] },
        properties: { name: r.title, html: `<b>${r.title.replace(/</g, '&lt;')}</b><br>${r.domain} · ${r.loc.name.replace(/</g, '&lt;')}`, url: r.url, domain: r.domain, country: CC_NAME[r.loc.cc] || r.loc.cc, place: r.loc.name, seendate: r.seendate, tone: r.tone, precision: r.loc.score >= 3 ? 'city' : r.loc.score === 2 ? 'region' : 'country' }
      }));
      const articles = g.recs.map(r => ({ title: r.title, url: r.url, domain: r.domain, sourcecountry: CC_NAME[r.loc.cc] || r.loc.cc, seendate: r.seendate, lat: r.loc.lat, lon: r.loc.lon, place: r.loc.name, tone: r.tone }));
      if (features.length) remember(features, articles);
      return respond(features, articles, {
        _gdelt_count: features.length, _gdelt_status: 'live', _gdelt_source: 'gkg',
        _gdelt_window: (g.filesOk * 15) + 'm', _gdelt_files: g.filesOk + '/' + g.filesRequested,
        _gdelt_ms: Date.now() - t0, _gdelt_doc_warning: docWarn
      }, 'public, max-age=300, stale-while-revalidate=900');
    }
    return stale(docWarn + '; GKG 0/' + g.filesRequested + ' files');
  } catch (e) {
    return stale(docWarn + '; GKG ' + e.message);
  }
};
