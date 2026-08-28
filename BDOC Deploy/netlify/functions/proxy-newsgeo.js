// ============================================================
// proxy-newsgeo — geolocated conflict/incident news WITH MEDIA
// ============================================================
// WHY THIS EXISTS
// The War Room / GDELT layer is dead. Verified 2026-06-09: api.gdeltproject.org
// accepts the TCP connection then never responds (>30s, no bytes) from both this
// droplet AND from Netlify's egress, while www.gdeltproject.org 301s normally.
// So proxy-gdelt returns an empty FeatureCollection on every call and the layer
// silently plots zero events. That is the "I'm still not getting live feed" bug.
//
// It also fixes a second, older problem: GDELT's artlist NEVER returned an image
// URL, so every popup was text-only. Operator requirement is that clicking an
// event shows the photo/video and the source link, the way liveuamap's venue
// records do (picture / twitpic / images / video / source / moreSources).
//
// DESIGN (patterns lifted from the liveuamap + WeatherWise recon)
//  - Multi-source ingest with per-source failure isolation. One dead outlet can
//    never blank the layer (liveuamap's per-feature try/catch, generalized).
//  - Media is a first-class field. media:content / media:thumbnail / enclosure /
//    og:image-in-description are all harvested into `img`.
//  - Cross-outlet dedupe on a normalized title shingle, so the same strike
//    reported by BBC + Guardian + Sky becomes ONE event carrying 3 sources —
//    which is exactly liveuamap's `moreSources` and lets the client render
//    "3 outlets reporting" as a corroboration signal.
//  - Gazetteer geocoding against a place table. Every event carries `precision`
//    (city | region | country) so the client can draw an HONEST uncertainty
//    radius instead of a fake-precise pin — the meshmap.net finding.
//  - Fixed 15-min edge cache. 1000 users = 1 origin fetch (WeatherWise's
//    immutable-object + CDN discipline, adapted to a function).
//
// NEVER returns 5xx. On total failure it serves last-good (stale-while-error)
// and flags it, so the map degrades to "stale" not "empty".

