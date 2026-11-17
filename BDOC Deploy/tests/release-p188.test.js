// p188 release: layer workspace persistence + War Room boot race.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
const AUTH = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth.js'), 'utf8');

test('SW bdoc-v192 for p188, with v191 kept as a (prev) line', () => {
  assert.match(SW, /^(?:\/\/ \(prev\) )?const SW_VERSION = 'bdoc-v192';  \/\/ p188:[^\n]*\n\/\/ \(prev\) const SW_VERSION = 'bdoc-v191';  \/\/ p187:/m);
});
test('auth.js at ?v=p188 (or later) in page and precache', () => {
  assert.ok(/auth\.js\?v=p(18[89]|19\d)/.test(HTML));
  assert.ok(/auth\.js\?v=p(18[89]|19\d)/.test(SW));
});
test('boot restore and War Room auto-arm both use the idempotent bdocLayerOn, never a raw toggle', () => {
  assert.match(HTML, /window\.bdocLayerOn=function\(ly\)/);
  assert.match(HTML, /bdocLayerOn\('warlive'\)/);
  assert.ok(!/data-layer="warlive"\]'\);\s*if\(el&&!el\.classList\.contains\('on'\)&&!layers\.warlive\)\{togLy\(el\)/.test(HTML));
});
test('layer persistence keeps saved layers that are locked right now', () => {
  assert.match(HTML, /BDOC_Auth\.canAccess\(k\)\)\)\);Object\.keys\(layers\)/);
});
test('a tier change re-offers saved layers once boot restore has run', () => {
  assert.match(AUTH, /_bdocRestoreArmed&&window\.bdocRestoreLayers/);
});
