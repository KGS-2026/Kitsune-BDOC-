// ============================================================
// BDOC snapshot-client.js — pointer-first layer fetch (P122)
// ============================================================
// TECHNIQUE SOURCE: Google Earth Web recon §4.2 + WeatherWise §4.1.
//
// Google Earth's clouds-cubemap/root.json is 83 bytes and holds one field: a
// baseUrl pointing at a dated immutable snapshot directory. WeatherWise's
// socket does the same thing over a different transport — it broadcasts a URL,
// never a payload. Both get the same three wins:
//
//   1. Origin cost stops scaling with audience. 1 writer, N edge readers.
//   2. Backfill and live share ONE code path (an older key is just another key).
//   3. Offline is free — immutable objects are trivially service-worker cached.
//
// This module is the client half. Call BDOCSnap.fetchLayer('events') and it:
//   - polls the tiny pointer (max-age=60)
//   - fetches the dated snapshot (immutable, almost always an edge/SW hit)
//   - stashes the last good result in localStorage
//   - on total failure, RETURNS THE STALE SNAPSHOT with an honest age instead
//     of throwing — "last good snapshot, 14 min ago" beats a blank layer for a
//     grid-down operator, which is the entire point.
//
// Falls back to the live proxy URL when no snapshot has been published yet, so
// adopting this is non-breaking: layers work exactly as before, just cheaper.

(function () {
  'use strict';

  var PTR   = '/.netlify/functions/layer-root?l=';
  var LSKEY = 'bdoc_snap_';
  var mem   = new Map();      // layer -> { key, data, at }
  var inflight = new Map();   // dedupe concurrent callers (radio.garden LRU idea)

  function lsGet(layer) {
    try {
      var raw = localStorage.getItem(LSKEY + layer);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function lsSet(layer, key, data, generated) {
    try {
      localStorage.setItem(LSKEY + layer, JSON.stringify({
        key: key, data: data, generated: generated, at: Date.now()
      }));
    } catch (_) { /* quota — non-fatal, memory cache still works */ }
  }

  function ageLabel(iso) {
    if (!iso) return 'unknown age';
    var m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    return h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago';
  }

  // fetchLayer(layer, liveUrl) -> { data, source, key, generated, age, stale }
  //   source: 'memory' | 'snapshot' | 'live' | 'cache-stale'
  function fetchLayer(layer, liveUrl, opts) {
    opts = opts || {};
    if (inflight.has(layer)) return inflight.get(layer);

    var p = (async function () {
      var ptr = null;
      try {
        var pr = await fetch(PTR + encodeURIComponent(layer), {
          signal: AbortSignal.timeout(opts.ptrTimeout || 6000)
        });
        if (pr.ok) ptr = await pr.json();
      } catch (_) { /* pointer unreachable — handled below */ }

      // Snapshot path (the fast, cheap, cacheable one)
      if (ptr && ptr.baseUrl && ptr.key) {
        var hit = mem.get(layer);
        if (hit && hit.key === ptr.key) {
          return { data: hit.data, source: 'memory', key: ptr.key,
                   generated: ptr.generated, age: ageLabel(ptr.generated), stale: false };
        }
        var cached = lsGet(layer);
        if (cached && cached.key === ptr.key) {
          mem.set(layer, { key: ptr.key, data: cached.data, at: Date.now() });
          return { data: cached.data, source: 'snapshot', key: ptr.key,
                   generated: ptr.generated, age: ageLabel(ptr.generated), stale: false };
        }
        try {
          // 'force-cache' is correct here and NOT a bug: the key is dated and
          // the bytes are immutable, so a cache hit can never be wrong.
          var sr = await fetch(ptr.baseUrl, {
            cache: 'force-cache',
            signal: AbortSignal.timeout(opts.snapTimeout || 12000)
          });
          if (sr.ok) {
            var data = await sr.json();
            mem.set(layer, { key: ptr.key, data: data, at: Date.now() });
            lsSet(layer, ptr.key, data, ptr.generated);
            return { data: data, source: 'snapshot', key: ptr.key,
                     generated: ptr.generated, age: ageLabel(ptr.generated), stale: false };
          }
        } catch (_) { /* fall through to live */ }
      }

      // Live path — no snapshot published yet, or snapshot fetch failed.
      if (liveUrl) {
        try {
          var lr = await fetch(liveUrl, { signal: AbortSignal.timeout(opts.liveTimeout || 25000) });
          if (lr.ok) {
            var ld = await lr.json();
            lsSet(layer, 'live', ld, new Date().toISOString());
            return { data: ld, source: 'live', key: null,
                     generated: new Date().toISOString(), age: 'just now', stale: false };
          }
        } catch (_) { /* fall through to stale */ }
      }

      // GRID-DOWN PATH. Everything upstream failed. Return the last good bytes
      // with an honest age rather than nothing. An operator can act on
      // "14 min old"; they cannot act on an empty map.
      var last = lsGet(layer);
      if (last && last.data) {
        return { data: last.data, source: 'cache-stale', key: last.key,
                 generated: last.generated, age: ageLabel(last.generated), stale: true };
      }
      return { data: null, source: 'none', key: null, generated: null, age: null, stale: true };
    })();

    inflight.set(layer, p);
    p.finally(function () { inflight.set(layer, null); inflight.delete(layer); });
    return p;
  }

  // Badge text a layer row can render verbatim.
  function provenance(r) {
    if (!r || !r.data) return 'NO DATA';
    if (r.stale) return 'STALE · last good ' + r.age;
    if (r.source === 'live') return 'LIVE · direct';
    return 'SNAPSHOT · ' + r.age;
  }

  window.BDOCSnap = {
    fetchLayer: fetchLayer,
    provenance: provenance,
    ageLabel: ageLabel,
    _mem: mem
  };
  console.log('[BDOCSnap] pointer-first layer client ready (P122)');
})();
