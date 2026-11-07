// p177 ship check — exporting a plan to TAK and opening that file again must not add copies.
// Range rings and bullseyes keep their centre both on its own and inside a drawing group, so:
// the export writes each uid once, and the import finds group members as "already on the map".
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const HTML = read('index.html'), PLAN = read('js/bdoc-plan.js');

function cotFind(battleEntities, meta, alive) {
  const i = HTML.indexOf('function _cotFind(uid){');
  const src = HTML.slice(i, HTML.indexOf('\n}\n', i) + 3);
  const ctx = vm.createContext({ battleEntities, battleMeta: meta, V: { entities: { contains: e => alive.has(e) } } });
  vm.runInContext(src + ';this.f=_cotFind;', ctx);
  return ctx.f;
}

test('the import finds an entity that only lives inside a drawing group', () => {
  const centre = { id: 'aaaa-1' }, ring = { id: 'aaaa-2' }, unit = { id: 'bbbb-1' }, tak = { id: 'cccc-1' }, gone = { id: 'dddd-1' };
  const meta = new Map([[unit, { type: 'unit' }], [tak, { type: 'unit', cotUid: 'ANDROID-123' }], [gone, { type: 'unit' }]]);
  const f = cotFind([unit, [centre, [ring]], tak, gone], meta, new Set([centre, ring, unit, tak]));
  assert.strictEqual(f('BDOC-aaaa-1'), centre, 'group member');
  assert.strictEqual(f('BDOC-aaaa-2'), ring, 'nested group member');
  assert.strictEqual(f('BDOC-bbbb-1'), unit);
  assert.strictEqual(f('ANDROID-123'), tak, 'TAK uid');
  assert.strictEqual(f('BDOC-cccc-1'), null, 'an entity that has a TAK uid is not matched by its own id');
  assert.strictEqual(f('BDOC-dddd-1'), null, 'removed from the map');
  assert.strictEqual(f(''), null);
});

test('the TAK export writes each uid once', () => {
  assert.match(PLAN, /const t = tNow\(\), events = \[\], seenUid = new Set\(\); let n = 0;/);
  assert.match(PLAN, /if \(s\.kind === 'point' && s\.labelOnly && group\) continue;[^\n]*\n\s*\/\/ an entity can sit both on its own and inside a drawing group: one event per uid\n\s*if \(seenUid\.has\(uid\)\) continue;\n\s*seenUid\.add\(uid\);/);
});
