// ============================================================
// proxy-ogimage — resolve an article URL to its social preview image
// ============================================================
// WHY THIS EXISTS (P121)
// GDELT event records (proxy-gdeltevents) carry a source article URL but NO
// image. So every SITREP / events marker rendered a text-only card — the
// operator clicks "GROUND CLASH · Newberry County" and gets Goldstein numbers
// instead of the photo that is sitting right there in the source article.
//
// This function fetches the article HTML, pulls the og:image (the same tag
// Facebook/Twitter/Slack use to build a preview), and 302-REDIRECTS to it.
//
// The redirect is the important design choice. Because the response is a
// redirect rather than a proxied body:
//   - we never stream image bytes through the function (no bandwidth cost,
//     no 6MB Lambda response cap, no timeout on a slow CDN)
//   - the browser fetches the image straight from the outlet's CDN
//   - the client just does <img src="/.netlify/functions/proxy-ogimage?url=..">
//     with an onerror fallback, i.e. zero client-side JS
//
// Range-limited read: we abort after the first 96KB of HTML because <meta>
// tags live in <head>. Pulling a full 2MB news page to read one attribute
// would be the whole latency budget.
//
// Caching is aggressive and deliberate: og:image for a given article URL is
// effectively immutable, so a hit costs the CDN edge and never the function.

const CACHE_OK   = 'public, max-age=86400, s-maxage=604800, immutable';
const CACHE_MISS = 'public, max-age=300';           // negative cache, short
const MAX_HTML   = 96 * 1024;

// A 1x1 transparent GIF. Returned (not 404) on miss so the <img> onerror path
// stays predictable and we never emit a console error for an expected miss.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function pickMeta(html) {
  // Ordered by quality: og:image:secure_url > og:image > twitter:image >
  // link rel=image_src > first large <img> in an <article>/<figure>.
  const pats = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i
  ];
  for (const re of pats) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  // Last resort: a reasonably-sized <img> inside article/figure markup.
  const fig = html.match(/<(?:figure|article)[^>]*>[\s\S]{0,4000}?<img[^>]+src=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i);
  return fig ? fig[1] : null;
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'")
          .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const target = q.url || '';

  const miss = (reason) => ({
    statusCode: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': CACHE_MISS,
      'Access-Control-Allow-Origin': '*',
      'X-OG-Miss': reason
    },
    body: PIXEL.toString('base64'),
    isBase64Encoded: true
  });

  // SSRF guard: only http(s), only public hosts. This function takes a
  // caller-supplied URL, so it must never be usable to reach internal metadata
  // endpoints (169.254.169.254) or anything on the private ranges.
  let u;
  try { u = new URL(target); } catch { return miss('bad-url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return miss('bad-proto');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' ||
      /^(?:127|10)\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
      /\.internal$|\.local$/.test(host)) {
    return miss('private-host');
  }

  try {
    const res = await fetch(u.toString(), {
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
      headers: {
        // Outlets serve richer meta to a real UA; many 403 an unknown agent.
        'User-Agent': 'Mozilla/5.0 (compatible; BDOC/1.0; +https://kgsbdoc.netlify.app)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    if (!res.ok) return miss('http-' + res.status);

    // Read only the head-ish prefix, then bail — full article bodies are wasted bytes.
    let html = '';
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (reader) {
      const dec = new TextDecoder('utf-8', { fatal: false });
      while (html.length < MAX_HTML) {
        const { done, value } = await reader.read();
        if (done) break;
        html += dec.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;      // everything we need is above this
      }
      try { await reader.cancel(); } catch (_) {}
    } else {
      html = (await res.text()).slice(0, MAX_HTML);
    }

    let img = pickMeta(html);
    if (!img) return miss('no-og-tag');
    img = decodeEntities(img.trim());

    // Resolve protocol-relative and root-relative URLs against the article.
    if (img.startsWith('//')) img = u.protocol + img;
    else if (img.startsWith('/')) img = u.origin + img;
    else if (!/^https?:/i.test(img)) img = new URL(img, u.toString()).toString();

    return {
      statusCode: 302,
      headers: {
        Location: img,
        'Cache-Control': CACHE_OK,
        'Access-Control-Allow-Origin': '*',
        'X-OG-Source': u.hostname
      },
      body: ''
    };
  } catch (e) {
    return miss('err-' + (e.name || 'unknown'));
  }
};
