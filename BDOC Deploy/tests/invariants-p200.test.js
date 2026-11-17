// p200 (T200): the twelve home-module invariants live in .ci/invariants/ at the
// repo root. These tests prove three things:
//   1. all twelve checks are wired, in order;
//   2. the real repo passes them (PASS, WARN or DORMANT; never FAIL);
//   3. every check catches a planted violation, so a check that is DORMANT today
//      (the code it guards does not exist yet) already has teeth the day that
//      code lands.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const repoRoot = path.join(__dirname, '..', '..');
const inv = require(path.join(repoRoot, '.ci', 'invariants', 'run.js'));

const S = (...parts) => parts.join(''); // secret-shaped samples are built at runtime, never stored whole

// A minimal repo that passes all twelve checks. Planted files overwrite it.
function tree(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdoc-inv-'));
  const write = (rel, body) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  write('BDOC Deploy/index.html', '<!doctype html><title>BDOC</title><p>Live map.</p>');
  write('BDOC Deploy/js/app.js', "fetch('/.netlify/functions/ping')");
  write('BDOC Deploy/package.json', '{}');
  write('BDOC Deploy/netlify.toml', [
    '[[redirects]]', '  from = "/tests/*"', '  to = "/404.html"', '  status = 404', '',
    '[[redirects]]', '  from = "/netlify/*"', '  to = "/404.html"', '  status = 404', '',
    '[[redirects]]', '  from = "/package.json"', '  to = "/404.html"', '  status = 404', '',
  ].join('\n'));
  write('BDOC Deploy/netlify/functions/ping.js', 'exports.handler = async () => ({ statusCode: 200 })');
  write('BDOC Deploy/tests/public-surface.test.js', "const surface = require('./helpers/public-surface-lib');");
  write('BDOC Deploy/tests/public-surface.inventory.json', JSON.stringify({
    endpoints: { baseline: ['ping.js'], added: {} },
    relay_endpoints: {},
    config: { 'netlify.toml': { served: false, why: 'fixture' }, 'package.json': { why: 'fixture' } },
    repo_config: {},
  }));
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  return dir;
}

