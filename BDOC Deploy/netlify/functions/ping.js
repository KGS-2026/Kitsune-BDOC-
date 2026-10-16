// ping — link-state probe for js/bdoc-link-manager.js (P156d, field audit S1).
// The probe used to hit `config`, which the service worker serves from its API cache,
// so a dead uplink still read as ONLINE. This answer must never be cached — not by the
// CDN, the browser or the service worker (the SW passes this path straight through).
// `t` is server time, for a future clock-skew check (field audit S13).
exports.handler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' },
  body: JSON.stringify({ ok: true, t: Date.now() })
});
