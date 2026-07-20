// proxy-cyber.js — Unified cyber threat IOC geocoder
// Sources: ThreatFox (abuse.ch) C2 IPs + Emerging Threats compromised IPs
// Geocoding: ip-api.com batch endpoint (free, no key, HTTP OK server-side)
// Cache: 30 min | Phase 20a (2026-05-15)

const CACHE_TTL = 30 * 60; // seconds

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: '' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Netlify-Vary': 'query', 'Cache-Control': `public, max-age=${CACHE_TTL}`,
    'Access-Control-Allow-Origin': '*'
  };

  try {
    // Fetch ThreatFox + Emerging Threats in parallel
    const [tfResult, etResult] = await Promise.allSettled([
      fetchThreatFox(),
      fetchEmergingThreats()
    ]);

    const threatfoxEntries = tfResult.status === 'fulfilled' ? tfResult.value : [];
    const etIPs           = etResult.status === 'fulfilled' ? etResult.value : [];

    // Build IP → metadata map (ThreatFox takes priority)
    const ipMap = new Map();
    for (const entry of threatfoxEntries) {
      ipMap.set(entry.ip, {
        source:      'threatfox',
        malware:     entry.malware,
        threat_type: entry.threat_type,
        confidence:  entry.confidence,
        port:        entry.port
      });
    }
    for (const ip of etIPs) {
      if (!ipMap.has(ip)) {
        ipMap.set(ip, {
          source:      'emerging_threats',
          malware:     'Compromised Host',
          threat_type: 'compromised',
          confidence:  70,
          port:        null
        });
      }
    }

    // Phase 22: cap at 200 (was 400) — geocoding runs in parallel but 400 IPs
    // in 4×100 batches each with 8s timeout added up to 17s worst-case (Netlify kills at 10s)
    const allIPs    = [...ipMap.keys()];
    const sampleIPs = allIPs.slice(0, 200);

    // Geocode in parallel batches of 100
    const geoResults = await geocodeBatch(sampleIPs);

    // Build output features
    const features = [];
    for (const geo of geoResults) {
      if (geo.status !== 'success') continue;
      if (!geo.lat || !geo.lon)    continue;
      const meta = ipMap.get(geo.query) || {};
      features.push({
        ip:          geo.query,
        lat:         geo.lat,
        lon:         geo.lon,
        country:     geo.country || '',
        city:        geo.city    || '',
        isp:         geo.isp     || '',
        source:      meta.source      || 'unknown',
        malware:     meta.malware     || '',
        threat_type: meta.threat_type || '',
        confidence:  meta.confidence  || 50,
        port:        meta.port        || null
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        count:           features.length,
        threatfox_count: threatfoxEntries.length,
        et_count:        etIPs.length,
        features,
        updated:         new Date().toISOString()
      })
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: e.message, source: 'proxy-cyber' })
    };
  }
};

// ─── ThreatFox ───────────────────────────────────────────────────────────────
async function fetchThreatFox() {
  const res = await fetch('https://threatfox-api.abuse.ch/api/v1/', {
    method:  'POST',
    signal:  AbortSignal.timeout(5000), // Phase 22: was 9s — too close to Netlify 10s hard kill
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'KitsuneGlobal/BDOC-8.0' },
    body:    JSON.stringify({ query: 'get_iocs', days: 1 })
  });
  if (!res.ok) throw new Error(`ThreatFox HTTP ${res.status}`);
  const j = await res.json();
  if (j.query_status !== 'ok' || !Array.isArray(j.data)) return [];

  const entries = [];
  for (const ioc of j.data) {
    // Only want IP:port IOCs
    if (ioc.ioc_type !== 'ip:port') continue;
    const colonIdx = ioc.ioc_value.lastIndexOf(':');
    const ip   = colonIdx > 0 ? ioc.ioc_value.slice(0, colonIdx) : ioc.ioc_value;
    const port = colonIdx > 0 ? ioc.ioc_value.slice(colonIdx + 1) : null;
    // Skip obviously invalid
    if (!ip || ip.startsWith('0.') || ip === '127.0.0.1' || ip.startsWith('10.') || ip.startsWith('192.168.')) continue;
    entries.push({
      ip,
      port,
      malware:     ioc.malware_printable || ioc.malware || 'Unknown Malware',
      threat_type: ioc.threat_type       || 'botnet_cc',
      confidence:  typeof ioc.confidence_level === 'number' ? ioc.confidence_level : 75
    });
  }
  return entries;
}

// ─── Emerging Threats ────────────────────────────────────────────────────────
async function fetchEmergingThreats() {
  const res = await fetch('https://rules.emergingthreats.net/blockrules/compromised-ips.txt', {
    signal:  AbortSignal.timeout(5000), // Phase 22: was 8s
    headers: { 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
  });
  if (!res.ok) throw new Error(`Emerging Threats HTTP ${res.status}`);
  const text = await res.text();

  const ips = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith(';')) continue;
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(t)) ips.push(t);
  }
  // Sample evenly — don't hammer geocoder with 3000 IPs
  const step = Math.max(1, Math.floor(ips.length / 280));
  return ips.filter((_, i) => i % step === 0);
}

// ─── ip-api.com batch geocoding ──────────────────────────────────────────────
async function geocodeBatch(ips) {
  const BATCH_SIZE = 100;
  const allResults = [];
  const batches = [];
  for (let i = 0; i < ips.length; i += BATCH_SIZE) {
    batches.push(ips.slice(i, i + BATCH_SIZE));
  }

  // Run all batches in parallel (ip-api.com allows it on server-side)
  const settled = await Promise.allSettled(
    batches.map(batch =>
      fetch('http://ip-api.com/batch?fields=status,lat,lon,country,city,isp,query', {
        method:  'POST',
        signal:  AbortSignal.timeout(5000), // Phase 22: was 8s
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(batch.map(q => ({ query: q })))
      })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`ip-api ${r.status}`)))
    )
  );

  for (const s of settled) {
    if (s.status === 'fulfilled' && Array.isArray(s.value)) {
      allResults.push(...s.value);
    }
  }
  return allResults;
}
