// Watch-zone phone alerts: the pure half of zone-alerts-tick.mjs.
//
// A device that armed push can attach its watch zones to its push subscription.
// Every five minutes the tick reads public hazard feeds once, finds events inside
// each device's zones, and pushes the new ones, so a person learns about a quake,
// a tornado warning or a wildfire near home with BDOC closed.
//
// Everything here is a pure function of its inputs (no fetch, no Blobs, no clock
// unless passed in), so tests/zone-alerts.test.js can pin every decision.
// (c) 2026 Kitsune Global Solutions LLC

const MAX_ZONES = 10;
const RAD_MIN = 5;
const RAD_MAX = 500;
const LEVELS = ['serious', 'all'];

// Quakes older than this are history, not an alert. It also keeps a newly armed
// zone from paging for something that happened yesterday.
const QUAKE_MAX_AGE_MS = 3 * 3600 * 1000;
const QUAKE_MIN = { serious: 4.0, all: 2.5 };

// A fire keeps burning for days. Alert once, then again only if it is still
// active after the cooldown, instead of on every satellite pass.
const FIRE_COOLDOWN_MS = { serious: 6 * 3600 * 1000, all: 1 * 3600 * 1000 };
const SEEN_TTL_MS = 72 * 3600 * 1000;

// Per device per tick. More than this becomes one summary line, so a bad night
// cannot bury a phone under a stack of notifications.
const MAX_PER_TICK = 3;

const SEV_RANK = { critical: 3, high: 2, info: 1 };

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }

function cleanZones(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const ids = new Set();
  for (let i = 0; i < raw.length && out.length < MAX_ZONES; i++) {
    const z = raw[i] || {};
    const lat = num(z.lat), lon = num(z.lon);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) continue;
    let radKm = num(z.radKm);
    if (!Number.isFinite(radKm)) radKm = 100;
    radKm = Math.min(Math.max(Math.round(radKm), RAD_MIN), RAD_MAX);
    let id = String(z.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || ('z' + i);
    if (ids.has(id)) continue;
    ids.add(id);
    const rlat = Math.round(lat * 1e4) / 1e4, rlon = Math.round(lon * 1e4) / 1e4;
    const name = String(z.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60)
      || (rlat.toFixed(2) + ', ' + rlon.toFixed(2));
    out.push({ id, name, lat: rlat, lon: rlon, radKm });
  }
  return out;
}

function cleanPrefs(raw) {
  const p = raw || {};
  return {
    level: LEVELS.includes(p.level) ? p.level : 'serious',
    quake: p.quake !== false,
    weather: p.weather !== false,
    fire: p.fire !== false,
    // p181: FEMA national alerts and tests (gov-alert-tick.mjs). Not zone-based.
    national: p.national !== false
  };
}

