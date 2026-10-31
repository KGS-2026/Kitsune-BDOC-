// Regressions from the first real run of the collector, 2026-10-30. Every headline here is
// verbatim from the droplet's dry run or a live search that day. Unit fixtures passed while
// these were wrong, which is the reason this file exists: when a real headline misclassifies,
// add it here first.
const { test } = require('node:test');
const assert = require('node:assert');
const { classify } = require('../tools/wire/lib/classify');
const { parseBy } = require('../tools/wire/lib/parse');
const { Pipeline } = require('../tools/wire/lib/pipeline');
const { MemoryStore } = require('../tools/wire/lib/store');

const k = (h, cls = 'wire', x = '') => classify({ h, x, cls });

test('figurative words do not read as military', () => {
  assert.ok(!k('Shriners invade Salina on Saturday morning').cat.includes('military'));
  assert.equal(k('Shriners invade Salina on Saturday morning').sev, 0);
  assert.ok(!k('[PUBLICATION] SERI launches new briefs on anti-land invasion units').cat.includes('military'));
  assert.ok(!k('Protestos contra custo de vida e pela educação continuam a mobilizar estudantes', 'social').cat.includes('military'));
  assert.ok(!k('How a charm offensive won the mayor over').cat.includes('military'));
});

test('real invasions and mobilizations still do', () => {
  assert.ok(k('Russian invasion of Ukraine enters new phase').cat.includes('military'));
  assert.ok(k('China invades Taiwan').cat.includes('military'));
  assert.ok(k('Russia announces partial mobilization').cat.includes('military'));
});

test('a domain name is not a claim', () => {
  const r = k('I took action with No Kings. Will you join me? Use this link to sign up: www.mobilize.us/nokings/even...', 'social');
  assert.ok(!r.cat.includes('military'));
});

test('recount the verb is not an election', () => {
  const r = k('Christa Pike Recounts Botched Execution in First Public Comments');
  assert.ok(!r.cat.includes('election'));
  assert.equal(r.sev, 0);
});

test('recount the procedure still is', () => {
  assert.ok(k('Judge orders hand recount in Maricopa County').cat.includes('election'));
  assert.ok(k('Recount of ballots begins in Georgia Senate race').cat.includes('election'));
});

test('nov4 needs positive evidence', () => {
  for (const h of [
    'Psychedelic Recovery Pathways Discussion Panel Pre-recorded Online Presentation Wed 4 Nov',
    'Flood Watch issued October 30 at 11:29AM MDT until November 4 at 5:00AM MST by NWS Pueblo CO',
    'Flood Warning issued until November 4 at 5:00AM MST',
    'World of Warcraft: Forever Goes Live Globally November 4!',
    'Board of elections meets Nov. 4'
  ]) assert.ok(!k(h, 'social').w.includes('nov4'), h);
});

test('the real Nov. 4 anchors fire', () => {
  for (const h of [
    'Strike deadline at LA-LB ports expected to be delayed to Nov. 4: PMA',
    'Police to deploy 10 000 police officers in EC ahead November 4 polls',
    'DOJ grand jury subpoenas for three L.A. County election workers, returnable Nov. 4, the morning after the election',
    'SAVE THE DATE: In the event of election interference or sabotage, the No Kings movement will gather on November 4',
    'November 4th should be the day we finally fight back',
    'Preparing for a false flag event. canceled rallies.. expect something to happen before November 4th.'
  ]) assert.ok(k(h, 'social').w.includes('nov4'), h);
});

test('a rumor on Nov. 4 is flagged as rumor and stays notable', () => {
  const r = k('Preparing for a false flag event near the base. Expect something to happen before November 4th, election is the target', 'social');
  assert.ok(r.cat.includes('rumor'));
  assert.equal(r.sev, 1);
});

test('major real events rate high, not notable', () => {
  for (const h of [
    'Drone strikes on Ethiopia displacement camp kill at least 15, sources say',
    'Saudi-led coalition reports intercepting ballistic missile and drone',
    'North Korean hackers steal over $6 billion from the largest cryptocurrency exchange',
    'Binance Suspends Withdrawals After Crypto Hackers Steal $6.3 Billion',
    "Italy's PM deploys troops as nation faces widespread strikes and port blockades",
    'Mass protests sweep Italy during nationwide strike'
  ]) assert.equal(k(h).sev, 2, h);
});

test('legal and vendor boilerplate is not an incident', () => {
  assert.equal(k('$2M Covenant Health data breach class action settlement').sev, 0);
  assert.equal(k('New Framework Puts Ransomware Resilience for AI Systems in Focus').sev, 0);
});

test('casual social mentions stay out of the signal view', () => {
  assert.equal(k('But I was told years ago that it could not be hacked and it was totally safe', 'social').sev, 0);
  assert.equal(k('I support dumping the electoral college', 'social').sev, 0);
});

