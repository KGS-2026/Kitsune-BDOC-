// Proxy for PowerOutage.us API
// Tier 1: county-level (requires API key)
// Tier 2: state-level (public, no key) — synthesized into pseudo-county markers
// Tier 3: error response with diagnostic so client can show fallback UI
exports.handler = async (event) => {
  // Phase 22: removed hardcoded fallback key — was exposed in source/version control.
  // Set POWEROUTAGE_KEY in Netlify env vars. If missing, function skips Tier 1 gracefully.
  const key = process.env.POWEROUTAGE_KEY;
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
    'Access-Control-Allow-Origin': '*'
  };

  // Tier 1: keyed county-level endpoint (4s budget — must leave room for Tier 2 + Netlify 10s limit)
  // Guard: skip entirely if key is missing — avoids wasting 4s on a guaranteed 401/403 response
  if (key) try {
    const url = `https://poweroutage.us/api/web/counties?key=${key}&countryid=us`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.text();
      // Validate it's a non-empty array
      try {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return { statusCode: 200, headers, body: data };
        }
      } catch (_) {}
    }
    console.warn(`[proxy-outages] Tier 1 (county) returned ${res.status} — falling back to state-level`);
  } catch (e) {
    console.warn(`[proxy-outages] Tier 1 (county) failed:`, e.message);
  }

  // Tier 2: public state-level summary (no key required)
  // poweroutage.us exposes /api/web/stats/StateGeoCount?countryid=us as public
  try {
    const stateUrl = 'https://poweroutage.us/api/web/stats/StateGeoCount?countryid=us';
    const res = await fetch(stateUrl, { signal: AbortSignal.timeout(4500) }); // 4.5s — total budget ~9s
    if (res.ok) {
      const stateData = await res.json();
      // State centroids for synthesizing county-like markers
      const STATE_CENTROIDS = {
        AL:[32.806,-86.791],AK:[61.370,-152.404],AZ:[33.729,-111.431],AR:[34.969,-92.373],CA:[36.116,-119.681],
        CO:[39.059,-105.311],CT:[41.597,-72.755],DE:[39.318,-75.507],FL:[27.766,-81.687],GA:[33.040,-83.643],
        HI:[21.094,-157.498],ID:[44.240,-114.479],IL:[40.349,-88.986],IN:[39.849,-86.258],IA:[42.011,-93.210],
        KS:[38.526,-96.726],KY:[37.668,-84.670],LA:[31.169,-91.867],ME:[44.693,-69.382],MD:[39.063,-76.802],
        MA:[42.230,-71.530],MI:[43.326,-84.536],MN:[45.694,-93.900],MS:[32.741,-89.678],MO:[38.456,-92.288],
        MT:[46.921,-110.454],NE:[41.125,-98.268],NV:[38.314,-117.055],NH:[43.452,-71.564],NJ:[40.298,-74.521],
        NM:[34.840,-106.248],NY:[42.165,-74.948],NC:[35.630,-79.806],ND:[47.529,-99.784],OH:[40.388,-82.764],
        OK:[35.565,-96.928],OR:[44.572,-122.071],PA:[40.590,-77.209],RI:[41.680,-71.511],SC:[33.856,-80.945],
        SD:[44.299,-99.438],TN:[35.747,-86.692],TX:[31.054,-97.563],UT:[40.150,-111.862],VT:[44.045,-72.710],
        VA:[37.769,-78.169],WA:[47.400,-121.490],WV:[38.491,-80.954],WI:[44.268,-89.616],WY:[42.756,-107.302],
        DC:[38.898,-77.026],PR:[18.220,-66.590]
      };
      // Full state name → abbreviation map for when API returns only StateName
      const NAME_TO_ABBR = {
        'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO',
        'Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID',
        'Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA',
        'Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS',
        'Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ',
        'New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
        'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',
        'Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA',
        'West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY','District of Columbia':'DC','Puerto Rico':'PR'
      };
      const counties = (Array.isArray(stateData) ? stateData : [])
        .filter(s => s && (s.StateName || s.StateAbbreviation) && (s.CustomersTracked > 0))
        .map(s => {
          // Resolve abbreviation: prefer StateAbbreviation, then map StateName, then guess
          let abbr = s.StateAbbreviation;
          if (!abbr && s.StateName) abbr = NAME_TO_ABBR[s.StateName] || s.StateName;
          const c = STATE_CENTROIDS[abbr] || null;
          if (!c) return null; // skip rather than clumping at US center
          return {
            CountyName: s.StateName || abbr,
            StateName: s.StateName || abbr,
            Latitude: c[0],
            Longitude: c[1],
            OutageCount: s.CustomersOut || 0,
            CustomerCount: s.CustomersTracked || 1,
            _stateLevel: true
          };
        })
        .filter(c => c && c.OutageCount > 0);
      return {
        statusCode: 200,
        headers: { ...headers, 'X-Source-Tier': 'state-fallback' },
        body: JSON.stringify(counties)
      };
    }
  } catch (e) {
    console.warn(`[proxy-outages] Tier 2 (state) failed:`, e.message);
  }

  // Tier 3: all upstreams unavailable. Return an empty-but-valid 200 payload
  // (NOT 502) so the client renders "no outage data" cleanly instead of a
  // console error / broken layer. Matches the graceful-degrade contract used
  // by proxy-gdelt. Diagnostic header preserved for debugging.
  // BLOCKER (2026-06-26): poweroutage.us migrated to poweroutage.com and the
  // /api/web/stats/StateGeoCount path now 404s; Tier 1 county endpoint needs a
  // paid POWEROUTAGE_KEY. Real outage data requires a new upstream or a key.
  return {
    statusCode: 200,
    headers: { ...headers, 'X-Source-Tier': 'unavailable' },
    body: JSON.stringify([])
  };
};
