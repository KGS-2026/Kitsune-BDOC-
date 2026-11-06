// ============================================================
// BDOC PHASE 2 MODULE: milsymbol-loader.js
// Lazy-loads MIL-STD-2525C military symbology (milsymbol 2.2.0, MIT, from the CDN)
// Only fetched when military layers or the Battle Tracker need it.
// (c) 2026 Kitsune Global Solutions LLC
//
// p175: window.BDOC.loadMilsymbol() returns a promise for the library itself and can be called
// again after a failure (offline → back online). Before, the fetch promise was parked on
// window._milsymbolLoading with no .catch, so a CDN failure raised the red "Background error"
// toast, and LazyLoader kept this file marked loaded so nothing in the session ever retried.
// Keep the URL's basename (milsymbol.min.js): the desktop offline build maps it by that name
// (tools/desktop/vendor.js).
// ============================================================

(function() {
  'use strict';
  var SRC = 'https://cdn.jsdelivr.net/npm/milsymbol@2.2.0/dist/milsymbol.min.js';

  function loadMilsymbol() {
    if (typeof window.ms !== 'undefined' && window.ms && typeof window.ms.Symbol === 'function') return Promise.resolve(window.ms);
    if (window._milsymbolLoading) return window._milsymbolLoading;

    var p = new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      var done = false;
      var timeout = setTimeout(function() { finish(new Error('milsymbol load timeout')); }, 15000);
      function finish(err) {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        script.onload = script.onerror = null;
        if (err) {
          try { script.parentNode && script.parentNode.removeChild(script); } catch (_) {}
          console.warn('[milsymbol-loader]', err.message);
          reject(err);
        } else if (typeof window.ms === 'undefined') {
          reject(new Error('milsymbol loaded but window.ms is missing'));
        } else {
          resolve(window.ms);
        }
      }
      script.src = SRC;
      script.crossOrigin = 'anonymous';
      script.onload = function() { finish(null); };
      script.onerror = function() { finish(new Error('milsymbol CDN failed')); };
      document.head.appendChild(script);
    });

    window._milsymbolLoading = p;
    // clear the slot either way, so the next call after a failure tries again
    p.then(function() { if (window._milsymbolLoading === p) delete window._milsymbolLoading; },
           function() { if (window._milsymbolLoading === p) delete window._milsymbolLoading; });
    return p;
  }

  window.BDOC = window.BDOC || {};
  window.BDOC.loadMilsymbol = loadMilsymbol;
  // start right away as before (callers that only check `typeof ms` keep working); handled here,
  // so a failure is a console warning and the callers' own fallbacks, not an unhandled rejection
  loadMilsymbol().catch(function() {});
})();
