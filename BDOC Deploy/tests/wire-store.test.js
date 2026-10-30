// LIVE WIRE persistence tests. node --test tests/wire-store.test.js
// Spec ground rule 5: a restart must not page anyone, so what the store remembers is a
// safety property. These open real database files and reopen them. They skip cleanly on
// Node 20, which has no node:sqlite: CI still covers the MemoryStore half of the API.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const lib = path.join(__dirname, '..', 'tools', 'wire', 'lib');
const { SqliteStore, MemoryStore, SeenSet, openStore } = require(path.join(lib, 'store.js'));
const { Pipeline } = require(path.join(lib, 'pipeline.js'));

let sqliteError = null;
try { require('node:sqlite'); } catch (e) { sqliteError = e; }
const needsSqlite = sqliteError ? { skip: 'node:sqlite not available on Node ' + process.version } : {};

const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
const DAY = 24 * 3600e3;

function tmpFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wire-store-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* Windows file locks */ } });
  return path.join(dir, 'deep', 'wire.db');
}

function open(file, now) {
  return new SqliteStore({ file, now: () => (now === undefined ? NOW : now) }).open();
}

const item = (id, o) => Object.assign({ id, c: id, t: NOW, pt: NOW, src: 's', sn: 'S', cls: 'wire', h: 'Headline ' + id, x: '', u: '', cat: [], w: [], sev: 1, st: 'reported', n: 1, fresh: true }, o);

function quiet(fn) {
  const orig = process.stdout.write;
  process.stdout.write = () => true;
  try { return fn(); } finally { process.stdout.write = orig; }
}

// ── MemoryStore: runs everywhere, including CI ────────────────────────────────
test('MemoryStore has the same memory as the real one for a single process', () => {
  const s = new MemoryStore();
  assert.equal(s.hasSeen('a'), false);
  s.markSeen('a', NOW);
  assert.equal(s.hasSeen('a'), true);
  assert.equal(s.isPolled('src'), false);
  s.markPolled('src');
  assert.equal(s.isPolled('src'), true);
  s.set('k', { v: 1 });
  assert.deepEqual(s.get('k'), { v: 1 });
  assert.equal(s.get('missing'), null);
  assert.equal(s.stats().durable, false);
});

test('SeenSet stays bounded and still answers for the previous generation', () => {
  const s = new SeenSet();
  for (let i = 0; i < 300001; i++) s.add('id' + i);
  assert.ok(s.has('id0'), 'previous generation');
  assert.ok(s.has('id300000'), 'current generation');
  for (let i = 0; i < 300000; i++) s.add('x' + i);
  assert.ok(!s.has('id0'), 'two generations back is gone from memory');
  assert.ok(s.size <= 600000);
});

test('openStore falls back to memory rather than going dark', () => {
  const s = quiet(() => openStore({ file: path.join(__filename, 'not', 'a', 'dir', 'wire.db') }));
  assert.equal(s.durable, false);
  assert.ok(s.stats().reason);
  s.markSeen('a');
  assert.equal(s.hasSeen('a'), true);
});

// ── SQLite ────────────────────────────────────────────────────────────────────
test('opens in WAL mode and creates its directory', needsSqlite, (t) => {
  const file = tmpFile(t);
  const s = open(file);
  const mode = s.db.prepare('PRAGMA journal_mode').get();
  s.close();
  assert.equal(mode.journal_mode, 'wal');
  assert.ok(fs.existsSync(file));
});

test('dedupe survives a restart, from memory and from disk', needsSqlite, (t) => {
  const file = tmpFile(t);
  const a = open(file);
  a.markSeen('old-id', NOW - 5 * DAY);     // past the in-memory restore window
  a.markSeen('new-id', NOW);
  a.close();

  const b = open(file);
  b.restore();
  assert.equal(b.seen.has('new-id'), true, 'restored into memory');
  assert.equal(b.seen.has('old-id'), false, 'not in memory');
  assert.equal(b.hasSeen('old-id'), true, 'found on disk');
  assert.equal(b.hasSeen('never'), false);
  b.close();
});

test('a batch is written in one transaction on flush, not per call', needsSqlite, (t) => {
  const s = open(tmpFile(t));
  s.markSeen('a', NOW);
  s.saveItem(item('a'));
  const count = () => s.db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  assert.equal(count(), 0, 'nothing on disk yet');
  assert.ok(s.flush() >= 2);
  assert.equal(count(), 1);
  assert.equal(s.flush(), 0, 'an empty flush is a no-op');
  s.close();
});

test('a large batch flushes itself without waiting for the timer', needsSqlite, async (t) => {
  const s = new SqliteStore({ file: tmpFile(t), now: () => NOW, batchMax: 10 }).open();
  for (let i = 0; i < 12; i++) s.markSeen('id' + i, NOW);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.pending, 0);
  s.close();
});

