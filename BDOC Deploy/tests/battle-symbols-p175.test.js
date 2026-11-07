// p175 — Travon picked "Military symbols first" for the Battle Tracker. Units are now real
// MIL-STD-2525C / APP-6 symbols: a 15-character SIDC (side, status, size, HQ / task force / dummy)
// drawn by milsymbol, stored flat in the unit's meta, exported to TAK as its exact CoT type, and
// editable afterwards. Without the library the hand-drawn icons stay as the offline fallback.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const HTML = read('index.html'), SW = read('service-worker.js'), PLAN = read('js/bdoc-plan.js');
const SYM_SRC = read('js/modules/battle-symbols.js'), LOADER_SRC = read('js/modules/milsymbol-loader.js');

function loadSym(extra) {
  const ctx = vm.createContext(Object.assign({ console, setTimeout, clearTimeout, btoa: s => Buffer.from(s, 'binary').toString('base64') }, extra || {}));
  vm.runInContext(SYM_SRC, ctx);
  return { ctx, S: ctx.BDOCSym };
}
const { S } = loadSym();
const tick = () => new Promise(r => setImmediate(r));

// ── SIDC building ────────────────────────────────────────────────────────────────────────
test('library units build the standard SIDC', () => {
  assert.equal(S.buildSIDC({ key: 'infantry', aff: 'friendly' }), 'SFGPUCI--------');
  assert.equal(S.buildSIDC({ key: 'armor', aff: 'hostile', ech: 'company' }), 'SHGPUCA----E---');
  assert.equal(S.buildSIDC({ key: 'fighter', aff: 'hostile' }), 'SHAPMFF--------');
  assert.equal(S.buildSIDC({ key: 'submarine', aff: 'neutral' }), 'SNUPS----------');
  assert.equal(S.buildSIDC({ key: 'sof', aff: 'friendly', ech: 'team' }), 'SFFP-------A---');
  assert.equal(S.buildSIDC({ key: 'mechanized', aff: 'suspect', cond: 'planned', ech: 'battalion' }), 'SSGAUCIZ---F---');
  // unknown key and no base → a plain unknown ground unit, never a throw
  assert.equal(S.buildSIDC({ key: 'nope' }), 'SUGPU----------');
  assert.equal(S.buildSIDC(), 'SUGPU----------');
});

test('every side, status and size lands in the right position', () => {
  const affCodes = { friendly: 'F', hostile: 'H', neutral: 'N', unknown: 'U', afriend: 'A', suspect: 'S', pending: 'P' };
  assert.deepEqual(Object.fromEntries(S.AFFILIATIONS.map(a => [a.v, a.code])), affCodes);
  for (const [v, c] of Object.entries(affCodes)) assert.equal(S.buildSIDC({ key: 'infantry', aff: v })[1], c, v);
  const condCodes = { present: 'P', planned: 'A', capable: 'C', damaged: 'D', destroyed: 'X', full: 'F' };
  assert.deepEqual(Object.fromEntries(S.CONDITIONS.map(c => [c.v, c.code])), condCodes);
  for (const [v, c] of Object.entries(condCodes)) assert.equal(S.buildSIDC({ key: 'infantry', cond: v })[3], c, v);
  const echCodes = { none: '-', team: 'A', squad: 'B', section: 'C', platoon: 'D', company: 'E', battalion: 'F', regiment: 'G', brigade: 'H', division: 'I', corps: 'J', army: 'K', armygroup: 'L' };
  assert.deepEqual(Object.fromEntries(S.ECHELONS.map(e => [e.v, e.code])), echCodes);
  for (const [v, c] of Object.entries(echCodes)) assert.equal(S.buildSIDC({ key: 'infantry', ech: v })[11], c, v);
});

test('HQ / task force / dummy use the 2525C position-11 codes', () => {
  const table = [
    [false, false, false, '-'], [false, false, true, 'F'], [false, true, false, 'E'], [false, true, true, 'G'],
    [true, false, false, 'A'], [true, false, true, 'C'], [true, true, false, 'B'], [true, true, true, 'D'],
  ];
  for (const [hq, tf, feint, code] of table) {
    assert.equal(S.modIndicator(hq, tf, feint), code, `hq=${hq} tf=${tf} feint=${feint}`);
    const sidc = S.buildSIDC({ key: 'infantry', aff: 'friendly', ech: 'brigade', hq, tf, feint });
    assert.equal(sidc[10], code);
    const p = S.parseSIDC(sidc);
    assert.deepEqual([p.hq, p.tf, p.feint, p.ech], [hq, tf, feint, 'brigade'], sidc);
  }
  // the Headquarters type always carries its staff unless told otherwise
  assert.equal(S.buildSIDC({ key: 'hq' })[10], 'A');
  assert.equal(S.buildSIDC({ key: 'hq', tf: true })[10], 'B');
  assert.equal(S.buildSIDC({ key: 'hq', hq: false })[10], '-');
});

