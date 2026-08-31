# IMPLEMENTATION PLAN — God's Eye View recon → Kitsune BDOC

**Author:** Hermes (Opus 4.8) · **Date:** 2026-06-09 · **Mode:** planning only, nothing built this session
**Executor:** Sonnet (or any lower-cost model). **Every judgment call is already made below. Make none of your own.**
**Source recon:** `bilawalsidhu/gods-eye-view` (MIT, Cesium 1.138.0, ~109k LOC vanilla JS)

---

## 0. READ THIS BEFORE TOUCHING ANYTHING

### 0.1 The rule that overrides everything else
**Do not delete, remove, replace, or overwrite existing working code.**
Every task below is written as **additive**. Where a task comes near existing work, it is marked
**⚠️ TOUCHES EXISTING** with an explicit instruction. If you hit anything not covered by this plan
that would require removing or rewriting existing behaviour: **STOP, do not decide, ask Travon.**

### 0.2 Ground truth about the repo (verified 2026-06-09, do not re-derive)
| Fact | Value |
|---|---|
| Repo root | `/root/Kitsune-BDOC-/BDOC Deploy` |
| Branch | `hermes-overnight-2026-06-09` (autonomous writes go here, **never main**) |
| Last commits | `c93352a` P122 root.json pointer, `fa4cfc4` P122b og:image bytes |
| Cache-bust knobs | `index.html` → `_version: 'pNNN'` (line ~1563) **and** `service-worker.js` → `SW_VERSION` |
| Current versions | LazyLoader `p122`, SW `bdoc-v132` |
| Aircraft poll | `CFG.refresh.aircraft = 60000` (index.html line 1477) |
| Aircraft regions | 12 regions, `CFG.regions` (index.html line 1480) |
| Aircraft entity maps | `_airEntMap`, `_milEntMap` (hex → Cesium **Entity**) in `js/modules/layers-air.js` |
| Existing trail history | `_acTrailHistory` — hex → `[{lon,lat,alt}]`, capped 20, already exists (line ~389) |
| Render governor | **ALREADY EXISTS** as `window.BDOCRender` in `js/cesium-init.js` (P119) |
| `entities.add` count | index.html **111**, layers-arcgis 7, bdoc-atak 7, nuke-sim 6, layers-warlive 6, layers-air 6 |
| AIS source | `netlify/functions/proxy-maritime.js` → `meri.digitraffic.fi` — **no key, not AISStream** |
| OpenSky proxy | `netlify/functions/proxy-opensky.js` exists and is wired as an aircraft fallback |
| Attribution UI | **does not exist** — zero `creditDisplay` / `addStaticCredit` hits |

### 0.3 Recon items DELIBERATELY EXCLUDED — do not build these
| Excluded | Why (decision already made) |
|---|---|
| Google Photorealistic 3D Tiles | ~$6/1,000 root requests, billing-DoS on a public paid site. BDOC uses ESRI World Imagery. Keep it. |
| 28-tool OpenAI realtime voice agent | Margin-negative against $9.99/$29.99 tiers; their own $5 session cap proves the ceiling. |
| TomTom traffic | Metered, off-thesis. |
| Cockpit / WX / 3D-hangar cluster | ~15k LOC toy feature set. Wins YouTube views, not subscriptions. |
| TeleGeography submarine cable dataset | **CC BY-NC-SA — NonCommercial.** BDOC is paid. BDOC already has its own `proxy-cables`. Do not import theirs. |
| Recipe C (server-side AIS relay) | **Does not apply.** BDOC does not use AISStream. It uses keyless `meri.digitraffic.fi`. There is no key to leak. Skipping is correct, not an oversight. |
| Recipe B (render governor port) | **Already shipped in P119** as refcounted `BDOCRender`. Task 2 only adds the 3 missing pieces; do not port their file. |

### 0.4 The one legal landmine that MUST be fixed
**OpenSky's licence is non-commercial.** BDOC has paid Stripe tiers. `proxy-opensky.js` is wired live
as an aircraft fallback right now. Task 8 handles this. Do **not** delete the file — demote it behind a
flag so it is trivially reversible.

---

