# TASK FOR CLAUDE CODE — BDOC Secret Exposure Audit & Remediation

**Written by:** Hermes, 2026-06-09
**For:** Claude Code running on Travon's laptop with filesystem access
**Repo:** `Kitsune-BDOC-` → working dir is the `BDOC Deploy/` subfolder
**Live site:** https://kgsbdoc.netlify.app/
**Branch rule:** Work on a branch. Never commit straight to `main`. Branch name: `claude-security-audit`

---

## WHY THIS TASK EXISTS

Recon on five commercial mapping products (WeatherWise, Liveuamap, Apple Maps, Google Maps, ADS-B Exchange) turned up the same class of bug in three of them:

- **WeatherWise** ships a Mapbox **secret-scope** token (`sk.…`, username `uzdriver`) in plaintext in their client bundle. A secret-scope token can create/delete tilesets and read account data — not just render maps.
- **Liveuamap** ships an unrestricted public `pk.` Mapbox token with no referrer lock, so anyone can spend their tile quota.
- **BDOC's own teardown (2026-08-17)** flagged that a Google Maps key is exposed via `/.netlify/functions/config`, plus a `bdoc_dev_key` sitting in localStorage.

Google Maps Dynamic Maps billing is **$0.007 per map load** with only 10,000 free loads/month. An unrestricted exposed key is a **billing denial-of-service**: someone can run up a four-figure bill in a weekend. This is the cheapest possible catastrophic failure and it takes about an hour to close.

**Goal:** no credential that can spend money or write data is reachable from a browser, and CI fails the build if one ever gets reintroduced.

---

## GROUND RULES (read before touching anything)

1. **The Supabase `anon` key in client JS is CORRECT and EXPECTED.** Do not remove it. It is designed to be public. What protects the data is Row Level Security, not secrecy. Do not "fix" it.
2. **The Supabase `service_role` key must NEVER be client-reachable.** If you find one, that is a P0.
3. **Do not rotate any key yourself.** Hermes' standing doctrine is: *Hermes flags, the operator rotates.* You identify and report; Travon does the rotation in each vendor console. Same rule applies to you.
4. **Do not commit a real secret into the repo to "test" the scanner.** Use an obviously fake string like `sk_live_FAKE_FOR_TESTING_ONLY_0000`.
5. **Do not delete anything you cannot explain.** If a key's purpose is unclear, report it rather than removing it — a wrong removal breaks a live layer.
6. Verify every claim you make with actual command output. Do not report "fixed" without showing the passing check.

---

## STEP 1 — INVENTORY (read-only, no changes yet)

Run each of these from `BDOC Deploy/` and save the raw output. Do not fix anything yet — build a complete picture first, because a partial fix that misses one path is worse than none.

### 1a. Scan the shipped client surface

These are the files a browser can actually download. That is the only thing that matters for exposure.

```bash
# High-signal credential patterns
grep -rnE "(sk_live_|sk_test_|service_role|AIza[0-9A-Za-z_-]{35}|sk\.eyJ|pk\.eyJ|ghp_|github_pat_|xoxb-|AKIA[0-9A-Z]{16})" \
  --include="*.html" --include="*.js" --include="*.json" --include="*.css" \
  . | grep -v node_modules | grep -v "/netlify/functions/"

# Long JWTs (Supabase keys are JWTs — you must then decode to tell anon from service_role)
grep -rnoE "eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}" \
  --include="*.html" --include="*.js" . | grep -v node_modules | head -40

# Generic assignment-style leaks
grep -rniE "(api[_-]?key|secret|password|token|bearer)\s*[:=]\s*['\"][A-Za-z0-9_\-]{16,}" \
  --include="*.html" --include="*.js" . | grep -v node_modules | head -40
```

### 1b. Decode every JWT you found

A Supabase JWT tells you its own role. This is how you distinguish a harmless `anon` key from a catastrophic `service_role` key:

```bash
# Replace <JWT> with each token found above
echo '<JWT>' | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | python3 -m json.tool
```

