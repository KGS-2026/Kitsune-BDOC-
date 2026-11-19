#!/usr/bin/env node
// p200 (T200): repo-wide secret scan (tracked + untracked files, minus
// .gitignore). Exit 1 on any finding that is not on .ci/allowlist.json under
// "secrets". Prints fingerprints and four-character previews, never a secret.
// Usage: node .ci/secret-scan.js [repoRoot]
'use strict';
const path = require('path');
const scan = require('./lib/secrets');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const r = scan.scanRepo(root);
console.log(`secret scan: ${r.scanned} files, ${r.open.length} open, ${r.allowed.length} allowlisted`);
for (const a of r.allowed)
  console.log(`  allowed  ${a.file}:${a.line} ${a.rule} ${a.preview} [${a.kind}, expires ${a.expires}] ${a.reason}`);
for (const f of r.open)
  console.log(`  OPEN     ${f.file}:${f.line} ${f.rule} ${f.preview} fingerprint ${f.fingerprint}`);
process.exit(r.open.length ? 1 : 0);
