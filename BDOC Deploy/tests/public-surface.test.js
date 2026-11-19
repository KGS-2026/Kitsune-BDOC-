// p158f — every root-level internal file must be 404'd by netlify.toml.
// Netlify publishes the WHOLE directory (publish="."), and a "/*.md" splat does
// not match filenames, so a new doc at the root is public by default. This test
// fails the build when someone adds one without a redirect.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
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

// ── p200: leaks the checks above could not see ──────────────────────────────
// Those checks only knew root-level docs. An env file, a key file, a new config
// file, a new top-level folder (relay/, spec/ ...) or a new function was public
// by default. The audit reads the DISK, not git: the desktop build packs files
// from disk, so an untracked secrets file in this tree would ship inside the
// installer even though nobody committed it. Every endpoint and config file is
// declared in tests/public-surface.inventory.json, so adding one is a decision
// someone wrote down, not an accident. Logic: tests/helpers/public-surface-lib.js
const surface = require('./helpers/public-surface-lib');
const repoRoot = path.join(root, '..');
const audit = surface.audit(repoRoot);

test('p200: no env file anywhere in the repo or the publish tree', () => {
  assert.deepEqual(audit.env, [], 'env files belong in Netlify / platform settings, never on disk here: ' + audit.env.join(', '));
});

test('p200: no private key or certificate file anywhere in the repo', () => {
  assert.deepEqual(audit.keys, [], 'key material found: ' + audit.keys.join(', '));
});

test('p200: every config file is declared, and publish-tree config is never served', () => {
  assert.deepEqual(audit.config, [], 'declare it in tests/public-surface.inventory.json and 404 it in netlify.toml: ' + audit.config.join(', '));
});

test('p200: every top-level folder in the publish tree is public on purpose or 404-blocked', () => {
  assert.deepEqual(audit.dirs, [], 'add a /<dir>/* 404 rule in netlify.toml, or list it in PUBLIC_DIRS with a reason: ' + audit.dirs.join(', '));
});

test('p200: every endpoint is declared (functions and, once it exists, the home relay)', () => {
  assert.deepEqual(audit.endpoints, [], 'declare each new endpoint in tests/public-surface.inventory.json with what it does and who may call it: ' + audit.endpoints.join(', '));
});

test('p200: the inventory lists nothing that no longer exists', () => {
  assert.deepEqual(audit.stale, [], 'remove these from tests/public-surface.inventory.json: ' + audit.stale.join(', '));
});

// Deliberate leaks in a throwaway tree. These are the T200 gate kept as tests,
// so the audit cannot quietly stop catching them later.
function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdoc-surface-'));
  const write = (rel, body) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  write('BDOC Deploy/index.html', '<!doctype html><title>fixture</title>');
  write('BDOC Deploy/netlify.toml', [
    '[[redirects]]', '  from = "/tests/*"', '  to = "/404.html"', '  status = 404', '',
    '[[redirects]]', '  from = "/netlify/*"', '  to = "/404.html"', '  status = 404', '',
    '[[redirects]]', '  from = "/package.json"', '  to = "/404.html"', '  status = 404', '',
  ].join('\n'));
  write('BDOC Deploy/package.json', '{}');
  write('BDOC Deploy/netlify/functions/ping.js', 'exports.handler = async () => ({ statusCode: 200 })');
  write('BDOC Deploy/tests/public-surface.inventory.json', JSON.stringify({
    endpoints: { baseline: ['ping.js'], added: {} },
    relay_endpoints: {},
    config: {
      'netlify.toml': { served: false, why: 'fixture' },
      'package.json': { why: 'fixture' },
    },
    repo_config: {},
  }));
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  return dir;
}

function auditFixture(files) {
  const dir = fixture(files);
  try { return surface.audit(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('p200 gate: the clean fixture has no findings', () => {
  const v = auditFixture({});
  for (const k of ['env', 'keys', 'config', 'dirs', 'endpoints', 'stale']) assert.deepEqual(v[k], [], k);
});

test('p200 gate: a leaked .env in the publish tree fails, even untracked', () => {
  assert.deepEqual(auditFixture({ 'BDOC Deploy/.env': 'STRIPE_SECRET_KEY=x' }).env, ['BDOC Deploy/.env']);
  assert.deepEqual(auditFixture({ 'BDOC Deploy/js/.env.production': 'X=1' }).env, ['BDOC Deploy/js/.env.production']);
});

test('p200 gate: a .env beside the future relay fails too (outside the publish tree)', () => {
  assert.deepEqual(auditFixture({ 'relay/.env.local': 'BDOC_HOME_KEY=x' }).env, ['relay/.env.local']);
});

test('p200 gate: a new config file fails until it is declared and blocked', () => {
  assert.deepEqual(auditFixture({ 'BDOC Deploy/home-relay.toml': 'url = "x"' }).config,
    ['BDOC Deploy/home-relay.toml (not declared in tests/public-surface.inventory.json)']);
  assert.deepEqual(auditFixture({ 'relay/relay.yml': 'a: 1' }).config,
    ['relay/relay.yml (not declared in tests/public-surface.inventory.json)']);
});

test('p200 gate: a declared config file that the site would still serve fails', () => {
  const dir = fixture({ 'BDOC Deploy/hub.toml': 'x = 1' });
  try {
    const invPath = path.join(dir, 'BDOC Deploy/tests/public-surface.inventory.json');
    const inv = JSON.parse(fs.readFileSync(invPath, 'utf8'));
    inv.config['hub.toml'] = { why: 'declared, but no 404 rule' };
    fs.writeFileSync(invPath, JSON.stringify(inv));
    assert.deepEqual(surface.audit(dir).config, ['BDOC Deploy/hub.toml (declared but the site would serve it: add a 404 rule)']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('p200 gate: key material fails wherever it sits', () => {
  assert.deepEqual(auditFixture({ 'BDOC Deploy/assets/hub.pem': 'x' }).keys, ['BDOC Deploy/assets/hub.pem']);
  assert.deepEqual(auditFixture({ 'relay/certs/relay.key': 'x' }).keys, ['relay/certs/relay.key']);
});

test('p200 gate: a relay/ folder dropped into the publish tree fails until 404-blocked', () => {
  assert.deepEqual(auditFixture({ 'BDOC Deploy/relay/enroll.js': '//' }).dirs, ['relay/']);
});

test('p200 gate: a new function or relay endpoint fails until declared', () => {
  assert.deepEqual(auditFixture({ 'BDOC Deploy/netlify/functions/relay-enroll.js': '//' }).endpoints,
    ['BDOC Deploy/netlify/functions/relay-enroll.js']);
  assert.deepEqual(auditFixture({ 'relay/functions/enroll.mjs': '//' }).endpoints, ['relay/functions/enroll.mjs']);
});
