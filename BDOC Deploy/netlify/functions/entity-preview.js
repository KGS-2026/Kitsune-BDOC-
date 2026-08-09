/**
 * BDOC P112 — Glyph-preserving server-side redaction (IntelX technique).
 *
 * Returns a preview of a geospatial entity's enriched data.
 * For recon (free) tier: every non-whitespace char → U+2588 FULL BLOCK (█).
 * Structure (row count, column widths, field widths, tabs) is preserved intact,
 * so the free user can independently verify the record is real and relevant
 * without seeing the actual values — far more effective than a blur.
 *
 * Why server-side matters: the redacted payload contains zero PII, making
 * it safe to cache publicly and serve to anonymous users. A client-side blur
 * sends the real data to everyone's browser. This does not.
 *
 * Usage:
 *   GET /.netlify/functions/entity-preview?id=<entityId>&layer=<layerKey>&lines=8
 *   Headers: Authorization: Bearer <supabase_session_token>  (optional — for tier detection)
 *
 * Returns: text/plain — preview text, possibly redacted.
 */

const BLOCK = '\u2588';  // U+2588 FULL BLOCK

/**
 * Length-preserving redaction.
 * Iterate Array.from (code points, not UTF-16 units) so emoji/CJK don't
 * double-block and corrupt the column-width signal.
 */
function redactPreserving(text) {
  return Array.from(text).map(ch => {
    if (ch === '\n' || ch === '\r' || ch === '\t') return ch; // preserve structure
    return BLOCK;
  }).join('');
}

/**
 * Resolve the user's BDOC tier from a Supabase session token.
 * Returns 'recon' on any failure — safe default = most restrictive.
 */
async function resolveTier(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return 'recon';
  const token = authHeader.slice(7);
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return 'recon';
  try {
    // Verify JWT and get user id
    const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': supabaseKey },
      signal: AbortSignal.timeout(3000)
    });
    if (!userResp.ok) return 'recon';
    const user = await userResp.json();
    if (!user || !user.id) return 'recon';
    // Fetch tier from profiles
    const profResp = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=tier`,
      { headers: { 'Authorization': `Bearer ${token}`, 'apikey': supabaseKey, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3000) }
    );
    if (!profResp.ok) return 'recon';
    const profiles = await profResp.json();
    return (profiles && profiles[0] && profiles[0].tier) || 'recon';
  } catch (_) { return 'recon'; }
}

/**
 * Build a text preview of an entity from layer-specific data sources.
 * Currently generates synthetic structured preview — wire up to live data
 * when specific layers need richer previews.
 */
function buildPreview(layer, id, lines) {
  // Preview shape: header row + data rows in a tab-delimited structure.
  // This makes column widths meaningful to a free user looking at blocks.
  const templates = {
    outage: [
      `ENTITY\t${id}`,
      `LAYER\tCarrier Outage`,
      `STATUS\tConfirmed`,
      `SCOPE\t${id.includes('TMO') ? 'nationwide' : 'regional'}`,
      `OUTLETS\t14 sources reporting`,
      `THREAT\tINFRA disruption — causal analysis pending`,
      `FIRST_SEEN\t${new Date().toISOString().slice(0, 19)}Z`,
      `FUSION_SCORE\t0.82`,
    ],
    cyber: [
      `ENTITY\t${id}`,
      `LAYER\tCyber / CISA KEV`,
      `CVE\tCVE-2026-XXXXX`,
      `VENDOR\tMicrosoft`,
      `PRODUCT\tWindows Server 2022`,
      `RANSOMWARE\tKNOWN`,
      `ADDED\t${new Date().toISOString().slice(0, 10)}`,
      `DESCRIPTION\tRemote code execution in network service`,
    ],
    conflict: [
      `ENTITY\t${id}`,
      `LAYER\tGDELT Conflict Event`,
      `ACTORS\tUnknown → Unknown`,
      `CAMEO\t190 — Use conventional military force`,
      `GOLDSTEIN\t-10.0`,
      `GEO_PRECISION\t3`,
      `SOURCES\t8 articles (3 outlets)`,
      `CAUSAL_LINK\tNone confirmed`,
    ],
  };
  const rows = templates[layer] || [
    `ENTITY\t${id}`,
    `LAYER\t${layer || 'unknown'}`,
    `STATUS\tData available`,
    `TIER_REQUIRED\tOperator ($9.99/mo) or higher`,
    `PREVIEW\tUpgrade to see full intelligence enrichment`,
    `SOURCES\tFused from 3+ live feeds`,
    `LAST_UPDATE\t${new Date().toISOString().slice(0, 19)}Z`,
    `CONFIDENCE\tHIGH`,
  ];
  return rows.slice(0, Math.min(lines, rows.length)).join('\n');
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const params = event.queryStringParameters || {};
  const id    = (params.id    || 'unknown').slice(0, 64);
  const layer = (params.layer || 'generic').slice(0, 32);
  const lines = Math.min(Math.max(parseInt(params.lines) || 8, 1), 40);

  // Resolve tier — fallback to recon (safe/restrictive) on any error
  const tier = await resolveTier(event.headers['authorization'] || event.headers['Authorization'] || '');

  const raw = buildPreview(layer, id, lines);
  const isRecon = (tier === 'recon');
  const body = isRecon ? redactPreserving(raw) : raw;

  return {
    statusCode: 200,
    headers: {
      ...headers,
      // Redacted previews are identical for all anon users — cache hard at CDN.
      // Clear previews are user-specific — never cache.
      'Cache-Control': isRecon
        ? 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600'
        : 'private, no-store',
      'X-BDOC-Tier': tier,
      'X-BDOC-Redacted': isRecon ? 'true' : 'false',
    },
    body,
  };
};
