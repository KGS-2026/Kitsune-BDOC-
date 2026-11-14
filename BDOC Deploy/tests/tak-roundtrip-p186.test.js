// p186 — the TAK import (p177), run for real: tests/helpers/battle-page.js runs the Battle Tracker's
// own page code with the real symbol, plan, export and import modules, so each test opens a TAK
// file, exports, undoes or opens a plan file the way a user does and looks at what is on the map.
//
// The bugs the p186 review found in what was live, each reproduced here:
//   a freeze on a long run of spaces in <remarks> (90 s for 300,000 spaces); emergency-management,
//   stability-operations and pre-p175 units redrawn as infantry when BDOC's own export was opened
//   again; callsigns squeezed into A-Z ("Сокіл-1" → "-1") and sent back to TAK that way; a cancelled
//   alert still placed; BDOC's own "FRIEND Infantry" label kept as a name after TAK changed the side;
//   one undo step per item on a stack of 400; BDOC's CASEVAC sent as a type TAK does not know; and a
//   plan file able to put events of its own into the operator's TAK export.
// The other tests guard the fixes themselves: the name the unit editor keeps and a plan file cannot
// fill with markup, what the one undo step puts back, and the single index of the map.
// Run against the live code before the fix (63931bd), all 15 fail.
const { test } = require('node:test');
const assert = require('node:assert');
const { make, ev, pt, det, read } = require('./helpers/battle-page.js');

const T = 'time="2026-11-13T10:00:00Z"';
const meta = (P, e) => P.get('battleMeta').get(e);
const labelOf = e => e.label.text.getValue();
const posOf = e => { const p = e.position.getValue(); return [p.y, p.x]; };
const open = (P, xml, name) => P.ctx._cotImportText(xml, name || 'test.cot');
const exported = P => { P.downloads.length = 0; P.ctx.exportBattlePlanCoT(); return P.downloads[0] ? P.downloads[0].xml : ''; };
const events = xml => [...xml.matchAll(/<event\b[\s\S]*?<\/event>/g)].map(m => ({
  xml: m[0], uid: (/\suid="([^"]*)"/.exec(m[0]) || [])[1], type: (/\stype="([^"]*)"/.exec(m[0]) || [])[1],
  callsign: (/callsign="([^"]*)"/.exec(m[0]) || [])[1], remarks: ((/<remarks>([\s\S]*?)<\/remarks>/.exec(m[0]) || [])[1] || '').trim(),
}));
const parse = (P, xml) => P.ctx.BDOCCot.parse(xml, { Sym: P.ctx.BDOCSym });
// a unit placed with the UNIT tool's own code
const place = (P, lat, lon, st, note) => P.ctx._bpAddUnit(lat, lon, Object.assign({ key: 'infantry', aff: 'friendly', cond: 'present', ech: 'none', strength: '', hq: false, tf: false, feint: false, designation: '', higher: '', custom: '', customRaw: '' }, st), note || '').ent;

test('a long run of spaces in <remarks> no longer freezes the tab', () => {
  const P = make();
  // 300,000 spaces then a letter: about two minutes in p177's cleanNote, which trimmed line ends with a backtracking regex
  const xml = ev(`uid="u" type="a-f-G-U-C" ${T}`, pt(1, 1) + det('A', ' '.repeat(300000) + 'x'));
  const t0 = Date.now();
  const r = parse(P, xml);
  const ms = Date.now() - t0;
  assert.equal(r.error, null);
  assert.equal(r.records[0].comment, 'x');
  assert.ok(ms < 3000, 'parsed in ' + ms + ' ms');
  // and the cleaner itself, on its own, at the file size limit
  const t1 = Date.now();
  assert.equal(P.ctx.BDOCCot.cleanNote(' '.repeat(2000000) + 'x\n  y  \n\n\n\nz\t', 100), 'x\n  y\n\nz');
  assert.ok(Date.now() - t1 < 3000);
});