## 1. THE TASKS (ordered, atomic)

Execute strictly in order. Each task is independently committable. Run `node --check <file>` after
every JS edit. Do not batch commits — one commit per task, message given per task.

---

### TASK 1 — Create the shared motion/interpolation module
**New file, touches nothing existing. Safest possible start.**

**What:** Create `js/modules/motion-model.js` exporting a render-behind interpolation utility onto
`window.BDOCMotion`. This is the recon's #1 item (Recipe A) and everything in Tasks 3–4 depends on it.

**Approach — implement exactly these five exports:**

1. `BDOCMotion.RENDER_DELAY_SEC_DEFAULT = 60` — **decision made:** BDOC's aircraft poll is 60000 ms
   (`CFG.refresh.aircraft`), and the recon's rule is "delay = one poll interval." Their 30 is because
   *their* poll is 30 s. Use 60 for BDOC aircraft. Do not copy 30.
2. `BDOCMotion.pushFix(map, id, {lon, lat, alt, track, velocity, epochMs})` — append to a ring buffer,
   cap **8** entries (`HISTORY_MAX = 8`), never mutate a stored fix, drop a fix whose `epochMs` is
   not strictly greater than the last one.
3. `BDOCMotion.displayPosition(map, id, {delaySec, nowMs})` → `{lon, lat, alt, courseDeg}` or `null`.
   Logic in this exact priority order:
   - **Bracket:** walk history backward, find `a,b` with `a.epochMs <= renderMs <= b.epochMs`,
     `t = (renderMs - a.epochMs) / (b.epochMs - a.epochMs)`, linear-interpolate lon/lat/alt.
   - **Warm-up** (renderMs predates all history): extrapolate the **OLDEST** fix **BACKWARD** by
     `min(lookbackSec, 60)`. Do NOT hold the oldest fix (freezes the icon) and do NOT extrapolate the
     newest to wall-clock now (causes a backward jump when interpolation takes over).
   - **Coast** (renderMs after all history): extrapolate the newest fix forward, capped at
     `min(max(60, ...), 300)` seconds. Beyond the cap return `null` so the caller can hide the contact.
4. `BDOCMotion.arcOffsetEnu(speedMps, trackDeg, turnRateDps, dtSec, result)` — port the 14-line
   constant-rate-turn arc math verbatim from recon §4.1. Straight-line branch when `|w| < 1e-4`.
   Their inherited attribution must be carried: comment `// Arc math adapted from skylight
   (https://github.com/cpaczek/skylight, MIT) via gods-eye-view (MIT, (c) 2026 Bilawal Sidhu)`.
5. `BDOCMotion.absorb(state, rawLonLat, {velocity, nowMs})` — the 900 ms discontinuity absorber
   (§4.2). `DR_CORRECTION_MS = 900`. Plausibility gate `plausible = speed * dtSec * 4 + 25` metres;
   on exceed, re-anchor the correction to the **previously DISPLAYED** position, then decay the
   correction linearly to zero over 900 ms.

**Also required in this file:**
- `lerpAngleDeg(a, b, t)` — shortest-arc angle interpolation (must handle the 350°→10° wrap).
- `courseBetweenLonLat(a, b)` — initial great-circle bearing.
- A `speedRamp(mps)` returning 0 below 15 m/s, 1 above 60 m/s, smooth between — used to weight
  chord-course vs reported-track. Helicopters (`klass === 'helicopter'`) always weight 0.
- Everything must be pure lon/lat/number math with **no Cesium dependency**, so it is unit-testable
  in plain node.

**DONE looks like:** `node -e "require('./js/modules/motion-model.js')"` after shimming `global.window={}`
runs clean, and a scripted 3-fix buffer returns a midpoint position for a bracketing timestamp.

**Commit:** `feat(p123): motion-model.js — render-behind interpolation core (GEV Recipe A)`

---

### TASK 2 — Complete the existing render governor (3 additions only)
**⚠️ TOUCHES EXISTING — `js/cesium-init.js` lines ~33-52.**

**What:** `window.BDOCRender` already exists from P119 with the correct Set-of-owners design. The recon
names three things it is missing. Add **only** these three. **Do not rewrite the governor. Do not
port their file. Do not change the existing `hold`/`release`/`kick`/`_apply` behaviour.**

