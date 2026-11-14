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
//   top bar, side panels, tickers, HUD overlays, the nav widget, menus, full-screen overlays and
//   modals, and (p186) any bar its own CSS stretches across the whole viewport, such as a banner.
// - Drag: press the top 36 px of a box (its title bar) and move 4 px. Buttons, links, inputs, tabs
//   and selects in the title bar keep working, and a plain click stays a click. Mouse and pen only,
//   at desktop width: on touch and phones the panels keep their own layouts (the threat box made
//   the same call in P111 / P113, because touch dragging fought the globe).
// - Front: pressing anywhere on a box that another box overlaps raises it just above that box.
//   p186: one stack for every box. Alert banners (z 99000 and up: outage, update, FEMA) are not part
//   of it: nothing is raised over them and they are never a reason to raise. Open menus (top-bar
//   drop-downs, the search list, the right-click menu) draw over every box. Before each raise the
//   raised boxes settle to the lowest z that keeps what is drawn over what, and a raised box that
//   was closed goes back to its own z, so z never creeps.
//   (p178 had three layers: a data panel under the Watchlist could not come forward, the layer above
//   the top bar had no ceiling, and the FEMA banner, added later, counted as a box.)
//   A box being dragged is over every other box while it moves, and where it is dropped it stays just
//   above the boxes under it (p186: it used to slide underneath a later or higher box).
//   The sign-in, pricing and PACE dialogs draw over every box (p186: their backdrop shared z 200 with
//   the Watchlist and COA panels, which were drawn on top of the dialog).
// - Boxes that already drag themselves keep their own code (OWN_DRAG); they still come to the front.
// - The map's info box is moved to <body> once at startup, at z 61 (above the data panels, under the
//   tickers), so it shows over the panels and drags like the rest. Its iframe reloads once on the
//   move; BDOC already reloads it at startup (cesium-init.js, sandbox fix) and Cesium's load handler
//   redraws the current description, so nothing is lost.
// - A dragged box stays where you put it until the page reloads; if the window shrinks, it is pulled
//   back so its title bar can still be grabbed, and below 768 px every box goes back to its own phone
//   layout. A title bar cannot be dragged under the top bar or an alert banner.
// - View > Reset Panel Positions (p186) calls BDOCFloat.reset(): every box back to its usual place,
//   including the ones that drag themselves and the saved places of Cam Wall, Signals and the
//   time-zone bar.
// - A drag ends if the button is already up or the window loses focus (p186), so a box can never
//   follow a mouse with no button held.
(function (root) {
  'use strict';

  const HANDLE_PX = 36;        // the top strip of a box that drags it
  const KEEP_PX = 80;          // at least this much of a box stays on screen sideways
  const THRESHOLD = 4;         // px of movement before a press becomes a drag
  const MIN_W = 80, MIN_H = 30;
  const MIN_DESKTOP = 768;     // narrower: panels use their phone layouts, no dragging
  const INFOBOX_Z = 61;
  // p186: alert banners and critical notices sit at or above this z (outage banner 99990, update
  // banner 100000, FEMA alert 2147483000). They keep the order their own code gave them: nothing is
  // raised to this height, and they never count as "covering" a panel.
  const ALERT_Z = 99000;
  const PANEL_TOP = ALERT_Z - 100;   // the highest z a pressed box can reach
  const MODAL_Z = ALERT_Z - 80;      // the dialogs that block the page (sign-in, pricing, PACE): over every box
  const MENU_Z = ALERT_Z - 50;       // open menus (top-bar drop-downs, the right-click menu): over every box, under the alerts

  // Docked or full-width UI and menus: never dragged, never raised, never counted as covering a box.
  // (p186: any bar that spans the viewport edge to edge is left out by isBox as well, whatever its id.)
  const EXCLUDE = [
    '.tb', '#lp', '.lp', '#rp', '.rp', '#sitPanel', '#sc', '.sc', '.fd', '#bdocTicker', '#intel-ticker',
    '.grid-ov', '.hud-vignette', '.hud-frame', '.hud-corner', '.vfx-crt', '#ss-watermark', '#ss-ts',
    '#nav-widget', '#cesiumContainer', '#bootSeq', '#loginBtn', '#bdocUndoBtn', '#scToggle', '.lp-reopen',
    '#mob-ov', '.mo-bg', '#settingsOverlay', '#bdocGovAlert', '#battle-ctx', '#battle-tooltip',
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
  // The highest z a box may be raised to. p186: one stack for every box under the alerts. p178 kept
  // three layers (data panels under 80, 80-99, the rest with no ceiling at all): a data panel or the
  // map info box under the Watchlist (z 200) could never come forward, and a pressed camera viewer
  // went over the FEMA alert. The top bar is protected by the drag limit and by MENU_Z instead.
  const layerCap = z => (z < ALERT_Z ? PANEL_TOP : Infinity);
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  // t / others: { z, order (DOM order), rect, natural (z before BDOCFloat touched it) }; others holds
  // no alerts. Returns null when nothing covers t, else { z }: just above the highest box over it.
  // all: over every other box, covering t or not. That is a box being dragged: it was lifted only
  // over what covered it at the press, so a panel dragged across a later or higher one slid
  // underneath it and needed a second click to come forward.
  function planRaise(t, others, all) {
    if (t.natural >= ALERT_Z) return null;                       // an alert is never re-ordered
    let cover = -Infinity;
    for (const o of others) {
      if (o.z >= ALERT_Z) continue;                              // alerts stay above, and are no reason to climb
      if (o.z < t.z || (o.z === t.z && o.order < t.order)) continue;  // already under t
      if (!all && !overlaps(t.rect, o.rect)) continue;
      cover = Math.max(cover, o.z);
    }
    if (cover === -Infinity) return null;
    return { z: Math.min(cover + 1, PANEL_TOP) };
  }

  // Before each raise, every raised box drops to the lowest z that keeps each overlapping pair drawn
  // in the order it is now, so z never creeps (two panels pressed in turn stay around their own z),
  // and a box that was lifted over a panel which has since closed comes back down.
  // boxes: every visible box under the alerts, { z, order, natural, raised, rect }. Returns the z for
  // each, in the order given (unraised boxes keep theirs).
  function settlePlan(boxes) {
    const idx = boxes.map((b, i) => i).sort((a, b) => boxes[a].z - boxes[b].z || boxes[a].order - boxes[b].order);
    const out = boxes.map(b => b.z), below = [];
    for (const i of idx) {
      const b = boxes[i];
      if (b.raised) {
        let v = b.natural;
        for (const j of below) if (overlaps(b.rect, boxes[j].rect)) v = Math.max(v, out[j] + 1);
        out[i] = Math.min(v, b.z);                               // settling only ever lowers
      }
      below.push(i);
    }
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

  const core = Object.freeze({ HANDLE_PX, KEEP_PX, THRESHOLD, MIN_DESKTOP, INFOBOX_Z, ALERT_Z, PANEL_TOP, MODAL_Z, MENU_Z, EXCLUDE, OWN_DRAG, INTERACTIVE, layerCap, overlaps, planRaise, settlePlan, clampRect, inHandle });

  const doc = root.document;
  if (!doc || !doc.body || typeof root.getComputedStyle !== 'function') {
    root.BDOCFloat = Object.freeze({ core });
    return;
  }

  // ── page glue ──────────────────────────────────────────────────────────────────────────────────
  const S = { drag: null, own: null, raf: 0, hot: null, hoverT: null, hoverB: null, hx: 0, hy: 0, ht: null, hraf: 0, ib: null, saved: new Map(), raised: new Set() };
  const cs = el => root.getComputedStyle(el);
  const zOf = el => { const z = parseInt(cs(el).zIndex, 10); return Number.isFinite(z) ? z : 0; };
  const natural = el => (S.saved.has(el) && S.saved.get(el).z0 != null ? S.saved.get(el).z0 : zOf(el));
  const pinned = el => { const s = S.saved.get(el); return !!(s && s.pinned); };   // dragged by this code and still where the drag left it
  const shown = c => c.position === 'fixed' && c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity >= 0.05;
  const spansWidth = r => r.left <= 1 && r.right >= root.innerWidth - 1;

  function isBox(el) {
    if (!el || el.nodeType !== 1 || el.parentElement !== doc.body) return false;
    if (el.matches(EXCLUDE)) return false;
    if (!shown(cs(el))) return false;
    const r = el.getBoundingClientRect();
    if (r.width < MIN_W || r.height < MIN_H) return false;
    // p186: a bar its own CSS stretches across the whole viewport (an alert banner, a status strip)
    // is docked UI, not a box. A box the user dragged there stays a box, or it could never be moved back.
    if (spansWidth(r) && !pinned(el)) return false;
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

  // back to the z the box's own code gave it
  function unraise(el) {
    restore(el, ['z-index']);
    S.raised.delete(el);
    const s = S.saved.get(el);
    if (s) s.z0 = null;
  }

  // Every raised box down to the lowest z that keeps the picture as it is (settlePlan). A raised box
  // that has been closed goes back to its own z: reopened, it starts where its code puts it.
  // Returns the stack: every visible box under the alerts, in page order.
  function settle(keep) {
    const kids = Array.prototype.slice.call(doc.body.children);
    for (const b of Array.from(S.raised)) if (b !== keep && !isBox(b)) unraise(b);
    const list = kids.filter(n => n === keep || isBox(n))
      .map(n => ({ el: n, z: zOf(n), order: kids.indexOf(n), rect: n.getBoundingClientRect(), natural: natural(n), raised: S.raised.has(n) }))
      .filter(b => b.natural < ALERT_Z);                         // alerts are not part of the stack
    settlePlan(list).forEach((z, i) => {
      const b = list[i];
      if (!b.raised || z === b.z) return;
      if (z === b.natural) { unraise(b.el); b.raised = false; } else setZ(b.el, z);
      b.z = z;
    });
    return list;
  }

  // all: over every box (a drag), not only the ones covering it now (a press)
  function raise(el, all) {
    const list = settle(el);
    const t = list.find(b => b.el === el);
    const p = t && planRaise(t, list.filter(b => b !== t), all);
    if (!p) return false;
    setZ(el, p.z);
    return true;
  }

  // After a key or a click, which may have closed the panel a box was lifted over, settle once.
  // Without this, a panel reopened a moment later (W, W for the Watchlist) would come up underneath
  // the box that had been lifted over it. Nothing runs unless a box is raised.
  let settleT = 0;
  function settleSoon() {
    if (!S.raised.size || settleT) return;
    // not in the middle of a drag, ours or a box's own: a key pressed while dragging must not drop the box
    settleT = root.setTimeout(() => { settleT = 0; if (!S.drag && !(S.own && S.own.lifted)) { try { settle(null); } catch (_) {} } }, 200);
  }

  const POS = ['left', 'top', 'right', 'bottom', 'margin', 'transform', 'translate', 'width', 'height'];
  const HOME = ['left', 'top', 'right', 'bottom', 'transform'];   // what a box's own drag code rewrites
  const setBack = (el, p, was) => { if (was[0]) el.style.setProperty(p, was[0], was[1]); else el.style.removeProperty(p); };
  // put back what we changed (all of it, or only the position)
  function restore(el, props) {
    const s = S.saved.get(el);
    if (!s) return;
    for (const p of props || Object.keys(s.props)) {
      if (!(p in s.props)) continue;
      setBack(el, p, s.props[p]);
      delete s.props[p];
    }
    if (!('left' in s.props)) s.pinned = false;
  }
  // p186: a box that drags itself (OWN_DRAG) is noted as it stood before its own code first moved it,
  // so "Reset Panel Positions" can send it home too. Our pointerdown runs before the box's handlers.
  function rememberHome(el) {
    let s = S.saved.get(el);
    if (!s) { s = { props: {}, z0: null }; S.saved.set(el, s); }
    if (!s.home) { s.home = {}; for (const p of HOME) s.home[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]; }
  }

  // switch a box to plain left / top (keeping where it is on screen and its size) so it can move
  function pin(el) {
    remember(el, POS).pinned = true;
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

  // How high a box may be dragged: its title bar stays below the bars across the top of the screen,
  // which are the top bar and, when one is up, an alert banner (a title bar parked under the FEMA
  // banner could not be grabbed again). p186: for every box, whatever its z, now that a pressed panel
  // can rise above the top bar's own z. Bars are found by shape, not by name: fixed, edge to edge,
  // stacked down from the top edge. A hidden top bar (Clean View) does not count.
  function minTopFor(el) {
    const bars = [];
    for (const n of Array.prototype.slice.call(doc.body.children)) {
      if (n === el || n.nodeType !== 1 || !shown(cs(n))) continue;
      const r = n.getBoundingClientRect();
      if (spansWidth(r) && r.height >= 1 && r.height <= root.innerHeight / 2) bars.push(r);
    }
    bars.sort((a, b) => a.top - b.top);
    let top = 0;
    for (const r of bars) if (r.top <= top + 1) top = Math.max(top, r.bottom);
    return Math.max(0, Math.round(top));
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
    // p186: over every other box while it moves; where it lands, finish() settles it just above
    // the boxes under it (or back to its own z when it lands on none)
    try { raise(d.box, true); } catch (_) {}
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
    try { settle(null); } catch (_) {}
    if (!keepClick) {
      // the click that follows a drag must not press the title bar (collapse toggles and the like)
      const eat = ev => { ev.stopPropagation(); ev.preventDefault(); };
      root.addEventListener('click', eat, true);
      root.setTimeout(() => root.removeEventListener('click', eat, true), 0);
    }
  }

  function onDown(e) {
    if (S.drag || !e.isPrimary || e.button !== 0) return;
    const t = e.target;
    // a box that drags itself, even one too small to count as a box here (the coordinate readout)
    const own = t && t.nodeType === 1 ? t.closest(OWN_DRAG) : null;
    if (own && own.parentElement === doc.body) rememberHome(own);
    const box = boxOf(t);
    if (!box) return;
    try { raise(box); } catch (_) {}
    // p186: a box that drags itself is watched while the button is down, so it too goes over the
    // other boxes once it moves (onMove), and settles after the release (settleSoon)
    S.own = box.matches(OWN_DRAG) ? { box, id: e.pointerId, sx: e.clientX, sy: e.clientY } : null;
    if (e.pointerType === 'touch' || root.innerWidth < MIN_DESKTOP || box.matches(OWN_DRAG)) return;
    if (!inHandle(box.getBoundingClientRect(), e.clientX, e.clientY)) return;
    const hit = t.closest(INTERACTIVE);
    if (hit && hit !== box && box.contains(hit)) return;
    S.drag = { box, id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, on: false };
  }

  function onMove(e) {
    const o = S.own;
    if (o && e.pointerId === o.id) {
      if (e.pointerType === 'mouse' && !(e.buttons & 1)) { S.own = null; settleSoon(); }   // released where we could not see it
      else if (!o.lifted && (Math.abs(e.clientX - o.sx) >= THRESHOLD || Math.abs(e.clientY - o.sy) >= THRESHOLD)) {
        o.lifted = true;                                                    // once per press; stays lifted until the release
        try { if (isBox(o.box)) raise(o.box, true); } catch (_) {}
      }
    }
    const d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    // p186: the button came up where this page could not see it (focus left the window mid-press, a
    // native menu or dialog took the release). Without this the box would follow a mouse with no
    // button held until the next click.
    if (!(e.buttons & 1)) { finish(e, true); return; }
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
    if (e.pointerType !== 'mouse' || S.drag) return;
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
        if (!pinned(el) || !isBox(el)) continue;
        const r = el.getBoundingClientRect();
        const p = clampRect(r.left, r.top, r.width, r.height, root.innerWidth, root.innerHeight, minTopFor(el));
        if (p.left !== Math.round(r.left) || p.top !== Math.round(r.top)) {
          put(el, 'left', (parseFloat(el.style.getPropertyValue('left')) + p.left - r.left) + 'px');
          put(el, 'top', (parseFloat(el.style.getPropertyValue('top')) + p.top - r.top) + 'px');
        }
      }
    }, 150);
  }

  // Every box back where its own code put it, and at its own z (View > Reset Panel Positions, p186).
  // That covers boxes dragged by this code, boxes that drag themselves (as first seen this session),
  // and the three that keep a position of their own across reloads: Cam Wall, Signals, the time-zone bar.
  function reset() {
    for (const [el, s] of S.saved) {
      if (!el.isConnected) continue;
      restore(el);
      if (s.home) for (const p of HOME) setBack(el, p, s.home[p]);
    }
    S.saved.clear(); S.raised.clear();
    for (const m of [root.CamWall, root.SignalsWatch]) {
      try {
        if (!m || !m.pos) continue;
        m.pos = null;
        if (typeof m._save === 'function') m._save();
        if (m.panel) ['left', 'top', 'right', 'bottom'].forEach(p => m.panel.style.removeProperty(p));
      } catch (_) {}
    }
    try {
      root.localStorage.removeItem('bdoc_tzbar_pos');
      const tz = doc.getElementById('tz-bar');
      if (tz) ['top', 'right'].forEach(p => tz.style.removeProperty(p));
    } catch (_) {}
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
    + '.cesium-infoBox.bdoc-float-ib{position:fixed!important;z-index:' + INFOBOX_Z + '}'
    // p186: menus draw over every box. The top bar is a stacking layer at z 100, so its drop-downs
    // opened UNDER any panel at z 200 and up (COA in its usual place hid most of the View and Tools
    // menus). While a menu or the search list is open, the bar is lifted over the boxes with it.
    + '.tb:has(.menu-drop.show),.tb:has(#searchBar:focus){z-index:' + MENU_Z + '!important}'
    + '#battle-ctx{z-index:' + MENU_Z + '!important}'
    // p186: the sign-in, pricing and PACE dialogs share one backdrop (.mo-bg) at z 200, the z of the
    // Watchlist, COA and Situations panels. Those come later in the page, so an open panel was drawn
    // on top of the dialog, and so was everything higher (threat widget 999, camera viewer 10500, any
    // raised box). A dialog that blocks the page goes over every box. The promo-code and thank-you
    // dialogs (99999), the update banner and the alerts are above this and stay above it.
    + '.mo-bg{z-index:' + MODAL_Z + '!important}';
  doc.head.appendChild(css);

  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('pointermove', onMove, true);
  root.addEventListener('pointerup', e => finish(e, false), true);
  root.addEventListener('pointercancel', e => finish(e, true), true);
  // p186: leaving the window mid-drag (Alt+Tab, a system dialog) ends the drag where the box is
  root.addEventListener('blur', () => { if (S.drag) finish({ pointerId: S.drag.id }, true); });
  root.addEventListener('pointerup', settleSoon, true);
  root.addEventListener('pointercancel', settleSoon, true);
  root.addEventListener('keyup', settleSoon, true);
  const ownEnd = e => { if (S.own && e.pointerId === S.own.id) S.own = null; };
  root.addEventListener('pointerup', ownEnd, true);
  root.addEventListener('pointercancel', ownEnd, true);
  doc.addEventListener('pointermove', onHover, { passive: true });
  root.addEventListener('resize', onResize);
  // the phone-layout switch, even where a resize event is not sent (some emulators, split views)
  try { root.matchMedia('(max-width: ' + (MIN_DESKTOP - 1) + 'px)').addEventListener('change', onResize); } catch (_) {}

  root.BDOCFloat = Object.freeze({ core, raise, reset, isBox, boxOf });
})(typeof window !== 'undefined' ? window : globalThis);
