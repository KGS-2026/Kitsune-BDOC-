// p160 — LIVE WIRE client. The feed renders attacker-controlled text on the owner's
// screen and decides whether he sees the word LIVE, so these assert the two things
// that must never regress: nothing from a feed can become markup or a dangerous link,
// and no status claims more than the evidence supports.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'bdoc-wire.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'bdoc-wire.css'), 'utf8');
const page = fs.readFileSync(path.join(root, 'wire.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dev = require('../tools/wire/dev-server.js');

const {
  safeUrl, cleanText, normItem, mergeItems, applyUpdate, filterItems, collapseStories, visibleRows,
  viewCounts, statusLabel, fmtAge, fmtClock, connectionState, bucketStats, sourceState, sortSources,
  stateRows, normWatch, checkTerm, MAX_ITEMS, MAX_ROWS, HB_LIVE_SEC, SNAP_STALE_SEC, SUPABASE_SRI
} = require('../js/bdoc-wire.js');

const NOW = 1793377888000;
const mk = (id, over) => Object.assign({
  id, c: id, t: NOW, pt: NOW, src: 's', sn: 'S', cls: 'wire', h: 'headline ' + id, x: '', u: '',
  cat: [], w: [], sev: 0, st: 'reported', n: 1, fresh: true
}, over);

// ── Banned surfaces ──

test('the file contains none of the banned DOM calls', () => {
  for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'DOMParser',
    'createContextualFragment', 'srcdoc', 'eval(', 'new Function']) {
    assert.ok(!src.includes(banned), banned + ' must not appear in bdoc-wire.js');
  }
});

test('nothing is ever loaded from a feed URL', () => {
  assert.doesNotMatch(src, /createElement\(['"]img|new Image\(|h\('img'|h\('iframe'|h\('video'|h\('audio'/);
});

test('h() refuses href and src, so extLink is the only route to an outbound anchor', () => {
  assert.match(src, /k === 'href' \|\| k === 'src'\) continue/);
  assert.match(src, /function extLink\(url, cls, text\) \{\s+const safe = safeUrl\(url\);/);
});

test('every new-tab link carries rel noopener noreferrer', () => {
  const opens = src.match(/target: '_blank'/g) || [];
  const safe = src.match(/target: '_blank', rel: 'noopener noreferrer'/g) || [];
  assert.ok(opens.length > 0);
  assert.equal(opens.length, safe.length);
});

test('a globe marker is position and point only, with no feed text', () => {
  const start = src.indexOf('st.ds.entities.add({');
  assert.ok(start > 0, 'marker block not found: did it move?');
  const block = src.slice(start, src.indexOf('st.marks.set(c', start));
  assert.doesNotMatch(block, /description|name:|label|billboard|properties|it\.h|it\.x|it\.sn/);
  assert.doesNotMatch(src, /description\s*:/, 'no Cesium description anywhere in this file');
});

test('the file loads under Node without touching document or window', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof window, 'undefined');
  assert.equal(typeof globalThis.BDOCWire, 'undefined');
  assert.equal(typeof safeUrl, 'function');
});

test('the production module knows nothing about the dev harness', () => {
  assert.doesNotMatch(src, /__wire|127.0.0.1/);
});

test('limits match the spec', () => {
  assert.equal(MAX_ITEMS, 2000);
  assert.equal(MAX_ROWS, 400);
  assert.equal(HB_LIVE_SEC, 45);
  assert.equal(SNAP_STALE_SEC, 300);
});

// ── safeUrl ──

test('safeUrl keeps http and https', () => {
  assert.equal(safeUrl('https://www.reuters.com/world/a?b=1#c'), 'https://www.reuters.com/world/a?b=1#c');
  assert.equal(safeUrl('http://example.com/'), 'http://example.com/');
  assert.equal(safeUrl('  https://example.com/x  '), 'https://example.com/x');
  assert.equal(safeUrl('HTTPS://EXAMPLE.COM/'), 'https://example.com/');
});

test('safeUrl rejects javascript:, data:, vbscript: and relative junk', () => {
  const bad = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\nscript:alert(1)',
    'java\tscript:alert(1)', 'jav&#x09;ascript:alert(1)', '\u0001javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'DATA:text/html;base64,AAAA',
    'vbscript:msgbox(1)', 'VBScript:msgbox(1)', 'file:///etc/passwd', 'blob:https://a.test/1', 'ftp://example.com/x',
    '//evil.example/phish', '/relative/path', 'relative/path', './x', '../x', '?q=1', '#frag', 'example.com',
    'http:evil.example', 'https:/evil.example', 'https:///evil.example', 'https:\\\\evil.example', 'http://',
    'https://bbc.com@evil.example/', 'https://user:pw@example.com/', '', '   '
  ];
  for (const u of bad) assert.equal(safeUrl(u), '', 'must reject: ' + JSON.stringify(u));
});

