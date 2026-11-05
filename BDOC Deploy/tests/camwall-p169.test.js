// p169: Cam Wall regions, curated stationary cams (no news channels, no open YouTube search), one live player,
// operator anomaly log. Upstreams are stubbed; these pin the whitelists, the copyright rules and the wiring.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'netlify', 'functions', 'proxy-mecams.js');
const CAM_SRC = fs.readFileSync(path.join(ROOT, 'js', 'modules', 'cam-wall.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function fresh() { delete require.cache[require.resolve(FN)]; return require(FN); }
async function withFetch(reply, fn) {
  const real = global.fetch, calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    const r = reply(String(url), opts) || {};
    const status = r.status || 200, body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body || {});
    return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body), text: async () => body };
  };
  try { return await fn(calls); } finally { global.fetch = real; }
}
const call = (mod, qs) => mod.handler({ httpMethod: 'GET', queryStringParameters: qs, headers: {} });
async function noKeys(fn) {
  const saved = { y: process.env.YOUTUBE_API_KEY, w: process.env.WINDY_API_KEY };
  delete process.env.YOUTUBE_API_KEY; delete process.env.WINDY_API_KEY;
  try { return await fn(); } finally {
    if (saved.y !== undefined) process.env.YOUTUBE_API_KEY = saved.y;
    if (saved.w !== undefined) process.env.WINDY_API_KEY = saved.w;
  }
}

test('the curated list is well formed: valid ids, coordinates in their region, an operator named for every cam', () => {
  const { REGIONS, CAMS } = fresh()._test;
  assert.deepStrictEqual(Object.keys(REGIONS).sort(), ['kr', 'me', 'tw', 'ua']);
  const box = { me: [12, 42, 25, 65], ua: [44, 60, 22, 41], tw: [21, 27, 116, 123], kr: [33, 43, 124, 131] }; // S,N,W,E
  const ids = new Set();
  for (const [r, list] of Object.entries(CAMS)) {
    for (const c of list) {
      assert.match(c.v, /^[A-Za-z0-9_-]{11}$/, c.id);
      assert.match(c.ch, /^UC[A-Za-z0-9_-]{22}$/, c.id);
      assert.ok(c.by && c.name && c.city, c.id);
      const [s, n, w, e] = box[r];
      assert.ok(c.lat > s && c.lat < n && c.lon > w && c.lon < e, `${c.id} sits in ${r}`);
      assert.doesNotThrow(() => new RegExp(c.match, 'i'), c.id);
      assert.ok(!ids.has(c.id), 'duplicate id ' + c.id); ids.add(c.id);
    }
  }
  assert.strictEqual(CAMS.ua.length, 0, 'no operator-run Ukraine cams were found; aggregator restreams stay out');
});

