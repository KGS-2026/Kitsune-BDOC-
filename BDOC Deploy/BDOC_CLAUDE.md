# KITSUNE QUAD-CLAUDE CYCLE OF OPERATIONS
# Project: KGS BDOC — Tactical Mapping Platform
# Operator: Travon Brown | Kitsune Global Solutions LLC
# Created: 2026-04-06 | Last Updated: 2026-04-20
# Next Review: When Netlify deploy is live or 14 days, whichever comes first
# Purpose: Unified operating directive for all Claude interfaces — BDOC project

---

## IDENTITY OF THE OPERATOR

You are working for Travon Brown. Marine Corps veteran (2012-2017), MOS 0311/8152/0933, SOCOM GEOINT, Afghanistan deployment. Founder and CEO of Kitsune Global Solutions LLC (SDVOSB, CAGE: 174S8, UEI: FG87MJMMBPN6). He is building Golden Fox Holdings — a holding company with 54+ subsidiaries across defense, real estate, technology, entertainment, and finance verticals. He operates with 15-30 hours per week of empire time while working a cook job. He is currently living in his vehicle. He has zero margin for error, zero capital buffer, and zero tolerance for wasted time.

He is an INTP empiricist. He learns by doing. He thinks in systems and cross-domain patterns. He does not need motivation. He does not need caveats. He needs execution. Every hour of his time that you waste is an hour he cannot get back and an hour closer to his financial runway expiring.

Your job is to help him execute. Not plan. Not philosophize. Execute.

---

## THE CYCLE OF OPERATIONS

Like a firearm: Firing → Unlocking → Extracting → Ejecting → Cocking → Feeding → Chambering → Locking

### 1. RECEIVE (Chat)
Chat defines the mission and writes this CLAUDE.md.

### 2. LOAD (CLAUDE.md Transfer)
This file is placed in the BDOC project folder. Code reads it first every session.

### 3. CHAMBER (Code Tab — Claude Desktop)
Code reads this file, understands the BDOC mission, connects Chrome.

### 4. FIRE (Code + Chrome — Execution)
Code edits index.html directly. Chrome opens kgsbdoc.netlify.app (or local file) to verify changes render correctly.

### 5. EXTRACT (Verification)
Chrome loads the site, verifies layers render, tests toggles, confirms no console errors. If verification fails, loop back to FIRE.

**Loop Termination:** Maximum 3 verification loops before escalating to Chat. Timebox: 30 minutes per loop.

**Chrome Failure Fallback:** If Chrome cannot load the site within 60 seconds, Code documents the blocker and escalates.

### 6. EJECT (Reporting)
Code updates session log in this file with what changed.

### 7. FEED (Next Round)
If more tasks remain, cycle repeats. If mission complete, return to Chat for next project.

---

## PROJECT: KGS BDOC

**What it is:** A 3D tactical mapping and situational awareness platform. "Gorilla Maps having a baby with Google Earth and the Weather Channel." Passive awareness tool — no PII required, no team roster, no sensitive data from users.

**Tagline:** "Governments have Palantir. You have BDOC."

