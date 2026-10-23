# Security Policy

Kitsune Global Solutions LLC — BDOC (kgsbdoc.netlify.app)

## Reporting a vulnerability

Email **security@kgsbdoc.com** (or tbrown1993@yahoo.com until that alias is
live). Please include:

- what you found and where (URL, endpoint, or file)
- the steps to reproduce it
- what an attacker could do with it

**Please do not** open a public GitHub issue for a security finding, and please
do not test against other people's accounts or data.

### What we commit to

| Stage | Target |
|---|---|
| Acknowledge your report | 3 business days |
| Initial assessment + severity | 7 business days |
| Fix for critical / high | 30 days |
| Fix for medium / low | 90 days |
| Public credit (if you want it) | on release of the fix |

We are a small team. If a deadline is going to slip we will tell you rather
than go quiet.

## Safe harbour

We will not pursue legal action against researchers who:

- act in good faith and avoid privacy violations, data destruction, and service
  degradation
- test only against their own accounts or accounts they have permission to use
- give us reasonable time to fix an issue before disclosing it publicly
- do not exfiltrate data beyond the minimum needed to demonstrate the issue

## Scope

**In scope**

- `kgsbdoc.netlify.app` — the web application
- `/.netlify/functions/*` — the API surface
- the BDOC desktop app (Electron) published under GitHub Releases
- the local IPC bridge (`127.0.0.1:9876`) shipped in `tools/`

**Out of scope**

- Third-party upstreams we proxy (NOAA, USGS, NASA, ADS-B, AIS, Overpass).
  Report those to the upstream owner.
- Supabase, Netlify, and Stripe platform infrastructure — report to those
  vendors directly.
- Findings that require a compromised device or a malicious browser extension.
- Volumetric denial of service. Please do not stress-test production.
- Missing hardening headers with no demonstrated impact.

## Known and accepted

Disclosed deliberately, because a researcher will find these in the first hour
and we would rather not waste their time:

- **`'unsafe-inline'` and `'unsafe-eval'` in CSP.** CSP is currently
  `Report-Only`. `unsafe-eval` is required by Cesium's bundled Knockout;
  `unsafe-inline` is required until the large inline script in `index.html` is
  extracted. Tracked.
- **InfoBox iframe runs with `allow-scripts allow-same-origin`.** Known and
  tracked. All feed-derived content passes through `esc()` / DOMPurify today.
  A bypass of that escaping is a **high-severity** report and we want it.
- **Desktop app bundles Electron 31 (Chromium 126), which is end of life.**
  Known; an upgrade is scheduled. CVEs inherited from that Chromium are already
  catalogued and do not need to be re-reported — a working exploit chain
  against BDOC specifically does.

## Data handling

BDOC deliberately stores as little as possible. Our design intent is that a
full database compromise exposes **account email and subscription tier** and
nothing further.

- **No card data ever touches BDOC.** Stripe hosts checkout and the billing
  portal; we store only the Stripe customer and subscription identifiers.
- Credentials and session handling are managed by Supabase Auth.
- All API keys are held server-side in environment variables, never in the
  client bundle.

If you find anything that contradicts the above, that is a valid report and we
treat it as high severity regardless of exploitability.

## Supported versions

| Version | Supported |
|---|---|
| Web app (always current) | yes |
| Desktop — latest GitHub release | yes |
| Desktop — older releases | no, please update |

The web app updates continuously. The desktop app loads the live site when
online, so content stays current, but the bundled browser engine only updates
when you reinstall.
