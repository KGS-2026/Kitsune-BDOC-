// GPS interference: the pure half of gps-interference-tick.mjs / gps-interference.mjs.
//
// Every ADS-B position report carries the aircraft's own opinion of its position
// quality: NIC (integrity containment radius) and NACp (accuracy). When GPS is
// jammed or spoofed nearby, those drop, and readsb marks an aircraft that just lost
// GPS with gpsOkBefore. Counting, per map cell, how many aircraft report degraded
// GPS out of all that report at all shows where GPS is being interfered with.
// Same idea and bands as gpsjam.org (low < 2 %, medium 2-10 %, high > 10 %).
//
// Pure functions only (no fetch, no Blobs, no clock unless passed in), so
// tests/gps-interference.test.js can pin every rule.
// (c) 2026 Kitsune Global Solutions LLC

// Sample circles, 250 nm each (adsb.lol's maximum). Known interference areas first,
// then busy airspace elsewhere so the map also shows where GPS is fine.
const REGIONS = [
  ['Kaliningrad', 54.7, 20.5], ['Gulf of Finland', 59.8, 26.0], ['Baltic states', 57.0, 24.5],
  ['Gotland', 57.5, 18.5], ['Poland', 52.2, 19.0], ['Finnmark', 69.5, 26.0],
  ['Romania', 44.5, 26.0], ['Black Sea', 43.5, 32.5], ['Istanbul', 41.0, 29.0],
  ['Eastern Turkey', 39.0, 39.0], ['Caucasus', 40.5, 44.5], ['Cyprus', 35.0, 33.5],
  ['Levant', 32.5, 35.0], ['Sinai and Cairo', 30.0, 32.5], ['Iraq', 33.3, 44.4],
  ['Kuwait and Basra', 29.5, 48.0], ['Gulf', 25.0, 55.0], ['Tehran', 35.7, 51.4],
  ['Riyadh', 24.7, 46.7], ['Red Sea', 21.5, 39.2], ['Libya', 32.9, 13.2],
  ['Punjab', 30.5, 74.5], ['Myanmar', 17.0, 96.0], ['Korea', 37.5, 127.0],
  ['Western Europe', 50.0, 5.0], ['US East', 39.5, -77.0], ['US Central', 38.0, -95.0],
  ['US West', 36.0, -118.0], ['Japan', 35.5, 139.5], ['Hong Kong', 22.5, 114.0],
  ['Sao Paulo', -23.5, -46.6], ['Sydney', -33.9, 151.2]
].map(([name, lat, lon]) => ({ name, lat, lon }));

const DIST_NM = 250;
// adsb.lol rate-limits bursts (about 20 quick calls was enough to get "rate limit
// exceeded"). Each 15-minute run samples a quarter of the regions, so every region
// is sampled once an hour: 32 calls an hour in all.
const PER_RUN = 8;
const RUNS_PER_HOUR = 4;

// Which regions the run at `now` samples: quarter q of the hour takes every 4th region.
function regionsFor(now) {
  const q = Math.floor(new Date(now).getUTCMinutes() / 15) % RUNS_PER_HOUR;
  return REGIONS.filter((_, i) => i % RUNS_PER_HOUR === q).slice(0, PER_RUN);
}
const CELL_DEG = 1;            // ~111 km tall: enough aircraft per cell to mean something
const WINDOW_HOURS = 24;
// Aircraft reports in a cell over the window (an aircraft seen in four hourly samples
// counts four times). Below this a single odd transponder could paint a cell red.
const MIN_AIRCRAFT = 20;
const BANDS = { medium: 0.02, high: 0.10 };

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// null = the report says nothing about GPS quality; true/false = degraded or not.
function degraded(ac) {
  if (!ac || ac.alt_baro === 'ground') return null;
  // ADS-B aircraft only. version >= 1 means it has been heard broadcasting ADS-B
  // status; version 0 transponders send NUCp, not NIC/NACp, and would read as jammed.
  if (!(num(ac.version) >= 1)) return null;
  // Its own broadcast, or a ground (MLAT) fix. Keep MLAT: a jammed airliner stops
  // sending a valid position, so the network falls back to locating it from the
  // ground. Near Kaliningrad most jammed airliners showed up exactly that way.
  if (ac.type !== 'adsb_icao' && ac.type !== 'mlat') return null;
  // Light aircraft out. Microlights and kit planes (category A1) carry uncertified
  // GPS that reports low NIC all the time: over Western Europe they made 11 % of
  // aircraft look jammed on a normal day. A2-A6 are small to heavy jets and fast
  // aircraft. No category: count it only up where light aircraft don't fly.
  // (SIL is no help: some Airbus types report SIL 0 while jammed.)
  const cat = typeof ac.category === 'string' ? ac.category : '';
  if (cat ? !/^A[2-6]$/.test(cat) : !(num(ac.alt_baro) >= 15000)) return null;
  if (ac.gpsOkBefore) return true;
  const nic = num(ac.nic), nacp = num(ac.nac_p);
  if (nic === null && nacp === null) return null;
  return (nic !== null && nic < 7) || (nacp !== null && nacp < 8);
}