test('aircraft, ships and equipment take no echelon or HQ marks', () => {
  for (const key of ['fighter', 'carrier', 'submarine', 'uav', 'radar']) {
    const s = S.buildSIDC({ key, aff: 'friendly', ech: 'division', hq: true, tf: true, feint: true });
    assert.equal(s.slice(10, 12), '--', key + ' ' + s);
  }
  assert.equal(S.buildSIDC({ key: 'radar', aff: 'hostile' }), 'SHGPESR--------');
});

test('a pasted SIDC keeps its function and country code; the controls set side, status and size', () => {
  assert.equal(S.buildSIDC({ base: 'SFGPUCFHE---USX', aff: 'hostile', ech: 'battalion' }), 'SHGPUCFHE--FUSX');
  assert.equal(S.buildSIDC({ base: 'SFAPMFF--------', aff: 'neutral', ech: 'company', hq: true }), 'SNAPMFF--------');
  // an installation keeps its H marker
  assert.equal(S.buildSIDC({ base: 'SFGPIB----H----', aff: 'friendly' })[10], 'H');
  // garbage is not a base
  assert.equal(S.buildSIDC({ base: '<svg onload=x>', aff: 'friendly' }), 'SFGPU----------');
});

test('the catalogue covers the Battle Tracker library and every entry is a valid SIDC', () => {
  const keys = Object.keys(S.CATALOG);
  assert.ok(keys.length >= 59, `${keys.length} catalogued types`);
  const bi = HTML.slice(HTML.indexOf('const BATTLE_ICONS={'), HTML.indexOf('};', HTML.indexOf('const BATTLE_ICONS={')));
  for (const k of keys) {
    const c = S.CATALOG[k];
    assert.match(bi, new RegExp(`\\n  ${k}:\\{label:`), `${k} is in BATTLE_ICONS`);
    assert.match(c.fn, /^[A-Z0-9-]{6}$/, k);
    assert.ok('GFASU'.includes(c.dim), k);
    assert.ok(['ground', 'support', 'air', 'naval', 'cyber'].includes(c.cat), k);
    for (const aff of S.AFFILIATIONS.map(a => a.v)) assert.ok(S.isSIDC(S.buildSIDC({ key: k, aff, ech: 'company' })), `${k}/${aff}`);
  }
  // corrected echelon fact: a brigade is X, a division XX (the old picker was one step off)
  assert.equal(S.ECH_BY_V.brigade.mark, 'X');
  assert.equal(S.ECH_BY_V.division.mark, 'XX');
});

test('parseSIDC reads back what buildSIDC wrote, and rejects junk', () => {
  for (const aff of S.AFFILIATIONS) for (const cond of S.CONDITIONS) for (const ech of S.ECHELONS) {
    const s = S.buildSIDC({ key: 'infantry', aff: aff.v, cond: cond.v, ech: ech.v });
    const p = S.parseSIDC(s);
    assert.deepEqual([p.aff, p.cond, p.ech, p.fn, p.dim], [aff.v, cond.v, ech.v, 'UCI---', 'G'], s);
  }
  for (const bad of ['', 'SFGPUCI', 'SFGPUCI---------', 'sfgpuci--------', 'SFGPUCI<-------', null, 42, {}]) {
    assert.equal(S.isSIDC(bad), false, String(bad));
    assert.equal(S.parseSIDC(bad), null);
  }
});

