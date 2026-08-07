# BDOC 10x Upgrade Plan — "Supersede Palantir Lite"

> **For Hermes:** Planning document only. Execute phase-by-phase after Travon approves. Each phase ships independently on a branch → verify in prod → next.

**Date:** 2026-08-04 · **Prod state at planning time:** sw/bdoc-v127, live Stripe, Supabase auth, ~45 Netlify functions, 12 JS modules, 912KB monolithic index.html
**Goal:** Make BDOC the one-app answer for (1) veterans, (2) emergency-management coordinators, (3) preppers/meshtastic community, (4) everyday "one weather+world app" users — while staying a one-man+AI shop on a near-zero marginal cost basis.

---

## 1. COMPETITIVE ANALYSIS (verified Aug 2026)

### Liveuamap — $8/mo (or $15/yr ad-removal), 750k+ downloads, **2.9/5 rating**
- Strengths: brand, editorial curation of conflict reporting, multi-language, iOS/Android native apps.
- **Verified weaknesses (their own users, 2026 reviews):** unskippable ads every 10–30s; paid subscribers STILL get ads (July 2026 review: "does not honor the paid subscription… pornographic ads"); accusations of bias; conflict-only (no weather, no infra, no cyber); no offline; no user data layers; human editors = hours of lag.
- **BDOC beats them on:** breadth (50+ layers vs 1 domain), no ads ever, machine-speed ingestion (15-min GDELT + live feeds), causal fusion, offline PWA, price parity ($9.99 vs $8 but 50x scope).
- **They beat BDOC on:** editorial verification quality, brand recognition, native app store presence. → Counter: UNVERIFIED tagging discipline + PWA install + (later) store wrappers.

### S2 Underground / "The Ghost Net" — free, YouTube-driven
- Strengths: massive trust with EXACTLY Travon's target audience (veterans/preppers); ATAK data packages; excellent tradecraft education.
- Weaknesses: not a product — a hobby distribution; requires ATAK skill ceiling; no SaaS, no support, updates sporadic, desktop/Android only.
- **BDOC play:** don't fight — *court*. BDOC is "S2's tradecraft, zero setup." Their audience is our beachhead market. Offer creator/affiliate codes (Stripe promo codes already wired). Same for Grand Thumb outreach.

### ATAK-CIV / CivTAK — free, gov-grade
- Strengths: actual military BFT, mesh/radio plugins, DoD pedigree.
- Weaknesses: brutal learning curve, Android-first, no built-in OSINT feeds (bring your own), zero onboarding.
- **BDOC play:** "ATAK capability, Google Maps ease." Interop, don't compete: **CoT/KML export** (partially exists — downloadCoT) so BDOC feeds ATAK users; import ATAK data packages later.

### Watch Duty — free/donation, wildfire only
- Proof that a lean nonprofit beats government apps on speed and UX in ONE vertical. BDOC generalizes that model across all-hazards. Their gap: single-hazard, US-only.

### Palantir / S2 (ArcGIS) / commercial GEOINT — $500+/mo to enterprise-only
- Not reachable by consumers/small EM offices. BDOC's price point IS the moat downmarket. Their moat (analyst tooling, entity resolution, timeline analysis) defines our Phase-4 roadmap targets in miniature.

### Positioning sentence (use in marketing):
**"The Weather Channel + Liveuamap + ATAK-lite + Watch Duty in one $9.99 app that works when the grid doesn't."**

---

## 2. WHAT 10x MEANS — RANKED BY (revenue proximity > dependency > time), per doctrine

| # | Theme | Why it's the multiplier |
|---|-------|------------------------|
| P0 | Launch-blockers & retention leaks | Money path must survive first 100 users |
| P1 | Mobile/touch excellence | Every screenshot bug Travon found = churn at scale; iPad/phone IS the consumer platform |
| P2 | Alerting = the daily hook | An app that pings you "tornado warning + substation outage near HOME" gets opened daily; retention = LTV |
| P3 | Offline / grid-down + mesh | The unique moat NO competitor has; the prepper/veteran story; PR-able |
| P4 | Analyst tools (timeline, drawing, AOI, export) | Converts EM coordinators at $29.99; the "Palantir-lite" claims |
| P5 | Desktop app + scenario mode | Already spec'd (grid-down custom data plotting); Electron skeleton exists |

---

## 3. PHASE PLAN

