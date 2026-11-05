// proxy-watch.js — AOI Watch multi-source proxy (Natanz / Pickaxe and Strait of Hormuz / Qeshm watch zones)
// One function, whitelisted sources. Every source is free + keyless; responses are trimmed
// server-side so the client only gets what the watch panel renders.
// Sources verified live 2026-11-02:
//   emsc     EMSC seismicportal FDSN (includes IIEES Iranian network contributions)
//   usgs     USGS FDSN earthquakes
//   meteo    Open-Meteo current conditions + 24h cloud cover
//   ripe     RIPE Atlas probes (public internet measurement nodes) filtered to radius
//   ioda     IODA (Georgia Tech) internet connectivity signals — country or region
//   iodaalerts IODA outage alerts
//   imagery  Copernicus Data Space catalogue — latest Sentinel-1 / Sentinel-2 scenes over a point
//   milair   adsb.lol military transponders filtered to a bbox
//   news     GDELT DOC 2.0 article list (optional domain=aljazeera.com single-outlet filter)
//   markets  Polymarket Gamma — open Iran-tagged markets
// p168p: ported to main from the stale OneDrive copy. Not wrapped in _lib/guard.js, like every other
//   proxy on main (guard is shipped but not enforced anywhere yet, see HANDOFF).
// (c) 2026 Kitsune Global Solutions LLC

const NUM = /^-?\d+(\.\d+)?$/;
const UA = { 'User-Agent': 'KITSUNE-BDOC/8.0 (kgsbdoc.netlify.app)', 'Accept': 'application/json' };

