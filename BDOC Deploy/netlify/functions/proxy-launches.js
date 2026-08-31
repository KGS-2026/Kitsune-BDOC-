// Netlify function: Launch Library 2.0 space launches proxy (no auth required)
// GET /.netlify/functions/proxy-launches?days=7
// Returns: upcoming space launches within N days

exports.handler = async (event) => {
  const days = Math.min(parseInt(event.queryStringParameters?.days || '30'), 90); // Cap at 90 days
  
  if (isNaN(days) || days < 1) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'days must be a positive integer' })
    };
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout
    
    // LL2 API: filters by net (launch net) >= today
    // mode=list for pagination-friendly response
    const now = new Date();
    const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    
    // Format: YYYY-MM-DD
    const dateGte = now.toISOString().split('T')[0];
    const dateLte = futureDate.toISOString().split('T')[0];
    
    const res = await fetch(
      `https://ll.thespacedevs.com/2.0.0/launch/upcoming/?` +
      `format=json&limit=100&` +
      `net__gte=${dateGte}&net__lte=${dateLte}&` +
      `ordering=net`,
      {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      }
    );
    
    clearTimeout(timeout);
    
    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { 'Cache-Control': 'max-age=300' },
        body: JSON.stringify({ error: `Launch Library returned ${res.status}` })
      };
    }
    
    const data = await res.json();
    
    // Normalize response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=600', // 10min cache (launches don't shift that often)
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        count: data.count || 0,
        launches: (data.results || []).map(launch => ({
          id: launch.id,
          name: launch.name,
          net: launch.net, // ISO 8601 datetime
          status: launch.status, // 0=TBD, 1=Go, 2=No Go, 3=Hold, 4=InFlight, 5=Partial Failure, 6=Failure, 7=Success
          rocket: {
            id: launch.rocket?.id,
            name: launch.rocket?.name,
            family: launch.rocket?.family?.name
          },
          pad: {
            id: launch.pad?.id,
            name: launch.pad?.name,
            location: launch.pad?.location?.name,
            latitude: launch.pad?.latitude,
            longitude: launch.pad?.longitude,
            country_code: launch.pad?.location?.country_code
          },
          mission: {
            name: launch.mission?.name,
            type: launch.mission?.type,
            description: launch.mission?.description
          },
          image_url: launch.image?.image_url,
          webcast_live: launch.webcast_live,
          probability: launch.probability,
          holdreason: launch.holdreason,
          failreason: launch.failreason
        })),
        source: 'thespacedevs.com/launchlibrary2'
      })
    };
  } catch (err) {
    console.error('[proxy-launches]', err);
    return {
      statusCode: 504,
      headers: { 'Cache-Control': 'max-age=60' },
      body: JSON.stringify({ error: 'Launch Library request failed', message: err.message })
    };
  }
};
