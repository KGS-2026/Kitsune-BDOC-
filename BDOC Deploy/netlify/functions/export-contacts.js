// Operator-only contact export — Phase 32 (2026-06-02)
// Returns a CSV (or JSON) of users who EXPLICITLY opted into marketing.
//
// Security:
//   - Requires ?key=<ADMIN_EXPORT_KEY> matching a server-only env var.
//     This is NOT the client dev key (that one is public in auth.js).
//   - Uses SUPABASE_SERVICE_KEY (service role) to read across all profiles.
//   - ONLY returns rows where marketing_consent = true. Never exports
//     users who didn't opt in — that's the CAN-SPAM/TCPA firewall.
//
// Usage:
//   https://kgsbdoc.netlify.app/.netlify/functions/export-contacts?key=YOUR_ADMIN_KEY
//   add &format=json for JSON instead of CSV
//
// Required Netlify env vars:
//   SUPABASE_URL            (or falls back to project URL below)
//   SUPABASE_SERVICE_KEY    (Supabase > Project Settings > API > service_role)
//   ADMIN_EXPORT_KEY        (any long random string you choose)

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const adminKey = process.env.ADMIN_EXPORT_KEY;

  // Gate 1: admin key must be configured AND match
  if (!adminKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Export disabled — ADMIN_EXPORT_KEY not set in Netlify.' }) };
  }
  if ((params.key || '') !== adminKey) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden — invalid or missing admin key.' }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ulgxbqhbgbyxlzoyxcus.supabase.co';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SERVICE_KEY) {
    return { statusCode: 503, body: JSON.stringify({ error: 'SUPABASE_SERVICE_KEY not set in Netlify env.' }) };
  }

  // PostgREST query — consented users only
  const cols = 'email,phone,display_name,marketing_consent_at,consent_version,tier,created_at';
  const url = `${SUPABASE_URL}/rest/v1/profiles?marketing_consent=eq.true&select=${cols}&order=created_at.desc`;

  try {
    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      const txt = await res.text();
      return { statusCode: 502, body: JSON.stringify({ error: `Supabase ${res.status}`, detail: txt.slice(0, 300) }) };
    }
    const rows = await res.json();

    if (params.format === 'json') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ count: rows.length, contacts: rows })
      };
    }

    // CSV — escape quotes/commas/newlines per RFC 4180
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = ['email', 'phone', 'display_name', 'consent_at', 'consent_version', 'tier', 'created_at'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        esc(r.email), esc(r.phone), esc(r.display_name),
        esc(r.marketing_consent_at), esc(r.consent_version), esc(r.tier), esc(r.created_at)
      ].join(','));
    }
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="bdoc-consented-contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store'
      },
      body: lines.join('\n')
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
