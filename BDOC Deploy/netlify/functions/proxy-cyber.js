// proxy-cyber.js — Unified cyber threat IOC geocoder
// Sources (C2 leg, priority order):
//   1. ThreatFox (abuse.ch) API — ONLY with an Auth-Key. Since 2026-10-21 abuse.ch
//      answers {"error":"Unauthorized"} to keyless calls, so this leg silently
//      returned 0 C2 servers for a month. Free key: https://auth.abuse.ch/ →
//      Netlify env ABUSECH_AUTH_KEY (THREATFOX_AUTH_KEY also accepted).
//   2. Feodo Tracker botnet C2 blocklist (abuse.ch, still keyless) — online rows only.
//   3. C2IntelFeeds (github.com/drb-ra/C2IntelFeeds, keyless, updated daily) —
//      Cobalt Strike / C2 IP:port scan results.
// Compromised-host leg: Emerging Threats compromised-ips.txt.
// Geocoding: ip-api.com batch endpoint (free, no key, HTTP OK server-side)
// Every leg reports {status,count} in `sources` so the client can say which feed
// is down instead of reading "0 C2 servers" as "no C2 servers". (p208)

const CACHE_TTL = 30 * 60; // seconds
const UA = 'KitsuneBDOC/8.0 (+https://kgsbdoc.netlify.app)';
const C2_CAP = 110;   // geocode budget for C2 rows (of 200 total) so ET can't crowd them out
const GEO_CAP = 200;

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
    const legs = { threatfox: fetchThreatFox, feodo: fetchFeodo, c2intel: fetchC2Intel, et: fetchEmergingThreats };
    const names = Object.keys(legs);
    const settled = await Promise.allSettled(names.map(n => legs[n]()));
    const sources = {};
    const got = {};
    names.forEach((n, i) => {
      const s = settled[i];
      if (s.status === 'fulfilled' && s.value && s.value.skipped) {
        sources[n] = { status: s.value.skipped, count: 0 };
        got[n] = [];
      } else if (s.status === 'fulfilled') {
        got[n] = s.value || [];
        sources[n] = { status: 'ok', count: got[n].length };
      } else {
        got[n] = [];
        sources[n] = { status: 'error', count: 0, error: String(s.reason && s.reason.message || s.reason).slice(0, 120) };
      }
    });

    // Build IP → metadata map (C2 legs first, in priority order; ET only fills gaps)
    const ipMap = new Map();
    for (const leg of ['threatfox', 'feodo', 'c2intel']) {
      for (const entry of got[leg]) {
        if (ipMap.has(entry.ip)) continue;
        ipMap.set(entry.ip, {
          source:      leg,
          malware:     entry.malware,
          threat_type: entry.threat_type || 'botnet_cc',
          confidence:  entry.confidence,
          port:        entry.port
        });
      }
    }
    const c2IPs = sampleEvenly([...ipMap.keys()], C2_CAP);
    const etIPs = [];
    for (const ip of got.et) {
      if (ipMap.has(ip)) continue;
      ipMap.set(ip, { source: 'emerging_threats', malware: 'Compromised Host', threat_type: 'compromised', confidence: 70, port: null });
      etIPs.push(ip);
    }
    const sampleIPs = c2IPs.concat(sampleEvenly(etIPs, GEO_CAP - c2IPs.length));

    // Geocode in parallel batches of 100
    const geoResults = await geocodeBatch(sampleIPs);

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
    const c2Total = got.threatfox.length + got.feodo.length + got.c2intel.length;
    if (!features.length) headers['Cache-Control'] = 'no-store';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        count:           features.length,
        c2_count:        c2Total,
        threatfox_count: got.threatfox.length,
        et_count:        got.et.length,
        sources,
        geocoded:        { requested: sampleIPs.length, ok: features.length },
        features,
        updated:         new Date().toISOString()
      })
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: Object.assign({}, headers, { 'Cache-Control': 'no-store' }),
      body: JSON.stringify({ error: e.message, source: 'proxy-cyber' })
    };
  }
};

