// Proxy for GDELT live conflict/news feed.
// 2026-06 FIX (Hermes): the old GDELT GEO 2.0 endpoint (/api/v2/geo/geo) now
// returns HTTP 404 for every query — it is effectively retired. That broke the
// GTA threat score (GDELT = up to 22 of 100 pts) and the OSINT news sidebar.
// This version calls the MAINTAINED GDELT DOC 2.0 API (/api/v2/doc/doc), which
// returns live geocoded-by-source articles, and converts them to the GeoJSON
// FeatureCollection shape the front-end already expects (features[].geometry +
// features[].properties.{name,html,url}). It NEVER throws a 5xx: on any failure
// it returns an empty FeatureCollection so callers degrade gracefully and the
// score simply omits the GDELT component instead of the whole function 502ing.

// Country centroid lookup (lon,lat) — covers the conflict-heavy source countries.
// Used to place each article on the globe by its sourcecountry.
const CENTROIDS = {
  'United States':[-98.6,39.8],'Russia':[105.3,61.5],'Ukraine':[31.2,48.4],
  'Israel':[34.8,31.0],'Palestinian Territory':[35.2,31.9],'Iran':[53.7,32.4],
  'Iraq':[43.7,33.2],'Syria':[38.0,35.0],'Lebanon':[35.9,33.9],'Yemen':[48.5,15.6],
  'Saudi Arabia':[45.1,23.9],'Turkey':[35.2,38.9],'China':[104.2,35.9],
  'Taiwan':[121.0,23.7],'North Korea':[127.5,40.3],'South Korea':[127.8,36.4],
  'Japan':[138.3,36.2],'India':[78.9,20.6],'Pakistan':[69.3,30.4],
  'Afghanistan':[67.7,33.9],'Sudan':[30.2,12.9],'South Sudan':[31.3,6.9],
  'Ethiopia':[39.8,9.1],'Somalia':[46.2,5.2],'Nigeria':[8.7,9.1],
  'Mali':[-3.5,17.6],'Niger':[8.1,17.6],'Libya':[17.2,26.3],'Egypt':[30.8,26.8],
  'United Kingdom':[-1.5,52.4],'France':[2.2,46.2],'Germany':[10.5,51.2],
  'Poland':[19.1,51.9],'Myanmar':[95.9,21.9],'Thailand':[101.0,15.9],
  'Cambodia':[104.9,12.6],'Vietnam':[108.3,14.1],'Philippines':[122.9,12.9],
  'Venezuela':[-66.6,6.4],'Colombia':[-74.3,4.6],'Mexico':[-102.6,23.6],
  'Democratic Republic of the Congo':[23.6,-2.9],'Congo':[15.8,-0.7]
};

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const query = params.query || 'war OR airstrike OR missile OR offensive OR military OR conflict OR attack';
  const maxrecords = Math.min(Math.max(parseInt(params.maxpoints || params.maxrecords, 10) || 75, 1), 250);
  const timespan = /^\d+[hdwm]$/.test(params.timespan || '') ? params.timespan : '24h';

  const empty = (warn) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ type: 'FeatureCollection', features: [], _gdelt_warning: warn || null })
  });

  // GDELT DOC 2.0 — the maintained endpoint. format=json, mode=artlist.
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=${maxrecords}&format=json&timespan=${timespan}&sort=datedesc`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { 'User-Agent': 'BDOC/1.0 (intelligence dashboard)' } });
    if (!res.ok) return empty(`GDELT DOC returned ${res.status}`); // 429 rate-limit etc → degrade, don't 502
    const text = await res.text();

    let data;
    try { data = JSON.parse(text); }
    catch { return empty('GDELT returned non-JSON'); }

    const articles = Array.isArray(data.articles) ? data.articles : [];
    const features = [];
    for (const a of articles) {
      const c = CENTROIDS[a.sourcecountry];
      if (!c) continue; // only plot articles we can geolocate; still real conflict signal
      // small deterministic jitter so many articles from one country don't stack on one pixel
      const j = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return ((h % 1000) / 1000 - 0.5) * 6; };
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c[0] + j(a.url || ''), c[1] + j(a.title || '')] },
        properties: {
          name: a.title || 'Untitled',
          html: `<b>${(a.title || '').replace(/</g, '&lt;')}</b><br>${a.domain || ''} · ${a.sourcecountry || ''}`,
          url: a.url || '',
          domain: a.domain || '',
          country: a.sourcecountry || '',
          seendate: a.seendate || ''
        }
      });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ type: 'FeatureCollection', features, _gdelt_count: articles.length })
    };
  } catch (e) {
    return empty(e.message); // timeout/network → graceful empty, never 502
  }
};
