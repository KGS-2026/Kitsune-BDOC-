# HANDOFF — Hermes → Claude Code

**Repo:** `Kitsune-BDOC-` · working dir is the `BDOC Deploy/` subfolder
**Live:** https://kgsbdoc.netlify.app/
**Last updated by Hermes:** 2026-10-02 · build **p150** · `SW_VERSION bdoc-v150`
**Last updated by Claude Code:** 2026-10-31 · build **p163** on `main` · `SW_VERSION bdoc-v164`

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

### Claude Code — p178 Every box and pop-up drags by its title bar; pressing a covered box brings it to the front (2026-11-06) — LIVE on `main` @ `7ef330e` (2026-11-07)
**Live check 7 Nov ~15:38Z (on Travon's "Ship p178"):**
- **Merge:** in a new worktree, `C:\Users\ARNAUTICA\bdoc-s178`, branch `claude/ship-p178`. Another session had switched `bdoc-port` to its own branch, so this merge stayed out of it. `claude/drag-panels` (`686cb33`) was merged on top of `f0b8ab8` as `2696d3c`.
  - Conflicts were only the SW line and this file. `bdoc-v180` is the live line, with `(prev)` lines for v179 (p177) and v178 (p176).
  - `7ef330e`: version tests for p177 / p178 now also accept their SW line as a `(prev)` line, so the next ship doesn't break them.
- **Before push:** `node --test` 901 pass / 0 fail / 1 skipped, and `ci-validate.sh` passed.
  - Dev server: ww3 12/12. The map info box dragged with the mouse by exactly (-256, +256) and stayed open.
  - A press on the AOI Watch box raised it over the info box (z 62 over 61); a press on the info box raised it back (63). Both stayed under the ticker (80).
- **Deploy:** fast-forward push `f0b8ab8..7ef330e` at 15:36:52Z. Netlify served SW `bdoc-v180` by 15:37:21Z.
- **Live check** (`bdoc-port-tmp/checks/p178_live.sh`): 10/10.
  - Versions: SW v180 with `(prev)` v179 and v178; LazyLoader `p176` = every module `?v=`.
  - `bdoc-float.js?v=p178` is in the page and in the precache; OPEN TAK is still there.
  - `js/bdoc-float.js` and `service-worker.js` are byte-identical to `7ef330e`. `index.html` differs only by Netlify rewrites.

Built in the worktree `C:\Users\ARNAUTICA\bdoc-drag`, from `main` @ `410a388`.

Travon (screenshot: the AOI Watch box sat on top of a Taipei cam pop-up): "I need the boxes to be able to be dragged like the global threat box ... for all boxes and all pop-ups ... other boxes pop up on top of it which don't allow you to see it."
- **Numbering:** p178 / SW `bdoc-v180`. It assumes p176 (`claude/milsym-layer-sidc`, `bdoc-v178`) and p177 (`claude/cot-import`, `bdoc-v179`) ship first.
  - All three branches start from `410a388` and change the SW line and precache list; whichever ships later keeps its own number and adds `(prev)` lines for the others.
  - If this ships before them, renumber whichever ships after it to the next free number.
- **New `js/bdoc-float.js` (`window.BDOCFloat`), loaded last on the page:**
  - *Drag:* press the top 36 px (title bar) of any floating box and move 4 px.
    - Buttons, links, inputs, selects, tabs and iframes in the title bar still click. A plain click stays a click, and the click after a drag is swallowed so title-bar toggles don't fire.
    - The box can't go under the top bar, and at least 80 px of it stays on screen.
    - Mouse and pen only, at 768 px and wider. On touch and phone widths the panels keep their own layouts: the threat box made the same call in P111 / P113 because touch dragging fought the globe.
    - Going below 768 px puts dragged boxes back on their phone layouts. A dragged box stays put until reload. `BDOCFloat.reset()` puts everything back.
  - *Front:* pressing anywhere on a box that another box overlaps raises it just above that box, within its layer.
    - Data panels (z < 80) stop at 79, under the tickers (80, 95) and the top bar (100), so a raised panel never covers menus or modals.
    - z 80-99 stops at 99. Boxes above the top bar (camera viewer, LIVE WIRE, dialogs) order among themselves.
    - Raising only goes up. When a layer fills, its raised boxes are renumbered as low as their order allows.
  - *What counts as a box:* every visible `position:fixed` child of `<body>` (all 73 fixed elements are).
    - Not boxes: the top bar, the left / right / SIT panels, tickers, HUD overlays, the nav widget, the globe, and full-screen overlays / modal backdrops.
    - Boxes that drag themselves keep their own code and are only raised: threat box, Battle Tracker, COA, Cam Wall, Signals, time-zone bar, coordinates.
  - *The map's info box* (the pop-up when you click something on the globe) was the real reason boxes "covered" it.
    - Cesium puts it inside `#cesiumContainer`, which is its own stacking layer at z-index 1, so every BDOC panel (z 50+) drew over it whatever its z.
    - It is now moved to `<body>` once at startup, as `position:fixed`, z 61: above the data panels (56-60), under the tickers.
    - Pressing the box or its description raises it. Opening it from the map raises it over a panel it lands under.
    - The move reloads its iframe once. BDOC already does that at startup (`cesium-init.js` sandbox fix), and Cesium's load handler redraws the current description.
    - BDOC's info-box CSS is unscoped, so it still applies. A test fails if someone later scopes it under the globe.
  - *Cost:* nothing runs until a press lands on a box. A press on the globe is one `closest()` call. The grab cursor is one check per animation frame while the mouse moves. No MutationObserver, no timers after startup.
- **Versions:** SW `bdoc-v180`, with the `(prev)` line for v177 kept. `bdoc-float.js` is at `?v=p178` in `index.html` and the SW precache. LazyLoader is unchanged at `p175`: no `js/modules` file changed.
- **Tests:** `tests/float-panels-p178.test.js` (12) covers:
  - layers and ceilings, when a box is raised, renumbering;
  - keeping the title bar on screen, the 36 px strip;
  - the exclude / own-drag / clickable lists, with every id and class checked to still exist in the code;
  - mouse-only drag, the swallowed click, no `stopPropagation`, no HTML building;
  - the info-box move, with no CSS scoped through the globe;
  - wiring and versions.
- **Checked:** 877/877 unit tests; `scripts/ci-validate.sh` green (126 JS files, 9 inline scripts). In the dev server (port 8896; Claude's window was minimized, so most checks read the DOM after real mouse input):
  - Pressing AOI Watch, which sat under the open info box, Signals and Cam Wall, raised it to 62, on top at the covered spot.
  - Dragging its title bar moved it exactly (884,110 → 484,290). No text was selected.
  - Dragging it up stopped at y 56, under the top bar.
  - The info box dragged by its title (810,60 → 460,480) and stayed open with its cam card. Its × still closes it.
  - Cam Wall still dragged with its own code and was only raised.
  - 40 alternating raises of three overlapping panels peaked at z 79. The last pressed was on top.
  - Shrinking to 700 px put a dragged AOI Watch back on its phone layout.
  - No JS errors.
- **Not done:**
  - No drag on touch screens (iPad / phone).
  - Positions are not kept across reloads; Cam Wall and Signals keep theirs as before.
  - The docked side panels (INTEL / AI) don't move.
  - Cross-origin iframes (YouTube tiles) can't raise their box when clicked inside the video; the title bar can.

### Claude Code — p176 + p177 shipped together (2026-11-07) — LIVE on `main` @ `8710c62`
**On Travon's "Ship both".** Merged in `C:\Users\ARNAUTICA\bdoc-port`, branch `claude/ship-p176-p177`: p176 (`79e0825`) fast-forward, then p177 (`0d18a34` + `b957aea`) as merge `321544c`.
- **Merge:** conflicts only in `service-worker.js` (v179 live, v178 kept as `(prev)`) and `HANDOFF.md` (both entries kept).
- **Fixed before shipping (`8710c62`):** re-importing BDOC's own TAK export added range-ring / bullseye centres as unknown units. Those entities sit both on their own and inside a drawing group. `cotEvents` now writes each uid once (it wrote some twice; that dated from p175's uid change, and ATAK simply keeps one). `_cotFind` now searches group members too. Test: `tests/cot-roundtrip-groups-p177.test.js`.
- **Checked before push:** 889/889 tests (1 skip: the node milsymbol sweep needs a local copy of milsymbol, which is not run here; checked in the browser instead). CI green. ww3 12/12. In the dev server: a TAK file of units, a marker, a bad type and a remarks SIDC places 3 units + 1 marker and keeps HQ + higher unit. Opening it again updates 4 with no copies. A DOCTYPE / entity file is refused, with its name escaped in the toast. The BDOC → TAK → BDOC round trip adds 0 new items with 0 duplicate uids. Undo works. milsymbol accepts `SHGPUCM` / `SFPP` and rejects the old `UWS`.
- **Deploy:** fast-forward push `410a388..8710c62` at 15:20:06Z. Netlify served SW `bdoc-v179` by 15:20:40Z.
- **Live check (`bdoc-port-tmp/checks/p177_live.sh`, 11/11):** SW v179 with the v178 `(prev)` line; LazyLoader `p176` = every module `?v=`; OPEN TAK and `bdoc-cot-import.js` in the page and precached. Every changed served file matches `8710c62` (`index.html` apart from Netlify's pretty URLs + analytics snippet).
  - In the live app (Chrome, read-only, nothing placed): `BDOCCot.parse` turns a TAK file into units / a marker with the HQ kept, and refuses a DOCTYPE file. Both p176 codes are valid. `bdoc-v179` caches are active. No console errors on a fresh load.
- **p178 (`claude/drag-panels`, `686cb33`, draggable panels) is NOT live.** Its session ran out of usage before pushing. It was cut from `410a388`, so before it ships it must merge `main` and resolve the SW / version lines (its `bdoc-v180` is still above v179).
- **Seen, not fixed (older code):** the undo / delete toasts put `meta.label` into `af()` (innerHTML) without `esc()`. TAK labels are cleaned, but labels from a shared `.bdoc.json` plan file are not.

### Claude Code — p177 CoT import (TAK → BDOC): 📂 OPEN TAK puts ATAK / WinTAK / iTAK files on the Battle Tracker (2026-11-06) — LIVE on `main` @ `8710c62` (see the ship entry above)
Built in the worktree `C:\Users\ARNAUTICA\bdoc-cot`, from `main` @ `410a388`.
- **Numbering:** this is p177 / SW `bdoc-v179`, not p176. Branch `claude/milsym-layer-sidc` (`79e0825`, military layers draw only valid codes) already took p176 / `bdoc-v178` from the same base. Two builds with one `SW_VERSION` would leave the second one's devices on the old cache.
  - If the sidc branch ships first, this one merges on top. A trial `git merge-tree` conflicts only in `service-worker.js` and `HANDOFF.md`; `index.html` and `tests/battle-symbols-p175.test.js` merge cleanly.
    - In the SW, keep `bdoc-v179` as the one live line, add `(prev)` lines for v178 and v177, and keep both branches' precache entries.
    - In HANDOFF, keep both entries.
    - Then run `tests/cot-import-p177.test.js`. It checks for one live SW line and that LazyLoader equals the module `?v=`.
  - If this one ships first, renumber the sidc branch to p178 / `bdoc-v180`.
- **What it does:** the Battle Tracker toolbar has **📂 OPEN TAK** next to ⬇ TAK. It opens a `.cot` / `.xml` file holding one `<event>` or an `<events>` list.
  - *Units:* each `a-…` event becomes a unit drawn as its 2525C symbol.
    - The code is the `SIDC …` line BDOC writes into remarks, when it is usable and its CoT type matches the event's. So BDOC → TAK → BDOC keeps HQ, size and status. Otherwise the code comes from `BDOCSym.sidcFromCot(type)`.
    - A code that matches a library entry becomes that entry. Any other code is kept as a custom code on the nearest library type.
    - The callsign becomes the designation. It is left blank when it is only the auto label ("Hostile Armor / Tank"). Remarks become the note. The higher unit comes from BDOC's remarks line.
  - *Markers:* map points `b-m-p-*`, CASEVAC `b-r-f-h-c` and alerts `b-a-o-*` (not the cancel) become tactical markers. Each is a diamond with a fixed glyph and colour, and its popup shows the TAK type. An `a-` type with no usable code also becomes a marker.
  - *Skipped, with a count in the toast:*
    - drawings `u-d-*` and routes `b-m-r`;
    - chat, tasking and other non-map messages;
    - a position that is not a finite in-range number, or is 0,0;
    - an unreadable type;
    - repeats of one uid in a file (the newest `time` wins);
    - anything past 2000 events.
  - *Same uid again:* updates that unit or marker in place: position, note and label.
    - The symbol is redrawn only if the TAK type changed, so strength, status and library type survive a move in TAK.
    - `BDOC-<entity id>` uids from BDOC's own export find the original entity.
    - A uid already on the map as the other kind (unit vs marker) is left alone and counted.
  - *Undo:* every new item and every update is its own undo step, named after the item.
  - *Back out:* the TAK uid (`meta.cotUid`) and a marker's TAK type (`meta.cotType`) go back out unchanged in ⬇ TAK, so ATAK updates its item instead of adding a copy. Plan files keep both; `sanitizeSpec` drops bad values.
  - *Offline:* without milsymbol, OPEN TAK waits up to 6 s. Then it places simple icons and keeps the exact code in `customSidc`, and `_bpSymReady` redraws those units with it when the symbols arrive.
- **The file is untrusted:**
  - Parsed with DOMParser only. A DOCTYPE or ENTITY is refused before parsing, so entities are never expanded.
  - Limits: 8 MB and 2000 events. Numbers must match a strict decimal pattern.
  - Text loses control, bidi and line-separator characters. The callsign goes through `BDOCSym.cleanText`, and labels also lose `< > & " ' \``. Every toast and popup string goes through `esc()`.
  - The uid (at most 128 characters) is used only for matching and in the export (`xmlEsc`). Codes must pass `isUsableSIDC`, and lookups are own-property only.
- **Files:**
  - new `js/bdoc-cot-import.js` (`window.BDOCCot`: pure parser and mapper, no DOM writes);
  - `index.html`: the button. `_bpAddUnit` is split out of `placeBattleUnit`. `_bpSymReady` also redraws exact-code units. The p177 block holds `importBattleCoT`, `_cotImportText`, `_cotFind`, `_cotUpdate` and the marker helpers;
  - `js/bdoc-plan.js`: the TAK uid / type round trip and the `sanitizeSpec` checks;
  - `service-worker.js`.
- **Versions:** SW `bdoc-v179`, with the `(prev)` line for v177 kept. `bdoc-plan.js` and `bdoc-cot-import.js` are at `?v=p177` in `index.html` and in the SW precache. LazyLoader is unchanged at `p175`: no `js/modules` file changed.
- **Tests:** `tests/cot-import-p177.test.js` (16) uses `tests/helpers/xml-dom.js`, a strict test-only XML DOM, because node has no DOMParser. The tests cover:
  - ATAK single events and lists; number formats;
  - the DTD refusal (the parser is never called); broken, empty, huge and non-XML files;
  - text cleaning, prototype uids, the 2000 cap, duplicates and remarks-SIDC precedence;
  - every library key × 7 sides round trip, and custom codes;
  - a real `bdoc-plan.js` `cotEvents` round trip in a vm;
  - bad uid / type in plan files, the page wiring, `_cotFind`;
  - versions: the LazyLoader rule, not a pinned build.

  The p175 tests are updated for the new export lines.
- **Checked:** 881/881 unit tests; `scripts/ci-validate.sh` green (126 JS files, 9 inline scripts). In the dev server (port 8897, real DOMParser and milsymbol; the page's tier was set to enterprise because localhost is not signed in):
  - *ATAK list:* 3 units and 3 markers, with the skips counted.
  - *Re-import:* moved, renamed and retyped items in place with the count unchanged. Three undos restored each item.
  - *Round trip:* opening a ⬇ TAK export changed nothing. Into an empty map it rebuilt `SFGPUCI---AF---` (HQ battalion, higher 1 BCT) and `SHGAUCF----E---` (planned company) exactly.
  - *Hostile files:* the billion-laughs and external-entity DOCTYPEs were refused, as were broken XML, JSON and a 9 MB file. 2005 events were capped at 2000. Script / img in the callsign, remarks, uid and detail never reached the DOM (0 alerts), and the uid was escaped in the export.
  - *Offline:* simple icons with the exact code, redrawn when milsymbol loaded.
  - No JS errors.
- **Not done:**
  - Shapes (`u-d-*`) and routes are not imported. ATAK data packages (`.zip`) are not opened. Only one file per open.
  - Strength (2525C field F) has no place in CoT, so a new unit from TAK has none. It does survive a TAK move of an existing unit.
  - `stale` / `how` are ignored, so a stale event is still placed.
- **Seen, not touched (older code):**
  - The undo / delete toasts (`↶ Undone: …`, `Deleted: …`) put `meta.label` or the entity's label into `af()`, which is innerHTML, without `esc()`. A crafted plan file's label may reach it; not checked end to end.
  - `tests/tier-labels-p172.test.js` fails on a CRLF checkout (its regex expects `\n}\nfunction hideMo`).

### Claude Code — p176 military map layers: every 2525C code is valid (2026-11-06) — LIVE on `main` @ `8710c62` (shipped with p177, see above)
Follow-up from p175: `getSIDC()` in `js/modules/layers-military.js` builds the MIL-STD-2525C code for every base (Military Bases layer) and airfield (Military Airfields layer).
- **All codes enumerated:** the 269 bases and 34 airfields, plus every branch name the function knows × allied / hostile / other country × base / airfield / naval. That gives 21 distinct codes, each run through milsymbol 2.2.0 `isValid()` and `BDOCSym.isSIDC()`. Two branches were wrong (6 codes, one per side):
  - **PLA Rocket Force** (4 bases: Wenchang, Jiuquan, Xichang, Taiyuan) got `S?GPUWS---`. `UWS---` is not a 2525C function ID: milsymbol marked it invalid and drew its red "unknown icon" hook in the frame. Now `S?GPUCM---`, the 2525C surface-to-surface missile unit. `BDOCSym.CATALOG` has no missile entry; its nearest, `UCFRM-`, is a multiple rocket launcher and would mislabel a strategic missile force.
  - **Space Force** (8 bases, e.g. Vandenberg SFB, Thule AB) got `S?PT------`. Position 4 is the status, and T is not a 2525C status, so `BDOCSym.isSIDC` refused the code (milsymbol drew it only because it ignores position 4). Now `S?PP------`: same space-track drawing, valid code.
  - The other 15 codes were already valid and are unchanged.
- **Test `tests/layers-military-sidc-p176.test.js` (7):** runs `getSIDC` straight from the module source over all of the above. Every code must be 15 characters and pass `BDOCSym.isSIDC`, and its dimension + function ID must be on a list checked with milsymbol 2.2.0. With `MILSYMBOL_JS=path/to/milsymbol.js` it also calls the real `isValid()` on every code; it skips without it. Run against `origin/main`'s file with `MILSYMBOL_JS` set, 4 of the 7 fail (Thule AB and Wenchang named). The p175 version test now accepts p175 or later.
- **Versions:** SW `bdoc-v178`; LazyLoader and every precached module `p176`.
- **Checked:** 872/872 unit tests, including the real-milsymbol sweep. `scripts/ci-validate.sh` green. Dev server (port 8898, worktree `C:\Users\ARNAUTICA\bdoc-sidc`): modules served at `?v=p176` and milsymbol 2.2.0 from jsDelivr. All 17 codes the layers draw are valid in the page, and Xichang shows the hostile missile symbol on the globe.
- **Found, not fixed (outside this change):**
  - *Cold start:* the Military Bases toggle draws as soon as `milsymbol-loader.js` has run, before milsymbol itself arrives. In a fresh session all 269 bases came up hand-drawn and stayed that way (nothing redraws once `ms` loads). So the 2525C symbols appear only if milsymbol was already loaded, e.g. after the Battle Tracker. The Military Airfields toggle does not load `milsymbol-loader` at all. Fix: wait for `BDOC.loadMilsymbol()` (it has a timeout) before `loadMilBases()` / `loadMilAirfields()`.
  - *Array hole:* `MILBASES` has an empty slot at index 230 (`},,` after Lumut Naval Base, `layers-military.js:272`). `upgradeUSBranchIcons()` pairs `milbaseEnts[i]` with `MILBASES[i]`, so each of the last 39 billboards (MCMWTC Bridgeport onward) gets the insignia worked out from the record before it.
  - *Semantics:* airfields use `S?APMFA---` (an attack aircraft, not an airfield). Army / DOD / NATO / default bases use `IBA---` (airport / air base, not `IB----` base). No installation carries the `H` at position 11 that 2525C and `BDOCSym.buildSIDC` use, so they draw as plain ground frames. All of these are valid codes, so they were left as they are.
- **Release note:** the TAK CoT import session (`claude/cot-import`) may also claim p176 / `bdoc-v178`. Whichever ships second rebases and takes the next number.

### Claude Code — p175 Battle Tracker units are real MIL-STD-2525C / APP-6 symbols (2026-11-06) — LIVE on `main` @ `542008e`
**Live check 6 Nov ~14:40Z (on Travon's "Yes, ship it"):**
- **Deploy:** fast-forward push `eb9a3bc..542008e` at 14:34:32Z. Netlify served SW `bdoc-v177` by 14:35:14Z.
- **Live files (`p175_live.sh`, 21/23 pass):** the page has LazyLoader `p175` and loads `bdoc-atak.js` / `bdoc-plan.js` / `bdoc-p154.css` at `?v=p175`. The SW precaches every p175 file and carries milsymbol across deploys. The served `service-worker.js`, `battle-symbols.js`, `milsymbol-loader.js`, `bdoc-atak.js`, `bdoc-plan.js` and `bdoc-p154.css` are byte-identical to the commit (line endings aside).
  - The 2 "fails" are `index.html` and `sources.html`. They differ only by Netlify post-processing: pretty URLs (`/privacy.html` → `/privacy`) and the injected Simple Analytics snippet.
  - The milsymbol 2.2.0 jsDelivr URL returns 200 with CORS `*`.
- **In the live app (Chrome, read-only, no units placed):** the `bdoc-v177` SW is active with its caches. The symbol module loads. `ensure()` gets milsymbol, which lands in `bdoc-v177-cdn` for offline use. Sample codes render valid: HQ company, fighter, tracked tank, sub, emergency-management `EFIPA`, stability-ops `OHVPA`. The joker code is refused with its reason. CoT types match. No console errors on a fresh load.

Travon picked "Military symbols first" from the Battle Tracker ideas. Before this, the UNIT tool drew hand-made look-alikes: no planned or damaged status, no HQ / task force / dummy, and every size mark one step off (a brigade showed XX, which is a division).
- **New module `js/modules/battle-symbols.js` (`window.BDOCSym`):** builds a 15-character 2525C SIDC from side (7 identities, including assumed friend, suspect and pending), status (present, planned, fully capable, damaged, destroyed, full), size (team to army group), HQ / task force / dummy and a custom base code. It draws the code with milsymbol 2.2.0 (MIT), which the military layers already load.
  - 59 of the 83 library entries map to a 2525C function ID, each checked with milsymbol's `isValid()`. The other 24 (infrastructure and status markers) keep their hand-drawn icons, and their tooltip says they are map markers, not standard symbols.
  - The SVG is padded so the symbol's anchor (frame centre, or the foot of an HQ staff) is the billboard centre. `render()` also returns how far the drawing reaches below the anchor, so the name label sits just under the symbol.
  - Unit text (designation, higher unit) keeps to `A-Z 0-9 . , : ; / ( ) # + - * _`, at most 21 characters, before it reaches the SVG.
- **Panel (`index.html`, `#bp-sym`):** preview, SIDE, STATUS, SIZE, STRENGTH, DESIGNATION, HIGHER UNIT, HQ / TASK FORCE / DUMMY, CUSTOM SIDC, and a readout of the SIDC and TAK type. Pasting a code sets the controls to match it. A bad code turns the box red and the UNIT tool refuses to place. The collapsed panel keeps the symbol row while the UNIT tool is active (CUSTOM SIDC hidden there).
  - Standard symbols always use the standard side colours; the colour swatches now say they are for shapes, lines and notes.
  - The fallback `ECHELON_MARKS` are corrected (brigade X, division XX, corps XXX …).
- **Edit Unit Symbol:** right-click a unit → `✪ Edit Unit Symbol` (Recolor is hidden for units). The dialog has every field above plus TYPE; SAVE goes on the undo stack and keeps the popup's PLACED time. `buildEntityPopup()` gained an optional `placed`.
- **Stored per unit (flat, so OPEN FILE keeps it):** `sidc, customSidc, iconKey, aff, cond, ech, strength, hq, tf, feint, designation, higher`. Echelon and HQ are recorded from the drawn code, so a fighter never claims a company size.
- **TAK / exports (`js/bdoc-plan.js`):** a unit with a SIDC goes out as its exact CoT type (`a-h-A-M-F-F` hostile fighter, `a-f-G-U-C-I` friendly infantry …), with the SIDC and higher unit in remarks, 24 h stale. The CoT uid now comes from the entity id, so re-exporting updates markers in ATAK instead of duplicating them. `pickCoT` reads the SIDC first, then `meta.aff`. "attack" now means hostile only for a tactical marker (it was turning a friendly Attack Helicopter hostile). GeoJSON carries `sidc, cot_type, unit_type, affiliation, status, echelon, strength, designation, higher_formation, headquarters, task_force, feint_dummy`.
- **OPEN FILE:** `sanitizeSpec` drops a SIDC that is not a real 2525C code and cleans unit text. `importDoc` fires `bdoc:plan-imported`, and imported units are redrawn from their SIDC, so a file's picture cannot disagree with its code. If the library is offline, the file's own picture stays.
- **Offline:** without milsymbol the UNIT tool uses the old hand-drawn icons and says so in the panel and the popup; their TAK type comes from `meta.aff`. `milsymbol-loader.js` is now `BDOC.loadMilsymbol()`: it handles its own failure (no red background-error toast), removes the failed script, and a later call retries. The service worker copies the pinned `milsymbol@2.2.0` response from the old `-cdn` cache into the new one on activate, so a laptop that goes offline after a deploy keeps the symbols it already had.
- **Review fixes (multi-agent review, each finding checked by 2 skeptics; 19 of 21 confirmed, all fixed):**
  - *Codes:* a pasted code whose side the SIDE picker cannot show (exercise, joker, faker, none) is refused with the reason (`isUsableSIDC`, `sidcProblem`) instead of quietly turning UNKNOWN. Stability-operations (O) and emergency-management (E) codes are now accepted: position 3 is checked per scheme, in both `battle-symbols.js` and `bdoc-plan.js`. A pasted code keeps what no control can show: mobility / towed array, a dummy installation (HB), region / command size, and positions 11-12 of air, sea and O / E symbols.
  - *Strength:* drawn only on units, written `(+)` / `(-)` / `(±)` as 2525C does. Aircraft, ships and vehicles no longer store or export it.
  - *Imported files:* a unit that carries only a SIDC keeps its HQ / task force / dummy (they were dropped on redraw). All symbol tables have no prototype, and `_bpOwn` guards every lookup, so `__proto__` / `constructor` in a file reach nothing. `sanitizeSpec` keeps only the panel's own side / status / size / strength values, boolean flags and a plain `iconKey`.
  - *TAK:* `xmlEsc` (`bdoc-atak.js`) drops control characters XML forbids, so one bad note can no longer make a whole `.cot.xml` unreadable. Without the module, `pickCoT` and `sidcCoT` use the same rule as `BDOCSym.cotType` (exercise sides, unknown dimension X). A unit with only `customSidc` still exports its type.
  - *Editor and undo:* map markers (bridge, objective, LZ …) keep their own type in the editor (MAP MARKERS group) instead of turning into Infantry, and their popup says "Map marker", not "standard symbols unavailable". The Unit edit undo step names the unit, so CLEAR / delete retires it. Undoing an edit keeps a note written after it and the PLACED time. EDIT NOTE keeps PLACED too. Destroyers placed before p175 are still found by their old label.
  - *Offline:* a CUSTOM SIDC is refused while the symbol set is missing (it used to be placed as the library icon with the wrong TAK type). After a failed load, BDOC retries when the connection returns, notices a late copy, and redraws simple-icon units with their standard symbol. Placing a unit retries in the background at most every 30 s, and the offline toast shows once. Picking a library symbol clears a hidden pasted code. The offline grid draws suspect / pending with the hostile / unknown frame, matching the map.
- **Versions:** SW `bdoc-v177`; LazyLoader and every precached module `p175`; `battle-symbols.js` and `milsymbol-loader.js` precached; `bdoc-p154.css`, `bdoc-plan.js` and `bdoc-atak.js` at `?v=p175`. `sources.html` credits milsymbol. Tests: `tests/battle-symbols-p175.test.js` (22) and `tests/battle-symbols-p175-review.test.js` (11). The p174 version test no longer pins the current SW line.
- **Checked:** 865/865 unit tests, `scripts/ci-validate.sh` green (125 JS files, 9 inline scripts), and `tools/qa/ww3.js` 12/12 in the dev server with no JS errors.
  - *Before the review:* 15 units across all 7 sides on the map (frames, size marks, TF bracket, HQ staff, planned dashes, damaged bar, reinforced), paste-to-sync, bad-code refusal, edit + undo, GeoJSON and CoT types, a tampered plan file redrawn to match its code, the offline fallback, autosave restore of 23 units, and the dialog at phone width.
  - *After the fixes (dev server):* joker code refused with its reason; EMS code `EFIPA----------` placed and drawn; tracked tank `SHGPEVAT--MQ---` keeps its mobility; `(+)` on infantry and none on a fighter; bridge edits as a map marker; edit → note → undo keeps the note and PLACED; deleting a unit retires its edit step; offline custom code refused; a simple-icon unit upgraded to `SFGPUCIZ-------` when milsymbol arrived; CoT XML well-formed with a control character in a note.
- **Not done:** CoT import (TAK → BDOC) — `BDOCSym.sidcFromCot()` is ready for it. `layers-military.js` `getSIDC` still emits some codes milsymbol marks invalid (fixed in p176, see above). The ENEMY tactical marker is not a 2525 unit.

### Claude Code — p174 SIT cards expand on double-click; live OSINT cards fixed (2026-11-06) — LIVE on `main` @ `9092a81`
**Live check 6 Nov ~04:05Z (p172 + p173 + p174 together, on Travon's "Ship all three"):**
- **Deploy:** fast-forward push `e34acf8..9092a81` at ~04:00:20Z. Netlify served SW `bdoc-v176` by 04:00:39Z, with the page at LazyLoader `p173`, `bdoc.css` / `bdoc-p154.css` at `?v=p173` and `auth.js` at `?v=p172`.
- **Live files:** `auth.js` has `firedanger` in the Operator list, `layers-air.js?v=p173` has the new rotorcraft codes, and the red Undo and info-box rules are in the live CSS. proxy-gdelt returned 200 with 75 features carrying `name` / `domain` / `place` / `seendate` / `url`.
- **Live page in Chrome (1920×945):** service worker in control with only the `bdoc-v176` caches; `BDOC_Auth.TIERS.operator` includes `firedanger`, and `minTier('camwall')` is `analyst`. Undo is `rgb(180,43,40)` at left 262px, top 102px. The SIT tab shows 5 briefs and 15 feed cards, each with headline then "place · source · age", and no repeated headline.
- **Expand test:** a real double-click on a feed card opened `#sitExpand` at left 260px, 640px wide, with a 21px title and the ✕, OPEN ARTICLE and SHOW ON MAP buttons. Double-clicking the panel closed it.
- **Errors:** 0 console errors, including across a reload.
- **Not checked live:** a W-3 in the air (no live helicopter to point at) and the info box beside the parked compass. Both are covered by tests and were checked in the dev server.

Travon: double-click a situation card and it "shoots off to the side of the bar and gets really big"; double-click again and it goes back. All of it is inside `SituationManager` in `index.html`.
- **Expanded view:** double-clicking any card in the SIT tab (analyst brief or live GDELT item) grows it out of the card (a FLIP transform) into `#sitExpand`, beside the INTEL panel (`left: var(--lw)+12px`, up to 640px, z 130). Title 21px, body 14px, plus place, source, age and UTC time.
  - Briefs show Details, Intelligence and Possible Activity.
  - Feed items get OPEN ARTICLE (`safeUrl`, `noopener`) and SHOW ON MAP buttons. Items pinned only to the source country say so.
  - Double-click the panel, double-click the card again, press Esc or ✕ to shrink it back. Closing the panel, switching tabs, opening a detail or going back shrinks it too.
- **Single click still opens a brief's detail,** delayed 260 ms so a double-click cancels it (no detail flash).
- **Live feed fix:** the cards read an `<a href>` out of `properties.html`, which proxy-gdelt no longer sends, so every card showed its headline twice in grey and had no link. They now use the proxy's fields (`name`, `place`/`country`, `domain`, `url`, `seendate`): headline, then place, source and age.
- CSS is injected once by JS (`#sitExpandCss`), so no stylesheet version bump. SW `bdoc-v176`. `tests/sit-expand-p174.test.js` (6 tests).

### Claude Code — p173 Helicopters drawn as jets; info box under the compass; Undo button over the panel (2026-11-06) — LIVE on `main` @ `9092a81` (shipped with p174)
Three fixes from Travon's screenshots.
- **Helicopter shown as a jet:** KR07, a PZL W-3 Sokol (type `W3`), drew as a jet with "NARROW-BODY JET" on its card. `js/modules/layers-air.js`:
  - Added 8 codes to the rotorcraft list (`W3 B105 FREL S55 S58 H2 KA25 WG30`).
  - The description fallback now also matches PZL-Świdnik / Sokol / W-3, MBB, Bo 105, BK 117, Alouette, Dauphin, Gazelle, Super Puma, Ecureuil, Kaman, Guimbal / Cabri, Dhruv, NH90, Westland and "Aerospatiale SA/AS-3xx".
  - Fixed `LEONARDO AW\b`, which never matched "LEONARDO AW169".
  - Left out on purpose: plain "PZL", because PZL-Mielec builds planes (M28, Wilga), and `SW4`, which clashes with the Swearingen Merlin.
- **Info box under the compass:** with the AI panel collapsed or closed, the compass parks top-right (`#nav-widget.nw-parked`, scale 0.62, 0.9 on hover) right over the Cesium info box's close button, so it could not be closed. `css/bdoc.css` now moves the box left of the parked compass: `right:150px` when collapsed, `108px` when closed (`body:has(...)`). That leaves a 12px gap from the hovered compass, measured in the dev server; the close button is the top element in all three panel states.
- **Undo over the panel:** the button sat at the bottom-left of the map, where the Fire Danger and Cam Wall panels open. With the KITSUNE / INTEL panel (`#sitPanel`) open, the old `.lp` stays `.shut` underneath, so `body:has(.lp.shut)` moved the button to `left:18px`, on top of the MAP STYLE buttons. `css/bdoc-p154.css` now:
  - puts it under the coordinate bar (`left: var(--lw)+14px; top: var(--tbh)+46px`), where nothing else sits;
  - makes it red like BATTLE TRACKER (`#B42B28`, `#DA3633` on hover);
  - on phones (≤767px) puts it bottom-left at `12px`, because `--lw` stays 248px there and pushed it off the right edge.
- SW `bdoc-v175`; LazyLoader and all module entries `p173`; `bdoc.css` and `bdoc-p154.css` at `?v=p173`. `tests/air-heli-ui-p173.test.js` (7 tests); the p172 version test no longer pins numbers that later bumps move.

### Claude Code — p172 Fire danger forecast opens to Operator; locked layers name the plan that unlocks them (2026-11-05) — LIVE on `main` @ `9092a81` (shipped with p174)
Travon's tier call ("Fire danger to Operator"): `firedanger` joins the Operator list in `js/auth.js`, for county emergency managers. Signals, Cam Wall, AOI Watch, EU warnings and CEMS stay Analyst.
- **Fixed on the way:** every locked-layer surface said "Operator $9.99/mo", so the Analyst-only layers (all five above) told Recon users to buy a plan that still left them locked. The hover badge, command palette, preset message, onboarding tour and upgrade screen now name the right plan.
- **How:** the tier table moved to `BDOC_Auth.TIERS`; `canAccess()` reads it, and the new `BDOC_Auth.minTier(feature)` returns the lowest plan that unlocks a feature. `markLockedLayers()` writes it to `data-tier` on each locked toggle. CSS `.ly.locked[data-tier="analyst"]:hover::after` and the palette read that. `showMo()` falls back to `minTier()` after its own `LAYER_TIER` list and names unnamed layers from their toggle. Replay and PDF now pass their name to `showMo()`, so the Analyst card is highlighted.
- **Left alone (Travon's pricing call):** `LAYER_TIER` in `showMo()` says IMINT is Analyst (as the pricing card does), but the Operator list includes `imint`, so Operator users already have it.
- SW `bdoc-v174`; `auth.js` and `bdoc.css` at `?v=p172` in the page and the precache. No module changes, so LazyLoader stays `p171`. `tests/tier-labels-p172.test.js` (6 tests).

### Claude Code — p171 European open data: Meteoalarm warnings, Copernicus EMS activations, GWIS fire danger forecast (2026-11-05) — LIVE on `main` @ `38065da`
**Live check 5 Nov ~20:48Z (p169 + p170 + p171 together, on Travon's "Ship all three"):** fast-forward push `dade4c6..38065da` at 20:46:55Z; Netlify served SW `bdoc-v173` and LazyLoader `p171` by 20:47:39Z. Production functions: proxy-eu warnings 558 warnings, 0 of 39 feeds failed, 5.0 s; proxy-eu cems 42 activations; proxy-signals hf / squawk / sdr all 200; proxy-mecams 200. On the live page in Chrome: service worker in control, all five toggles present (euwarn, cems, firedanger, signals, camwall), the eu-feeds, signals and cam-wall modules load (`EUFeeds` warnings/cems/fireDanger, `SignalsWatch`, `CamWall`), fire danger days run Today to Wed 11, warnings read 558 in 17 countries, 0 console errors. Still Travon's call: tiers (all five are analyst+), `WINDY_API_KEY` / `YOUTUBE_API_KEY` in Netlify for Cam Wall, and the Day/Night cycle dimming overlays on the night side.
Travon asked for free European data ("weather, earthquakes... grab as much information as possible"). Three toggles in ENVIRONMENT, one lazy module `js/modules/eu-feeds.js` (`EUFeeds`, `EU_FEEDS_CFG`), one proxy `netlify/functions/proxy-eu.js`. All three are analyst+ by omission from the operator list (Travon to decide; for county EMs the fire danger forecast is an obvious Operator candidate).
- **EU Weather Warnings (Meteoalarm)**, `euwarn`, `source=warnings`. Licence **CC BY 4.0**, stated on feeds.meteoalarm.org itself.
  - Reads all 39 country Atom feeds in parallel (7 s each), cached 10 min. Live: about 5 s, 153 KB.
  - The Atom feeds hold only warnings at yellow or above that are in effect or coming. The JSON API (`/api/v1/warnings/feeds-<country>`) also keeps expired and all-clear items and is far bigger (Israel 5 MB, ~10 s), too slow for the 10 s function limit.
  - Parsing keeps yellow/orange/red and drops cancelled, expired and second-language copies. Outlines are cut to ~80 points.
  - Only some services send outlines (Ukraine, Israel, Norway, Estonia, Sweden, Slovenia, Switzerland, UK). Germany, France, Spain, Poland and Italy send region codes only, so every country with warnings also gets a badge (`DE 254`) whose popup lists them all with links to meteoalarm.org.
  - A country whose feed fails is named in the summary line; it is never counted as calm. All 39 failing → 502.
- **Copernicus EMS Activations**, `cems`, `source=cems`. "© European Union, Copernicus Emergency Management Service", free with credit.
  - Satellite damage / flood mapping activations worldwide: the last 120 days plus any still open. Public keyless API `rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/`, cached 30 min.
  - **CEMS times have no zone and are UTC** (checked against the activation page, "16:03 (UTC)"); the proxy appends Z, otherwise a non-UTC server would shift them.
  - Popup links to `mapping.emergency.copernicus.eu/activations/<EMSR code>/`, the canonical page (the rapidmapping host redirects there).
- **Fire Danger Forecast (GWIS)**, `firedanger`. **CC BY 4.0** (GWIS and EFFIS data-licence pages).
  - Worldwide Fire Weather Index from ECMWF forecasts, WMS `maps.effis.emergency.copernicus.eu/gwis`, layer `ecmwf.fwi`, `time=YYYY-MM-DD`. CORS is open, so the browser loads it directly with no proxy. `enablePickFeatures:false`, so map clicks never fire GetFeatureInfo.
  - Panel (bottom left, a top sheet on phones) with Today + 6 days and GWIS's own legend image: Low < 11.2 … Very extreme > 70. The colours are not re-drawn by hand.
  - EFFIS's own `mf010.fwi` covers Europe only, hence GWIS.
  - **The globe's Day/Night cycle dims every overlay on the night side** (lighting multiplies imagery: pale green read 51,81,62 lit vs 181,255,255 unlit). The panel says to switch off Day/Night cycle in Settings to read the colours at full strength. The same applies to the existing weather overlays.
- **Rejected:** EURDEP radiation (JRC): data stay under each provider's copyright and need prior written agreement for other uses. EFFIS burnt areas: empty this time of year. EMSC: already in `proxy-watch`. GDACS floods: already a layer.
- `sources.html`: MeteoAlarm, Copernicus EMS and GWIS/EFFIS rows. `electron/server.js` runs `proxy-eu` in-process. Modules `p171`, SW `bdoc-v173`. CSP (report-only) already allows https images and connections.

**Verified:** 813 tests (8 new in `tests/eu-feeds-p171.test.js`), CI script passes. Both proxy sources against the live feeds: 558 warnings in 17 of 39 countries (6 orange: Corsica / Gard rain-flood), 26 with outlines, no country failing; 42 CEMS activations (newest EMSR935, Valencia floods). In Chromium on this branch:
  - all three toggles lazy-load the module at `p171`; 26 outlines + 17 badges, 42 activation pins, fire layer with 7 day buttons;
  - fire map: Europe tiles return 200 with the right layer and date; switching the day re-requests tiles with the new date (129 tiles for +3 d);
  - tile pixels are real classes (Europe 62 % coloured, mostly Low; Australia orange/red), and the overlay changes globe pixels;
  - screenshot with Day/Night off: Low over most of Europe, moderate to high over Iberia, higher over North Africa;
  - popups: Germany badge (254: low temperature 224, fog 30), Gulf of Finland wind outline, EMSR935 with UTC times matching Copernicus's page;
  - hostile warning text injected through `draw()` is escaped and a `javascript:` link becomes `#`;
  - × and the toggles remove imagery, pins, panel and timers, and layers come back on cleanly;
  - 1440 px: panel clear of the left sidebar and threat box. 375 px: full-width sheet, 44 px buttons, no horizontal scroll;
  - legend image loads; proxy-eu calls 200.

**Not verified:** the function on Netlify (39 parallel fetches from Netlify's network), production, a red warning (none were up), the fire map in daylight on a real GPU.

### Claude Code — p170 Signals layer: HF conditions, emergency squawks, public shortwave receivers (2026-11-05) — LIVE on `main` @ `38065da` (shipped with p171)
Travon: "signals intelligence ... that's the one thing we haven't done yet". The SIGINT group's "SOON" placeholder is now a real toggle, **"Signals: squawks, HF, receivers"** (analyst+ by omission from the operator list, like Cam Wall; Travon to decide). Public data only: transponder broadcasts, receivers their owners publish, public-domain NOAA. Nothing decodes or records private communications.
- **Server** `netlify/functions/proxy-signals.js`, three sources:
  - `hf`: NOAA SWPC `noaa-scales.json`. R (radio blackout), S (solar radiation storm), G (geomagnetic storm) now, plus the 3-day probabilities. 10 min cache.
  - `squawk`: aircraft squawking 7500 / 7600 / 7700 anywhere, from adsb.lol `/v2/sqk/<code>`, with adsb.fi as a per-code fallback. Deduped by hex, control characters stripped, 7500 first. 30 s cache. If both sources fail for every code it returns a 502, so a feed outage never reads as "none right now".
  - `sdr`: public KiwiSDR receivers. kiwisdr.com/public is behind a CAPTCHA, so it reads the hourly copy published for map makers at `http://rx.linkfanel.net/kiwisdr_com.js` (a JS assignment). **Parsed with JSON.parse only (trailing commas stripped), never evaluated**; a test feeds it code and checks it is refused. Only active entries with GPS and a plain `http(s)://host[:port]` URL are kept. 6 h cache.
  - Source lookup uses hasOwnProperty, so `constructor` and friends get a 400.
- **Client** `js/modules/signals.js` (`SignalsWatch`, `SIGNALS_CFG`; name-clash test passes). Panel at bottom right: draggable, minimizable, a full-width top sheet on phones. It has three sections:
  - HF conditions, in plain words.
  - Squawks: rows fly to and select the aircraft; the popup links to globe.adsb.lol. Each new aircraft raises an alert-feed line and an EventLog entry, once per aircraft per 2 h.
  - **LISTEN**: six presets (HFGCS 8992 / 11175, The Buzzer 4625, Shannon VOLMET 5505, New York VOLMET 6604, WWV 10000). It opens the receiver nearest the middle of the view that covers the frequency and has a free slot, tuned there (`<url>/?f=8992usb`), in a new tab with `noopener`.
  - About 840 receiver pins; the popup shows antenna, band, users, SNR, OPEN and tune links for every preset in band.
  - Squawks refresh every minute and HF every 10 min, both paused while the tab is hidden. Off removes every pin, timer and the panel.
- **Escaping:** `af()` puts its text into innerHTML unescaped (`rf()` in index.html), so the squawk alert text goes through `esc()` first. A test feeds `<img src=x>` as a callsign. Receiver names and locations come from strangers and are always escaped; links go through `safeUrl`.
- `sources.html`: KiwiSDR / rx.linkfanel.net row added; NOAA, adsb.lol (ODbL noted) and adsb.fi rows now mention Signals. Desktop: `electron/server.js` runs `proxy-signals` in-process next to proxy-watch / proxy-mecams. Modules `p170`, SW `bdoc-v172`.
- **Licensing:** the receiver list carries no stated licence. BDOC shows where receivers are and links to each owner's page; it never relays audio. adsb.lol's live-API licence is still unclear and adsb.fi is on the licensing list (§ p166), same as the Air layer.

**Verified:** 805 tests (11 new in `tests/signals-p170.test.js`), CI script passes. Desktop route called through `createServer()` with a recording stand-in for express (express is not installed on this laptop): hf 200 from NOAA, unknown source 400, registered before the offline catch-all. All three sources against the real upstreams through the local dev server: NOAA R0/S0/G0 with the outlook, one real 7600 (a C172 near Rockford IL, NORDO) that later cleared and was removed on the next refresh, 843 receivers (783 with a free slot, 837 covering 8992 kHz). In Chromium on this branch:
  - the toggle lazy-loads the module at `p170`; the panel draws; 843 pins plus the squawk pin; the alert fired once;
  - a test aircraft injected in the page: row click selects it, the popup has the adsb.lol link, and fly-to lands exactly (frames pumped by hand, hidden pane);
  - LISTEN (`window.open` stubbed) chose the nearest free in-band receiver and built `?f=10000am` with `noopener`;
  - preset and minimize survive a reload; the layer comes back from the shared URL;
  - × turns the layer off and removes all pins and timers;
  - 1440 px: panel 16 px clear of the right sidebar. 375 px: full-width sheet, no horizontal scroll, 44 px buttons;
  - every proxy-signals call returned 200.

**Not verified:** a live 7500 / 7700 (only a 7600 was up), actually listening on a receiver (the tab open was stubbed), the function on Netlify, production.

### Claude Code — p169 Cam Wall: regions, stationary cams only, one live player, anomaly log (2026-11-05) — LIVE on `main` @ `38065da` (shipped with p171)
Travon asked for a region picker, stationary city cameras instead of news channels (copyright), less lag, and a way to log an impact or flash seen on a camera and plot it.
- **Regions** (header dropdown, flies the globe there): Middle East, Ukraine & Russia, Taiwan Strait, Korean Peninsula. Each has its own Windy boxes and curated cams; tile picks are remembered per region.
- **Sources** (`proxy-mecams.js`, rewritten): news channels and open YouTube search are gone. On 5 Nov the "live cam" searches for Kyiv, Tehran, Tel Aviv and Beirut returned mostly aggregator channels restreaming other people's cameras (Intel Cams, TVL Trzcianka, InquizeX, Source Global, MiddleEastLive247): that is the copyright risk, more than an official news embed. Now: `CAMS`, 16 stationary cameras streamed by whoever runs them (Taipei / Taoyuan / Kaohsiung city tourism offices, EarthCam, the Western Wall's own channel, KT GiGAeyes, Seoul skyline-cam channels), each checked through YouTube oEmbed (200 ok, 401 embedding off, 404 gone), cached 1 h; plus Windy per region when `WINDY_API_KEY` is set. With `YOUTUBE_API_KEY` the function finds a camera's current live video by channel + title, so restarted 24/7 streams keep working (one search per channel per 6 h, about 2,000 units/day). **Ukraine and Iran have no operator-run cams** (Ukraine asked owners to switch street cameras off; the St Petersburg cam found has embedding off): Windy is the only clean source there, and the tiles say so.
- **Lag:** only the selected tile plays live; the other tiles show the stream's still frame (`i.ytimg.com/vi/<id>/hqdefault_live.jpg`, refreshed every 5 min) or the Windy preview. LIVE: ALL brings back four players. Click a tile to watch it live.
- **⚠ LOG:** records the UTC time and the selected camera, a kind (Flash, Explosion, Smoke plume, Fire or glow, Other) and a note, then PIN ON GLOBE (crosshair, click the spot, Esc cancels) or AT CAMERA. Draws an orange marker plus a dashed sight line from the camera; the popup has REMOVE; COPY LOG copies the list as text. **Saved on this device only (localStorage), unconfirmed, sent nowhere.** Shared reports and automatic flash detection need a server: YouTube frames cannot be read in the browser (cross-origin), so detection means sampling frames on the droplet. Not built.
- Toggle renamed "Cam Wall: city cams". `sources.html` YouTube row updated. Modules `p169`, SW `bdoc-v171`.

**Verified:** 794 tests (7 new in `tests/camwall-p169.test.js`; the two p168p tests for the removed YouTube search sources were retired), CI script passes. In Chromium on this branch (local server running the v1 handlers): Middle East 3 cams, Taiwan 8, Korea 5, all oEmbed ok; one iframe live and the rest stills (480 px frames load); clicking a still moves the live player; LIVE: ALL gives 4 and back to 1; region change flies to the region (frames pumped by hand, hidden pane); Ukraine shows the no-cams message with the Windy hint; anomaly pinned on the globe and at camera, note escaped in the popup, sight line drawn, REMOVE from the real InfoBox frame, survives layer off/on; layer off removes all entities and stops video; every proxy-mecams call 200; 375 px no horizontal scroll (header wraps to two rows of 44 px touch buttons). **Not verified:** Windy and the YouTube key path against the real APIs (no keys), video playback itself, production.

### Claude Code — p168p stale-copy port: AOI Watch, Cam Wall, Pickaxe + Qeshm, Sanctions cleanup (2026-11-05) — LIVE on `main` @ `060f55e`
**Live check 5 Nov 19:23Z:** Travon OK'd the push; Netlify served SW `bdoc-v170p` about 20 s later. Page `_version` and every SW module entry read `p168p`, both toggles are in the page, the three modules answer 200 and include the Pickaxe + Qeshm markers. `proxy-watch`: unknown source 400, usgs / emsc / meteo / ioda 200 in 0.8–1.8 s. `proxy-mecams` status says no YouTube or Windy key (so the wall runs keyless), yt answers `configured:false`. **`news` (GDELT) returned 502 three times:** the proxy's 6 s timeout fired, and GDELT also answered this laptop 429 after 10 s, so GDELT was slow or limiting at the time. The AOI NEWS / AL JAZEERA rows are still unverified. In Chromium on production, signed out: `LazyLoader._version` is `p168p`, both modules load (`AOIZoneWatch`, `CamWall`) with the P69 `AOIWatch` still an object, and no page errors. The console shows only a report-only frame-src note for the Spotify player (Spotify was never in that list, so this is older than p168p) and two 404s from no p168p file. Not done on production: turning the layers on (they need analyst+).
On 2026-11-02/03 a session worked in the stale OneDrive copy (§0 rule 0), so none of it reached `main`. Travon approved porting four items; behaviour was ported onto current `main`, no stale file was copied over a main file. Audit: side-session notes `stale-copy-audit-2026-11-04.md`.
- **Conflict markers** (`layers-conflict.js`): Pickaxe Mountain (Natanz, watch item) and the 2026-11-02 Qeshm Island US strike. The incident archive ends 2026-10-30, so neither was on the map.
- **AOI Watch: Natanz + Hormuz** (CONFLICTS, analyst+ by omission from the operator list): `js/modules/aoi-watch.js` + `netlify/functions/proxy-watch.js` (EMSC, USGS, Open-Meteo, RIPE Atlas, IODA, Copernicus catalogue, adsb.lol mil, GDELT incl. Al Jazeera domain filter, Polymarket; all keyless) plus existing proxy-firms / proxy-celestrak / proxy-gnews. **The object is `AOIZoneWatch`**: main already has a top-level `const AOIWatch` (P69 NEAR ME home alerts) and the stale name made the script die with "Identifier has already been declared". A test now fails on any top-level name clash between these modules and index.html / other scripts.
- **Cam Wall: Middle East** (CONFLICTS, analyst+): `js/modules/cam-wall.js` + **`netlify/functions/proxy-mecams.js`** (renamed: main's `proxy-cams.js` is the p159g US traffic-cam index, untouched). Optional env `YOUTUBE_API_KEY`, `WINDY_API_KEY`; without them the wall plays keyless 24/7 news-channel embeds. Popup buttons use `data-cw-act` and a listener on the InfoBox frame document, so they work with today's `allow-scripts` sandbox and after §2 N #18 is closed. CSP (report-only) frame-src gained `youtube-nocookie.com` and `webcams.windy.com`.
- **Sanctions / Alliances**: unmatched countries are now removed from the data source instead of hidden. On Cesium 1.104 that hid-but-kept Antarctica crashed rendering; **on 1.146 it does not reproduce** (old logic replayed: 634 forced frames, 0 errors, `OrientedBoundingBox.fromRectangle` on a 360° rectangle is finite). Kept as a cleanup: 271 invisible ground polygons no longer built per toggle.
- **proxy-firms** caps `days` at 5 (FIRMS answers 400 "Invalid day range. Expects [1..5]" above that, checked 5 Nov).
- Desktop: `electron/server.js` runs `proxy-watch` / `proxy-mecams` handlers in-process. `sources.html`: EMSC, RIPE Atlas, IODA, Copernicus, Windy, YouTube rows. Modules `p168p`, SW `bdoc-v170p`.

**Verified:** 789 tests (11 new in `tests/stale-port.test.js`), CI script passes. In Chromium on this branch (local static server running the v1 handlers, `?dev=local`): both markers render with popups; Sanctions keeps all 10 programs (24 shapes), Alliances 49 countries, 537 forced frames with Conflicts + War Room + both on, 0 render errors; AOI Watch 9 of 11 rows live in both zones (thermal, seismic, RIPE 76 / 23 probes, IODA, imagery, sat passes, weather, markets; mil air 0 in theater), tabs, row detail, fly-to Hormuz, FIRMS popup, off removes all 247 entities and timers; P69 `AOIWatch` still intact; Cam Wall keyless fallbacks in 4 tiles, 5 city pins, popup button switches the focused tile, 1-tile layout, off blanks iframes; 375 px no horizontal scroll; desktop routes answer through the real express app. **Not verified:** NEWS and AL JAZEERA rows (GDELT 429 from this laptop, no GNews key locally), real YouTube / Windy APIs (no keys), video playback, production. Known: on a phone, AOI and Cam Wall panels overlap ~115 px when both are open.

### Claude Code — p168b County Brief: a missing feed never reads as all clear (2026-11-05) — LIVE on `main` @ `d5f8da0`
Found on the live check of p168: one Hillsborough call had NOAA gauges time out (over 5.5 s from Netlify; 1–2.4 s from here, and the next three calls were fine), so the level came from six feeds and read NORMAL, "Nothing active in the feeds BDOC checks", where it was really ELEVATED (Alafia River at action stage). Now, when a feed did not answer, the badge says "Nothing active in the feeds that answered", adds "Not checked: river gauges. The level may be higher." (no "may be higher" when already SEVERE), and the SITREP gets a `NOT CHECKED:` line under the overall level. Feed names in words (`SOURCE_NAMES` in `_lib/county-brief.js`, same words in the panel, tested). Module `p168b`, SW `bdoc-v170`.

**Verified:** 778 tests, CI; in Chromium on this branch with the real Hillsborough body and gauges marked failed: badge, footer and printed SITREP as above, 0 page errors.

### Claude Code — p168 County Brief for emergency managers (2026-11-05) — LIVE on `main` @ `a1c08de`
**Live check 5 Nov 16:04Z:** Seminole FL SEVERE in 2.5 s, Norton KS NORMAL, London 404, bad input 400; on the real page the module loads at `p168`, the panel and county line draw, the Tools menu opens over the panel, 0 page errors.
Battle plan Phase 2, for the one government buyer BDOC sells to: county EM coordinators. One click gives everything BDOC knows about one U.S. county, with a one-page SITREP for the morning brief. **No tier gate: free for everyone** (Travon to decide).
- **Where:** Quick Start > "MY COUNTY BRIEF" (location, else the NEAR ME home spot, else pick on the map), map / long-press menu > "County Brief", Tools > County Brief (arms a map pick).
- **Server** `county-brief.mjs` (sync, `?lat=&lon=`, CDN 120 s per spot rounded to 3 decimals): Census TIGERweb finds the county and its line, then in parallel NWS alerts for the county zone (`FLC057`), the NWS forecast at the county centre, NOAA NWPS gauges, NHC storms within 1,500 km, NASA FIRMS 24 h through our own `proxy-firms` (no key in this function), USGS 24 h, and FEMA open shelters. Every feed is cut to the county line (holes and islands count). Each source reports ok / failed; a failed one shows "Not available", never "none". 404 outside the U.S. Rules in `_lib/county-brief.js` (pure, `tests/county-brief.test.js`, 24 tests).
- **Level:** SEVERE = a Severe/Extreme NWS alert, a gauge at moderate flood or worse, a storm within 300 km, an M5+ quake, or 25+ fire detections / 100 MW. ELEVATED = any other alert, action stage or minor flood, a storm within 1,000 km, M3.5+, 3+ detections / 20 MW, or an open shelter. One small fire detection does not raise the level (usually a farm or a flare).
- **Client** `js/modules/county-brief.js`: draws the county line and marks flooding gauges, open shelters and quakes; panel with level, reasons and seven sections; Print SITREP (printable page; pop-up blocked → copied instead), Copy, Refresh, and **Watch This County**, which arms a watch zone just big enough to cover the county, so p165 phone alerts cover it.
- **Pitfalls found on live data:** river Flood Warnings have no `ends`, and `expires` is only when NWS reissues the message, so showing it as "until 04:00Z" was wrong; now only `ends` is shown. Their headline is generic ("REMAINS IN EFFECT UNTIL FURTHER NOTICE"), so the river comes from the "<river> affecting <County>" lines in the text, keeping only this county's (one Tampa Bay message lists four rivers in three counties). County lines are simplified to ~110 m, not 500 m, because gauges often sit on the river that is the county line.
- **Also fixed:** the GPS jamming (p167) and incident (p163) panels were at z-index 900, so on desktop they hid the Tools menu and the right-click menu wherever they overlapped. Desktop panels now sit at 60, under the top bar (100) and the map menu (200); phones keep the old order (their panels sit over the bottom layers drawer). Module version `p168` in the LazyLoader and every SW module entry; SW `bdoc-v169`.
- Each brief is 9 upstream calls (all free U.S. government APIs). Two clicks at different spots in one county are two calls; the CDN only shares exact repeats.

**Verified:** 776 tests, CI passes. `brief()` against the live feeds: Seminole FL SEVERE (two St. Johns River Flood Warnings, Lake Harney gauge forecast moderate), Hillsborough FL ELEVATED (Alafia River at action stage), Norton KS NORMAL; 0.5–2 s, all 7 sources ok. In Chromium on this branch with those real bodies: all three entry points, map pick, print page, copy, Watch This County (30 km zone, which flagged the Flood Warning at once), 404 and 503 messages, close clears the globe, Tools menu and map menu open over the panel, phone top sheet ends above the layers drawer, no sideways scroll, hostile text from every feed shown as text. **Not verified:** the function on Netlify (deploy), the county line on a real GPU globe (headless globe renders blank), printing from iPad Safari, and a county with FEMA shelters open (none were open in the counties tried).

### Claude Code — p167 GPS jamming layer (2026-11-05) — LIVE on `main` @ `cf45a8f`
**Production confirmed 5 Nov:** the scheduled tick ran at 15:45 and 16:00 UTC and Blobs kept both hours; at 16:00 four cells had 20+ reports (two medium near Istanbul, two low). The map fills in over 24 h.
Battle plan Phase 2. Military menu > "GPS Jamming (24h)", Operator tier (`js/auth.js`; Travon may want it free).
- `gps-interference-tick.mjs` (scheduled, 15 min) samples 8 of 32 regions per run from adsb.lol, so each region once an hour, 32 calls/hour, 1.5 s apart. adsb.lol rate-limits bursts (~20 quick calls got "rate limit exceeded", a 200 with a text body); the tick stops at the first one. Counts per 1° cell go to Blobs `gps-interference` / `h-YYYYMMDDHH`. `gps-interference.mjs` serves the last 24 h (CDN 10 min). `js/modules/layers-gpsjam.js` draws one Primitive of rectangles + a panel; click a cell for a card.
- **Rule, tuned on live data 5 Nov** (`_lib/gps-interference.js`, 13 tests): degraded = `gpsOkBefore`, NIC < 7 or NACp < 8. Counted only for ADS-B v1+ aircraft, own broadcast **or MLAT**, category A2–A6 (no category: only at 15,000 ft+). Pitfalls found: light aircraft (A1, uncertified GPS) made Western Europe read 11 % jammed; filtering by SIL instead dropped the real jammed airliners, because jammed jets fall back to MLAT and some Airbus types report SIL 0. Final rule on live data: Kaliningrad 17 %, Gulf of Finland 15 %, Levant 6 %, Western Europe 0.6 %, US 0–0.8 %.
- Bands as gpsjam.org (< 2 % / 2–10 % / > 10 %); a cell needs 20 reports in 24 h. Reports, not distinct aircraft: one jet seen in several hourly samples counts each time.
- After deploy the layer reads "Collecting" and fills over 24 h. adsb.lol's live-API licence is still unclear (licensing list).

**Verified:** 752 tests, CI. One real tick against adsb.lol (8 regions, 1,713 aircraft, 0 errors) → real endpoint body; in Chromium on this branch: 301 cells drawn (red over the Baltic: Gotland, Saaremaa, eastern Poland, Lithuania), panel, fly-to, off cleans up, empty state. **Not verified:** the Netlify scheduler and Blobs in production, and a real 24 h of samples.

### Claude Code — p166 battle-plan quick wins (2026-11-05) — LIVE on `main` @ `8927123`
Items from the 5 Nov battle plan (Phase 0 and 1) that needed no account or key.
- **Local bridge off switch** (`js/bdoc-plugin-renderer.js`): P155 saved `bdoc_local_ipc` forever, so one try of Wireshark Live meant every later visit polled `127.0.0.1:9876` every 15 s. Now, on the web, polling runs only while Wireshark Live, the local mesh layer or Network Builder LIVE is on (`enable(who)` / `release(who)`); the old flag is deleted on load. The desktop app still polls from the start. `tests/local-bridge.test.js`.
- **Forecast radar → NOAA WPC** (`WxForecast` in `index.html`): Tomorrow.io's free key (25 calls/h) could never serve 7 frames of tiles. Now 8 six-hour frames out to 48 h from `mapservices.weather.noaa.gov .../precip/wpc_qpf/MapServer` layers 13–20: public domain, no key, CORS on. Lower 48 only. Row renamed "Forecast Rain (48h, US)".
- **Sentinel-2 licensing:** the layer used EOX `s2cloudless-2021`. EOX's FAQ: 2018+ mosaics are CC BY-NC-SA and paid/freemium apps need a commercial licence (hosted endpoint about EUR 6,000/yr). Switched to `s2cloudless_3857`, the 2016 mosaic, CC BY 4.0, with EOX's exact credit. Going back to newer imagery means buying the licence.
- **`sources.html`** Sources & Licenses page: every feed in the code, with credit; a licence is stated only where confirmed. Linked from the welcome card, sign-up and Terms §6.
- **Believed, not yet confirmed, also non-commercial for a paid app:** Open-Meteo's free API (air quality), Cloudflare Radar data (CC BY-NC), TeleGeography cable data (CC BY-NC-SA). Joins adsb.fi / RainViewer / Broadcastify / OpenSky on the licensing list.
- ADS-B feed check for the planned GPS jamming layer: adsb.lol v2 returns `nic`, `nac_p`, `nac_v`, `sil` and `gpsOkBefore` per aircraft, so the layer can be built from data BDOC already pulls. Its live-API licence is still unclear.

**Verified:** 739 tests, CI passes. In Chromium on this branch: 0 local-port requests on a visit with the old flag saved, polling while Wireshark Live is on, 0 requests in the 10 s after it is off; NOAA and EOX tiles fetched through the layers' own imagery providers (CORS ok, real pixels); sources page fits a 375 px phone. **Not verified:** the layers drawn on a rendering globe (headless swiftshader showed a black globe), and the desktop app.

### Claude Code — p165 watch zones reach the phone (2026-11-05) — LIVE on `main` @ `b82c173`
Watch zones were checked only by an open tab, so a quake or tornado warning near home reached nobody whose BDOC was closed. Roadmap step 2.1 ("palantir for the people": the person, not the agency).
- **Client:** `bdoc-push.js` sends the device's zones (max 10) and alert choices with its push registration, and re-sends them, debounced, whenever a zone or choice changes (`BDOCPush.syncZones`, called from `watch-zones.js save()`). Settings > Alerts gained level (serious / everything) and quake / weather / fire switches. Adding the first zone offers push. The open tab skips its own OS notification for a class the server already covers, so nobody gets two.
- **Server:** `push-subscribe.mjs` stores `zones` + `prefs` on the record (cleaned by `_lib/zone-alerts.js`). New scheduled `zone-alerts-tick.mjs` (every 5 min): USGS 2.5_day once, NWS `alerts/active?point=` per US zone, FIRMS per zone through our own `proxy-firms` (the key stays there). Per-device `seen_<key>` blob dedupes, fires re-alert after a cooldown, max 3 pushes per device per tick (the third becomes "N more alerts"). 404/410 prunes the device; other failures retry next tick. Rules live in `_lib/zone-alerts.js` (pure, 23 tests in `tests/zone-alerts.test.js`).
- **Tapping an alert** opens or flies BDOC to `#v=1&c=lon,lat,h`. Pitfall found: the P111 share-link writer in `index.html` replaced the whole `BDOC.DeepLink` object, so `restore()` from `js/deeplink.js` was gone. It now merges (`Object.assign`), with a test.
- `privacy.html` now says what is stored (push address, browser type, zone centre/radius/name) and that turning push off deletes it. **Travon to review the wording.**
- Push is on: live `push-subscribe` reports `sendReady:true` (5 Nov). Without the key the tick would log `skipped: VAPID_PRIVATE_KEY missing`. No tier gate yet: every armed device gets 10 zones. Outages are not in v1 (Sentinel feed on Netlify is empty). iPhone needs Add to Home Screen for any push.

**Verified:** 734 tests; CI passes; live feed shapes (USGS, an NWS Flood Warning, FIRMS via the live proxy); headless Chromium on this branch with the real SW and modules (zone sync on boot/add/change/remove, status line, `covers()`, alert tap flies the open tab, cold open lands on the spot, SW `bdoc-v166`).
**Not verified:** a real push reaching a real phone, and the Netlify scheduler running the tick. After deploy: arm push on a phone, add a zone, watch the function log for `[zone-alerts]`.
Also this session, already live: p163i iPad fix (`87637f7`) and p163s five broken layers (`5e784b4`). The commit messages have the detail. Pre-existing, not fixed: the Plausible script `pa-E-tvb2Sx_aDQGdqkqF1Lh.js` is 404, so visits are probably not counted; `mesh-nodes` is 503 on live.

### Claude Code — p163 Incident Archive (2026-10-31) — IRAN WAS NOT A THEATER, AND WAR ROOM KEPT ONLY 3 HOURS
Travon: "I have no idea what is going on in Iran." Measured on prod: 6 Iran events of 179 worldwide. The US/Israel-Iran war has run since 2026-02-28, and `WAR_THEATERS` had no Iran entry.
- **New layer `incidents`** (`js/modules/layers-incidents.js`): every located GDELT root 18/19/20 event since 2026-02-28, in `data/incidents/*.json`, drawn in one PointPrimitiveCollection (167,381 worldwide, 23,744 Iran/Gulf). Same plan tiers as `warlive`.
- **Backfill:** `node tools/incidents/backfill.js <cache>` then `node tools/incidents/build.js <cache> data/incidents`. Cache is on the laptop at `C:\Users\ARNAUTICA\bdoc-incident-cache`. Resumable. Repo gained 24 MB.
- **Live top-up:** `incidents-tick.mjs` (scheduled, 15 min, looks back 24 h) writes Blobs; `incidents-recent.mjs` serves them. Split because scheduled functions have no URL. Blobs keep serving 45 days, so **rebuild the shards at least monthly**.
- War Room: Iran theater + FIRMS box; `proxy-newsgeo` gained Iran/Hormuz Google News searches and Gulf gazetteer places.
- Pitfall: the SW is cache-first for local files, so shards are fetched with `?v=<index.generated>`. A plain URL would never update.
- A dot is a cluster of reports at one place on one day, NOT a confirmed strike. Do not market the number as a strike count. Vetted counts need ACLED (commercial licence) or UCDP (token). Neither is wired.
- Believed, not verified: droplet not checked (classifier blocked read-only SSH). Static Iran markers in `layers-conflict.js` are still stale.

### Claude Code — desktop 8.2.0 (2026-10-31) — THE DOWNLOAD WAS AN AUGUST BUILD THAT COULD NOT WORK OFFLINE
The only GitHub release was `v8.0.0` (2026-08-10), so no fix since reached a download. Its bundled mode had no `config` route, so Supabase never started and sign-in could not work. Worse: Cesium and every library came from CDNs, so with no internet there was no globe at all.
- `tools/desktop/vendor.js` copies pinned CDN files to `electron/vendor` (gitignored, run before electron-builder, added to `desktop-release.yml`). Offline, `main.js` redirects CDN urls there, so SRI still passes and `index.html` is unchanged. Cesium's NaturalEarthII is added as a bottom imagery layer.
- `server.js` got `config` and a 503 for unknown functions (the SPA fallback was answering them with HTML). `setWindowOpenHandler` replaces the removed `new-window` event. `will-navigate` was blocking Google sign-in and sending Stripe nowhere: Supabase and Google now stay in the window, and anything else https opens in the system browser. BDOC menu has Switch to Offline / Live Mode.
- Offline unlock: `~/.bdoc/unlock`, or a file named `bdoc-unlock` beside the exe, loads `/?dev=local`, which `Auth.checkDevKey` already honours on localhost. Deliberately not shipped in the release. Customers get recon offline, and paid-tier offline for them is still open.

**Verified** on this laptop with the packaged exe, DNS blocked for everything but localhost: Cesium 1.146, globe renders (frame captured), `offlineMap` true, tier enterprise. Online: loads the live site, `BDOC_Auth.client` present. 704 tests.
**Not verified:** a real password or Google sign-in inside the app, the exe on a second machine, a physical power cut. Offline imagery is world-scale only, no street detail. Offline data is whatever was cached.
Electron is still 31 (the 14 KEV CVEs in §2 stand); not touched days before an election.

**8.3.0 Tool Bridge and offline AI.** BDOC menu > Tools and Offline AI (Ctrl+Shift+T), shown only when unlocked. A separate window at `electron/tools.html`; `main.js` rejects tool IPC from any other page, so the main window and the live site cannot reach it. `electron/tools.js` is a fixed list of actions with validated input and no shell: Wi-Fi scan, COM ports, tshark adapters and capture (`-p`, own traffic only), raw serial read as hex, and app launchers from `IT TOOLS`. Add a row to add a tool. The AI chat calls local Ollama (`ensureOllama` starts it hidden), hides `:cloud` models, flags models over 8 GB as slow, and can only read tool output the operator sends it. Verified on the packaged exe with DNS blocked: all actions, real packet capture, injection rejected, `llama3.1` answered in 5 s. **Not verified:** raw serial read, because no radio was attached; opening each app; a human using the window. No tag: published installers stay 8.2.2.

**8.2.1 tripwire (`electron/main.js`).** Every 10 s it opens TCP connections to the site and three public IPs. All failing for 45 s (`~/.bdoc/tripwire.json` `{"failAfterSec":N}`) flips to offline with a banner, tone, Windows notification and `~/.bdoc/tripwire.log`. It does not auto-return. Verified on the packaged exe with probes forced to fail: live to offline in 15 s at a 10 s limit. A heartbeat file reports an unclean shutdown at next start, because this laptop's battery reads 0% and cannot warn after mains loss. `on-battery` is wired but untested. **The repo is PUBLIC** (`private:false`): HANDOFF, session transcripts, `sentinel.mjs`'s fallback key, the droplet IP and owner ids are readable by anyone. Older notes saying "private repo" are wrong. Making it private breaks unauthenticated release downloads, so that is Travon's call.

### Claude Code — p162 auth-fetch fix (2026-10-30) — CHECKOUT WAS BROKEN FOR EVERYONE
**This corrects §2 Y.2, which said nothing was broken.** Since p158b (`9107060`, 2026-10-23) `stripe-checkout` and `stripe-portal` require a JWT, `subscribe()` and `openPortal()` rely on this wrapper to send it, and the wrapper sent nothing. Every signed-in Subscribe click got 401 `sign in required` and Stripe was never called. `tests/payment-auth.test.js` greps each side on its own, so nothing proved the two met. Existing subscribers are unaffected: their tier is read from Supabase, not through a function.

**The one-line rename alone is not safe.** Two consequences, both measured:
- `getSession()` now sits in front of every function call. With a valid token it costs 15 µs, so there is no token cache. With an expired token and Supabase unreachable it retries for ~30 s: feeds were held back 27.7 s, and the `ping` link probe reported a healthy uplink as unreachable. So the wait is capped at 3 s, calls then go as a guest until the read settles, and `ping` never reads the session.
- The service worker's `networkFirst` stored the request with its headers, so every signed-in GET wrote a live JWT to Cache Storage, where it survived logout. It now stores a bare URL key. **Production does this today** through Supabase's own `profiles` GET, on the "everything else" route, and p162 closes that too.

`client.auth.lock` is `null` on supabase-js 2.118.0, so the "internal lock" in the p157 note in `js/auth.js` no longer exists. Keep its rule anyway: `getSession()` still waits on `initializePromise`, and a nested refresh still deadlocks on `refreshingDeferred`.

**Verified:**
- Prod, 2026-10-30: live page has `typeof window.Auth` `undefined`, `BDOC_Auth` an object, wrapper installed. Curl `stripe-checkout` and `stripe-portal` with no JWT: 401.
- Real browser with supabase-js 2.118.0 from the production URL and SRI, real `auth.js`, `guard.wrap` and `stripe-checkout` handler; only Supabase's HTTP API and the Stripe SDK were fake. Old wrapper: subscribe 401, no Stripe call. New: 200, and the Stripe stub got the verified user id. `guard.wrap` on a paid layer: signed in 200, guest 401.
- Signed in: token on `/.netlify/functions/*`, `/api/*`, `Request` and `URL` inputs. Guest: none. Third party: none on look-alike paths, another port, or the hop after a same-origin 302. Real `index.html` boot: 14 real third-party hosts, 0 tokens.
- Supabase unreachable, expired token: first feeds 3.0 s (was 27.7 s), a feed 10 s later 14 ms (was 17.7 s), `ping` 12 ms (was a false failure). Token back 4.7 s after recovery. Supabase black-holed: `getSession()` still pending at 8 s, feeds 3.0 s then 10 ms, paid layer 401, free layer 200.
- Real service worker in headless Edge with a throwaway profile (the app's browser pane cannot fetch a worker script from localhost): token reaches the server through the worker, 0 JWTs in Cache Storage before and after logout, offline copy still served. After one function GET, today's production files left 1 JWT and the one-line fix 2.
- No function forwards the incoming `Authorization`, `/api/*` only rewrites to our own functions, Electron's proxies send fixed headers, and the two 302 functions are reached through Cesium tiles and `<img>`, not `fetch`. No `onAuthStateChange` subscriber awaits, and a test now pins that.
- CDN: `Cache-Status` identical with and without a bearer on 4 production functions, but all were `fwd=miss; stored`, so that sample had no hit rate to lose.
- 678 tests on Node 24. Eight reintroduced bugs each fail `tests/auth-fetch.test.js`: old name, renamed global, no cap, no stall skip, `ping` on Supabase, no origin check, JWT in cache, async auth callback.

**Verified after shipping:** Travon's screenshot, 2026-10-30: a real signed-in Subscribe opened `checkout.stripe.com` for BDOC Operator at $9.99/month, no test-mode label, account `foxunit101.tb@gmail.com`. (Commit `35c8db1` claimed this earlier from an accidental button click; the screenshot is the real evidence.) **Not verified:** a completed payment through the webhook and tier upgrade, and Firefox or Safari.
### Claude Code — p161 Web Push activation (2026-10-30) — CODE LIVE, PUSH NOT YET TURNED ON
§2 Y.1: `sendReady:false`, neither key on Netlify, so the sentinel's push fan-out has never reached anyone. Telegram still reaches Travon.

**Hermes: do NOT add `VAPID_PRIVATE_KEY` or `PUSH_SEND_KEY` by hand, and do not reuse the p140 key.** Travon turns this on by running `tools/push/activate.ps1` (read its header), then `activate.ps1 -TestPush` with a real device armed. It is Travon's to run because it creates a key and writes secrets (§0 rule 6).

**The p140 private key.** Not in git or Netlify. `~/.hermes/cron/output/c92a63f73955/2026-09-30_17-49-19.md` line 55 shows a long token labelled `VAPID_PRIVATE_KEY`, and that job delivers to Telegram, so it very likely survives in both places. NOT proven: the value was masked on read and never tested against the public key. A wider scan of the droplet was stopped by the permission classifier as credential exploration, and testing that one token means handling the secret, so neither was done. Decision: a new keypair either way. The old key has been through a chat and an LLM, and replacing it will never again be this cheap, with one subscriber. It stops mattering once the new key is live. Whether to delete that report and message is Travon's call.

**What changed.**
- `push-subscribe.mjs`: the public key is derived from `VAPID_PRIVATE_KEY`, so a mismatched pair cannot exist and a future rotation is env-only. `sendReady` now also needs `PUSH_SEND_KEY` (it used to say true with a gate that refused everyone). `GET` splits `count` (reachable) from `stale` (bound to a retired key).
- `push-send.mjs`: `dryRun` now really signs and encrypts. Before, it signed nothing, and `setVapidDetails` only checks lengths, so a wrong key passed it. Stale subscriptions are skipped and counted, never deleted: deleting on a key mismatch would let one wrong env value wipe every subscriber on the next page. The same reason 401/403 is not pruned.
- `bdoc-push.js`: `register()` reused any existing subscription, so a key change left a device dead forever while it re-posted that subscription on every boot. It now compares keys and swaps silently (permission is already granted, so no prompt), and reports `vapid`, as does the SW on `pushsubscriptionchange`.
- The sentinel needed no code change. `PUSH_SEND_KEY` goes in `/root/.hermes/.env`: it is a `no_agent` cron job, Hermes re-reads `.env` before every run, and `_sanitize_subprocess_env` lets the name through, so nothing restarts.

**The one existing subscriber** cannot receive anything signed by the new key. It shows as `stale` until that device opens BDOC, then re-keys by itself. Whose device it is was not determined. If it never opens BDOC, it stays `stale`, harmless.

**Verified:**
- `node --test`: 685 pass, Node 24. `scripts/ci-validate.sh` on Linux Node 22: all 5 checks pass.
- Real functions + real `web-push` 3.6.7 against a strict fake push service, Node 24 and 22, 18 checks: signature, `aud`, `exp` and `sub` verified, payload decrypted, dry run reaches no service, and the real `bdoc-push.js` on an old-key phone re-keys and then receives a real push. Controls: a forged signature gets 401, a wrong key gets 403 and is reported, not pruned.
- Real FCM with a throwaway key from the script's own generator, junk endpoint: 410 (accepted). The same request with a corrupted signature: 403 `invalid JWT provided`. So 410 really does mean the signature was checked.
- `activate.ps1` run whole with Netlify, SSH and the deploy stubbed, 19 checks: every stop condition, droplet before Netlify, neither secret ever printed, the private key never goes to the droplet, `-TestPush` sends nothing without a yes.
- Its generator: 3,000 throwaway keys derive correctly with Node, 12 of them with a leading zero byte. Its droplet commands run through real PowerShell and SSH against a `/tmp` file with dummy values: fixes a missing trailing newline, replaces instead of duplicating, keeps mode 600, leaves no `\r`.
- Real Chromium 152 exposes `PushSubscription.options.applicationServerKey`.

**Believed, NOT verified:** the Netlify env POST and redeploy (same shape as `go-live.ps1`, which worked, but stubbed here), Node 18 (22 and 24 only), the first real send from a Netlify function, re-key on a physical phone (iOS Safari especially), and the sentinel's own Python push block, which only runs on a catastrophic page. Check `sendReady`, the dry run and the test push right after activation.

**Pitfalls found.** `tests/wire-function.test.js` hard-pinned `bdoc-v160`, so any SW bump failed it; it now pins the kept `(prev)` line. A `data:` module is cached by URL, so a stub whose source never changes is shared between test loads. Git Bash mangles `openssl -subj /CN=...`; set `MSYS_NO_PATHCONV=1`.

### Claude Code — p160 LIVE WIRE (2026-10-30) — LIVE, COLLECTOR RUNNING ON THE DROPLET
Travon's directive: "I need to know in real time what is going on... chatter and rumors about things happening on the 4th of November... there should be a live scraper... as the owner I should be able to see everything in real time."

**Hermes: do NOT start a second collector.** Travon approved go-live and `tools/wire/go-live.ps1` ran 2026-10-30 19:56 UTC. `bdoc-wire.service` is live on the droplet, and `WIRE_INGEST_KEY`, `WIRE_TOPIC` and `BDOC_OWNER_IDS` are set on Netlify. Update the daemon with the one-liner in `tools/wire/README.md`, never by editing `/opt/bdoc-wire`, and never print `/etc/bdoc-wire/env`.

**What it is.** Contract: `docs/LIVE-WIRE-SPEC.md`. Runbook: `tools/wire/README.md`.
- `tools/wire/`: always-on Node 22 collector, zero npm deps. 138 polled sources (official, wires, specialist, Google News RSS searches, Telegram public previews, status pages) + Bluesky Jetstream + Wikimedia SSE + GDELT GKG. Classifies, clusters stories, assigns a truth status: official / corroborated / reported / unverified / disputed.
- Delivery opens NO inbound port. Supabase Realtime Broadcast on a secret topic (measured 30–114 ms, droplet to subscriber) plus a 60 s snapshot POST to `netlify/functions/wire` (Blobs) as a second, independent path.
- Owner gate is server-side on the immutable Supabase user id (`BDOC_OWNER_IDS`), never email or tier. Fails closed. `/wire` is the phone and second-monitor page; the main app gets an owner-only WIRE item in `.tb-r`.
- Telegram pages the catastrophic tier only (P110 doctrine). A lone social post can never page. Backlog never pages.
- Ground rules you must keep: feed text reaches the DOM through `textContent` only, never into a Cesium `description` (InfoBox iframe is allow-scripts + allow-same-origin), and never to an LLM (prompt injection). See spec §0.

**Verified:**
- Prod (`bdoc-v160`, curl, 2026-10-30): `/wire` 200, function 401 for no token / garbage token / no ingest key / wrong key, 405 on DELETE, no CORS for a foreign origin, `no-store`, `noindex`. `tools/`, `docs/`, `tests/`, `_lib/` all 404.
- `scripts/ci-validate.sh` on Linux Node 22: all 5 checks pass. 658 tests on Node 24 after the last fixes.
- Realtime broadcast end to end from the droplet with the real project: 5/5 received, 30–114 ms.
- Real browser against `tools/wire/dev-server.js`: desktop and 375 px, hostile `<script>` / `onerror` strings render as text, 0 images, all links http(s) with noopener noreferrer, 0 console errors.
- Real collector runs (droplet dry run; 3 min on the laptop): 131/139 sources up, 0 errors, firehoses ~2,900/min each, about 22 live items in 3 min after filtering. `tests/wire-live-run.test.js` pins every real misclassification found.

- Live on the droplet after go-live: runs as an unprivileged dynamic user, 193 MB, 0 listening sockets, `/root` not visible, `hermes-gateway` still active. Subscribed to the real topic: heartbeats 82–128 ms, new items 0.5–1.3 s from collection. Snapshot POST returned the watch list (6 default terms, sources rose to 147), so production Blobs works. One real Telegram test delivered through `sendTelegram`. 0 errors, 0 dropped, 0 failed publishes.

**Confirmed by Travon, 2026-10-30:** opened `/wire` signed in and it works. **Not verified:** `/wire` on a physical phone.

**Memory leak, fixed in p160c.** The collector hit its 460 MB V8 heap limit and core-dumped at 22:36 UTC, 2.5 hours after go-live; systemd had it back about 40 s later with no data lost. V8 stores a substring as a pointer into its parent, so a kept `guid` or `u` pinned the whole feed body, and a GDELT row pinned the whole decompressed file, while every item count stayed inside its cap. Measured with the real parser: +283 MB per 300 1-MB polls before, +2 MB after. Anything that outlives a poll now goes through `ownItem()` in `lib/util.js`, applied in `parseBy` and `gdelt.rowsFrom`. `tests/wire-live-run.test.js` measures the heap directly and fails at 58 MB without the fix. On the droplet after the fix: RSS 162–184 MB across a 40-minute watch with 0 restarts and 0 errors, against 375 MB at 96 minutes before it. Watch a full day before calling it closed. New parsers must return through `parseBy`.

**Pitfalls found.** `tests/wire-*` fetcher and pipeline tests passed on Node 24 but died on 22/20 because the code unrefs its timers: they hold a `keepAlive` interval now. The laptop's `%TEMP%\package.json` GIF breaks `node file.js` under Temp, so pipe scripts through stdin. Install the daemon from `git archive`, not from the laptop checkout (CRLF breaks `deploy.sh`).

**Known source gaps, by design for now:** X/Twitter, Reddit (403/429 from the droplet), TikTok, Facebook. See §2 Y.

**CORRECTION, 2026-10-30: this session first logged the `window.Auth` bug as harmless. It was not.** `stripe-checkout` and `stripe-portal` have required a JWT since p158b (`9107060`, 2026-10-23), and the `window.Auth` bug means the browser never sends one, so every signed-in Subscribe click and billing-portal open gets a 401 in production. Curl with no token confirms the 401. Fixed in p162, shipped the same day on Travon's OK. See the p162 entry above.

### Hermes — p159i, on `main` @ `3ed62f2` (2026-10-28 cron shift — GDELT BACK FROM THE DEAD)
The p159f/g entry below left GDELT as "the real-time gap": `api.gdeltproject.org` DOC API 429s/times out every call from datacenter IPs (re-verified: droplet 429 after 6 s pause; prod `proxy-gdelt` → `_gdelt_status:'down'`, 0 features). Browser-direct is also CORS-blocked (no ACAO header) so the "browser-direct primary" path never worked either → news layer 0, GTA CONFLICT component 0/22, OutageWatch news-detect `newsOk:false`, fusion CYBER-a leg dead.
- **Fix (`netlify/functions/proxy-gdelt.js`)**: DOC API (4 s, 10-min dead-memo on warm container) → **raw GKG 15-min files** on `storage.googleapis.com/data.gdeltproject.org/gdeltv2/<stamp>.gkg.csv.zip` (same bucket `proxy-gdeltevents` uses; NOT rate-limited; 8.5 MB zip, 0.2 s download + 0.35 s inflate/parse measured; parsed slices cached per container). GKG rows give `<PAGE_TITLE>`, V2Themes (`CYBER_ATTACK`, `ARMEDCONFLICT`, `POWER_OUTAGE`…), **V2Locations with real lat/lon + precision** — strictly better than DOC artlist's country-centroid dots. Query grammar: whitespace-separated groups AND, `a OR b` inside a group OR, quoted phrases, word-boundary match on title/URL, or mapped theme mentioned ≥3× in body. `?format=articles` returns DOC-compatible `{articles:[{title,url,domain,sourcecountry,seendate,lat,lon,place,tone}]}`. Meta: `_gdelt_source:'gkg'|'doc'`, `_gdelt_window`, `_gdelt_files`, `_gdelt_doc_warning`. Edge cache 5 min + SWR 15 min. **Pitfall:** GKG col 9 = V1Locations (lat at `#` index 4), col 10 = V2Locations (lat at index 5) — I shipped the wrong column first and got lon=-2106554.
- **`outage-watch.js`**: `gdeltArticles()` = browser-direct → `proxy-gdelt?format=articles` fallback with 10-min dead-memo; used by `pollNews()` and the fusion CYBER-a leg.
- Cache: `SW_VERSION bdoc-v159i`, LazyLoader `p159i`, SW precache `js/modules/*?v=` re-aligned to the LazyLoader version (they had drifted to p159 vs p159f → precache misses).
- **Verified on prod** (`/root/bdoc-qa/gdelt_live.py`, `ow_dbg.py`, Playwright headless, SW blocked): `proxy-gdelt` 50/50 features `_gdelt_source:gkg`, city precision (White House, Belfast, Nushki PK…), 0.5 s warm; news layer **98 entities** (was 0); `OutageWatch.newsOk:true via:'proxy'` (was false); GTA 39 ELEVATED with CONFLICT component populated; **0 page errors**. `timelinevol` mode (7-day escalation curve) is DOC-only and still dead — needs a GKG-derived volume series if anyone wants it back.
- Window caveat: GKG path = last 60 min (4 files, `?gkgfiles=` up to 8 = 2 h), not the 24 h the DOC path promised. Honest, and fresher.
- Next: §2 queue unchanged. Causal fusion engine (p-prior) is now actually fed on the cyber leg; consider adding `POWER_OUTAGE`-theme GKG articles as a 5th OutageWatch detector input.

### Hermes — p159f/p159g, on `main` @ `44b8b4f` (2026-10-26 — REAL-TIME + LIVE CAMERAS)
Travon's directive: ≤60 s from world to globe; live cameras must play; online/offline must feel identical.
Measured BEFORE: SW served `/.netlify/functions/*` stale-while-revalidate → every live layer rendered the *previous* poll (one full interval behind). Warlive polled 15 min, EQ 5 min, outages 2–3 min, GDELT news 3 h. "Live webcams" = 15 links to webcamtaxi.com pages in an iframe that the site blocks → pop-up.
- **p159f `b413f5e`** SW API path → network-first (15 s) with cache only as offline fallback; aircraft clamp ≤60 s visible; EQ/warlive/outage-watch/watch-zones → 60 s; GDELT news → 5 min. LazyLoader `_version` → p159f.
- **p159g `44b8b4f`** `netlify/functions/proxy-cams.js`: 4,405 public cams (Caltrans D1–D12 HLS `wzmedia.dot.ca.gov` CORS * + NYC DOT 978 stills), 185 KB gz, edge 10 min. In-app player (`#camPanel`: `<video>` + hls.js **vendored** at `js/vendor/hls.min.js`, Safari native; stills refresh on camera cadence). `media-src` added to CSP-RO. Verified on prod: 4,405 entities in 2.7 s, Caltrans D7 CCTV-196 plays 1280 px, frames advancing.
- Measured AFTER (prod, 60 s in): USGS feed age 44 s / newest quake 13 min (USGS's own detection lag); ADS-B `seen` 0.0–0.2 s; FIRMS 51 s.
- **GDELT is the real-time gap**: `api.gdeltproject.org` answers HTTP 429 to *every* call (1 req/5 s/IP, 429 even after 6 s pause from droplet) → conflict/news layers are `_gdelt_status:'down'`, 0 features. A serialize-in-container patch was tried and reverted (unverifiable). Right fix = droplet-side collector (always-on, one IP, paced) publishing a JSON the site reads — or replace with Bluesky Jetstream / Wikipedia RC SSE (sub-second, keyless; see `docs/LIVE-SOURCES-RECON-2026-10-26.md`).
- QA: `/root/bdoc-qa/rt.js` (feed ages + cam play), `cams.js`. Headless Chrome must be launched with `--autoplay-policy=no-user-gesture-required` for video tests.

### Hermes — p159e, on `main` @ `8000c99` (2026-10-26, continuing the night shift)
Travon's new bar: a geospatial analyst (or Claude-in-Chrome on his enterprise
profile) must be able to build a full WW3 picture — units, tactical markers,
building outlines, zones, PL/FEBA/FSCL/MSR, bullseye, comments/tags — and hit
zero friction. So I wrote the scenario as a script and ran it against prod.

**Harness:** `/root/bdoc-qa/ww3.js` (27-item Taiwan Strait plan, undo, delete,
GeoJSON, autosave) run by `/root/bdoc-qa/probe2.py <url> 1600 900 30 "$(cat ww3.js)"
shot.png "<initjs>" RELOAD` — the `RELOAD` arg reloads in the same browser
context and reports what `bdoc-plan.js` restored. Treat this as the
regression gate for anything touching `battleEntities`.

Shipped since p159b:
- **p159c `08bee00`** — active layers persist across reload (`bdoc_layers_on`,
  staggered restore, `?fresh=1` skips). Before: every reload = empty globe.
- **p159d `f75e665`** — `css/bdoc-p159d.css`: flat Lattice-style side panels,
  one button idiom, copilot messages flat with left rule, three boot
  marketing messages collapsed to one line.
- **p159e `8000c99`** — three real bugs the scenario found:
  1. `js/bdoc-plan.js` — markers placed in the first ~6–10 s (while `restore()`
     awaited IndexedDB) hit `markDirty()` with `ready=false` and were **never
     autosaved**. Fix: after restore, `markDirty()` if `battleEntities.length >
     savedCount`. Verified: marker placed at t=4 s survives reload on prod.
  2. `placeBattleUnit` — HOSTILE/NEUTRAL/UNKNOWN units rendered in **friendly
     blue** (default swatch won over affiliation). Now affiliation owns the
     colour (APP-6: red/green/amber) unless the user explicitly picked a swatch
     (`window._battleColorPicked`).
  3. First-run weather card stacked on top of the welcome card on a cleared
     profile — `onboardVisible()` now holds while any modal is open.

Verified on prod after reload: 27/27 items restored, GeoJSON = 39 pt / 6 poly /
22 line, no JS errors.

Not bugs (harness artefacts, don't chase): `BDOCPlan.cotEvents()` needs the
`pickCoT` classifier the EXPORT button passes; a 1-point line correctly refuses
to finish. IndexedDB on the headless droplet takes 5–20 s per 100 KB write —
environment (swiftshader/tmp profile), untested on a real device; if a user
reports slow saves, that's the first place to look.

Open next: label collisions when 8 tactical markers sit in one cluster (no
declutter); battle panel reopen state isn't persisted (plan restores but panel
is closed); imagery `tilesLoaded=false` at 25 s on droplet — likely environment.

### Hermes — p159, on `main` @ `9d43268` (2026-10-24 night shift, Travon asleep, "full authority")
Mission for the night: close bugs, then make BDOC *look* like the Ferrari it is
(bar: Palantir Gotham / Anduril Lattice). Each pass ships to main with its own
`css/bdoc-p15x.css` layer loaded LAST, so a sibling can revert one pass by
removing one `<link>`. Verify live with `BUILD p159` / `bdoc-v159`.

**p158f @ `30f0315`** — CI red for 7 pushes: GitHub = Node 20, `node --test tests/`
needs the `tests/*.test.js` glob (fixed in `package.json` + `scripts/ci-validate.sh`).
Fallbacks: `proxy-adsb?mil=1` (adsb.lol → adsb.fi) replaces dead `adsb-global`;
`proxy-firms` falls through SNPP → NOAA-20 → NOAA-21 when a source returns
header-only (UTC rollover); `proxy-status` + `outage-watch.js` use
slack-status.com / zoomstatus.com. Mobile `#mob-ov` card now uses our proxies
(FIRMS key is out of the page). Onboarding wizard defers until the phone gate
closes. ONLINE badge docked inline after `#bdocThreatPill`. `css/bdoc-p158f.css`
= 10px text floor (231 → 28 sub-10px nodes). `netlify.toml`: the `/*.md` splat
NEVER matched — BDOC_CLAUDE.md, BDOC_HISTORY.md, IMPLEMENTATION_PLAN.md,
ADDING_A_NEW_API_KEY.md, meshtastic_receptor.py, deno.lock were public; each is
now 404'd explicitly and `tests/public-surface.test.js` fails the build if a new
root-level internal file lacks a rule. Two tracked `.bak` files deleted.

**p159 @ `9d43268`** — `css/bdoc-p159.css`: top bar 48 → 56px via `--tbh` (lp/rp/
sitPanel/hud-corners/outage banner/cursorCoords follow). Live bar content measured
**2461px on a 1600px viewport** — LOGIN, clock, NVG/FLIR were off-screen; the bar
now collapses by width (export strip <2800, subline+build pill <2200, status strip
<1700, CRT/NVG/FLIR <1800, link badge <1600) — nothing removed from the DOM.
LOGIN back in flow (was `position:fixed` over NAV); duplicate SIGN IN pill removed
(`js/auth.js` logged-out badge is empty). Single accent: every `#2D72D2` inside an
inline `style=` in index.html → `#E8B349` (data/semantic colours untouched).
Onboarding: no emoji, no rainbow tints, 14px radius, Inter. Cesium label fonts
7–9px → 10–11px across `js/modules/*` (blurry on WebGL below 10px).

**Open next (in order):** pricing copy still wrong (free = 10 layers, copilot free,
live feeds); data age per entity; copilot "what changed" on load; trust-score label.
Travon's side: run `docs/mesh-setup.sql`; rotate the FIRMS key (was in client code).
Local QA harness: `/root/bdoc-qa/probe.py URL W H WAIT JS [png]` over Playwright
CDP :9222 (`/root/.venvs/pw/bin/python`); competitor teardown in `/root/bdoc-qa/comp/`.

### Hermes — p158e, on `main` @ `81bcd26` (2026-10-24)
- **Situation panel XSS closed** (list cards + detail view). `sit.title/author/region/details/intel/activity` now go through `esc()`. Static demo data today; would have been stored XSS once a `situations` table feeds it. Opus-4.8 had left the detail half uncommitted — finished, list half added.
- **Field audit S2 fixed — paid tools no longer lock offline.** `loadProfile()` caches `{uid,tier,exp:+30d}` in `localStorage.bdoc_tier_cache` on each successful load; read ONLY when the profile fetch fails/returns null. Rejects expired, other-uid, and non-paid/unknown tiers; cleared on logout. Client-side only — grants nothing the server checks.
- Tests: `npm test` = **66** (+`tests/tier-cache.test.js` 7, `tests/xss-situations.test.js` 8).
- Live verified: BUILD p158e, SW `bdoc-v158e`, `auth.js?v=p158e` serves the cache code.
- Weekly cron `c92a63f73955` last run (10-21) died on Anthropic credit balance, not code.
- **Next from §2:** S9 community-trust label, S13 clock-skew warning, pricing-modal copy (Recon layers / copilot / "24h delayed"), per-entity staleness, copilot boot briefing.

### Hermes — p157 + p157b, on `main` @ `6f99a3f` (2026-10-23)

Hermes was 21 commits behind (still on p152) and re-synced to p156g before
starting. Verified Claude's p154 heli fix independently against 1,142 live
aircraft: 42 helicopters correctly classed (EC35, B429, V22, H60, R22), and
the p152 exact-ICAO regression cases still pass 9/9. That fix is real.

**p157 — four fixes + the first tests in this repo**

1. **Hurricane layer returned ZERO features during an actual Cat-3 landfall.**
   `proxy-weather?type=hurricanes` asked NWS for `event=Hurricane,Tropical
   Storm,Typhoon`. NWS `event=` is an EXACT match and no alert is named
   "Hurricane" — the real names are "Hurricane Warning", "Storm Surge Warning",
   "Tropical Storm Warning". The query matched nothing, always.
   Caught 2026-10-09 with Isaias at 28.7N 87.1W / 105 kt / 959 mb: NWS had 250
   active alerts across AL/FL/MS/GA (25 Hurricane Warnings, 18 Storm Surge
   Warnings) and BDOC drew none.
     old query -> 0 features · 13 exact names -> 183 features
   Re-proved on a calm day so it isn't a fluke:
     `event=High Wind Warning,Wind Advisory` -> 13 · `event=Wind` -> 0
   Added `type=storms` (NHC `CurrentStorms.json`) for storm POSITION/intensity/
   pressure/movement. **`nhc.noaa.gov` had to be added to the User-Agent guard**
   — it is a different host from `api.weather.gov` and the old check missed it.

2. **`_bdoc` provenance envelope on proxy-weather.** Today the hurricane layer
   legitimately returns 0 (Isaias dissipated; only Vance remains in the EPAC).
   Yesterday it returned 0 because it was broken. Byte-identical, opposite
   meanings. Responses now carry
   `_bdoc:{source,type,fetched_at,upstream_status,count,degraded}` additively —
   callers still read `.features` / `.activeStorms`. Errors carry it too.
   **This is the contract any provenance badge work should read.**

3. **Auth deadlock + triple profile load** (review #3). `await loadProfile()`
   inside `onAuthStateChange` is the documented supabase-js v2 deadlock and can
   hang auth on TOKEN_REFRESHED. Callback is now sync, work deferred via
   `setTimeout(0)`. Same change kills 3 duplicate `profiles?id=eq.…` per load
   (guarded by uid comparison + `_profileLoaded`, set on both paths).

4. **CDN pinned + SRI on all 7 third-party scripts** (review #6/#7).
   `supabase-js@2` and `mqtt@5` were floating — supabase-js went 2.116.0 ->
   2.117.3 -> 2.118.0 in days, so prod ran a version nobody chose. Pinned to
   2.118.0 / 5.16.1. **The Oct-8 pack's SRI hashes were for Cesium 1.104 and
   would have broken the page after p153's 1.146 upgrade** — these are
   recomputed from the real downloaded bytes. cdnjs and jsDelivr Cesium 1.146
   are byte-identical (6,080,574 B), so the CDN-fallback tag shares the hash.

**p157b — the local bridge was readable by ANY website** (review #4).
`tools/bdoc-ipc-receiver.js` sent `Access-Control-Allow-Origin: *`, so any tab
could read `/wireshark/packet`, `/wifi/scan`, `/shodan/device`,
`/sensor/reading`. Binding to 127.0.0.1 does not help — the browser is already
inside the trust boundary; CORS decides who may READ.
Now: origin allowlist (no wildcard) + 32-byte pairing token in
`~/.bdoc/bridge_token` (0600), required in `X-BDOC-Bridge`, timing-safe
compared. `/api/v1/status` stays open so the UI can say "running, not paired".
Token printed in a startup banner — without it the lockdown just looks broken.
**Gotcha:** `send()` needed the origin across 13 call sites. Rebinding `send`
per request is a RACE (POST routes read the body async, overlapping requests
clobber each other). Origin is stored per-response in a `WeakMap`.

**Server-side paywall groundwork — SHIPPED BUT NOT ENFORCED** (review #14).
- `netlify/functions/_lib/guard.js` — `wrap()` adds JWT verify, server-side
  tier, origin lock, Sec-Fetch-Site, per-IP rate limit, sanitized errors to an
  existing handler without rewriting it. Reads tier with the **caller's own
  token**, not the service key, so RLS `profiles_select_own` means a bug still
  cannot read another account. Built on this repo's `_supabase.js` because the
  Netlify var is named `supabase` and there is **no `SUPABASE_URL`** — the
  pack's hardcoded env names would 500 in production. Fails CLOSED on gated
  layers, OPEN on recon layers.
- `js/bdoc-auth-fetch.js` — wraps `window.fetch`, attaches the JWT to
  same-origin `/.netlify/functions/*` and `/api/*` ONLY. Covers ~40 call sites
  and every future layer.
- **Not wired to any proxy yet.** Flipping 43 endpoints before the layer→tier
  map is signed off risks locking out paying users, which is worse than the
  hole. Next step is one proxy at a time with the map reviewed first.

**First tests in the repo — `npm test`, 35 passing.** `node --test`, no deps.
Use the glob (`"tests/*.test.js"`); **Node 18 rejects a bare directory**.
  - `tests/guard.test.js` (18) — 401/402/403/405/429, recon open to guests,
    unknown tier fails closed, inner throw -> 502 without leaking the stack.
  - `tests/auth-fetch.test.js` (8) — the token-leak invariant, with explicit
    negative tests for USGS, NOAA, Cesium, OpenSky and a look-alike path on a
    foreign origin.
  - `tests/bridge-security.test.js` (9) — starts the REAL receiver on :9879 and
    attacks it; asserts no response anywhere carries `ACAO: *`.
Writing these caught a real bug pre-deploy: `guard.js` is in `_lib/`, so
`require('./_supabase')` resolved nowhere and would have 500'd every wrapped
function on first request.

**Checked, no action needed:**
- `mesh-nodes` 503 is **honest** — `{"status":"not_provisioned"}`, the
  `mesh_nodes` table genuinely does not exist. Needs Travon to run
  `docs/mesh-setup.sql`. Not a code bug.
- `proxy-meshworld` source A (§2 P): not a tunable timeout.
  `meshtastic.liamcottle.net` hung for the full 45 s on 3/3 attempts from the
  droplet and returned 16 KB once, nothing twice. The function's failover is
  working correctly and `sources.a:'unavailable'` is accurate reporting.
  Source B alone is serving **9,647 nodes**. Leave it.

Live verified at p157/bdoc-v157: BUILD pill, SW version, 7 `integrity=` tags,
0 floating versions, `bdoc-auth-fetch.js` 200, `type=storms` returning
Hurricane Vance (75 kt).

### Claude Code — p156g touch menu, grids, sharing, no boot prompt, on `main` @ `0c1b0f3` (2026-10-16)

The quick-win batch from §2 W. Also logged the pasted critique as §2 X.
- **Touch long-press** (~0.55 s, <10 px movement, one finger) calls the same
  handler as right-click, now named `window._bdocMapContext`
  (`index.html`).
  - A Cesium-wide `LEFT_CLICK` guard (`cesium-init.js`, patched onto
    `ScreenSpaceEventHandler.prototype.setInputAction` before the Viewer is
    built) skips the release, via `window._bdocLongPress`.
  - A capture listener eats the DOM click that would close the menu.
  - Android's native long-press `contextmenu` is suppressed on the canvas.
- **Context menu:** ⌗ Copy Grid (MGRS) and ↗ Share This Spot
  (`navigator.share` with a `GRID … | lat, lon | HHMMZ` line + a `?fly=` link;
  clipboard fallback via `_bdocCopy`). The menu header and the coordinate bar
  show the grid, since touch has no hover readout.
- **`js/converters.js`:**
  - `formatMGRS(lat,lon,digits)`: 6/8/10-digit, spaced.
  - `parseMGRS(str)`: the inverse; any case/spacing, 0–10 digits, returns the
    square centre, wraps at the antimeridian.
  - `parseCoordQuery`: a grid or "lat, lon".
  - `formatCoord` handles `mgrs`.
  - The `toDMS`/`toDM` carry fix (no more `60.0"`).
- **Settings:** Coordinates → MGRS was a no-op and now works, with a new MGRS
  precision select. Both persist in `localStorage bdoc_coord_settings`.
- **Search:** a grid or lat/lon resolves on the device (never sent to
  Nominatim; works offline), flies in by precision, drops a 3-minute pin;
  Enter picks the top result.
- **Notification prompts removed:** at boot, from anomaly events, and from
  `OutageWatch.start` (lazy module). Watch zones, AOIWatch and the alerts
  toggle still ask in context.
- **`og-image.png`** added (1200×630, a real globe frame); the meta tags
  already pointed to it.
- **Version:** `converters.js` / `cesium-init.js` `?v=p156g`, LazyLoader
  `_version` + 10 module keys p156g, SW `bdoc-v156g`, `BUILD p156g`,
  changelog.

**Verified by running:**
- **Headless Chrome with real touch events, old (p156f) vs new:**
  - Boot permission requests: 2 → 0.
  - A tap does nothing; a hold opens the menu, and the release selects
    nothing.
  - Copy grid gives `16S GC 4176 3749`; share gives a GRID line + link.
  - A 10-digit MGRS readout persists across a reload.
  - A grid search makes 0 geocoder requests (old: 1) and lands on the Georgia
    Capitol with a pin.
  - og-image is 200 at 1200×630.
- **`parseMGRS` vs the `mgrs` library on 3,200 points:** identical at 6–10
  digits, 1 m round trip worst 0.7 m, 10/10 malformed grids rejected.
- **`toDMS`** on 200k values: no out-of-range seconds.
- `ci-validate.sh` passes.
- **Live:** p156g and every change are served. A returning browser moved to
  v156g, and `parseMGRS` / `formatMGRS` / long-press / Copy Grid are present
  with no errors.

**Not verified:** a real phone or tablet (long-press and haptics on hardware,
the real iOS/Android share sheets).

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

### Y. Found while building p160 (2026-10-30)
1. **Web Push is ready and waiting on Travon (p161, see §1).** Run `tools/push/activate.ps1`, then `activate.ps1 -TestPush` with a real device armed. Done when `sendReady` is true, the dry run passes and the test notification appears on the device. Until then the sentinel's push fan-out and every customer alert stay silently dead. Telegram still reaches Travon.
2. ✅ **FIXED in p162: `bdoc-auth-fetch.js` never attached a token, which also broke checkout.** See §1. **Before a paid proxy adopts `guard.wrap`:** (a) calls fired before `BDOC_Auth.client` exists go as a guest; at boot that is `proxy-firms`, `proxy-adsb` and `mesh-nodes`. (b) Tile and `<img>` loads skip `fetch`, so they carry no token. (c) A gated 200 must not be cacheable by URL. In testing the browser's HTTP cache answered a guest with a response fetched while signed in, and the worker writes every 200 to Cache Storage, so gated responses need `private, no-store` and a worker bypass like `wire`'s.
3. **`sentinel` relay is empty.** `GET /.netlify/functions/sentinel` returns `generated:null`. Nothing POSTs to it.
4. **`bdoc_sentinel.py` still calls the GDELT DOC API**, which 429s from the droplet, so its cyber sweep degrades silently.
5. **LIVE WIRE source gaps.** No X, Reddit, TikTok or Facebook. X is the largest: it needs a paid API or a scraping vendor, and that is Travon's call.
6. **LIVE WIRE next:** Bluesky `searchPosts` (works unauthenticated on `api.bsky.app`, `public.api` 403s) returns like and repost counts the firehose lacks, so the feed can show which rumors are actually spreading.

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

**✅ Done in p156g (`0c1b0f3`):**
- The boot notification prompt, the anomaly auto-prompt and the OutageWatch
  boot prompt are all removed.
- Long-press context menu with COPY GRID / SHARE.
- Working MGRS setting (6/8/10-digit, spaced, persisted).
- MGRS / lat-lon parsing in search (on device, never sent to the geocoder).
- `og-image.png` is in place.

**Still open from W:**
- Rotate the AIS + FIRMS keys (Travon), then proxy them.
- AOI pre-stage / offline imagery.
- GPS fix age + spoof gate + manual position (S10). The parser now exists to
  build on.
- EMCON / field mode.
- Per-entity staleness.
- Text and target sizes.
- Mobile overlay stacking.
- Pricing-modal copy.
- Privacy policy (Simple Analytics, location).
- Manifest orientation / screenshots.
- `.bdoc.json` UID merge.

### X. Pasted "Mr. Robot" critique + build spec (another AI chat, 2026-10-16)
Travon pasted a persona-style transcript: a hacker critique of the live site,
an "OSINT gold tool" roadmap, and a 5-module "paste-ready" spec. Checked
against the code:
- **Valid, still open:**
  - **The copilot doesn't brief on load.** It shows a static "ALL MODULES
    LOADED" list and "Type help" (`index.html:11540`, `:10415`). Have it
    narrate the delta on boot.
  - **Panels show `--` / "Loading…" until their feeds resolve.** Render the
    last-known-good values marked STALE (`snapshot-client.js` already does
    this for some feeds).
  - **The threat pill reads `NORMAL · GTA --` before a score exists**
    (`index.html:463`).
  - **Move off `netlify.app`** to `kitsuneglobalsolutions.com` (DNS, Travon).
- **Already logged:** the AISStream key (the paste prints it in full, so it
  has now been pasted into another AI service, which makes rotation more
  urgent), the Cesium ion Allowed URLs, and server-side proxies (§2 N, W).
- **Wrong:**
  - **"Free tier = 24h delayed feeds."** Nothing delays feeds for Recon;
    only the pricing modal says so (`index.html:883`). The fix is the copy,
    not the tiers.
  - **"Layers ship default-on despite the comment."** Already fixed
    (`index.html:11455`).
- **The spec code is not drop-in.** It calls APIs BDOC doesn't have:
  - `BDOC.OfflineStore` (the real one is `BDOCOfflineStore`), `EventLog.push`
    (the real one is `EventLog.add`).
  - `BDOC.Push.send` (client push is impossible: `push-send` is
    server-key-gated and `sendReady:false`).
  - `BDOC.RuleStore`, `BDOC.FusionHistory`, and `FusionEngine.on(...)`
    (FusionEngine has no events).
  - It also says `layer-provenance.js` does SHA-256, which it doesn't, and
    its P157–P161 numbering clashes with §2 L.
- **Direction worth keeping:** standing watches → rules → intelligence
  requirements → a hash-chained evidence log. `watch-zones.js` (P118)
  already covers the standing watch (pin+radius, five sweep classes, in-page
  alerts). The gaps:
  - It only runs while the tab is open.
  - Zones are circles only.
  - There are no user-written rules and no tamper-evident log.

  Build it on the real APIs if it's taken up.

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