const FEEDS = [
  { id: 'bbc-world',  name: 'BBC World',    url: 'https://feeds.bbci.co.uk/news/world/rss.xml', weight: 3 },
  { id: 'bbc-me',     name: 'BBC MidEast',  url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', weight: 3 },
  { id: 'guardian',   name: 'Guardian',     url: 'https://www.theguardian.com/world/rss', weight: 3 },
  { id: 'skynews',    name: 'Sky News',     url: 'https://feeds.skynews.com/feeds/rss/world.xml', weight: 2 },
  { id: 'aljazeera',  name: 'Al Jazeera',   url: 'https://www.aljazeera.com/xml/rss/all.xml', weight: 3 },
  { id: 'dw',         name: 'DW',           url: 'https://rss.dw.com/rdf/rss-en-world', weight: 2 },
  { id: 'nypost',     name: 'NY Post',      url: 'https://nypost.com/world-news/feed/', weight: 1 }
];

// ── Gazetteer. lon, lat, precision-radius in metres. ─────────
// radius encodes real locational uncertainty: a city hit is ~15km, a named
// region ~60km, a whole country is its centroid and we say so (up to 400km).
// The client draws this as a circle, so we never imply a strike was at a
// street corner when all we know is "somewhere in Lebanon".
const GAZ = {
  // conflict-relevant cities / sub-regions
  'kyiv':[30.52,50.45,15000],'kiev':[30.52,50.45,15000],'kharkiv':[36.23,49.99,15000],
  'odesa':[30.73,46.48,15000],'odessa':[30.73,46.48,15000],'lviv':[24.03,49.84,15000],
  'donetsk':[37.80,48.00,25000],'mariupol':[37.55,47.10,15000],'kherson':[32.62,46.64,15000],
  'zaporizhzhia':[35.14,47.84,15000],'crimea':[34.10,45.30,90000],'sevastopol':[33.53,44.62,15000],
  'bakhmut':[38.00,48.60,12000],'pokrovsk':[37.18,48.28,12000],'sumy':[34.80,50.91,15000],
  'moscow':[37.62,55.75,20000],'belgorod':[36.59,50.60,15000],'kursk':[36.19,51.73,15000],
  'st petersburg':[30.34,59.93,20000],'novorossiysk':[37.77,44.72,12000],
  'gaza':[34.47,31.50,12000],'rafah':[34.25,31.29,8000],'khan younis':[34.31,31.35,8000],
  'jerusalem':[35.21,31.77,12000],'tel aviv':[34.78,32.08,12000],'west bank':[35.30,32.00,45000],
  'beirut':[35.50,33.89,12000],'south lebanon':[35.40,33.30,40000],
  'damascus':[36.29,33.51,15000],'aleppo':[37.16,36.20,15000],'idlib':[36.63,35.93,25000],
  'homs':[36.72,34.73,15000],'latakia':[35.79,35.52,15000],
  'tehran':[51.39,35.69,20000],'isfahan':[51.68,32.65,15000],'natanz':[51.72,33.72,10000],
  'fordow':[50.99,34.88,8000],'bandar abbas':[56.28,27.19,12000],
  'baghdad':[44.36,33.31,18000],'erbil':[44.01,36.19,12000],'mosul':[43.12,36.34,12000],
  'sanaa':[44.21,15.35,15000],'hodeidah':[42.95,14.80,12000],'aden':[45.04,12.79,12000],
  'red sea':[38.00,20.00,300000],'bab el-mandeb':[43.35,12.58,60000],
  'strait of hormuz':[56.25,26.57,60000],'suez canal':[32.35,30.60,50000],
  'taiwan':[121.00,23.70,90000],'taipei':[121.56,25.03,15000],'taiwan strait':[119.50,24.50,90000],
  'south china sea':[114.00,15.00,400000],'beijing':[116.41,39.90,20000],
  'north korea':[127.50,40.34,200000],'pyongyang':[125.75,39.03,15000],
  'seoul':[126.98,37.57,18000],'south korea':[127.85,36.50,150000],
  'khartoum':[32.53,15.50,18000],'darfur':[24.90,13.00,250000],'port sudan':[37.22,19.62,12000],
  'mogadishu':[45.34,2.04,15000],'sahel':[2.00,15.00,400000],
  'kabul':[69.21,34.52,15000],'islamabad':[73.05,33.68,15000],'kashmir':[76.00,34.00,120000],
  'karachi':[67.01,24.86,18000],'delhi':[77.21,28.61,20000],'new delhi':[77.21,28.61,20000],
  'myanmar':[95.96,21.91,300000],'rakhine':[93.50,20.00,120000],
  'port-au-prince':[-72.34,18.54,15000],'haiti':[-72.29,18.97,90000],
  'caracas':[-66.90,10.49,15000],'venezuela':[-66.58,6.42,300000],
  'ceuta':[-5.32,35.89,8000],'lampedusa':[12.61,35.50,8000],
  // countries (centroid — precision deliberately coarse)
  'ukraine':[31.17,48.38,400000],'russia':[60.00,58.00,400000],'israel':[34.85,31.05,60000],
  'lebanon':[35.86,33.85,50000],'syria':[38.00,35.00,180000],'iran':[53.69,32.43,400000],
  'iraq':[43.68,33.22,250000],'yemen':[48.52,15.55,250000],'gaza strip':[34.47,31.42,20000],
  'china':[104.20,35.86,400000],'japan':[138.25,36.20,300000],'india':[78.96,20.59,400000],
  'pakistan':[69.35,30.38,300000],'afghanistan':[67.71,33.94,250000],'sudan':[30.22,12.86,400000],
  'somalia':[46.20,5.15,300000],'nigeria':[8.68,9.08,300000],'mali':[-3.50,17.57,300000],
  'libya':[17.23,26.34,400000],'egypt':[30.80,26.82,300000],'turkey':[35.24,38.96,300000],
  'poland':[19.15,51.92,180000],'germany':[10.45,51.17,180000],'france':[2.21,46.23,200000],
  'united kingdom':[-1.55,52.36,180000],'britain':[-1.55,52.36,180000],
  'nepal':[84.12,28.39,120000],'tibet':[88.00,31.00,300000],'philippines':[122.88,12.88,250000],
  'venezuela ':[-66.58,6.42,300000],'mexico':[-102.55,23.63,300000],'colombia':[-74.30,4.57,250000],
  'united states':[-98.58,39.83,400000],'washington':[-77.04,38.91,20000]
};

// Signal terms. Only events matching one of these become map features —
// a world-news RSS feed is 80% noise for a defense product.
const KINETIC = {
  strike:      ['airstrike','air strike','missile','drone strike','shelling','bombard','artillery','rocket','mortar','air raid','munition','ordnance'],
  attack:      ['attack','assault','offensive','raid','ambush','militant','insurgent','gunmen','shooting','bomb','explosion','blast','ied'],
  casualty:    ['killed','dead','death toll','casualt','wounded','injured','massacre'],
  military:    ['troops','soldiers','military','army','navy','air force','deploy','mobiliz','warship','submarine','fighter jet','battalion','brigade'],
  escalation:  ['ceasefire','truce','sanction','ultimatum','retaliat','warn','threat','nuclear','tension','border clash','incursion','violation'],
  cyber:       ['cyberattack','cyber attack','ransomware','hack','breach','malware','ddos'],
  disaster:    ['earthquake','flood','wildfire','hurricane','typhoon','cyclone','landslide','eruption','tsunami','evacuat'],
  unrest:      ['protest','riot','unrest','coup','uprising','crackdown','curfew','martial law']
};

const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function decodeEnt(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#039;/g,"'")
    .replace(/&nbsp;/g,' ').replace(/&mdash;/g,'—').replace(/&ndash;/g,'–')
    .replace(/&rsquo;/g,'’').replace(/&lsquo;/g,'‘')
    .replace(/&ldquo;/g,'“').replace(/&rdquo;/g,'”')
    .replace(/&amp;/g,'&')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g,' ').trim();
}

