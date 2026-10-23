# BDOC — CISA Posture Assessment

**Assessed:** 2026-10-23 · **Build:** p158 · **Assessor:** ISSO
**Sources:** CISA KEV catalog **2026.10.21** (1,754 entries, pulled live), CISA Secure by Design pledge goals, BOD 22-01 remediation model.

> BDOC is a private commercial SaaS. BOD 22-01 is binding only on federal civilian
> agencies — but if you sell to emergency management, a buyer will ask whether you
> track KEV and meet Secure by Design. This assesses against both as a commercial
> baseline, not a compliance claim.

---

## 1. KEV exposure — measured against the real stack

Cross-referenced all 1,754 KEV entries against what BDOC actually runs
(Netlify functions, Supabase, Stripe, Cesium, Electron, the npm tree) rather
than a generic vendor list.

| Component | KEV entries | Applies to BDOC? |
|---|---|---|
| **Chromium / V8** | 65 total | **YES — 14 unpatched in the desktop app.** See §2. |
| Electron | 1 | No — matches an unrelated Delta Electronics product |
| Node.js | 1 | No — `systeminformation` npm package, not in our tree |
| OpenSSL | 1 | No — Heartbleed (2014), platform-managed by Netlify |
| Stripe / Supabase / Netlify / Cesium | 0 | No KEV entries exist |

**Web platform: no KEV exposure.** Netlify and Supabase patch their own
runtimes; we hold no server we patch ourselves.

---

## 2. FINDING — 14 known-exploited CVEs ship in the desktop app

**Severity: HIGH. The single most defensible finding in this assessment.**

```
Electron bundled:   31.7.7  →  Chromium 126.0.6478.234 (released 2024-06-11)
Current Electron:   45.0.0  (2026-10-21)
Supported window:   latest 3 majors → 31 is END OF LIFE, receives no security fixes
```

14 Chromium/V8 entries were added to KEV **after** Chromium 126 shipped. Every
one is a vulnerability CISA has confirmed is **actively exploited in the wild**,
and every one is present in the binary your 54 desktop users are running:

| Added | CVE | Class | BOD 22-01 due |
|---|---|---|---|
| 2026-09-09 | CVE-2026-87491 | V8 out-of-bounds write → RCE | 2026-09-23 |
| 2026-09-04 | CVE-2026-85046 | V8 type confusion → RCE | 2026-09-18 |
| 2026-06-09 | CVE-2026-11645 | V8 OOB read/write | 2026-06-23 |
| 2026-03-13 | CVE-2026-3910 | V8 memory bounds | 2026-03-27 |
| 2026-02-17 | CVE-2026-2441 | CSS use-after-free | 2026-03-10 |
| 2025-12-12 | CVE-2025-14174 | ANGLE OOB memory access | 2026-01-02 |
| 2025-11-19 | CVE-2025-13223 | V8 type confusion → heap corruption | 2025-12-10 |
| 2025-09-23 | CVE-2025-10585 | V8 type confusion | 2025-10-14 |
| 2025-07-22 | CVE-2025-6558 | ANGLE/GPU input validation | 2025-08-12 |
| 2025-07-02 | CVE-2025-6554 | V8 type confusion | 2025-07-23 |
| 2025-06-05 | CVE-2025-5419 | V8 OOB read/write | 2025-06-26 |
| **2025-03-27** | **CVE-2025-2783** | **Mojo Windows SANDBOX ESCAPE** | 2025-04-17 |
| 2024-08-28 | (+2 older) | — | — |

**Why this matters more here than for a normal app.** BDOC renders untrusted
remote content: GDELT headlines, AIS vessel names, Meshtastic node names,
Broadcastify and webcam iframes. A V8 RCE plus **CVE-2025-2783 (Windows sandbox
escape)** is a full chain from "user opened a news card" to code execution on
the operator's machine — on a product marketed to people who care about exactly
that.

It also compounds POA&M-2 from the SSP: the InfoBox iframe still carries
`allow-scripts allow-same-origin`.

