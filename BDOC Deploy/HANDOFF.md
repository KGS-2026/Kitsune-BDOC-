# HANDOFF — Hermes → Claude Code

**Repo:** `Kitsune-BDOC-` · working dir is the `BDOC Deploy/` subfolder
**Live:** https://kgsbdoc.netlify.app/
**Last updated by Hermes:** 2026-10-02 · build **p150** · `SW_VERSION bdoc-v150`
**Last updated by Claude Code:** 2026-10-16 · build **p156f** live on `main` @ `54f84cc` · `SW_VERSION bdoc-v156f`

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

### Claude Code — p156f current flowing along grid lines + pipeline flow, on `main` @ `54f84cc` (2026-10-16)

Travon: "animations for the infrastructure line like electrical current".
- **`js/cesium-init.js` (end of file):** a `BdocFlow` Fabric material added
  via `Cesium.Material._materialCache` (private API; re-check on Cesium
  upgrades), plus `window.BDOCFlow`.
  - Screen-space pattern via `v_polylineAngle` (the same trick as Cesium's
    dash material), so pulse spacing is constant in pixels on any segment
    length: bright leading edge, fading tail, electrical shimmer.
  - `time` is a wall-clock uniform (`performance.now()`, not the Cesium
    clock).
- **One shared `FlowProp` per line class** (`power500`, `power345`,
  `pipeHGL`, `pipePetro`). Cesium's per-material ground-polyline batch then
  refreshes the uniforms every frame, and thousands of segments stay batched.
  - **Gotcha:** for a non-constant material that batch reads
    `material.color` as a **Property** (per-instance colour attribute). A
    raw `Cesium.Color` there throws `getValue is not a function`. Keep
    `color` a `ConstantProperty`.
- **Render cost:** `requestRenderMode` stays. A ~24 fps `requestRender`
  ticker (42 ms) runs only while `layers.gridinfra` / `layers.pipelines`
  have entities and the tab is visible, and stops by itself.
  - Off for `prefers-reduced-motion`, GPU tier 1, and Settings → Labels &
    Overlays → "Animate infrastructure lines" (`localStorage bdoc_flowfx`).
- **`js/modules/layers-arcgis.js`:** 500/345 kV lines and HGL/petroleum
  pipelines use `BDOCFlow.material(...)`, falling back to the old colour /
  dash, and call `BDOCFlow.kick()` after load.
- **Version:** `LazyLoader._version` `p156f` + all 10 `/js/modules/*`
  precache keys, `cesium-init.js?v=p156f`, SW `bdoc-v156f`, `BUILD p156f`,
  changelog.

**Verified by running:**
- **Headless Chrome on the local build with live HIFLD data:**
  - 3,472 grid + 467 pipeline segments loaded, no errors.
  - GIF frames show pulses moving along the lines.
  - 24 render requests/s while on, stopping once both layers are off.
  - Render 5.6 vs 5.1 ms/frame, on vs off (SwiftShader, relative only).
- `ci-validate.sh` passes.
- **Live:**
  - `BUILD p156f`, `bdoc-v156f`, the module keys, `BDOCFlow` and
    `layers-arcgis.js` using it are all served.
  - A returning browser moved from v156e to v156f with only v156f caches,
    `BDOCFlow` loaded, plan autosave ready.
  - A test flow polyline rendered on the live origin with no errors.

**Not verified:** battery cost on a real tablet or phone, and how it looks on
the 2070 at full speed (only headless frames were captured).

### Claude Code — p156e battle plan persistence + real-shape exports, on `main` @ `a5a677c` (2026-10-16)

Fixes field audit S3 + S5 (§2 V) and the EOC eval's "markers vanish on refresh".

**New `js/bdoc-plan.js`** (loaded after `bdoc-offline-store.js`):
- **Serializer:** handles every `battleEntities` item generically, single
  entities or groups. It reads all billboard, label, point, polyline, polygon,
  ellipse and rectangle properties, plus Dash/Glow/Arrow/Outline/Image
  materials, `battleMeta`, and a CASEVAC card's CoT from `window._cotStore`.
  No drawing tool was touched, so new tools are covered automatically as long
  as they push into `battleEntities`.
- **Autosave:** to IndexedDB `bdoc-offline` → store `meta` → key
  `battle_plan_v1`, about 0.8 s after any change.
  - Triggers: push/splice (the tracked array is wrapped again, keeping the
    BDOCUndo hook), `clearBattleEntities()`, any entity's `definitionChanged`
    (note edit, recolor), and a 4 s length check.
  - The plan is restored on boot.
  - `beforeunload` warns only while a change isn't confirmed saved.
  - A red toast appears if IndexedDB fails.
