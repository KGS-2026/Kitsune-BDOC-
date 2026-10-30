// bdoc-auth-fetch: prove the token goes ONLY to our own functions.
// A leak here would hand a live Supabase session to USGS/NOAA/Cesium.
//
// load() runs the REAL js/auth.js, so the singleton under test is the one the app
// creates. A hand-made stand-in is how this wrapper read window.Auth, a global
// nothing defines, from p157 to p160 with every test green while stripe-checkout
// 401ed every customer.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://kgsbdoc.netlify.app';
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'bdoc-auth-fetch.js'), 'utf8');
const AUTH_SRC = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');

const session = token => ({ data: { session: { access_token: token } } });
const tick = () => new Promise(r => setImmediate(r));
const NO_HANG = { timeout: 2000 };   // a wrapper that waits forever must fail, not stall the run

function makeSandbox(calls, warnings) {
  const sandbox = {
    console: { ...console, warn: m => warnings.push(m) },
    URL, Headers, Request: undefined, AbortSignal, setTimeout, clearTimeout,
    localStorage: {
      _v: { bdoc_bridge_token: 'BRIDGE-TOKEN-xyz' },
      getItem(k) { return this._v[k] || null; }
    },
    location: { href: `${SITE}/`, origin: SITE },
    window: null
  };
  sandbox.window = sandbox;
  sandbox.fetch = async (input, init) => {
    const h = (init && init.headers) || (input && input.headers);
    calls.push({
      url: typeof input === 'string' ? input : (input && input.url) || String(input),
      auth: h && typeof h.get === 'function' ? h.get('Authorization') : null,
      bridge: h && typeof h.get === 'function' ? h.get('X-BDOC-Bridge') : null
    });
    return { ok: true, json: async () => ({ url: 'https://checkout.stripe.example/s' }) };
  };
  return sandbox;
}

function load() {
  const calls = [], warnings = [], reads = { n: 0 };
  const sandbox = makeSandbox(calls, warnings);
  vm.createContext(sandbox);
  vm.runInContext(AUTH_SRC, sandbox);
  vm.runInContext(SRC, sandbox);
  sandbox.BDOC_Auth.client = {
    auth: { getSession: async () => { reads.n++; return session('JWT-SECRET-123'); } }
  };
  return { sandbox, calls, warnings, reads };
}

// A getSession() that stays pending until the test settles it, and timers the test fires.
function stall(sandbox) {
  const timers = [];
  const s = { timers, reads: 0, settle: null, fail: null };
  sandbox.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  sandbox.clearTimeout = () => {};
  sandbox.BDOC_Auth.client.auth.getSession = () => {
    s.reads++;
    return new Promise((resolve, reject) => { s.settle = resolve; s.fail = reject; });
  };
  return s;
}

function appSources() {
  const js = fs.readdirSync(path.join(ROOT, 'js'), { recursive: true })
    .filter(f => /\.js$/.test(f) && !/vendor/.test(f))
    .map(f => path.join('js', f));
  return ['index.html', ...js].map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
}

test('attaches JWT to /.netlify/functions/*', async () => {
  const { sandbox, calls } = load();
  await sandbox.fetch('/.netlify/functions/proxy-maritime?type=vessels');
  assert.equal(calls[0].auth, 'Bearer JWT-SECRET-123');
});

test('attaches JWT to /api/*', async () => {
  const { sandbox, calls } = load();
  await sandbox.fetch('/api/layers');
  assert.equal(calls[0].auth, 'Bearer JWT-SECRET-123');
});

test('NEVER attaches JWT to a foreign host (USGS)', async () => {
  const { sandbox, calls } = load();
  await sandbox.fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson');
  assert.equal(calls[0].auth, null, 'token leaked to USGS');
});

test('NEVER attaches JWT to NOAA / Cesium / OpenSky', async () => {
  const { sandbox, calls } = load();
  for (const u of ['https://api.weather.gov/alerts/active',
                   'https://assets.ion.cesium.com/tile',
                   'https://opensky-network.org/api/states/all']) {
    await sandbox.fetch(u);
  }
  for (const c of calls) assert.equal(c.auth, null, 'token leaked to ' + c.url);
});

test('does not attach JWT to a same-path URL on a DIFFERENT origin', async () => {
  const { sandbox, calls } = load();
  await sandbox.fetch('https://evil.example/.netlify/functions/proxy-maritime');
  assert.equal(calls[0].auth, null, 'token leaked to look-alike path');
});

test('URLs that only look like ours get no JWT', async () => {
  const { sandbox, calls } = load();
  for (const u of ['//evil.example/.netlify/functions/proxy-firms',
                   '/\\evil.example/.netlify/functions/proxy-firms',
                   `${SITE}.evil.example/.netlify/functions/proxy-firms`,
                   'http://kgsbdoc.netlify.app/.netlify/functions/proxy-firms',
                   new URL('https://evil.example/api/layers')]) {
    await sandbox.fetch(u);
  }
  assert.equal(calls.length, 5);
  for (const c of calls) assert.equal(c.auth, null, 'token leaked to ' + c.url);
});

