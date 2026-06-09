# BDOC Design System — Standing Style Spec

_The north star for every UI change to BDOC. Any AI or human styling BDOC follows this.
Goal: BEAT Palantir on data + 3D visualization; look like a $200k design team built the chrome._

## Core philosophy: SUBTRACTION, not addition
The "built-by-AI / built-by-Claude" tell is **decoration**. We win by removing it.
- The chrome (panels, borders, headers, buttons) is **quiet, gray, professional**.
- The **data** (globe entities, feeds, 3D layers) is the ONLY loud thing on screen.
- Teal is a **5% accent for meaning**, never a uniform coat of paint.

## The #1 rule: TEAL is an accent, not a uniform
Travon's brand color is **teal** (he loves teal/turquoise). Use teal ONLY for:
- Selected / active entity or filter
- Primary action button
- Live-feed pulse + Cassini AI presence
- Focus rings
NEVER put teal on: every panel border, section headers, body text, generic icons.
This single discipline kills ~60% of the amateur look.

## Palette (gray-on-gray base, single teal accent)
Base/chrome (Blueprint-grade dark, already mostly in bdoc.css):
- App bg `#0E1116` · surfaces `#13171F` / `#181D26` / `#1D222A`
- Borders: hairline `rgba(255,255,255,0.06)` → `rgba(255,255,255,0.10)` (NOT colored)
- Text: primary `#E6E8EB` · secondary `#9BA1A8` · tertiary `#5C636B`

Teal accent (replaces the stray Phase-11 blue #4A9EFF and Phase-13 cyan #00d4ff):
- `--kf` brand teal `#2EB8B8` · hover `#26A0A0` · dim fill `rgba(46,184,184,0.12)`

Status triad (sparing, meaning only): danger `#DA3633` · ok `#3FB950` · warn `#E8B339`

## Geometry & depth
- Border-radius: `2–3px` globally. NO 12–16px glass cards.
- Depth from **1px borders + one-step background value shift**, NOT glow.
- `backdrop-filter: blur()` allowed ONLY on true floating overlays (modals, context
  menus, Cassini chat) — NOT on docked sidebars. Keep blur subtle.
- ZERO colored `box-shadow`/glow. Shadows are neutral dark only: `0 1px 2px rgba(0,0,0,0.4)`.

## Spacing
4 / 8px grid: allowed values 4, 8, 12, 16, 24, 32. No arbitrary 7px/13px.

## Typography
- UI: `Inter` / system stack. Data/coords/IDs/timestamps/callsigns: `JetBrains Mono`.
- Scale: 11 / 12 / 14 / 16 / 20px. Section labels 11–12px UPPERCASE, letter-spacing 0.05em, muted gray.
- Monospace for all tactical data = instant "intel-grade" signal.

## Iconography
ONE monochrome line-icon set (Lucide / Phosphor / Blueprint Icons), single weight,
`currentColor`. **Remove all emoji used as UI icons.**

## The globe (where we BEAT Palantir)
- Dark, desaturated Cesium basemap (muted slate land, near-black ocean, dim graticule).
- Entities/layers are the brightest pixels: color = CATEGORY (air/sea/cyber/disaster/veg/water), not decoration.
- Our moat vs Gotham (2D link-analysis + flat map): hyper-3D digitized Earth with
  layered live OSINT — vegetation/NDVI, water bodies, terrain, elevation, in volume.
  Invest visualization polish HERE, not on the chrome.

## Known offender to keep purged: the "Phase 13 cinematic war-room" layer
A prior pass (Phase 13) layered cyan `#00d4ff`, `--glass`, `--border-glow`,
`blur(12px)` glassmorphism, and `0 0 Npx rgba(0,212,255,...)` glows ON TOP of the
clean Phase-11 base. THAT is the amateur tell. It is being removed. Do not reintroduce
cyan glow, colored borders, or glass-card styling.
