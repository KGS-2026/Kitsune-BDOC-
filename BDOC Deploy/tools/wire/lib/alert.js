// ============================================================
// alert — the only code path that can reach Travon's phone
// ============================================================
// WHY THIS EXISTS
// P110 doctrine (2026-08-04): no alert fatigue. Everything lands in the feed and only
// the catastrophic tier reaches Telegram. A page that turns out to be a rumor, a drill
// or last night's backlog teaches the owner to ignore pages, which is worse than having
// no pager at all. So shouldPage is a list of ways to say no, and a story has to get
// past every one of them.
//
// DESIGN NOTES
// - blockReason() returns why a page was refused, and shouldPage is just "no reason".
//   When a real event does not page, the log has to say which gate stopped it.
// - The story must stand without backlog. Spec section 8 says first-poll items never
//   page, so official or corroborated has to hold on live items alone. A second
//   backfilled outlet does not count as a witness.
// - Two live publishers must each make the critical claim themselves (cluster.strong).
//   One false merge can put a sev 3 headline beside an unrelated report; that is a fake
//   confirmation, and the spec names it as the failure that could page someone. A real
//   catastrophe has dozens of outlets saying it within minutes, so this costs seconds.
// - Plain text with no parse_mode, always. Feed text is hostile: with Markdown or HTML
//   a headline could forge a link or break the message so it never arrives.
// - Link previews are off. A preview makes Telegram fetch and render a page chosen by
//   whoever wrote the feed, which breaks the "no images from feed URLs" rule.
// - A page is marked before the send, so two items in one tick cannot double-page. If
//   delivery really fails the mark is undone, so the next item in the story can retry.

'use strict';

const { log, safeUrl } = require('./util');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MIN_UPTIME_MS = 5 * 60 * 1000;
const MAX_PER_HOUR = 6;
const MAX_PER_DAY = 20;
const SEND_ATTEMPTS = 3;
const SEND_TIMEOUT_MS = 10000;
const RETRY_BASE_MS = 1000;
const RETRY_AFTER_CAP_MS = 30000;
const SITE = 'https://kgsbdoc.netlify.app';

function blockReason(c, ctx) {
  if (!c) return 'no story';
  if (c.base !== 3) return 'base sev below 3';
  if (c.st !== 'official' && c.st !== 'corroborated') return 'status ' + c.st;
  if (c.disputed) return 'disputed';
  if (c.drill) return 'drill';
  if (!c.fresh) return 'newest item not fresh';
  if (c.st === 'official') {
    if (!c.liveOff) return 'only first-poll items';
    if (!c.offStrong) return 'official item did not claim sev 3';
  } else {
    if (!c.livePubs || c.livePubs.size < 2) return 'corroboration rests on first-poll items';
    if (!c.strong || c.strong.size < 2) return 'fewer than two outlets claim it';
    // Two papers running one wire story are one source. See independent() in cluster.js.
    if (c.strongWordings && c.strongWordings.size < 2) return 'only one wording, likely syndicated';
  }
  if (!(ctx.uptimeMs > MIN_UPTIME_MS)) return 'daemon up under 5 min';
  if (c.paged) return 'already paged';
  if (ctx.pagesLastHour >= MAX_PER_HOUR) return 'hourly limit';
  if (ctx.pagesLastDay >= MAX_PER_DAY) return 'daily limit';
  return null;
}

function shouldPage(c, ctx) {
  return blockReason(c, ctx) === null;
}

// Newlines in a headline could forge the "Live:" line beneath it.
const SEPARATORS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

function oneLine(s, max) {
  return String(s == null ? '' : s)
    .replace(SEPARATORS, ' ')
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function hhmm(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return Number.isFinite(d.getTime()) ? `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : '--:--';
}

// The exact layout in spec section 6. A line with nothing to say is left out.
function formatPage(c, site) {
  const top = c.top || {};
  const n = c.n || 1;
  const lines = [
    `BDOC WIRE — CRITICAL · ${String(c.st).toUpperCase()} (${n} ${n === 1 ? 'outlet' : 'outlets'})`,
    oneLine(top.h, 300),
    `${oneLine(top.sn, 80) || 'Unknown source'} · ${hhmm(top.t)} UTC`
  ];
  const url = safeUrl(top.u);
  if (url) lines.push(oneLine(url, 600));
  lines.push(`Live: ${site || SITE}/wire`);
  return lines.join('\n');
}

const pause = (ms) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  if (t.unref) t.unref();
});

// One message. Resolves true or false and never rejects.
async function sendTelegram(o) {
  const body = JSON.stringify({
    chat_id: o.chatId,
    text: o.text,
    disable_notification: false,
    link_preview_options: { is_disabled: true }
  });
  const url = `https://api.telegram.org/bot${o.token}/sendMessage`;
  const attempts = o.attempts || SEND_ATTEMPTS;
  const wait = o.pause || pause;
  for (let i = 1; i <= attempts; i++) {
    let delay = RETRY_BASE_MS * 2 ** (i - 1);
    try {
      const res = await o.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(o.timeoutMs || SEND_TIMEOUT_MS)
      });
      if (res.ok) return true;
      // Status only. The token is in the URL, so nothing about the request is logged.
      log('warn', 'telegram refused page', { status: res.status, attempt: i });
      if (res.status === 429) {
        const j = await res.json().catch(() => null);
        const secs = j && j.parameters && Number(j.parameters.retry_after);
        if (secs > 0) delay = Math.min(secs * 1000, RETRY_AFTER_CAP_MS);
      } else if (res.status >= 400 && res.status < 500) {
        return false;   // a bad token or chat id will not fix itself by retrying
      }
    } catch (e) {
      log('warn', 'telegram send failed', { kind: e && e.name, attempt: i });
    }
    if (i < attempts) await wait(delay);
  }
  return false;
}

