# CLAUDE.md — Kitsune-BDOC- (repo root)

Claude Code loads this in every session that opens this repo. Keep it short.

- **The app lives in `BDOC Deploy/`.** Read `BDOC Deploy/CLAUDE.md` and
  `BDOC Deploy/HANDOFF.md` (§0 hard rules, §1–2 state and open items) before
  changing anything. A push to `main` deploys to production.
- **This repo is public.** Never commit a key, token, `.env` or key file.
  `node .ci/secret-scan.js` and the test suite fail on them, and CI runs gitleaks.
- **Gate before every commit:** `bash scripts/ci-validate.sh` (needs node and
  python3). It runs syntax checks, the test suite, the twelve invariants and the
  secret scan.
- **New endpoint or config file?** Declare it in
  `BDOC Deploy/tests/public-surface.inventory.json`. The public-surface test
  fails until you do.
- **Suppressing a finding?** Add an entry to `.ci/allowlist.json` with a reason,
  who accepted it, a date and an expiry. There are no other exceptions.
  See `.ci/README.md`.

## Home-defense module: proposed, NOT approved

Plan: `.hermes/plans/2026-11-17_home-module-plan.md`.

Status 2026-11-17: the T200 bootstrap is on branch
`claude/p200-home-bootstrap` (pushed, not merged to `main`). T201 decides whether BDOC adds a
home backend at all. That decision is Travon's and has not been made, so do not
start T201 or later until he decides.

When working on it:
- one task per session;
- tests first, and the gate green before the next task;
- one commit per task, with a `p2NN:` subject and a HANDOFF-style body (the plan's §2 covers the numbering clash);
- an ADR in `.hermes/plans/adr/` before any invariant break.

The invariants are in `.ci/invariants/`.
