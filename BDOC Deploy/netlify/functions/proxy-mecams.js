// proxy-mecams.js — Cam Wall: curated stationary city cameras + Windy Webcams, per region. Keys stay server-side.
// Created 2026-11-03 as proxy-cams.js in the stale OneDrive copy; renamed in p168p when ported to main,
// because main's proxy-cams.js is the p159g US traffic-cam index (Caltrans + NYC DOT). Do not merge them.
// p169: regions (Middle East, Ukraine & Russia, Taiwan Strait, Korean Peninsula). News channels and open
//   YouTube search are gone: search results were mostly aggregator channels restreaming other people's
//   cameras (the real copyright risk). The wall now shows only:
//     - CAMS below: stationary cameras streamed on YouTube by the people who run them (city tourism
//       offices, EarthCam, KT GiGAeyes, skyline-cam channels). Embedding checked through YouTube oEmbed.
//     - Windy webcams (licensed for embedding with attribution) when WINDY_API_KEY is set.
//   Never: unsecured / private cameras, restreams, scraped players.
// Netlify env vars (both optional):
//   WINDY_API_KEY    api.windy.com/webcams (free tier) — fills every region, the only source for Ukraine and Iran.
//   YOUTUBE_API_KEY  keeps CAMS fresh: when a 24/7 stream restarts it gets a new video id; with the key the
//                    function finds the channel's current live video by title. Without it the ids below are used.
//   source=status              which keys are configured (booleans only)
//   source=cams&region=<id>    the region's curated cams with an embed check (ok / blocked / gone / unknown)
//   source=windy&region=<id>   public Windy webcams inside the region's boxes. Free-tier image URLs expire after 10 min.
// (c) 2026 Kitsune Global Solutions LLC

const UA = { 'User-Agent': 'KITSUNE-BDOC/8.0 (kgsbdoc.netlify.app)', 'Accept': 'application/json' };

// Windy v3 bbox format: N,E,S,W
const REGIONS = {
  me: { name: 'Middle East',        windy: { levant: '37.5,39.5,29.0,34.0', iran: '40.0,63.5,25.0,44.0', gulf: '30.5,60.0,22.0,46.0' } },
  ua: { name: 'Ukraine & Russia',   windy: { ukraine: '52.4,40.3,44.3,22.1', westrussia: '60.0,40.5,52.4,30.0' } },
  tw: { name: 'Taiwan Strait',      windy: { taiwan: '26.4,122.1,21.8,119.9', fujian: '27.5,119.9,23.5,116.5' } },
  kr: { name: 'Korean Peninsula',   windy: { south: '38.7,130.0,33.0,124.5', north: '43.0,130.8,38.7,124.2' } }
};

