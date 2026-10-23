#!/usr/bin/env node
// BDOC IPC receiver — Node-only (uses http). Runs on the customer's machine.
// External apps POST data; the BDOC web UI GETs it back.
//
//   POST /api/v1/<source>/<datatype>   ingest
//   GET  /api/v1/<source>/<datatype>   read back {status,count,nodes:[...]}
//   GET  /api/v1/status                health
//
// Sources: wireshark/packet, wifi/scan, mesh/node, mesh/packet, flightradar/aircraft,
//          shodan/device, sensor/reading
//
//   GET  /api/v1/wireshark/events?since=N   every captured IP packet (Network Builder)
//   GET  /api/v1/mesh/events?since=N        every mesh RF packet heard (Skybridge + Network Builder)

const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.BDOC_IPC_PORT || 9876);
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const MAX_BODY = 1 << 20;            // 1 MB
const RATE_LIMIT_PER_MIN = 6000;   // p155: 100 pkt/s bursts for live capture

const ROUTES = {
  'wireshark/packet':     { key: d => `pkt-${d.src_ip}-${d.dst_ip}-${d.dst_port || 0}`, validate: v => { req(v, 'src_ip', 'dst_ip', 'protocol'); geo(v.geo_src); geo(v.geo_dst); } },
  'wifi/scan':            { key: d => `wifi-${d.location.lat},${d.location.lon}`,        validate: v => { if (!v.location || typeof v.location.lat !== 'number' || typeof v.location.lon !== 'number') throw new Error('location.lat/lon required'); if (!Array.isArray(v.networks)) throw new Error('networks must be an array'); } },
  'mesh/node':            { key: d => d.node_id,                                          validate: v => { req(v, 'node_id'); latlon(v); } },
  // p156: one record per RF packet heard on the mesh (any portnum). Skybridge chunks ride
  // portnum 256 with payload_b64; the Network Builder animates all of them.
  'mesh/packet':          { key: d => `${d.from}-${d.id || ''}-${d.hop_limit === undefined ? '' : d.hop_limit}`, validate: v => { req(v, 'from', 'portnum'); if (v.payload_b64 !== undefined && (typeof v.payload_b64 !== 'string' || v.payload_b64.length > 400)) throw new Error('payload_b64 must be a base64 string <= 400 chars'); } },
  'flightradar/aircraft': { key: d => d.icao,                                             validate: v => { req(v, 'icao'); latlon(v); } },
  'shodan/device':        { key: d => d.ip,                                               validate: v => { req(v, 'ip'); latlon(v); } },
  'sensor/reading':       { key: d => `sensor-${d.sensor_id}`,                            validate: v => { req(v, 'sensor_id'); if (typeof v.value !== 'number') throw new Error('value must be a number'); latlon(v); } }
};

function req(o, ...fields) { for (const f of fields) if (o[f] === undefined || o[f] === null || o[f] === '') throw new Error(`missing ${f}`); }
function latlon(o) { if (typeof o.latitude !== 'number' || typeof o.longitude !== 'number') throw new Error('latitude/longitude must be numbers'); }
function geo(g) { if (g && (typeof g.lat !== 'number' || typeof g.lon !== 'number')) throw new Error('geo must be {lat,lon} numbers'); }

const stores = {};
for (const r of Object.keys(ROUTES)) stores[r] = new Map();

// P155: per-PACKET event stream for the Network Builder. The flow store above keeps
// only the latest record per src/dst/port, which is right for arcs but useless for
// animating individual packets (a SYN, its SYN-ACK and the ACK collapse into one).
// Every wireshark/packet POST is also appended here with a monotonically increasing
// seq; the browser asks for "everything after seq N" twice a second.
const EVENT_CAP = 5000;
const EVENT_ROUTES = ['wireshark/packet', 'mesh/packet'];
const rings = {};
for (const r of EVENT_ROUTES) rings[r] = { seq: 0, events: [] };
function pushEvent(route, d) {
  const ring = rings[route];
  const e = Object.assign({}, d, { seq: ++ring.seq });
  ring.events.push(e);
  if (ring.events.length > EVENT_CAP) ring.events.splice(0, ring.events.length - EVENT_CAP);
}

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

// ── p157 SECURITY: origin lock + pairing token ────────────────────────────
// Found by the 2026-10-08 external review (#4). This server replied with
// `Access-Control-Allow-Origin: *`, so ANY website open in the same browser
// could read /wireshark/packet, /wifi/scan, /shodan/device and /sensor/reading
// — the operator's own packet captures and Wi-Fi survey, handed to any tab.
// Binding to 127.0.0.1 does NOT help: the browser is already inside the trust
// boundary and CORS is what decides who may read the response.
//
// Two gates now:
//   1. Origin allowlist — only https://kgsbdoc.netlify.app (plus localhost for
//      development). No wildcard, ever.
//   2. Pairing token — a random secret written to ~/.bdoc/bridge_token on first
//      run and required in the X-BDOC-Bridge header. Pair once:
//        localStorage.setItem('bdoc_bridge_token','<token printed at startup>')
//      js/bdoc-auth-fetch.js attaches it automatically after that.
const fsx = require('fs');
const osx = require('os');
const pathx = require('path');
const cryptox = require('crypto');

