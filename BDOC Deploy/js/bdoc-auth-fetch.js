/* BDOC auth fetch (p157)
 *
 * Attaches the signed-in user's Supabase access token to every same-origin call
 * to /.netlify/functions/* and /api/*, so netlify/functions/_lib/guard.js can
 * enforce tier SERVER-SIDE.
 *
 * Why a fetch wrapper instead of editing call sites: there are ~40 of them
 * across index.html and js/modules/*. Editing each one is 40 chances to miss a
 * gated endpoint, and every new layer added later would have to remember. One
 * wrapper covers all of them, now and in future.
 *
 * SECURITY INVARIANT — the token is attached ONLY to:
 *   - our own origin, on the function paths above
 *   - the local bridge on 127.0.0.1:9876 (its own separate pairing token)
 * It is never attached to USGS, NOAA, OpenSky, Cesium Ion, or any other host.
 * Getting this wrong would leak a session token to third parties, so the origin
 * check is deliberately strict and runs before anything else.
 *
 * Load order: AFTER js/auth.js (needs window.Auth.client), BEFORE any layer
 * module that fetches.
 */
(function () {
  'use strict';

  if (window.__bdocAuthFetchInstalled) return;   // idempotent
  window.__bdocAuthFetchInstalled = true;

  var nativeFetch = window.fetch.bind(window);
  var FN_PATH = /^\/(?:\.netlify\/functions|api)\//;

  function parseUrl(input) {
    try {
      var raw = typeof input === 'string' ? input
              : (input && input.url) ? input.url
              : String(input);
      return new URL(raw, location.href);
    } catch (_) { return null; }
  }

  function isOurFunction(u) {
    return !!u && u.origin === location.origin && FN_PATH.test(u.pathname);
  }

  function isLocalBridge(u) {
    return !!u
      && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
      && (u.port === '9876');
  }

  function bridgeToken() {
    try { return localStorage.getItem('bdoc_bridge_token') || ''; }
    catch (_) { return ''; }
  }

  async function currentToken() {
    try {
      var c = window.Auth && window.Auth.client;
      if (!c || !c.auth) return null;
      // getSession() refreshes the token if it is close to expiry.
      var res = await c.auth.getSession();
      return (res && res.data && res.data.session && res.data.session.access_token) || null;
    } catch (_) { return null; }
  }

  window.fetch = async function (input, init) {
    var u = parseUrl(input);

    // Local IPC bridge: send its pairing token, never the Supabase JWT.
    if (isLocalBridge(u)) {
      var bt = bridgeToken();
      if (!bt) return nativeFetch(input, init);
      var bh = new Headers((init && init.headers) || undefined);
      bh.set('X-BDOC-Bridge', bt);
      return nativeFetch(input, Object.assign({}, init || {}, { headers: bh }));
    }

    // Anything that is not our own function endpoint goes through untouched.
    if (!isOurFunction(u)) return nativeFetch(input, init);

    var token = await currentToken();
    if (!token) return nativeFetch(input, init);   // guest: guard allows recon layers

    var headers = new Headers(
      (init && init.headers) ||
      (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined)
    );
    if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);

    if (typeof Request !== 'undefined' && input instanceof Request) {
      return nativeFetch(new Request(input, Object.assign({}, init || {}, { headers: headers })));
    }
    return nativeFetch(input, Object.assign({}, init || {}, {
      headers: headers,
      credentials: 'same-origin'
    }));
  };

  // Exposed for tests / debugging.
  window.BDOCAuthFetch = { isOurFunction: isOurFunction, isLocalBridge: isLocalBridge };
})();
