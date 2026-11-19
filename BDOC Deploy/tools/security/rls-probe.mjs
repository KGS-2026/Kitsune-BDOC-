#!/usr/bin/env node
// p204 RLS probe — run after migration 004 to prove what the public key can and cannot do.
//
//   node tools/security/rls-probe.mjs                       # signed-out checks only
//   BDOC_TEST_JWT=<access token of a TEST account> node tools/security/rls-probe.mjs
//
// Read-only for the signed-out part. With BDOC_TEST_JWT it also tries, as that test user,
// to raise its own tier (must fail) and to change its own display_name (must work, and is
// put back). Never use a real customer's token. Prints PASS/FAIL lines, no row contents.
const SITE = process.env.BDOC_SITE || 'https://kgsbdoc.netlify.app';
const cfg = await (await fetch(`${SITE}/api/config`)).json();
const URL_ = cfg.supabase_url, KEY = cfg.supabase_anon_key;
let failed = 0;
const say = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? '  (' + detail + ')' : ''}`); };
const rest = (path, opts = {}, jwt) => fetch(`${URL_}/rest/v1/${path}`, {
  ...opts,
  headers: { apikey: KEY, Authorization: `Bearer ${jwt || KEY}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) },
});
const rows = async (r) => { try { const j = await r.json(); return Array.isArray(j) ? j.length : -1; } catch { return -1; } };

// signed out
for (const t of ['profiles', 'audit_log', 'heartbeats']) {
  const r = await rest(`${t}?select=*&limit=5`);
  const n = r.ok ? await rows(r) : 0;
  say(!r.ok || n === 0, `signed-out read of ${t} returns nothing`, `${r.status}, ${n} rows`);
}
const cols = await rest('profiles?select=marketing_consent&limit=1');
say(cols.status !== 400 || !(await cols.text()).includes('does not exist'), 'profiles.marketing_consent exists (003/004 applied)', String(cols.status));

const hb = await fetch(`${SITE}/.netlify/functions/proxy-supabase?table=heartbeats`);
say(hb.status === 405, 'proxy-supabase refuses GET', String(hb.status));
const mi = await fetch(`${SITE}/.netlify/functions/mesh-ingest`, { method: 'POST', body: '{"source":"meshtastic","type":"x"}' });
say(mi.status === 401 || mi.status === 503, 'mesh-ingest refuses a request without the key', String(mi.status));

// signed in as a TEST user
const jwt = process.env.BDOC_TEST_JWT;
if (jwt) {
  const me = await (await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${jwt}` } })).json();
  const id = me && me.id;
  say(!!id, 'test token is valid');
  if (id) {
    const own = await rest(`profiles?id=eq.${id}&select=id,tier,display_name`, {}, jwt);
    const mine = own.ok ? await own.json() : [];
    say(mine.length === 1, 'test user reads its own profile');
    const others = await rest(`profiles?id=neq.${id}&select=id&limit=5`, {}, jwt);
    say(others.ok && (await rows(others)) === 0, 'test user sees no one else');
    const up = await rest(`profiles?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ tier: 'enterprise' }) }, jwt);
    say(!up.ok, 'test user cannot raise its own tier', String(up.status));
    const before = mine[0] && mine[0].display_name;
    const dn = await rest(`profiles?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ display_name: 'rls-probe' }) }, jwt);
    say(dn.ok, 'test user can change its own display_name', String(dn.status));
    if (dn.ok) await rest(`profiles?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ display_name: before }) }, jwt);
    const al = await rest('audit_log', { method: 'POST', body: JSON.stringify({ user_id: id, action: 'rls-probe' }) }, jwt);
    say(!al.ok, 'test user cannot write the audit log', String(al.status));
  }
} else {
  console.log('SKIP  signed-in checks (set BDOC_TEST_JWT to a TEST account token)');
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