**Approach:**
1. Change `s.maximumRenderTimeChange = 0.5` → `Infinity`.
   **Justification to put in the code comment:** at 0.5 Cesium re-renders on simulation-time deltas
   behind the governor's back, which defeats on-demand mode. **Consequence you must handle:** the
   existing comment says 0.5 was kept "for sun/lighting drift." So in the same edit, add a 60-second
   `setInterval` that calls `BDOCRender.kick()` **only when `!document.hidden`** — this preserves
   day/night terminator drift at 1 frame/min instead of continuously.
2. Add the `document.hidden` kill: on `visibilitychange`, `V.useDefaultRenderLoop = !document.hidden`.
3. Add `BDOCRender.deferred(reason)` — an alias of `kick()` with a distinct name, implementing the
   recon's hard rule: *"skipping is a deferral, never a cancellation."* Any future throttled painter
   must call this when it declines a frame.

**DONE looks like:** in a live browser, `V.scene.maximumRenderTimeChange === Infinity`,
`BDOCRender.deferred` is a function, and switching browser tabs sets
`V.useDefaultRenderLoop === false`.

**Commit:** `perf(p123): render governor — Infinity render-time-change, hidden-tab kill, deferral API`

---

### TASK 3 — Wire interpolation into the aircraft layer
**⚠️ TOUCHES EXISTING — `js/modules/layers-air.js`. This is the highest-value task in the plan.**

**What:** Make aircraft glide between fixes instead of snapping once per 60 s poll.

**Explicit non-goals — do NOT do these:**
- Do **not** convert `_airEntMap`/`_milEntMap` from Entity to Billboard/PointPrimitive. That is Task 9
  and it is gated on Travon's approval.
- Do **not** remove or repurpose `_acTrailHistory`. It feeds the trail polylines. Add a **separate**
  buffer.

**Approach:**
1. Add `const _acFixHistory = new Map();` beside `_acTrailHistory`. This is the interpolation buffer
   (`BDOCMotion.pushFix` format, cap 8). It is separate from the 20-entry trail buffer on purpose:
   the trail wants a long visual tail, the interpolator wants a short accurate one.
2. In the aircraft ingest loop (immediately after the existing `_acTrailHistory` push, ~line 491),
   call `BDOCMotion.pushFix(_acFixHistory, a.hex, {...})` with `epochMs: Date.now()`, plus
   `track: a.track`, `velocity: a.spd` — check the actual field names in the ingest object and use
   whatever is really there; if ground speed is in knots convert to m/s (`* 0.514444`).
3. Replace each aircraft entity's **static** `position` with a `Cesium.CallbackProperty`:
   ```js
   new Cesium.CallbackProperty(function(){
     const p = BDOCMotion.displayPosition(_acFixHistory, hex, { delaySec: 60 });
     if (!p) return undefined;              // coast expired -> Cesium hides it
     return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt);
   }, false);
   ```
   **`false` (not isConstant=true) is required** or Cesium caches the value.
4. Same for billboard `rotation` if the icon is rotated — drive it from `p.courseDeg`.
5. **Mandatory pairing:** a CallbackProperty only animates while the scene renders. So on the code
   path that turns the aircraft layer ON, call `BDOCRender.hold('air-interp')`, and on the path that
   turns it OFF, `BDOCRender.release('air-interp')`. Without this the governor leaves the scene in
   on-demand mode and the interpolation will not visibly run. **This is the #1 way this task fails —
   do not skip it.**
6. Guard the whole thing: `if (!window.BDOCMotion) { /* fall back to the existing static position */ }`
   so a load-order failure degrades to today's behaviour instead of a blank layer.

**DONE looks like:** with the AIRCRAFT layer on, watching one aircraft for 3 minutes shows continuous
smooth motion with **zero** visible snap at the 60 s poll boundary, and `BDOCRender.active` contains
`'air-interp'`.

**Commit:** `feat(p123): aircraft render-behind interpolation — no more 60s snap`

---

