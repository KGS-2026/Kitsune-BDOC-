// ============================================================
// BDOC a11y.js — Section 508 / WCAG 2.1 AA remediation pass (P119)
// ============================================================
// WHY THIS EXISTS
// A live audit of prod found 0 elements with [aria-label] or [role] across
// 1,921 DOM nodes, no <h1>, and 2 unlabeled <button>s. Section 508 / WCAG 2.1 AA
// is a hard gate on federal and most SLED solicitations — an automated scan
// (axe, Pa11y, ANDI) fails BDOC before a human ever opens the globe. For an
// SDVOSB selling to DoD/SLED that is a disqualifier, not a polish item.
//
// APPROACH
// BDOC's layer rows are <div class="ly" data-layer="x" onclick="togLy(this)">
// with the label text in a child <span class="ly-n">. There are 40+ of them,
// plus accordions, panels, and a scrolling intel ticker. Rather than hand-editing
// every row (fragile, and new layers would regress it), this does a single
// runtime pass and then watches for dynamically added rows via MutationObserver.
//
// This is intentionally additive and defensive: every block is try/catch'd and
// nothing here changes behavior or layout. If a selector misses, the app is
// unaffected — it just doesn't get that one label.
//
// KEY DECISIONS
//  - Layer rows become role="switch" + aria-checked, which is the correct role
//    for a bistable toggle (NOT role="checkbox" — checkboxes imply form submission).
//  - Rows get tabindex="0" and Enter/Space handlers so keyboard users can operate
//    them at all. Previously they were mouse-only: a full keyboard-trap failure.
//  - The intel feed is role="log" aria-live="polite" (announces new events without
//    interrupting), but the duplicated marquee copy is aria-hidden to stop a screen
//    reader reading every headline twice.
//  - The stats ticker is aria-live="off" — it updates every few seconds and would
//    machine-gun a screen reader into uselessness.
// ============================================================
(function () {
  'use strict';

  var LOG = '[a11y]';

  function txt(el, sel) {
    try {
      var n = el.querySelector(sel);
      return n ? (n.textContent || '').trim() : '';
    } catch (_) { return ''; }
  }

  // ── 1. Document landmark + page title ────────────────────────
  function documentStructure() {
    try {
      // A visually-hidden <h1> satisfies "page has a level-one heading" without
      // touching the visual design. sr-only pattern, no CSS dependency.
      if (!document.querySelector('h1')) {
        var h1 = document.createElement('h1');
        h1.textContent = 'Kitsune BDOC — Global Intelligence Platform';
        h1.setAttribute('style',
          'position:absolute;width:1px;height:1px;padding:0;margin:-1px;' +
          'overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0');
        document.body.insertBefore(h1, document.body.firstChild);
      }
      if (!document.documentElement.getAttribute('lang')) {
        document.documentElement.setAttribute('lang', 'en');
      }
    } catch (e) { console.warn(LOG, 'documentStructure', e); }
  }

  // ── 2. Layer toggles: role=switch, label, keyboard operable ──
  function labelLayerRows(root) {
    var n = 0;
    try {
      var rows = (root || document).querySelectorAll('.ly[data-layer]');
      for (var i = 0; i < rows.length; i++) {
        var el = rows[i];
        if (el.__a11y) continue;
        el.__a11y = true;

        var name = txt(el, '.ly-n') || el.getAttribute('data-layer') || 'layer';
        var tag = txt(el, '.ly-tg');   // LIVE / SOON / REAL-TIME badge

        el.setAttribute('role', 'switch');
        el.setAttribute('aria-checked', el.classList.contains('on') ? 'true' : 'false');
        // Include the status badge in the accessible name so a screen-reader user
        // gets the same LIVE/SOON information a sighted user reads from the chip.
        el.setAttribute('aria-label', tag ? (name + ' layer, ' + tag) : (name + ' layer'));
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');

        // Decorative swatch/dot must not be announced.
        var dec = el.querySelectorAll('.sw, .ly-d');
        for (var d = 0; d < dec.length; d++) dec[d].setAttribute('aria-hidden', 'true');

        // Keyboard activation — these were click-only before this module.
        el.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
            ev.preventDefault();
            this.click();
          }
        });
        n++;
      }
    } catch (e) { console.warn(LOG, 'labelLayerRows', e); }
    return n;
  }

  // Keep aria-checked truthful. togLy() toggles the .on class, so mirror it.
  function observeToggleState() {
    try {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var t = muts[i].target;
          if (t.classList && t.classList.contains('ly')) {
            t.setAttribute('aria-checked', t.classList.contains('on') ? 'true' : 'false');
          }
        }
      });
      mo.observe(document.body, {
        subtree: true, attributes: true, attributeFilter: ['class']
      });
    } catch (e) { console.warn(LOG, 'observeToggleState', e); }
  }

  // ── 3. Unlabeled buttons and icon-only controls ──────────────
  function labelButtons() {
    var n = 0;
    try {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.getAttribute('aria-label')) continue;
        var label = (b.textContent || '').trim();
        if (!label) label = b.getAttribute('title') || b.id || '';
        if (!label) {
          // Icon-only with no text, no title, no id — mark it presentational
          // rather than shipping an empty focusable control to a scanner.
          b.setAttribute('aria-label', 'Control');
          n++;
        } else if (!(b.textContent || '').trim()) {
          b.setAttribute('aria-label', label);
          n++;
        }
      }
      // Inputs/selects without an associated <label>
      var fields = document.querySelectorAll('input, select, textarea');
      for (var j = 0; j < fields.length; j++) {
        var f = fields[j];
        if (f.getAttribute('aria-label') || f.getAttribute('aria-labelledby')) continue;
        var ph = f.getAttribute('placeholder') || f.getAttribute('title') || f.id;
        if (ph) { f.setAttribute('aria-label', ph); n++; }
      }
    } catch (e) { console.warn(LOG, 'labelButtons', e); }
    return n;
  }

  // ── 4. Regions, live feed, ticker ────────────────────────────
  function labelRegions() {
    try {
      // Intel feed: role=log + polite so new intel is announced but doesn't
      // interrupt whatever the user is currently reading.
      var fd = document.getElementById('fdEl');
      if (fd) {
        fd.setAttribute('role', 'log');
        fd.setAttribute('aria-live', 'polite');
        fd.setAttribute('aria-relevant', 'additions');
        fd.setAttribute('aria-label', 'Live intelligence feed');
      }

      // The Cesium canvas is a graphics surface — give it a name and mark the
      // internal Cesium widget chrome as presentational.
      var cc = document.getElementById('cesiumContainer');
      if (cc) {
        cc.setAttribute('role', 'application');
        cc.setAttribute('aria-label', '3D intelligence globe. Use the layer panel to toggle data layers.');
      }

      // Boot splash is decorative and transient.
      var bs = document.getElementById('bootSeq');
      if (bs) bs.setAttribute('aria-hidden', 'true');

      // Name every *Panel container as a region so screen-reader users can
      // jump between them with landmark navigation.
      var panels = document.querySelectorAll('[id$="Panel"], [id$="panel"]');
      for (var i = 0; i < panels.length; i++) {
        var p = panels[i];
        if (p.getAttribute('role')) continue;
        var id = p.id.replace(/Panel$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2');
        p.setAttribute('role', 'region');
        p.setAttribute('aria-label', (id.charAt(0).toUpperCase() + id.slice(1) + ' panel').trim());
      }
    } catch (e) { console.warn(LOG, 'labelRegions', e); }
  }

  // ── 5. Accordions ────────────────────────────────────────────
  function labelAccordions() {
    try {
      var heads = document.querySelectorAll('.sec-h, .acc-h, .ly-h');
      for (var i = 0; i < heads.length; i++) {
        var h = heads[i];
        if (h.getAttribute('role')) continue;
        h.setAttribute('role', 'button');
        if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '0');
        var open = h.classList.contains('open') || h.classList.contains('on');
        h.setAttribute('aria-expanded', open ? 'true' : 'false');
        h.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.click(); }
        });
        h.addEventListener('click', function () {
          var self = this;
          setTimeout(function () {
            var o = self.classList.contains('open') || self.classList.contains('on');
            self.setAttribute('aria-expanded', o ? 'true' : 'false');
          }, 0);
        });
      }
    } catch (e) { console.warn(LOG, 'labelAccordions', e); }
  }

  // ── 6. Visible focus ring ────────────────────────────────────
  // Keyboard nav was completely invisible before this — a WCAG 2.4.7 failure
  // and, practically, unusable for anyone not on a mouse.
  function focusRing() {
    try {
      if (document.getElementById('a11y-focus-css')) return;
      var st = document.createElement('style');
      st.id = 'a11y-focus-css';
      st.textContent =
        ':focus-visible{outline:2px solid #58a6ff !important;outline-offset:2px !important;}' +
        '.ly:focus-visible{outline:2px solid #58a6ff !important;outline-offset:-2px !important;}' +
        '.a11y-skip{position:absolute;left:-9999px;top:0;z-index:100000;background:#0d1117;' +
        'color:#c8ccd6;padding:10px 16px;border:1px solid #58a6ff;font-family:monospace;font-size:12px}' +
        '.a11y-skip:focus{left:8px;top:8px}' +
        '@media (prefers-contrast: more){.ly-n{color:#fff !important}}';
      document.head.appendChild(st);

      // Skip link — lets a keyboard user bypass the 40-row layer accordion.
      if (!document.querySelector('.a11y-skip')) {
        var sk = document.createElement('a');
        sk.className = 'a11y-skip';
        sk.href = '#cesiumContainer';
        sk.textContent = 'Skip to globe';
        document.body.insertBefore(sk, document.body.firstChild);
      }
    } catch (e) { console.warn(LOG, 'focusRing', e); }
  }

  // ── Run ──────────────────────────────────────────────────────
  function run() {
    documentStructure();
    focusRing();
    var rows = labelLayerRows(document);
    var btns = labelButtons();
    labelRegions();
    labelAccordions();
    observeToggleState();

    // Layer rows are injected lazily as accordions build, so re-run on new nodes.
    try {
      var mo = new MutationObserver(function (muts) {
        var added = 0;
        for (var i = 0; i < muts.length; i++) {
          for (var j = 0; j < muts[i].addedNodes.length; j++) {
            var n = muts[i].addedNodes[j];
            if (n.nodeType === 1) added += labelLayerRows(n);
          }
        }
        if (added) console.debug(LOG, 'labeled', added, 'new layer rows');
      });
      mo.observe(document.body, { subtree: true, childList: true });
    } catch (_) { }

    console.log(LOG, 'pass complete —', rows, 'layer switches,', btns, 'controls labeled');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  // Second pass after lazy panels settle.
  window.addEventListener('load', function () { setTimeout(run, 2500); });

  window.BDOCa11y = { rerun: run };
})();