// ── TAK ──────────────────────────────────────────────────────────────────────────────────
test('the CoT type is the one ATAK / WinTAK / iTAK draw the same 2525 symbol from', () => {
  assert.equal(S.cotType('SFGPUCI--------'), 'a-f-G-U-C-I');
  assert.equal(S.cotType('SHAPMFF--------'), 'a-h-A-M-F-F');
  assert.equal(S.cotType('SHGPUCA----E---'), 'a-h-G-U-C-A');
  assert.equal(S.cotType('SFGPU------A---'), 'a-f-G-U');
  assert.equal(S.cotType('SFFP-----------'), 'a-f-F');
  assert.equal(S.cotType('SNUPS----------'), 'a-n-U-S');
  assert.equal(S.cotType('SSGAUCIZ---F---'), 'a-s-G-U-C-I-Z');
  assert.equal(S.cotType('IFGPSRAI-------'), null, 'SIGINT scheme has no a- type');
  assert.equal(S.cotType('garbage'), null);
  // and back again, for CoT that comes in from TAK
  assert.equal(S.sidcFromCot('a-f-G-U-C-I'), 'SFGPUCI--------');
  assert.equal(S.sidcFromCot('a-h-A-M-F-F'), 'SHAPMFF--------');
  for (const bad of ['b-m-p-s-p-loc', 'a-x-G', 'a-f-Q-U', 'a-f-G-<-x', 'a-f-G-UC', '', null]) assert.equal(S.sidcFromCot(bad), null, String(bad));
  for (const k of Object.keys(S.CATALOG)) {
    const s = S.buildSIDC({ key: k, aff: 'friendly' });
    assert.equal(S.sidcFromCot(S.cotType(s)).slice(0, 10), s.slice(0, 10), k);
  }
});

test('Battle Tracker CoT export uses the SIDC first and keeps the label rules for everything else', () => {
  const start = HTML.indexOf('const pickCoT=(meta)=>{');
  const src = HTML.slice(start, HTML.indexOf('\n  };', start) + 5);
  // the offline SIDC → CoT rule pickCoT falls back to
  const hs = HTML.indexOf('const _BP_COT_AFF=');
  const helper = HTML.slice(hs, HTML.indexOf(".join('-')}\n", HTML.indexOf('function _bpSidcCoT(s){', hs)) + 12);
  for (const withSym of [true, false]) {
    const ctx = vm.createContext({ window: withSym ? { BDOCSym: S } : {}, BDOCSym: S });
    vm.runInContext(helper + src + ';this.pick=pickCoT;this.off=_bpSidcCoT;', ctx);
    const pick = ctx.pick;
    assert.equal(pick({ type: 'unit', sidc: 'SHAPMFF--------', label: 'FRIEND whatever' }), 'a-h-A-M-F-F', `sym=${withSym}`);
    assert.equal(pick({ type: 'unit', sidc: 'SFGPUCI--------' }), 'a-f-G-U-C-I');
    // a custom code placed while the symbol set was missing has only customSidc
    assert.equal(pick({ type: 'unit', customSidc: 'SHAPMFF--------' }), 'a-h-A-M-F-F');
    // the offline rule gives the same type as BDOCSym.cotType, unknown dimension and exercise sides included
    for (const s of ['SFZP-----------', 'SFXPUCI--------', 'SDGPUCI--------', 'SGAPMFF--------', 'SOGPU----------', 'IFGPSRAI-------', 'EFIPA----------'])
      assert.equal(pick({ type: 'unit', sidc: s }) === S.cotType(s) || S.cotType(s) === null, true, s);
    assert.equal(ctx.off('SFZP-----------'), 'a-f-X');
    for (const k of Object.keys(S.CATALOG)) { const s = S.buildSIDC({ key: k, aff: 'pending' }); assert.equal(ctx.off(s), S.cotType(s), s); }
    // an imported aff such as "constructor" is not a key of the side table
    assert.equal(typeof pick({ type: 'unit', aff: 'constructor', label: 'x' }), 'string');
    assert.doesNotMatch(pick({ type: 'unit', aff: 'constructor', label: 'x' }), /function/);
    // fallback-icon units keep their side in meta.aff (a designation says nothing about side)
    assert.equal(pick({ type: 'unit', aff: 'suspect', label: 'A/2-7 CAV' }), 'hostile_ground');
    assert.equal(pick({ type: 'unit', aff: 'pending', label: 'X' }), 'unknown_ground');
    // 'attack' only means hostile for a tactical marker, not a friendly Attack Helicopter
    assert.equal(pick({ type: 'unit', label: 'FRIENDLY Attack Helicopter' }), 'friendly_ground');
    assert.equal(pick({ type: 'tactical', label: 'ATTACK' }), 'hostile_ground');
    assert.equal(pick({ type: 'tactical', label: 'Enemy contact' }), 'hostile_ground');
    assert.equal(pick({ type: 'casevac', label: 'x' }), 'casevac');
  }
});

