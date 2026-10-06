// Global ADS-B snapshot — the whole planet in ONE request.
//
// p152: BDOC previously polled 12 fixed regional circles (CONUS r=250nm,
// EUCOM r=200nm, ...), which is why the globe showed isolated pockets of
// traffic over the US and Europe and nothing in between. FlightRadar24 looks
// "full" because it renders a global feed, not a handful of sample discs.
//
// OpenSky /states/all returns EVERY aircraft it can see worldwide in a single
// call: measured 12,428 aircraft / 1.6MB / 0.84s, 108 countries, all continents.
//
// Payload discipline matters here. The raw response is 1.6MB of 17-element
// arrays, most of which the globe never reads. We project to the 8 fields the
// renderer actually uses and round the floats, which cuts it by roughly 2/3
// before it crosses the wire to the browser.
//
// Rate limit: anonymous OpenSky is credit-based (observed x-rate-limit-remaining
// ~400). At the 20s client cadence that is comfortable, and the 15s CDN cache
// below means concurrent users share one upstream call rather than each
// spending a credit.

exports.handler = async () => {
  const UA = 'KitsuneBDOC/7.0 (+https://kgsbdoc.netlify.app)';

  try {
    const res = await fetch('https://opensky-network.org/api/states/all', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(20000)
    });

    if (!res.ok) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: `OpenSky returned ${res.status}` })
      };
    }

    const json = await res.json();
    const states = Array.isArray(json.states) ? json.states : [];

    // OpenSky state vector indices:
    //  0 icao24, 1 callsign, 2 origin_country, 5 lon, 6 lat,
    //  7 baro_altitude(m), 9 velocity(m/s), 10 true_track(deg),
    //  13 geo_altitude(m), 16 category
    const ac = [];
    for (const s of states) {
      const lon = s[5], lat = s[6];
      if (lon == null || lat == null) continue;          // no position = nothing to draw
      if (s[8] === true) continue;                        // on_ground: skip ground clutter

      const altM = s[13] != null ? s[13] : s[7];
      ac.push({
        hex:  s[0],
        flight: (s[1] || '').trim(),
        lat:  Math.round(lat * 10000) / 10000,
        lon:  Math.round(lon * 10000) / 10000,
        // metres -> feet, metres/sec -> knots (the rest of BDOC speaks ft/kt)
        alt:  altM != null ? Math.round(altM * 3.28084) : null,
        gs:   s[9] != null ? Math.round(s[9] * 1.94384) : null,
        trk:  s[10] != null ? Math.round(s[10]) : null,
        cc:   s[2] || null
      });
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Shared CDN cache: concurrent viewers cost ONE upstream credit, not N.
        'Cache-Control': 'public, max-age=15, s-maxage=15',
        'Access-Control-Allow-Origin': '*',
        'X-BDOC-Count': String(ac.length)
      },
      body: JSON.stringify({ ac, now: json.time || Math.floor(Date.now() / 1000), count: ac.length })
    };

  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.name === 'TimeoutError' ? 'OpenSky timeout' : e.message })
    };
  }
};
