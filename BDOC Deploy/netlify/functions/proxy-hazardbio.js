// proxy-hazardbio.js — Biological Hazard Layer (Phase 2, 2026-07-02)
// Proxies iNaturalist research-grade observations for a curated set of
// medically-significant species groups (ticks, venomous snakes/spiders/insects).
// Viewport-driven: caller passes camera bounds. iNaturalist API is free/keyless;
// cache aggressively to be a good citizen.
//
// Category → iNaturalist taxon IDs (curated):
//   ticks    47577   Ixodida (all ticks: deer/dog/lone-star)
//   vsnakes  30764   Viperidae (rattlesnakes, copperheads, cottonmouths)
//            8672    Elapidae (coral snakes)
//   vspiders 48000   Latrodectus (widow spiders)
//            123784  Loxosceles (recluse spiders)
//   vinsects 47651   Vespidae (hornets/wasps incl. yellowjackets)
//            199439  Solenopsis invicta (fire ants)
//   scorp    48498   Scorpiones (scorpions)
const CATEGORIES = {
  ticks:    { taxa: [47577],         label: 'Ticks' },
  vsnakes:  { taxa: [30764, 8672],   label: 'Venomous Snakes' },
  vspiders: { taxa: [48000, 123784], label: 'Venomous Spiders' },
  vinsects: { taxa: [47651, 199439], label: 'Stinging Insects' },
  scorp:    { taxa: [48498],         label: 'Scorpions' }
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: '' };
  }
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=1800', // 30 min — species observations move slowly
    'Access-Control-Allow-Origin': '*'
  };
  const p = event.queryStringParameters || {};
  const cat = CATEGORIES[p.category || 'ticks'];
  if (!cat) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown category. Allowed: ' + Object.keys(CATEGORIES).join(', ') }) };
  }
  // Bounds — numeric, clamped
  const nelat = parseFloat(p.nelat), nelng = parseFloat(p.nelng), swlat = parseFloat(p.swlat), swlng = parseFloat(p.swlng);
  if (![nelat, nelng, swlat, swlng].every(Number.isFinite)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing/invalid bounds: nelat, nelng, swlat, swlng' }) };
  }
  const perPage = Math.min(parseInt(p.limit || '200', 10) || 200, 200);
  // Recent-first, research-grade only, with coords + photos
  const qs = new URLSearchParams({
    taxon_id: cat.taxa.join(','),
    nelat: String(nelat), nelng: String(nelng), swlat: String(swlat), swlng: String(swlng),
    quality_grade: 'research',
    geo: 'true',
    photos: 'true',
    per_page: String(perPage),
    order_by: 'observed_on',
    order: 'desc'
  });
  const url = `https://api.inaturalist.org/v1/observations?${qs.toString()}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'KGS-BDOC/1.0' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`iNaturalist ${res.status}`);
    const raw = await res.json();
    // Trim server-side — full iNat objects are huge (like maritime, avoid response-cap 502s)
    const out = (raw.results || []).map(o => {
      const [lat, lon] = (o.location || ',').split(',').map(Number);
      const t = o.taxon || {};
      const ph = (o.photos && o.photos[0]) ? (o.photos[0].url || '').replace('square', 'medium') : null;
      return {
        id: o.id,
        lat, lon,
        sci: t.name || null,
        common: (t.preferred_common_name || t.english_common_name || null),
        date: o.observed_on || null,
        photo: ph,
        url: o.uri || ('https://www.inaturalist.org/observations/' + o.id)
      };
    }).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ category: p.category || 'ticks', label: cat.label, _total: raw.total_results || 0, _returned: out.length, data: out })
    };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message, source: 'iNaturalist' }) };
  }
};
