// p175 review fixes — an adversarial review of the military-symbols change confirmed 19 findings.
// These tests pin the fixes: codes the controls cannot hold are refused with a reason, pasted
// modifiers survive, stability-operations / emergency-management codes are accepted, strength is a
// unit amplifier written (+) / (-) / (±), imported files cannot reach prototype keys, a SIDC-only
// unit keeps its HQ / task force / dummy flags, and control characters never reach a .cot.xml.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const HTML = read('index.html'), PLAN = read('js/bdoc-plan.js'), ATAK = read('js/bdoc-atak.js');
const SYM_SRC = read('js/modules/battle-symbols.js');
const ctx0 = vm.createContext({ console, setTimeout, clearTimeout });
vm.runInContext(SYM_SRC, ctx0);
const S = ctx0.BDOCSym;

const line = start => { const i = HTML.indexOf(start); assert.ok(i >= 0, start); return HTML.slice(i, HTML.indexOf('\n', i) + 1); };
const fnSrc = start => { const i = HTML.indexOf(start); assert.ok(i >= 0, start); return HTML.slice(i, HTML.indexOf('\n}\n', i) + 3); };

test('a code whose side the SIDE picker cannot show is refused with the reason', () => {
  for (const s of ['SJGPUCI--------', 'SKGPUCI--------', 'SDGPUCI--------', 'SGGPUCI--------', 'SOGPUCI--------']) {
    assert.equal(S.isSIDC(s), true, s);
    assert.equal(S.isUsableSIDC(s), false, s);
    assert.match(S.sidcProblem(s), new RegExp('^side code ' + s[1] + ' \\(' + S.OTHER_AFF[s[1]] + '\\) is not supported here; use F, H, N, U, A, S or P$'));
  }
  assert.equal(S.OTHER_AFF.J, 'JOKER');
  for (const s of ['SFGPUCI--------', 'SPGPUCI--------', 'SAAPMFF--------']) { assert.equal(S.isUsableSIDC(s), true, s); assert.equal(S.sidcProblem(s), null, s); }
  assert.equal(S.sidcProblem('nope'), 'must be 15 characters of MIL-STD-2525C (e.g. SFGPUCI--------)');
  // every place a pasted or imported code is accepted uses the usable test
  assert.match(HTML, /custom:\(S&&S\.isUsableSIDC\(raw\)\)\?raw:'',customRaw:raw\};/);
  assert.match(HTML, /if\(S&&S\.isUsableSIDC\(raw\)&&raw!==el\._bpSynced\)\{/);
  assert.match(HTML, /if\(V\.entities\.contains\(x\)&&S\.isUsableSIDC\(battleMeta\.get\(x\)\.sidc\)\)\{/);
  assert.match(HTML, /custom:S\.isUsableSIDC\(raw\)\?raw:'',customRaw:raw\}\};/);
  assert.match(HTML, /CUSTOM SIDC '\+esc\(\(S&&S\.hasMs\(\)&&S\.sidcProblem\(st\.customRaw\)\)\|\|'needs the standard symbol set, which is not loaded \(offline\?\)'\)/);
});

test('stability operations and emergency management codes are accepted; their positions 11-12 are kept', () => {
  for (const s of ['OHVPA----------', 'OFLPA----------', 'OHRPA----------', 'EFIPA----------', 'EHNPA----------', 'ENOPA----------', 'EUFPA----------'])
    assert.equal(S.isSIDC(s), true, s);
  // position 3 is checked against the scheme's own list
  for (const s of ['EHGPA----------', 'EHAPA----------', 'OHAPA----------', 'OHGQA----------', 'SFVPUCI--------', 'IFIPSRAI-------'])
    assert.equal(S.isSIDC(s), false, s);
  assert.equal(S.sidcKind('OHVPA----------'), 'track');
  assert.equal(S.sidcKind('EFIPA----------'), 'track');
  assert.equal(S.buildSIDC({ base: 'OHVPA-----AB---', aff: 'hostile', ech: 'battalion', hq: false }), 'OHVPA-----AB---');
  assert.equal(S.buildSIDC({ base: 'EFIPA----------', aff: 'neutral', cond: 'planned', ech: 'division', hq: true }), 'ENIAA----------');
  const p = S.parseSIDC('OHVPA-----AB---');
  assert.deepEqual([p.hq, p.tf, p.feint, p.ech, p.installation], [false, false, false, 'none', false]);
  // TAK has no a- type for these; the export falls back to the side's generic point
  assert.equal(S.cotType('EFIPA----------'), null);
});