- **Exports:**
  - `exportBattlePlan()` → `BDOCPlan.exportGeoJSON()`: Point / LineString /
    Polygon, circles as a 64-pt Polygon + `radius_m`, groups included,
    simplestyle colours.
  - `exportBattlePlanCoT()` → `BDOCPlan.cotEvents(pickCoT)`: `u-d-f` shapes
    with `<link>` vertices, `u-d-c-c` circles, and the CASEVAC's full 9-line.
    Ring/degree labels inside groups are skipped.
- **💾 SAVE FILE / 📂 OPEN FILE** (battle panel): a full-fidelity
  `.bdoc.json` (`format: "bdoc-plan"`, `version: 1`). Opening appends to the
  plan with new ids, then flies to it.
  - **Imports are sanitized:** DOMPurify on the description and
    `meta.popupExtras` (the info box has `allow-scripts`, §2 N #18); hex-only
    `meta.color`; `data:image` billboards only.
  - Inline `onclick` buttons in imported cards are therefore inert. The
    right-click menu still works.
- **Update banner:** says the plan is saved on the device when it is.
- **Version:** SW `bdoc-v156e` (precaches `bdoc-plan.js?v=p156e`),
  `BUILD p156e`, changelog entry.

**Verified by running:**
- **Headless Chrome, old (p156d) vs new**, against a local server with the
  real SW. A 12-item / 52-entity plan was drawn with the app's own tool
  functions.
  - Reload: old lost all of it; new restored it identically.
  - Note edit and undo persist across a reload.
  - `beforeunload` fires only when unsaved.
  - GeoJSON: old was 8 Points only; new is 22 LineString + 3 Polygon +
    27 Point, with PL ALPHA as a 3-vertex LineString and the circle carrying
    `radius_m`.
  - CoT: old was 8 events; new is 30 well-formed (24 `u-d-f`, 1 `u-d-c-c`,
    the full CASEVAC).
  - `.bdoc.json` (86 KB) opened on a fresh profile: identical.
  - A hostile `.bdoc.json` ran no script, and its colour and remote image
    were dropped.
- `ci-validate.sh` passes.
- **Live:** `BUILD p156e`, `bdoc-v156e` and `bdoc-plan.js` are served. A real
  round trip on the live origin worked (marker → IndexedDB → reload →
  restored with its note → cleaned up).

**Not verified:**
- CoT shapes in a real ATAK, WinTAK or iTAK (well-formed only; no TAK device
  here).
- `beforeunload` on mobile browsers.

**Nit:** the 4 s length check doesn't reset after a save, so one redundant
save follows each add or remove. Harmless; set `lastLen` in `saveNow()`.

### Claude Code — p156d field-safety pass, on `main` @ `f6c2aee` (2026-10-16)

These are the quick, silent-failure items from the field-resilience audit (§2 V).
- **S6** `js/bdoc-atak.js`: `xmlEsc()` covers every CoT attribute and text
  node (`buildCoT`, `_casevac`, `_zmist`).
- **S7/S8** `latLonToMGRS` (`index.html`): the Svalbard zone exceptions now
  apply only at 0–42°E. The zone is padded to two digits, and lon 180 maps to
  zone 60.
- **S1/S11:**
  - New `netlify/functions/ping.js` (no-store). The SW lets it through
    untouched, and `bdoc-link-manager.js` probes it instead of the cached
    `config`.
  - The SW's offline answer for API calls is now **503** + `X-BDOC-Offline`,
    with the same JSON body. `data.js` treats that header as a transient
    network error, so its retry and stale behaviour are unchanged.
- **S3** (`index.html` SW block): on `controllerchange`, there's no reload
  while `battleEntities.length > 0`. Instead the banner offers EXPORT PLAN /
  UPDATE NOW / LATER.
- **S4:** `savePACE` and community report/vote saves only say "saved" when the
  localStorage write worked; otherwise they show a red warning.
- **Version:** `bdoc-atak.js`, `bdoc-link-manager.js` and `data.js` are
  `?v=p156d`; SW `bdoc-v156d`; `BUILD p156d`; changelog entry.

**Verified by running:**
- **Browser test:** old (p156c) vs new in visible Chrome, against a local
  server with the real SW; offline = server killed + browser offline.
  - S6: the CASEVAC form with `& < " '` gave not-well-formed XML before; now
    it's well-formed and all fields round-trip.
  - S4: storage full showed false "saved" toasts before; now it shows "NOT
    saved".
  - S3: with 1 marker it reloaded and lost the marker before; now there's no
    reload, the marker is kept and the banner shows. With 0 markers it still
    reloads.
  - S1: offline, the link state stayed `cloud`; now it's `cache`, and back to
    `cloud` when online.
  - S11: an uncached fn offline returned 200; now 503 + header.
- **MGRS** vs the `mgrs` library: 3,366/3,366 strict matches (old: 259 wrong,
  all >72°N west of 0°).
- `ci-validate.sh` passes.
- **Live:**
  - `BUILD p156d` and `bdoc-v156d` are served.
  - `ping` returns 200 `no-store`.
  - A returning browser moved from v156c to v156d, link `cloud`, and its probe
    requests `/ping`.
  - Greenland MGRS is correct in the page; no console errors.

**Not done:** S3's persistence (a manual refresh or crash still loses
markers), plus S2, S5, S9, S10, S12, S13 (§2 V).

