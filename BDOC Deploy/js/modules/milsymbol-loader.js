// ============================================================
// BDOC PHASE 2 MODULE: milsymbol-loader.js
// Lazy-loads MIL-STD-2525C military symbology (763KB from CDN)
// Only fetched when military layers are toggled on.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

(function() {
  'use strict';
  
  // Guard: if already loaded or loading, return the promise
  if (window._milsymbolLoading) {
    return window._milsymbolLoading;
  }
  if (typeof window.ms !== 'undefined') {
    // Already loaded
    return Promise.resolve();
  }

  // Create a promise that resolves when the script loads
  window._milsymbolLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/milsymbol@2.2.0/dist/milsymbol.min.js';
    script.crossOrigin = 'anonymous';
    
    script.onload = () => {
      delete window._milsymbolLoading;
      resolve();
    };
    
    script.onerror = (err) => {
      delete window._milsymbolLoading;
      console.error('[milsymbol-loader] failed to load CDN script', err);
      reject(new Error('milsymbol CDN failed'));
    };
    
    // 15-second timeout
    const timeout = setTimeout(() => {
      delete window._milsymbolLoading;
      script.onerror = null; // Prevent double-fire
      console.error('[milsymbol-loader] load timeout');
      reject(new Error('milsymbol load timeout'));
    }, 15000);
    
    script.onload = (() => {
      clearTimeout(timeout);
      delete window._milsymbolLoading;
      resolve();
    });
    
    script.onerror = (() => {
      clearTimeout(timeout);
      delete window._milsymbolLoading;
      console.error('[milsymbol-loader] CDN failed');
      reject(new Error('milsymbol CDN failed'));
    });
    
    document.head.appendChild(script);
  });

  return window._milsymbolLoading;
})();
