// p200 (T200): every suppression lives in one file, .ci/allowlist.json, keyed
// by check (inv01 ... inv12, secrets). Invariant 9 says every suppression logs a
// reason, so each entry needs a kind, a reason, who accepted it, a date and an
// expiry. inv09 enforces that; the checks print every entry they use.
//
// kind:
//   design          an allowed thing, not a risk (e.g. the local bridge port)
//   accepted-risk   a risk someone signed for; WARN while accepted_by is UNSIGNED
//   open-violation  a known breach waiting on a fix; always WARN, FAILs on expiry
'use strict';
const fs = require('fs');
const path = require('path');

const KINDS = new Set(['design', 'accepted-risk', 'open-violation']);
const today = () => new Date().toISOString().slice(0, 10);

function load(root) {
  const p = path.join(root, '.ci', 'allowlist.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

const entries = (root, check) => (load(root)[check] || []).filter(e => e && typeof e === 'object');
const active = e => !e.expires || e.expires >= today();
const unsigned = e => !e.accepted_by || /^unsigned/i.test(String(e.accepted_by));
const warns = e => e.kind === 'open-violation' || (e.kind === 'accepted-risk' && unsigned(e));

function note(e) {
  const who = unsigned(e) ? ', UNSIGNED' : ', signed ' + e.accepted_by;
  return `allowed: ${e.file}${e.match ? ' ' + e.match : ''} [${e.kind}${who}, expires ${e.expires}] reason: ${e.reason}`;
}

function problems(e) {
  const out = [];
  for (const k of ['file', 'kind', 'reason', 'accepted_by', 'date', 'expires'])
    if (!e[k] || !String(e[k]).trim()) out.push('missing ' + k);
  if (e.kind && !KINDS.has(e.kind)) out.push('unknown kind "' + e.kind + '"');
  for (const k of ['date', 'expires'])
    if (e[k] && !/^\d{4}-\d{2}-\d{2}$/.test(e[k])) out.push(k + ' is not YYYY-MM-DD');
  if (e.expires && e.expires < today()) out.push('expired on ' + e.expires + ': fix it, or re-sign it with a new date');
  if (e.reason && String(e.reason).trim().length < 10) out.push('reason too short to mean anything');
  if (!e.match && !e.fingerprint) out.push('needs a match or a fingerprint');
  return out;
}

module.exports = { KINDS, today, load, entries, active, unsigned, warns, note, problems };
