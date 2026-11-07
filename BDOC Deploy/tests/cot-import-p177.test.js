// p177 — CoT import (TAK → BDOC). 📂 OPEN TAK in the Battle Tracker reads a .cot / .xml file from
// ATAK / WinTAK / iTAK (one <event> or an <events> list) with js/bdoc-cot-import.js and places each
// a- event as a unit drawn as its MIL-STD-2525C symbol; spot / waypoint / CASEVAC / alert points become
// plain markers; drawings, routes and chat are counted and skipped. The file is untrusted: no DTD, size
// and event caps, numbers in range, every string cleaned. A uid seen before updates that unit, and the
// TAK uid / type go back out on the next export. These tests run the parser with a small XML DOM
// (tests/helpers/xml-dom.js) and run the real bdoc-plan.js cotEvents() for the round trip.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { DOMParser } = require('./helpers/xml-dom');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const HTML = read('index.html'), SW = read('service-worker.js'), PLAN = read('js/bdoc-plan.js'), ATAK = read('js/bdoc-atak.js');
const SYM_SRC = read('js/modules/battle-symbols.js'), COT_SRC = read('js/bdoc-cot-import.js');

const quiet = { log() {}, info() {}, warn() {}, error() {} };
function loadCot(extra) {
  const ctx = vm.createContext(Object.assign({ console: quiet, setTimeout, clearTimeout }, extra || {}));
  vm.runInContext(SYM_SRC, ctx);
  vm.runInContext(COT_SRC, ctx);
  return ctx;
}
const C0 = loadCot();
const S = C0.BDOCSym, K = C0.BDOCCot;
const parse = (xml, o) => K.parse(xml, Object.assign({ DOMParser, Sym: S }, o || {}));
const plain = x => JSON.parse(JSON.stringify(x));   // vm objects → this realm, for deepEqual
const fnSrc = start => { const i = HTML.indexOf(start); assert.ok(i >= 0, start); return HTML.slice(i, HTML.indexOf('\n}\n', i) + 3); };

const ev = (a, inner) => `<event version="2.0" ${a}>${inner || ''}</event>`;
const pt = (lat, lon) => `<point lat="${lat}" lon="${lon}" hae="9999999.0" ce="9999999.0" le="9999999.0"/>`;
const det = (cs, rm) => `<detail>${cs != null ? `<contact callsign="${cs}"/>` : ''}${rm != null ? `<remarks>${rm}</remarks>` : ''}</detail>`;

// what ATAK writes for one hostile armour marker (single quotes, a parent link, empty detail tags)
const ATAK_ONE = `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>
<event version='2.0' uid='ANDROID-5f3a9c' type='a-h-G-U-C-A' time='2026-11-06T12:00:00.000Z' start='2026-11-06T12:00:00.000Z' stale='2026-11-07T12:00:00.000Z' how='h-g-i-g-o'>
  <point lat='48.5201234' lon='37.9912345' hae='9999999.0' ce='9999999.0' le='9999999.0'/>
  <detail>
    <contact callsign='Hostile Armor 1'/>
    <link uid='ANDROID-me' production_time='2026-11-06T12:00:00.000Z' type='a-f-G-U-C' parent_callsign='VIPER' relation='p-p'/>
    <remarks>T-72s moving west &amp; dug in</remarks>
    <archive/>
    <color argb='-1'/>
  </detail>
</event>`;

test('a single ATAK <event> becomes one unit with its 2525C code, callsign as designation', () => {
  const r = parse(ATAK_ONE);
  assert.equal(r.error, null);
  assert.equal(r.total, 1);
  assert.deepEqual(plain(r.counts), { unit: 1, marker: 0, skip: 0 });
  const u = r.records[0];
  assert.equal(u.kind, 'unit');
  assert.equal(u.uid, 'ANDROID-5f3a9c');
  assert.equal(u.type, 'a-h-G-U-C-A');
  assert.equal(u.sidc, 'SHGPUCA--------');
  assert.equal(u.sidcFrom, 'type');
  assert.equal(u.designation, 'HOSTILE ARMOR 1');
  assert.equal(u.comment, 'T-72s moving west & dug in');
  assert.equal(u.lat, 48.5201234);
  assert.equal(u.lon, 37.9912345);
  // drawn as the library Armor / Tank, not a custom code
  const st = K.unitState(u, S);
  assert.equal(st.key, 'armor');
  assert.equal(st.custom, '');
  assert.equal(st.aff, 'hostile');
  assert.equal(st.designation, 'HOSTILE ARMOR 1');
  assert.equal(S.buildSIDC({ key: st.key, aff: st.aff, cond: st.cond, ech: st.ech, hq: st.hq || undefined, tf: st.tf, feint: st.feint }), 'SHGPUCA--------');
});

