// Invariant 11: home data never joins map state. Separate schema, separate
// bucket, separate keys.
// Always on: home endpoints never land in the map function folder (relay-*,
// homebase-*, hub-*); that is the first wrong move a relay could make.
// DORMANT for the rest until a home surface exists (relay/, hub/, js/home/,
// schema home). Then:
//  - map functions and map client code never touch the home schema or a
//    BDOC_HOME_* key (the home bucket and keys live only there);
//  - SQL outside the home migrations never references home.* objects;
//  - home client code never draws on the globe;
//  - the relay imports nothing from the map paths.
'use strict';
const files = require('../lib/files');
const { make } = require('../lib/result');

const ID = 'inv11';
const TITLE = 'Home data never joins map state (own schema, bucket, keys)';
const SITE = files.SITE + '/';
const HOME_KEY_RE = /\bBDOC_HOME_[A-Z0-9_]+/;
const HOME_SCHEMA_RE = /\.schema\(\s*['"]home['"]\s*\)|(?:Accept|Content)-Profile['"]?\s*[:,]\s*['"]home['"]/i;
const GLOBE_RE = /\b(V|viewer)\.(entities|dataSources|scene\.primitives)\b|new\s+Cesium\.Entity\b|\bCesium\.Entity\s*\(/;
const MAP_IMPORT_RE = /(?:require\(|from\s+|import\s*\()\s*['"][^'"]*(netlify\/functions|BDOC Deploy\/js|\/_lib\/)[^'"]*['"]/;
const HOME_SQL_REF = /\bhome\s*\.\s*"?\w/i;

function run(root) {
  const r = make(ID, TITLE);
  const all = files.listFiles(root);
  const fnDir = SITE + 'netlify/functions/';
  for (const f of all.filter(f => f.startsWith(fnDir))) {
    const entry = f.slice(fnDir.length).split('/')[0];
    if (/^(relay|homebase|hub)[-_]/i.test(entry)) r.fail(`${f}: home endpoint inside the map function folder; the relay is its own deploy with its own keys`);
  }
  const home = files.homeSurface(root);
  if (!files.homeExists(home)) {
    r.dormant('no home surface yet (relay/, hub/, js/home/, schema home); separation rules arm when one appears');
    return r.done();
  }
  const mapCode = all.filter(f => (f.startsWith(fnDir) || (f.startsWith(SITE + 'js/') && !f.startsWith(SITE + 'js/home/')))
    && /\.(m?js|cjs|ts)$/.test(f) && !files.isVendor(f));
  for (const f of mapCode) {
    const text = files.read(root, f);
    const k = text.match(HOME_KEY_RE);
    if (k) r.fail(`${f}:${files.lineOf(text, k.index)} map code reads home key ${k[0]}`);
    const s = text.match(HOME_SCHEMA_RE);
    if (s) r.fail(`${f}:${files.lineOf(text, s.index)} map code queries the home schema`);
  }
  const homeSql = new Set(home.sql.filter(f => /\bschema\s+(if\s+not\s+exists\s+)?"?home"?\b/i.test(files.read(root, f)) || /home/i.test(f)));
  for (const f of all.filter(f => /\.sql$/i.test(f) && !homeSql.has(f))) {
    const text = files.read(root, f);
    const m = text.match(HOME_SQL_REF);
    if (m) r.fail(`${f}:${files.lineOf(text, m.index)} SQL outside the home migrations references ${m[0]}...`);
  }
  for (const f of home.client) {
    const text = files.read(root, f);
    const m = text.match(GLOBE_RE);
    if (m) r.fail(`${f}:${files.lineOf(text, m.index)} home client draws on the globe (${m[0]})`);
  }
  for (const f of home.relay) {
    const text = files.read(root, f);
    const m = text.match(MAP_IMPORT_RE);
    if (m) r.fail(`${f}:${files.lineOf(text, m.index)} relay imports map code (${m[1]})`);
  }
  r.note(`checked ${mapCode.length} map files, ${home.client.length} home-client files, ${home.relay.length} relay files`);
  return r.done();
}

module.exports = { id: ID, title: TITLE, run };