test("BDOC's SIDC line is the LAST one in remarks and survives a long note", () => {
  const P = make();
  // the user's own note holds a line that looks like BDOC's; BDOC's real line comes after it
  const note = 'Was reported as:\nSIDC SHGPUCI--------\nnow confirmed armor';
  let r = parse(P, ev(`uid="u" type="a-h-G-U-C-A" ${T}`, pt(1, 1) + det('X', note + '\nSIDC SHGAUCA---AF--- · Higher: 3BCT')));
  assert.equal(r.records[0].sidc, 'SHGAUCA---AF---', 'planned armor battalion HQ, from BDOC\'s line');
  assert.equal(r.records[0].sidcFrom, 'remarks');
  assert.equal(r.records[0].higher, '3BCT');
  assert.equal(r.records[0].comment, note, 'the user\'s note is whole, its own SIDC-looking line included');
  // a note of 3,990 characters used to push BDOC's line past the 4,000-character cut
  const long = 'n'.repeat(3990);
  r = parse(P, ev(`uid="u" type="a-h-G-U-C-A" ${T}`, pt(1, 1) + det('X', long + '\nSIDC SHGAUCA---AF---')));
  assert.equal(r.records[0].sidc, 'SHGAUCA---AF---');
  assert.equal(r.records[0].comment.length, 1000, 'the note itself is still cut to what a note holds');
  // text a TAK user added after BDOC's line does not hide it
  r = parse(P, ev(`uid="u" type="a-h-G-U-C-A" ${T}`, pt(1, 1) + det('X', 'first\nSIDC SHGAUCA---AF---\nadded in ATAK')));
  assert.equal(r.records[0].sidc, 'SHGAUCA---AF---');
  assert.equal(r.records[0].comment, 'first\nadded in ATAK');
});

test('a code TAK has no type for is trusted while the type is still its side\'s plain ground type', () => {
  const P = make(), K = P.ctx.BDOCCot, S = P.ctx.BDOCSym;
  const rec = (type, line) => parse(P, ev(`uid="u" type="${type}" ${T}`, pt(1, 1) + det('X', line))).records[0];
  // emergency management, stability operations, signals intelligence: cotType() is null for all three
  for (const code of ['EFIPA----------', 'OFVPA----------', 'IFAPSCC--------']) {
    assert.equal(S.cotType(code), null, code);
    const r = rec('a-f-G-U-C', 'SIDC ' + code);
    assert.equal(r.sidc, code, code + ' comes back as itself (p177 made it SFGPUC---------)');
    assert.equal(r.sidcFrom, 'remarks');
    // TAK changed the side, or gave it a function: TAK wins
    assert.equal(rec('a-h-G-U-C', 'SIDC ' + code).sidcFrom, 'type', code + ' side changed');
    assert.equal(rec('a-f-G-U-C-I', 'SIDC ' + code).sidc, 'SFGPUCI--------', code + ' type changed');
  }
  assert.equal(rec('a-h-G-U-C', 'SIDC OHVPA----------').sidc, 'OHVPA----------');
  assert.equal(rec('a-n-G', 'SIDC ENIPA----------').sidc, 'ENIPA----------');
  assert.equal(rec('a-u-G', 'SIDC EUIPA----------').sidc, 'EUIPA----------');
  // assumed friend and suspect go out under the friendly and hostile plain types
  assert.equal(rec('a-f-G-U-C', 'SIDC EAIPA----------').sidc, 'EAIPA----------');
  assert.equal(rec('a-h-G-U-C', 'SIDC ESIPA----------').sidc, 'ESIPA----------');
  // a warfighting code still has to name the very type
  assert.equal(rec('a-f-G-U-C', 'SIDC SFGPUCI--------').sidc, 'SFGPUC---------');
  // the plain types are the ones the export really uses (index.html _bpPickCoT + js/bdoc-atak.js COT_TYPES)
  const want = { friendly: 'f', afriend: 'f', hostile: 'h', suspect: 'h', neutral: 'n', unknown: 'u', pending: 'u' };
  for (const aff of Object.keys(want)) {
    const key = P.ctx._bpPickCoT({ type: 'unit', aff, customSidc: 'EFIPA----------' });
    assert.equal(P.get('COT_TYPES')[key], K.GENERIC_TYPE[want[aff]], aff);
  }
});

