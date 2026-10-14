// netlify/functions/proxy-meshworld.js
// GET /.netlify/functions/proxy-meshworld  → every Meshtastic node on Earth that
// reports a position to the public MQTT maps, merged and slimmed for the globe.
//
// Sources (both keyless, public):
//   A. meshtastic.liamcottle.net/api/v1/nodes   ~30k nodes, ~17.6k with position,
//      plus NeighborInfo (measured RF neighbour + SNR) for ~2.4k nodes.
//      28 MB raw / 3.4 MB gzip, ~5 s.
//   B. meshmap.net/nodes.json                    ~9.4k positioned nodes, with
//      "seenBy" = which MQTT gateway heard the node (topic carries region/preset).
//   Union is ~20k positioned nodes (Oct 2026). Either source alone still works.
//
// Output (compact, ~2 MB):
//   { status, generated, sources:{a,b}, dict:{hw:[],role:[],preset:[],region:[]},
//     nodes: [[id, lat, lon, alt, short, long, hwIdx, roleIdx, batt, lastHeard, presetIdx, regionIdx], ...],
//     links: [[aIdx, bIdx, snr|null, kind], ...] }       kind 0 = measured RF neighbour (NeighborInfo)
//                                                          kind 1 = heard by that MQTT gateway (may be relayed)
// Cached at the edge for 10 min (stale-while-revalidate 30 min) and in the warm
// lambda for 5 min, so the 5 s upstream pull happens rarely.

const SRC_A = 'https://meshtastic.liamcottle.net/api/v1/nodes';
const SRC_B = 'https://meshmap.net/nodes.json';
const MAX_AGE_S = 7 * 24 * 3600;      // drop nodes silent for > 7 days
const GW_MAX_KM = 250;                // gateway "heard" edges longer than this are almost surely MQTT-bridged
const RF_MAX_KM = 250;                // NeighborInfo also lists MQTT-downlinked nodes as "neighbours" (seen up to 12,000 km); drop the impossible ones

const baseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

let warm = null; // { at, body }

async function pull(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'User-Agent': 'BDOC-meshworld/1.0 (+https://kgsbdoc.netlify.app)' }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// "MediumFast" (MQTT topic channel) and "MEDIUM_FAST" (map report) are the same
// preset; custom channel names in topics ("SFNarrow") are not presets at all.
const PRESETS = ['LONG_FAST', 'LONG_SLOW', 'LONG_MODERATE', 'LONG_TURBO', 'MEDIUM_SLOW', 'MEDIUM_FAST', 'SHORT_SLOW', 'SHORT_FAST', 'SHORT_TURBO', 'VERY_LONG_SLOW'];
function normPreset(p) {
  if (!p) return null;
  const s = String(p).replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
  return PRESETS.includes(s) ? s : null;
}
const normRegion = r => (r ? String(r).split('/')[0].toUpperCase() : null);

