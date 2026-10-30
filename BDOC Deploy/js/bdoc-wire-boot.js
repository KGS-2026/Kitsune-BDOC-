/* BDOC LIVE WIRE boot (p160)
 *
 * Loads for every visitor, so it stays tiny. The feed itself (js/bdoc-wire.js and
 * css/bdoc-wire.css) is fetched only when the owner clicks WIRE.
 *
 * Its one job: ask the server whether the signed-in user is the owner, and draw
 * the top-bar item if the answer is yes. The server is the gate, see
 * netlify/functions/_lib/owner.mjs. Nothing in this file is a secret, and forcing
 * the item to appear gets you a panel full of 403s.
 *
 * WHY THE TOKEN IS ATTACHED BY HAND: the probe already holds the session, because
 * it needs the user id. bdoc-auth-fetch.js leaves a header it finds alone.
 *
 * WHY THE AUTH CALLBACK IS ONE LINE: awaiting Supabase inside onAuthStateChange
 * is the documented supabase-js v2 deadlock (p157 note in js/auth.js), and
 * getSession() is exactly such a call. setTimeout(0) runs it after the lock is
 * released.
 *
 * WHY THE USER ID IS REMEMBERED: SIGNED_IN also fires every time a tab regains
 * focus, and a non-owner must not be re-probed on each alt-tab.
 *
 * Every failure here is silent: a broken wire must never reach a paying customer's
 * map. A signed-in non-owner gets 200 {owner:false}, so nothing lands in the console.
 */
(function () {
  'use strict';

  var VERSION = 'p160';
  var PROBE_URL = '/.netlify/functions/wire?probe=1';

  // Only for 5xx and network errors. A 401 or 403 is an answer, not a failure.
  var RETRY_MS = [5000, 20000, 60000];

  // BDOC_Auth.init() runs from bootFeeds, at the end of cesium-init.js, so on a
  // slow link it can start long after this file. Nothing announces when it ends.
  var AUTH_POLL_MS = 500;
  var AUTH_POLL_MAX = 600;

  var CSS_WAIT_MS = 2000;

  var client = null;
  var uid = null;          // the user the current verdict belongs to
  var item = null;         // the top-bar element, the owner's only
  var countEl = null;
  var countWired = false;  // the module outlives the item, so subscribe only once
  var panelLoad = null;

  function setCount(n) {
    if (!countEl) return;
    countEl.textContent = n > 99 ? '99+' : String(n);
    countEl.style.display = n > 0 ? '' : 'none';
  }

  function removeItem() {
    if (item) item.remove();
    item = countEl = null;
    // Sign-out must also clear the feed off the screen, not just the button.
    try { if (window.BDOCWire && window.BDOCWire.close) window.BDOCWire.close(); } catch (_) {}
  }

  function loadPanel() {
    if (window.BDOCWire) return Promise.resolve();
    if (!panelLoad) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'css/bdoc-wire.css?v=' + VERSION;
      var js = document.createElement('script');
      js.src = 'js/bdoc-wire.js?v=' + VERSION;

      // The panel paints the moment open() runs, so it waits for its stylesheet: an
      // unstyled flash of the whole feed looks broken. Not for long, though, because a
      // stalled CSS file must never cost the owner the feed. A failed link is removed
      // so the module's own ensureCss() gets a second try at it.
      var styled = new Promise(function (done) {
        css.onload = done;
        css.onerror = function () { css.remove(); done(); };
        setTimeout(done, CSS_WAIT_MS);
      });
      var scripted = new Promise(function (resolve, reject) {
        js.onload = resolve;
        js.onerror = function () {
          css.remove();
          js.remove();
          panelLoad = null;     // the next click gets a clean retry
          reject();
        };
      });
      panelLoad = Promise.all([styled, scripted]);
      document.head.appendChild(css);
      document.head.appendChild(js);
    }
    return panelLoad;
  }

  function openPanel() {
    loadPanel().then(function () {
      var wire = window.BDOCWire;
      if (!countWired && wire.onCount) {
        countWired = true;
        wire.onCount(setCount);
      }
      wire.open({ client: window.BDOC_Auth.client, embedded: true });
    }).catch(function () {});
  }

  function drawItem() {
    var clk = document.querySelector('.tb-r #clk');
    if (item || !clk) return;

    item = document.createElement('div');
    item.className = 'st';
    item.id = 'bdocWireItem';
    item.title = 'LIVE WIRE';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.style.cursor = 'pointer';

    // Amber, not the .dt-g green its siblings use: this item appearing proves the
    // user is the owner, not that the collector is alive (spec rule 6).
    var dot = document.createElement('div');
    dot.className = 'dt';
    dot.style.background = '#E8B349';

    countEl = document.createElement('span');
    countEl.style.color = '#E8B349';
    countEl.style.display = 'none';

    item.appendChild(dot);
    item.appendChild(document.createTextNode('WIRE'));
    item.appendChild(countEl);
    item.addEventListener('click', openPanel);
    item.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel(); }
    });

    clk.parentNode.insertBefore(item, clk);
  }

  async function probe(id, attempt) {
    var transient = false;
    try {
      var got = await client.auth.getSession();
      var session = got && got.data && got.data.session;
      if (!session || id !== uid) return;

      var res = await fetch(PROBE_URL, {
        headers: { Authorization: 'Bearer ' + session.access_token },
        cache: 'no-store'
      });
      transient = res.status >= 500;
      if (res.status === 200) {
        var body = await res.json();
        // The user may have signed out while this was in flight.
        if (id === uid && body && body.owner === true) drawItem();
      }
    } catch (_) {
      transient = true;
    }
    if (!transient || id !== uid) return;
    if (attempt < RETRY_MS.length) {
      setTimeout(function () { if (id === uid) probe(id, attempt + 1); }, RETRY_MS[attempt]);
    } else {
      uid = null;   // still no verdict: the next auth event, like a tab refocus, asks again
    }
  }

  async function syncSession() {
    try {
      var got = await client.auth.getSession();
      var session = got && got.data && got.data.session;
      var id = (session && session.user && session.user.id) || null;
      if (id === uid) return;
      removeItem();
      uid = id;
      if (id) probe(id, 0);
    } catch (_) {}
  }

  function start(c) {
    client = c;
    try {
      c.auth.onAuthStateChange(function () { setTimeout(syncSession, 0); });
    } catch (_) {}
    syncSession();
  }

  (function waitForAuth(tries) {
    var auth = window.BDOC_Auth;
    if (auth && auth._initialized) {
      if (auth.client) start(auth.client);   // no client: guest mode, nothing to do
      return;
    }
    if (tries < AUTH_POLL_MAX) {
      setTimeout(function () { waitForAuth(tries + 1); }, AUTH_POLL_MS);
    }
  })(0);
})();
