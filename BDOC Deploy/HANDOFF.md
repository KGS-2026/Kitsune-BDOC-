# HANDOFF — Hermes → Claude Code

**Repo:** `Kitsune-BDOC-` · working dir is the `BDOC Deploy/` subfolder
**Live:** https://kgsbdoc.netlify.app/
**Last updated by Hermes:** 2026-10-02 · build **p150** · `SW_VERSION bdoc-v150`
**Last updated by Claude Code:** 2026-10-14 · build **p155** (patches, not pushed) · `SW_VERSION bdoc-v155`

This is the running baton. Hermes updates the top section on every handoff.
Claude Code: read §1 and §2 before touching anything. If you change something
here, update §1 so Hermes knows where you left off.

---

## 0. HARD RULES FOR THIS REPO (learned the painful way)

0. **⚠️ THERE IS A STALE COPY OF THIS PROJECT ON THE LAPTOP.** Travon flagged it
   2026-10-02:
   ```
   C:\Users\ARNAUTICA\OneDrive\Desktop\Golden Fox Agency\SubSitaries\Kitsune Global Solutions LLC\BDOC Deploy
   ```
   **Do not work in that folder until you have checked it.** It predates the
   p74–p147 run (grid-down, glass system, basemap fixes, handoff files), so
   editing it and pushing would **revert weeks of shipped work**.

   The authoritative source is **`origin/main` on GitHub** (`KGS-2026/Kitsune-BDOC-`),
   mirrored on the droplet at `/root/Kitsune-BDOC-/BDOC Deploy`.

   Check it before anything else:
   ```powershell
   cd "C:\Users\ARNAUTICA\OneDrive\Desktop\Golden Fox Agency\SubSitaries\Kitsune Global Solutions LLC\BDOC Deploy"
   git rev-parse --is-inside-work-tree      # is it even a clone?
   git log --oneline -3                     # how far behind?
   git status --porcelain                   # any local work worth keeping?
   ```
   - **Not a git clone** → treat as dead weight. Do not copy files out of it
     into the repo. Clone fresh somewhere outside OneDrive.
   - **Is a clone, clean** → `git fetch origin && git reset --hard origin/main`.
   - **Is a clone with real uncommitted work** → stash or branch it and tell
     Travon before reconciling. Do not `reset --hard` over his changes.

   Also: **OneDrive and git do not mix.** OneDrive syncs `.git/` mid-operation
   and corrupts index/lock files. Prefer a working copy outside the OneDrive
   tree (e.g. `C:\dev\Kitsune-BDOC-`).

1. **Production deploys from `main`.** Netlify auto-deploys `main` on push.
   The local branch is usually `hermes-overnight-2026-06-09`. Pushing that
   branch does **nothing** to the live site. Ship with:
   ```bash
   git push origin HEAD:main
   ```
   A `netlify deploy --prod` from a different branch gets silently overwritten
   by the next `main` auto-deploy. This has burned us twice.

2. **Two agents write to this repo.** Hermes (droplet) and Claude Code
   (laptop), plus a Hermes cron job that commits p140-p145-style work on its
   own. **Always `git fetch origin` and check `git log origin/main` before you
   start**, and re-read any file before writing to it. Hermes has already
   clobbered a cron's edit once and had to restore it.

3. **Bump `SW_VERSION` in `service-worker.js` for ANY shipped asset change.**
   Service-worker caches are keyed off that constant. Forget it and existing
   users never receive your fix. Cache keys **include the `?v=` query string**,
   so a precache entry for `auth.js?v=p70` will never match a live request for
   `?v=p136`.

4. **`NODE_VERSION=18` is pinned in `netlify.toml`.** `@supabase/supabase-js`
   v2 needs a native WebSocket (Node 20+) and **throws at import**, 500-ing the
   whole function. In Netlify functions, talk to PostgREST over plain `fetch`,
   or go through `netlify/functions/_supabase.js`, which requires it lazily
   inside a try/catch.

