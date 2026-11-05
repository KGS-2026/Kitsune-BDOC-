// p166: the page may reach the local bridge (127.0.0.1:9876) only while something
// local is on. Before, one try of Wireshark Live saved a flag and every later visit
// polled the port forever.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'bdoc-plugin-renderer.js'), 'utf8');

function load({ ua = 'Mozilla/5.0 Chrome/141', stored = {} } = {}) {
  const store = { ...stored };
  const fetches = [];
  const timers = new Map();
  let nextId = 1;
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    navigator: { userAgent: ua },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    document: { readyState: 'complete', addEventListener() {} },
    fetch: async (url) => { fetches.push(url); throw new Error('ECONNREFUSED'); },
    setInterval: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearInterval: (id) => { timers.delete(id); },
    setTimeout: () => 0,
    clearTimeout: () => {},
    AbortController,
    V: { entities: { remove() {} } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const settle = () => new Promise((r) => setImmediate(r));
  return { pr: ctx.pluginRenderer, store, fetches, timers, settle };
}

test('p166: a web visit does not touch the local port, even with the old P155 flag saved', async () => {
  const t = load({ stored: { bdoc_local_ipc: '1' } });
  await t.settle();
  assert.strictEqual(t.fetches.length, 0);
  assert.strictEqual(t.timers.size, 0);
  assert.strictEqual(t.store.bdoc_local_ipc, undefined, 'the stale opt-in is cleared');
});

test('p166: polling runs while a local layer is on and stops when the last one is off', async () => {
  const t = load();
  await t.settle();
  t.pr.enable('wireshark');
  t.pr.enable('mesh');
  await t.settle();
  assert.ok(t.fetches.some((u) => u.includes('127.0.0.1:9876')));
  assert.strictEqual(t.timers.size, 1, 'one poll loop, not one per layer');

  t.pr.release('wireshark');
  assert.strictEqual(t.timers.size, 1, 'mesh is still on');
  t.pr.release('mesh');
  assert.strictEqual(t.timers.size, 0, 'nothing local is on, so nothing polls');
  assert.strictEqual(t.pr.pollHandle, null);

  t.pr.enable('skybridge');
  await t.settle();
  assert.strictEqual(t.timers.size, 1, 'turning a local layer back on restarts it');
});

test('p166: turning the layer off while the first check is in flight leaves nothing running', async () => {
  const t = load();
  await t.settle();
  t.pr.enable('wireshark');
  t.pr.release('wireshark');
  await t.settle();
  assert.strictEqual(t.timers.size, 0);
});

test('p166: the desktop app still polls from the start and keeps polling', async () => {
  const t = load({ ua: 'Mozilla/5.0 BDOC Electron/31' });
  await t.settle();
  assert.strictEqual(t.timers.size, 1);
  t.pr.enable('wireshark');
  t.pr.release('wireshark');
  assert.strictEqual(t.timers.size, 1);
});

test('p166: every local feature says when it turns on and off', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sky = fs.readFileSync(path.join(ROOT, 'js', 'modules', 'skybridge.js'), 'utf8');
  for (const who of ['wireshark', 'mesh']) {
    assert.match(html, new RegExp(`pluginRenderer\\.enable\\('${who}'\\)`));
    assert.match(html, new RegExp(`pluginRenderer\\.release\\('${who}'\\)`));
  }
  assert.match(sky, /pluginRenderer\.enable\('skybridge'\)/);
  assert.match(sky, /pluginRenderer\.release\('skybridge'\)/);
  assert.doesNotMatch(html + sky, /pluginRenderer\.enable\(\)/, 'an unnamed enable() could never be released');
});
