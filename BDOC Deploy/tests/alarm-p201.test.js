'use strict';
// p201 outage alarm: tools/alarm/bdoc-alarm-ping decides what to tell Healthchecks.io.
// Runs the real script under bash with a fake curl (logs its calls) and a fake systemctl.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'tools', 'alarm');
const SCRIPT = path.join(DIR, 'bdoc-alarm-ping');

function findBash() {
  if (process.platform !== 'win32') return 'bash';
  // On Windows, plain "bash" can resolve to WSL; use Git Bash when present.
  const git = 'C:\\Program Files\\Git\\bin\\bash.exe';
  return fs.existsSync(git) ? git : null;
}
const BASH = findBash();
const skip = BASH ? false : 'no usable bash on this machine';

const fwd = (p) => p.replace(/\\/g, '/');

function run(mode, { conf, states = {} }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdoc-alarm-'));
  const log = path.join(tmp, 'curl.log');
  const curl = path.join(tmp, 'fake-curl');
  const sysctl = path.join(tmp, 'fake-systemctl');
  // fake curl: record body + URL (the last two args), succeed
  fs.writeFileSync(curl, '#!/usr/bin/env bash\nn=$#\nbody="${@:n-1:1}"\nurl="${@:n:1}"\nprintf "%s|%s\\n" "$url" "$body" >> "' + fwd(log) + '"\n');
  // fake systemctl: "is-active UNIT" prints $STATE_<unit with - as _>
  fs.writeFileSync(sysctl, '#!/usr/bin/env bash\nv="STATE_${2//-/_}"\necho "${!v:-unknown}"\n');
  fs.chmodSync(curl, 0o755);
  fs.chmodSync(sysctl, 0o755);
  let confPath = path.join(tmp, 'pings.env');
  if (conf === null) confPath = path.join(tmp, 'missing.env');
  else fs.writeFileSync(confPath, conf);
  const env = { ...process.env, BDOC_ALARM_CONF: fwd(confPath), BDOC_ALARM_CURL: fwd(curl), BDOC_ALARM_SYSTEMCTL: fwd(sysctl) };
  for (const [u, s] of Object.entries(states)) env['STATE_' + u.replace(/-/g, '_')] = s;
  const r = spawnSync(BASH, [fwd(SCRIPT), mode], { env, encoding: 'utf8' });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('|');
    return { url: l.slice(0, i), body: l.slice(i + 1) };
  }) : [];
  fs.rmSync(tmp, { recursive: true, force: true });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), calls };
}

const CONF = [
  'BDOC_ALARM_SERVICES="hermes-gateway bdoc-wire bdoc-alarm-canary"',
  'HC_HEARTBEAT=https://hc.example/hb',
  'HC_LIFECYCLE=https://hc.example/life',
  'HC_SVC_hermes_gateway=https://hc.example/hermes',
  'HC_SVC_bdoc_wire=https://hc.example/wire',
  'HC_SVC_bdoc_alarm_canary=https://hc.example/canary',
  '',
].join('\n');

test('no pings.env: dormant, exits 0, sends nothing', { skip }, () => {
  const r = run('tick', { conf: null });
  assert.strictEqual(r.status, 0);
  assert.match(r.out, /dormant/);
  assert.deepStrictEqual(r.calls, []);
});

test('tick with everything up: heartbeat, lifecycle keep-alive and one OK ping per service', { skip }, () => {
  const r = run('tick', { conf: CONF, states: { 'hermes-gateway': 'active', 'bdoc-wire': 'active', 'bdoc-alarm-canary': 'active' } });
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(r.calls.map((c) => c.url), [
    'https://hc.example/hb', 'https://hc.example/life',
    'https://hc.example/hermes', 'https://hc.example/wire', 'https://hc.example/canary',
  ]);
  assert.match(r.calls[0].body, /host=.*load .*disk/);
});

test('a killed service sends /fail at once; the others still report OK', { skip }, () => {
  const r = run('tick', { conf: CONF, states: { 'hermes-gateway': 'active', 'bdoc-wire': 'active', 'bdoc-alarm-canary': 'failed' } });
  const canary = r.calls.find((c) => c.url.startsWith('https://hc.example/canary'));
  assert.strictEqual(canary.url, 'https://hc.example/canary/fail');
  assert.match(canary.body, /bdoc-alarm-canary is failed/);
  assert.ok(r.calls.some((c) => c.url === 'https://hc.example/wire'));
});

test('inactive or missing units fail; a unit mid-restart is left to the grace time', { skip }, () => {
  const r = run('tick', { conf: CONF, states: { 'hermes-gateway': 'activating', 'bdoc-wire': 'inactive' } });
  const urls = r.calls.map((c) => c.url);
  assert.ok(!urls.some((u) => u.includes('/hermes')), 'no ping while activating');
  assert.ok(urls.includes('https://hc.example/wire/fail'));
  assert.ok(urls.includes('https://hc.example/canary/fail'), 'unknown unit counts as down');
});

test('boot pings the lifecycle check OK; a clean shutdown pings it /fail', { skip }, () => {
  const b = run('boot', { conf: CONF });
  assert.deepStrictEqual(b.calls.map((c) => c.url), ['https://hc.example/life']);
  assert.match(b.calls[0].body, /^booted/);
  const s = run('shutdown', { conf: CONF });
  assert.deepStrictEqual(s.calls.map((c) => c.url), ['https://hc.example/life/fail']);
  assert.match(s.calls[0].body, /clean shutdown/);
});

test('ping URLs never appear in the log output', { skip }, () => {
  const r = run('tick', { conf: CONF, states: { 'bdoc-wire': 'failed' } });
  assert.doesNotMatch(r.out, /hc\.example/);
});

test('units and installer agree on paths and the 2-minute period', () => {
  const timer = fs.readFileSync(path.join(DIR, 'bdoc-alarm.timer'), 'utf8');
  assert.match(timer, /^OnUnitActiveSec=120$/m);
  const svc = fs.readFileSync(path.join(DIR, 'bdoc-alarm.service'), 'utf8');
  assert.match(svc, /^ExecStart=\/usr\/local\/bin\/bdoc-alarm-ping tick$/m);
  const life = fs.readFileSync(path.join(DIR, 'bdoc-alarm-lifecycle.service'), 'utf8');
  assert.match(life, /^ExecStop=\/usr\/local\/bin\/bdoc-alarm-ping shutdown$/m);
  assert.match(life, /^After=network-online\.target$/m);
  const inst = fs.readFileSync(path.join(DIR, 'install.sh'), 'utf8');
  for (const u of ['bdoc-alarm.service', 'bdoc-alarm.timer', 'bdoc-alarm-lifecycle.service', 'bdoc-alarm-canary.service']) {
    assert.ok(inst.includes(u), 'installer copies ' + u);
  }
  const example = fs.readFileSync(path.join(DIR, 'pings.env.example'), 'utf8');
  assert.doesNotMatch(example, /hc-ping\.com\/[0-9a-f]{8}-/i, 'template holds no real ping URL');
});
