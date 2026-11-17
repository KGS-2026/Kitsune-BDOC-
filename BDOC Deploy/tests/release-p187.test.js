// p187 release: plans window and first-screen fixes from marketing/LANDING_PAGE_FIXES.md.
// SW bdoc-v191 with v190 kept as a "(prev)" line, css/bdoc.css at ?v=p187 in the page and the
// precache, and the pricing changes themselves:
//  - the plans grid no longer carries an inline 4-column style (it beat the phone rule, so phones
//    showed four squeezed cards); desktop gets 4 columns from .mo .pg4, phones 1 from .mo .pg
//  - no annual Subscribe buttons while the Stripe yearly prices are one-time (auth.js falls back)
//  - no aggregateRating in the JSON-LD (there are no reviews)
//  - plan cards don't promise a REST API, white-label, custom AI models or an SLA
//  - ?vet=1 / ?promo=CODE pre-applies a whitelisted military code, and nothing else
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const HTML = read('index.html'), SW = read('service-worker.js'), CSS = read('css/bdoc.css');
const PRECACHE = [.../const STATIC_PRECACHE = \[([\s\S]*?)\n\];/.exec(SW)[1].matchAll(/^\s*'([^']+)',?\s*$/gm)].map(m => m[1]);
const MODAL = (() => { const i = HTML.indexOf('<div class="mo-bg" id="moBg">'); return HTML.slice(i, HTML.indexOf('CONTINUE FREE', i)); })();

test('SW bdoc-v191 for p187, with v190 kept as a (prev) line', () => {
  assert.match(SW, /^(?:\/\/ \(prev\) )?const SW_VERSION = 'bdoc-v191';  \/\/ p187:[^\n]*\n\/\/ \(prev\) const SW_VERSION = 'bdoc-v190';  \/\/ p186:/m);
  assert.equal((SW.match(/^const SW_VERSION = /gm) || []).length, 1, 'one live SW_VERSION line');
});

test('css/bdoc.css moved to ?v=p187 (or later) in the page and the precache, once each', () => {
  const v = /<link rel="stylesheet" href="css\/bdoc\.css\?v=([^"]+)">/.exec(HTML)[1];
  assert.match(v, /^p1(?:8[7-9]|9\d)\w*$/);
  assert.deepEqual(PRECACHE.filter(p => p.startsWith('/css/bdoc.css')), ['/css/bdoc.css?v=' + v]);
});

test('plans grid: no inline column count; 4 columns on desktop, the phone rule still wins', () => {
  assert.ok(MODAL.includes('<div class="pg pg4">'), 'grid has the pg4 class');
  assert.ok(!/class="pg[^"]*"[^>]*style="[^"]*grid-template-columns/.test(MODAL), 'no inline grid-template-columns on the grid');
  const desk = CSS.indexOf('.mo .pg4{grid-template-columns:repeat(4,1fr)}');
  const phone = CSS.indexOf('.mo .pg{grid-template-columns:1fr}');
  assert.ok(desk > -1 && phone > -1, 'both rules exist');
  // same specificity (0,2,0), so the later phone rule inside @media(max-width:767px) wins on phones
  assert.ok(desk < phone, 'desktop rule comes before the phone rule');
  const before = CSS.slice(0, phone), mq = before.lastIndexOf('@media(max-width:767px){');
  assert.ok(mq > desk && !before.slice(mq).includes('\n}\n'), 'phone rule sits inside the 767px media block');
});

test('no annual Subscribe buttons while yearly Stripe prices are one-time', () => {
  assert.ok(!/subscribe\('(?:operator|analyst|enterprise)',\s*true\)/.test(MODAL));
  assert.ok(!/ANNUAL — \$/.test(MODAL));
  assert.equal((MODAL.match(/Monthly · cancel anytime/g) || []).length, 3);
});

test('no made-up rating in the structured data', () => {
  const ld = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(HTML)[1];
  const j = JSON.parse(ld);
  assert.equal(j.aggregateRating, undefined);
  assert.deepEqual(j.offers.map(o => o.price), ['0', '9.99', '29.99', '499']);
});

test('plan cards list only what exists', () => {
  for (const claim of ['REST API access', 'White-label deployment', 'Custom AI models', 'Dedicated analyst support', 'SLA &amp;', "world's first"]) {
    assert.ok(!MODAL.includes(claim), 'still claims: ' + claim);
  }
  assert.ok(MODAL.includes('Battle Tracker: 2525C symbols, TAK import'), 'Analyst names Battle Tracker');
  assert.ok(MODAL.includes('Veterans &amp; military: <b>$4.99/mo</b>'), 'veteran price on the Operator card');
  assert.ok(/id="bdocProof" hidden/.test(MODAL), 'proof slot starts hidden');
});

test('showMo() keeps the new headline (it used to write the old one back on every open)', () => {
  assert.ok(!HTML.includes('UNLOCK FULL INTELLIGENCE'), 'old headline still in the page');
  assert.ok(MODAL.includes('<h2>SEE THE WHOLE PICTURE, LIVE</h2>'));
  assert.match(HTML, /h2\.textContent = lName \? [^\n]*: 'SEE THE WHOLE PICTURE, LIVE';/);
});

// The ?vet=1 snippet is one inline line; run it in a sandbox with a fake location/localStorage.
function runVet(search) {
  const line = HTML.split('\n').find(l => l.includes("q.get('vet')"));
  assert.ok(line, 'vet snippet present');
  const store = {}, toasts = [];
  const ctx = { URLSearchParams, location: { search }, localStorage: { setItem: (k, v) => { store[k] = v; } },
    setTimeout: f => f(), af: (c, m) => toasts.push(m) };
  vm.runInNewContext(line, ctx);
  return { store, toasts };
}

test('?vet=1 applies VETERAN50; ?promo= only takes whitelisted codes', () => {
  assert.deepEqual(runVet('?vet=1&ref=fb-test').store, { bdoc_promo_applied: 'VETERAN50' });
  assert.equal(runVet('?vet=1').toasts.length, 1);
  assert.deepEqual(runVet('?promo=military50').store, { bdoc_promo_applied: 'MILITARY50' });
  assert.deepEqual(runVet('?promo=YUT/50').store, { bdoc_promo_applied: 'YUT50' });
  assert.deepEqual(runVet('?promo=FREE100').store, {});
  assert.deepEqual(runVet('?ref=r-preppers').store, {});
  assert.deepEqual(runVet('').store, {});
});

test('the whitelist in the page matches the checkout function', () => {
  const fn = read('netlify/functions/stripe-checkout.js');
  const server = /PROMO_WHITELIST = \[([^\]]+)\]/.exec(fn)[1].match(/'([A-Z0-9]+)'/g).map(s => s.slice(1, -1)).sort();
  const line = HTML.split('\n').find(l => l.includes("q.get('vet')"));
  const page = /\[('MILITARY50'[^\]]+)\]/.exec(line)[1].match(/'([A-Z0-9]+)'/g).map(s => s.slice(1, -1)).sort();
  assert.deepEqual(page, server);
});
