// Proxy for GDACS (Global Disaster Alert and Coordination System)
// GDACS API has no CORS headers, so browser fetches fail. This routes through Netlify.
// Used by: Floods (FL), Tsunamis (TS), Volcanoes (VO), Earthquakes (EQ), Cyclones (TC), Drought (DR)
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const eventtype = params.eventtype || 'EQ';
  const alertlevel = params.alertlevel || 'Green;Orange;Red';
  const fromDate = params.fromDate || '';
  const toDate = params.toDate || '';

  // Whitelist event types — prevent arbitrary URL construction
  const VALID = ['EQ','FL','TS','VO','TC','DR','WF'];
  if (!VALID.includes(eventtype)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid eventtype' }) };
  }

  let url = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=${eventtype}&alertlevel=${encodeURIComponent(alertlevel)}`;
  if (fromDate) url += `&fromDate=${encodeURIComponent(fromDate)}`;
  if (toDate) url += `&toDate=${encodeURIComponent(toDate)}`;

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=900', // 15 min — GDACS data is slow-moving
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'Accept': 'application/json', 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
    });
    if (!res.ok) throw new Error(`GDACS ${res.status}`);
    const data = await res.text();
    return { statusCode: 200, headers, body: data };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: e.message, source: 'GDACS', upstream: url })
    };
  }
};
