// netlify/functions/mesh-nodes.js
// GET /.netlify/functions/mesh-nodes -> active mesh nodes (last 8h)
//
// Uses PostgREST over plain fetch instead of @supabase/supabase-js on purpose:
// the site pins NODE_VERSION=18, and supabase-js v2 requires a native WebSocket
// (Node 20+) at import time, which made this function 500 with
// "Node.js detected but native WebSocket not found". We only need a REST read.

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

const COLUMNS = [
  'node_id', 'long_name', 'short_name', 'hw_model',
  'latitude', 'longitude', 'altitude',
  'battery_level', 'rssi', 'snr', 'last_heard'
].join(',');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ status: 'error', error: 'Method not allowed' }) };
  }

  // SUPABASE_URL is not reliably set on this Netlify site; resolve via the shared
  // helper's project-URL fallback (P136) so a missing env var doesn't blank the layer.
  const url = require('./_supabase').supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ status: 'offline', error: 'Supabase not configured', nodes: [], count: 0 })
    };
  }

  const since = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const query =
    `${url.replace(/\/$/, '')}/rest/v1/mesh_nodes` +
    `?select=${encodeURIComponent(COLUMNS)}` +
    `&latitude=not.is.null` +
    `&last_heard=gte.${encodeURIComponent(since)}` +
    `&order=last_heard.desc` +
    `&limit=5000`;

  try {
    const res = await fetch(query, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
    });

    const text = await res.text();

    if (!res.ok) {
      // PGRST205 = table missing. Report it as "not provisioned" rather than a
      // generic 500, so the globe can stay quiet instead of erroring every 30s.
      let code = null;
      try { code = JSON.parse(text).code; } catch (e) { /* non-JSON error body */ }
      if (res.status === 404 || code === 'PGRST205') {
        return {
          statusCode: 503,
          headers,
          body: JSON.stringify({
            status: 'not_provisioned',
            error: 'mesh_nodes table does not exist — run docs/mesh-setup.sql',
            nodes: [], count: 0
          })
        };
      }
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ status: 'error', error: `supabase ${res.status}`, detail: text.slice(0, 200), nodes: [], count: 0 })
      };
    }

    const data = JSON.parse(text);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        count: Array.isArray(data) ? data.length : 0,
        nodes: Array.isArray(data) ? data : [],
        timestamp: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('[mesh-nodes]', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ status: 'error', error: err.message, nodes: [], count: 0 })
    };
  }
};
