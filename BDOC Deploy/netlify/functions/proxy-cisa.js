// Proxy for CISA Known Exploited Vulnerabilities (KEV) Catalog
// Real-time cyber threat intelligence — CVEs actively exploited in the wild.
// No API key required. Government CDN may not set CORS headers.
// Phase 19b (2026-05-15)
exports.handler = async (event) => {
  const url = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600', // 1 hour — CISA updates catalog daily
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'Accept': 'application/json', 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
    });
    if (!res.ok) throw new Error(`CISA ${res.status}`);
    const data = await res.text();
    try { JSON.parse(data); } catch (_) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Non-JSON from CISA' }) };
    }
    return { statusCode: 200, headers, body: data };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: e.message, source: 'CISA-KEV', upstream: url })
    };
  }
};
