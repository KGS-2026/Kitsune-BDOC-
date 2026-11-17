// p200 (T200): what the public site, the desktop installer and the public repo
// could expose. Pure functions over a repo root, so the tests can run them on a
// throwaway tree. Reads the DISK, not git: the desktop build packs files from
// disk, so an untracked secrets file in the publish tree would ship inside the
// installer without ever being committed.
'use strict';
const fs = require('fs');
const path = require('path');

const SITE = 'BDOC Deploy';
// Never part of any published surface: dependencies, build output, git and
// Netlify CLI state. (node_modules and dist-electron are also 404-blocked; the
// p158f test enforces that.)
const SKIP_DIRS = new Set(['node_modules', 'dist-electron', '.git', '.netlify']);
// Top-level folders of the publish tree that exist to be fetched by browsers.
const PUBLIC_DIRS = new Set(['.well-known', 'assets', 'css', 'data', 'js']);

const ENV_RE = /^\.env(\.|$)/i;                                         // .env, .env.local, .env.production
const KEY_RE = /\.(pem|key|p8|p12|pfx|jks|keystore|crt|cer|der)$/i;     // key material and certificates
const CONFIG_RE = /\.(toml|ya?ml|ini|conf|cfg|properties|lock)$|^package(-lock)?\.json$|^tsconfig[^/]*\.json$|\.config\.(c|m)?js$|^dockerfile|^docker-compose/i;

function walk(abs, rel, out) {
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(abs, e.name), r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}

function blockedPaths(toml) {
  return new Set([...toml.matchAll(/from\s*=\s*"([^"]+)"[^\[]*?status\s*=\s*404/g)].map(m => m[1]));
}

// Does a 404 rule cover this site-relative path? Either the exact path, or a
// "/dir/*" splat over one of its folders (Netlify splats match whole segments).
function isBlocked(siteRel, blocked) {
  if (blocked.has('/' + siteRel)) return true;
  const parts = siteRel.split('/');
  for (let i = 1; i < parts.length; i++) if (blocked.has('/' + parts.slice(0, i).join('/') + '/*')) return true;
  return false;
}

const declared = obj => Object.keys(obj || {}).filter(k => !k.startsWith('_'));

function relayEndpoints(repoRoot) {
  const relay = path.join(repoRoot, 'relay');
  if (!fs.existsSync(relay)) return [];
  const out = [];
  const fnDir = path.join(relay, 'functions');
  if (fs.existsSync(fnDir)) for (const n of fs.readdirSync(fnDir)) if (!n.startsWith('.')) out.push('relay/functions/' + n);
  for (const e of fs.readdirSync(relay, { withFileTypes: true }))
    if (e.isFile() && /\.(m?js|cjs|ts)$/.test(e.name)) out.push('relay/' + e.name);
  return out;
}

function audit(repoRoot) {
  const siteAbs = path.join(repoRoot, SITE);
  const toml = fs.readFileSync(path.join(siteAbs, 'netlify.toml'), 'utf8');
  const inv = JSON.parse(fs.readFileSync(path.join(siteAbs, 'tests', 'public-surface.inventory.json'), 'utf8'));
  const blocked = blockedPaths(toml);
  const files = walk(repoRoot, '', []);
  const fileSet = new Set(files);
  const site = SITE + '/';
  const v = { env: [], keys: [], config: [], dirs: [], endpoints: [], stale: [] };

  // Env files, key material and config files, anywhere in the repo.
  for (const f of files) {
    const base = f.slice(f.lastIndexOf('/') + 1);
    if (ENV_RE.test(base)) { v.env.push(f); continue; }
    if (KEY_RE.test(base)) { v.keys.push(f); continue; }
    if (!CONFIG_RE.test(base)) continue;
    if (f.startsWith(site)) {
      const rel = f.slice(site.length);
      const d = (inv.config || {})[rel];
      if (!d) v.config.push(f + ' (not declared in tests/public-surface.inventory.json)');
      else if (d.served !== false && d.public !== true && !isBlocked(rel, blocked))
        v.config.push(f + ' (declared but the site would serve it: add a 404 rule)');
    } else if (!(inv.repo_config || {})[f]) {
      v.config.push(f + ' (not declared in tests/public-surface.inventory.json)');
    }
  }
  for (const k of declared(inv.config)) if (!fileSet.has(site + k)) v.stale.push('config: ' + k);
  for (const k of declared(inv.repo_config)) if (!fileSet.has(k)) v.stale.push('repo_config: ' + k);

  // Top-level folders of the publish tree: public on purpose, or 404-blocked.
  for (const e of fs.readdirSync(siteAbs, { withFileTypes: true })) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
    if (!PUBLIC_DIRS.has(e.name) && !blocked.has('/' + e.name + '/*')) v.dirs.push(e.name + '/');
  }

  // Endpoints: Netlify functions, then the home relay once it exists.
  const fnAbs = path.join(siteAbs, 'netlify', 'functions');
  const fns = fs.existsSync(fnAbs) ? fs.readdirSync(fnAbs).filter(n => !n.startsWith('.')) : [];
  const ep = inv.endpoints || {};
  const added = ep.added || {};
  const known = new Set([...(ep.baseline || []), ...declared(added)]);
  for (const n of fns) if (!known.has(n)) v.endpoints.push(site + 'netlify/functions/' + n);
  for (const n of declared(added))
    if (!(typeof added[n] === 'string' && added[n].trim().length >= 10))
      v.endpoints.push(site + 'netlify/functions/' + n + ' (declared without saying what it does and who may call it)');
  for (const n of known) if (!fns.includes(n)) v.stale.push('endpoint: ' + n);

  const relay = relayEndpoints(repoRoot);
  const relayKnown = inv.relay_endpoints || {};
  for (const n of relay) if (!relayKnown[n] || n.startsWith('_')) v.endpoints.push(n);
  for (const n of declared(relayKnown)) if (!relay.includes(n)) v.stale.push('relay endpoint: ' + n);

  return v;
}

module.exports = { SITE, PUBLIC_DIRS, ENV_RE, KEY_RE, CONFIG_RE, blockedPaths, isBlocked, audit };
