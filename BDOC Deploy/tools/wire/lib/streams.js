// ============================================================
// wire/streams — the Bluesky and Wikipedia firehoses
// ============================================================
// WHY THIS EXISTS
// Polling tells the owner what was published a minute ago. These two are push: Bluesky
// is where chatter shows up first and a surge of Wikipedia edits is often the earliest
// public sign that something is happening. Both are firehoses, about 48 posts a second
// on Bluesky, so almost everything is counted and thrown away; only a prefilter hit
// becomes an item (spec section 4, Firehose filter).
//
// DESIGN NOTES
// - A silent socket is the failure that matters. A TCP connection can stay "open" for
//   hours with nothing flowing, so a watchdog treats 30 s without a message as dead and
//   reconnects (spec section 8). The owner must never see a stale stream labelled live.
// - Jetstream's resumable position is `time_us`, NOT the `cursor` field in its messages.
//   That field is a relay sequence number around 2.6e10; sent back as ?cursor= it reads
//   as a timestamp in 1970 and asks for the entire retained backlog.
// - Bluesky posts are social, so they can never page, but a long replay after downtime
//   would still swamp the feed. A cursor older than MAX_REPLAY_MS is dropped and the
//   stream rejoins live.
// - `prefilter` is read off `this` on every event, never captured. New custom watch
//   terms extend the filter without a restart (spec section 8).
// - WebSocket comes from wsImpl or globalThis at connect time, never at import, because
//   CI runs on Node 20 where the global does not exist (spec ground rule 9).

'use strict';

const { UA } = require('./sources');
const { cleanText, log, safeUrl } = require('./util');

const H_MAX = 240;
const X_MAX = 280;
const STALL_MS = 30000;
const WATCHDOG_MS = 5000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEALTHY_MS = 30000; // a connection that lived this long clears the backoff

const JETSTREAM_HOSTS = [
  'jetstream1.us-east.bsky.network',
  'jetstream2.us-east.bsky.network',
  'jetstream1.us-west.bsky.network',
  'jetstream2.us-west.bsky.network'
];
const REPLAY_REWIND_US = 5 * 1000000; // overlap, so a reconnect leaves no gap; ids dedupe
const MAX_REPLAY_MS = 15 * 60000;
const CURSOR_SAVE_MS = 5000;
const DID_CAP = 10;
const DID_WINDOW_MS = 3600000;
const DID_TRACK_MAX = 50000;

const WIKI_URL = 'https://stream.wikimedia.org/v2/stream/recentchange';
const SURGE_WINDOW_MS = 10 * 60000;
const SURGE_EDITS = 12;
const SURGE_USERS = 6;
const SURGE_COOLDOWN_MS = 6 * 3600000;
const SURGE_TRACK_MAX = 20000;
const SSE_LINE_MAX = 1024 * 1024;

// Rolling one-minute count in one-second buckets. Costs nothing at 48 hits a second.
class RateWindow {
  constructor(now) {
    this.now = now;
    this.buckets = new Array(60).fill(0);
    this.sec = Math.floor(now() / 1000);
  }

  _advance() {
    const sec = Math.floor(this.now() / 1000);
    const gap = sec - this.sec;
    if (gap === 0) return;
    if (gap < 0 || gap >= 60) this.buckets.fill(0);
    else for (let i = 1; i <= gap; i++) this.buckets[(this.sec + i) % 60] = 0;
    this.sec = sec;
  }

  hit() {
    this._advance();
    this.buckets[this.sec % 60]++;
  }

  perMin() {
    this._advance();
    return this.buckets.reduce((a, b) => a + b, 0);
  }
}

function splitPost(text) {
  if (text.length <= H_MAX) return { h: text, x: '' };
  const cut = text.lastIndexOf(' ', H_MAX);
  const at = cut > 40 ? cut : H_MAX;
  return { h: text.slice(0, at).trim(), x: text.slice(at).trim() };
}

const langOk = (langs) => !Array.isArray(langs) || !langs.length || langs.some((l) => /^en(?:-|$)/i.test(String(l)));

// ── Jetstream ───────────────────────────────────────────────────────────────

