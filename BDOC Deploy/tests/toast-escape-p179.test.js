// p179: the Battle Tracker toasts escape the item's label.
//
// af() pushes its message into the feed and rf() writes it with innerHTML. The undo toast
// ('↶ Undone: …'), the delete toasts ('Deleted: …') and the watchlist toasts put an item's
// label there without esc(). A .bdoc.json plan file is untrusted (it is shared between people),
// and sanitizeSpec did not touch meta.label, name or label.text, so a crafted label ran script
// when the user undid or deleted that item. The autosave restore is trusted, so a label that
// came in from a file before p179 is still raw in IndexedDB: the sinks must escape, not just the
// import.
//
// These tests run the page's own esc / af / rf, BDOCUndo, Delete-key handler, Watchlist and
// _ctxEntityTitle (sliced from index.html), with the real js/bdoc-plan.js, in a vm.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const HTML = read('index.html');
const PLAN = read('js/bdoc-plan.js');
const SW = read('service-worker.js');

const PAYLOAD = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;';

const line = start => { const i = HTML.indexOf('\n' + start); assert.ok(i >= 0, start); return HTML.slice(i + 1, HTML.indexOf('\n', i + 1)); };
const between = (a, b) => { const i = HTML.indexOf(a); assert.ok(i >= 0, a); const j = HTML.indexOf(b, i); assert.ok(j > i, b); return HTML.slice(i, j + b.length); };
const fnSrc = start => { const i = HTML.indexOf(start); assert.ok(i >= 0, start); return HTML.slice(i, HTML.indexOf('\n}\n', i) + 3); };

const ESC_SRC = line('function esc(s){');
const FEED_SRC = [line('let _rfPending=false;'), line('function af(c,x){'), line('function rf(){')].join('\n');
const UNDO_SRC = between('window.BDOCUndo=(function(){', 'var battleEntities=_bdocTrackedArray();');
const KEY_SRC = between("document.addEventListener('keydown',function(e){\n  const t=e.target", '\n});');
const WL_SRC = between('const Watchlist={', '\n};\n');
const TITLE_SRC = fnSrc('function _ctxEntityTitle(e){');

const quiet = { log() {}, warn() {}, error() {}, info() {} };

// a page: the globe stub, the feed, the undo stack and the plan module, wired as index.html wires them
function page(opts) {
  const ents = [];
  let n = 0;
  const fd = { innerHTML: '' };
  const keyHandlers = [];
  const ctx = vm.createContext({
    console: quiet, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, Date, Math, JSON, Promise,
    requestAnimationFrame: f => f(),
    document: {
      addEventListener(type, h) { if (type === 'keydown') keyHandlers.push(h); },
      getElementById: id => (id === 'fdEl' ? fd : null),
      createElement: () => ({}),
    },
    localStorage: { getItem: () => null, setItem() {} },
    EventLog: { add() {} },
    feed: [],
    battleMeta: new WeakMap(),
  });
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.Cesium = { JulianDate: { now: () => 0 } };
  ctx.V = {
    entities: {
      add(o) {
        const e = Object.assign({}, o, { id: o.id || 'ent-' + (++n) });
        if (o.label) e.label = Object.assign({}, o.label, { text: { getValue: () => o.label.text } });
        ents.push(e); return e;
      },
      contains: e => ents.includes(e),
      remove(e) { const i = ents.indexOf(e); if (i >= 0) ents.splice(i, 1); return i >= 0; },
      getById: id => ents.find(e => e.id === id),
    },
    clock: { currentTime: 0 }, scene: { requestRender() {} }, flyTo() {}, selectedEntity: undefined,
  };
  if (opts && opts.store) ctx.BDOCOfflineStore = opts.store;
  vm.runInContext(ESC_SRC, ctx);
  vm.runInContext(FEED_SRC, ctx);
  vm.runInContext(UNDO_SRC, ctx);
  vm.runInContext(KEY_SRC, ctx);
  vm.runInContext(TITLE_SRC + '\nthis._ctxEntityTitle=_ctxEntityTitle;', ctx);
  vm.runInContext(WL_SRC + '\nthis.Watchlist=Watchlist;', ctx);
  vm.runInContext(PLAN, ctx);
  const toasts = () => ctx.feed.map(f => f.x);
  return { ctx, ents, fd, toasts, last: () => toasts()[toasts().length - 1], key: e => keyHandlers.forEach(h => h(e)) };
}
const planDoc = items => ({ format: 'bdoc-plan', version: 1, items });
const noMarkup = (s, what) => assert.ok(!/[<>]/.test(s), `${what} carries markup: ${s}`);

