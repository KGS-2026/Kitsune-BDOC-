// js/bdoc-glass-guard.js
// Drops backdrop-filter automatically if the glass is costing too much frame rate.
//
// WHY: backdrop-filter over a live Cesium WebGL canvas is the most expensive
// thing in this UI. It looks right on a desktop GPU and can halve the frame
// rate on an iPad or an integrated-graphics laptop. Rather than pick one
// tradeoff for everyone, measure the actual frame rate and degrade only where
// it is actually hurting.
//
// Sets <html class="no-glass">, which css/bdoc-glass.css handles.

(function () {
  'use strict';

  var SAMPLE_MS = 4000;    // observe this long before judging
  var MIN_FPS = 32;        // below this, glass is not affordable
  var STORE_KEY = 'bdoc_glass_mode';   // 'auto' | 'on' | 'off'

  function setGlass(enabled, reason) {
    document.documentElement.classList.toggle('no-glass', !enabled);
    console.log('[glass] ' + (enabled ? 'enabled' : 'disabled') + (reason ? ' — ' + reason : ''));
  }

  // Explicit user choice always wins over the heuristic.
  var pref = null;
  try { pref = localStorage.getItem(STORE_KEY); } catch (e) { /* private mode */ }
  if (pref === 'off') { setGlass(false, 'user preference'); return; }
  if (pref === 'on') { setGlass(true, 'user preference'); return; }

  // Cheap hardware signals before we spend any frames measuring.
  var cores = navigator.hardwareConcurrency || 4;
  var mem = navigator.deviceMemory || 4;
  if (cores <= 2 || mem <= 2) {
    setGlass(false, 'low-end device (cores=' + cores + ', mem=' + mem + 'GB)');
    return;
  }

  if (!('requestAnimationFrame' in window)) return;

  var frames = 0;
  var start = performance.now();

  function sample(now) {
    frames++;
    var elapsed = now - start;
    if (elapsed < SAMPLE_MS) { requestAnimationFrame(sample); return; }

    var fps = (frames * 1000) / elapsed;
    if (fps < MIN_FPS) {
      setGlass(false, 'measured ' + fps.toFixed(1) + ' fps (< ' + MIN_FPS + ')');
    } else {
      console.log('[glass] keeping glass — ' + fps.toFixed(1) + ' fps');
    }
  }

  // Wait for the globe to finish its initial tile load, or the first seconds
  // of loading would be misread as "the glass is too slow".
  function begin() {
    start = performance.now();
    frames = 0;
    requestAnimationFrame(sample);
  }

  if (document.readyState === 'complete') setTimeout(begin, 6000);
  else window.addEventListener('load', function () { setTimeout(begin, 6000); });

  // Manual override for the operator: BDOCGlass.off() / .on() / .auto()
  window.BDOCGlass = {
    on: function () { try { localStorage.setItem(STORE_KEY, 'on'); } catch (e) {} setGlass(true, 'manual'); },
    off: function () { try { localStorage.setItem(STORE_KEY, 'off'); } catch (e) {} setGlass(false, 'manual'); },
    auto: function () { try { localStorage.removeItem(STORE_KEY); } catch (e) {} location.reload(); }
  };
})();
