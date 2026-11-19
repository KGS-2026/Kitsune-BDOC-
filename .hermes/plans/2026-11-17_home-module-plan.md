# Home-defense module ("Home / Base"): plan of record

**Status, 2026-11-17: proposed, not approved.** T200 (bootstrap) is built and
committed on branch `claude/p200-home-bootstrap`. That branch is pushed but **not merged** to `main`. T201, the
decision whether BDOC takes on a home backend at all, belongs to Travon and has
not been made. Nothing after T200 has been started.

**Where it came from:** a spec Travon pasted from another AI chat on 2026-11-17.
He asked for whatever can be applied "without breaking it ... let's protect the
customers". §3 reproduces the spec as given. §1 and §2 are Claude Code's notes
on what it means for this repo.

---

## 1. Conventions T200 fixed (so every check agrees)

| Piece | Where it lives | Guarded by |
|---|---|---|
| Relay tier (T203): enroll, frame and image endpoints | `relay/` at the repo root, its own deploy | inv02 inv04 inv05 inv07 inv11 inv12 |
| Hub code (T207 plans a separate repo) | `hub/` only if it ever lands here | inv02 inv07 inv08 |
| Frame code (T209) | any file in `relay/`, `hub/`, `frame/` or `js/home/` that names `FRAME_LEN` or `BDOS-v1` | inv03 |
| Client module `BDOC.Home` (T215) | `BDOC Deploy/js/home/` | inv01 inv04 inv06 inv11 |
| Schema `home` (T204) | SQL that creates or touches schema `home` | inv06 inv11 |
| Home keys, bucket and secrets | env vars named `BDOC_HOME_*`, read only by the relay | inv11 |
| New endpoints and config | declared in `BDOC Deploy/tests/public-surface.inventory.json` | inv12 + public-surface test |
| Every suppression | `.ci/allowlist.json`, with a reason, who accepted it, a date and an expiry | inv09 |

