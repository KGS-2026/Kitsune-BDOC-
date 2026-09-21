// Meshtastic Public MQTT Listener
// Subscribes to the public MQTT server and streams mesh node positions to Supabase

const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');

let supabase;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

const MESHTASTIC_MQTT_URL = 'mqtt://mqtt.meshtastic.org:1883';
const mqttClient = mqtt.connect(MESHTASTIC_MQTT_URL, {
  clientId: `bdoc-mesh-listener-${Date.now()}`,
  clean: true,
  reconnectPeriod: 5000
});

mqttClient.on('connect', () => {
  console.log('[Meshtastic MQTT] Connected to public server');
  
  // Subscribe to all position reports: msh/2/[nodeID]/telemetry/position
  mqttClient.subscribe('msh/2/+/telemetry/position', { qos: 1 }, (err) => {
    if (err) console.error('[Meshtastic MQTT] Position subscribe error:', err);
    else console.log('[Meshtastic MQTT] Subscribed to positions');
  });
  
  // Subscribe to node info: msh/2/[nodeID]/info
  mqttClient.subscribe('msh/2/+/info', { qos: 1 }, (err) => {
    if (err) console.error('[Meshtastic MQTT] Info subscribe error:', err);
    else console.log('[Meshtastic MQTT] Subscribed to node info');
  });
});

mqttClient.on('message', async (topic, payload) => {
  try {
    // Parse MQTT topic to extract nodeID
    // msh/2/<nodeID>/telemetry/position or msh/2/<nodeID>/info
    const parts = topic.split('/');
    const nodeId = parts[2]; // The <nodeID> segment
    
    if (topic.includes('telemetry/position')) {
      // Position message: JSON with latitude, longitude, altitude, etc.
      const data = JSON.parse(payload.toString());
      
      if (data.latitude && data.longitude) {
        await upsertNodePosition(nodeId, data);
      }
    } else if (topic.includes('/info')) {
      // Node info message: user details (longName, shortName, hwModel)
      const data = JSON.parse(payload.toString());
      
      if (data.user) {
        await upsertNodeInfo(nodeId, data.user);
      }
    }
  } catch (e) {
    console.error('[Meshtastic MQTT] Parse error:', e.message);
  }
});

mqttClient.on('error', (err) => {
  console.error('[Meshtastic MQTT] Connection error:', err);
});

mqttClient.on('offline', () => {
  console.log('[Meshtastic MQTT] Offline - will reconnect');
});

async function upsertNodePosition(nodeId, posData) {
  if (!supabase) {
    console.log('[Meshtastic] Supabase not configured - skipping position upsert');
    return;
  }

  try {
    const { error } = await supabase
      .from('mesh_nodes')
      .upsert(
        {
          node_id: `!${nodeId}`, // Meshtastic format: !hexID
          latitude: posData.latitude,
          longitude: posData.longitude,
          altitude: posData.altitude || 0,
          accuracy: posData.accuracy || null,
          last_heard: new Date().toISOString()
        },
        { onConflict: 'node_id' }
      );

    if (error) throw error;
    console.log(`[Meshtastic] Position updated: !${nodeId}`);
  } catch (e) {
    console.error('[Meshtastic] Upsert position error:', e.message);
  }
}

async function upsertNodeInfo(nodeId, userInfo) {
  if (!supabase) {
    console.log('[Meshtastic] Supabase not configured - skipping info upsert');
    return;
  }

  try {
    const { error } = await supabase
      .from('mesh_nodes')
      .upsert(
        {
          node_id: `!${nodeId}`,
          long_name: userInfo.longName || null,
          short_name: userInfo.shortName || null,
          hw_model: userInfo.hwModel || null,
          last_heard: new Date().toISOString()
        },
        { onConflict: 'node_id' }
      );

    if (error) throw error;
    console.log(`[Meshtastic] Info updated: !${nodeId} (${userInfo.longName || 'unknown'})`);
  } catch (e) {
    console.error('[Meshtastic] Upsert info error:', e.message);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[Meshtastic MQTT] Shutting down gracefully');
  mqttClient.end(() => {
    console.log('[Meshtastic MQTT] Disconnected');
    process.exit(0);
  });
});

console.log('[Meshtastic MQTT] Listener started - connecting to public server...');
