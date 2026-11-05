// proxy-eu.js — p171 European open data (ENVIRONMENT group).
//   source=warnings  Meteoalarm official weather warnings for 39 countries, from each country's Atom feed
//                    (feeds.meteoalarm.org, licence CC BY 4.0, data from the EUMETNET national weather services).
//                    The Atom feeds list only warnings in effect at yellow or above; outlines are included where the
//                    national service sends them. All 39 are read in parallel, compacted, cached 10 min.
//   source=cems      Copernicus Emergency Management Service rapid mapping activations (free to use with credit
//                    "© European Union, Copernicus Emergency Management Service"), last 120 days plus any still open. 30 min.
// The fire danger forecast (GWIS / EFFIS, CC BY 4.0) is a WMS map the browser loads directly (CORS open), so it is not here.
// XML is read with regular expressions as text only; nothing is evaluated.
// (c) 2026 Kitsune Global Solutions LLC

const UA = { 'User-Agent': 'KitsuneBDOC/7.0 (+https://kgsbdoc.netlify.app; contact via site)', 'Accept': 'application/atom+xml, application/json, */*' };
const TTL = { warnings: 600, cems: 1800, err: 60 };
const memo = {};

// slug → [ISO code, English name, lat, lon of a representative point for the country badge]
const COUNTRIES = {
  'andorra': ['AD', 'Andorra', 42.55, 1.58], 'austria': ['AT', 'Austria', 47.6, 14.1], 'belgium': ['BE', 'Belgium', 50.6, 4.6],
  'bosnia-herzegovina': ['BA', 'Bosnia and Herzegovina', 44.2, 17.8], 'bulgaria': ['BG', 'Bulgaria', 42.7, 25.3],
  'croatia': ['HR', 'Croatia', 45.3, 15.9], 'cyprus': ['CY', 'Cyprus', 35.0, 33.2], 'czechia': ['CZ', 'Czechia', 49.8, 15.5],
  'denmark': ['DK', 'Denmark', 56.0, 9.6], 'estonia': ['EE', 'Estonia', 58.7, 25.5], 'finland': ['FI', 'Finland', 63.5, 26.5],
  'france': ['FR', 'France', 46.6, 2.4], 'germany': ['DE', 'Germany', 51.1, 10.4], 'greece': ['GR', 'Greece', 39.3, 22.0],
  'hungary': ['HU', 'Hungary', 47.2, 19.4], 'iceland': ['IS', 'Iceland', 64.9, -18.6], 'ireland': ['IE', 'Ireland', 53.2, -8.0],
  'israel': ['IL', 'Israel', 31.4, 35.0], 'italy': ['IT', 'Italy', 42.8, 12.6], 'latvia': ['LV', 'Latvia', 56.9, 24.9],
  'lithuania': ['LT', 'Lithuania', 55.3, 23.9], 'luxembourg': ['LU', 'Luxembourg', 49.8, 6.1], 'malta': ['MT', 'Malta', 35.9, 14.4],
  'moldova': ['MD', 'Moldova', 47.2, 28.5], 'montenegro': ['ME', 'Montenegro', 42.8, 19.3], 'netherlands': ['NL', 'Netherlands', 52.2, 5.5],
  'republic-of-north-macedonia': ['MK', 'North Macedonia', 41.6, 21.7], 'norway': ['NO', 'Norway', 61.5, 9.5],
  'poland': ['PL', 'Poland', 52.1, 19.4], 'portugal': ['PT', 'Portugal', 39.6, -8.0], 'romania': ['RO', 'Romania', 45.9, 25.0],
  'serbia': ['RS', 'Serbia', 44.0, 20.9], 'slovakia': ['SK', 'Slovakia', 48.7, 19.7], 'slovenia': ['SI', 'Slovenia', 46.1, 14.8],
  'spain': ['ES', 'Spain', 40.2, -3.6], 'sweden': ['SE', 'Sweden', 62.0, 15.5], 'switzerland': ['CH', 'Switzerland', 46.8, 8.2],
  'ukraine': ['UA', 'Ukraine', 49.0, 31.4], 'united-kingdom': ['GB', 'United Kingdom', 54.0, -2.5]
};
const LEVELS = { green: 1, yellow: 2, orange: 3, red: 4 };
const TYPE_WORDS = { coastalevent: 'Coastal event', 'snow-ice': 'Snow / ice', 'rain-flood': 'Rain / flood', 'forest-fire': 'Forest fire',
  'high-temperature': 'High temperature', 'low-temperature': 'Low temperature' };
const MAX_POINTS = 80, MAX_RINGS = 4;

async function get(url, ms, asText) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms || 8000) });
  if (!res.ok) { const e = new Error(`upstream ${res.status}`); e.status = res.status; throw e; }
  return asText ? res.text() : res.json();
}
const xml = (s) => String(s == null ? '' : s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&#(\d{1,6});/g, (_, n) => { const c = +n; return c > 31 && c < 0x110000 ? String.fromCodePoint(c) : ' '; })
  .replace(/&amp;/g, '&');
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const tag = (entry, name) => { const m = new RegExp(`<cap:${name}>([\\s\\S]*?)</cap:${name}>`).exec(entry); return m ? str(xml(m[1]), 200) : ''; };
// CEMS sends UTC times with no zone ("2026-10-19T03:10:00"); Date.parse would read those as server-local time
const iso = (s) => {
  let v = str(s, 40);
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(v)) v += 'Z';
  const t = Date.parse(v); return v && isFinite(t) ? new Date(t).toISOString() : null;
};

