# BDOC PHANTOM — Persistent Project Brief
**For AI agent injection. Do not summarize. Retain all technical details exactly as written.**

---

## WHAT THIS IS

BDOC PHANTOM is a CesiumJS-based 3D OSINT/Tactical Common Operating Picture (COP) platform.
- Live URL: https://kgsbdoc.netlify.app
- Deploy method: Netlify drag-and-drop (no build step, no CI/CD)
- Working directory: `C:\Users\ARNAUTICA\OneDrive\Desktop\BDOC Deploy`
- Primary file: `index.html` (~11,000 lines, all logic in one file currently)
- Dependencies: All CDN-loaded (CesiumJS 1.104, jsPDF, satellite.js)
- Owner/Operator: Travon Brown, Kitsune Global Solutions LLC (SDVOSB)

---

## DUAL-LANE PRODUCT POSITIONING

**Lane 1 — Defense/Government:** Defense-grade TOC for DoD/agency channels (SDVOSB contracting angle)
**Lane 2 — Civilian:** Emergency preparedness subscriber platform with tiered access

---

## CONFIRMED WORKING FEATURES (DO NOT TOUCH WITHOUT TESTING)

- CesiumJS 3D globe rendering
- SVG aircraft billboards with live heading rotation
- 29 precise geo-located conflict markers (not generic circles)
- Day/night cycle
- NVG filter (night vision green overlay)
- FLIR filter (thermal simulation)
- CRT filter (retro scan lines)
- Time acceleration controls
- NASA FIRMS live fire data integration (API key live)
- Cesium Ion token live
- AI chat panel (Kitsune AI — wired to Anthropic API)

---

## OPEN BUGS (TRIAGED, NOT FIXED)

1. **verifyMilitary() runtime crash** — HARD BLOCKER. Crashes on load when military verification is called. Blocks entire monetization gate. FIX THIS FIRST before any other work.
2. **Lat/Lon HUD collision** — overlaps with AI chat bar UI. CSS positioning conflict.
3. **Locked/paywalled layer toggles** — render in ON state visually even when locked. Should show locked/greyed.
4. **Conflict markers clip at distance** — appear as half-circles at certain zoom levels due to depth test failure in CesiumJS.
5. **NVG mode globe shake** — camera mutations during NVG activation cause brief globe shake.
6. **NVG mode too dark** — no dynamic gain control. Night vision is too dim to be useful.
7. **Clock icon blocks SIGN IN button** — UI overlap, z-index issue.
8. **Shepherd.js onboarding tour** — 8-step tour spec written but never implemented. Not blocking launch.

---

## MONETIZATION GATE — 3 SEQUENTIAL BLOCKERS

Must be resolved IN ORDER before launch:

**Blocker 1:** `verifyMilitary()` runtime crash (hard crash, nothing else matters until this is fixed)
**Blocker 2:** Supabase authentication — schema exists, tables exist, but login/signup UI is NOT wired to auth flow
**Blocker 3:** Stripe tier gating — Stripe checkout functions ARE deployed but NOT connected to UI tier gates

Do not attempt Blocker 2 until Blocker 1 is resolved.
Do not attempt Blocker 3 until Blocker 2 is resolved.

---

## INTEGRATIONS — STATUS

| Integration | Status |
|---|---|
| NASA FIRMS live fire data | LIVE — working |
| Cesium Ion | LIVE — token active |
| Supabase auth schema | EXISTS — not wired to UI |
| Stripe checkout functions | DEPLOYED — not wired to tier gates |
| ACLED API (live conflict events) | PROPOSED — never started |
| GDELT 2.0 threat scoring backend | ARCHITECTED — never built |
| OpenSky / adsb.lol global mil feed | PROPOSED — never started |

---

## PHASE 2 MODULARIZATION PLAN (LOCKED — NOT YET EXECUTED)

Goal: Decompose ~11,000-line index.html into 10 JS modules. Reduces file to ~200-line shell.

**Extraction order (lowest to highest blast radius):**
1. `bdoc.css` — pure styling, zero JS risk
2. `js/filters.js` — NVG/FLIR/CRT filter logic
3. `js/telemetry.js` — telemetry/logging
4. `js/layers-military.js` — military base/airfield/nuke site layers
5. `js/layers-conflict.js` — conflict marker data
6. `js/kitsune-ai.js` — AI chat panel
7. `js/auth.js` — Supabase auth wiring
8. `js/cesium-init.js` — CesiumJS globe initialization (highest blast radius, extract last)

**CRITICAL:** Do NOT begin Phase 2 extraction while verifyMilitary() crash is unresolved. Extracting broken code into modules makes it harder to debug.

**Global variable hazard:** index.html uses many globals. Any extraction must audit all global references before moving code.

---

## ROADMAP ITEMS (FUTURE — NOT CURRENT SPRINT)

- Project Salt Box layer: ICE/DHS warehouse and detention facility data (from Michael Wriston, projectsaltbox.substack.com)
  - **OPSEC FLAG:** Weigh political sensitivity against SDVOSB contracting standing before public deploy
- Guerillamap feature parity (competitor reference)
- ACLED API for live conflict events
- OpenSky military aircraft feed

---

## TECHNICAL CONSTRAINTS

- Single-file HTML — no build process, no npm, no webpack
- All changes tested by opening file locally in browser before Netlify drag-and-drop deploy
- OneDrive sync is NON-FUNCTIONAL — do not rely on it for backup
- CesiumJS version pinned at 1.104 — do not upgrade mid-development
- Known recurring bug pattern: `</script>` inside JS comments breaks browser parsing — always check after edits

---

## AI STACK CONTEXT

- Claude (Anthropic): Architect, QA, code review — primary intelligence
- Grok: Fast drafter, audited via Truth Protocol v1.1
- GLM-5: Red team / adversarial review
- GPT-4o: Documentation
- Hermes (Nous Research) + Mem0: Autonomous agent backbone on DigitalOcean (empire-orchestrator, 104.131.188.150)

---

## PRIORITY SEQUENCE (AS OF JUNE 2026)

1. Fix verifyMilitary() crash
2. Wire Supabase auth to login/signup UI
3. Wire Stripe to tier gates
4. Generate BDOC_HISTORY.md (DONE — this file)
5. Begin Phase 2 modularization (CSS first)
6. ACLED API integration

---

*Last updated: June 2026. Source: Claude chat history consolidation. Feed to Hermes/Mem0 at session start.*
