#!/usr/bin/env node
// p200 (T200): runs the twelve home-module invariants (see .ci/README.md).
//   PASS     armed, and the code it guards is clean
//   WARN     armed and clean, but an allowlisted exception is open or unsigned
//   DORMANT  the code it guards does not exist yet; the rule arms itself when it does
//   FAIL     a violation; exit code 1
// Usage: node .ci/invariants/run.js [--json] [repoRoot]
// A check that crashes counts as FAIL: a guard that cannot run is not a guard.
'use strict';
const fs = require('fs');
const path = require('path');

// Every file named invNN-*.js in this folder is a check, run in number order. The test suite
// pins the twelve ids, so a missing or extra file fails it. There is no hand-written list on
// purpose: on GitHub's first run, gitleaks' generic-api-key rule read such a list as a secret
// (one name ends in a key word, so the next name looked like its value).
const checks = fs.readdirSync(__dirname)
  .filter(f => /^inv\d{2}-[a-z0-9-]+\.js$/.test(f))
  .sort()
  .map(f => require(path.join(__dirname, f)));

function runAll(root) {
  return checks.map(c => {
    try {
      return c.run(root);
    } catch (err) {
      return { id: c.id, title: c.title, status: 'FAIL', findings: ['check crashed: ' + (err && err.stack || err)], notes: [] };
    }
  });
}

function print(results, out = console.log) {
  for (const r of results) {
    out(`${r.id}  ${r.status.padEnd(8)} ${r.title}`);
    for (const f of r.findings) out(`         ✗ ${f}`);
    for (const n of r.notes) out(`         · ${n}`);
  }
  const count = s => results.filter(r => r.status === s).length;
  out(`\n${results.length} invariants: ${count('PASS')} pass, ${count('WARN')} warn, ${count('DORMANT')} dormant, ${count('FAIL')} fail`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const root = path.resolve(args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', '..'));
  const results = runAll(root);
  if (json) console.log(JSON.stringify(results, null, 2));
  else print(results);
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
}

module.exports = { checks, runAll, print };
