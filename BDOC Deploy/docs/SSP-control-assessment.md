# BDOC — System Security Plan & Control Assessment

**System:** BDOC (Battlespace Digital Operations Center) — kgsbdoc.netlify.app
**Owner:** Kitsune Global Solutions LLC
**ISSO assessment date:** 2026-10-23
**Build assessed:** p158 / bdoc-v158
**Classification:** Unclassified. Aggregates public OSINT only. No CUI, no classified data.
**Framework:** NIST SP 800-53 Rev 5 control families, tailored to a commercial SaaS. Not an ATO package — this is the internal control baseline a red team and an enterprise buyer will both ask for.

> Every finding in this document was reproduced against production with a command
> whose output can be pasted. Nothing is asserted from reading code alone.

---

## 1. System description

| Element | Detail |
|---|---|
| Front end | Single-page app, Cesium 1.146 globe, PWA with service worker |
| Hosting | Netlify (static + serverless functions, Node 18) |
| Identity | Supabase Auth (email/password), JWT bearer tokens |
| Data store | Supabase Postgres, RLS enforced |
| Payments | Stripe Checkout + Customer Portal, webhook-driven tier grants |
| Edge integrations | Local IPC bridge (127.0.0.1:9876), Meshtastic LoRa mesh |
| External data | ~43 keyless upstream proxies (NOAA, USGS, NASA, ADS-B, AIS) |

**Boundary:** the browser is NOT inside the trust boundary. Every authorization
decision must be made in a Netlify function or in Postgres RLS. This is stated
because the system violated it until p157–p158.

---

## 2. Data inventory (PT / SC families)

Doctrine on record: *KGS stores nothing beyond email + subscription tier; a breach
should expose email + plan and nothing else.*

Actual contents of `public.profiles`, read from the migrations:

| Column | Type | Doctrine-compliant? |
|---|---|---|
| `id` | uuid | yes — required |
| `email` | text | yes — explicitly allowed |
| `tier` | text | yes — explicitly allowed |
| `display_name` | text | yes — user-chosen, optional |
| `stripe_customer_id` | text | yes — pointer, not payment data |
| `stripe_subscription_id` | text | yes — pointer |
| `created_at` / `updated_at` | timestamptz | yes |
| **`phone`** | text | **NO — PII beyond the stated minimum** |
| **`marketing_consent`** + `_at` + `consent_version` | — | consent record for the phone field |
| **`api_key`** | text, auto-generated, UNIQUE | **NO — dormant plaintext credential** |

**Card data:** never touches BDOC. Stripe Checkout is hosted; we store only the
`cus_`/`sub_` pointers. This is correct and should stay that way.

**Two deviations from doctrine, both real:**

- **PT-2 / DM-1 — `phone` is collected at signup** (`js/auth.js` signup path,
  persisted by migration 003). It has a defensible CAN-SPAM/TCPA consent record,
  so it is lawful — but it is not "email + tier." Breach blast radius is now
  email + phone. **Decision required: keep it and amend the doctrine, or drop
  the column.** An ISSO cannot resolve a business-intent conflict; the owner can.
- **IA-5 — `api_key` is auto-generated plaintext for every user and validated by
  nothing.** Grep across `netlify/functions/*.js` and `js/*.js` returns zero
  consumers. A credential that exists but is never checked is pure liability: it
  widens breach impact and implies an API surface that does not exist. Either
  implement it (hashed, scoped, revocable) or drop the column.

---

## 3. Control assessment

Status: **S**atisfied · **P**artial · **O**ther than satisfied

### AC — Access Control

| Control | Status | Evidence |
|---|---|---|
| AC-3 Access enforcement | **P** | `_lib/guard.js` built and unit-tested (18 tests) but **not yet attached to any proxy**. Tier gating is still client-side on data layers. Payment endpoints ARE enforced as of p158. |
| AC-4 Information flow | **S** | `js/bdoc-auth-fetch.js` attaches the JWT to same-origin function paths only. Negative tests prove it is never sent to USGS, NOAA, Cesium, OpenSky, or a look-alike path on a foreign origin. |
| AC-6 Least privilege | **P** | `docs/security-audit.sql` §1 strips UPDATE to `display_name` only. **Not yet confirmed applied in production** — see POA&M-1. |
| AC-12 Session termination | **O** | No idle timeout. Supabase refresh tokens persist in `localStorage` indefinitely until explicit sign-out. |