test('plan export: SIDC units go out as their CoT type, with the SIDC in remarks and a stable uid', () => {
  // bdoc-plan.js keeps its own copy of the SIDC check and the CoT mapping (no module needed);
  // both must agree with battle-symbols.js
  const RE = String(/^(?:[SI][PUAFNSHGWMDLJKO][PAGSUFXZ]|O[PUAFNSHGWMDLJKO][VLOIPGR]|E[PUAFNSHGWMDLJKO][INOF])[APCDXF][A-Z0-9-]{6}[A-Z0-9*-]{2}[A-Z0-9*-]{2}[A-Z0-9*-]$/);
  assert.ok(PLAN.includes(RE), 'plan SIDC_RE');
  assert.ok(SYM_SRC.includes(RE), 'module SIDC_RE');
  const fn = PLAN.slice(PLAN.indexOf('  const SIDC_RE'), PLAN.indexOf('\n  }\n', PLAN.indexOf('function sidcCoT')) + 4);
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(fn + ';this.f=sidcCoT;this.re=SIDC_RE;', ctx);
  for (const k of Object.keys(S.CATALOG)) for (const aff of ['friendly', 'hostile', 'neutral', 'unknown', 'afriend', 'suspect', 'pending']) {
    const s = S.buildSIDC({ key: k, aff, ech: 'company', hq: true });
    assert.equal(ctx.f(s), S.cotType(s), s);
  }
  // pasted codes too: unknown battle dimension, exercise / joker / faker sides, other schemes
  for (const s of ['SFZP-----------', 'SFXPUCI--------', 'SDGPUCI--------', 'SJAPMFF--------', 'SKGPUCA--------', 'SOGPU----------', 'IFGPSRAI-------', 'OHVPA----------', 'EFIPA----------'])
    assert.equal(ctx.f(s), S.cotType(s), s);
  for (const s of ['OHVPA----------', 'EFIPA----------', 'EHNPA----------', 'SFGPUCI--------', 'garbage', 'EHGPA----------', 'OHAPA----------'])
    assert.equal(ctx.re.test(s), S.isSIDC(s), s);
  assert.equal(ctx.f('junk'), null);
  assert.match(PLAN, /const sd = m\.sidc \|\| m\.customSidc;   \/\/ a custom code/);
  assert.match(PLAN, /const unitType = sd \? sidcCoT\(sd\) : null;/);
  // p177: a marker imported from TAK keeps its CoT type, and anything imported keeps its TAK uid
  // (tests/cot-import-p177.test.js runs the export for real)
  assert.match(PLAN, /const cotType = unitType \|\| takType \|\| \(typeof pickCoT === 'function' \? pickCoT\(m\) : 'a-u-G'\);/);
  assert.match(PLAN, /'SIDC ' \+ sd/);
  assert.match(PLAN, /staleMs: \(unitType \|\| takType\) \? 86400000 : 3600000/);
  assert.match(PLAN, /const uid = takUidOk\(m\.cotUid\) \? m\.cotUid : ent\.id \? 'BDOC-' \+ String\(ent\.id\)\.slice\(0, 60\) : 'BDOC-BP-'/);
  // GeoJSON keeps the symbology for QGIS / other C2 tools
  for (const p of ['props.sidc = sd', 'props.cot_type = ct', "['higher', 'higher_formation']", "['feint', 'feint_dummy']"]) assert.ok(PLAN.includes(p), p);
});

