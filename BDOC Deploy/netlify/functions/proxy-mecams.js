// proxy-mecams.js — Middle East cam wall: YouTube live search + Windy Webcams. API keys stay server-side.
// Created 2026-11-03 as proxy-cams.js in the stale OneDrive copy; renamed in p168p when ported to main,
// because main's proxy-cams.js is the p159g US traffic-cam index (Caltrans + NYC DOT). Do not merge them.
// Netlify env vars: YOUTUBE_API_KEY (YouTube Data API v3), WINDY_API_KEY (api.windy.com/webcams).
// Both optional: without them the wall plays keyless 24/7 news channel embeds.
// Only official players are used client-side — no restreaming, no unsecured/private cameras.
//   source=status            which keys are configured (booleans only)
//   source=yt&city=<id>      live, embeddable YouTube videos for a whitelisted city query.
//   source=ytch&ch=<id>      current live video of a whitelisted channel whose embed/live_stream?channel= embed
//                            fails ("This video is unavailable") — embedded by video id instead.
//                            search.list costs 100 quota units of the 10,000/day default, so responses carry a shared
//                            CDN cache (cities 2 h, channels 6 h): 60 + 8 searches ≈ 6,800 units/day for any number of viewers.
//   source=windy             public Windy webcams in the Israel/Jordan/Lebanon, Iran and Gulf boxes.
//                            Free-tier image URLs expire after 10 min → 8 min cache.
// (c) 2026 Kitsune Global Solutions LLC

const UA = { 'User-Agent': 'KITSUNE-BDOC/8.0 (kgsbdoc.netlify.app)', 'Accept': 'application/json' };

// YouTube search supports | as OR — English + local-language terms
const CITIES = {
  telaviv:   'Tel Aviv live cam|תל אביב שידור חי',
  jerusalem: 'Jerusalem live cam|ירושלים שידור חי',
  haifa:     'Haifa live cam|חיפה שידור חי',
  amman:     'Amman live|عمّان بث مباشر',
  tehran:    'Tehran live|تهران زنده'
};

// Channel live embed verified broken for these on 2026-11-03 (video-id embed works)
const RESOLVE_CHANNELS = {
  aja:      'UCfiwzLy-8yKzIbsmZTzxDgw',   // Al Jazeera Arabic
  iranintl: 'UCat6bC0Wrqq9Bcq7EkH_yQw'    // Iran International
};

// N,E,S,W per Windy v3 bbox format
const WINDY_BOXES = {
  levant: '37.5,39.5,29.0,34.0',   // Israel, Palestine, Jordan, Lebanon, west Syria
  iran:   '40.0,63.5,25.0,44.0',   // Iran + east Iraq
  gulf:   '30.5,60.0,22.0,46.0'    // Kuwait, Bahrain, Qatar, UAE, north Oman, east Saudi
};

const TTL = { status: 300, yt: 7200, ytch: 21600, ytErr: 600, windy: 480 };
const memo = {}; // warm-container memo on top of the CDN cache

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

