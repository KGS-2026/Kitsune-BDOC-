// ============================================================
// bdoc-gov-alert.js — FEMA national alerts across the top of BDOC (p181).
//
// Phones cannot hand a cell-broadcast alert to an app, and the 2026-11-17
// nationwide test is TV and radio only. FEMA publishes the same message through
// IPAWS, so BDOC reads it (gov-alert function) and shows FEMA's own words here,
// on every plan, signed in or not. Polls every 30 s while open; the push half is
// gov-alert-tick.mjs.
//
// Everything from the feed goes in with textContent. Nothing here builds HTML.
// Console: BDOCGovAlert.demo() shows a sample banner; BDOCGovAlert.poll() checks now.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
(function () {
  'use strict';

  var ENDPOINT = '/.netlify/functions/gov-alert';
  var POLL_MS = 30000;
  var LS_DISMISSED = 'bdoc_gov_alert_dismissed';
  var last = [];
  var demoItem = null;
  var current = null;
  var lastCheck = null;

  function dismissed() {
    try {
      var a = JSON.parse(localStorage.getItem(LS_DISMISSED) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (_) { return []; }
  }

  function dismiss(id) {
    try {
      var a = dismissed().filter(function (x) { return x !== id; });
      a.push(id);
      localStorage.setItem(LS_DISMISSED, JSON.stringify(a.slice(-30)));
    } catch (_) {}
  }

  function words(n) {
    var es = /^es\b/i.test(navigator.language || '');
    return (es && n.langs.es) || n.langs.en || n.langs.es || {};
  }

  function clock(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function label(n) {
    var l = n.kind === 'emergency' ? (n.presidential ? 'PRESIDENTIAL ALERT' : 'NATIONAL ALERT')
      : n.kind === 'test' ? (n.code === 'NPT' ? 'NATIONWIDE TEST' : 'NATIONAL ALERT TEST')
      : 'FEMA NOTICE';
    return n.demo ? 'DEMO · ' + l : l;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function ensureStyle() {
    if (document.getElementById('bdocGovAlertCss')) return;
    var s = document.createElement('style');
    s.id = 'bdocGovAlertCss';
    s.textContent =
      '.gova{position:fixed;top:0;left:0;right:0;z-index:2147483000;color:#fff;padding:10px 16px 8px;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.55);border-bottom:2px solid rgba(255,255,255,.35);max-height:45vh;overflow:auto;' +
      'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
      '.gova-emergency{background:#B3121B}.gova-test{background:#7A4E00}.gova-notice{background:#0F3D6E}' +
      '.gova-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
      '.gova-chip{font:700 11px/1.4 var(--m,ui-monospace,monospace);letter-spacing:.08em;padding:2px 8px;border:1px solid rgba(255,255,255,.85);border-radius:3px;white-space:nowrap}' +
      '.gova-head{font-weight:700;font-size:15px;flex:1 1 220px;min-width:0}' +
      '.gova-x{background:transparent;border:1px solid rgba(255,255,255,.6);color:#fff;font-size:15px;line-height:1;padding:6px 10px;border-radius:3px;cursor:pointer;margin-left:auto}' +
      '.gova-x:hover,.gova-x:focus-visible{background:rgba(255,255,255,.15)}' +
      '.gova-text{font-size:13px;line-height:1.45;margin-top:6px;max-width:1100px}' +
      '.gova-meta{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font:11px/1.4 var(--m,ui-monospace,monospace);opacity:.9;margin-top:6px}' +
      '.gova-btn{color:#fff;border:1px solid rgba(255,255,255,.7);padding:2px 8px;border-radius:3px;text-decoration:none;font-weight:700}' +
      '@media (prefers-reduced-motion:no-preference){.gova-emergency{animation:govaPulse 1.6s ease-in-out 3}}' +
      '@keyframes govaPulse{50%{background:#E01E2B}}';
    document.head.appendChild(s);
  }

  function render(n) {
    var box = document.getElementById('bdocGovAlert');
    if (!n) {
      if (box) box.remove();
      document.documentElement.classList.remove('gov-alert-on');
      current = null;
      return;
    }
    if (box && current && current.id === n.id) return;   // same alert: no redraw every poll
    if (box) box.remove();
    current = n;

    var w = words(n);
    box = el('div', 'gova gova-' + (n.kind === 'emergency' || n.kind === 'test' ? n.kind : 'notice'));
    box.id = 'bdocGovAlert';
    box.setAttribute('role', n.kind === 'emergency' ? 'alert' : 'status');
    box.setAttribute('aria-live', n.kind === 'emergency' ? 'assertive' : 'polite');

    var top = el('div', 'gova-top');
    top.appendChild(el('span', 'gova-chip', label(n)));
    top.appendChild(el('span', 'gova-head', w.headline || w.event || ''));
    var x = el('button', 'gova-x', '✕');
    x.type = 'button';
    x.title = 'Dismiss';
    x.setAttribute('aria-label', 'Dismiss this alert');
    x.addEventListener('click', function () { dismiss(n.id); render(null); show(); });
    top.appendChild(x);
    box.appendChild(top);

    if (w.text) box.appendChild(el('div', 'gova-text', w.text));
    if (w.instruction) box.appendChild(el('div', 'gova-text', w.instruction));

    var meta = el('div', 'gova-meta');
    meta.appendChild(el('span', null,
      (n.demo ? 'BDOC demo' : 'FEMA IPAWS') + ' · sent ' + clock(n.sent) + ' · until ' + clock(n.expires) +
      (n.partial ? ' · FEMA’s full text not readable yet' : '')));
    if (w.audio && /^https:\/\/[^\s"'<>]+$/i.test(w.audio)) {
      var a = el('a', 'gova-btn', '▶ LISTEN');
      a.href = w.audio;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      meta.appendChild(a);
    }
    box.appendChild(meta);

    ensureStyle();
    document.body.appendChild(box);
    document.documentElement.classList.add('gov-alert-on');
  }

  // Most urgent active alert the user has not dismissed (the server sorts them).
  // A real alert always wins over the demo.
  function show() {
    var now = Date.now(), gone = dismissed(), pick = null;
    var list = demoItem ? last.concat([demoItem]) : last;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n && n.id && n.langs && Date.parse(n.expires) > now && gone.indexOf(n.id) < 0) { pick = n; break; }
    }
    render(pick);
  }

  function poll() {
    if (navigator.onLine === false) { show(); return Promise.resolve(); }
    return fetch(ENDPOINT, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && Array.isArray(d.national)) {
          last = d.national.filter(function (n) { return n && !n.demo; });
          lastCheck = d.checked || new Date().toISOString();
        }
        show();
      })
      .catch(function () { show(); });
  }

  function demo(kind) {
    var now = Date.now();
    var k = kind === 'emergency' || kind === 'notice' ? kind : 'test';
    demoItem = {
      id: 'demo-' + now, demo: true, code: k === 'test' ? 'NPT' : 'EAN', kind: k, test: k === 'test', presidential: false,
      sent: new Date(now).toISOString(), expires: new Date(now + 5 * 60e3).toISOString(),
      langs: { en: {
        event: 'Demo',
        headline: 'This is how a FEMA national alert appears in BDOC',
        text: 'A real alert shows FEMA’s own words here, in English or Spanish, within about a minute of TV and radio. This demo goes away in 5 minutes or when you close it.',
        instruction: '', audio: ''
      } }
    };
    render(null);
    show();
  }

  window.BDOCGovAlert = {
    poll: poll,
    demo: demo,
    state: function () { return { current: current, alerts: last.slice(), demo: demoItem, lastCheck: lastCheck }; }
  };

  function start() {
    poll();
    setInterval(poll, POLL_MS);
    // A background tab is throttled; catch up the moment it is looked at again.
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') poll(); });
    window.addEventListener('online', poll);
    // Tapping a FEMA push opens or focuses BDOC with #govalert.
    window.addEventListener('bdoc-push-nav', function (e) {
      if (e.detail && /govalert/.test(String(e.detail.url || ''))) poll();
    });
  }

  if (document.readyState === 'complete') setTimeout(start, 2500);
  else window.addEventListener('load', function () { setTimeout(start, 2500); });
})();
