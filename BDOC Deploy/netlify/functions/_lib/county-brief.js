// County brief: the pure half of county-brief.mjs (p168).
//
// An emergency manager picks a spot; this frames every hazard feed BDOC can reach to
// that one county: NWS warnings for the county, river gauges in flood, quakes, satellite
// fire detections, tropical storms nearby, open FEMA shelters, and the forecast. Then
// it rolls them into one level and a one-page SITREP for the morning brief.
//
// Pure functions only, so tests/county-brief.test.js can pin every rule.
// (c) 2026 Kitsune Global Solutions LLC

const STATE_BY_FIPS = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC',
  '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT',
  '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP',
  '72': 'PR', '78': 'VI'
};

const num = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };
const r3 = (n) => Math.round(n * 1000) / 1000;

function km(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Ray casting over every ring; a point inside an odd number of rings is inside
// (so holes and islands both work).
function inRings(lat, lon, rings) {
  let inside = false;
  for (const ring of rings || []) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// TIGERweb State_County layer 1 feature (outSR 4326) -> the county everything is framed to.
function countyFrom(feature) {
  const a = (feature && feature.attributes) || {};
  const rings = feature && feature.geometry && feature.geometry.rings;
  const geoid = String(a.GEOID || '');
  if (!/^\d{5}$/.test(geoid) || !Array.isArray(rings) || !rings.length) return null;
  const state = STATE_BY_FIPS[geoid.slice(0, 2)];
  if (!state) return null;
  let w = 180, s = 90, e = -180, n = -90;
  const outline = rings.map(ring => ring.map(([x, y]) => {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
    return [r3(x), r3(y)];
  }));
  const lat = num(a.CENTLAT), lon = num(a.CENTLON);
  const name = String(a.NAME || a.BASENAME || 'County').slice(0, 80);
  return {
    geoid, state, stateFips: geoid.slice(0, 2), countyFips: geoid.slice(2),
    name,
    basename: String(a.BASENAME || name.replace(/\s+(County|Parish|Borough|Census Area|Municipality|city)$/i, '')).slice(0, 60),
    lat: lat ?? (s + n) / 2, lon: lon ?? (w + e) / 2,
    bbox: [r3(w), r3(s), r3(e), r3(n)],
    outline
  };
}

// NWS county zone, e.g. Hillsborough FL (12057) -> FLC057.
const nwsZone = (c) => c.state + 'C' + c.countyFips;

const inCounty = (c, lat, lon) => lat >= c.bbox[1] && lat <= c.bbox[3] && lon >= c.bbox[0] && lon <= c.bbox[2] && inRings(lat, lon, c.outline);

const SEV = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

// River warnings carry a generic headline ("FLOOD WARNING REMAINS IN EFFECT UNTIL FURTHER
// NOTICE"); the river is in the text, one paragraph per forecast point:
//   "Alafia River At Lithia affecting Hillsborough County."
// One message can list rivers in several counties, so keep the ones naming this county.
function riversOf(desc, c) {
  const text = String(desc || '').slice(0, 3000).replace(/([^\n])\n(?!\n)/g, '$1 ');  // unwrap lines
  const all = [];
  const re = /^\s*(\S.{2,120}?)\s+affecting\s+(.{2,240}?)\.?\s*$/gm;
  let m;
  while ((m = re.exec(text))) all.push({ river: m[1].trim(), where: m[2].toLowerCase() });
  const base = c && c.basename ? c.basename.toLowerCase() : '';
  const mine = base ? all.filter(r => r.where.includes(base)) : [];
  return [...new Set((mine.length ? mine : all).map(r => r.river))].slice(0, 3);
}

function alertsOf(geo, now, c) {
  const out = [], keys = new Set();
  for (const f of (geo && Array.isArray(geo.features) ? geo.features : [])) {
    const p = (f && f.properties) || {};
    if (p.status && p.status !== 'Actual') continue;
    if (p.messageType === 'Cancel') continue;
    // "ends" is when the hazard ends. River warnings have none ("until further notice"), and
    // "expires" is only when this message is due to be reissued, so it is never shown as an end.
    const gone = p.ends || p.expires;
    if (gone && Date.parse(gone) < now) continue;
    // An update points at the alert it replaces: show the chain once, newest wording.
    const refs = (Array.isArray(p.references) ? p.references : []).map(r => r && r.identifier).filter(Boolean).sort();
    const key = refs[0] || p.id || f.id;
    if (keys.has(key)) continue;
    keys.add(key);
    out.push({
      event: String(p.event || 'Alert').slice(0, 80),
      severity: SEV[p.severity] !== undefined ? p.severity : 'Unknown',
      urgency: p.urgency || '',
      where: riversOf(p.description, c).join('; ').slice(0, 240),
      // NWSheadline is the forecaster's one-liner; the plain headline only says who issued it and when.
      headline: String((p.parameters && Array.isArray(p.parameters.NWSheadline) && p.parameters.NWSheadline[0]) || p.headline || '').slice(0, 240),
      onset: p.onset || p.effective || null,
      ends: p.ends || null,
      sender: String(p.senderName || '').slice(0, 80)
    });
  }
  out.sort((a, b) => SEV[b.severity] - SEV[a.severity] || String(a.onset).localeCompare(String(b.onset)));
  return out;
}

function forecastOf(fc) {
  const periods = fc && fc.properties && Array.isArray(fc.properties.periods) ? fc.properties.periods : [];
  return periods.slice(0, 4).map(p => ({
    name: String(p.name || '').slice(0, 40),
    temp: num(p.temperature), unit: p.temperatureUnit || 'F',
    wind: String((p.windSpeed || '') + ' ' + (p.windDirection || '')).trim().slice(0, 40),
    short: String(p.shortForecast || '').slice(0, 80)
  }));
}

const FLOOD = { major: 4, moderate: 3, minor: 2, action: 1, no_flooding: 0 };
const floodRank = (cat) => (FLOOD[cat] !== undefined ? FLOOD[cat] : -1);
// NWPS categories in words. Action stage is a warning sign, not a flood yet.
const FLOOD_WORDS = { major: 'major flood', moderate: 'moderate flood', minor: 'minor flood', action: 'action stage', no_flooding: 'below flood stage' };
const floodWords = (cat) => FLOOD_WORDS[cat] || 'n/a';

// NWPS gauges in the county's box -> how many report, and the ones at action stage or worse.
function gaugesOf(nwps, c) {
  const list = nwps && Array.isArray(nwps.gauges) ? nwps.gauges : [];
  const out = { reporting: 0, flooding: [] };
  for (const g of list) {
    const lat = num(g.latitude), lon = num(g.longitude);
    if (lat === null || lon === null || !inCounty(c, lat, lon)) continue;
    const obs = (g.status && g.status.observed) || {}, fc = (g.status && g.status.forecast) || {};
    if (floodRank(obs.floodCategory) >= 0) out.reporting++;
    const worst = Math.max(floodRank(obs.floodCategory), floodRank(fc.floodCategory));
    if (worst < 1) continue;
    out.flooding.push({
      lid: String(g.lid || ''), name: String(g.name || '').trim().slice(0, 80), lat, lon,
      stage: num(obs.primary) !== null && obs.primary > -900 ? obs.primary : null, unit: obs.primaryUnit || 'ft',
      observed: obs.floodCategory || null, forecast: floodRank(fc.floodCategory) >= 0 ? fc.floodCategory : null,
      rank: worst
    });
  }
  out.flooding.sort((a, b) => b.rank - a.rank);
  return out;
}

function quakesOf(geo, c, now) {
  const out = [];
  for (const f of (geo && Array.isArray(geo.features) ? geo.features : [])) {
    const [lon, lat] = (f && f.geometry && f.geometry.coordinates) || [];
    const p = (f && f.properties) || {};
    if (num(lat) === null || num(lon) === null || !inCounty(c, lat, lon)) continue;
    if (!(now - num(p.time) <= 24 * 3600e3)) continue;
    out.push({ mag: num(p.mag), place: String(p.place || '').slice(0, 100), time: num(p.time), lat, lon });
  }
  return out.sort((a, b) => (b.mag || 0) - (a.mag || 0));
}

// FIRMS area CSV for the county's box, last 24 h -> detections inside the county.
function firesOf(csv, c) {
  if (typeof csv !== 'string' || !csv || csv.charAt(0) === '{') return null;
  const lines = csv.split('\n');
  const hdr = lines[0].split(',');
  const iLat = hdr.indexOf('latitude'), iLon = hdr.indexOf('longitude'), iFrp = hdr.indexOf('frp');
  if (iLat < 0 || iLon < 0) return null;
  let count = 0, maxFrp = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const lat = parseFloat(cols[iLat]), lon = parseFloat(cols[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inCounty(c, lat, lon)) continue;
    count++;
    maxFrp = Math.max(maxFrp, parseFloat(cols[iFrp]) || 0);
  }
  return { count, maxFrp: Math.round(maxFrp) };
}

// NHC CurrentStorms.json -> active storms within 1,500 km of the county centre.
function stormsNear(nhc, c) {
  const out = [];
  for (const s of (nhc && Array.isArray(nhc.activeStorms) ? nhc.activeStorms : [])) {
    const lat = num(s.latitudeNumeric), lon = num(s.longitudeNumeric);
    if (lat === null || lon === null) continue;
    const d = Math.round(km(c.lat, c.lon, lat, lon));
    if (d > 1500) continue;
    out.push({
      name: String(s.name || 'Storm').slice(0, 40), classification: String(s.classification || '').slice(0, 10),
      intensityKt: num(s.intensity), movement: [s.movementDir != null ? s.movementDir + '°' : '', s.movementSpeed != null ? s.movementSpeed + ' mph' : ''].filter(Boolean).join(' at '),
      distanceKm: d,
      advisory: s.publicAdvisory && /^https:\/\//.test(s.publicAdvisory.url || '') ? s.publicAdvisory.url : null
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

function sheltersOf(arc, c) {
  const out = [];
  for (const f of (arc && Array.isArray(arc.features) ? arc.features : [])) {
    const a = (f && f.attributes) || {};
    const lat = num(a.latitude), lon = num(a.longitude);
    if (lat === null || lon === null || !inCounty(c, lat, lon)) continue;
    out.push({
      name: String(a.shelter_name || 'Shelter').slice(0, 100), city: String(a.city || '').slice(0, 40), lat, lon,
      status: String(a.shelter_status || '').slice(0, 20),
      capacity: num(a.evacuation_capacity), population: num(a.total_population),
      pets: /yes|pets|allowed/i.test(String(a.pet_accommodations_code || '')),
      ada: /^y/i.test(String(a.ada_compliant || a.wheelchair_accessible || ''))
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// One word for the top of the brief, with the reasons that set it.
function levelOf(b) {
  const severe = [], elevated = [];
  for (const a of b.alerts || []) {
    const msg = a.event + (a.where ? ': ' + a.where : '');
    if (SEV[a.severity] >= 3) severe.push(msg); else elevated.push(msg);
  }
  for (const g of (b.gauges && b.gauges.flooding) || []) {
    const msg = g.name + ': ' + floodWords(g.rank === 4 ? 'major' : g.rank === 3 ? 'moderate' : g.rank === 2 ? 'minor' : 'action');
    (g.rank >= 3 ? severe : elevated).push(msg);
  }
  for (const s of b.storms || []) {
    const msg = s.name + ' ' + s.distanceKm + ' km away';
    if (s.distanceKm <= 300) severe.push(msg); else if (s.distanceKm <= 1000) elevated.push(msg);
  }
  for (const q of b.quakes || []) { if ((q.mag || 0) >= 5) severe.push('M' + q.mag + ' earthquake'); else if ((q.mag || 0) >= 3.5) elevated.push('M' + q.mag + ' earthquake'); }
  // One small detection is usually a farm or a flare, so it is listed but does not raise the level.
  if (b.fires && (b.fires.count >= 25 || b.fires.maxFrp >= 100)) severe.push(b.fires.count + ' fire detections');
  else if (b.fires && (b.fires.count >= 3 || b.fires.maxFrp >= 20)) elevated.push(b.fires.count + ' fire detections');
  if ((b.shelters || []).length) elevated.push(b.shelters.length + ' shelter' + (b.shelters.length === 1 ? '' : 's') + ' open');
  const unique = (xs) => [...new Set(xs)];
  if (severe.length) return { level: 'SEVERE', reasons: unique(severe).concat(unique(elevated)).slice(0, 6) };
  if (elevated.length) return { level: 'ELEVATED', reasons: unique(elevated).slice(0, 6) };
  return { level: 'NORMAL', reasons: [] };
}

const hhmm = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : ''; };

// Feeds that did not answer, in words. The level is worked out from the ones that did,
// so a missing feed can only hide a reason to raise it (5 Nov: a slow NOAA gauge feed
// turned Hillsborough's ELEVATED into NORMAL for one call).
const SOURCE_NAMES = {
  nws_alerts: 'NWS warnings', nwps_gauges: 'river gauges', nhc_storms: 'NHC storms', nasa_firms: 'NASA fire detections',
  usgs_quakes: 'USGS earthquakes', fema_shelters: 'FEMA shelters', nws_forecast: 'NWS forecast'
};
const missingOf = (sources) => Object.keys(sources || {}).filter(k => sources[k] !== 'ok').map(k => SOURCE_NAMES[k] || k);

// Plain-text SITREP: what the coordinator reads out at the morning brief.
function sitrep(b, now) {
  const L = [];
  const c = b.county;
  const missing = missingOf(b.sources);
  L.push('SITREP: ' + c.name + ', ' + c.state + ' (FIPS ' + c.geoid + ')');
  L.push('As of ' + hhmm(new Date(now).toISOString()) + ' · Overall: ' + b.level.level + (b.level.reasons.length ? ' (' + b.level.reasons.join('; ') + ')' : ''));
  if (missing.length) L.push('NOT CHECKED: ' + missing.join(', ') + ' did not answer' + (b.level.level !== 'SEVERE' ? ', so the level may be higher.' : '.'));
  L.push('');
  L.push('1. WEATHER WARNINGS (NWS)');
  if (!b.alerts) L.push('   Not available.');
  else if (!b.alerts.length) L.push('   None in effect.');
  else for (const a of b.alerts) L.push('   - ' + a.event + (a.where ? ', ' + a.where : '') + ' [' + a.severity + ']' + (a.ends ? ', until ' + hhmm(a.ends) : '') + (a.headline ? ': ' + a.headline : ''));
  L.push('2. RIVERS (NOAA gauges)');
  if (!b.gauges) L.push('   Not available.');
  else if (!b.gauges.flooding.length) L.push('   ' + b.gauges.reporting + ' gauge' + (b.gauges.reporting === 1 ? '' : 's') + ' reporting, none at action stage or above.');
  else {
    for (const g of b.gauges.flooding) L.push('   - ' + g.name + ': now ' + floodWords(g.observed) + (g.forecast ? ', forecast ' + floodWords(g.forecast) : '') + (g.stage !== null ? ' (' + g.stage + ' ' + g.unit + ')' : ''));
    L.push('   ' + b.gauges.reporting + ' gauge' + (b.gauges.reporting === 1 ? '' : 's') + ' reporting in all.');
  }
  L.push('3. TROPICAL (NHC)');
  if (!b.storms) L.push('   Not available.');
  else if (!b.storms.length) L.push('   No active storm within 1,500 km.');
  else for (const s of b.storms) L.push('   - ' + s.classification + ' ' + s.name + ', ' + s.distanceKm + ' km from county centre' + (s.intensityKt ? ', ' + s.intensityKt + ' kt' : '') + (s.movement ? ', moving ' + s.movement : ''));
  L.push('4. FIRE (NASA FIRMS, 24 h)');
  L.push('   ' + (!b.fires ? 'Not available.' : b.fires.count ? b.fires.count + ' satellite detection' + (b.fires.count === 1 ? '' : 's') + (b.fires.maxFrp >= 1 ? ', strongest ' + b.fires.maxFrp + ' MW' : '') + '.' : 'No detections.'));
  L.push('5. EARTHQUAKES (USGS, 24 h, M2.5+)');
  if (!b.quakes) L.push('   Not available.');
  else if (!b.quakes.length) L.push('   None.');
  else for (const q of b.quakes) L.push('   - M' + q.mag + ' ' + q.place);
  L.push('6. SHELTERS (FEMA open shelters)');
  if (!b.shelters) L.push('   Not available.');
  else if (!b.shelters.length) L.push('   None open in the county.');
  else for (const s of b.shelters) L.push('   - ' + s.name + (s.city ? ', ' + s.city : '') + (s.population !== null && s.capacity ? ': ' + s.population + '/' + s.capacity : '') + (s.pets ? ', pets' : '') + (s.ada ? ', ADA' : ''));
  L.push('7. FORECAST (NWS, county centre)');
  if (!b.forecast || !b.forecast.length) L.push('   Not available.');
  else for (const f of b.forecast) L.push('   - ' + f.name + ': ' + f.short + (f.temp !== null ? ', ' + f.temp + '°' + f.unit : '') + (f.wind ? ', wind ' + f.wind : ''));
  L.push('');
  L.push('Sources: NWS, NOAA NWPS, NHC, NASA FIRMS, USGS, FEMA, U.S. Census. Generated by BDOC. Verify before acting.');
  return L;
}

module.exports = {
  STATE_BY_FIPS, FLOOD_WORDS, SOURCE_NAMES, floodWords, missingOf, km, inRings, countyFrom, nwsZone, inCounty,
  riversOf, alertsOf, forecastOf, gaugesOf, floodRank, quakesOf, firesOf, stormsNear, sheltersOf, levelOf, sitrep
};
