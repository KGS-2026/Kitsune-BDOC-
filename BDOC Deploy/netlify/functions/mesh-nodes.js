// netlify/functions/mesh-nodes.js
// REST endpoint: GET /mesh-nodes
// Returns all active mesh nodes with positions

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          error: 'Supabase not configured',
          status: 'mesh nodes unavailable'
        })
      };
    }

    // Query nodes active in the last 8 hours
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('mesh_nodes')
      .select('*')
      .gte('last_heard', eightHoursAgo)
      .order('last_heard', { ascending: false });

    if (error) throw error;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        count: data?.length || 0,
        nodes: data || [],
        timestamp: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('[mesh-nodes] Error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: err.message,
        status: 'error'
      })
    };
  }
};
