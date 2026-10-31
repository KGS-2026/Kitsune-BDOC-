// Web Push: the checks that decide whether "sendReady" and a dry run can be trusted,
// and what happens to a subscription when the signing key changes. A wrong answer here
// is silent: it passes every status check and fails on the first real alert.
//
// @netlify/blobs and web-push are not installed in CI, so both are swapped for stubs
// the same way wire-function.test.js does it. The real library was checked by hand
// against a strict fake push service and against FCM; see HANDOFF p161.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'netlify', 'functions');
const SUBSCRIBE_SRC = fs.readFileSync(path.join(FN, 'push-subscribe.mjs'), 'utf8');
const SEND_SRC = fs.readFileSync(path.join(FN, 'push-send.mjs'), 'utf8');
const CLIENT_SRC = fs.readFileSync(path.join(ROOT, 'js', 'bdoc-push.js'), 'utf8');

const P140 = SUBSCRIBE_SRC.match(/const P140_PUBLIC = '([^']+)'/)[1];
const GATE = 'gate-value-for-tests';
const URL_SEND = 'https://kgsbdoc.netlify.app/.netlify/functions/push-send';
const URL_SUB = 'https://kgsbdoc.netlify.app/.netlify/functions/push-subscribe';

function newKey() {
  const priv = crypto.randomBytes(32);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(priv);
  return { priv: priv.toString('base64url'), pub: ecdh.getPublicKey('base64url') };
}

const dataUrl = (src) => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');

function fakeStore(records = {}) {
  const m = new Map(Object.entries(records).map(([k, v]) => [k, JSON.stringify(v)]));
  m.set('index.json', JSON.stringify({ keys: Object.keys(records) }));
  return {
    m,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    roster() { return JSON.parse(m.get('index.json')).keys; }
  };
}

function fakeWebpush(statusFor = () => 0) {
  const calls = { sent: [], built: [], signed: 0 };
  return {
    calls,
    setVapidDetails() {},
    getVapidHeaders() { calls.signed++; return {}; },
    generateRequestDetails(sub) {
      if (!sub.keys.p256dh) throw new Error('bad p256dh');
      calls.built.push(sub.endpoint);
      return {};
    },
    async sendNotification(sub) {
      calls.sent.push(sub.endpoint);
      const statusCode = statusFor(sub.endpoint);
      if (statusCode) throw Object.assign(new Error('refused'), { statusCode });
    }
  };
}

const rec = (endpoint, vapid, tier = 'recon') => ({
  subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } }, tier, ...(vapid ? { vapid } : {})
});

// Every load gets a fresh module, because the signing key is read at import.
let loads = 0;
async function load(t, env, { store = fakeStore(), webpush = fakeWebpush(), p140 = P140 } = {}) {
  const keys = ['VAPID_PRIVATE_KEY', 'PUSH_SEND_KEY'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) { if (k in env) process.env[k] = env[k]; else delete process.env[k]; }
  globalThis.__pushStore = store;
  globalThis.__pushLib = webpush;
  t.after(() => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    delete globalThis.__pushStore;
    delete globalThis.__pushLib;
  });

  const blobs = dataUrl('export const getStore = () => globalThis.__pushStore;');
  const lib = dataUrl('export default new Proxy({}, { get: (_, k) => globalThis.__pushLib[k] });');
  const sub = SUBSCRIBE_SRC
    .replace("from '@netlify/blobs'", `from ${JSON.stringify(blobs)}`)
    .replace(P140, p140) + `\n// load ${++loads}`;
  const subUrl = dataUrl(sub);
  const send = SEND_SRC
    .replace("from 'web-push'", `from ${JSON.stringify(lib)}`)
    .replace("from './push-subscribe.mjs'", `from ${JSON.stringify(subUrl)}`);
  assert.ok(!/from '[^n]/.test(send) && !/from '@/.test(sub), 'imports changed, update this test');
  return {
    subscribe: await import(subUrl),
    send: await import(dataUrl(send)),
    store,
    webpush
  };
}

