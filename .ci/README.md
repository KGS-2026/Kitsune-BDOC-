# .ci: invariants, secret scan, allowlist (p200 / T200)

Everything here runs offline with plain Node. Nothing is downloaded and no
package is installed. `scripts/ci-validate.sh` runs it as steps 6 and 7, and the
test suite in `BDOC Deploy/tests/` runs it again, with planted violations.

| Command | What it does |
|---|---|
| `node .ci/invariants/run.js` | The twelve home-module invariants, one line each. Exit 1 on FAIL. `--json` for machines. |
| `node .ci/secret-scan.js` | Scans every tracked and untracked (not ignored) file for credentials. Exit 1 on anything not allowlisted. |
| `bash scripts/ci-validate.sh` | The whole gate: syntax, tests, invariants, secret scan. |

## Statuses

- **PASS**: the check is armed and the code it guards is clean.
- **WARN**: armed and clean, but an allowlisted exception is still open, or nobody has signed it yet.
- **DORMANT**: the code it guards (the relay, the hub, the frame parser, the `BDOC.Home` client, schema `home`) doesn't exist yet. The check arms itself the moment that code appears. `BDOC Deploy/tests/invariants-p200.test.js` proves that every check, dormant or not, fails on a planted violation.
- **FAIL**: a violation. A check that crashes also counts as FAIL.

## The twelve

| # | Invariant | Today |
|---|---|---|
| 1 | The app has no network path to the hub or a tunnel; relay only | Active: client code, private ranges, `.lan` / mDNS names, tunnels, camera protocols; loopback only from the allowlist |
| 2 | The hub opens every connection; no inbound dial to a home | Dormant until `relay/` or `hub/` |
| 3 | A frame is exactly 74 bytes at fixed offsets | Dormant until frame code |
| 4 | No camera-original bytes reach the app | Dormant until `relay/` or `js/home/` |
| 5 | No durable credential in the client; anything minted lives 15 minutes or less | Active: secret scan of client code; relay lifetimes dormant |
| 6 | Deny by default; tenant isolation through Postgres RLS | Active: every table in every SQL file needs RLS |
| 7 | Parameters are enforced on the hub; the cloud only requests | Dormant until `relay/` or `hub/` |
| 8 | Model artifacts load by commit, hash and signature only | Dormant until home code refers to a model |
| 9 | Every suppression logs a reason | Active: the allowlist, scanner suppressions, skipped tests |
| 10 | No global security claim | Active: every page and script a visitor reads |
| 11 | Home data never joins map state | One rule is always on (no relay endpoints in the map function folder); the rest are dormant |
| 12 | Every new endpoint and config file is in the public-surface test | Active: same audit as `tests/public-surface.test.js` |

They are static tripwires. They catch the obvious wrong move early. They are not
proofs: a URL built at runtime, for example, is invisible to inv01. The runtime
gates in T203 to T220 are the proofs.

## Allowlisting (`.ci/allowlist.json`)

There is one file for every suppression, keyed by check (`inv01` ... `inv12`,
`secrets`). Each entry needs:

```json
{ "file": "BDOC Deploy/index.html", "fingerprint": "<16 hex>",
  "kind": "design | accepted-risk | open-violation",
  "reason": "why this is allowed, in plain words",
  "accepted_by": "who signed it (or UNSIGNED: ...)",
  "date": "YYYY-MM-DD", "expires": "YYYY-MM-DD" }
```

- Secrets are named by fingerprint, the first 16 hex characters of their sha256. The scanner prints that fingerprint, so the allowlist never repeats a key.
- Other checks use `match` instead of a fingerprint (for example `127.0.0.1:9876`). For inv01, `file` is a path prefix.
- `accepted-risk` stays WARN while it is unsigned. `open-violation` is always WARN.
- inv09 FAILS on any entry that is past its expiry. Fix the cause, or re-sign the entry with a new date.
