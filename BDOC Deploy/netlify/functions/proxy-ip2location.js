// Proxy for ip2location.io — IP geolocation + proxy/VPN/TOR detection.
// Accepts either a specific IP (`?ip=...`) or no IP (looks up caller's IP).
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const apiKey = process.env.IP2LOCATION_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'IP2LOCATION_API_KEY not configured' }) };
  }

  const ip = (params.ip || '').trim();
  // Basic IPv4/IPv6 validation — reject anything that isn't obviously an IP.
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[0-9a-fA-F:]+$/;
  let url = `https://api.ip2location.io/?key=${apiKey}&format=json`;
  if (ip) {
    if (!ipv4.test(ip) && !(ipv6.test(ip) && ip.includes(':'))) {
      return { statusCode: 400, body: JSON.stringify({ error: 'invalid ip' }) };
    }
    url += `&ip=${encodeURIComponent(ip)}`;
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const body = await res.text();
    return {
      statusCode: res.ok ? 200 : res.status,
      headers: {
        'Content-Type': 'application/json',
        'Netlify-Vary': 'query', 'Cache-Control': 'public, max-age=600',
        'Access-Control-Allow-Origin': '*'
      },
      body
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
