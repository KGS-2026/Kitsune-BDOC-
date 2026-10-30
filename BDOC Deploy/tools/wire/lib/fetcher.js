// ============================================================
// wire/fetcher — polite HTTP, the poll scheduler, and honest health
// ============================================================
// WHY THIS EXISTS
// About 130 feeds have to be read every minute or two, for days, from one droplet IP,
// without getting that IP banned and without one bad feed taking the others down. This
// is the only place in the daemon that talks to a feed over plain HTTP.
//
// DESIGN NOTES
// - One simple loop. A timer ticks and launches whatever is due, subject to the global
//   concurrency limit and the per-host gap. No per-source timers to leak or double-fire:
//   reliability beats cleverness, and this has to run unattended through election week.
// - Failure isolation is the first requirement. Every poll runs in its own try/catch,
//   so a parser exception is a bad health row for that source and nothing else.
// - Validators are stored only after a body parsed AND the pipeline took it. Storing
//   them earlier means the next poll gets a 304, so a failed parse is never retried and
//   the items are silently lost.
// - A 429 is about the host, not the feed. There are more than two dozen sources on
//   news.google.com; if each only backed off itself they would all still hit the limit
//   in turn, and that is how an IP gets banned. So a 429 or Retry-After holds the host.
// - `ok` means data is really flowing. Spec ground rule 6: HTTP 200 with stale content
//   is not live (CNN and WSJ World do exactly this), so health() marks a source stale
//   when its newest item is well past that feed's own normal rhythm.
//
// CONTRACT
// new Scheduler({ sources, onItems(rawItems, source), isFirstPoll(id), markPolled(id),
//                 fetchImpl?, now?, sleep?, ctx?, random? })
// .start() .stop() .add(source) .remove(id) .health()
// .ctx is the shared parser state. Read .ctx.official for stats.official.

'use strict';

const { parseBy } = require('./parse');
const { UA } = require('./sources');
const { log } = require('./util');

const CONCURRENCY = 8;
const TICK_MS = 100;
const TIMEOUT_MS = 15000;
const BODY_CAP = 8 * 1024 * 1024;
const BACKOFF_CAP_MS = 900000;
const JITTER = 0.1;
const START_SPREAD_MS = 5000; // so a restart does not fire 130 requests in one tick

const GAP_DEFAULT_MS = 250;
const HOST_GAPS = new Map([['news.google.com', 1500], ['t.me', 3000]]);

// When a host says 429 without saying how long, assume at least this.
const HOST_HOLD_MIN_MS = 60000;
// Retry-After is honoured, but a server's typo must not blind a source through the
// election. An hour is longer than any real rate-limit window we have seen.
const RETRY_AFTER_CAP_MS = 3600000;

const HOUR = 3600000;
const DAY = 24 * HOUR;
const STALE_FLOOR_MS = 6 * HOUR; // news feeds really do slow down overnight
const STALE_UNKNOWN_MS = 7 * DAY; // one item in the feed, so no rhythm to measure
const SEEN_MAX = 5000;
const STAMPS_MAX = 20000;

// Per kind because api.weather.gov really does negotiate: offer it Atom first and it
// sends Atom, and the JSON parser then calls a healthy source broken.
const ACCEPT_XML = 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5';
const ACCEPT_JSON = 'application/geo+json, application/json;q=0.9, */*;q=0.5';
const ACCEPT_HTML = 'text/html, application/xhtml+xml, */*;q=0.5';
const JSON_KINDS = new Set(['nws', 'usgs', 'emsc', 'swpc', 'eonet', 'fema', 'hn']);

function acceptFor(kind) {
  if (kind === 'telegram') return ACCEPT_HTML;
  return JSON_KINDS.has(kind) ? ACCEPT_JSON : ACCEPT_XML;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
}

function shortError(e) {
  const s = e && e.message ? e.message : String(e);
  return s.replace(/\s+/g, ' ').slice(0, 200);
}

