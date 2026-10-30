// LIVE WIRE clustering tests. node --test tests/wire-cluster.test.js
// A false match here is a fake confirmation, and a fake confirmation can page the
// owner. So half of this file is proving things do NOT merge.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const lib = path.join(__dirname, '..', 'tools', 'wire', 'lib', 'cluster.js');
const { Clusterer, tokenize } = require(lib);

let seq = 0;
const NOW = Date.UTC(2026, 9, 30, 18, 0, 0);

function item(h, o) {
  seq++;
  return Object.assign({
    id: 'id' + seq, t: NOW, h, sn: 'Outlet', cls: 'wire', pub: 'outlet' + seq + '.com', base: 0, fresh: true
  }, o);
}

function clock(start) {
  const c = { t: start || NOW };
  c.now = () => c.t;
  return c;
}

const fresh = (t) => new Clusterer({ now: (t || clock()).now });

test('tokenize strips the Google News suffix, stopwords and simple plurals', () => {
  const t = tokenize('Strikes at the ports of Long Beach - The Maritime Executive', 'The Maritime Executive', 'aggregator');
  assert.deepEqual([...t], ['strike', 'port', 'long', 'beach']);
});

test('the publisher name in a suffix is not evidence of sameness', () => {
  const a = fresh();
  a.add(item('Mayor resigns in Reno after audit - Daily Herald', { sn: 'Daily Herald', cls: 'aggregator' }));
  const r = a.add(item('Council votes in Boise on budget - Daily Herald', { sn: 'Daily Herald', cls: 'aggregator' }));
  assert.equal(r.isNew, true);
});

test('a lone wire item is reported, a lone post is unverified, a lone official item is official', () => {
  assert.equal(fresh().add(item('Bridge closes in Duluth', { cls: 'wire' })).cluster.st, 'reported');
  assert.equal(fresh().add(item('Bridge closes in Duluth', { cls: 'social', pub: 'bsky.app' })).cluster.st, 'unverified');
  assert.equal(fresh().add(item('Bridge closes in Duluth', { cls: 'osint', pub: 't.me' })).cluster.st, 'unverified');
  assert.equal(fresh().add(item('Bridge closes in Duluth', { cls: 'signal', pub: 'trends' })).cluster.st, 'unverified');
  assert.equal(fresh().add(item('Bridge closes in Duluth', { cls: 'official', pub: 'dot.gov' })).cluster.st, 'official');
});

test('the same story from two publishers is corroborated and reports a change', () => {
  const a = fresh();
  const one = a.add(item('Trump invokes Insurrection Act', { base: 3, pub: 'reuters.com' }));
  assert.equal(one.cluster.st, 'reported');
  assert.equal(one.isNew, true);
  const two = a.add(item('President Trump invokes the Insurrection Act', { base: 3, pub: 'bbc.co.uk' }));
  assert.equal(two.isNew, false);
  assert.equal(two.cluster.id, one.cluster.id);
  assert.equal(two.cluster.st, 'corroborated');
  assert.equal(two.cluster.n, 2);
  assert.equal(two.changed, true);
});

test('real paraphrases of one story from the same day merge', () => {
  const a = fresh();
  const one = a.add(item('Strike Threat Looms at Eight Los Angeles, Long Beach Port Terminals'));
  const two = a.add(item('Port strike threat at Los Angeles, Long Beach terminals looms'));
  assert.equal(two.cluster.id, one.cluster.id);
  const b = fresh();
  const x = b.add(item('Three dead after two helicopters collide midair near Oregon airport'));
  const y = b.add(item('Helicopters collide midair near Oregon airport, three dead'));
  assert.equal(y.cluster.id, x.cluster.id);
});

test('one publisher twice is one publisher, however many feeds it arrives through', () => {
  const a = fresh();
  a.add(item('Trump invokes Insurrection Act', { pub: 'reuters.com' }));
  const r = a.add(item('Trump invokes the Insurrection Act', { pub: 'www.reuters.com' }));
  assert.equal(r.cluster.st, 'reported');
  assert.equal(r.cluster.n, 1);
});

test('two stories sharing the words National Guard do NOT merge', () => {
  const a = fresh();
  const one = a.add(item('Colorado National Guard rescues 50 people and 20 pets amid flooding'));
  const two = a.add(item('National Guard deployed to Chicago after protests'));
  assert.equal(two.isNew, true);
  assert.notEqual(two.cluster.id, one.cluster.id);
  assert.equal(two.cluster.st, 'reported');
});

test('same sentence, different city: not the same story', () => {
  const a = fresh();
  a.add(item('National Guard deployed to Portland after protests'));
  assert.equal(a.add(item('National Guard deployed to Chicago after protests')).isNew, true);
  assert.equal(a.add(item('Terror attack kills 30 in Mali')).isNew, true);
  assert.equal(a.add(item('Terror attack kills 30 in Nigeria')).isNew, true);
});

test('same sentence, different unknown place: also not the same story', () => {
  const a = fresh();
  a.add(item('Wildfire near Bishop forces evacuations'));
  assert.equal(a.add(item('Wildfire near Ojai forces evacuations')).isNew, true);
});