test('an <events> list: units, plain markers, and every skip counted by reason', () => {
  const xml = '<?xml version="1.0"?><events>' + [
    ev('uid="u1" type="a-f-G-U-C-I"', pt(34.5, 69.1) + det('Alpha 1')),
    ev('uid="u2" type="a-f-A-M-F-Q"', pt(34.6, 69.2) + det('Raven')),
    ev('uid="u3" type="a-n-S-C-L-D-D"', pt(26.5, 56.3) + det('')),
    ev('uid="m1" type="b-m-p-s-p-loc"', pt(34.7, 69.3) + det('OP North', 'overwatch')),
    ev('uid="m2" type="b-r-f-h-c"', pt(34.8, 69.4) + det('MEDEVAC 1')),
    ev('uid="m3" type="b-a-o-tbl"', pt(34.9, 69.5) + det('911')),
    ev('uid="m4" type="a-j-G-U-C"', pt(35.0, 69.6) + det('Joker')),
    ev('uid="d1" type="u-d-f"', pt(34.5, 69.1) + '<detail><link point="34.5,69.1"/><link point="34.6,69.2"/></detail>'),
    ev('uid="d2" type="u-d-c-c"', pt(34.5, 69.1) + '<detail><shape><ellipse major="500" minor="500" angle="360"/></shape></detail>'),
    ev('uid="r1" type="b-m-r"', pt(34.5, 69.1)),
    ev('uid="c1" type="b-t-f"', pt(34.5, 69.1)),
    ev('uid="t1" type="t-x-c-t"', pt(0, 0)),
    ev('uid="p1" type="a-f-G"', det('no point')),
    ev('uid="p2" type="a-f-G"', pt(0, 0)),
    ev('uid="p3" type="a-f-G"', pt(91, 10)),
    ev('uid="p4" type="a-f-G"', pt(10, 'NaN')),
    ev('uid="p5" type="a-f-G"', pt('1e999', 10)),
    ev('uid="p6" type="a-f-G"', pt('0x10', 10)),
    ev('uid="p7" type="a-f-G"', pt('45,5', 10)),
    ev('uid="y1" type="A-F-G"', pt(1, 1)),
    ev('uid="y2"', pt(1, 1)),
  ].join('\n') + '</events>';
  const r = parse(xml);
  assert.equal(r.error, null);
  assert.equal(r.total, 21);
  assert.deepEqual(plain(r.counts), { unit: 3, marker: 4, skip: 14 });
  assert.deepEqual(plain(r.skipped), { drawing: 2, route: 1, other: 2, position: 7, type: 2 });
  const by = Object.fromEntries(r.records.map(x => [x.uid, x]));
  assert.equal(by.u1.sidc, 'SFGPUCI--------');
  assert.equal(K.unitState(by.u1, S).key, 'infantry');
  assert.equal(by.u2.sidc, 'SFAPMFQ--------');
  assert.equal(K.unitState(by.u2, S).key, 'uav');
  assert.equal(by.u3.sidc, 'SNSPCLDD-------');
  assert.equal(K.unitState(by.u3, S).key, 'destroyer');
  assert.equal(by.u3.designation, '');
  // plain markers keep their TAK type and get a fixed style
  assert.equal(by.m1.kind, 'marker');
  assert.equal(by.m1.type, 'b-m-p-s-p-loc');
  assert.equal(by.m1.label, 'OP North');
  assert.equal(by.m1.comment, 'overwatch');
  assert.equal(by.m1.style.kind, 'SPOT / POINT');
  assert.equal(by.m2.style.kind, 'CASEVAC / MEDEVAC REQUEST');
  assert.equal(by.m3.style.kind, 'EMERGENCY ALERT');
  // a joker side has no symbol the controls can hold: a marker, not a quietly UNKNOWN unit
  assert.equal(by.m4.kind, 'marker');
  assert.equal(by.m4.style.color, '#DA3633');
  // the toast reasons exist for every skip kind
  for (const k of Object.keys(r.skipped)) assert.ok(K.REASONS[k], k);
  assert.ok(K.REASONS.duplicate && K.REASONS.limit);
});

test('numbers must be plain decimals inside the globe; padding and a sign are fine', () => {
  const one = (lat, lon) => parse(ev('uid="x" type="a-f-G-U-C"', pt(lat, lon))).records.length;
  assert.equal(one(' 45.5 ', '-120.25'), 1);
  assert.equal(one('+45.5', '.5'), 1);
  assert.equal(one('-90', '180'), 1);
  assert.equal(one('90.0001', '0'), 0);
  assert.equal(one('45', '-180.5'), 0);
  for (const bad of ['', 'Infinity', '-Infinity', '1e9999', '4 5', '45°', '0b1', '1_0', '45.5.5']) assert.equal(one(bad, '10'), 0, bad);
});

