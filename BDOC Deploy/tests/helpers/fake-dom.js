// A small page for testing js/bdoc-float.js's page glue in node. Test-only: not a browser.
//
// What it models, and nothing more:
// - a viewport (innerWidth / innerHeight) and position:fixed elements laid out from left / top /
//   right / bottom / width / height / max-height (px or %), plus the transforms the app's boxes use
//   (translateX(-50%), translate(-50%,-50%), translate(100%, 0));
// - the cascade the glue depends on: a stylesheet value (el.css, may end in "!important") against an
//   inline value with or without priority;
// - selectors: tag, #id, .class, [attr], [attr="v"], compound, descendant, and comma lists;
// - listeners on window and document, fired by hand with win.fire(type, props);
// - timers and animation frames that run only when the test says so (win.runTimers / win.runFrames).
// Children of a box are placed with el.box = {x, y, w, h}, relative to their parent's rectangle.
'use strict';

function parseCompound(s) {
  // "div#a.b[c="d"]" -> { tag, id, classes[], attrs[[name, value|null]] }
  const out = { tag: null, id: null, classes: [], attrs: [] };
  const re = /^([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/;
  let rest = s;
  while (rest) {
    const m = re.exec(rest);
    if (!m) throw new Error('fake-dom: unsupported selector "' + s + '"');
    if (m[1]) out.tag = m[1].toUpperCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else out.attrs.push([m[4], m[5] != null ? m[5] : m[6] != null ? m[6] : m[7] != null ? m[7] : null]);
    rest = rest.slice(m[0].length);
  }
  return out;
}

function matchCompound(el, c) {
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const k of c.classes) if (!el.classList.contains(k)) return false;
  for (const [n, v] of c.attrs) {
    const a = el.getAttribute(n);
    if (a == null || (v != null && a !== v)) return false;
  }
  return true;
}

function matchOne(el, sel) {
  const parts = sel.trim().split(/\s+/).map(parseCompound);
  if (!matchCompound(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  for (let p = el.parentElement; p && i >= 0; p = p.parentElement) if (matchCompound(p, parts[i])) i--;
  return i < 0;
}

function createPage(opts) {
  const o = opts || {};
  const win = { innerWidth: o.width || 1600, innerHeight: o.height || 1000 };
  const listeners = { win: new Map(), doc: new Map() };
  const timers = []; const frames = [];
  let nextId = 1;

  class El {
    constructor(tag) {
      this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.id = ''; this.parentElement = null; this.children = [];
      this.css = {}; this.attrs = {}; this.box = null; this.contentW = 300; this.contentH = 200; this.textContent = '';
      const map = new Map();
      this.style = {
        _map: map,
        setProperty(p, v, pr) { if (v === '' || v == null) map.delete(p); else map.set(p, [String(v), pr || '']); },
        getPropertyValue(p) { return map.has(p) ? map.get(p)[0] : ''; },
        getPropertyPriority(p) { return map.has(p) ? map.get(p)[1] : ''; },
        removeProperty(p) { map.delete(p); },
        get cssText() { return Array.from(map).map(([p, v]) => p + ': ' + v[0] + (v[1] ? ' !important' : '') + ';').join(' '); },
      };
      const cls = new Set(); const self = this;
      this.classList = {
        add(...k) { k.forEach(x => cls.add(x)); }, remove(...k) { k.forEach(x => cls.delete(x)); },
        contains(k) { return cls.has(k); }, toggle(k, on) { const want = on == null ? !cls.has(k) : !!on; if (want) cls.add(k); else cls.delete(k); return want; },
        get value() { return Array.from(cls).join(' '); },
      };
      Object.defineProperty(this, 'className', { get() { return self.classList.value; }, set(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => cls.add(x)); } });
    }
    get isConnected() { for (let n = this; n; n = n.parentElement) if (n === doc.documentElement) return true; return false; }
    getAttribute(n) { return n === 'id' ? (this.id || null) : n === 'class' ? (this.className || null) : (n in this.attrs ? this.attrs[n] : null); }
    setAttribute(n, v) { if (n === 'id') this.id = String(v); else if (n === 'class') this.className = v; else this.attrs[n] = String(v); }
    appendChild(c) { if (c.parentElement) c.parentElement.children.splice(c.parentElement.children.indexOf(c), 1); c.parentElement = this; this.children.push(c); return c; }
    remove() { if (this.parentElement) { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; } }
    contains(n) { for (; n; n = n.parentElement) if (n === this) return true; return false; }
    matches(sel) { return String(sel).split(',').some(s => s.trim() && matchOne(this, s)); }
    closest(sel) { for (let n = this; n; n = n.parentElement) if (n.matches(sel)) return n; return null; }
    querySelector(sel) { for (const c of this.children) { if (c.matches(sel)) return c; const d = c.querySelector(sel); if (d) return d; } return null; }
    addEventListener() {} removeEventListener() {}
    setPointerCapture(id) { win.captured = { el: this, id }; }
    releasePointerCapture() { win.captured = null; }
    // the winning declaration for a property: inline !important, then stylesheet !important, then inline, then stylesheet
    eff(p) {
      const inl = this.style._map.get(p), base = this.css[p];
      const imp = typeof base === 'string' && /!important\s*$/.test(base);
      const baseVal = base == null ? '' : imp ? base.replace(/\s*!important\s*$/, '') : String(base);
      if (inl && inl[1] === 'important') return inl[0];
      if (imp) return baseVal;
      return inl ? inl[0] : baseVal;
    }
    getBoundingClientRect() {
      const R = (l, t, w, h) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t });
      for (let n = this; n; n = n.parentElement) if (n.eff('display') === 'none') return R(0, 0, 0, 0);
      if (this.box) { const p = this.parentElement.getBoundingClientRect(); return R(p.left + this.box.x, p.top + this.box.y, this.box.w, this.box.h); }
      if (this.eff('position') !== 'fixed') return this.parentElement ? this.parentElement.getBoundingClientRect() : R(0, 0, win.innerWidth, win.innerHeight);
      const vw = win.innerWidth, vh = win.innerHeight;
      const px = (v, ref) => (v === '' || v === 'auto' || v == null ? null : /%$/.test(v) ? parseFloat(v) / 100 * ref : parseFloat(v));
      let l = px(this.eff('left'), vw), r = px(this.eff('right'), vw), w = px(this.eff('width'), vw);
      let t = px(this.eff('top'), vh), b = px(this.eff('bottom'), vh), h = px(this.eff('height'), vh);
      if (w == null) w = l != null && r != null ? vw - l - r : this.contentW;
      if (h == null) h = t != null && b != null ? vh - t - b : this.contentH;
      const mh = px(this.eff('max-height'), vh); if (mh != null) h = Math.min(h, mh);
      if (l == null) l = r != null ? vw - r - w : 0;
      if (t == null) t = b != null ? vh - b - h : 0;
      const tf = this.eff('transform');
      if (/translateX\(-50%\)/.test(tf)) l -= w / 2;
      else if (/translate\(-50%,\s*-50%\)/.test(tf)) { l -= w / 2; t -= h / 2; }
      else if (/translate\(100%/.test(tf)) l += w;
      return R(l, t, w, h);
    }
  }

  const doc = {
    documentElement: new El('html'), head: null, body: null,
    createElement: tag => new El(tag),
    getElementById(id) { return doc.documentElement.querySelector('#' + id); },
    querySelector(sel) { return doc.documentElement.matches(sel) ? doc.documentElement : doc.documentElement.querySelector(sel); },
    addEventListener(type, fn) { (listeners.doc.get(type) || listeners.doc.set(type, []).get(type)).push(fn); },
    removeEventListener(type, fn) { const a = listeners.doc.get(type) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
  };
  doc.head = doc.documentElement.appendChild(new El('head'));
  doc.body = doc.documentElement.appendChild(new El('body'));

  Object.assign(win, {
    document: doc, captured: null, selectionCleared: 0,
    getComputedStyle(el) {
      return { position: el.eff('position') || 'static', display: el.eff('display') || 'block', visibility: el.eff('visibility') || 'visible',
        opacity: el.eff('opacity') || '1', zIndex: el.eff('z-index') || 'auto', pointerEvents: el.eff('pointer-events') || 'auto' };
    },
    addEventListener(type, fn, opt) { (listeners.win.get(type) || listeners.win.set(type, []).get(type)).push({ fn, capture: opt === true || !!(opt && opt.capture) }); },
    removeEventListener(type, fn) { const a = listeners.win.get(type) || []; const i = a.findIndex(x => x.fn === fn); if (i >= 0) a.splice(i, 1); },
    setTimeout(fn, ms) { const id = nextId++; timers.push({ id, fn, ms: ms || 0 }); return id; },
    clearTimeout(id) { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    requestAnimationFrame(fn) { const id = nextId++; frames.push({ id, fn }); return id; },
    cancelAnimationFrame(id) { const i = frames.findIndex(f => f.id === id); if (i >= 0) frames.splice(i, 1); },
    getSelection() { return { removeAllRanges() { win.selectionCleared++; } }; },
    localStorage: (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, get length() { return m.size; } }; })(),
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    // run what is queued now (not what those callbacks queue)
    runTimers() { const due = timers.splice(0); due.forEach(t => t.fn()); return due.length; },
    runFrames() { const due = frames.splice(0); due.forEach(f => f.fn(0)); return due.length; },
    pendingTimers: () => timers.length, pendingFrames: () => frames.length,
    // window capture listeners, then document, then window bubble listeners
    fire(type, props) {
      const ev = Object.assign({ type, target: doc.body, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: 0, clientY: 0,
        defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } }, props || {});
      const w = (listeners.win.get(type) || []).slice();
      w.filter(x => x.capture).forEach(x => x.fn(ev));
      if (!ev.stopped) (listeners.doc.get(type) || []).slice().forEach(fn => fn(ev));
      if (!ev.stopped) w.filter(x => !x.capture).forEach(x => x.fn(ev));
      return ev;
    },
    resize(w, h) { win.innerWidth = w; if (h) win.innerHeight = h; win.fire('resize'); },
    // a position:fixed child of <body>; css is its stylesheet (e.g. { top: '110px', right: '376px', width: '340px', 'z-index': '56' })
    addBox(id, css, size) {
      const el = new El('div'); el.id = id || '';
      el.css = Object.assign({ position: 'fixed' }, css || {});
      if (size) { if (size.w != null) el.contentW = size.w; if (size.h != null) el.contentH = size.h; }
      return doc.body.appendChild(el);
    },
    // a child placed inside a box, relative to the box's top-left corner
    addChild(parent, tag, box, attrs) {
      const el = new El(tag); el.box = box;
      Object.keys(attrs || {}).forEach(k => el.setAttribute(k, attrs[k]));
      return parent.appendChild(el);
    },
  });
  win.window = win;
  return win;
}

module.exports = { createPage };