test('safeUrl rejects non-strings and oversized input', () => {
  for (const u of [null, undefined, 0, 1, true, {}, [], ['https://a.test']]) assert.equal(safeUrl(u), '');
  assert.equal(safeUrl('https://example.com/' + 'a'.repeat(3000)), '');
});

// ── normItem and cleanText ──

test('cleanText removes bidi overrides and controls, collapses space and clamps', () => {
  assert.equal(cleanText('\u202eabc', 50), 'abc');
  assert.equal(cleanText('a\u200bb', 50), 'ab');
  assert.equal(cleanText('  a\n\t b  ', 50), 'a b');
  assert.equal(cleanText('x'.repeat(10), 5), 'xxxx…');
  assert.equal(cleanText(42, 5), '');
});

test('normItem leaves hostile text as literal text and strips hostile URLs', () => {
  const it = normItem(mk('aaaaaaaaaaaaaaaa', { h: '<img src=x onerror=alert(1)> hi', u: 'javascript:alert(1)' }), NOW);
  assert.equal(it.h, '<img src=x onerror=alert(1)> hi');
  assert.equal(it.u, '');
});

test('normItem drops what it cannot trust and defaults to the least trusted status', () => {
  for (const raw of [null, 'x', 7, {}, mk('<img>'), mk('a', { h: '' }), mk('a', { t: 'soon' }), mk('a', { t: -1 })]) {
    assert.equal(normItem(raw, NOW), null);
  }
  const bad = normItem(mk('a', { st: 'constructor', cls: '__proto__', sev: 99, n: -5, cat: 'x', w: 7 }), NOW);
  assert.equal(bad.st, 'unverified');
  assert.equal(bad.cls, 'unknown');
  assert.equal(bad.sev, 1, 'unverified caps at sev 1 even with a forged sev');
  assert.equal(bad.n, 1);
  assert.deepEqual(bad.cat, []);
  assert.deepEqual(bad.w, []);
});

test('normItem keeps future stamps off the top of the feed and clamps pt to t', () => {
  const it = normItem(mk('a', { t: NOW + 864e7, pt: NOW + 864e8 }), NOW);
  assert.ok(it.t <= NOW + 60000);
  assert.ok(it.pt <= it.t);
  assert.equal(normItem(mk('a', { pt: null }), NOW).pt, null);
});

test('normItem refuses coordinates that are not real', () => {
  const geo = g => normItem(mk('a', { geo: g }), NOW).geo;
  assert.equal(geo({ lat: 'NaN', lon: 9999 }), undefined);
  assert.equal(geo({ lat: 91, lon: 0 }), undefined);
  assert.equal(geo({ lat: 0, lon: 181 }), undefined);
  assert.equal(geo({ lat: null, lon: null }), undefined, 'a null must not become null island');
  assert.deepEqual(geo({ p: 'Long Beach, CA', lat: 33.77, lon: -118.19, r: 15000, cc: 'US' }),
    { p: 'Long Beach, CA', lat: 33.77, lon: -118.19, r: 15000, cc: 'US' });
});

test('normItem drops category tags that are not plain words and keeps watch hits as text', () => {
  const it = normItem(mk('a', { cat: ['"><img src=x>', 'election', 'election'], w: ['NOV4', 'custom:Long Beach'] }), NOW);
  assert.deepEqual(it.cat, ['election']);
  assert.deepEqual(it.w, ['nov4', 'custom:long beach']);
});

// ── mergeItems ──

test('mergeItems is idempotent', () => {
  const batch = [mk('a', { t: NOW - 1 }), mk('b', { t: NOW - 2 }), mk('c', { t: NOW - 3 })];
  const once = mergeItems([], batch);
  const twice = mergeItems(once, batch);
  const thrice = mergeItems(twice, [...batch, ...batch]);
  assert.equal(once.length, 3);
  assert.deepEqual(twice, once);
  assert.deepEqual(thrice, once);
});