const ALLOWED_ORIGINS = new Set([
  'https://kgsbdoc.netlify.app',
  'http://localhost:9080',       // electron/server.js local serve
  'http://127.0.0.1:9080'
]);
(process.env.BDOC_EXTRA_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
  .forEach(o => ALLOWED_ORIGINS.add(o));

const TOKEN_FILE = pathx.join(osx.homedir(), '.bdoc', 'bridge_token');
function loadBridgeToken() {
  try {
    fsx.mkdirSync(pathx.dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
    if (!fsx.existsSync(TOKEN_FILE)) {
      fsx.writeFileSync(TOKEN_FILE, cryptox.randomBytes(32).toString('base64url'), { mode: 0o600 });
    }
    return fsx.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch (e) {
    console.error('[BDOC Receiver] could not create token file:', e.message);
    return cryptox.randomBytes(32).toString('base64url'); // session-only fallback
  }
}
const BRIDGE_TOKEN = loadBridgeToken();

function tokenMatches(given) {
  const A = Buffer.from(String(given || ''));
  const B = Buffer.from(BRIDGE_TOKEN);
  return A.length > 0 && A.length === B.length && cryptox.timingSafeEqual(A, B);
}

// Per-response origin, set by the request handler. WeakMap so responses are
// garbage-collected normally and concurrent requests never share state.
const ORIGIN_FOR_RES = new WeakMap();

function send(res, code, obj) {
  const origin = ORIGIN_FOR_RES.get(res) || '';
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  };
  // Echo the origin ONLY when it is allowlisted. Never '*' — see note above.
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-BDOC-Bridge';
    // Chrome Private/Local Network Access: an https page talking to this
    // loopback server needs the preflight to opt in, or the whole bridge
    // breaks in a future Chrome release.
    headers['Access-Control-Allow-Private-Network'] = 'true';
    headers['Access-Control-Max-Age'] = '600';
  }
  res.writeHead(code, headers);
  res.end(body);
}

const server = http.createServer((req_, res) => {
  const u = new URL(req_.url, `http://localhost:${PORT}`);
  const path = u.pathname;

  // p157: remember this request's origin against its own response object, so
  // send() can echo it only when allowlisted. A WeakMap (not a rebound
  // function) because POST routes read the body asynchronously — two
  // overlapping requests would otherwise clobber each other's origin.
  const origin = req_.headers.origin || '';
  ORIGIN_FOR_RES.set(res, origin);

  // Gate 1 — origin. A browser request from any other site is refused outright.
  // (Requests with no Origin are non-browser clients: local scripts, curl,
  //  the Python gateway. Those still face the token gate below.)
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return send(res, 403, { status: 'error', error: 'origin not allowed' });
  }

  // Preflight must answer before the token check, or the browser never gets
  // the chance to send the token header.
  if (req_.method === 'OPTIONS') return send(res, 204, {});

  // Gate 2 — pairing token on every data route. /api/v1/status stays open so
  // the UI can show "bridge running, not paired" instead of a dead box.
  if (path !== '/api/v1/status' && !tokenMatches(req_.headers['x-bdoc-bridge'])) {
    return send(res, 401, {
      status: 'error',
      error: 'bridge not paired',
      hint: "run: localStorage.setItem('bdoc_bridge_token','<token printed by the receiver>')"
    });
  }

  if (path === '/api/v1/status' && req_.method === 'GET') {
    const counts = {};
    for (const [k, m] of Object.entries(stores)) counts[k] = m.size;
    return send(res, 200, { status: 'running', uptime_s: Math.round(process.uptime()), port: PORT, stores: counts });
  }

  const evm = path.match(/^\/api\/v1\/(wireshark|mesh)\/events$/);
  if (evm && req_.method === 'GET') {
    const ring = rings[evm[1] === 'mesh' ? 'mesh/packet' : 'wireshark/packet'];
    const since = Number(u.searchParams.get('since') || 0);
    const limit = Math.min(2000, Number(u.searchParams.get('limit') || 800));
    // first call (since=0) only gets the tail so a reconnect doesn't replay 5,000 packets
    // (mesh keeps 300: a reconnecting Skybridge decoder still gets whole messages)
    let out = since > 0 ? ring.events.filter(e => e.seq > since) : ring.events.slice(evm[1] === 'mesh' ? -300 : -50);
    if (out.length > limit) out = out.slice(-limit);
    return send(res, 200, { status: 'ok', seq: ring.seq, count: out.length, events: out });
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
    if (rings[route]) pushEvent(route, data);
    send(res, 200, { status: 'received', id, stored_at: data.timestamp });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[BDOC Receiver] listening on http://127.0.0.1:${PORT}`);
  // p157: print the pairing token so the operator can pair once. Without this
  // the lockdown just looks like "the bridge stopped working".
  console.log('');
  console.log('  ┌─ PAIRING REQUIRED ────────────────────────────────────────');
  console.log('  │ In the BDOC tab, open DevTools console and run ONCE:');
  console.log(`  │   localStorage.setItem('bdoc_bridge_token','${BRIDGE_TOKEN}')`);
  console.log(`  │ Token is stored at ${TOKEN_FILE} and survives restarts.`);
  console.log('  └───────────────────────────────────────────────────────────');
  console.log('');
});
process.on('SIGINT', () => server.close(() => process.exit(0)));
module.exports = server;
