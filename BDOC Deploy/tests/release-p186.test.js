// p186 release wiring (HANDOFF rule 3): SW bdoc-v190 with v189 kept as a "(prev)" line, the four
// changed scripts at ?v=p186 in index.html and in the precache, and LazyLoader left alone (no
// js/modules file changed).
//
// And one rule that had no test. index.html loads its scripts and stylesheets with <script src> and
// <link rel="stylesheet">, and the service worker keeps an offline copy of the ones named in
// STATIC_PRECACHE. Five boot scripts were never named there (the mesh layer on the globe, the local
// plugin renderer, the screen-reader labels, the snapshot client and the WIRE probe), so after an
// update the durable offline cache did not hold them: only the browser's ordinary HTTP cache did,
// which the browser may empty at any time. "every local script and stylesheet ..." below fails when
// a local boot file is missing from the precache or sits there under another ?v=.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const HTML = read('index.html'), SW = read('service-worker.js');
const PRECACHE = [.../const STATIC_PRECACHE = \[([\s\S]*?)\n\];/.exec(SW)[1].matchAll(/^\s*'([^']+)',?\s*$/gm)].map(m => m[1]);

// "p186 or later": a later build that changes one of these files moves its ?v= again
const P186 = 'p1(?:8[6-9]|9\\d)\\w*';

test('SW bdoc-v190 for p186, with v189 kept as a (prev) line', () => {
  // live line while p186 is newest; a "(prev)" line once a later build ships
  assert.match(SW, /^(?:\/\/ \(prev\) )?const SW_VERSION = 'bdoc-v190';  \/\/ p186:/m);
  assert.match(SW, /^(?:\/\/ \(prev\) )?const SW_VERSION = 'bdoc-v190';[^\n]*\n\/\/ \(prev\) const SW_VERSION = 'bdoc-v189';  \/\/ p185c:[^\n]*\n\/\/ \(prev\) const SW_VERSION = 'bdoc-v188';  \/\/ p185b:/m);
  assert.equal((SW.match(/^const SW_VERSION = /gm) || []).length, 1, 'one live SW_VERSION line');
  assert.ok(Number(/^const SW_VERSION = 'bdoc-v(\d+)/m.exec(SW)[1]) >= 190);
});

test('the four changed scripts moved to ?v=p186 in index.html and in the precache', () => {
  for (const f of ['bdoc-float', 'bdoc-cot-import', 'bdoc-plan', 'bdoc-atak']) {
    const tags = [...HTML.matchAll(new RegExp(`<script src="js/${f}\\.js\\?v=([^"]+)"></script>`, 'g'))];
    assert.equal(tags.length, 1, f + ': one script tag');
    assert.match(tags[0][1], new RegExp('^' + P186 + '$'), f + ' is at p186 or later');
    assert.ok(PRECACHE.includes(`/js/${f}.js?v=${tags[0][1]}`), `${f} precached at ${tags[0][1]}`);
    assert.equal(PRECACHE.filter(p => p.split('?')[0] === `/js/${f}.js`).length, 1, f + ': one precache entry');
  }
  // load order the code relies on: the export types before the page script uses them, the plan file
  // code before the TAK reader, and the float code after the globe is set up
  assert.ok(HTML.indexOf('js/bdoc-atak.js?v=') < HTML.indexOf('js/cesium-init.js?v='));
  assert.ok(HTML.indexOf('js/bdoc-plan.js?v=') < HTML.indexOf('js/bdoc-cot-import.js?v='));
  assert.ok(HTML.indexOf('js/bdoc-float.js?v=') > HTML.indexOf('js/cesium-init.js?v='));
});

test('no js/modules file changed: LazyLoader keeps its build, equal to every module ?v=', () => {
  const lz = /_version:\s*'([^']+)'/.exec(HTML)[1];
  const mods = PRECACHE.filter(p => p.startsWith('/js/modules/'));
  assert.ok(mods.length > 5, 'module precache entries found');
  for (const p of mods) assert.equal(p.split('?v=')[1], lz, p);
});

// ── every local boot file is in the offline precache ─────────────────────────────────────────────
// Local <script src> and <link rel="stylesheet"> tags, with comments and inline script text removed
// first (inline code holds strings that look like tags).
function bootFiles() {
  const live = HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/(<script\b(?![^>]*\bsrc=)[^>]*>)[\s\S]*?<\/script>/g, '$1</script>');
  const out = [];
  for (const m of live.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)) out.push(m[1]);
  for (const m of live.matchAll(/<link\b[^>]*>/g)) {
    const href = /\bhref=["']([^"']+)["']/.exec(m[0]), rel = /\brel=["']([^"']+)["']/.exec(m[0]);
    if (href && rel && /(^|\s)stylesheet(\s|$)/.test(rel[1])) out.push(href[1]);
  }
  return out.filter(u => !/^(?:[a-z]+:)?\/\//i.test(u) && !/^data:/i.test(u)).map(u => '/' + u.replace(/^\.?\//, ''));
}
// Deliberately not precached, each with its reason. Keep this list short.
const NOT_PRECACHED = {
  // Nothing in the app calls BDOCIcons, so the page works without it. It also lives in js/modules,
  // where every precache entry must carry the LazyLoader build, and this tag carries its own.
  '/js/modules/icon-factory.js?v=p116': 'unused at run time',
};

