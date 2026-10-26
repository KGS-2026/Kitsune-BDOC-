// p159g — LIVE CAMERA INDEX (real video, not links to someone else's webpage)
//
// Sources (all public, keyless, verified 2026-10-26 from the droplet):
//   • Caltrans CCTV — 12 districts, ~2,100 in-service cameras. Most publish an HLS
//     stream (wzmedia.dot.ca.gov/.../playlist.m3u8, CORS *) the browser can play
//     with hls.js, plus a JPEG refreshed every ~5 s.
//   • NYC DOT — 978 cameras, JPEG refreshed every few seconds.
//
// Output: compact GeoJSON points {name, src, hls, img, ref}. The client plays HLS in
// a <video>, otherwise auto-refreshes the JPEG. Edge-cached 10 min: the INDEX moves
// slowly, the PICTURES are live.
const CALTRANS = [1,2,3,4,5,6,7,8,9,10,11,12];

exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=600, s-maxage=600',
    'Access-Control-Allow-Origin': '*'
  };
  const feats = [];
  const errs = [];
  const get = (u, ms) => fetch(u, { signal: AbortSignal.timeout(ms || 12000), headers: { 'User-Agent': 'KitsuneGlobal/BDOC', 'Accept': 'application/json' } });

  const jobs = CALTRANS.map(async d => {
    const dd = String(d).padStart(2, '0');
    try {
      const r = await get(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      for (const it of (j.data || [])) {
        const c = it.cctv; if (!c || c.inService !== 'true') continue;
        const lat = +c.location.latitude, lon = +c.location.longitude;
        if (!isFinite(lat) || !isFinite(lon)) continue;
        const hls = (c.imageData && c.imageData.streamingVideoURL) || '';
        const img = (c.imageData && c.imageData.static && c.imageData.static.currentImageURL) || '';
        if (!hls && !img) continue;
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: { name: (c.location.locationName || '').replace(/^TV\d+\s*--\s*/, ''), place: c.location.nearbyPlace || '', route: c.location.route || '',
            src: 'Caltrans D' + d, hls: /\.m3u8$/.test(hls) ? hls : '', img, every: +(c.imageData.static && c.imageData.static.currentImageUpdateFrequency) || 5 } });
      }
    } catch (e) { errs.push('caltrans-d' + d + ': ' + e.message); }
  });

  jobs.push((async () => {
    try {
      const r = await get('https://webcams.nyctmc.org/api/cameras');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      for (const c of j) {
        if (c.isOnline !== 'true') continue;
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [+c.longitude, +c.latitude] },
          properties: { name: c.name, place: c.area || 'NYC', route: '', src: 'NYC DOT', hls: '', img: c.imageUrl, every: 4 } });
      }
    } catch (e) { errs.push('nycdot: ' + e.message); }
  })());

  await Promise.all(jobs);
  // Compact: gzip on the edge handles repetition, but 4.4k points × long names ≈ 1.5 MB raw.
  // Keep names short (≤60 chars) and never ship the img URL when HLS exists (client derives nothing; keep both only when both exist and differ in host).
  for (const f of feats) { const q = f.properties; q.name = q.name.slice(0, 60); f.geometry.coordinates = f.geometry.coordinates.map(v => Math.round(v * 1e5) / 1e5); }
  if (!feats.length) return { statusCode: 502, headers: { ...headers, 'Cache-Control': 'no-store' }, body: JSON.stringify({ type: 'FeatureCollection', features: [], _errors: errs }) };
  return { statusCode: 200, headers, body: JSON.stringify({ type: 'FeatureCollection', features: feats, _count: feats.length, _video: feats.filter(f => f.properties.hls).length, _errors: errs, _generated: new Date().toISOString() }) };
};
