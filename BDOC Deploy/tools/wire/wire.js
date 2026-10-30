#!/usr/bin/env node
// ============================================================
// bdoc-wire — LIVE WIRE collector daemon
// ============================================================
// WHY THIS EXISTS
// Directive from Travon, 2026-10-30: "I need to know in real time what is going on."
// This process reads ~130 sources around the clock, decides what each headline claims
// and how far to believe it, and pushes the result to the owner's browser. Contract:
// docs/LIVE-WIRE-SPEC.md. Runbook: tools/wire/README.md.
//
// This file only wires the parts together. The rules live in lib/.
//
// DESIGN NOTES
// - One bad source must never stop the collector. Parsers and streams isolate their
//   own failures, and anything that still escapes lands in the uncaughtException
//   handler below, which logs and carries on. Only a burst of them exits non-zero, so
//   systemd restarts us into a clean state rather than limping.
// - Secrets stay in process.env. Nothing here logs a value from it. Hermes shares this
//   droplet, so this process opens no port and reads nothing outside its own state.
// - Exit codes mean something to systemd: 0 for a requested stop, 1 for fatal.
//
// RUN   WIRE_DRY=1 WIRE_DB=/tmp/wire.db node wire.js
// ENV   see readConfig(), and spec section 10

'use strict';

const { log } = require('./lib/util');
const { SOURCES, customSource } = require('./lib/sources');
const { Scheduler } = require('./lib/fetcher');
const { Jetstream, WikiStream } = require('./lib/streams');
const { Gdelt } = require('./lib/gdelt');
const { prefilter, setCustomTerms } = require('./lib/classify');
const { openStore } = require('./lib/store');
const { Pipeline } = require('./lib/pipeline');
const { Publisher, SnapshotPoster } = require('./lib/publish');
const { Pager } = require('./lib/alert');

const STATUS_LOG_MS = 60000;
const SHUTDOWN_STEP_MS = 3000;
const SHUTDOWN_HARD_MS = 8000;
const CRASH_WINDOW_MS = 60000;
const CRASH_LIMIT = 10;
const GDELT_EVERY_S = 900;

function readConfig(env) {
  return {
    dry: env.WIRE_DRY === '1',
    topic: env.WIRE_TOPIC || '',
    ingestKey: env.WIRE_INGEST_KEY || '',
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseKey: env.SUPABASE_PUBLISHABLE_KEY || '',
    site: env.WIRE_SITE || 'https://kgsbdoc.netlify.app',
    tgToken: env.TELEGRAM_BOT_TOKEN || '',
    tgChat: env.TELEGRAM_CHAT_ID || '',
    db: env.WIRE_DB || '/var/lib/bdoc-wire/wire.db'
  };
}

// Names only, never values.
function missingConfig(cfg) {
  if (cfg.dry) return [];
  const need = [['WIRE_TOPIC', cfg.topic], ['WIRE_INGEST_KEY', cfg.ingestKey], ['SUPABASE_URL', cfg.supabaseUrl], ['SUPABASE_PUBLISHABLE_KEY', cfg.supabaseKey]];
  return need.filter(([, v]) => !v).map(([k]) => k);
}

const timeout = (ms) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  if (t.unref) t.unref();
});

// GDELT is a poller with its own loop, not a Scheduler source. It still has to show up
// in the same health list, or a dead GDELT would be invisible to the owner.
function gdeltRow(st) {
  return {
    id: 'gdelt', n: 'GDELT GKG', cls: 'aggregator', kind: 'gdelt', every: GDELT_EVERY_S, ok: !!st.ok,
    lastOk: st.lastEvent, lastErr: st.lastErr || null, err: st.err || null, newest: st.lastEvent,
    c1h: st.hits || 0, c24h: 0, fails: st.err ? 1 : 0, stale: false
  };
}