test('mergeItems keeps object identity when nothing changed, because the renderer uses it as a dirty check', () => {
  const a = mk('a');
  const out = mergeItems([a], [Object.assign({}, a)]);
  assert.strictEqual(out[0], a);
});

test('mergeItems caps at 2000 and keeps the newest', () => {
  const many = Array.from({ length: 2500 }, (_, i) => mk('i' + i, { t: NOW + i }));
  const out = mergeItems([], many);
  assert.equal(out.length, 2000);
  assert.equal(out[0].id, 'i2499');
  assert.equal(out[1999].id, 'i500');
  assert.equal(mergeItems(out, [mk('new', { t: NOW + 9999 })]).length, 2000);
  assert.equal(mergeItems([], many, 10).length, 10);
});

test('mergeItems sorts newest first and is stable on equal times', () => {
  const out = mergeItems([mk('b', { t: 5 })], [mk('a', { t: 5 }), mk('c', { t: 9 })]);
  assert.deepEqual(out.map(i => i.id), ['c', 'a', 'b']);
});

test('mergeItems takes the newer status but never loses publishers or moves a row in time', () => {
  const live = mk('a', { t: 100, st: 'corroborated', n: 4 });
  const [out] = mergeItems([live], [mk('a', { t: 200, st: 'disputed', n: 2 })]);
  assert.equal(out.st, 'disputed');
  assert.equal(out.n, 4);
  assert.equal(out.t, 100);
});

test('mergeItems skips rows with no id instead of throwing', () => {
  assert.equal(mergeItems(null, [null, {}, mk('a')]).length, 1);
});

// ── applyUpdate ──

test('applyUpdate changes status and n across a cluster', () => {
  const items = [mk('a', { c: 'k' }), mk('b', { c: 'k', st: 'unverified', sev: 1 }), mk('c', { c: 'other' })];
  const out = applyUpdate(items, [{ c: 'k', st: 'corroborated', n: 3, sev: 2 }]);
  assert.deepEqual(out.filter(i => i.c === 'k').map(i => [i.st, i.n, i.sev]), [['corroborated', 3, 2], ['corroborated', 3, 2]]);
  assert.strictEqual(out[2], items[2], 'other stories keep identity');
  assert.equal(items[0].st, 'reported', 'the input is not mutated');
});

test('applyUpdate returns the same array when nothing changed', () => {
  const items = [mk('a')];
  assert.strictEqual(applyUpdate(items, []), items);
  assert.strictEqual(applyUpdate(items, null), items);
  assert.strictEqual(applyUpdate(items, [{ c: 'nope', st: 'official', n: 2, sev: 1 }]), items);
  assert.strictEqual(applyUpdate(items, [{ c: 'a', st: 'reported', n: 1, sev: 0 }]), items);
});

test('applyUpdate cannot promote a rumor past the ladder and ignores unknown statuses', () => {
  const items = [mk('a', { st: 'reported' })];
  assert.equal(applyUpdate(items, [{ c: 'a', st: 'unverified', n: 1, sev: 3 }])[0].sev, 1);
  assert.equal(applyUpdate(items, [{ c: 'a', st: 'bogus', n: 2, sev: 1 }])[0].st, 'reported');
});

// ── filterItems ──

const FEED = [
  mk('wire-0', { cls: 'wire', sev: 0 }),
  mk('wire-1', { cls: 'wire', sev: 1, cat: ['election'] }),
  mk('wire-3', { cls: 'wire', sev: 3, cat: ['infra'], st: 'corroborated' }),
  mk('watch', { cls: 'aggregator', sev: 0, w: ['custom:long beach'] }),
  mk('osint-1', { cls: 'osint', sev: 1, st: 'unverified', cat: ['rumor'], w: ['nov4'] }),
  mk('social-0', { cls: 'social', sev: 0, st: 'unverified' }),
  mk('off-0', { cls: 'official', sev: 0, st: 'official' }),
  mk('off-2', { cls: 'official', sev: 2, st: 'official' }),
  mk('wire-off', { cls: 'wire', sev: 1, st: 'official' })
];
const ids = rows => rows.map(r => r.id).sort();

test('SIGNAL is sev 1 and up or any watch hit', () => {
  assert.deepEqual(ids(filterItems(FEED, { view: 'signal' })), ['off-2', 'osint-1', 'watch', 'wire-1', 'wire-3', 'wire-off'].sort());
});

test('an unknown view falls back to SIGNAL, the safe default', () => {
  assert.deepEqual(filterItems(FEED, { view: 'constructor' }), filterItems(FEED, { view: 'signal' }));
  assert.deepEqual(filterItems(FEED), filterItems(FEED, { view: 'signal' }));
});

