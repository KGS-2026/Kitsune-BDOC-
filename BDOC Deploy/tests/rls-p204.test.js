'use strict';
// p204 (item 1b chunk C): Supabase least privilege. Pins migration 004 and the functions that
// write with the service role.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FN = (f) => path.join(ROOT, 'netlify', 'functions', f);
const M004 = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '004_security_baseline.sql'), 'utf8');
const code = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').toLowerCase();

function fresh(file) { delete require.cache[require.resolve(file)]; return require(file); }
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
async function withFetch(fn) {
  const real = global.fetch, calls = [];
  global.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return { ok: true, status: 201, text: async () => '' }; };
  try { return await fn(calls); } finally { global.fetch = real; }
}

test('004 is one transaction, turns RLS on everywhere, and never FORCEs it (signup would break)', () => {
  const c = code(M004);
  assert.match(c, /^begin;/m);
  assert.match(c, /^commit;/m);
  assert.match(c, /alter table public\.%i enable row level security/);
  assert.doesNotMatch(c, /force row level security/);
});

test('004: anon gets nothing on profiles; signed-in users may change only three columns', () => {
  const c = code(M004);
  assert.match(c, /revoke all on public\.profiles from anon;/);
  assert.match(c, /revoke insert, update, delete on public\.profiles from authenticated;/);
  const grants = [...c.matchAll(/grant update \(([^)]+)\) on public\.profiles to authenticated/g)].map((m) => m[1]);
  assert.deepStrictEqual(grants, ['display_name, phone, marketing_consent']);
  assert.doesNotMatch(c, /grant update \([^)]*(tier|stripe|api_key|email|marketing_consent_at)/);
  assert.match(c, /revoke select \(%1\$i\), insert \(%1\$i\), update \(%1\$i\)/, 'column-level grants are cleared too');
});

test('004: no policy is open to everyone, and every policy names its role', () => {
  const c = code(M004);
  assert.doesNotMatch(c, /using\s*\(\s*true\s*\)/);
  const policies = [...c.matchAll(/create policy [^;]+;/g)].map((m) => m[0]);
  assert.ok(policies.length >= 3);
  for (const p of policies) assert.match(p, / to authenticated /, p);
  assert.match(c, /drop policy if exists "anyone can read heartbeats"/);
  assert.match(c, /drop policy if exists "users can update own profile"/, "001's every-column update policy is removed");
});

test('004: functions have a fixed search_path and consent time is stamped by the database', () => {
  const c = code(M004);
  const fns = [...c.matchAll(/create or replace function [^$]+\$\$/g)].map((m) => m[0]);
  assert.ok(fns.length >= 2);
  for (const f of fns) assert.match(f, /set search_path = ''/, f.slice(0, 60));
  assert.match(c, /new\.marketing_consent_at := case when new\.marketing_consent then now\(\) else null end/);
  assert.match(c, /create trigger profiles_stamp\s+before update on public\.profiles/);
  assert.match(c, /add column if not exists marketing_consent\s+boolean/, '003 is folded in (it never ran live)');
});

test('every table any SQL file creates also turns RLS on', () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).map((f) => path.join(ROOT, 'supabase', 'migrations', f)),
    path.join(ROOT, 'docs', 'mesh-setup.sql'),
  ].filter((f) => f.endsWith('.sql'));
  const all = files.map((f) => code(fs.readFileSync(f, 'utf8'))).join('\n');
  const created = [...all.matchAll(/create table if not exists (?:public\.)?([a-z_]+)/g)].map((m) => m[1]);
  assert.ok(created.length >= 7);
  for (const t of created) assert.match(all, new RegExp(`alter table (public\\.)?${t} enable row level security`), t);
});

test('mesh-setup.sql no longer lets any signed-in user write the mesh tables', () => {
  const c = code(fs.readFileSync(path.join(ROOT, 'docs', 'mesh-setup.sql'), 'utf8'));
  assert.doesNotMatch(c, /auth\.role\(\)\s*=\s*'authenticated'/);
  assert.doesNotMatch(c, /for (all|insert|update|delete)/);
});