const postSend = (mod, body, key = GATE) => mod.send.default(new Request(URL_SEND, {
  method: 'POST', headers: { 'x-push-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body)
}));
const getStatus = async (mod) => (await mod.subscribe.default(new Request(URL_SUB))).json();

test('sendReady stays false until the key is valid AND the send gate exists', async (t) => {
  const k = newKey();
  const states = [
    [{}, false],
    [{ PUSH_SEND_KEY: GATE }, false],
    [{ VAPID_PRIVATE_KEY: k.priv }, false],
    [{ VAPID_PRIVATE_KEY: 'not-a-key', PUSH_SEND_KEY: GATE }, false],
    [{ VAPID_PRIVATE_KEY: k.priv + '\n', PUSH_SEND_KEY: GATE }, false],
    [{ VAPID_PRIVATE_KEY: 'A'.repeat(43), PUSH_SEND_KEY: GATE }, false],
    [{ VAPID_PRIVATE_KEY: k.priv, PUSH_SEND_KEY: GATE }, true]
  ];
  for (const [env, want] of states) {
    const got = await getStatus(await load(t, env));
    assert.equal(got.sendReady, want, JSON.stringify(Object.keys(env)));
  }
});

test('the public key always comes from the private key, so the pair cannot disagree', async (t) => {
  const k = newKey();
  const status = await getStatus(await load(t, { VAPID_PRIVATE_KEY: k.priv, PUSH_SEND_KEY: GATE }));
  assert.equal(status.publicKey, k.pub);
});

test('with no key set, browsers can still arm against the p140 key', async (t) => {
  const status = await getStatus(await load(t, {}));
  assert.equal(status.publicKey, P140);
  assert.equal(status.sendReady, false);
});

test('count is reach: a subscription on a retired key is reported apart', async (t) => {
  const k = newKey();
  const store = fakeStore({ a: rec('https://push/old'), b: rec('https://push/new', k.pub) });
  const status = await getStatus(await load(t, { VAPID_PRIVATE_KEY: k.priv, PUSH_SEND_KEY: GATE }, { store }));
  assert.deepEqual([status.count, status.stale], [1, 1]);
});

test('before activation the existing subscriber still counts', async (t) => {
  const store = fakeStore({ a: rec('https://push/old') });
  const status = await getStatus(await load(t, {}, { store }));
  assert.deepEqual([status.count, status.stale], [1, 0]);
});

test('restoring the p140 private key keeps every old subscription live', async (t) => {
  const k = newKey();
  const store = fakeStore({ a: rec('https://push/old') });
  const mod = await load(t, { VAPID_PRIVATE_KEY: k.priv, PUSH_SEND_KEY: GATE }, { store, p140: k.pub });
  assert.deepEqual([(await getStatus(mod)).count, (await getStatus(mod)).stale], [1, 0]);
  const out = await (await postSend(mod, { title: 't' })).json();
  assert.deepEqual([out.sent, out.stale, out.pruned], [1, 0, 0]);
});

test('a device reports its own key, and old code that reports none is treated as p140', async (t) => {
  const k = newKey();
  const mod = await load(t, { VAPID_PRIVATE_KEY: k.priv, PUSH_SEND_KEY: GATE });
  const post = (body) => mod.subscribe.default(new Request(URL_SUB, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  }));
  const keys = { p256dh: 'p', auth: 'a' };
  await post({ subscription: { endpoint: 'https://push/old', keys } });
  await post({ subscription: { endpoint: 'https://push/new', keys }, vapid: k.pub });
  const status = await getStatus(mod);
  assert.deepEqual([status.count, status.stale], [1, 1]);
});

test('push-send refuses a bad gate before it looks at anything else', async (t) => {
  const mod = await load(t, { PUSH_SEND_KEY: GATE });
  assert.equal((await postSend(mod, { title: 't' }, 'wrong')).status, 403);
});

test('push-send is 503 for a missing or malformed private key', async (t) => {
  for (const env of [{ PUSH_SEND_KEY: GATE }, { PUSH_SEND_KEY: GATE, VAPID_PRIVATE_KEY: 'nope' }]) {
    const res = await postSend(await load(t, env), { title: 't', dryRun: true });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /VAPID_PRIVATE_KEY/);
  }
});

test('a dry run signs and builds every request, sends nothing and changes nothing', async (t) => {
  const k = newKey();
  const store = fakeStore({ a: rec('https://push/old'), b: rec('https://push/new', k.pub) });
  const before = JSON.stringify([...store.m]);
  const mod = await load(t, { VAPID_PRIVATE_KEY: k.priv, PUSH_SEND_KEY: GATE }, { store });
  const out = await (await postSend(mod, { title: 't', dryRun: true })).json();
  assert.deepEqual([out.ok, out.dryRun, out.signed, out.stale, out.sent], [true, true, 1, 1, 0]);
  assert.equal(mod.webpush.calls.signed, 1);
  assert.deepEqual(mod.webpush.calls.built, ['https://push/new']);
  assert.deepEqual(mod.webpush.calls.sent, []);
  assert.equal(JSON.stringify([...store.m]), before);
});

test('a dry run with no subscribers still proves signing', async (t) => {
  const k = newKey();
  const mod = await load(t, { VAPID_PRIVATE_KEY: k.priv, PUSH_SEND_KEY: GATE });
  const out = await (await postSend(mod, { title: 't', dryRun: true })).json();
  assert.equal(out.ok, true);
  assert.equal(mod.webpush.calls.signed, 1);
});

