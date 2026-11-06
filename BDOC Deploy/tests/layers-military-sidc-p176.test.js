// p176 — the military map layers (bases, airfields) draw their symbols from getSIDC() in
// js/modules/layers-military.js. Two of its codes were wrong: PLA Rocket Force bases got UWS---,
// which is not a 2525C function ID (milsymbol 2.2.0 marked it invalid and drew a question mark),
// and Space Force bases got status T, which 2525C does not have (BDOCSym.isSIDC refused it).
// This test runs getSIDC over every base and airfield in the layer data and over every branch it
// knows, and checks each code is a 15-character 2525C SIDC of the shape BDOCSym.isSIDC accepts.
//
// To also check every code with the real library: MILSYMBOL_JS=path/to/milsymbol.js (2.2.0).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const MIL = read('js/modules/layers-military.js'), AIRF = read('js/modules/layers-airfields.js');
const HTML = read('index.html'), SW = read('service-worker.js');

function slice(src, start, end) {
  const i = src.indexOf(start);
  assert.ok(i >= 0, 'found ' + start);
  const j = src.indexOf(end, i);
  assert.ok(j > i, 'found the end of ' + start);
  return src.slice(i, j + end.length);
}
const FN_SRC = slice(MIL, 'function getSIDC(', '\n}\n');
const ctx = vm.createContext({});
vm.runInContext([
  FN_SRC, slice(MIL, 'var MILBASES = [', '\n];'), slice(AIRF, 'var MILAIRFIELDS = [', '\n];'),
  'this.getSIDC = getSIDC; this.BASES = MILBASES.filter(Boolean); this.AIRFIELDS = MILAIRFIELDS.filter(Boolean);',
].join('\n'), ctx);
const { getSIDC, BASES, AIRFIELDS } = ctx;

const symCtx = vm.createContext({ console });
vm.runInContext(read('js/modules/battle-symbols.js'), symCtx);
const S = symCtx.BDOCSym;

