// p208: dead-feed audit — IOC C2 leg and Overpass mirrors.
// Runs the shipped handlers with fetch stubbed (no network).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function stubFetch(routes) {
  return async (url, opts) => {
    const u = String(url);
    for (const [frag, fn] of routes) if (u.includes(frag)) return fn(u, opts || {});
    throw new Error('unexpected fetch ' + u);
  };
}
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body), text: async () => body });

test('proxy-cyber: keyless run plots C2 from Feodo + C2IntelFeeds and reports ThreatFox as needs_key', async () => {
  const saved = global.fetch;
  delete process.env.ABUSECH_AUTH_KEY; delete process.env.THREATFOX_AUTH_KEY;
  let tfCalled = false;
  global.fetch = stubFetch([
    ['threatfox', () => { tfCalled = true; return resp(401, '{"error":"Unauthorized"}'); }],
    ['feodotracker', () => resp(200, JSON.stringify([
      { ip_address: '50.16.16.211', port: 443, status: 'online', malware: 'QakBot' },
      { ip_address: '1.2.3.4', port: 443, status: 'offline', malware: 'Emotet' }]))],
    ['C2IntelFeeds', () => resp(200, '#ip,port,ioc\n1.117.74.144,18443,Possible Cobaltstrike C2 IP\n')],
    ['emergingthreats', () => resp(200, '# x\n8.8.4.4\n')],
    ['ip-api.com', (u, o) => resp(200, JSON.stringify(JSON.parse(o.body).map(q => ({ status: 'success', lat: 1, lon: 2, query: q.query }))))]
  ]);
  try {
    delete require.cache[require.resolve('../netlify/functions/proxy-cyber.js')];
    const r = await require('../netlify/functions/proxy-cyber.js').handler({ httpMethod: 'GET' });
    const j = JSON.parse(r.body);
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(tfCalled, false, 'no keyless ThreatFox call');
    assert.strictEqual(j.sources.threatfox.status, 'needs_key');
    assert.strictEqual(j.sources.feodo.count, 1, 'offline Feodo rows dropped');
    assert.strictEqual(j.sources.c2intel.count, 1);
    assert.strictEqual(j.c2_count, 2);
    const bySrc = Object.fromEntries(j.features.map(f => [f.ip, f.source]));
    assert.deepStrictEqual(bySrc, { '50.16.16.211': 'feodo', '1.117.74.144': 'c2intel', '8.8.4.4': 'emerging_threats' });
    assert.strictEqual(j.features.find(f => f.source === 'c2intel').malware, 'Cobaltstrike C2');
  } finally { global.fetch = saved; }
});

test('proxy-cyber: ThreatFox sends the Auth-Key when ABUSECH_AUTH_KEY is set', async () => {
  const saved = global.fetch;
  process.env.ABUSECH_AUTH_KEY = 'k-test';
  let sentKey = null;
  global.fetch = stubFetch([
    ['threatfox', (u, o) => { sentKey = o.headers['Auth-Key']; return resp(200, JSON.stringify({ query_status: 'ok', data: [{ ioc_type: 'ip:port', ioc_value: '9.9.9.9:80', malware_printable: 'AsyncRAT' }] })); }],
    ['feodotracker', () => resp(500, '')],
    ['C2IntelFeeds', () => resp(200, '#ip,port,ioc\n')],
    ['emergingthreats', () => resp(200, '')],
    ['ip-api.com', (u, o) => resp(200, JSON.stringify(JSON.parse(o.body).map(q => ({ status: 'success', lat: 1, lon: 2, query: q.query }))))]
  ]);
  try {
    delete require.cache[require.resolve('../netlify/functions/proxy-cyber.js')];
    const j = JSON.parse((await require('../netlify/functions/proxy-cyber.js').handler({ httpMethod: 'GET' })).body);
    assert.strictEqual(sentKey, 'k-test');
    assert.strictEqual(j.sources.threatfox.count, 1);
    assert.strictEqual(j.sources.feodo.status, 'error');
    assert.strictEqual(j.features[0].source, 'threatfox');
  } finally { global.fetch = saved; delete process.env.ABUSECH_AUTH_KEY; }
});

test('proxy-overpass: first good mirror wins; all-fail 502 names every mirror and is not cached', async () => {
  const saved = global.fetch;
  global.fetch = async (u) => {
    if (u.includes('mail.ru')) return resp(200, '{"elements":[]}');
    return resp(429, 'rate');
  };
  try {
    delete require.cache[require.resolve('../netlify/functions/proxy-overpass.js')];
    const h = require('../netlify/functions/proxy-overpass.js').handler;
    const ok = await h({ httpMethod: 'POST', body: 'data=x' });
    assert.strictEqual(ok.statusCode, 200);
    assert.strictEqual(ok.headers['X-Overpass-Endpoint'], 'maps.mail.ru');
    global.fetch = async () => resp(429, 'rate');
    const bad = await h({ httpMethod: 'POST', body: 'data=x' });
    assert.strictEqual(bad.statusCode, 502);
    assert.strictEqual(bad.headers['Cache-Control'], 'no-store');
    assert.strictEqual(Object.keys(JSON.parse(bad.body).mirrors).length, 4);
  } finally { global.fetch = saved; }
});

test('IOC layer counts every C2 source as C2 and names offline feeds', () => {
  assert.match(HTML, /const isC2=f\.source!=='emerging_threats'&&f\.threat_type!=='compromised';/);
  assert.match(HTML, /c2intel:'C2IntelFeeds/);
  assert.match(HTML, /' · offline: '\+esc\(_down\.join/);
});

test('SW v196 ships p208', () => {
  const SW = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  assert.match(SW, /const SW_VERSION = 'bdoc-v196';  \/\/ p208:/);
});