test('no news channels and no open YouTube search are left anywhere in the Cam Wall', () => {
  const src = fs.readFileSync(FN, 'utf8');
  for (const s of [src, CAM_SRC]) {
    assert.doesNotMatch(s, /embed\/live_stream\?channel=/, 'channel auto-live embeds were the news-channel path');
    assert.doesNotMatch(s, /Al Jazeera|Al Arabiya|Iran International|TRT World|i24NEWS/);
    assert.doesNotMatch(s, /[?&]q=|['"]q['"]\s*:/, 'no free-text YouTube search');
  }
  // aggregator restream channels found on 5 Nov 2026 must never be added
  const { CAMS } = fresh()._test;
  const banned = ['UCper-NWj8xdXacSpFtF4Mgg', 'UCzpQxPIFPy4PgpULtRsE-nA', 'UCuyLmOJb7PVCvx8zbRT9_GQ', 'UC98W74iwmWXnOMHq0lYeDIw', 'UCgV656Y-ZIOOn-z0tIkbYQA'];
  assert.ok(Object.values(CAMS).flat().every(c => !banned.includes(c.ch)));
});

test('cams without keys: only YouTube oEmbed is called, and its answer becomes ok / blocked / gone / unknown', async () => {
  await noKeys(async () => {
    const m = fresh();
    const { CAMS } = m._test;
    const [a, b, c, d] = CAMS.kr.map(x => x.v);
    await withFetch((url) => {
      const v = decodeURIComponent(url).match(/v=([\w-]{11})/)[1];
      return { status: v === a ? 200 : v === b ? 401 : v === c ? 404 : v === d ? 500 : 200 };
    }, async (calls) => {
      const r = JSON.parse((await call(m, { source: 'cams', region: 'kr' })).body);
      assert.ok(calls.length > 0 && calls.every(x => x.url.startsWith('https://www.youtube.com/oembed?')));
      const st = Object.fromEntries(r.cams.map(x => [x.v, x.state]));
      assert.strictEqual(st[a], 'ok'); assert.strictEqual(st[b], 'blocked'); assert.strictEqual(st[c], 'gone'); assert.strictEqual(st[d], 'unknown');
      assert.strictEqual(r.region, 'kr');
      assert.strictEqual(r.youtubeKey, false);
    });
  });
});

test('an unknown region falls back to the Middle East; status and windy without a key call nothing', async () => {
  await noKeys(async () => {
    const m = fresh();
    await withFetch(() => ({ status: 200 }), async (calls) => {
      const r = JSON.parse((await call(m, { source: 'cams', region: '../../etc' })).body);
      assert.strictEqual(r.region, 'me');
      const n = calls.length;
      assert.deepStrictEqual(JSON.parse((await call(m, { source: 'status' })).body).windy, false);
      const w = JSON.parse((await call(m, { source: 'windy', region: 'ua' })).body);
      assert.strictEqual(w.configured, false);
      assert.strictEqual(calls.length, n, 'no upstream call for status or keyless windy');
      assert.strictEqual((await call(m, { source: 'yt' })).statusCode, 400, 'the old search source is gone');
      assert.strictEqual((await call(m, { source: 'constructor' })).statusCode, 400, 'prototype names are not sources');
    });
  });
});

test('with a YouTube key: one search per channel, the matching live title replaces a stale id, the key never reaches the client', async () => {
  const saved = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = 'YTKEY777';
  try {
    const m = fresh();
    await withFetch((url) => {
      if (url.startsWith('https://www.googleapis.com/youtube/v3/search?')) {
        return { body: { items: [{ id: { videoId: 'NEWID000001' }, snippet: { title: '【Taipei Live Cam】象山看台北 &amp; 101' } }, { id: { videoId: 'bad id' }, snippet: { title: '象山' } }] } };
      }
      return { status: 200 };
    }, async (calls) => {
      const res = await call(m, { source: 'cams', region: 'tw' });
      assert.doesNotMatch(res.body, /YTKEY777/);
      const r = JSON.parse(res.body);
      const x = r.cams.find(c => c.id === 'tpe-xiangshan');
      assert.strictEqual(x.v, 'NEWID000001'); assert.strictEqual(x.refreshed, true); assert.strictEqual(x.state, 'ok');
      const searches = calls.filter(c => c.url.includes('/youtube/v3/search?'));
      const chans = new Set(searches.map(c => new URL(c.url).searchParams.get('channelId')));
      assert.strictEqual(searches.length, chans.size, 'one search per channel, not per camera');
      assert.ok(searches.every(c => new URL(c.url).searchParams.get('eventType') === 'live'));
      assert.match(res.headers['Netlify-CDN-Cache-Control'], /s-maxage=\d+/, 'shared CDN cache protects the quota');
    });
  } finally {
    if (saved === undefined) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = saved;
  }
});

test('windy uses the requested region\'s boxes only', async () => {
  const saved = process.env.WINDY_API_KEY;
  process.env.WINDY_API_KEY = 'WKEY';
  try {
    const m = fresh();
    await withFetch(() => ({ body: { total: 0, webcams: [] } }), async (calls) => {
      await call(m, { source: 'windy', region: 'tw' });
      const boxes = calls.map(c => new URL(c.url).searchParams.get('bbox'));
      assert.deepStrictEqual(boxes.sort(), Object.values(m._test.REGIONS.tw.windy).sort());
    });
  } finally {
    if (saved === undefined) delete process.env.WINDY_API_KEY; else process.env.WINDY_API_KEY = saved;
  }
});

test('the client plays one tile live by default and keeps the anomaly log on the device', () => {
  assert.match(CAM_SRC, /this\.allLive \|\| this\.layout === 1 \|\| i === this\.focus/, 'only the focused tile is live unless LIVE: ALL');
  assert.match(CAM_SRC, /allLive: false/);
  assert.match(CAM_SRC, /hqdefault_live\.jpg/, 'other tiles show a still');
  assert.match(CAM_SRC, /anomKey: 'bdoc\.camwall\.anomalies\.v1'/);
  assert.match(CAM_SRC, /Saved on this device only/, 'the popup says the report is local and unconfirmed');
  assert.doesNotMatch(CAM_SRC, /fetch\([^)]*anomal/i, 'anomalies are not sent anywhere yet');
  for (const r of ['me', 'ua', 'tw', 'kr']) assert.match(CAM_SRC, new RegExp(`\\b${r}: \\{ name:`), 'region ' + r + ' in the dropdown');
  assert.match(HTML, /Cam Wall: city cams/);
});
