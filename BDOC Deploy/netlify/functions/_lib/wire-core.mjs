// BDOC — LIVE WIRE function core (p160)
//
// WHY THIS EXISTS: the droplet opens no inbound port (it holds all of Hermes's
// secrets), so it cannot be asked for anything. It pushes a snapshot here every
// 60 s and the owner's browser reads it back. That gives the feed a second path
// that shares nothing with Supabase Realtime: lose the socket and the owner
// drops to ~90 s latency instead of silence.
//
// WHY IT IS NOT IN wire.mjs: CI runs with no node_modules, so anything importing
// @netlify/blobs cannot be tested there. The store is passed in, and wire.mjs is
// a two-line shell around handle().
//
//   GET  ?probe=1                 owner JWT    {owner:true}, no Blobs read
//   GET                           owner JWT    {owner:true, topic, snapshot, watch, ageSec}
//   POST                          x-wire-key   stores the snapshot, {ok:true, watch}
//   POST ?action=watch {terms}    owner JWT    replaces custom terms, {ok:true, watch}
//
// DESIGN NOTES
// - No token or a bad one is 401, a valid non-owner is 403, and the body is the
//   same {error} shape on every denial. The topic appears in exactly one place,
//   the owner read, because that string is what unlocks the live feed.
// - Fails closed per credential. An unset BDOC_OWNER_IDS means nobody is the
//   owner and an unset WIRE_INGEST_KEY means nothing can be ingested. Neither
//   blocks the other: during a key rotation the owner must still be able to read
//   the last snapshot, and its ageSec shows how stale it is.
// - Every response is no-store, including denials. This is the one endpoint on
//   the site whose body must never sit in a shared cache.
//
// Contract: docs/LIVE-WIRE-SPEC.md section 3. (c) 2026 Kitsune Global Solutions LLC

import { createHash, timingSafeEqual } from 'node:crypto';
import { checkOwner } from './owner.mjs';

// Netlify buffers function responses up to 6 MB. The owner read wraps the
// snapshot, so the cap sits well under that instead of finding the limit at
// read time, when the only copy has already been overwritten.
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

export const MAX_TERMS = 40;
export const TERM_MIN_CHARS = 2;
export const TERM_MAX_CHARS = 64;

const SITE_ORIGIN = 'https://kgsbdoc.netlify.app';
const STRONG_JSON = { type: 'json', consistency: 'strong' };

// Control and invisible format characters, the kind that arrive on a paste:
// C0, DEL, C1, zero-width, bidi overrides, line separators, BOM.
const CONTROL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

function responseHeaders(origin) {
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin, Authorization'
  };
  // The page is same-origin and the daemon is not a browser, so this only ever
  // decides what a foreign site's script may read: nothing. x-wire-key is left
  // out of the allowed headers because no browser has any business sending it.
  if (origin === SITE_ORIGIN) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  }
  return h;
}