function km(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// lon1,lat1,lon2,lat2: the order the FIRMS area API wants.
function bbox(z) {
  const dLat = z.radKm / 111;
  const dLon = z.radKm / (111 * Math.max(0.2, Math.cos(z.lat * Math.PI / 180)));
  return [
    Math.max(-180, z.lon - dLon), Math.max(-90, z.lat - dLat),
    Math.min(180, z.lon + dLon), Math.min(90, z.lat + dLat)
  ];
}

// Same box the in-page sweep uses: NWS answers only for the US and territories.
function isUS(z) { return z.lat > 15 && z.lat < 72 && z.lon > -180 && z.lon < -60; }

// Opens BDOC flown to the spot. deeplink.js restores a camera-only hash without
// touching the user's layers.
function flyUrl(lat, lon, radKm) {
  const h = Math.round(Math.min(Math.max((radKm || 100) * 3000, 50000), 1500000));
  return '/#v=1&c=' + lon.toFixed(3) + ',' + lat.toFixed(3) + ',' + h;
}

function quakeEvents(zones, prefs, geo, now) {
  if (!prefs.quake || !geo || !Array.isArray(geo.features)) return [];
  const min = QUAKE_MIN[prefs.level];
  const out = [];
  for (const f of geo.features) {
    const c = f && f.geometry && f.geometry.coordinates;
    const p = (f && f.properties) || {};
    const mag = num(p.mag);
    if (!c || !Number.isFinite(mag) || mag < min) continue;
    if (!(now - num(p.time) <= QUAKE_MAX_AGE_MS)) continue;
    for (const z of zones) {
      const d = km(z.lat, z.lon, c[1], c[0]);
      if (d > z.radKm) continue;
      out.push({
        key: 'eq:' + f.id,
        tag: 'wz:eq:' + f.id,
        severity: mag >= 5.5 ? 'critical' : 'high',
        title: z.name + ': M' + mag.toFixed(1) + ' earthquake',
        body: Math.round(d) + ' km from your zone center' + (p.place ? ' · ' + String(p.place).slice(0, 80) : ''),
        url: flyUrl(c[1], c[0], 60)
      });
      break; // one push per quake, even if it sits in two zones
    }
  }
  return out;
}

// An NWS update gets a new id but points at the alert it replaces. Keying on the
// first alert in that chain turns "warning issued, extended, extended" into one push.
function nwsKey(p, fallback) {
  const refs = Array.isArray(p.references) ? p.references : [];
  const first = refs.map(r => r && r.identifier).filter(Boolean).sort()[0];
  return 'nws:' + (first || p.id || fallback);
}

function nwsEvents(z, prefs, geo, now) {
  if (!prefs.weather || !geo || !Array.isArray(geo.features)) return [];
  const out = [];
  for (const f of geo.features) {
    const p = (f && f.properties) || {};
    if (p.status && p.status !== 'Actual') continue;
    if (p.messageType === 'Cancel') continue;
    if (p.expires && Date.parse(p.expires) < now) continue;
    const sev = p.severity;
    if (prefs.level === 'serious' && sev !== 'Extreme' && sev !== 'Severe') continue;
    const key = nwsKey(p, f.id);
    out.push({
      key,
      tag: 'wz:' + key,
      severity: sev === 'Extreme' ? 'critical' : sev === 'Severe' ? 'high' : 'info',
      title: z.name + ': ' + String(p.event || 'Weather alert').slice(0, 60),
      body: String(p.headline || p.areaDesc || '').slice(0, 160),
      url: flyUrl(z.lat, z.lon, z.radKm)
    });
  }
  return out;
}

// FIRMS area CSV for the zone's box. Counts every detection inside the circle
// over the last day, and alerts when the zone is actually burning: in 'serious'
// mode 10+ detections or one hot one (50+ MW), in 'all' mode any detection.
function fireEvent(z, prefs, csv) {
  if (!prefs.fire || typeof csv !== 'string' || !csv || csv.charAt(0) === '{') return null;
  const lines = csv.split('\n');
  if (lines.length < 2) return null;
  const hdr = lines[0].split(',');
  const iLat = hdr.indexOf('latitude'), iLon = hdr.indexOf('longitude'), iFrp = hdr.indexOf('frp');
  if (iLat < 0 || iLon < 0) return null;
  let total = 0, maxFrp = 0, best = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const la = parseFloat(cols[iLat]), lo = parseFloat(cols[iLon]);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    if (km(z.lat, z.lon, la, lo) > z.radKm) continue;
    total++;
    const frp = parseFloat(cols[iFrp]) || 0;
    if (!best || frp > maxFrp) { maxFrp = frp; best = { la, lo }; }
  }
  if (!total) return null;
  if (prefs.level === 'serious' && total < 10 && maxFrp < 50) return null;
  return {
    key: 'fire:' + z.id,
    cooldownMs: FIRE_COOLDOWN_MS[prefs.level],
    tag: 'wz:fire:' + z.id,
    severity: (total >= 25 || maxFrp >= 100) ? 'critical' : 'high',
    title: z.name + ': wildfire activity',
    body: total + ' satellite fire detection' + (total === 1 ? '' : 's') + ' in the last 24 h, strongest ' + Math.round(maxFrp) + ' MW',
    url: flyUrl(best.la, best.lo, 40)
  };
}

function pruneSeen(seen, now) {
  const out = {};
  for (const [k, t] of Object.entries(seen || {})) {
    if (Number.isFinite(t) && now - t < SEEN_TTL_MS) out[k] = t;
  }
  return out;
}

// Drops what this device already got, marks the rest seen, and returns at most
// MAX_PER_TICK messages, the last one a summary when there are more.
function selectToSend(events, seen, now) {
  const fresh = [];
  const keys = new Set();
  for (const e of events) {
    if (keys.has(e.key)) continue;
    keys.add(e.key);
    const t = seen[e.key];
    if (t && (!e.cooldownMs || now - t < e.cooldownMs)) continue;
    fresh.push(e);
  }
  fresh.sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0));
  for (const e of fresh) seen[e.key] = now;
  if (fresh.length <= MAX_PER_TICK) return fresh;
  const head = fresh.slice(0, MAX_PER_TICK - 1);
  const rest = fresh.length - head.length;
  head.push({
    key: 'summary',
    covers: fresh.slice(head.length).map(e => e.key),
    tag: 'wz:summary',
    severity: fresh[head.length].severity,
    title: rest + ' more alert' + (rest === 1 ? '' : 's') + ' in your watch zones',
    body: 'Open BDOC to see them all.',
    url: '/'
  });
  return head;
}

function payloadOf(e, now) {
  return JSON.stringify({
    title: String(e.title).slice(0, 120),
    body: String(e.body || '').slice(0, 400),
    url: e.url || '/',
    severity: e.severity || 'info',
    tag: e.tag,
    ts: now
  });
}

module.exports = {
  MAX_ZONES, MAX_PER_TICK, QUAKE_MAX_AGE_MS, FIRE_COOLDOWN_MS,
  cleanZones, cleanPrefs, km, bbox, isUS, flyUrl,
  quakeEvents, nwsEvents, fireEvent, pruneSeen, selectToSend, payloadOf
};