test('opening BDOC\'s own TAK export changes nothing: emergency, stability and pre-p175 units included', async () => {
  const P = make();
  place(P, 30.1, -90.1, { custom: 'EFIPA----------', customRaw: 'EFIPA----------' }, 'Shelter at the school');
  place(P, 30.2, -90.2, { aff: 'hostile', custom: 'OHVPA----------', customRaw: 'OHVPA----------', designation: 'CELL 4' });
  place(P, 30.3, -90.3, { cond: 'damaged', ech: 'company', designation: 'A CO', higher: '2-7 IN' });
  // a unit placed before p175: a label and a picture, no code, no side field
  const legacy = P.V.entities.add({ position: P.Cesium.Cartesian3.fromDegrees(-90.4, 30.4), billboard: { image: 'data:image/svg+xml;base64,AAAA', width: 32, height: 32 }, label: { text: 'ARMOR / TANK' } });
  P.ctx.attachMeta(legacy, { label: 'HOSTILE Armor / Tank', comment: '', type: 'unit', color: '#DA3633' });
  P.ctx.battleEntities.push(legacy);
  const snap = () => P.ents.map(e => JSON.stringify([meta(P, e), labelOf(e), posOf(e), e.billboard.image.getValue()]));
  const before = snap();
  const out = exported(P), evs = events(out);
  assert.deepEqual(evs.map(e => e.type), ['a-f-G-U-C', 'a-h-G-U-C', 'a-f-G-U-C-I', 'a-h-G-U-C']);
  assert.match(evs[0].remarks, /^Shelter at the school\nSIDC EFIPA----------$/, 'the export writes the code for a unit TAK has no type for');
  assert.match(evs[1].remarks, /^SIDC OHVPA----------$/);
  assert.match(evs[2].remarks, /^SIDC SFGDUCI----E--- · Higher: 2-7 IN$/);
  assert.equal(evs[3].remarks, '', 'a unit without a code has no code line');
  const r = await open(P, out, 'BDOC-BattlePlan.cot.xml');
  assert.deepEqual([r.units, r.markers, r.updated, r.other, r.failed], [0, 0, 4, 0, 0]);
  assert.equal(P.ents.length, 4);
  assert.deepEqual(snap(), before, 'p177 turned the first, second and fourth into plain infantry here');
  // and TAK moving them moves them, still unchanged
  const moved = out.replace(/lat="30\.1000000"/, 'lat="31.5000000"').replace(/lat="30\.4000000"/, 'lat="31.6000000"');
  await open(P, moved, 'moved.cot');
  assert.deepEqual(posOf(P.ents[0]), [31.5, -90.1]);
  assert.deepEqual(posOf(legacy), [31.6, -90.4]);
  assert.equal(meta(P, P.ents[0]).sidc, 'EFIPA----------');
  assert.equal(labelOf(legacy), 'ARMOR / TANK');
  assert.equal(meta(P, legacy).sidc, undefined, 'the pre-p175 unit is still what it was');
});

