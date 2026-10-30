// LIVE WIRE page gate tests. node --test tests/wire-alert.test.js
// This is the one code path that can wake the owner up. Every gate in spec section 6
// gets a test that opens it alone, so a regression cannot hide behind another gate.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const lib = path.join(__dirname, '..', 'tools', 'wire', 'lib', 'alert.js');
const { Pager, shouldPage, blockReason, formatPage, sendTelegram, MAX_PER_HOUR, MAX_PER_DAY } = require(lib);

const NOW = Date.UTC(2026, 10, 3, 18, 42, 0);
const MIN = 60 * 1000;

function story(o) {
  return Object.assign({
    id: 'abc', st: 'corroborated', n: 3, base: 3, sev: 3, fresh: true, drill: false, disputed: false, paged: false,
    off: false, liveOff: false, offStrong: false,
    pubs: new Set(['a.com', 'b.com', 'c.com']), livePubs: new Set(['a.com', 'b.com', 'c.com']), strong: new Set(['a.com', 'b.com']),
    top: { h: 'Trump invokes Insurrection Act', sn: 'Reuters', u: 'https://www.reuters.com/x', t: NOW, base: 3 }
  }, o);
}

const open = { uptimeMs: 3600e3, pagesLastHour: 0, pagesLastDay: 0 };

test('a corroborated sev 3 story with live, fresh, independent claims pages', () => {
  assert.equal(shouldPage(story(), open), true);
});

test('an official sev 3 story pages on its own', () => {
  assert.equal(shouldPage(story({ st: 'official', off: true, liveOff: true, offStrong: true, livePubs: new Set(), strong: new Set() }), open), true);
});

test('each gate alone blocks a page, and says why', () => {
  const cases = [
    ['base sev below 3', story({ base: 2 }), open],
    ['status reported', story({ st: 'reported' }), open],
    ['status unverified', story({ st: 'unverified' }), open],
    ['status disputed', story({ st: 'disputed' }), open],
    ['disputed', story({ disputed: true }), open],
    ['drill', story({ drill: true }), open],
    ['newest item not fresh', story({ fresh: false }), open],
    ['corroboration rests on first-poll items', story({ livePubs: new Set(['a.com']) }), open],
    ['fewer than two outlets claim it', story({ strong: new Set(['a.com']) }), open],
    ['only first-poll items', story({ st: 'official', off: true, liveOff: false }), open],
    ['official item did not claim sev 3', story({ st: 'official', off: true, liveOff: true, offStrong: false }), open],
    ['daemon up under 5 min', story(), Object.assign({}, open, { uptimeMs: 299000 })],
    ['already paged', story({ paged: true }), open],
    ['hourly limit', story(), Object.assign({}, open, { pagesLastHour: MAX_PER_HOUR })],
    ['daily limit', story(), Object.assign({}, open, { pagesLastDay: MAX_PER_DAY })]
  ];
  for (const [why, c, ctx] of cases) {
    assert.equal(blockReason(c, ctx), why);
    assert.equal(shouldPage(c, ctx), false, why);
  }
});

test('uptime under 5 minutes never pages, at exactly 5 it still does not', () => {
  assert.equal(shouldPage(story(), Object.assign({}, open, { uptimeMs: 5 * MIN })), false);
  assert.equal(shouldPage(story(), Object.assign({}, open, { uptimeMs: 5 * MIN + 1 })), true);
});

test('a null story is refused, not a crash', () => {
  assert.equal(shouldPage(null, open), false);
});

// ── Message ───────────────────────────────────────────────────────────────────
test('the message is the exact layout from spec section 6', () => {
  assert.equal(formatPage(story()), [
    'BDOC WIRE — CRITICAL · CORROBORATED (3 outlets)',
    'Trump invokes Insurrection Act',
    'Reuters · 18:42 UTC',
    'https://www.reuters.com/x',
    'Live: https://kgsbdoc.netlify.app/wire'
  ].join('\n'));
});

