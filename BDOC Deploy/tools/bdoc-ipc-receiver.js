#!/usr/bin/env node
// BDOC IPC receiver — Node-only (uses http). Runs on the customer's machine.
// External apps POST data; the BDOC web UI GETs it back.
//
//   POST /api/v1/<source>/<datatype>   ingest
//   GET  /api/v1/<source>/<datatype>   read back {status,count,nodes:[...]}
//   GET  /api/v1/status                health
//
// Sources: wireshark/packet, wifi/scan, mesh/node, flightradar/aircraft,
//          shodan/device, sensor/reading

const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.BDOC_IPC_PORT || 9876);
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const MAX_BODY = 1 << 20;            // 1 MB
const RATE_LIMIT_PER_MIN = 2000;

const ROUTES = {
  'wireshark/packet':     { key: d => `pkt-${d.src_ip}-${d.dst_ip}-${d.dst_port || 0}`, validate: v => { req(v, 'src_ip', 'dst_ip', 'protocol'); geo(v.geo_src); geo(v.geo_dst); } },
  'wifi/scan':            { key: d => `wifi-${d.location.lat},${d.location.lon}`,        validate: v => { if (!v.location || typeof v.location.lat !== 'number' || typeof v.location.lon !== 'number') throw new Error('location.lat/lon required'); if (!Array.isArray(v.networks)) throw new Error('networks must be an array'); } },
  'mesh/node':            { key: d => d.node_id,                                          validate: v => { req(v, 'node_id'); latlon(v); } },
  'flightradar/aircraft': { key: d => d.icao,                                             validate: v => { req(v, 'icao'); latlon(v); } },
  'shodan/device':        { key: d => d.ip,                                               validate: v => { req(v, 'ip'); latlon(v); } },
  'sensor/reading':       { key: d => `sensor-${d.sensor_id}`,                            validate: v => { req(v, 'sensor_id'); if (typeof v.value !== 'number') throw new Error('value must be a number'); latlon(v); } }
};

function req(o, ...fields) { for (const f of fields) if (o[f] === undefined || o[f] === null || o[f] === '') throw new Error(`missing ${f}`); }
function latlon(o) { if (typeof o.latitude !== 'number' || typeof o.longitude !== 'number') throw new Error('latitude/longitude must be numbers'); }
function geo(g) { if (g && (typeof g.lat !== 'number' || typeof g.lon !== 'number')) throw new Error('geo must be {lat,lon} numbers'); }

const stores = {};
for (const r of Object.keys(ROUTES)) stores[r] = new Map();

let windowStart = Date.now(), windowCount = 0;
function rateOk() {
  const now = Date.now();
  if (now - windowStart > 60000) { windowStart = now; windowCount = 0; }
  return ++windowCount <= RATE_LIMIT_PER_MIN;
}

function prune() {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const map of Object.values(stores)) {
    for (const [id, rec] of Array.from(map.entries())) {
      if (rec._received_ms < cutoff) map.delete(id);
    }
  }
}
setInterval(prune, 60000).unref();

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const server = http.createServer((req_, res) => {
  const u = new URL(req_.url, `http://localhost:${PORT}`);
  const path = u.pathname;

  if (req_.method === 'OPTIONS') return send(res, 204, {});

  if (path === '/api/v1/status' && req_.method === 'GET') {
    const counts = {};
    for (const [k, m] of Object.entries(stores)) counts[k] = m.size;
    return send(res, 200, { status: 'running', uptime_s: Math.round(process.uptime()), port: PORT, stores: counts });
  }

  const m = path.match(/^\/api\/v1\/(\w+)\/(\w+)$/);
  if (!m) return send(res, 404, { status: 'error', error: 'not found' });
  const route = `${m[1]}/${m[2]}`;
  const spec = ROUTES[route];
  if (!spec) return send(res, 404, { status: 'error', error: `unknown source: ${route}` });

  if (req_.method === 'GET') {
    const nodes = Array.from(stores[route].values());
    return send(res, 200, { status: 'ok', count: nodes.length, nodes });
  }

  if (req_.method !== 'POST') return send(res, 405, { status: 'error', error: 'method not allowed' });
  if (!rateOk()) return send(res, 429, { status: 'error', error: 'rate limit exceeded' });

  let body = '', tooBig = false;
  req_.on('data', c => {
    if (tooBig) return;
    body += c;
    if (body.length > MAX_BODY) { tooBig = true; send(res, 413, { status: 'error', error: 'payload too large' }); req_.destroy(); }
  });
  req_.on('end', () => {
    if (tooBig) return;
    let data;
    try { data = JSON.parse(body); } catch { return send(res, 400, { status: 'error', error: 'invalid JSON', code: 'PARSE_ERROR' }); }
    try { spec.validate(data); } catch (e) { return send(res, 400, { status: 'error', error: e.message, code: 'VALIDATION_ERROR' }); }

    const id = String(spec.key(data));
    data._received_ms = Date.now();
    if (!data.timestamp) data.timestamp = new Date(data._received_ms).toISOString();
    stores[route].set(id, data);
    send(res, 200, { status: 'received', id, stored_at: data.timestamp });
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[BDOC Receiver] listening on http://127.0.0.1:${PORT}`));
process.on('SIGINT', () => server.close(() => process.exit(0)));
module.exports = server;
