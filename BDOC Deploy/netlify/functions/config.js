// Config endpoint — returns public config for client initialization
// The anon key and Google Maps key are safe to expose (designed for client-side use)
exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300'
    },
    body: JSON.stringify({
      supabase_url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ulgxbqhbgbyxlzoyxcus.supabase.co',
      // Key read ONLY from env (Netlify var named "supabase"). Never hardcode — secrets scanner blocks the build.
      supabase_anon_key: process.env.supabase || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      google_maps_api_key: process.env.GOOGLE_MAPS_API_KEY || '',
      prices: {
        operator: process.env.STRIPE_PRICE_OPERATOR_MONTHLY || '',
        analyst: process.env.STRIPE_PRICE_ANALYST_MONTHLY || ''
      },
      stripe_prices: {
        operator_monthly: process.env.STRIPE_PRICE_OPERATOR_MONTHLY || '',
        operator_yearly: process.env.STRIPE_PRICE_OPERATOR_YEARLY || '',
        analyst_monthly: process.env.STRIPE_PRICE_ANALYST_MONTHLY || '',
        analyst_yearly: process.env.STRIPE_PRICE_ANALYST_YEARLY || '',
        enterprise_monthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY || '',
        enterprise_yearly: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY || ''
      }
    })
  };
};
