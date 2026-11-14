// The Battle Tracker's own page code, run in node. Test-only.
//
// index.html has no build step and its Battle Tracker lives in one inline script, so most tests
// could only match its text. This helper cuts the real code out of index.html (by the names of its
// functions, not by line number) and runs it in a vm with the real js/modules/battle-symbols.js,
// js/bdoc-atak.js, js/bdoc-plan.js and js/bdoc-cot-import.js. Cesium, the viewer, milsymbol, the
// feed element and the IndexedDB wrapper are small stand-ins; the XML DOM is tests/helpers/xml-dom.js.
// A test then does what a user does (open a TAK file, export, undo, open a plan file) and looks at
// what is on the map.
//
// make(opts) → { ctx, ents, run, get, toasts, downloads, logs, store, V, Cesium, fd }
//   opts.ms === false   no milsymbol (the offline icons)
//   opts.failMs         the symbol set cannot load
//   opts.idb, opts.savedDoc   an autosave to restore
//   opts.DOMPurify      the sanitizer OPEN FILE uses when it is on the page
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const HTML = read('index.html');
const { DOMParser } = require('./xml-dom.js');

// ── cutting code out of index.html ───────────────────────────────────────────────────────────────
const at = (s, from) => { const i = HTML.indexOf(s, from || 0); if (i < 0) throw new Error('battle-page: not found in index.html: ' + s); return i; };
const lineStart = i => HTML.lastIndexOf('\n', i) + 1;
const lineEnd = i => { const j = HTML.indexOf('\n', i); return j < 0 ? HTML.length : j; };
// one whole line that starts with `start`
const line = start => { const i = at('\n' + start) + 1; return HTML.slice(i, lineEnd(i)); };
// a top-level function: from its first line to the closing brace in column 0
const fnEnd = i => { const j = HTML.indexOf('\n}\n', i); if (j < 0) throw new Error('battle-page: no end of function after ' + HTML.slice(i, i + 40)); return j + 2; };
const fn = start => { const i = lineStart(at(start)); return HTML.slice(i, fnEnd(i)); };
// from the line holding `a` to an end found after `b`: the end of b's line, of the function b starts, or the text `close`
const span = (a, b, how, close) => {
  const i = lineStart(at(a)), j = at(b, i);
  const end = how === 'line' ? lineEnd(j) : how === 'fn' ? fnEnd(j) : at(close, j) + close.length;
  return HTML.slice(i, end);
};

const PAGE = [
  ['esc', line('function esc(s){')],
  ['svgToDataUri', line('function svgToDataUri(svg){')],
  ['feed', [line('let _rfPending=false;'), line('function af(c,x){'), line('function rf(){')].join('\n')],
  ['battleMode', line('let battleMode=false;')],
  ['undo', span('window.BDOCUndo=(function(){', 'var battleEntities=_bdocTrackedArray();', 'line')],
  ['draw-state', span('let battleTempEntities=[];', 'let battleRectCorner=null;', 'line')],
  ['icons', span('const BATTLE_ICONS={', 'const BATTLE_ICONS={', 'text', '\n};')],
  ['nato', span("let battleEchelon='none';", 'function buildNatoSVG(icon,color,affiliation,key){', 'fn')],
  ['stubs', 'let _battleIconFilter="all";function populateBattleIcons(){};function bpSymChanged(){};'],
  ['symbols', span('const _BP_AFF_COL=', "window.addEventListener('bdoc:plan-imported',e=>{", 'text', '\n});')],
  ['readable', fn('function _readable(css){')],
  ['addUnit', fn('function _bpAddUnit(lat,lon,st,comment){')],
  ['remove-clear', span('function removeBattleEntity(){', 'function clearBattleEntities(){', 'fn')],
  ['pickCoT', fn('function _bpPickCoT(meta){')],
  ['exportCoT', fn('function exportBattlePlanCoT(){')],
  ['tak-import', span('const _cotHasIcon=', 'async function _cotImportText(text,fileName){', 'fn')],
  ['meta', span('const battleMeta=new WeakMap();', 'function attachMeta(entity,meta){', 'fn')],
  ['outline', line('let outlinePoints=[];')],
  // the note editor, the position text and the popup every battle item uses
  ['popup', span('function editEntityNote(){', 'function buildEntityPopup(opts){', 'fn')],
];
const SRC = { sym: read('js/modules/battle-symbols.js'), atak: read('js/bdoc-atak.js'), plan: read('js/bdoc-plan.js'), cot: read('js/bdoc-cot-import.js') };