### TASK 4 — Add `motion-model.js` + `snapshot-client.js` to the loader and bump caches
**⚠️ TOUCHES EXISTING — `index.html`, `service-worker.js`.**

**What:** Register the new module and force clients to pick up the change.

**Approach:**
1. In `index.html`, add `<script src="js/modules/motion-model.js?v=p123"></script>` **before** the
   `layers-air` lazy-load path can run. Safest: put it next to the other eager `js/modules/*` tags,
   or if none are eager, load it in the same `<script>` block that defines `BDOC.LazyLoader`.
   It must be a plain global script (no ESM), matching the rest of the codebase.
2. Bump `_version: 'p122'` → `'p123'` in `index.html` (~line 1563).
3. Bump `SW_VERSION = 'bdoc-v132'` → `'bdoc-v133'` in `service-worker.js`.
4. Add `js/modules/motion-model.js` to the service worker's precache list **only if** such a list
   exists and already names other `js/modules/*` files. If it does not, change nothing else.

**DONE looks like:** `curl -s localhost/index.html | grep motion-model` returns the tag, and in a
browser `typeof window.BDOCMotion === 'object'` on a cold load.

**Commit:** `chore(p123): register motion-model, bump LazyLoader p123 / SW v133`

---

### TASK 5 — Honest source states, per layer
**New file + additive edits. This is the liability shield and the trust surface.**

**What:** Every layer surfaces exactly one of `live | delayed | partial | simulated | unavailable`.
The recon calls this "the highest-trust-per-pixel pattern in the whole repo," and for BDOC's SDVOSB
federal positioning it doubles as a liability shield.

**Approach:**
1. Create `js/modules/source-state.js` → `window.BDOCSource`:
   - `set(layerId, state, meta)` where `state` is one of the five strings and `meta` is
     `{ ageMs, source, note }`.
   - `get(layerId)`, `all()`.
   - State derivation rule (**decide once, here**): `live` if `ageMs < 2× ttl`; `delayed` if
     `< 5× ttl`; `unavailable` if the last fetch threw or returned zero rows; `partial` if some
     sub-sources failed but not all; `simulated` only when set explicitly by the layer.
2. Render a chip in each layer row in the INTEL LAYERS panel: a coloured dot + the state word +
   relative age. Green `live`, amber `delayed`, blue `partial`, purple `simulated`, red `unavailable`.
   **⚠️ TOUCHES EXISTING:** the layer rows are `.ly[data-layer]` divs in `index.html` and they already
   carry a `.ly-tg` badge (LIVE / SOON / REAL-TIME). **Do not remove `.ly-tg`.** Append a **new**
   `<span class="ly-src">` after it and populate that.
3. Wire the states from the existing `Health` telemetry where it already tracks a feed, so this is
   mostly a display layer over data BDOC already has.
4. Add the recon's disclaimer verbatim to the About/Help surface:
   > *"Data may be delayed, incomplete, modeled, inferred, or wrong. Do not use it for flight or
   > maritime navigation, emergency response, medical or health decisions, investment decisions, or
   > other safety-critical or operational purposes."*

**DONE looks like:** with the app loaded and 2+ layers on, every enabled layer row shows a state chip,
and killing network then refreshing a layer flips its chip to red `unavailable`.

**Commit:** `feat(p124): honest per-layer source states + safety disclaimer`

---

### TASK 6 — Data attribution lightbox
**New file + additive. Compliance, and it is currently missing entirely (verified: 0 hits).**

**What:** BDOC runs 50+ layers under a dozen licences and currently displays **no attribution**.
ODbL (adsb.lol, Overpass, OSM), CC BY 4.0 (Open-Meteo), and TfL all *require* it.

**Approach:**
1. Create `js/modules/data-credits.js` → `window.BDOCCredits.register(layerId, {name, url, licence, requiredText})`.
2. Registry entries required at minimum: OpenStreetMap contributors (ODbL), adsb.lol (ODbL),
   ESRI World Imagery, NASA FIRMS (public domain), USGS (public domain), NOAA/NWS (public domain),
   GDELT (cite), CelesTrak (cite), Open-Meteo (CC BY 4.0 — **must be a live link adjacent to the data**),
   Cesium ion, and the MIT notice for gods-eye-view + skylight for the ported motion math.