test('a callsign is kept as written: on the map, in the popup and on the way back to TAK', async () => {
  const P = make();
  const cases = [
    // callsign from TAK,            name kept,                        2525C designation
    ['Viper 2-6',                    'Viper 2-6',                      'VIPER 2-6'],
    ['ALPHA 1-1',                    '',                               'ALPHA 1-1'],      // fits as it is: no separate name needed
    ['Müller',                       'Müller',                         ''],
    ['José 2',                       'José 2',                         ''],
    ['Сокіл-1',                      'Сокіл-1',                        ''],
    ['Склад БК',                     'Склад БК',                       ''],
    ['القائد',                       'القائد',                         ''],
    ['第3小隊',                       '第3小隊',                         ''],
    ['Recon Team Bravo Two-Six North', 'Recon Team Bravo Two-Six North', ''],             // 30 characters: the 21-character field would cut it
    ["O'Neill",                      'ONeill',                         'ONEILL'],         // the apostrophe goes (labels reach HTML), the letters stay
  ];
  const xml = '<events>' + cases.map((c, i) => ev(`uid="ANDROID-${i}" type="a-f-G-U-C-I" ${T}`, pt(10 + i, 20) + det(c[0].replace(/&/g, '&amp;').replace(/'/g, '&apos;')))).join('') + '</events>';
  const r = await open(P, xml);
  assert.equal(r.units, cases.length);
  cases.forEach((c, i) => {
    const m = meta(P, P.ents[i]), shown = c[1] || c[2];
    assert.equal(m.name || '', c[1], c[0] + ': name');
    assert.equal(m.designation, c[2], c[0] + ': designation');
    assert.equal(m.label, shown, c[0] + ': label');
    assert.equal(labelOf(P.ents[i]), shown + '\nINFANTRY', c[0] + ': map label');
    assert.equal(m.popupTitle, shown + ' — INFANTRY', c[0] + ': popup title');
  });
  // back to TAK under the same uid with the same callsign (p177 sent "-1", "MLLER", "FRIEND Infantry" …)
  const evs = events(exported(P));
  cases.forEach((c, i) => { assert.equal(evs[i].uid, 'ANDROID-' + i); assert.equal(evs[i].callsign, c[1] || c[2], c[0] + ': exported'); });
  // an edit of something else keeps the name; typing a new designation replaces it
  const e = P.ents[4], st = P.ctx._bpStateFromMeta(meta(P, e));
  assert.equal(st.name, 'Сокіл-1');
  P.ctx._bpApplyUnit(e, Object.assign({}, st, { cond: 'damaged' }));
  assert.equal(meta(P, e).name, 'Сокіл-1'); assert.equal(labelOf(e), 'Сокіл-1\nINFANTRY');
  P.ctx._bpApplyUnit(e, Object.assign({}, st, { name: '', designation: 'SOKIL 1' }));
  assert.equal(meta(P, e).name, ''); assert.equal(labelOf(e), 'SOKIL 1\nINFANTRY');
  assert.equal(events(exported(P))[4].callsign, 'SOKIL 1');
  // the same file again: TAK's callsign is the name again, and nothing is added
  const again = await open(P, xml);
  assert.deepEqual([again.units, again.updated], [0, cases.length]);
  assert.equal(meta(P, e).name, 'Сокіл-1');
});

test('the unit editor keeps a TAK name unless the designation is retyped (the page code says so)', () => {
  const ed = read('index.html');
  assert.match(ed, /if\(st\.name&&s\.designation===st\.designation\)s\.name=st\.name;/);
  // _bpUnitMeta always writes name, so a redraw without one clears an old one in the merged meta
  assert.match(ed, /name:st\.name\|\|''\};\n  return m;/);
});

test('an alert cancelled later in the file is not placed', async () => {
  const P = make();
  const alert = (time, type) => ev(`uid="ANDROID-7-9-1-1" type="${type}" time="${time}"`, pt(34, 69) + det('JENNY-Alert'));
  let r = parse(P, '<events>' + alert('2026-11-13T10:00:00Z', 'b-a-o-tbl') + alert('2026-11-13T10:05:00Z', 'b-a-o-can') + '</events>');
  assert.equal(r.records.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r.skipped)), { cancelled: 1, other: 1 });
  assert.equal(r.counts.skip, 2);
  // written the other way round in the file, the times still decide
  r = parse(P, '<events>' + alert('2026-11-13T10:05:00Z', 'b-a-o-can') + alert('2026-11-13T10:00:00Z', 'b-a-o-tbl') + '</events>');
  assert.equal(r.records.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r.skipped)), { cancelled: 1, other: 1 });
  // raised again after the cancel: it stands
  r = parse(P, '<events>' + alert('2026-11-13T10:00:00Z', 'b-a-o-tbl') + alert('2026-11-13T10:05:00Z', 'b-a-o-can') + alert('2026-11-13T10:09:00Z', 'b-a-o-pan') + '</events>');
  assert.deepEqual(r.records.map(x => [x.kind, x.type]), [['marker', 'b-a-o-pan']]);
  // a cancel on its own is a message, as before; one without a position is fine (it has none)
  r = parse(P, ev(`uid="x" type="b-a-o-can" ${T}`, ''));
  assert.equal(r.records.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r.skipped)), { other: 1 });
  // the toast says so
  await open(P, '<events>' + alert('2026-11-13T10:00:00Z', 'b-a-o-tbl') + alert('2026-11-13T10:05:00Z', 'b-a-o-can') + '</events>', 'alerts.cot');
  assert.equal(P.ents.length, 0);
  assert.match(P.toasts[P.toasts.length - 1], /nothing placed · skipped: .*alerts cancelled later in the file \(1\)/);
});

