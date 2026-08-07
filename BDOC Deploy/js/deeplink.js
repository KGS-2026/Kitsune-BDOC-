/* ============================================================================
   BDOC DEEP-LINK / URL-AS-STATE  (P115)
   Competitor recon (guerillamap, celltowerfinder, ATOC) converged on one
   highest-ROI pattern: the entire view is a shareable URL. Every theater view
   an operator posts to Discord/X/a SITREP renders OUR product, OUR branding,
   to a pre-qualified stranger — organic reach with zero marketing spend, and
   it feeds straight into the Stripe funnel.

   Mechanism (all client-side, zero credentials, zero backend):
     - serialize the live `layers` map + Cesium camera to the URL hash, debounced
     - on load, parse the hash and restore camera + re-activate the saved layers
     - copy-link affordance via BDOC.DeepLink.copy()

   State lives in the URL HASH (not query) so it never hits the server and is
   pure client concern — matches guerillamap's "we store nothing about you"
   OPSEC posture, which is itself a sales argument to the grid-down segment.

   Hash shape (compact, human-inspectable):
     #v=1&c=45.20,33.70,120000&h=0,-45&l=warlive,conf,outages,gnss
       c = lon,lat,height(m)     h = heading,pitch(deg)     l = active layer ids
   ========================================================================== */
(function () {
  'use strict';
  var VERSION = 1;
  var SAVE_DEBOUNCE_MS = 450;
  var _saveTimer = null;
  var _restoring = false;   // guard: don't save while we're applying a restore
  var _booted = false;

  function V() { return (typeof window.V !== 'undefined') ? window.V : null; }
  function layersMap() { return (typeof window.layers !== 'undefined') ? window.layers : null; }

  // ---- SERIALIZE ------------------------------------------------------------
  function readCamera() {
    var v = V();
    if (!v || !v.camera) return null;
    try {
      var c = v.camera.positionCartographic;
      if (!c) return null;
      var lon = Cesium.Math.toDegrees(c.longitude);
      var lat = Cesium.Math.toDegrees(c.latitude);
      var h = c.height;
      var heading = Cesium.Math.toDegrees(v.camera.heading);
      var pitch = Cesium.Math.toDegrees(v.camera.pitch);
      return { lon: lon, lat: lat, h: h, heading: heading, pitch: pitch };
    } catch (e) { return null; }
  }

  function activeLayerIds() {
    var L = layersMap();
    if (!L) return [];
    var out = [];
    for (var k in L) { if (L[k] === true) out.push(k); }
    return out;
  }

  function buildHash() {
    var parts = ['v=' + VERSION];
    var cam = readCamera();
    if (cam) {
      parts.push('c=' + cam.lon.toFixed(3) + ',' + cam.lat.toFixed(3) + ',' + Math.round(cam.h));
      parts.push('h=' + Math.round(cam.heading) + ',' + Math.round(cam.pitch));
    }
    var ls = activeLayerIds();
    if (ls.length) parts.push('l=' + ls.join(','));
    return '#' + parts.join('&');
  }

  function save() {
    if (_restoring || !_booted) return;
    try {
      var hash = buildHash();
      if (('#' + location.hash.replace(/^#/, '')) === hash) return; // no-op
      history.replaceState(null, '', location.pathname + location.search + hash);
    } catch (e) { /* non-fatal */ }
  }

  function scheduleSave() {
    if (_restoring || !_booted) return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS);
  }

  // ---- PARSE ----------------------------------------------------------------
  function parseHash(hash) {
    var h = (hash || location.hash || '').replace(/^#/, '');
    if (!h) return null;
    var kv = {};
    h.split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i < 0) return;
      kv[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
    });
    if (!kv.v) return null;
    var out = { layers: [] };
    if (kv.c) {
      var c = kv.c.split(',').map(Number);
      if (c.length >= 3 && c.every(function (n) { return isFinite(n); })) {
        out.camera = { lon: c[0], lat: c[1], h: c[2] };
      }
    }
    if (kv.h && out.camera) {
      var hp = kv.h.split(',').map(Number);
      if (hp.length >= 2 && hp.every(function (n) { return isFinite(n); })) {
        out.camera.heading = hp[0]; out.camera.pitch = hp[1];
      }
    }
    if (kv.l) out.layers = kv.l.split(',').filter(Boolean);
    return out;
  }

  // ---- RESTORE --------------------------------------------------------------
  function applyCamera(cam) {
    var v = V();
    if (!v || !v.camera || !cam) return;
    try {
      var opts = { destination: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, cam.h), duration: 0 };
      if (typeof cam.heading === 'number' && typeof cam.pitch === 'number') {
        opts.orientation = {
          heading: Cesium.Math.toRadians(cam.heading),
          pitch: Cesium.Math.toRadians(cam.pitch),
          roll: 0
        };
      }
      v.camera.flyTo(opts);
    } catch (e) { /* non-fatal */ }
  }

  function applyLayers(ids) {
    if (!ids || !ids.length) return;
    var L = layersMap();
    ids.forEach(function (id) {
      try {
        var el = document.querySelector('.ly[data-layer="' + id + '"]');
        if (!el) return;
        // Only toggle ON if currently off — togLy() flips state.
        var isOn = el.classList.contains('on') || (L && L[id] === true);
        if (!isOn && typeof window.togLy === 'function') window.togLy(el);
      } catch (e) { /* skip bad id */ }
    });
  }

  function restore() {
    var st = parseHash();
    if (!st) return false;
    _restoring = true;
    try {
      applyCamera(st.camera);
      applyLayers(st.layers);
    } finally {
      // release the guard after the toggles settle, then persist current truth
      setTimeout(function () { _restoring = false; scheduleSave(); }, 800);
    }
    return true;
  }

  // ---- COPY / SHARE ---------------------------------------------------------
  function currentUrl() {
    return location.origin + location.pathname + location.search + buildHash();
  }
  function copy() {
    var url = currentUrl();
    var done = function (ok) {
      try {
        if (typeof window.af === 'function') {
          window.af(ok ? 'var(--gn)' : 'var(--yl)', ok ? 'View link copied — share it anywhere' : 'Copy failed — link: ' + url);
        }
      } catch (_) {}
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = url; document.body.appendChild(ta); ta.select();
        var ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta); done(ok);
      }
    } catch (e) { done(false); }
    return url;
  }

  // ---- WIRE-UP --------------------------------------------------------------
  function boot() {
    var v = V();
    if (!v || !v.scene || typeof window.togLy !== 'function') {
      return setTimeout(boot, 300); // wait for Cesium + togLy
    }
    // 1) restore any incoming shared view BEFORE we start saving
    var hadState = false;
    try { hadState = restore(); } catch (e) { hadState = false; }

    // 2) persist on camera settle (moveEnd fires after fly/drag/zoom stops)
    try { v.camera.moveEnd.addEventListener(scheduleSave); } catch (e) {}

    // 3) persist on layer toggles — wrap togLy so every toggle re-serializes
    if (!window.togLy.__deeplinkWrapped) {
      var _orig = window.togLy;
      window.togLy = function () {
        var r = _orig.apply(this, arguments);
        scheduleSave();
        return r;
      };
      window.togLy.__deeplinkWrapped = true;
    }

    _booted = true;
    if (!hadState) scheduleSave(); // seed the URL with the default view
  }

  window.BDOC = window.BDOC || {};
  window.BDOC.DeepLink = {
    save: scheduleSave,
    restore: restore,
    copy: copy,
    url: currentUrl,
    _buildHash: buildHash,
    _parseHash: parseHash
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 100);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 100); });
  }
})();