5. **Verify by execution, not by assumption.** Every "fixed" claim in this file
   has a command next to it that produced the result. Keep that standard — a
   layer that returns HTTP 200 can still be serving garbage (see §1).

6. **Don't rotate keys.** Hermes flags, Travon rotates. Same rule for you.

---

## 1. WHERE HERMES LEFT OFF (2026-10-02)

### Claude Code — p155 (2026-10-14) — Network Builder + Meshtastic World, NOT yet on `main`

Patch `0003` on top of p154. Nothing pushed. SW `bdoc-v155`; LazyLoader `_version`
and every `/js/modules/*` precache key → `p155`; `auth.js?v=p155`,
`bdoc-plugin-renderer.js?v=p155`.

- **Network Builder** — `js/modules/net-builder.js` (lazy). Tools menu → 🖧 Network
  Builder, or CYBER / DIGITAL → Network Builder. 15 device types, 8 cable types,
  place by click or drag-from-palette, drag to move, property card (name, IPs/CIDR,
  MAC, notes, capture machine), PING tool with hop path / UNREACHABLE, SIM traffic,
  DEMO NETWORK, export/import JSON, saved in `localStorage.bdoc_netbuilder_v1`.
  LIVE mode polls `GET 127.0.0.1:9876/api/v1/wireshark/events?since=` (new ring
  buffer in `tools/bdoc-ipc-receiver.js`) and animates each packet along the cabled
  path with protocol + TCP-flag labels. Gate: `netbuilder` (operator tier).
- **Wireshark adapter** — per-packet TCP flags, ICMP type, MACs, DNS/SNI/ARP info,
  LAN packets without geo, `--demo-lan` (loops a realistic LAN conversation on the
  DEMO NETWORK IPs), `-D` lists interfaces, finds tshark under Program Files on
  Windows, auto-picks Wi-Fi/Ethernet when `-i` is omitted off Linux.
- **Meshtastic World** — `js/modules/mesh-world.js` (lazy) + new function
  `netlify/functions/proxy-meshworld.js` (merges meshtastic.liamcottle.net +
  meshmap.net: ~20k positioned nodes, ~4k measured RF links, ~11k gateway-heard
  links; 1.9 MB / 0.84 MB gzip; edge-cached 10 min). Layer row
  `data-layer="meshworld"` under COMMS. Route finder: hop-limited Bellman-Ford over
  measured RF (SNR-weighted) + gateway + predicted-range links, region/preset aware;
  no path → closest gap + relay pins (≤150 km) or "internet/satellite only".
  Gate: `meshworld` (operator tier). RF "neighbours" > 250 km are dropped (MQTT
  downlink makes NeighborInfo list nodes up to 12,000 km away).
- **Adjacent fix** — `js/bdoc-plugin-renderer.js` polled `127.0.0.1:9876` for every
  visitor at page load. Chrome 141+ turns that into a "Local network access" prompt
  for everyone. It now starts only after a local layer is switched on (remembered in
  `localStorage.bdoc_local_ipc`); always on inside Electron.

Verified headless (Chromium 141 / SwiftShader): demo network 13 devices / 12 cables,
click-place, drag-from-palette, cable by two clicks, drag-move, property edit, CIDR
match, ping 4 hops + unreachable, LIVE from the real receiver + `--demo-lan`
(SYN / SYN-ACK / ACK labels), real tshark capture on this box through the receiver
(272 packets incl. SYN/SYN-ACK), 20,060 mesh nodes rendered, SF→San Jose route
(3 relays, 2 measured RF links), node card, search, Atlanta→Macon gap with pins,
Atlanta→London = internet-only, ci-validate green. Not verifiable here: the deployed
function (served its local output in the test), the Chrome LNA prompt on a real
desktop, Windows tshark/Npcap capture.

### Claude Code — p153 + p154 (2026-10-14) — built and tested, NOT yet on `main`

Delivered to Travon as two `git am` patches on top of `c1f5f06` (p152). Nothing
was pushed. Ship with the normal `git push origin HEAD:main` once applied.