test('CHATTER is osint and social, with sev 0 hidden by default and reachable with SEV ANY', () => {
  assert.deepEqual(ids(filterItems(FEED, { view: 'chatter' })), ['osint-1']);
  assert.deepEqual(ids(filterItems(FEED, { view: 'chatter', minSev: 0 })), ['osint-1', 'social-0']);
});

test('OFFICIAL holds official sources and any row labelled OFFICIAL', () => {
  assert.deepEqual(ids(filterItems(FEED, { view: 'official' })), ['off-2', 'wire-off']);
  assert.deepEqual(ids(filterItems(FEED, { view: 'official', minSev: 0 })), ['off-0', 'off-2', 'wire-off']);
});

test('ALL shows everything, so sev 0 stays reachable', () => {
  assert.equal(filterItems(FEED, { view: 'all' }).length, FEED.length);
});

test('SEV ANY cannot widen SIGNAL past its definition', () => {
  assert.deepEqual(ids(filterItems(FEED, { view: 'signal', minSev: 0 })), ids(filterItems(FEED, { view: 'signal' })));
});

test('min severity raises the floor in any view', () => {
  assert.deepEqual(ids(filterItems(FEED, { view: 'all', minSev: 2 })), ['off-2', 'wire-3']);
  assert.deepEqual(ids(filterItems(FEED, { view: 'signal', minSev: 3 })), ['wire-3']);
});

test('category filters match categories and watch hits, as an OR', () => {
  assert.deepEqual(ids(filterItems(FEED, { view: 'all', cats: ['election', 'infra'] })), ['wire-1', 'wire-3']);
  assert.deepEqual(ids(filterItems(FEED, { view: 'all', cats: new Set(['nov4']) })), ['osint-1']);
  assert.deepEqual(ids(filterItems(FEED, { view: 'all', cats: ['custom:long beach'] })), ['watch']);
  assert.equal(filterItems(FEED, { view: 'all', cats: [] }).length, FEED.length);
});

test('search is case-insensitive, needs every word, and reaches source and place', () => {
  const feed = [mk('a', { h: 'Port strike in Long Beach', sn: 'Reuters' }), mk('b', { h: 'Other', geo: { p: 'Detroit, MI', lat: 1, lon: 1 } })];
  assert.deepEqual(ids(filterItems(feed, { view: 'all', q: 'PORT beach' })), ['a']);
  assert.deepEqual(ids(filterItems(feed, { view: 'all', q: 'port detroit' })), []);
  assert.deepEqual(ids(filterItems(feed, { view: 'all', q: 'reuters' })), ['a']);
  assert.deepEqual(ids(filterItems(feed, { view: 'all', q: 'detroit' })), ['b']);
  assert.equal(filterItems(feed, { view: 'all', q: '   ' }).length, 2);
});

test('filtering 2000 items takes well under a frame', () => {
  const many = Array.from({ length: 2000 }, (_, i) => mk('i' + i, { sev: i % 4, h: 'headline number ' + i, cat: ['election'] }));
  filterItems(many, { view: 'all', q: 'seed the cache' });
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) visibleRows(many, { view: 'signal', q: 'number', cats: ['election'] });
  const each = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  assert.ok(each < 16, 'one filter pass took ' + each.toFixed(2) + ' ms');
});

// ── Stories ──

test('collapseStories gives one row per story, fronted by the strongest source', () => {
  const rows = collapseStories([
    mk('post', { c: 'k', cls: 'social', t: 300, st: 'corroborated' }),
    mk('wire', { c: 'k', cls: 'wire', t: 200, st: 'corroborated' }),
    mk('aggr', { c: 'k', cls: 'aggregator', t: 100, st: 'corroborated' }),
    mk('solo', { t: 250 })
  ]);
  assert.deepEqual(rows.map(r => r.id), ['solo', 'wire']);
});

test('collapseStories lets fresh reporting from an equal source move the story up', () => {
  const rows = collapseStories([mk('new', { c: 'k', t: 300 }), mk('old', { c: 'k', t: 100 })]);
  assert.deepEqual(rows.map(r => r.id), ['new']);
});