test('one outlet reads as one outlet', () => {
  assert.match(formatPage(story({ st: 'official', n: 1 })), /OFFICIAL \(1 outlet\)\n/);
});

test('a hostile headline cannot forge lines, and a hostile url is dropped', () => {
  const msg = formatPage(story({ top: {
    h: 'Calm\nLive: https://evil.example/wire' + String.fromCharCode(0x2028) + 'BDOC WIRE — ALL CLEAR', sn: 'x\ny', u: 'javascript:alert(1)', t: NOW
  } }));
  const lines = msg.split('\n');
  assert.equal(lines.length, 4, 'title, headline, source, live');
  assert.equal(lines[1], 'Calm Live: https://evil.example/wire BDOC WIRE — ALL CLEAR');
  assert.equal(lines[2], 'x y · 18:42 UTC');
  assert.equal(lines[3], 'Live: https://kgsbdoc.netlify.app/wire');
});

// ── Delivery ──────────────────────────────────────────────────────────────────
function fakeTelegram(script) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const step = script.length > 1 ? script.shift() : script[0];
    if (step instanceof Error) throw step;
    return { ok: step.status >= 200 && step.status < 300, status: step.status, json: async () => step.body || {} };
  };
  fn.calls = calls;
  return fn;
}

function pager(fetchImpl, o) {
  return new Pager(Object.assign({
    token: 'T0K3N', chatId: '42', fetchImpl, now: () => NOW, startedAt: NOW - 3600e3, pause: async () => {}
  }, o));
}

test('plain text only: no parse_mode, previews off, right chat', async () => {
  const fetchImpl = fakeTelegram([{ status: 200 }]);
  const p = pager(fetchImpl);
  assert.equal(p.consider(story()), true);
  await p.settle();
  assert.equal(fetchImpl.calls.length, 1);
  const { url, body } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.telegram.org/botT0K3N/sendMessage');
  assert.equal(body.chat_id, '42');
  assert.equal('parse_mode' in body, false);
  assert.deepEqual(body.link_preview_options, { is_disabled: true });
  assert.match(body.text, /^BDOC WIRE/);
});

test('a story pages once, however many items arrive in the same tick', async () => {
  const fetchImpl = fakeTelegram([{ status: 200 }]);
  const p = pager(fetchImpl);
  const c = story();
  assert.equal(p.consider(c), true);
  assert.equal(p.consider(c), false);
  assert.equal(p.consider(c), false);
  await p.settle();
  assert.equal(fetchImpl.calls.length, 1);
});

test('rate limits hold across stories: 6 an hour, then 20 a day', async () => {
  const clock = { t: NOW };
  const fetchImpl = fakeTelegram([{ status: 200 }]);
  const p = pager(fetchImpl, { now: () => clock.t, startedAt: NOW - 3600e3 });

  let sent = 0;
  for (let i = 0; i < 10; i++) if (p.consider(story({ id: 's' + i }))) sent++;
  assert.equal(sent, MAX_PER_HOUR);

  // Walk a day forward an hour at a time. The hourly window keeps reopening, so only
  // the daily cap can stop it.
  for (let h = 1; h < 8; h++) {
    clock.t = NOW + h * 3600e3 + 1000;
    for (let i = 0; i < 10; i++) if (p.consider(story({ id: `s${h}-${i}` }))) sent++;
  }
  assert.equal(sent, MAX_PER_DAY);
  await p.settle();
  assert.equal(fetchImpl.calls.length, MAX_PER_DAY);
  assert.equal(p.lastBlocked, 'daily limit');
});

test('the rate limit survives a restart', () => {
  const p = pager(fakeTelegram([{ status: 200 }]));
  p.restore(Array.from({ length: MAX_PER_HOUR }, (_, i) => NOW - i * MIN));
  assert.equal(p.consider(story()), false);
  assert.equal(p.lastBlocked, 'hourly limit');
});