- **p153** — Cesium 1.104 → 1.146 (`createOsmBuildingsAsync`), SW `bdoc-v153`.
- **p154** — Travon's 25-item field list (logged 2026-10-13). SW `bdoc-v154`,
  `?v=p154` on `bdoc.css`, new `bdoc-p154.css`, `filters.js`, `cesium-init.js`,
  LazyLoader `_version` and all `/js/modules/*` precache keys. New function:
  `netlify/functions/embed-check.js`. New CI workflow:
  `.github/workflows/desktop-release.yml` (fires ONLY on a `desktop-v*` tag).

| # | Bug | Root cause found | Fix | Verified how |
|---|-----|------------------|-----|--------------|
| 1 | Watchlist doesn't add | Menu taller than screen (Watchlist cut off); entity adds stored cursor ground point; ids not stringified | Entity actions at top of menu, menu measured + scrolls, entity's own position stored, panel opens on add | Headless: add → panel open with item |
| 2 | NVG too dim / unrealistic | Page-wide CSS multiply + black overlays, sun light cut to 5%; Black Marble painted over the DAY side (dayAlpha ignored when terrain has vertex normals) | GPU intensifier stage: auto-gain by sun angle, halo, grain, vignette, P43/P45 (Shift+2); night = lighting off + keyed city lights | Before/after renders day + night |
| 3 | Helis shown as planes | ADS-B `category` (A7 rotorcraft) ignored; "SIKORSKY …/…HELICOPTERS" descs fell to jet; OpenSky country used as type | `resolveAircraftClass()` → A7/B6 first, then `t`, then desc; +60 rotor codes | 394 live tracks: 2/2 A7 = heli; 17 desc strings unit-tested |
| 4 | Markers through earth | 175 markers `disableDepthTestDistance` 5e6, 24 Infinity | One shared dynamic value = camera horizon distance (patched in `merge()` of Billboard/Point/LabelGraphics) | Through-earth pixels 110 → 17 (remaining are in front of horizon) |
| 5 | FLIR bugs + crosshair | CSS invert: white sky, flipped marker colours, reticle `::after`, fake random temp | GPU thermal stage (heat estimate, cold sky, AGC stretch), WHOT/BHOT/IRONBOW chip, no reticle | Renders |
| 6 | No colour per aircraft type | Civil coloured by altitude only | Per-family palette + red/blue outline for mil/VIP; legend with TYPE/ALTITUDE toggle | Legend + recolour live |
| 7 | Random shutdown / not loading | Cesium can't survive WebGL context loss; render governor froze half-drawn frames; single CDN | Auto-reload with view+layers restore (loop-guarded); tile-load render hold; jsDelivr fallback for Cesium | Forced `loseContext()` → overlay → reload → camera restored |
| 8 | Notes lettering too dark | Glass pass made ctx menu 55% see-through, #8B919A text; labels used raw marker blue; labels HTML-escaped (`&amp;`) | Denser glass (0.88 + blur kept), bright text, `_readable()` label colours, no esc() on Cesium labels | Screens over Streets |
| 9/10 | FSCL / phase line buggy, "letting go" | LEFT_CLICK fires twice per double-click (dup vertex); Cesium stock double-click tracked the vertex; inertia slid the globe; rubber band clamped + never re-rendered; panel covered the map | Second click ignored + dedupe; stock dblclick replaced; inertia 0 in battle mode; unclamped live band; panel auto-collapses | 3 clicks + dblclick → 4 vertices, not tracked |
| 11 | Explain double-click | — | Instruction pill while a multi-point tool is armed | Screenshot |
| 12 | Right-click needs validation | Tools/Add menu items called ctxAction with no position → did nothing (Measure, Draw Arrow, Annotation, Intel) | Arm a one-shot map pick; left-click completes measure/arrow | Measure via menu → 2 lines |
| 13 | Can't delete one marker | Delete only removed the clicked piece, hidden at menu bottom | "Delete This Marker" removes the whole item; Delete key on selection | Note deleted, count 0 |
| 14 | Undo button | None outside battle panel | `BDOCUndo`: Ctrl+Z / floating ↶ UNDO; last vertex while drawing | Undo measure, vertex, bullseye |
| 15 | Bullseye won't detach | Outlines silently disabled on clamped ellipses → rings invisible but transparent fill caught double-clicks → camera re-tracked | Rings are clamped polylines, no fill disk; dblclick empty map / ESC releases | Dblclick inside rings → not tracked |
| 16 | Rotating nav widget in the way | — (also: MutationObserver on whole document) | Parks top-right at 62% when AI panel collapses/closes; observer scoped to `#rp` class | Rect 1546/56, scale 0.62 |
| 17 | PD live audio broken | Embedded Broadcastify web-player PAGE in iframe | Native `<audio>` on `broadcastify.cdnstream1.com/<id>` with LIVE status → webPlayer fallback → link | **Fallback chain only** — sandbox can't reach Broadcastify |
| 18 | Live video broken | webcamtaxi/tw.live send X-Frame-Options SAMEORIGIN / CF challenge; Chrome fires `load` on blocked frames | `embed-check` function reads framing headers; blocked → sized pop-up viewer | Headless: blocked → popup opened |
| 19 | Pop density opacity | — | Slider under the layer row, persisted | alpha 0.65 → 0.30 |
| 20 | Navigation slow | Sequential geocoding with 6 s fallbacks; 2 full-detail clamped polylines (1,639 pts ATL→Athens) | Parallel + raced geocoders; 1 line, Douglas-Peucker ≤5 m (1,639 → 250) | Route renders; timing noisy in sandbox |
| 21 | Screen crowding by device | Fixed 248/360 px panels at any size; outage banner sat on map | `bdoc-compact`/`bdoc-tight` tiers, AI panel auto-rail on tight screens (first visit), banner hides after 12 s | 1366/1536 screenshots |
| 22 | Desktop app update | Hard-coded v8.0.0 asset names; app served frozen bundled copy | Download resolves latest GitHub release asset; Electron loads live site when online (falls back offline); release workflow | Syntax only — needs a real build |
| 23/24 | Streets / Topo blown out | Bloom on light basemaps; render stall left blank navy at city zoom | Bloom off on light maps, maps toned ~10% down, tile-load render hold | Before/after: white sheet → full detail |
| 25 | 3D terrain partial / slow | Same render stall; 100-tile cache evicting terrain | Hold render through tile load; cache 400/250/120 by GPU tier, sibling preload | Renders converge; real-GPU timing not measured |

