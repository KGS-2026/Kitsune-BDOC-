# BDOC CI/CD

## What runs
Every push and pull request triggers `.github/workflows/ci.yml`, which runs
`scripts/ci-validate.sh` — the automated version of the manual bug-hunt:

1. **JS syntax** — `node --check` on all 56 JS files (modules + Netlify functions)
2. **Inline scripts** — extracts and syntax-checks every inline `<script>` in
   `index.html` (skips JSON-LD structured-data blocks)
3. **CSS integrity** — verifies `bdoc.css` braces are balanced (catches truncation)
4. **JSON sanity** — validates `manifest.json` and `package.json`

A failing check exits non-zero and **fails the GitHub Actions run**, which blocks
the PR from merging — so broken code never reaches the `main` branch or Netlify.

## Run it locally before pushing
```bash
bash scripts/ci-validate.sh
```
Exit 0 = all green. Exit 1 = something failed (the output names the file + line).

## Pipeline relationship to Netlify
- **GitHub Actions** (this) = the *quality gate*: is the code valid?
- **Netlify** = the *deploy*: GitHub→Netlify integration auto-builds previews/prod.
- Recommended: in GitHub repo settings → Branches → protect `main` and require the
  "Validate" check to pass before merge. That makes the gate mandatory.

## Extending the gate
Add checks to `scripts/ci-validate.sh` as new bug classes are found. Keep it
dependency-free (node + python3 only) so it runs fast and never breaks on a missing
package. Each new check should: print a clear pass/fail line, and set `fail=1` on failure.