### Claude Code — p156c service-worker fix, on `main` @ `160c111` (2026-10-16)

Fixed §2 S (now marked ✅). `service-worker.js` `cacheFirst()` now does exact
match → network → any-version copy only when offline. Also: SW `bdoc-v156c`,
`BUILD p156c`, and a changelog entry.
- **Verified:** a deploy simulation in Chrome; old vs new code, online and
  offline. Details are in §2 S.
- **Verified:** `ci-validate.sh` passes.
- **Verified live:** `BUILD p156c` and `bdoc-v156c` are served with the new
  `cacheFirst`. A returning browser on v156b moved to v156c with only v156c
  caches left, the p156b settings in effect and no console errors.

Also logged the three outside audits from today in §2 U.

### Claude Code — p156b sharper globe, on `main` @ `1d4b82b` (2026-10-16)

Travon asked for "sharper graphics, like Google Earth". The measured live
settings on his RTX 2070 (tier 3) were:
- Already good: native resolution, SSE 1.5, 4× MSAA, 400-tile cache.
- Softening the image:
  - FXAA running on top of MSAA.
  - p68's heavy grade (saturation 1.25, contrast 1.16, gamma 0.92).
  - Bloom at globe view.
  - Raster labels capped at z18.
  - Esri imagery capped at z19.

p156b fixes the first three. All changes are in `js/cesium-init.js` unless noted.
- **Anti-aliasing:** 4× MSAA alone on WebGL2; FXAA only as the WebGL1 fallback.
  Settings → Antialiasing (`index.html`) offers MSAA 4x / FXAA / Off.
- **Satellite grade:** one shared `window.BDOC_SAT_GRADE` (contrast 1.05,
  saturation 1.08, gamma 1.0) at the top of the file. It is used at init and
  by the `satellite`/`hybrid` basemaps, so tune it there.
- **Bloom (far end):** brightness −0.30 → −0.45, sigma 3.0 → 2.2.
- **Version:** SW `bdoc-v156b`, `cesium-init.js?v=p156b`, `BUILD p156b`,
  changelog entry.