test('ALL does not collapse, the other views do, and counts follow', () => {
  const feed = [mk('a', { c: 'k', sev: 1 }), mk('b', { c: 'k', sev: 1 }), mk('c', { sev: 1 })];
  assert.equal(visibleRows(feed, { view: 'signal' }).length, 2);
  assert.equal(visibleRows(feed, { view: 'all' }).length, 3);
  assert.deepEqual(viewCounts(feed), { signal: 2, chatter: 0, official: 0, all: 3 });
});

// ── Connection state ──

const conn = over => connectionState(Object.assign({ now: NOW, startedAt: NOW - 600000, snapAgeSec: 30, pathDown: false }, over));

test('connectionState transitions at 45 s', () => {
  assert.equal(conn({ lastHb: NOW }).state, 'live');
  assert.equal(conn({ lastHb: NOW - 44999 }).state, 'live');
  assert.equal(conn({ lastHb: NOW - 45000 }).state, 'live', 'exactly 45 s is still within 45 s');
  assert.equal(conn({ lastHb: NOW - 45001 }).state, 'degraded');
});

test('a fresh snapshot alone never earns LIVE', () => {
  assert.equal(conn({ lastHb: 0, snapAgeSec: 1 }).state, 'degraded');
});

test('no heartbeat and no fresh snapshot is COLLECTOR OFFLINE', () => {
  assert.equal(conn({ lastHb: NOW - 60000, snapAgeSec: 300 }).state, 'degraded');
  assert.equal(conn({ lastHb: NOW - 60000, snapAgeSec: 301 }).state, 'offline');
  assert.equal(conn({ lastHb: 0, snapAgeSec: null }).state, 'offline');
});

test('a dead data path is not blamed on the collector', () => {
  assert.equal(conn({ lastHb: NOW - 60000, pathDown: true }).state, 'unreachable');
  assert.equal(conn({ lastHb: NOW - 1000, pathDown: true }).state, 'live', 'a heartbeat beats a failed poll');
});

test('connecting only lasts through the first-heartbeat grace window', () => {
  assert.equal(conn({ lastHb: 0, startedAt: NOW - 5000 }).state, 'connecting');
  assert.equal(conn({ lastHb: 0, startedAt: NOW - 20000 }).state, 'degraded');
  assert.equal(conn({ lastHb: NOW - 60000, startedAt: NOW - 5000 }).state, 'degraded');
});

test('connectionState reports the ages it used', () => {
  const c = conn({ lastHb: NOW - 90000, snapAgeSec: 120 });
  assert.equal(c.hbAge, 90);
  assert.equal(c.snapAge, 120);
  assert.equal(conn({ lastHb: 0 }).hbAge, null);
  assert.equal(conn({ lastHb: NOW + 5000 }).hbAge, 0, 'clock skew cannot produce a negative age');
});

// ── Labels and formats ──

test('fmtAge edge cases', () => {
  assert.equal(fmtAge(0), '0s');
  assert.equal(fmtAge(0.4), '0s');
  assert.equal(fmtAge(59.9), '59s');
  assert.equal(fmtAge(60), '1m');
  assert.equal(fmtAge(3599), '59m');
  assert.equal(fmtAge(3600), '1h');
  assert.equal(fmtAge(86399), '23h');
  assert.equal(fmtAge(86400), '1d');
  assert.equal(fmtAge(864000), '10d');
  assert.equal(fmtAge(-5), '0s', 'clock skew reads as now');
  for (const v of [null, undefined, NaN, Infinity, -Infinity, '12', {}]) assert.equal(fmtAge(v), '—');
});

test('fmtClock prints Zulu and survives a bad stamp', () => {
  assert.equal(fmtClock(Date.UTC(2026, 10, 3, 4, 5, 6)), '04:05:06Z');
  assert.equal(fmtClock(NaN), '--:--:--Z');
});

test('statusLabel spells out both vocabularies', () => {
  assert.equal(statusLabel('unverified'), 'UNVERIFIED');
  assert.equal(statusLabel('disputed'), 'DISPUTED');
  assert.equal(statusLabel('offline'), 'COLLECTOR OFFLINE');
  assert.equal(statusLabel('degraded'), 'DEGRADED');
  assert.equal(statusLabel('live'), 'LIVE');
  assert.equal(statusLabel('nonsense'), 'UNKNOWN');
  assert.equal(statusLabel('constructor'), 'UNKNOWN');
});