**Remediation:** upgrade Electron 31 → 45 and cut a new release. Breaking
changes are expected across 14 majors; this needs a real build and a smoke test,
not a version bump. Until then, the web app (which runs in the user's own
patched browser) is the *safer* way to use BDOC — the opposite of what the
desktop download implies.

**Mitigating factor:** p157c made the installed app load the live site when
online, so the *web content* is current. The Chromium *engine* is not.

---

## 3. npm dependency posture — CLOSED THIS PASS

`npm audit --omit=dev` before:

```
critical 1   (proxy-addr — IP spoofing via IPv4-mapped IPv6 trust subnet)
moderate 4   (express, body-parser, qs, ip-address)
```

Reachability assessed before severity was accepted: `express` appears **only**
in `electron/server.js`, the Electron offline localhost server bound to
loopback. Not internet-facing, so real-world exposure was lower than the raw
"critical" label — but `proxy-addr` IP-spoofing in a server that will later back
rate-limiting is exactly the kind of thing to fix before it matters.

After `npm audit fix --omit=dev`: **0 vulnerabilities.**

---

## 4. CISA Secure by Design — pledge goal assessment

| Goal | Status | Evidence |
|---|---|---|
| **1. MFA** | **NOT MET** | No MFA offered to users; owner-account MFA unconfirmed. SSP POA&M-8. |
| **2. Default passwords** | MET | No default or shipped credentials. The hardcoded dev key `KGSBDOC-ADMIN-7X` was removed and the dev path locked to localhost (p149). |
| **3. Reduce vuln classes** | **PARTIAL** | XSS: `esc()`/`safeUrl()`/DOMPurify used broadly, but 83 `innerHTML` sinks remain and `SituationManager` renders 4 fields unescaped. IDOR: closed p158b. Supply chain: SRI + pinned deps, p157. |
| **4. Security patches** | **NOT MET** | Electron 31 is EOL with 14 KEV CVEs. No published patch cadence. |
| **5. Vuln disclosure policy** | **NOT MET** | No `SECURITY.md`, no `security.txt`, no advertised contact. A researcher who finds something today has no way to report it responsibly. |
| **6. CVE transparency** | N/A | No CVEs issued against BDOC. |
| **7. Evidence of intrusions** | **PARTIAL** | `audit_log` written by the Stripe webhook only. No auth-event logging, no alerting. SSP POA&M-7. |

**3 of 7 not met, 2 partial.** Goals 1 and 5 are the cheapest to close and the
two a buyer checks first.

---

## 5. Recommended actions, ranked

| # | Action | Effort | Why this order |
|---|---|---|---|
| 1 | Run `docs/security-audit.sql` §0a | 2 min | SSP POA&M-1. Still unresolved. Outranks everything here — an unenforced paywall is a bigger business risk than a desktop CVE. |
| 2 | Publish `SECURITY.md` + `/.well-known/security.txt` | 30 min | Secure by Design goal 5. Nearly free, and the absence is conspicuous on a security product. |
| 3 | Enable Supabase leaked-password protection + MFA on owner accounts | 15 min | Goal 1. Dashboard toggles. |
| 4 | Electron 31 → 45, cut `desktop-v8.1.0` | ~half a day | Clears all 14 KEV CVEs. Needs a real build + smoke test across 14 majors. |
| 5 | Commit the `npm audit fix` lockfile | done | Already applied this pass. |
| 6 | KEV monitoring cron | 1 hr | Weekly diff of the KEV catalog against the stack; alert only on a hit. Turns this one-off into posture. |

---

## 6. Honest summary

**Web app: clean on KEV.** Zero known-exploited vulnerabilities apply to the
hosted surface, dependencies are now clean, and the headers are complete.

**Desktop app: 14 actively-exploited CVEs**, including a Windows sandbox escape,
in an EOL Chromium. That is the finding a competent red team leads with, and the
one an agency buyer's scanner will surface without a human involved.

**Process: the gap is disclosure and patch cadence, not controls.** BDOC has
real security engineering in it now — what it lacks is the paperwork that proves
it: a way to report a vulnerability, a stated patch window, and MFA.

Nothing in the KEV catalog implicates Netlify, Supabase, Stripe, or Cesium.
The exposure is entirely in the one component we compile ourselves and have not
updated in 16 months.