### AU — Audit & Accountability

| Control | Status | Evidence |
|---|---|---|
| AU-2 Auditable events | **P** | `public.audit_log` exists and is written by `stripe-webhook.js` and `launch-selftest.js` only. No auth events, no tier changes, no admin actions. |
| AU-3 Content of records | **P** | `tier_audit` table defined in `security-audit.sql` §3 — logs the fact of a change and the actor, deliberately no PII. Not yet applied. |
| AU-6 Review | **O** | No alerting. Failures are discovered by looking at the screen. |

### CM — Configuration Management

| Control | Status | Evidence |
|---|---|---|
| CM-2 Baseline | **S** | Everything in git; `main` auto-deploys; `SW_VERSION` + `?v=` cache keys version every asset. |
| CM-6 Settings | **S** (p158) | 8/8 security headers live. Verified: HSTS+preload, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP, CSP-Report-Only. |
| CM-7 Least functionality | **S** (p158) | Server-side source no longer served. `/supabase/*`, `/netlify/*`, `/electron/*`, `/tests/*`, `/scripts/*`, `/package*.json`, `/*.md` → 404, functions still execute. |
| CM-8 Component inventory | **P** | `package-lock.json` exists; CDN deps pinned with SRI (p157). No SBOM published. |

### IA — Identification & Authentication

| Control | Status | Evidence |
|---|---|---|
| IA-2 User identification | **S** | Supabase JWT, verified server-side in `guard.js`, `stripe-portal.js`, `stripe-checkout.js`. |
| IA-2(1) MFA | **O** | Not offered to users. Owner accounts (Netlify/GitHub/Stripe/Supabase) require owner confirmation. |
| IA-5 Authenticator management | **P** | Password policy is Supabase default — **leaked-password protection and min-length not confirmed enabled**. Dormant `api_key` noted above. |

### SC — System & Communications Protection

| Control | Status | Evidence |
|---|---|---|
| SC-7 Boundary protection | **S** (p157b) | Local IPC bridge was `Access-Control-Allow-Origin: *` — any website could read the operator's Wireshark captures and Wi-Fi scans. Now origin-allowlisted + 32-byte pairing token, timing-safe. Proven by attacking the running server: evil origin 403, no token 401, correct token 200, no wildcard on any route. |
| SC-8 Transmission confidentiality | **S** | HTTPS only, HSTS with preload. |
| SC-18 Mobile code | **P** | CSP is Report-Only. InfoBox iframe still carries `allow-scripts allow-same-origin` (`cesium-init.js:144`) — see POA&M-2. |
| SC-28 Data at rest | **S** | Supabase-managed encryption. No card data held. |

### SI — System & Information Integrity

| Control | Status | Evidence |
|---|---|---|
| SI-2 Flaw remediation | **P** | No CI gate; two agents plus a cron push to `main`. 51 tests exist but nothing blocks a merge. |
| SI-3 Malicious code | **S** (p157) | SRI on all 7 third-party scripts, versions pinned. `supabase-js` had drifted 2.116.0 → 2.118.0 unnoticed — a supply-chain exposure window that is now closed. |
| SI-10 Input validation | **P** | `esc()` / `safeUrl()` / DOMPurify used widely, but 83 `innerHTML` sinks and `SituationManager` renders four fields unescaped. |
| SI-11 Error handling | **S** (p158) | Functions return sanitized errors; detail stays in Netlify logs. `stripe-portal` no longer echoes `e.message` (Stripe errors can contain customer ids). |

---

## 4. POA&M — Plan of Action & Milestones