test('restore brings back items, clusters, polled sources, page times and kv', needsSqlite, (t) => {
  const file = tmpFile(t);
  const a = open(file);
  a.saveItem(item('i1', { c: 'c1', t: NOW - 1000 }));
  a.saveItem(item('i2', { c: 'c1', t: NOW - 500 }));
  a.saveCluster({ id: 'c1', tLast: NOW - 500, members: [], paged: true });
  a.markPolled('bbc-us', NOW);
  a.recordPage('c1', NOW - 60000);
  a.recordPage('c-old', NOW - 2 * DAY);
  a.set('jetstream.cursor', 26605979634);
  a.set('watch', ['Long Beach']);
  a.close();

  const b = open(file);
  const r = b.restore();
  assert.deepEqual(r.items.map(i => i.id), ['i1', 'i2'], 'oldest first');
  assert.equal(r.clusters.length, 1);
  assert.equal(r.clusters[0].paged, true);
  assert.deepEqual(r.pageTimes, [NOW - 60000], 'only the last day counts toward the rate limit');
  assert.equal(b.isPolled('bbc-us'), true);
  assert.equal(b.isPolled('never-polled'), false);
  assert.equal(b.get('jetstream.cursor'), 26605979634);
  assert.deepEqual(b.get('watch'), ['Long Beach']);
  b.close();
});

test('a story update rewrites its items, and restore shows the update', needsSqlite, (t) => {
  const file = tmpFile(t);
  const a = open(file);
  a.saveItem(item('i1', { c: 'c1', sev: 1, st: 'reported', n: 1 }));
  a.flush();
  a.updateStory({ c: 'c1', st: 'corroborated', n: 3, sev: 3 });
  a.close();

  const b = open(file);
  const [it] = b.restore().items;
  assert.equal(it.st, 'corroborated');
  assert.equal(it.n, 3);
  assert.equal(it.sev, 3);
  b.close();
});

test('prune keeps seen 14 days and items 30 days', needsSqlite, (t) => {
  const s = open(tmpFile(t));
  s.markSeen('fresh', NOW - 13 * DAY);
  s.markSeen('stale', NOW - 15 * DAY);
  s.saveItem(item('keep', { t: NOW - 29 * DAY }));
  s.saveItem(item('drop', { t: NOW - 31 * DAY }));
  s.flush();
  assert.equal(s.prune(NOW), 2);
  const ids = (tbl) => s.db.prepare(`SELECT id FROM ${tbl}`).all().map(r => r.id);
  assert.deepEqual(ids('seen'), ['fresh']);
  assert.deepEqual(ids('items'), ['keep']);
  s.close();
});

test('a failed flush keeps its batch and retries, the process never sees it', needsSqlite, (t) => {
  const s = open(tmpFile(t));
  s.markSeen('a', NOW);
  const real = s.db;
  s.db = { exec() { throw new Error('disk full'); } };
  assert.equal(quiet(() => s.flush()), 0);
  assert.equal(s.errors, 1);
  assert.match(s.lastErr, /disk full/);
  assert.equal(s.pending, 1, 'batch kept');
  s.db = real;
  assert.equal(s.flush(), 1);
  assert.equal(s.hasSeen('a'), true);
  s.close();
});

test('hostile text is stored as data', needsSqlite, (t) => {
  const file = tmpFile(t);
  const a = open(file);
  const h = `'; DROP TABLE items; -- \u{1F600} "quoted"`;
  a.saveItem(item('x', { h }));
  a.close();
  const b = open(file);
  assert.equal(b.restore().items[0].h, h);
  b.close();
});

test('simulated restart through the real pipeline: nothing repeats, nothing pages', needsSqlite, (t) => {
  const file = tmpFile(t);
  const raw = {
    sid: 'reuters', sn: 'Reuters', cls: 'wire', guid: 'g1', h: 'Trump invokes Insurrection Act',
    x: '', u: 'https://reuters.com/a', pt: NOW - 60000, pub: 'reuters.com', firstPoll: false
  };

  const s1 = open(file);
  const p1 = new Pipeline({ store: s1, now: () => NOW });
  assert.ok(p1.ingest(raw), 'first sight is ingested');
  assert.equal(p1.ingest(raw), null, 'second sight in the same process is a dup');
  s1.close();

  const considered = [];
  const s2 = open(file);
  const p2 = new Pipeline({ store: s2, now: () => NOW + 60000, pager: { consider: (c) => considered.push(c) } });
  const restored = p2.restore();
  assert.equal(restored.items, 1);
  assert.equal(restored.clusters, 1);
  assert.equal(p2.ingest(raw), null, 'same item after a restart is still a dup');
  assert.equal(p2.c.dup, 1);
  assert.equal(considered.length, 0);

  // The restored story is still alive for matching and corroboration.
  const it = p2.ingest(Object.assign({}, raw, { sid: 'bbc', sn: 'BBC', guid: 'g2', u: 'https://bbc.co.uk/b', pub: 'bbc.co.uk', h: 'President Trump invokes Insurrection Act' }));
  assert.equal(it.st, 'corroborated');
  s2.close();
});