test('a dry run fails loudly when signing throws', async (t) => {
  const k = newKey();
  const webpush = fakeWebpush();
  webpush.getVapidHeaders = () => { throw new Error('curve not supported'); };
  const res = await postSend(await load(t, { VAPID_PRIVATE_KEY: k.priv, PUSH_SEND_KEY: GATE }, { webpush }), { title: 't', dryRun: true });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /signing failed/);
});

test('a dry run shows a stored subscription that cannot be encrypted for', async (t) => {
  const k = newKey();
  const junk = rec('https://push/junk', k.pub);
  junk.subscription.keys.p256dh = '';
  const store = fakeStore({ j: junk });
  const out = await (await postSend(await load(t, { VAPID_PRIVATE_KEY: k.priv, PUSH_SEND_KEY: GATE }, { store }), { title: 't', dryRun: true })).json();
  assert.deepEqual([out.signed, out.failed], [0, 1]);
  assert.deepEqual(store.roster(), ['j']);
});

test('a real send reaches current subscribers and skips a retired one without trying it', async (t) => {
  const k = newKey();
  const store = fakeStore({ a: rec('https://push/old'), b: rec('https://push/new', k.pub) });
  const mod = await load(t, { VAPID_PRIVATE_KEY: k.priv, PUSH_SEND_KEY: GATE }, { store });
  const out = await (await postSend(mod, { title: 't' })).json();
  assert.deepEqual([out.sent, out.stale, out.failed, out.pruned], [1, 1, 0, 0]);
  assert.deepEqual(mod.webpush.calls.sent, ['https://push/new']);
});

test('a key mismatch never deletes anyone: one wrong env value must not wipe the roster', async (t) => {
  const right = newKey();
  const wrong = newKey();
  const store = fakeStore({ a: rec('https://push/a', right.pub), b: rec('https://push/b', right.pub) });
  const out = await (await postSend(await load(t, { VAPID_PRIVATE_KEY: wrong.priv, PUSH_SEND_KEY: GATE }, { store }), { title: 't' })).json();
  assert.deepEqual([out.sent, out.stale, out.pruned], [0, 2, 0]);
  assert.deepEqual(store.roster(), ['a', 'b']);
  assert.ok(await store.get('a'));
});

test('404 and 410 prune; 401 and 403 must not, or one bad deploy wipes every subscriber', async (t) => {
  const k = newKey();
  const store = fakeStore({
    gone: rec('https://push/410', k.pub),
    missing: rec('https://push/404', k.pub),
    denied: rec('https://push/403', k.pub),
    unauth: rec('https://push/401', k.pub)
  });
  const webpush = fakeWebpush(url => Number(url.slice(-3)));
  const out = await (await postSend(await load(t, { VAPID_PRIVATE_KEY: k.priv, PUSH_SEND_KEY: GATE }, { store, webpush }), { title: 't' })).json();
  assert.deepEqual([out.pruned, out.failed], [2, 2]);
  assert.deepEqual(store.roster().sort(), ['denied', 'unauth']);
  assert.deepEqual(out.errors.sort(), ['401', '403']);
});

// ── Client ──────────────────────────────────────────────────────────────────

const toBuffer = (b64) => Uint8Array.from(Buffer.from(b64, 'base64url')).buffer;

function device({ existingKey, endpoint = 'https://push/old', serverKey, withOptions = true }) {
  const log = [];
  const pm = {
    current: null,
    failSubscribe: false,
    async getSubscription() { return pm.current; },
    async subscribe(o) {
      // A real browser throws InvalidStateError for a second key on one registration.
      if (pm.current) throw new Error('InvalidStateError');
      if (pm.failSubscribe) throw new Error('push service unreachable');
      log.push({ subscribe: Buffer.from(o.applicationServerKey).toString('base64url') });
      pm.current = makeSub('https://push/fresh', Buffer.from(o.applicationServerKey).toString('base64url'));
      return pm.current;
    }
  };
  function makeSub(url, key) {
    return {
      endpoint: url,
      ...(withOptions ? { options: { applicationServerKey: toBuffer(key) } } : {}),
      async unsubscribe() { log.push({ unsubscribeDevice: url }); pm.current = null; return true; },
      toJSON() { return { endpoint: url, keys: { p256dh: 'p', auth: 'a' } }; }
    };
  }
  if (existingKey) pm.current = makeSub(endpoint, existingKey);

  const sandbox = {
    console, atob, btoa,
    setTimeout() {},
    addEventListener() {},
    PushManager: function () {},
    Notification: { permission: 'granted' },
    localStorage: {
      v: { bdoc_push_state: JSON.stringify({ enabled: true }) },
      getItem(k) { return this.v[k] || null; },
      setItem(k, val) { this.v[k] = val; }
    },
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: pm }), addEventListener() {} } },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
    async fetch(url, init) {
      if (!init.body) return { json: async () => ({ publicKey: serverKey, sendReady: true }) };
      const body = JSON.parse(init.body);
      log.push(body.unsubscribe ? { unsubscribeServer: body.endpoint } : { register: body });
      return { json: async () => ({ ok: true }) };
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_SRC, sandbox);
  return { api: sandbox.BDOCPush, log, pm, sandbox };
}

