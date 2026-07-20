// Proxy for GNews API (gnews.io) — keeps API key server-side
// Env var: Gnews
// Topics: breaking-news, world, nation, business, technology, science, health
exports.handler = async (event) => {
  const apiKey = process.env.Gnews;
  if (!apiKey) return { statusCode: 503, body: JSON.stringify({ error: 'GNews key not configured' }) };

  const p = event.queryStringParameters || {};
  const q = (p.q || 'military conflict').slice(0, 100);
  const lang = (p.lang || 'en').slice(0, 5);
  const max = Math.min(parseInt(p.max, 10) || 10, 10); // free tier max = 10
  const topic = p.topic || null;

  // Use topic endpoint if provided, otherwise search
  const url = topic
    ? `https://gnews.io/api/v4/top-headlines?topic=${encodeURIComponent(topic)}&lang=${lang}&max=${max}&apikey=${apiKey}`
    : `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=${lang}&max=${max}&sortby=publishedAt&apikey=${apiKey}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
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