class Jetstream {
  constructor(opts) {
    const o = opts || {};
    this.prefilter = o.prefilter || (() => false);
    this.onItem = o.onItem || (() => {});
    this.wsImpl = o.wsImpl || null;
    this.hosts = o.hosts && o.hosts.length ? o.hosts : JETSTREAM_HOSTS;
    this.getCursor = o.getCursor || null;
    this.setCursor = o.setCursor || null;
    this.now = o.now || Date.now;
    this.reconnectBaseMs = o.reconnectBaseMs != null ? o.reconnectBaseMs : RECONNECT_BASE_MS;
    this.random = o.random || Math.random;

    this.running = false;
    this.ws = null;
    this.hostIdx = 0;
    this.attempt = 0;
    this.cursor = null;
    this.cursorLoaded = false;
    this.cursorSavedAt = 0;
    this.lastEvent = null;
    this.lastActivity = 0;
    this.openedAt = 0;
    this.rate = new RateWindow(this.now);
    this.dids = new Map();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._watchdogTimer = setInterval(() => this._watchdog(), WATCHDOG_MS);
    if (this._watchdogTimer.unref) this._watchdogTimer.unref();
    this._connect();
  }

  stop() {
    this.running = false;
    clearInterval(this._watchdogTimer);
    clearTimeout(this._retryTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.close(); } catch (_) { /* already closed */ } }
  }

  status() {
    const seen = this.lastEvent != null && this.now() - this.lastEvent < STALL_MS;
    return { ok: !!this.ws && this.openedAt > 0 && seen, lastEvent: this.lastEvent, perMin: this.rate.perMin() };
  }

  _urlFor(host) {
    const base = /^wss?:/.test(host)
      ? host
      : 'wss://' + host + '/subscribe?wantedCollections=app.bsky.feed.post';
    if (this.cursor == null) return base;
    // time_us is microseconds; a replay further back than this is not worth having.
    if (this.now() - this.cursor / 1000 > MAX_REPLAY_MS) {
      this.cursor = null;
      return base;
    }
    return base + (base.includes('?') ? '&' : '?') + 'cursor=' + (this.cursor - REPLAY_REWIND_US);
  }

  async _connect() {
    if (!this.running) return;
    if (!this.cursorLoaded) {
      this.cursorLoaded = true;
      if (this.getCursor) {
        try {
          // Number(): the store's kv table is TEXT, so this comes back as a string.
          const saved = Number(await this.getCursor());
          if (Number.isFinite(saved) && saved > 0) this.cursor = saved;
        } catch (e) {
          log('warn', 'jetstream cursor load failed', { err: e });
        }
        if (!this.running) return;
      }
    }

    const WS = this.wsImpl || globalThis.WebSocket;
    this.lastActivity = this.now(); // a connect that hangs is a stall too
    this.openedAt = 0;
    let ws;
    try {
      if (!WS) throw new Error('no WebSocket in this runtime');
      ws = new WS(this._urlFor(this.hosts[this.hostIdx]));
    } catch (e) {
      log('warn', 'jetstream connect failed', { err: e });
      this._down(null);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.openedAt = this.now();
      this.lastActivity = this.openedAt;
      log('info', 'jetstream connected', { host: this.hosts[this.hostIdx] });
    };
    ws.onmessage = (ev) => {
      if (ws === this.ws) this._message(ev.data);
    };
    ws.onerror = () => this._down(ws);
    ws.onclose = () => this._down(ws);
  }

  // Runs once per connection however many of error, close and the watchdog fire.
  _down(ws) {
    if (ws && ws !== this.ws) return;
    const lived = this.openedAt ? this.now() - this.openedAt : 0;
    this.ws = null;
    this.openedAt = 0;
    if (ws) { try { ws.close(); } catch (_) { /* already closed */ } }
    if (!this.running) return;
    this.attempt = lived >= HEALTHY_MS ? 0 : this.attempt + 1;
    this.hostIdx = (this.hostIdx + 1) % this.hosts.length; // whatever went wrong, try the next host
    const delay = Math.min(RECONNECT_MAX_MS, this.reconnectBaseMs * 2 ** Math.min(this.attempt, 10));
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => this._connect(), delay * (0.5 + this.random() * 0.5));
    if (this._retryTimer.unref) this._retryTimer.unref();
  }

  _watchdog() {
    if (this.running && this.ws && this.now() - this.lastActivity >= STALL_MS) {
      log('warn', 'jetstream stalled', { host: this.hosts[this.hostIdx] });
      this._down(this.ws);
    }
  }

  _hit(text) {
    try { return !!this.prefilter(text); } catch (_) { return false; }
  }

  _underCap(did, now) {
    const entry = this.dids.get(did);
    if (!entry || now >= entry.resetAt) {
      if (!entry && this.dids.size >= DID_TRACK_MAX) {
        for (const [k, v] of this.dids) if (now >= v.resetAt) this.dids.delete(k);
        if (this.dids.size >= DID_TRACK_MAX) this.dids.clear();
      }
      this.dids.set(did, { n: 1, resetAt: now + DID_WINDOW_MS });
      return true;
    }
    entry.n++;
    return entry.n <= DID_CAP;
  }

  _saveCursor(now) {
    if (!this.setCursor || now - this.cursorSavedAt < CURSOR_SAVE_MS) return;
    this.cursorSavedAt = now;
    try {
      const r = this.setCursor(this.cursor);
      if (r && r.catch) r.catch(() => {});
    } catch (e) {
      log('warn', 'jetstream cursor save failed', { err: e });
    }
  }

  _message(data) {
    const now = this.now();
    this.lastActivity = now;
    let m;
    try {
      m = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    } catch (_) {
      return;
    }
    if (!m || typeof m !== 'object') return;
    this.lastEvent = now;
    if (Number.isFinite(m.time_us) && m.time_us > 0) {
      this.cursor = m.time_us;
      this._saveCursor(now);
    }

    const c = m.commit;
    if (m.kind !== 'commit' || !c || c.operation !== 'create' || c.collection !== 'app.bsky.feed.post') return;
    this.rate.hit();

    const r = c.record;
    if (!r || typeof r !== 'object' || r.reply) return;
    if (!langOk(r.langs)) return;

    const external = r.embed && r.embed.external && typeof r.embed.external === 'object' ? r.embed.external : null;
    const body = typeof r.text === 'string' ? r.text : '';
    const linkTitle = external && typeof external.title === 'string' ? external.title : '';
    if (!this._hit(body + ' ' + linkTitle)) return;

    const did = String(m.did || '');
    const rkey = String(c.rkey || '');
    if (!/^did:[a-z]+:[a-zA-Z0-9._:%-]+$/.test(did) || !/^[a-zA-Z0-9._~:-]{1,512}$/.test(rkey)) return;
    if (!this._underCap(did, now)) return;

    const text = cleanText(body, 1000) || cleanText(linkTitle, H_MAX);
    if (!text) return;
    const parts = splitPost(text);
    const raw = {
      sid: 'bsky',
      sn: 'Bluesky',
      cls: 'social',
      guid: did + '/' + rkey,
      h: cleanText(parts.h, H_MAX),
      x: cleanText(parts.x || linkTitle, X_MAX),
      u: safeUrl('https://bsky.app/profile/' + did + '/post/' + rkey),
      // The relay's clock, not the post's createdAt, which the poster can set to anything.
      pt: Number.isFinite(m.time_us) ? Math.floor(m.time_us / 1000) : now,
      pub: 'bsky.app',
      firstPoll: false,
      off: false
    };
    try {
      this.onItem(raw);
    } catch (e) {
      log('error', 'jetstream onItem failed', { err: e });
    }
  }
}