// every code getSIDC can return → where it came from
function allCodes() {
  const out = new Map();
  const add = (code, why) => { if (!out.has(code)) out.set(code, []); out.get(code).push(why); };
  // what the layers really draw: loadMilBases passes 'base', loadMilAirfields 'airfield' (country
  // defaults to US there)
  for (const b of BASES) add(getSIDC(b.t, b.c, 'base'), `base ${b.n} (${b.t}/${b.c})`);
  for (const a of AIRFIELDS) add(getSIDC(a.t, a.c || 'US', 'airfield'), `airfield ${a.n} (${a.t}/${a.c || 'US'})`);
  // every branch name the function tests for, plus one it does not, on each side and icon kind
  const names = [...new Set([...FN_SRC.matchAll(/'([^']+)'/g)].map(m => m[1]))].concat(['Coast Guard', '']);
  for (const t of names) for (const c of ['US', 'RU', 'CH', undefined]) for (const k of ['base', 'airfield', 'naval', undefined])
    add(getSIDC(t, c, k), `sweep ${t}/${c}/${k}`);
  return out;
}
const CODES = allCodes();

test('the layer data is all there', () => {
  assert.ok(BASES.length >= 260, `${BASES.length} bases`);
  assert.ok(AIRFIELDS.length >= 30, `${AIRFIELDS.length} airfields`);
  for (const r of BASES.concat(AIRFIELDS)) assert.equal(typeof r.t, 'string', r.n);
});

test('every code getSIDC returns is a 15-character MIL-STD-2525C SIDC', () => {
  assert.ok(CODES.size >= 15, `${CODES.size} distinct codes`);
  for (const [code, why] of CODES) {
    assert.equal(typeof code, 'string', why[0]);
    assert.equal(code.length, 15, `${code} (${why[0]})`);
    assert.ok(S.isSIDC(code), `BDOCSym.isSIDC refuses ${code} (${why[0]})`);
    assert.ok(S.isUsableSIDC(code), `${code} side ${code[1]}`);
    assert.ok('FHN'.includes(code[1]), `${code} side`);
    assert.equal(code[3], 'P', `${code} status is PRESENT`);
  }
});

// each [battle dimension, function ID] that getSIDC uses, checked with milsymbol 2.2.0 isValid()
// on 2026-11-06 for F, H and N. A new one must be checked the same way before it goes here.
const MILSYMBOL_OK = new Set([
  'A ------', // air track (USAF / ANG / AFRC / foreign air forces)
  'A MFA---', // military fixed wing, attack (airfields layer)
  'G IBA---', // installation: airport / air base (Army, DOD, NATO, default)
  'G UCI---', // infantry (Marines); the same function ID as BDOCSym.CATALOG.infantry
  'G UCM---', // missile, surface to surface (PLA Rocket Force)
  'P ------', // space track (Space Force)
  'S ------', // sea surface track (Navy); the same as BDOCSym.CATALOG.naval
]);
test('only function IDs milsymbol 2.2.0 accepts', () => {
  for (const [code, why] of CODES) {
    const k = code[2] + ' ' + code.slice(4, 10);
    assert.ok(MILSYMBOL_OK.has(k), `${code} uses ${k}, not checked with milsymbol (${why[0]})`);
  }
});

test('PLA Rocket Force and Space Force get the corrected codes', () => {
  assert.equal(getSIDC('PLA Rocket Force', 'CN', 'base'), 'SHGPUCM---*****');
  assert.equal(getSIDC('missile', 'CN', 'base'), 'SHGPUCM---*****');
  assert.equal(getSIDC('USSF', 'US', 'base'), 'SFPP------*****');
  assert.equal(getSIDC('USSF', 'GL', 'base'), 'SNPP------*****');
  const rocket = BASES.filter(b => b.t === 'PLA Rocket Force'), space = BASES.filter(b => b.t === 'USSF');
  assert.ok(rocket.length >= 1 && space.length >= 1, 'the layer has both kinds of base');
  for (const [code] of CODES) {
    assert.ok(!code.includes('UWS'), code);
    assert.doesNotMatch(code, /^S.PT/, code);
  }
});

test('the other codes are unchanged', () => {
  assert.equal(getSIDC('USAF', 'US', 'base'), 'SFAP------*****');
  assert.equal(getSIDC('USAF', 'US', 'airfield'), 'SFAPMFA---*****');
  assert.equal(getSIDC('USN', 'US', 'base'), 'SFSP------*****');
  assert.equal(getSIDC('USN', 'US', 'naval'), 'SFSP------*****');
  assert.equal(getSIDC('USMC', 'JP', 'base'), 'SFGPUCI---*****');
  assert.equal(getSIDC('USA', 'DE', 'base'), 'SFGPIBA---*****');
  assert.equal(getSIDC('RU Navy', 'RU', 'base'), 'SHSP------*****');
  assert.equal(getSIDC('Indian AF', 'IN', 'base'), 'SFAP------*****');
  assert.equal(getSIDC('Coast Guard', 'CH', 'base'), 'SNGPIBA---*****');
});

const MS_PATH = process.env.MILSYMBOL_JS;
test('every code is valid in milsymbol itself', { skip: !MS_PATH && 'set MILSYMBOL_JS to milsymbol.js 2.2.0 to run' }, () => {
  // (ms.version is no help: the 2.2.0 build reports '2.0.0')
  const ms = require(path.resolve(MS_PATH));
  for (const [code, why] of CODES) {
    const sym = new ms.Symbol(code, { size: 40 });
    assert.ok(sym.isValid(), `milsymbol marks ${code} invalid (${why[0]})`);
  }
});

test('versions: module bumped with the service worker', () => {
  const ver = /_version:\s*'([^']+)'/.exec(HTML)[1];
  const num = v => Number(String(v).replace(/^p/, '').replace(/\D.*$/, ''));
  assert.ok(num(ver) >= 176, `LazyLoader ${ver}`);
  assert.ok(SW.includes(`'/js/modules/layers-military.js?v=${ver}',`), 'layers-military precached at the LazyLoader version');
  // p176 introduced bdoc-v178; later bumps keep it as a "(prev)" line, so match it unanchored
  assert.match(SW, /const SW_VERSION = 'bdoc-v178';  \/\/ p176:/);
  assert.match(SW, /^\/\/ \(prev\) const SW_VERSION = 'bdoc-v177';  \/\/ p175:/m);
});
