// Cellular carrier outage layer — fuses live signal so BDOC is NOT blind to
// nationwide carrier events (T-Mobile / AT&T / Verizon / etc).
// GAP FOUND 2026-08-09 (T-Mobile nationwide outage): proxy-outages is EIA power
// grid ONLY — there was no cellular-carrier tracking anywhere in BDOC. This adds it.
//
// SOURCE: GDELT DOC 2.0 artlist (free, no key, proven reachable from this droplet/
// Netlify) filtered to carrier + outage terms in the last hour, deduped, geocoded
// to the reporting metro when the headline names one, else pinned to a US centroid
// with a nationwide flag. Cross-checks CISA/cyber terms to tag possible-cyber.
// Output: array of {_carrier:true, carrier, lat, lon, title, url, seendate,
//   scope:'nationwide'|'regional', cyberFlag:bool, outlets:int}.
// 8s upstream budget inside Netlify's 10s hard limit; Tier-2 graceful empty.

const CARRIERS = [
  { key: 'T-Mobile', rx: /t[- ]?mobile|tmobile|metro ?by ?t-mobile|mint mobile/i },
  { key: 'AT&T',     rx: /at&t|at and t|cricket wireless/i },
  { key: 'Verizon',  rx: /verizon|visible wireless/i },
  { key: 'US Cellular', rx: /us cellular|u\.s\. cellular/i },
  { key: 'Spectrum', rx: /spectrum mobile/i },
];
const OUTAGE_RX = /outage|down|offline|no service|sos mode|disrupt|can'?t (call|text)|service (issue|disruption)|network (issue|problem|down)/i;
const CYBER_RX  = /cyber ?attack|ransomware|hack|breach|ddos|intrusion|malicious|sabotage/i;
const NATION_RX = /nationwide|nation-wide|across the (us|u\.s\.|country)|coast to coast|multiple states|all 50/i;

// Rough metro centroids for headline geocoding (US-focused; the events that matter).
const METROS = {
  'new york':[40.71,-74.0],'los angeles':[34.05,-118.24],'chicago':[41.88,-87.63],
  'houston':[29.76,-95.37],'phoenix':[33.45,-112.07],'philadelphia':[39.95,-75.16],
  'san antonio':[29.42,-98.49],'san diego':[32.72,-117.16],'dallas':[32.78,-96.80],
  'austin':[30.27,-97.74],'atlanta':[33.75,-84.39],'miami':[25.76,-80.19],
  'seattle':[47.61,-122.33],'denver':[39.74,-104.99],'boston':[42.36,-71.06],
  'detroit':[42.33,-83.05],'las vegas':[36.17,-115.14],'portland':[45.52,-122.68],
  'washington':[38.90,-77.04],'nashville':[36.16,-86.78],'new jersey':[40.06,-74.41],
  'california':[36.78,-119.42],'texas':[31.0,-99.0],'florida':[27.99,-81.76],
};
const US_CENTROID = [39.5, -98.35];

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Netlify-Vary': 'query',
    'Cache-Control': 'public, max-age=180', // carrier events move fast; 3-min edge cache
    'Access-Control-Allow-Origin': '*'
  };

  const geocode = (title) => {
    const t = title.toLowerCase();
    for (const [name, ll] of Object.entries(METROS)) if (t.includes(name)) return ll;
    return null;
  };

  // Shared collector — both sources dedupe into one incident list.
  const seen = new Set();
  const incidents = [];
  let jitter = 0;
  const pushIncident = (title, url, domain, seendate) => {
    title = (title || '').trim();
    if (!title || !OUTAGE_RX.test(title)) return;
    const carrier = CARRIERS.find(c => c.rx.test(title));
    if (!carrier) return;
    const dkey = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 55);
    if (seen.has(dkey)) return;
    seen.add(dkey);
    const nationwide = NATION_RX.test(title);
    let ll = geocode(title);
    if (!ll) {
      ll = [US_CENTROID[0] + (jitter % 3) * 0.9 - 0.9, US_CENTROID[1] + Math.floor(jitter / 3) * 1.1 - 1.1];
      jitter++;
    }
    incidents.push({
      _carrier: true, carrier: carrier.key, lat: ll[0], lon: ll[1],
      title, url: url || '', domain: domain || '', seendate: seendate || '',
      scope: nationwide ? 'nationwide' : 'regional', cyberFlag: CYBER_RX.test(title),
    });
  };

  let tier = 'unavailable';

  // ── TIER 1: Google News RSS (no rate limit, fast, fresh) ──
  try {
    const rssUrl = 'https://news.google.com/rss/search?q=' +
      encodeURIComponent('(T-Mobile OR AT&T OR Verizon OR cellular) (outage OR "no service" OR down) when:1d') +
      '&hl=en-US&gl=US&ceid=US:en';
    const r = await fetch(rssUrl, { signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KitsuneGlobal/BDOC-8.0)' } });
    if (r.ok) {
      const xml = await r.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const it of items) {
        const tm = it.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
        const lm = it.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
        const dm = it.match(/<source[^>]*>([\s\S]*?)<\/source>/);
        const pm = it.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        if (tm) pushIncident(tm[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'"), lm && lm[1], dm && dm[1], pm && pm[1]);
      }
      if (incidents.length) tier = 'google-news';
    }
  } catch (e) { /* fall through to GDELT */ }

  // ── TIER 2: GDELT (backup — richer geo, but rate-limits this IP) ──
  if (!incidents.length) try {
    // CRITICAL GDELT SYNTAX: dash-words MUST be quoted ("T-Mobile") or GDELT
    // rejects the ENTIRE query with "illegal character" and returns non-JSON.
    // Unquoted T-Mobile / AT&T was why this returned zero on 2026-08-09.
    const q = encodeURIComponent('(outage OR "no service" OR down) ("T-Mobile" OR "AT&T" OR Verizon OR cellular OR "cell service" OR "wireless network")');
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&format=json&timespan=6h&maxrecords=75&sort=datedesc`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'KitsuneGlobal/BDOC-8.0' } });
    if (res.ok) {
      // GDELT returns plain-text errors (429/illegal-char) with 200 + non-JSON body.
      const raw = await res.text();
      let data = null;
      try { data = JSON.parse(raw); } catch (_) { data = null; }
      const arts = data && Array.isArray(data.articles) ? data.articles : [];
      for (const a of arts) pushIncident(a.title, a.url, a.domain, a.seendate);
      if (incidents.length) tier = 'gdelt-carrier';
    }
  } catch (e) { /* graceful empty below */ }

  // Roll up outlet counts per carrier+scope so the client can show confidence
  const rollup = {};
  for (const i of incidents) { const k = i.carrier + '|' + i.scope; rollup[k] = (rollup[k] || 0) + 1; }
  for (const i of incidents) i.outlets = rollup[i.carrier + '|' + i.scope];

  return {
    statusCode: 200,
    headers: {
      ...headers,
      'Cache-Control': incidents.length ? 'public, max-age=180' : 'public, max-age=60',
      'X-Source-Tier': tier,
      'X-Incident-Count': String(incidents.length)
    },
    body: JSON.stringify(incidents)
  };
};
