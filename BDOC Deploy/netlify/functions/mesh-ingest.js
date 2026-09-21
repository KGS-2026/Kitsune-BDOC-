// Ingest Meshtastic mesh events (positions, messages, telemetry)
// Called by meshtastic_receptor.py via HTTP or stored in real-time DB
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { 
      statusCode: 204, 
      headers: { 
        'Access-Control-Allow-Origin': '*', 
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type'
      } 
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { source, type, timestamp, data } = body;

    if (source !== 'meshtastic') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid source' }) };
    }

    // Route by event type
    switch (type) {
      case 'position':
        return await ingestPosition(data, timestamp);
      case 'text_message':
        return await ingestMessage(data, timestamp);
      case 'telemetry':
        return await ingestTelemetry(data, timestamp);
      case 'node_info':
        return await ingestNodeInfo(data, timestamp);
      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown event type: ${type}` }) };
    }
  } catch (e) {
    console.error('[mesh-ingest] Error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

async function ingestPosition(data, timestamp) {
  try {
    const { sender, latitude, longitude, altitude, rssi } = data;
    
    // Upsert into mesh_nodes table (latest position)
    const { error: posError } = await supabase
      .from('mesh_nodes')
      .upsert(
        {
          node_id: sender,
          latitude,
          longitude,
          altitude: altitude || 0,
          rssi: rssi || 0,
          last_heard: timestamp
        },
        { onConflict: 'node_id' }
      );

    if (posError) throw posError;

    // Insert into mesh_trail for history
    await supabase
      .from('mesh_trail')
      .insert({
        node_id: sender,
        latitude,
        longitude,
        altitude: altitude || 0,
        rssi: rssi || 0,
        recorded_at: timestamp
      });

    return { statusCode: 200, body: JSON.stringify({ ok: true, event: 'position' }) };
  } catch (e) {
    console.error('[mesh-ingest] Position error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
}

async function ingestMessage(data, timestamp) {
  try {
    const { sender, to, text, hop_limit, rssi, snr } = data;

    await supabase
      .from('mesh_messages')
      .insert({
        sender,
        recipient: to,
        text,
        hop_limit: hop_limit || 0,
        rssi: rssi || 0,
        snr: snr || 0,
        received_at: timestamp
      });

    return { statusCode: 200, body: JSON.stringify({ ok: true, event: 'text_message' }) };
  } catch (e) {
    console.error('[mesh-ingest] Message error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
}

async function ingestTelemetry(data, timestamp) {
  try {
    const { sender, battery_level, voltage, channel_utilization, air_util_tx } = data;

    await supabase
      .from('mesh_telemetry')
      .insert({
        node_id: sender,
        battery_level: battery_level || 0,
        voltage: voltage || 0,
        channel_utilization: channel_utilization || 0,
        air_util_tx: air_util_tx || 0,
        recorded_at: timestamp
      });

    return { statusCode: 200, body: JSON.stringify({ ok: true, event: 'telemetry' }) };
  } catch (e) {
    console.error('[mesh-ingest] Telemetry error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
}

async function ingestNodeInfo(data, timestamp) {
  try {
    const { sender, node_id, long_name, short_name, hw_model, latitude, longitude, battery_level } = data;

    // Upsert node metadata
    const { error } = await supabase
      .from('mesh_nodes')
      .upsert(
        {
          node_id: sender,
          long_name,
          short_name,
          hw_model,
          latitude: latitude || null,
          longitude: longitude || null,
          battery_level: battery_level || 0,
          last_heard: timestamp
        },
        { onConflict: 'node_id' }
      );

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ ok: true, event: 'node_info' }) };
  } catch (e) {
    console.error('[mesh-ingest] Node info error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
}
