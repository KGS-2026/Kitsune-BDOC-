// p170: Signals layer (SIGINT group). Upstreams are stubbed; these pin the source whitelist, the squawk
// fallback, the KiwiSDR list being read as data only (never evaluated), the NOAA mapping and the wiring.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'netlify', 'functions', 'proxy-signals.js');
const FN_SRC = fs.readFileSync(FN, 'utf8');
const SG_SRC = fs.readFileSync(path.join(ROOT, 'js', 'modules', 'signals.js'), 'utf8');
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
const body = (r) => JSON.parse(r.body);

test('only the three sources answer; anything else, prototype names included, is a 400 with no upstream call', async () => {
  const m = fresh();
  await withFetch(() => ({}), async (calls) => {
    for (const s of [undefined, '', 'yt', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const r = await call(m, s === undefined ? {} : { source: s });
      assert.strictEqual(r.statusCode, 400, String(s));
    }
    assert.strictEqual(calls.length, 0);
  });
});

test('squawk: adsb.lol first, adsb.fi when it fails; aircraft deduped, bad positions dropped, 7500 sorted first', async () => {
  const m = fresh();
  const feeds = {
    'api.adsb.lol/v2/sqk/7500': { ac: [{ hex: 'ABC123', flight: 'TEST1   ', r: 'N1', t: 'B738', alt_baro: 35000, gs: 450, lat: 40.1, lon: -74.2, squawk: '7500' }] },
    'api.adsb.lol/v2/sqk/7600': { ac: [{ hex: 'def456', flight: 'RAD\u0007IO', alt_baro: 'ground', lat: 51.5, lon: -0.1 }, { hex: 'bad000', lat: 'x', lon: 2 }, { hex: 'bad001', lat: 95, lon: 2 }] },
    'opendata.adsb.fi/api/v2/sqk/7700': { ac: [{ hex: 'abc123', lat: 40.1, lon: -74.2 }, { hex: '0a0b0c', t: 'A320', alt_baro: 12000, lat: -33.9, lon: 151.2, emergency: 'general' }] }
  };
  await withFetch((url) => {
    if (url.includes('api.adsb.lol/v2/sqk/7700')) return { status: 503 };
    const k = Object.keys(feeds).find(k => url.includes(k));
    return k ? { body: feeds[k] } : { status: 404 };
  }, async (calls) => {
    const r = await call(m, { source: 'squawk' });
    assert.strictEqual(r.statusCode, 200);
    const j = body(r);
    assert.deepStrictEqual(j.aircraft.map(a => a.hex), ['abc123', 'def456', '0a0b0c'], 'deduped across codes, 7500 first');
    assert.strictEqual(j.aircraft[0].meaning, 'hijack');
    assert.strictEqual(j.aircraft[0].flight, 'TEST1');
    assert.strictEqual(j.aircraft[1].alt, 'ground');
    assert.strictEqual(j.aircraft[1].flight, 'RAD IO', 'control characters are stripped');
    assert.strictEqual(j.aircraft[2].emergency, 'general');
    assert.ok(calls.some(c => c.url === 'https://opendata.adsb.fi/api/v2/sqk/7700'), 'fell back to adsb.fi');
    assert.ok(calls.every(c => !/@/.test(c.opts.headers['User-Agent'])), 'no email address in the User-Agent');
    assert.match(r.headers['Netlify-CDN-Cache-Control'], /s-maxage=\d+/);
  });
});

test('squawk: when both ADS-B sources fail for every code the function says so (502) instead of "none right now"', async () => {
  const m = fresh();
  await withFetch(() => ({ status: 500 }), async () => {
    const r = await call(m, { source: 'squawk' });
    assert.strictEqual(r.statusCode, 502);
    assert.match(body(r).error, /both ADS-B sources failed/);
  });
});

test('sdr: the receiver list is parsed as JSON only, and unusable or unsafe entries are dropped', async () => {
  assert.doesNotMatch(FN_SRC, /\beval\s*\(|new\s+Function|Function\s*\(|require\(['"]vm['"]\)/, 'never evaluates the downloaded list');
  const list = [
    { id: 'a', status: 'active', offline: 'no', name: 'Good RX', loc: 'Somewhere', antenna: 'Mini-Whip', url: 'http://rx.example.org:8073/', gps: '(50.45, 30.52)', users: '2', users_max: '8', bands: '0-30000000', snr: '24,19' },
    { id: 'b', status: 'active', offline: 'no', name: 'Partial band', url: 'https://rx2.example.org', gps: '(35.70, 51.40)', users: '0', users_max: '4', bands: '10000-14000000' },
    { id: 'c', status: 'offline', offline: 'yes', url: 'http://off.example.org:8073', gps: '(1, 1)' },
    { id: 'd', status: 'active', offline: 'no', url: 'javascript:alert(1)', gps: '(10, 10)' },
    { id: 'e', status: 'active', offline: 'no', url: 'http://x.example.org/?a=<script>', gps: '(10, 10)' },
    { id: 'f', status: 'active', offline: 'no', url: 'http://nogps.example.org', gps: '' },
    { id: 'g', status: 'active', offline: 'no', url: 'http://null-island.example.org', gps: '(0, 0)' }
  ];
  // the mirror's real shape: a JS assignment with trailing commas
  const text = 'var kiwisdr_com = ' + JSON.stringify(list, null, 1).replace(/\n\s*\}/g, ',\n}').replace(/\}\n\]/, '},\n]') + ';\n';
  const m = fresh();
  await withFetch(() => ({ body: text }), async (calls) => {
    const r = await call(m, { source: 'sdr' });
    assert.strictEqual(r.statusCode, 200, r.body);
    const rx = body(r).receivers;
    assert.deepStrictEqual(rx.map(x => x.id), ['a', 'b']);
    assert.strictEqual(rx[0].url, 'http://rx.example.org:8073', 'trailing slash removed');
    assert.deepStrictEqual([rx[0].lo, rx[0].hi, rx[0].users, rx[0].max, rx[0].snr], [0, 30000, 2, 8, 24]);
    assert.deepStrictEqual([rx[1].lo, rx[1].hi], [10, 14000], 'bands are converted to kHz');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'http://rx.linkfanel.net/kiwisdr_com.js');
  });
  // a list that is code rather than data is refused, not run
  const m2 = fresh();
  await withFetch(() => ({ body: 'var kiwisdr_com = [ (function(){ globalThis.__pwned = 1; return {}; })() ];' }), async () => {
    const r = await call(m2, { source: 'sdr' });
    assert.strictEqual(r.statusCode, 502);
    assert.strictEqual(globalThis.__pwned, undefined);
  });
});

test('hf: NOAA scales map to now + a 3-day outlook, and the answer is cached', async () => {
  const noaa = {
    '-1': { DateStamp: '2026-11-04', TimeStamp: '00:00:00', R: { Scale: '0' }, S: { Scale: '0' }, G: { Scale: '0' } },
    '0': { DateStamp: '2026-11-05', TimeStamp: '19:50:00', R: { Scale: '2', Text: 'moderate', MinorProb: null, MajorProb: null }, S: { Scale: '0', Text: 'none', Prob: null }, G: { Scale: '1', Text: 'minor' } },
    '1': { DateStamp: '2026-11-06', TimeStamp: '00:00:00', R: { Scale: null, Text: null, MinorProb: '35', MajorProb: '10' }, S: { Scale: null, Text: null, Prob: '5' }, G: { Scale: '1', Text: 'minor' } },
    '2': { DateStamp: '2026-11-07', TimeStamp: '00:00:00', R: { Scale: null, MinorProb: '30', MajorProb: '5' }, S: { Scale: null, Prob: '1' }, G: { Scale: '0', Text: 'none' } },
    '3': { DateStamp: '2026-11-08', TimeStamp: '00:00:00', R: { Scale: null, MinorProb: '25', MajorProb: '5' }, S: { Scale: null, Prob: '1' }, G: { Scale: '0', Text: 'none' } }
  };
  const m = fresh();
  await withFetch(() => ({ body: noaa }), async (calls) => {
    const j = body(await call(m, { source: 'hf' }));
    assert.deepStrictEqual([j.now.r, j.now.s, j.now.g, j.now.gText, j.now.date, j.now.time], [2, 0, 1, 'minor', '2026-11-05', '19:50:00']);
    assert.deepStrictEqual(j.outlook.map(d => [d.date, d.rMinor, d.rMajor, d.sProb, d.g]),
      [['2026-11-06', 35, 10, 5, 1], ['2026-11-07', 30, 5, 1, 0], ['2026-11-08', 25, 5, 1, 0]]);
    assert.strictEqual(j.outlook[0].r, null, 'a forecast day has no current scale');
    await call(m, { source: 'hf' });
    assert.strictEqual(calls.length, 1, 'second call inside 10 min is served from memory');
  });
});

test('LISTEN picks the nearest receiver that covers the frequency and has a free slot', () => {
  const ctx = { window: {}, console };
  vm.runInNewContext(SG_SRC, ctx, { filename: 'signals.js' });
  const S = ctx.window.SignalsWatch, P = ctx.SIGNALS_CFG.presets;
  const hfgcs = P.find(p => p.f === 8992), wwv = P.find(p => p.f === 10000);
  S.sdr = [
    { name: 'Kyiv full', lat: 50.4, lon: 30.5, users: 4, max: 4, lo: 0, hi: 30000, url: 'http://a.example' },
    { name: 'Warsaw', lat: 52.2, lon: 21.0, users: 1, max: 4, lo: 0, hi: 30000, url: 'http://b.example' },
    { name: 'Lviv 10m only', lat: 49.8, lon: 24.0, users: 0, max: 4, lo: 28000, hi: 30000, url: 'http://c.example' },
    { name: 'Lisbon', lat: 38.7, lon: -9.1, users: 0, max: 4, lo: 0, hi: 30000, url: 'http://d.example' }
  ];
  const at = { lat: 50.45, lon: 30.52 };
  assert.strictEqual(S.nearest(hfgcs, at).r.name, 'Warsaw', 'full and out-of-band receivers are skipped');
  assert.ok(Math.abs(S.nearest(hfgcs, at).km - 690) < 30);
  assert.strictEqual(S._tuneUrl(S.sdr[1], hfgcs), 'http://b.example/?f=8992usb');
  assert.strictEqual(S._tuneUrl(S.sdr[1], wwv), 'http://b.example/?f=10000am');
  S.sdr = S.sdr.filter(r => r.name === 'Kyiv full');
  assert.strictEqual(S.nearest(hfgcs, at), null);
  assert.deepStrictEqual([S._khz(10), S._khz(0), S._khz(30000), S._khz(14400)], ['10 kHz', '0 kHz', '30 MHz', '14.4 MHz']);
  assert.strictEqual(S._where({ name: 'VE9CIB | Haut-Sheila, New-Brunswick', loc: 'Haut-Sheila, New-Brunswick' }), '', 'place already in the name');
  assert.strictEqual(S._where({ name: 'Mini-Whip RX', loc: 'Lviv' }), 'Lviv');
  for (const p of P) assert.ok(p.f > 0 && p.f < 30000 && ['usb', 'lsb', 'am'].includes(p.m) && p.name && p.note);
});

test('a squawk alert is escaped before the alert feed (which uses innerHTML) and fires once per aircraft', () => {
  const fed = [], logged = [];
  const ctx = { window: {}, console, af: (c, x) => fed.push(x), EventLog: { add: (s, m) => logged.push(m) },
    esc: (s) => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]) };
  vm.runInNewContext(SG_SRC, ctx, { filename: 'signals.js' });
  const S = ctx.window.SignalsWatch;
  S.sq = [{ hex: 'abc123', squawk: '7700', meaning: 'emergency', flight: '<img src=x>', type: 'B738', alt: 'ground', lat: 1, lon: 2 }];
  S._alertNew(); S._alertNew();
  assert.strictEqual(fed.length, 1, 'the same aircraft is not alerted twice');
  assert.doesNotMatch(fed[0], /<img/);
  assert.match(fed[0], /&lt;img src=x&gt;/);
  assert.strictEqual(logged.length, 1);
});

