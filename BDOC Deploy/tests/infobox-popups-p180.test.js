// p180 — links in the map info box open as normal tabs.
// Travon's screenshot: RIPE ATLAS PROBE #13312 → "OPEN SOURCE →" opened atlas.ripe.net as
// "refused to connect" (ERR_BLOCKED_BY_RESPONSE). The info box is a sandboxed iframe; a tab it
// opens inherits that sandbox unless the frame has allow-popups-to-escape-sandbox, and Chrome
// refuses any page that sends Cross-Origin-Opener-Policy (RIPE sends same-origin-allow-popups)
// in a sandboxed tab.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const INIT = read('js/cesium-init.js'), HTML = read('index.html'), SW = read('service-worker.js');

test('the info box frame lets the tabs it opens escape its sandbox', () => {
  const m = /V\.infoBox\.frame\.setAttribute\('sandbox','([^']*)'\);\n\s*V\.infoBox\.frame\.src='about:blank';/.exec(INIT);
  assert.ok(m, 'sandbox is set, then the frame reloads so it takes effect');
  const flags = m[1].split(/\s+/);
  for (const f of ['allow-same-origin', 'allow-scripts', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-forms']) {
    assert.ok(flags.includes(f), f);
  }
  // nothing broader than before: no top navigation, no modals, no downloads
  assert.deepStrictEqual(flags.filter(f => /top-navigation|modals|downloads|pointer-lock/.test(f)), []);
  assert.strictEqual((INIT.match(/setAttribute\('sandbox'/g) || []).length, 1, 'one place sets it');
});

test('card links that open a new tab keep rel="noopener noreferrer"', () => {
  for (const f of ['js/modules/aoi-watch.js', 'js/modules/layers-conflict.js']) {
    const src = read(f);
    const blank = src.match(/<a [^>]*target="_blank"[^>]*>/g) || [];
    assert.ok(blank.length > 0, f);
    for (const a of blank) assert.match(a, /rel="noopener noreferrer"/, f + ': ' + a.slice(0, 80));
  }
});

test('versions: cesium-init.js at p180 in index and SW; SW v182 with v180 kept; LazyLoader equals every module', () => {
  assert.equal((HTML.match(/<script src="js\/cesium-init\.js\?v=p180"><\/script>/g) || []).length, 1);
  assert.ok(SW.includes("'/js/cesium-init.js?v=p180',"));
  assert.ok(!/cesium-init\.js\?v=p163i'/.test(SW) && !HTML.includes('cesium-init.js?v=p163i'));
  assert.match(SW, /^(?:\/\/ \(prev\) )?const SW_VERSION = 'bdoc-v182';  \/\/ p180: links in the map info box/m);
  assert.match(SW, /^\/\/ \(prev\) const SW_VERSION = 'bdoc-v180';  \/\/ p178:/m);
  assert.equal((SW.match(/^const SW_VERSION = /gm) || []).length, 1, 'one live SW_VERSION line');
  // cesium-init.js is not a js/modules file: LazyLoader keeps its build, equal to every module ?v=
  const lz = /_version:\s*'([^']+)'/.exec(HTML)[1];
  const mods = [...SW.matchAll(/'\/js\/modules\/[^'?]+\?v=([^']+)'/g)].map(m => m[1]);
  assert.ok(mods.length > 5);
  for (const v of mods) assert.equal(v, lz);
});
