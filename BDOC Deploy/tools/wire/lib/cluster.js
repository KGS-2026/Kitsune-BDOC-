// ============================================================
// cluster — which headlines are one story, and how true it is
// ============================================================
// WHY THIS EXISTS
// Spec ground rule 3: rumor is not fact. "Reported by two independent outlets" is
// the only evidence this system has that something really happened, so everything
// honest about the feed rests on knowing when two headlines are the same story.
//
// Two ways to be wrong, and they are not equal. A miss leaves a true story showing
// "reported" instead of "corroborated" for a while. A false match manufactures a
// confirmation, and a manufactured confirmation can page Travon at 3 a.m. Every
// choice in here leans toward the miss.
//
// DESIGN NOTES
// - Similarity is IDF-weighted Dice over headline tokens. Dice, not containment:
//   a short headline sits inside plenty of long ones. Words that are generic in
//   news ("National", "Guard", "deployed") are discounted by a static list too,
//   because IDF knows nothing in the first minutes after a cold start.
// - IDF alone cannot separate "Guard deployed to Portland" from "Guard deployed to
//   Chicago": three of four words match and log-scaled IDF is too flat. So places
//   are checked explicitly (placeConflict), and with only three shared words the
//   headlines must not each carry something of their own.
// - Stories match against their member headlines, never a growing union of tokens.
//   A union drifts: a story that absorbs everything eventually matches everything.
// - Two different headlines from one publisher are two stories. A wire does not
//   confirm itself, and this is what keeps templated feeds (NWS, USGS, GDACS) from
//   collapsing into one story per template. A near-identical repost still joins.
// - Social text cannot steer a story. A post can join one, but only credible
//   classes set its severity, and only credible classes can dispute it: otherwise
//   anyone could block a real page by posting "hoax" under the headline.
// - Publishers come from domainOf(pub), and parse.js already folds one newsroom's
//   several domains into one, so BBC cannot corroborate BBC.

'use strict';

const { domainOf } = require('./util');
const { places } = require('./gazetteer');

const WINDOW_MS = 12 * 3600 * 1000;
const MIN_SHARED = 3;
const MIN_SIM = 0.6;
const SAME_PUB_SIM = 0.9;
const MAX_MEMBERS = 8;
const MAX_TOKENS = 32;
const GENERIC_WEIGHT = 0.35;
const PRUNE_EVERY = 500;
const RARE_TOKENS = 5;        // how many of a headline's rarest words find candidates
const MAX_POSTING = 2000;     // a word in this many live stories identifies nothing
const MAX_CANDIDATES = 400;   // hard ceiling on comparisons per item

// Classes that are journalism, as opposed to the people talking about it.
const NEWS = new Set(['wire', 'specialist', 'aggregator']);
const CREDIBLE = new Set(['official', 'wire', 'specialist', 'aggregator']);

const STOP = new Set(('a an and are as at be been being but by can did do does for from had has have he her his how i ' +
  'if in into is it its just more most new no not of on one or our out over say said says she so some than that the ' +
  'their them then there these they this to too two up us was we were what when where which who why will with would ' +
  'you your about after again against all also amid among any around because before being between both during each ' +
  'few first get gets got here him himself just last like made make many may might much must near next now off once ' +
  'only other own same see since still such take through under until very via while yet report reports reported ' +
  'breaking update updates updated live latest news watch video photos').split(' '));

// Frequent in exactly the stories we care about, so they prove little. Discounted
// from the first second, before there is any corpus to compute an IDF from.
const GENERIC = new Set(('national guard deployed deploy deploys deployment troop soldier officer official police ' +
  'president trump biden governor mayor senator congress court judge state city county federal government nation ' +
  'election vote voter ballot poll campaign attack killed kill dead death shooting shot protest protester strike ' +
  'military army war force people man woman group leader member worker union warning threat emergency order ' +
  'week day today night year monday tuesday wednesday thursday friday saturday sunday').split(' '));

const unique = (a) => [...new Set(a)];