test('hostile files: a DTD is refused before the XML parser ever sees it', () => {
  const before = DOMParser.calls;
  const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
    <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>
    <event uid="x" type="a-f-G-U-C"><point lat="1" lon="1"/><detail><contact callsign="&lol3;"/></detail></event>`;
  const xxe = `<?xml version="1.0"?><!DOCTYPE event [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><event uid="x" type="a-f-G-U-C"><point lat="1" lon="1"/><detail><remarks>&xxe;</remarks></detail></event>`;
  for (const x of [laughs, xxe, '<!doctype event><event/>', '<event><!ENTITY a "b"></event>']) {
    const r = parse(x);
    assert.match(r.error, /DOCTYPE or entities/);
    assert.equal(r.records.length, 0);
  }
  assert.equal(DOMParser.calls, before, 'DOMParser was not called');
});

test('hostile files: broken, empty, huge, wrong format and fake parser errors are refused with a reason', () => {
  assert.match(parse('<event uid="x" type="a-f-G"><point lat="1" lon="2"></event>').error, /not well-formed/);
  assert.match(parse('{"format":"bdoc-plan","items":[]}').error, /not well-formed/);
  assert.match(parse('').error, /not well-formed/);
  assert.match(parse('<kml><Document><Placemark/></Document></kml>').error, /no CoT <event>/);
  assert.match(parse('<events></events>').error, /no CoT <event>/);
  // only <event> at the top or one level down: a nested one is not read
  assert.match(parse('<a><b>' + ev('uid="x" type="a-f-G-U-C"', pt(1, 1)) + '</b></a>').error, /no CoT <event>/);
  assert.match(parse('<events><parsererror/>' + ev('uid="x" type="a-f-G-U-C"', pt(1, 1)) + '</events>').error, /not well-formed/);
  assert.match(parse('x'.repeat(K.MAX_BYTES + 1)).error, /larger than 8 MB/);
  assert.match(parse(null).error, /not a text file/);
  assert.match(parse(new ArrayBuffer(8)).error, /not a text file/);
  // a missing module or XML parser is an error, not a throw
  assert.match(K.parse(ATAK_ONE, { DOMParser, Sym: {} }).error, /symbol module/);
  assert.match(K.parse(ATAK_ONE, { DOMParser: 'nope', Sym: S }).error, /cannot read XML/);
  // a byte-order mark and a namespace prefix are fine
  assert.equal(parse('\uFEFF' + ATAK_ONE).records.length, 1);
  assert.equal(parse('<c:events xmlns:c="urn:x"><c:event uid="n" type="a-f-G-U-C"><c:point lat="1" lon="1"/></c:event></c:events>').records.length, 1);
});

test('hostile files: text is cleaned before it can reach a label, a toast, a popup or milsymbol', () => {
  const nasty = '&lt;img src=x onerror=alert(1)&gt;&quot;&apos;&amp;`\\';
  const r = parse('<events>' +
    ev('uid="u" type="a-h-G-U-C-I"', pt(1, 1) + det(nasty, 'line one\u202E\u0085\u2028 &lt;script&gt;alert(1)&lt;/script&gt;\n\n\n\nline two')) +
    ev('uid="m" type="b-m-p-s-p-loc"', pt(1, 2) + det(nasty + ' ' + 'Ж'.repeat(80))) +
    ev(`uid="${'q'.repeat(129)}" type="a-f-G-U-C"`, pt(1, 3) + det('Z'.repeat(5000))) + '</events>');
  assert.equal(r.records.length, 3);
  const [u, m, q] = r.records;
  // unit designation: the 2525C text set, 21 characters
  assert.match(u.designation, /^[A-Z0-9 .,:;/()#+\-*_]{0,21}$/);
  assert.equal(u.designation, 'IMG SRCX ONERRORALERT');
  // marker label: any script, no markup characters, 40 characters
  assert.doesNotMatch(m.label, /[<>&"'`\\]/);
  assert.ok(m.label.length <= 40 && m.label.includes('Ж'));
  // notes keep their words (they are escaped where shown) but lose control / direction characters
  assert.doesNotMatch(u.comment, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E]/);
  assert.equal(u.comment, 'line one <script>alert(1)</script>\n\nline two');
  // a uid over 128 characters is no TAK uid: placed, but never matched or sent back
  assert.equal(q.uid, '');
  assert.equal(q.designation.length, 21);
  // the module never writes HTML and never evaluates anything (comments aside)
  assert.doesNotMatch(COT_SRC.replace(/\/\/.*$/gm, ''), /\beval\s*\(|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\.write|setTimeout\(['"`]/);
  assert.match(COT_SRC, /new DP\(\)\.parseFromString\(text, 'application\/xml'\)/);
});

test('hostile files: prototype names as uids, a 2000-event cap, and the newest copy of a uid wins', () => {
  const r = parse('<events>' + ['__proto__', 'constructor', '__proto__', 'toString'].map((u, i) =>
    ev(`uid="${u}" type="a-f-G-U-C" time="2026-11-06T12:0${i}:00Z"`, pt(1, i + 1))).join('') + '</events>');
  assert.deepEqual(r.records.map(x => x.uid), ['__proto__', 'constructor', 'toString']);
  assert.equal(r.records[0].lon, 3, 'the later __proto__ report replaced the earlier one');
  assert.deepEqual(plain(r.skipped), { duplicate: 1 });
  // a later copy with an OLDER time does not replace the newer one
  const old = parse('<events>' + ev('uid="a" type="a-f-G-U-C" time="2026-11-06T12:05:00Z"', pt(1, 1)) + ev('uid="a" type="a-f-G-U-C" time="2026-11-06T12:00:00Z"', pt(2, 2)) + '</events>');
  assert.equal(old.records.length, 1);
  assert.equal(old.records[0].lat, 1);
  // events past the cap are counted, not read
  const many = '<events>' + Array.from({ length: K.MAX_EVENTS + 5 }, (_, i) => ev(`uid="n${i}" type="a-f-G-U-C"`, pt(1 + (i % 80), 1))).join('') + '</events>';
  const big = parse(many);
  assert.equal(big.records.length, K.MAX_EVENTS);
  assert.equal(big.skipped.limit, 5);
  assert.equal(big.total, K.MAX_EVENTS + 5);
});

test('a SIDC in remarks wins only while it still names the event type', () => {
  const one = (type, remarks) => parse(ev(`uid="x" type="${type}"`, pt(1, 1) + det('Bravo', remarks))).records[0];
  // BDOC's own line: full code (HQ, battalion, planned) and higher unit kept, line taken out of the note
  let r = one('a-f-G-U-C-I', 'Hold the bridge\nSIDC SFGAUCI---AF--- · Higher: 3BCT');
  assert.equal(r.sidc, 'SFGAUCI---AF---');
  assert.equal(r.sidcFrom, 'remarks');
  assert.equal(r.higher, '3BCT');
  assert.equal(r.comment, 'Hold the bridge');
  // the side was changed to hostile in TAK: the type wins, the stale line still leaves the note
  r = one('a-h-G-U-C-I', 'SIDC SFGAUCI---AF--- · Higher: 3BCT');
  assert.equal(r.sidc, 'SHGPUCI--------');
  assert.equal(r.sidcFrom, 'type');
  assert.equal(r.higher, '');
  assert.equal(r.comment, '');
  // a code the controls cannot hold (joker) or a fake one is ignored
  assert.equal(one('a-f-G-U-C-I', 'SIDC SJGPUCI--------').sidc, 'SFGPUCI--------');
  assert.equal(one('a-f-G-U-C-I', 'SIDC &lt;script&gt;-------').sidc, 'SFGPUCI--------');
  // only BDOC's exact line shape counts; a sentence mentioning a SIDC stays in the note
  r = one('a-f-G-U-C-I', 'see SIDC SFGAUCI---AF--- later');
  assert.equal(r.sidcFrom, 'type');
  assert.equal(r.comment, 'see SIDC SFGAUCI---AF--- later');
});

test('stateFromSidc: every library symbol comes back as its library type and the same code', () => {
  const affs = ['friendly', 'hostile', 'neutral', 'unknown', 'afriend', 'suspect', 'pending'];
  const mods = [{}, { ech: 'company' }, { ech: 'brigade', hq: true }, { ech: 'battalion', tf: true, feint: true }, { cond: 'planned' }, { cond: 'destroyed', ech: 'team' }];
  let n = 0;
  for (const k of Object.keys(S.CATALOG)) for (const aff of affs) for (const md of mods) {
    const c = S.CATALOG[k], ech = (c.ech && !md.ech) ? c.ech : (md.ech || 'none');
    // the code the UNIT tool draws (_bpUnitVisual)
    const sd = S.buildSIDC({ key: k, aff, cond: md.cond || 'present', ech, hq: md.hq || undefined, tf: !!md.tf, feint: !!md.feint });
    const st = K.stateFromSidc(sd, S);
    assert.equal(st.custom, '', `${k} ${sd}`);
    // sniper / militia / jammer share a code with infantry / EW (their text is not in the code)
    if (!c.text) assert.equal(st.key, k, sd);
    const back = S.buildSIDC({ key: st.key, aff: st.aff, cond: st.cond, ech: (S.CATALOG[st.key].ech && st.ech === 'none') ? S.CATALOG[st.key].ech : st.ech, hq: st.hq || undefined, tf: st.tf, feint: st.feint });
    assert.equal(back, sd, `${k} ${aff} ${JSON.stringify(md)}`);
    n++;
  }
  assert.ok(n > 2000);
});

test('stateFromSidc: a code no library type draws exactly stays the exact custom code', () => {
  const custom = sd => { const st = K.stateFromSidc(sd, S); assert.equal(st.custom, sd, sd); assert.equal(st.customRaw, sd); return st; };
  // country + order of battle (positions 13-15), a generic unit (the HQ type would add a staff),
  // a function the library does not list, an installation, a mobility modifier
  assert.equal(custom('SFGPUCI----EUSA').key, 'infantry');
  assert.equal(custom('SFGPU----------').key, 'infantry');
  assert.equal(custom('SHGPUCVRA------').key, 'infantry');
  custom('SFGPIB----H----');
  custom('SFGPEVAT--MQ---');
  assert.equal(custom('SFAPMHH--------').key, 'rotary');
  // a cruiser is not in the library: its offline icon is the nearest sea type
  assert.equal(S.CATALOG[custom('SFSPCLCC-------').key].dim, 'S');
  // …while a plain surface track is the library's own Surface Vessel
  assert.deepEqual([K.stateFromSidc('SFSP-----------', S).key, K.stateFromSidc('SFSP-----------', S).custom], ['naval', '']);
  // what _bpUnitVisual will draw from that custom code is the code itself
  for (const sd of ['SFGPUCI----EUSA', 'SFGPU----------', 'SFGPEVAT--MQ---', 'SFAPMHH--------']) {
    const st = K.stateFromSidc(sd, S);
    assert.equal(S.buildSIDC({ base: st.custom, aff: st.aff, cond: st.cond, ech: st.ech, hq: st.hq || undefined, tf: st.tf, feint: st.feint }), sd);
  }
  // the key is always one index.html has a fallback icon for
  const st = K.stateFromSidc('SFGPUCI--------', S, k => k !== 'infantry');
  assert.notEqual(st.key, 'infantry');
  assert.equal(K.stateFromSidc('nope', S), null);
});

test('unitState: BDOC\'s own "FRIEND Infantry" callsign is not a designation; a real name is', () => {
  const rec = (sidc, callsign) => ({ sidc, callsign, designation: S.cleanText(callsign, 21), higher: '' });
  assert.equal(K.unitState(rec('SFGPUCI--------', 'FRIEND Infantry'), S).designation, '');
  assert.equal(K.unitState(rec('SHAPMFF--------', 'HOSTILE Fighter'), S).designation, '');
  assert.equal(K.unitState(rec('SFGPUCI----EUSA', 'FRIEND Custom symbol'), S).designation, '');
  assert.equal(K.unitState(rec('SAGPUSS3-------', 'ASSUMED FRIEND Supply Class III (Fuel / POL)'.slice(0, 40)), S).designation, '');
  assert.equal(K.unitState(rec('SFGPUCI--------', 'Alpha 1'), S).designation, 'ALPHA 1');
  assert.equal(K.unitState(rec('SFGPUCI--------', 'HOSTILE Infantry'), S).designation, 'HOSTILE INFANTRY', 'a different side is a name');
});

// ── round trip through the real export ──────────────────────────────────────────────────────
function loadPlan() {
  const ents = [];
  const ctx = vm.createContext({
    console: quiet, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, Date, Math, JSON,
    document: { addEventListener() {}, getElementById: () => null },
    battleMeta: new WeakMap(),
    battleEntities: [],
  });
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.Cesium = {
    JulianDate: { now: () => 0 },
    Color: function Color() {}, Cartesian3: function Cartesian3() {}, Cartesian2: function Cartesian2() {},
    Cartographic: { fromCartesian: p => ({ longitude: p.lon * Math.PI / 180, latitude: p.lat * Math.PI / 180, height: 0 }) },
    Math: { toDegrees: r => r * 180 / Math.PI },
  };
  ctx.V = { entities: { contains: e => ents.includes(e), getById: id => ents.find(e => e.id === id) }, clock: { currentTime: 0 }, scene: { requestRender() {} } };
  vm.runInContext(SYM_SRC, ctx);
  vm.runInContext(ATAK, ctx);
  vm.runInContext(PLAN, ctx);
  vm.runInContext(COT_SRC, ctx);
  const add = (id, lat, lon, meta, extra) => {
    const e = Object.assign({ id, position: { lat, lon }, billboard: {}, label: { text: meta.label || '' }, description: '' }, extra || {});
    ents.push(e); ctx.battleEntities.push(e); ctx.battleMeta.set(e, meta); return e;
  };
  return { ctx, add };
}

test('round trip: BDOC → TAK → BDOC keeps uid, full SIDC (HQ / size / status), designation, higher unit and note', () => {
  const { ctx, add } = loadPlan();
  const A = S.buildSIDC({ key: 'armor', aff: 'hostile', cond: 'planned', ech: 'battalion', hq: true });
  assert.equal(A, 'SHGAUCA---AF---');
  add('ent-A', 48.1, 37.2, { type: 'unit', label: '2-7 CAV', comment: 'Dug in on the ridge', sidc: A, customSidc: '', iconKey: 'armor', aff: 'hostile', cond: 'planned', ech: 'battalion', strength: '+', hq: true, tf: false, feint: false, designation: '2-7 CAV', higher: '3BCT' });
  add('ent-B', 48.2, 37.3, { type: 'unit', label: 'FRIEND Infantry', comment: '', sidc: 'SFGPUCI--------', iconKey: 'infantry', aff: 'friendly', designation: '' });
  add('ent-C', 48.3, 37.4, { type: 'unit', label: 'FRIEND Custom symbol', sidc: 'SFGPUCI----EUSA', customSidc: 'SFGPUCI----EUSA', iconKey: 'infantry', aff: 'friendly', cotUid: 'ANDROID-123' });
  add('ent-D', 48.4, 37.5, { type: 'tactical', label: 'OP NORTH', comment: 'Good overwatch', cotUid: 'ANDROID-spot', cotType: 'b-m-p-s-p-loc', color: '#E8B349' });
  add('ent-E', 48.5, 37.6, { type: 'tactical', label: 'FOB', comment: '' });
  add('ent-G', 48.6, 37.7, { type: 'unit', label: 'HOSTILE Armor / Tank', iconKey: 'armor', aff: 'hostile', sidc: '', customSidc: '' });
  add('ent-F', 48.0, 37.0, { type: 'zone', label: 'AO EAGLE' }, { billboard: undefined, label: { text: 'AO EAGLE' },
    polygon: { hierarchy: { positions: [{ lat: 48, lon: 37 }, { lat: 48.1, lon: 37 }, { lat: 48.1, lon: 37.1 }], holes: [] }, outlineWidth: 2 } });
  // pickCoT stands in for index.html's: tactical → FOB, simple-icon unit → its side
  const pick = m => (m.type === 'tactical' ? 'fob' : m.aff === 'hostile' ? 'hostile_ground' : 'friendly_ground');
  const events = ctx.BDOCPlan.cotEvents(pick);
  assert.equal(events.length, 7);
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<events>\n' + events.join('\n') + '\n</events>';
  const r = ctx.BDOCCot.parse(xml, { DOMParser, Sym: ctx.BDOCSym });
  assert.equal(r.error, null);
  assert.deepEqual(plain(r.skipped), { drawing: 1 });
  const by = Object.fromEntries(r.records.map(x => [x.uid, x]));
  // A: everything the CoT can carry comes back
  const a = by['BDOC-ent-A'];
  assert.ok(a, Object.keys(by).join());
  assert.equal(a.type, 'a-h-G-U-C-A');
  assert.equal(a.sidc, A);
  assert.equal(a.sidcFrom, 'remarks');
  assert.equal(a.designation, '2-7 CAV');
  assert.equal(a.higher, '3BCT');
  assert.equal(a.comment, 'Dug in on the ridge');
  assert.ok(Math.abs(a.lat - 48.1) < 1e-6 && Math.abs(a.lon - 37.2) < 1e-6);
  const sa = ctx.BDOCCot.unitState(a, ctx.BDOCSym);
  assert.deepEqual([sa.key, sa.custom, sa.aff, sa.cond, sa.ech, sa.hq, sa.tf, sa.feint, sa.designation, sa.higher],
    ['armor', '', 'hostile', 'planned', 'battalion', true, false, false, '2-7 CAV', '3BCT']);
  // B: no designation in, none out
  assert.equal(by['BDOC-ent-B'].sidc, 'SFGPUCI--------');
  assert.equal(ctx.BDOCCot.unitState(by['BDOC-ent-B'], ctx.BDOCSym).designation, '');
  // C: imported from TAK earlier, so it goes back with TAK's uid and its exact code
  const c = by['ANDROID-123'];
  assert.equal(c.sidc, 'SFGPUCI----EUSA');
  assert.equal(ctx.BDOCCot.unitState(c, ctx.BDOCSym).custom, 'SFGPUCI----EUSA');
  assert.equal(ctx.BDOCCot.unitState(c, ctx.BDOCSym).designation, '');
  // D: a TAK spot marker keeps its uid and type (it used to go out as friendly ground)
  const d = by['ANDROID-spot'];
  assert.equal(d.kind, 'marker');
  assert.equal(d.type, 'b-m-p-s-p-loc');
  assert.equal(d.label, 'OP NORTH');
  assert.equal(d.comment, 'Good overwatch');
  // E / G: no SIDC, so the type is the pickCoT one (index.html leaves E alone: it is not a unit there)
  assert.equal(by['BDOC-ent-E'].type, 'a-f-G-I-B-B-F');
  assert.equal(by['BDOC-ent-G'].sidc, 'SHGPUC---------');
  // TAK markers and units stay on a TAK map for a day
  const dEv = events.find(e => e.includes('uid="ANDROID-spot"'));
  const t = s => Date.parse(new RegExp(s + '="([^"]+)"').exec(dEv)[1]);
  assert.ok(t('stale') - t('time') > 23 * 3600e3);
});

test('export: a bad cotUid / cotType never reaches the CoT; OPEN FILE drops them', () => {
  const { ctx, add } = loadPlan();
  add('ent-X', 1, 1, { type: 'tactical', label: 'X', cotUid: 'a\u0001b', cotType: 'constructor' });
  add('ent-Y', 1, 2, { type: 'tactical', label: 'Y', cotUid: 'u'.repeat(129), cotType: 'a-f-G-<x' });
  const evs = ctx.BDOCPlan.cotEvents(() => 'friendly_ground');
  assert.match(evs[0], /uid="BDOC-ent-X" type="a-f-G-U-C"/);
  assert.match(evs[1], /uid="BDOC-ent-Y" type="a-f-G-U-C"/);
  // sanitizeSpec (OPEN FILE) keeps good ones, drops bad ones
  const pre = ['  const SIDC_RE', '  const takUidOk', '  const COT_TYPE_RE'].map(s => PLAN.slice(PLAN.indexOf(s), PLAN.indexOf('\n', PLAN.indexOf(s)))).join('\n');
  const fnStart = PLAN.indexOf('  function sanitizeSpec(s) {');
  const sx = vm.createContext({});
  vm.runInContext(pre + '\n' + PLAN.slice(fnStart, PLAN.indexOf('\n  }\n', fnStart) + 4) + ';this.f=sanitizeSpec;', sx);
  const good = sx.f({ meta: { type: 'tactical', cotUid: 'ANDROID-358240051111110', cotType: 'b-m-p-s-p-loc' } }).meta;
  assert.equal(good.cotUid, 'ANDROID-358240051111110');
  assert.equal(good.cotType, 'b-m-p-s-p-loc');
  for (const [u, t] of [['', 'b'], ['x'.repeat(129), '__proto__'], ['a\nb', 'a-f-G-U-C-<'], [42, 42]]) {
    const m = sx.f({ meta: { cotUid: u, cotType: t } }).meta;
    assert.equal('cotUid' in m, false, String(u));
    assert.equal('cotType' in m, false, String(t));
  }
  assert.equal(PLAN.match(/const COT_TYPE_RE = (\/.*\/);/)[1], String(K.TYPE_RE), 'plan and module agree on the CoT type shape');
});

// ── index.html wiring ───────────────────────────────────────────────────────────────────────
test('OPEN TAK sits beside the TAK export and the import code is wired, escaped and on the undo stack', () => {
  assert.match(HTML, /⬇ TAK<\/button>\n<button class="bp-tool" onclick="importBattleCoT\(\)" title="Open a CoT file from ATAK \/ WinTAK \/ iTAK[^"]*"[^>]*>📂 OPEN TAK<\/button>/);
  const pick = fnSrc('function importBattleCoT(){');
  assert.match(pick, /inp\.accept='\.cot,\.xml,application\/xml,text\/xml';/);
  assert.match(pick, /f\.size>\(window\.BDOCCot\?BDOCCot\.MAX_BYTES:8388608\)/);
  const imp = fnSrc('async function _cotImportText(text,fileName){');
  assert.match(imp, /const name=esc\(String\(fileName\|\|'file'\)/);
  assert.match(imp, /esc\(res\.error\)/);
  assert.doesNotMatch(imp, /af\([^)]*fileName/);
  assert.match(imp, /BDOCCot\.parse\(text,\{Sym:S\}\)/);
  // standard symbols when they come within a few seconds, else the UNIT tool's offline icons
  assert.match(imp, /Promise\.race\(\[_bpSymLoad\(\)\.catch\(\(\)=>false\),new Promise\(r=>setTimeout\(r,6000\)\)\]\)/);
  // same uid → update; a different kind of item with that uid is left alone
  assert.match(imp, /const hit=_cotFind\(r\.uid\);/);
  assert.match(imp, /_cotUpdate\(hit,r,S\);out\.updated\+\+/);
  // new units go through the UNIT tool's own entity code, so they are pushed (undo + autosave)
  assert.match(fnSrc('function _bpAddUnit(lat,lon,st,comment){'), /attachMeta\(ent,meta\);\n  battleEntities\.push\(ent\);/);
  assert.match(fnSrc('function _cotAddMarker(r){'), /attachMeta\(ent,meta\);\n  battleEntities\.push\(ent\);/);
  assert.match(fnSrc('function placeBattleUnit(lat,lon){'), /const \{vis,meta\}=_bpAddUnit\(lat,lon,st,''\);/);
  const upd = fnSrc('function _cotUpdate(ent,r,S){');
  // p179: an undo label is plain text and BDOCUndo.undo() escapes it once (tests/toast-escape-p179.test.js)
  assert.match(upd, /BDOCUndo\.record\(ent,'TAK update of '\+\(now\.label\|\|'marker'\),/);
  assert.match(upd, /_bpRestoreUnit\(ent,snap\);/);
  // offline: the exact code is kept for ⬇ TAK and the later redraw
  assert.match(fnSrc('function _cotAddUnit(r,S){'), /if\(!vis\.sidc\)meta\.customSidc=r\.sidc;/);
  // marker popup rows are escaped, and the marker glyph comes from the module's fixed list
  assert.match(HTML, /const _cotR=\(k,v\)=>v\?`<b style="color:#4a5068">\$\{k\}:<\/b> \$\{esc\(v\)\}<br>`:'';/);
  assert.match(fnSrc('function _cotMarkerSVG(s){'), /\$\{esc\(\(s&&s\.glyph\)\|\|'•'\)\}/);
});

test('_cotFind: a TAK uid finds the unit imported with it, or the BDOC entity it was exported from', () => {
  const src = fnSrc('function _cotFind(uid){');
  const a = { id: 'aaa' }, b = { id: 'bbb' }, c = { id: 'ccc' }, gone = { id: 'ddd' };
  const meta = new Map([[a, { cotUid: 'ANDROID-1' }], [b, {}], [c, { cotUid: 'BDOC-bbb' }], [gone, { cotUid: 'ANDROID-9' }]]);
  const ctx = vm.createContext({ battleEntities: [a, [b], b, c, gone], battleMeta: meta, V: { entities: { contains: e => e !== gone } } });
  vm.runInContext(src + ';this.f=_cotFind;', ctx);
  assert.equal(ctx.f('ANDROID-1'), a);
  // BDOC-bbb: c was imported with that uid (another BDOC's export) and wins over b's own id
  assert.equal(ctx.f('BDOC-bbb'), c);
  ctx.battleEntities = [a, b];
  vm.runInContext('battleEntities=this.battleEntities', ctx);
  assert.equal(ctx.f('BDOC-bbb'), b);
  assert.equal(ctx.f('ANDROID-9'), null, 'a removed unit is not updated');
  assert.equal(ctx.f(''), null);
  assert.equal(ctx.f('BDOC-'), null);
});

// p177, not p176: branch claude/milsym-layer-sidc already took p176 / bdoc-v178 from the same base.
// Two builds sharing one SW_VERSION would leave the second one's devices on the old cache.
test('versions: SW v179 for p177 with v177 kept; the new module and bdoc-plan.js are precached at p177 or later', () => {
  // p179 or later keeps this line as `// (prev)`, so the match is not anchored to the line start
  assert.match(SW, /const SW_VERSION = 'bdoc-v179';  \/\/ p177: CoT import/);
  assert.match(SW, /^\/\/ \(prev\) const SW_VERSION = 'bdoc-v177';  \/\/ p175:/m);
  assert.equal((SW.match(/^const SW_VERSION = /gm) || []).length, 1, 'one live SW_VERSION line');
  // p177 or later: a later build that changes one of these files bumps its ?v= (p179 changed bdoc-plan.js)
  const at = {};
  for (const f of ['bdoc-plan', 'bdoc-cot-import']) {
    const m = new RegExp(`<script src="js/${f}\\.js\\?v=(p1(?:7[7-9]|[89]\\d)\\w*)"></script>`).exec(HTML);
    assert.ok(m, f);
    at[f] = m[1];
    assert.ok(SW.includes(`'/js/${f}.js?v=${m[1]}',`), `${f} precached at ${m[1]}`);
  }
  // the module loads after bdoc-plan.js (no order dependency, but keep the pair together)
  assert.ok(HTML.indexOf(`js/bdoc-cot-import.js?v=${at['bdoc-cot-import']}`) > HTML.indexOf(`js/bdoc-plan.js?v=${at['bdoc-plan']}`));
  // p177 changes no js/modules file, so LazyLoader keeps whatever build it is at; the rule that
  // matters (HANDOFF rule 3) is that it equals ?v= on every /js/modules/* precache entry
  const lz = /_version:\s*'([^']+)'/.exec(HTML)[1];
  const mods = [...SW.matchAll(/'\/js\/modules\/[^'?]+\?v=([^']+)'/g)].map(m => m[1]);
  assert.ok(mods.length > 5, 'module precache entries found');
  for (const v of mods) assert.equal(v, lz, 'LazyLoader _version = module ?v=');
});