function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? decodeEnt(m[1]) : '';
}

// Media extraction — the whole point. Try every convention outlets use.
function extractImage(block) {
  let m = block.match(/<media:content[^>]*\burl="([^"]+)"[^>]*>/i);
  if (m) return m[1];
  m = block.match(/<media:thumbnail[^>]*\burl="([^"]+)"/i);
  if (m) return m[1];
  m = block.match(/<enclosure[^>]*\burl="([^"]+)"[^>]*type="image/i);
  if (m) return m[1];
  m = block.match(/<enclosure[^>]*\burl="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
  if (m) return m[1];
  m = block.match(/<itunes:image[^>]*href="([^"]+)"/i);
  if (m) return m[1];
  // og:image style <img src> inside description/content HTML
  m = block.match(/<img[^>]*\bsrc="([^"]+)"/i);
  if (m) return m[1];
  return null;
}

function extractVideo(block) {
  let m = block.match(/<media:content[^>]*type="video[^"]*"[^>]*\burl="([^"]+)"/i);
  if (m) return m[1];
  m = block.match(/\b(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+)/i);
  if (m) return m[1];
  return null;
}

function classify(text) {
  const t = text.toLowerCase();
  const hits = [];
  for (const k in KINETIC) {
    for (const term of KINETIC[k]) {
      if (t.indexOf(term) !== -1) { hits.push(k); break; }
    }
  }
  return hits;
}

function geocode(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  let best = null;
  for (const place in GAZ) {
    // word-boundary-ish match so "iran" doesn't fire inside "iranian" wrongly
    // (it actually should, so we allow a trailing letter run)
    const idx = t.indexOf(place);
    if (idx === -1) continue;
    const before = t[idx - 1];
    if (before && /[a-z]/.test(before)) continue;   // reject mid-word
    const g = GAZ[place];
    // prefer the MOST precise (smallest radius) match found in the headline
    if (!best || g[2] < best.radius) {
      best = { name: place, lon: g[0], lat: g[1], radius: g[2] };
    }
  }
  return best;
}

// Title shingle for cross-outlet dedupe: lowercase, strip stopwords/punctuation,
// keep the 6 longest tokens sorted. Same strike from 3 outlets collapses to 1.
const STOP = new Set(['the','a','an','of','in','on','at','to','for','and','or','as','by','from','with','after','over','into','amid','says','say','said','new','more','than','that','this','its','his','her','their','are','was','were','has','have','had','will','be','been','is','it','he','she','they','we','you','not','but','out']);
function shingle(title) {
  const toks = String(title).toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/)
    .filter(w => w.length > 3 && !STOP.has(w));
  return toks.sort((a,b) => b.length - a.length).slice(0,6).sort().join('|');
}

