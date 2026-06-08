// Proxy for Supabase REST API
// Injects service role key for heartbeat writes
// Also handles arbitrary table operations for server-side use
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const table = params.table;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Return 204 (no-op) rather than 500 — heartbeat is non-critical, avoids red error in console
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  }

  // Whitelist: only allow tables this proxy is legitimately used for.
  // The sole caller is data.js (heartbeat POST). Using SUPABASE_SERVICE_KEY bypasses RLS,
  // so accepting arbitrary tables would expose all user data to unauthenticated GET requests.
  const ALLOWED_TABLES = ['heartbeats'];
  if (!table || !ALLOWED_TABLES.includes(table)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Table not allowed' }) };
  }

  const url = `${supabaseUrl}/rest/v1/${table}`;
  const method = event.httpMethod === 'POST' ? 'POST' : 'GET';

  try {
    const fetchOpts = {
      method,
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      signal: AbortSignal.timeout(10000)
    };

    if (method === 'POST' && event.body) {
      fetchOpts.body = event.body;
    }

    const res = await fetch(url, fetchOpts);
    if (!res.ok && res.status !== 201) throw new Error(`Supabase returned ${res.status}`);

    const data = method === 'GET' ? await res.text() : '';
    return {
      statusCode: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: data || '{}'
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
