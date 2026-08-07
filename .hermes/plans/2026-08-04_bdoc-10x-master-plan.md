# BDOC 10X MASTER PLAN — Post-Launch Upgrade Doctrine
**Date:** 2026-08-04 · **Author:** Hermes (droplet-HERMES) · **Status:** PLANNING ONLY — no execution authorized yet
**Prod:** kgsbdoc.netlify.app (sw-v123+) · **Repo:** ~/Kitsune-BDOC- (branch: hermes-overnight-2026-06-09 → main)

---

## 0. Where BDOC stands today (honest baseline)

**Live and verified:** 50+ OSINT layers, War Room (6 theaters, GDELT+FIRMS), SITREP engine (LLM-free Q&A),
Causal Fusion Engine (outage → probable-cause), Sentinel (5-min global tripwires → Travon's phone), PWA
installable on phone/desktop, Stripe live-mode checkout w/ military promos, Supabase auth+tiers, /terms /privacy.
**First real revenue event:** Ashley's subscription (pending verification). **Known weak spots:** email delivery
(Supabase built-in mailer), tablet/touch UX (partially fixed P110-P112), no native app-store presence, no
offline/mesh story shipped yet (Scenario Mode designed, not built).

---

## 1. Competitive Analysis (August 2026)

### Tier 1 — the giants (we don't fight them head-on; we flank)
| Competitor | Strength | Weakness we exploit |
|---|---|---|
| **Palantir Gotham/FedStart** | Deep fusion, gov contracts, $B budgets | Inaccessible to individuals; $500K+ entry; no consumer tier at all. BDOC = "Palantir for the rest of us" at $9.99 |
| **Esri ArcGIS / S2's Nexus hub** | Authoritative data infra | It's a toolbox, not a product. Requires GIS skills. BDOC is turnkey |
| **Liveuamap** | Brand recognition, conflict coverage | $500+/mo API, single-domain (conflict only), no weather/infra/cyber fusion, no offline |

### Tier 2 — the direct threat class (crowded, moving fast)
| Competitor | What they have | What they DON'T have |
|---|---|---|
| **ATAK-CIV / iTAK / WinTAK** (free, DoD, 500K+ installs) | Offline maps, mesh via plugins, collaborative markers, the tactical gold standard | **Brutal UX** ("Windows 98 app" — actual Play Store review), no built-in intel feeds (BYO data), scary permissions, no threat scoring, setup requires a TAK server. ATAK is a *radio*; BDOC is a *newsroom + radio* |
| **S2 Underground** (free, YouTube-driven) | Community trust, ArcGIS feeds, tiplines | Volunteer cadence, no product polish, no alerting, no fusion, no mobile app |
| **Dirty Civilian / prepper SA apps** | Niche loyalty | Same: fragmented, single-purpose |
| **defconlevel.com / status dashboards** | Simple threat levels | No map, no layers, no personalization |

### The strategic gap BDOC owns
Nobody in Tier 2 has ALL of: (1) live multi-domain fusion (conflict+cyber+weather+infra+space),
(2) causal attribution ("grid down BECAUSE ransomware"), (3) proactive push alerting, (4) consumer-grade
UX at consumer price, (5) offline/grid-down mode. ATAK has #5 only. Liveuamap has #1 partially.
**BDOC's moat = the fusion brain + the Sentinel + one-app consolidation** (Travon's Amazon/Weather-Channel thesis).

### Target market sequencing (per Travon)
1. **Veterans** — speak the language natively (BDOC, SITREP, GTA). Grand-thumb-class influencer outreach.
2. **Emergency Management coordinators** — causal fusion + county-level alerting is their daily job.
3. **General preppers/civilians** — weather + threat + offline in one $9.99 app.

---

## 2. THE 10X ROADMAP — four phases, revenue-ordered

### PHASE A — "Stop the bleeding, start the earning" (days, do first)
| # | Item | Why | Effort |
|---|---|---|---|
| A1 | **Resend SMTP into Supabase** (runbook already written for Claude-in-Chrome) | Every signup today silently fails email verify = dead customers | 30 min human + verify |
| A2 | **Friends & Family Enterprise comps** — Supabase `profiles.tier='enterprise'` set directly via admin function + a `comp_until` date column; NO Stripe involvement (100%-off Stripe coupons create $0 invoices and clutter) . Build `admin-user?action=comp&email=…` behind ADMIN key | Travon's inner circle (Ashley, Grantham-class testers) sees everything, costs nothing, zero billing complexity | 1-2 h |
| A3 | **Verify Ashley's payment end-to-end** (Stripe dashboard: payment → webhook → profiles.tier flip → cancel flow works) | First real dollar = proof of the whole loop | 30 min |
| A4 | **Touch/iPad polish pass 2** — pinch-zoom top banner, drag handles ≥44px, test matrix: Safari iPad / Chrome iPad / Android tablet | Every early customer is on mobile; first impressions are the funnel | 0.5 day |
| A5 | **Signed-out click-through audit** of every button on the money path (lesson from P107/P108) | No more silent landmines | 2 h |