test("BDOC's own \"FRIEND Infantry\" callsign is never a name, whatever TAK changed", async () => {
  const P = make();
  const u = place(P, 30, -90, {});                                      // friendly infantry, no designation
  const evs = events(exported(P));
  assert.equal(evs[0].callsign, 'FRIEND Infantry');
  // TAK makes it hostile and sends it back with the callsign it was given
  await open(P, ev(`uid="${evs[0].uid}" type="a-h-G-U-C-I" ${T}`, pt(30, -90) + det('FRIEND Infantry')));
  let m = meta(P, u);
  assert.equal(m.aff, 'hostile'); assert.equal(m.sidc, 'SHGPUCI--------');
  assert.equal(m.designation, '', 'p177 made the old label its designation: a hostile unit called FRIEND INFANTRY');
  assert.equal(m.label, 'HOSTILE Infantry');
  assert.equal(labelOf(u), 'INFANTRY');
  // TAK changes the type and still sends the first callsign
  await open(P, ev(`uid="${evs[0].uid}" type="a-h-G-U-C-A" ${T}`, pt(30, -90) + det('FRIEND Infantry')));
  m = meta(P, u);
  assert.equal(m.sidc, 'SHGPUCA--------'); assert.equal(m.designation, ''); assert.equal(labelOf(u), 'ARMOR / TANK');
  // a designation typed in BDOC since is not wiped by an old export that still says "FRIEND Infantry"
  P.ctx._bpApplyUnit(u, Object.assign({}, P.ctx._bpStateFromMeta(meta(P, u)), { designation: 'RED 1' }));
  await open(P, ev(`uid="${evs[0].uid}" type="a-h-G-U-C-A" ${T}`, pt(30.5, -90) + det('FRIEND Infantry')));
  assert.equal(meta(P, u).designation, 'RED 1');
  assert.deepEqual(posOf(u), [30.5, -90]);
  // every side with every type is covered, including the offline icon library's names
  const K = P.ctx.BDOCCot, S = P.ctx.BDOCSym;
  assert.equal(K.isAutoLabel('SUSPECT Field Artillery', S), true);
  assert.equal(K.isAutoLabel('PENDING Custom symbol', S), true);
  assert.equal(K.isAutoLabel('Hostile Armor 1', S), false);
  assert.equal(K.isAutoLabel('', S), false);
});

test('a TAK file is ONE undo step, however many items it holds', async () => {
  const P = make();
  const mine = [place(P, 1, 1, { designation: 'MINE 1' }), place(P, 2, 2, { designation: 'MINE 2' }), place(P, 3, 3, { designation: 'MINE 3' })];
  const many = '<events>' + Array.from({ length: 450 }, (_, i) => ev(`uid="E${i}" type="a-h-G-U-C-I" ${T}`, pt(10 + i / 100, 20) + det('E' + i))).join('') + '</events>';
  const r = await open(P, many, 'big.cot');
  assert.equal(r.units, 450); assert.equal(P.ents.length, 453);
  P.ctx.BDOCUndo.undo();
  assert.equal(P.ents.length, 3, 'p177: 400 presses of Ctrl+Z left 50 of the 450 on the map');
  assert.equal(P.toasts[P.toasts.length - 1], '↶ Undone: TAK file &quot;big.cot&quot; (450 items)');
  assert.deepEqual(P.ents, mine);
  assert.equal(P.ctx.battleEntities.length, 3, 'and they are off the plan, not just off the map');
  // the next undo is the user's own last unit, as before
  P.ctx.BDOCUndo.undo();
  assert.equal(P.ents.length, 2);
  assert.match(P.toasts[P.toasts.length - 1], /^↶ Undone: MINE 3/);
});