test('the social posts that matter stay in', () => {
  assert.equal(k('Voter intimidation at my polling place right now', 'social').sev, 1);
  assert.equal(k('National Guard trucks rolling down our street tonight', 'social').sev >= 1, true);
});

test('a rumor that merges with an official denial reads DISPUTED and cannot page', () => {
  const { Clusterer } = require('../tools/wire/lib/cluster');
  const { shouldPage } = require('../tools/wire/lib/alert');
  let now = Date.parse('2026-10-30T18:00:00Z');
  const c = new Clusterer({ now: () => now });
  const live = { fresh: true, firstPoll: false, drill: false };
  c.add({ ...live, id: 'a', t: now, h: 'Martial law declared in Portland tonight', sn: 'Bluesky', cls: 'social', pub: 'bsky.app', u: 'https://bsky.app/1', base: 3 });
  now += 60000;
  const r = c.add({ ...live, id: 'b', t: now, h: 'Martial law declared in Portland is false, DHS says', sn: 'DHS', cls: 'official', pub: 'dhs.gov', u: 'https://dhs.gov/1', base: 1, debunk: true });
  assert.equal(r.isNew, false, 'the fixture must merge for this test to mean anything');
  assert.equal(r.cluster.st, 'disputed');
  assert.equal(shouldPage(r.cluster, { uptimeMs: 3600000, pagesLastHour: 0, pagesLastDay: 0 }), false);
  const restored = new Clusterer({ now: () => now });
  restored.restore([c.serialize(r.cluster)]);
  assert.equal(restored.get(r.cluster.id).offDenied, true, 'survives a restart');
});

test('fake monitors are a real event, not a debunk', () => {
  assert.equal(k('South Florida election officials warned about fake election monitors at early-voting sites').debunk, false);
  assert.equal(k('Video of ballot burning is fake, officials say').debunk, true);
  assert.equal(k('Fake video claims to show ballots being destroyed').debunk, true);
});

test('a court follow-up to an old shooting is not a live shooting', () => {
  assert.ok(k('Charges dropped against man arrested in mass shooting at Ohio festival that wounded 12').sev <= 1);
});

test('a newsroom snippet saying "reports of" does not make the story a rumor', () => {
  const r = classify({ cls: 'wire', h: 'ICE activity is surging ahead of midterms. So is voter turnout.', x: 'There are reports of agents near polling places in several states.' });
  assert.ok(!r.cat.includes('rumor'));
  assert.ok(classify({ cls: 'social', h: 'ICE at the polls tomorrow', x: 'There are reports of agents near polling places.' }).cat.includes('rumor'));
  assert.ok(k('Rumors of martial law spread online ahead of the election').cat.includes('rumor'));
});

test('reprints of one wire story are one report, not corroboration', () => {
  const { Clusterer } = require('../tools/wire/lib/cluster');
  let now = Date.parse('2026-10-30T18:00:00Z');
  const c = new Clusterer({ now: () => now });
  const paper = (id, pub, h) => c.add({
    id, t: now, h, sn: pub, cls: 'aggregator', pub, u: 'https://' + pub + '/x', base: 1, fresh: true, firstPoll: false
  });
  const same = 'Three men who planned to bomb mosque jailed in Dublin';
  let r;
  for (const pub of ['kentonline.co.uk', 'eadt.co.uk', 'dorsetecho.co.uk', 'penarthtimes.co.uk', 'edp24.co.uk']) {
    now += 1000;
    r = paper(pub, pub, same);
  }
  assert.equal(r.cluster.st, 'reported', 'five copies of one headline is still one report');
  assert.equal(r.cluster.n, 5, 'the outlet count stays honest');
  now += 1000;
  r = paper('rte', 'rte.ie', 'Three men behind plot to bomb Galway mosque jailed in Dublin');
  assert.equal(r.isNew, false, 'the fixture must merge for this test to mean anything');
  assert.equal(r.cluster.st, 'corroborated', 'a newsroom writing its own headline is independent');
});

test('two papers running one sev 3 wire headline cannot page', () => {
  const { Clusterer } = require('../tools/wire/lib/cluster');
  const { blockReason } = require('../tools/wire/lib/alert');
  let now = Date.parse('2026-10-30T18:00:00Z');
  const c = new Clusterer({ now: () => now });
  const add = (id, pub, h) => c.add({
    id, t: now, h, sn: pub, cls: 'wire', pub, u: 'https://' + pub + '/x', base: 3, fresh: true, firstPoll: false
  });
  const ctx = { uptimeMs: 3600000, pagesLastHour: 0, pagesLastDay: 0 };
  add('a', 'one.example', 'President invokes Insurrection Act in Portland tonight');
  now += 1000;
  const r = add('b', 'two.example', 'President invokes Insurrection Act in Portland tonight');
  assert.equal(r.isNew, false);
  assert.notEqual(blockReason(r.cluster, ctx), null);
  now += 1000;
  const r2 = add('c', 'three.example', 'President invokes the Insurrection Act in Portland tonight, White House says');
  assert.equal(r2.isNew, false, 'the fixture must merge for this test to mean anything');
  assert.equal(blockReason(r2.cluster, ctx), null, 'independent wording clears the gate');
});

