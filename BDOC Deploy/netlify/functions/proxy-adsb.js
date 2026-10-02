// Proxy for ADS-B aircraft data.
//
// p151: was a bare fetch() to api.adsb.lol with NO User-Agent. Node's fetch
// sends no UA by default, and adsb.lol 403s unidentified clients from
// datacenter IPs — so this returned 502 "adsb.lol API returned 403" for every
// request while the same URL answered 200 from a normal machine. The globe
// showed 0 aircraft. Same failure class as the p146 OSM tile block: the
// upstream is fine, it just refuses anonymous callers.
//
// Two changes:
//   1. Send an identifying User-Agent (and Accept), per adsb.lol's usage policy.
//   2. Fail over to opendata.adsb.fi, which serves the identical v2 schema,
//      so a single upstream going down no longer blanks the aircraft layer.
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const { lat, lon, dist } = params;

  if (!lat || !lon || !dist) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing params: lat, lon, dist' }) };
  }
  // Validate numeric before interpolating into the URL path — prevents path traversal (e.g. ../../admin)
  if (!/^-?\d+(\.\d+)?$/.test(lat) || !/^-?\d+(\.\d+)?$/.test(lon) || !/^\d+(\.\d+)?$/.test(dist)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid params: lat/lon/dist must be numeric' }) };
  }

  const HEADERS = {
    // Identify ourselves. Anonymous datacenter traffic gets 403'd.
    'User-Agent': 'KitsuneBDOC/7.0 (+https://kgsbdoc.netlify.app; contact via site)',
    'Accept': 'application/json'
  };

  // Both expose the same v2 response shape. adsb.lol uses {ac:[...]},
  // adsb.fi uses {aircraft:[...]} — normalised below so the client sees one shape.
  const UPSTREAMS = [
    { name: 'adsb.lol', url: `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}` },
    { name: 'adsb.fi',  url: `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${dist}` }
  ];

  const errors = [];
  for (const up of UPSTREAMS) {
    try {
      const res = await fetch(up.url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
      if (!res.ok) { errors.push(`${up.name}:${res.status}`); continue; }

      const json = await res.json();
      // Normalise: always hand the client { ac: [...] }.
      const ac = json.ac || json.aircraft || [];
      if (!Array.isArray(ac)) { errors.push(`${up.name}:badshape`); continue; }

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Netlify-Vary': 'query',
          'Cache-Control': 'public, max-age=10',
          'Access-Control-Allow-Origin': '*',
          'X-BDOC-Upstream': up.name
        },
        body: JSON.stringify({ ac, now: json.now || Date.now(), resultCount: ac.length, source: up.name })
      };
    } catch (e) {
      errors.push(`${up.name}:${e.name === 'TimeoutError' ? 'timeout' : e.message}`);
    }
  }

  return {
    statusCode: 502,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'All ADS-B upstreams failed', detail: errors.join(', ') })
  };
};
