// layer-publish.js — the writer. Scheduled; pulls each source ONCE and writes
// an immutable dated snapshot + rewrites the tiny pointer.
//
// This is the half of the Google Earth root.json pattern that actually saves
// money. Today every client polls proxy-* directly, so N viewers = N origin
// invocations per interval. After this, ONE scheduled writer produces the
// snapshot and N viewers read an 83-byte pointer plus a permanently-edge-cached
// payload. Origin cost stops scaling with audience — which is precisely the
// cost curve you want to grow.
//
// Deliberately reuses the existing proxy-* handlers in-process rather than
// re-implementing ingest: same parsing, same fallbacks, one source of truth.

const { publish, prune, POINTER_HEADERS } = require('./_snapshot');

// layer id → { fn: proxy module, qs: query params }
// Chosen for the layers that are (a) polled by every session and (b) globally
// identical for all users, which is what makes a shared snapshot valid.
const LAYERS = {
  events:   { fn: 'proxy-gdeltevents', qs: { files: '12', img: '150' } },
  newsgeo:  { fn: 'proxy-newsgeo',     qs: { max: '120' } },
  firms:    { fn: 'proxy-firms',       qs: {} },
  cyber:    { fn: 'proxy-cyber',       qs: {} },
  outages:  { fn: 'proxy-carrier-outages', qs: {} },
  spacewx:  { fn: 'proxy-spaceweather', qs: {} },
  cables:   { fn: 'proxy-cables',      qs: {} }
};

async function runOne(id) {
  const cfg = LAYERS[id];
  if (!cfg) return { id, ok: false, err: 'unknown layer' };
  const t0 = Date.now();
  try {
    const mod = require('./' + cfg.fn);
    const res = await mod.handler({
      queryStringParameters: cfg.qs,
      httpMethod: 'GET',
      headers: {}
    });
    if (!res || res.statusCode !== 200 || !res.body) {
      return { id, ok: false, err: 'upstream ' + (res && res.statusCode) };
    }
    const data = JSON.parse(res.body);

    // Guard: never publish an empty snapshot over a good one. A transient
    // upstream failure must not blank the layer for every client for the next
    // interval — the pointer keeps aiming at the last good dated key instead.
    const n = Array.isArray(data.features) ? data.features.length
            : Array.isArray(data.events)   ? data.events.length
            : Array.isArray(data)          ? data.length
            : (data && typeof data === 'object' ? Object.keys(data).length : 0);
    if (!n) return { id, ok: false, err: 'empty payload, pointer left unchanged' };

    const out = await publish(id, data);
    const pruned = await prune(id, 24);
    return { id, ok: true, count: n, bytes: out.bytes, key: out.key, pruned, ms: Date.now() - t0 };
  } catch (e) {
    return { id, ok: false, err: e.message, ms: Date.now() - t0 };
  }
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const only = q.l ? q.l.split(',').filter(x => LAYERS[x]) : Object.keys(LAYERS);

  // Sequential on purpose: these hit rate-limited upstreams and the function
  // has a wall-clock budget. Parallel would trip throttling on GDELT.
  const results = [];
  for (const id of only) results.push(await runOne(id));

  return {
    statusCode: 200,
    headers: { ...POINTER_HEADERS, 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      ran: results.length,
      ok: results.filter(r => r.ok).length,
      results
    })
  };
};

// Netlify scheduled function — every 10 minutes.
exports.config = { schedule: '*/10 * * * *' };
