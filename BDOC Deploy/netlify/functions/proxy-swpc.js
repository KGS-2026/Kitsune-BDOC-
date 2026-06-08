// Proxy for NOAA Space Weather Prediction Center (SWPC)
// Fetches planetary Kp index (geomagnetic storm level) + GOES X-ray flux (solar flares)
// No API key required. CORS not reliably set on SWPC CDN.
// Phase 19c (2026-05-15)
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=900', // 15 min — SWPC updates ~hourly
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const [kpRes, xrayRes] = await Promise.allSettled([
      fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', {
        signal: AbortSignal.timeout(8000),
        headers: { 'Accept': 'application/json', 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
      }).then(r => { if (!r.ok) throw new Error('Kp ' + r.status); return r.json(); }),
      fetch('https://services.swpc.noaa.gov/json/goes/primary/xrays-1-minute.json', {
        signal: AbortSignal.timeout(8000),
        headers: { 'Accept': 'application/json', 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
      }).then(r => { if (!r.ok) throw new Error('Xray ' + r.status); return r.json(); })
    ]);

    // Kp index: [[time_tag, kp, observed, noaa_scale], ...] — first row is header
    let currentKp = null, gScale = 'G0';
    if (kpRes.status === 'fulfilled' && Array.isArray(kpRes.value) && kpRes.value.length > 2) {
      const rows = kpRes.value.slice(1); // skip header
      const recent = rows.slice(-4); // last ~4 readings (3-hr cadence)
      const vals = recent.map(r => parseFloat(r[1])).filter(v => !isNaN(v));
      currentKp = vals.length ? Math.max(...vals) : null;
      if (currentKp !== null) {
        if (currentKp >= 9)      gScale = 'G5';
        else if (currentKp >= 8) gScale = 'G4';
        else if (currentKp >= 7) gScale = 'G3';
        else if (currentKp >= 6) gScale = 'G2';
        else if (currentKp >= 5) gScale = 'G1';
        else                     gScale = 'G0';
      }
    }

    // X-ray flux: [{time_tag, energy, flux}, ...] — use long channel (0.1-0.8nm) for flare class
    let xrayFlux = null, flareClass = 'A';
    if (xrayRes.status === 'fulfilled' && Array.isArray(xrayRes.value) && xrayRes.value.length > 0) {
      const longCh = xrayRes.value.filter(r => r.energy && r.energy.includes('0.8'));
      const latest = longCh.length ? longCh[longCh.length - 1] : xrayRes.value[xrayRes.value.length - 1];
      xrayFlux = parseFloat(latest.flux);
      if (!isNaN(xrayFlux)) {
        if      (xrayFlux >= 1e-4) flareClass = 'X' + (xrayFlux / 1e-4).toFixed(1);
        else if (xrayFlux >= 1e-5) flareClass = 'M' + (xrayFlux / 1e-5).toFixed(1);
        else if (xrayFlux >= 1e-6) flareClass = 'C' + (xrayFlux / 1e-6).toFixed(1);
        else if (xrayFlux >= 1e-7) flareClass = 'B' + (xrayFlux / 1e-7).toFixed(1);
        else                       flareClass = 'A' + (xrayFlux / 1e-8).toFixed(1);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ kp: currentKp, gScale, flareClass, xrayFlux, updated: new Date().toISOString() })
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: e.message, source: 'NOAA-SWPC' })
    };
  }
};