// Hashing first gives timingSafeEqual two equal-length inputs, which it needs
// (it throws otherwise) and which also keeps the key's length out of the timing.
export function keyMatches(given, expected) {
  if (!expected || typeof given !== 'string' || !given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// Terms are stored as literal text. Metacharacters survive untouched, and the
// daemon must match them as phrases, never compile them into a regex.
export function cleanTerms(terms) {
  if (!Array.isArray(terms)) return { error: 'terms must be an array' };
  if (terms.length > MAX_TERMS) return { error: `at most ${MAX_TERMS} terms` };

  const out = [];
  const seen = new Set();
  for (const raw of terms) {
    if (typeof raw !== 'string') return { error: 'terms must be strings' };
    const term = raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
    if (term.length < TERM_MIN_CHARS || term.length > TERM_MAX_CHARS) {
      return { error: `each term must be ${TERM_MIN_CHARS} to ${TERM_MAX_CHARS} characters` };
    }
    const folded = term.toLowerCase();
    if (!seen.has(folded)) { seen.add(folded); out.push(term); }
  }
  return { terms: out };
}

function snapshotProblem(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return 'snapshot must be an object';
  if (s.v !== 1) return 'unsupported snapshot version';
  if (!Number.isFinite(s.ts)) return 'snapshot ts must be epoch ms';
  if (!Array.isArray(s.items)) return 'snapshot items must be an array';
  return null;
}

// The list until the owner first edits it. Each one is a real anchor from live
// coverage on 2026-10-30, and the owner's first save replaces all of them.
export const DEFAULT_WATCH = ['No Kings', 'Local 26', 'grand jury subpoena', 'false flag',
  'Insurrection Act', 'day after the election'];

// Deliberately does not swallow errors, unlike readIndex in push-subscribe.mjs.
// Answering [] during a Blobs blip would tell the daemon the owner had deleted
// every custom term.
async function readWatch(st) {
  const w = await st.get('watch', STRONG_JSON);
  return w && Array.isArray(w.terms) ? w.terms : DEFAULT_WATCH;
}

async function readFeed(ctx, probe) {
  const gate = await checkOwner(ctx.req.headers.get('authorization'), ctx);
  // "Am I the owner?" answered no is an answer, not an error. As a 403 it would put a red
  // line in every signed-in customer's console on every page load, and it says nothing a
  // 403 does not. It carries no data either way.
  if (probe && gate.status === 403) return ctx.send({ owner: false });
  if (!gate.ok) return ctx.send({ error: gate.error }, gate.status);
  if (probe) return ctx.send({ owner: true });

  return ctx.withStore(async (st) => {
    const [snapshot, watch] = await Promise.all([st.get('snapshot', STRONG_JSON), readWatch(st)]);
    const ageSec = snapshot && Number.isFinite(snapshot.ts)
      ? Math.max(0, Math.round((ctx.now() - snapshot.ts) / 1000))
      : null;
    return ctx.send({
      owner: true,
      topic: ctx.env.WIRE_TOPIC || null,
      snapshot: snapshot || null,
      watch,
      ageSec
    });
  });
}

async function ingest(ctx) {
  // The key is checked before the body is read, so a caller without it cannot
  // make this function buffer or parse anything.
  if (!keyMatches(ctx.req.headers.get('x-wire-key'), ctx.env.WIRE_INGEST_KEY)) {
    return ctx.send({ error: 'unauthorized' }, 401);
  }
  if (Number(ctx.req.headers.get('content-length')) > MAX_SNAPSHOT_BYTES) {
    return ctx.send({ error: 'snapshot too large' }, 413);
  }

  let text;
  try { text = await ctx.req.text(); }
  catch (_) { return ctx.send({ error: 'bad body' }, 400); }

  // Content-Length is optional and caller-supplied, so measure what really came.
  if (Buffer.byteLength(text, 'utf8') > MAX_SNAPSHOT_BYTES) {
    return ctx.send({ error: 'snapshot too large' }, 413);
  }

  let snapshot;
  try { snapshot = JSON.parse(text); }
  catch (_) { return ctx.send({ error: 'bad json' }, 400); }

  const problem = snapshotProblem(snapshot);
  if (problem) return ctx.send({ error: problem }, 400);

  return ctx.withStore(async (st) => {
    await st.set('snapshot', text);
    return ctx.send({ ok: true, watch: await readWatch(st) });
  });
}

async function updateWatch(ctx) {
  // Auth first: a non-owner gets the same 403 whatever the body says, so the
  // validation messages below reveal nothing to anyone but the owner.
  const gate = await checkOwner(ctx.req.headers.get('authorization'), ctx);
  if (!gate.ok) return ctx.send({ error: gate.error }, gate.status);

  let body;
  try { body = await ctx.req.json(); }
  catch (_) { return ctx.send({ error: 'bad json' }, 400); }

  const cleaned = cleanTerms(body && body.terms);
  if (cleaned.error) return ctx.send({ error: cleaned.error }, 400);

  return ctx.withStore(async (st) => {
    await st.setJSON('watch', { terms: cleaned.terms, updated: new Date(ctx.now()).toISOString() });
    return ctx.send({ ok: true, watch: cleaned.terms });
  });
}

/**
 * handle(req, { store, env, now }) -> Response
 *
 * store is a function returning the Blobs store. It is not the store itself
 * because getStore() throws when Blobs is not wired: that has to become a 503
 * here, and a probe, which never touches Blobs, has to survive it.
 */
export async function handle(req, deps = {}) {
  const origin = req.headers.get('origin') || '';
  const headers = responseHeaders(origin);
  const send = (obj, status = 200, extra) =>
    new Response(JSON.stringify(obj), { status, headers: { ...headers, ...extra } });

  const ctx = {
    req,
    env: deps.env || process.env,
    now: deps.now || Date.now,
    send,
    async withStore(fn) {
      try {
        return await fn(deps.store());
      } catch (e) {
        console.error('[wire] blobs:', String(e && e.message).slice(0, 160));
        return send({ error: 'storage unavailable' }, 503);
      }
    }
  };

  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const qs = new URL(req.url).searchParams;
    if (req.method === 'GET') return await readFeed(ctx, qs.get('probe') === '1');
    if (req.method === 'POST') {
      return await (qs.get('action') === 'watch' ? updateWatch(ctx) : ingest(ctx));
    }
    return send({ error: 'method not allowed' }, 405, { Allow: 'GET, POST, OPTIONS' });
  } catch (e) {
    console.error('[wire]', String(e && e.message).slice(0, 160));
    return send({ error: 'server error' }, 500);
  }
}
