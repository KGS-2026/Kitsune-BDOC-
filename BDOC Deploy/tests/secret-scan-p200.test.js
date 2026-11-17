// p200 (T200): repo-wide secret scan. The repo is PUBLIC, and the site
// publishes this whole folder, so a key committed anywhere is a key published.
// Scanner: .ci/lib/secrets.js (no downloads, runs offline). CI also runs
// gitleaks on each push as a second opinion.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const repoRoot = path.join(__dirname, '..', '..');
const scan = require(path.join(repoRoot, '.ci', 'lib', 'secrets.js'));

const S = (...parts) => parts.join(''); // samples are built at runtime so this file never holds one whole

test('detects the credential formats BDOC and its agents actually use', () => {
  const samples = {
    'stripe-secret': S('sk_', 'live_', 'A1b2'.repeat(6)),
    'stripe-restricted': S('rk_', 'live_', 'A1b2'.repeat(6)),
    'stripe-webhook-secret': S('whsec_', 'Q7'.repeat(16)),
    'aws-access-key': S('AKIA', 'ABCDEFGHIJKLMNOP'),
    'github-token': S('ghp_', 'x1'.repeat(18)),
    'private-key': S('-----BEGIN ', 'PRIVATE KEY-----'),
    'telegram-bot-token': S('123456789', ':AA', 'b2'.repeat(16), 'c'),
    'mem0-key': S('m0-', 'k9'.repeat(20)),
    'anthropic-key': S('sk-ant-', 'api03-', 'z8'.repeat(20)),
    'openai-key': S('sk-', 'proj-', 'p7'.repeat(20)),
    'supabase-secret-key': S('sb_secret_', 'y6'.repeat(15)),
    'google-api-key': S('AIza', 'S5'.repeat(17), 'x'),
    'slack-token': S('xox', 'b-', '1234567890-', 'abcdefghij'),
  };
  for (const [rule, secret] of Object.entries(samples)) {
    const found = scan.scanText('const v = "' + secret + '";', 'fixture.js');
    assert.ok(found.some(f => f.rule === rule), rule + ' was not detected (got ' + found.map(f => f.rule).join(',') + ')');
  }
});

test('a key-named literal is caught; env lookups and placeholders are not', () => {
  const literal = S("APIKey:'", '4f1d9a7c2b6e8035', 'a9c7e1f3d5b70428', "'");
  assert.ok(scan.scanText(literal, 'a.js').some(f => f.rule === 'key-named-literal'));
  for (const t of [
    'apiKey: process.env.STRIPE_SECRET_KEY',
    "token: 'YOUR_TOKEN_HERE_1234567890abcd'",
    "secret = '<set-in-netlify-env-settings>'",
    "password: 'changeme-changeme-changeme'",
    "api_key: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx'",
  ]) assert.deepEqual(scan.scanText(t, 'a.js'), [], t);
});

test('a Supabase service_role JWT is a secret; other JWTs are client tokens', () => {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = payload => [b64({ alg: 'HS256', typ: 'JWT' }), b64(payload), 'c2lnbmF0dXJlLXNpZ25hdHVyZQ'].join('.');
  assert.ok(scan.scanText('"' + jwt({ role: 'service_role', iss: 'supabase' }) + '"', 'a.js').some(f => f.rule === 'supabase-service-role-jwt'));
  const other = scan.scanText('"' + jwt({ jti: 'x', id: 1 }) + '"', 'a.js');
  assert.deepEqual(other.map(f => f.rule), ['jwt']);
  assert.equal(other[0].severity, 'client-token');
});

test('findings never print the secret in full', () => {
  const secret = S('sk_', 'live_', 'Secret9'.repeat(4));
  const [f] = scan.scanText('x="' + secret + '"', 'a.js');
  assert.ok(f, 'expected a finding');
  assert.ok(!JSON.stringify(f).includes(secret), 'finding leaks the secret');
  assert.match(f.fingerprint, /^[0-9a-f]{16}$/);
});

test('tracked files hold no secret that is not on the allowlist with a reason', () => {
  const r = scan.scanRepo(repoRoot);
  assert.ok(r.scanned > 100, 'scanned only ' + r.scanned + ' files');
  assert.deepEqual(r.open.map(f => f.file + ':' + f.line + ' ' + f.rule + ' ' + f.preview), []);
  for (const a of r.allowed) assert.ok(a.reason && a.reason.length > 10, a.file + ' allowed without a reason');
});
