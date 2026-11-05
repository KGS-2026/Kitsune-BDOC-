// ============================================================
// county-brief.mjs — one-click county view for emergency managers (p168).
//   GET /.netlify/functions/county-brief?lat=27.95&lon=-82.46
//
// Finds the U.S. county under the point (Census TIGERweb), then gathers, for that
// county only: NWS warnings for its county zone, the NWS forecast at its centre,
// NOAA river gauges at action stage or above, NHC storms within 1,500 km, NASA FIRMS
// fire detections, USGS quakes and open FEMA shelters. Returns the brief, an overall
// level and a plain-text SITREP. Each source says ok or failed, so a missing feed is
// shown as missing, never as "none". Rules live in _lib/county-brief.js.
// All sources are U.S. government data. No key here; FIRMS goes through proxy-firms.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
import lib from './_lib/county-brief.js';

const UA = 'KitsuneGlobal/BDOC (kgsbdoc.netlify.app)';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
// Synchronous functions stop at 10 s: county lookup ~3.5 s worst, then everything at once.
// Outline simplified to ~110 m (0.001°): gauges often sit on the river that is the county line.
const T_COUNTY = 3500, T_FEED = 5500;

const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...CORS, ...extra } });

async function get(url, ms, as = 'json') {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/geo+json, application/json' : '*/*' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(String(r.status));
  return as === 'json' ? r.json() : r.text();
}

export async function brief({ lat, lon, now = Date.now(), site = process.env.URL || 'https://kgsbdoc.netlify.app' }) {
  const tiger = await get('https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query' +
    '?geometry=' + lon + ',' + lat + '&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects' +
    '&outFields=GEOID,NAME,BASENAME,CENTLAT,CENTLON&returnGeometry=true&maxAllowableOffset=0.001&outSR=4326&f=json', T_COUNTY);
  const county = lib.countyFrom(tiger && tiger.features && tiger.features[0]);
  if (!county) return null;

  const [w, s, e, n] = county.bbox;
  const sources = {};
  const feed = (name, p) => p.then(v => { sources[name] = 'ok'; return v; }, () => { sources[name] = 'failed'; return undefined; });

  const [alerts, forecast, gauges, quakes, fires, storms, shelters] = await Promise.all([
    feed('nws_alerts', get('https://api.weather.gov/alerts/active?zone=' + lib.nwsZone(county), T_FEED).then(g => lib.alertsOf(g, now, county))),
    feed('nws_forecast', get('https://api.weather.gov/points/' + county.lat.toFixed(4) + ',' + county.lon.toFixed(4), 2500)
      .then(p => get(p.properties.forecast, 3000)).then(lib.forecastOf)),
    feed('nwps_gauges', get('https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=' + w + '&bbox.ymin=' + s + '&bbox.xmax=' + e + '&bbox.ymax=' + n + '&srid=EPSG_4326', T_FEED)
      .then(g => lib.gaugesOf(g, county))),
    feed('usgs_quakes', get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', T_FEED).then(g => lib.quakesOf(g, county, now))),
    feed('nasa_firms', get(site + '/.netlify/functions/proxy-firms?mode=area&area=' + [w, s, e, n].join(',') + '&days=1', T_FEED, 'text')
      .then(csv => { const f = lib.firesOf(csv, county); if (!f) throw new Error('no csv'); return f; })),
    feed('nhc_storms', get('https://www.nhc.noaa.gov/CurrentStorms.json', T_FEED).then(j => lib.stormsNear(j, county))),
    feed('fema_shelters', get('https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/MapServer/0/query?geometry=' + [w, s, e, n].join(',') +
      '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json', T_FEED)
      .then(j => { if (j && j.error) throw new Error('arcgis'); return lib.sheltersOf(j, county); }))
  ]);

  const b = { county, alerts, forecast, gauges, quakes, fires, storms, shelters, sources, asOf: new Date(now).toISOString() };
  b.level = lib.levelOf(b);
  b.sitrep = lib.sitrep(b, now);
  return b;
}

export default async (req) => {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get('lat')), lon = Number(u.searchParams.get('lon'));
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) || u.searchParams.get('lat') === null || u.searchParams.get('lon') === null) {
    return json(400, { error: 'lat and lon are required' });
  }
  try {
    const b = await brief({ lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 });
    if (!b) return json(404, { error: 'No U.S. county here. County briefs cover the 50 states, DC and territories.' });
    return json(200, b, { 'Cache-Control': 'public, max-age=120', 'Netlify-CDN-Cache-Control': 'public, max-age=120', 'Netlify-Vary': 'query' });
  } catch (e) {
    return json(503, { error: 'County lookup is unavailable right now. Try again in a minute.' });
  }
};

export const config = { path: '/.netlify/functions/county-brief' };