test('proxy-supabase: POST to heartbeats only, rebuilt row, server timestamp, size cap', async () => {
  const p = fresh(FN('proxy-supabase.js'));
  await withEnv({ SUPABASE_SERVICE_KEY: 'svc' }, async () => {
    await withFetch(async (calls) => {
      assert.strictEqual((await p.handler({ httpMethod: 'GET', queryStringParameters: { table: 'heartbeats' } })).statusCode, 405);
      assert.strictEqual((await p.handler({ httpMethod: 'POST', queryStringParameters: { table: 'profiles' }, body: '{}' })).statusCode, 400);
      assert.strictEqual((await p.handler({ httpMethod: 'POST', queryStringParameters: { table: 'heartbeats' }, body: 'x'.repeat(17000) })).statusCode, 413);
      assert.strictEqual((await p.handler({ httpMethod: 'POST', queryStringParameters: { table: 'heartbeats' }, body: 'nope' })).statusCode, 400);
      assert.strictEqual(calls.length, 0);
      const evil = {
        feeds: { usgs: { status: 'healthy', lastOk: 1763590000000, errCount: 1, dataCount: 9, html: '<script>' }, 'bad key!': { status: 'x' } },
        system: '<img onerror=1>', version: '7.0.0', timestamp: '1999-01-01', id: 1, created_at: '1999-01-01', extra: 'x',
      };
      const r = await p.handler({ httpMethod: 'POST', queryStringParameters: { table: 'heartbeats' }, body: JSON.stringify(evil) });
      assert.strictEqual(r.statusCode, 201);
      assert.strictEqual(calls.length, 1);
      const sent = JSON.parse(calls[0].opts.body);
      assert.deepStrictEqual(Object.keys(sent).sort(), ['feeds', 'system', 'timestamp', 'version']);
      assert.deepStrictEqual(sent.feeds, { usgs: { status: 'healthy', lastOk: 1763590000000, errCount: 1, dataCount: 9 } });
      assert.strictEqual(sent.system, 'unknown');
      assert.notStrictEqual(sent.timestamp, '1999-01-01');
    });
  });
  await withEnv({ SUPABASE_SERVICE_KEY: undefined, SUPABASE_KEY: undefined }, async () => {
    const r = await p.handler({ httpMethod: 'POST', queryStringParameters: { table: 'heartbeats' }, body: '{}' });
    assert.strictEqual(r.statusCode, 204);
  });
});

test('mesh-ingest refuses everyone without MESH_INGEST_KEY in x-mesh-key', async () => {
  const body = JSON.stringify({ source: 'meshtastic', type: 'position', data: {} });
  await withEnv({ MESH_INGEST_KEY: undefined, SUPABASE_SERVICE_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }, async () => {
    const m = fresh(FN('mesh-ingest.js'));
    assert.strictEqual((await m.handler({ httpMethod: 'POST', headers: {}, body })).statusCode, 503);
  });
  await withEnv({ MESH_INGEST_KEY: 'right-key', SUPABASE_SERVICE_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }, async () => {
    const m = fresh(FN('mesh-ingest.js'));
    assert.strictEqual((await m.handler({ httpMethod: 'POST', headers: {}, body })).statusCode, 401);
    assert.strictEqual((await m.handler({ httpMethod: 'POST', headers: { 'x-mesh-key': 'wrong' }, body })).statusCode, 401);
    const ok = await m.handler({ httpMethod: 'POST', headers: { 'x-mesh-key': 'right-key' }, body });
    assert.match(ok.body, /Supabase not configured/, 'past the gate');
  });
});

for (const file of ['admin-user.js', 'export-contacts.js']) {
  test(`${file}: wrong key 403; right key works from the header or ?key=`, async () => {
    await withEnv({ ADMIN_EXPORT_KEY: 'adm', SUPABASE_SERVICE_KEY: undefined }, async () => {
      const f = fresh(FN(file));
      const q = { email: 'a@b.c' };
      assert.strictEqual((await f.handler({ queryStringParameters: { ...q, key: 'nope' }, headers: {} })).statusCode, 403);
      assert.strictEqual((await f.handler({ queryStringParameters: q, headers: {} })).statusCode, 403);
      assert.strictEqual((await f.handler({ queryStringParameters: q, headers: { 'x-admin-key': 'adm' } })).statusCode, 503);
      assert.strictEqual((await f.handler({ queryStringParameters: { ...q, key: 'adm' }, headers: {} })).statusCode, 503);
    });
  });
}

test('sameSecret', () => {
  const { sameSecret } = require(FN('_lib/secret.js'));
  assert.strictEqual(sameSecret('a', 'a'), true);
  assert.strictEqual(sameSecret('a', 'b'), false);
  assert.strictEqual(sameSecret('', ''), false);
  assert.strictEqual(sameSecret(undefined, 'a'), false);
});