test('OPEN FILE keeps a real SIDC, drops a fake one, and cleans unit text', () => {
  const re = PLAN.slice(PLAN.indexOf('  const SIDC_RE'), PLAN.indexOf('\n', PLAN.indexOf('  const SIDC_RE')));
  const fnStart = PLAN.indexOf('  function sanitizeSpec(s) {');
  const fn = PLAN.slice(fnStart, PLAN.indexOf('\n  }\n', fnStart) + 4);
  const ctx = vm.createContext({});
  vm.runInContext(re + '\n' + fn + ';this.f=sanitizeSpec;', ctx);
  const out = ctx.f({ meta: { type: 'unit', sidc: 'SHGPUCA----E---', customSidc: '<img src=x onerror=alert(1)>', designation: '<b>a/2-7 cav</b>', higher: 'x'.repeat(40), nested: { a: 1 } } });
  assert.equal(out.meta.sidc, 'SHGPUCA----E---');
  assert.equal('customSidc' in out.meta, false);
  assert.equal(out.meta.designation, 'BA/2-7 CAV/B');
  assert.equal(out.meta.higher.length, 21);
  assert.equal('nested' in out.meta, false);
  assert.equal('sidc' in ctx.f({ meta: { sidc: 12345 } }).meta, false);
  // importDoc tells index.html which entities arrived, so their symbols are redrawn from the SIDC
  assert.match(PLAN, /window\.dispatchEvent\(new CustomEvent\('bdoc:plan-imported', \{ detail: \{ entities: added \} \}\)\)/);
  assert.match(HTML, /window\.addEventListener\('bdoc:plan-imported',/);
  assert.match(HTML, /if\(!ok\|\|!S\|\|!S\.hasMs\(\)\)return;   \/\/ offline: keep the file's own picture/);
});

// ── text + rendering ─────────────────────────────────────────────────────────────────────
test('unit text is cleaned before it reaches the SVG', () => {
  assert.equal(S.cleanText('  a/2-7   cav '), 'A/2-7 CAV');
  assert.equal(S.cleanText('<img onerror=x>'), 'IMG ONERRORX');
  assert.equal(S.cleanText('"\'&<>`'), '');
  assert.equal(S.cleanText('x'.repeat(50), 21).length, 21);
  assert.equal(S.cleanText(null), '');
});

test('render pads the SVG so the anchor is the centre, cleans text and caches', () => {
  assert.equal(S.render('SFGPUCI--------'), null, 'no milsymbol → null (caller falls back)');
  let seen = null;
  function Sym(sidc, o) { seen = { sidc, o }; }
  Sym.prototype.asSVG = () => '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"></svg>';
  Sym.prototype.getAnchor = () => ({ x: 10, y: 20 });
  Sym.prototype.getSize = () => ({ width: 40, height: 30 });
  Sym.prototype.isValid = () => true;
  const { S: S2 } = loadSym({ ms: { Symbol: Sym } });
  const r = S2.render('SFGPUCI--------', { size: 999, uniqueDesignation: '<b>x</b>', reinforcedReduced: '+', color: 'red;}' });
  assert.equal(r.width, 60); assert.equal(r.height, 40);
  assert.equal(r.below, 10, 'drawing reaches 10px under the anchor (label goes there, not under the padding)');
  assert.match(HTML, /function _bpLabelOffset\(vis\)\{return new Cesium\.Cartesian2\(0,\(vis\.below!=null\?vis\.below:Math\.round\(vis\.h\/2\)\)\+4\)\}/);
  const svg = Buffer.from(r.uri.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="60" height="40" viewBox="0 0 60 40"><svg x="20" y="0"/);
  assert.equal(seen.o.size, 120, 'size clamped');
  assert.equal(seen.o.uniqueDesignation, 'BX/B');
  assert.equal(seen.o.reinforcedReduced, '(+)', 'field F is written the 2525C way');
  assert.equal(seen.o.colorMode, undefined, 'bad colour ignored');
  assert.equal(r.valid, true);
  assert.strictEqual(S2.render('SFGPUCI--------', { size: 999, uniqueDesignation: '<b>x</b>', reinforcedReduced: '+' }), r, 'cached');
  assert.equal(S2.render('not a sidc'), null);
  S2.render('SFGPUCI--------', { reinforcedReduced: '±' }); assert.equal(seen.o.reinforcedReduced, '(±)');
  S2.render('SFGPUCI--------', { reinforcedReduced: '-' }); assert.equal(seen.o.reinforcedReduced, '(-)');
  S2.render('SFGPUCI--------', { reinforcedReduced: 'x' }); assert.equal(seen.o.reinforcedReduced, undefined);
  // strength is a unit amplifier: never on an aircraft, ship or vehicle
  for (const s of ['SHAPMFF--------', 'SNUPS----------', 'SFGPEVAT-------', 'SFGPIB----H----']) {
    S2.render(s, { reinforcedReduced: '+' }); assert.equal(seen.o.reinforcedReduced, undefined, s);
  }
  assert.match(HTML, /unit:S\.sidcKind\(sidc\)==='unit'/);
  assert.match(HTML, /if\(vis\.std&&vis\.unit===false\)st=Object\.assign\(\{\},st,\{strength:''\}\);/);
});

test('ensure() waits for the library itself and can try again after a failure', async () => {
  let calls = 0, fail = true;
  const env = { BDOC: { LazyLoader: { load: () => Promise.resolve(true) } } };
  const { ctx, S: S3 } = loadSym(env);
  env.BDOC = ctx.BDOC;   // same object inside the context
  ctx.BDOC.loadMilsymbol = () => { calls++; if (fail) return Promise.reject(new Error('offline')); ctx.ms = { Symbol: function () {} }; return Promise.resolve(ctx.ms); };
  assert.equal(await S3.ensure(200), false);
  fail = false;
  assert.equal(await S3.ensure(200), true);
  assert.equal(calls, 2);
  assert.equal(await S3.ensure(200), true, 'already loaded');
  assert.equal(calls, 2);
});

// ── milsymbol-loader.js ──────────────────────────────────────────────────────────────────
test('milsymbol-loader: a failed CDN load is handled, cleaned up and retried', async () => {
  const scripts = [], removed = [];
  const head = { appendChild(s) { s.parentNode = head; scripts.push(s); }, removeChild(s) { s.parentNode = null; removed.push(s); } };
  const ctx = vm.createContext({ console: { warn() {}, log() {} }, setTimeout, clearTimeout, document: { head, createElement: () => ({}) } });
  ctx.window = ctx;
  vm.runInContext(LOADER_SRC, ctx);
  assert.equal(scripts.length, 1, 'starts loading right away');
  assert.equal(scripts[0].src, 'https://cdn.jsdelivr.net/npm/milsymbol@2.2.0/dist/milsymbol.min.js');
  assert.equal(scripts[0].crossOrigin, 'anonymous');
  assert.strictEqual(ctx.BDOC.loadMilsymbol(), ctx._milsymbolLoading, 'second call shares the fetch');
  scripts[0].onerror();
  await tick();
  assert.equal(removed[0], scripts[0], 'failed script tag removed');
  assert.equal(ctx._milsymbolLoading, undefined, 'slot cleared so a later call retries');
  const p = ctx.BDOC.loadMilsymbol();
  assert.equal(scripts.length, 2, 'retry adds a new script');
  ctx.ms = { Symbol: function () {} };
  scripts[1].onload();
  assert.strictEqual(await p, ctx.ms);
  assert.strictEqual(await ctx.BDOC.loadMilsymbol(), ctx.ms, 'loaded: no third fetch');
  assert.equal(scripts.length, 2);
  // the start-up call handles its own failure (no unhandled rejection toast)
  assert.match(LOADER_SRC, /loadMilsymbol\(\)\.catch\(function\(\) \{\}\);/);
});

// ── the Battle Tracker panel and dialog ─────────────────────────────────────────────────
const optionValues = id => {
  const m = HTML.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  assert.ok(m, id);
  return [...m[1].matchAll(/<option value="([^"]*)"/g)].map(x => x[1]);
};
test('panel pickers offer exactly the values the symbol module understands', () => {
  assert.deepEqual(optionValues('bp-affiliation'), S.AFFILIATIONS.map(a => a.v));
  assert.deepEqual(optionValues('bp-cond'), S.CONDITIONS.map(c => c.v));
  assert.deepEqual(optionValues('bp-echelon'), S.ECHELONS.map(e => e.v));
  assert.deepEqual(optionValues('bp-strength'), S.STRENGTH.map(s => s.v));
  for (const id of ['bp-desig', 'bp-higher']) assert.match(HTML, new RegExp(`<input id="${id}" maxlength="21"`));
  for (const id of ['bp-hq', 'bp-tf', 'bp-feint']) assert.match(HTML, new RegExp(`<input type="checkbox" id="${id}" onchange="bpSymChanged\\(\\)">`));
  assert.match(HTML, /<input id="bp-sidc-in" maxlength="15"[^>]*oninput="bpSidcInput\(this\)">/);
  // the hand-drawn fallback's size marks now match the standard (brigade X, division XX)
  const em = HTML.match(/const ECHELON_MARKS=(\{[^\n]*\});/)[1];
  const marks = vm.runInNewContext('(' + em + ')');
  for (const e of S.ECHELONS) assert.equal(marks[e.v], e.mark, e.v);
});

test('standard symbols always take the standard side colours; the swatch is for shapes', () => {
  const vis = HTML.slice(HTML.indexOf('function _bpUnitVisual(st){'), HTML.indexOf('function _bpAffName('));
  const stdBranch = vis.slice(vis.indexOf('if(S&&S.hasMs()&&(c||st.custom)){'), vis.indexOf('// fallback icon'));
  assert.ok(stdBranch.length > 50);
  assert.doesNotMatch(stdBranch, /battleColor/);
  assert.match(stdBranch, /col:affCol/);
  assert.match(HTML, /id="bp-color-note">for shapes, lines &amp; notes\. Units always use their standard side colour\./);
});

test('placing a unit stays synchronous, refuses a bad custom SIDC, and stores flat meta', () => {
  const place = HTML.slice(HTML.indexOf('function placeBattleUnit(lat,lon){'), HTML.indexOf('// ═══ DRAW POLYGON ═══'));
  assert.doesNotMatch(HTML, /async function placeBattleUnit/);
  // a pasted code is refused when it is bad, and also offline (it would come out as the library
  // icon with the wrong TAK type); a failed symbol load is retried at most every 30 s
  assert.match(place, /const st=bpSymState\(\),S=_bpSym\(\);\n  if\(st\.customRaw\)\{/);
  assert.match(place, /if\(!S\|\|!S\.hasMs\(\)\)\{af\('var\(--yl\)','A CUSTOM SIDC needs the standard symbol set/);
  assert.match(place, /if\(!st\.custom\)\{af\('var\(--rd\)','CUSTOM SIDC '\+esc\(S\.sidcProblem\(st\.customRaw\)/);
  assert.match(place, /if\(window\._bpSymFailed&&!_bpSymLoading&&Date\.now\(\)-_bpSymLastTry>30000\)/);
  assert.match(place, /verticalOrigin:Cesium\.VerticalOrigin\.CENTER,heightReference:Cesium\.HeightReference\.CLAMP_TO_GROUND/);
  assert.match(place, /attachMeta\(ent,meta\);/);
  const meta = HTML.slice(HTML.indexOf('function _bpUnitMeta(st,vis,comment){'), HTML.indexOf('// live preview + SIDC readout'));
  for (const k of ['iconKey:st.key', "sidc:vis.sidc||''", "customSidc:st.custom||''", 'aff:st.aff', 'cond:st.cond', "ech:st.ech||'none'", 'hq:!!st.hq', 'tf:!!st.tf', 'feint:!!st.feint', "designation:st.designation||''", "higher:st.higher||''"])
    assert.ok(meta.includes(k), k);
  // popup rows are escaped
  assert.match(meta, /const R=\(k,v\)=>v\?`<b style="color:#4a5068">\$\{k\}:<\/b> \$\{esc\(v\)\}<br>`:'';/);
});

test('right-click → Edit Unit Symbol opens the editor, with undo', () => {
  assert.match(HTML, /<div class="ctx-item" onclick="ctxAction\('editunit'\)" id="ctx-editunit-item" style="display:none;color:#9CC4FF">/);
  assert.match(HTML, /case 'editunit':/);
  assert.match(HTML, /editUnitItem\.style\.display=_isUnit\?'flex':'none';/);
  const ed = HTML.slice(HTML.indexOf('function openUnitEditor(ent){'), HTML.indexOf('function closeUnitEditor(){'));
  // the record names the unit, so CLEAR / delete retires it (custom records die with their entity)
  assert.match(ed, /BDOCUndo\.record\(ent,'Unit edit',\{undo:\(\)=>_bpRestoreUnit\(ent,snap\)\}\)/);
  assert.match(HTML, /const _alive=r=>\{if\(r\.custom\)return !r\.dead&&\(!r\.ref\|\|_live\(r\.ref\)\);return _live\(r\.ref\)\};/);
  assert.match(ed, /if\(!V\.entities\.contains\(ent\)\)\{closeUnitEditor\(\);af\('var\(--t3\)','That unit is no longer on the map'\);return\}/);
  // map markers (bridge, objective, LZ …) keep their own type instead of turning into Infantry
  assert.match(ed, /<optgroup label="MAP MARKERS \(no standard symbol\)">'\+Object\.entries\(BATTLE_ICONS\)\.filter\(\(\[k\]\)=>!_bpOwn\(S\.CATALOG,k\)\)/);
  // a code the controls cannot hold opens as typed, with the reason
  assert.match(ed, /value="\$\{esc\(st\.customRaw\|\|st\.custom\)\}"/);
  assert.match(ed, /esc\(S\.sidcProblem\(s\.customRaw\)\|\|''\)/);
  // undoing the edit keeps a note written after it, and the PLACED time
  const rs = HTML.slice(HTML.indexOf('function _bpRestoreUnit(ent,s){'), HTML.indexOf('\n}\n', HTML.indexOf('function _bpRestoreUnit(ent,s){')));
  assert.match(rs, /const live=battleMeta\.get\(ent\),note=live\?live\.comment:undefined,placed=_bpPlacedOf\(ent\);/);
  assert.match(rs, /if\(rm&&note!==undefined\)rm\.comment=note;/);
  assert.match(rs, /ent\.description=buildEntityPopup\(\{title:rm\.popupTitle\|\|rm\.label,[^\n]*placed\}\);/);
  // EDIT NOTE is not a new placement
  assert.match(HTML, /placed:_bpPlacedOf\(V\.selectedEntity\)   \/\/ p175: a note is not a new placement/);
  assert.match(ed, /const snap=_bpSnapUnit\(ent\);const v=_bpApplyUnit\(ent,s\);/);
  assert.match(ed, /d\._esc=e=>\{if\(e\.key==='Escape'\)closeUnitEditor\(\)\}/);
  assert.match(ed, /value="\$\{esc\(st\.designation\)\}"/);
  // a pasted code sets the dialog's controls too
  assert.match(ed, /_bpSyncFromSidc\(S\.parseSIDC\(raw\),k=>g\('ue-'\+k\)\)/);
});

test('battle mode starts loading the symbol set; the module is lazy-loaded and precached', () => {
  assert.match(HTML, /_bpSymLoading=BDOC\.LazyLoader\.load\('battle-symbols'\)/);
  const enter = HTML.slice(HTML.indexOf('function enterBattleMode('), HTML.indexOf('function enterBattleMode(') + 4000);
  assert.match(enter, /_bpSymLoad\(\)/);
  const ver = /_version:\s*'([^']+)'/.exec(HTML)[1];
  // p175 or later: a later build bumps the module version for every module together
  assert.ok(Number(ver.replace(/^p/, '').replace(/\D.*$/, '')) >= 175, `LazyLoader ${ver}`);
  for (const m of ['battle-symbols', 'milsymbol-loader', 'layers-military']) assert.ok(SW.includes(`'/js/modules/${m}.js?v=${ver}',`), m);
});

test('service worker: v177 for p175, and the pinned milsymbol file survives a deploy', () => {
  assert.match(SW, /const SW_VERSION = 'bdoc-v177';  \/\/ p175:/);
  assert.match(SW, /^\/\/ \(prev\) const SW_VERSION = 'bdoc-v176';  \/\/ p174:/m);
  assert.ok(SW.includes("'/css/bdoc-p154.css?v=p175',"));
  // p177 changed bdoc-plan.js again (CoT import); any later build is fine here
  assert.match(SW, /'\/js\/bdoc-plan\.js\?v=p1(7[5-9]|[89]\d)\w*',/);
  assert.match(HTML, /href="css\/bdoc-p154\.css\?v=p175"/);
  assert.match(HTML, /src="js\/bdoc-plan\.js\?v=p1(7[5-9]|[89]\d)\w*"/);
  assert.match(SW, /await carryPinnedCdn\(old\.filter\(k => k\.endsWith\('-cdn'\)\)\);\n\s*return Promise\.all\(old\.map\(k => caches\.delete\(k\)\)\);/);
  assert.ok(SW.includes("'https://cdn.jsdelivr.net/npm/milsymbol@2.2.0/',"));
  // the loader URL must match the carried prefix (and the desktop build's vendored basename)
  assert.ok(LOADER_SRC.includes("'https://cdn.jsdelivr.net/npm/milsymbol@2.2.0/dist/milsymbol.min.js'"));
});

test('service worker carry-over copies only pinned milsymbol responses into the new CDN cache', async () => {
  const start = SW.indexOf('const CARRY_CDN_PREFIXES');
  const src = SW.slice(start, SW.indexOf('\n}\n', SW.indexOf('async function carryPinnedCdn')) + 3);
  const store = new Map();
  const mk = name => { if (!store.has(name)) store.set(name, new Map()); const m = store.get(name);
    return { keys: async () => [...m.keys()].map(url => ({ url })), match: async r => m.get(r.url), put: async (r, res) => { m.set(r.url, res); } }; };
  const MS = 'https://cdn.jsdelivr.net/npm/milsymbol@2.2.0/dist/milsymbol.min.js';
  const old = mk('bdoc-v176-cdn');
  await old.put({ url: MS }, { ok: true, body: 'ms' });
  await old.put({ url: 'https://cdn.jsdelivr.net/npm/other@1/x.js' }, { ok: true, body: 'other' });
  const ctx = vm.createContext({ caches: { open: async n => mk(n) }, CDN_CACHE: 'bdoc-v177-cdn', console });
  vm.runInContext(src + ';this.carry=carryPinnedCdn;', ctx);
  await ctx.carry(['bdoc-v176-cdn']);
  const dest = store.get('bdoc-v177-cdn');
  assert.deepEqual([...dest.keys()], [MS]);
  await ctx.carry([]);   // nothing to do is fine
});
