// layer-snap.js — serve one IMMUTABLE dated snapshot.
// GET /.netlify/functions/layer-snap?k=firms/20260828_1435.json
//
// Every response here carries `max-age=31536000, immutable`, which is only
// safe because the key contains a timestamp and the bytes at that key are
// never rewritten. That single invariant is what lets the CDN answer every
// client from the edge and reduces origin traffic to one write per interval,
// no matter how many people are watching a layer.
//
// Also why offline works: a service worker can cache these keys permanently
// with zero staleness risk, and the app can replay history by requesting an
// older key through the exact same code path as "live".

const { readSnapshot, IMMUTABLE_HEADERS, POINTER_HEADERS } = require('./_snapshot');

exports.handler = async (event) => {
  const key = (event.queryStringParameters || {}).k || '';
  // Constrain to the shape publish() emits — prevents path traversal and stops
  // this becoming a general-purpose read primitive over the blob store.
  if (!/^[a-z0-9_-]{1,32}\/\d{8}_\d{4}\.json$/.test(key)) {
    return { statusCode: 400, headers: POINTER_HEADERS, body: JSON.stringify({ error: 'bad key' }) };
  }
  const body = await readSnapshot(key);
  if (!body) {
    // 404 must NOT be cached long, or a race between pointer-publish and
    // snapshot-visibility would poison the edge for a year.
    return {
      statusCode: 404,
      headers: { ...POINTER_HEADERS, 'Cache-Control': 'public, max-age=10' },
      body: JSON.stringify({ error: 'no snapshot' })
    };
  }
  return { statusCode: 200, headers: IMMUTABLE_HEADERS, body };
};