// "lat,lon lat,lon ..." → [[lat,lon],...] cut to MAX_POINTS by stride, closed, 3 decimals (~100 m)
function ring(text) {
  const pts = [];
  for (const pair of String(text).trim().split(/\s+/)) {
    const [a, b] = pair.split(',').map(Number);
    if (isFinite(a) && isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) pts.push([+a.toFixed(3), +b.toFixed(3)]);
  }
  if (pts.length < 3) return null;
  const step = Math.ceil(pts.length / MAX_POINTS);
  const out = step > 1 ? pts.filter((_, i) => i % step === 0) : pts.slice();
  const f = out[0], l = out[out.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) out.push(f.slice());
  return out.length >= 4 ? out : null;
}

// one country's Atom feed → compact warnings (in effect or upcoming, yellow or above, not cancelled)
function parseAtom(text, slug, now) {
  const cc = COUNTRIES[slug][0], out = [], seen = new Set();
  for (const m of String(text).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const title = str(xml((/<title>([\s\S]*?)<\/title>/.exec(e) || [])[1]), 200);
    const t = /^(Green|Yellow|Orange|Red)\s+(.+?)\s+Warning\b/i.exec(title);
    if (!t) continue;
    const level = LEVELS[t[1].toLowerCase()];
    if (level < 2) continue;
    if (/^cancel/i.test(tag(e, 'message_type')) || (tag(e, 'status') && !/^actual$/i.test(tag(e, 'status')))) continue;
    const expires = iso(tag(e, 'expires'));
    if (!expires || Date.parse(expires) <= now) continue;
    const area = tag(e, 'areaDesc'), id = tag(e, 'identifier');
    const key = id + '|' + area + '|' + level;
    if (seen.has(key)) continue; // the same warning in a second language
    seen.add(key);
    const tw = t[2].toLowerCase();
    const type = TYPE_WORDS[tw] || (t[2].charAt(0).toUpperCase() + t[2].slice(1).toLowerCase()).replace(/-/g, ' ');
    const rings = [...e.matchAll(/<cap:polygon>([\s\S]*?)<\/cap:polygon>/g)].map(p => ring(xml(p[1]))).filter(Boolean).slice(0, MAX_RINGS);
    const link = [...e.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)].map(x => xml(x[1])).find(u => /^https:\/\/meteoalarm\.org\?[\w=:,.-]{1,200}$/.test(u));
    const w = { cc, area: area || COUNTRIES[slug][1], event: str(tag(e, 'event'), 60), type: str(type, 40), level,
      onset: iso(tag(e, 'onset')) || iso(tag(e, 'effective')), expires, severity: str(tag(e, 'severity'), 12) };
    if (rings.length) w.poly = rings;
    if (link) w.url = link;
    out.push(w);
  }
  return out;
}

const SOURCES = {
  async warnings() {
    const now = Date.now(), countries = [], warnings = [], failed = [];
    await Promise.all(Object.keys(COUNTRIES).map(async slug => {
      const [cc, name, lat, lon] = COUNTRIES[slug];
      try {
        const list = parseAtom(await get('https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-' + slug, 7000, true), slug, now);
        list.forEach(w => warnings.push(w));
        countries.push({ cc, name, lat, lon, ok: true, count: list.length, max: list.reduce((m, w) => Math.max(m, w.level), 0) });
      } catch (e) {
        failed.push(name);
        countries.push({ cc, name, lat, lon, ok: false, count: 0, max: 0 });
      }
    }));
    if (failed.length === countries.length) { const e = new Error('Meteoalarm did not answer'); e.status = 502; throw e; }
    countries.sort((a, b) => a.name.localeCompare(b.name));
    warnings.sort((a, b) => b.level - a.level || a.cc.localeCompare(b.cc) || a.area.localeCompare(b.area));
    return { ttl: TTL.warnings, data: { countries, warnings, failed: failed.sort() } };
  },

  async cems() {
    const j = await get('https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=80&offset=0', 9000);
    const now = Date.now(), keep = 120 * 864e5;
    const activations = [];
    ((j && j.results) || []).forEach(a => {
      const code = str(a.code, 10);
      if (!/^EMSR\d{1,5}$/.test(code)) return;
      const act = iso(a.activationTime);
      if (a.closed && (!act || now - Date.parse(act) > keep)) return;
      const c = /^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/.exec(str(a.centroid, 80));
      if (!c) return;
      const lon = +(+c[1]).toFixed(4), lat = +(+c[2]).toFixed(4);
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
      activations.push({ code, name: str(a.name, 120), category: str(a.category, 30), countries: (Array.isArray(a.countries) ? a.countries : []).slice(0, 8).map(x => str(x, 40)),
        eventTime: iso(a.eventTime), activationTime: act, lastUpdate: iso(a.lastUpdate), closed: !!a.closed,
        aois: Number.isInteger(a.n_aois) ? a.n_aois : null, products: Number.isInteger(a.n_products) ? a.n_products : null, lat, lon });
    });
    activations.sort((x, y) => String(y.activationTime).localeCompare(String(x.activationTime)));
    return { ttl: TTL.cems, data: { activations, total: Number.isInteger(j && j.count) ? j.count : null } };
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
      'Cache-Control': `public, max-age=${Math.min(left, 300)}`,
      'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${left}, stale-while-revalidate=600` },
      body: JSON.stringify({ source: p.source, fetched: new Date().toISOString(), ...out.data }) };
  } catch (e) {
    return { statusCode: 502, headers: { ...headers, 'Cache-Control': `public, max-age=${TTL.err}` }, body: JSON.stringify({ error: e.message, source: p.source }) };
  }
};

exports._test = { COUNTRIES, parseAtom, ring, xml };
