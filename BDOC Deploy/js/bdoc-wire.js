// ============================================================
// bdoc-wire.js — LIVE WIRE feed UI (BUILD p160, owner only)
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
// WHY THIS EXISTS
// Travon, 2026-10-30: "I need to know in real time what is going on." This is the
// screen the owner watches on election night, on a laptop and on a phone. The contract is
// docs/LIVE-WIRE-SPEC.md; this file is §9 of it, under the rules of §0.
//
// TWO MOUNTS, ONE MODULE
//  - Panel: right side of the main app, opened by js/bdoc-wire-boot.js.
//  - Page: wire.html (<html data-wire-page>). Boots itself, runs its own sign-in gate
//    and works with no Cesium at all.
//
// EVERY BYTE FROM A FEED IS HOSTILE
// The collector sanitizes, and this file does not trust that it did. A public
// Realtime broadcast can be sent to by anyone holding the topic, so a payload is
// treated as attacker-controlled on arrival:
//  - normItem() whitelists every field before an item is stored.
//  - The DOM is built only by h() with text nodes. HTML-string APIs do not appear
//    in this file, and tests/wire-client.test.js fails the build if they ever do.
//  - extLink() is the only place an outbound anchor is made, and it runs safeUrl().
//  - Nothing is ever loaded from a feed URL: no images, no favicons, no previews.
//  - Globe markers carry position and point only. No name and no description,
//    because the Cesium InfoBox iframe is allow-scripts allow-same-origin.
//
// HONEST STATUS
// LIVE means a heartbeat ARRIVED within 45 s, timed on the local clock at receipt.
// A subscribed socket is not LIVE. A 200 from the function is not LIVE. Anything
// else is spelled out with its age, because a fake green dot on election night is
// worse than no dot.
//
// NO DEV HOOK LIVES HERE
// tools/wire/dev-server.js swaps the Supabase global for a fake on localhost by
// rewriting wire.html as it serves it, so production code has no test path to abuse.

