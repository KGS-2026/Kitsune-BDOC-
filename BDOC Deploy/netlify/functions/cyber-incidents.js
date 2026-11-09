// ============================================================
// cyber-incidents.js — reported cyber incidents, placed on the map (p182).
//
// GET /.netlify/functions/cyber-incidents
//   -> { ok, checked, incidents: [...], advisories: [...], feeds: { id: 'ok' | error } }
// Each incident: title, link, sources[], published, sector (water, health, food, energy,
// government, education, transport, finance, telecom, retail, other), and place
// ({level: county | city | state | country, name, state, cc, lat, lon}) or null.
// Keyless. Headlines and links only, like any news reader. Rules: _lib/cyber-incidents.js.
// The CDN keeps one answer for 15 minutes and serves it stale for an hour while refreshing.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
'use strict';
const lib = require('./_lib/cyber-incidents.js');

const UA = 'KitsuneGlobal/BDOC (kgsbdoc.netlify.app)';
const GN = (q, lang = 'en-US', gl = 'US') => 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) +
  '&hl=' + lang + '&gl=' + gl + '&ceid=' + gl + ':' + lang.split('-')[0];

const FEEDS = [
  { id: 'therecord', name: 'The Record', url: 'https://therecord.media/feed' },
  { id: 'bleeping', name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/' },
  { id: 'securityweek', name: 'SecurityWeek', url: 'https://www.securityweek.com/feed/' },
  { id: 'industrialcyber', name: 'Industrial Cyber', url: 'https://industrialcyber.co/feed/' },
  { id: 'darkreading', name: 'Dark Reading', url: 'https://www.darkreading.com/rss.xml' },
  { id: 'hipaajournal', name: 'HIPAA Journal', url: 'https://www.hipaajournal.com/feed/' },
  { id: 'databreaches', name: 'DataBreaches.net', url: 'https://databreaches.net/feed/' },
  { id: 'thehackernews', name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews' },
  { id: 'cyberscoop', name: 'CyberScoop', url: 'https://cyberscoop.com/feed/' },
  { id: 'statescoop', name: 'StateScoop', url: 'https://statescoop.com/feed/' },
  { id: 'zataz', name: 'ZATAZ', url: 'https://www.zataz.com/feed/', lang: 'fr' },
  { id: 'lemagit', name: 'LeMagIT', url: 'https://www.lemagit.fr/rss/ContentSyndication.xml', lang: 'fr' },
  // Google News searches reach the local papers that report a town's water plant or school district.
  { id: 'gn-attacks', name: 'Google News', google: true, url: GN('(cyberattack OR ransomware OR hackers OR "cyber attack") when:7d') },
  { id: 'gn-water', name: 'Google News', google: true, url: GN('(cyberattack OR hackers OR ransomware OR hacked) water (utility OR system OR authority OR district OR plant) when:365d') },
  { id: 'gn-health', name: 'Google News', google: true, url: GN('(ransomware OR cyberattack OR hackers) (hospital OR "blood" OR "health system") when:30d') },
  { id: 'gn-food', name: 'Google News', google: true, url: GN('(cyberattack OR ransomware OR hackers) (supermarket OR grocery OR food) when:30d') },
  { id: 'gn-local', name: 'Google News', google: true, url: GN('(ransomware OR cyberattack OR "cyber incident") (county OR "city of" OR "school district") when:30d') },
  { id: 'gn-uk', name: 'Google News', google: true, url: GN('"cyber attack" when:7d', 'en-GB', 'GB') },
  { id: 'gn-fr', name: 'Google News', google: true, url: GN('cyberattaque when:14d', 'fr', 'FR'), lang: 'fr' }
];
const CISA = 'https://www.cisa.gov/cybersecurity-advisories/all.xml';

async function getText(url, ms, fetchImpl) {
  const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
const why = (e) => String((e && e.message) || e || 'error').slice(0, 60);

async function collect({ now = Date.now(), fetchImpl = globalThis.fetch, feeds = FEEDS } = {}) {
  const status = {};
  const items = [];
  const [results, cisa] = await Promise.all([
    Promise.allSettled(feeds.map(f => getText(f.url, 6500, fetchImpl).then(xml => ({ f, xml })))),
    getText(CISA, 6500, fetchImpl).then(x => lib.advisories(x), e => { status.cisa = why(e); return []; })
  ]);
  results.forEach((r, i) => {
    const f = feeds[i];
    if (r.status !== 'fulfilled') { status[f.id] = why(r.reason); return; }
    try { const got = lib.parseFeed(r.value.xml, f); items.push(...got); status[f.id] = 'ok'; } catch (e) { status[f.id] = 'parse: ' + why(e); }
  });
  if (!status.cisa) status.cisa = 'ok';
  const okCount = Object.values(status).filter(v => v === 'ok').length;
  return {
    ok: okCount > 0,
    checked: new Date(now).toISOString(),
    incidents: lib.build(items, now),
    advisories: cisa,
    feeds: status
  };
}

exports.collect = collect;
exports.FEEDS = FEEDS;

exports.handler = async (event) => {
  const json = { 'Content-Type': 'application/json; charset=utf-8' };
  if (event && event.httpMethod && event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: json, body: JSON.stringify({ error: 'GET only' }) };
  }
  try {
    const out = await collect();
    return {
      statusCode: out.ok ? 200 : 502,
      headers: {
        ...json,
        'Cache-Control': 'public, max-age=300',
        'Netlify-CDN-Cache-Control': out.ok ? 'public, durable, s-maxage=900, stale-while-revalidate=3600' : 'public, s-maxage=60'
      },
      body: JSON.stringify(out)
    };
  } catch (e) {
    return { statusCode: 502, headers: { ...json, 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: false, error: why(e), incidents: [], advisories: [] }) };
  }
};