function make(opts) {
  opts = opts || {};
  const ents = [];
  let n = 0;
  const fd = { innerHTML: '' };
  const downloads = [], toasts = [], logs = [];
  const store = { doc: opts.savedDoc || null, puts: 0 };
  const ctx = vm.createContext({
    console: opts.verbose ? console : { log() {}, info() {}, warn(...a) { logs.push(a.map(String).join(' ')); }, error(...a) { logs.push(a.map(String).join(' ')); } },
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); if (t.unref) t.unref(); return t; },
    clearTimeout: t => clearTimeout(t), setInterval: () => 0, clearInterval() {},
    Date, Math, JSON, Promise, btoa, DOMParser,
    requestAnimationFrame: f => f(),
    confirm: () => true, prompt: () => null,
    document: {
      addEventListener() {}, removeEventListener() {},
      getElementById: id => (id === 'fdEl' ? fd : null),
      createElement: () => ({ click() {}, style: {} }),
      body: { appendChild() {}, removeChild() {}, classList: { add() {}, remove() {} } },
      querySelectorAll: () => [], querySelector: () => null, hidden: false,
    },
    localStorage: { getItem: () => null, setItem() {} },
    EventLog: { add() {} },
    feed: [],
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: function Blob(parts) { this.text = parts.join(''); },
  });
  ctx.window = ctx;
  ctx.removeEventListener = () => {};
  ctx.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
  const listeners = {};
  ctx.addEventListener = (t, f) => { (listeners[t] = listeners[t] || []).push(f); };
  ctx.dispatchEvent = e => { (listeners[e.type] || []).forEach(f => f(e)); return true; };
  if (opts.DOMPurify) ctx.DOMPurify = opts.DOMPurify;
  // in-memory stand-in for the IndexedDB wrapper bdoc-plan.js saves to
  ctx.BDOCOfflineStore = {
    open: async () => ({ transaction() { const tx = { objectStore: () => ({ put(rec) { store.doc = JSON.parse(JSON.stringify(rec.v)); store.puts++; setImmediate(() => tx.oncomplete && tx.oncomplete()); } }) }; return tx; } }),
    getMeta: async () => (opts.idb ? store.doc : null),
  };
  // ── a minimal Cesium: positions are (lon, lat) held as x, y ──
  class Cartesian3 { constructor(x, y, z) { this.x = x; this.y = y; this.z = z || 0; } static fromDegrees(lon, lat) { return new Cartesian3(lon, lat, 0); } }
  class Cartesian2 { constructor(x, y) { this.x = x; this.y = y; } }
  class NearFarScalar { constructor(a, b, c, d) { this.near = a; this.nearValue = b; this.far = c; this.farValue = d; } }
  class DistanceDisplayCondition { constructor(a, b) { this.near = a; this.far = b; } }
  class Rectangle { }
  class PolygonHierarchy { constructor(p, h) { this.positions = p; this.holes = h; } }
  class Color {
    constructor(r, g, b, a) { this.red = r; this.green = g; this.blue = b; this.alpha = a == null ? 1 : a; }
    static fromCssColorString(s) { const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(String(s)); return m ? new Color(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255, 1) : new Color(1, 1, 1, 1); }
    static clone(c) { return new Color(c.red, c.green, c.blue, c.alpha); }
    static lerp(a, b, t, r) { r.red = a.red + (b.red - a.red) * t; r.green = a.green + (b.green - a.green) * t; r.blue = a.blue + (b.blue - a.blue) * t; r.alpha = 1; return r; }
    withAlpha(a) { return new Color(this.red, this.green, this.blue, a); }
    toCssHexString() { const h = x => Math.round(x * 255).toString(16).padStart(2, '0'); return '#' + h(this.red) + h(this.green) + h(this.blue); }
  }
  Color.WHITE = new Color(1, 1, 1, 1); Color.BLACK = new Color(0, 0, 0, 1);
  const Cesium = ctx.Cesium = {
    JulianDate: { now: () => 0 }, Cartesian3, Cartesian2, NearFarScalar, DistanceDisplayCondition, Rectangle, PolygonHierarchy, Color,
    Cartographic: { fromCartesian: p => ({ longitude: p.x * Math.PI / 180, latitude: p.y * Math.PI / 180, height: 0 }) },
    Math: { toDegrees: r => r * 180 / Math.PI },
    VerticalOrigin: { CENTER: 0, TOP: 1 }, HeightReference: { CLAMP_TO_GROUND: 1 }, LabelStyle: { FILL_AND_OUTLINE: 2 },
    ColorMaterialProperty: function () {},
  };
  // an entity whose fields behave like Cesium properties (getValue), as the page code expects
  const prop = v => (v && typeof v.getValue === 'function') ? v : { getValue: () => v };
  const gfx = o => {
    const g = {};
    const define = (t, k, v) => { let cur = prop(v); Object.defineProperty(t, k, { enumerable: true, configurable: true, get: () => cur, set: x => { cur = prop(x); } }); };
    for (const k of Object.keys(o)) define(g, k, o[k]);
    return new Proxy(g, { set(t, k, v) { if (!(k in t)) define(t, k, v); else t[k] = v; return true; } });
  };
  class Ent {
    constructor(o) {
      this.id = o.id || ('guid-' + String(++n).padStart(4, '0') + '-aaaa-bbbb-cccc-dddddddddddd');
      if (o.name) this.name = o.name;
      if (o.show === false) this.show = false;
      this._pos = o.position !== undefined ? prop(o.position) : undefined;
      this._desc = o.description !== undefined ? prop(o.description) : undefined;
      for (const g of ['billboard', 'label', 'point', 'polyline', 'polygon', 'ellipse', 'rectangle']) if (o[g]) this[g] = gfx(o[g]);
      this.definitionChanged = { addEventListener() {} };
    }
    get position() { return this._pos; } set position(v) { this._pos = v === undefined ? undefined : prop(v); }
    get description() { return this._desc; } set description(v) { this._desc = v === undefined ? undefined : prop(v); }
  }
  const V = ctx.V = {
    entities: {
      add(o) { const e = new Ent(o); ents.push(e); return e; },
      contains: e => ents.includes(e),
      remove(e) { const i = ents.indexOf(e); if (i >= 0) ents.splice(i, 1); return i >= 0; },
      getById: id => ents.find(e => e.id === id),
      get values() { return ents; },
    },
    clock: { currentTime: 0 }, scene: { requestRender() {} }, flyTo(x) { ctx._flyTo = x; }, selectedEntity: undefined,
  };
  ctx.BDOC = { LazyLoader: { load: () => Promise.resolve() } };
  // milsymbol stand-in: the SVG names the code it was asked to draw
  const fakeMs = { Symbol: function (sidc) { this.asSVG = () => '<svg xmlns="http://www.w3.org/2000/svg" data-sidc="' + sidc + '"></svg>'; this.getAnchor = () => ({ x: 20, y: 20 }); this.getSize = () => ({ width: 40, height: 40 }); this.isValid = () => true; } };
  if (opts.ms !== false) ctx.ms = fakeMs;
  const run = (src, name) => vm.runInContext(src, ctx, { filename: name || 'expr.js' });
  for (const [name, src] of PAGE) run(src, 'index.html:' + name);
  run(SRC.sym, 'battle-symbols.js');
  if (opts.failMs) run('BDOCSym.ensure=()=>Promise.resolve(false);', 'failMs');
  run(SRC.atak, 'bdoc-atak.js');
  ctx._downloads = downloads;
  run('downloadCoT=function(xml,name){_downloads.push({xml,name})};', 'dl');   // capture instead of download
  ctx._toasts = toasts;
  run('{const _af=af;af=function(c,x){_toasts.push(x);return _af(c,x)}}', 'af-tap');
  run(SRC.plan, 'bdoc-plan.js');
  run(SRC.cot, 'bdoc-cot-import.js');
  const get = expr => run(expr, 'get');
  return { ctx, ents, run, get, toasts, downloads, logs, store, V, Cesium, fakeMs, fd };
}

const wait = ms => new Promise(r => setTimeout(r, ms));
// CoT building blocks for test files
const ev = (a, inner) => `<event version="2.0" ${a}>${inner || ''}</event>`;
const pt = (lat, lon) => `<point lat="${lat}" lon="${lon}" hae="9999999.0" ce="9999999.0" le="9999999.0"/>`;
const det = (cs, rm) => `<detail>${cs != null ? `<contact callsign="${cs}"/>` : ''}${rm != null ? `<remarks>${rm}</remarks>` : ''}</detail>`;
module.exports = { make, wait, ev, pt, det, HTML, read, DOMParser, ROOT, PAGE };
