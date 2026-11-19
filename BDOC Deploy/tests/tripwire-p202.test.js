'use strict';
// p202 droplet tripwire: tools/hardening/bdoc-tripwire decides what to tell Healthchecks.io.
// Runs the real script under bash with a fake snapshot, a fake firewall log and a fake curl.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DIR = path.join(__dirname, '..', 'tools', 'hardening');
const SCRIPT = path.join(DIR, 'bdoc-tripwire');

function findBash() {
  if (process.platform !== 'win32') return 'bash';
  const git = 'C:\\Program Files\\Git\\bin\\bash.exe';
  return fs.existsSync(git) ? git : null;
}
const BASH = findBash();
const skip = BASH ? false : 'no usable bash on this machine';
const fwd = (p) => p.replace(/\\/g, '/');

const BASE = [
  'listen tcp 0.0.0.0:22 sshd',
  'exe /usr/sbin/sshd',
  'exe /usr/bin/node',
  'uid0 root',
  'keys /root/.ssh/authorized_keys aaaaaaaaaaaaaaaa',
  'sshdcfg bbbbbbbbbbbbbbbb',
  'unit hermes-gateway.service',
  'cron cccccccccccccccc',
];

function rig() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdoc-tw-'));
  const log = path.join(tmp, 'curl.log');
  const curl = path.join(tmp, 'fake-curl');
  fs.writeFileSync(curl, '#!/usr/bin/env bash\nn=$#\nbody="${@:n-1:1}"\nurl="${@:n:1}"\n{ printf "%s\\n" "$url"; printf "%s\\n" "$body"; printf "%s\\n" "----"; } >> "' + fwd(log) + '"\n');
  fs.chmodSync(curl, 0o755);
  const conf = path.join(tmp, 'pings.env');
  fs.writeFileSync(conf, 'HC_TRIPWIRE=https://hc.example/tw\n');
  const snap = path.join(tmp, 'snap');
  const blocked = path.join(tmp, 'blocked');
  fs.writeFileSync(blocked, '');
  const state = path.join(tmp, 'state');
  return {
    tmp,
    setSnap(lines) { fs.writeFileSync(snap, lines.join('\n') + '\n'); },
    setBlocked(text) { fs.writeFileSync(blocked, text); },
    run(mode, now) {
      if (fs.existsSync(log)) fs.unlinkSync(log);
      const env = {
        ...process.env,
        BDOC_TRIPWIRE_STATE: fwd(state),
        BDOC_ALARM_CONF: fwd(conf),
        BDOC_ALARM_CURL: fwd(curl),
        BDOC_TRIPWIRE_SNAPSHOT_FILE: fwd(snap),
        BDOC_TRIPWIRE_BLOCKED_FILE: fwd(blocked),
        BDOC_TRIPWIRE_LEARN_HOURS: '24',
        BDOC_TRIPWIRE_NOW: String(now),
      };
      const r = spawnSync(BASH, [fwd(SCRIPT), mode], { env, encoding: 'utf8' });
      const raw = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
      const pings = raw.split('----\n').filter(Boolean).map((chunk) => {
        const i = chunk.indexOf('\n');
        return { url: chunk.slice(0, i), body: chunk.slice(i + 1) };
      });
      return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), pings };
    },
    done() { fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}

const T0 = 1_800_000_000;
const DAY = 86400;

test('first run creates the baseline and reports OK', { skip }, () => {
  const r = rig();
  r.setSnap(BASE);
  const a = r.run('check', T0);
  assert.strictEqual(a.status, 0);
  assert.match(a.out, /baseline created/);
  assert.deepStrictEqual(a.pings.map((p) => p.url), ['https://hc.example/tw']);
  const b = r.run('check', T0 + 300);
  assert.match(b.out, /clean/);
  assert.strictEqual(b.pings[0].url, 'https://hc.example/tw');
  r.done();
});

