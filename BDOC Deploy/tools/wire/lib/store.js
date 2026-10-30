// ============================================================
// store — what the daemon remembers across a restart
// ============================================================
// WHY THIS EXISTS
// Spec ground rule 5: a restart must not page anyone. The daemon restarts on every
// deploy and every crash, so "seen", "already paged" and "this source has been polled
// before" all have to outlive the process. Without them, a restart turns the whole
// backlog of 115 feeds into breaking news.
//
// DESIGN NOTES
// - node:sqlite is required inside open(), never at import. CI runs Node 20, which
//   does not have it, and these libs must load there (spec ground rule 9).
// - The API is synchronous on purpose. node:sqlite is, and a lookup in `seen` is a few
//   microseconds. Writes are what would hurt, so they are batched into one transaction
//   every second. A crash loses at most a second of writes, and the worst result is a
//   few items seen twice, which dedupe by id absorbs.
// - `seen` lives in memory for speed but is two generations of a Set, not one forever-
//   growing Set: at ~1 item a second, 14 days is over a million ids. A miss in memory
//   falls through to the indexed table, so the bound costs nothing in accuracy.
// - A database problem must not take the feed down. A failed flush keeps its batch
//   (bounded) and retries, and if the file cannot be opened at all, openStore() falls
//   back to MemoryStore and says so in health. Losing history beats going dark. That
//   fallback only forgets; with no polled set every source reads as a first poll, so
//   the failure mode is "no pages from backlog", never "a page from backlog".
// - MemoryStore shares the API, which is also how pipeline.js gets tested without
//   SQLite or a disk.

'use strict';

const fs = require('fs');
const path = require('path');
const { log } = require('./util');

const DAY = 24 * 3600 * 1000;
const SEEN_KEEP_MS = 14 * DAY;
const ITEMS_KEEP_MS = 30 * DAY;
const CLUSTERS_KEEP_MS = 7 * DAY;
const PAGES_KEEP_MS = 30 * DAY;
const RESTORE_ITEMS_MS = 2 * DAY;
const RESTORE_CLUSTERS_MS = 12 * 3600 * 1000 + 3600 * 1000;
const RESTORE_ITEMS_MAX = 5000;
const RESTORE_SEEN_MS = 3 * DAY;
const RESTORE_SEEN_MAX = 300000;

const SEEN_GENERATION = 300000;
const BATCH_MS = 1000;
const BATCH_MAX = 500;
const PENDING_MAX = 20000;   // a stuck disk must not become a full heap
const PRUNE_EVERY_MS = 3600 * 1000;

// Two Sets, the older dropped whole. O(1), and memory cannot run away.
class SeenSet {
  constructor() {
    this.cur = new Set();
    this.old = new Set();
  }

  has(id) {
    return this.cur.has(id) || this.old.has(id);
  }

  add(id) {
    this.cur.add(id);
    if (this.cur.size >= SEEN_GENERATION) {
      this.old = this.cur;
      this.cur = new Set();
    }
  }

  get size() {
    return this.cur.size + this.old.size;
  }
}

// ── In memory: tests, and the fallback when SQLite will not open ──────────────
class MemoryStore {
  constructor(opts) {
    const o = opts || {};
    this.now = o.now || Date.now;
    this.seen = new SeenSet();
    this.items = [];
    this.clusters = new Map();
    this.polled = new Set();
    this.pages = [];
    this.kv = new Map();
    this.durable = false;
    this.reason = o.reason || null;
  }

  open() { return this; }
  start() {}
  flush() { return 0; }
  prune() { return 0; }
  close() {}

  hasSeen(id) { return this.seen.has(id); }
  markSeen(id) { this.seen.add(id); }

  saveItem(item) {
    this.items.push(item);
    if (this.items.length > RESTORE_ITEMS_MAX) this.items.splice(0, this.items.length - RESTORE_ITEMS_MAX);
  }

  updateStory(u) {
    for (const it of this.items) {
      if (it.c === u.c) { it.st = u.st; it.n = u.n; it.sev = u.sev; }
    }
  }

  saveCluster(c) { this.clusters.set(c.id, c); }
  isPolled(sid) { return this.polled.has(sid); }
  markPolled(sid) { this.polled.add(sid); }
  recordPage(c, t) { this.pages.push({ c, t }); }
  get(k) { return this.kv.has(k) ? this.kv.get(k) : null; }
  set(k, v) { this.kv.set(k, v); }

  restore() {
    return {
      items: this.items.slice(),
      clusters: [...this.clusters.values()],
      pageTimes: this.pages.map(p => p.t)
    };
  }

  stats() {
    return { kind: 'memory', durable: false, reason: this.reason, seen: this.seen.size, items: this.items.length };
  }
}

