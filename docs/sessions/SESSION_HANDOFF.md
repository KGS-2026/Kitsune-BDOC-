# BDOC SESSION HANDOFF — 2026-10-24 (post-context-overflow)

## WHY THIS FILE EXISTS
The Telegram DM session (20260901_205632_eff9f132) ran from 2026-09-01, hit
502k tokens, and overflowed every provider's context window. Root cause was
config: model.context_length was unset so compression never fired on time.
FIXED: context_length=200000, compression.threshold=0.6 (compresses ~120k now).
Next step after reading this: user starts /new, says "continue BDOC security".

## BDOC STATE: live at p158d, 58 tests passing, CI gate enforces them.

## SECURITY WORK SHIPPED (verified live):
- Stripe IDOR closed (stripe-portal took customerId from body -> 401 now)
- Stripe checkout identity spoofing closed (userId from token, not body)
- Full server-side source disclosure closed (/netlify/*, /supabase/* etc -> 404)
- Local IPC bridge CORS locked (origin allowlist + pairing token)
- SituationManager XSS escaped (6 fields: title/author/region/details/intel/activity)
- CDN deps pinned + SRI (supabase-js had drifted 2.116->2.118)
- Auth deadlock fixed (await inside onAuthStateChange)
- CSP Report-Only + COOP + CORP live (8/8 headers)
- SECURITY.md + /.well-known/security.txt live
- npm audit: 0 vulnerabilities
- Hurricane layer query fixed (0 -> 183 alerts; NWS exact event names)

## OPEN ITEMS (the three that matter, ranked):
1. RUN docs/security-audit.sql section 0a in Supabase SQL Editor — the tier
   self-upgrade check. Biggest unknown: did migration 002 ever run in prod?
   If not, any user can PATCH their own tier to enterprise. ONE QUERY.
2. InfoBox iframe still has allow-scripts + allow-same-origin (cesium-init.js
   ~line 144). Last XSS->account-takeover link. Needs postMessage bridge for
   466 onclick handlers, not a one-liner.
3. Electron 31 -> 45 then `git tag desktop-v8.1.0 && git push origin desktop-v8.1.0`
   — clears 14 KEV CVEs (incl CVE-2025-2783 Windows sandbox escape) in the
   desktop app's bundled Chromium 126.

## VENICE: key WORKS (tested direct: claude-opus-5-5 returned 200). The
"safety refusal" errors were the overflow, NOT the key, NOT Venice, NOT safety.

## ASSESSMENT DOCS (in repo, served as 404 publicly):
docs/SSP-control-assessment.md, docs/CISA-posture-assessment.md, docs/security-audit.sql