Look at the `"role"` field.
- `"role": "anon"` → **fine, expected, leave it alone.**
- `"role": "service_role"` → **P0. Flag immediately, loudest possible.**

### 1c. Audit the config function — the known finding

The teardown specifically called out `/.netlify/functions/config`. Check what it hands out:

```bash
cat netlify/functions/config.js
curl -s https://kgsbdoc.netlify.app/.netlify/functions/config | python3 -m json.tool
```

For **every** key it returns, answer these three questions in your report:
1. What is it for?
2. Can it spend money or write data?
3. Is it domain/referrer-restricted in the vendor console?

Anything that can spend money and is unrestricted is a finding.

### 1d. Check what's actually live in prod

The repo and prod can drift. Check the real deployed bundle, not just local files:

```bash
curl -s https://kgsbdoc.netlify.app/index.html \
  | grep -oE "(AIza[0-9A-Za-z_-]{35}|pk\.eyJ[A-Za-z0-9._-]+|sk\.eyJ[A-Za-z0-9._-]+)" | sort -u

for f in $(curl -s https://kgsbdoc.netlify.app/index.html | grep -oE 'js/[a-z0-9/_.-]+\.js' | sort -u); do
  echo "--- $f"
  curl -s "https://kgsbdoc.netlify.app/$f" \
    | grep -oE "(AIza[0-9A-Za-z_-]{35}|sk_live_[A-Za-z0-9]+|service_role|sk\.eyJ[A-Za-z0-9._-]+)" | sort -u
done
```

### 1e. Client-side storage

The teardown flagged `bdoc_dev_key` in localStorage:

```bash
grep -rn "bdoc_dev_key\|dev_key\|devKey\|KGSBDOC-ADMIN" --include="*.js" --include="*.html" . | grep -v node_modules
```

Determine what it actually unlocks. If it gates paid features client-side only, that is a **paywall bypass**, not just an information leak — anyone can read it in DevTools and set it themselves. Report it as such. Entitlement must be enforced server-side (this is the WeatherWise "entitlement = socket room denial" pattern: a free user should never be *able* to fetch the expensive thing, not merely be told not to).

### 1f. Verify RLS is actually on

The anon key is safe **only** if RLS is enforced. Confirm, don't assume:

```bash
grep -rn "supabase" netlify/functions/*.js | grep -iE "service|admin|createClient" | head -20
```

Then in the Supabase dashboard (Travon will need to do this part or grant access): confirm every table under Authentication → Policies has RLS **enabled** with at least one policy. A table with RLS off and an anon key in the client is world-readable and world-writable.

---

## STEP 2 — REMEDIATE

Order matters. Do the highest-severity first and verify each before moving on.

### Priority order

| Severity | Finding | Action |
|---|---|---|
| **P0** | `service_role` JWT, `sk_live_` Stripe key, or any `sk.` Mapbox token in client code | Move server-side immediately, flag for rotation |
| **P0** | Any table with RLS disabled | Report to Travon — do not change DB policy yourself |
| **P1** | Google Maps `AIza…` key unrestricted | Restrict by HTTP referrer, or remove the dependency |
| **P1** | Client-only entitlement gate (`bdoc_dev_key`) | Document the bypass, propose the server-side fix |
| **P2** | Anything else client-reachable that can spend money | Proxy it through a Netlify function |

### The remediation pattern

Any key that can spend money or write data goes into a Netlify function, never the client:

```js
// netlify/functions/proxy-<service>.js
exports.handler = async (event) => {
  const KEY = process.env.SERVICE_API_KEY;         // set in Netlify UI, never in the repo
  if (!KEY) {
    return { statusCode: 200,
             headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
             body: JSON.stringify({ error: 'unconfigured', data: [] }) };
  }
  // Validate/whitelist params — never interpolate raw user input into the upstream URL
  const q = (event.queryStringParameters || {});
  // ... call upstream with KEY, return only what the client needs
};
```

