'use strict';
// p205 (item 1b chunk E): site canaries page on decoy hits, stay quiet otherwise, and store nothing.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const load = (f) => import(pathToFileURL(path.join(ROOT, 'netlify', 'functions', f)).href + '?t=' + Date.now() + Math.random());

async function withFetch(fn) {
  const real = global.fetch, calls = [];
  global.fetch = async (url, opts) => { calls.push({ url: String(url), body: opts && opts.body }); return { ok: true, status: 200 }; };
  try { return await fn(calls); } finally { global.fetch = real; }
}
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const ctx = { ip: '203.0.113.7', geo: { city: 'Testville', country: { code: 'ZZ' } } };
const req = (url, headers = {}, method = 'GET') => new Request(url, { method, headers: { 'user-agent': 'curl/8', ...headers } });

test('a decoy hit answers 401, pings /fail with who and where, and keeps no body', async () => {
  const m = await load('canary.mjs');
  await withEnv({ HC_SITE_CANARY: 'https://hc.example/abc' }, () => withFetch(async (calls) => {
    const r = await m.default(req('https://kgsbdoc.netlify.app/kgs-ops-console/login', { referer: 'https://kgsbdoc.netlify.app/robots.txt' }), ctx);
    assert.strictEqual(r.status, 401);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://hc.example/abc/fail');
    assert.match(calls[0].body, /SITE CANARY: decoy ops console/);
    assert.match(calls[0].body, /GET \/kgs-ops-console\/login/);
    assert.match(calls[0].body, /203\.0\.113\.7 \(Testville, ZZ\)/);
    assert.match(calls[0].body, /browser: curl\/8/);
    assert.match(calls[0].body, /referer: https:\/\/kgsbdoc\.netlify\.app\/robots\.txt/);
  }));
});

test('a second hit within 20 s is logged but not pinged again; Healthchecks alerts once per DOWN anyway', async () => {
  const m = await load('canary.mjs');
  await withEnv({ HC_SITE_CANARY: 'https://hc.example/abc' }, () => withFetch(async (calls) => {
    await m.default(req('https://kgsbdoc.netlify.app/kgs-ops-console'), ctx);
    await m.default(req('https://kgsbdoc.netlify.app/kgs-ops-console'), ctx);
    assert.strictEqual(calls.length, 1);
  }));
});

test('the droplet decoy token is recognised by hash and always pings, flagged as a compromise', async () => {
  const m = await load('canary.mjs');
  const src = fs.readFileSync(path.join(ROOT, 'netlify', 'functions', 'canary.mjs'), 'utf8');
  assert.match(src, /DROPLET_DECOY_SHA256 = '[0-9a-f]{64}'/);
  assert.doesNotMatch(src, /kgsops_[0-9a-f]{48}/, 'the token itself is never in the repo');
  await withEnv({ HC_SITE_CANARY: 'https://hc.example/abc' }, () => withFetch(async (calls) => {
    await m.default(req('https://kgsbdoc.netlify.app/ops/auth?k=wrong'), ctx);
    const r = await m.default(req('https://kgsbdoc.netlify.app/ops/auth', { authorization: 'Bearer also-wrong' }), ctx);
    assert.strictEqual(r.status, 401);
    assert.strictEqual(calls.length, 1, 'non-matching tokens are an ordinary (throttled) decoy hit');
    assert.match(calls[0].body, /decoy ops endpoint/);
    assert.doesNotMatch(calls[0].body, /COMPROMISED|compromised/);
  }));
});

test('without HC_SITE_CANARY the canary still answers 401 and calls nobody', async () => {
  const m = await load('canary.mjs');
  await withEnv({ HC_SITE_CANARY: undefined }, () => withFetch(async (calls) => {
    const r = await m.default(req('https://kgsbdoc.netlify.app/kgs-ops-console'), ctx);
    assert.strictEqual(r.status, 401);
    assert.strictEqual(calls.length, 0);
  }));
});

test('the canary listens only on decoy paths, never a generic scanner path or a real route', async () => {
  const m = await load('canary.mjs');
  const paths = m.config.path;
  assert.deepStrictEqual(paths, ['/kgs-ops-console', '/kgs-ops-console/*', '/ops/auth', '/ops/auth/*']);
  for (const p of paths) {
    const top = p.split('/')[1];
    assert.ok(!fs.existsSync(path.join(ROOT, top)), `${top} must not be a real file or folder`);
  }
  assert.ok(!paths.some((p) => /(\.env|wp-|admin|phpmyadmin|\.git)/.test(p)), 'no scanner-noise paths');
});

test('the decoys are advertised only where a snoop would look', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8'), /^Disallow: \/kgs-ops-console\/$/m);
  assert.match(fs.readFileSync(path.join(ROOT, '404.html'), 'utf8'), /<!-- ops: legacy console moved to \/kgs-ops-console\/ /);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /kgs-ops-console/, 'never linked from the app itself');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8'), /kgs-ops-console/);
});

test('canary-rearm sends a plain OK ping once a day', async () => {
  const m = await load('canary-rearm.mjs');
  assert.strictEqual(m.config.schedule, '17 9 * * *');
  await withEnv({ HC_SITE_CANARY: 'https://hc.example/abc' }, () => withFetch(async (calls) => {
    await m.default();
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://hc.example/abc');
  }));
});
