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
    'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=900', // 15 min — GDACS data is slow-moving
    'Access-Control-Allow-Origin': '*'
  };

  try {
    // p81: GDACS intermittently throws transient 500s (confirmed 2026-07-20: 500 then
    // 200 seconds apart, same URL) — retry once after a short pause before failing.
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        headers: { 'Accept': 'application/json', 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
      });
      if (res.ok) break;
      if (attempt === 0) await new Promise(r => setTimeout(r, 1200));
    }
    if (!res.ok) throw new Error(`GDACS ${res.status}`);
    let data = await res.text();
    // p82: GDACS upstream now IGNORES the eventtype param — returns a mixed bag of
    // FL/EQ/TC/DR regardless of what you ask for (confirmed 2026-07-20: eventtype=TS
    // returned 171 features, 0 of them TS). Filter server-side so each layer only
    // gets its own event type; without this, floods/tsunamis/volcanoes render each
    // other's (mislabeled) events.
    try {
      const geo = JSON.parse(data);
      if (geo && Array.isArray(geo.features)) {
        geo.features = geo.features.filter(f => (f.properties?.eventtype || '') === eventtype);
        data = JSON.stringify(geo);
      }
    } catch (_) { /* non-JSON payload — pass through untouched */ }
    return { statusCode: 200, headers, body: data };
  } catch (e) {
    return {
      statusCode: 502,
      // p81: failures must NOT inherit the 15-min success cache — the CDN was pinning
      // transient GDACS 500s into 15-minute layer outages (same class as p78b GDELT fix).
      headers: { ...headers, 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: e.message, source: 'GDACS', upstream: url })
    };
  }
};
