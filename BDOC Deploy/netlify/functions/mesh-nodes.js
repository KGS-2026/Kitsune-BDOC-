// netlify/functions/mesh-nodes.js
// GET /.netlify/functions/mesh-nodes -> active mesh nodes (last 8h)
// FIX: createClient() at module scope throws when env vars are missing, which makes the
//      whole function 502 instead of returning the intended 503. Create it lazily.

const { createClient } = require('@supabase/supabase-js');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ status: 'error', error: 'Method not allowed' }) };
  }

  // P136: SUPABASE_URL is not set on this Netlify site; resolve via the shared
  // helper's project-URL fallback so a missing env var doesn't blank the layer.
  const url = require('./_supabase').supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return { statusCode: 503, headers, body: JSON.stringify({ status: 'offline', error: 'Supabase not configured', nodes: [], count: 0 }) };
  }

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const since = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('mesh_nodes')
      .select('node_id,long_name,short_name,hw_model,latitude,longitude,altitude,battery_level,rssi,snr,last_heard')
      .not('latitude', 'is', null)
      .gte('last_heard', since)
      .order('last_heard', { ascending: false })
      .limit(5000);

    if (error) throw error;
    return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok', count: data ? data.length : 0, nodes: data || [], timestamp: new Date().toISOString() }) };
  } catch (err) {
    console.error('[mesh-nodes]', err);
    return { statusCode: 500, headers, body: JSON.stringify({ status: 'error', error: err.message, nodes: [], count: 0 }) };
  }
};