// Seconds or an HTTP date, per RFC 9110. Anything else is ignored.
function retryAfterMs(res, now) {
  const v = res.headers && res.headers.get ? res.headers.get('retry-after') : null;
  if (!v) return 0;
  const secs = Number(v);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(v) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(ms, RETRY_AFTER_CAP_MS);
}

function charsetOf(contentType, bytes) {
  const header = /charset=["']?([\w-]+)/i.exec(contentType || '');
  if (header) return header[1];
  const prolog = /<\?xml[^>]*encoding=["']([\w-]+)/i.exec(bytes.subarray(0, 200).toString('latin1'));
  return prolog ? prolog[1] : 'utf-8';
}

function decodeBody(bytes, contentType) {
  try {
    return new TextDecoder(charsetOf(contentType, bytes)).decode(bytes);
  } catch (_) {
    return bytes.toString('utf8'); // unknown charset label
  }
}

// Reads at most `cap` bytes, then stops pulling, so a body that never ends cannot take
// the memory with it. A cut document still goes to the parser: the XML parsers are built
// to survive it and a few hundred good items beat a dead source. JSON will throw, which
// is the honest result for a document that really is incomplete.
async function readBody(res, cap) {
  const type = res.headers && res.headers.get ? res.headers.get('content-type') : '';
  if (!res.body || typeof res.body.getReader !== 'function') {
    return String(await res.text()).slice(0, cap);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    if (size + chunk.length >= cap) {
      chunks.push(chunk.subarray(0, cap - size));
      size = cap;
      try { await reader.cancel(); } catch (_) { /* already gone */ }
      break;
    }
    chunks.push(chunk);
    size += chunk.length;
  }
  return decodeBody(Buffer.concat(chunks, size), type);
}

function median(sorted) {
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

// The feed's rhythm: median gap between consecutive item times in the document.
function normalGap(items) {
  const pts = items.map((i) => i.pt).filter((t) => t != null).sort((a, b) => b - a);
  const gaps = [];
  for (let i = 1; i < pts.length; i++) if (pts[i - 1] > pts[i]) gaps.push(pts[i - 1] - pts[i]);
  return median(gaps.sort((a, b) => a - b));
}

function realSleep(self, ms) {
  return new Promise((resolve) => {
    self._wake = resolve;
    self._sleepTimer = setTimeout(resolve, ms);
  });
}

class Scheduler {
  constructor(opts) {
    const o = opts || {};
    this.onItems = o.onItems || (() => {});
    this.isFirstPoll = o.isFirstPoll || (() => true);
    this.markPolled = o.markPolled || (() => {});
    this.fetchImpl = o.fetchImpl || ((url, init) => globalThis.fetch(url, init));
    this.now = o.now || Date.now;
    this.sleep = o.sleep || ((ms) => realSleep(this, ms));
    this.random = o.random || Math.random;
    this.timeoutMs = o.timeoutMs || TIMEOUT_MS;
    this.bodyCap = o.bodyCap || BODY_CAP;
    this.concurrency = o.concurrency || CONCURRENCY;

    this.ctx = o.ctx || { official: {} };
    if (!this.ctx.official) this.ctx.official = {};
    if (!this.ctx.now) this.ctx.now = this.now;

    this.states = new Map();
    this.hostNext = new Map(); // host → earliest next request start (per-host gap)
    this.hostHold = new Map(); // host → held until (429 / Retry-After)
    this.inflight = new Set();
    this.controllers = new Set();
    this.running = false;
    this._loop = null;

    for (const s of o.sources || []) this.add(s);
  }

  add(source) {
    if (!source || !source.id || this.states.has(source.id)) return false;
    this.states.set(source.id, {
      source,
      host: hostOf(source.url),
      nextAt: this.now(),
      polling: false,
      ok: false,
      lastOk: null,
      lastErr: null,
      err: null,
      fails: 0,
      etag: null,
      lastModified: null,
      newest: null,
      gap: null,
      lastCount: 0,
      seen: new Set(),
      stamps: []
    });
    return true;
  }

  remove(id) {
    return this.states.delete(id); // a poll in flight checks this before it reschedules
  }

  start() {
    if (this.running) return;
    this.running = true;
    const now = this.now();
    for (const st of this.states.values()) {
      if (st.lastOk == null && st.lastErr == null) st.nextAt = now + this.random() * START_SPREAD_MS;
    }
    this._loop = this._run();
  }

  async stop() {
    this.running = false;
    clearTimeout(this._sleepTimer);
    if (this._wake) this._wake();
    for (const c of this.controllers) c.abort(new Error('stopped'));
    await this._loop;
    await Promise.allSettled([...this.inflight]);
  }

  async _run() {
    while (this.running) {
      try {
        this._launch();
      } catch (e) {
        log('error', 'scheduler tick failed', { err: e }); // keep the loop alive whatever happens
      }
      await this.sleep(TICK_MS);
    }
  }

  _launch() {
    const now = this.now();
    const due = [];
    for (const st of this.states.values()) if (!st.polling && st.nextAt <= now) due.push(st);
    due.sort((a, b) => a.nextAt - b.nextAt);
    for (const st of due) {
      if (this.inflight.size >= this.concurrency) break;
      if (Math.max(this.hostNext.get(st.host) || 0, this.hostHold.get(st.host) || 0) > now) continue;
      this.hostNext.set(st.host, now + (HOST_GAPS.get(st.host) || GAP_DEFAULT_MS));
      st.polling = true;
      const run = this._poll(st)
        .catch((e) => { st.err = shortError(e); })
        .finally(() => {
          st.polling = false;
          this.inflight.delete(run);
        });
      this.inflight.add(run);
    }
  }

  // Launch what is due and wait for those polls. The test seam, and handy from a REPL.
  async _tick() {
    this._launch();
    await Promise.allSettled([...this.inflight]);
  }

  _jitter(ms) {
    return ms * (1 + (this.random() * 2 - 1) * JITTER);
  }

  async _poll(st) {
    const src = st.source;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error('timeout after ' + this.timeoutMs + ' ms')), this.timeoutMs);
    if (timer.unref) timer.unref();
    this.controllers.add(ctl);
    // Raced as well as passed in, so a fetch that ignores its signal still ends here.
    const aborted = new Promise((_, reject) => {
      ctl.signal.addEventListener('abort', () => reject(ctl.signal.reason), { once: true });
    });
    aborted.catch(() => {});

    try {
      const res = await Promise.race([this._request(src, st, ctl.signal), aborted]);
      if (res.status === 304) {
        if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
        this._succeed(st);
        return;
      }
      if (!res.ok) {
        const wait = retryAfterMs(res, this.now());
        if (res.status === 429 || wait) {
          const until = this.now() + (wait || HOST_HOLD_MIN_MS);
          if (until > (this.hostHold.get(st.host) || 0)) this.hostHold.set(st.host, until);
        }
        if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
        this._fail(st, new Error('HTTP ' + res.status), wait);
        return;
      }

      const body = await Promise.race([readBody(res, this.bodyCap), aborted]);
      const items = parseBy(src.kind, body, src, this.ctx);
      if (!this.states.has(src.id)) return; // removed while in flight

      const first = !!this.isFirstPoll(src.id);
      for (const item of items) item.firstPoll = first;
      this._record(st, items);
      if (items.length) await Promise.race([Promise.resolve(this.onItems(items, src)), aborted]);
      // A first poll that found nothing still counts. NTAS is empty today, and the first
      // bulletin it ever carries is news, not backlog: it must be able to page.
      if (first) this.markPolled(src.id);

      this._succeed(st, res);
    } catch (e) {
      if (this.running || !/stopped/.test(shortError(e))) this._fail(st, e, 0);
    } finally {
      clearTimeout(timer);
      this.controllers.delete(ctl);
    }
  }

  _request(src, st, signal) {
    const headers = {
      'User-Agent': src.ua || UA,
      'Accept': acceptFor(src.kind),
      'Accept-Language': 'en-US,en;q=0.9'
    };
    if (st.etag) headers['If-None-Match'] = st.etag;
    if (st.lastModified) headers['If-Modified-Since'] = st.lastModified;
    return this.fetchImpl(src.url, { headers, signal, redirect: 'follow' });
  }

  _succeed(st, res) {
    const now = this.now();
    st.ok = true;
    st.lastOk = now;
    st.err = null;
    st.fails = 0;
    if (res && res.headers && res.headers.get) {
      st.etag = res.headers.get('etag') || null;
      st.lastModified = res.headers.get('last-modified') || null;
    }
    st.nextAt = now + this._jitter(st.source.every * 1000);
  }

  _fail(st, err, wait) {
    const now = this.now();
    st.ok = false;
    st.lastErr = now;
    st.err = shortError(err);
    st.fails++;
    const every = st.source.every * 1000;
    // Spec: min(every × 2^fails, 900 s). The max() is for the 1800 s feeds, where that
    // formula alone would poll a failing source twice as often as a healthy one.
    const backoff = Math.max(every, Math.min(every * 2 ** Math.min(st.fails, 20), BACKOFF_CAP_MS));
    st.nextAt = now + Math.max(this._jitter(backoff), wait || 0);
    log('warn', 'source failed', { id: st.source.id, fails: st.fails, err: st.err });
  }

  // Newest item time and the rolling counts. Items repeat on every poll, so each guid is
  // counted once, at its own publish time rather than the moment we happened to see it.
  _record(st, items) {
    const now = this.now();
    for (const item of items) {
      const fresh = !st.seen.has(item.guid);
      if (fresh) {
        st.seen.add(item.guid);
        if (st.seen.size > SEEN_MAX) st.seen.delete(st.seen.values().next().value);
      }
      // A feed may date an item in the future (planned maintenance, a bad clock), and
      // that must not read as freshness. An undated item is dated when first seen.
      const t = item.pt != null && item.pt <= now ? item.pt : fresh ? now : null;
      if (t == null) continue;
      if (st.newest == null || t > st.newest) st.newest = t;
      if (fresh && now - t < DAY) st.stamps.push(t);
    }
    const cutoff = now - DAY;
    if (st.stamps.length && (st.stamps[0] < cutoff || st.stamps.length > STAMPS_MAX)) {
      st.stamps = st.stamps.filter((t) => t >= cutoff).slice(-STAMPS_MAX);
    }
    const gap = normalGap(items);
    if (gap != null) st.gap = gap;
    st.lastCount = items.length;
  }

  // Stale means the feed is serving old items. An empty answer is not that: a `when:1h`
  // search with no hits at 4 AM has simply found nothing, and its source is fine.
  _isStale(st, now) {
    if (st.source.quiet || st.newest == null || !st.lastCount) return false;
    const limit = st.gap == null
      ? STALE_UNKNOWN_MS
      : Math.max(3 * st.gap, 3 * st.source.every * 1000, STALE_FLOOR_MS);
    return now - st.newest > limit;
  }

  health() {
    const now = this.now();
    const out = [];
    for (const st of this.states.values()) {
      const s = st.source;
      const stale = st.ok && this._isStale(st, now);
      const inHour = st.stamps.filter((t) => now - t < HOUR).length;
      const inDay = st.stamps.filter((t) => now - t < DAY).length;
      out.push({
        id: s.id,
        n: s.name,
        cls: s.cls,
        kind: s.kind,
        every: s.every,
        ok: st.ok && !stale,
        lastOk: st.lastOk,
        lastErr: st.lastErr,
        err: st.err || (stale ? 'stale' : null),
        newest: st.newest,
        c1h: inHour,
        c24h: inDay,
        fails: st.fails,
        stale
      });
    }
    return out;
  }
}

module.exports = { Scheduler, HOST_GAPS, GAP_DEFAULT_MS, CONCURRENCY, BODY_CAP, TIMEOUT_MS };