test('every local script and stylesheet index.html loads is precached under the same ?v=', () => {
  const boot = bootFiles();
  assert.ok(boot.length >= 30, 'found the boot files (' + boot.length + ')');
  for (const f of ['/js/cesium-init.js', '/css/bdoc.css', '/js/bdoc-float.js', '/js/auth.js']) assert.ok(boot.some(u => u.split('?')[0] === f), f + ' seen as a boot file');
  const missing = boot.filter(u => !PRECACHE.includes(u) && !(u in NOT_PRECACHED));
  assert.deepEqual(missing, [], 'in index.html but not in STATIC_PRECACHE under the same ?v=');
  // the five p186 added
  for (const u of ['/js/snapshot-client.js?v=p122', '/js/bdoc-wire-boot.js?v=p160', '/js/a11y.js?v=p119', '/js/mesh-globe-layer.js?v=p163s', '/js/bdoc-plugin-renderer.js?v=p166']) {
    if (boot.includes(u)) assert.ok(PRECACHE.includes(u), u);
  }
});

test('the one boot file left out of the precache is still unused', () => {
  const boot = bootFiles();
  for (const u of Object.keys(NOT_PRECACHED)) {
    assert.ok(boot.includes(u), u + ' is still loaded by index.html (drop it from NOT_PRECACHED when its tag goes)');
    assert.ok(!PRECACHE.includes(u), u);
  }
  const users = ['index.html']
    .concat(fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f))
    .concat(fs.readdirSync(path.join(ROOT, 'js/modules')).filter(f => f.endsWith('.js') && f !== 'icon-factory.js').map(f => 'js/modules/' + f));
  for (const f of users) assert.ok(!/\bBDOCIcons\b/.test(read(f)), f + ' now uses BDOCIcons: add js/modules/icon-factory.js to the precache');
});

test('the precache names real files, once each', () => {
  assert.equal(new Set(PRECACHE).size, PRECACHE.length, 'no entry twice');
  const files = PRECACHE.map(p => p.split('?')[0]);
  assert.equal(new Set(files).size, files.length, 'no file under two ?v= values');
  for (const p of PRECACHE) {
    if (p === '/') continue;
    assert.ok(fs.existsSync(path.join(ROOT, p.split('?')[0])), p + ' exists (a wrong name is a silent precache miss)');
  }
});

test('the build pill names this build', () => {
  assert.match(HTML, new RegExp(`id="bdocBuildPill"[^>]*>BUILD ${P186}</span>`));
});

// scripts/ci-validate.sh checks js/ and netlify/functions/*.js; the service worker sits beside
// index.html and nothing parsed it. p186 edits its precache list, and a slip there would take the
// offline cache and Web Push down with it.
test('service-worker.js still parses as a script', () => {
  assert.doesNotThrow(() => new vm.Script(SW, { filename: 'service-worker.js' }));
});

// The build pill opens the changelog. Its box had no height limit: with 19 releases it stood about
// 4,700 px tall, centred, so on any screen the newest entries were above the top edge and CLOSE was
// below the bottom, with nothing to scroll.
test('the changelog popup scrolls inside the screen, and its newest entry is this build', () => {
  const fn = HTML.slice(HTML.indexOf('function showBdocChangelog(){'), HTML.indexOf('// Phase 7A (2026-05-05)'));
  assert.ok(fn.length > 500 && fn.length < 6000, 'found showBdocChangelog');
  assert.match(fn, /max-width:520px;max-height:calc\(100vh - 40px\);overflow-y:auto;box-sizing:border-box;/);
  assert.match(fn, /position:fixed;inset:0;[^']*display:flex;align-items:center;justify-content:center;padding:20px/, 'the 40 px is the backdrop padding, top and bottom');
  // every item is escaped on the way in
  assert.ok(fn.includes('rel.items.forEach(it=>{html+=`<li>${esc(it)}</li>`});'));
  const start = HTML.indexOf('const _BDOC_CHANGELOG=[');
  const lines = HTML.slice(start, start + 4000).split('\n');
  const ver = /^  \{ver:'([^']+)',items:\[$/.exec(lines[1]);
  assert.ok(ver, 'first changelog entry');
  // p186 or later (before p186 the newest entry was p156g, thirty builds behind the pill)
  assert.match(ver[1], new RegExp('^' + P186 + ' [(]20\\d\\d-'), 'the newest entry is p186 or later');
  const items = [];
  for (let i = 2; i < lines.length && lines[i].startsWith("    '"); i++) items.push(lines[i].trim());
  assert.ok(items.length >= 3 && items.length <= 9, items.length + ' items');
  // plain single-quoted strings: an apostrophe or a backslash inside one would end the script
  for (const it of items) assert.match(it, /^'[^'\\]+',?$/, it.slice(0, 40));
});