function main() {
  const cfg = readConfig(process.env);
  const startedAt = Date.now();
  const upSec = () => Math.floor((Date.now() - startedAt) / 1000);

  const missing = missingConfig(cfg);
  if (missing.length) {
    log('error', 'missing required environment, exiting', { missing });
    process.exit(1);
  }
  if (!cfg.dry && (!cfg.tgToken || !cfg.tgChat)) {
    // The feed is still worth having, so this does not stop the daemon. It is loud
    // because it means a real catastrophe would not reach the phone.
    log('error', 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing: pages will NOT be delivered');
  }

  const store = openStore({ file: cfg.db });
  store.start();

  let scheduler = null;
  let jetstream = null;
  let wiki = null;
  let gdelt = null;
  let activeCustomIds = new Set();

  const pager = new Pager({ token: cfg.tgToken, chatId: cfg.tgChat, dry: cfg.dry, site: cfg.site, startedAt, store });

  function sourceRows() {
    return scheduler.health().concat(gdeltRow(gdelt.status()));
  }

  function heartbeat() {
    const rows = sourceRows();
    const streams = [jetstream.status(), wiki.status()];
    return {
      ts: Date.now(),
      up: upSec(),
      ok: rows.filter(r => r.ok).length + streams.filter(s => s.ok).length,
      total: rows.length + streams.length,
      items1m: pipeline.stats().items1m,
      official: scheduler.ctx.official
    };
  }

  const publisher = new Publisher({
    supabaseUrl: cfg.supabaseUrl, key: cfg.supabaseKey, topic: cfg.topic, dry: cfg.dry, heartbeat
  });

  const pipeline = new Pipeline({
    store, publisher, pager,
    official: () => (scheduler ? scheduler.ctx.official : {})
  });

  const restored = pipeline.restore();
  pager.restore(restored.pageTimes);
  log('info', 'state restored', { items: restored.items, stories: restored.clusters, store: store.stats().kind });

  // Applied at start from the store and after every snapshot from the function.
  // Idempotent, so an unchanged list costs nothing.
  function applyWatch(list) {
    const terms = setCustomTerms(list);
    const want = new Map(terms.map((t) => { const s = customSource(t); return [s.id, s]; }));
    let changed = false;
    for (const id of activeCustomIds) {
      if (!want.has(id)) { scheduler.remove(id); changed = true; }
    }
    for (const [id, s] of want) {
      if (!activeCustomIds.has(id)) { scheduler.add(s); changed = true; }
    }
    activeCustomIds = new Set(want.keys());
    if (changed) {
      store.set('watch', terms);
      log('info', 'watch list updated', { terms: terms.length });
    }
  }

  function onItems(items) {
    for (const raw of items) pipeline.ingest(raw);
  }

  scheduler = new Scheduler({
    sources: SOURCES,
    onItems,
    isFirstPoll: (id) => !store.isPolled(id),
    markPolled: (id) => store.markPolled(id)
  });

  jetstream = new Jetstream({
    prefilter,
    onItem: (raw) => pipeline.ingest(raw),
    getCursor: () => store.get('jetstream.cursor'),
    setCursor: (c) => store.set('jetstream.cursor', c)
  });

  wiki = new WikiStream({ prefilter, onItem: (raw) => pipeline.ingest(raw) });
  gdelt = new Gdelt({ prefilter, onItems });

  function health() {
    return {
      ts: Date.now(),
      up: upSec(),
      sources: sourceRows(),
      streams: { bsky: jetstream.status(), wiki: wiki.status() },
      publish: publisher.stats(),
      snapshot: poster.stats(),
      store: store.stats(),
      pages: pager.stats(),
      pipeline: pipeline.counters()
    };
  }

  function buildSnapshot() {
    const ts = Date.now();
    return { v: 1, ts, generated: new Date(ts).toISOString(), items: pipeline.selectSnapshot(), health: health(), stats: pipeline.stats() };
  }

  const poster = new SnapshotPoster({
    site: cfg.site, key: cfg.ingestKey, dry: cfg.dry, build: buildSnapshot, onWatch: applyWatch
  });

  applyWatch(store.get('watch') || []);

  let stopping = false;

  async function shutdown(code, why) {
    if (stopping) return;
    stopping = true;
    log('info', 'stopping', { why });
    const hard = setTimeout(() => {
      log('error', 'shutdown overran, exiting');
      try { store.close(); } catch (_) { /* exiting either way */ }
      process.exit(code);
    }, SHUTDOWN_HARD_MS);
    if (hard.unref) hard.unref();

    const step = (p) => Promise.race([Promise.resolve(p).catch(() => {}), timeout(SHUTDOWN_STEP_MS)]);
    try {
      clearInterval(statusTimer);
      poster.stop();
      await step(Promise.allSettled([scheduler.stop(), jetstream.stop(), wiki.stop(), gdelt.stop()]));
      await step(publisher.stop());
      await step(poster.post());
      await step(pager.settle());
    } catch (e) {
      log('error', 'shutdown step failed', { err: e });
    }
    try {
      store.close();
    } catch (e) {
      log('error', 'store close failed', { err: e });
    }
    log('info', 'stopped');
    process.exit(code);
  }

  process.on('SIGTERM', () => shutdown(0, 'SIGTERM'));
  process.on('SIGINT', () => shutdown(0, 'SIGINT'));

  // A stray throw from one source must not take the other 132 down with it, but an
  // endless stream of them means our own state is broken, so let systemd start clean.
  const crashes = [];
  function onCrash(kind, e) {
    log('error', kind, { err: e, stack: e && e.stack ? String(e.stack).slice(0, 1000) : undefined });
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0] > CRASH_WINDOW_MS) crashes.shift();
    if (crashes.length >= CRASH_LIMIT) shutdown(1, 'too many uncaught errors');
  }
  process.on('uncaughtException', (e) => onCrash('uncaught exception', e));
  process.on('unhandledRejection', (e) => onCrash('unhandled rejection', e));

  const statusTimer = setInterval(() => {
    const rows = sourceRows();
    log('info', 'status', {
      up: upSec(),
      sourcesOk: rows.filter(r => r.ok).length,
      sourcesTotal: rows.length,
      bskyPerMin: jetstream.status().perMin,
      wikiPerMin: wiki.status().perMin,
      counts: pipeline.counters(),
      publish: publisher.stats(),
      pages: pager.stats()
    });
  }, STATUS_LOG_MS);
  if (statusTimer.unref) statusTimer.unref();

  publisher.start();
  poster.start();
  scheduler.start();
  jetstream.start();
  wiki.start();
  gdelt.start();

  log('info', 'bdoc-wire started', { dry: cfg.dry, node: process.version, sources: SOURCES.length, custom: activeCustomIds.size });
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    log('error', 'fatal startup error', { err: e, stack: e && e.stack ? String(e.stack).slice(0, 1000) : undefined });
    process.exit(1);
  }
}

module.exports = { readConfig, missingConfig, gdeltRow };