3. Render as a small "Data attribution" link on the globe credit line that opens an expandable
   lightbox listing only **currently-active** layers' credits. Must remain visible in clean-view.
4. Create `THIRD_PARTY_LICENSES.md` at repo root reproducing the MIT text for
   `bilawalsidhu/gods-eye-view` and `cpaczek/skylight`.

**DONE looks like:** clicking "Data attribution" lists a credit line for every currently-enabled layer,
and `THIRD_PARTY_LICENSES.md` contains both MIT notices.

**Commit:** `feat(p124): data attribution lightbox + THIRD_PARTY_LICENSES.md`

---

### TASK 7 — Free keyless feeds BDOC is not yet using
**New Netlify functions only. Additive.**

**What:** Recon §6 Recipe F lists keyless sources BDOC lacks. Build the two with the best
thesis-fit-per-hour and skip the rest.

**Approach — build exactly these two, in this order:**
1. `netlify/functions/proxy-adsbdb.js` → `api.adsbdb.com/v0/callsign/{cs}` and `/v0/aircraft/{hex}`.
   **No key.** Cache **24 h** (`max-age=86400`), serve-stale on failure, `X-BDOC-Cache: HIT|MISS|STALE`
   header. This turns a bare hex code into operator + route + type — a direct upgrade to the aircraft
   click-through card.
2. `netlify/functions/proxy-launches.js` → `ll.thespacedevs.com/2.3.0/launches/upcoming/`.
   **No key**, 15 calls/hour anonymous — so cache **15 minutes** minimum and never poll faster.

**Both must follow the house pattern already used by `proxy-newsgeo.js`:** never throw a 5xx, degrade
to last-good or an empty envelope with a `_status` field of `live|stale|down`.

**Do NOT build:** OpenSky anything (see Task 8), Google News RSS (commercial use restricted — BDOC
already runs GDELT which permits commercial use with citation), TeleGeography (NonCommercial).

**DONE looks like:** `curl "$SITE/.netlify/functions/proxy-adsbdb?callsign=UAL428"` returns 200 with a
JSON body carrying `_status`, and a second immediate call returns `X-BDOC-Cache: HIT`.

**Commit:** `feat(p124): keyless proxies — adsbdb enrichment, Launch Library 2`

---

### TASK 8 — Demote OpenSky (LEGAL — non-commercial licence vs paid tiers)
**⚠️ TOUCHES EXISTING — `js/modules/layers-air.js` line ~304. FLAGGED: read the instruction exactly.**

**What:** OpenSky's data licence is **non-commercial**; operational REST use in a live product can
require a prior written agreement. BDOC has paid Stripe tiers. This is the single sharpest legal trap
in the recon.

**DO NOT DELETE `netlify/functions/proxy-opensky.js`. DO NOT DELETE the call site.**

**Approach — reversible demotion only:**
1. In `index.html` `CFG`, add `flags: { openskyEnabled: false }`.
2. At the `proxy-opensky` call site in `layers-air.js` (~line 304), wrap the call in
   `if (CFG.flags && CFG.flags.openskyEnabled) { ...existing call... }`. The existing adsb.lol path
   (line ~320, ODbL, commercial-OK) becomes the sole live source. Change nothing else about it.
3. Add a comment block at the call site stating the licence reason and that flipping the flag to
   `true` restores it — so the decision is documented and one-line reversible.
4. Write the finding into `IMPLEMENTATION_PLAN.md`'s ledger notes and **tell Travon in the report**:
   if he wants OpenSky back, the path is a written agreement with OpenSky, not a code change.

**DONE looks like:** aircraft still populate from adsb.lol with the flag off, and grepping the network
tab during a full aircraft refresh shows **zero** requests to `proxy-opensky`.

**Commit:** `legal(p124): gate OpenSky behind a disabled flag — non-commercial licence vs paid tiers`

---

### TASK 9 — ⚠️ GATED: Entity → Primitive collection migration
**DO NOT EXECUTE WITHOUT TRAVON'S EXPLICIT GO-AHEAD.**

