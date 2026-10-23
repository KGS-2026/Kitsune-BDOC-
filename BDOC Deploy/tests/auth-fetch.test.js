// bdoc-auth-fetch: prove the token goes ONLY to our own functions.
// A leak here would hand a live Supabase session to USGS/NOAA/Cesium.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'bdoc-auth-fetch.js'), 'utf8');

function load() {
  const calls = [];
  const sandbox = {
    console,
    URL, Headers, Request: undefined,
    localStorage: {
      _v: { bdoc_bridge_token: 'BRIDGE-TOKEN-xyz' },
      getItem(k) { return this._v[k] || null; }
    },
    location: { href: 'https://kgsbdoc.netlify.app/', origin: 'https://kgsbdoc.netlify.app' },
    window: null
  };
  sandbox.window = sandbox;
  sandbox.fetch = async (input, init) => {
    const h = init && init.headers;
    calls.push({
      url: typeof input === 'string' ? input : String(input),
      auth: h && typeof h.get === 'function' ? h.get('Authorization') : null,
      bridge: h && typeof h.get === 'function' ? h.get('X-BDOC-Bridge') : null
    });
    return { ok: true };
  };
  sandbox.Auth = {
    client: { auth: { getSession: async () => ({ data: { session: { access_token: 'JWT-SECRET-123' } } }) } }
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, calls };
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

test('bridge gets its own token, never the Supabase JWT', async () => {
  const { sandbox, calls } = load();
  await sandbox.fetch('http://127.0.0.1:9876/wireshark/packet');
  assert.equal(calls[0].bridge, 'BRIDGE-TOKEN-xyz');
  assert.equal(calls[0].auth, null, 'Supabase JWT sent to local bridge');
});

test('guest (no session) sends no Authorization header', async () => {
  const { sandbox, calls } = load();
  sandbox.Auth.client.auth.getSession = async () => ({ data: { session: null } });
  await sandbox.fetch('/.netlify/functions/proxy-firms');
  assert.equal(calls[0].auth, null);
});

test('install is idempotent (double-load does not double-wrap)', () => {
  const { sandbox } = load();
  const first = sandbox.fetch;
  vm.runInContext(SRC, sandbox);
  assert.equal(sandbox.fetch, first);
});