test('modifiers no control can show are kept from a pasted code', () => {
  const same = ['SFGPEVAT--MQ---', 'SFSPCLDD--NS---', 'SFGPIB----HB---', 'SFAPMFF---NS---'];
  for (const s of same) assert.equal(S.buildSIDC({ base: s, aff: 'friendly', ech: 'none' }), s, s);
  // region / command size: kept while SIZE is none, replaced when SIZE is set
  assert.equal(S.buildSIDC({ base: 'SFGPU------M---', aff: 'friendly', ech: 'none' }), 'SFGPU------M---');
  assert.equal(S.buildSIDC({ base: 'SFGPU------N---', aff: 'hostile', ech: 'none' }), 'SHGPU------N---');
  assert.equal(S.buildSIDC({ base: 'SFGPU------M---', aff: 'friendly', ech: 'battalion' }), 'SFGPU------F---');
  // the controls still set side, status, size and HQ / task force / dummy on an ordinary unit
  assert.equal(S.buildSIDC({ base: 'SFGPUCI---AF---', aff: 'hostile', ech: 'company', hq: false, tf: true }), 'SHGPUCI---EE---');
  // an HB installation is not read as a squad, and mobility is not a size
  assert.equal(S.parseSIDC('SFGPIB----HB---').ech, 'none');
  assert.equal(S.parseSIDC('SFGPEVAT--MQ---').ech, 'none');
  assert.equal(S.parseSIDC('SFGPUCI---AF---').ech, 'battalion');
  // library entries are unchanged
  assert.equal(S.buildSIDC({ key: 'infantry', aff: 'friendly' }), 'SFGPUCI--------');
  assert.equal(S.buildSIDC({ key: 'radar', aff: 'hostile', ech: 'battalion' }), 'SHGPESR--------');
});

test('sidcKind follows the 2525C unit / equipment / installation / track split', () => {
  assert.equal(S.sidcKind('SFGPUCI--------'), 'unit');
  assert.equal(S.sidcKind('SFFP-----------'), 'unit');
  assert.equal(S.sidcKind('SFGPEVAT-------'), 'equip');
  assert.equal(S.sidcKind('SFGPIB---------'), 'inst');
  assert.equal(S.sidcKind('SHAPMFF--------'), 'track');
  assert.equal(S.sidcKind('SNUPS----------'), 'track');
  assert.equal(S.sidcKind('IFGPSRAI-------'), 'track');
  assert.equal(S.sidcKind('junk'), null);
  for (const k of Object.keys(S.CATALOG)) {
    const c = S.CATALOG[k], s = S.buildSIDC({ key: k, aff: 'friendly' });
    if (c.kind !== 'track') assert.equal(S.sidcKind(s), c.kind, k);
  }
});

test('symbol tables have no prototype: "__proto__" or "constructor" from a file finds nothing', () => {
  for (const t of ['CATALOG', 'AFF_BY_V', 'AFF_BY_CODE', 'COND_BY_V', 'ECH_BY_V', 'ECH_BY_CODE', 'OTHER_AFF'])
    for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal(S[t][k], undefined, t + '.' + k);
  assert.equal(S.buildSIDC({ key: 'constructor', aff: '__proto__', cond: 'toString', ech: 'valueOf' }), 'SUGPU----------');
  assert.equal(S.describe('SFGPUCI--------', 'constructor').type, 'Custom symbol');
});

// _bpStateFromMeta runs on every imported unit and every edit dialog, so run the real code
function stateFromMeta() {
  const bi = HTML.indexOf('const BATTLE_ICONS={');
  const icons = HTML.slice(bi, HTML.indexOf('\n};', bi) + 3);
  const src = icons + '\n' + line('const ECHELON_MARKS=') + line('const _BP_AFF_COL=') + line('const _BP_MARKER_CATS=') +
    line('const _BP_LEGACY_LABELS=') + line('function _bpOwn(o,k)') + line('function _bpSym()') +
    fnSrc('function _bpLegacyUnitState(m){') + fnSrc('function _bpStateFromMeta(m){') + ';this.f=_bpStateFromMeta;';
  const c = vm.createContext({ window: { BDOCSym: S } });
  vm.runInContext(src, c);
  return c.f;
}