test('undoing a file that moved and renamed things puts each one back', async () => {
  const P = make();
  await open(P, '<events>' + ev(`uid="A" type="a-f-G-U-C-I" ${T}`, pt(10, 20) + det('Alpha', 'first note')) + ev(`uid="M" type="b-m-p-w" ${T}`, pt(11, 21) + det('WP 1')) + '</events>', 'one.cot');
  const [a, w] = P.ents;
  const r = await open(P, '<events>' + ev(`uid="A" type="a-f-G-U-C-A" time="2026-11-13T11:00:00Z"`, pt(12, 22) + det('Bravo', 'second note')) +
    ev(`uid="M" type="b-m-p-w" time="2026-11-13T11:00:00Z"`, pt(13, 23) + det('WP 1B')) + ev(`uid="N" type="b-m-p-s-m" ${T}`, pt(14, 24) + det('New spot')) + '</events>', 'two.cot');
  assert.deepEqual([r.units, r.markers, r.updated], [0, 1, 2]);
  assert.deepEqual(posOf(a), [12, 22]); assert.equal(meta(P, a).sidc, 'SFGPUCA--------'); assert.equal(meta(P, a).label, 'Bravo'); assert.equal(meta(P, a).comment, 'second note');
  assert.equal(labelOf(w), 'WP 1B'); assert.equal(P.ents.length, 3);
  P.ctx.BDOCUndo.undo();                                                // the second file
  assert.equal(P.toasts[P.toasts.length - 1], '↶ Undone: TAK file &quot;two.cot&quot; (3 items)');
  assert.equal(P.ents.length, 2);
  assert.deepEqual(posOf(a), [10, 20]); assert.equal(meta(P, a).sidc, 'SFGPUCI--------'); assert.equal(meta(P, a).label, 'Alpha'); assert.equal(meta(P, a).comment, 'first note');
  assert.equal(labelOf(a), 'Alpha\nINFANTRY');
  assert.deepEqual(posOf(w), [11, 21]); assert.equal(labelOf(w), 'WP 1');
  P.ctx.BDOCUndo.undo();                                                // the first file
  assert.equal(P.ents.length, 0);
  assert.equal(P.ctx.BDOCUndo.canUndo(), false);
});

test('an import whose items are all gone is not an undo step any more; deleting one item deletes one', async () => {
  const P = make();
  const mine = place(P, 1, 1, { designation: 'MINE' });
  await open(P, '<events>' + ev(`uid="A" type="a-f-G-U-C-I" ${T}`, pt(10, 20) + det('Alpha')) + ev(`uid="B" type="a-f-G-U-C-I" ${T}`, pt(11, 21) + det('Bravo')) + '</events>', 'two.cot');
  const [, a, b] = P.ents;
  assert.equal(P.ctx.BDOCUndo.owns(a), true, 'an imported unit is the user\'s to delete');
  assert.equal(P.ctx.BDOCUndo.remove(a), 'Alpha');
  assert.deepEqual(P.ents, [mine, b], 'one deleted, not the whole file');
  P.ctx.BDOCUndo.remove(b);
  P.ctx.BDOCUndo.undo();
  assert.match(P.toasts[P.toasts.length - 1], /^↶ Undone: MINE/, 'the emptied import is skipped');
  assert.equal(P.ents.length, 0);
});

test('2000 events: one pass over the map, and the same file again adds nothing', async () => {
  const P = make();
  const xml = '<events>' + Array.from({ length: 2000 }, (_, i) => ev(`uid="U${i}" type="a-f-G-U-C-I" ${T}`, pt(10 + i / 1000, 20) + det('U' + i))).join('') + '</events>';
  // count the walks over the map instead of timing them: p177 walked it once per event
  let walks = 0;
  P.run('{const _ix=_cotIndex;_cotIndex=function(){_walks.n++;return _ix()}}'.replace('_walks', 'this._walks'), 'count');
  P.ctx._walks = { get n() { return walks; }, set n(v) { walks = v; } };
  let r = await open(P, xml, 'big.cot');
  assert.equal(r.units, 2000); assert.equal(walks, 1);
  r = await open(P, xml, 'big.cot');
  assert.deepEqual([r.units, r.updated], [0, 2000]); assert.equal(walks, 2);
  assert.equal(P.ents.length, 2000);
  // a uid twice in one file after the first copy was placed: the index knows the new item
  const twice = '<events>' + ev(`uid="Z" type="b-m-p-w" time="2026-11-13T10:00:00Z"`, pt(1, 1) + det('one')) + '</events>';
  await open(P, twice); await open(P, twice);
  assert.equal(P.ents.length, 2001);
});

