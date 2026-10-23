// Live security test: start the real receiver, attack it, assert it holds.
// Regression guard for the 2026-10-08 review finding #4 — the bridge replied
// `Access-Control-Allow-Origin: *`, so ANY website open in the same browser
// could read the operator's packet captures and Wi-Fi scans.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.BDOC_TEST_IPC_PORT || 9879);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN_FILE = path.join(os.homedir(), '.bdoc', 'bridge_token');
const EVIL = 'https://evil.example';
const GOOD = 'https://kgsbdoc.netlify.app';

let srv, token = '', startupLog = '';

async function hit(p, headers) {
  try {
    const r = await fetch(BASE + p, { headers: headers || {}, signal: AbortSignal.timeout(5000) });
    return { status: r.status, acao: r.headers.get('access-control-allow-origin') };
  } catch (e) {
    return { status: 'ERR', acao: null, err: String(e.name) };
  }
}

before(async () => {
  srv = spawn('node', [path.join(__dirname, '..', 'tools', 'bdoc-ipc-receiver.js')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BDOC_IPC_PORT: String(PORT) }
  });
  srv.stdout.on('data', d => { startupLog += d; });
  srv.stderr.on('data', d => { startupLog += d; });
  await new Promise(r => setTimeout(r, 1500));
  token = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : '';
});

after(() => { if (srv) srv.kill('SIGINT'); });

test('THE EXPLOIT: foreign site cannot read packet data', async () => {
  const r = await hit('/api/v1/wireshark/packet', { Origin: EVIL });
  assert.equal(r.status, 403);
  assert.notEqual(r.acao, '*');
  assert.notEqual(r.acao, EVIL);
});

test('foreign site cannot read wifi scan or shodan either', async () => {
  for (const p of ['/api/v1/wifi/scan', '/api/v1/shodan/device', '/api/v1/sensor/reading']) {
    const r = await hit(p, { Origin: EVIL });
    assert.equal(r.status, 403, p + ' was not blocked');
  }
});

test('correct origin without a pairing token -> 401', async () => {
  const r = await hit('/api/v1/wireshark/packet', { Origin: GOOD });
  assert.equal(r.status, 401);
});

test('correct origin with a wrong token -> 401', async () => {
  const r = await hit('/api/v1/wireshark/packet', { Origin: GOOD, 'X-BDOC-Bridge': 'wrong-token' });
  assert.equal(r.status, 401);
});

test('correct origin + correct token -> 200 (BDOC still works)', async () => {
  const r = await hit('/api/v1/wireshark/packet', { Origin: GOOD, 'X-BDOC-Bridge': token });
  assert.equal(r.status, 200);
  assert.equal(r.acao, GOOD);
});

test('non-browser client with no Origin still needs the token', async () => {
  const r = await hit('/api/v1/wireshark/packet', {});
  assert.equal(r.status, 401);
});

test('/status stays open so the UI can show "running, not paired"', async () => {
  const r = await hit('/api/v1/status', { Origin: GOOD });
  assert.equal(r.status, 200);
});

test('no response anywhere carries Access-Control-Allow-Origin: *', async () => {
  const probes = [
    ['/api/v1/status', { Origin: GOOD }],
    ['/api/v1/status', { Origin: EVIL }],
    ['/api/v1/wireshark/packet', { Origin: EVIL }],
    ['/api/v1/wireshark/packet', { Origin: GOOD, 'X-BDOC-Bridge': token }],
    ['/api/v1/nope/nope', { Origin: GOOD, 'X-BDOC-Bridge': token }]
  ];
  for (const [p, h] of probes) {
    const r = await hit(p, h);
    assert.notEqual(r.acao, '*', `wildcard CORS on ${p}`);
  }
});

test('pairing token is printed at startup', () => {
  assert.ok(startupLog.includes('PAIRING REQUIRED'), 'operator would see a dead bridge with no hint');
});
