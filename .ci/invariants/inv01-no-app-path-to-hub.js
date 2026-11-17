// Invariant 1: the app has no network path to the hub or its tunnel; it talks
// to the relay only.
// ACTIVE today. Scans everything the browser or desktop app runs for addresses
// on a home network (private ranges, mDNS / .lan names), tunnel services and
// camera protocols. Loopback (this computer) is allowed only on the host:port
// pairs listed in .ci/allowlist.json, each with a reason. Static tripwire: a URL
// built at runtime from variables is not visible to it.
'use strict';
const files = require('../lib/files');
const allow = require('../lib/allowlist');
const { make } = require('../lib/result');

const ID = 'inv01';
const TITLE = 'App has no network path to hub or tunnel (relay only)';
const URL_RE = /\b(https?|wss?|rtsps?|rtmp|onvif):\/\/([^\s'"`<>\/?#\\(),;|*]+)/gi;
const TUNNEL_RE = /(^|\.)(trycloudflare\.com|ngrok\.io|ngrok-free\.app|ngrok\.app|ts\.net|loca\.lt|localtunnel\.me|serveo\.net|playit\.gg|zrok\.io|pinggy\.link|tunnelto\.dev)$/i;
const LAN_NAME_RE = /(^|\.)(local|lan|home\.arpa|internal|localdomain)$/i;

function hostPort(authority) {
  const a = authority.replace(/^[^@]*@/, ''); // drop user:pass@
  const m = a.match(/^\[([^\]]+)\](?::(\d+))?$/) || a.match(/^([^:]+)(?::(\d+))?$/);
  const host = (m ? m[1] : a).toLowerCase().replace(/\.+$/, ''); // "http://10.0.0.1." at the end of a sentence
  return { host, port: m && m[2] || '' };
}

function privateV4(h) {
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127); // 100.64/10 = CGNAT / Tailscale
}
const privateV6 = h => /^f[cd][0-9a-f]{2}:/i.test(h) || /^fe80:/i.test(h);
const loopback = h => h === 'localhost' || /^127\./.test(h) || h === '::1' || h === '0.0.0.0';

function run(root) {
  const r = make(ID, TITLE);
  const client = files.clientFiles(root);
  const list = allow.entries(root, ID);
  const used = new Set();
  for (const f of client) {
    const text = files.read(root, f);
    for (const m of text.matchAll(URL_RE)) {
      const scheme = m[1].toLowerCase();
      if (m[2].includes('${') || m[2].includes('+')) continue; // built at runtime: invisible here
      const { host, port } = hostPort(m[2]);
      const where = `${f}:${files.lineOf(text, m.index)}`;
      if (/^(rtsps?|rtmp|onvif)$/.test(scheme)) { r.fail(`${where} camera protocol ${scheme}:// in app code`); continue; }
      if (TUNNEL_RE.test(host)) { r.fail(`${where} tunnel service ${host}`); continue; }
      if (privateV4(host) || privateV6(host) || LAN_NAME_RE.test(host)) { r.fail(`${where} home-network address ${host}`); continue; }
      if (loopback(host)) {
        const hp = host + (port ? ':' + port : '');
        const e = list.find(x => f.startsWith(x.file) && x.match === hp && allow.active(x));
        if (!e) { r.fail(`${where} loopback ${hp} is not on the allowlist (add it with a reason, or remove it)`); continue; }
        used.add(e);
      }
    }
  }
  r.note(`scanned ${client.length} client files (web + desktop)`);
  for (const e of used) (allow.warns(e) ? r.warn : r.note)(allow.note(e));
  return r.done();
}

module.exports = { id: ID, title: TITLE, run };