test('bucketStats uses the last 5 minutes and needs a real surge to call one', () => {
  const quiet = Array(60).fill(1);
  assert.equal(bucketStats(quiet).rate, 1);
  assert.equal(bucketStats(quiet).total, 60);
  assert.equal(bucketStats(quiet).surge, false);
  assert.equal(bucketStats(Array(55).fill(0).concat([4, 4, 4, 4, 4])).surge, true);
  assert.equal(bucketStats(Array(55).fill(0).concat([0, 0, 0, 0, 1])).surge, false, 'one stray item is not a surge');
  assert.deepEqual(bucketStats(null), { series: [], rate: 0, total: 0, surge: false });
  assert.deepEqual(bucketStats([1, 'x', -2, null, 3]).series, [1, 0, 0, 0, 3]);
  assert.equal(bucketStats(Array(100).fill(1)).series.length, 60);
});

test('source health follows the collector, so a quiet feed stays healthy', () => {
  assert.equal(sourceState({ ok: true, newest: NOW - 90 * 864e5 }), 'ok');
  assert.equal(sourceState({ ok: false, stale: true, err: 'stale' }), 'stale');
  assert.equal(sourceState({ ok: false, err: 'stale' }), 'stale', 'still stale if a snapshot drops the boolean');
  assert.equal(sourceState({ ok: false, lastOk: 5, lastErr: 9, err: 'HTTP 500' }), 'down');
  assert.equal(sourceState({ ok: false, lastOk: null, lastErr: null }), 'pending');
  assert.equal(sourceState(null), 'down');
});

test('dead sources sort first, then stale, then not yet polled, then healthy', () => {
  const sorted = sortSources([
    { id: 'c', n: 'C', ok: true },
    { id: 'p', n: 'P', ok: false, lastOk: null, lastErr: null },
    { id: 's', n: 'S', ok: false, stale: true },
    { id: 'd1', n: 'D1', ok: false, fails: 1, lastOk: 1, lastErr: 2 },
    { id: 'd2', n: 'D2', ok: false, fails: 9, lastOk: 1, lastErr: 2 },
    null
  ]);
  assert.deepEqual(sorted.map(s => s.id), ['d2', 'd1', 's', 'p', 'c']);
  assert.deepEqual(sortSources(undefined), []);
});

const GOOD_STATE = {
  ntas: { active: false, title: null },
  faa: { stops: 0, delays: 0, closures: 0, updated: NOW },
  nws: { extreme: 0, severe: 0, civil: 0 },
  usgs: { m6p24h: 0 }
};

test('an all-clear has to be earned: junk and partial data read NO DATA, never zero', () => {
  const words = o => stateRows(o, []).map(r => r.v);
  assert.deepEqual(words(GOOD_STATE), ['NO ACTIVE ADVISORY', '0 STOPS · 0 DELAYS · 0 CLOSURES', '0 EXTREME · 0 SEVERE · 0 CIVIL', '0 M6+ IN 24H']);
  for (const bad of [null, undefined, 5, 'x', {}, { ntas: 'x', faa: 7, nws: null, usgs: [] }, { ntas: {}, faa: {}, nws: { extreme: 1 }, usgs: { m6p24h: 'many' } }]) {
    assert.deepEqual(words(bad), ['NO DATA', 'NO DATA', 'NO DATA', 'NO DATA'], JSON.stringify(bad));
    assert.ok(stateRows(bad, []).every(r => r.tone === 'none'), 'no coloured dot without data');
  }
});

test('a feed that is down or stale cannot vouch for its last value', () => {
  const rows = stateRows(GOOD_STATE, [
    { id: 'ntas', ok: false, lastOk: 1, lastErr: 2 },
    { id: 'faa', ok: false, stale: true },
    { id: 'nws', ok: false, lastOk: null, lastErr: null },
    { id: 'usgs', ok: true }
  ]);
  assert.equal(rows[0].v, 'FEED DOWN, STATE UNKNOWN');
  assert.equal(rows[1].v, 'FEED STALE, STATE UNKNOWN');
  assert.equal(rows[2].v, '0 EXTREME · 0 SEVERE · 0 CIVIL', 'a pending feed with a value keeps it');
  assert.equal(rows[3].tone, 'ok');
  assert.equal(stateRows({}, [{ id: 'ntas', ok: false, lastOk: null, lastErr: null }])[0].v, 'NOT POLLED YET');
});

