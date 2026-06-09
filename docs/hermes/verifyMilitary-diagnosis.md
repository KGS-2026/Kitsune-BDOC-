# verifyMilitary() Diagnosis — hermes/overnight-2026-06-09

## BLUF
`verifyMilitary()` (BDOC Deploy/index.html line 3062) could **not** be confirmed as a
hard runtime crash from static analysis. The function is fully wrapped in try/catch and
every DOM lookup inside it is either guarded or recreated. **Confidence that this
function is the revenue blocker: LOW.** The real, provable revenue blocker was found
elsewhere — see `payment-wiring.md`.

I did not fabricate a crash I could not substantiate.

## What verifyMilitary() actually does
- Lines 3062–3085. Opens a promo-code modal (`#promoBg`), creates it on first call,
  re-shows it on later calls. Validates codes in `submitPromoCode()` (3086–3101)
  against `['MILITARY50','VETERAN50','GWOT50']`, stores the applied code in
  `localStorage['bdoc_promo_applied']`.
- Entire body is inside `try{...}catch(e){console.error('[PromoCode] verifyMilitary error:',e)}`.
  Even if a DOM node were missing it would log, not crash the page.

## Symbols verified present (no undefined-reference crash on this path)
- `af()`  — defined index.html:2984
- `feed`  — defined index.html:2950 (`const milAC=[],allAC=[],feed=[]`)
- `EventLog` — defined js/telemetry.js:12, exposed as `window.EventLog` (loaded as a
  PHASE 2 module BEFORE the inline script at index.html:1357, comment at 1356)
- `hideMo()` — defined index.html:3061

## Why a live repro could not be completed
Production URL `https://kgsbdoc.netlify.app/` returned **"Page not found"** during this
run (headless browser, no residential proxy — could be bot-detection, a path change, or
a transient deploy state). Per the anti-thrash rule I did not guess-loop on it.

## What Travon must capture (if a crash is still seen in a real browser)
1. Open the production site in Chrome, DevTools → Console.
2. Click the green "MILITARY / VETERAN DISCOUNT" bar (index.html:771).
3. Copy the **exact** red console error text + the file:line it points to.
   That single line will localize it immediately — the function itself is sound, so a
   real error almost certainly originates in a helper or in load order, not here.

## Proposed action
Treat verifyMilitary() as **not the blocker**. Focus on the orphaned checkout flow
(payment-wiring.md), which is a concrete, code-level defect with a shipped fix on this
branch.

_Confidence: LOW that verifyMilitary is broken. HIGH that the checkout orphaning is the real blocker._