class Pager {
  constructor(opts) {
    const o = opts || {};
    this.token = o.token || '';
    this.chatId = o.chatId || '';
    this.dry = !!o.dry;
    this.site = o.site || SITE;
    this.now = o.now || Date.now;
    this.startedAt = o.startedAt === undefined ? this.now() : o.startedAt;
    this.fetchImpl = o.fetchImpl || ((u, i) => globalThis.fetch(u, i));
    this.store = o.store || null;
    this.pause = o.pause || pause;
    this.times = [];      // when each page went out, newest last
    this.counts = { sent: 0, failed: 0, blocked: 0, skippedNoCreds: 0 };
    this.lastBlocked = null;
    this.inflight = new Set();
  }

  // Page times from the store, so a restart cannot reset the rate limit.
  restore(times) {
    const cutoff = this.now() - DAY;
    this.times = (times || []).filter(t => t > cutoff).sort((a, b) => a - b);
  }

  context() {
    const now = this.now();
    this.times = this.times.filter(t => now - t < DAY);
    return {
      uptimeMs: now - this.startedAt,
      pagesLastHour: this.times.filter(t => now - t < HOUR).length,
      pagesLastDay: this.times.length
    };
  }

  /**
   * Called for any story at base sev 3. Decides synchronously, delivers in the
   * background, and never throws: ingest must not wait on Telegram.
   */
  consider(cluster) {
    let why;
    try {
      why = blockReason(cluster, this.context());
      if (why) {
        this.counts.blocked++;
        this.lastBlocked = why;
        log('info', 'page blocked', { c: cluster && cluster.id, why });
        return false;
      }
      this._fire(cluster);
      return true;
    } catch (e) {
      log('error', 'page gate failed', { err: e });
      return false;
    }
  }

  _fire(cluster) {
    const t = this.now();
    cluster.paged = true;
    this.times.push(t);
    const text = formatPage(cluster, this.site);

    if (this.dry) {
      log('info', 'WOULD PAGE', { c: cluster.id, st: cluster.st, n: cluster.n, h: cluster.top && cluster.top.h });
      this.counts.sent++;
      return;
    }
    if (!this.token || !this.chatId) {
      this.counts.skippedNoCreds++;
      log('error', 'page not sent: Telegram credentials missing', { c: cluster.id });
      return;
    }

    const run = sendTelegram({
      token: this.token, chatId: this.chatId, text, fetchImpl: this.fetchImpl, pause: this.pause
    }).then((ok) => {
      if (ok) {
        this.counts.sent++;
        if (this.store && this.store.recordPage) this.store.recordPage(cluster.id, t);
        log('warn', 'paged', { c: cluster.id, st: cluster.st, n: cluster.n });
        return;
      }
      // Undo, so this failure neither eats the rate limit nor silences the story.
      this.counts.failed++;
      cluster.paged = false;
      const i = this.times.indexOf(t);
      if (i >= 0) this.times.splice(i, 1);
      log('error', 'page delivery failed', { c: cluster.id });
    }).catch((e) => {
      log('error', 'page handler failed', { err: e });
    }).finally(() => {
      this.inflight.delete(run);
    });
    this.inflight.add(run);
  }

  // For shutdown and tests: wait for sends already in flight.
  async settle() {
    await Promise.allSettled([...this.inflight]);
  }

  stats() {
    const c = this.context();
    return Object.assign({ lastHour: c.pagesLastHour, lastDay: c.pagesLastDay, lastBlocked: this.lastBlocked }, this.counts);
  }
}

module.exports = { Pager, shouldPage, blockReason, formatPage, sendTelegram, MAX_PER_HOUR, MAX_PER_DAY, MIN_UPTIME_MS };