**Verified by running:**
- `ci-validate.sh` passes.
- **Visible Chrome comparison** (Intel UHD 630; the same GPU for both runs).
  Live p156 against live + local p156b files, with the same camera and clock.
  Frames were read from the WebGL canvas. Laplacian sharpness:

  | View | Before | After |
  |---|---|---|
  | Globe | 17.6 | 20.5 (Sahara bloom glare gone) |
  | Region crop | 37.7 | 41.2 |
  | City crop | 36.0 | 37.3 |
  | 350 m close-up | 9.67 | 9.59 (limited by Esri's z19 imagery) |

  No new console errors.
- **Live:**
  - `BUILD p156b`, `bdoc-v156b` and `cesium-init.js?v=p156b` (with the new
    code) are served, and internal docs still return 404.
  - In a returning browser: msaa 4, fxaa off, grade 1/1.05/1.08/1.

  That check passed only on the **second** load. The first load after the
  deploy ran new HTML with the **old** `cesium-init.js` (§2 S).

### Claude Code — p153–p157 deployed + mem0 key file pulled (2026-10-16)

Applied patches `0001`–`0005` on `c1f5f06` and pushed to `main` (Travon's go,
2026-10-16). `main` was still `c1f5f06`, so no rebase was needed. Backup branch:
`claude/p153-p157-sec`.

| Commit | What |
|---|---|
| `64e104a` | p153 Cesium 1.146 |
| `9e8d4b8` | p154 field list |
| `d842d56` | p155 Network Builder + Mesh World |
| `da378d5` | p156 Skybridge |
| `32c68c3` | p157 queue doc |
| `e086a19` | security: `mem0_importer.py` reads the key from env; `netlify.toml` 404s it |

`e086a19` is the code half of `0a3d5b4` from the laptop clone
`C:\Users\ARNAUTICA\source\repos\Kitsune-BDOC-` (committed 2026-10-13, never
pushed). Its HANDOFF note, and that clone's other unpushed commit `d92c8b6`
(the "two-way baton" header + 2026-10-13 catch-up log), conflict with this
file's p153–p157 entries and are **not** merged. They exist only in that clone.
Reconcile by hand, then reset that clone to `origin/main`.

**Verified by running:**
- `scripts/ci-validate.sh` → `ALL CHECKS PASSED`, but only after three Windows
  quirks were worked around without repo changes (§2 Q).
- `SW_VERSION = 'bdoc-v156'`; `BUILD p156` in `index.html`.
- Skybridge smoke test: `skybridge.py demo` exit 0; `mesh/events` returned 29
  events; `decode` wrote `raster-1.png` + `decoded.json`.
- Live, about 30 s after the push:
  - `BUILD p156` and `bdoc-v156` are served.
  - `/mem0_importer.py` returns **404** (it was 200 before).
  - `HANDOFF.md`, `CLAUDE.md`, `docs/GRID_DOWN_OPERATIONS.md`,
    `docs/WIN_PLAN_2026-10.md` and `tools/skybridge.py` all return 404.
- `proxy-meshworld` is only partly working: `status=ok` with 9,688 nodes and
  10,306 links at 14:00Z, and 9,671 nodes on the 14:10Z rebuild. Both are
  below the 10,000 bar. Source A (liamcottle) timed out both times, so the
  response is meshmap.net data alone (§2 P).
- In the browser: `BUILD p156`, `Cesium.VERSION` 1.146.0, viewer up.
  - Console errors on load are **all pre-existing**: CORS blocks on direct
    fetches to fire.ca.gov, OpenSky, FIRMS and adsb.lol (the same code is in
    p152), plus `mesh-nodes` 503 (§2 B).
  - The Skybridge and Mesh World rows and both Tools entries exist and are
    locked for guests.
  - `skybridge.js`, `net-builder.js` and `mesh-world.js` (`?v=p156`) are
    served with 200.

**Not verified:** clicking through COMMS → Skybridge, Network Builder →
SKYBRIDGE DEMO, and Mesh World. All three are operator-tier, and this session
had no operator login (it did not use a console tier override). Travon: check
them signed in.

### Claude Code — p156 (2026-10-14) — Skybridge: satellite data over the mesh, on `main` @ `da378d5` (2026-10-16)

Patch `0004` on top of p155. SW `bdoc-v156`; LazyLoader `_version` + module keys
`p156`; `auth.js?v=p156`.

- `tools/skybridge.py` — BDSB/1 binary format (raster grid / warning polygons / text),
  8-byte chunk header, 199-byte payloads, CRC32, one XOR parity chunk per message.
  `raster` (SatDump/goestools PNG + bbox, `--enhanced` for colour IR, median, despeckle),
  `warnings` (NWS GeoJSON), `text`, `send --radio serial:COM5 | tcp:host` (meshtastic lib,
  port 256, paced per preset) or `--sim` into the local receiver, `demo`, `decode`.
- `tools/bdoc-ipc-receiver.js` — `mesh/packet` route + `GET /api/v1/mesh/events`.
- `tools/grid_down_gateway.py` — forwards EVERY packet heard to `mesh/packet`
  (port-256 payloads as base64, text, hop/SNR/RSSI).
- `js/modules/skybridge.js` — reassembly + parity rebuild + CRC + inflate in the browser;
  rasters as an imagery layer (clouds or E-INK), warnings as ground polygons, bulletins
  in the panel/EventLog; products saved to IndexedDB and restored offline. Layer row
  `skybridge` (COMMS) + Tools menu. Gate `skybridge` (operator).
- `js/modules/net-builder.js` — LIVE also polls `mesh/events`: every mesh packet (TEXT,
  POS, TELEM, SKY …) animates; broadcasts fan out one hop to each radio neighbour;
  new `dish` device; SKYBRIDGE DEMO topology (node ids match `skybridge.py demo`);
  raised cables keep a depth-fail material so terrain can't hide them.

Verified here: Python round-trip of all three types; every single-chunk loss rebuilt,
two losses correctly refused, corruption caught by CRC; gateway path with real-shaped
Meshtastic packet dicts; a real GOES-19 band-13 image (Oct 14 13:01Z) encoded to 353 B
and drawn over the Southeast in the browser; browser parity rebuild of a dropped
chunk; Network Builder animation of the simulated mesh. Not verified: a physical
Meshtastic radio, a physical dish.

### Claude Code — p155 (2026-10-14) — Network Builder + Meshtastic World, on `main` @ `d842d56` (2026-10-16)

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

### Claude Code — p153 + p154 (2026-10-14) — built and tested, on `main` @ `64e104a` + `9e8d4b8` (2026-10-16)

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

### W. Three more outside audits, 2026-10-16 (live p156e; files in Travon's Downloads)
- `bdoc-operator-eval-2026-10-16.md` (tier-1 SMU)
- `BDOC_consumer_teardown_2026-10-16.md` (impatient consumer)
- `BDOC-field-eval-2026-10-16.md` (drone/TD unit)

**Confirmed in source by Claude Code, same day:**
- **Notification prompt on load.** `index.html:10414` calls
  `Notification.requestPermission()` at top level. This contradicts
  `bdoc-push.js` ("NEVER auto-prompts"); users who hit "Block" are lost for
  good. Fix: delete it. The watch-zone path (`:3288`) already asks in context.
- **Keys in client JS.** The FIRMS MAP_KEY is in `initMobile`
  (`index.html:2624`) and the AISStream `APIKey` is at `index.html:5327`
  (open since Aug 14). §0 rule 6 applies: Travon rotates. Then route FIRMS
  through `proxy-firms` and AIS through a server relay.
- **`og:image` → `/og-image.png` returns 404,** so every shared link has no
  preview.
- **MGRS:**
  - Settings → Coordinates → "Military Grid (MGRS)" is a no-op
    (`converters.js` `formatCoord` has no mgrs branch).
  - There's no MGRS **parser** anywhere, and no 6/10-digit option.
  - The right-click "copy coordinates" copies decimal degrees.
- **Offline imagery is accidental.**
  - Esri tile URLs match neither `TILE_HOSTS` nor the tile regex (no file
    extension), so they fall into `networkFirst` → `STATIC_CACHE`.
  - That cache is unbounded and wiped on every `SW_VERSION` bump.
  - `putTile()` has no callers, and there's no AOI pre-stage or coverage view.

**Reported, not yet re-checked here:**
- The context menu is right-click only (no long-press), so the touch target
  loop can't be completed on a tablet.
- No GPS fix age, spoof gate or manual position (S10).
- No EMCON / field mode; ~100 third-party hosts plus analytics.
- Live entities carry no per-entity staleness.
- Text and targets are tiny (median 24 px targets, most text <11 px).
- On mobile, the "built for desktop" card and the persona wizard stack, and the
  wizard blocks the button.
- The page restarts ~15 s into a cold mobile boot (unreproduced).
- The pricing modal says Recon has 3 layers and the AI copilot is paid; the
  code gives 10 layers and a free copilot.
- The privacy policy omits Simple Analytics and location.
- Manifest: `orientation: landscape` + `fullscreen`, empty `screenshots`.
- `.bdoc.json` import twice doubles items: no UID merge.

**Each audit's top pick:**
- **Operator:** AOI pre-stage with a coverage-verified "AOI READY" badge (it
  gates every offline feature).
- **Field:**
  1. Touch target loop: long-press menu, COPY GRID, `navigator.share`, a
     working MGRS setting.
  2. MGRS decoder + manual position + GNSS-suspect gate.
  3. Sector pre-cache + self-hosted Cesium.
- **Consumer:**
  - A mobile "near you now" home card.
  - No notification prompt at boot.
  - Panels collapsed on phones, 12 px / 44 px floors.

Cheap, high-value next build: delete the boot notification prompt, a
long-press context menu + COPY GRID / SHARE, a working MGRS display setting
(6/8/10-digit, spaced), an MGRS parser in search, and add `og-image.png`.

### V. Field-resilience audit, 2026-10-16 (`BDOC-field-resilience-audit-2026-10-16.md`, Travon's Downloads)
An "institution absent" audit: grid down, no admin, junk phones, milsim
weekend. It audited live p156c from the deployed files. Claude Code confirmed
S1, S2, S3, S5, S6 and S7 in source before fixing.

**Fixed in p156d:**
- S1 link badge
- S3 auto-reload (banner only)
- S4 save toasts
- S6 CoT escaping
- S7/S8 MGRS
- S11 offline 503

**Fixed in p156e:**
- S3 persistence: autosave/restore + `beforeunload`
- S5 real LineString/Polygon and CoT shapes, plus `.bdoc.json` import

**Still open, silently wrong (highest first):**
- **S2 paid tools lock offline.** `loadProfile` fails, so `tier` stays
  `recon`, and Battle Tracker needs analyst/enterprise (`enterBattleMode`).
  Fix: cache `{tier, exp ≤30 d}` after each successful load, or make Battle
  Tracker free (it holds no licensed data).
- **S9 "Community" trust is this-device-only.** Label it "unverified — this
  device" and drop the 50 % starting trust.
- **S10 GPS honesty.** The accuracy circle is clamped to ≥50 m, and there's
  no fix age, no jump check and no manual position.
- **S12** `BDOCLinkManager.fetchSource()` has zero callers (the HUD "CACHED"
  is only a label).
- **S13** the device clock is authoritative. `ping` now returns server `t`,
  so a skew warning is cheap.

**Fails when the institution is absent:**
- No offline AOI tile download (`putTile` has no callers).
- `unpkg` (mqtt.js) isn't in `CDN_HOSTS`, so it isn't cached offline.
- The local receiver is hard-wired to 127.0.0.1, so phones can't reach a
  laptop gateway on the LAN.
- No self-hosting path.
- Stripe-only billing.

**Milsim gaps:** no sharing between players, no coordinate *input*
(MGRS/UTM/lat-long), no AAR export or GPS breadcrumb, the CASEVAC modal is
fixed 580 px (doesn't fit a phone), and no i18n/RTL.

Audit's top 5 for the widest benefit:
1. Honest link state (done).
2. Plan persistence + `.bdoc.json` export/import.
3. Coordinate input + an honest GPS panel.
4. QR/file peer sharing.
5. Externalized strings + responsive tactical UI.

### U. Three outside audits, 2026-10-16 (files in Travon's Downloads)
`bdoc-soc-tier-audit-2026-10-16.md`, `bdoc-geoint-analyst-audit-2026-10-16.md`,
and `BDOC Phantom — EOC Deployment Evaluation.pdf`. All three ran against live p156.
Checked by Claude Code the same day:
- **Push alerts can't be delivered.** `GET push-subscribe` returns
  `count:1, sendReady:false`: one device is subscribed, and the VAPID signing
  key isn't configured, so nothing can send. The EOC eval says the UI tells
  subscribers "Armed" (not re-checked here). This is the life-safety #1 item.
  Fix: set the key in Netlify (Travon), or stop saying "Armed" until
  `sendReady` is true.
- **`?dev=` paywall key: closed in production.** `checkDevKey()` wipes the
  key and returns false unless the host is localhost or 127.0.0.1
  (`auth.js:22-26`). The SOC audit's "still present" means the identifiers
  exist, not that the bypass works. The console tier override is a separate
  issue and stays open (§2 L.1).
- **Not yet tracked here** (the EOC eval's punch list, in its order):
  - Drawn markers (`battleEntities`) are lost on refresh with no warning.
    (p156d stops *update-triggered* reloads while markers exist. **p156e
    fixes this:** the plan autosaves to IndexedDB and is restored on boot.
    The PACE plan and community reports were already in localStorage. None
    of it is shared between users yet.)
    `BDOCOfflineStore` already exists; autosave to it and warn on
    `beforeunload`.
  - `mesh-globe-layer.js` uses a bare `fetch` (no `BDOCLinkManager`
    fallback), polls the 503 `mesh-nodes` every 30 s with no backoff, and
    shows no failure in the UI.
  - `createGeofence` / `checkGeofences` (`bdoc-atak.js`) have no callers.
  - No shared incident object. PACE plan, community reports and markers are
    single-browser only (Supabase + Realtime is the proposed fix).
  - The narrow-screen interstitial blocks phones before onboarding.
  - An EM-vocabulary preset for the military tool names.
- **From the GEOINT audit:**
  - The glass-guard cold-load FPS sample can disable glass for the whole session.
  - Layer toggles have no `aria-label` (`a11y.js` reports 0 labeled).
  - Layer/map-style click overlap below full width.
  - No WGS84 tag on the coordinate readout.
  - CSV import is missing.

### S. ✅ FIXED in p156c (`160c111`) — service worker served OLD JS on the first load after every deploy
`cacheFirst()` now goes exact match → network → any-version copy only in the
offline `catch`. Tested in Chrome with a local deploy simulation, new SW held
back 8 s:
- Old code: requested `?v=D2`, ran D1.
- New code: ran D2.
- Offline: both boot from cache, the any-version fallback returns 200, and a
  never-cached file returns 408.

Live: a returning browser moved from v156b to v156c cleanly. (The p156c deploy
itself changed no versioned JS, so it couldn't skew.) Original write-up:

`cacheFirst()` in `service-worker.js` (~l.161) tries
`caches.match(request, {ignoreSearch: true})` **before** the network. Here is
what happens on a returning visitor's first load after a deploy:
1. The new SW hasn't finished precaching yet.
2. The old SW gets `cesium-init.js?v=p156b`, misses the exact match, and
   returns its cached `?v=p154` copy.
3. The page runs new `index.html` with old JS.

The next load is correct (the new SW activates and deletes the old caches).
Seen live 2026-10-16:
- First load: `BUILD p156b`, but `BDOC_SAT_GRADE` undefined and FXAA on.
- Second load: correct.

This has applied to **every** deploy: a mixed-version page for one load, and
a real breakage risk when new HTML calls functions the old JS lacks. The
ignoreSearch fallback exists for grid-down (offline) use. Fix: try exact match,
then the network, and use the ignoreSearch match only in the `catch` (offline)
path. Bump `SW_VERSION`. Test both online and offline.

### R. Far-side country labels drawn over the map at city/region zoom
At Atlanta 350 m, 27 labels 9,000–12,000 km away (JAPAN, CHINA, INDONESIA,
TURKEY …) are drawn on top of the imagery. All are behind the globe
(`EllipsoidalOccluder` confirms it). They also show at 350 km (INDONESIA over
Georgia). Present on p156 and p156b alike.
- **Source:** "major country labels", `cesium-init.js` ~l.1422–1484
  (`NATIONS`, 32 entries), plus crisis-zone labels such as "⚡ YEMEN / RED SEA"
  (`index.html` hot zones, ~l.11045).
- **Why they show:** `distanceDisplayCondition(1.5e6, 2.5e7)` is measured from
  the camera to the label, so from Atlanta Japan (9,700 km) qualifies. They set
  no `disableDepthTestDistance` and still aren't occluded at close zoom. That
  root cause is not confirmed.
- **Fix:** gate on camera **altitude** instead (show only above ~1,500 km), and
  hide any label that `EllipsoidalOccluder.isPointVisible()` says is behind the
  globe, checked in `camera.changed` (32 entities, cheap). Apply the same gate
  to the crisis-zone labels.

### T. Remaining "Google Earth sharpness" levers (after p156b)
1. **z20 imagery where Esri has it.** Downtown Atlanta has real z20; rural GA
   stops at z19. Past that, Esri returns a 2,521-byte "Map data not yet
   available" tile, so add a missing-tile discard policy. Do this together with
   the licensed Esri setup (§2 L.1).
2. **Vector place labels** to replace the raster `World_Boundaries_and_Places`
   (max z18; blurs when zoomed or tilted). This fits the p158 offline packs.
3. **Optional "Ultra" quality** for strong GPUs: `resolutionScale` slightly
   above native, SSE 1.0.
4. **3D Photo (Google photoreal tiles)** as a standalone showcase, under the
   licensing limits in §2 L.2.

### M. Confirm the leaked mem0 key is revoked  ← Travon, mem0 dashboard
`mem0_importer.py` shipped a hardcoded mem0 API key, and Netlify served it at
`/mem0_importer.py` with 200 from at least 2026-10-13 until the `e086a19`
deploy on 2026-10-16 (now 404). The key is still in git history, and the repo
is public. The 2026-10-13 note says it is **not** Hermes's `MEM0_API_KEY` and
that nothing running uses it. Nobody has confirmed it was revoked. Per §0 rule
6, agents don't rotate: Travon revokes it in mem0 and records that here.

### N. Oct 8 hardening pack — port it, don't copy it
`BDOC_hardening_pack.zip` (with `HARDENING.md`, in Travon's Downloads) was built
on p152 and has **not** been applied.
- **Do not** follow its "copy everything in `patched/` over the repo root" step.
  `index.html`, `js/auth.js`, `js/cesium-init.js` and `js/modules/outage-watch.js`
  were all changed by p153–p156, so copying would silently revert them.
- `PATCH.diff` test-applied to `e086a19`:
  - `auth.js` and `outage-watch.js` apply.
  - `index.html` (Cesium tag lines) and `cesium-init.js` fail.
  - Its SRI hashes are for Cesium 1.104 and must be recomputed for 1.146.
- Not needed: its `proxy-status.js`. Ours already restricts to 15 known hosts.
- New files to add as-is: `netlify/functions/_lib/guard.js`, `csp-report.js`,
  `js/infobox-bridge.js`, `js/bdoc-auth-fetch.js`, `local-bridge/bridge_guard.*`.
- Needs Travon: the Supabase SQL (`hardening.sql`) and the Netlify env vars
  (`BDOC_INTERNAL_SECRET` etc.).

Oct 8 review (`BDOC_code_review_2026-10-08.md`), status on `e086a19`:

| # | Finding | Status |
|---|---|---|
| 2 | `proxy-gdelt` 503 | **Fixed**: returns 200 |
| 11 | Cesium 1.104 | **Fixed** by p153 |
| 20 | `proxy-status` open proxy | **Fixed**: allowlist already in place |
| 1 | `mesh-nodes` 503 | Still open (§2 B) |
| 3 | Auth deadlock | Still open: `await this.loadProfile()` inside `onAuthStateChange` (`auth.js:59`) |
| 4 | Local bridge readable by any site | Still open: receiver sends `Access-Control-Allow-Origin: *` |
| 6/7 | Floating CDN versions, no SRI | Still open: `supabase-js@2` and `mqtt@5` float; 0 `integrity=` |
| 14 | Paywall unlocks from the console | Still open (also §2 L.1) |
| 18 | InfoBox iframe `allow-scripts` | Still open (`cesium-init.js:124`) |

### O. Heli + bomber icons — art supplied 2026-10-16
p150 left `heli` and `bomber` on hand-drawn glyphs ("no suitable top-down
art"). Travon has since supplied SVGs. They are on the laptop only (Downloads),
not in the repo; send them zipped (p150 lesson).
- **Top-down helicopter:** `military-helicopter-bottom-view.svg`,
  `military-helicopter.svg`.
- **Top-down four-engine transport:** `transport.svg`.
- **Bomber candidate:** `army-airplane-bottom-view.svg`, a top-down swept-wing
  military jet.
- **Not usable:** `bomber.svg` and `heliciopter.svg` are side or angled views.

Wire them into `assets/aircraft-svg/` and `js/modules/layers-air.js`
(`case 'heli'` ~l.294, `case 'bomber'` ~l.335), then bump `?v=` and `SW_VERSION`.

### P. `proxy-meshworld` source A times out
The function gives each source `8500` ms. liamcottle is about 3.4 MB gzipped
(28 MB raw) and took 3.9–7.1 s from the laptop before JSON parse. Source A
timed out on **both** fresh builds after the deploy, so the function served
meshmap.net alone with `sources.a: 'unavailable'`:
- 14:00Z: 9,688 nodes
- 14:10Z: 9,671 nodes

This is persistent, not a cold start. Mesh World shows about half the nodes
and loses liamcottle's measured RF links, which the route finder depends on.
Fix:
- Raise the timeout toward the function limit, **or**
- keep the last good merge in Netlify Blobs and serve it when a source fails.

### Q. `scripts/ci-validate.sh` fails on Windows Git Bash
It fails for three reasons, none of them a code problem:
1. There is no `python3` command on Windows.
2. Python writes temp files as cp1252 and dies on `→` in `index.html`.
3. `C:\Users\ARNAUTICA\AppData\Local\Temp\package.json` is actually a GIF, so
   `node --check` refuses every temp file under `%TEMP%`.

Workaround used on 2026-10-16: a `python3` shim on PATH, `PYTHONUTF8=1`, and
`TMP`/`TEMP`/`TMPDIR` pointed at a directory containing a `{}` `package.json`.

Script fix: fall back to `python`, set `PYTHONUTF8=1`, and give the inline
check its own temp dir with a `{}` `package.json`. Also, check 2/4 skipped
silently when `python3` was missing; make that a failure.

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

### K. p156 checks on a real machine  ← after applying 0004
1. Two Meshtastic radios on a private channel (index 1). Radio A on the "station"
   machine: `python tools/skybridge.py demo --save out` then
   `python tools/skybridge.py send out/ir.bin out/warnings.bin out/bulletin.bin --radio serial:COMx --channel 1`.
2. Radio B on the BDOC laptop: `node tools/bdoc-ipc-receiver.js` + `python tools/grid_down_gateway.py --serial COMy`.
   Turn on COMMS → Skybridge. Clouds, 3 warnings and a bulletin should appear with Wi-Fi off.

### L. NEXT BUILD QUEUE — p157 → p159 (Travon's direction, 2026-10-14)
Full reasoning: `docs/WIN_PLAN_2026-10.md`. Position: BDOC is the command post that
runs with no internet and no server, and can prove nothing leaves the machine.
1. **p157 Sovereign Mode + review hygiene** — one switch cuts every outbound call
   (Plausible, Esri, Cesium ion, Google, Supabase, Netlify proxies); local-only
   profile; live readout of outside hosts contacted; remove or label the 40
   hardcoded webcams and 19 fixed dark-fleet ships; restore map credits
   (`creditContainer` is a detached div today); server-side tier checks in the
   proxies (`BDOC_Auth.tier='enterprise'` in the console unlocks everything now).
2. **Google 3D path** — "3D Photo" streams Google tiles via Cesium ion asset
   2275207 on the ion token, not Travon's paid `GOOGLE_MAPS_API_KEY` (which
   `config` hands out and nothing uses). Google content terms: no use near a
   non-Google map, no "emergency response services", no caching/offline,
   attribution required. Fix: use the paid key directly, standalone view
   (Esri off, Google logo on), excluded from Sovereign/offline modes.
3. **p158 Offline AO packs** — USGS 3DEP + NAIP + OSM/Protomaps, draw a box,
   download, airplane mode; MGRS map print.
4. **p159 Team over mesh** — decode Meshtastic POSITION + ATAK_PLUGIN (portnum 72)
   into team icons; terrain line-of-sight relay planner.
5. **BDOC Node v1** — solar GOES/Meteor + ADS-B + AIS + Meshtastic router box;
   feeder program (host a node → Pro free).

### J. p155 checks on a real machine  ← after applying 0003
1. `node tools/bdoc-ipc-receiver.js`, then `python tools/adapters/wireshark_adapter.py -D`
   (lists interfaces), then `python tools/adapters/wireshark_adapter.py` (auto-picks
   Wi-Fi/Ethernet on Windows). Network Builder → LIVE WIRESHARK. Chrome will ask to
   access apps on this device → Allow. Badge should read LIVE.
2. Put a device on the map with your PC's LAN IP (ipconfig), tick "capture machine",
   cable it to a router with your gateway IP. Real packets ride that cable.
3. After deploy: `https://kgsbdoc.netlify.app/.netlify/functions/proxy-meshworld`
   should return `count` ≈ 20,000. First call takes ~5 s, cached after.
   (2026-10-16: both fresh builds got ~9,700 nodes from meshmap.net only; see §2 P.)

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