const flat = (x) => JSON.parse(JSON.stringify(x));

test('same key: the subscription is kept and its key is reported', async () => {
  const k = newKey();
  const d = device({ existingKey: k.pub, serverKey: k.pub });
  await d.api._resume();
  assert.deepEqual(flat(d.log), [{
    register: { subscription: { endpoint: 'https://push/old', keys: { p256dh: 'p', auth: 'a' } }, vapid: k.pub }
  }]);
});

test('key changed: the device swaps silently, in the only order a browser allows', async () => {
  const k = newKey();
  const d = device({ existingKey: P140, serverKey: k.pub });
  await d.api._resume();
  assert.deepEqual(flat(d.log), [
    { unsubscribeDevice: 'https://push/old' },
    { unsubscribeServer: 'https://push/old' },
    { subscribe: k.pub },
    { register: { subscription: { endpoint: 'https://push/fresh', keys: { p256dh: 'p', auth: 'a' } }, vapid: k.pub } }
  ]);
});

test('a failed swap leaves the device armed, and the next boot finishes it', async () => {
  const k = newKey();
  const d = device({ existingKey: P140, serverKey: k.pub });
  d.pm.failSubscribe = true;
  await d.api._resume();                       // quiet on boot, by design
  assert.equal(d.pm.current, null);
  assert.equal(d.api.status().enabled, true);

  d.pm.failSubscribe = false;
  await d.api._resume();
  assert.equal(d.pm.current.endpoint, 'https://push/fresh');
  assert.equal(flat(d.log).at(-1).register.vapid, k.pub);
});

test('no subscription yet: one is created on the server key', async () => {
  const k = newKey();
  const d = device({ serverKey: k.pub });
  await d.api.enable();
  assert.deepEqual(flat(d.log)[0], { subscribe: k.pub });
  assert.equal(flat(d.log)[1].register.vapid, k.pub);
});

test('a browser that hides the key is left alone and reports nothing it cannot know', async () => {
  const k = newKey();
  const d = device({ existingKey: P140, serverKey: k.pub, withOptions: false });
  await d.api._resume();
  const log = flat(d.log);
  assert.equal(log.length, 1);
  assert.equal(log[0].register.vapid, undefined);
});

// The handler swallows every error, so a mistake here would be silent forever.
async function fireEndpointChange(nu) {
  const handlers = {};
  const posts = [];
  const sandbox = {
    console, btoa, URL,
    self: { addEventListener(n, f) { handlers[n] = f; }, registration: {}, location: { origin: 'https://kgsbdoc.netlify.app' } },
    async fetch(url, init) { posts.push(JSON.parse(init.body)); return {}; }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8'), sandbox);
  let done;
  handlers.pushsubscriptionchange({
    oldSubscription: { endpoint: 'https://push/old' },
    newSubscription: { endpoint: 'https://push/rotated', ...nu, toJSON: () => ({ endpoint: 'https://push/rotated' }) },
    waitUntil(p) { done = p; }
  });
  await done;
  return flat(posts);
}

test('a browser-initiated endpoint change reports the key, or the server would call it stale', async () => {
  const k = newKey();
  const posts = await fireEndpointChange({ options: { applicationServerKey: toBuffer(k.pub) } });
  assert.deepEqual(posts, [
    { unsubscribe: true, endpoint: 'https://push/old' },
    { subscription: { endpoint: 'https://push/rotated' }, vapid: k.pub }
  ]);
});

test('an endpoint change on a browser that hides the key reports none', async () => {
  const posts = await fireEndpointChange({});
  assert.deepEqual(posts[1], { subscription: { endpoint: 'https://push/rotated' } });
});

test('the page and the service worker ask for the same bdoc-push.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  const inHtml = html.match(/js\/bdoc-push\.js\?v=([\w.-]+)/)[1];
  const inSw = sw.match(/js\/bdoc-push\.js\?v=([\w.-]+)/)[1];
  assert.equal(inHtml, inSw);
});