test('coup de is an idiom, coup d\'etat is not', () => {
  assert.equal(k('Holy shit COUP DE ROSE is publicly available in 9 HOURS', 'social').sev, 0);
  assert.ok(k("Army stages coup d'etat in the capital").cat.includes('unrest'));
});

// The collector crashed at its 460 MB heap limit after 2.5 hours on 2026-10-30. A kept guid or
// url was a V8 slice of the feed body, so each one held the whole body alive. Item counts
// stayed inside their caps the whole time, which is why only a heap measurement catches this.
function heapGrowth(run) {
  const v8 = require('node:v8');
  const vm = require('node:vm');
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const used = () => { gc(); gc(); return process.memoryUsage().heapUsed / 1048576; };
  const before = used();
  const kept = run();
  const grew = used() - before;
  assert.ok(kept.length > 0, 'the test must actually keep something');
  return grew;
}

test('keeping a parsed guid and url does not keep the feed body', () => {
  const src = { id: 't', name: 'T', cls: 'wire', kind: 'rss', url: 'https://example.com/f', every: 60 };
  const body = (i) => '<rss><channel>' +
    `<item><title>Headline ${i}</title><link>https://example.com/story/${i}</link><guid>guid-number-${i}-abcdefghijkl</guid>` +
    '<pubDate>Fri, 30 Oct 2026 12:00:00 GMT</pubDate></item>' +
    `<item><title>filler ${i}</title><guid>filler</guid></item>`.repeat(18000) + '</channel></rss>';
  const grew = heapGrowth(() => {
    const kept = [];
    for (let i = 0; i < 60; i++) {
      const [it] = parseBy('rss', body(i), src, { official: {} });
      kept.push(it.guid, it.u, it.h);
    }
    return kept;
  });
  assert.ok(grew < 15, `heap grew ${Math.round(grew)} MB across 60 one-megabyte polls`);
});

test('keeping a GDELT row does not keep the decompressed file', () => {
  const { rowsFrom } = require('../tools/wire/lib/gdelt');
  const row = (i) => {
    const c = new Array(27).fill('');
    c[0] = 'rec-' + i; c[1] = '20261030180000'; c[3] = 'example.com'; c[4] = 'https://example.com/a/' + i;
    c[26] = `<PAGE_TITLE>Protest number ${i} blocks the bridge downtown</PAGE_TITLE>`;
    return c.join('\t');
  };
  const grew = heapGrowth(() => {
    const kept = [];
    for (let f = 0; f < 12; f++) {
      const csv = row(f) + '\n' + 'x'.repeat(5 * 1048576) + f;
      kept.push(...rowsFrom(csv, () => true, false).raws);
    }
    return kept;
  });
  assert.ok(grew < 15, `heap grew ${Math.round(grew)} MB across 12 five-megabyte files`);
});

test('a witness post survives the social filter', () => {
  assert.equal(k('Protesters are blocking the bridge downtown right now', 'social').sev, 1);
});

test('a title that is only the publisher is dropped', () => {
  const xml = `<rss><channel>
    <item><title> - Reuters</title><link>https://news.google.com/rss/articles/a</link><guid>a</guid>
      <pubDate>Fri, 30 Oct 2026 17:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
    <item><title>Real headline here - Reuters</title><link>https://news.google.com/rss/articles/b</link><guid>b</guid>
      <pubDate>Fri, 30 Oct 2026 17:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
  </channel></rss>`;
  const src = { id: 'reuters', name: 'Reuters', cls: 'wire', kind: 'gnews', every: 90 };
  const heads = parseBy('gnews', xml, src, { official: {} }).map(i => i.h).filter(Boolean);
  assert.deepEqual(heads, ['Real headline here']);
});

test('identical social text reaches the feed once but still counts', () => {
  let now = Date.parse('2026-10-30T18:00:00Z');
  const published = [];
  const pipe = new Pipeline({
    store: new MemoryStore(), now: () => now,
    publisher: { publish: (i) => published.push(i), update() {} }
  });
  const raw = (n) => ({
    sid: 'bsky', sn: 'Bluesky', cls: 'social', guid: 'g' + n, u: 'https://bsky.app/profile/did:plc:' + n + '/post/1',
    h: 'I took action with No Kings. Will you join me? Martial law is what they want.', x: '', pt: now
  });
  for (let i = 0; i < 5; i++) { pipe.ingest(raw(i)); now += 1000; }
  assert.equal(published.length, 1);
  assert.equal(pipe.counters().dup, 4);
});