test("BDOC's CASEVAC goes out as TAK's CASEVAC type, and older cards are still read", async () => {
  const P = make();
  assert.equal(P.get('COT_TYPES').casevac, 'b-r-f-h-c', 'ATAK CASEVACMarkerImporter COT_TYPE (BDOC sent b-c-c, which is no TAK type)');
  assert.equal(P.get('COT_TYPES').medevac, 'b-r-f-h-c');
  assert.equal(P.get('COT_TYPES').waypoint, 'b-m-p-w', 'waypoint pointed at the CASEVAC type');
  const K = P.ctx.BDOCCot;
  for (const t of ['b-r-f-h-c', 'b-c-c', 'b-c-c-m']) { assert.equal(K.classify(t), 'marker', t); assert.equal(K.markerStyle(t).kind, 'CASEVAC / MEDEVAC REQUEST', t); }
  // a card as BDOC stores it: placed, exported in full, and read by another BDOC as a CASEVAC
  const card = uid => { const xml = P.ctx.buildCoT({ cotType: 'casevac', uid, lat: 34.5, lon: 69.1, callsign: 'CASEVAC-URGENT', staleMs: 3600000, remarks: '1. 42SWD1234567890', extra: '<_casevac line1="42SWD1234567890" precedence="URGENT" pax="2"/>' });
    P.get('_cotStore').set(uid, xml);
    const e = P.V.entities.add({ position: P.Cesium.Cartesian3.fromDegrees(69.1, 34.5), point: { pixelSize: 10 }, label: { text: 'CASEVAC' }, description: `<button onclick="window._downloadCotXml('${uid}')">EXPORT</button>` });
    P.ctx.attachMeta(e, { label: 'CASEVAC URGENT', type: 'casevac', comment: '' }); P.ctx.battleEntities.push(e); return e; };
  card('BDOC-CASEVAC-1794604810994');
  const evs = events(exported(P));
  assert.equal(evs.length, 1);
  assert.equal(evs[0].type, 'b-r-f-h-c'); assert.match(evs[0].xml, /<_casevac line1="42SWD1234567890"/);
  const other = make();
  const r = await open(other, '<events>' + evs[0].xml + '</events>', 'casevac.cot');
  assert.equal(r.markers, 1, 'p177 skipped BDOC\'s own CASEVAC as "chat, tasking and other non-map messages"');
  assert.equal(meta(other, other.ents[0]).popupSubtitle, 'CASEVAC / MEDEVAC REQUEST');
  // a card stored by an older build (type b-c-c) goes out under the real type
  P.get('_cotStore').set('BDOC-CASEVAC-1794604810994', P.get('_cotStore').get('BDOC-CASEVAC-1794604810994').replace('type="b-r-f-h-c"', 'type="b-c-c"'));
  assert.equal(events(exported(P))[0].type, 'b-r-f-h-c');
});

