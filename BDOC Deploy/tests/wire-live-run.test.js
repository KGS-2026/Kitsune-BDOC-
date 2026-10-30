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