test('state tones follow the numbers', () => {
  const tone = o => stateRows(Object.assign({}, GOOD_STATE, o), []).map(r => r.tone);
  assert.deepEqual(tone({}), ['ok', 'ok', 'ok', 'ok']);
  assert.equal(tone({ ntas: { active: true, title: 'x' } })[0], 'crit');
  assert.equal(tone({ faa: { stops: 1, delays: 0, closures: 0 } })[1], 'crit');
  assert.equal(tone({ faa: { stops: 0, delays: 2, closures: 0 } })[1], 'warn');
  assert.equal(tone({ nws: { extreme: 0, severe: 0, civil: 1 } })[2], 'crit');
  assert.equal(tone({ nws: { extreme: 0, severe: 3, civil: 0 } })[2], 'warn');
  assert.equal(tone({ usgs: { m6p24h: 1 } })[3], 'warn');
});

test('watch terms: both response shapes parse, and the client rule follows the server rule', () => {
  assert.deepEqual(normWatch(['a', 'long beach', 'Long Beach', '\u0007x']), ['long beach']);
  assert.deepEqual(normWatch({ terms: ['aa'] }), ['aa']);
  assert.deepEqual(normWatch(null), []);
  assert.equal(normWatch(Array.from({ length: 60 }, (_, i) => 'term' + i)).length, 40);
  assert.ok(checkTerm('a', []).error);
  assert.ok(checkTerm('x'.repeat(65), []).error);
  assert.ok(checkTerm('aa', ['AA']).error);
  assert.ok(checkTerm('aa', Array(40).fill('t')).error);
  assert.deepEqual(checkTerm('  long  beach ', []), { term: 'long beach' });
});

// ── wire.html ──

test('wire.html loads the exact pinned Supabase tag from index.html', () => {
  const re = /<script[^>]*supabase-js@[^>]*><\/script>/;
  const fromApp = app.match(re);
  const fromPage = page.match(re);
  assert.ok(fromApp && fromPage);
  assert.equal(fromPage[0], fromApp[0]);
  assert.ok(fromPage[0].includes(SUPABASE_SRI), 'the fallback in bdoc-wire.js must use the same hash');
  assert.ok(src.includes(fromPage[0].match(/@supabase\/supabase-js@[\d.]+/)[0]), 'the fallback must pin the same version');
});

test('wire.html has no inline script, handler or style', () => {
  assert.match(page, /<html lang="en" data-wire-page>/);
  const tags = page.match(/<script\b[^>]*>/g) || [];
  assert.ok(tags.length >= 2);
  for (const t of tags) assert.match(t, /\ssrc=/, 'inline script: ' + t);
  assert.doesNotMatch(page, /<script\b[^>]*>[^<]/);
  assert.doesNotMatch(page, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(page, /\sstyle\s*=/i);
  assert.doesNotMatch(page, /<style\b/i);
});

test('wire.html stays out of search engines and busts the immutable /js cache', () => {
  assert.match(page, /name="robots" content="noindex/);
  assert.match(page, /\/js\/bdoc-wire\.js\?v=/);
  assert.match(page, /\/css\/bdoc-wire\.css\?v=/);
});

// ── Design rules that are cheap to enforce here ──

test('css has no glow, glass or gradient', () => {
  assert.doesNotMatch(css, /backdrop-filter|text-shadow|linear-gradient|radial-gradient|filter:\s*blur/);
  for (const [decl] of css.matchAll(/box-shadow:[^;}]+/g)) assert.match(decl, /inset/, 'only hollow dots may use box-shadow: ' + decl);
});

test('css respects the 2-3 px radius and 10 px minimum text size', () => {
  for (const [, v] of css.matchAll(/border-radius:([^;}]+)/g)) {
    if (v.trim() === '50%') continue;
    for (const px of v.match(/\d+(?:\.\d+)?px/g) || []) assert.ok(parseFloat(px) <= 3, 'radius too large: ' + v);
  }
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g), ...css.matchAll(/\bfont:\s*\d+\s+([\d.]+)px/g)];
  assert.ok(sizes.length > 20);
  for (const [, px] of sizes) assert.ok(parseFloat(px) >= 10, 'text below 10px: ' + px);
});

test('css honors reduced motion and caps the panel at the spec width', () => {
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.bw-panel\{[^}]*width:560px/);
  assert.match(css, /z-index:10500/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) 320px/);
});

// ── Harness ──

test('requiring the dev server does not start it, and it swaps only the Supabase tag', () => {
  assert.ok(dev.MODES.includes('live') && dev.MODES.includes('offline') && dev.MODES.includes('nonowner') && dev.MODES.includes('signedout'));
  const out = dev.rewriteWireHtml(page);
  assert.doesNotMatch(out, /supabase-js/);
  assert.match(out, /\/__wire\/shim\.js/);
  assert.equal(out.length > 0, true);
});

