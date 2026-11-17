// Invariant 9: every suppression logs a reason.
// ACTIVE today:
//  - every .ci/allowlist.json entry has a kind, a reason, who accepted it, a date
//    and an unexpired expiry (an expired one fails: fix it or re-sign it);
//  - security-scanner suppressions in code (gitleaks:allow, nosemgrep, nosec,
//    codeql[...], lgtm[...], secret-scan:allow) carry a reason on the same line;
//  - every skipped test says why in a string, never just `skip: true`.
// Home part (DORMANT until home code exists): suppress / mute / snooze / squelch
// calls pass a reason.
'use strict';
const files = require('../lib/files');
const allow = require('../lib/allowlist');
const { make } = require('../lib/result');

const ID = 'inv09';
const TITLE = 'Every suppression logs a reason';
const INLINE_RE = /(gitleaks:allow|nosemgrep|#\s*nosec\b|codeql\[[^\]]*\]|lgtm\[[^\]]*\]|secret-scan:allow)(.*)$/;
// A skip option is `skip:` on a test call, or an options object that starts with
// skip (`? { skip: ... }`). An object counting skipped items ({ unit: 1, skip: 0 })
// is neither.
const SKIP_FN_RE = /\b(test|it|describe)\.skip\s*\(/;
const SKIP_OPT_RE = /\b(test|it|describe|suite)\s*\(.*\bskip\s*:|[?:=(,]\s*\{\s*skip\s*:/;
const SKIP_REASONED_RE = /\bskip\s*:(?!\s*true\b)[^}]*['"`]/;
const HOME_SUPPRESS_RE = /\b(suppress|mute|snooze|squelch|silence)\w*\s*\(([^)]*)\)/g;

function run(root) {
  const r = make(ID, TITLE);
  const list = allow.load(root);
  let entries = 0;
  for (const [check, items] of Object.entries(list)) {
    if (check.startsWith('_')) continue;
    if (!Array.isArray(items)) { r.fail(`.ci/allowlist.json: "${check}" must be a list`); continue; }
    items.forEach((e, i) => {
      entries++;
      for (const p of allow.problems(e || {})) r.fail(`.ci/allowlist.json ${check}[${i}] ${(e && e.file) || '?'}: ${p}`);
    });
  }
  const all = files.listFiles(root).filter(f => files.isText(f) && !files.isVendor(f) && !f.startsWith('.ci/'));
  let skips = 0;
  for (const f of all) {
    const text = files.read(root, f);
    text.split('\n').forEach((line, i) => {
      const m = line.match(INLINE_RE);
      if (m && m[2].replace(/[\s:*\/#>-]+/g, ' ').trim().length < 10)
        r.fail(`${f}:${i + 1} ${m[1]} without a reason`);
      if (!/\.test\.(m?js|cjs)$/.test(f)) return;
      if (SKIP_FN_RE.test(line)) r.fail(`${f}:${i + 1} test skipped without saying why (use { skip: 'reason' })`);
      else if (SKIP_OPT_RE.test(line)) {
        skips++;
        if (!SKIP_REASONED_RE.test(line)) r.fail(`${f}:${i + 1} test skipped without saying why (use skip: 'reason')`);
      }
    });
  }
  const home = files.homeSurface(root);
  for (const f of [...home.relay, ...home.hub, ...home.client]) {
    const text = files.read(root, f);
    for (const m of text.matchAll(HOME_SUPPRESS_RE))
      if (!/reason|['"`]/.test(m[2])) r.fail(`${f}:${files.lineOf(text, m.index)} ${m[1]}(...) without a reason`);
  }
  r.note(`${entries} allowlist entr${entries === 1 ? 'y' : 'ies'} checked; ${skips} skipped test(s) checked for a reason`);
  if (!files.homeExists(home)) r.note('home suppression rule is DORMANT until home code exists');
  return r.done();
}

module.exports = { id: ID, title: TITLE, run };
