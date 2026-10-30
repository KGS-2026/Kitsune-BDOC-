// ============================================================
// publish — getting items out of the droplet
// ============================================================
// WHY THIS EXISTS
// The droplet holds all of Hermes's secrets and opens no inbound port, so nothing can
// ever connect to it. Everything leaves by outbound HTTPS, on two independent paths:
//   Publisher       Supabase Realtime Broadcast, the owner's browser in about 100 ms
//   SnapshotPoster  the Netlify function, every 60 s, for backfill and fallback
// Losing the first degrades the feed to ~90 s latency, not silence. That is why a
// failed broadcast is simply dropped after a retry: the snapshot will carry the item,
// and a queue that retries forever is how a Realtime outage becomes a memory leak.
//
// DESIGN NOTES
// - Ingest never waits on the network. publish() and update() only touch memory.
// - Nothing here throws or rejects into the daemon. A failed POST is a counter in
//   health, because a publishing failure must not stop collection.
// - flush() is single-flight. A slow or down Realtime therefore cannot pile up
//   concurrent requests, and sev 2+ items arriving mid-flight go out on the next pass.
// - The topic is the secret that gates the owner's channel (spec section 3), so it and
//   the keys are never logged. Errors log a status code, not a request.

'use strict';

const { log } = require('./util');

const MAX_PAYLOAD = 200 * 1024;
const ENVELOPE = 256;
const FLUSH_MS = 2000;
const HEARTBEAT_MS = 15000;
const MAX_QUEUE = 5000;
const TIMEOUT_MS = 8000;
const ATTEMPTS = 3;
const BACKOFF_MS = 500;
const LOG_GAP_MS = 30000;
const SNAPSHOT_MS = 60000;
const SNAPSHOT_FIRST_MS = 15000;
const SNAPSHOT_TIMEOUT_MS = 20000;

const pause = (ms) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  if (t.unref) t.unref();
});

const sizeOf = (x) => Buffer.byteLength(JSON.stringify(x)) + 1;

function errName(e) {
  return e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network error';
}

// One readable line per item, for `WIRE_DRY=1 node wire.js | less`.
function dryLine(it) {
  const tags = [...(it.cat || []), ...(it.w || [])].join(',') || '-';
  return `DRY item sev=${it.sev} st=${it.st} n=${it.n} cls=${it.cls} src=${it.src} tags=${tags} | ${it.h}\n`;
}

class Publisher {
  constructor(opts) {
    const o = opts || {};
    this.url = o.supabaseUrl ? String(o.supabaseUrl).replace(/\/+$/, '') + '/realtime/v1/api/broadcast' : '';
    this.key = o.key || '';
    this.topic = o.topic || '';
    this.dry = !!o.dry;
    this.fetchImpl = o.fetchImpl || ((u, i) => globalThis.fetch(u, i));
    this.now = o.now || Date.now;
    this.heartbeat = o.heartbeat || (() => ({}));
    this.out = o.out || ((s) => process.stdout.write(s));
    this.maxQueue = o.maxQueue || MAX_QUEUE;
    this.flushMs = o.flushMs || FLUSH_MS;
    this.hbMs = o.hbMs || HEARTBEAT_MS;
    this.timeoutMs = o.timeoutMs || TIMEOUT_MS;
    this.attempts = o.attempts || ATTEMPTS;
    this.backoffMs = o.backoffMs === undefined ? BACKOFF_MS : o.backoffMs;
    this.maxPayload = o.maxPayload || MAX_PAYLOAD;

    this.queue = [];
    this.upds = new Map();
    this.flushing = null;
    this.again = false;
    this.soon = false;
    this.c = { items: 0, upds: 0, batches: 0, dropped: 0, droppedFailed: 0, failed: 0, hbOk: 0, hbFail: 0 };
    this.lastOk = null;
    this.lastErr = null;
    this.lastLog = 0;
  }

  start() {
    this.flushTimer = setInterval(() => { this.flush(); }, this.flushMs);
    this.hbTimer = setInterval(() => { this.beat(); }, this.hbMs);
    if (this.flushTimer.unref) this.flushTimer.unref();
    if (this.hbTimer.unref) this.hbTimer.unref();
  }

  async stop() {
    clearInterval(this.flushTimer);
    clearInterval(this.hbTimer);
    await this.flush();
  }

  publish(item) {
    if (this.dry) {
      this.out(dryLine(item));
      this.c.items++;
      return;
    }
    this.queue.push(item);
    if (this.queue.length > this.maxQueue) {
      this.queue.shift();
      this.c.dropped++;
    }
    if (item.sev >= 2) this._flushSoon();
  }

  update(u) {
    if (this.dry) {
      this.out(`DRY upd c=${u.c} st=${u.st} n=${u.n} sev=${u.sev}\n`);
      this.c.upds++;
      return;
    }
    this.upds.delete(u.c);    // re-insert so the Map stays in age order
    this.upds.set(u.c, u);
    if (this.upds.size > this.maxQueue) {
      this.upds.delete(this.upds.keys().next().value);
      this.c.dropped++;
    }
    if (u.sev >= 2) this._flushSoon();
  }

  // Coalesces a burst of sev 2 items from one poll into one POST.
  _flushSoon() {
    if (this.soon) return;
    this.soon = true;
    setImmediate(() => {
      this.soon = false;
      this.flush();
    });
  }

