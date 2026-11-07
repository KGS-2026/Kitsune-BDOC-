// BDOC p178: bdoc-float.js — every floating box and pop-up drags by its title bar, and pressing on a
// box that another box covers brings it to the front.
//
// Travon: "boxes pop up on top of the one I'm looking at and you can't see it". Before this only a
// few boxes dragged (threat level, Cam Wall, Signals, COA, Battle Tracker, coordinates, time zones),
// each with its own code, and the map's info box could never come to the front: Cesium puts it inside
// #cesiumContainer, a stacking layer at z-index 1, so every BDOC panel (z 50 and up) drew over it.
//
// How it works (nothing runs until you press on a box, so the globe and the feeds pay nothing):
// - A "box" is any visible position:fixed child of <body> (they all are) that is not docked UI:
//   top bar, side panels, tickers, HUD overlays, the nav widget, full-screen overlays and modals.
// - Drag: press the top 36 px of a box (its title bar) and move 4 px. Buttons, links, inputs, tabs
//   and selects in the title bar keep working, and a plain click stays a click. Mouse and pen only,
//   at desktop width: on touch and phones the panels keep their own layouts (the threat box made
//   the same call in P111 / P113, because touch dragging fought the globe).
// - Front: pressing anywhere on a box that another box overlaps raises it just above that box, in
//   its own layer: data panels (z < 80) stay under the tickers (80, 95) and the top bar (100), so a
//   raised panel never covers the menus or the modals; boxes at z 80-99 stay under 100; boxes that
//   already sit above the top bar (camera viewer, LIVE WIRE, dialogs) order among themselves.
//   Raising only ever goes up, so nothing a box covered before is uncovered by surprise.
// - Boxes that already drag themselves keep their own code (OWN_DRAG); they still come to the front.
// - The map's info box is moved to <body> once at startup, at z 61 (above the data panels, under the
//   tickers), so it shows over the panels and drags like the rest. Its iframe reloads once on the
//   move; BDOC already reloads it at startup (cesium-init.js, sandbox fix) and Cesium's load handler
//   redraws the current description, so nothing is lost.
// - A dragged box stays where you put it until the page reloads; if the window shrinks, it is pulled
//   back so its title bar can still be grabbed, and below 768 px every box goes back to its own phone
//   layout. BDOCFloat.reset() puts every box back.
(function (root) {
  'use strict';

  const HANDLE_PX = 36;        // the top strip of a box that drags it
  const KEEP_PX = 80;          // at least this much of a box stays on screen sideways
  const THRESHOLD = 4;         // px of movement before a press becomes a drag
  const MIN_W = 80, MIN_H = 30;
  const MIN_DESKTOP = 768;     // narrower: panels use their phone layouts, no dragging
  const INFOBOX_Z = 61;

  // Docked or full-width UI: never dragged, never raised, never counted as covering a box.
  const EXCLUDE = [
    '.tb', '#lp', '.lp', '#rp', '.rp', '#sitPanel', '#sc', '.sc', '.fd', '#bdocTicker', '#intel-ticker',
    '.grid-ov', '.hud-vignette', '.hud-frame', '.hud-corner', '.vfx-crt', '#ss-watermark', '#ss-ts',
    '#nav-widget', '#cesiumContainer', '#bootSeq', '#loginBtn', '#bdocUndoBtn', '#scToggle', '.lp-reopen',
    '#mob-ov', '.mo-bg', '#settingsOverlay',
  ].join(',');
  // These drag themselves already (their own handle code): raise only.
  const OWN_DRAG = [
    '#gtaWidget', '#battlePanel', '.battle-panel', '#coaPanel', '#camWallPanel', '#signalsPanel',
    '#tz-bar', '#cursorCoords',
  ].join(',');
  // A press on one of these inside a title bar is a click, not a drag.
  const INTERACTIVE = 'a,button,input,select,textarea,label,option,summary,video,audio,iframe,canvas,'
    + '[contenteditable="true"],[contenteditable=""],[role="button"],[role="tab"],[role="slider"],'
    + '[role="menuitem"],[data-nodrag]';

  // ── pure helpers (tests/float-panels-p178.test.js) ─────────────────────────────────────────────
  // The highest z a box may be raised to: its layer's ceiling.
  const layerCap = z => (z < 80 ? 79 : z < 100 ? 99 : Infinity);
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  // t / others: { z, order (DOM order), rect, natural (z before BDOCFloat touched it) }.
  // Returns null when no other box in t's layer covers t, else { z, compact }: compact means the
  // layer is full (z would pass the ceiling) and the raised boxes in it must be renumbered first.
  function planRaise(t, others) {
    const cap = layerCap(t.natural);
    let cover = -Infinity;
    for (const o of others) {
      if (o.z > cap) continue;                                   // a higher layer stays above
      if (o.z < t.z || (o.z === t.z && o.order < t.order)) continue;  // already under t
      if (!overlaps(t.rect, o.rect)) continue;
      cover = Math.max(cover, o.z);
    }
    if (cover === -Infinity) return null;
    return cover + 1 > cap ? { z: cap, compact: true } : { z: cover + 1, compact: false };
  }

  // Renumber the raised boxes of one layer as low as their order allows (never under their natural
  // z), so raising never creeps up into the tickers or the top bar. boxes: { z, order, natural }.
  // Returns the new z for each box, in the order given.
  function compactPlan(boxes) {
    const idx = boxes.map((b, i) => i).sort((a, b) => boxes[a].z - boxes[b].z || boxes[a].order - boxes[b].order);
    const out = new Array(boxes.length);
    let v = -Infinity;
    for (const i of idx) { v = Math.max(v + 1, boxes[i].natural); out[i] = v; }
    return out;
  }

  // Where a box being dragged may go (viewport px): its title bar stays reachable.
  function clampRect(left, top, w, h, vw, vh, minTop) {
    const keep = Math.min(KEEP_PX, w);
    const minL = keep - w, maxL = Math.max(minL, vw - keep);
    const maxT = Math.max(minTop, vh - HANDLE_PX);
    return { left: Math.round(Math.min(Math.max(left, minL), maxL)), top: Math.round(Math.min(Math.max(top, minTop), maxT)) };
  }

  const inHandle = (r, x, y) => y >= r.top && y <= r.top + HANDLE_PX && x >= r.left && x <= r.right;

  const core = Object.freeze({ HANDLE_PX, KEEP_PX, THRESHOLD, MIN_DESKTOP, INFOBOX_Z, EXCLUDE, OWN_DRAG, INTERACTIVE, layerCap, overlaps, planRaise, compactPlan, clampRect, inHandle });

  const doc = root.document;
  if (!doc || !doc.body || typeof root.getComputedStyle !== 'function') {
    root.BDOCFloat = Object.freeze({ core });
    return;
  }

  // ── page glue ──────────────────────────────────────────────────────────────────────────────────
  const S = { drag: null, raf: 0, hot: null, hoverT: null, hoverB: null, hx: 0, hy: 0, ht: null, hraf: 0, ib: null, saved: new Map(), raised: new Set() };
  const cs = el => root.getComputedStyle(el);
  const zOf = el => { const z = parseInt(cs(el).zIndex, 10); return Number.isFinite(z) ? z : 0; };
  const natural = el => (S.saved.has(el) && S.saved.get(el).z0 != null ? S.saved.get(el).z0 : zOf(el));

  function isBox(el) {
    if (!el || el.nodeType !== 1 || el.parentElement !== doc.body) return false;
    if (el.matches(EXCLUDE)) return false;
    const c = cs(el);
    if (c.position !== 'fixed' || c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) return false;
    const r = el.getBoundingClientRect();
    if (r.width < MIN_W || r.height < MIN_H) return false;
    return !(r.width >= root.innerWidth * 0.9 && r.height >= root.innerHeight * 0.9);   // full-screen overlay
  }
  // the box a press landed in (boxes are children of <body>, so this is one hop at most)
  function boxOf(t) {
    if (!t || t.nodeType !== 1 || t.closest('#cesiumContainer')) return null;
    let n = t;
    while (n && n.parentElement && n.parentElement !== doc.body) n = n.parentElement;
    return isBox(n) ? n : null;
  }

  // remember what a box looked like before we touched it, so reset() can put it back
  function remember(el, props) {
    let s = S.saved.get(el);
    if (!s) { s = { props: {}, z0: null }; S.saved.set(el, s); }
    for (const p of props) if (!(p in s.props)) s.props[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)];
    return s;
  }
  const put = (el, p, v) => el.style.setProperty(p, v, 'important');

  function setZ(el, z) {
    const s = remember(el, ['z-index']);
    if (s.z0 == null) s.z0 = zOf(el);
    put(el, 'z-index', String(z));
    S.raised.add(el);
  }

  function raise(el) {
    const kids = Array.prototype.slice.call(doc.body.children);
    const info = n => ({ el: n, z: zOf(n), order: kids.indexOf(n), rect: n.getBoundingClientRect(), natural: natural(n) });
    const others = () => kids.filter(n => n !== el && isBox(n)).map(info);
    let t = info(el), p = planRaise(t, others());
    if (!p) return false;
    if (p.compact) {
      const cap = layerCap(t.natural);
      const group = Array.from(S.raised).filter(b => b.isConnected && b !== el && layerCap(natural(b)) === cap).map(info);
      group.push(t);
      compactPlan(group).forEach((z, i) => setZ(group[i].el, z));
      t = info(el);
      p = planRaise(t, others());
      if (!p) return true;
    }
    setZ(el, Math.min(p.z, layerCap(t.natural)));
    return true;
  }

  const POS = ['left', 'top', 'right', 'bottom', 'margin', 'transform', 'translate', 'width', 'height'];
  // put back what we changed (all of it, or only the position)
  function restore(el, props) {
    const s = S.saved.get(el);
    if (!s) return;
    for (const p of props || Object.keys(s.props)) {
      if (!(p in s.props)) continue;
      const [v, pr] = s.props[p];
      if (v) el.style.setProperty(p, v, pr); else el.style.removeProperty(p);
      delete s.props[p];
    }
  }

  // switch a box to plain left / top (keeping where it is on screen and its size) so it can move
  function pin(el) {
    remember(el, POS);
    const r = el.getBoundingClientRect();
    ['right', 'bottom'].forEach(p => put(el, p, 'auto'));
    put(el, 'margin', '0'); put(el, 'transform', 'none'); put(el, 'translate', 'none');
    put(el, 'left', '0px'); put(el, 'top', '0px');
    const o = el.getBoundingClientRect();          // where left:0 / top:0 lands
    put(el, 'left', (r.left - o.left) + 'px'); put(el, 'top', (r.top - o.top) + 'px');
    const n = el.getBoundingClientRect();
    if (Math.abs(n.width - r.width) > 1) put(el, 'width', r.width + 'px');
    if (Math.abs(n.height - r.height) > 1) put(el, 'height', r.height + 'px');
    return { ox: o.left, oy: o.top };
  }

  function minTopFor(el) {
    if (zOf(el) >= 100) return 0;
    const tb = doc.querySelector('.tb');
    const r = tb && tb.getBoundingClientRect();
    return r && r.height ? Math.max(0, Math.round(r.bottom)) : 0;
  }

  function place(d) {
    const p = clampRect(d.base.left + d.x - d.sx, d.base.top + d.y - d.sy, d.base.width, d.base.height, root.innerWidth, root.innerHeight, d.minTop);
    put(d.box, 'left', (p.left - d.ox) + 'px');
    put(d.box, 'top', (p.top - d.oy) + 'px');
  }
  function frame() { S.raf = 0; if (S.drag && S.drag.on) place(S.drag); }

  function start(d) {
    d.on = true;
    d.tr = [d.box.style.getPropertyValue('transition'), d.box.style.getPropertyPriority('transition')];
    put(d.box, 'transition', 'none');               // before measuring, or a transition skews the numbers
    const o = pin(d.box);
    d.ox = o.ox; d.oy = o.oy;
    d.base = d.box.getBoundingClientRect();
    d.minTop = minTopFor(d.box);
    try { d.box.setPointerCapture(d.id); } catch (_) {}
    doc.documentElement.classList.add('bdoc-float-drag');
    try { root.getSelection().removeAllRanges(); } catch (_) {}
  }

  function finish(e, keepClick) {
    const d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    S.drag = null;
    if (!d.on) return;
    if (S.raf) { root.cancelAnimationFrame(S.raf); S.raf = 0; }
    place(d);
    d.box.style.setProperty('transition', d.tr[0], d.tr[1]);
    try { d.box.releasePointerCapture(d.id); } catch (_) {}
    doc.documentElement.classList.remove('bdoc-float-drag');
    if (!keepClick) {
      // the click that follows a drag must not press the title bar (collapse toggles and the like)
      const eat = ev => { ev.stopPropagation(); ev.preventDefault(); };
      root.addEventListener('click', eat, true);
      root.setTimeout(() => root.removeEventListener('click', eat, true), 0);
    }
  }

  function onDown(e) {
    if (S.drag || !e.isPrimary || e.button !== 0) return;
    const t = e.target, box = boxOf(t);
    if (!box) return;
    try { raise(box); } catch (_) {}
    if (e.pointerType === 'touch' || root.innerWidth < MIN_DESKTOP || box.matches(OWN_DRAG)) return;
    if (!inHandle(box.getBoundingClientRect(), e.clientX, e.clientY)) return;
    const hit = t.closest(INTERACTIVE);
    if (hit && hit !== box && box.contains(hit)) return;
    S.drag = { box, id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, on: false };
  }

  function onMove(e) {
    const d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.on) {
      if (Math.abs(d.x - d.sx) < THRESHOLD && Math.abs(d.y - d.sy) < THRESHOLD) return;
      start(d);
    }
    e.preventDefault();
    if (!S.raf) S.raf = root.requestAnimationFrame(frame);
  }

  // grab cursor while the mouse is over a title bar it can drag (one check per frame at most)
  function hover() {
    S.hraf = 0;
    const t = S.ht;
    let hot = null;
    if (!S.drag && t && t.nodeType === 1 && root.innerWidth >= MIN_DESKTOP) {
      const box = t === S.hoverT ? S.hoverB : boxOf(t);
      S.hoverT = t; S.hoverB = box;
      if (box && box.isConnected && !box.matches(OWN_DRAG) && inHandle(box.getBoundingClientRect(), S.hx, S.hy)) {
        const hit = t.closest(INTERACTIVE);
        if (!(hit && hit !== box && box.contains(hit))) hot = box;
      }
    }
    if (hot !== S.hot) {
      if (S.hot) S.hot.classList.remove('bdoc-float-hot');
      if (hot) hot.classList.add('bdoc-float-hot');
      S.hot = hot;
    }
  }
  function onHover(e) {
    if (e.pointerType !== 'mouse') return;
    S.hx = e.clientX; S.hy = e.clientY; S.ht = e.target;
    if (!S.hraf) S.hraf = root.requestAnimationFrame(hover);
  }

  // a smaller window must not strand a box out of reach; at phone width the boxes go back to their
  // own phone layouts (a pinned left / top would override their media queries)
  let rt = 0;
  function onResize() {
    root.clearTimeout(rt);
    rt = root.setTimeout(() => {
      const phone = root.innerWidth < MIN_DESKTOP;
      for (const el of S.saved.keys()) {
        if (!el.isConnected) { S.saved.delete(el); S.raised.delete(el); continue; }
        if (phone) { restore(el, POS); continue; }
        if (!('left' in S.saved.get(el).props) || !isBox(el)) continue;
        const r = el.getBoundingClientRect();
        const p = clampRect(r.left, r.top, r.width, r.height, root.innerWidth, root.innerHeight, minTopFor(el));
        if (p.left !== Math.round(r.left) || p.top !== Math.round(r.top)) {
          put(el, 'left', (parseFloat(el.style.getPropertyValue('left')) + p.left - r.left) + 'px');
          put(el, 'top', (parseFloat(el.style.getPropertyValue('top')) + p.top - r.top) + 'px');
        }
      }
    }, 150);
  }

  // every box back where its own code put it, and at its own z
  function reset() {
    for (const el of S.saved.keys()) if (el.isConnected) restore(el);
    S.saved.clear(); S.raised.clear();
  }

  // ── the map's info box: out of the globe's layer, into <body> ─────────────────────────────────
  function viewer() { try { return typeof V !== 'undefined' && V ? V : null; } catch (_) { return null; } }
  function bindFrame() {
    try {
      const v = viewer(), d = v && v.infoBox && v.infoBox.frame && v.infoBox.frame.contentDocument;
      if (d && !d.__bdocFloat) {
        d.__bdocFloat = 1;
        // a press inside the description raises the box too (same-origin frame, sandbox allows it)
        d.addEventListener('pointerdown', () => { try { if (S.ib && isBox(S.ib)) raise(S.ib); } catch (_) {} }, true);
      }
    } catch (_) {}
  }
  function adoptInfoBox() {
    const v = viewer();
    const ib = v && v.infoBox && doc.querySelector('.cesium-viewer .cesium-infoBox');
    if (!ib) return false;
    ib.classList.add('bdoc-float-ib');
    doc.body.appendChild(ib);
    S.ib = ib;
    try { v.infoBox.frame.addEventListener('load', bindFrame); } catch (_) {}
    bindFrame();
    // the box you just opened from the map comes up over the panels it lands under
    try {
      v.selectedEntityChanged.addEventListener(ent => {
        if (ent) root.setTimeout(() => { try { if (isBox(ib)) raise(ib); } catch (_) {} }, 260);
      });
    } catch (_) {}
    return true;
  }
  let tries = 0;
  (function waitForViewer() {
    if (doc.querySelector('.bdoc-float-ib') || adoptInfoBox()) return;
    if (++tries < 240) root.setTimeout(waitForViewer, 500);
  })();

  const css = doc.createElement('style');
  css.id = 'bdocFloatCss';
  css.textContent = 'html.bdoc-float-drag,html.bdoc-float-drag *{user-select:none!important;-webkit-user-select:none!important;cursor:grabbing!important}'
    + 'html.bdoc-float-drag iframe{pointer-events:none!important}'
    + '.bdoc-float-hot,.bdoc-float-hot *:not(a):not(button):not(input):not(select):not(textarea):not(iframe){cursor:grab!important}'
    + '.cesium-infoBox.bdoc-float-ib{position:fixed!important;z-index:' + INFOBOX_Z + '}';
  doc.head.appendChild(css);

  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('pointermove', onMove, true);
  root.addEventListener('pointerup', e => finish(e, false), true);
  root.addEventListener('pointercancel', e => finish(e, true), true);
  doc.addEventListener('pointermove', onHover, { passive: true });
  root.addEventListener('resize', onResize);
  // the phone-layout switch, even where a resize event is not sent (some emulators, split views)
  try { root.matchMedia('(max-width: ' + (MIN_DESKTOP - 1) + 'px)').addEventListener('change', onResize); } catch (_) {}

  root.BDOCFloat = Object.freeze({ core, raise, reset, isBox, boxOf });
})(typeof window !== 'undefined' ? window : globalThis);
