// proxy-polymarket.js — Polymarket Gamma API (geopolitics markets)
// Free, no API key required. CORS-friendly from server side.
// Cache: 5 min | Phase 20a (2026-05-15)

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: '' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=300',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    // Fetch geopolitics events sorted by volume descending
    const url = 'https://gamma-api.polymarket.com/events' +
      '?tag_slug=geopolitics&limit=50&closed=false&order=volume&ascending=false';

    const res = await fetch(url, {
      signal:  AbortSignal.timeout(10000),
      headers: { 'Accept': 'application/json', 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
    });
    if (!res.ok) throw new Error(`Polymarket Gamma API HTTP ${res.status}`);
    const events = await res.json();

    if (!Array.isArray(events)) throw new Error('Unexpected Polymarket response shape');

    const markets = [];
    for (const ev of events) {
      if (!ev || !ev.markets || !ev.markets.length) continue;

      // Gamma API returns outcomes/outcomePrices as JSON-ENCODED STRINGS
      // (e.g. '["Yes","No"]'), not arrays — parse both shapes defensively.
      const asArr = (v) => {
        if (Array.isArray(v)) return v;
        if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
        return [];
      };

      // Parse up to 4 sub-markets per event
      const parsedMarkets = (ev.markets || []).slice(0, 4).map(m => {
        const outcomes      = asArr(m.outcomes);
        const outcomePrices = asArr(m.outcomePrices);
        return {
          question:      m.question || '',
          outcomes,
          // Prices come as strings like "0.73" → convert to 0-100 percentage
          probs: outcomePrices.map(p => Math.round(parseFloat(p) * 100)),
          volume: parseFloat(m.volume || 0)
        };
      }).filter(m => m.outcomes.length > 0);

      if (!parsedMarkets.length) continue;

      markets.push({
        id:        ev.id        || '',
        title:     ev.title     || ev.question || '',
        slug:      ev.slug      || '',
        volume:    parseFloat(ev.volume    || 0),
        liquidity: parseFloat(ev.liquidity || 0),
        endDate:   ev.endDate   || null,
        markets:   parsedMarkets,
        // Derived: leading YES probability of first sub-market
        leadProb: parsedMarkets[0]?.probs?.[0] ?? null
      });
    }

    // Sort by volume desc (already sorted by Gamma API, but enforce)
    markets.sort((a, b) => b.volume - a.volume);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        count:   markets.length,
        markets,
        updated: new Date().toISOString()
      })
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: e.message, source: 'Polymarket Gamma API' })
    };
  }
};
