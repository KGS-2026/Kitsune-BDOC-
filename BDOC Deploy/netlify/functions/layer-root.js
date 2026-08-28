// layer-root.js — the 83-byte pointer. GET /.netlify/functions/layer-root?l=firms
//
// This is the ONLY thing a client polls. It returns a tiny JSON object naming
// the current immutable snapshot. max-age=60, so it is cheap to hammer; every
// actual payload byte comes from the CDN edge via layer-snap.
//
// If no snapshot exists yet the response is still 200 with baseUrl:null — the
// client treats that as "no snapshot, fall back to the live proxy" rather than
// having to distinguish an error from an empty state.

const { readPointer, POINTER_HEADERS } = require('./_snapshot');

exports.handler = async (event) => {
  const layer = (event.queryStringParameters || {}).l || '';
  if (!/^[a-z0-9_-]{1,32}$/.test(layer)) {
    return { statusCode: 400, headers: POINTER_HEADERS, body: JSON.stringify({ error: 'bad layer' }) };
  }
  const ptr = await readPointer(layer);
  return {
    statusCode: 200,
    headers: POINTER_HEADERS,
    body: JSON.stringify(ptr || { baseUrl: null, generated: null, layer })
  };
};