test('index.html wires the Signals toggle, and the module stays inside its lane', () => {
  assert.doesNotMatch(HTML, /Signals Intelligence<\/span><span class="ly-tg tg-p">SOON/, 'the placeholder is gone');
  assert.match(HTML, /<div class="ly" data-layer="signals" onclick="togLy\(this\)">/);
  assert.match(HTML, /const layers=\{[^}]*camwall:false,signals:false/);
  assert.match(HTML, /if\(ly==='signals'\)\{[^\n]*LazyLoader\.load\('signals'\)[^\n]*window\.SignalsWatch\.stop\(\)/);
  // module: talks only to its own proxy, no inline handlers, new tabs cannot reach back into BDOC
  assert.deepStrictEqual([...SG_SRC.matchAll(/fetch\('([^'?]+)/g)].map(x => x[1]), ['/.netlify/functions/proxy-signals']);
  assert.doesNotMatch(SG_SRC, /onclick=/i);
  assert.match(SG_SRC, /window\.open\(.*'_blank', 'noopener'\)/);
  for (const a of SG_SRC.match(/<a href=[^>]+>/g)) {
    assert.match(a, /href="\$\{safeUrl\(/, 'every link goes through safeUrl: ' + a);
    assert.match(a, /rel="noopener noreferrer"/, a);
  }
  // receiver names come from strangers: they are always escaped before they reach HTML
  assert.doesNotMatch(SG_SRC, /\$\{(?:r|n\.r)\.(?:name|loc|antenna)\s*[}.+]/, 'raw receiver text never interpolated');
});

test('signals.js declares no top-level name that index.html or another script already declares', () => {
  const top = (src) => [...src.matchAll(/^(?:var|let|const|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  const others = [HTML].concat(fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')))
    .concat(fs.readdirSync(path.join(ROOT, 'js', 'modules')).filter(f => f.endsWith('.js') && f !== 'signals.js').map(f => fs.readFileSync(path.join(ROOT, 'js', 'modules', f), 'utf8')));
  const taken = new Set(others.flatMap(top).concat(others.flatMap(s => [...s.matchAll(/(?:^|[\s;{}])(?:let|const|class|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]))));
  const mine = top(SG_SRC);
  assert.deepStrictEqual(mine.sort(), ['SIGNALS_CFG', 'SignalsWatch']);
  assert.deepStrictEqual(mine.filter(n => taken.has(n)), []);
});

test('the desktop app runs proxy-signals in-process, before its offline catch-all', () => {
  const s = fs.readFileSync(path.join(ROOT, 'electron', 'server.js'), 'utf8');
  const list = /for \(const fn of \[([^\]]+)\]\)/.exec(s);
  assert.ok(list && /'proxy-signals'/.test(list[1]));
  assert.ok(s.indexOf("'proxy-signals'") < s.indexOf("app.all('/.netlify/functions/*'"));
});

test('sources.html credits every Signals feed', () => {
  const s = fs.readFileSync(path.join(ROOT, 'sources.html'), 'utf8');
  assert.match(s, /kiwisdr\.com/);
  assert.match(s, /rx\.linkfanel\.net/);
  assert.match(s, /adsb\.lol[\s\S]{0,200}emergency squawks/);
  assert.match(s, /HF radio conditions/);
});
