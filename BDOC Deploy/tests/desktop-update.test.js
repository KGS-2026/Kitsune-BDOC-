// Desktop update check: version comparison must be right or we either nag
// users forever (false positive) or never warn them (false negative — they
// find out their build is stale when the grid is already down).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Pull just bdocVersionNewer out of index.html — no DOM needed.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function bdocVersionNewer');
assert.ok(start > 0, 'bdocVersionNewer not found in index.html');
let depth = 0, i = html.indexOf('{', start), end = start;
for (; i < html.length; i++) {
  if (html[i] === '{') depth++;
  else if (html[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
}
const ctx = { };
vm.createContext(ctx);
vm.runInContext(html.slice(start, end) + '\nthis.fn = bdocVersionNewer;', ctx);
const newer = ctx.fn;

test('detects a newer patch / minor / major', () => {
  assert.equal(newer('8.1.1', '8.1.0'), true);
  assert.equal(newer('8.2.0', '8.1.0'), true);
  assert.equal(newer('9.0.0', '8.9.9'), true);
});

test('same version is NOT newer (no nagging)', () => {
  assert.equal(newer('8.1.0', '8.1.0'), false);
  assert.equal(newer('8.1.0', '8.1'), false, '8.1 and 8.1.0 are the same build');
});

test('older release never prompts a downgrade', () => {
  assert.equal(newer('8.0.0', '8.1.0'), false);
  assert.equal(newer('7.9.9', '8.0.0'), false);
});

test('strips desktop-v and v tag prefixes', () => {
  assert.equal(newer('desktop-v8.2.0', '8.1.0'), true);
  assert.equal(newer('v8.2.0', '8.1.0'), true);
  assert.equal(newer('desktop-v8.1.0', '8.1.0'), false);
});

test('10 > 9 — string compare would get this wrong', () => {
  assert.equal(newer('8.10.0', '8.9.0'), true);
  assert.equal(newer('8.9.0', '8.10.0'), false);
});

test('the real current case: v8.0.0 published vs 8.1.0 installed', () => {
  // GitHub's only release is v8.0.0; package.json is 8.1.0. A user who built
  // from source must NOT be told to "update" to an older binary.
  assert.equal(newer('v8.0.0', '8.1.0'), false);
});

test('garbage input fails safe (no prompt)', () => {
  assert.equal(newer('', '8.1.0'), false);
  assert.equal(newer(undefined, '8.1.0'), false);
  assert.equal(newer('not-a-version', '8.1.0'), false);
});
