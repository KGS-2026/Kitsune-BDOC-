// Proxy for NewsAPI — keeps the API key server-side and bypasses CORS.
// NewsAPI's free "developer" plan blocks browser-origin requests, so all
// client calls must go through this function.
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const q = (params.q || 'military').slice(0, 80);
  const pageSize = Math.min(parseInt(params.pageSize, 10) || 50, 100);
  const language = (params.language || 'en').slice(0, 5);
  const sortBy = ['publishedAt', 'relevancy', 'popularity'].includes(params.sortBy) ? params.sortBy : 'publishedAt';

  // Phase 15b (2026-05-13): hardcoded fallback authorized by operator. Netlify env NEWSAPI_KEY overrides if set.
  // Rotate at newsapi.org/account if you want to invalidate the chat-exposed version.
  const apiKey = process.env.NEWSAPI_KEY || '47636335de79468886e1f93910ffd046';
  // Note: !apiKey guard removed — hardcoded fallback makes it unreachable dead code

  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&sortBy=${sortBy}&pageSize=${pageSize}&language=${encodeURIComponent(language)}`;

  try {
    const res = await fetch(url, {
      headers: {
        'X-Api-Key': apiKey,
        'User-Agent': 'KITSUNE-BDOC/8.0 (kgsbdoc.netlify.app)'
      },
      signal: AbortSignal.timeout(15000)
    });
    const body = await res.text();
    return {
      statusCode: res.ok ? 200 : res.status,
      headers: {
        'Content-Type': 'application/json',
        'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      },
      body
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