  // Oldest first, up to the payload limit. A batch that is too big waits its turn.
  _take() {
    const items = [];
    const upd = [];
    let bytes = ENVELOPE;
    while (this.queue.length) {
      const s = sizeOf(this.queue[0]);
      if (items.length && bytes + s > this.maxPayload) break;
      items.push(this.queue.shift());
      bytes += s;
    }
    for (const [c, u] of this.upds) {
      const s = sizeOf(u);
      if ((items.length || upd.length) && bytes + s > this.maxPayload) break;
      upd.push(u);
      this.upds.delete(c);
      bytes += s;
    }
    return { items, upd };
  }

  flush() {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = this._drain().finally(() => {
      this.flushing = null;
      if (this.again) {
        this.again = false;
        this.flush();
      }
    });
    return this.flushing;
  }

  async _drain() {
    try {
      while (this.queue.length || this.upds.size) {
        const batch = this._take();
        const ok = await this._send('b', batch, this.attempts);
        if (ok) {
          this.c.items += batch.items.length;
          this.c.upds += batch.upd.length;
          this.c.batches++;
        } else {
          // Retry-then-drop. The next snapshot carries these items.
          this.c.failed++;
          this.c.droppedFailed += batch.items.length;
        }
      }
    } catch (e) {
      this._note(e && e.message);
    }
  }

  async beat() {
    let payload;
    try {
      payload = this.heartbeat();
    } catch (e) {
      this._note('heartbeat build failed: ' + (e && e.message));
      return false;
    }
    if (this.dry) {
      this.out(`DRY hb ${JSON.stringify(payload)}\n`);
      return true;
    }
    const ok = await this._send('hb', payload, 1);
    if (ok) this.c.hbOk++;
    else this.c.hbFail++;
    return ok;
  }

  // Resolves true or false. Never rejects.
  async _send(event, payload, attempts) {
    if (!this.url || !this.key || !this.topic) {
      this._note('realtime not configured');
      return false;
    }
    let body;
    try {
      body = JSON.stringify({ messages: [{ topic: this.topic, event, payload, private: false }] });
    } catch (e) {
      this._note('payload did not serialize');
      return false;
    }
    for (let i = 1; i <= attempts; i++) {
      try {
        const res = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        if (res.ok) {
          this.lastOk = this.now();
          return true;
        }
        this._note('HTTP ' + res.status);
        if (res.status >= 400 && res.status < 500 && res.status !== 429) return false;
      } catch (e) {
        this._note(errName(e));
      }
      if (i < attempts) await pause(this.backoffMs * 2 ** (i - 1));
    }
    return false;
  }

  _note(msg) {
    this.lastErr = msg;
    const now = this.now();
    if (now - this.lastLog < LOG_GAP_MS) return;
    this.lastLog = now;
    log('warn', 'realtime publish problem', { err: msg, queued: this.queue.length });
  }

  stats() {
    return Object.assign({ queued: this.queue.length, updQueued: this.upds.size, lastOk: this.lastOk, lastErr: this.lastErr }, this.c);
  }
}

class SnapshotPoster {
  constructor(opts) {
    const o = opts || {};
    this.url = o.site ? String(o.site).replace(/\/+$/, '') + '/.netlify/functions/wire' : '';
    this.key = o.key || '';
    this.dry = !!o.dry;
    this.build = o.build || (() => ({}));
    this.onWatch = o.onWatch || (() => {});
    this.fetchImpl = o.fetchImpl || ((u, i) => globalThis.fetch(u, i));
    this.now = o.now || Date.now;
    this.everyMs = o.everyMs || SNAPSHOT_MS;
    this.firstMs = o.firstMs === undefined ? SNAPSHOT_FIRST_MS : o.firstMs;
    this.timeoutMs = o.timeoutMs || SNAPSHOT_TIMEOUT_MS;
    this.running = false;
    this.c = { ok: 0, failed: 0 };
    this.lastOk = null;
    this.lastErr = null;
    this.lastBytes = 0;
  }

  start() {
    this.firstTimer = setTimeout(() => { this.post(); }, this.firstMs);
    this.timer = setInterval(() => { this.post(); }, this.everyMs);
    if (this.firstTimer.unref) this.firstTimer.unref();
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    clearTimeout(this.firstTimer);
    clearInterval(this.timer);
  }

  // Resolves true or false. Never rejects.
  async post() {
    if (this.running) return false;
    this.running = true;
    try {
      const snap = this.build();
      const body = JSON.stringify(snap);
      this.lastBytes = Buffer.byteLength(body);
      if (this.dry) {
        log('info', 'DRY snapshot', { bytes: this.lastBytes, items: snap && snap.items ? snap.items.length : 0 });
        this.c.ok++;
        this.lastOk = this.now();
        return true;
      }
      if (!this.url || !this.key) throw new Error('snapshot path not configured');
      const res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wire-key': this.key },
        body,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const reply = await res.json().catch(() => null);
      this.c.ok++;
      this.lastOk = this.now();
      this.lastErr = null;
      // No list means no news. An absent watch must never read as "clear every term".
      if (reply && Array.isArray(reply.watch)) {
        try {
          this.onWatch(reply.watch);
        } catch (e) {
          log('error', 'watch update failed', { err: e });
        }
      }
      return true;
    } catch (e) {
      this.c.failed++;
      this.lastErr = /^HTTP |not configured/.test(e && e.message) ? e.message : errName(e);
      log('warn', 'snapshot post failed', { err: this.lastErr });
      return false;
    } finally {
      this.running = false;
    }
  }

  stats() {
    return Object.assign({ lastOk: this.lastOk, lastErr: this.lastErr, lastBytes: this.lastBytes }, this.c);
  }
}

module.exports = { Publisher, SnapshotPoster, dryLine, MAX_PAYLOAD, MAX_QUEUE };
