// Invariant 10: no global security claim. Security is stated per tier, about a
// named control, never as "BDOC is secure".
// ACTIVE today on everything a visitor reads: the pages, the scripts that write
// the UI, the web manifest, SECURITY.md, and the package description that ships
// with the desktop app. Exceptions go in .ci/allowlist.json with a reason.
'use strict';
const files = require('../lib/files');
const allow = require('../lib/allowlist');
const { make } = require('../lib/result');

const ID = 'inv10';
const TITLE = 'No global security claim; per-tier statements only';
const CLAIMS = [
  /\b(military|defen[cs]e|bank|enterprise|government)[- ](grade|level)\s+(security|encryption|protection|privacy)\b/i,
  /\bunhackable\b/i,
  /\bhack[- ]?proof\b/i,
  /\bcan(?:not|['’]t) be hacked\b/i,
  /\b100\s?%\s+(secure|safe|private|protected)\b/i,
  /\b(fully|completely|totally|perfectly|absolutely)\s+(secure|encrypted|private|protected)\b/i,
  /\bend[- ]to[- ]end[- ]encrypt/i,
  /\bnsa[- ]proof\b/i,
  /\bimpenetrable\b/i,
  /\bzero[- ]knowledge\b/i,
  /\bguaranteed\s+(security|privacy|protection)\b/i,
  /\b(bulletproof|ironclad)\s+(security|encryption|protection)\b/i,
];

function run(root) {
  const r = make(ID, TITLE);
  const site = files.SITE + '/';
  const scope = [...files.clientFiles(root), site + 'package.json', site + 'SECURITY.md']
    .filter((f, i, a) => a.indexOf(f) === i && files.listFiles(root).includes(f));
  const list = allow.entries(root, ID);
  for (const f of scope) {
    const text = files.read(root, f);
    for (const re of CLAIMS) {
      const m = text.match(re);
      if (!m) continue;
      const e = list.find(x => x.file === f && x.match && m[0].toLowerCase() === x.match.toLowerCase() && allow.active(x));
      if (e) (allow.warns(e) ? r.warn : r.note)(allow.note(e));
      else r.fail(`${f}:${files.lineOf(text, m.index)} global security claim "${m[0]}": say what protects whom, per tier`);
    }
  }
  r.note(`scanned ${scope.length} visitor-facing files`);
  return r.done();
}

module.exports = { id: ID, title: TITLE, run };