Two BDOC-specific conventions to follow, both learned the hard way:

1. **Never return 5xx on upstream failure.** Return HTTP 200 with an empty-but-valid payload. A 5xx makes the layer look broken; a graceful empty degrades cleanly. Better still, cache the last good response and serve it flagged `_stale` (see `netlify/functions/proxy-newsgeo.js` for the pattern already in this repo).
2. **`Cache-Control: no-store` on error responses.** Caching a failure for 10 minutes turns a 3-second upstream hiccup into a 10-minute outage.

### For the Google Maps key specifically

Two options — **prefer option B**:

**Option A (defensive):** In Google Cloud Console → Credentials → the key → Application restrictions → HTTP referrers → add `https://kgsbdoc.netlify.app/*` and `https://*.kitsuneglobalsolutions.com/*`. Then API restrictions → limit to only the specific APIs in use. *Travon must do this — it is a console action, not a code change.*

**Option B (eliminate the risk):** Drop the Google raster layer entirely and use keyless free imagery. This removes the billing ceiling AND the exposed-key finding in one move:

- **Esri World Imagery** — `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` (no key, attribution required: "Esri, Maxar, Earthstar Geographics")
- **NASA GIBS VIIRS** — fully public, and **VIIRS Black Marble night lights is free, on-brand for a dark war-room aesthetic, and almost nobody else uses it**
- **EOX Sentinel-2 cloudless** — CC-BY-4.0

Report which option you took and why. If you take B, verify the imagery actually renders before declaring done.

---

## STEP 3 — CI GUARD (this is the part that makes it stay fixed)

A one-time cleanup decays. The scanner is what makes it permanent.

Create `scripts/scan-secrets.sh`:

```bash
#!/usr/bin/env bash
# Fails the build if a spendable/writable credential is reachable from the browser.
# The Supabase ANON key is deliberately NOT matched here — it is public by design.
set -uo pipefail
cd "$(dirname "$0")/.."

PATTERNS='(sk_live_[A-Za-z0-9]{8,}|sk_test_[A-Za-z0-9]{8,}|service_role|sk\.eyJ[A-Za-z0-9._-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xoxb-[0-9A-Za-z-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'

HITS=$(grep -rnE "$PATTERNS" \
        --include="*.html" --include="*.js" --include="*.json" --include="*.css" \
        . 2>/dev/null \
      | grep -v node_modules \
      | grep -v "/netlify/functions/" \
      | grep -v "scripts/scan-secrets.sh" \
      | grep -v "CLAUDE-SECURITY-TASK.md" \
      | grep -v "FAKE_FOR_TESTING")

if [ -n "$HITS" ]; then
  echo "=============================================="
  echo " BUILD FAILED — secret reachable from client"
  echo "=============================================="
  echo "$HITS"
  echo ""
  echo "Move it into a Netlify function and read it from process.env."
  exit 1
fi

echo "scan-secrets: clean — no client-reachable spendable credentials"
exit 0
```

```bash
chmod +x scripts/scan-secrets.sh
./scripts/scan-secrets.sh          # must print "clean"
```

Wire it into `netlify.toml` so it runs on every deploy:

```toml
[build]
  command = "./scripts/scan-secrets.sh"
```

If a build command already exists, chain it: `./scripts/scan-secrets.sh && <existing command>`.

**Prove the scanner works — do not skip this.** A scanner that never fires is indistinguishable from a broken one:

```bash
echo 'const k = "sk_live_FAKE_FOR_TESTING_ONLY_0000";' > /tmp/canary.js
cp /tmp/canary.js ./js/_canary_test.js
./scripts/scan-secrets.sh          # MUST exit 1 and print the finding
rm ./js/_canary_test.js
./scripts/scan-secrets.sh          # MUST exit 0 again
```

Note: the exclusion list above filters `FAKE_FOR_TESTING`, so name your canary file's secret exactly `sk_live_FAKE_FOR_TESTING_ONLY_0000` **but remove that filter line temporarily** when running the canary test, or use a different fake value like `sk_live_canary1234567890`. Confirm the scanner fires either way.

