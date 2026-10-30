// ============================================================
// pipeline — one raw item in, one honest item out
// ============================================================
// WHY THIS EXISTS
// Everything the sources produce passes through ingest(). This is where spec section 8
// is enforced: the age rules, dedupe, first-poll backfill, and the order of operations
// that makes "a story's status changed" something the client can actually be told.
//
// DESIGN NOTES
// - No network and no SQLite in here. The store, publisher and pager are handed in, so
//   the whole path is unit tested with a fake clock.
// - Ingest cannot fail because a side effect failed. Store, publish and page are each
//   fenced off by side(): a full disk still publishes, a dead Realtime still stores.
// - A first-poll item is history. It is stored and shows up in the next snapshot, but
//   it is not broadcast, because a fresh start would otherwise push thousands of old
//   headlines down the live channel. It does not count toward the rates either: the
//   per-minute sparkline must show the world, not our restart.
// - `fresh` is measured from now, not from t. First-poll items get t = pt, so t - pt
//   would call every piece of backlog fresh.
// - An undated item on a source we already follow counts as fresh. Its first appearance
//   is the only timing we have, and missing a real bulletin is worse. The page gate
//   still demands everything else.
// - A dated item from the future is not fresh. Feeds schedule things (maintenance
//   windows) and clocks are wrong, and neither is news happening now.
// - Firehose posts that classify to nothing are dropped uncounted against `seen`. They
//   were only ever candidates; spec section 4 says the firehose is never stored
//   wholesale, and at 48 posts a second it could not be.

'use strict';

const { sha16, canonUrl, safeUrl, cleanText, log } = require('./util');
const { classify, BUCKETS } = require('./classify');
const { geocode } = require('./gazetteer');
const { Clusterer } = require('./cluster');
const { MemoryStore } = require('./store');

const HOUR = 3600 * 1000;
const MAX_AGE_MS = 72 * HOUR;
const STORE_AGE_MS = 6 * HOUR;
const FRESH_MS = 45 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const RECENT_CAP = 2500;
const SIGNAL_CAP = 2500;
const SNAPSHOT_MAX = 600;
const SNAPSHOT_SIGNAL_MAX = 450;
const SNAPSHOT_WINDOW_MS = 24 * HOUR;
const H_MAX = 240;
const X_MAX = 280;

const FIREHOSE = new Set(['bsky']);
const BUCKET_SET = new Set(BUCKETS);

// Counts per time slot, oldest first on read. Slots are absolute (minute number), so a
// quiet stretch reads as zeros without anything having to tick.
class Ring {
  constructor(size) {
    this.size = size;
    this.v = new Array(size).fill(0);
    this.at = null;
  }

  _roll(slot) {
    if (this.at === null) { this.at = slot; return; }
    const gap = slot - this.at;
    if (gap <= 0) return;
    for (let i = 1; i <= Math.min(gap, this.size); i++) this.v[(this.at + i) % this.size] = 0;
    this.at = slot;
  }

  add(slot) {
    this._roll(slot);
    this.v[slot % this.size]++;
  }

  toArray(slot) {
    this._roll(slot);
    const out = [];
    for (let i = this.size - 1; i >= 0; i--) out.push(this.v[((slot - i) % this.size + this.size) % this.size]);
    return out;
  }

  sum(slot) {
    this._roll(slot);
    return this.v.reduce((a, b) => a + b, 0);
  }
}

function pushCapped(arr, x, cap) {
  arr.push(x);
  // Trim in bulk, so the ring costs O(1) per push on average, not O(cap).
  if (arr.length > cap * 1.2) arr.splice(0, arr.length - cap);
}