// ── Server-Sent Events ──────────────────────────────────────────────────────

// Network chunks split wherever they like: mid-line, inside \r\n, inside a character.
// Multi-byte safety is the caller's TextDecoder({stream}); lines are handled here.
class SseParser {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.buf = '';
    this.data = [];
    this.id = '';
    this.event = '';
  }

  push(chunk) {
    const s = this.buf + chunk;
    let start = 0;
    let i = 0;
    for (; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c !== 10 && c !== 13) continue;
      if (c === 13 && i + 1 === s.length) break; // a CR at the end may be half of CRLF
      this._line(s.slice(start, i));
      if (c === 13 && s.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    }
    this.buf = s.slice(start);
    if (this.buf.length > SSE_LINE_MAX) { // a server that never ends a line
      this.buf = '';
      this.data = [];
    }
  }

  _line(line) {
    if (line === '') {
      if (this.data.length) {
        this.onEvent({ event: this.event || 'message', data: this.data.join('\n'), id: this.id });
      }
      this.data = [];
      this.event = '';
      return;
    }
    if (line[0] === ':') return; // comment, used as a keep-alive
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let val = colon < 0 ? '' : line.slice(colon + 1);
    if (val[0] === ' ') val = val.slice(1);
    if (field === 'data') this.data.push(val);
    else if (field === 'id') this.id = val;
    else if (field === 'event') this.event = val;
  }
}

