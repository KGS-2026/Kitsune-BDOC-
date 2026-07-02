// Proxy for US Treasury Fiscal Data API
// Treasury enables CORS but some networks / corporate firewalls / regional ISPs block it.
// This proxy routes the same calls server-side. Phase 16b (2026-05-13)
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const endpoint = params.endpoint || 'debt_to_penny';

  // Whitelist endpoint slugs — prevents arbitrary URL injection.
  // NOTE (2026-07-02): Treasury mixes API versions per dataset — debt_to_penny is v2,
  // most others are v1. Hardcoding v1 for all returned 404 and killed the markets panel.
  const ENDPOINTS = {
    debt_to_penny:      'v2/accounting/od/debt_to_penny',
    avg_interest_rates: 'v2/accounting/od/avg_interest_rates',
    monthly_treasury:   'v1/accounting/mts/mts_table_5',
    income_outlays:     'v1/accounting/mts/mts_table_1',
    debt_to_gdp:        'v2/accounting/od/debt_to_penny', // dedicated debt_to_gdp dataset was retired; derive GDP ratio client-side
    exchange_rates:     'v1/accounting/od/rates_of_exchange'
  };
  const path = ENDPOINTS[endpoint];
  if (!path) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown endpoint: ' + endpoint + '. Allowed: ' + Object.keys(ENDPOINTS).join(',') }) };
  }

  // Pass through whitelisted query params (Treasury uses page[size]/page[number]/sort/fields/filter)
  const passThrough = ['sort', 'fields', 'filter', 'page[size]', 'page[number]', 'format'];
  const qs = new URLSearchParams();
  for (const k of passThrough) if (params[k] != null) qs.set(k, String(params[k]));
  if (!qs.has('page[size]')) qs.set('page[size]', '1');
  if (!qs.has('sort')) qs.set('sort', '-record_date');

  const url = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/${path}?${qs.toString()}`;

  try {
    // 7s — must complete before Netlify's 10s hard kill
    const res = await fetch(url, {
      signal: AbortSignal.timeout(7000),
      headers: { 'Accept': 'application/json', 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
    });
    if (!res.ok) throw new Error(`Treasury ${res.status}`);
    const data = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=900',
        'Access-Control-Allow-Origin': '*'
      },
      body: data
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message, source: 'US Treasury Fiscal Data API' })
    };
  }
};