test('the fixture covers every status, severity, class and geo case', () => {
  const items = dev.fixtureItems(NOW).map(r => normItem(r, NOW)).filter(Boolean);
  const set = k => new Set(items.map(i => i[k]));
  for (const st of ['official', 'corroborated', 'reported', 'unverified', 'disputed']) assert.ok(set('st').has(st), st);
  for (const sev of [0, 1, 2, 3]) assert.ok(set('sev').has(sev), 'sev ' + sev);
  for (const cls of ['official', 'wire', 'specialist', 'aggregator', 'factcheck', 'osint', 'social', 'signal']) assert.ok(set('cls').has(cls), cls);
  assert.ok(items.some(i => i.geo));
  assert.ok(items.some(i => !i.geo));
  assert.ok(items.some(i => i.w.some(w => w.startsWith('custom:'))));
  assert.ok(items.some(i => i.n > 1));
});

test('hostile fixture rows cannot produce a link, and rows that fail validation are dropped', () => {
  const raw = dev.hostileItems(NOW);
  const kept = raw.map(r => normItem(r, NOW)).filter(Boolean);
  assert.ok(kept.length < raw.length, 'the bad-id, no-headline and non-object rows must be dropped');
  for (const it of kept) assert.equal(it.u.includes('example.com') || it.u === '', true, it.h + ' -> ' + it.u);
  for (const needle of ['onerror', 'vbscript', 'Protocol-relative', 'Mixed-case', 'Newline-split', 'Userinfo']) {
    const it = kept.find(i => i.h.includes(needle));
    assert.ok(it, 'fixture row missing: ' + needle);
    assert.equal(it.u, '', needle + ' must lose its URL');
  }
  const enums = kept.find(i => i.h.startsWith('Bad enums'));
  assert.equal(enums.st, 'unverified');
  assert.equal(enums.sev, 1);
  const future = kept.find(i => i.h.startsWith('Stamped 100 days'));
  assert.ok(future.t <= NOW + 60000);
});

// ── Contract with the other p160 pieces. These run against their real code, so a change
//    to a shape on either side fails here instead of on election night. ──

test('a real Scheduler source that has never been polled reads as pending, not dead', () => {
  const { Scheduler } = require('../tools/wire/lib/fetcher.js');
  const sched = new Scheduler({
    sources: [{ id: 'x', name: 'X', cls: 'wire', kind: 'rss', url: 'https://example.com/rss', every: 60 }],
    onItems() {}, isFirstPoll: () => false, markPolled() {}
  });
  const [row] = sched.health();
  assert.equal(sourceState(row), 'pending');
  for (const k of ['id', 'n', 'cls', 'ok', 'lastOk', 'lastErr', 'err', 'newest', 'c1h', 'fails']) assert.ok(k in row, 'health row lost ' + k);
});

test('the function and the client agree on watch terms', async () => {
  const { cleanTerms, TERM_MIN_CHARS, TERM_MAX_CHARS, MAX_TERMS } = await import('../netlify/functions/_lib/wire-core.mjs');
  assert.deepEqual([TERM_MIN_CHARS, TERM_MAX_CHARS, MAX_TERMS], [2, 64, 40]);
  for (const raw of ['a', 'ok', 'long beach', 'x'.repeat(64), 'x'.repeat(65), '  spaced   out  ']) {
    const server = cleanTerms([raw]);
    const client = checkTerm(raw, []);
    assert.equal(!!server.error, !!client.error, 'disagree on ' + JSON.stringify(raw));
    if (!server.error) assert.equal(client.term, server.terms[0]);
  }
  assert.deepEqual(normWatch(cleanTerms(['Long Beach', 'long beach', 'Detroit']).terms), ['Long Beach', 'Detroit']);
});

test('the real classifier watch tag survives normItem and the custom filter', () => {
  const classify = require('../tools/wire/lib/classify.js');
  classify.setCustomTerms(['Long Beach']);
  try {
    const { w } = classify.classify({ h: 'Long Beach council delays waterfront vote', x: '', cls: 'wire' });
    const it = normItem(mk('a', { w }), NOW);
    assert.ok(filterItems([it], { view: 'all', cats: ['custom:long beach'] }).length === 1, 'tag was ' + JSON.stringify(w));
  } finally {
    classify.setCustomTerms([]);
  }
});
