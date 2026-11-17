// Invariant 12: every new endpoint and config file is added to the
// public-surface test.
// ACTIVE today. Runs the same audit as BDOC Deploy/tests/public-surface.test.js
// (functions, relay endpoints, config files, env and key files, top-level
// folders) against tests/public-surface.inventory.json, and checks that the test
// still uses that audit, so nobody can quietly drop it.
'use strict';
const fs = require('fs');
const path = require('path');
const { make } = require('../lib/result');
const surface = require('../../BDOC Deploy/tests/helpers/public-surface-lib.js');

const ID = 'inv12';
const TITLE = 'Every new endpoint and config file is in the public-surface test';
const LABELS = {
  env: 'env file', keys: 'key material', config: 'config file', dirs: 'unblocked folder',
  endpoints: 'undeclared endpoint', stale: 'stale inventory entry',
};

function run(root) {
  const r = make(ID, TITLE);
  const testFile = path.join(root, surface.SITE, 'tests', 'public-surface.test.js');
  if (!fs.existsSync(testFile)) r.fail('BDOC Deploy/tests/public-surface.test.js is missing');
  else if (!/public-surface-lib/.test(fs.readFileSync(testFile, 'utf8'))) r.fail('public-surface.test.js no longer runs the p200 audit');
  let v;
  try { v = surface.audit(root); } catch (err) { r.fail('public-surface audit could not run: ' + err.message); return r.done(); }
  for (const [k, label] of Object.entries(LABELS)) for (const item of v[k]) r.fail(`${label}: ${item}`);
  const inv = JSON.parse(fs.readFileSync(path.join(root, surface.SITE, 'tests', 'public-surface.inventory.json'), 'utf8'));
  const n = (inv.endpoints && inv.endpoints.baseline || []).length + Object.keys(inv.endpoints && inv.endpoints.added || {}).filter(k => !k.startsWith('_')).length;
  const c = Object.keys(inv.config || {}).length + Object.keys(inv.repo_config || {}).length;
  r.note(`${n} endpoints and ${c} config files declared; audit clean`);
  return r.done();
}

module.exports = { id: ID, title: TITLE, run };