test('a plan file cannot put events of its own into the TAK export', async () => {
  const forged = '<event version="2.0" uid="k" type="b-r-f-h-c" time="2026-11-13T10:00:00Z" start="2026-11-13T10:00:00Z" stale="2026-11-14T10:00:00Z" how="h-g-i-g-o"><point lat="1" lon="1" hae="0" ce="1" le="1"/><detail/></event>';
  const bad = [
    forged + '<event version="2.0" uid="x" type="t-x-d-d" time="2026-11-13T10:00:00Z" start="2026-11-13T10:00:00Z" stale="2026-11-14T10:00:00Z" how="m-g"><point lat="0" lon="0" hae="0" ce="1" le="1"/><detail><link uid="ANDROID-teammate-1" relation="none" type="none"/></detail></event>',
    forged.replace('type="b-r-f-h-c"', 'type="a-h-G-U-C-I"'),                      // a forged unit
    forged.replace('uid="k"', 'uid="ANDROID-teammate-1"'),                        // someone else's uid
    forged.replace('<detail/>', '<detail><event uid="k" type="b-r-f-h-c"/></detail>'),
    '<!DOCTYPE x [<!ENTITY a "b">]>' + forged, '<?xml version="1.0"?><?pi x?>' + forged, forged + 'trailing text', '<event uid="k" type="b-r-f-h-c">', 'not xml at all', forged.replace('</event>', ''),
    forged + '<!-- -->', 'x'.repeat(20001),
  ];
  for (const xml of bad) {
    const P = make();
    const doc = { format: P.get('BDOCPlan').toDoc().format, version: 1, items: [{ e: { id: 'rally', position: { _t: 'Cartesian3', v: [69.1, 34.5, 0] }, point: { pixelSize: 10 }, label: { text: 'Rally point' },
      description: "Rally point _downloadCotXml('k')", meta: { label: 'Rally point', type: 'tactical', comment: '' }, cot: { uid: 'k', xml } } }] };
    const res = P.ctx.BDOCPlan.importDoc(doc);
    assert.equal(P.ents.length, 1, 'the item itself opens: ' + JSON.stringify(res));
    assert.equal(P.get('_cotStore').has('k'), false, 'nothing is stored for: ' + xml.slice(0, 60));
    const evs = events(exported(P));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].callsign, 'Rally point', 'the export holds what the operator sees, and only that');
    assert.doesNotMatch(exported(P), /t-x-d-d|ANDROID-teammate-1/);
  }
  // text already in the store (an autosave written by an older build) is checked on the way out too
  const P = make();
  const e = P.V.entities.add({ position: P.Cesium.Cartesian3.fromDegrees(69.1, 34.5), point: { pixelSize: 10 }, label: { text: 'Rally point' }, description: "Rally point _downloadCotXml('k')" });
  P.ctx.attachMeta(e, { label: 'Rally point', type: 'tactical', comment: '' }); P.ctx.battleEntities.push(e);
  P.get('_cotStore').set('k', bad[0]);
  const evs = events(exported(P));
  assert.deepEqual(evs.map(x => x.callsign), ['Rally point']);
  // and a real card in a plan file still travels: one event, BDOC's CASEVAC type, the same uid
  const Q = make();
  const good = forged.replace('uid="k"', 'uid="BDOC-CASEVAC-1"');
  Q.ctx.BDOCPlan.importDoc({ format: Q.get('BDOCPlan').toDoc().format, version: 1, items: [{ e: { id: 'c1', position: { _t: 'Cartesian3', v: [69.1, 34.5, 0] }, point: { pixelSize: 10 }, label: { text: 'CASEVAC' },
    description: "x _downloadCotXml('BDOC-CASEVAC-1')", meta: { label: 'CASEVAC', type: 'casevac', comment: '' }, cot: { uid: 'BDOC-CASEVAC-1', xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + good } } }] });
  assert.equal(Q.get('_cotStore').get('BDOC-CASEVAC-1'), good);
  assert.deepEqual(events(exported(Q)).map(x => [x.uid, x.type]), [['BDOC-CASEVAC-1', 'b-r-f-h-c']]);
});

test("a plan file's unit name is plain text: no markup, 40 characters", () => {
  const P = make();
  const doc = { format: P.get('BDOCPlan').toDoc().format, version: 1, items: [{ e: { id: 'u', position: { _t: 'Cartesian3', v: [69.1, 34.5, 0] }, billboard: { image: 'data:image/svg+xml;base64,AAAA' }, label: { text: 'x' },
    meta: { label: 'x', type: 'unit', sidc: 'SFGPUCI--------', iconKey: 'infantry', aff: 'friendly', name: '<img src=x onerror=alert(1)>"\'`&\u202E ' + 'Ж'.repeat(60), designation: 'a<b' } } }] };
  P.ctx.BDOCPlan.importDoc(doc);
  const m = meta(P, P.ents[0]);
  assert.doesNotMatch(m.name, /[<>&"'`\\\u202E]/);
  assert.ok(m.name.length <= 40 && m.name.startsWith('img src=x onerror=alert(1) ЖЖ'), m.name);
  assert.equal(m.designation, 'AB');
  // the page reads it back the same way
  assert.equal(P.ctx._bpStateFromMeta(Object.assign({}, m, { name: '<b>Сокіл</b>' })).name, 'bСокіл/b');
  assert.equal(P.ctx._bpStateFromMeta(Object.assign({}, m, { name: { toString: () => 'x' } })).name, '');
});