---

## STEP 4 — ALSO ADD THESE (same deploy, ~20 min, closes teardown items #13)

BDOC loads executable JS from `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, and `unpkg.com`. Any one of those being compromised is full script execution in your users' sessions. There is currently **no CSP and no referrer policy**.

Add to `netlify.toml` (headers, not a meta tag — meta-tag CSP can't set `frame-ancestors`):

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Referrer-Policy = "strict-origin-when-cross-origin"
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "SAMEORIGIN"
    Permissions-Policy = "geolocation=(self), microphone=(), camera=(), payment=(self)"
```

**On CSP specifically — be careful.** BDOC uses a large amount of inline JS and Cesium uses `blob:` workers and WebAssembly. A strict CSP will white-screen the app. Do this properly:

1. First deploy with **`Content-Security-Policy-Report-Only`** so nothing breaks.
2. Load the app, exercise every layer, collect the violation reports from the console.
3. Only then convert to an enforcing `Content-Security-Policy`.

A realistic starting point for this app:

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://js.stripe.com blob:;
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com;
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' data: blob: https:;
connect-src 'self' https:;
frame-src https://js.stripe.com;
object-src 'none';
base-uri 'self';
frame-ancestors 'self';
```

Do **not** ship the enforcing version without completing the report-only pass. Breaking the globe to fix a theoretical supply-chain risk is a bad trade.

---

## STEP 5 — DELIVERABLE

Commit on branch `claude-security-audit` and write `SECURITY-AUDIT-2026-06.md` at the repo root containing:

1. **Findings table** — every credential found: file, line, type, decoded role (for JWTs), severity, whether it can spend money, current status.
2. **What you changed** — file by file, with the reasoning.
3. **ROTATION LIST for Travon** — an explicit, prioritized checklist of keys he must rotate in each vendor console, with a direct link to the right console page for each. This is the part he acts on. Be specific: "Google Cloud Console → APIs & Services → Credentials → key ending `…xY7z` → Restrict + Regenerate."
4. **Scanner proof** — paste the terminal output showing the canary firing (exit 1) and the clean run (exit 0).
5. **What you did NOT do and why** — anything you found but deliberately left alone. Be honest about gaps; a known gap is manageable, an unknown one is not.

Then report to Travon in plain language: what was exposed, what it could have cost, what's fixed now, and exactly what he needs to click.

---

## VERIFICATION CHECKLIST — all must be true before you say "done"

- [ ] `./scripts/scan-secrets.sh` exits 0 on the clean tree
- [ ] Scanner demonstrably exits 1 on a planted canary (output pasted in the report)
- [ ] No `service_role` JWT anywhere outside `netlify/functions/`
- [ ] No `sk_live_` / `sk_test_` / `sk.` token in any client-served file
- [ ] Every JWT remaining in client code decodes to `"role": "anon"` — decoded output pasted
- [ ] Google Maps key is either referrer-restricted (confirmed in console) or removed entirely
- [ ] `bdoc_dev_key` bypass documented, with a concrete server-side fix proposed
- [ ] Security headers live — verify with `curl -sI https://kgsbdoc.netlify.app/ | grep -i "referrer\|content-type-options\|frame-options"`
- [ ] CSP shipped in **report-only** mode (not enforcing) on this pass
- [ ] Site still fully works: globe renders, layers toggle, Stripe checkout still returns a session URL
- [ ] Committed to `claude-security-audit`, **not** to `main`

---

## ONE LAST THING

If you find something genuinely bad — a live `service_role` key, an open RLS table, a Stripe secret in the bundle — **stop and tell Travon immediately** rather than quietly fixing it and mentioning it in a report he reads later. Those three specifically mean the window of exposure matters, and he needs to start rotating while you're still working.

Do not guess. Do not report a fix you did not verify with real command output.