test('a Request object gets the JWT on our origin and nowhere else', async () => {
  const { sandbox, calls } = load();
  sandbox.Request = Request;
  await sandbox.fetch(new Request(`${SITE}/.netlify/functions/proxy-firms`));
  await sandbox.fetch(new Request('https://evil.example/.netlify/functions/proxy-firms'));
  assert.equal(calls[0].auth, 'Bearer JWT-SECRET-123');
  assert.equal(calls[1].auth, null, 'token leaked through a Request object');
});

test('a foreign URL never reaches getSession', async () => {
  // supabase-js refreshes through this wrapper, so a read here would re-enter itself.
  const { sandbox, reads } = load();
  await sandbox.fetch('https://abc.supabase.co/auth/v1/token?grant_type=refresh_token', { method: 'POST' });
  await sandbox.fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson');
  assert.equal(reads.n, 0);
});

test('bridge gets its own token, never the Supabase JWT', async () => {
  const { sandbox, calls } = load();
  await sandbox.fetch('http://127.0.0.1:9876/wireshark/packet');
  assert.equal(calls[0].bridge, 'BRIDGE-TOKEN-xyz');
  assert.equal(calls[0].auth, null, 'Supabase JWT sent to local bridge');
});

test('guest (no session) sends no Authorization header', async () => {
  const { sandbox, calls } = load();
  sandbox.BDOC_Auth.client.auth.getSession = async () => ({ data: { session: null } });
  await sandbox.fetch('/.netlify/functions/proxy-firms');
  assert.equal(calls[0].auth, null);
});

test('a call made before the client exists goes out as a guest', async () => {
  const { sandbox, calls } = load();
  sandbox.BDOC_Auth.client = null;
  await sandbox.fetch('/.netlify/functions/config');
  assert.equal(calls[0].auth, null);
});

test('a header the caller set is left alone', async () => {
  const { sandbox, calls } = load();
  await sandbox.fetch('/.netlify/functions/wire?probe=1', { headers: { Authorization: 'Bearer OWNER' } });
  assert.equal(calls[0].auth, 'Bearer OWNER');
});

test('install is idempotent (double-load does not double-wrap)', () => {
  const { sandbox } = load();
  const first = sandbox.fetch;
  vm.runInContext(SRC, sandbox);
  assert.equal(sandbox.fetch, first);
});

// ── the name ────────────────────────────────────────────────────────────────

test('the wrapper reads the global js/auth.js really exposes, whatever it is called', async () => {
  const calls = [];
  const sandbox = makeSandbox(calls, []);
  vm.createContext(sandbox);
  const before = new Set(Object.keys(sandbox));
  vm.runInContext(AUTH_SRC, sandbox);
  const exposed = Object.keys(sandbox).filter(k => !before.has(k));
  assert.equal(exposed.length, 1, `auth.js should put one singleton on window, found: ${exposed}`);

  vm.runInContext(SRC, sandbox);
  sandbox[exposed[0]].client = { auth: { getSession: async () => session('JWT-SECRET-123') } };
  await sandbox.fetch('/.netlify/functions/proxy-firms');
  assert.equal(calls[0].auth, 'Bearer JWT-SECRET-123', `wrapper does not read window.${exposed[0]}`);
});

test('nothing in the app refers to window.Auth', () => {
  const hits = appSources().filter(([, src]) => /\bwindow\.Auth\b/.test(src)).map(([f]) => f);
  assert.deepEqual(hits, []);
});

// ── the paths that need the token ───────────────────────────────────────────

test('signed-in subscribe() reaches stripe-checkout with the JWT', async () => {
  const { sandbox, calls } = load();
  sandbox.BDOC_Auth.user = { id: 'user-1', email: 'user@example.test' };
  await sandbox.BDOC_Auth.subscribe('operator');
  const c = calls.find(x => x.url.endsWith('/stripe-checkout'));
  assert.equal(c.auth, 'Bearer JWT-SECRET-123', 'stripe-checkout 401s without it: nobody can subscribe');
  assert.equal(sandbox.location.href, 'https://checkout.stripe.example/s');
});

test('openPortal() reaches stripe-portal with the JWT', async () => {
  const { sandbox, calls } = load();
  sandbox.BDOC_Auth.profile = { stripe_customer_id: 'cus_1' };
  await sandbox.BDOC_Auth.openPortal();
  const c = calls.find(x => x.url.endsWith('/stripe-portal'));
  assert.equal(c.auth, 'Bearer JWT-SECRET-123');
});

// ── getSession on every call ────────────────────────────────────────────────