class Pipeline {
  constructor(opts) {
    const o = opts || {};
    this.store = o.store || new MemoryStore();
    this.publisher = o.publisher || { publish() {}, update() {} };
    this.pager = o.pager || { consider() { return false; } };
    this.now = o.now || Date.now;
    this.official = o.official || (() => ({}));
    this.clusters = new Clusterer({ now: this.now });

    this.recent = [];   // everything, oldest first
    this.signal = [];   // sev >= 1 or a watch hit, so quiet items cannot push them out
    this.buckets = new Map();
    this.perSec = new Ring(60);
    this.perMin = new Ring(60);
    this.c = {
      in: 0, bad: 0, tooOld: 0, dup: 0, aged: 0, firehoseDropped: 0, stored: 0, firstPoll: 0,
      published: 0, upd: 0, errors: 0, sideErrors: 0
    };
  }

  /** Rebuilds memory from the store after a restart. Returns what came back. */
  restore() {
    const state = this.store.restore();
    const n = this.clusters.restore(state.clusters);
    for (const it of state.items) this._remember(it);
    return { items: state.items.length, clusters: n, pageTimes: state.pageTimes };
  }

  _remember(item) {
    pushCapped(this.recent, item, RECENT_CAP);
    if (item.sev >= 1 || (item.w && item.w.length)) pushCapped(this.signal, item, SIGNAL_CAP);
  }

  _count(item, now) {
    const min = Math.floor(now / 60000);
    this.perSec.add(Math.floor(now / 1000));
    this.perMin.add(min);
    for (const b of item.cat.concat(item.w)) {
      if (!BUCKET_SET.has(b) && !b.startsWith('custom:')) continue;
      let r = this.buckets.get(b);
      if (!r) { r = new Ring(60); this.buckets.set(b, r); }
      r.add(min);
    }
  }

  // A side effect failing is an event in the log, never a lost item.
  _side(fn) {
    try {
      fn();
    } catch (e) {
      this.c.sideErrors++;
      log('error', 'pipeline side effect failed', { err: e });
    }
  }

  ingest(raw) {
    this.c.in++;
    try {
      return this._ingest(raw);
    } catch (e) {
      this.c.errors++;
      log('error', 'ingest failed', { sid: raw && raw.sid, err: e });
      return null;
    }
  }

  _ingest(raw) {
    if (!raw || !raw.h) { this.c.bad++; return null; }
    const now = this.now();

    const pt0 = Number.isFinite(raw.pt) ? raw.pt : null;
    if (pt0 !== null && now - pt0 > MAX_AGE_MS) { this.c.tooOld++; return null; }

    const id = sha16(canonUrl(raw.u) || String(raw.sid) + String(raw.guid));
    if (this.store.hasSeen(id)) { this.c.dup++; return null; }

    if (pt0 !== null && now - pt0 > STORE_AGE_MS) {
      this.store.markSeen(id, now);
      this.c.aged++;
      return null;
    }

    const h = cleanText(raw.h, H_MAX);
    if (!h) { this.c.bad++; return null; }
    const x = cleanText(raw.x, X_MAX);

    const k = classify({ h, x, cls: raw.cls, cat0: raw.cat0, sev0: raw.sev0, geo: raw.geo });
    if (FIREHOSE.has(raw.sid) && (k.noise || (k.sev === 0 && !k.w.length))) {
      this.c.firehoseDropped++;
      return null;
    }

    const first = !!raw.firstPoll;

    // The same words from many accounts are one claim. "I took action with No Kings"
    // arrived from dozens of accounts in the first two minutes of the first live run.
    // Copies still count, so the sparkline shows the volume, but one row reaches the feed.
    if (raw.cls === 'social') {
      const textKey = sha16('text:' + h.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 160));
      if (this.store.hasSeen(textKey)) {
        this.c.dup++;
        if (!first) this._count({ cat: k.cat, w: k.w }, now);
        return null;
      }
      this._side(() => this.store.markSeen(textKey, now));
    }