test('a broader and a narrower place can be one story', () => {
  const a = fresh();
  const one = a.add(item('National Guard deployed to Chicago to stop riots spreading'));
  const two = a.add(item('Illinois: National Guard deployed to Chicago to stop riots'));
  assert.equal(two.cluster.id, one.cluster.id);
});

test('LA and Long Beach are one metro, for the one story that needs them to be', () => {
  const a = fresh();
  const one = a.add(item('Port strike shuts Los Angeles terminals as talks collapse'));
  const two = a.add(item('Port strike shuts Long Beach terminals as talks collapse'));
  assert.equal(two.cluster.id, one.cluster.id);
});

test('a short headline does not swallow every longer one that contains its words', () => {
  const a = fresh();
  a.add(item('Trump election fraud claims'));
  const r = a.add(item('Georgia judge dismisses Trump election fraud lawsuit brought by county commissioners'));
  assert.equal(r.isNew, true);
});

test('headlines with too few meaningful words never match anything', () => {
  const a = fresh();
  a.add(item('Trump speaks'));
  assert.equal(a.add(item('Trump speaks')).isNew, true);
});

test('two different headlines from one publisher are two stories', () => {
  const a = fresh();
  a.add(item('Flood Warning issued for Harris County until midnight', { cls: 'official', pub: 'weather.gov' }));
  const r = a.add(item('Flood Warning issued for Dallas County until midnight', { cls: 'official', pub: 'weather.gov' }));
  assert.equal(r.isNew, true);
  const b = fresh();
  b.add(item('Green earthquake (Magnitude 5.5M, Depth:10km) in Vanuatu Islands 28/10/2026 01:39 UTC', { cls: 'official', pub: 'gdacs.org' }));
  assert.equal(b.add(item('Green earthquake (Magnitude 6M, Depth:10km) in Vanuatu Islands 28/10/2026 02:21 UTC', { cls: 'official', pub: 'gdacs.org' })).isNew, true);
});

test('a near-identical repost from one publisher still joins', () => {
  const a = fresh();
  const one = a.add(item('They are moving the National Guard into Philly tonight', { cls: 'social', pub: 'bsky.app' }));
  const two = a.add(item('They are moving the National Guard into Philly tonight!!', { cls: 'social', pub: 'bsky.app' }));
  assert.equal(two.cluster.id, one.cluster.id);
  assert.equal(two.cluster.st, 'unverified');
});

test('a story only stays open for 12 hours after its last item', () => {
  const t = clock();
  const a = fresh(t);
  a.add(item('Trump invokes Insurrection Act', { t: t.t }));
  t.t += 12 * 3600e3 + 1000;
  const r = a.add(item('President Trump invokes Insurrection Act', { t: t.t }));
  assert.equal(r.isNew, true);
});

test('prune frees the index along with the story', () => {
  const t = clock();
  const a = fresh(t);
  a.add(item('Trump invokes Insurrection Act', { t: t.t }));
  t.t += 13 * 3600e3;
  assert.equal(a.prune(), 1);
  assert.equal(a.size, 0);
  assert.equal(a.index.size, 0);
});

// ── Truth ladder ──────────────────────────────────────────────────────────────
test('official beats everything, including a fact check', () => {
  const a = fresh();
  a.add(item('Hurricane warning issued for Tampa Bay coast', { cls: 'wire' }));
  a.add(item('Hurricane warning issued for Tampa Bay coast tonight', { cls: 'official', pub: 'nhc.noaa.gov' }));
  const r = a.add(item('Fact check: hurricane warning issued for Tampa Bay coast', { cls: 'factcheck', pub: 'snopes.com', debunk: true }));
  assert.equal(r.cluster.st, 'official');
});

test('a factcheck joining marks a corroborated story disputed', () => {
  const a = fresh();
  a.add(item('Trump declares martial law in Chicago', { base: 3, pub: 'a.com' }));
  a.add(item('Trump declares martial law across Chicago', { base: 3, pub: 'b.com' }));
  const r = a.add(item('Fact check: did Trump declare martial law in Chicago', { cls: 'factcheck', pub: 'snopes.com', debunk: true }));
  assert.equal(r.cluster.st, 'disputed');
  assert.equal(r.changed, true);
  assert.equal(r.cluster.sev, 1);
});

test('a news outlet saying the headline is false disputes the story', () => {
  const a = fresh();
  a.add(item('Ballots burned in Detroit warehouse fire', { pub: 'a.com' }));
  const r = a.add(item('Claim that ballots burned in Detroit warehouse fire is a hoax', { pub: 'b.com', debunk: true }));
  assert.equal(r.cluster.st, 'disputed');
});

test('a social post cannot dispute a story that the record supports', () => {
  const a = fresh();
  a.add(item('Trump invokes Insurrection Act', { base: 3, pub: 'a.com' }));
  a.add(item('President Trump invokes Insurrection Act', { base: 3, pub: 'b.com' }));
  const r = a.add(item('Trump invokes Insurrection Act hoax', { cls: 'social', pub: 'bsky.app', debunk: true }));
  assert.equal(r.cluster.id, a.stories.keys().next().value);
  assert.equal(r.cluster.st, 'corroborated');
});

