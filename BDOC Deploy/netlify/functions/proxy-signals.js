// proxy-signals.js — p170 SIGNALS layer (SIGINT group): public signals data only.
//   source=squawk  aircraft broadcasting 7500 (hijack), 7600 (radio failure) or 7700 (emergency) anywhere,
//                  from adsb.lol (ODbL) with opendata.adsb.fi as fallback. 30 s cache.
//   source=sdr     public KiwiSDR shortwave receivers. Owners list them publicly on kiwisdr.com; that list sits behind
//                  a CAPTCHA, so this reads the hourly copy published for map makers at rx.linkfanel.net
//                  (Pierre Ynard's dyatlov map). Parsed with JSON.parse only, never evaluated. 6 h cache.
//   source=hf      NOAA SWPC space weather scales (public domain): R radio blackout, S solar radiation storm,
//                  G geomagnetic storm, now and the 3-day outlook. 10 min cache.
// Legal boundary: transponder broadcasts, receivers their owners made public, public-domain NOAA data.
// Nothing here decodes or records private communications.
// (c) 2026 Kitsune Global Solutions LLC

const UA = { 'User-Agent': 'KitsuneBDOC/7.0 (+https://kgsbdoc.netlify.app; contact via site)', 'Accept': 'application/json, text/javascript, */*' };
const TTL = { squawk: 30, sdr: 21600, hf: 600, err: 60 };
const memo = {};
const SQUAWKS = { '7500': 'hijack', '7600': 'radio failure', '7700': 'emergency' };

async function get(url, ms, asText) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms || 8000) });
  if (!res.ok) { const e = new Error(`upstream ${res.status}`); e.status = res.status; throw e; }
  return asText ? res.text() : res.json();
}
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null));
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

// one readsb-style aircraft → the fields the layer shows
function plane(a, code) {
  const lat = num(a.lat), lon = num(a.lon);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const hex = str(a.hex, 8).toLowerCase().replace(/[^0-9a-f~]/g, '');
  if (!hex) return null;
  return { hex, squawk: code, meaning: SQUAWKS[code], flight: str(a.flight, 10), reg: str(a.r, 12), type: str(a.t, 8), desc: str(a.desc, 60),
    lat, lon, alt: a.alt_baro === 'ground' ? 'ground' : num(a.alt_baro), gs: num(a.gs), track: num(a.track),
    emergency: str(a.emergency, 16), seen: num(a.seen) };
}

const SOURCES = {
  async squawk() {
    const out = [], errors = [], seen = new Set();
    await Promise.all(Object.keys(SQUAWKS).map(async code => {
      let j = null;
      for (const base of ['https://api.adsb.lol/v2/sqk/', 'https://opendata.adsb.fi/api/v2/sqk/']) {
        try { j = await get(base + code, 6000); break; } catch (e) { errors.push(code + ' ' + base.split('/')[2] + ': ' + e.message); }
      }
      ((j && j.ac) || []).forEach(a => { const p = plane(a, code); if (p && !seen.has(p.hex)) { seen.add(p.hex); out.push(p); } });
    }));
    if (!out.length && errors.length >= 6) { const e = new Error('both ADS-B sources failed'); e.status = 502; throw e; }
    out.sort((x, y) => x.squawk.localeCompare(y.squawk)); // 7500 first
    return { ttl: TTL.squawk, data: { aircraft: out, errors } };
  },

  async sdr() {
    const text = await get('http://rx.linkfanel.net/kiwisdr_com.js', 15000, true);
    const a = text.indexOf('['), b = text.lastIndexOf(']');
    if (a < 0 || b < a) { const e = new Error('receiver list format changed'); e.status = 502; throw e; }
    let list;
    try { list = JSON.parse(text.slice(a, b + 1).replace(/,(\s*[\]}])/g, '$1')); }
    catch (_) { const e = new Error('receiver list format changed'); e.status = 502; throw e; }
    const gps = /^\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/;
    const okUrl = /^https?:\/\/[a-z0-9.-]+(?::\d{2,5})?\/?$/i;
    const receivers = [];
    (Array.isArray(list) ? list : []).forEach(r => {
      if (!r || r.status !== 'active' || r.offline === 'yes') return;
      const g = gps.exec(r.gps || ''), url = str(r.url, 120);
      if (!g || !okUrl.test(url)) return;
      const lat = +g[1], lon = +g[2];
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return;
      const band = /^(\d+)-(\d+)$/.exec(r.bands || '');
      receivers.push({ id: str(r.id, 20) || url, name: str(r.name, 100), loc: str(r.loc, 80), antenna: str(r.antenna, 100), url: url.replace(/\/$/, ''),
        lat: +lat.toFixed(4), lon: +lon.toFixed(4), users: num(r.users) || 0, max: num(r.users_max) || 0,
        lo: band ? Math.round(+band[1] / 1000) : 0, hi: band ? Math.round(+band[2] / 1000) : 30000, snr: num(String(r.snr || '').split(',')[0]) });
    });
    return { ttl: TTL.sdr, data: { receivers, source: 'kiwisdr.com public list via rx.linkfanel.net' } };
  },

  async hf() {
    const j = await get('https://services.swpc.noaa.gov/products/noaa-scales.json', 8000);
    const sc = (v) => (v == null || v === '' ? null : num(v));
    const day = (k) => {
      const d = j[k] || {};
      return { date: str(d.DateStamp, 10), r: sc(d.R && d.R.Scale), rText: str(d.R && d.R.Text, 20), rMinor: sc(d.R && d.R.MinorProb), rMajor: sc(d.R && d.R.MajorProb),
        s: sc(d.S && d.S.Scale), sProb: sc(d.S && d.S.Prob), g: sc(d.G && d.G.Scale), gText: str(d.G && d.G.Text, 20) };
    };
    return { ttl: TTL.hf, data: { now: Object.assign(day('0'), { time: str((j['0'] || {}).TimeStamp, 8) }), outlook: ['1', '2', '3'].map(day) } };
  }
};

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { ...headers, 'Access-Control-Allow-Headers': '*' }, body: '' };
  const p = event.queryStringParameters || {};
  const fn = Object.prototype.hasOwnProperty.call(SOURCES, p.source) ? SOURCES[p.source] : null;
  if (!fn) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown source. Allowed: ' + Object.keys(SOURCES).join(', ') }) };
  const hit = memo[p.source];
  try {
    let out;
    if (hit && Date.now() < hit.exp) out = hit.out;
    else { out = await fn(p); memo[p.source] = { out, exp: Date.now() + out.ttl * 1000 }; }
    const left = Math.max(10, Math.round((memo[p.source].exp - Date.now()) / 1000));
    return { statusCode: 200, headers: { ...headers,
      'Cache-Control': `public, max-age=${Math.min(left, 600)}`,
      'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${left}, stale-while-revalidate=${p.source === 'squawk' ? 30 : 600}` },
      body: JSON.stringify({ source: p.source, fetched: new Date().toISOString(), ...out.data }) };
  } catch (e) {
    return { statusCode: 502, headers: { ...headers, 'Cache-Control': `public, max-age=${TTL.err}` }, body: JSON.stringify({ error: e.message, source: p.source }) };
  }
};

exports._test = { plane, SQUAWKS };
