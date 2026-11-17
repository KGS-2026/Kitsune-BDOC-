// Invariant 2: the hub opens every connection; nothing dials into a home.
// DORMANT until relay/ (or hub/) exists. Then, a static tripwire:
//  - relay code never listens for connections;
//  - relay code never dials an address taken from a hub, home, device or camera
//    record, and holds no literal hosts (its outbound targets, the store and the
//    dead-man, come from BDOC_HOME_* environment variables);
//  - hub code never accepts inbound connections unless an allowlist entry says
//    why (e.g. a LAN-side service for the camera segment).
'use strict';
const files = require('../lib/files');
const allow = require('../lib/allowlist');
const { make } = require('../lib/result');

const ID = 'inv02';
const TITLE = 'Hub initiates all connections; no inbound dial to the home';
const LISTEN_RE = /\bcreateServer\s*\(|\.listen\s*\(|\bdgram\b|net\.Listen\s*\(|ListenAndServe|TcpListener::bind|\bsocket\.bind\s*\(/;
const DIAL_RE = /\b(fetch|request|connect|WebSocket|dial|Dial|DialContext|axios|got|undici)\s*\(/;
const HUB_ADDR_RE = /\b(hub|home|customer|device|camera|cam)_?(ip|host|addr(ess)?|url|endpoint|port)\b/i;
const LITERAL_URL_RE = /\b(?:https?|wss?|mqtts?|tcp|tls):\/\/[a-z0-9][a-z0-9.\-\[\]:]*/gi;

function run(root) {
  const r = make(ID, TITLE);
  const home = files.homeSurface(root);
  if (!home.relay.length && !home.hub.length) {
    r.dormant('no relay/ or hub/ yet; arms itself when either appears');
    return r.done();
  }
  const list = allow.entries(root, ID);
  for (const f of home.relay) {
    const lines = files.read(root, f).split('\n');
    lines.forEach((line, i) => {
      const where = `${f}:${i + 1}`;
      if (LISTEN_RE.test(line)) r.fail(`${where} relay listens for connections; the relay only answers platform requests`);
      if (DIAL_RE.test(line) && HUB_ADDR_RE.test(line)) r.fail(`${where} relay dials an address from a hub or customer record`);
      for (const m of line.matchAll(LITERAL_URL_RE)) {
        const e = list.find(x => x.file === f && x.match === m[0] && allow.active(x));
        if (e) r.note(allow.note(e));
        else r.fail(`${where} literal host ${m[0]}; outbound targets come from BDOC_HOME_* env vars`);
      }
    });
  }
  for (const f of home.hub) {
    files.read(root, f).split('\n').forEach((line, i) => {
      if (!LISTEN_RE.test(line)) return;
      const e = list.find(x => x.file === f && line.includes(x.match) && allow.active(x));
      if (e) r.note(allow.note(e));
      else r.fail(`${f}:${i + 1} hub accepts inbound connections`);
    });
  }
  r.note(`checked ${home.relay.length} relay and ${home.hub.length} hub files`);
  return r.done();
}

module.exports = { id: ID, title: TITLE, run };
