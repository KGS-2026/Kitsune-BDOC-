# HANDOFF — Hermes → Claude Code

**Repo:** `Kitsune-BDOC-` · working dir is the `BDOC Deploy/` subfolder
**Live:** https://kgsbdoc.netlify.app/
**Last updated by Hermes:** 2026-10-02 · build **p147** · `SW_VERSION bdoc-v147`

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
