#!/usr/bin/env node
// Meshtastic public-MQTT -> Supabase bridge.
//
// FIXES vs first draft:
//  - topic was 'msh/2/+/telemetry/position'. The real JSON topic is
//    msh/<REGION>/2/json/<CHANNEL>/<USERID>  (see meshtastic.org/docs/software/integrations/mqtt)
//    so the old subscription matched nothing, forever, silently.
//  - public broker requires credentials (meshdev / large4cats) — anonymous connect is refused.
//  - payload is one JSON envelope {from,type,payload:{...}}, not separate position/info topics.
//  - `mqtt` was never added to package.json.
//
// Run:  MESH_REGION=US node tools/mesh-mqtt-listener.js

const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');

const REGION  = process.env.MESH_REGION || 'US';
const BROKER  = process.env.MESH_MQTT_URL || 'mqtt://mqtt.meshtastic.org:1883';
const USER    = process.env.MESH_MQTT_USER || 'meshdev';
const PASS    = process.env.MESH_MQTT_PASS || 'large4cats';
const TOPIC   = `msh/${REGION}/2/json/#`;

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = (SUPA_URL && SUPA_KEY) ? createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } }) : null;
if (!supabase) console.warn('[mesh-mqtt] SUPABASE_URL/SUPABASE_SERVICE_KEY unset — running in log-only mode');

const client = mqtt.connect(BROKER, {
  clientId: `bdoc-${Math.random().toString(16).slice(2, 10)}`,
  username: USER, password: PASS, clean: true, reconnectPeriod: 5000, connectTimeout: 15000
});

let seen = 0, written = 0, skipped = 0;

// `from` is usually a number, but some gateways emit "!abcd1234" or a decimal string.
// Number("!abcd1234") is NaN, which produced the bogus node_id "!00000NaN" in testing.
function toNodeId(from) {
  if (from === undefined || from === null) return null;
  if (typeof from === 'string') {
    const s = from.trim();
    if (/^![0-9a-fA-F]{1,8}$/.test(s)) return '!' + s.slice(1).toLowerCase().padStart(8, '0');
    if (/^[0-9a-fA-F]{8}$/.test(s) && !/^\d+$/.test(s)) return '!' + s.toLowerCase();
    from = Number(s);
  }
  if (!Number.isFinite(from) || from <= 0) return null;
  return '!' + (from >>> 0).toString(16).padStart(8, '0');
}

client.on('connect', () => {
  console.log(`[mesh-mqtt] connected ${BROKER}`);
  client.subscribe(TOPIC, { qos: 0 }, err => {
    if (err) console.error('[mesh-mqtt] subscribe failed:', err.message);
    else console.log(`[mesh-mqtt] subscribed ${TOPIC}`);
  });
});

client.on('error',   e => console.error('[mesh-mqtt] error:', e.message));
client.on('offline', () => console.warn('[mesh-mqtt] offline, will reconnect'));

client.on('message', async (topic, buf) => {
  let env;
  try { env = JSON.parse(buf.toString()); } catch { return; }   // non-JSON (protobuf) topics
  seen++;

  const nodeId = toNodeId(env.from);
  if (!nodeId) { skipped++; return; }
  const p = env.payload || {};
  const row = { node_id: nodeId, last_heard: new Date().toISOString() };

  if (env.type === 'position') {
    // Meshtastic JSON sends fixed-point 1e-7 degrees as latitude_i/longitude_i.
    const lat = typeof p.latitude_i === 'number' ? p.latitude_i / 1e7 : p.latitude;
    const lon = typeof p.longitude_i === 'number' ? p.longitude_i / 1e7 : p.longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number') return;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return;
    row.latitude = lat; row.longitude = lon; row.altitude = p.altitude || 0;
  } else if (env.type === 'nodeinfo') {
    row.long_name = p.longname || p.longName || null;
    row.short_name = p.shortname || p.shortName || null;
    row.hw_model = p.hardware !== undefined ? String(p.hardware) : null;
  } else if (env.type === 'telemetry') {
    if (typeof p.battery_level === 'number') row.battery_level = p.battery_level;
    else return;
  } else return;

  if (typeof env.rssi === 'number') row.rssi = env.rssi;
  if (typeof env.snr === 'number') row.snr = env.snr;

  if (!supabase) { console.log('[mesh-mqtt]', env.type, JSON.stringify(row)); return; }
  const { error } = await supabase.from('mesh_nodes').upsert(row, { onConflict: 'node_id' });
  if (error) console.error('[mesh-mqtt] upsert:', error.message);
  else written++;
});

setInterval(() => console.log(`[mesh-mqtt] seen=${seen} written=${written} skipped=${skipped}`), 60000).unref();
process.on('SIGINT', () => client.end(true, () => process.exit(0)));
