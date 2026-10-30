// BDOC — LIVE WIRE endpoint (p160, Functions v2)
//
// Thin on purpose. Every line of logic is in _lib/wire-core.mjs, which takes the
// Blobs store as a parameter, because CI has no node_modules and a test that
// imported this file would die on '@netlify/blobs'.
//
// WHY .mjs: Netlify only auto-wires Blobs credentials for Functions v2. See the
// note at the top of push-subscribe.mjs.
//
// Env: BDOC_OWNER_IDS, WIRE_INGEST_KEY, WIRE_TOPIC, supabase (the anon key).
// Contract: docs/LIVE-WIRE-SPEC.md section 3.
// (c) 2026 Kitsune Global Solutions LLC

import { getStore } from '@netlify/blobs';
import { handle } from './_lib/wire-core.mjs';

export default (req) => handle(req, { store: () => getStore('wire') });

export const config = { path: '/.netlify/functions/wire' };
