// Proxy for newsdata.io — keeps API key server-side
// Env var: newsdata_io
// Docs: https://newsdata.io/documentation
exports.handler = async (event) => {
  const apiKey = process.env.newsdata_io;
  if (!apiKey) return { statusCode: 503, body: JSON.stringify({ error: 'newsdata.io key not configured' }) };

  const p = event.queryStringParameters || {};
  const q = (p.q || 'conflict military').slice(0, 100);
  const language = (p.language || 'en').slice(0, 10);
  const category = (p.category || 'politics,world').slice(0, 50);
  const country = p.country ? p.country.slice(0, 20) : null;

  const params = new URLSearchParams({ apikey: apiKey, q, language, category });
  if (country) params.set('country', country);

  const url = `https://newsdata.io/api/1/news?${params}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const body = await res.text();
    return {
      statusCode: res.ok ? 200 : res.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      },
      body
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