(function () {
  'use strict';

  const MAX_ITEMS = 2000;
  const MAX_ROWS = 400;
  const MAX_BATCH = 1000;        // a broadcast is capped at 200 KB, so more than this is not ours
  const HB_LIVE_SEC = 45;
  const SNAP_STALE_SEC = 300;
  const CONNECT_GRACE_SEC = 20;  // heartbeats come every 15 s, so allow one interval plus the join
  const WATCHDOG_SEC = 60;       // a "joined" socket with no heartbeat this long is a zombie
  const POLL_MS = 60000;
  const POLL_DOWN_MS = 30000;
  const FETCH_TIMEOUT_MS = 15000;
  const FREEZE_PX = 40;          // scrolled past this, the list stops moving and shows N NEW
  const FLUSH_FLOOR_MS = 400;
  const MARKER_CAP = 200;
  const SOURCES_FOLDED = 14;     // ~115 sources would bury the phone feed if all drawn by default
  const WIRE_URL = '/.netlify/functions/wire';
  const CONFIG_URL = '/.netlify/functions/config';
  const CSS_HREF = '/css/bdoc-wire.css?v=p160';
  // Same file and same hash as the jsDelivr tag in wire.html. P154 lost the whole app to
  // one CDN hiccup on Cesium, so the page gets a second path to the auth library.
  const SUPABASE_FALLBACK = 'https://unpkg.com/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js';
  const SUPABASE_SRI = 'sha384-UagCvVPT5XXA0Hx+nJYUAGBFseHT9zBgpJMSebsAxl9lciTwbT+39j5VfRjdP5Tp';

  const VIEW_ORDER = ['signal', 'chatter', 'official', 'all'];
  const VIEW_LABEL = { signal: 'SIGNAL', chatter: 'CHATTER', official: 'OFFICIAL', all: 'ALL' };
  // §9 defines the views by class, §4 says sev 0 shows only in ALL. Both hold: this is
  // the DEFAULT floor per view, and the SEV control can drop CHATTER or OFFICIAL to ANY.
  const VIEW_MIN_SEV = { signal: 1, chatter: 1, official: 1, all: 0 };
  const CLASSES = new Set(['official', 'wire', 'specialist', 'aggregator', 'factcheck', 'osint', 'social', 'signal']);
  const TRUTH = new Set(['official', 'corroborated', 'reported', 'unverified', 'disputed']);
  const CLASS_RANK = { official: 5, factcheck: 4, wire: 3, specialist: 2, aggregator: 2, osint: 1, social: 0, signal: 0 };
  const STATUS_WORD = {
    official: 'OFFICIAL', corroborated: 'CORROBORATED', reported: 'REPORTED',
    unverified: 'UNVERIFIED', disputed: 'DISPUTED',
    connecting: 'CONNECTING', live: 'LIVE', degraded: 'DEGRADED',
    offline: 'COLLECTOR OFFLINE', unreachable: 'NO CONNECTION'
  };
  const BUCKETS = ['nov4', 'election', 'unrest', 'security', 'infra', 'cyber', 'military', 'rumor', 'ports'];
  const CHIPS = [
    ['nov4', 'NOV 4'], ['election', 'ELECTION'], ['unrest', 'UNREST'], ['security', 'SECURITY'],
    ['military', 'MILITARY'], ['cyber', 'CYBER'], ['infra', 'INFRA'], ['ports', 'PORTS'],
    ['disaster', 'DISASTER'], ['health', 'HEALTH'], ['finance', 'FINANCE'], ['gov', 'GOV'],
    ['labor', 'LABOR'], ['rumor', 'RUMOR']
  ];
  const ID_RE = /^[\w:-]{1,64}$/;
  const TAG_RE = /^[a-z0-9_-]{1,24}$/;
  const CTRL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
  // Bidi overrides and zero-width characters let a headline reorder or hide its own text.
  const INVISIBLE_RE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

  // ── Pure logic. No document, no window: tests/wire-client.test.js runs all of this
  //    under plain Node, and the file must load there without touching the DOM. ──

  // http and https only, fully qualified. Control characters and backslashes are refused
  // outright rather than normalized: browsers strip them, which is how "java\nscript:"
  // gets past a prefix check. Userinfo is refused because "https://bbc.com@evil.test"
  // reads as one host and goes to another.
  function safeUrl(u) {
    if (typeof u !== 'string') return '';
    const s = u.trim();
    if (!s || s.length > 2048) return '';
    if (/[\u0000-\u001f\u007f\\]/.test(s)) return '';
    if (!/^https?:\/\/[^\s/?#]/i.test(s)) return '';
    let p;
    try { p = new URL(s); } catch (_) { return ''; }
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return '';
    if (!p.hostname || p.username || p.password) return '';
    return p.href;
  }

  function cleanText(s, max) {
    if (typeof s !== 'string') return '';
    const t = s.replace(INVISIBLE_RE, '').replace(CTRL_RE, ' ').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  function clampSev(v) {
    const n = Math.floor(Number(v));
    return n >= 3 ? 3 : n >= 1 ? n : 0;
  }

  function normGeo(g) {
    if (!g || typeof g !== 'object') return null;
    const { lat, lon } = g;
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const r = Number(g.r);
    return { p: cleanText(g.p, 80), lat, lon, r: Number.isFinite(r) && r > 0 ? r : 0, cc: cleanText(g.cc, 4) };
  }

  function tagList(v) {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const t of v.slice(0, 12)) if (typeof t === 'string' && TAG_RE.test(t) && !out.includes(t)) out.push(t);
    return out;
  }

  function watchList(v) {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const t of v.slice(0, 16)) {
      const s = cleanText(t, 72).toLowerCase();
      if (s && !out.includes(s)) out.push(s);
    }
    return out;
  }

  // The gate every item passes through before it is stored. Enumerations are whitelisted,
  // so a value from here is safe to use as a data attribute. Unknown status means the
  // least trusted one: a bad payload must never read as confirmed.
  function normItem(raw, now) {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'string' ? raw.id : '';
    const head = cleanText(raw.h, 240);
    const t = Number(raw.t);
    if (!ID_RE.test(id) || !head || !Number.isFinite(t) || t <= 0) return null;
    // A future stamp would pin an item to the top of the feed for good.
    const seen = Math.min(t, (now === undefined ? Date.now() : now) + 60000);
    const pub = raw.pt === null || raw.pt === undefined ? NaN : Number(raw.pt);
    const st = TRUTH.has(raw.st) ? raw.st : 'unverified';
    let sev = clampSev(raw.sev);
    if (st === 'unverified' && sev > 1) sev = 1; // §0.3: a rumor never reads as critical
    const n = Math.floor(Number(raw.n));
    const item = {
      id,
      c: typeof raw.c === 'string' && ID_RE.test(raw.c) ? raw.c : id,
      t: seen,
      pt: Number.isFinite(pub) && pub > 0 ? Math.min(pub, seen) : null,
      src: cleanText(raw.src, 64),
      sn: cleanText(raw.sn, 80) || cleanText(raw.src, 64) || 'UNKNOWN SOURCE',
      cls: CLASSES.has(raw.cls) ? raw.cls : 'unknown',
      h: head,
      x: cleanText(raw.x, 280),
      u: safeUrl(raw.u),
      cat: tagList(raw.cat),
      w: watchList(raw.w),
      sev,
      st,
      n: n >= 1 ? Math.min(n, 999) : 1,
      fresh: raw.fresh !== false
    };
    const geo = normGeo(raw.geo);
    if (geo) item.geo = geo;
    return item;
  }

  function byNewest(a, b) {
    return (b.t - a.t) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  function sameList(a, b) {
    const x = a || [];
    const y = b || [];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  // Keeps object identity when nothing changed. The renderer uses identity as its dirty
  // check, so a re-merged snapshot repaints nothing.
  function mergeOne(prev, next) {
    const n = Math.max(prev.n || 1, next.n || 1); // publishers in a story only ever grow
    const same = prev.st === next.st && prev.sev === next.sev && (prev.n || 1) === n &&
      prev.h === next.h && prev.x === next.x && prev.u === next.u && prev.fresh === next.fresh &&
      sameList(prev.cat, next.cat) && sameList(prev.w, next.w);
    if (same) return prev;
    return Object.assign({}, prev, next, { t: prev.t, n });
  }

  // Idempotent by id, newest first, capped. Snapshot and live batches overlap on purpose,
  // so the same item arriving twice has to be harmless.
  function mergeItems(existing, incoming, cap) {
    const limit = cap === undefined ? MAX_ITEMS : cap;
    const byId = new Map();
    for (const it of existing || []) if (it && it.id) byId.set(it.id, it);
    for (const it of incoming || []) {
      if (!it || !it.id) continue;
      const prev = byId.get(it.id);
      byId.set(it.id, prev ? mergeOne(prev, it) : it);
    }
    const out = Array.from(byId.values()).sort(byNewest);
    if (out.length > limit) out.length = limit;
    return out;
  }

  // Applies [{c, st, n, sev}] across every item in each story. Returns the same array when
  // nothing changed; changed items become new objects so their rows repaint.
  function applyUpdate(items, upd) {
    if (!Array.isArray(upd) || !upd.length) return items;
    const byC = new Map();
    for (const u of upd) if (u && typeof u.c === 'string') byC.set(u.c, u);
    let changed = false;
    const out = items.map(it => {
      const u = byC.get(it.c);
      if (!u) return it;
      const st = TRUTH.has(u.st) ? u.st : it.st;
      const raw = Math.floor(Number(u.n));
      const n = raw >= 1 ? Math.min(raw, 999) : it.n;
      let sev = u.sev === undefined || u.sev === null ? it.sev : clampSev(u.sev);
      if (st === 'unverified' && sev > 1) sev = 1;
      if (st === it.st && n === it.n && sev === it.sev) return it;
      changed = true;
      return Object.assign({}, it, { st, n, sev });
    });
    return changed ? out : items;
  }

  // Any watch hit counts as notable: §4 lists nov4 and rumor at sev 1, and a custom term
  // the owner typed in himself must not vanish from SIGNAL for being sev 0.
  function effSev(it) {
    return Math.max(it.sev || 0, it.w && it.w.length ? 1 : 0);
  }

  function inView(it, view) {
    if (view === 'chatter') return it.cls === 'osint' || it.cls === 'social';
    // A wire row whose story holds an official item carries the word OFFICIAL, so it has
    // to appear here. A row labelled OFFICIAL that is absent from OFFICIAL would read as a bug.
    if (view === 'official') return it.cls === 'official' || it.st === 'official';
    return true;
  }

  const HAY = new WeakMap();
  function haystack(it) {
    let s = HAY.get(it);
    if (s === undefined) {
      s = [it.h, it.x, it.sn, it.src, it.geo && it.geo.p, (it.cat || []).join(' '), (it.w || []).join(' ')]
        .filter(Boolean).join(' ').toLowerCase();
      HAY.set(it, s);
    }
    return s;
  }

  // filter: { view, cats (Set or array of categories and watch hits), q, minSev }.
  // Leave minSev undefined or null for the view's default floor.
  function filterItems(items, filter) {
    const f = filter || {};
    const view = Object.prototype.hasOwnProperty.call(VIEW_MIN_SEV, f.view) ? f.view : 'signal';
    let min = typeof f.minSev === 'number' ? f.minSev : VIEW_MIN_SEV[view];
    if (view === 'signal') min = Math.max(min, 1);   // SIGNAL is sev 1 and up by definition
    const cats = f.cats ? (f.cats instanceof Set ? f.cats : new Set(f.cats)) : null;
    const tags = cats && cats.size ? cats : null;
    const terms = typeof f.q === 'string' ? f.q.toLowerCase().split(/\s+/).filter(Boolean) : [];
    const out = [];
    for (const it of items) {
      if (!inView(it, view) || effSev(it) < min) continue;
      if (tags) {
        let hit = false;
        for (const c of it.cat || []) if (tags.has(c)) { hit = true; break; }
        if (!hit) for (const w of it.w || []) if (tags.has(w)) { hit = true; break; }
        if (!hit) continue;
      }
      if (terms.length) {
        const hay = haystack(it);
        let hit = true;
        for (const term of terms) if (!hay.includes(term)) { hit = false; break; }
        if (!hit) continue;
      }
      out.push(it);
    }
    return out;
  }

  // One row per story. Twenty outlets on one event is one thing that happened, and twenty
  // rows would push everything else off the screen. The strongest source fronts the story
  // so a stray post that clustered into a confirmed report cannot take over its headline.
  // Ties go to the newest, so fresh reporting moves the story up. ALL skips this.
  function collapseStories(items) {
    const best = new Map();
    for (const it of items) {
      const c = it.c || it.id;
      const cur = best.get(c);
      if (!cur) { best.set(c, it); continue; }
      const a = CLASS_RANK[it.cls] || 0;
      const b = CLASS_RANK[cur.cls] || 0;
      if (a > b || (a === b && it.t > cur.t)) best.set(c, it);
    }
    return Array.from(best.values()).sort(byNewest);
  }

  function visibleRows(items, filter) {
    const rows = filterItems(items, filter);
    return filter && filter.view === 'all' ? rows : collapseStories(rows);
  }

  function viewCounts(items) {
    return {
      signal: visibleRows(items, { view: 'signal' }).length,
      chatter: visibleRows(items, { view: 'chatter' }).length,
      official: visibleRows(items, { view: 'official' }).length,
      all: items.length
    };
  }

  // One word list for both status vocabularies (truth and connection). The codes do not
  // collide, and every word on screen comes from this table.
  function statusLabel(code) {
    return Object.prototype.hasOwnProperty.call(STATUS_WORD, code) ? STATUS_WORD[code] : 'UNKNOWN';
  }

  function fmtAge(sec) {
    if (typeof sec !== 'number' || !Number.isFinite(sec)) return '—';
    const s = Math.max(0, Math.floor(sec));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  function fmtClock(ms) {
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '--:--:--Z' : d.toISOString().slice(11, 19) + 'Z';
  }

  // c: { now, lastHb (local ms at receipt), snapAgeSec, pathDown, startedAt }.
  //  - live: a heartbeat arrived within 45 s, and nothing else can earn this.
  //  - unreachable: no heartbeat and the last GET failed. We cannot see the collector,
  //    so saying it is offline would be a guess. This is a state the spec does not name;
  //    it exists so a dead laptop connection is never blamed on the droplet.
  //  - degraded: no heartbeat, but a snapshot under 5 min old proves the collector runs.
  //  - offline: no heartbeat and no fresh snapshot.
  //  - connecting: only inside the first-heartbeat grace window of a new watch.
  function connectionState(c) {
    const o = c || {};
    const now = typeof o.now === 'number' ? o.now : Date.now();
    const hbAge = o.lastHb ? Math.max(0, (now - o.lastHb) / 1000) : null;
    const snapAge = typeof o.snapAgeSec === 'number' && Number.isFinite(o.snapAgeSec) ? Math.max(0, o.snapAgeSec) : null;
    const result = state => ({ state, hbAge, snapAge });
    if (hbAge !== null && hbAge <= HB_LIVE_SEC) return result('live');
    if (o.pathDown) return result('unreachable');
    const inGrace = hbAge === null && !!o.startedAt && (now - o.startedAt) / 1000 < CONNECT_GRACE_SEC;
    if (inGrace) return result('connecting');
    return result(snapAge !== null && snapAge <= SNAP_STALE_SEC ? 'degraded' : 'offline');
  }

  // perMin series are oldest to newest. rate is the mean of the last 5 minutes, because
  // the newest bucket is a partial minute and would always read low. surge flags what is
  // going up: 3x the prior hour, with a floor so one stray item is not a surge.
  function bucketStats(series) {
    const s = Array.isArray(series) ? series.slice(-60).map(v => (typeof v === 'number' && v > 0 ? v : 0)) : [];
    const sum = a => a.reduce((x, y) => x + y, 0);
    const recent = s.slice(-5);
    const prior = s.slice(0, -5);
    const rate = recent.length ? sum(recent) / recent.length : 0;
    const base = prior.length ? sum(prior) / prior.length : 0;
    return { series: s, rate, total: sum(s), surge: prior.length >= 10 && rate >= 1 && rate >= 3 * Math.max(base, 0.2) };
  }

  // The collector decides this, not the client: it knows each feed's rhythm, and that a
  // quiet NTAS or NHC feed with nothing new is healthy. HTTP 200 with old content arrives
  // here as stale (§0.6). A source not polled yet since a restart is unknown, not dead.
  function sourceState(s) {
    if (!s) return 'down';
    if (s.ok === true) return 'ok';
    if (s.stale === true || s.err === 'stale') return 'stale';
    if (s.lastOk === null && s.lastErr === null) return 'pending';
    return 'down';
  }

  function sortSources(list) {
    const rank = { down: 0, stale: 1, pending: 2, ok: 3 };
    return (Array.isArray(list) ? list : []).filter(s => s && typeof s === 'object').slice().sort((a, b) =>
      (rank[sourceState(a)] - rank[sourceState(b)]) ||
      ((Number(b.fails) || 0) - (Number(a.fails) || 0)) ||
      String(a.n || a.id).localeCompare(String(b.n || b.id)));
  }

  function validOfficial(name, v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const nums = keys => keys.every(k => typeof v[k] === 'number' && Number.isFinite(v[k]));
    if (name === 'ntas') return typeof v.active === 'boolean';
    if (name === 'faa') return nums(['stops', 'delays', 'closures']);
    if (name === 'nws') return nums(['extreme', 'severe', 'civil']);
    if (name === 'usgs') return nums(['m6p24h']);
    return false;
  }

  // The STATE rail. An all-clear is a claim, so it has to be earned: missing or malformed
  // data reads NO DATA, never zero, and a feed that is down or stale cannot vouch for the
  // last value it reported. "No active advisory" from a dead NTAS poll is false comfort.
  function stateRows(official, sources) {
    const o = official && typeof official === 'object' ? official : {};
    const srcs = Array.isArray(sources) ? sources : [];
    const row = (k, id, name, build) => {
      const src = srcs.find(x => x && x.id === id);
      const feed = src ? sourceState(src) : 'ok';
      if (feed === 'down' || feed === 'stale') return { k, tone: 'none', v: 'FEED ' + feed.toUpperCase() + ', STATE UNKNOWN', s: k + ' ?' };
      if (!validOfficial(name, o[name])) return { k, tone: 'none', v: feed === 'pending' ? 'NOT POLLED YET' : 'NO DATA', s: k + ' —' };
      return build(o[name]);
    };
    return [
      row('NTAS', 'ntas', 'ntas', v => (v.active
        ? { k: 'NTAS', tone: 'crit', v: 'ACTIVE', sub: cleanText(v.title, 160), s: 'NTAS ACTIVE' }
        : { k: 'NTAS', tone: 'ok', v: 'NO ACTIVE ADVISORY', s: 'NTAS NONE' })),
      row('FAA', 'faa', 'faa', v => {
        const when = typeof v.updated === 'number' ? fmtClock(v.updated) : cleanText(v.updated, 40);
        return {
          k: 'FAA', tone: v.stops ? 'crit' : v.delays ? 'warn' : 'ok',
          v: v.stops + ' STOPS · ' + v.delays + ' DELAYS · ' + v.closures + ' CLOSURES',
          sub: when ? 'UPDATED ' + when : '', s: 'FAA ' + v.stops + '/' + v.delays + '/' + v.closures
        };
      }),
      row('NWS', 'nws', 'nws', v => ({
        k: 'NWS', tone: v.civil || v.extreme ? 'crit' : v.severe ? 'warn' : 'ok',
        v: v.extreme + ' EXTREME · ' + v.severe + ' SEVERE · ' + v.civil + ' CIVIL',
        s: 'NWS ' + v.extreme + '/' + v.severe + '/' + v.civil
      })),
      row('USGS', 'usgs', 'usgs', v => ({ k: 'USGS', tone: v.m6p24h ? 'warn' : 'ok', v: v.m6p24h + ' M6+ IN 24H', s: 'M6+ ' + v.m6p24h }))
    ];
  }

  function normWatch(w) {
    const list = Array.isArray(w) ? w : (w && Array.isArray(w.terms) ? w.terms : []);
    const out = [];
    for (const t of list) {
      const s = cleanText(t, 64);
      if (s.length >= 2 && !out.some(x => x.toLowerCase() === s.toLowerCase())) out.push(s);
    }
    return out.slice(0, 40);
  }

  // Mirrors the server rule for a fast answer. The server still decides.
  function checkTerm(raw, existing) {
    const term = cleanText(raw, 200);
    if (term.length < 2) return { error: 'A watch term needs at least 2 characters.' };
    if (term.length > 64) return { error: 'A watch term can be at most 64 characters.' };
    if (existing.length >= 40) return { error: 'The limit is 40 custom terms. Remove one first.' };
    if (existing.some(x => x.toLowerCase() === term.toLowerCase())) return { error: 'That term is already on the watch list.' };
    return { term };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      safeUrl, cleanText, normItem, mergeItems, applyUpdate, filterItems, collapseStories, visibleRows,
      viewCounts, statusLabel, fmtAge, fmtClock, connectionState, bucketStats, sourceState, sortSources,
      validOfficial, stateRows, normWatch, checkTerm, MAX_ITEMS, MAX_ROWS, HB_LIVE_SEC, SNAP_STALE_SEC, SUPABASE_SRI
    };
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // ── DOM helpers ──

  // Every node in this feature is built here. Text goes in as text nodes, so feed data
  // cannot be interpreted as markup. href and src are refused so that no future edit can
  // route a feed URL around safeUrl: see extLink().
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false || k === 'href' || k === 'src') continue;
        if (k === 'class') el.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }

  function add(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(k => add(el, k)); return; }
    el.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k of Object.keys(attrs || {})) el.setAttribute(k, String(attrs[k]));
    return el;
  }

  function setText(el, s) {
    if (el.textContent !== s) el.textContent = s;
  }

  // The one place an anchor to the outside world is created. Without a safe URL the
  // text is still shown, as plain text.
  function extLink(url, cls, text) {
    const safe = safeUrl(url);
    if (!safe) return h('span', { class: cls }, text);
    const a = h('a', { class: cls, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }, text);
    a.href = safe;
    return a;
  }

  function ensureCss() {
    if (document.querySelector('link[href*="bdoc-wire.css"]')) return null;
    const link = h('link', { rel: 'stylesheet' });
    link.href = CSS_HREF;
    document.head.appendChild(link);
    return link;
  }

  // Convenience only (which sections are open, whether notifications are on). It can
  // come back empty, so nothing depends on it.
  const PREF_KEY = 'bdoc_wire_prefs';
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function savePrefs(p) {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (_) {}
  }

  // ── State ──

  let S = null;            // one watch at a time, or null when closed
  const P = { host: null, client: null, view: '', signingIn: false, userSignOut: false, overlay: null };
  const countFns = new Set();
  let lastCount = 0;

  function newState(opts) {
    const prefs = loadPrefs();
    return {
      mode: opts.embedded ? 'panel' : 'page',
      client: opts.client,
      flyTo: typeof opts.flyTo === 'function' ? opts.flyTo : null,
      prefs,
      ac: new AbortController(),
      startedAt: Date.now(),
      items: [],
      watch: [],
      health: null,
      stats: null,
      official: null,
      hb: null,
      lastHb: 0,
      topic: '',
      chan: null,
      chanTopic: '',
      chanGen: 0,
      chanFails: 0,
      chanTimer: 0,
      chanRetryAt: 0,
      sock: 'none',          // none | connecting | open | closed
      sockOpenAt: 0,
      pulling: false,
      pollTimer: 0,
      fetchCtl: null,
      pathDown: false,
      failCount: 0,
      lastKind: null,        // outcome of the most recent GET
      lastStatus: 0,
      lastDetail: '',
      lastOkAt: 0,
      lastPullAt: 0,
      snapState: 'unknown',  // unknown | none | empty | ok
      snapAgeBase: 0,
      snapAt: 0,
      recentUpd: [],
      filter: { view: 'signal', cats: new Set(), q: '', minSev: null },
      rows: new Map(),
      shown: [],
      visible: new Set(),
      fresh: new Set(),
      openStories: new Set(),
      alerted: new Set(),
      matched: 0,
      frozen: false,
      newCount: 0,
      raf: 0,
      flushTimer: 0,
      tickTimer: 0,
      io: null,
      el: null,
      root: null,
      sectionsOpen: Object.assign({ state: false, watch: false, sources: false }, prefs.sections),
      srcAll: false,
      watchBusy: false,
      watchErr: '',
      toneOn: false,
      audio: null,
      lastTone: 0,
      notifyOn: !!prefs.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted',
      notifyNote: '',
      ds: null,
      marks: new Map(),
      cesRight: null,
      authSub: null
    };
  }

  // ── Data path ──

  async function currentToken(st) {
    const res = await st.client.auth.getSession();
    const sess = res && res.data && res.data.session;
    return sess ? sess.access_token : null;
  }

  async function callWire(st, token) {
    const ctl = new AbortController();
    st.fetchCtl = ctl;
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(WIRE_URL, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // One GET, reduced to a plain outcome, so exactly one place turns results into UI state.
  async function pullWire(st) {
    let res;
    try {
      const token = await currentToken(st);
      if (!token) return { kind: 'nosession' };
      res = await callWire(st, token);
      if (res.status === 401) {
        // The token can lapse between getSession and the function. Refresh once before
        // telling the owner the session is gone.
        const r = await st.client.auth.refreshSession();
        const fresh = r && r.data && r.data.session;
        if (!fresh) {
          const msg = r && r.error && r.error.message ? r.error.message : '';
          return /fetch|network|timeout/i.test(msg) ? { kind: 'net' } : { kind: 'expired' };
        }
        res = await callWire(st, fresh.access_token);
      }
    } catch (_) {
      return { kind: 'net' };
    }
    if (res.status === 401) return { kind: 'expired' };
    if (res.status === 403) return { kind: 'forbidden' };
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail = body ? cleanText(body.error, 80) : '';
      return { kind: res.status === 503 ? 'unavailable' : 'http', status: res.status, detail };
    }
    try {
      const body = await res.json();
      return body && typeof body === 'object' ? { kind: 'ok', body } : { kind: 'bad' };
    } catch (_) {
      return { kind: 'bad' };
    }
  }

  async function reconcile() {
    const st = S;
    if (!st || st.pulling) return;
    st.pulling = true;
    clearTimeout(st.pollTimer);
    const out = await pullWire(st);
    st.pulling = false;
    if (st !== S) return;            // closed while the request was out
    st.lastPullAt = Date.now();
    if (out.kind === 'forbidden') { denied(); return; }
    if (st.mode === 'page' && !st.el) {
      if (out.kind === 'expired' || out.kind === 'nosession') {
        teardown();
        gate('signedout', 'Sign in to open the wire.');
        return;
      }
      mountShell();
      clearGate();
    }
    applyPull(st, out);
    schedulePoll();
  }

  function applyPull(st, out) {
    st.lastKind = out.kind;
    st.lastStatus = out.status || 0;
    st.lastDetail = out.detail || '';
    if (out.kind === 'ok') {
      st.pathDown = false;
      st.failCount = 0;
      st.lastOkAt = Date.now();
      ingest(st, out.body);
      ensureChannel(st);
    } else {
      st.pathDown = true;
      st.failCount++;
    }
    tick();
    schedule();
  }

  function schedulePoll() {
    const st = S;
    if (!st) return;
    clearTimeout(st.pollTimer);
    const wait = st.pathDown
      ? Math.min(5000 * Math.pow(2, Math.max(0, st.failCount - 1)), POLL_DOWN_MS)
      : (socketHealthy(st) ? POLL_MS : POLL_DOWN_MS);
    st.pollTimer = setTimeout(reconcile, wait);
  }

  function socketHealthy(st) {
    return st.sock === 'open' && !!st.lastHb && Date.now() - st.lastHb <= HB_LIVE_SEC * 1000;
  }

  function ingest(st, body) {
    const now = Date.now();
    if (typeof body.topic === 'string' && body.topic) st.topic = body.topic;
    const watch = normWatch(body.watch);
    if (!sameList(watch, st.watch)) {
      st.watch = watch;
      paintChips();
      renderWatch();
    }
    const snap = body.snapshot && typeof body.snapshot === 'object' ? body.snapshot : null;
    if (!snap) {
      st.snapState = 'none';
      st.snapAt = 0;
      return;
    }
    const raw = Array.isArray(snap.items) ? snap.items.slice(0, MAX_ITEMS) : [];
    st.snapState = raw.length ? 'ok' : 'empty';
    // The function computes ageSec on its own clock, which is immune to laptop clock skew.
    const age = Number(body.ageSec);
    const ts = Number(snap.ts);
    st.snapAgeBase = body.ageSec !== null && Number.isFinite(age) ? Math.max(0, age)
      : Number.isFinite(ts) && ts > 0 ? Math.max(0, (now - ts) / 1000) : 0;
    st.snapAt = now;
    // Polling is a delivery path too: in DEGRADED, this is how new items arrive. The very
    // first snapshot is backlog, not news, so it neither flashes nor counts.
    const known = st.items.length ? new Set(st.items.map(i => i.id)) : null;
    const clean = [];
    for (const r of raw) {
      const it = normItem(r, now);
      if (!it) continue;
      clean.push(it);
      if (known && !known.has(it.id)) st.fresh.add(it.id);
    }
    let items = mergeItems(st.items, clean);
    // A snapshot can be up to 60 s older than a live status update. Replay those so the
    // reconcile does not walk a story back from corroborated to reported until the next one.
    const snapMoment = now - st.snapAgeBase * 1000;
    st.recentUpd = st.recentUpd.filter(u => now - u.at < 300000);
    const replay = st.recentUpd.filter(u => u.at > snapMoment).map(u => u.upd);
    if (replay.length) items = applyUpdate(items, replay);
    st.items = items;
    st.health = snap.health && typeof snap.health === 'object' ? snap.health : st.health;
    st.stats = snap.stats && typeof snap.stats === 'object' ? snap.stats : st.stats;
    if (st.stats && st.stats.official && typeof st.stats.official === 'object') st.official = st.stats.official;
    renderRail();
  }

  function ensureChannel(st) {
    if (!st.topic) return;
    if (st.chan && st.chanTopic === st.topic) return;
    dropChannel(st);
    connectChannel(st);
  }

  function connectChannel(st) {
    if (st !== S || st.chan || !st.topic) return;
    const gen = ++st.chanGen;
    const mine = () => st === S && gen === st.chanGen;
    st.sock = 'connecting';
    st.chanTopic = st.topic;
    try {
      const ch = st.client.channel(st.topic, { config: { broadcast: { self: false, ack: false } } });
      ch.on('broadcast', { event: 'b' }, m => { if (mine()) onBatch(st, m && m.payload); });
      ch.on('broadcast', { event: 'hb' }, m => { if (mine()) onHeartbeat(st, m && m.payload); });
      st.chan = ch;
      ch.subscribe(status => { if (mine()) onChannelStatus(st, status); });
    } catch (e) {
      console.warn('[wire] channel failed:', e && e.message);
      onChannelStatus(st, 'CHANNEL_ERROR');
    }
  }

  // Bumps the generation FIRST: removeChannel fires CLOSED on the old channel, and that
  // callback must not schedule a reconnect for a channel we are retiring on purpose.
  function dropChannel(st) {
    st.chanGen++;
    const ch = st.chan;
    st.chan = null;
    if (ch) {
      try {
        const r = st.client.removeChannel(ch);
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (_) {}
    }
  }

  function onChannelStatus(st, status) {
    if (status === 'SUBSCRIBED') {
      const wasDown = st.sock === 'closed';
      st.sock = 'open';
      st.sockOpenAt = Date.now();
      st.chanFails = 0;
      // supabase-js can rejoin by itself before our timer fires. Drop the timer, or it
      // tears down a channel that just recovered.
      clearTimeout(st.chanTimer);
      st.chanTimer = 0;
      st.chanRetryAt = 0;
      if (wasDown) reconcile();      // fill the gap the outage left
      return;
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      st.sock = 'closed';
      retryChannel(st);
    }
  }

  function retryChannel(st) {
    if (st.chanTimer || st !== S) return;
    const wait = Math.min(1000 * Math.pow(2, st.chanFails), 30000) * (0.8 + Math.random() * 0.4);
    st.chanFails++;
    st.chanRetryAt = Date.now() + wait;
    st.chanTimer = setTimeout(() => {
      st.chanTimer = 0;
      st.chanRetryAt = 0;
      if (st !== S) return;
      dropChannel(st);
      connectChannel(st);
    }, wait);
  }

  // A "joined" socket can be dead (laptop lid, phone lock). Only a heartbeat proves it.
  // This runs only while a fresh snapshot proves the collector is up: when the collector
  // is the thing that died, the socket is fine and a reconnect loop would be a false alarm.
  function watchdog(st, c, now) {
    if (st.sock !== 'open' || c.state !== 'degraded') return;
    if (now - Math.max(st.lastHb, st.sockOpenAt) > WATCHDOG_SEC * 1000) {
      st.sock = 'closed';
      retryChannel(st);
    }
  }

  function onHeartbeat(st, p) {
    st.lastHb = Date.now();
    if (p && typeof p === 'object') {
      st.hb = p;
      if (p.official && typeof p.official === 'object') {
        const next = Object.assign({}, st.official);
        for (const k of ['ntas', 'faa', 'nws', 'usgs']) if (validOfficial(k, p.official[k])) next[k] = p.official[k];
        st.official = next;
        renderState();
      }
    }
    // One blink per real heartbeat, so the dot is evidence rather than decoration.
    if (st.el && st.el.connDot.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      st.el.connDot.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
    }
    tick();
  }

  function onBatch(st, p) {
    if (!p || typeof p !== 'object') return;
    const now = Date.now();
    const clean = [];
    for (const r of (Array.isArray(p.items) ? p.items.slice(0, MAX_BATCH) : [])) {
      const it = normItem(r, now);
      if (it) clean.push(it);
    }
    const upd = Array.isArray(p.upd) ? p.upd.slice(0, MAX_BATCH).filter(u => u && typeof u.c === 'string') : [];
    if (clean.length) {
      for (const it of clean) st.fresh.add(it.id);
      st.items = mergeItems(st.items, clean);
    }
    if (upd.length) {
      for (const u of upd) st.recentUpd.push({ at: now, upd: u });
      if (st.recentUpd.length > 500) st.recentUpd.splice(0, st.recentUpd.length - 500);
      st.items = applyUpdate(st.items, upd);
    }
    alertCritical(st, clean, upd);
    schedule();
  }

  // ── Render: feed ──

  // rAF batches a burst into one reconcile. The timer is a floor, not the path: browsers
  // stop frames for an occluded window while document.hidden stays false, and a live
  // header above a list that silently stopped updating is the worst failure this page has.
  function schedule() {
    const st = S;
    if (!st || st.raf) return;
    st.raf = requestAnimationFrame(flush);
    st.flushTimer = setTimeout(flush, FLUSH_FLOOR_MS);
  }

  function flush() {
    const st = S;
    if (!st) return;
    cancelAnimationFrame(st.raf);
    clearTimeout(st.flushTimer);
    st.raf = 0;
    st.flushTimer = 0;
    if (!st.el) return;
    // Read the real position here rather than trusting the last scroll event, which can
    // be a frame behind. Getting this wrong moves the row the owner is reading.
    st.frozen = isScrolledDown();
    const matched = visibleRows(st.items, st.filter);
    st.matched = matched.length;
    const next = matched.length > MAX_ROWS ? matched.slice(0, MAX_ROWS) : matched;
    if (st.frozen) {
      // Scrolled down: nothing moves. Rows repaint in place, the count says what is waiting.
      // "New" means it arrived while frozen. A timestamp cannot answer that: one row
      // stamped in the future would hide every real arrival behind it.
      let waiting = 0;
      for (const it of matched) {
        const row = st.rows.get(it.id);
        if (row) { if (row._w.it !== it) repaintRow(row, it); }
        else if (st.fresh.has(it.id)) waiting++;
      }
      setNewCount(waiting);
    } else {
      reconcileRows(next);
      setNewCount(0);
    }
    paintCounts();
    paintEmpty();
    syncMarkers(st);
    emitCount();
  }

  function dropRow(st, id, row) {
    if (st.io) st.io.unobserve(row);
    st.visible.delete(row);
    st.rows.delete(id);
    row.remove();
  }

  // Keyed reconcile. Removals go first, otherwise one removal at the top makes the walk
  // below move every later row. Most flushes end up as one or two insertions.
  function reconcileRows(next) {
    const st = S;
    const list = st.el.rows;
    const keep = new Set();
    for (const it of next) keep.add(it.id);
    st.rows.forEach((row, id) => { if (!keep.has(id)) dropRow(st, id, row); });
    let cursor = list.firstChild;
    for (const it of next) {
      let row = st.rows.get(it.id);
      if (!row) {
        row = makeRow(it, st.fresh.has(it.id));
        st.rows.set(it.id, row);
        if (st.io) st.io.observe(row);
        list.insertBefore(row, cursor);
        continue;
      }
      if (row._w.it !== it) {
        const was = row;
        row = repaintRow(row, it);
        if (cursor === was) cursor = row;
      }
      if (row === cursor) cursor = cursor.nextSibling;
      else list.insertBefore(row, cursor);
    }
    st.fresh.clear();
    st.shown = next;
  }

  function tagNodes(it) {
    const out = [];
    for (const w of it.w) out.push(h('span', { class: 'bw-tag bw-tag-w' }, w.indexOf('custom:') === 0 ? w.slice(7) : w.toUpperCase()));
    for (const c of it.cat) out.push(h('span', { class: 'bw-tag' }, c.toUpperCase()));
    return out;
  }

  function makeRow(it, isNew) {
    const word = h('span', { class: 'bw-r-word' });
    const sev = h('span', { class: 'bw-r-sev' });
    const more = h('span', { class: 'bw-r-n' });
    const age = h('span', { class: 'bw-r-age' }, fmtAge((Date.now() - it.t) / 1000));
    // An old story recirculating is how rumors get legs, so a late sighting says so.
    const late = !it.fresh && it.pt ? h('span', { class: 'bw-r-old' }, 'PUB ' + fmtAge((it.t - it.pt) / 1000) + ' EARLIER') : null;
    const row = h('article', { class: 'bw-row' + (isNew ? ' bw-row-new' : ''), tabindex: '0' },
      h('time', { class: 'bw-r-t', datetime: new Date(it.t).toISOString() }, fmtClock(it.t)),
      age,
      h('span', { class: 'bw-r-st' }, h('span', { class: 'bw-dot', 'aria-hidden': 'true' }), word),
      extLink(it.u, 'bw-r-h', it.h),
      h('div', { class: 'bw-r-foot' },
        h('span', { class: 'bw-r-src' }, it.sn),
        h('div', { class: 'bw-r-end' }, sev, tagNodes(it), more, late)));
    row._w = { it, word, sev, more, age, detail: null };
    paintRow(row, it);
    if (S.openStories.has(it.c)) openDetail(row);
    return row;
  }

  function paintRow(row, it) {
    const w = row._w;
    w.it = it;
    row.dataset.sev = String(it.sev);
    row.dataset.st = it.st;
    setText(w.word, statusLabel(it.st));
    setText(w.sev, it.sev === 3 ? 'CRITICAL' : it.sev === 2 ? 'HIGH' : '');
    setText(w.more, it.n > 1 ? '+' + (it.n - 1) + (it.n === 2 ? ' OUTLET' : ' OUTLETS') : '');
  }

  // Status changes patch the row in place. Anything else (rare) rebuilds that one row.
  function repaintRow(row, it) {
    const was = row._w.it;
    if (was.h === it.h && was.u === it.u && was.x === it.x && sameList(was.cat, it.cat) && sameList(was.w, it.w)) {
      paintRow(row, it);
      return row;
    }
    const st = S;
    const next = makeRow(it, false);
    row.replaceWith(next);
    if (st.io) { st.io.unobserve(row); st.io.observe(next); }
    st.visible.delete(row);
    st.rows.set(it.id, next);
    return next;
  }

  function otherOutlets(it) {
    const seen = new Set();
    const out = [];
    for (const o of S.items) {
      if (o.c !== it.c || o.id === it.id) continue;
      if (seen.has(o.sn)) continue;
      seen.add(o.sn);
      out.push(o);
      if (out.length >= 12) break;
    }
    return out;
  }

  function storyGeo(it) {
    if (it.geo) return it.geo;
    const o = S.items.find(x => x.c === it.c && x.geo);
    return o ? o.geo : null;
  }

  function openDetail(row) {
    const w = row._w;
    const it = w.it;
    const lines = [];
    if (it.x) lines.push(h('p', { class: 'bw-d-x' }, it.x));
    const geo = storyGeo(it);
    const facts = [
      ['SEEN', fmtClock(it.t)],
      ['PUBLISHED', it.pt ? fmtClock(it.pt) : 'NOT GIVEN'],
      ['CLASS', it.cls.toUpperCase()],
      ['SOURCE ID', it.src || '—'],
      ['PLACE', geo ? (geo.p || 'UNNAMED') + ' ' + geo.lat.toFixed(2) + ', ' + geo.lon.toFixed(2) : 'NONE'],
      ['LINK', it.u ? new URL(it.u).hostname : 'NO SAFE LINK']
    ];
    lines.push(h('dl', { class: 'bw-d-f' }, facts.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])));
    const others = otherOutlets(it);
    if (others.length) {
      lines.push(h('div', { class: 'bw-d-t' }, 'ALSO IN THIS STORY'));
      lines.push(h('ul', { class: 'bw-d-o' }, others.map(o => h('li', null,
        h('span', { class: 'bw-d-os' }, fmtClock(o.t) + ' ' + o.sn), extLink(o.u, 'bw-d-oh', o.h)))));
    }
    if (geo && canFly()) {
      lines.push(h('button', { class: 'bw-btn', type: 'button', onclick: e => { e.stopPropagation(); fly(geo, it); } }, 'LOCATE ON GLOBE'));
    }
    w.detail = h('div', { class: 'bw-d' }, lines);
    row.appendChild(w.detail);
    row.setAttribute('aria-expanded', 'true');
  }

  function toggleDetail(row) {
    const w = row._w;
    if (w.detail) {
      w.detail.remove();
      w.detail = null;
      S.openStories.delete(w.it.c);
      row.setAttribute('aria-expanded', 'false');
      return;
    }
    S.openStories.add(w.it.c);
    openDetail(row);
  }

  function canFly() {
    return !!S.flyTo || !!(window.V && window.V.camera && window.Cesium);
  }

  function fly(geo, it) {
    const clean = { p: geo.p, lat: geo.lat, lon: geo.lon, r: geo.r, cc: geo.cc };
    if (S.flyTo) {
      try { S.flyTo(clean, it); } catch (e) { console.warn('[wire] flyTo failed:', e && e.message); }
      return;
    }
    if (!window.V || !window.V.camera || !window.Cesium) return;
    try {
      const height = Math.min(Math.max((geo.r || 50000) * 8, 40000), 2500000);
      window.V.camera.flyTo({ destination: window.Cesium.Cartesian3.fromDegrees(geo.lon, geo.lat, height), duration: 1.6 });
    } catch (e) {
      console.warn('[wire] camera flyTo failed:', e && e.message);
    }
  }

  function onListClick(e) {
    const t = e.target;
    if (!t.closest || t.closest('a,button')) return;
    const row = t.closest('.bw-row');
    if (!row) return;
    const sel = window.getSelection ? String(window.getSelection()) : '';
    if (sel) return;                // selecting text to copy is not a click on the row
    toggleDetail(row);
    const geo = storyGeo(row._w.it);
    if (geo && canFly()) fly(geo, row._w.it);
  }

  function onListKey(e) {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.classList || !e.target.classList.contains('bw-row')) return;
    e.preventDefault();
    toggleDetail(e.target);
  }

  function isScrolledDown() {
    const el = S.el;
    // The wide layout scrolls the list; the narrow layout scrolls the whole body.
    return Math.max(el.list.scrollTop, el.body.scrollTop - el.listWrap.offsetTop) > FREEZE_PX;
  }

  // Back at the top, whatever was held can go in. Going down needs nothing here: flush()
  // reads the position itself, and scroll events are already frame-aligned.
  function onScroll() {
    const st = S;
    if (st && st.el && st.frozen && !isScrolledDown()) schedule();
  }

  function toTop() {
    const el = S.el;
    el.list.scrollTop = 0;
    if (el.body.scrollTop > el.listWrap.offsetTop) el.body.scrollTop = el.listWrap.offsetTop;
  }

  function setNewCount(n) {
    const st = S;
    if (n === st.newCount) return;
    st.newCount = n;
    st.el.newBtn.hidden = n === 0;
    setText(st.el.newBtn, n + ' NEW. BACK TO TOP');
  }

  function paintCounts() {
    const st = S;
    const counts = viewCounts(st.items);
    for (const v of VIEW_ORDER) setText(st.el.viewCount[v], String(counts[v]));
    const over = st.matched > MAX_ROWS;
    st.el.end.hidden = !over;
    if (over) setText(st.el.end, 'SHOWING NEWEST ' + MAX_ROWS + ' OF ' + st.matched + '. NARROW THE FILTERS TO REACH THE REST.');
  }

  function filtersActive() {
    const f = S.filter;
    return f.cats.size > 0 || !!f.q || f.minSev !== null;
  }

  function clearFilters() {
    const st = S;
    st.filter.cats.clear();
    st.filter.q = '';
    st.filter.minSev = null;
    st.el.search.value = '';
    paintChips();
    paintSev();
    renderWatch();
    filterChanged();
  }

  function paintEmpty() {
    const st = S;
    const el = st.el;
    let msg = '';
    let canClear = false;
    if (!st.matched) {
      if (st.items.length) {
        msg = 'NOTHING IN ' + VIEW_LABEL[st.filter.view] + ' MATCHES RIGHT NOW. ' + st.items.length + ' ITEMS ARE HELD IN ALL.';
        canClear = filtersActive();
      } else if (st.lastKind === null) msg = 'LOADING SNAPSHOT';
      else if (st.lastKind !== 'ok') msg = 'NO DATA TO SHOW. THE STATUS ABOVE SAYS WHY.';
      else if (st.snapState === 'none') msg = 'NO SNAPSHOT HAS BEEN RECEIVED YET.';
      else msg = 'THE SNAPSHOT IS EMPTY. THE COLLECTOR POSTED 0 ITEMS.';
    }
    el.empty.hidden = !msg;
    setText(el.emptyMsg, msg);
    el.emptyClear.hidden = !canClear;
  }

  function filterChanged() {
    const st = S;
    toTop();
    st.fresh.clear();
    flush();                        // synchronous: a filter change must feel instant
  }

  // ── Render: header and banners ──

  function connNow(st, now) {
    return connectionState({
      now,
      lastHb: st.lastHb,
      snapAgeSec: st.snapAt ? st.snapAgeBase + (now - st.snapAt) / 1000 : null,
      pathDown: st.pathDown || navigator.onLine === false,
      startedAt: st.startedAt
    });
  }

  function hbPhrase(c) {
    if (c.hbAge !== null) return 'LAST HEARTBEAT ' + fmtAge(c.hbAge) + ' AGO';
    // Heartbeats live only in this tab. After a reload the snapshot is the best proof
    // of when the collector was last alive, and it is labelled as what it is.
    return c.snapAge !== null ? 'NO HEARTBEAT YET, SNAPSHOT ' + fmtAge(c.snapAge) + ' OLD' : 'NO HEARTBEAT YET';
  }

  function connDetail(st, c) {
    if (c.state === 'live') return 'HB ' + fmtAge(c.hbAge);
    if (c.state === 'connecting') return st.sock === 'open' ? 'WAITING FOR HEARTBEAT' : 'JOINING';
    if (c.state === 'degraded') return 'POLLING. ' + hbPhrase(c);
    return hbPhrase(c);
  }

  function meters(st, now) {
    if (st.hb && st.lastHb && now - st.lastHb <= HB_LIVE_SEC * 1000) {
      return { ok: st.hb.ok, total: st.hb.total, rate: st.hb.items1m };
    }
    const srcs = st.health && Array.isArray(st.health.sources) ? st.health.sources : null;
    return {
      ok: srcs ? srcs.filter(s => s && s.ok === true).length : null,
      total: srcs ? srcs.length : null,
      rate: st.stats ? st.stats.items1m : null
    };
  }

  function showNum(v) {
    return typeof v === 'number' && Number.isFinite(v) ? String(v) : '—';
  }

  function renderConn(st, now) {
    const c = connNow(st, now);
    const el = st.el;
    const word = statusLabel(c.state);
    setText(el.connWord, word);
    setText(el.connDetail, connDetail(st, c));
    el.conn.dataset.s = c.state;
    const m = meters(st, now);
    setText(el.src, 'SRC ' + showNum(m.ok) + '/' + showNum(m.total));
    setText(el.rate, showNum(m.rate) + '/MIN');
    if (st.mode === 'page') {
      const title = word + ' · BDOC Wire';
      if (document.title !== title) document.title = title;
    }
    return c;
  }

  function httpReason(st) {
    return 'HTTP ' + st.lastStatus + (st.lastDetail ? ': ' + st.lastDetail : '');
  }

  // Every failure state has a line that says what is wrong in words. Order is severity.
  function bannerList(st, c, now) {
    const out = [];
    const lastOk = st.lastOkAt ? fmtAge((now - st.lastOkAt) / 1000) + ' ago' : '';
    const retry = { label: 'RETRY', fn: retryNow };
    const signin = { label: 'SIGN IN', fn: promptSignIn };
    if (st.lastKind === 'expired') {
      out.push({ k: 'expired', lvl: 'crit', text: 'SESSION EXPIRED. ' + (lastOk ? 'The feed stopped updating ' + lastOk + '. ' : '') + 'Sign in to resume.', act: signin });
    } else if (st.lastKind === 'nosession') {
      out.push({ k: 'nosession', lvl: 'crit', text: 'NOT SIGNED IN. Sign in to resume the feed.', act: signin });
    } else if (st.lastKind === 'net' || navigator.onLine === false) {
      out.push({ k: 'net', lvl: 'crit', text: 'NETWORK DOWN. ' + (lastOk ? 'Last reached the wire function ' + lastOk + '. ' : 'The wire function has not answered this session. ') + 'Retrying.', act: retry });
    } else if (st.lastKind === 'unavailable') {
      out.push({ k: 'unavailable', lvl: 'crit', text: 'WIRE FUNCTION UNAVAILABLE (' + httpReason(st) + '). Retrying.', act: retry });
    } else if (st.lastKind === 'http') {
      out.push({ k: 'http', lvl: 'crit', text: 'WIRE FUNCTION ERROR (' + httpReason(st) + '). Retrying.', act: retry });
    } else if (st.lastKind === 'bad') {
      out.push({ k: 'bad', lvl: 'crit', text: 'THE WIRE FUNCTION RETURNED SOMETHING UNREADABLE. Retrying.', act: retry });
    }
    if (c.state === 'offline') {
      const age = c.hbAge !== null && c.snapAge !== null ? ' Newest snapshot is ' + fmtAge(c.snapAge) + ' old.' : '';
      out.push({ k: 'offline', lvl: 'crit', text: 'COLLECTOR OFFLINE. ' + hbPhrase(c) + '.' + age + ' Everything below is last known state, not current.' });
    }
    if (st.lastKind === 'ok') {
      if (st.snapState === 'none') {
        out.push({ k: 'nosnap', lvl: 'warn', text: 'NO SNAPSHOT. The function has nothing stored from the collector yet.' });
      } else if (st.snapState === 'empty') {
        out.push({ k: 'empty', lvl: 'warn', text: 'EMPTY SNAPSHOT. The collector posted 0 items.' });
      }
      if (c.state === 'live' && c.snapAge !== null && c.snapAge > SNAP_STALE_SEC) {
        out.push({ k: 'stale', lvl: 'warn', text: 'SNAPSHOT ' + fmtAge(c.snapAge) + ' OLD. Heartbeats are arriving, but snapshot posts are failing, so the rail may be behind the feed.' });
      }
      if (!st.topic) {
        out.push({ k: 'notopic', lvl: 'warn', text: 'NO REALTIME TOPIC CONFIGURED. Polling only, latency up to 90 s.' });
      }
    }
    if (st.sock === 'closed') {
      const secs = st.chanRetryAt ? Math.max(0, Math.ceil((st.chanRetryAt - now) / 1000)) : 0;
      out.push({ k: 'socket', lvl: 'warn', text: 'REALTIME SOCKET CLOSED. Reconnecting' + (secs ? ' in ' + secs + 's' : '') + '. Polling every 30 s until it returns.', act: retry });
    }
    return out;
  }

  function renderBanners(st, c, now) {
    const list = bannerList(st, c, now);
    const box = st.el.banners;
    const seen = new Set();
    for (const b of list) {
      seen.add(b.k);
      let row = box.querySelector('[data-k="' + b.k + '"]');
      if (!row) {
        const text = h('span', { class: 'bw-ban-t' });
        const act = b.act ? h('button', { class: 'bw-btn', type: 'button', onclick: b.act.fn }, b.act.label) : null;
        row = h('div', { class: 'bw-ban', 'data-k': b.k, 'data-lvl': b.lvl }, text, act);
        box.appendChild(row);
      }
      setText(row.firstChild, b.text);
    }
    for (const row of Array.from(box.children)) if (!seen.has(row.dataset.k)) row.remove();
    box.hidden = !list.length;
  }

  function tick() {
    const st = S;
    if (!st || !st.el) return;
    const now = Date.now();
    setText(st.el.clock, fmtClock(now));
    const c = renderConn(st, now);
    renderBanners(st, c, now);
    if (!document.hidden) {
      // Only rows on screen: 400 text writes a second would be a reflow generator.
      st.visible.forEach(row => setText(row._w.age, fmtAge((now - row._w.it.t) / 1000)));
    }
    watchdog(st, c, now);
  }

  function retryNow() {
    const st = S;
    if (!st) return;
    reconcile();
    if (st.sock === 'closed') {
      clearTimeout(st.chanTimer);
      st.chanTimer = 0;
      st.chanRetryAt = 0;
      dropChannel(st);
      connectChannel(st);
    }
  }

  function promptSignIn() {
    const st = S;
    if (st && st.mode === 'page') gate('signedout', 'Your session expired. Sign in to resume the feed.');
    else if (window.BDOC_Auth && typeof window.BDOC_Auth.showModal === 'function') window.BDOC_Auth.showModal();
  }

  // ── Render: rail ──

  function renderRail() {
    renderState();
    renderWatch();
    renderSources();
  }

  function renderState() {
    const st = S;
    if (!st || !st.el) return;
    const rows = stateRows(st.official, st.health && st.health.sources);
    st.el.stateRows.replaceChildren(...rows.map(r => h('div', { class: 'bw-kv' },
      h('span', { class: 'bw-kv-k' }, r.k),
      h('span', { class: 'bw-kv-v', 'data-tone': r.tone }, h('span', { class: 'bw-dot', 'aria-hidden': 'true' }), r.v),
      r.sub ? h('span', { class: 'bw-kv-s' }, r.sub) : null)));
    setText(st.el.secSum.state, rows.map(r => r.s).join(' · '));
  }

  function sparkline(series, label, readout, restValue) {
    const W = 120;
    const H = 20;
    const svg = svgEl('svg', { class: 'bw-spark', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', role: 'img', 'aria-label': label });
    const n = series.length;
    const step = W / 60;
    // A floor of 4 stops a single item in a quiet hour from drawing as a full-height spike.
    const max = Math.max(4, ...series);
    let older = '';
    let recent = '';
    series.forEach((v, i) => {
      if (!v) return;
      const x = (W - (n - i - 0.5) * step).toFixed(1);
      const y = (H - Math.max(2, (v / max) * (H - 1))).toFixed(1);
      const seg = 'M' + x + ' ' + H + 'V' + y;
      if (n - i <= 5) recent += seg; else older += seg;
    });
    svg.appendChild(svgEl('path', { class: 'bw-sp-base', d: 'M0 ' + (H - 0.5) + 'H' + W }));
    svg.appendChild(svgEl('path', { class: 'bw-sp-old', d: older || 'M0 0' }));
    svg.appendChild(svgEl('path', { class: 'bw-sp-cur', d: recent || 'M0 0' }));
    svg.addEventListener('pointermove', e => {
      const box = svg.getBoundingClientRect();
      if (!box.width || !n) return;
      const fromEnd = Math.floor((box.right - e.clientX) / (box.width / 60));
      const i = n - 1 - fromEnd;
      if (i >= 0 && i < n) setText(readout, '-' + fromEnd + 'M: ' + series[i]);
    });
    svg.addEventListener('pointerleave', () => setText(readout, restValue));
    return svg;
  }

  function perMinFor(key) {
    const pm = S.stats && S.stats.perMin;
    if (!pm || typeof pm !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(pm, key)) return pm[key];
    const low = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(pm, low) ? pm[low] : null;
  }

  function watchRow(key, label, custom) {
    const st = S;
    const tag = key.toLowerCase();
    const raw = perMinFor(key);
    const s = bucketStats(raw);
    const rest = raw ? s.rate.toFixed(1) + '/M' : '—';
    const rate = h('span', { class: 'bw-w-rate' }, rest);
    const on = st.filter.cats.has(tag);
    const main = h('button', {
      class: 'bw-w-main', type: 'button', 'aria-pressed': on ? 'true' : 'false',
      onclick: () => toggleCat(tag),
      title: raw ? s.total + ' in the last hour. Click to filter the feed.' : 'No data yet. Click to filter the feed.'
    },
      h('span', { class: 'bw-w-k' }, label),
      sparkline(s.series, label + ': ' + rest + ' per minute, ' + s.total + ' in the last hour', rate, rest),
      s.surge ? h('span', { class: 'bw-w-surge' }, 'SURGE') : null,
      rate);
    const row = h('div', { class: 'bw-w', 'data-surge': s.surge ? '1' : '0' }, main);
    if (custom) {
      row.appendChild(h('button', {
        class: 'bw-w-x', type: 'button', 'aria-label': 'Remove watch term ' + label,
        disabled: st.watchBusy, onclick: () => removeTerm(label)
      }, '✕'));
    }
    return { row, stats: s, label };
  }

  function renderWatch() {
    const st = S;
    if (!st || !st.el) return;
    const rows = BUCKETS.map(b => watchRow(b, b === 'nov4' ? 'NOV 4' : b.toUpperCase(), false));
    for (const term of st.watch) rows.push(watchRow('custom:' + term, term, true));
    st.el.watchRows.replaceChildren(...rows.map(r => r.row));
    const surging = rows.filter(r => r.stats.surge).map(r => r.label);
    const top = rows[0];
    setText(st.el.secSum.watch, surging.length
      ? 'SURGE ' + surging.slice(0, 3).join(' · ')
      : top.label + ' ' + top.stats.rate.toFixed(1) + '/M · ' + st.watch.length + ' CUSTOM');
    setText(st.el.termErr, st.watchErr);
    st.el.termErr.hidden = !st.watchErr;
    st.el.termBtn.disabled = st.watchBusy;
    st.el.termInput.disabled = st.watchBusy;
    setText(st.el.termBtn, st.watchBusy ? 'SAVING' : 'ADD');
  }

  function renderSources() {
    const st = S;
    if (!st || !st.el) return;
    const now = Date.now();
    const box = st.el.srcRows;
    const health = st.health;
    const list = sortSources(health && health.sources);
    const kids = [];
    const streams = health && health.streams && typeof health.streams === 'object' ? health.streams : {};
    for (const [name, label] of [['bsky', 'BLUESKY FIREHOSE'], ['wiki', 'WIKIMEDIA']]) {
      const s = streams[name];
      if (!s || typeof s !== 'object') continue;
      const age = typeof s.lastEvent === 'number' ? fmtAge((now - s.lastEvent) / 1000) + ' AGO' : '—';
      kids.push(h('div', { class: 'bw-src', 'data-s': s.ok ? 'ok' : 'down' },
        h('span', { class: 'bw-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'bw-src-n' }, label),
        h('span', { class: 'bw-src-m' }, (s.ok ? 'UP ' : 'DOWN ') + showNum(s.perMin) + '/MIN · ' + age)));
    }
    const tally = { down: 0, stale: 0, pending: 0, ok: 0 };
    const counted = list.map(s => {
      const state = sourceState(s);
      tally[state]++;
      return { s, state };
    });
    const drawn = st.srcAll ? counted : counted.filter((r, i) => r.state !== 'ok' || i < SOURCES_FOLDED);
    for (const { s, state } of drawn) {
      const last = Number(s.lastOk);
      const ago = t => fmtAge((now - t) / 1000) + ' AGO';
      let meta;
      if (state === 'down') meta = 'DOWN' + (Number(s.fails) > 0 ? ' ×' + Number(s.fails) : '') + (last > 0 ? ' · OK ' + ago(last) : '');
      else if (state === 'stale') meta = 'STALE' + (Number(s.newest) > 0 ? ' · NEWEST ' + fmtAge((now - Number(s.newest)) / 1000) + ' OLD' : '');
      else if (state === 'pending') meta = 'NOT POLLED YET';
      else meta = (Number.isFinite(Number(s.c1h)) ? s.c1h + '/H' : '') + (last > 0 ? ' · ' + ago(last) : '');
      kids.push(h('div', { class: 'bw-src', 'data-s': state, title: cleanText(s.err, 200) || null },
        h('span', { class: 'bw-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'bw-src-n' }, cleanText(s.n, 40) || cleanText(s.id, 40) || 'UNNAMED'),
        h('span', { class: 'bw-src-m' }, meta)));
    }
    box.replaceChildren(...kids);
    const hidden = counted.length - drawn.length;
    st.el.srcMore.hidden = !(hidden > 0 || st.srcAll) || counted.length <= SOURCES_FOLDED;
    setText(st.el.srcMore, st.srcAll ? 'SHOW FEWER' : 'SHOW ALL ' + counted.length);
    setText(st.el.secSum.sources, !list.length ? 'NO HEALTH DATA' :
      tally.ok + '/' + list.length + ' UP' + (tally.down ? ' · ' + tally.down + ' DOWN' : '') +
      (tally.stale ? ' · ' + tally.stale + ' STALE' : '') + (tally.pending ? ' · ' + tally.pending + ' PENDING' : ''));
  }

  function toggleSection(k) {
    const st = S;
    st.sectionsOpen[k] = !st.sectionsOpen[k];
    paintSections();
    st.prefs.sections = st.sectionsOpen;
    savePrefs(st.prefs);
  }

  function paintSections() {
    const st = S;
    for (const k of ['state', 'watch', 'sources']) {
      const on = !!st.sectionsOpen[k];
      st.el.sec[k].dataset.open = on ? '1' : '0';
      st.el.secBtn[k].setAttribute('aria-expanded', on ? 'true' : 'false');
    }
  }

  // ── Custom watch terms ──

  function addTerm(e) {
    e.preventDefault();
    const st = S;
    const check = checkTerm(st.el.termInput.value, st.watch);
    if (check.error) {
      st.watchErr = check.error;
      renderWatch();
      return;
    }
    postWatch(st.watch.concat(check.term));
  }

  function removeTerm(term) {
    const st = S;
    st.filter.cats.delete('custom:' + term.toLowerCase());
    postWatch(st.watch.filter(t => t !== term));
  }

  async function postWatch(terms) {
    const st = S;
    st.watchBusy = true;
    st.watchErr = '';
    renderWatch();
    let err = '';
    try {
      const token = await currentToken(st);
      if (!token) throw new Error('Not signed in.');
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(WIRE_URL + '?action=watch', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ terms }),
          cache: 'no-store',
          signal: ctl.signal
        });
      } finally {
        clearTimeout(timer);
      }
      const body = await res.json().catch(() => null);
      if (st !== S) return;
      if (!res.ok || !body || body.ok !== true) {
        const reason = body && typeof body.error === 'string' ? cleanText(body.error, 200) : '';
        throw new Error(reason || 'The server rejected the change (HTTP ' + res.status + ').');
      }
      st.watch = normWatch(body.watch);
      st.el.termInput.value = '';
      paintChips();
    } catch (e) {
      err = e && e.name === 'AbortError' ? 'The server did not answer in time. Nothing was saved.'
        : (e && e.message) || 'Could not save the watch list.';
    }
    if (st !== S) return;
    st.watchBusy = false;
    st.watchErr = err;
    renderWatch();
    filterChanged();
  }

  // ── Filters ──

  function toggleCat(tag) {
    const st = S;
    if (st.filter.cats.has(tag)) st.filter.cats.delete(tag);
    else st.filter.cats.add(tag);
    paintChips();
    renderWatch();
    filterChanged();
  }

  function setView(v) {
    const st = S;
    if (!VIEW_ORDER.includes(v)) return;
    st.filter.view = v;
    st.filter.minSev = null;       // a floor set on one view would blank another without warning
    paintViews();
    paintSev();
    filterChanged();
  }

  function setMinSev(n) {
    S.filter.minSev = n;
    paintSev();
    filterChanged();
  }

  function paintViews() {
    const st = S;
    for (const v of VIEW_ORDER) st.el.viewBtn[v].setAttribute('aria-pressed', st.filter.view === v ? 'true' : 'false');
  }

  function paintSev() {
    const st = S;
    const view = st.filter.view;
    const cur = st.filter.minSev === null ? VIEW_MIN_SEV[view] : st.filter.minSev;
    st.el.sevBtn.forEach((b, i) => {
      b.setAttribute('aria-pressed', i === cur ? 'true' : 'false');
      b.disabled = i === 0 && view === 'signal';  // SIGNAL is defined as sev 1 and up
    });
  }

  function paintChips() {
    const st = S;
    if (!st.el) return;
    const custom = st.watch.map(t => ['custom:' + t.toLowerCase(), t]);
    st.el.chips.replaceChildren(...CHIPS.concat(custom).map(([tag, label]) => h('button', {
      class: 'bw-chip', type: 'button', 'aria-pressed': st.filter.cats.has(tag) ? 'true' : 'false',
      onclick: () => toggleCat(tag)
    }, label)));
  }

  // ── Sev 3 alerts: tone and Notification, both off until the owner turns them on ──

  function paintAlerts() {
    const st = S;
    setText(st.el.toneBtn, 'TONE ' + (st.toneOn ? 'ON' : 'OFF'));
    st.el.toneBtn.setAttribute('aria-pressed', st.toneOn ? 'true' : 'false');
    setText(st.el.notifyBtn, 'NOTIFY ' + (st.notifyNote || (st.notifyOn ? 'ON' : 'OFF')));
    st.el.notifyBtn.setAttribute('aria-pressed', st.notifyOn ? 'true' : 'false');
  }

  function playTone(st) {
    const ctx = st.audio;
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      const at = ctx.currentTime;
      [0, 0.24].forEach(offset => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, at + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, at + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at + offset);
        osc.stop(at + offset + 0.18);
      });
    } catch (_) {}
  }

  function toggleTone() {
    const st = S;
    if (st.toneOn) {
      st.toneOn = false;
    } else {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        st.audio = st.audio || new AC();     // must happen inside this click: autoplay policy
        st.toneOn = true;
        playTone(st);
      } catch (_) {
        st.toneOn = false;
      }
    }
    paintAlerts();
  }

  async function toggleNotify() {
    const st = S;
    st.notifyNote = '';
    if (st.notifyOn) {
      st.notifyOn = false;
    } else if (typeof Notification === 'undefined') {
      st.notifyNote = 'UNSUPPORTED';
    } else {
      const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (st !== S) return;
      st.notifyOn = p === 'granted';
      if (!st.notifyOn) st.notifyNote = 'BLOCKED';
    }
    st.prefs.notify = st.notifyOn;
    savePrefs(st.prefs);
    paintAlerts();
  }

  function showNotification(it) {
    const title = 'BDOC WIRE CRITICAL · ' + statusLabel(it.st);
    const opts = { body: it.h, tag: 'bdoc-wire-' + it.c };
    try {
      const n = new Notification(title, opts);
      n.onclick = () => { window.focus(); n.close(); };
    } catch (_) {
      // Android Chrome refuses the constructor and insists on the service worker path.
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(r => r.showNotification(title, opts)).catch(() => {});
      }
    }
  }

  // Live arrivals and live status upgrades only. Snapshots never reach this, because
  // backlog never alerts (§0.5). Disputed and unverified stories never alert either.
  function alertCritical(st, items, upd) {
    if (!st.toneOn && !st.notifyOn) return;
    const hits = [];
    const seen = new Set();
    for (const it of items) if (it.sev === 3 && it.fresh) { hits.push(it); seen.add(it.c); }
    for (const u of upd) {
      if (Number(u.sev) !== 3 || seen.has(u.c)) continue;
      const it = st.items.find(x => x.c === u.c);
      if (it) { hits.push(it); seen.add(u.c); }
    }
    for (const it of hits) {
      if (it.st === 'disputed' || it.st === 'unverified' || st.alerted.has(it.c)) continue;
      st.alerted.add(it.c);
      if (st.notifyOn) showNotification(it);
      if (st.toneOn && Date.now() - st.lastTone > 10000) {
        st.lastTone = Date.now();
        playTone(st);
      }
    }
  }

  // ── Globe (panel only). Position and point, nothing else. ──

  const MARK_COLOR = { official: '#3FB950', corroborated: '#E6E9EE', reported: '#9BA1A8', unverified: '#E8B349', disputed: '#DA3633' };

  function syncMarkers(st) {
    if (st.mode !== 'panel' || !window.V || !window.Cesium) return;
    const C = window.Cesium;
    try {
      if (!st.ds) {
        // Its own data source keeps these out of V.entities, which File ▸ Export walks.
        st.ds = new C.CustomDataSource('bdoc-wire');
        window.V.dataSources.add(st.ds);
      }
      const want = new Map();
      for (const it of st.items) {
        if (it.sev < 2 || !it.geo || want.has(it.c)) continue;
        want.set(it.c, it);
        if (want.size >= MARKER_CAP) break;
      }
      st.marks.forEach((m, c) => {
        if (!want.has(c)) { st.ds.entities.remove(m.ent); st.marks.delete(c); }
      });
      want.forEach((it, c) => {
        const m = st.marks.get(c);
        if (m && m.st === it.st) return;
        if (m) st.ds.entities.remove(m.ent);
        const ent = st.ds.entities.add({
          position: C.Cartesian3.fromDegrees(it.geo.lon, it.geo.lat),
          point: {
            pixelSize: it.sev >= 3 ? 11 : 8,
            color: C.Color.fromCssColorString(MARK_COLOR[it.st] || MARK_COLOR.reported),
            outlineColor: C.Color.fromCssColorString('#0E1116'),
            outlineWidth: 1.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        });
        st.marks.set(c, { ent, st: it.st });
      });
      if (window.V.scene && typeof window.V.scene.requestRender === 'function') window.V.scene.requestRender();
    } catch (e) {
      console.warn('[wire] marker sync failed:', e && e.message);
    }
  }

  function clearMarkers(st) {
    if (!st.ds) return;
    try {
      if (window.V && window.V.dataSources) window.V.dataSources.remove(st.ds, true);
    } catch (e) {
      console.warn('[wire] marker removal failed:', e && e.message);
    }
    st.ds = null;
    st.marks.clear();
  }

  // ── Shell ──

  function buildSection(st, k, title, body) {
    const sum = h('span', { class: 'bw-sec-s' });
    const btn = h('button', { class: 'bw-sec-h', type: 'button', onclick: () => toggleSection(k) },
      h('span', { class: 'bw-sec-t' }, title), sum, h('span', { class: 'bw-sec-c', 'aria-hidden': 'true' }));
    const sec = h('section', { class: 'bw-sec' }, btn, h('div', { class: 'bw-sec-b' }, body));
    st.el.sec[k] = sec;
    st.el.secBtn[k] = btn;
    st.el.secSum[k] = sum;
    return sec;
  }

  function mountShell() {
    const st = S;
    const el = st.el = { sec: {}, secBtn: {}, secSum: {}, viewBtn: {}, viewCount: {} };
    const signal = st.ac.signal;

    el.clock = h('span', { class: 'bw-clock' }, fmtClock(Date.now()));
    el.connDot = h('span', { class: 'bw-dot', 'aria-hidden': 'true' });
    el.connWord = h('span', { class: 'bw-conn-w' }, 'CONNECTING');
    el.connDetail = h('span', { class: 'bw-conn-d' });
    el.conn = h('span', { class: 'bw-conn', role: 'status', 'data-s': 'connecting' }, el.connDot, el.connWord, el.connDetail);
    el.src = h('span', { class: 'bw-meter' });
    el.rate = h('span', { class: 'bw-meter' });

    const brand = h('a', { class: 'bw-mark', title: 'Back to BDOC' }, 'BDOC WIRE');
    brand.href = '/';
    const pop = h('a', { class: 'bw-hd-btn', target: '_blank', rel: 'noopener noreferrer' }, 'POP OUT');
    pop.href = '/wire';
    const actions = st.mode === 'panel'
      ? [pop, h('button', { class: 'bw-hd-btn bw-hd-x', type: 'button', 'aria-label': 'Close the wire panel', onclick: () => close() }, '✕')]
      : [h('button', { class: 'bw-hd-btn', type: 'button', onclick: signOut }, 'SIGN OUT')];
    const header = h('header', { class: 'bw-hd' }, brand,
      h('div', { class: 'bw-status' }, el.conn, el.src, el.rate),
      el.clock, h('div', { class: 'bw-hd-act' }, actions));

    const views = h('nav', { class: 'bw-views', 'aria-label': 'Feed views' }, VIEW_ORDER.map((v, i) => {
      el.viewCount[v] = h('span', { class: 'bw-view-n' }, '0');
      el.viewBtn[v] = h('button', { class: 'bw-view', type: 'button', title: 'Press ' + (i + 1), onclick: () => setView(v) }, VIEW_LABEL[v], ' ', el.viewCount[v]);
      return el.viewBtn[v];
    }));

    el.banners = h('div', { class: 'bw-bans', role: 'status' });
    el.banners.hidden = true;

    el.search = h('input', {
      class: 'bw-in bw-search', type: 'search', placeholder: 'Search', 'aria-label': 'Search the feed',
      autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search',
      oninput: () => { st.filter.q = el.search.value; toTop(); schedule(); }
    });
    el.sevBtn = ['ANY', '1+', '2+', '3'].map((label, i) => h('button', {
      class: 'bw-seg', type: 'button', title: i === 0 ? 'Any severity' : 'Severity ' + i + (i < 3 ? ' and up' : ' only'),
      onclick: () => setMinSev(i)
    }, label));
    el.chips = h('div', { class: 'bw-chips', role: 'group', 'aria-label': 'Category filters' });
    const tools = h('div', { class: 'bw-tools' },
      h('div', { class: 'bw-tools-a' }, el.search,
        h('div', { class: 'bw-segs', role: 'group', 'aria-label': 'Minimum severity' }, h('span', { class: 'bw-segs-k' }, 'SEV'), el.sevBtn)),
      el.chips);

    el.stateRows = h('div', { class: 'bw-kvs' });
    el.toneBtn = h('button', { class: 'bw-btn', type: 'button', onclick: toggleTone });
    el.notifyBtn = h('button', { class: 'bw-btn', type: 'button', onclick: toggleNotify });
    const stateBody = [el.stateRows, h('div', { class: 'bw-alerts' },
      h('span', { class: 'bw-alerts-k' }, 'SEV 3 ALERT'), el.toneBtn, el.notifyBtn)];

    el.watchRows = h('div', { class: 'bw-ws' });
    el.termInput = h('input', {
      class: 'bw-in', type: 'text', maxlength: '80', placeholder: 'Add a watch term', 'aria-label': 'Add a watch term',
      autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done'
    });
    el.termBtn = h('button', { class: 'bw-btn', type: 'submit' }, 'ADD');
    el.termErr = h('div', { class: 'bw-term-err', role: 'alert' });
    el.termErr.hidden = true;
    const watchBody = [el.watchRows, h('form', { class: 'bw-term', onsubmit: addTerm }, el.termInput, el.termBtn), el.termErr];

    el.srcRows = h('div', { class: 'bw-srcs' });
    el.srcMore = h('button', { class: 'bw-btn bw-src-more', type: 'button', onclick: () => { st.srcAll = !st.srcAll; renderSources(); } });
    el.srcMore.hidden = true;

    const rail = h('aside', { class: 'bw-rail', 'aria-label': 'Situation rail' },
      buildSection(st, 'state', 'STATE', stateBody),
      buildSection(st, 'watch', 'WATCH', watchBody),
      buildSection(st, 'sources', 'SOURCES', [el.srcRows, el.srcMore]));

    el.newBtn = h('button', { class: 'bw-new', type: 'button', onclick: () => { toTop(); schedule(); } });
    el.newBtn.hidden = true;
    el.rows = h('div', { class: 'bw-rows', role: 'feed', 'aria-label': 'Wire items' });
    el.emptyMsg = h('span');
    el.emptyClear = h('button', { class: 'bw-btn', type: 'button', onclick: clearFilters }, 'CLEAR FILTERS');
    el.emptyClear.hidden = true;
    el.empty = h('div', { class: 'bw-empty' }, el.emptyMsg, el.emptyClear);
    el.end = h('div', { class: 'bw-end' });
    el.end.hidden = true;
    el.list = h('div', { class: 'bw-list', onclick: onListClick, onkeydown: onListKey }, el.rows, el.empty, el.end);
    el.listWrap = h('div', { class: 'bw-listwrap' }, h('div', { class: 'bw-newwrap' }, el.newBtn), el.list);
    el.body = h('div', { class: 'bw-body' }, tools, rail, el.listWrap);

    const root = h('div', { class: 'bw ' + (st.mode === 'panel' ? 'bw-panel' : 'bw-page'), id: 'bdocWire' }, header, views, el.banners, el.body);
    st.root = root;

    if (st.mode === 'panel') {
      const link = ensureCss();
      if (link) {
        // An unstyled flash of the whole feed is worse than a blank first frame.
        root.classList.add('bw-wait');
        const show = () => root.classList.remove('bw-wait');
        link.addEventListener('load', show, { once: true });
        link.addEventListener('error', show, { once: true });
      }
      document.body.appendChild(root);
      const ces = document.getElementById('cesiumContainer');
      if (ces && window.innerWidth > 900) {
        st.cesRight = ces.style.right;
        ces.style.right = '560px';   // same move as #camPanel, so the globe stays clickable
      }
    } else {
      P.host.appendChild(root);
    }

    if (typeof IntersectionObserver === 'function') {
      st.io = new IntersectionObserver(entries => {
        for (const e of entries) {
          if (e.isIntersecting) st.visible.add(e.target);
          else st.visible.delete(e.target);
        }
      });
    }
    el.list.addEventListener('scroll', onScroll, { passive: true, signal });
    el.body.addEventListener('scroll', onScroll, { passive: true, signal });
    // Capture on window: the main app binds 1-4 to CRT/NVG/FLIR on document, and those
    // must not fire while the same keys are switching wire views.
    window.addEventListener('keydown', onKey, { capture: true, signal });
    window.addEventListener('online', retryNow, { signal });
    window.addEventListener('offline', tick, { signal });
    document.addEventListener('visibilitychange', onVisible, { signal });

    paintViews();
    paintSev();
    paintChips();
    paintSections();
    paintAlerts();
    renderRail();
    paintEmpty();
    st.tickTimer = setInterval(tick, 1000);
    tick();
  }

  function onKey(e) {
    const st = S;
    if (!st || !st.el || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const tag = t && t.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!(t && t.isContentEditable);
    if (typing && !st.root.contains(t)) return;   // the palette, the auth modal, the search bar
    const search = st.el.search;
    let handled = true;
    if (e.key === 'Escape') {
      if (t === search && search.value) {
        search.value = '';
        st.filter.q = '';
        filterChanged();
      } else if (st.mode === 'panel') close();
      else if (typing) t.blur();
      else handled = false;
    } else if (typing) {
      handled = false;
    } else if (e.key === '/') {
      search.focus();
      search.select();
    } else if (e.key >= '1' && e.key <= '4' && e.key.length === 1) {
      setView(VIEW_ORDER[Number(e.key) - 1]);
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // A sleeping laptop or a locked phone wakes with a dead socket and timers that never fired.
  function onVisible() {
    const st = S;
    if (!st || document.hidden) return;
    tick();
    if (st.sock === 'closed' || Date.now() - st.lastPullAt > 15000) retryNow();
  }

  // ── Lifecycle ──

  function stopData(st) {
    st.ac.abort();
    clearInterval(st.tickTimer);
    clearTimeout(st.pollTimer);
    clearTimeout(st.chanTimer);
    clearTimeout(st.flushTimer);
    cancelAnimationFrame(st.raf);
    st.chanTimer = 0;
    st.flushTimer = 0;
    st.raf = 0;
    if (st.fetchCtl) { try { st.fetchCtl.abort(); } catch (_) {} }
    dropChannel(st);
    st.sock = 'none';
    if (st.io) { st.io.disconnect(); st.io = null; }
    clearMarkers(st);
    if (st.audio) { try { st.audio.close(); } catch (_) {} st.audio = null; }
    if (st.authSub) { try { st.authSub.unsubscribe(); } catch (_) {} st.authSub = null; }
  }

  function teardown() {
    const st = S;
    if (!st) return;
    stopData(st);
    if (st.cesRight !== null) {
      const ces = document.getElementById('cesiumContainer');
      if (ces) ces.style.right = st.cesRight;
    }
    if (st.root) st.root.remove();
    S = null;
    emitCount();
  }

  // 403: the account is signed in but it is not the owner. Drop everything held in memory.
  function denied() {
    const st = S;
    if (st.mode === 'page') {
      teardown();
      gate('nonowner');
      return;
    }
    stopData(st);
    st.items = [];
    if (st.el) {
      st.el.body.replaceChildren(h('div', { class: 'bw-denied' },
        h('div', { class: 'bw-denied-t' }, 'RESTRICTED'),
        h('div', null, 'This account is not the owner of this wire.')));
      st.el.banners.hidden = true;
      setText(st.el.connWord, 'RESTRICTED');
      setText(st.el.connDetail, '');
      st.el.conn.dataset.s = 'offline';
    }
  }

  function emitCount() {
    const n = S ? S.newCount : 0;
    if (n === lastCount) return;
    lastCount = n;
    countFns.forEach(fn => { try { fn(n); } catch (_) {} });
  }

  function watchAuth(st) {
    try {
      const r = st.client.auth.onAuthStateChange(evt => {
        // Never await Supabase in this callback: it holds the auth lock while it runs,
        // which is the p157 deadlock documented in auth.js. setTimeout(0) runs after release.
        setTimeout(() => {
          if (st !== S) return;
          if (evt === 'SIGNED_OUT') close();
          else if (evt === 'TOKEN_REFRESHED' && st.pathDown) reconcile();
        }, 0);
      });
      st.authSub = r && r.data && r.data.subscription;
    } catch (e) {
      console.warn('[wire] auth listener failed:', e && e.message);
    }
  }

  function open(opts) {
    const o = opts || {};
    if (S) return;                    // one watch, one channel, however often the button is hit
    if (document.documentElement.hasAttribute('data-wire-page')) return;
    const client = o.client || (window.BDOC_Auth && window.BDOC_Auth.client);
    if (!client) {
      console.warn('[wire] open() has no Supabase client yet');
      return;
    }
    S = newState({ client, embedded: true, flyTo: o.flyTo });
    mountShell();
    watchAuth(S);
    reconcile();
  }

  function close() {
    if (S && S.mode === 'panel') teardown();
  }

  // ── Page gate ──

  function authErrorText(e) {
    // Same distinction as auth.js P136: an unreachable backend must not read as a bad password.
    const raw = (e && e.message) || '';
    if (/failed to fetch|networkerror|load failed|err_name_not_resolved|fetch failed|network request failed/i.test(raw)) {
      return 'The sign-in service is unreachable right now. That is a connection problem, not your credentials.';
    }
    return raw || 'Sign-in failed. Try again.';
  }

  async function mfaRequired() {
    try {
      const { data, error } = await P.client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error || !data) return false;
      return data.nextLevel === 'aal2' && data.nextLevel !== data.currentLevel;
    } catch (_) {
      return false;
    }
  }

  function clearGate() {
    if (P.overlay) P.overlay.remove();
    P.overlay = null;
    P.view = '';
  }

  function gateMessage(text) {
    return h('div', { class: 'bw-gate-m' }, text);
  }

  function gateSignIn(msg) {
    const email = h('input', { class: 'bw-in', type: 'email', name: 'email', autocomplete: 'username', placeholder: 'Email', 'aria-label': 'Email', required: true });
    const pass = h('input', { class: 'bw-in', type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'Password', 'aria-label': 'Password', required: true });
    const err = h('div', { class: 'bw-gate-e', role: 'alert' });
    err.hidden = true;
    const btn = h('button', { class: 'bw-btn bw-btn-p', type: 'submit' }, 'SIGN IN');
    const showErr = text => { err.textContent = text; err.hidden = !text; };
    const submit = async e => {
      e.preventDefault();
      showErr('');
      const em = email.value.trim();
      if (!em || !pass.value) { showErr('Email and password required.'); return; }
      btn.disabled = true;
      btn.textContent = 'SIGNING IN';
      P.signingIn = true;
      try {
        const { error } = await P.client.auth.signInWithPassword({ email: em, password: pass.value });
        if (error) throw error;
        pass.value = '';
        await enterWatch();
      } catch (ex) {
        showErr(authErrorText(ex));
      } finally {
        P.signingIn = false;
        btn.disabled = false;
        btn.textContent = 'SIGN IN';
      }
    };
    const sso = h('a', { class: 'bw-gate-l' }, 'Use Google? Sign in on the main app, then come back.');
    sso.href = '/';
    return [msg ? gateMessage(msg) : null,
      h('form', { class: 'bw-form', onsubmit: submit }, email, pass, btn), err, sso];
  }

  function gateMfa() {
    const code = h('input', {
      class: 'bw-in', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6',
      placeholder: '000000', 'aria-label': 'Six digit authenticator code', required: true
    });
    const err = h('div', { class: 'bw-gate-e', role: 'alert' });
    err.hidden = true;
    const btn = h('button', { class: 'bw-btn bw-btn-p', type: 'submit' }, 'VERIFY');
    const showErr = text => { err.textContent = text; err.hidden = !text; };
    const submit = async e => {
      e.preventDefault();
      showErr('');
      const value = code.value.trim();
      if (value.length !== 6) { showErr('Enter the 6-digit code.'); return; }
      btn.disabled = true;
      P.signingIn = true;
      try {
        const { data: factors } = await P.client.auth.mfa.listFactors();
        const totp = factors && factors.totp && factors.totp[0];
        if (!totp) throw new Error('No authenticator enrolled');
        const { data: ch, error: chErr } = await P.client.auth.mfa.challenge({ factorId: totp.id });
        if (chErr) throw chErr;
        const { error } = await P.client.auth.mfa.verify({ factorId: totp.id, challengeId: ch.id, code: value });
        if (error) throw error;
        await enterWatch();
      } catch (ex) {
        showErr((ex && ex.message) || 'Invalid code. Try again.');
      } finally {
        P.signingIn = false;
        btn.disabled = false;
      }
    };
    return [gateMessage('Enter the code from your authenticator app.'),
      h('form', { class: 'bw-form', onsubmit: submit }, code, btn), err];
  }

  function gate(kind, msg) {
    P.view = kind;
    let body;
    let focus = null;
    if (kind === 'signedout') { body = gateSignIn(msg); focus = 'input'; }
    else if (kind === 'mfa') { body = gateMfa(); focus = 'input'; }
    else if (kind === 'nonowner') {
      body = [h('div', { class: 'bw-gate-t' }, 'RESTRICTED'),
        gateMessage('This account is not the owner of this wire.'),
        h('button', { class: 'bw-btn', type: 'button', onclick: signOut }, 'SIGN OUT')];
    } else if (kind === 'error') {
      body = [h('div', { class: 'bw-gate-t' }, 'CANNOT START'), gateMessage(msg),
        h('button', { class: 'bw-btn', type: 'button', onclick: () => bootPage() }, 'RETRY')];
    } else {
      body = [h('div', { class: 'bw-gate-c' }, h('span', { class: 'bw-dot', 'aria-hidden': 'true' }), 'CONNECTING'),
        msg ? gateMessage(msg) : null];
    }
    const node = h('div', { class: 'bw bw-gate' },
      h('div', { class: 'bw-gate-card' }, h('div', { class: 'bw-gate-b' }, 'BDOC WIRE'), body));
    if (P.overlay) P.overlay.remove();
    P.overlay = node;
    P.host.appendChild(node);
    if (focus) {
      const first = node.querySelector(focus);
      if (first) first.focus();
    }
    document.title = 'BDOC Wire';
  }

  async function signOut() {
    P.userSignOut = true;
    teardown();
    try {
      // local, not global: signing out the phone must not kill the laptop mid-watch.
      await P.client.auth.signOut({ scope: 'local' });
    } catch (e) {
      console.warn('[wire] sign out failed:', e && e.message);
    }
    if (P.view !== 'signedout') gate('signedout');
  }

  async function enterWatch() {
    if (await mfaRequired()) { gate('mfa'); return; }
    if (S) {                          // re-sign-in over a live watch: keep what is on screen
      clearGate();
      reconcile();
      return;
    }
    gate('connecting', 'Checking owner access.');
    S = newState({ client: P.client, embedded: false });
    reconcile();
  }

  function loadFallbackSupabase() {
    return new Promise(resolve => {
      const s = h('script', { crossorigin: 'anonymous', integrity: SUPABASE_SRI, referrerpolicy: 'no-referrer' });
      s.onload = () => resolve();
      s.onerror = () => resolve();
      s.src = SUPABASE_FALLBACK;
      document.head.appendChild(s);
    });
  }

  function onPageAuth(evt) {
    if (evt === 'SIGNED_OUT') {
      const asked = P.userSignOut;
      P.userSignOut = false;
      if (asked) return;
      teardown();
      gate('signedout', 'Your session ended. Sign in to resume the feed.');
      return;
    }
    if (evt === 'TOKEN_REFRESHED' && S && S.pathDown) { reconcile(); return; }
    if (evt === 'SIGNED_IN' && !P.signingIn && !S && P.view === 'signedout') enterWatch();
  }

  async function bootPage() {
    P.host = P.host || document.getElementById('bdocWireRoot') || document.body;
    teardown();
    P.host.replaceChildren();         // the static CONNECTING placeholder from wire.html
    gate('connecting', 'Loading configuration.');
    let cfg = null;
    try {
      const r = await fetch(CONFIG_URL, { signal: AbortSignal.timeout(8000) });
      if (r.ok) cfg = await r.json();
    } catch (e) {
      console.warn('[wire] config fetch failed:', e && e.message);
    }
    if (!cfg || !cfg.supabase_url || !cfg.supabase_anon_key) {
      gate('error', 'The configuration endpoint did not answer. Check the connection and retry.');
      return;
    }
    if (!window.supabase || !window.supabase.createClient) await loadFallbackSupabase();
    if (!window.supabase || !window.supabase.createClient) {
      gate('error', 'The sign-in library failed to load from both CDNs. Check the connection and retry.');
      return;
    }
    if (!P.client) {
      P.client = window.supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key);
      try {
        // Same deadlock rule as watchAuth(): defer, never await in the callback.
        P.client.auth.onAuthStateChange(evt => { setTimeout(() => onPageAuth(evt), 0); });
      } catch (e) {
        console.warn('[wire] auth listener failed:', e && e.message);
      }
    }
    let session = null;
    try {
      const { data } = await P.client.auth.getSession();
      session = data && data.session;
    } catch (e) {
      gate('error', authErrorText(e));
      return;
    }
    if (!session) { gate('signedout'); return; }
    await enterWatch();
  }

  window.BDOCWire = {
    open,
    close,
    toggle(opts) { if (S && S.mode === 'panel') close(); else open(opts); },
    isOpen() { return !!S; },
    // fn(n): rows waiting behind N NEW. Returns an unsubscribe function.
    onCount(fn) {
      if (typeof fn !== 'function') return () => {};
      countFns.add(fn);
      try { fn(S ? S.newCount : 0); } catch (_) {}
      return () => countFns.delete(fn);
    }
  };

  if (document.documentElement.hasAttribute('data-wire-page')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootPage, { once: true });
    else bootPage();
  }
})();
