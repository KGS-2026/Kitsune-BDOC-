// Netlify function: adsbdb aircraft enrichment (no auth required)
// GET /.netlify/functions/proxy-adsbdb?hex=ABC123
// Returns: aircraft type, manufacturer, operator, registration from adsbdb.org API

exports.handler = async (event) => {
  const hex = (event.queryStringParameters?.hex || '').trim().toUpperCase();
  
  if (!hex || !/^[0-9A-F]+$/.test(hex)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid hex code' })
    };
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
    
    const res = await fetch(`https://adsbdb.org/api/v5/aircraft?query=${hex}`, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    clearTimeout(timeout);
    
    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { 'Cache-Control': 'max-age=300' },
        body: JSON.stringify({ error: `adsbdb returned ${res.status}` })
      };
    }
    
    const data = await res.json();
    
    // Extract the first aircraft match
    const ac = data.aircraft && data.aircraft[0] ? data.aircraft[0] : null;
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=86400', // 1 day cache, aircraft metadata is stable
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        hex,
        icao_type: ac?.icaoType || null,
        manufacturer: ac?.manufacturer || null,
        model: ac?.model || null,
        registration: ac?.registration || null,
        operator: ac?.operator || null,
        operator_icao: ac?.operatorIcao || null,
        built: ac?.builtYear || null,
        source: 'adsbdb.org'
      })
    };
  } catch (err) {
    console.error('[proxy-adsbdb]', err);
    return {
      statusCode: 504,
      headers: { 'Cache-Control': 'max-age=60' },
      body: JSON.stringify({ error: 'adsbdb request failed', message: err.message })
    };
  }
};