// Where to count it. An aircraft that just lost GPS may report its last good fix.
function positionOf(ac) {
  const lat = num(ac.lat) ?? num(ac.gpsOkLat) ?? (ac.lastPosition && num(ac.lastPosition.lat));
  const lon = num(ac.lon) ?? num(ac.gpsOkLon) ?? (ac.lastPosition && num(ac.lastPosition.lon));
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function cellOf(lat, lon) {
  const y = Math.floor(lat / CELL_DEG) * CELL_DEG;
  const x = Math.floor(lon / CELL_DEG) * CELL_DEG;
  return y + ',' + x;   // south-west corner
}

// One sample (all regions of one tick) into { cell: [degraded, total] }.
// Regions overlap, so an aircraft is counted once per sample, by its hex id.
function tally(aircraftLists) {
  const seen = new Set();
  const cells = {};
  for (const list of aircraftLists) {
    for (const ac of list || []) {
      const id = ac && ac.hex;
      if (!id || seen.has(id)) continue;
      const bad = degraded(ac);
      if (bad === null) continue;
      const pos = positionOf(ac);
      if (!pos) continue;
      seen.add(id);
      const k = cellOf(pos.lat, pos.lon);
      const c = cells[k] || (cells[k] = [0, 0]);
      if (bad) c[0]++;
      c[1]++;
    }
  }
  return cells;
}

function addInto(into, cells) {
  for (const [k, [b, t]] of Object.entries(cells || {})) {
    if (!/^-?\d+,-?\d+$/.test(k) || !Number.isFinite(b) || !Number.isFinite(t)) continue;
    const c = into[k] || (into[k] = [0, 0]);
    c[0] += b; c[1] += t;
  }
  return into;
}

const hourKey = (ms) => 'h-' + new Date(ms).toISOString().slice(0, 13).replace(/[-T]/g, '');

// The hourly keys that make up the window ending at `now`, newest first.
function windowKeys(now, hours = WINDOW_HOURS) {
  const out = [];
  for (let i = 0; i < hours; i++) out.push(hourKey(now - i * 3600e3));
  return out;
}

function level(bad, total) {
  if (total < MIN_AIRCRAFT) return null;
  const share = bad / total;
  return share > BANDS.high ? 'high' : share >= BANDS.medium ? 'medium' : 'low';
}

// What the layer draws: one row per cell with enough aircraft.
function summarize(merged) {
  const out = [];
  for (const [k, [bad, total]] of Object.entries(merged)) {
    const lv = level(bad, total);
    if (!lv) continue;
    const [lat, lon] = k.split(',').map(Number);
    out.push({ lat, lon, bad, total, pct: Math.round(1000 * bad / total) / 10, level: lv });
  }
  out.sort((a, b) => b.pct - a.pct || b.total - a.total);
  return out;
}

module.exports = {
  REGIONS, DIST_NM, PER_RUN, CELL_DEG, WINDOW_HOURS, MIN_AIRCRAFT, BANDS,
  regionsFor, degraded, positionOf, cellOf, tally, addInto, hourKey, windowKeys, level, summarize
};