test('a new public port fails at once and keeps failing until accepted', { skip }, () => {
  const r = rig();
  r.setSnap(BASE);
  r.run('check', T0);
  r.setSnap([...BASE, 'listen tcp 0.0.0.0:4444 nc']);
  const a = r.run('check', T0 + 300);
  assert.strictEqual(a.pings[0].url, 'https://hc.example/tw/fail');
  assert.match(a.pings[0].body, /NEW PUBLIC PORT tcp 0\.0\.0\.0:4444 nc/);
  const b = r.run('check', T0 + 600);
  assert.strictEqual(b.pings[0].url, 'https://hc.example/tw/fail', 'not learned automatically');
  r.run('accept', T0 + 700);
  const c = r.run('check', T0 + 900);
  assert.strictEqual(c.pings[0].url, 'https://hc.example/tw');
  r.done();
});

test('keys, root accounts, sshd config, services and cron changes all alert', { skip }, () => {
  const r = rig();
  r.setSnap(BASE);
  r.run('check', T0);
  r.setSnap([
    ...BASE.filter((l) => !/^(keys|sshdcfg|cron) /.test(l)),
    'keys /root/.ssh/authorized_keys dddddddddddddddd',
    'uid0 toor',
    'sshdcfg eeeeeeeeeeeeeeee',
    'unit evil.service',
    'cron ffffffffffffffff',
  ]);
  const a = r.run('check', T0 + 300);
  const body = a.pings[0].body;
  assert.strictEqual(a.pings[0].url, 'https://hc.example/tw/fail');
  for (const re of [/SSH KEYS CHANGED/, /NEW ROOT-LEVEL ACCOUNT toor/, /SSHD CONFIG CHANGED/, /NEW ENABLED SERVICE evil\.service/, /SYSTEM CRONTAB CHANGED/]) {
    assert.match(body, re);
  }
  assert.match(body, /bdoc-tripwire accept/);
  r.done();
});

test('new programs are learned silently in the first 24 h, then alert once', { skip }, () => {
  const r = rig();
  r.setSnap(BASE);
  r.run('check', T0);
  r.setSnap([...BASE, 'exe /usr/bin/python3']);
  const a = r.run('check', T0 + 3600);
  assert.strictEqual(a.pings[0].url, 'https://hc.example/tw', 'learning window: no alert');
  r.setSnap([...BASE, 'exe /usr/bin/python3', 'exe /usr/bin/socat']);
  const b = r.run('check', T0 + 2 * DAY);
  assert.strictEqual(b.pings[0].url, 'https://hc.example/tw/fail');
  assert.match(b.pings[0].body, /NEW PROGRAM \/usr\/bin\/socat/);
  assert.doesNotMatch(b.pings[0].body, /python3/);
  const c = r.run('check', T0 + 2 * DAY + 300);
  assert.strictEqual(c.pings[0].url, 'https://hc.example/tw', 'alerted once, then learned');
  r.done();
});

test('programs running from /tmp or a deleted file always alert', { skip }, () => {
  const r = rig();
  r.setSnap(BASE);
  r.run('check', T0);
  r.setSnap([...BASE, 'sus /tmp/.x/miner', 'sus /root/payload (deleted)']);
  const a = r.run('check', T0 + 300);
  assert.match(a.pings[0].body, /SUSPICIOUS PROGRAM \/tmp\/\.x\/miner/);
  assert.match(a.pings[0].body, /SUSPICIOUS PROGRAM \/root\/payload \(deleted\)/);
  const b = r.run('check', T0 + 600);
  assert.strictEqual(b.pings[0].url, 'https://hc.example/tw/fail', 'never learned');
  r.done();
});

test('outbound packets the firewall blocked are reported', { skip }, () => {
  const r = rig();
  r.setSnap(BASE);
  r.run('check', T0);
  r.setBlocked('      7 TCP 203.0.113.9:4444\n      1 UDP 198.51.100.2:6667\n');
  const a = r.run('check', T0 + 300);
  assert.strictEqual(a.pings[0].url, 'https://hc.example/tw/fail');
  assert.match(a.pings[0].body, /BLOCKED OUTBOUND 7 TCP 203\.0\.113\.9:4444/);
  assert.match(a.pings[0].body, /BLOCKED OUTBOUND 1 UDP 198\.51\.100\.2:6667/);
  r.done();
});

