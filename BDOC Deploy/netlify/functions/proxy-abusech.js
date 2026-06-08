// Proxy for Abuse.ch Feodo Tracker IOC feed
// Abuse.ch provides free malware C2 IP blocklists with no API key.
// Phase 17a (2026-05-14)
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const list = params.list || 'feodo';

  const LISTS = {
    feodo:  'https://feodotracker.abuse.ch/downloads/ipblocklist.json',
    sslbl:  'https://sslbl.abuse.ch/blacklist/sslipblacklist.json',
    botnet: 'https://feodotracker.abuse.ch/downloads/ipblocklist_aggressive.json'
  };
  const url = LISTS[list];
  if (!url) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown list. Use: feodo|sslbl|botnet' }) };
  }
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'Accept': 'application/json', 'User-Agent': 'KitsuneGlobal/BDOC-8.0' }
    });
    if (!res.ok) throw new Error('Abuse.ch ' + res.status);
    const data = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600', // 1 hour — Feodo updates every few hours
        'Access-Control-Allow-Origin': '*'
      },
      body: data
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message, source: 'Abuse.ch Feodo Tracker' }) };
  }
};
