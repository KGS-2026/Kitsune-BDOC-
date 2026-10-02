# CLAUDE.md — BDOC

Claude Code auto-loads this file. It is intentionally short.

## Read this first

**→ [`HANDOFF.md`](./HANDOFF.md)** is the running baton between Hermes and
Claude Code. It holds current state, what was just shipped, and the open-items
queue. Read §0 (hard rules) and §1–2 (state + open items) before changing
anything.

## The four rules that will bite you

1. **Ship to `main` or it does not go live.** Netlify auto-deploys `main`.
   The checked-out branch is usually `hermes-overnight-2026-06-09`.
   ```bash
   git push origin HEAD:main
   ```

2. **Two agents write here.** Hermes (droplet) + a Hermes cron job + you.
   `git fetch origin` and re-read files before writing. Check for sibling edits.

3. **Bump `SW_VERSION` in `service-worker.js`** for any shipped asset change,
   or existing users never get your fix. Cache keys include the `?v=` string.

4. **`NODE_VERSION=18`.** `@supabase/supabase-js` v2 throws at import (needs
   Node 20+ WebSocket). In functions, use PostgREST over `fetch`, or go through
   `netlify/functions/_supabase.js`.

## Project shape

- `index.html` — the app. Large single file, ~13.5k lines.
- `js/cesium-init.js` — globe setup. **The viewer global is `V`, not `viewer`.**
- `css/bdoc.css` then `css/bdoc-glass.css` — base, then the glass override pass.
- `netlify/functions/` — 58 functions, mostly keyless upstream proxies.
- `tools/` — grid-down mesh gateway, IPC receiver, plugin adapters.
- `docs/` — grid-down ops, mesh setup SQL, plugin receiver spec.

## Verification standard

A layer returning **HTTP 200 can still be serving garbage** — that is exactly
how "API KEY REQUIRED" ended up tiled across the globe for weeks. Check
content-type and compare MD5 across several tiles before calling a map source
healthy. Prefer a command whose output you can paste over a claim that
something works.
