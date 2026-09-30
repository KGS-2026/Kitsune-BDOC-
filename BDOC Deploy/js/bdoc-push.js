/* BDOC — Push alerts client (p140)
 *
 * Bridges the browser's PushManager to /.netlify/functions/push-subscribe so
 * OutageWatch / sentinel alerts reach a phone with the tab closed.
 *
 * Design notes:
 *  - NEVER auto-prompts. An unsolicited notification permission prompt on first
 *    load is the fastest way to get permanently denied. Arming is user-initiated
 *    (BDOCPush.enable()) or resumed silently if already granted.
 *  - Re-registers the subscription on every boot when permission is granted, so
 *    a store wipe or a rotated endpoint self-heals.
 *  - Data-gates every response: the BDOC service worker returns {offline:true}
 *    with HTTP 200 on failed fetches, so status checks alone are not enough.
 */
(function () {
  'use strict';

  var EP = '/.netlify/functions/push-subscribe';
  var LS = 'bdoc_push_state';

  function urlB64ToUint8(base64) {
    var pad = '='.repeat((4 - base64.length % 4) % 4);
    var b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function supported() {
    return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  }

  function state() {
    try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (_) { return {}; }
  }
  function setState(o) {
    try { localStorage.setItem(LS, JSON.stringify(o)); } catch (_) {}
  }

  async function serverKey() {
    var r = await fetch(EP, { cache: 'no-store' });
    var j = await r.json();
    // SW offline sentinel comes back 200 — gate on data presence, not status.
    if (!j || j.offline || !j.publicKey) throw new Error('push service unavailable');
    return j;
  }

  async function register(tier, label) {
    var cfg = await serverKey();
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8(cfg.publicKey)
      });
    }
    var body = { subscription: sub.toJSON ? sub.toJSON() : sub };
    if (tier) body.tier = tier;
    if (label) body.label = label;
    var pr = await fetch(EP, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var pj = await pr.json();
    if (!pj || pj.offline || !pj.ok) throw new Error((pj && pj.error) || 'subscribe rejected');
    setState({ enabled: true, endpoint: sub.endpoint, at: Date.now(), sendReady: !!cfg.sendReady });
    return { ok: true, endpoint: sub.endpoint, sendReady: !!cfg.sendReady };
  }

  var API = {
    supported: supported,

    status: function () {
      var st = state();
      return {
        supported: supported(),
        permission: ('Notification' in window) ? Notification.permission : 'unsupported',
        enabled: !!st.enabled,
        endpoint: st.endpoint || null,
        sendReady: !!st.sendReady
      };
    },

    // User-initiated. Prompts for permission, then subscribes.
    enable: async function (tier, label) {
      if (!supported()) throw new Error('push not supported in this browser');
      var perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState({ enabled: false, denied: perm === 'denied' }); throw new Error('permission ' + perm); }
      return register(tier, label);
    },

    disable: async function () {
      var out = { ok: true };
      try {
        var reg = await navigator.serviceWorker.ready;
        var sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch(EP, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unsubscribe: true, endpoint: sub.endpoint })
          });
          await sub.unsubscribe();
          out.endpoint = sub.endpoint;
        }
      } catch (e) { out.warn = String(e && e.message); }
      setState({ enabled: false });
      return out;
    },

    // Boot resume: silent, no prompt. Refreshes a possibly-stale registration.
    _resume: async function () {
      if (!supported()) return;
      if (Notification.permission !== 'granted') return;
      var st = state();
      if (!st.enabled) return;
      try { await register(st.tier, st.label); } catch (_) { /* stay quiet on boot */ }
    }
  };

  window.BDOCPush = API;

  // Handle SW -> page navigation requests from notification clicks.
  try {
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'PUSH_NAV' && e.data.url) {
        try { history.replaceState(null, '', e.data.url); } catch (_) {}
        try { window.dispatchEvent(new CustomEvent('bdoc-push-nav', { detail: e.data })); } catch (_) {}
      }
    });
  } catch (_) {}

  // Resume after the globe settles — never compete with first paint.
  if (document.readyState === 'complete') setTimeout(function () { API._resume(); }, 4000);
  else window.addEventListener('load', function () { setTimeout(function () { API._resume(); }, 4000); });

  // ── Settings-panel binding (index.html #setPush / #pushStatus) ────────────
  function say(msg, col) {
    var el = document.getElementById('pushStatus');
    if (el) { el.textContent = msg; el.style.color = col || 'var(--t3)'; }
  }

  function refreshUI() {
    var el = document.getElementById('setPush');
    var st = API.status();
    if (!st.supported) {
      if (el) { el.checked = false; el.disabled = true; }
      say('Not supported in this browser.');
      return;
    }
    if (el) { el.checked = st.enabled && st.permission === 'granted'; el.disabled = false; }
    if (st.permission === 'denied') {
      if (el) el.disabled = true;
      say('Blocked in browser settings — re-allow notifications for this site to enable.', '#DA3633');
    } else if (st.enabled) {
      // Be honest when the server half is not configured: the user is
      // subscribed but nothing can actually be sent to them yet.
      say(st.sendReady ? 'Armed. Critical outage/crisis alerts will reach this device.'
                       : 'Subscribed — server signing key not yet configured, so no alerts will send.',
          st.sendReady ? '#3FB950' : '#E8B349');
    } else {
      say('Off. Turn on to get critical alerts with BDOC closed.');
    }
  }

  window.togglePushAlerts = async function (on) {
    var el = document.getElementById('setPush');
    try {
      if (on) { say('Requesting permission…', '#E8B349'); await API.enable(); }
      else { say('Turning off…'); await API.disable(); }
    } catch (e) {
      if (el) el.checked = false;
      say('Could not enable: ' + (e && e.message ? e.message : 'unknown error'), '#DA3633');
      return;
    }
    refreshUI();
  };

  API._refreshUI = refreshUI;
  if (document.readyState !== 'loading') setTimeout(refreshUI, 1500);
  else document.addEventListener('DOMContentLoaded', function () { setTimeout(refreshUI, 1500); });
})();
