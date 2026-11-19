// Invariant 6: per-object authorization, deny by default. Tenant isolation is
// Postgres row-level security, never a client-side WHERE.
// ACTIVE today on every SQL file in the repo: each table created must have RLS
// enabled. Tables in the home schema must also FORCE RLS and carry a policy keyed
// to current_setting('app.tenant_id'), and none of their policies may be
// USING (true). Home client code may not filter by tenant itself.
// Limit: tables made by hand in the Supabase dashboard are invisible to CI.
'use strict';
const files = require('../lib/files');
const { make } = require('../lib/result');

const ID = 'inv06';
const TITLE = 'Per-object authz, deny by default; tenant isolation via Postgres RLS';
const NAME = '((?:"?\\w+"?\\.)?"?\\w+"?)';
const CREATE_RE = new RegExp('create\\s+(temp(?:orary)?\\s+|unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?' + NAME, 'gi');
const ENABLE_RE = new RegExp('alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?' + NAME + '\\s+enable\\s+row\\s+level\\s+security', 'gi');
const FORCE_RE = new RegExp('alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?' + NAME + '\\s+force\\s+row\\s+level\\s+security', 'gi');
const POLICY_RE = new RegExp('create\\s+policy\\s+(?:"[^"]+"|\\w+)\\s+on\\s+' + NAME + '([\\s\\S]*?);', 'gi');
const CLIENT_TENANT_FILTER = /\.eq\(\s*['"]tenant_id['"]|tenant_id=eq\.|\bwhere\s+tenant_id\b|\btenant_id\s*===/i;

const strip = sql => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const ident = s => s.replace(/"/g, '').toLowerCase().replace(/^public\./, '');

function run(root) {
  const r = make(ID, TITLE);
  const sqlFiles = files.listFiles(root).filter(f => /\.sql$/i.test(f));
  const created = new Map(), enabled = new Set(), forced = new Set(), policies = new Map();
  for (const f of sqlFiles) {
    const sql = strip(files.read(root, f));
    for (const m of sql.matchAll(CREATE_RE)) if (!/temp/i.test(m[1] || '')) created.set(ident(m[2]), f); // temp tables die with the session
    for (const m of sql.matchAll(ENABLE_RE)) enabled.add(ident(m[1]));
    for (const m of sql.matchAll(FORCE_RE)) forced.add(ident(m[1]));
    for (const m of sql.matchAll(POLICY_RE)) {
      const t = ident(m[1]);
      if (!policies.has(t)) policies.set(t, []);
      policies.get(t).push(m[2]);
    }
  }
  for (const [t, f] of created) {
    if (!enabled.has(t)) r.fail(`${f}: table ${t} has no ENABLE ROW LEVEL SECURITY`);
    if (!t.startsWith('home.')) continue;
    if (!forced.has(t)) r.fail(`${f}: home table ${t} must FORCE ROW LEVEL SECURITY`);
    const ps = policies.get(t) || [];
    if (!ps.some(p => /current_setting\(\s*'app\.tenant_id'/i.test(p))) r.fail(`${f}: home table ${t} has no policy keyed to current_setting('app.tenant_id')`);
    if (ps.some(p => /using\s*\(\s*true\s*\)/i.test(p))) r.fail(`${f}: home table ${t} has a USING (true) policy`);
  }
  const home = files.homeSurface(root);
  for (const f of home.client) {
    const text = files.read(root, f);
    const m = text.match(CLIENT_TENANT_FILTER);
    if (m) r.fail(`${f}:${files.lineOf(text, m.index)} home client filters by tenant itself; RLS decides`);
  }
  r.note(`${created.size} table(s) in ${sqlFiles.length} SQL file(s), ${enabled.size} with RLS enabled; dashboard-made tables are invisible to CI`);
  return r.done();
}

module.exports = { id: ID, title: TITLE, run };
