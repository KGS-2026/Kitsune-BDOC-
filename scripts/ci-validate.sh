#!/usr/bin/env bash
# BDOC CI validation — codifies the manual bug-hunt into an automated gate.
# Runs on every push/PR. Fails the build if any check fails, so broken code
# never reaches the Netlify deploy. Zero external dependencies (node + python3 only).
set -uo pipefail
cd "$(dirname "$0")/.."   # repo root
ROOT="BDOC Deploy"
fail=0
echo "════════════════════════════════════════════"
echo " BDOC CI VALIDATION"
echo "════════════════════════════════════════════"

# ── 1. JS syntax check: every module + every Netlify function ──
echo; echo "── [1/5] JavaScript syntax (node --check) ──"
js_count=0; js_fail=0
while IFS= read -r -d '' f; do
  js_count=$((js_count+1))
  if ! out=$(node --check "$f" 2>&1); then
    echo "  ✗ FAIL: $f"
    echo "      ${out%%$'\n'*}"
    js_fail=$((js_fail+1)); fail=1
  fi
done < <(find "$ROOT/js" "$ROOT/netlify/functions" -name '*.js' -print0 2>/dev/null)
echo "  checked $js_count JS files, $js_fail failed"

# ── 2. Inline <script> blocks in index.html (skip JSON-LD) ──
echo; echo "── [2/5] Inline <script> blocks in index.html ──"
python3 - "$ROOT/index.html" <<'PY'
import re, sys, subprocess, tempfile, os
html = open(sys.argv[1], encoding="utf-8", errors="replace").read()
blocks = re.findall(r'<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>', html, re.S)
bad = 0; n = 0
for attrs, body in blocks:
    if 'application/ld+json' in attrs or 'application/json' in attrs:
        continue            # structured-data, not JS
    if not body.strip():
        continue
    n += 1
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as t:
        t.write(body); tn = t.name
    r = subprocess.run(["node", "--check", tn], capture_output=True, text=True)
    os.unlink(tn)
    if r.returncode != 0:
        bad += 1
        print(f"  ✗ FAIL inline block #{n}: {(r.stderr.strip().splitlines() or ['error'])[0]}")
print(f"  checked {n} inline scripts, {bad} failed")
sys.exit(1 if bad else 0)
PY
[ $? -ne 0 ] && fail=1

# ── 3. CSS brace balance (catches truncated/broken stylesheets) ──
echo; echo "── [3/5] CSS brace balance ──"
python3 - "$ROOT/css/bdoc.css" <<'PY'
import sys
c = open(sys.argv[1], encoding="utf-8", errors="replace").read()
o, cl = c.count("{"), c.count("}")
print(f"  bdoc.css: {{ {o}  }} {cl}")
sys.exit(0 if o == cl else 1)
PY
[ $? -ne 0 ] && { echo "  ✗ FAIL: unbalanced braces in bdoc.css"; fail=1; }

# ── 4. JSON sanity: manifest, package.json, netlify config ──
echo; echo "── [4/5] JSON / config sanity ──"
for jf in "$ROOT/manifest.json" "$ROOT/package.json"; do
  [ -f "$jf" ] || continue
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$jf" 2>/dev/null; then
    echo "  ✓ $jf"
  else
    echo "  ✗ FAIL: invalid JSON in $jf"; fail=1
  fi
done

echo; echo "════════════════════════════════════════════"

# ── 5. SECURITY TEST SUITE (p158 — POA&M-6) ──
# The gate validated SYNTAX but never ran the tests, so 51 security tests
# existed that nothing enforced. A guard.js regression that silently stopped
# checking tier, or an auth-fetch change that leaked the JWT to a third party,
# would have sailed through and deployed. Node 18 rejects a bare directory as
# a --test target, hence the glob.
echo; echo "── [5/5] Security + unit tests (node --test) ──"
if [ -d "$ROOT/tests" ]; then
  if (cd "$ROOT" && node --test "tests/*.test.js" > /tmp/bdoc-tests.log 2>&1); then
    echo "  ✓ $(grep -c '^ok ' /tmp/bdoc-tests.log 2>/dev/null || echo '?') tests passed"
  else
    echo "  ✗ FAIL: test suite"
    grep -E "^not ok |error: " /tmp/bdoc-tests.log 2>/dev/null | head -20
    fail=1
  fi
else
  echo "  ✗ FAIL: $ROOT/tests missing — the security suite must not disappear"
  fail=1
fi

echo; echo "════════════════════════════════════════════"
if [ $fail -eq 0 ]; then
  echo " ✓ ALL CHECKS PASSED"
else
  echo " ✗ VALIDATION FAILED — see above"
fi
echo "════════════════════════════════════════════"
exit $fail