**Platform:** Netlify (kgsbdoc.netlify.app)
**Stack:** CesiumJS, vanilla JS, single index.html file
**Current Size:** 11,703 lines
**Brackets Balanced:** braces 0, parens 0, brackets 0 (net — verified 2026-04-20)
**Local File:** BDOC Deploy/index.html (this is the latest — NOT what's on Netlify yet)
**Revenue Model:** Operator $9.99/mo, Analyst $29.99/mo, MILITARY50 coupon for 50% off

**Competitive Positioning:**
- vs ATOC/GRIDBASE: BDOC requires no PII, no unit roster, passive only
- vs GuerillaMap: BDOC has 3D globe (they're 2D), AI copilot, subscription model
- vs Liveuamap: BDOC has satellite tracking, prediction engine (planned), deeper layer stack
- The Iran war (Operation Fury, Feb 28 2026) made this product 10x more relevant — maritime awareness, conflict tracking, energy disruption monitoring

---

## WHAT'S BUILT (25 features across 6 phases)

### Phase 1: Performance
- Font loading switched to preload with onload swap
- Scripts deferred (jsPDF, satellite.js, Supabase, MQTT) — only Cesium synchronous
- Activity feed DOM thrashing fixed with requestAnimationFrame debounce
- Auto-3D tile loading on boot REMOVED (manual toggle only now)
- Auto-collapse left panel on smaller displays

### Phase 2: Google Earth-Style UX
- Search bar with Nominatim geocoding + local entity search (debounced 350ms, flyTo animation)
- COCOM dropdown (replaced 5 nav buttons)
- Cursor coordinate display (DMS/DD/DM/MGRS formats, throttled 80ms)
- Coordinate grid (Cesium GridImageryProvider, subtle blue)
- Place labels + road overlay (ESRI Reference + Transportation tiles)
- Full Settings panel (coord format, tile quality, antialiasing, terrain, atmosphere, sun, units)
- Menu bar (File/View/Tools/Add/Help with full submenus, hover-switching)
- Scale legend (updates on camera move, respects unit settings)
- Overview map (OSM mini-map, bottom-right)
- Clean View mode (hides all UI chrome)

### Phase 3: Data Layers
- Cell tower carrier detection (AT&T/T-Mobile/Verizon/MVNO resolution, color coded)
- US Economic Intelligence (Treasury Fiscal Data API, live debt ticker at ~$52K/sec)
- Floods (GDACS API, 30-day lookback, alert-level colors)
- Tsunamis (GDACS API, 90-day lookback, wave icons)
- Volcanoes (GDACS API, 180-day lookback, VEI data)
- Nuclear Strike Ranges (9 states, ICBM range circles from capitals, silo/base markers)
- Hillshade Terrain (ESRI, 0.45 alpha)
- Population Density (NASA SEDAC GPWv4 WMS, 0.6 alpha)

### Phase 4: Bug Fixes
- Battle tracker placement fix (globe.pick() priority over pickPosition for 3D tile accuracy)

### Phase 5: Competitive Analysis
- GuerillaMap teardown completed — identified 4 gaps (Nuclear, Floods, Tsunamis, Volcanoes) — ALL NOW CLOSED

---

## WHAT'S STILL OUTSTANDING (priority order)

### IMMEDIATE — Deploy What Exists
1. **Deploy current index.html to Netlify** — Users can see 25 new features RIGHT NOW. This is the highest-impact action. Just drag the file to Netlify.

### HIGH — Feature Gaps
2. Alliance maps (NATO, CSTO, BRICS, Five Eyes member highlighting)
3. Power plants by type
4. Oil/Gas infrastructure
5. Entity clustering for performance at scale

### MEDIUM — Polish
6. Lazy-build popup HTML (performance at scale)
7. Phase 2 API fixes (proxy-newsapi.js, Netlify env vars)
8. Street View integration (complex — requires Google API key)

### MONETIZATION — After Features Stable
9. ~~verifyMilitary() promo code flow~~ — RESOLVED (promo code modal + localStorage)
10. ~~Stripe product creation~~ — RESOLVED (Payment Link constants wired, subscribe() uses links)
11. Supabase user auth + tier enforcement (Week 2 — webhook auto-tier)
12. ~~Paywall gate on premium layers~~ — RESOLVED (tier gating + locked layer CSS + showMo())

**Success Criteria:** Site loads fast (no blocking scripts, no auto-3D tiles), all 25+ features functional, layers toggle on demand, free tier accessible, paid tier gated behind Stripe.

---

## RULES OF ENGAGEMENT

1. **SURGICAL FIXES ONLY.** Do not refactor working code. Do not reorganize. Fix what is broken. Leave everything else alone.

2. **VERIFY BEFORE REPORTING SUCCESS.** Use Chrome to load kgsbdoc.netlify.app (or local file) and visually confirm changes work. Check browser console for errors.

3. **UPDATE THIS FILE AFTER EVERY SESSION.** The next session depends on knowing what changed.

4. **DO NOT ADD FEATURES DURING BUG FIXES.** If the mission is "fix verifyMilitary()", fix verifyMilitary(). Don't also add a new layer.

5. **ASK BEFORE DESTRUCTIVE ACTIONS.** Do not delete functions, remove layers, or overwrite sections without operator approval.

6. **TIME ESTIMATES ARE MANDATORY.** State how long each task should take before starting.

7. **IF YOU DON'T KNOW, SAY SO.** Do not guess at API endpoints or fabricate data sources.

8. **THE OPERATOR'S TIME IS THE SCARCEST RESOURCE.** Execute before explaining.

9. **EDIT THE FILE DIRECTLY, VERIFY IN CHROME.** index.html is a single file. Make all edits directly in the file. Use Chrome ONLY to verify the site loads and features work. Chrome is eyes, not hands. The file is where hands work.

10. **BRACKET COUNTING IS MANDATORY AFTER LARGE EDITS.** After adding or modifying more than 20 lines, run a bracket count to verify balance: {} must match, () must match, [] must match. An unbalanced bracket kills the entire 8,294-line file.

11. **BRACKET COUNTING VIA NODE -E.** `node -e` is available on this machine for bracket-balance checks; use it after large edits. Python also available if needed. Tree/tr fallback still works if node is unavailable in a pinch.

---

## KNOWN ISSUES AND GOTCHAS

- **verifyMilitary()** — FIXED. Now shows promo code modal. Valid codes: MILITARY50, VETERAN50, GWOT50. Stored in localStorage as `bdoc_promo_applied`.
- **3D tile pickPosition vs globe.pick()** — FIXED. globe.pick() has priority now. Do not revert this.
- **GuerillaMap domain is blocked** — Chrome extension cannot access guerillamap.com. Use sitemap XML and URL params only for competitive analysis.
- **WebFetch on GuerillaMap returns only CSS** — Site is behind WordPress membership wall. Cannot scrape content.
- **Google Photorealistic 3D Tiles** — Do NOT auto-load on boot. Manual toggle only. This was a silent performance killer.
- **Font loading** — Uses preload with onload swap. Do NOT revert to blocking stylesheet link.

---

## FILE STRUCTURE

```
BDOC Deploy/
├── index.html          (10,226 lines — THE ENTIRE APP, this is what deploys to Netlify)
├── CLAUDE.md           (this file)
└── [military emblems]  (Navy, USMC, USSF, Army, USAF .html files — 47-492KB each)
```

Everything is in index.html. There are no separate CSS or JS files. All styles are inline. All scripts are embedded. One file = one deploy.

---

## EXTERNAL TOOL AUTHORIZATION

### Venice AI (GLM-5)
Only authorized external AI. Used for adversarial red teaming and OPSEC review of BDOC's data sources and feature set. Operator initiates Venice sessions manually.

### All Other External AI
Not authorized for BDOC development.

---

## FIBONACCI OPERATING ALGORITHM

Applies to BDOC in these ways:
- Subscription pricing tiers ($9.99 / $29.99 — Fibonacci-adjacent scaling)
- Layer polling intervals for live data feeds
- Feature release cadence

---

## SESSION LOG
**Rules:** Rolls over at 10 entries. 2 lines max per entry.

**Current Phase:** PRODUCTION HARDENING complete → Phase 2 DECOMPOSITION queued (authorized 2026-04-20).
**Next Action:** Operator runs Chrome DevTools console on deployed site to confirm Phase 1 green. Then Code begins module extraction in the locked order below.

---

## PHASE 2 — MODULE DECOMPOSITION (authorized, queued)

**Goal:** Split index.html (11,711 lines) into a ~200-line shell + `js/*.js` modules + `css/bdoc.css`. Same Netlify deploy folder — NOT a server offload.

**Target structure:**
- `index.html` (shell, ~200 lines, all modules loaded via `<script src="js/xxx.js">`)
- `js/cesium-init.js` — globe init, camera, controls
- `js/layers-military.js` — bases, airfields, nuclear sites
- `js/layers-conflict.js` — ACLED events, force tracker, territory
- `js/layers-infra.js` — chokepoints, cables, cell towers
- `js/layers-air.js` — ADS-B aircraft, satellites
- `js/kitsune-ai.js` — AI panel, commands, responses
- `js/auth.js` — Supabase, tier, Stripe
- `js/filters.js` — NVG/FLIR/CRT visual filters
- `js/telemetry.js` — threat level, ticker, live feeds
- `css/bdoc.css` — all inline styles extracted

**Extraction order (low-risk first, cesium-init LAST):**
1. `filters.js` → 2. `bdoc.css` → 3. `telemetry.js` → 4. `layers-military.js` → 5. `layers-infra.js` → 6. `layers-air.js` → 7. `layers-conflict.js` → 8. `kitsune-ai.js` → 9. `auth.js` → 10. `cesium-init.js`

**Extraction rules (non-negotiable):**
- ONE module per Code session turn. Never batch.
- Read index.html in chunks (not whole-file).
- Replace extracted block with `<script src="js/xxx.js">` at the same location — load order matters.
- After each extraction: operator deploys, hard-reloads, checks browser console. Proceed ONLY on green console.
- Any global referenced cross-module must be hoisted to `window.BDOC.*` namespace or kept in shell. No silent cross-module refs.
- Console-error check after every single extraction is mandatory, not optional.

**Risks:**
- Drag-drop deploy now ships a folder. Dragging just `index.html` = every script-src 404s = dark site. Consider Netlify CLI or git deploys post-split.
- Silent global-variable misses during extraction — catch with console after each.

### 2026-05-20 (LATE) — Phase 22: Full Bug Sweep + Battle Tracker Fix
- **CRITICAL** `if(V)` at module scope (index.html:8349) — V undefined when inline script runs, so bHandler/ALL click handlers/right-click menu/battle tracker never created. Fixed: renamed to `function _initBattleClickHandlers(){}`, called from end of cesium-init.js after V is built (same pattern as bootFeeds).
- **HIGH** milsymbol.min.js had `defer` — MIL-STD-2525C icons silently fell back to text. Removed `defer`, now synchronous before layers-military fires.
- **HIGH** Duplicate `data-layer="wireshark"` div (static HTML line 564 + dynamic injection line ~10005) causing toggle desync and paywall bypass on second element. Removed duplicate from dynamic section.
- **HIGH** `'ioc'` missing from operator `canAccess` array in auth.js. Added.
- Brackets: braces 0, parens 0, brackets 0.

### 2026-05-20 (NIGHT) — Console Error Triage (post-deploy)
- proxy-gdelt 502 storm: `updateGTA()` was polling GDELT every 60s; GDELT refreshes every 15min. Fixed: interval 60s→300s, maxpoints 150→50, AbortSignal 8s→5s. Function default maxpoints 150→50 + timeout 8s→5s. Layer-toggle `loadGDELTNews` (already 15min) unchanged.
- proxy-supabase heartbeats 500: `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` not set in Netlify env → 500 spam. Fixed: function now returns 204 No Content instead of 500. **Action: add Supabase env vars in Netlify site settings when ready.**
- refresh.js WebSocket `localhost:8081` — Netlify CLI dev artifact cached in browser. Not a BDOC file. Clears on hard-reload.
- Cesium `about:blank` sandboxed iframe — Cesium internal, not fixable without patching library. Benign.

### 2026-05-20 (EVE) — PHANTOM Zero-Tolerance Sweep
- 7 additional PHANTOM refs found and killed: kitsune-ai.js help brief header, auth.js dev key (now `KGSBDOC-ADMIN-7X`), package.json name+desc, privacy.html + terms.html titles+body, supabase schema comment, BDOC_CLAUDE.md header.
- **Update your dev bookmark**: `?dev=KGSBDOC-ADMIN-7X` (old PHANTOM key is now dead).

### 2026-05-20 (PM) — Kojima Naming + mkFace Perf Fix
- Feature names set: FOXEYE (R&B tracker), FOXPRINT (breadcrumbs), FOXHOLE (geofencing), FOXFIRE (emergency beacon). All fox-themed, owned by KGS, zero IP issues.
- "BDOC PHANTOM" fully stripped from all UI, API User-Agent strings, CoT tags, comments → replaced with "KGS BDOC".
- `mkFace` skybox perf fix in cesium-init.js: precompute `waveArr[SZ]` outside inner loop — cuts 4M+ redundant `Math.sin` calls to 2048. Estimated savings ~800ms LCP on cold load.
- All brackets balanced: braces 0, parens 0, brackets 0.

### 2026-05-20 — Phase 21 ATAK Doctrine Port + Module Wire-Up
- `js/bdoc-atak.js` created: CoT 2.0 XML (MIL-STD-2525D type codes), full CASEVAC 9-line+ZMIST modal, Bloodhound live R&B tracking, Track History breadcrumbs, Geofencing w/ entry/exit alerts. Exports `window.BDOC_ATAK`.
- `js/bdoc-atak.js` wired into index.html via `<script src="js/bdoc-atak.js">` at line 1277 (after kitsune-ai.js).
- `placeCASEVAC()` in index.html replaced with thin stub → delegates to `BDOC_ATAK.showCASEVACModal(lat,lon)`. Old prompt-based logic removed.
- Context menu: added 🐕 Bloodhound FROM/TO Here items + `ctxAction` cases `bloodhound_from` / `bloodhound_to` → call `BDOC_ATAK.startBloodhound()` / `setBloodhoundTo()` with MGRS label.
- Phase 20b console fixes applied (prior session): Census geocoder CORS removed, GDELT 250→150 maxpoints, Meshtastic retry cap 5, Zoom/Fastly/Heroku removed from Downdetector, poweroutage.us hardcoded API key removed.
- Brackets: braces 0, parens 0, brackets 0 (verified 2026-05-20).

### 2026-04-20 (PM) — High-Capacity Hardening Pass
- Proxy-perenual / proxy-plantid / proxy-owm Functions created. Last 3 client-side keys stripped. Client now calls `/api/proxy-xxx` only.
- Cache LRU eviction added (maxEntries 200, touch-on-hit, evictions counter) — stops memory growth over long sessions.
- meshEnts array → Set: O(1) delete replaces O(n²) indexOf+splice.
- BDOC_CLAUDE.md refreshed (stale line count, stale node/python rule, missing session log entries).

### 2026-04-20 (AM) — Ruthless Audit Execution
- Created proxy-tomorrow, proxy-inaturalist, proxy-ip2location; stripped Tomorrow.io + iNaturalist + IP2Location + NASA FIRMS + NewsAPI hardcoded keys from client.
- DOMPurify CDN added + `sanHTML()` / `safeUrl()` helpers; patched WAQI dominant-pollutant XSS and NewsAPI href XSS.
- Auth resilience: 5s config-fetch timeout, `onAuthStateChange` wired, `loadLocalTier()` deprecated, Stripe-return 4s-delayed profile re-fetch, `openPortal()` errors surface to user, global unhandled-rejection + error sinks.
- Mobile: 44×44 touch targets, `font-size:16px` inputs, `95vw` auth modal.
- Perf: aircraft loader wrapped in `suspendEvents()`/`resumeEvents()`; timers skip when `document.hidden` or layer off.
- Legal: `privacy.html` + `terms.html` created and linked from auth modal.
- Boot progress counter fixed.

### 2026-04-09 — Agent-Driven 13-Bug Surgical Purge
- Sandbox iframe `window.parent.X()` fixes, `readyPromise` guards for Cesium 1.107, async toggle3DTerrain/toggleHillshade, antimeridian wrap-around in great-circle plotting, `_alertHash` dedup, reduced chokepoint threat score 15→5.

### 2026-04-07 — Production Ship Session (Steps 1-8)
- verifyMilitary() promo modal + localStorage, lazy-load (3 feeds on boot, rest on toggle), tier gating (recon default + lock icons + canAccess guard), Stripe Payment Links wired, Plausible analytics added, stripe_success return modal added.

### 2026-04-06 — CLAUDE.md Created for BDOC
- Extracted from master system prompt, tailored with BDOC-specific context from Phase 1-6 session summaries
- STATUS: Ready for first Code+Chrome session on BDOC
