'use strict';
// p203 key cleanup (item 1b chunk D): no secret ships in the repo, and the proxies fail closed without their env var.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'netlify', 'functions');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(m?js|cjs|html|py|sh|json|toml|ya?ml)$/.test(e.name)) out.push(p);
  }
  return out;
}

const SERVED_AND_SERVER = [
  ...walk(FN),
  ...walk(path.join(ROOT, 'js')),
  path.join(ROOT, 'index.html'),
  ...walk(path.join(ROOT, 'tools')),
];

test('no Netlify function falls back to a hardcoded key', () => {
  const bad = [];
  for (const f of walk(FN)) {
    const s = fs.readFileSync(f, 'utf8');
    const re = /process\.env\.([A-Z0-9_]+)\s*(\|\||\?\?)\s*['"`]([A-Za-z0-9_-]{16,})['"`]/g;
    let m;
    while ((m = re.exec(s))) bad.push(`${path.basename(f)}: ${m[1]}`);
  }
  assert.deepStrictEqual(bad, []);
});

test('no server-side secret formats anywhere in served or server code', () => {
  const PATTERNS = [
    /\bsk_live_[0-9A-Za-z]{16,}/, /\brk_live_[0-9A-Za-z]{16,}/, /\bwhsec_[0-9A-Za-z]{20,}/,
    /\bsb_secret_[0-9A-Za-z_-]{20,}/, /\bsk-ant-[0-9A-Za-z_-]{20,}/, /\bm0-[0-9A-Za-z]{30,}/,
    /\b(ghp|gho|ghs)_[0-9A-Za-z]{30,}/, /\bdo[po]_v1_[0-9a-f]{60,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /hc-ping\.com\/[0-9a-f]{8}-[0-9a-f]{4}-/, /\b\d{8,10}:AA[0-9A-Za-z_-]{33}\b/,
  ];
  const hits = [];
  for (const f of SERVED_AND_SERVER) {
    const s = fs.readFileSync(f, 'utf8');
    for (const re of PATTERNS) if (re.test(s)) hits.push(`${path.relative(ROOT, f)} ~ ${re.source.slice(0, 18)}`);
  }
  assert.deepStrictEqual(hits, []);
});

for (const [file, env] of [
  ['proxy-firms.js', 'NASA_FIRMS_KEY'],
  ['proxy-news.js', 'NEWSAPI_KEY'],
  ['proxy-owm.js', 'OWM_API_KEY'],
  ['proxy-tomorrow.js', 'TOMORROW_API_KEY'],
]) {
  test(`${file} answers 503 without ${env} and never calls out`, async () => {
    const saved = process.env[env];
    const savedFetch = global.fetch;
    delete process.env[env];
    let called = false;
    global.fetch = async () => { called = true; throw new Error('should not fetch'); };
    try {
      delete require.cache[require.resolve(path.join(FN, file))];
      const { handler } = require(path.join(FN, file));
      const r = await handler({ queryStringParameters: { z: '1', x: '1', y: '1', mode: 'forecast', lat: '1', lon: '1' } });
      assert.strictEqual(r.statusCode, 503);
      assert.match(r.body, new RegExp(env));
      assert.strictEqual(called, false);
    } finally {
      if (saved === undefined) delete process.env[env]; else process.env[env] = saved;
      global.fetch = savedFetch;
    }
  });
}

test('the dormant sentinel relay (public fallback key, no reader) is gone', () => {
  assert.strictEqual(fs.existsSync(path.join(FN, 'sentinel.mjs')), false);
});

test('.gitignore keeps env files and keys out of the public repo', () => {
  const gi = fs.readFileSync(path.join(ROOT, '..', '.gitignore'), 'utf8');
  for (const line of ['.env', '.env.*', '!.env.example', '*.pem', 'pings.env']) {
    assert.ok(gi.split(/\r?\n/).includes(line), `missing ${line}`);
  }
});