function km(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180, dLa = (bLat - aLat) * r, dLo = (bLon - aLon) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

function build(a, b) {
  const now = Date.now() / 1000;
  const dict = { hw: [], role: [], preset: [], region: [] };
  const di = (k, v) => { if (v === null || v === undefined || v === '') return -1; v = String(v); let i = dict[k].indexOf(v); if (i < 0) { i = dict[k].length; dict[k].push(v); } return i; };
  const byId = new Map(); // id -> merged record
  const ok = (lat, lon) => isFinite(lat) && isFinite(lon) && !(lat === 0 && lon === 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const clean = s => (s == null ? '' : String(s).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40));

  // A — liamcottle
  const rfLinks = [];
  if (a && Array.isArray(a.nodes)) {
    for (const n of a.nodes) {
      const id = Number(n.node_id); if (!id) continue;
      const lat = n.latitude / 1e7, lon = n.longitude / 1e7;
      const t = Date.parse(n.updated_at) / 1000 || 0;
      if (Array.isArray(n.neighbours)) for (const nb of n.neighbours) if (nb && nb.node_id) rfLinks.push([id, Number(nb.node_id), typeof nb.snr === 'number' ? nb.snr : null]);
      if (n.latitude == null || !ok(lat, lon) || now - t > MAX_AGE_S) continue;
      byId.set(id, {
        id, lat, lon, alt: n.altitude || 0, short: clean(n.short_name), long: clean(n.long_name),
        hw: n.hardware_model_name, role: n.role_name, batt: n.battery_level == null ? -1 : n.battery_level,
        t, preset: n.modem_preset_name, region: n.region_name
      });
    }
  }
  // B — meshmap.net (fills gaps, adds seenBy gateways, newer timestamps win)
  const gwSeen = [];
  if (b && typeof b === 'object') {
    for (const [k, n] of Object.entries(b)) {
      const id = Number(k); if (!id || !n) continue;
      const lat = n.latitude / 1e7, lon = n.longitude / 1e7;
      let t = Math.max(n.lastMapReport || 0, n.lastDeviceMetrics || 0, n.lastEnvironmentMetrics || 0);
      let topicPreset = null, topicRegion = null;
      for (const [topic, ts] of Object.entries(n.seenBy || {})) {
        if (ts > t) t = ts;
        const m = topic.match(/^msh\/(.+?)\/2\/[ec]\/([^/]+)\/!([0-9a-f]{8})$/i);
        if (m) { topicRegion = topicRegion || m[1]; topicPreset = topicPreset || m[2]; const gw = parseInt(m[3], 16); if (gw && gw !== id) gwSeen.push([gw, id]); }
      }
      if (!ok(lat, lon) || now - t > MAX_AGE_S) continue;
      const cur = byId.get(id);
      if (cur) {
        if (t > cur.t) { cur.t = t; cur.lat = lat; cur.lon = lon; }
        cur.preset = cur.preset || n.modemPreset || topicPreset;
        cur.region = cur.region || n.region || topicRegion;
        if (cur.batt < 0 && n.batteryLevel != null) cur.batt = n.batteryLevel;
        if (!cur.long) cur.long = clean(n.longName);
        if (!cur.short) cur.short = clean(n.shortName);
      } else {
        byId.set(id, {
          id, lat, lon, alt: n.altitude || 0, short: clean(n.shortName), long: clean(n.longName),
          hw: n.hwModel, role: n.role, batt: n.batteryLevel == null ? -1 : n.batteryLevel,
          t, preset: n.modemPreset || topicPreset, region: n.region || topicRegion
        });
      }
    }
  }

  const list = Array.from(byId.values());
  const idx = new Map(list.map((n, i) => [n.id, i]));
  const nodes = list.map(n => [n.id, +n.lat.toFixed(5), +n.lon.toFixed(5), Math.round(n.alt || 0), n.short, n.long,
    di('hw', n.hw), di('role', n.role), n.batt, Math.round(n.t), di('preset', normPreset(n.preset)), di('region', normRegion(n.region))]);

  const seen = new Set(), links = []; let droppedRf = 0;
  const key = (x, y) => x < y ? x + ':' + y : y + ':' + x;
  for (const [x, y, snr] of rfLinks) {
    const i = idx.get(x), j = idx.get(y); if (i === undefined || j === undefined || i === j) continue;
    const k = key(i, j); if (seen.has(k)) continue;
    if (km(list[i].lat, list[i].lon, list[j].lat, list[j].lon) > RF_MAX_KM) { droppedRf++; continue; }
    seen.add(k);
    links.push([i, j, snr === null ? null : Math.round(snr * 4) / 4, 0]);
  }
  for (const [g, n] of gwSeen) {
    const i = idx.get(g), j = idx.get(n); if (i === undefined || j === undefined || i === j) continue;
    const k = key(i, j); if (seen.has(k)) continue;
    const A = list[i], B = list[j]; if (km(A.lat, A.lon, B.lat, B.lon) > GW_MAX_KM) continue;
    seen.add(k); links.push([i, j, null, 1]);
  }
  return { nodes, links, dict, droppedRf };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: baseHeaders, body: '' };
  if (warm && Date.now() - warm.at < 5 * 60 * 1000) {
    return { statusCode: 200, headers: Object.assign({ 'X-BDOC-Cache': 'warm' }, cacheHeaders()), body: warm.body };
  }
  const [ra, rb] = await Promise.allSettled([pull(SRC_A, 8500), pull(SRC_B, 8500)]);
  const a = ra.status === 'fulfilled' ? ra.value : null;
  const b = rb.status === 'fulfilled' ? rb.value : null;
  if (!a && !b) {
    return {
      statusCode: 502, headers: Object.assign({ 'Cache-Control': 'no-store' }, baseHeaders),
      body: JSON.stringify({ status: 'error', error: 'both Meshtastic map sources unreachable', a: String(ra.reason || ''), b: String(rb.reason || ''), nodes: [], links: [] })
    };
  }
  const out = build(a, b);
  const body = JSON.stringify({
    status: 'ok', generated: new Date().toISOString(),
    sources: { a: a ? 'meshtastic.liamcottle.net' : 'unavailable', b: b ? 'meshmap.net' : 'unavailable' },
    attribution: 'Node data: public Meshtastic MQTT via meshtastic.liamcottle.net and meshmap.net',
    count: out.nodes.length, linkCount: out.links.length, droppedLongRf: out.droppedRf,
    dict: out.dict, nodes: out.nodes, links: out.links
  });
  warm = { at: Date.now() - (a && b ? 0 : 4 * 60 * 1000), body }; // partial result: retry the missing source after 1 min
  return { statusCode: 200, headers: cacheHeaders(), body };
};

function cacheHeaders() {
  return Object.assign({}, baseHeaders, {
    'Cache-Control': 'public, max-age=120',
    'Netlify-CDN-Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800, durable'
  });
}

exports._build = build; // for local tests