    const t = first ? Math.min(pt0 === null ? now : pt0, now) : now;
    const pt = pt0 === null ? null : Math.min(pt0, t);
    const fresh = pt0 === null ? !first : (pt0 <= now + CLOCK_SKEW_MS && now - pt0 <= FRESH_MS);
    const u = safeUrl(raw.u) || '';
    const geo = raw.geo || geocode(h) || (x ? geocode(x) : null);

    const r = this.clusters.add({
      id, t, h, sn: raw.sn, cls: raw.cls, pub: raw.pub, u, base: k.sev, fresh,
      firstPoll: first, drill: k.drill, debunk: k.debunk
    });
    const story = r.cluster;

    const item = {
      id, c: story.id, t, pt,
      src: raw.sid, sn: cleanText(raw.sn, 80), cls: raw.cls,
      h, x, u,
      cat: k.cat, w: k.w,
      sev: story.sev, st: story.st, n: story.n,
      fresh
    };
    if (geo) item.geo = geo;

    this._remember(item);
    if (first) this.c.firstPoll++;
    else this._count(item, now);

    this._side(() => this.store.markSeen(id, now));
    this._side(() => this.store.saveItem(item));
    this.c.stored++;

    if (!first) {
      this._side(() => this.publisher.publish(item));
      this.c.published++;
    }
    if (r.changed && !r.isNew) {
      const u2 = { c: story.id, st: story.st, n: story.n, sev: story.sev };
      // No client holds backlog that was never broadcast. The next snapshot settles it.
      if (!first) this._side(() => this.publisher.update(u2));
      this._side(() => this.store.updateStory(u2));
      this.c.upd++;
    }

    // Page before saving the story, so `paged` is durable with the same write.
    if (story.base >= 3 && !first) this._side(() => this.pager.consider(story));
    this._side(() => this.store.saveCluster(this.clusters.serialize(story)));

    return item;
  }

  // Latest story state onto an item. Stories outlive their items' published copies.
  _current(it) {
    const c = this.clusters.get(it.c);
    if (c) { it.st = c.st; it.n = c.n; it.sev = c.sev; }
    return it;
  }

  /**
   * Spec section 3: every sev >= 1 item from the last 24 h (up to 450, worst first when
   * there are more), then fill to 600 by recency. Newest first.
   */
  selectSnapshot() {
    const cutoff = this.now() - SNAPSHOT_WINDOW_MS;
    const all = new Map();
    for (const it of this.signal) all.set(it.id, this._current(it));
    for (const it of this.recent) all.set(it.id, this._current(it));

    const notable = [...all.values()].filter(it => it.sev >= 1 && it.t >= cutoff);
    notable.sort((a, b) => (b.sev - a.sev) || (b.t - a.t));

    const pick = new Map();
    for (const it of notable.slice(0, SNAPSHOT_SIGNAL_MAX)) pick.set(it.id, it);
    const rest = [...all.values()].sort((a, b) => b.t - a.t);
    for (const it of rest) {
      if (pick.size >= SNAPSHOT_MAX) break;
      if (!pick.has(it.id)) pick.set(it.id, it);
    }
    return [...pick.values()].sort((a, b) => b.t - a.t);
  }

  stats() {
    const now = this.now();
    const min = Math.floor(now / 60000);
    const perMin = {};
    for (const b of BUCKETS) {
      const r = this.buckets.get(b);
      perMin[b] = r ? r.toArray(min) : new Array(60).fill(0);
    }
    for (const [b, r] of this.buckets) if (b.startsWith('custom:')) perMin[b] = r.toArray(min);
    return {
      items1m: this.perSec.sum(Math.floor(now / 1000)),
      items1h: this.perMin.sum(min),
      perMin,
      official: this.official()
    };
  }

  counters() {
    return Object.assign({ stories: this.clusters.size, recent: this.recent.length, signal: this.signal.length }, this.c);
  }
}

module.exports = { Pipeline, Ring, MAX_AGE_MS, STORE_AGE_MS, FRESH_MS };