function sampleEvenly(arr, n) {
  if (n <= 0) return [];
  if (arr.length <= n) return arr.slice();
  const out = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function validIP(ip) {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip || '') &&
    !ip.startsWith('0.') && ip !== '127.0.0.1' && !ip.startsWith('10.') && !ip.startsWith('192.168.');
}

// ─── ThreatFox (needs Auth-Key since 2026-10-21) ─────────────────────────────
async function fetchThreatFox() {
  const key = process.env.ABUSECH_AUTH_KEY || process.env.THREATFOX_AUTH_KEY || process.env.Abusech_auth_key;
  if (!key) return { skipped: 'needs_key' };
  const res = await fetch('https://threatfox-api.abuse.ch/api/v1/', {
    method:  'POST',
    signal:  AbortSignal.timeout(5000), // Phase 22: was 9s — too close to Netlify 10s hard kill
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Auth-Key': key },
    body:    JSON.stringify({ query: 'get_iocs', days: 1 })
  });
  if (res.status === 401 || res.status === 403) return { skipped: 'key_rejected' };
  if (!res.ok) throw new Error(`ThreatFox HTTP ${res.status}`);
  const j = await res.json();
  if (j.query_status !== 'ok' || !Array.isArray(j.data)) throw new Error('ThreatFox ' + (j.query_status || j.error || 'bad payload'));

  const entries = [];
  for (const ioc of j.data) {
    // Only want IP:port IOCs
    if (ioc.ioc_type !== 'ip:port') continue;
    const colonIdx = ioc.ioc_value.lastIndexOf(':');
    const ip   = colonIdx > 0 ? ioc.ioc_value.slice(0, colonIdx) : ioc.ioc_value;
    const port = colonIdx > 0 ? ioc.ioc_value.slice(colonIdx + 1) : null;
    if (!validIP(ip)) continue;
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

// ─── Feodo Tracker botnet C2 (keyless) ───────────────────────────────────────
async function fetchFeodo() {
  const res = await fetch('https://feodotracker.abuse.ch/downloads/ipblocklist.json', {
    signal: AbortSignal.timeout(5000), headers: { 'User-Agent': UA }
  });
  if (!res.ok) throw new Error(`Feodo HTTP ${res.status}`);
  const j = await res.json();
  if (!Array.isArray(j)) throw new Error('Feodo bad payload');
  return j.filter(r => r && r.status === 'online' && validIP(r.ip_address)).map(r => ({
    ip: r.ip_address, port: r.port != null ? String(r.port) : null,
    malware: (r.malware || 'Botnet') + ' botnet C2', threat_type: 'botnet_cc', confidence: 90
  }));
}

// ─── C2IntelFeeds (keyless, daily) ───────────────────────────────────────────
async function fetchC2Intel() {
  const res = await fetch('https://raw.githubusercontent.com/drb-ra/C2IntelFeeds/master/feeds/IPPortC2s.csv', {
    signal: AbortSignal.timeout(5000), headers: { 'User-Agent': UA }
  });
  if (!res.ok) throw new Error(`C2IntelFeeds HTTP ${res.status}`);
  const text = await res.text();
  if (text.charAt(0) === '{' || text.charAt(0) === '<') throw new Error('C2IntelFeeds non-CSV body');
  const out = [];
  for (const line of text.split('\n')) {
    if (!line || line.charAt(0) === '#') continue;
    const [ip, port, ioc] = line.split(',');
    if (!validIP(ip)) continue;
    out.push({
      ip, port: port || null,
      malware: (ioc || 'C2 server').replace(/^Possible\s+/i, '').replace(/\s+IP$/i, '').trim(),
      threat_type: 'botnet_cc', confidence: 60
    });
  }
  return out;
}

// ─── Emerging Threats ────────────────────────────────────────────────────────
async function fetchEmergingThreats() {
  const res = await fetch('https://rules.emergingthreats.net/blockrules/compromised-ips.txt', {
    signal:  AbortSignal.timeout(5000), // Phase 22: was 8s
    headers: { 'User-Agent': UA }
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