async function fetchFeed(f) {
  try {
    const res = await fetch(f.url, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KitsuneBDOC/1.0; +https://kgsbdoc.netlify.app)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      }
    });
    if (!res.ok) return { id: f.id, ok: false, err: 'HTTP ' + res.status, items: [] };
    const xml = await res.text();
    // RSS <item> and Atom <entry>
    const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    const items = [];
    for (const b of blocks) {
      const title = tag(b, 'title');
      if (!title) continue;
      let link = tag(b, 'link');
      if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); if (m) link = m[1]; }
      items.push({
        title,
        link,
        desc: (tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || '').slice(0, 400),
        pub: tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || '',
        img: extractImage(b),
        video: extractVideo(b),
        src: f.name, srcId: f.id, weight: f.weight
      });
    }
    return { id: f.id, ok: true, items };
  } catch (e) {
    return { id: f.id, ok: false, err: e.message, items: [] };
  }
}

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  const wantMax = Math.min(Math.max(parseInt(p.max, 10) || 120, 1), 300);
  const needGeo = p.geo !== '0';

  const CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  const results = await Promise.all(FEEDS.map(fetchFeed));
  const sources = results.map(r => ({ id: r.id, ok: r.ok, n: r.items.length, err: r.err || null }));
  const okCount = results.filter(r => r.ok).length;

  // ── merge + classify + geocode + dedupe ────────────────────
  const byShingle = new Map();
  for (const r of results) {
    for (const it of r.items) {
      const blob = it.title + ' ' + it.desc;
      const cats = classify(blob);
      if (!cats.length) continue;                       // drop non-signal news
      const geo = needGeo ? geocode(blob) : null;
      if (needGeo && !geo) continue;                    // unplaceable → not a map feature

      const key = shingle(it.title);
      const existing = byShingle.get(key);
      if (existing) {
        // Corroboration: same story, another outlet. liveuamap's moreSources.
        if (!existing.sources.some(s => s.src === it.src)) {
          existing.sources.push({ src: it.src, url: it.link, title: it.title });
          existing.corroboration = existing.sources.length;
        }
        // keep the best available image
        if (!existing.img && it.img) existing.img = it.img;
        if (!existing.video && it.video) existing.video = it.video;
        continue;
      }
      byShingle.set(key, {
        id: key,
        title: it.title,
        desc: it.desc,
        img: it.img,
        video: it.video,
        pub: it.pub,
        ts: it.pub ? Date.parse(it.pub) || Date.now() : Date.now(),
        cats,
        primary: cats[0],
        place: geo ? geo.name : null,
        lon: geo ? geo.lon : null,
        lat: geo ? geo.lat : null,
        radius: geo ? geo.radius : null,
        precision: geo ? (geo.radius <= 20000 ? 'city' : geo.radius <= 120000 ? 'region' : 'country') : null,
        sources: [{ src: it.src, url: it.link, title: it.title }],
        corroboration: 1
      });
    }
  }

  let events = [...byShingle.values()];
  // Rank: corroboration first (multi-outlet = real), then recency.
  events.sort((a, b) => (b.corroboration - a.corroboration) || (b.ts - a.ts));
  events = events.slice(0, wantMax);

  const withImg = events.filter(e => e.img).length;

  const payload = {
    type: 'FeatureCollection',
    generated: new Date().toISOString(),
    _status: okCount === 0 ? 'down' : (okCount < FEEDS.length ? 'partial' : 'live'),
    _sources: sources,
    _stats: { events: events.length, withImage: withImg, feedsOk: okCount, feedsTotal: FEEDS.length },
    features: events.map(e => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      properties: {
        id: e.id,
        name: e.title,
        title: e.title,
        desc: e.desc,
        img: e.img,                 // ← the photo the operator wants on click
        video: e.video,
        cat: e.primary,
        cats: e.cats,
        place: e.place,
        radius: e.radius,           // ← honest uncertainty, not a fake-precise pin
        precision: e.precision,
        ts: e.ts,
        pub: e.pub,
        corroboration: e.corroboration,
        sources: e.sources,
        url: e.sources[0] ? e.sources[0].url : null,
        domain: e.sources[0] ? e.sources[0].src : null
      }
    }))
  };

  if (events.length) {
    try { globalThis.__newsgeoLastGood = { payload, t: Date.now() }; } catch (_) {}
  } else {
    // stale-while-error: never hand the client an empty map if we have history
    const lg = globalThis.__newsgeoLastGood;
    if (lg) {
      lg.payload._status = 'stale';
      lg.payload._staleAgeSec = Math.round((Date.now() - lg.t) / 1000);
      return { statusCode: 200, headers: { ...CORS, 'Cache-Control': 'no-store' }, body: JSON.stringify(lg.payload) };
    }
  }

  return {
    statusCode: 200,
    headers: {
      ...CORS,
      // 10-min edge cache: 1000 concurrent users = 1 origin fetch.
      'Cache-Control': events.length ? 'public, max-age=600, stale-while-revalidate=1800' : 'no-store',
      'Netlify-Vary': 'query'
    },
    body: JSON.stringify(payload)
  };
};