// Verified 2026-11-05: live in YouTube's live filter and embeddable (oEmbed 200). lat/lon is the area the camera
// shows, not a surveyed camera position. ch + match let the function find the current video id when a stream restarts.
// Ukraine and Iran: no stationary cameras streamed by their operators turned up (Ukraine asked owners to switch
// public street cameras off in wartime; every "Kyiv live cam" result was an aggregator restream). Windy only there.
const CAMS = {
  me: [
    { id: 'kotel-earthcam', name: 'Western Wall', city: 'Jerusalem', lat: 31.7767, lon: 35.2345, v: '77akujLn4k8', ch: 'UC6qrG3W8SMK0jior2olka3g', match: 'Western Wall', by: 'EarthCam' },
    { id: 'kotel-plaza',    name: 'Western Wall plaza', city: 'Jerusalem', lat: 31.7765, lon: 35.2340, v: 'LMHUcDktP-w', ch: 'UCvcdHbNAQvbe2GuIDLhlwaw', match: 'Main Plaza', by: 'The Western Wall' },
    { id: 'olives',         name: 'Old City from the Mount of Olives', city: 'Jerusalem', lat: 31.7780, lon: 35.2380, v: 'zp6LNSoq000', ch: 'UCnsR6NZFdu_kOljI3SWiGJw', match: 'Western Wall|Temple', by: 'Mt. of Olives Prayer Bridge' }
  ],
  ua: [],
  tw: [
    { id: 'tpe-xiangshan',  name: 'Taipei skyline from Xiangshan', city: 'Taipei', lat: 25.0274, lon: 121.5768, v: 'z_fY1pj1VBw', ch: 'UCJLjpq7pTJRbP3vtx0LxB9Q', match: '象山|Xiangshan', by: 'Taipei Travel (city tourism office)' },
    { id: 'tpe-dadaocheng', name: 'Dadaocheng Wharf', city: 'Taipei', lat: 25.0565, lon: 121.5079, v: 'Ndo_8RuefH4', ch: 'UCJLjpq7pTJRbP3vtx0LxB9Q', match: '大稻埕|Dadaocheng', by: 'Taipei Travel (city tourism office)' },
    { id: 'tpe-jiantanshan', name: 'Jiantanshan lookout', city: 'Taipei', lat: 25.0870, lon: 121.5320, v: '34h_Cy_n0Ok', ch: 'UCJLjpq7pTJRbP3vtx0LxB9Q', match: '劍潭|Jiantan', by: 'Taipei Travel (city tourism office)' },
    { id: 'tpe-bishan',     name: 'Taipei from Bishan Temple', city: 'Taipei', lat: 25.0950, lon: 121.5900, v: 'uvwfYzwY8tg', ch: 'UCJLjpq7pTJRbP3vtx0LxB9Q', match: '碧山|Bishan', by: 'Taipei Travel (city tourism office)' },
    { id: 'tyn-airport',    name: 'Taoyuan International Airport', city: 'Taoyuan', lat: 25.0797, lon: 121.2342, v: '91PfFoqvuUk', ch: 'UCARB8y6PuoOBjZXJKIG-LDw', match: 'Airport|機場', by: 'Taoyuan Travel (city tourism office)' },
    { id: 'khh-shoushan',   name: 'Kaohsiung from Shoushan', city: 'Kaohsiung', lat: 22.6392, lon: 120.2726, v: 'C03Itx8iSC0', ch: 'UC2lamMZjjT-Qcq-zIx6NrCw', match: '壽山|Shoushan', by: 'Kaohsiung Travel (city tourism office)' },
    { id: 'khh-cijin',      name: 'Cijin Beach', city: 'Kaohsiung', lat: 22.6133, lon: 120.2672, v: 'ka7FV0sCvxQ', ch: 'UC2lamMZjjT-Qcq-zIx6NrCw', match: '旗津|Cijin', by: 'Kaohsiung Travel (city tourism office)' },
    { id: 'khh-lotus',      name: 'Lotus Pond', city: 'Kaohsiung', lat: 22.6806, lon: 120.2925, v: 'BnPoNatG-HE', ch: 'UC2lamMZjjT-Qcq-zIx6NrCw', match: '蓮池潭|Lotus', by: 'Kaohsiung Travel (city tourism office)' }
  ],
  kr: [
    { id: 'sel-station',    name: 'Seoul Station plaza', city: 'Seoul', lat: 37.5547, lon: 126.9707, v: 'C3hW1VrwmNc', ch: 'UCsy6UOjk8q7Ajq9yQ7iDAbA', match: '서울역|Seoul Station', by: 'GiGAeyes (KT)' },
    { id: 'sel-namsan',     name: 'Namsan Tower', city: 'Seoul', lat: 37.5512, lon: 126.9882, v: 'GhNscofIqHU', ch: 'UC_WJaEpQOURh6dNEXqA8FgA', match: 'Namsan|남산', by: 'Han River Live 365' },
    { id: 'sel-hanriver',   name: 'Han River', city: 'Seoul', lat: 37.5175, lon: 126.9950, v: '5gVrWGRZo9s', ch: 'UC_WJaEpQOURh6dNEXqA8FgA', match: 'Han River|한강', by: 'Han River Live 365' },
    { id: 'sel-yeouido',    name: 'Yeouido skyline', city: 'Seoul', lat: 37.5260, lon: 126.9330, v: 'vk5BHoDxXf0', ch: 'UC4ueDZiC-xHAwql4QxVNQZg', match: '여의도|Yeouido|SEOUL', by: 'RIVERWORKER' },
    { id: 'sel-hangang',    name: 'Hangang live cam', city: 'Seoul', lat: 37.5300, lon: 126.9800, v: 'RVvYQghFCXk', ch: 'UCQKQTgZJo3PlxA-9V1Z51XA', match: '한강|Hangang', by: 'Daily Seoul' }
  ]
};

const TTL = { status: 300, cams: 3600, camsKey: 21600, windy: 480, err: 600 };
const memo = {}; // warm-container memo on top of the CDN cache
const VID = /^[A-Za-z0-9_-]{11}$/;

function decode(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
async function getJson(url, headers, ms) {
  const res = await fetch(url, { headers: Object.assign({}, UA, headers || {}), signal: AbortSignal.timeout(ms || 8000) });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch (_) {}
  if (!res.ok) { const e = new Error((j && j.error && (j.error.message || j.error)) || `upstream ${res.status}`); e.status = res.status; e.body = j; throw e; }
  return j;
}
const region = (p) => (Object.prototype.hasOwnProperty.call(REGIONS, p.region) ? p.region : 'me');

// oEmbed answers 200 for a public embeddable video, 401 when the owner turned embedding off, 400/404 when it is gone.
async function embedCheck(v) {
  try {
    const res = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + v), { headers: UA, signal: AbortSignal.timeout(5000) });
    return res.status === 200 ? 'ok' : res.status === 401 || res.status === 403 ? 'blocked' : res.status === 400 || res.status === 404 ? 'gone' : 'unknown';
  } catch (_) { return 'unknown'; }
}