// ── Wikimedia recent changes ────────────────────────────────────────────────

class WikiStream {
  constructor(opts) {
    const o = opts || {};
    this.prefilter = o.prefilter || (() => false);
    this.onItem = o.onItem || (() => {});
    this.fetchImpl = o.fetchImpl || ((url, init) => globalThis.fetch(url, init));
    this.now = o.now || Date.now;
    this.reconnectBaseMs = o.reconnectBaseMs != null ? o.reconnectBaseMs : RECONNECT_BASE_MS;
    this.url = o.url || WIKI_URL;

    this.running = false;
    this.open = false;
    this.attempt = 0;
    this.ctl = null;
    this.lastId = '';
    this.lastEvent = null;
    this.lastActivity = 0;
    this.rate = new RateWindow(this.now);
    this.titles = new Map();
    this.events = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._watchdogTimer = setInterval(() => this._watchdog(), WATCHDOG_MS);
    if (this._watchdogTimer.unref) this._watchdogTimer.unref();
    this._loop = this._run();
  }

  async stop() {
    this.running = false;
    clearInterval(this._watchdogTimer);
    clearTimeout(this._retryTimer);
    if (this._wake) this._wake();
    if (this.ctl) this.ctl.abort(new Error('stopped'));
    await this._loop;
  }

  status() {
    const seen = this.lastEvent != null && this.now() - this.lastEvent < STALL_MS;
    return { ok: this.open && seen, lastEvent: this.lastEvent, perMin: this.rate.perMin() };
  }

  _watchdog() {
    if (this.running && this.ctl && this.now() - this.lastActivity >= STALL_MS) {
      log('warn', 'wikistream stalled');
      this.ctl.abort(new Error('stalled'));
    }
  }

  async _run() {
    while (this.running) {
      const startedAt = this.now();
      try {
        await this._consume();
      } catch (e) {
        if (this.running) log('warn', 'wikistream dropped', { err: e });
      }
      this.open = false;
      this.ctl = null;
      if (!this.running) break;
      // Wikimedia ends every stream after about 15 minutes by design. That reconnect is
      // routine, so a connection that lived a while starts over from the short delay.
      this.attempt = this.now() - startedAt >= HEALTHY_MS ? 0 : this.attempt + 1;
      await new Promise((resolve) => {
        this._wake = resolve;
        this._retryTimer = setTimeout(resolve, Math.min(RECONNECT_MAX_MS, this.reconnectBaseMs * 2 ** Math.min(this.attempt, 10)));
      });
    }
  }