test('a stalled getSession holds a function call back once, then it goes as a guest', NO_HANG, async () => {
  const { sandbox, calls } = load();
  const s = stall(sandbox);
  const pending = sandbox.fetch('/.netlify/functions/proxy-firms');
  await tick();
  assert.equal(calls.length, 0, 'should wait for the token first');
  assert.ok(s.timers[0].ms < 5000, 'the shortest timeout a caller gives a function call is 5 s');

  s.timers[0].fn();
  await pending;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].auth, null);
});

test('during a stall later calls do not wait, and the token returns when it settles', NO_HANG, async () => {
  const { sandbox, calls, warnings } = load();
  const s = stall(sandbox);
  const first = sandbox.fetch('/.netlify/functions/proxy-firms');
  const second = sandbox.fetch('/.netlify/functions/proxy-adsb');
  await tick();
  s.timers.forEach(t => t.fn());
  await Promise.all([first, second]);
  assert.equal(warnings.length, 1, 'one line per stall, not one per call');

  await sandbox.fetch('/.netlify/functions/proxy-cisa');
  assert.equal(calls.length, 3);
  assert.equal(s.reads, 2, 'a third read was queued behind the stalled one');

  s.settle(session('JWT-AFTER-STALL'));
  await tick();
  const third = sandbox.fetch('/.netlify/functions/proxy-gdacs');
  await tick();
  s.settle(session('JWT-AFTER-STALL'));
  await third;
  assert.equal(calls[3].auth, 'Bearer JWT-AFTER-STALL');
});

test('a getSession that fails after a stall clears it too', NO_HANG, async () => {
  const { sandbox, calls } = load();
  const s = stall(sandbox);
  const pending = sandbox.fetch('/.netlify/functions/proxy-firms');
  await tick();
  s.timers[0].fn();
  await pending;
  s.fail(new Error('refresh failed'));
  await tick();

  const next = sandbox.fetch('/.netlify/functions/proxy-cisa');
  await tick();
  s.settle(session('JWT-AFTER-STALL'));
  await next;
  assert.equal(calls[1].auth, 'Bearer JWT-AFTER-STALL');
});

test('a getSession that throws still lets the call out', async () => {
  const { sandbox, calls } = load();
  sandbox.BDOC_Auth.client.auth.getSession = async () => { throw new Error('storage blocked'); };
  await sandbox.fetch('/.netlify/functions/proxy-firms');
  assert.equal(calls[0].auth, null);
});

test('the link probe never touches Supabase', NO_HANG, async () => {
  // js/bdoc-link-manager.js gives it 4 s. A Supabase outage must not read as a dead uplink.
  const { sandbox, calls } = load();
  const s = stall(sandbox);
  await sandbox.fetch('/.netlify/functions/ping', { cache: 'no-store' });
  assert.equal(s.reads, 0);
  assert.equal(calls[0].auth, null);
});

test('no onAuthStateChange callback is async', () => {
  // Every function fetch reads the session now, so one awaited in this callback is the
  // p157 deadlock in js/auth.js. An inline non-async callback cannot await at all.
  let seen = 0;
  for (const [file, src] of appSources()) {
    for (const m of src.matchAll(/\.onAuthStateChange\(\s*([^\n]{0,40})/g)) {
      seen++;
      assert.match(m[1], /^(\(|function\b|\w+\s*=>)/, `${file}: ${m[0]}`);
    }
  }
  assert.ok(seen >= 4, 'the scan stopped finding the subscribers');
});

// ── service worker ──────────────────────────────────────────────────────────

// Runs the real file against a stored-request store, the way Cache Storage keeps them.
async function throughServiceWorker(request) {
  const handlers = {}, stored = [];
  vm.runInNewContext(SW_SRC, {
    self: { addEventListener(type, fn) { handlers[type] = fn; }, location: { origin: SITE } },
    URL, console, AbortSignal,
    fetch: async () => new Response('{}', { status: 200 }),
    caches: { open: async () => ({ put: async key => { stored.push(new Request(key)); } }) }
  });
  let answer;
  handlers.fetch({ request, respondWith(p) { answer = p; } });
  await answer;
  await tick();
  return stored;
}

test('service worker: a signed-in call leaves no JWT in Cache Storage', async () => {
  const stored = await throughServiceWorker(new Request(`${SITE}/.netlify/functions/proxy-firms`, {
    headers: { Authorization: 'Bearer JWT-SECRET-123' }
  }));
  assert.equal(stored.length, 1, 'the offline copy should still be written');
  assert.equal(stored[0].url, `${SITE}/.netlify/functions/proxy-firms`);
  assert.equal(stored[0].headers.get('Authorization'), null, 'JWT written to disk');
});

test('service worker: a guest call is stored as before', async () => {
  const stored = await throughServiceWorker(new Request(`${SITE}/.netlify/functions/proxy-firms`, {
    headers: { 'X-Test': 'kept' }
  }));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].headers.get('X-Test'), 'kept');
});