function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(?:ss|sh|ch|x|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

// Google News appends " - Publisher". parse.js strips it, but a story must not
// depend on that: the publisher's name would otherwise count as shared evidence.
function stripSuffix(h, sn, cls) {
  const s = String(h == null ? '' : h);
  if (sn) {
    const tail = ' - ' + sn;
    if (s.endsWith(tail)) return s.slice(0, -tail.length);
  }
  if (cls === 'aggregator') return s.replace(/\s+[-–—|]\s+[^-–—|]{2,60}$/, '');
  return s;
}

function tokenize(h, sn, cls) {
  const text = stripSuffix(h, sn, cls).slice(0, 400).toLowerCase().replace(/[‘’]/g, "'").replace(/'s\b/g, '');
  const out = new Set();
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const w = m[0];
    if (w.length < 2 || STOP.has(w)) continue;
    out.add(stem(w));
    if (out.size >= MAX_TOKENS) break;
  }
  return out;
}

function placeSig(h) {
  const p = places(h);
  return { m: [...p.metros], r: [...p.regions] };
}

const overlaps = (a, b) => a.some(x => b.includes(x));

// True when two headlines name places that cannot be the same one. Compares at the
// finest level both have: Chicago vs Portland conflict, Chicago vs Illinois do not.
function placeConflict(a, b) {
  if (!a.r.length || !b.r.length) return false;
  if (a.m.length && b.m.length) return !overlaps(a.m, b.m);
  return !overlaps(a.r, b.r);
}

function publisherOf(it) {
  return domainOf(it.pub || '') || domainOf(it.u || '') || String(it.sid || it.src || '');
}

function statusOf(c) {
  if (c.off) return 'official';
  if (c.disputed) return 'disputed';
  if (c.pubs.size >= 2) return 'corroborated';
  if (c.pubs.size === 1) return 'reported';
  return c.disputedLow ? 'disputed' : 'unverified';
}

class Clusterer {
  constructor(opts) {
    const o = opts || {};
    this.now = o.now || Date.now;
    this.windowMs = o.windowMs || WINDOW_MS;
    this.stories = new Map();
    this.index = new Map();    // token -> Set(story id). df(t) is the set's size.
    this.adds = 0;
  }

  get size() {
    return this.stories.size;
  }

  get(id) {
    return this.stories.get(id) || null;
  }

  _weight(t) {
    const postings = this.index.get(t);
    const idf = 1 + Math.log((this.stories.size + 1) / ((postings ? postings.size : 0) + 1));
    return GENERIC.has(t) ? idf * GENERIC_WEIGHT : idf;
  }

  // Similarity of two token sets, or 0 when a guard rules the pair out.
  _similar(a, aPl, b, bPl, samePub) {
    let shared = 0;
    for (const t of a) if (b.has(t)) shared++;
    if (shared < MIN_SHARED) return 0;
    // Three shared words prove little if each side also says something the other
    // does not: "Wildfire near Bishop forces evacuations" vs "... near Ojai ...".
    if (shared === MIN_SHARED && a.size > shared && b.size > shared) return 0;
    if (placeConflict(aPl, bPl)) return 0;

    let sharedW = 0;
    let sumA = 0;
    let sumB = 0;
    for (const t of a) {
      const w = this._weight(t);
      sumA += w;
      if (b.has(t)) sharedW += w;
    }
    for (const t of b) sumB += this._weight(t);
    const sim = (2 * sharedW) / (sumA + sumB);
    if (samePub && sim < SAME_PUB_SIM) return 0;
    return sim;
  }

  // Candidates come from the headline's rarest words, so a word found in thousands
  // of stories ("trump", "election") costs nothing here. Two headlines that share
  // none of their rare words were never going to clear MIN_SIM, because the rare
  // words carry most of the weight. Without this, one template headline repeated
  // through a 12 h window makes every add compare against every story.
  _candidates(toks) {
    const lists = [];
    for (const t of toks) {
      const p = this.index.get(t);
      if (p && p.size <= MAX_POSTING) lists.push(p);
    }
    lists.sort((a, b) => a.size - b.size);
    const out = new Set();
    for (const p of lists.slice(0, RARE_TOKENS)) {
      for (const id of p) {
        out.add(id);
        if (out.size >= MAX_CANDIDATES) return out;
      }
    }
    return out;
  }

  _find(toks, pl, pub, now) {
    if (toks.size < MIN_SHARED) return null;
    let best = null;
    let bestSim = 0;
    for (const id of this._candidates(toks)) {
      const c = this.stories.get(id);
      if (!c || now - c.tLast > this.windowMs) continue;
      for (const m of c.members) {
        const s = this._similar(toks, pl, m.toks, m.pl, m.pub === pub);
        if (s > bestSim) { bestSim = s; best = c; }
      }
    }
    return bestSim >= MIN_SIM ? best : null;
  }

  _index(c, toks) {
    for (const t of toks) {
      let p = this.index.get(t);
      if (!p) { p = new Set(); this.index.set(t, p); }
      p.add(c.id);
    }
  }

  _unindex(c) {
    for (const m of c.members) {
      for (const t of m.toks) {
        const p = this.index.get(t);
        if (!p) continue;
        p.delete(c.id);
        if (!p.size) this.index.delete(t);
      }
    }
  }

  _create(it, now) {
    const c = {
      id: it.id,
      t0: it.t || now,
      tLast: it.t || now,
      count: 0,
      members: [],
      pubs: new Set(),      // news publishers, the corroboration count
      outlets: new Set(),   // news + official publishers, the displayed n
      livePubs: new Set(),  // news publishers seen outside a first-poll batch
      strong: new Set(),    // live publishers whose own headline claimed sev 3
      off: false,
      liveOff: false,
      offStrong: false,
      disputed: false,
      disputedLow: false,
      drill: false,
      base: 0,              // highest claim made by a credible class
      anyBase: 0,           // highest claim by anyone at all
      top: null,            // the credible item to quote in a page
      newestT: 0,
      fresh: false,
      paged: false,
      st: 'unverified',
      n: 1,
      sev: 0
    };
    this.stories.set(c.id, c);
    return c;
  }

  _absorb(c, it, toks, pl, pub, now) {
    c.count++;
    const t = it.t || now;
    if (t > c.tLast) c.tLast = t;
    if (t >= c.newestT) { c.newestT = t; c.fresh = !!it.fresh; }

    if (c.members.length < MAX_MEMBERS) {
      c.members.push({ toks, pl, pub });
      this._index(c, toks);
    }

    const cls = it.cls;
    const base = it.base || 0;
    const live = !it.firstPoll;
    if (base > c.anyBase) c.anyBase = base;
    if (it.drill) c.drill = true;

    if (cls === 'official') {
      c.off = true;
      c.outlets.add(pub);
      if (live) {
        c.liveOff = true;
        if (base >= 3) c.offStrong = true;
      }
    } else if (NEWS.has(cls)) {
      c.pubs.add(pub);
      c.outlets.add(pub);
      if (live) {
        c.livePubs.add(pub);
        if (base >= 3) c.strong.add(pub);
      }
    }

    if (cls === 'factcheck' || (it.debunk && NEWS.has(cls))) c.disputed = true;
    else if (it.debunk) c.disputedLow = true;

    if (CREDIBLE.has(cls)) {
      if (base > c.base) c.base = base;
      if (!c.top || base > c.top.base) c.top = { h: it.h, u: it.u || '', sn: it.sn || '', t, base };
    }
  }

  _settle(c) {
    c.st = statusOf(c);
    c.n = Math.max(1, c.outlets.size);
    // Chatter can make a story notable, but only the record can make it high.
    let sev = Math.max(c.base, Math.min(c.anyBase, 1));
    if (c.st === 'unverified' || c.st === 'disputed') sev = Math.min(sev, 1);
    c.sev = sev;
  }

  /**
   * add({ id, t, h, sn, cls, pub, u, base, fresh, firstPoll, drill, debunk })
   *   -> { cluster, isNew, changed }
   * `base` is classify()'s sev. `changed` means st, n or sev moved, which is what
   * the client needs an upd for.
   */
  add(it) {
    const now = this.now();
    if (++this.adds % PRUNE_EVERY === 0) this.prune(now);

    const toks = tokenize(it.h, it.sn, it.cls);
    const pl = placeSig(stripSuffix(it.h, it.sn, it.cls));
    const pub = publisherOf(it);

    let c = this._find(toks, pl, pub, now);
    const isNew = !c;
    if (isNew) c = this._create(it, now);
    const before = isNew ? '' : `${c.st}|${c.n}|${c.sev}`;

    this._absorb(c, it, toks, pl, pub, now);
    this._settle(c);

    return { cluster: c, isNew, changed: isNew || before !== `${c.st}|${c.n}|${c.sev}` };
  }

  prune(now) {
    const t = now === undefined ? this.now() : now;
    let removed = 0;
    for (const c of this.stories.values()) {
      if (t - c.tLast <= this.windowMs) continue;
      this._unindex(c);
      this.stories.delete(c.id);
      removed++;
    }
    return removed;
  }

  // Plain JSON for the store, so a restart keeps stories and never re-pages one.
  serialize(c) {
    return {
      id: c.id, t0: c.t0, tLast: c.tLast, count: c.count,
      members: c.members.map(m => ({ t: [...m.toks], p: m.pl, b: m.pub })),
      pubs: [...c.pubs], outlets: [...c.outlets], livePubs: [...c.livePubs], strong: [...c.strong],
      off: c.off, liveOff: c.liveOff, offStrong: c.offStrong, disputed: c.disputed, disputedLow: c.disputedLow,
      drill: c.drill, base: c.base, anyBase: c.anyBase, top: c.top, newestT: c.newestT, fresh: c.fresh,
      paged: c.paged, st: c.st, n: c.n, sev: c.sev
    };
  }

  restore(list) {
    const now = this.now();
    let n = 0;
    for (const s of list || []) {
      if (!s || !s.id || !Array.isArray(s.members) || now - s.tLast > this.windowMs) continue;
      const c = Object.assign({}, s, {
        members: s.members.map(m => ({ toks: new Set(m.t), pl: m.p || { m: [], r: [] }, pub: m.b })),
        pubs: new Set(s.pubs), outlets: new Set(s.outlets), livePubs: new Set(s.livePubs), strong: new Set(s.strong)
      });
      this.stories.set(c.id, c);
      for (const m of c.members) this._index(c, m.toks);
      n++;
    }
    return n;
  }
}

module.exports = { Clusterer, tokenize, statusOf, WINDOW_MS, unique };