  async _consume() {
    const ctl = new AbortController();
    this.ctl = ctl;
    this.lastActivity = this.now();
    const aborted = new Promise((_, reject) => {
      ctl.signal.addEventListener('abort', () => reject(ctl.signal.reason), { once: true });
    });
    aborted.catch(() => {});

    const headers = { Accept: 'text/event-stream', 'User-Agent': UA };
    if (this.lastId) headers['Last-Event-ID'] = this.lastId;
    const res = await Promise.race([this.fetchImpl(this.url, { headers, signal: ctl.signal }), aborted]);
    if (res.status !== 200 || !res.body) throw new Error('HTTP ' + res.status);

    this.open = true;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseParser((ev) => this._event(ev));
    // Cancelling the reader ends a pending read. Racing each read against `aborted`
    // instead would add a reaction per chunk, and leak for as long as the socket lives.
    const cancel = () => { reader.cancel().catch(() => {}); };
    ctl.signal.addEventListener('abort', cancel, { once: true });
    // An abort that landed before the listener went on never fires it, and the read
    // below would then wait forever on a stream nobody is watching any more.
    if (ctl.signal.aborted) cancel();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sse.push(typeof value === 'string' ? value : decoder.decode(value, { stream: true }));
      }
      if (ctl.signal.aborted) throw ctl.signal.reason;
    } finally {
      ctl.signal.removeEventListener('abort', cancel);
      cancel();
    }
  }

  _hit(text) {
    try { return !!this.prefilter(text); } catch (_) { return false; }
  }

  _emit(raw) {
    try {
      this.onItem(raw);
    } catch (e) {
      log('error', 'wikistream onItem failed', { err: e });
    }
  }

  _event(ev) {
    const now = this.now();
    this.lastActivity = now;
    this.lastEvent = now;
    this.rate.hit();
    if (ev.id) this.lastId = ev.id.slice(0, 2000);

    let e;
    try { e = JSON.parse(ev.data); } catch (_) { return; }
    if (!e || e.wiki !== 'enwiki' || e.namespace !== 0 || e.bot === true) return;
    if (e.type !== 'new' && e.type !== 'edit') return;
    const title = typeof e.title === 'string' ? e.title : '';
    if (!title || !this._hit(title)) return;

    const t = Number.isFinite(e.timestamp) ? e.timestamp * 1000 : now;
    if (e.type === 'new' && !/^\s*redirect/i.test(String(e.comment || ''))) this._newArticle(e, title, t);
    this._edit(e, title, t);
    if (++this.events % 500 === 0) this._prune(t);
  }

  _newArticle(e, title, t) {
    this._emit({
      sid: 'wiki',
      sn: 'Wikipedia',
      cls: 'signal',
      guid: 'new:' + title,
      h: cleanText('New Wikipedia article: ' + title, H_MAX),
      x: cleanText(e.comment, X_MAX),
      u: safeUrl(e.title_url || (e.meta && e.meta.uri) || ''),
      pt: t,
      pub: 'wikipedia.org',
      firstPoll: false,
      off: false
    });
  }

  _edit(e, title, t) {
    let track = this.titles.get(title);
    if (!track) {
      if (this.titles.size >= SURGE_TRACK_MAX) this._prune(t);
      track = { edits: [], firedAt: -Infinity };
      this.titles.set(title, track);
    }
    track.edits.push({ t, user: String(e.user || '') });
    while (track.edits.length && t - track.edits[0].t > SURGE_WINDOW_MS) track.edits.shift();

    const users = new Set(track.edits.map((x) => x.user)).size;
    if (track.edits.length < SURGE_EDITS || users < SURGE_USERS || t - track.firedAt < SURGE_COOLDOWN_MS) return;
    track.firedAt = t;

    // The url carries the window, because the url is the item's identity: without this
    // a second surge days later would dedupe against the first, or against the new-
    // article item for the same page.
    const bucket = Math.floor(t / SURGE_COOLDOWN_MS);
    const u = 'https://en.wikipedia.org/w/index.php?title=' + encodeURIComponent(title.replace(/ /g, '_')) + '&action=history&wire=' + bucket;
    this._emit({
      sid: 'wiki',
      sn: 'Wikipedia',
      cls: 'signal',
      guid: 'surge:' + title + ':' + bucket,
      h: cleanText('Wikipedia edit surge: ' + title, H_MAX),
      x: track.edits.length + ' edits by ' + users + ' editors in 10 minutes',
      u: safeUrl(u),
      pt: t,
      pub: 'wikipedia.org',
      firstPoll: false,
      off: false
    });
  }

  _prune(t) {
    for (const [title, track] of this.titles) {
      const last = track.edits.length ? track.edits[track.edits.length - 1].t : -Infinity;
      if (t - last > SURGE_WINDOW_MS && t - track.firedAt > SURGE_COOLDOWN_MS) this.titles.delete(title);
    }
    if (this.titles.size >= SURGE_TRACK_MAX) this.titles.clear();
  }
}

module.exports = { Jetstream, WikiStream, SseParser, RateWindow, JETSTREAM_HOSTS };