test('a lone post calling something false reads as disputed, not unverified', () => {
  assert.equal(fresh().add(item('Russia collusion hoax story exposed', { cls: 'osint', pub: 'trumpstruth.org', debunk: true })).cluster.st, 'disputed');
});

// ── Severity ──────────────────────────────────────────────────────────────────
test('a post claiming sev 3 displays 1, and rises only when the record backs it', () => {
  const a = fresh();
  const one = a.add(item('Trump invokes Insurrection Act', { cls: 'social', pub: 'bsky.app', base: 3 }));
  assert.equal(one.cluster.sev, 1);
  assert.equal(one.cluster.st, 'unverified');
  assert.equal(one.cluster.base, 0);

  const two = a.add(item('President Trump invokes Insurrection Act', { base: 3, pub: 'reuters.com' }));
  assert.equal(two.cluster.id, one.cluster.id);
  assert.equal(two.cluster.st, 'reported');
  assert.equal(two.cluster.sev, 3);
  assert.equal(two.changed, true);
});

test('a post cannot lift a reported story above what the outlet itself said', () => {
  const a = fresh();
  a.add(item('Trump invokes Insurrection Act, officials say Chicago next', { base: 1, pub: 'reuters.com' }));
  const r = a.add(item('Trump invokes Insurrection Act, officials say Chicago next!!', { cls: 'social', pub: 'bsky.app', base: 3 }));
  assert.equal(r.cluster.sev, 1);
});

test('a notable post can still mark a quiet story notable', () => {
  const a = fresh();
  a.add(item('Traffic stopped on bridge in Duluth during protests', { base: 0, pub: 'reuters.com' }));
  const r = a.add(item('Traffic stopped on bridge in Duluth during protests!', { cls: 'social', pub: 'bsky.app', base: 1 }));
  assert.equal(r.cluster.sev, 1);
});

test('newest item decides fresh, an older backfill cannot overwrite it', () => {
  const a = fresh();
  a.add(item('Trump invokes Insurrection Act', { t: NOW, fresh: true, pub: 'a.com' }));
  const r = a.add(item('President Trump invokes Insurrection Act', { t: NOW - 3600e3, fresh: false, pub: 'b.com', firstPoll: true }));
  assert.equal(r.cluster.fresh, true);
});

test('first-poll publishers count toward the display but not toward what a page may rely on', () => {
  const a = fresh();
  a.add(item('Trump invokes Insurrection Act', { pub: 'a.com', firstPoll: true, base: 3 }));
  const r = a.add(item('President Trump invokes Insurrection Act', { pub: 'b.com', firstPoll: true, base: 3 }));
  assert.equal(r.cluster.st, 'corroborated');
  assert.equal(r.cluster.livePubs.size, 0);
  assert.equal(r.cluster.strong.size, 0);
});

test('the page quote is the strongest credible item, never a post', () => {
  const a = fresh();
  a.add(item('Trump invokes Insurrection Act', { cls: 'social', pub: 'bsky.app', base: 3, sn: 'Bluesky' }));
  const r = a.add(item('President Trump invokes Insurrection Act', { base: 3, pub: 'reuters.com', sn: 'Reuters', u: 'https://reuters.com/x' }));
  assert.equal(r.cluster.top.sn, 'Reuters');
});

// ── Persistence ───────────────────────────────────────────────────────────────
test('a story survives serialize and restore: it still matches and remembers its page', () => {
  const t = clock();
  const a = fresh(t);
  const one = a.add(item('Trump invokes Insurrection Act', { base: 3, pub: 'a.com', t: t.t }));
  one.cluster.paged = true;
  const saved = JSON.parse(JSON.stringify(a.serialize(one.cluster)));

  const b = fresh(t);
  assert.equal(b.restore([saved]), 1);
  const r = b.add(item('President Trump invokes Insurrection Act', { base: 3, pub: 'b.com', t: t.t }));
  assert.equal(r.isNew, false);
  assert.equal(r.cluster.id, one.cluster.id);
  assert.equal(r.cluster.paged, true);
  assert.equal(r.cluster.st, 'corroborated');
});

test('restore skips stories past the window and malformed rows', () => {
  const t = clock();
  const a = fresh(t);
  const one = a.add(item('Trump invokes Insurrection Act', { pub: 'a.com', t: t.t }));
  const saved = a.serialize(one.cluster);
  t.t += 13 * 3600e3;
  const b = fresh(t);
  assert.equal(b.restore([saved, null, { id: 'x' }]), 0);
});

test('matching stays fast with a full window of stories', () => {
  const a = fresh();
  for (let i = 0; i < 20000; i++) {
    a.add(item(`Unrelated headline number ${i} about topic${i % 400} and subject${i % 900}`, { cls: 'social', pub: 'bsky.app' }));
  }
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) a.add(item(`Unrelated headline number ${i} about topic${i % 400} and thing${i}`));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
  assert.ok(ms < 20, ms.toFixed(2) + ' ms per add');
});
