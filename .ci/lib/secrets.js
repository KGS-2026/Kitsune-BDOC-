// p200 (T200): secret scanner. No downloads, runs offline, and never prints a
// secret: a finding carries its first four characters, its length and a
// 16-hex fingerprint (sha256 prefix), which is also how .ci/allowlist.json
// names a known token without repeating it. Rules cover the services BDOC,
// Hermes and the desktop app actually use. CI also runs gitleaks on each push.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const files = require('./files');
const allow = require('./allowlist');

// Order matters: when two rules match the same characters, the earlier one wins.
const RULES = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g],
  // Real Stripe keys carry 24+ characters after the prefix; shorter ones are doc examples.
  ['stripe-secret', /\bsk_(?:live|test)_[0-9A-Za-z]{24,}/g],
  ['stripe-restricted', /\brk_(?:live|test)_[0-9A-Za-z]{24,}/g],
  ['stripe-webhook-secret', /\bwhsec_[0-9A-Za-z+/=]{24,}/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['github-token', /\b(?:gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,})/g],
  ['slack-token', /\bxox[abposr]-[0-9A-Za-z-]{10,}/g],
  ['slack-webhook', /hooks\.slack\.com\/services\/T[0-9A-Z]+\/B[0-9A-Z]+\/[0-9A-Za-z]+/g],
  ['discord-webhook', /discord(?:app)?\.com\/api\/webhooks\/\d+\/[0-9A-Za-z_-]{20,}/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g],
  ['telegram-bot-token', /\b\d{8,10}:AA[0-9A-Za-z_-]{33}(?![0-9A-Za-z_-])/g],
  ['anthropic-key', /\bsk-ant-[0-9A-Za-z_-]{20,}/g],
  // Project / service / admin keys, or the legacy 48 letters-and-digits form.
  // (A plain "sk-..." with hyphens is a URL slug far more often than a key.)
  ['openai-key', /\bsk-(?:proj|svcacct|admin)-[0-9A-Za-z_-]{20,}|\bsk-[0-9A-Za-z]{48}(?![0-9A-Za-z_-])/g],
  ['mem0-key', /\bm0-[0-9A-Za-z]{30,}/g],
  ['supabase-secret-key', /\bsb_secret_[0-9A-Za-z_-]{20,}/g],
];
const JWT_RE = /\beyJ[0-9A-Za-z_-]{8,}\.eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}/g;
const KEY_LITERAL_RE = /\b(api[_-]?key|apikey|secret(?:[_-]?key)?|client[_-]?secret|access[_-]?token|auth[_-]?token|private[_-]?key|password|passwd|token)\b["']?\s*[:=]\s*["'`]([^"'`\s]{20,})["'`]/gi;
const PLACEHOLDER_RE = /your[_-]|_here\b|example|placeholder|changeme|xxxx|dummy|sample|fake|redacted|<|>|\$\{|\{\{|process\.env/i;

const fingerprint = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const preview = s => s.slice(0, 4) + '…(' + s.length + ')';

function jwtRole(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role || ''; }
  catch (_) { return ''; }
}

// Findings in one text. Each: { rule, severity, file, line, preview, fingerprint }
function scanText(text, file) {
  const hits = []; // { start, end, rule, severity, value }
  const overlaps = (s, e) => hits.some(h => s < h.end && e > h.start);
  const add = (start, value, rule, severity) => {
    const end = start + value.length;
    if (!overlaps(start, end)) hits.push({ start, end, rule, severity, value });
  };
  for (const [rule, re] of RULES) for (const m of text.matchAll(re)) add(m.index, m[0], rule, 'secret');
  for (const m of text.matchAll(JWT_RE)) {
    const service = jwtRole(m[0]) === 'service_role';
    add(m.index, m[0], service ? 'supabase-service-role-jwt' : 'jwt', service ? 'secret' : 'client-token');
  }
  for (const m of text.matchAll(KEY_LITERAL_RE)) {
    const value = m[2];
    if (PLACEHOLDER_RE.test(value) || new Set(value).size < 8) continue;
    add(m.index + m[0].lastIndexOf(value), value, 'key-named-literal', 'secret');
  }
  return hits.sort((a, b) => a.start - b.start).map(h => ({
    rule: h.rule, severity: h.severity, file, line: files.lineOf(text, h.start),
    preview: preview(h.value), fingerprint: fingerprint(h.value),
  }));
}

const MAX_BYTES = 4 * 1024 * 1024;

function readText(root, rel) {
  try {
    const abs = path.join(root, rel);
    if (fs.statSync(abs).size > MAX_BYTES) return null;
    const buf = fs.readFileSync(abs);
    return buf.subarray(0, 8000).includes(0) ? null : buf.toString('utf8');
  } catch (_) { return null; }
}

// Match findings against an allowlist section (file + fingerprint, still in force).
function triage(hits, list) {
  const allowed = [], open = [];
  for (const h of hits) {
    const e = list.find(x => x.file === h.file && x.fingerprint === h.fingerprint && allow.active(x));
    if (e) allowed.push({ ...h, kind: e.kind, reason: e.reason, expires: e.expires, accepted_by: e.accepted_by, entry: e });
    else open.push(h);
  }
  return { allowed, open };
}

// Every tracked (and untracked, not ignored) text file in the repo.
function scanRepo(root) {
  let scanned = 0;
  const hits = [];
  for (const f of files.listFiles(root)) {
    const text = readText(root, f);
    if (text === null) continue;
    scanned++;
    hits.push(...scanText(text, f));
  }
  return { scanned, ...triage(hits, allow.entries(root, 'secrets')) };
}

module.exports = { RULES, scanText, scanRepo, triage, readText, fingerprint };