### PHASE 0 — Revenue hardening (branch: `p0-launch-hardening`, ~1 session)
0.1 **Enterprise comp accounts for friends/family** — Supabase migration: `profiles.comp_until timestamptz` + `comp_reason text`; `admin-user` function gains `action:'grant_comp'` (tier→enterprise, no Stripe). Redeem codes: table `invite_codes(code, tier, max_uses, used_count, expires_at)` + function `redeem-invite` + UI field in auth modal ("Have an invite code?"). Travon generates codes from an admin page — no Stripe involvement, clean separation from paid tiers.
0.2 **Resend SMTP** (blocked on Travon's Resend signup — walk-through queued). Until then: signup UX must say "email may take a few minutes; check spam."
0.3 **Stripe webhook → tier flip verification harness**: scripted end-to-end test using Stripe CLI test-clock or the $5 MILITARY50 live test; document in `docs/LAUNCH_RUNBOOK.md`.
0.4 **Churn guard**: `stripe-webhook` must handle `customer.subscription.deleted` → downgrade tier (verify exists; add if missing).
0.5 **Analytics**: Plausible events already fire on subscribe-click; add funnel events (signup_started, email_confirmed, checkout_opened, checkout_completed) so we can see WHERE users fall off. Free tier: self-hosted or plausible.io trial; alternative GoatCounter (free).

### PHASE 1 — Touch & mobile excellence (branch: `p1-touch`, ~1-2 sessions)
1.1 Global **touch-drag parity** for every draggable (GTA widget, lat/lon bar, any panel): shared `makeDraggable(el)` util handling pointerdown/pointermove/pointercancel with `touch-action:none`; kill remaining mouse-only handlers. (P44 fixed two — audit ALL.)
1.2 **Responsive top banner**: at <900px collapse into hamburger "COMMAND" sheet (PDF, login, search, tools as vertical list). No more pinch-zooming to reach Login.
1.3 **Safe-area & viewport**: `viewport-fit=cover` + `env(safe-area-inset-*)` padding for iPhone notch/home bar; test PWA standalone mode.
1.4 **Layer panel bottom-sheet mode** on phones (drag up/down), left rail stays on tablet/desktop.
1.5 **Device test matrix** in runbook: iPad Safari, iPad Chrome, Android Chrome, iPhone Safari, desktop. Browserbase emulation for regression + Travon's physical devices for release sign-off.

### PHASE 2 — Personal alerting: "BDOC knows before you do" (branch: `p2-alerts`, ~2 sessions)
2.1 **AOI (Area of Interest) model**: `aois` table (user_id, name, geojson, alert_prefs jsonb). UI: "Watch this area" — draw circle/polygon or drop pin + radius. Free tier: 1 AOI; Operator: 5; Analyst: 25; Enterprise: unlimited.
2.2 **Server-side alert engine**: scheduled Netlify function (or droplet cron — droplet is BDOC-scope ✅) every 5 min: intersect AOIs × (NWS alerts, USGS quakes, FIRMS fires, power outages, GDELT kinetic events, cyber tripwires already in Sentinel). Dedupe per user+event.
2.3 **Web Push** (free, native to PWA): `push_subscriptions` table + VAPID keys + service-worker push handler. This is THE retention feature — tornado/outage/quake alerts on lock screen without app-store apps.
2.4 **Email digests** via Resend (daily AOI SITREP, Analyst+).
2.5 Tier-gate: real-time push = paid; daily digest = free teaser → upgrade prompt.

### PHASE 3 — Grid-down moat: offline + mesh (branch: `p3-griddown`, ~2-3 sessions)
3.1 **Offline base maps**: pre-cache MBTiles-style tile packs per region (user picks state/region, ~50-200MB in IndexedDB/Cache API) + all static layers (plants, substations, airfields) already local. "OFFLINE READY ✓" indicator.
3.2 **Scenario Mode** (already spec'd): import CSV/GeoJSON/pasted SITREP text → plotted with timeline scrubber; manual event entry; runs 100% offline. This is also the EM-coordinator training/tabletop tool — dual-purpose.
3.3 **Meshtastic bridge v1 (text)**: Web Serial/Web Bluetooth to a Meshtastic node; broadcast/receive compact event packets (type, lat, lon, severity, ts — CBOR ~30-50 bytes) on a BDOC channel; plot received events. Blue-force: opt-in position beacons from mesh nodes → live team markers (BFT-lite).
3.4 **Mesh imagery experiment** (Travon's Kindle idea — it's sound): weather-radar frame → 64×64 4-bit grayscale RLE (~1-2KB) → chunked over LoRa (~200 byte frames w/ sequence numbers) → reassemble + render client-side. PoC target: transmit a regional radar snapshot in <2 min on default LongFast. Color upgrade later via 2-bit palette (matches plasma-TV RGB intuition).
3.5 **Satellite direct-receive docs** (self-reliance thread): NOAA APT (137 MHz) + GOES HRIT via RTL-SDR ($30 dongle) — legal, license-free receive. Ship a guide + "import SDR image into Scenario Mode" pipeline. Real satellite weather with zero API dependency. (Full auto-ingest = Phase 5.)

### PHASE 4 — Analyst tier justification (branch: `p4-analyst`, ~2 sessions)
4.1 **Timeline scrubber** for all timestamped layers (quakes, GDELT, fires): 24h/7d playback. The single most "Palantir-ish" visual.
4.2 **Drawing/markup tools**: point/line/polygon/text annotations, saved per user (Supabase), export/import GeoJSON. (BattlePlan export exists — make it round-trip.)
4.3 **Entity dossier click-through**: click any event → side panel with source links, related events within 50km/24h (client-side correlation), UNVERIFIED tags preserved.
4.4 **Report generator**: current view + active layers + annotations + SITREP text → branded PDF (jsPDF, exists partially via screenshot capture) — EM coordinators live on PDFs for briefings.
4.5 **CoT/KML export hardening** for the ATAK crowd + import of ATAK data packages (zip w/ CoT XML).

### PHASE 5 — Desktop app + growth (branch: `p5-desktop`, ~2 sessions)
5.1 Package existing `electron/` into installers (electron-builder: Win NSIS + macOS dmg + AppImage); "Download BDOC Desktop" page; auto-update via GitHub releases.
5.2 Desktop-only powers: local file watch folder (drop CSVs → auto-plot), bigger tile caches, SDR ingest hook.
5.3 **Growth mechanics**: referral codes (extend invite_codes with referrer credit), veteran-creator affiliate codes (S2/Grand Thumb outreach kit: 1-pager + demo video script + their own promo code), Product Hunt / r/preppers / r/CommercialAV launch checklist.

---

## 4. WHAT WE DELIBERATELY DO **NOT** DO (YAGNI + doctrine)
- ❌ Native iOS/Android rewrites — PWA + Electron until revenue justifies store fees/review pain. (Store wrappers via PWABuilder = cheap later.)
- ❌ Editorial/human curation — we can't beat Liveuamap's editors; we win on machine speed + breadth + honesty tags.
- ❌ Custom-trained from-scratch LLM for event extraction — current regex/gazetteer pipeline is free and works; revisit only if revenue funds it.
- ❌ Transmitting on satellites/licensed bands — receive-only (legal), forever, unless licensed later.
- ❌ User-generated public content feeds — moderation liability; private/team layers only.
- ❌ Crypto payments — hard stop per doctrine.

## 5. RISKS
- **Free-feed dependency** (GDELT throttling, FIRMS keys, statuspage ToS): mitigation = multi-source fallbacks (already pattern), cache-last-good, degrade gracefully. Keep a `docs/FEEDS.md` inventory w/ fallback for each.
- **index.html monolith (912KB)** is nearing maintainability cliff: adopt "new code goes in js/modules/" rule + extract on touch; no big-bang refactor.
- **Netlify function invocation limits** at scale: alert engine may need droplet cron (allowed: BDOC scope) or paid tier when MRR supports it.
- **Apple PWA push** requires iOS 16.4+ and user "Add to Home Screen" — onboarding must teach it (1-screen tutorial).
- **Solo-founder bus factor**: LAUNCH_RUNBOOK.md + FEEDS.md + this plan = continuity docs.

## 6. VALIDATION GATES (each phase)
1. Signed-out AND signed-in click-through of money path on: desktop Chrome, iPad Safari, Android Chrome (Browserbase + physical).
2. `node --check` all touched JS + zero new console errors on prod after deploy.
3. "Would this have caught/served the last real event?" test per doctrine (e.g., P2 alert engine must fire on a replayed water-utility cyberattack + a real NWS tornado warning).
4. SW version bump + prod verification (grep live service-worker.js).
5. Every deploy: branch → verify → merge main (rollback doctrine).

## 7. SEQUENCE & ESTIMATE
P0 (revenue) → P1 (touch) → P2 (alerts) ship within ~1 week of sessions.
P3 (grid-down) is the marketing moment — coordinate with outreach to S2/Grand Thumb audiences.
P4 (analyst) before pitching EM coordinators/county offices.
P5 (desktop+growth) rolling.

**North-star metrics:** trial→paid conversion ≥5%, week-4 retention ≥40% (alerts drive this), MRR $1k = fund the empire loop.