function num(v, def, min, max) {
  if (v === undefined || v === null || v === '') return def;
  if (!NUM.test(String(v))) return def;
  return Math.min(Math.max(parseFloat(v), min), max);
}
function haversineKm(la1, lo1, la2, lo2) {
  const r = Math.PI / 180, d1 = (la2 - la1) * r, d2 = (lo2 - lo1) * r;
  const x = Math.sin(d1 / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(d2 / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}
async function getJson(url, ms = 8000) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!res.ok) { const e = new Error(`upstream ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}
function isoDaysAgo(d) { return new Date(Date.now() - d * 86400000).toISOString(); }
const NEWS_DOMAINS = ['aljazeera.com'];

const SOURCES = {
  async emsc(p) {
    const lat = num(p.lat, 33.69, -90, 90), lon = num(p.lon, 51.72, -180, 180);
    const radius = num(p.radius, 3, 0.1, 5), days = num(p.days, 30, 1, 60);
    const url = `https://www.seismicportal.eu/fdsnws/event/1/query?format=json&lat=${lat}&lon=${lon}&maxradius=${radius}&start=${isoDaysAgo(days).slice(0, 19)}&limit=100&orderby=time`;
    const j = await getJson(url);
    return { events: (j.features || []).map(f => {
      const q = f.properties || {};
      return { id: f.id, t: q.time, lat: +q.lat, lon: +q.lon, depth: +q.depth, mag: +q.mag, magtype: q.magtype, region: q.flynn_region, auth: q.auth, src: 'EMSC' };
    }) };
  },

  async usgs(p) {
    const lat = num(p.lat, 33.69, -90, 90), lon = num(p.lon, 51.72, -180, 180);
    const km = num(p.km, 400, 10, 1000), days = num(p.days, 30, 1, 60);
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lon}&maxradiuskm=${km}&starttime=${isoDaysAgo(days).slice(0, 10)}&minmagnitude=2`;
    const j = await getJson(url);
    return { events: (j.features || []).map(f => {
      const q = f.properties || {}, c = (f.geometry && f.geometry.coordinates) || [];
      return { id: f.id, t: new Date(q.time).toISOString(), lat: +c[1], lon: +c[0], depth: +c[2], mag: +q.mag, magtype: q.magType, region: q.place, auth: 'USGS', src: 'USGS', url: q.url };
    }) };
  },

  async meteo(p) {
    const lat = num(p.lat, 33.69, -90, 90), lon = num(p.lon, 51.72, -180, 180);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,cloud_cover,visibility,wind_speed_10m,wind_direction_10m,weather_code&hourly=cloud_cover&forecast_days=2`;
    const j = await getJson(url);
    const now = Date.now();
    const hourly = ((j.hourly && j.hourly.time) || []).map((t, i) => ({ t: t + 'Z', cc: j.hourly.cloud_cover[i] }))
      .filter(h => Date.parse(h.t) >= now - 3600000).slice(0, 24);
    return { current: j.current || null, hourly };
  },

  async ripe(p) {
    const lat = num(p.lat, 33.69, -90, 90), lon = num(p.lon, 51.72, -180, 180), km = num(p.km, 250, 10, 2000);
    // RIPE's own radius filter does the coarse cut (one page instead of paging a whole country);
    // country is optional — omit it to include cross-border probes (e.g. UAE side of Hormuz)
    const cc = /^[A-Z]{2}$/.test(String(p.country || '').toUpperCase()) ? String(p.country).toUpperCase() : '';
    let url = `https://atlas.ripe.net/api/v2/probes/?radius=${lat},${lon}:${Math.ceil(km)}${cc ? '&country_code=' + cc : ''}&page_size=500&fields=id,status,geometry,asn_v4,description,country_code`;
    const probes = [];
    for (let page = 0; url && page < 4; page++) {
      const j = await getJson(url, 9000);
      (j.results || []).forEach(r => {
        if (!r.geometry || !r.status) return;
        const [plon, plat] = r.geometry.coordinates;
        const s = r.status.name;
        if (s !== 'Connected' && s !== 'Disconnected') return; // skip abandoned / written off / never connected
        const d = haversineKm(lat, lon, plat, plon);
        if (d > km) return;
        probes.push({ id: r.id, s, since: r.status.since, lat: plat, lon: plon, asn: r.asn_v4, km: Math.round(d), cc: r.country_code || '', desc: (r.description || '').slice(0, 60) });
      });
      url = j.next || null;
    }
    return { probes };
  },

  async ioda(p) {
    const type = p.entityType === 'region' ? 'region' : 'country';
    const code = type === 'region'
      ? (/^\d{1,6}$/.test(String(p.code || '')) ? p.code : '1824')
      : (/^[A-Z]{2}$/.test(String(p.code || '').toUpperCase()) ? String(p.code).toUpperCase() : 'IR');
    const hours = num(p.hours, 24, 2, 72);
    const until = Math.floor(Date.now() / 1000), from = until - hours * 3600;
    const j = await getJson(`https://api.ioda.inetintel.cc.gatech.edu/v2/signals/raw/${type}/${code}?from=${from}&until=${until}`, 9000);
    // Summarise each numeric datasource: latest non-null value vs. median of the window
    const out = {};
    (j.data || []).flat().forEach(s => {
      if (!s || !Array.isArray(s.values)) return;
      const vals = s.values.map((v, i) => ({ v, t: s.from + i * s.step })).filter(x => typeof x.v === 'number');
      if (!vals.length) return;
      const sorted = vals.map(x => x.v).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const last = vals[vals.length - 1];
      out[s.datasource] = { latest: last.v, latestTs: last.t, median, ratio: median ? +(last.v / median).toFixed(3) : null, points: vals.length };
    });
    return { entityType: type, code, signals: out };
  },

  async iodaalerts(p) {
    const type = p.entityType === 'region' ? 'region' : 'country';
    const code = type === 'region'
      ? (/^\d{1,6}$/.test(String(p.code || '')) ? p.code : '1824')
      : (/^[A-Z]{2}$/.test(String(p.code || '').toUpperCase()) ? String(p.code).toUpperCase() : 'IR');
    const hours = num(p.hours, 24, 1, 168);
    const until = Math.floor(Date.now() / 1000), from = until - hours * 3600;
    const j = await getJson(`https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts?entityType=${type}&entityCode=${code}&from=${from}&until=${until}`, 9000);
    return { alerts: (j.data || []).slice(0, 50).map(a => ({ t: a.time, level: a.level, ds: a.datasource, cond: a.condition, value: a.value, hist: a.historyValue, entity: a.entity && a.entity.name })) };
  },

  async imagery(p) {
    const lat = num(p.lat, 33.69, -90, 90), lon = num(p.lon, 51.72, -180, 180), days = num(p.days, 20, 1, 60);
    const coll = p.collection === 'S1' ? 'SENTINEL-1' : 'SENTINEL-2';
    // S2: L2A only (one entry per pass, carries cloudCover). S1: GRD only.
    const typeFilter = coll === 'SENTINEL-2' ? "contains(Name,'MSIL2A')" : "contains(Name,'GRDH')";
    const filter = `Collection/Name eq '${coll}' and OData.CSC.Intersects(area=geography'SRID=4326;POINT(${lon} ${lat})') and ContentDate/Start gt ${isoDaysAgo(days).slice(0, 19)}.000Z and ${typeFilter}`;
    const url = `https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$filter=${encodeURIComponent(filter)}&$orderby=ContentDate/Start%20desc&$top=12&$expand=Attributes`;
    const j = await getJson(url, 9000);
    const seen = new Set();
    const scenes = [];
    (j.value || []).forEach(v => {
      const t = v.ContentDate && v.ContentDate.Start;
      if (!t || seen.has(t.slice(0, 16))) return; // same datatake split across products
      seen.add(t.slice(0, 16));
      const cc = (v.Attributes || []).find(a => a.Name === 'cloudCover');
      scenes.push({ t, sat: v.Name.slice(0, 3), name: v.Name, cloud: cc ? Math.round(cc.Value) : null });
    });
    return { collection: coll, scenes };
  },

  async milair(p) {
    const lamin = num(p.lamin, 12, -90, 90), lamax = num(p.lamax, 42, -90, 90);
    const lomin = num(p.lomin, 32, -180, 180), lomax = num(p.lomax, 65, -180, 180);
    const j = await getJson('https://api.adsb.lol/v2/mil', 9000);
    return { aircraft: (j.ac || []).filter(a => typeof a.lat === 'number' && a.lat >= lamin && a.lat <= lamax && a.lon >= lomin && a.lon <= lomax)
      .map(a => ({ hex: a.hex, flight: (a.flight || '').trim(), t: a.t || '', r: a.r || '', lat: a.lat, lon: a.lon, alt: a.alt_baro, gs: a.gs, track: a.track, sq: a.squawk })) };
  },

  async news(p) {
    // Query text: letters, digits, spaces, quotes, parentheses only — GDELT boolean syntax, no URL injection
    let q = /^[A-Za-z0-9 "()\-]{3,200}$/.test(String(p.q || '')) ? p.q : '(natanz OR "pickaxe mountain")';
    // Optional single-outlet filter — whitelisted domains only
    if (NEWS_DOMAINS.includes(p.domain)) q += ' domainis:' + p.domain;
    const timespan = /^\d+[hd]$/.test(String(p.timespan || '')) ? p.timespan : '24h';
    const max = num(p.max, 15, 1, 50);
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&timespan=${timespan}&maxrecords=${max}&sort=datedesc`;
    // 6 s — GDELT is slow under load; leaves headroom before Netlify's 10 s kill. Client falls back to proxy-gnews.
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(6000) });
    if (res.status === 429) return { articles: [], rateLimited: true };
    if (!res.ok) { const e = new Error(`upstream ${res.status}`); e.status = res.status; throw e; }
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch (_) { return { articles: [] }; } // GDELT returns HTML/empty on zero hits
    return { articles: (j.articles || []).map(a => ({ title: a.title, url: a.url, domain: a.domain, seen: a.seendate, lang: a.language, country: a.sourcecountry })) };
  },

  async markets() {
    const j = await getJson('https://gamma-api.polymarket.com/events?closed=false&limit=60&tag_slug=iran&order=volume&ascending=false', 9000);
    const now = Date.now();
    const rx = /strike|attack|bomb|nuclear|natanz|fordow|pickaxe|enrich|regime|war|military|ceasefire|hormuz|strait|qeshm|blockade/i;
    const out = [];
    (Array.isArray(j) ? j : []).forEach(ev => {
      if (!ev || !rx.test(ev.title || '')) return;
      if (ev.endDate && Date.parse(ev.endDate) < now) return; // drop expired-but-unresolved markets
      const m = (ev.markets || []).filter(m => !m.closed)[0];
      if (!m) return;
      let prices = m.outcomePrices; try { if (typeof prices === 'string') prices = JSON.parse(prices); } catch (_) { prices = []; }
      out.push({ title: ev.title, slug: ev.slug, question: m.question, yes: prices && prices[0] != null ? Math.round(parseFloat(prices[0]) * 100) : null, volume: Math.round(parseFloat(ev.volume || 0)), endDate: ev.endDate });
    });
    return { markets: out.slice(0, 8) };
  }
};

const CACHE_S = { emsc: 300, usgs: 300, meteo: 900, ripe: 300, ioda: 300, iodaalerts: 300, imagery: 1800, milair: 30, news: 900, markets: 600 };

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { ...headers, 'Access-Control-Allow-Headers': '*' }, body: '' };
  const p = event.queryStringParameters || {};
  const fn = SOURCES[p.source];
  if (!fn) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown source. Allowed: ' + Object.keys(SOURCES).join(', ') }) };
  try {
    const data = await fn(p);
    return { statusCode: 200, headers: { ...headers, 'Cache-Control': `public, max-age=${CACHE_S[p.source] || 300}` }, body: JSON.stringify({ source: p.source, fetched: new Date().toISOString(), ...data }) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message, source: p.source }) };
  }
};
