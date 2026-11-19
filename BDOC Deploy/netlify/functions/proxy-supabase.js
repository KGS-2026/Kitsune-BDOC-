// Heartbeat sink: browsers POST their feed-health snapshot (js/data.js heartbeat()) and this
// writes it to Supabase `heartbeats` with the service role.
//
// p204 (item 1b chunk C): this used to forward the raw request body with the service role,
// so anyone could write any columns and any amount of JSON into the table, and a GET read the
// whole table back with the service role. Now:
//   - POST only (nothing reads heartbeats through the browser; GET answers 405);
//   - the row is rebuilt server-side from a strict shape, the timestamp is the server's,
//     and bodies over 16 KB are refused;
//   - only the `heartbeats` table, as before.
const { supabaseUrl } = require('./_supabase');

const MAX_BODY = 16 * 1024;
const MAX_FEEDS = 64;
const WORD = /^[a-z0-9_]{1,40}$/;
const CORS = { 'Access-Control-Allow-Origin': '*' };

const int = (v) => (Number.isFinite(+v) && +v >= 0 ? Math.min(Math.floor(+v), 1e9) : 0);
const word = (v, fallback) => (typeof v === 'string' && WORD.test(v) ? v : fallback);

// Exported for tests: the only shape that reaches the database.
function cleanHeartbeat(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const feeds = {};
  const src = raw.feeds && typeof raw.feeds === 'object' && !Array.isArray(raw.feeds) ? raw.feeds : {};
  for (const [k, f] of Object.entries(src).slice(0, MAX_FEEDS)) {
    if (!WORD.test(k) || !f || typeof f !== 'object') continue;
    feeds[k] = {
      status: word(f.status, 'unknown'),
      // epoch milliseconds (Date.now()), so a wider cap than the counters
      lastOk: f.lastOk !== null && Number.isFinite(+f.lastOk) && +f.lastOk >= 0 ? Math.min(Math.floor(+f.lastOk), 1e14) : null,
      errCount: int(f.errCount),
      dataCount: int(f.dataCount),
    };
  }
  const version = typeof raw.version === 'string' && /^[0-9A-Za-z.\-]{1,20}$/.test(raw.version) ? raw.version : null;
  return { feeds, system: word(raw.system, 'unknown'), version, timestamp: new Date().toISOString() };
}

async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST only' }) };
  const table = (event.queryStringParameters || {}).table;
  if (table !== 'heartbeats') return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Table not allowed' }) };

  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  // Heartbeat is non-critical: answer 204 rather than 500 so the browser console stays clean.
  if (!key) return { statusCode: 204, headers: CORS, body: '' };

  const body = event.body || '';
  if (body.length > MAX_BODY) return { statusCode: 413, headers: CORS, body: JSON.stringify({ error: 'too large' }) };
  let row;
  try { row = cleanHeartbeat(JSON.parse(body)); } catch { row = null; }
  if (!row) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad heartbeat' }) };

  try {
    const res = await fetch(`${supabaseUrl()}/rest/v1/heartbeats`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Supabase returned ${res.status}`);
    return { statusCode: 201, headers: CORS, body: '' };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
}

module.exports = { handler, cleanHeartbeat };