// With a YouTube key: one search per channel (100 quota units), every 6 h → about 2,000 units/day for all regions.
async function liveByChannel(ch, key) {
  const qs = new URLSearchParams({ part: 'snippet', type: 'video', eventType: 'live', videoEmbeddable: 'true', maxResults: '25', channelId: ch, key });
  const j = await getJson('https://www.googleapis.com/youtube/v3/search?' + qs.toString(), null, 8000);
  return (j.items || []).filter(it => it.id && VID.test(it.id.videoId)).map(it => ({ v: it.id.videoId, title: decode((it.snippet || {}).title) }));
}

const SOURCES = {
  async status() {
    return { ttl: TTL.status, data: { youtube: !!process.env.YOUTUBE_API_KEY, windy: !!process.env.WINDY_API_KEY } };
  },

  async cams(p) {
    const r = region(p), key = process.env.YOUTUBE_API_KEY, list = CAMS[r];
    const fresh = {};
    if (key) {
      await Promise.all([...new Set(list.map(c => c.ch))].map(async ch => {
        try { fresh[ch] = await liveByChannel(ch, key); } catch (_) { /* quota or key problem: keep the stored ids */ }
      }));
    }
    const cams = await Promise.all(list.map(async c => {
      const hit = (fresh[c.ch] || []).find(x => new RegExp(c.match, 'i').test(x.title));
      const v = hit ? hit.v : c.v;
      return { id: c.id, name: c.name, city: c.city, lat: c.lat, lon: c.lon, v, by: c.by, ch: c.ch,
        state: hit ? 'ok' : await embedCheck(v), refreshed: !!hit };
    }));
    return { ttl: key ? TTL.camsKey : TTL.cams, data: { region: r, name: REGIONS[r].name, cams, youtubeKey: !!key } };
  },

  async windy(p) {
    const key = process.env.WINDY_API_KEY, r = region(p);
    if (!key) return { ttl: TTL.status, data: { configured: false, region: r, webcams: [] } };
    const hdr = { 'x-windy-api-key': key };
    const page = (bbox, offset) => getJson(`https://api.windy.com/webcams/api/v3/webcams?bbox=${bbox}&limit=50&offset=${offset}&include=images,location,player,urls`, hdr, 8000);
    const seen = new Set(), webcams = [];
    const add = (box, w) => {
      if (!w || seen.has(w.webcamId) || (w.status && w.status !== 'active')) return;
      const loc = w.location || {}, img = (w.images && w.images.current) || {}, pl = w.player || {}, u = w.urls || {};
      if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return;
      seen.add(w.webcamId);
      webcams.push({ id: String(w.webcamId), title: String(w.title || '').slice(0, 100), box, lat: loc.latitude, lon: loc.longitude,
        city: loc.city || '', country: loc.country || '', cc: loc.country_code || '',
        thumb: img.thumbnail || img.preview || img.icon || '', preview: img.preview || img.thumbnail || '',
        live: typeof pl.live === 'string' ? pl.live : '', player: (typeof pl.day === 'string' && pl.day) || u.player || '',
        detail: u.detail || '', updated: w.lastUpdatedOn || '' });
    };
    const errors = [];
    await Promise.all(Object.entries(REGIONS[r].windy).map(async ([box, bbox]) => {
      try {
        const first = await page(bbox, 0);
        (first.webcams || []).forEach(w => add(box, w));
        const more = [];
        for (let off = 50; off < Math.min(first.total || 0, 150); off += 50) more.push(page(bbox, off).catch(() => ({ webcams: [] })));
        (await Promise.all(more)).forEach(res => (res.webcams || []).forEach(w => add(box, w)));
      } catch (e) { errors.push(box + ': ' + e.message); }
    }));
    if (!webcams.length && errors.length) { const e = new Error(errors.join('; ')); e.status = 502; throw e; }
    return { ttl: TTL.windy, data: { configured: true, region: r, webcams, errors } };
  }
};

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { ...headers, 'Access-Control-Allow-Headers': '*' }, body: '' };
  const p = event.queryStringParameters || {};
  const fn = Object.prototype.hasOwnProperty.call(SOURCES, p.source) ? SOURCES[p.source] : null;
  if (!fn) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown source. Allowed: ' + Object.keys(SOURCES).join(', ') }) };
  const mk = p.source + ':' + (p.source === 'status' ? '' : region(p));
  const hit = memo[mk];
  try {
    let out;
    if (hit && Date.now() < hit.exp) out = hit.out;
    else { out = await fn(p); memo[mk] = { out, exp: Date.now() + out.ttl * 1000 }; }
    const left = Math.max(30, Math.round((memo[mk].exp - Date.now()) / 1000));
    return { statusCode: 200, headers: { ...headers,
      'Cache-Control': `public, max-age=${Math.min(left, 600)}`,
      // Netlify CDN caches function responses with this header — shared across all viewers, protects the quotas
      'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${left}, stale-while-revalidate=300` },
      body: JSON.stringify({ source: p.source, fetched: new Date().toISOString(), ...out.data }) };
  } catch (e) {
    return { statusCode: e.status === 400 ? 400 : 502, headers, body: JSON.stringify({ error: e.message, source: p.source }) };
  }
};

exports._test = { REGIONS, CAMS };