### PHASE B — "The moat" (weeks 1-3)
| # | Item | Detail |
|---|---|---|
| B1 | **SCENARIO MODE (grid-down offline)** — the killer differentiator vs everyone except ATAK, and friendlier than ATAK | IndexedDB feed cache (last-known-good snapshot of all layers, timestamped + "STALE" watermark); user data import (CSV/GeoJSON/KML drop → plotted); timeline scrubber; drawing tools (markers/zones/routes, saved locally); full function in airplane mode |
| B2 | **BDOC Desktop (Electron)** — skeleton exists (`electron/main.js`) | Package to installer (Windows first — electron-builder, code-sign later), "Download Desktop" button on site, bundles Scenario Mode + local tile cache |
| B3 | **Meshtastic bridge v1** — Travon's radio vision, staged honestly | Stage 1: BDOC → CoT/compact-JSON text SITREPs over mesh (256-byte frames, works today). Stage 2: image-over-mesh via 1-bit/4-gray dithered tiles (Kindle idea — realistic at LoRa bandwidth: a 64×64 4-gray tile ≈ 1KB ≈ 30-60s per tile; set expectations). Stage 3: Blue-force tracking — Meshtastic already broadcasts positions; BDOC plots them as friendly markers. Needs: a $30 LoRa node on Travon's side + serial/BLE Web API in the desktop app |
| B4 | **Alert subscriptions per user** — Sentinel goes multi-tenant | `alert_prefs` table (geofence + category + threshold); Netlify scheduled function evaluates per-user; delivery: web-push (free) → email (Resend) → SMS (Twilio, paid tier only). This converts the Sentinel from "Travon's tool" into **the product's #1 retention feature** |
| B5 | **GTA v2 with audit trail** — score changes link to the events that moved them (Travon's original demand: "GTA changes off real events with receipts") |

### PHASE C — "Be seen" (weeks 3-6)
| # | Item | Detail |
|---|---|---|
| C1 | **App Store presence** — PWA-wrap via PWABuilder → Google Play ($25 one-time) + Microsoft Store (free). iOS App Store later ($99/yr + review risk; Safari-PWA install is the interim) |
| C2 | **Veteran influencer kit** — 90-sec demo video (War Room → causal fusion → offline mode), press one-pager, comp codes for Grand Thumb / S2U-class reviewers |
| C3 | **Public status/proof page** — live feed counts, uptime, "events we caught before the news" ledger (the water-system cyberattack post-mortem becomes marketing) |
| C4 | **SEO/landing rework** — "Palantir-class fusion for $9.99" positioning, comparison table vs ATAK/Liveuamap |

### PHASE D — "The brain gets scary" (weeks 6-12, novel/cutting-edge)
| # | Item | Detail |
|---|---|---|
| D1 | **Predictive escalation index** — per-theater trend model on GDELT tone+volume+CAMEO mix (z-scores over rolling baselines, no LLM needed); "Taiwan Strait activity 2.3σ above 90-day baseline" alerts. This is the "BDOC knows before you do" promise made mathematical — and it's the ECH graph-entropy early-warning idea applied to live data |
| D2 | **ECH instrumentation** (Travon's own paper as product) — graph-entropy H(G) over the infra-outage network as a cascade-risk dial on the dashboard. Marketing: "powered by the Entropic Chain Hypothesis" — nobody else has a theory-backed early-warning metric |
| D3 | **Local AI analyst (no API keys)** — WebLLM/Ollama-class small model (Phi/Llama-3.2-3B) running in-browser/desktop for offline SITREP summarization; answers Travon's "AI on the app without Anthropic" question honestly: retrieval + extraction stays rule-based (already built), the small model only phrases summaries. $0/query, private, works air-gapped |
| D4 | **Hermes+Claude power-team pipeline** (the "novel" ask) — formalize what we already do ad-hoc: Hermes (droplet) = intel officer: watches prod, Sentinel, writes specs/mission orders as GitHub issues; Claude Code (laptop/WSL) = builder: picks up issues, implements on branch, opens PR; Hermes = QA: browser-tests prod preview, merges or bounces. Communication bus = GitHub issues/PRs (async, auditable, free) + the WSL limb for real-time handoff. One droplet stays BDOC-pure; heavy builds burn laptop compute |

---

## 3. What we will NOT do (YAGNI discipline)
- No direct satellite downlink work yet (SDR/decommissioned-sat reception is a hardware R&D rabbit hole; NOAA-APT weather-sat reception via RTL-SDR is the ONE cheap exception worth a $40 experiment later)
- No custom-trained foundation model (D3's small-model integration covers the need at ~0% of the cost)
- No iOS native app until revenue covers the $99/yr + review overhead
- No crypto payments, ever (doctrine)

## 4. Risks & open questions
1. **Netlify function limits** — per-user alert evaluation at scale may need a $19/mo tier or a move of the Sentinel to the droplet (already runs there — natural home)
2. **GDELT reliability** — already routed around 2 upstream failures; keep 3-tier fallbacks mandatory on every new feed
3. **Meshtastic image expectations** — physics caps LoRa at ~1-5 kbps; ship text SITREPs first so the feature is honest
4. **App-store review** — Play may flag "war" imagery; prepare EM/weather-first store listing
5. **Comp accounts** — decide policy: hard cap (e.g. 10) + `comp_until` expiry so it never leaks into lost revenue

## 5. Immediate next actions (when Travon says GO)
1. A1 email (Claude-in-Chrome runbook, already delivered)
2. A2 comp-code function + A3 Ashley verification (needs ADMIN key or dashboard 2-min check)
3. A4/A5 touch audit
4. Then Phase B1 Scenario Mode — the moat.