function runOne(id, files) {
  const dir = tree(files);
  try { return inv.checks.find(c => c.id === id).run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const IDS = ['inv01', 'inv02', 'inv03', 'inv04', 'inv05', 'inv06', 'inv07', 'inv08', 'inv09', 'inv10', 'inv11', 'inv12'];

test('all twelve invariant checks are wired, in order', () => {
  assert.deepEqual(inv.checks.map(c => c.id), IDS);
  for (const c of inv.checks) {
    assert.equal(typeof c.run, 'function', c.id);
    assert.ok(c.title.length > 10, c.id + ' needs a title');
  }
});

test('the real repo passes every invariant (PASS, WARN or DORMANT, never FAIL)', () => {
  const results = inv.runAll(repoRoot);
  assert.equal(results.length, 12);
  for (const r of results) assert.ok(['PASS', 'WARN', 'DORMANT', 'FAIL'].includes(r.status), r.id + ' status ' + r.status);
  const failed = results.filter(r => r.status === 'FAIL').map(r => r.id + ': ' + r.findings.join(' | '));
  assert.deepEqual(failed, []);
});

test('the clean skeleton passes all twelve, and the home-only checks stay DORMANT on it', () => {
  const dir = tree();
  try {
    const results = inv.runAll(dir);
    assert.deepEqual(results.filter(r => r.status === 'FAIL').map(r => r.id + ': ' + r.findings.join(' | ')), []);
    for (const id of ['inv02', 'inv03', 'inv04', 'inv07', 'inv08', 'inv11'])
      assert.equal(results.find(r => r.id === id).status, 'DORMANT', id);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// One planted violation per invariant.
const PLANTED = {
  inv01: { 'BDOC Deploy/js/home-panel.js': "fetch('http://192.168.1.50:8443/status')" },
  inv02: { 'relay/enroll.js': 'exports.handler = async () => fetch(`https://${hub_ip}:8443/config`)' },
  inv03: { 'relay/frame.js': 'const FRAME_LEN = 76; // BDOS-v1' },
  inv04: { 'BDOC Deploy/js/home/viewer.js': "img.src = 'rtsp://cam.example/stream1'" },
  inv05: { 'BDOC Deploy/js/keys.js': "const k = '" + S('sk_', 'live_', 'Zq9'.repeat(8)) + "';" },
  inv06: { 'BDOC Deploy/supabase/migrations/900_home.sql': 'CREATE SCHEMA home;\nCREATE TABLE home.alerts (id uuid primary key, tenant_id uuid not null);' },
  inv07: { 'relay/policy.js': 'exports.handler = async (e) => applyPolicy(JSON.parse(e.body))' },
  inv08: { 'relay/models.json': '{"detector":"https://huggingface.co/acme/det/resolve/main/model.onnx"}' },
  inv09: { '.ci/allowlist.json': JSON.stringify({ inv05: [{ file: 'BDOC Deploy/js/x.js', fingerprint: 'abc', kind: 'accepted-risk', reason: '', accepted_by: 'x', date: '2026-11-17', expires: '2099-01-01' }] }) },
  inv10: { 'BDOC Deploy/index.html': '<!doctype html><p>BDOC is unhackable.</p>' },
  inv11: { 'relay/ingest.js': '// relay', 'BDOC Deploy/netlify/functions/ping.js': 'const b = process.env.BDOC_HOME_BUCKET;' },
  inv12: { 'BDOC Deploy/netlify/functions/relay-enroll.js': 'exports.handler = async () => ({})' },
};

for (const id of IDS) {
  test(id + ' fails on a planted violation', () => {
    const r = runOne(id, PLANTED[id]);
    assert.equal(r.status, 'FAIL', id + ' returned ' + r.status + ' ' + JSON.stringify(r.findings));
    assert.ok(r.findings.length > 0, id + ' must say what it found');
  });
}

// Second cases: the passing shape of an armed check, and the other half of a rule.
test('inv03 passes a 74-byte frame and arms itself', () => {
  const r = runOne('inv03', { 'relay/frame.js': "const FRAME_LEN = 74; const DOMAIN = 'BDOS-v1';" });
  assert.equal(r.status, 'PASS', JSON.stringify(r.findings));
});

test('inv03 rejects a frame parser that reads JSON or a length prefix', () => {
  assert.equal(runOne('inv03', { 'relay/frame.js': "const FRAME_LEN = 74; const m = JSON.parse(buf); // BDOS-v1" }).status, 'FAIL');
});

test('inv05 rejects relay links or tokens that live longer than 15 minutes', () => {
  assert.equal(runOne('inv05', { 'relay/image.js': 'const url = await presign(key, { expiresIn: 3600 });' }).status, 'FAIL');
  assert.equal(runOne('inv05', { 'relay/image.js': 'const url = await presign(key, { expiresIn: 900 });' }).status, 'PASS');
});

test('inv06 passes a home table with RLS enabled, forced and keyed to app.tenant_id', () => {
  const sql = [
    'CREATE SCHEMA home;',
    'CREATE TABLE home.alerts (id uuid primary key, tenant_id uuid not null);',
    'ALTER TABLE home.alerts ENABLE ROW LEVEL SECURITY;',
    'ALTER TABLE home.alerts FORCE ROW LEVEL SECURITY;',
    "CREATE POLICY tenant_only ON home.alerts USING (tenant_id = current_setting('app.tenant_id')::uuid);",
  ].join('\n');
  const r = runOne('inv06', { 'BDOC Deploy/supabase/migrations/900_home.sql': sql });
  assert.equal(r.status, 'PASS', JSON.stringify(r.findings));
});

test('inv06 rejects a home client that filters by tenant itself', () => {
  assert.equal(runOne('inv06', { 'BDOC Deploy/js/home/feed.js': "q.eq('tenant_id', me.tenant)" }).status, 'FAIL');
});

test('inv07 rejects a hub policy engine without POLICY_REJECT', () => {
  assert.equal(runOne('inv07', { 'hub/policy.go': 'package policy\nfunc Apply(b []byte) error { return nil }' }).status, 'FAIL');
});

test('inv09 rejects an expired suppression and a test skipped without a reason', () => {
  const expired = { inv05: [{ file: 'BDOC Deploy/js/x.js', fingerprint: 'abc', kind: 'accepted-risk', reason: 'r', accepted_by: 'x', date: '2026-01-01', expires: '2026-02-01' }] };
  assert.equal(runOne('inv09', { '.ci/allowlist.json': JSON.stringify(expired) }).status, 'FAIL');
  // built in two pieces so inv09, scanning this very file, does not see a bare skip here
  assert.equal(runOne('inv09', { 'BDOC Deploy/tests/x.test.js': "test('a', { skip: " + 'true }, () => {})' }).status, 'FAIL');
  assert.equal(runOne('inv09', { 'BDOC Deploy/tests/x.test.js': "test('a', { skip: 'needs a radio attached' }, () => {})" }).status, 'PASS');
});

test('inv11 rejects home code that draws on the globe', () => {
  assert.equal(runOne('inv11', { 'BDOC Deploy/js/home/feed.js': 'V.entities.add({ position: p })' }).status, 'FAIL');
});

test('allowlisted findings print their reason (invariant 9: every suppression logs a reason)', () => {
  const r = inv.checks.find(c => c.id === 'inv05').run(repoRoot);
  assert.ok(['PASS', 'WARN'].includes(r.status), r.status);
  for (const n of r.notes.filter(n => n.startsWith('allowed:'))) assert.match(n, /reason: \S/);
});