// ── SQLite ────────────────────────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS seen(id TEXT PRIMARY KEY, t INTEGER NOT NULL) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS seen_t ON seen(t);
  CREATE TABLE IF NOT EXISTS items(
    id TEXT PRIMARY KEY, c TEXT NOT NULL, t INTEGER NOT NULL, sev INTEGER NOT NULL, st TEXT NOT NULL,
    n INTEGER NOT NULL, cls TEXT, src TEXT, h TEXT, j TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS items_t ON items(t);
  CREATE INDEX IF NOT EXISTS items_c ON items(c);
  CREATE INDEX IF NOT EXISTS items_sev ON items(sev, t);
  CREATE TABLE IF NOT EXISTS clusters(id TEXT PRIMARY KEY, tl INTEGER NOT NULL, j TEXT NOT NULL) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS clusters_tl ON clusters(tl);
  CREATE TABLE IF NOT EXISTS polled(sid TEXT PRIMARY KEY, t INTEGER NOT NULL) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS pages(c TEXT NOT NULL, t INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS pages_t ON pages(t);
  CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID;
`;

class SqliteStore {
  constructor(opts) {
    const o = opts || {};
    this.file = o.file;
    this.now = o.now || Date.now;
    this.batchMs = o.batchMs || BATCH_MS;
    this.batchMax = o.batchMax || BATCH_MAX;
    this.db = null;
    this.seen = new SeenSet();
    this.polled = new Set();
    this.kv = new Map();
    this.durable = true;
    this.q = this._emptyQueue();
    this.pending = 0;
    this.flushQueued = false;
    this.errors = 0;
    this.lastErr = null;
    this.lastFlush = null;
    this.dropped = 0;
  }

  _emptyQueue() {
    return { seen: [], items: [], ups: new Map(), clusters: new Map(), polled: [], pages: [], kv: new Map() };
  }

  open() {
    const { DatabaseSync } = require('node:sqlite');
    if (this.file !== ':memory:') fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=2000; PRAGMA foreign_keys=OFF;');
    this.db.exec(SCHEMA);

    const p = (sql) => this.db.prepare(sql);
    this.sql = {
      seenGet: p('SELECT 1 AS x FROM seen WHERE id = ?'),
      seenPut: p('INSERT OR IGNORE INTO seen(id, t) VALUES (?, ?)'),
      itemPut: p('INSERT OR REPLACE INTO items(id, c, t, sev, st, n, cls, src, h, j) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      itemUp: p('UPDATE items SET st = ?, n = ?, sev = ? WHERE c = ?'),
      clusterPut: p('INSERT OR REPLACE INTO clusters(id, tl, j) VALUES (?, ?, ?)'),
      polledPut: p('INSERT OR REPLACE INTO polled(sid, t) VALUES (?, ?)'),
      pagePut: p('INSERT INTO pages(c, t) VALUES (?, ?)'),
      kvPut: p('INSERT OR REPLACE INTO kv(k, v) VALUES (?, ?)')
    };
    return this;
  }

  // Timers are unref'd: they must never be what keeps a stopping process alive.
  start() {
    this.flushTimer = setInterval(() => this.flush(), this.batchMs);
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_EVERY_MS);
    if (this.flushTimer.unref) this.flushTimer.unref();
    if (this.pruneTimer.unref) this.pruneTimer.unref();
  }

  _touch(n) {
    this.pending += n || 1;
    if (this.pending >= this.batchMax && !this.flushQueued) {
      this.flushQueued = true;
      setImmediate(() => { this.flushQueued = false; this.flush(); });
    }
  }

  hasSeen(id) {
    if (this.seen.has(id)) return true;
    try {
      return !!this.sql.seenGet.get(id);
    } catch (e) {
      this._fail('seen lookup', e);
      return false;
    }
  }

  markSeen(id, t) {
    this.seen.add(id);
    this.q.seen.push([id, t === undefined ? this.now() : t]);
    this._touch();
  }

  saveItem(item) {
    this.q.items.push(item);
    this._touch();
  }

  updateStory(u) {
    this.q.ups.set(u.c, u);
    this._touch();
  }

  saveCluster(c) {
    this.q.clusters.set(c.id, c);
    this._touch();
  }

  isPolled(sid) {
    return this.polled.has(sid);
  }

  markPolled(sid, t) {
    this.polled.add(sid);
    this.q.polled.push([sid, t === undefined ? this.now() : t]);
    this._touch();
  }

  recordPage(c, t) {
    this.q.pages.push([c, t]);
    this._touch();
  }

  get(k) {
    return this.kv.has(k) ? this.kv.get(k) : null;
  }

  set(k, v) {
    this.kv.set(k, v);
    this.q.kv.set(k, v);
    this._touch();
  }

  _fail(what, e) {
    this.errors++;
    this.lastErr = what + ': ' + (e && e.message ? e.message : String(e));
    if (this.errors <= 5 || this.errors % 100 === 0) log('error', 'store ' + what + ' failed', { err: e, errors: this.errors });
  }

  flush() {
    if (!this.db || this.pending === 0) return 0;
    const q = this.q;
    const s = this.sql;
    let n = 0;
    try {
      this.db.exec('BEGIN');
      for (const [id, t] of q.seen) { s.seenPut.run(id, t); n++; }
      for (const it of q.items) {
        s.itemPut.run(it.id, it.c, it.t, it.sev, it.st, it.n, it.cls, it.src, it.h, JSON.stringify(it));
        n++;
      }
      for (const u of q.ups.values()) { s.itemUp.run(u.st, u.n, u.sev, u.c); n++; }
      for (const c of q.clusters.values()) { s.clusterPut.run(c.id, c.tLast, JSON.stringify(c)); n++; }
      for (const [sid, t] of q.polled) { s.polledPut.run(sid, t); n++; }
      for (const [c, t] of q.pages) { s.pagePut.run(c, t); n++; }
      for (const [k, v] of q.kv) { s.kvPut.run(k, JSON.stringify(v)); n++; }
      this.db.exec('COMMIT');
      this.q = this._emptyQueue();
      this.pending = 0;
      this.lastFlush = this.now();
      return n;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch (_) { /* nothing to roll back */ }
      this._fail('flush', e);
      this._trim();
      return 0;
    }
  }

  // Disk full or locked: keep what fits and count the rest, so memory stays bounded.
  _trim() {
    if (this.pending <= PENDING_MAX) return;
    const over = Math.max(this.q.seen.length, this.q.items.length) - PENDING_MAX / 2;
    if (over > 0) {
      this.dropped += Math.max(0, this.q.seen.length - PENDING_MAX / 2) + Math.max(0, this.q.items.length - PENDING_MAX / 2);
      this.q.seen = this.q.seen.slice(-PENDING_MAX / 2);
      this.q.items = this.q.items.slice(-PENDING_MAX / 2);
    }
    this.pending = this.q.seen.length + this.q.items.length + this.q.ups.size + this.q.clusters.size +
      this.q.polled.length + this.q.pages.length + this.q.kv.size;
  }

  restore() {
    const now = this.now();
    const all = (sql, ...a) => this.db.prepare(sql).all(...a);

    for (const r of all('SELECT id FROM seen WHERE t >= ? ORDER BY t DESC LIMIT ?', now - RESTORE_SEEN_MS, RESTORE_SEEN_MAX)) {
      this.seen.add(r.id);
    }
    for (const r of all('SELECT sid FROM polled')) this.polled.add(r.sid);
    for (const r of all('SELECT k, v FROM kv')) {
      try { this.kv.set(r.k, JSON.parse(r.v)); } catch (_) { /* a bad row is just forgotten */ }
    }

    const items = [];
    for (const r of all('SELECT j, st, n, sev FROM items WHERE t >= ? ORDER BY t DESC LIMIT ?', now - RESTORE_ITEMS_MS, RESTORE_ITEMS_MAX)) {
      try { items.push(Object.assign(JSON.parse(r.j), { st: r.st, n: r.n, sev: r.sev })); } catch (_) { /* skip */ }
    }
    items.reverse();

    const clusters = [];
    for (const r of all('SELECT j FROM clusters WHERE tl >= ?', now - RESTORE_CLUSTERS_MS)) {
      try { clusters.push(JSON.parse(r.j)); } catch (_) { /* skip */ }
    }

    const pageTimes = all('SELECT t FROM pages WHERE t >= ?', now - DAY).map(r => r.t);
    return { items, clusters, pageTimes };
  }

  prune(now) {
    if (!this.db) return 0;
    const t = now === undefined ? this.now() : now;
    this.flush();
    try {
      let n = 0;
      n += Number(this.db.prepare('DELETE FROM seen WHERE t < ?').run(t - SEEN_KEEP_MS).changes);
      n += Number(this.db.prepare('DELETE FROM items WHERE t < ?').run(t - ITEMS_KEEP_MS).changes);
      n += Number(this.db.prepare('DELETE FROM clusters WHERE tl < ?').run(t - CLUSTERS_KEEP_MS).changes);
      n += Number(this.db.prepare('DELETE FROM pages WHERE t < ?').run(t - PAGES_KEEP_MS).changes);
      this.db.exec('PRAGMA wal_checkpoint(PASSIVE); PRAGMA optimize;');
      return n;
    } catch (e) {
      this._fail('prune', e);
      return 0;
    }
  }

  close() {
    clearInterval(this.flushTimer);
    clearInterval(this.pruneTimer);
    if (!this.db) return;
    this.flush();
    try {
      this.db.close();
    } catch (e) {
      this._fail('close', e);
    }
    this.db = null;
  }

  stats() {
    return {
      kind: 'sqlite', durable: true, seen: this.seen.size, pending: this.pending, errors: this.errors,
      dropped: this.dropped, lastErr: this.lastErr, lastFlush: this.lastFlush
    };
  }
}

/**
 * Opens the database, or falls back to memory with a loud log line and an honest
 * health flag. A collector with no history is degraded; one that is down is blind.
 */
function openStore(opts) {
  const o = opts || {};
  try {
    return new SqliteStore(o).open();
  } catch (e) {
    log('error', 'store unavailable, running from memory', { file: o.file, err: e });
    return new MemoryStore({ now: o.now, reason: e && e.message ? e.message : String(e) });
  }
}

module.exports = { SqliteStore, MemoryStore, SeenSet, openStore, SEEN_KEEP_MS, ITEMS_KEEP_MS };
