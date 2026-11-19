// Invariant 5: no durable credential in the client. Anything the client holds is
// minted per request and lives 15 minutes or less.
// ACTIVE today: runs the repo secret scanner (JWTs included) over everything the
// browser or desktop app receives. A known token stays only while it is listed
// in .ci/allowlist.json under inv05 with a reason and an expiry, and it prints
// every run. Relay part (DORMANT until relay/ exists): presigned links and
// minted tokens may not live longer than 900 seconds.
'use strict';
const files = require('../lib/files');
const allow = require('../lib/allowlist');
const secrets = require('../lib/secrets');
const { make } = require('../lib/result');

const ID = 'inv05';
const TITLE = 'No durable credential in the client (minted per request, <=15 min)';
const MAX_TTL_SECONDS = 900;
const TTL_RE = /\b(expiresIn|expires_in|expiresInSeconds|X-Amz-Expires|ttl|ttlSeconds|ttl_seconds|max_age|maxAge)\b["']?\s*[:=]\s*(\d+)/g;

function run(root) {
  const r = make(ID, TITLE);
  const client = files.clientFiles(root);
  const hits = [];
  for (const f of client) hits.push(...secrets.scanText(files.read(root, f), f));
  const { allowed, open } = secrets.triage(hits, allow.entries(root, ID));
  for (const h of open) r.fail(`${h.file}:${h.line} ${h.rule} ${h.preview} (fingerprint ${h.fingerprint}) ships to every visitor`);
  for (const a of allowed) (allow.warns(a.entry) ? r.warn : r.note)(allow.note(a.entry) + ` [${a.rule} at line ${a.line}]`);
  r.note(`scanned ${client.length} client files`);

  const home = files.homeSurface(root);
  if (!home.relay.length) {
    r.note('relay token lifetime rule is DORMANT until relay/ exists');
  } else {
    for (const f of home.relay) {
      const text = files.read(root, f);
      for (const m of text.matchAll(TTL_RE))
        if (+m[2] > MAX_TTL_SECONDS) r.fail(`${f}:${files.lineOf(text, m.index)} ${m[1]} = ${m[2]} s; relay links and tokens live <= ${MAX_TTL_SECONDS} s`);
    }
    r.note(`checked token lifetimes in ${home.relay.length} relay files`);
  }
  return r.done();
}

module.exports = { id: ID, title: TITLE, run, MAX_TTL_SECONDS };