**What:** The recon's Recipe D — the biggest frame-budget win available — says every mass layer should
use `BillboardCollection` / `PointPrimitiveCollection` and reserve the Entity API for the single
tracked target. BDOC currently has **111 `entities.add` call sites in index.html alone**.

**Why it is gated and not just done:** this is a rewrite of working, shipped, user-visible layers. It
touches click-handling (`V.selectedEntity`), the InfoBox description cards that were fixed in P121/P122,
`V.trackedEntity` follow-camera, and every `.show` toggle. Done wrong it silently breaks the popups
Travon has already had to chase twice. The plan rule is *do not replace existing work without a call.*

**If and only if approved, the sequence is:**
1. Pick **one** layer, highest marker count first — recommend `layers-air.js` civilian aircraft.
2. Add a `BillboardCollection` at init, `viewer.scene.primitives.add(...)`, **never removed**; visibility
   by `.show` only (their source comment: *"Add permanently — toggle with .show to avoid
   destroy-on-remove errors."*).
3. Epsilon-gate every write: position `distanceSquared > 1.0`, rotation `> 0.002`, scale `> 0.005`.
   Assigning a Billboard property dirties the whole VBO.
4. Re-implement click-to-select against `scene.pick` → `billboard.id`, and re-point the InfoBox.
5. Ship one layer, verify popups + tracking + toggles, **then** consider the next.

**DONE looks like:** N/A — gated. Do not start.

---

## 2. RISK REGISTER (things that will bite the executor)

| Risk | Mitigation (already decided) |
|---|---|
| CallbackProperty doesn't animate | Governor is in on-demand mode. Task 3 step 5 — `BDOCRender.hold('air-interp')` is **mandatory**, not optional. |
| `maximumRenderTimeChange = Infinity` freezes the day/night terminator | Task 2 step 1 adds a 60 s `kick()` heartbeat, hidden-tab-gated. |
| Interpolation shows aircraft 60 s in the past | This is the **intended trade**: 60 s of latency for zero extrapolation error. The readout/alert/export must still report **raw sensor values**, never the smoothed display value — the recon calls this the display-truth vs sensor-truth line. Enforce it in Task 3. |
| Load-order race — `layers-air` runs before `BDOCMotion` exists | Task 3 step 6 guard clause falls back to static positions. |
| Popup regressions | Tasks 1–8 never touch `description` HTML. Only Task 9 does, and Task 9 is gated. |
| Cache not busted → "nothing changed" | Every task that edits a shipped file is followed by the Task 4 version bumps. If you edit a `js/modules/*` file in a later task, bump `_version` **again**. |

---

## 3. WHAT THIS PLAN DELIBERATELY DOES NOT CLAIM

- It does not make BDOC's globe match Google Earth's photoreal mesh. That dependency is excluded (§0.3).
- It does not add a voice agent.
- It does not touch the Kitsune Global website.
- Tasks 1–4 are the "make it feel like an instrument" block. Tasks 5–8 are the "make it defensible"
  block. Task 9 is the "make it fast at scale" block and is gated.

---

## 4. EXECUTION LEDGER

- [ ] **T1** — Create `js/modules/motion-model.js` (render-behind interpolation, arc math, 900ms absorber)
- [ ] **T2** — Complete render governor in `js/cesium-init.js` (Infinity + hidden-tab kill + deferred API)
- [ ] **T3** — Wire interpolation into `js/modules/layers-air.js` via CallbackProperty + render hold
- [ ] **T4** — Register motion-model in `index.html`, bump LazyLoader p123 / SW v133
- [ ] **T5** — `js/modules/source-state.js` + per-layer state chips + safety disclaimer
- [ ] **T6** — `js/modules/data-credits.js` + attribution lightbox + `THIRD_PARTY_LICENSES.md`
- [ ] **T7** — `proxy-adsbdb.js` + `proxy-launches.js` (keyless, cached, serve-stale)
- [ ] **T8** — Gate OpenSky behind `CFG.flags.openskyEnabled = false` (legal, reversible)
- [ ] **T9** — ⚠️ GATED: Entity → Primitive migration — **DO NOT START WITHOUT TRAVON'S GO**
