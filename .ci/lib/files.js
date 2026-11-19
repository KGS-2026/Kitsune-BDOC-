// p200 (T200): file lists shared by every .ci check.
// Uses git when the root is its own repo, so ignored build output and vendored
// copies are skipped exactly as CI sees the tree (tracked + untracked, minus
// .gitignore). Falls back to a plain walk for the throwaway trees the tests build.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SITE = 'BDOC Deploy';
const SKIP_DIRS = new Set(['node_modules', '.git', '.netlify', 'dist-electron']);

function walk(abs, rel, out) {
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(abs, e.name), r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}

function gitFiles(root) {
  const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 };
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], opts).trim();
    // Only trust git when ROOT is the top of its own repo; a temp tree that happens
    // to sit inside some other checkout must not inherit that checkout's files.
    if (path.resolve(top).toLowerCase() !== path.resolve(root).toLowerCase()) return null;
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], opts);
    return out.split('\0').filter(f => f && fs.existsSync(path.join(root, f)));
  } catch (_) {
    return null;
  }
}

const cache = new Map();
function listFiles(root) {
  const key = path.resolve(root);
  if (!cache.has(key)) cache.set(key, (gitFiles(root) || walk(root, '', [])).sort());
  return cache.get(key);
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const isVendor = f => /(^|\/)vendor\//.test(f) || /\.min\.js$/.test(f);
const isText = f => /\.(m?js|cjs|ts|tsx|py|go|rs|sql|json|toml|ya?ml|html?|css|md|sh|ps1|txt|conf|ini|env|xml|svg)$/i.test(f);

// Everything a browser or the desktop app receives: the web client and Electron.
// Third-party vendored files are left to the SBOM, not to these checks.
function clientFiles(root) {
  const p = SITE + '/';
  return listFiles(root).filter(f => {
    if (!f.startsWith(p) || isVendor(f)) return false;
    const r = f.slice(p.length);
    return /^[^/]+\.html$/.test(r) || r === 'service-worker.js' || r === 'manifest.json'
      || /^js\/.+\.m?js$/.test(r) || /^css\/.+\.css$/.test(r) || /^electron\/.+\.(m?js|html)$/.test(r);
  });
}

// Where the home module's pieces live. Fixed here so all twelve checks agree:
//   relay/                  the relay tier (T203): enroll, frame and image endpoints
//   hub/                    hub code, only if it ever lands in this repo (T207 plans its own repo)
//   BDOC Deploy/js/home/    the BDOC.Home client module (T215)
//   SQL naming schema home  the home schema (T204)
function homeSurface(root) {
  const files = listFiles(root);
  const code = f => isText(f) && !isVendor(f);
  return {
    relay: files.filter(f => f.startsWith('relay/') && code(f)),
    hub: files.filter(f => f.startsWith('hub/') && code(f)),
    client: files.filter(f => f.startsWith(SITE + '/js/home/') && code(f)),
    sql: files.filter(f => /\.sql$/i.test(f) && /\bschema\s+(if\s+not\s+exists\s+)?"?home"?\b|\bhome\s*\.\s*"?\w/i.test(read(root, f))),
  };
}

const homeExists = h => h.relay.length + h.hub.length + h.client.length + h.sql.length > 0;

// Line number of a character offset, for findings people can jump to.
function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

module.exports = { SITE, listFiles, read, isVendor, isText, clientFiles, homeSurface, homeExists, lineOf };
