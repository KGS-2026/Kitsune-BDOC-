// Proxy for GDELT Project geographic news feed
// Pass-through proxy — GDELT sometimes returns HTML errors instead of JSON for malformed queries.
// This proxy validates the response and forces application/json content-type.
// Phase 15 (2026-05-13)
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const query = params.query || 'conflict OR military OR disaster OR earthquake OR missile OR nuclear OR attack';
  // Whitelist known GDELT geo modes — rejects arbitrary string injection into the URL
  const GDELT_MODES = ['PointData', 'PointDataFull', 'TimelineVol', 'TimelineVolInfo'];
  const mode = GDELT_MODES.includes(params.mode) ? params.mode : 'PointData';
  // Timespan: accept only "<digits><unit>" format (e.g. 24h, 7d, 2w, 1m) — reject arbitrary text
  const timespan = /^\d+[hdwm]$/.test(params.timespan || '') ? params.timespan : '24h';
  // maxpoints: integer 1-250 — reduced default: 250→150→50 to shorten GDELT parse time
  const maxpoints = Math.min(Math.max(parseInt(params.maxpoints, 10) || 50, 1), 250);

  const url = `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(query)}&mode=${mode}&format=GeoJSON&timespan=${timespan}&maxpoints=${maxpoints}`;

  try {
    // 5 s timeout — client also aborts at 5 s; leave 4 s headroom before Netlify's 10 s hard kill
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`GDELT returned ${res.status}`);
    const text = await res.text();

    // Validate: GDELT sometimes returns HTML on no-results or quota errors
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (parseErr) {
      // Return empty FeatureCollection instead of HTML — caller can render gracefully
      payload = { type: 'FeatureCollection', features: [], _gdelt_warning: 'GDELT returned non-JSON response' };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(payload)
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message, source: 'GDELT Project' })
    };
  }
};