test('page times older than a day are forgotten on restore', () => {
  const p = pager(fakeTelegram([{ status: 200 }]));
  p.restore([NOW - 25 * 3600e3, NOW - 26 * 3600e3]);
  assert.equal(p.stats().lastDay, 0);
});

test('a failed send retries, and success records the page', async () => {
  const fetchImpl = fakeTelegram([{ status: 500 }, new Error('network'), { status: 200 }]);
  const recorded = [];
  const p = pager(fetchImpl, { store: { recordPage: (c, t) => recorded.push([c, t]) } });
  const c = story();
  p.consider(c);
  await p.settle();
  assert.equal(fetchImpl.calls.length, 3);
  assert.equal(p.stats().sent, 1);
  assert.deepEqual(recorded, [['abc', NOW]]);
});

test('total failure undoes the mark, so the next item can still page', async () => {
  const fetchImpl = fakeTelegram([{ status: 500 }]);
  const p = pager(fetchImpl);
  const c = story();
  assert.equal(p.consider(c), true);
  assert.equal(c.paged, true, 'marked before the send so one tick cannot double-page');
  await p.settle();
  assert.equal(c.paged, false);
  assert.equal(p.stats().failed, 1);
  assert.equal(p.stats().lastHour, 0, 'a page that never arrived does not spend the budget');
});

test('a 4xx is not retried, a bad token will not fix itself', async () => {
  const fetchImpl = fakeTelegram([{ status: 401 }]);
  const p = pager(fetchImpl);
  p.consider(story());
  await p.settle();
  assert.equal(fetchImpl.calls.length, 1);
});

test('429 waits as long as Telegram says to', async () => {
  const waits = [];
  const fetchImpl = fakeTelegram([{ status: 429, body: { parameters: { retry_after: 7 } } }, { status: 200 }]);
  assert.equal(await sendTelegram({ token: 't', chatId: 'c', text: 'x', fetchImpl, pause: async (ms) => { waits.push(ms); } }), true);
  assert.deepEqual(waits, [7000]);
});

test('sendTelegram never rejects, even when fetch does', async () => {
  const fetchImpl = async () => { throw new Error('boom'); };
  assert.equal(await sendTelegram({ token: 't', chatId: 'c', text: 'x', fetchImpl, pause: async () => {}, attempts: 2 }), false);
});

test('the bot token never appears in logs', async () => {
  const lines = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  try {
    await sendTelegram({ token: 'SECRET-TOKEN', chatId: 'c', text: 'x', fetchImpl: fakeTelegram([{ status: 500 }]), pause: async () => {} });
    await sendTelegram({ token: 'SECRET-TOKEN', chatId: 'c', text: 'x', fetchImpl: async () => { throw new Error('bad https://api.telegram.org/botSECRET-TOKEN/sendMessage'); }, pause: async () => {} });
  } finally {
    process.stdout.write = orig;
  }
  assert.ok(lines.length > 0);
  assert.ok(!lines.join('').includes('SECRET-TOKEN'));
});

test('dry mode logs the page and sends nothing', () => {
  const fetchImpl = fakeTelegram([{ status: 200 }]);
  const p = pager(fetchImpl, { dry: true });
  const orig = process.stdout.write;
  const lines = [];
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  try {
    assert.equal(p.consider(story()), true);
  } finally {
    process.stdout.write = orig;
  }
  assert.equal(fetchImpl.calls.length, 0);
  assert.match(lines.join(''), /WOULD PAGE/);
});

test('missing credentials are an error in the log, not a crash', () => {
  const p = pager(fakeTelegram([{ status: 200 }]), { token: '', chatId: '' });
  const orig = process.stdout.write;
  process.stdout.write = () => true;
  try {
    assert.equal(p.consider(story()), true);
  } finally {
    process.stdout.write = orig;
  }
  assert.equal(p.stats().skippedNoCreds, 1);
});