const SOURCES = {
  async status() {
    return { ttl: TTL.status, data: { youtube: !!process.env.YOUTUBE_API_KEY, windy: !!process.env.WINDY_API_KEY } };
  },

  async yt(p) {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) return { ttl: TTL.status, data: { configured: false, videos: [] } };
    const city = Object.prototype.hasOwnProperty.call(CITIES, p.city) ? p.city : 'telaviv';
    const qs = new URLSearchParams({ part: 'snippet', type: 'video', eventType: 'live', videoEmbeddable: 'true', maxResults: '15', q: CITIES[city], key });
    try {
      const j = await getJson('https://www.googleapis.com/youtube/v3/search?' + qs.toString(), null, 8000);
      const videos = (j.items || []).filter(it => it.id && it.id.videoId).map(it => {
        const s = it.snippet || {};
        return { id: it.id.videoId, title: decode(s.title).slice(0, 140), channel: decode(s.channelTitle).slice(0, 80), channelId: s.channelId || '',
          thumb: (s.thumbnails && (s.thumbnails.medium || s.thumbnails.default) || {}).url || '', since: s.publishedAt || '' };
      });
      return { ttl: TTL.yt, data: { configured: true, city, videos } };
    } catch (e) {
      // quotaExceeded / keyInvalid come back as 400/403 — short cache so the wall recovers once quota resets
      const reason = e.body && e.body.error && e.body.error.errors && e.body.error.errors[0] && e.body.error.errors[0].reason;
      return { ttl: TTL.ytErr, data: { configured: true, city, videos: [], error: reason || e.message } };
    }
  },

  async ytch(p) {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) return { ttl: TTL.status, data: { configured: false, videos: [] } };
    if (!Object.prototype.hasOwnProperty.call(RESOLVE_CHANNELS, p.ch)) { const e = new Error('unknown channel'); e.status = 400; throw e; }
    const qs = new URLSearchParams({ part: 'snippet', type: 'video', eventType: 'live', videoEmbeddable: 'true', maxResults: '5', order: 'viewCount', channelId: RESOLVE_CHANNELS[p.ch], key });
    try {
      const j = await getJson('https://www.googleapis.com/youtube/v3/search?' + qs.toString(), null, 8000);
      const videos = (j.items || []).filter(it => it.id && it.id.videoId).map(it => ({ id: it.id.videoId, title: decode((it.snippet || {}).title).slice(0, 140) }));
      // nothing live (brief off-air gap) → re-check in 30 min instead of 6 h
      return { ttl: videos.length ? TTL.ytch : 1800, data: { configured: true, ch: p.ch, videos } };
    } catch (e) {
      const reason = e.body && e.body.error && e.body.error.errors && e.body.error.errors[0] && e.body.error.errors[0].reason;
      return { ttl: TTL.ytErr, data: { configured: true, ch: p.ch, videos: [], error: reason || e.message } };
    }
  },

  async windy() {
    const key = process.env.WINDY_API_KEY;
    if (!key) return { ttl: TTL.status, data: { configured: false, webcams: [] } };
    const hdr = { 'x-windy-api-key': key };
    const page = (bbox, offset) => getJson(`https://api.windy.com/webcams/api/v3/webcams?bbox=${bbox}&limit=50&offset=${offset}&include=images,location,player,urls`, hdr, 8000);
    const seen = new Set(), webcams = [];
    const add = (region, w) => {
      if (!w || seen.has(w.webcamId) || (w.status && w.status !== 'active')) return;
      const loc = w.location || {}, img = (w.images && w.images.current) || {}, pl = w.player || {}, u = w.urls || {};
      if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return;
      seen.add(w.webcamId);
      webcams.push({ id: String(w.webcamId), title: String(w.title || '').slice(0, 100), region, lat: loc.latitude, lon: loc.longitude,
        city: loc.city || '', country: loc.country || '', cc: loc.country_code || '',
        thumb: img.thumbnail || img.preview || img.icon || '', preview: img.preview || img.thumbnail || '',
        live: typeof pl.live === 'string' ? pl.live : '', player: (typeof pl.day === 'string' && pl.day) || u.player || '',
        detail: u.detail || '', updated: w.lastUpdatedOn || '' });
    };
    const errors = [];
    await Promise.all(Object.entries(WINDY_BOXES).map(async ([region, bbox]) => {
      try {
        const first = await page(bbox, 0);
        (first.webcams || []).forEach(w => add(region, w));
        const more = [];
        for (let off = 50; off < Math.min(first.total || 0, 150); off += 50) more.push(page(bbox, off).catch(() => ({ webcams: [] })));
        (await Promise.all(more)).forEach(r => (r.webcams || []).forEach(w => add(region, w)));
      } catch (e) { errors.push(region + ': ' + e.message); }
    }));
    if (!webcams.length && errors.length) { const e = new Error(errors.join('; ')); e.status = 502; throw e; }
    return { ttl: TTL.windy, data: { configured: true, webcams, errors } };
  }
};

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { ...headers, 'Access-Control-Allow-Headers': '*' }, body: '' };
  const p = event.queryStringParameters || {};
  const fn = SOURCES[p.source];
  if (!fn) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown source. Allowed: ' + Object.keys(SOURCES).join(', ') }) };
  const mk = p.source + ':' + (p.city || p.ch || '');
  const hit = memo[mk];
  try {
    let out;
    if (hit && Date.now() < hit.exp) out = hit.out;
    else { out = await fn(p); memo[mk] = { out, exp: Date.now() + out.ttl * 1000 }; }
    const left = Math.max(30, Math.round((memo[mk].exp - Date.now()) / 1000));
    return { statusCode: 200, headers: { ...headers,
      'Cache-Control': `public, max-age=${Math.min(left, 600)}`,
      // Netlify CDN caches function responses with this header — shared across all viewers, protects the YouTube quota
      'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${left}, stale-while-revalidate=300` },
      body: JSON.stringify({ source: p.source, fetched: new Date().toISOString(), ...out.data }) };
  } catch (e) {
    return { statusCode: e.status === 400 ? 400 : 502, headers, body: JSON.stringify({ error: e.message, source: p.source }) };
  }
};