test('a plan file label shown as a Cesium label reaches the undo toast escaped', () => {
  const P = page();
  // no meta label and no name, so _label() falls back to label.text, which sanitizeSpec leaves alone
  const r = P.ctx.BDOCPlan.importDoc(planDoc([{ e: { id: 'evil', point: { pixelSize: 10 }, label: { text: PAYLOAD }, meta: { label: '', type: 'tactical' } } }]));
  assert.deepEqual({ ...r }, { items: 1, failed: 0 });
  assert.equal(P.ents.length, 1);
  P.ctx.BDOCUndo.undo();
  assert.equal(P.ents.length, 0, 'undo removed the imported item');
  assert.equal(P.last(), '↶ Undone: ' + ESCAPED);
  // what rf() hands to innerHTML: the payload is text, there is no <img element
  assert.ok(P.fd.innerHTML.includes('↶ Undone: ' + ESCAPED));
  assert.ok(!P.fd.innerHTML.includes('<img'));
});

test('the Delete key on an imported item: "Deleted: …" is escaped', () => {
  const P = page();
  P.ctx.BDOCPlan.importDoc(planDoc([{ e: { id: 'evil', point: { pixelSize: 10 }, label: { text: PAYLOAD + '\nsecond line' }, meta: { label: '', type: 'tactical' } } }]));
  P.ctx.V.selectedEntity = P.ents[0];
  let prevented = false;
  P.key({ target: { tagName: 'CANVAS' }, key: 'Delete', preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(P.ents.length, 0, 'the item is gone');
  assert.equal(P.last(), 'Deleted: ' + ESCAPED, 'first line of the label, escaped');
  assert.ok(!P.fd.innerHTML.includes('<img'));
});

test('a plan file meta.label loses < > on import, and the toast still escapes what is left', () => {
  const P = page();
  P.ctx.BDOCPlan.importDoc(planDoc([{ e: { id: 'evil', name: PAYLOAD, point: { pixelSize: 10 }, meta: { label: PAYLOAD + ' & "co"', type: 'tactical' } } }]));
  const e = P.ents[0];
  assert.equal(P.ctx.battleMeta.get(e).label, 'img src=x onerror=alert(1) & "co"');
  assert.equal(e.name, 'img src=x onerror=alert(1)');
  P.ctx.BDOCUndo.undo();
  assert.equal(P.last(), '↶ Undone: img src=x onerror=alert(1) &amp; &quot;co&quot;');
});

test('autosave restore (trusted, no sanitizeSpec): a raw label saved before p179 is escaped in the toasts', async () => {
  let doc = null;
  const P = page({ store: { getMeta: async () => doc } });
  doc = planDoc([
    { e: { id: 'old-1', point: { pixelSize: 10 }, meta: { label: PAYLOAD, type: 'tactical' } } },
    { e: { id: 'old-2', point: { pixelSize: 10 }, meta: { label: PAYLOAD, type: 'tactical' } } },
  ]);
  assert.equal(await P.ctx.BDOCPlan._restore(), 2);
  assert.equal(P.ctx.battleMeta.get(P.ents[0]).label, PAYLOAD, 'restore keeps the saved label as it was');
  P.ctx.BDOCUndo.undo();
  assert.equal(P.last(), '↶ Undone: ' + ESCAPED);
  P.ctx.V.selectedEntity = P.ents[0];
  P.key({ target: { tagName: 'CANVAS' }, key: 'Backspace', preventDefault() {} });
  assert.equal(P.last(), 'Deleted: ' + ESCAPED);
  assert.equal(P.ents.length, 0);
  assert.ok(!P.fd.innerHTML.includes('<img'));
});

test('an undo label recorded by the page is plain text and is escaped exactly once', () => {
  const P = page();
  const ent = P.ctx.V.entities.add({ point: {} });
  P.ctx.BDOCUndo.record(ent, 'TAK update of ' + PAYLOAD + ' & co', { undo() {} });
  P.ctx.BDOCUndo.undo();
  assert.equal(P.last(), '↶ Undone: TAK update of ' + ESCAPED + ' &amp; co');
  // the TAK import hands its label over unescaped now (it used to esc() it, which undo() would double).
  // p186: one record per file, made by _cotImportText from the raw file name (control characters out)
  const imp = fnSrc('async function _cotImportText(text,fileName){');
  const rec = imp.slice(imp.indexOf('BDOCUndo.record(')).split('\n')[0];
  assert.match(rec, /^BDOCUndo\.record\(null,'TAK file "'\+String\(fileName\|\|'file'\)\.replace\(/);
  assert.doesNotMatch(rec, /esc\(/);
  assert.doesNotMatch(fnSrc('function _cotUpdate(ent,r,S){'), /BDOCUndo\.record\(/);
});

test('watchlist toasts escape the right-click title (a plan label, an entity name or a callsign)', () => {
  const P = page();
  P.ctx.BDOCPlan.importDoc(planDoc([{ e: { id: 'evil', point: { pixelSize: 10 }, label: { text: PAYLOAD }, meta: { label: '', type: 'tactical' } } }]));
  const title = P.ctx._ctxEntityTitle(P.ents[0]);
  assert.equal(title, PAYLOAD.slice(0, 46), 'the title is the raw label (it is set with textContent)');
  P.ctx.Watchlist.add({ id: 'evil', name: title, lat: 1, lon: 2, type: 'entity' });
  assert.equal(P.last(), '⭐ Added to watchlist: ' + ESCAPED);
  P.ctx.Watchlist.add({ id: 'evil', name: title, lat: 1, lon: 2, type: 'entity' });
  assert.equal(P.last(), 'Already on watchlist: ' + ESCAPED);
  assert.ok(!P.fd.innerHTML.includes('<img'));
});

test('every af() that shows a Battle Tracker label escapes it at the sink', () => {
  // the right-click "Delete This Marker" path (inside ctxAction) and the Delete key
  const dels = HTML.match(/af\('var\(--bl\)','Deleted: '\+[^)]*\)/g) || [];
  assert.equal(dels.length, 2, 'two delete toasts');
  for (const d of dels) assert.equal(d, "af('var(--bl)','Deleted: '+esc(n)");
  assert.ok(HTML.includes("af('var(--bl)','↶ Undone: '+esc(r.lbl||_label(r.ref)));"));
  // FOXFIRE beacon: the note is typed by the user, still text
  assert.ok(HTML.includes("af('var(--rd)',`${esc(bLabel)} activated at ${esc(bMGRS)}`+(bNote?' — '+esc(bNote.slice(0,40)):''));"));
  // the unit edit toast already escaped; it must not be escaped twice
  assert.match(HTML, /af\('var\(--bl\)','Unit updated: '\+esc\(s\.designation\|\|v\.label\)/);
  // no af() in the Battle Tracker or the watchlist concatenates a bare label / name / comment
  // (saved views and COAs are named by the user on their own device; not covered here)
  const scope = between('// BATTLE TRACKING MODE', '// ═══ HOVER TOOLTIP') + WL_SRC;
  const bare = scope.match(/\baf\([^;\n]*\+\s*(?:m|meta|now|item|entry|r|e|ent|it)\.(?:label|name|comment|lbl|cs)\b[^;\n]*/g) || [];
  assert.deepEqual(bare, []);
});

test('sanitizeSpec: < > leave meta.label and name; a non-text label or name is dropped', () => {
  const pre = ['  const SIDC_RE', '  const takUidOk', '  const COT_TYPE_RE'].map(s => PLAN.slice(PLAN.indexOf(s), PLAN.indexOf('\n', PLAN.indexOf(s)))).join('\n');
  const fnStart = PLAN.indexOf('  function sanitizeSpec(s) {');
  const sx = vm.createContext({});
  vm.runInContext(pre + '\n' + PLAN.slice(fnStart, PLAN.indexOf('\n  }\n', fnStart) + 4) + ';this.f=sanitizeSpec;', sx);
  const s = sx.f({ name: '<b>Hi</b>', meta: { label: '<script>x</script>', comment: 'range < 5 km' } });
  assert.equal(s.name, 'bHi/b');
  assert.equal(s.meta.label, 'scriptx/script');
  assert.equal(s.meta.comment, 'range < 5 km', 'notes keep < > (every note sink escapes or uses textContent)');
  noMarkup(s.meta.label, 'label');
  assert.equal(sx.f({ meta: { label: 7 } }).meta.label, '7');
  for (const bad of [null, true, { toString: () => '<i>' }, ['<i>']]) {
    assert.ok(!('label' in sx.f({ meta: { label: bad } }).meta), String(bad));
    assert.ok(!('name' in sx.f({ name: bad })), String(bad));
  }
  assert.deepEqual(Object.keys(sx.f({ meta: { type: 'tactical' } }).meta), ['type'], 'no label is not added');
});

// p179 ships after p178 (bdoc-v180, 7ef330e) and p180 (bdoc-v182, 19fc2a9), so it takes bdoc-v183.
// v181 was this branch's number while it waited; it never went live, so it has no (prev) line.
test('versions: SW v183 for p179 with v182 / v180 / v179 / v178 kept; bdoc-plan.js at p179; LazyLoader = module ?v=', () => {
  // live line while p179 is newest; a "(prev)" line once a later build ships
  assert.match(SW, /^(?:\/\/ \(prev\) )?const SW_VERSION = 'bdoc-v183';  \/\/ p179:/m);
  // newest first: p179 (v183), then p180 (v182), p178 (v180), p177 (v179), p176 (v178)
  assert.match(SW, /^(?:\/\/ \(prev\) )?const SW_VERSION = 'bdoc-v183';[^\n]*\n\/\/ \(prev\) const SW_VERSION = 'bdoc-v182';  \/\/ p180:[^\n]*\n\/\/ \(prev\) const SW_VERSION = 'bdoc-v180';  \/\/ p178:[^\n]*\n\/\/ \(prev\) const SW_VERSION = 'bdoc-v179';  \/\/ p177:[^\n]*\n\/\/ \(prev\) const SW_VERSION = 'bdoc-v178';  \/\/ p176:/m);
  assert.equal((SW.match(/^const SW_VERSION = /gm) || []).length, 1, 'one live SW_VERSION line');
  const live = Number(/^const SW_VERSION = 'bdoc-v(\d+)/m.exec(SW)[1]);
  assert.ok(live >= 183, `SW_VERSION v${live}`);
  const m = /<script src="js\/bdoc-plan\.js\?v=(p1(?:79|[89]\d)\w*)"><\/script>/.exec(HTML);
  assert.ok(m, 'bdoc-plan.js is at p179 or later');
  assert.ok(SW.includes(`'/js/bdoc-plan.js?v=${m[1]}',`), 'precached at the same ?v=');
  const lz = /_version:\s*'([^']+)'/.exec(HTML)[1];
  const mods = [...SW.matchAll(/'\/js\/modules\/[^'?]+\?v=([^']+)'/g)].map(x => x[1]);
  assert.ok(mods.length > 5, 'module precache entries found');
  for (const v of mods) assert.equal(v, lz, 'LazyLoader _version = module ?v=');
});