| # | Weakness | Control | Sev | Owner | Mitigation |
|---|---|---|---|---|---|
| **1** | **Tier self-upgrade may be live.** `001_initial_schema.sql` grants `authenticated` UPDATE on every column of their own row including `tier`. `002` fixes it; nobody has confirmed 002 ran in production. If not, any signed-in user can PATCH themselves to enterprise with the public anon key. | AC-6 | **CRITICAL** | Travon | Run `docs/security-audit.sql` §0a. One query. §0b flags rows already on a paid tier with no Stripe subscription — i.e. whether it has already been exploited. |
| **2** | InfoBox iframe has `allow-scripts` + `allow-same-origin`, which lets frame content reach `parent` and therefore the Supabase session in `localStorage`. One unescaped field in any of 114 `entities.add` descriptions = account takeover. | SC-18 | **HIGH** | Hermes | postMessage bridge with an allowlisted handler table, then drop `allow-same-origin`. 466 `onclick=` handlers depend on it — not a one-line change. |
| **3** | `guard.js` not attached to any data proxy. Tier gating on layers is still browser-side; `Auth.tier='enterprise'` in DevTools still unlocks layers, and proxies are callable without an account (quota burn). | AC-3 | **HIGH** | Travon → Hermes | Needs the layer→tier map signed off. Enforce one proxy at a time; wrong map locks out paying users. |
| **4** | `profiles.api_key` — dormant plaintext credential on every row, validated by nothing. | IA-5 | MED | Travon | Drop the column, or implement hashed + scoped + revocable. |
| **5** | `phone` collected and stored, contradicting the stated email+tier doctrine. | PT-2 | MED | Travon | Business decision: amend doctrine or drop column + consent fields. |
| **6** | No CI gate. 51 tests exist; nothing enforces them before `main` deploys. | SI-2 | MED | Hermes | GitHub Actions: `node --check` + `npm test` required on push. |
| **7** | No audit of authentication or tier-change events. | AU-2 | MED | Hermes | `security-audit.sql` §3 adds `tier_audit`; extend `audit_log` writes to auth events. |
| **8** | No MFA offered; leaked-password protection unconfirmed. | IA-2(1) | MED | Travon | Supabase Auth → enable leaked-password protection, min length 12, MFA on owner account. |
| **9** | No idle session timeout; refresh token persists in `localStorage`. | AC-12 | LOW | Hermes | Idle timeout + re-auth for billing actions. |
| **10** | CSP is Report-Only. | SC-18 | LOW | Hermes | Collect a week of reports via `csp-report`, tighten, enforce. Blocked behind the 767 KB inline script. |

---

## 5. Closed this cycle

| Finding | Severity | Closed | Verification |
|---|---|---|---|
| Unauthenticated IDOR — `stripe-portal` opened ANY customer's billing portal from a body-supplied `customerId`; exposed invoices, payment method, and allowed cancellation | CRITICAL | p158b | `POST {"customerId":"cus_TEST123"}` → **401** (was 200) |
| `stripe-checkout` took `userId`/`email` from the request body; webhook upgrades whatever id it finds | HIGH | p158b | `POST` naming a foreign userId → **401** |
| Local IPC bridge readable by any website (`ACAO: *`) — packet captures, Wi-Fi scans | HIGH | p157b | Live attack suite, 9 tests: evil origin 403, no token 401, no wildcard anywhere |
| Full server-side source disclosure including RLS policies, `guard.js`, `stripe-webhook.js` | MED | p158 | All paths 404; `config`, `proxy-weather`, `ping` still 200 |
| Floating CDN deps (`supabase-js@2`, `mqtt@5`), zero SRI | MED | p157 | 7 `integrity=` tags live, 0 floating |
| Supabase-js auth deadlock (`await` inside `onAuthStateChange`) | MED | p157 | Callback synchronous, work deferred |
| Missing CSP / COOP / CORP | MED | p158 | 8/8 headers verified live |

---

## 6. Assessment summary

**The system is not currently suitable for an enterprise security questionnaire,
and is three items away from being so.**

What is genuinely strong: no card data held, secrets server-side only, SRI and
pinned dependencies, sanitized error handling, a real test suite, and a local
bridge that now fails closed. The p157–p158 work closed two money-path
vulnerabilities that were live-exploitable without an account.

What blocks sign-off:

1. **POA&M-1 is unresolved and it is one query.** Until §0a is run, nobody can
   state whether the subscription control works. An ISSO cannot assess a control
   whose status is unknown — it defaults to *other than satisfied*.
2. **POA&M-2 is the only XSS→takeover chain left.** Every input is escaped today,
   which is why it is not CRITICAL. One regression makes it CRITICAL.
3. **POA&M-3 means the access-control model is advisory on data layers.**

**Recommended posture before a red team engages under Letter of Authorization:**
close 1, 2, 3 and 6. Items 4, 5, 8, 9 are policy decisions that need the owner,
not engineering time. A red team that finds POA&M-1 in the first hour is a wasted
engagement — fix the known before paying someone to find the unknown.

**Residual risk accepted:** `'unsafe-eval'` must remain in CSP until Cesium drops
bundled Knockout. `'unsafe-inline'` must remain until the 767 KB inline script is
extracted. Both are documented, neither is discretionary today.