`p188b` (another session's WIP) adds `netlify/functions/home-hook.mjs` for
smart-home webhooks. That is not this module, and the names above were chosen
so the checks don't mistake it for one. Invariant 2 still conflicts with it in
substance: see §2.

How to run: `node .ci/invariants/run.js` (table), `node .ci/secret-scan.js`,
and the whole gate with `bash scripts/ci-validate.sh`. `.ci/README.md` explains
the statuses.

## 2. Read this before T201

**The posture premise is wrong.** The spec says "the zero-backend posture ends
for this feature". BDOC already runs a backend: Supabase (Postgres and Auth),
79 Netlify functions, Netlify Blobs, the droplet's `bdoc-wire` collector and
Stripe webhooks. The real T201 question is narrower and harder: **does BDOC add
a second, isolated backend that stores pictures from inside customers' homes?**
That carries legal, privacy and liability weight that no map feature has.

**Blocked: the SPEC is missing.** The spec cites SPEC §6 (policy bounds), §8
(score weights), §11 (the six breach checks) and §12 (the tables). That document
was never provided. T204, T206, T214, T217 and T220 cannot start until it
exists. Inventing it would mean inventing the requirements.

**Hardware.** T207 to T214 and T217 to T219 need:
- a hub device with TPM 2.0, Linux, and a Wi-Fi radio that runs hostapd with WPA3-SAE;
- Go and Rust toolchains;
- real cameras;
- a separate repo (T207 says so).

None of that exists on this laptop or the droplet. Gates like "deauth on A
survived" and "SAE flood restarts radio" need a radio lab.

**Would break current customers if done as written:**
- **T205 demotes Google sign-in.** Every current customer signs in through Supabase Auth with Google or email. Replacing that with WebAuthn-first, opaque server sessions is a migration project with its own plan, not one task.
- **T216: "no `unsafe-inline` in `script-src`".** That blanks the app today. `index.html` carries a ~767 KB inline script, per the netlify.toml comment. The inline script has to be extracted first, which is a large job of its own.

**Applies to today's customers without any hub** (logged in HANDOFF §2 Z):
- **Desktop navigation filter.** The `will-navigate` handler in `electron/main.js` tests whether the URL's text starts with `http://localhost:9080`. That is a text test, not an origin test, so a crafted link can load an outside page inside the desktop window. The window has no address bar, which makes this an in-app phishing path. The sign-in exception also accepts any `*.supabase.co` host, not just BDOC's project. Fix: compare `new URL(url).origin` and pin BDOC's Supabase host. Needs a desktop release. (Electron has sandboxed the main window by default since v20, and the app is on ^31, so that part is fine.)
- **Sign-out leaves cached data.** Sign-out (`js/auth.js`) clears the tier keys but not the service-worker caches.
- **CDN styles without integrity hashes.** Cesium's `widgets.css` is loaded twice, from two CDNs, without SRI. Cesium's JavaScript does have SRI.
- **CSP not enforced.** It is still Report-Only.
- **AISStream key in the page.** This is §2 W: Travon rotates it, then it moves behind a relay. inv05 shows it as an open violation. Its allowlist entry runs out after 2026-12-31, and from 2027-01-01 the gate **fails**.

**Conflict with p188b.** Smart-home webhooks POST from BDOC's servers to a URL
the customer provides, which is usually their home-automation hub. That means
the customer exposes an inbound endpoint into their home, and invariant 2 says
nothing dials into a home. Decide which wins before both ship.

**Public repo.** Everything committed here is readable on GitHub. The T202 threat
models would list accepted risks. Either keep them out of the repo until it goes
private (approved 2026-10-31, waiting on the releases repo), or accept that they
are public.

**Numbering.** The spec's `p200` to `p220` will collide with regular releases,
which are at p188. Options:
- regular releases skip from p199 to p221;
- or home tasks use `h200` and up.

Travon's call. T200 used `p200` as the spec asks.

| Task | Needs | Can start here? |
|---|---|---|
| T200 bootstrap | CI and tests | **Done** on the branch (pushed, not merged) |
| T201 posture ADR | Travon's decision | Waiting on him |
| T202 threat models | Docs (public repo: see above) | Yes, once T201 says go |
| T203 relay tier | A separate deploy (Netlify site or Supabase project), a private bucket, env vars | Needs Travon to create the accounts |
| T204 schema + RLS | SPEC §12 | Blocked: SPEC missing |
| T205 auth | A sign-in migration plan | Would break sign-in as written |
| T206 breach harness | SPEC §11 | Blocked: SPEC missing |
| T207–T214 hub | Hardware, Go/Rust, separate repo, radio lab | No |
| T215 UI | The hub (the spec puts it after T214 on purpose) | After T214 |
| T216 client hardening | Parts apply today (above) | Yes, as normal releases |
| T217 score | SPEC §8 | Blocked: SPEC missing |
| T218 dead-man | Hub + relay | After T210 |
| T219 certification | Wi-Fi / BLE test rig | No |
| T220 breach pass | All of the above | Last |

---

## 3. The spec as given (2026-11-17)

Add a home-defense module to Kitsune BDOC. A hardened in-home hub relays alerts and normalized images one direction into BDOC. The app is assumed compromised. Build the containment that survives it.

Read `README.md`, `LAUNCH_READINESS_AUDIT.md`, `.hermes/plans/`, and the last five HANDOFF commits before writing anything.

**EXISTING STACK — do not replace it**
Vanilla JS modules, HTML, CSS. CesiumJS globe. Service worker (`sw-vNNN`), versioned module list. Electron desktop builds with a navigation filter. Netlify deploy. Stripe entitlements. Google sign-in. Postgres/PLpgSQL. Python for proxy scripts. No framework, no build step to add.

**INVARIANTS — CI-enforced**

1. App has no network path to hub or tunnel. Relay only.
2. Hub initiates all connections. No inbound dial to the home.
3. Frame: exactly 74 bytes, fixed offsets, no length, no TLV, no JSON, no runtime negotiation.
4. No camera-original bytes reach the app. Hub re-encodes, strips metadata, owns filenames.
5. No durable credential in the client. Per-request minting, ≤15m.
6. Per-object authz, deny-by-default. Tenant isolation via Postgres RLS, never client `WHERE`.
7. Parameters enforced hub-side. Cloud changes are requests the hub may reject.
8. Model artifacts load by commit SHA + hash + signature only.
9. Every suppression logs a reason.
10. No global security claim. Per-tier only.
11. Home data never joins map state. Separate schema, separate bucket, separate keys.
12. Every new endpoint and config file is added to the public-surface test.

**OPERATING RULES**
One task per session. Gate green before the next. Tests first. One commit per task, `p2NN: ` prefix, HANDOFF-style body. No cross-task refactors. ADR in `.hermes/plans/adr/` before any invariant break. Paste gate output, don't summarize.

**T200 — Bootstrap.** Invariants 1–12 as checks in `.ci/invariants/`. Extend the public-surface test to enumerate `relay/`, `.env*`, and any new config. Add SAST + secret scan + SBOM to the existing workflow. Write `/CLAUDE.md` pointing here.
Gate: `npm test` green, all 12 invariant checks wired, public-surface test fails on a deliberately leaked config file. Commit.

**T201 — ADR: posture change.** Write `.hermes/plans/adr/0001-home-module-storage.md`. State plainly that the zero-backend posture ends for this feature, scope the exception to one relay, one schema, one bucket, one key hierarchy, and record what the globe still does not store. This is the identity decision — do it before code.
Gate: ADR merged with the exception scoped line by line. Commit.

**T202 — Threat models.** `/spec/threat/enrollment.md` first, then `transport.md`, `camera-ingest.md`, then `client.md` — covering service-worker cache, Electron navigation filter, Google sign-in, and hash deep links. STRIDE per boundary, each entry mapped to a control or a signed accepted risk. Assume the IoT segment is hostile.
Gate: every entry mapped or signed off. Commit.

**T203 — Relay tier.** Smallest possible: one edge function set (enroll, frame, image), one object bucket, one Postgres schema `home`. No shared code with map paths. Bucket private, presigned reads only, per-tenant prefix.
Gate: `home` schema absent from every map query; bucket public access off; netpol shows relay cannot reach the tunnel. Commit.

**T204 — Schema + RLS.** Tables per SPEC §12 in `home`. `tenant_id` everywhere, RLS enabled and forced, `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. Wrapper sets the setting, fails closed when unset. `disclosures_accepted` append-only by trigger.
Gate: cross-tenant select returns 0 rows with client filtering removed. Commit.

**T205 — Auth.** WebAuthn primary. Google sign-in demoted to secondary. TOTP fallback. Argon2id on password paths. Opaque server sessions, device-bound, 12h/30m, revocation checked per request. Per-account and per-IP throttle. Identical body and identical hash work for unknown-user vs bad-credential.
Gate: timing delta <15ms over 1000 iterations; revoked session fails on next request. Commit.

**T206 — Authz + breach harness.** Per-object resolution before return. Cross-tenant denial hard-fails the session; others log. Scaffold `/tests/breach` with all six SPEC §11 checks as failing tests.
Gate: harness fails in exactly six expected ways. Commit.

**T207 — Hub skeleton.** Go binary, separate from the web repo. systemd hardening flags, read-only rootfs, tmpfs `/var`. Egress allowlist: relay, NTP, dead-man. Config parser rejects unknown keys.
Gate: 10-minute idle `strace` shows no egress outside allowlist. Commit.

**T208 — Enrollment + attestation.** TPM quote or Secure Enclave. Per-hub cert issued only on valid quote. Relay pins, checks CRL. One-time enroll; re-enroll needs the old cert or physical proof.
Gate: cloned image fails enroll; revoked cert refused. Commit.

**T209 — Frame parser.** Rust `no_std` + FFI. `seq:u64BE | type:u8 | flags:u8 | sig:ed25519[64]` = 74. Sig over the 74 with sig zeroed, prefixed `BDOS-v1`. Reject length ≠ 74, reject seq outside a 64-wide window. 12 types, 4 reserved. Reject tests and fuzz target before implementation.
Gate: 1M corpus clean, zero panics, zero allocs on reject path. Commit.

**T210 — Transport.** Hub-initiated mTLS, backoff with jitter, 30s heartbeat. Relay verifies, never mints. Reject envelope skew >60s.
Gate: tunnel survives 10 min relay downtime and re-establishes; skew rejected. Commit.

**T211 — Ingest.** Stateless beyond the dedupe window on `(hub_id, seq)`. Verify, dedupe, append. Egress: store, dead-man.
Gate: replayed seq rejected; 100k burst with bounded memory; peak RSS reported. Commit.

**T212 — Normalizer.** Decode, fixed dimensions, re-encode JPEG q80/WebP, strip EXIF/XMP/IPTC, own ULID names. Reject on failed re-encode. ONVIF: scheme allowlist, reject `file://`, reject private-range unless subnet-matched, 5s timeout, 10MB cap.
Gate: EXIF-laden input arrives metadata-free; `file://` and metadata-IP rejected. Commit.

**T213 — AP control.** SSID A: WPA3-SAE, PMF required. SSID C: WPA2-PSK, PMF capable, MAC allowlist. Per-device 63-char CSPRNG PSK, hashed. Isolation on both. SAE commit limit + radio watchdog. Fingerprint-driven auto-assignment, no user choice.
Gate: deauth on A survived; SAE flood restarts radio; WPA2-only camera lands on C automatically. Commit.

**T214 — Policy engine.** Signed policy blob, reject-on-invalid, last-known-good retained. SPEC §6 bounds. `POLICY_REJECT` on refusal. Auto-isolate on anomaly; auto-harden with 24h confirm-or-revert.
Gate: out-of-bounds refused; unsigned blob rejected with LKG retained. Commit.

**T215 — UI integration.** New collapsible layer group `Home / Base` matching existing layer-panel conventions. Vanilla JS module, `BDOC.Home` namespace. Hub list, camera list, alert feed, image viewer. Both captured-at and received-at rendered. Permanent tier badge. Score panel with top three fixables and bounded sliders with `why` strings. Deep links use opaque IDs only.
Gate: layer group collapses like its siblings; alert feed renders in the mobile card pattern; deep link contains no tenant name. Commit.

**T216 — Client hardening.** CSP covering Cesium: `worker-src 'self' blob:`, `blob:` for workers, SRI on every CDN asset, or bundle Cesium. `contextIsolation: true`, `nodeIntegration: false`, narrow preload bridge. Electron navigation filter extended to the relay domain. SW cache namespaced per tenant, purged on sign-out, `sw-vNNN` bumped.
Gate: CSP has no `unsafe-inline` in `script-src`; sign-out purges the tenant cache; navigation filter blocks a non-allowlisted host. Commit.

**T217 — Score.** SPEC §8 weights and caps, computed hub-side, never self-reported. Bands gate features. Stripe entitlement checked server-side, never a client flag.
Gate: spoofed self-report doesn't move the score; client-flag flip without entitlement fails. Commit.

**T218 — Dead-man + observability.** 30s heartbeat, three misses → out-of-band alert independent of primary push. Hub-local alarm on egress loss. Hash-chained audit, append-only export, retention job.
Gate: 90s silence fires; audit chain verifies; row tamper breaks verification. Commit.

**T219 — Certification harness.** PMF survival, WPA3 downgrade resistance, cert chain/expiry/cipher, 554 fallback, band, firmware signing, BLE disable. Four gates: protocol, TLS quality, firmware hygiene, BLE. Writes `certified_models`.
Gate: known-good and known-bad both classify correctly. Commit.

**T220 — Breach pass.** All six must pass. Failure is a fix task, not a waiver.
Gate: six green. Commit.

**STOP AND ASK WHEN** an invariant blocks the obvious path · Cesium or the SW fights a control · a Stripe entitlement can't be checked server-side · two tasks conflict · a gate needs scope growth · you'd cross a phase boundary.

**DONE:** T200–T220 committed, gates green, six-for-six, threat models complete, ADRs for every deviation, public-surface test covering all new surface.

Two placement notes. T201 is second because the posture decision outranks any code — if you write the relay before deciding what it may store, you'll drift into a second backend. And T215 sits after the hub, not before, because a UI built against an imagined hub will encode assumptions the frame parser then has to live with.