test('a unit that only carries a SIDC keeps its HQ / task force / dummy flags', () => {
  const f = stateFromMeta();
  const st = f({ type: 'unit', sidc: 'SFGPUCI---AF---' });
  assert.deepEqual([st.key, st.aff, st.ech, st.hq, st.tf, st.feint, st.custom], ['infantry', 'friendly', 'battalion', true, false, false, 'SFGPUCI---AF---']);
  // rebuilding from that state gives back the same code (the import redraw used to drop the HQ)
  assert.equal(S.buildSIDC({ key: null, base: st.custom, aff: st.aff, cond: st.cond, ech: st.ech, hq: st.hq || undefined, tf: st.tf, feint: st.feint }), 'SFGPUCI---AF---');
  for (const [code, hq, tf, feint] of [['B', true, true, false], ['E', false, true, false], ['F', false, false, true], ['D', true, true, true]]) {
    const s = f({ type: 'unit', sidc: 'SHGPUCI---' + code + 'F---' });
    assert.deepEqual([s.hq, s.tf, s.feint], [hq, tf, feint], code);
  }
  // a flag BDOC saved wins over the code
  assert.equal(f({ type: 'unit', iconKey: 'infantry', sidc: 'SFGPUCI---AF---', hq: false }).hq, false);
});

test('a crafted plan file cannot steer the state through prototype keys', () => {
  const f = stateFromMeta();
  const st = f({ type: 'unit', iconKey: '__proto__', aff: 'constructor', cond: 'toString', ech: 'valueOf', strength: ['+'], sidc: 'SFGPUCI--------' });
  assert.deepEqual([st.key, st.aff, st.cond, st.ech, st.strength], ['infantry', 'friendly', 'present', 'none', '']);
  // a joker code stays visible in the editor (customRaw) but is not used
  const j = f({ type: 'unit', sidc: 'SJGPUCI--------' });
  assert.deepEqual([j.custom, j.customRaw], ['', 'SJGPUCI--------']);
  // pre-p175 units: renamed label still found, own keys only
  assert.equal(f({ label: 'HOSTILE Destroyer / Frigate' }).key, 'destroyer');
  assert.equal(f({ label: 'HOSTILE Destroyer / Frigate' }).aff, 'hostile');
  assert.equal(f({ label: 'CONSTRUCTOR thing' }).aff, 'friendly');
  assert.equal(f({ label: 'FRIENDLY Infantry', popupExtras: '<b>ECHELON:</b> CONSTRUCTOR' }).ech, 'none');
  assert.equal(f({ label: 'FRIENDLY Infantry', popupExtras: '<b>ECHELON:</b> BRIGADE' }).ech, 'brigade');
});

test('OPEN FILE keeps only the symbol values the panel offers', () => {
  const re = PLAN.slice(PLAN.indexOf('  const SIDC_RE'), PLAN.indexOf('\n', PLAN.indexOf('  const SIDC_RE')));
  const fnStart = PLAN.indexOf('  function sanitizeSpec(s) {');
  const fn = PLAN.slice(fnStart, PLAN.indexOf('\n  }\n', fnStart) + 4);
  const c = vm.createContext({});
  vm.runInContext(re + '\n' + fn + ';this.f=sanitizeSpec;', c);
  const m = c.f({ meta: { type: 'unit', aff: '__proto__', cond: 'damaged', ech: 'constructor', strength: '±', hq: 'yes', tf: true, feint: 0, iconKey: '<img>' } }).meta;
  assert.equal('aff' in m, false);
  assert.equal(m.cond, 'damaged');
  assert.equal('ech' in m, false);
  assert.equal(m.strength, '±');
  assert.equal('hq' in m, false);
  assert.equal(m.tf, true);
  assert.equal('feint' in m, false);
  assert.equal('iconKey' in m, false);
  const ok = c.f({ meta: { type: 'unit', aff: 'suspect', ech: 'armygroup', strength: '', iconKey: 'attack_helo', sidc: 'EFIPA----------' } }).meta;
  assert.deepEqual([ok.aff, ok.ech, ok.strength, ok.iconKey, ok.sidc], ['suspect', 'armygroup', '', 'attack_helo', 'EFIPA----------']);
  // the allow-lists are the panel's own values
  const al = PLAN.match(/const ALLOW = (\{[\s\S]*?\});/)[1];
  const A = vm.runInNewContext('(' + al + ')');
  assert.deepEqual([...A.aff].sort(), S.AFFILIATIONS.map(a => a.v).sort());
  assert.deepEqual(A.cond, S.CONDITIONS.map(x => x.v));
  assert.deepEqual(A.ech, S.ECHELONS.map(x => x.v));
  assert.deepEqual(A.strength, S.STRENGTH.map(x => x.v));
});