test('hardening files say what the HANDOFF says', () => {
  const sshd = fs.readFileSync(path.join(DIR, '10-bdoc-hardening.conf'), 'utf8');
  for (const re of [/^PermitRootLogin prohibit-password$/m, /^PasswordAuthentication no$/m, /^X11Forwarding no$/m, /^MaxAuthTries 3$/m]) {
    assert.match(sshd, re);
  }
  const fw = fs.readFileSync(path.join(DIR, 'apply-firewall.sh'), 'utf8');
  assert.match(fw, /ufw default deny incoming/);
  assert.match(fw, /ufw default deny outgoing/);
  assert.match(fw, /--on-active=300 --unit=bdoc-fw-rollback/, 'rollback is armed by default');
  const allowedOut = [...fw.matchAll(/^ufw allow out (\S+)/gm)].map((m) => m[1]).sort();
  assert.deepStrictEqual(allowedOut, ['123/udp', '22/tcp', '443/tcp', '53', '67:68/udp', '80/tcp']);
  const timer = fs.readFileSync(path.join(DIR, 'bdoc-tripwire.timer'), 'utf8');
  assert.match(timer, /^OnUnitActiveSec=300$/m);
});

test('p205: a canary file changing or vanishing alerts and stays down until accepted', { skip }, () => {
  const r = rig();
  r.setSnap([...BASE, 'canary /root/.config/kgs-ops/credentials.env 11:200:1700000000']);
  r.run('check', T0);
  r.setSnap([...BASE, 'canary /root/.config/kgs-ops/credentials.env MISSING']);
  const a = r.run('check', T0 + 300);
  assert.strictEqual(a.pings[0].url, 'https://hc.example/tw/fail');
  assert.match(a.pings[0].body, /CANARY FILE CHANGED OR DELETED \/root\/\.config\/kgs-ops\/credentials\.env MISSING/);
  const b = r.run('check', T0 + 600);
  assert.strictEqual(b.pings[0].url, 'https://hc.example/tw/fail');
  r.done();
});

test('p205: audit events on the canary file are reported with the program that opened it', { skip }, () => {
  const r = rig();
  r.setSnap(BASE);
  r.run('check', T0);
  const events = path.join(r.tmp, 'events');
  fs.writeFileSync(events, '1795120534.283 exe=/usr/bin/cat comm=cat uid=0 auid=0\n');
  process.env.BDOC_TRIPWIRE_CANARY_EVENTS_FILE = fwd(events);
  try {
    const a = r.run('check', T0 + 300);
    assert.strictEqual(a.pings[0].url, 'https://hc.example/tw/fail');
    assert.match(a.pings[0].body, /CANARY FILE OPENED at 2026-11-19 \d\d:\d\d:\d\dZ exe=\/usr\/bin\/cat comm=cat uid=0/);
  } finally {
    delete process.env.BDOC_TRIPWIRE_CANARY_EVENTS_FILE;
  }
  r.done();
});

test('p205: the audit parser keeps only file accesses newer than the last report, minus rule loads', { skip }, () => {
  const sample = [
    '----',
    'type=PROCTITLE msg=audit(1795120531.163:318): proctitle=636174',
    'type=SYSCALL msg=audit(1795120472.100:188): arch=c000003e syscall=44 success=yes exit=1104 auid=0 uid=0 comm="auditctl" exe="/usr/sbin/auditctl" key="bdoc-canary"',
    'type=SYSCALL msg=audit(1795120531.163:318): arch=c000003e syscall=257 success=yes exit=3 auid=0 uid=0 comm="cat" exe="/usr/bin/cat" key="bdoc-canary"',
    'type=SYSCALL msg=audit(1795120600.500:400): arch=c000003e syscall=257 success=yes exit=3 auid=1000 uid=0 comm="python3" exe="/usr/bin/python3.12" key="bdoc-canary"',
  ].join('\n');
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const fn = src.slice(src.indexOf('parse_audit() {'), src.indexOf('}\' | head -n 10') + 18);
  const run = (last) => spawnSync(BASH, ['-c', `${fn}\nparse_audit ${last}`], { input: sample, encoding: 'utf8' }).stdout.trim();
  assert.strictEqual(run(0), '1795120531.163 exe=/usr/bin/cat comm=cat uid=0 auid=0\n1795120600.500 exe=/usr/bin/python3.12 comm=python3 uid=0 auid=1000');
  assert.strictEqual(run('1795120531.163'), '1795120600.500 exe=/usr/bin/python3.12 comm=python3 uid=0 auid=1000');
});
