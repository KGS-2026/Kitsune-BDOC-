// Proxy for Perenual species API — keeps key server-side.
// Accepts: q (search term), hardiness (zone number), per_page (cap 30).
exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  const apiKey = process.env.PERENUAL_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'PERENUAL_API_KEY not configured' }) };
  }
  const params = new URLSearchParams({ key: apiKey });
  if (p.q) params.set('q', String(p.q).slice(0, 80));
  if (p.hardiness) {
    const h = parseInt(p.hardiness, 10);
    if (h >= 1 && h <= 13) params.set('hardiness', String(h));
  }
  const perPage = Math.min(parseInt(p.per_page, 10) || 10, 30);
  params.set('per_page', String(perPage));
  const url = `https://perenual.com/api/species-list?${params.toString()}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const body = await res.text();
    return {
      statusCode: res.ok ? 200 : res.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
      },
      body
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