test('control characters never reach a .cot.xml', () => {
  const i = ATAK.indexOf('function xmlEsc(s) {');
  const src = ATAK.slice(i, ATAK.indexOf('\n}\n', i) + 3);
  const c = vm.createContext({});
  vm.runInContext(src + ';this.x=xmlEsc;', c);
  assert.equal(c.x('a\u0001b\u000Bc\u001F<d>&\'"'), 'abc&lt;d&gt;&amp;&apos;&quot;');
  assert.equal(c.x('tab\there\nline\rcr'), 'tab\there\nline\rcr', 'tab, newline and CR are legal XML');
  assert.equal(c.x('￾￿ok'), 'ok');
  assert.equal(c.x(null), '');
  // changed file, so its cache key moved with it
  assert.match(HTML, /<script src="js\/bdoc-atak\.js\?v=p175"><\/script>/);
  assert.ok(read('service-worker.js').includes("'/js/bdoc-atak.js?v=p175',"));
});

test('map markers stay markers; the offline grid uses the right frame', () => {
  assert.match(HTML, /const _BP_MARKER_CATS=new Set\(\['infra','status'\]\);/);
  assert.match(HTML, /function _bpIsMarker\(st,vis\)\{return !vis\.std&&!st\.custom&&_bpOwn\(BATTLE_ICONS,st\.key\)&&_BP_MARKER_CATS\.has\(BATTLE_ICONS\[st\.key\]\.cat\)\}/);
  assert.match(HTML, /if\(marker\)st=Object\.assign\(\{\},st,\{ech:'none',hq:false,tf:false,feint:false,strength:''\}\);/);
  assert.match(HTML, /Map marker — not a standard unit symbol/);
  // every marker category really has no catalogue entry
  const f = stateFromMeta; void f;
  const bi = HTML.indexOf('const BATTLE_ICONS={');
  const icons = vm.runInNewContext('(' + HTML.slice(bi + 'const BATTLE_ICONS='.length, HTML.indexOf('\n};', bi) + 2) + ')');
  for (const [k, v] of Object.entries(icons)) if (v.cat === 'infra' || v.cat === 'status') assert.equal(S.CATALOG[k], undefined, k);
  // suspect / pending draw the hostile / unknown frame in the simple-icon grid, as on the map
  assert.match(HTML, /buildNatoSVG\(v,battleColor,_BP_AFF_LEGACY\[affVal\]\|\|affVal,k\)/);
});

test('a failed symbol load is retried, and simple-icon units are upgraded once the symbols arrive', () => {
  const load = fnSrc('function _bpSymLoad(){');
  assert.match(load, /if\(!wasFailed\)af\('var\(--yl\)'/, 'the offline toast shows once, not on every retry');
  assert.match(load, /if\(ok\)_bpSymReady\(wasFailed\);/);
  const arm = fnSrc('function _bpSymArmRetry(){');
  assert.match(arm, /window\.addEventListener\('online',onOnline\);/);
  assert.match(arm, /n\+\+<40&&window\._bpSymFailed&&S&&S\.hasMs\(\)/);
  const ready = fnSrc('function _bpSymReady(wasFailed){');
  assert.match(ready, /if\(!m\|\|m\.type!=='unit'\|\|m\.sidc\|\|m\.customSidc\|\|!_bpOwn\(S\.CATALOG,m\.iconKey\)\)continue;/);
  assert.match(ready, /_bpApplyUnit\(x,_bpStateFromMeta\(m\)\)/);
  // a library click drops a hidden pasted code
  assert.match(fnSrc('function selectBattleIcon(type){'), /if\(ci&&ci\.value\)\{ci\.value='';ci\._bpSynced='';ci\.classList\.remove\('bad'\)\}/);
});
