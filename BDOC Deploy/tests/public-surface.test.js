// p158f — every root-level internal file must be 404'd by netlify.toml.
// Netlify publishes the WHOLE directory (publish="."), and a "/*.md" splat does
// not match filenames, so a new doc at the root is public by default. This test
// fails the build when someone adds one without a redirect.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
const blocked = new Set([...toml.matchAll(/from\s*=\s*"([^"]+)"[^\[]*?status\s*=\s*404/g)].map(m => m[1]));
const PUBLIC_OK = new Set(['SECURITY.md']);
const INTERNAL = /\.(md|py|lock|sql|bak.*|orig|sh)$|\.bak-/i;

test('no backup copies are committed', () => {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.name === 'node_modules' || e.name.startsWith('.') ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const baks = walk(root).filter(f => /\.bak(-|$)|\.orig$|~$/.test(f)).map(f => path.relative(root, f));
  assert.deepEqual(baks, []);
});

test('every root-level internal file is 404-blocked', () => {
  const leaks = fs.readdirSync(root).filter(f => fs.statSync(path.join(root, f)).isFile() && INTERNAL.test(f) && !PUBLIC_OK.has(f)
    && !blocked.has('/' + f));
  assert.deepEqual(leaks, [], 'add a 404 redirect in netlify.toml for: ' + leaks.join(', '));
});

test('internal directories are 404-blocked', () => {
  for (const d of ['docs', 'tools', 'tests', 'netlify', 'electron', 'supabase', 'plugins', 'dist-electron', 'node_modules'])
    if (fs.existsSync(path.join(root, d))) assert.ok(blocked.has('/' + d + '/*'), '/' + d + '/* not blocked');
});