**Believed, not verified here (needs Travon's laptop / a real GPU):**
Broadcastify direct streams per feed ID (#17), feed IDs still current,
GitHub `releases/latest` API reachable for the repo (#22), an actual
electron-builder run of the new workflow, frame-rate impact of the NVG/FLIR
stages on the GTX 1660 Ti, and `embed-check` once deployed (the sandbox
browser treated it as "check failed" because it isn't on Netlify yet).


### Just shipped — p146 + p147

**The "API KEY REQUIRED" tiled across the globe — root-caused and fixed.**

It was **not** the Cesium ion token and **not** a lapsed payment. Token is
healthy:
```bash
curl -s -H "Authorization: Bearer $TOK" https://api.cesium.com/v1/me
# -> 200 {"id":396763,"scopes":["assets:read","geocode"]}
```

Two tile providers return **HTTP 200 with a block notice rendered as the image
itself**, so no error handler ever fired and Cesium happily painted them:

| Provider | What the pixels actually said |
|---|---|
| `basemaps.cartocdn.com/dark_all` | "API KEY REQUIRED — carto.com/basemaps/apikey" |
| `tile.openstreetmap.org` | "403 Access blocked — App is not following the tile usage policy" |

Detection trick worth reusing: **fetch three different x/y tiles and compare
MD5.** Real imagery differs per tile; a block tile is byte-identical.

```bash
for c in 4/6/9 4/5/10 5/12/20; do
  curl -s "https://basemaps.cartocdn.com/dark_all/${c}@2x.png" | md5sum
done   # identical hash => placeholder, not imagery
```

Carto ended keyless public basemaps. OSM blocks clients with no identifying
User-Agent/Referer — the same URL **with** a UA returns real tiles, so it is
policy, not an outage.

Fixed in `js/cesium-init.js` (`BASEMAPS`) and `index.html`, all keyless and
verified serving distinct real tiles:

- `BASEMAPS.dark` → ESRI Canvas `World_Dark_Gray_Base`
- `BASEMAPS.streets` → ESRI `World_Street_Map`
- dark label overlay → ESRI `World_Boundaries_and_Places`
- overview mini-map in `index.html` → ESRI Canvas (was rendering the 403 image
  as a thumbnail)

**Population-density layer (p147) — was dead, now fixed.**
`tiles.arcgis.com/.../World_Population_Density_Map_2022` is gone: service root
returns `{"error":{"code":404,...}}` and tiles return `text/html`. Toggling the
layer painted HTML bytes onto the globe. Replaced with NASA GIBS SEDAC GPW v4:

```
https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GPW_Population_Density_2020/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png
```
**`maximumLevel` MUST be 7** — the tile matrix set is `GoogleMapsCompatible_Level7`
and higher zooms return 403.

**`BUILD p44` pill was a lie.** Hardcoded literal in `index.html` while the
deployed SW was already `bdoc-v145` — stale for ~100 revisions. Now tracks the
build number.

### p150 — real aircraft artwork replaces the drawn glyphs

Travon supplied 17 SVGs. The p149 hand-drawn silhouettes were rightly rejected
as unprofessional. 8 of 10 families now use his vectors; **bomber** and **heli**
still use the drawn fallback because no top-down art was supplied for them.

**Sending vector assets: ZIP THEM.** 25 individual `.svg` attachments were
rejected by the chat image pipeline and never hit disk — which is why p149 was
drawn blind. A `.zip` worked first try. Source files archived in
`assets/aircraft-svg/`.

**Only plan-view art is usable.** Most of the set is side-profile or 3/4
perspective; a marker that rotates to heading needs top-down. The unused files
are kept for panel/detail views where a profile shot is correct.

Path data is used verbatim — never re-drawn. Each glyph is wrapped in a `<g>`
whose transform maps its native viewBox (they ranged 64 to 4000 units) into the
32x32 marker box. Fills are stripped from paths and applied on the group, which
is what keeps live tint working (altitude banding, red-on-select).

**Two traps worth remembering:**
1. A Python heredoc turned `\b` in a regex into a literal BACKSPACE (0x08) —
   seven of them shipped in p149 and the pattern silently never matched. If a
   regex mysteriously fails, check for control bytes:
   `grep -cP '\x08' file.js`
2. `classifyAircraftType` order: the fighter test's `SU-?[0-9]` swallowed SU-57
   before the mig test. Fixed by moving mig above fighter, not by widening
   patterns. Ordering is the mechanism.

Verified by running the real `makeAircraftSVG` from the shipped file: 22/22
classifier cases, all 10 families emit valid SVG, heading rotation and colour
injection confirmed, every family rendered at heading 0/45 and inspected.

### p149 — aircraft silhouettes + lazy-load cache desync

Symbology went 6 families -> 9: added **drone / bomber / tanker** to the runtime
SVG factory in `js/modules/layers-air.js`, with ICAO regexes routing to them.

**Classifier ordering is load-bearing.** First match wins, so unmanned/bomber/
tanker tests MUST precede the civil buckets — `MQ-9` was otherwise caught by
the prop regex, `B-52` by the wide-body `B7x` pattern. A 36-case table covers
this and asserts the 6 original families do not regress.

Lesson worth keeping: the first drone glyph **rendered as a stick figure**
(1.8px-tall wing rect + a floating nose circle = head on a body). Only caught
by rasterising the sheet and actually looking at it. If you add a glyph,
render it — `node --check` passing proves nothing about shape.

**Bug found in passing:** `BDOC.LazyLoader._version` was `p140` while the SW
precached `/js/modules/*.js?v=p31` (6 entries). Cache keys include the query
string, so the SW was caching URLs nothing requests while every real lazy-load
went network-or-nothing — those layers simply failed offline. All 7 module
entries now match `_version` at p149.

**→ When you touch anything in `js/modules/`, bump `LazyLoader._version` in
index.html AND every `/js/modules/*` entry in `service-worker.js` PRECACHE
together.** Verify:
```bash
curl -s https://kgsbdoc.netlify.app | grep -o "_version: 'p[0-9]*'"
curl -s https://kgsbdoc.netlify.app/service-worker.js \
  | grep -oE '/js/modules/[a-z0-9-]+.js.v=p[0-9]+' | sed 's|.*v=||' | sort -u
# must print the same single version
```

### Earlier in the same stretch

- **p76 — globe error message rewritten.** The `catch` around ~340 lines of
  `cesium-init.js` hardcoded "Replace YOUR_CESIUM_ION_TOKEN" for *any* failure,
  which sent us chasing a billing problem that did not exist. It now probes for
  WebGL and classifies the real cause (token / GPU memory / network / unknown).
- **p76 — adaptive skybox.** `const SZ=2048` built six 2048² canvases (~96 MB)
  before texture upload and threw on integrated GPUs and iPads. Now scales from
  `navigator.deviceMemory`: 2048 → 96 MB, 1024 → 24 MB, 512 → 6 MB on mobile.
- **p75 — glass system.** `css/bdoc-glass.css` applies one spec to every real
  panel: fill `rgba(15,17,21,0.72)`, 1px `rgba(255,255,255,0.10)` hairline,
  `0 8px 32px` shadow, `blur(10px) saturate(140%)`, 14px radius. Children tint
  only — nested `backdrop-filter` samples the parent, not the globe, and is
  expensive. `js/bdoc-glass-guard.js` measures real frame rate and drops blur
  below 32fps; override with `BDOCGlass.off()`.
  The 3 scaffold demo boxes were deleted along with `dashboard-ui.js`,
  `dashboard-draggable.js`, `dashboard-glassmorphism.css`.
- **p74 — grid-down mode.** See `docs/GRID_DOWN_OPERATIONS.md`. Four link
  tiers (`cloud → local → mesh → cache`), IndexedDB store, Meshtastic gateway,
  and satellite imagery over LoRa.

---

## 2. OPEN ITEMS — PICK UP HERE

### A. Stripe yearly prices are broken — blocks revenue
**Status:** not a code bug. Needs Travon in the Stripe dashboard.
```bash
# monthly works -> 200 with a real cs_live_ session
curl -s -X POST https://kgsbdoc.netlify.app/.netlify/functions/stripe-checkout \
  -H 'Content-Type: application/json' \
  -d '{"priceId":"price_1TJclHJ2SsOE0CBqbk6yAefw","userId":"probe","email":"x@y.com"}'

# yearly -> 500 "You must provide at least one recurring price in subscription mode"
```
All three yearly price IDs (`STRIPE_PRICE_*_YEARLY`) were created as **one-time**
prices. They must be recreated as **recurring/yearly**. Code is fine.

### B. Mesh tables do not exist in Supabase
`docs/mesh-setup.sql` has never been run. Supabase itself is healthy
(GoTrue 200, `profiles` reads fine), but:
```
mesh_nodes / mesh_messages / mesh_trail / mesh_telemetry -> PGRST205
"Could not find the table 'public.mesh_nodes'"
```
`mesh-nodes` correctly returns `503 not_provisioned`. Travon deferred this —
**do not run it without asking.** Needs the SQL Editor.

### C. `mesh-ingest` returns 503 even though the key is set
Cause confirmed: `_supabase.adminClient()` calls `createClient` in a
try/catch, which **throws on Node 18** and returns `null`. Verified locally —
returns a client on Node 22, null on 18. Fix is either `NODE_VERSION=20` in
`netlify.toml` or rewrite `mesh-ingest` to use PostgREST over `fetch` the way
`mesh-nodes.js` now does. Low priority while (B) is deferred.

### D. Optional side layers missing free keys
Genuinely broken, all non-core, all free tiers:
- `proxy-cfradar` → `CLOUDFLARE_API_TOKEN` ("Read Radar data" token)
- `proxy-ip2location` → `IP2LOCATION_API_KEY`
- `proxy-perenual` → `PERENUAL_API_KEY`
- `proxy-waqi` → returns 200 but body is `{"status":"error","data":"Invalid key"}`
  — a key exists somewhere and is wrong
- `proxy-opensky` → times out; upstream slowness, not a key

Core intel is all keyless and working: FIRMS fires, RainViewer, GDELT, CISA,
NOAA SWPC, outages, Polymarket, maritime, treasury.

### E. Nobody has visually confirmed the glass UI
Hermes **cannot** screenshot: no Chromium on the droplet, `browser_exec` fails
with `chrome-not-running`. The glass work was verified by cascade analysis and
a selector-coverage audit, **not by looking at it**.

**This is the single best thing for Claude Code to do next** — you are on the
laptop with a real browser. Load the site, confirm the panels read as glass,
and check framerate with the globe spinning.

Useful: `/tmp/coverage.py`-style audit lives in the p75 commit history; it
caught 6 panels the first pass missed (`replay-bar`, `tz-bar`, `vfx-flir-bar`,
`vm-sidebar`, `vm-statusbar`, `wxPlaybar`). `#vegNDVIbar` is deliberately
**excluded** — it is a progress-fill, not a panel, and glass breaks it.

### H. p154 items that need a real machine  ← after applying p153/p154
1. Click a police scanner marker → ▶ PLAY LIVE AUDIO. Expect "● LIVE" within a
   few seconds. If it falls back to the iframe on every feed, the direct stream
   host changed — check `broadcastify.cdnstream1.com/<feedId>` in a tab.
2. Open any webcam → it should open a pop-up viewer (providers block framing).
3. Toggle NVG at night and FLIR over a city; watch FPS on the 1660 Ti.
4. Tag `desktop-v8.1.0` to run `.github/workflows/desktop-release.yml`, then
   Help/File → Download Desktop App should pick the new asset.

### J. p155 checks on a real machine  ← after applying 0003
1. `node tools/bdoc-ipc-receiver.js`, then `python tools/adapters/wireshark_adapter.py -D`
   (lists interfaces), then `python tools/adapters/wireshark_adapter.py` (auto-picks
   Wi-Fi/Ethernet on Windows). Network Builder → LIVE WIRESHARK. Chrome will ask to
   access apps on this device → Allow. Badge should read LIVE.
2. Put a device on the map with your PC's LAN IP (ipconfig), tick "capture machine",
   cable it to a router with your gateway IP. Real packets ride that cable.
3. After deploy: `https://kgsbdoc.netlify.app/.netlify/functions/proxy-meshworld`
   should return `count` ≈ 20,000. First call takes ~5 s, cached after.

### I. Next competitive gap — camera network (ARGOS ATLAS has 205k cams)
ARGOS ATLAS (argosatlas.com) shows public DOT/agency cameras as snapshot cards
(latest image + capture time, ~2 min refresh), which sidesteps framing blocks
entirely. Same approach for BDOC: 511GA/GDOT + other state DOT JPEG endpoints
rendered as `<img>` cards with refresh — this is the durable fix behind bug #18.
Also on their list: airport tower audio, 3D aircraft/ship models + onboard view,
dark-ship flags, 7/90-day track history, geofence alerts.

### F. Reconcile (or retire) the stale laptop copy  ← DO THIS EARLY
Travon flagged 2026-10-02 that an older BDOC folder still exists at:
```
C:\Users\ARNAUTICA\OneDrive\Desktop\Golden Fox Agency\SubSitaries\Kitsune Global Solutions LLC\BDOC Deploy
```
It predates p74-p147. Risk: someone edits it, pushes, and silently reverts the
grid-down work, the glass system, the basemap fixes, and these handoff files.

Action for Claude Code (you are on that machine):
1. Determine whether it is a git clone and how far behind (commands in §0 r0).
2. If it holds no unique uncommitted work -> reset to `origin/main`, or rename
   it to `BDOC Deploy _ARCHIVED_pre-p147` so nobody mistakes it for live.
3. If it holds real local work -> branch/stash it and report to Travon before
   reconciling. Do not discard his changes.
4. Recommend a canonical working copy OUTSIDE OneDrive (OneDrive syncs `.git/`
   mid-write and corrupts index/lock files).

Report back in this file which of the above happened.

### G. Grid-down has never touched real radio hardware
`tools/grid_down_gateway.py --test` and `tools/satimg_mesh.py` are verified in
software only. Serial timing, real packet field names, and airtime under
contention are unproven. Needs a Meshtastic node on a bench.

---

## 3. AUDIT SNAPSHOT — all 58 functions probed live (2026-10-02)

```
200: 30    400: 14 (by-design param guards)    401/403: 3 (auth-gated)
405: 4 (method guards)    500: 3 (missing optional keys, §2D)
502: 1 (proxy-overpass, upstream 429)    503: 1 (mesh-nodes, §2B)
```
Reproduce with the loop in the p76 commit, or:
```bash
for f in $(ls netlify/functions/*.js | xargs -n1 basename | sed 's/.js//'); do
  printf "%-28s %s\n" "$f" \
    "$(curl -s -o /dev/null -w '%{http_code}' -m 25 \
      https://kgsbdoc.netlify.app/.netlify/functions/$f)"
done
```

---

## 3b. INTERNAL DOCS ARE NOT PUBLIC (p148)

These very files were being served at `https://kgsbdoc.netlify.app/HANDOFF.md`
(verified 200). They disclose internal architecture, which subsystems are
broken, which API keys are absent, and an operator's local filesystem path.
For a product sold as defense-grade intel tooling, publishing your own gap
analysis is an own-goal.

`netlify.toml` now 404s (not 403 — do not confirm existence):
`/HANDOFF.md`, `/CLAUDE.md`, `/CLAUDE-SECURITY-TASK.md`,
`/LAUNCH_READINESS_AUDIT.md`, `/docs/*`, `/tools/*`.

**If you add a new internal doc, add a matching 404 redirect.** The files stay
in git — that is how we read them — they just must not be served.

Verify after any deploy:
```bash
for p in HANDOFF.md CLAUDE.md docs/GRID_DOWN_OPERATIONS.md tools/satimg_mesh.py; do
  printf "%-36s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://kgsbdoc.netlify.app/$p)"
done   # all must be 404
```

---

## 4. GOTCHAS WORTH KNOWING

- The Cesium viewer global is **`V`**, not `viewer`. Code written against
  `viewer` throws `ReferenceError` and the globe silently stays empty.
- `el.style.display = 'block !important'` is **silently ignored** by the CSSOM.
  Use `el.style.setProperty('display','block','important')`. This cost a full
  debugging cycle on the draggable panels.
- `cache.addAll()` is **atomic** — one 404 rejects the whole batch and leaves an
  *empty* offline cache. Use per-entry `Promise.allSettled`.
- Meshtastic public MQTT needs credentials `meshdev` / `large4cats`, the JSON
  topic is `msh/<REGION>/2/json/#`, and coordinates arrive as fixed-point
  `latitude_i` / `longitude_i` at 1e-7 degrees. A naive `Number(env.from)` on a
  string like `"!abcd1234"` yields the node id `!00000NaN`.
- The Supabase **anon/publishable** key in client JS is correct and expected.
  RLS protects the data, not secrecy. Do not "fix" it. A `service_role` key
  reachable from a browser is a P0.

---

## 5. WHEN YOU HAND BACK

Update §1 with what you shipped and §2 with what you did or did not finish.
State plainly what you **verified by running** versus what you **believe**
works — that distinction is the whole point of this file.
