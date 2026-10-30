// LIVE WIRE classifier tests. node --test tests/wire-classify.test.js
// The first table is spec section 4, pulled from live feeds on 2026-10-30. Those
// fixtures are the contract. The rest are the false positives most likely to page
// the owner over a chess club or a box-office flop, and the real headlines those
// same feeds carried that day.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const lib = path.join(__dirname, '..', 'tools', 'wire', 'lib', 'classify.js');
const { classify, prefilter, setCustomTerms, BUCKETS } = require(lib);

const c = (h, extra) => classify(Object.assign({ h, cls: 'wire' }, extra));

// ── Spec section 4 ────────────────────────────────────────────────────────────
test('fixture: routine meetings, date ranges and earnings are not nov4', () => {
  for (const h of [
    'Planning and Zoning Commission to meet Nov. 4',
    'Forum Flashbacks: Oct. 29-Nov. 4',
    'EMU is Motor City MACtion Ready for Nov. 4',
    'Amcor (AMCR) Could Be 9% Undervalued Ahead Of November 4 Earnings'
  ]) {
    const r = c(h);
    assert.ok(!r.w.includes('nov4'), h);
    assert.equal(r.sev, 0, h);
  }
});

test('fixture: an emergency exercise is a drill, whatever the word emergency suggests', () => {
  const r = c('Temple airport to host emergency response exercise Nov. 4');
  assert.equal(r.drill, true);
  assert.ok(!r.w.includes('nov4'));
  assert.equal(r.sev, 0);
});

test('fixture: the port strike deadline is nov4 + ports + labor', () => {
  const r = c('Strike deadline at LA-LB ports expected to be delayed to Nov. 4: PMA');
  assert.ok(r.w.includes('nov4'));
  assert.ok(r.w.includes('ports'));
  assert.ok(r.cat.includes('labor'));
  assert.ok(r.sev >= 1);
});

test('fixture: the Guard rescuing people and goats is not a deployment', () => {
  for (const h of [
    'Colorado National Guard has helped rescues 50 people and 20 pets amid flooding',
    'National Guard Saves Goats From Flood'
  ]) assert.ok(c(h).sev <= 1, h);
});

test('fixture: martial law somewhere else, or in the past, stays low and non-US', () => {
  for (const h of [
    'Zelensky Extends Martial Law and Mobilization Until 2027',
    'Court acquits ex-generals accused of planning martial law at burger joint'
  ]) {
    const r = c(h);
    assert.ok(r.sev <= 1, h);
    assert.equal(r.us, false, h);
  }
});

test('fixture: voter intimidation order is an election item of at least sev 1', () => {
  const r = c('ACLU seeks emergency order over alleged voter intimidation at Las Vegas rec center');
  assert.ok(r.cat.includes('election'));
  assert.ok(r.sev >= 1);
});

test('fixture: Trump invokes Insurrection Act is sev 3', () => {
  assert.equal(c('Trump invokes Insurrection Act').sev, 3);
});

test('fixture: a fact check is a debunk and an election item', () => {
  const r = c('Fact Check: Does a punched hole in a Ventura County ballot envelope prove election rigging?');
  assert.equal(r.debunk, true);
  assert.ok(r.cat.includes('election'));
});

// ── Sev 3 requires an asserted event ──────────────────────────────────────────
test('sev 3: the spec list, stated plainly', () => {
  for (const h of [
    'Trump declares martial law in Chicago',
    'Martial law declared in Portland, Oregon',
    'Trump declares national emergency over election',
    'Terror attack kills 30 at Times Square in New York',
    'Dozens killed in terrorist attack in Paris',
    'Nationwide blackout hits United States',
    'Nationwide power outage leaves Americans in the dark',
    'Nuclear detonation reported over Pacific',
    'Iran declares war on Israel',
    'Senator assassinated outside Capitol',
    'Gunman kills two at polling place in Atlanta',
    'CISA issues Emergency Directive on Ivanti flaw',
    'Magnitude 7.4 earthquake strikes Alaska',
    'Tsunami Warning issued for Hawaii',
    'Nuclear Power Plant Warning issued for Maricopa County',
    'DHS issues NTAS bulletin'
  ]) assert.equal(c(h).sev, 3, h);
});

test('sev 3 needs a finite verb: planning, could and to invoke are not events', () => {
  for (const [h, want] of [
    ['Trump could invoke Insurrection Act', 1],
    ['Trump considers invoking the Insurrection Act', 1],
    ['Trump declares martial law in Chicago, sources say he could', 2],
    ['What happens if Trump declares martial law?', 1],
    ['Will Trump invoke the Insurrection Act?', 1],
    ['Judge blocks Trump from invoking Insurrection Act', 1],
    ['Trump denies he will declare martial law', 1],
    ['Trump weighs national emergency over ballots', 1]
  ]) assert.ok(c(h).sev <= want, `${h} -> ${c(h).sev}`);
});

test('conditional language drops 3 to 2, exactly as the spec says', () => {
  assert.equal(c('Trump may have declared martial law in Chicago').sev, 2);
});

test('the same event abroad is serious but never the catastrophic tier', () => {
  assert.equal(c('Thailand declares martial law after coup').sev, 2);
  assert.equal(c('Cuba hit by nationwide blackout').sev, 2);
  assert.equal(c('Japan declares national emergency').sev, 2);
});

test('figurative wars and non-senior victims are not sev 3', () => {
  for (const h of [
    'Mayor declares war on potholes',
    'Trump declares war on inflation',
    'Mexico declares war on cartels',
    'Assassination attempt on governor foiled',
    'Trial opens for man accused of assassinating president'
  ]) assert.ok(c(h).sev < 3, h);
});

test('a tsunami warning that was cancelled is not a tsunami warning', () => {
  assert.ok(c('Tsunami warning cancelled after quake off Oregon').sev <= 1);
});

test('retrospective, opinion and explainer forms cap at 1', () => {
  for (const h of [
    'Man sentenced for attack on polling place in Georgia that killed two',
    'Ten years ago today: Trump declares national emergency',
    'Opinion: What if Trump invokes the Insurrection Act',
    'Explainer: Terror attack kills 30, what to know',
    'Podcast: Riots in Chicago',
    'Anniversary of the nationwide blackout in America'
  ]) assert.ok(c(h).sev <= 1, h);
});

test('a superlative about today is not a retrospective', () => {
  assert.equal(c('Terror attack kills 40 in deadliest strike in US history').sev, 3);
});

// ── Sev 2 ─────────────────────────────────────────────────────────────────────
test('sev 2: the spec list, stated plainly', () => {
  for (const h of [
    'Riots erupt in Minneapolis',
    'Curfew imposed in Portland after unrest',
    'National Guard deployed to Chicago',
    'Trump sends National Guard to Portland',
    'Bomb threats reported at polling places in Georgia',
    'Maricopa County election office evacuated',
    'Active shooter reported at mall in Omaha',
    'Substation attack leaves thousands without power',
    'Cyberattack hits Texas power grid operator',
    'Dockworkers go on strike at Port of Los Angeles',
    'Port strike begins at Los Angeles and Long Beach',
    'M 6.3 - 40 km E of Sendai, Japan',
    'Magnitude 6.1 earthquake rattles Peru',
    'Civil Danger Warning issued for Pima County',
    'Shelter In Place Warning for Kanawha County'
  ]) assert.equal(c(h).sev, 2, h);
});

test('a sev 2 rule facing a hypothetical comes down to 1', () => {
  for (const h of [
    'Officials fear riots could erupt after election',
    'Hackers could target election systems, FBI warns',
    'ILWU local threatens strike at LA-LB ports beginning Sunday',
    'ILWU Watchmen May Strike at LA/Long Beach, With Effects on Half the Port',
    'Shelter-in-place order lifted in Omaha'
  ]) assert.ok(c(h).sev <= 1, h);
});

test('an asserted deployment stays high when it is merely ahead of something', () => {
  assert.equal(c('National Guard deployed to Atlanta ahead of election').sev, 2);
});

test('teen curfews and Guard parades do not read as civil disorder', () => {
  assert.equal(c('City council approves teen curfew at Tulsa mall').sev, 0);
  assert.ok(c('National Guard band to march in homecoming parade').sev <= 1);
});

// ── False friends ─────────────────────────────────────────────────────────────
test('strike in sports, weather and business is not a strike', () => {
  for (const h of [
    'Lightning strike sparks house fire in Tulsa',
    'Yankees ace strikes out 12 in playoff win',
    'Bowler rolls perfect strike in league final',
    'Automakers strike a deal on battery supply',
    'Tesla strike price rises as options traders pile in'
  ]) {
    const r = c(h);
    assert.ok(r.sev === 0, `${h} -> ${r.sev}`);
    assert.ok(!r.cat.includes('labor'), h);
    assert.ok(!r.cat.includes('military'), h);
  }
});

test('attack in the kitchen, the clinic and the arena is not an attack', () => {
  for (const h of [
    'How to attack a whole chicken like a pro chef',
    'Man survives heart attack at gym',
    'Lakers attack the rim in comeback win',
    'Shark attack closes beach in Maui',
    'Five tips for coping with panic attacks'
  ]) {
    const r = c(h);
    assert.equal(r.sev, 0, h);
    assert.ok(!r.cat.includes('security'), h);
  }
});

test('Riot Games is not a riot', () => {
  for (const h of ['Riot Games announces new League of Legends season', 'Riot Games lays off 30 staff', 'Pussy Riot member speaks in Berlin']) {
    assert.equal(c(h).sev, 0, h);
    assert.ok(!c(h).cat.includes('unrest'), h);
  }
});

test('nuclear family, nuclear option and nuclear power are not detonations', () => {
  for (const h of [
    'The slow decline of the nuclear family',
    'Senate Republicans weigh the nuclear option',
    'Georgia nuclear plant adds third reactor'
  ]) assert.ok(c(h).sev <= 1 && !c(h).cat.includes('security'), h);
});

test('an election at the Rotary Club is not an election', () => {
  for (const h of [
    'Rotary Club election: Jane Smith named president',
    'Chess club holds election for new president',
    'Yacht club announces election of officers',
    'Student council election results are in'
  ]) assert.ok(!c(h).cat.includes('election'), h);
});

test('bomb as slang is not a bomb', () => {
  for (const h of [
    'New superhero movie is a box-office bomb',
    'Best bath bomb gifts for the holidays',
    'Mahomes drops a bomb to Kelce in overtime',
    'Bomb cyclone to bring heavy snow to Maine',
    'Senator drops an f-bomb on live TV'
  ]) {
    const r = c(h);
    assert.ok(r.sev === 0, `${h} -> ${r.sev}`);
    assert.ok(!r.cat.includes('security'), h);
  }
});

test('Cyber Monday, martial arts, marching bands and blackout curtains stay quiet', () => {
  for (const h of [
    'Cyber Monday deals start early this year',
    'Martial arts tournament comes to Reno',
    'High school marching band wins state title',
    'Best blackout curtains for shift workers',
    'Civil War reenactment draws crowds in Gettysburg'
  ]) assert.equal(c(h).sev, 0, h);
});

test('sports cap: a game is 0, but a shooting at the game is not a game', () => {
  assert.equal(c('Bears defense shoots down Packers in NFL rivalry').sev, 0);
  assert.equal(c('Active shooter at NFL stadium in Kansas City').sev, 2);
});

test('threat actors are a cyber story, not a casting call', () => {
  const r = c('Threat actors breach election office ransomware attack');
  assert.ok(r.cat.includes('cyber'));
  assert.ok(r.sev >= 1);
});

test('voters exercising a right is not a drill, a drill is', () => {
  assert.equal(c('Voters exercise their right at polling place').drill, false);
  assert.equal(c('Police exercise restraint at protest').drill, false);
  assert.equal(c('Drill, baby, drill: oil output climbs').drill, false);
  assert.equal(c('School holds lockdown drill Monday').drill, true);
  assert.equal(c('Emergency alert test scheduled for Wednesday').drill, true);
  assert.equal(c('Active shooter drill at Temple hospital').sev, 0);
  assert.equal(c('Mass casualty exercise simulates terror attack killing 30').sev, 0);
});

// ── Nov. 4 ────────────────────────────────────────────────────────────────────
test('nov4: every date form in the spec', () => {
  for (const h of [
    'Rally planned Nov 4 in Chicago', 'Rally planned Nov. 4 in Chicago', 'Rally planned November 4 in Chicago',
    'Rally planned November 4th in Chicago', 'Rally planned on the 4th of November', 'Rally planned 4 November in Chicago',
    'Rally planned 11/4 in Chicago', 'Everyone get ready #nov4', 'Everyone get ready #november4'
  ]) assert.ok(c(h).w.includes('nov4'), h);
});

test('nov4: other dates are not Nov. 4', () => {
  for (const h of [
    'Nov. 14 hearing set', 'November 40 percent', 'The vote on 11/14', 'Score was 11/42',
    'Nov. 4, 2024 flood remembered', 'Riots on 11/4/2022 recalled', 'Odds were 2/11/4'
  ]) assert.ok(!c(h).w.includes('nov4'), h);
});

test('nov4: a date range is noise even if the range is in a sentence', () => {
  for (const h of ['Exhibit runs Nov. 4-7 downtown', 'Forum Flashbacks: Oct. 29-Nov. 4', 'Library hours Nov. 1 through Nov. 4']) {
    assert.ok(!c(h).w.includes('nov4'), h);
  }
});

test('nov4: routine terms lose to a strong signal', () => {
  assert.ok(!c('City council to meet Nov. 4').w.includes('nov4'));
  assert.ok(c('Bomb threat forces city council to cancel Nov. 4 meeting').w.includes('nov4'));
  assert.ok(c('Protest planned outside Nov. 4 board meeting').w.includes('nov4'));
});

test('nov4: the snippet counts, and any hit is at least notable', () => {
  const r = classify({ h: 'Union leaders say talks collapsed', x: 'Walkout now set for Nov. 4.', cls: 'wire' });
  assert.ok(r.w.includes('nov4'));
  assert.ok(r.sev >= 1);
});

test('severity never comes from the snippet', () => {
  const r = classify({ h: 'Bake sale raises record funds', x: 'Last year, Trump invokes Insurrection Act.', cls: 'wire' });
  assert.equal(r.sev, 0);
});

// ── Rumor and debunk ──────────────────────────────────────────────────────────
test('rumor language needs context, and a rumor is at least notable', () => {
  for (const h of [
    'Hearing that the National Guard is rolling into Philly tonight',
    'Unconfirmed reports of ballots burned in Detroit',
    'They dont want you to know: something big is coming to the election',
    'Stock up now, banks are going to close',
    'false flag at the polls, be careful'
  ]) {
    const r = c(h, { cls: 'social' });
    assert.ok(r.rumor, h);
    assert.ok(r.cat.includes('rumor'), h);
    assert.ok(r.sev >= 1, h);
  }
  assert.equal(c('Trade rumors swirl around Lakers star').rumor, false);
  assert.equal(c('Be prepared for delays on I-95').rumor, false);
});

test('debunk phrases mark the claim as false and stop it asserting anything', () => {
  for (const h of [
    'No evidence martial law was declared in Chicago',
    'Viral claim that Trump invoked Insurrection Act is false',
    'Debunked: Trump declares martial law',
    'Hoax bomb threats emailed to polling places'
  ]) {
    const r = c(h);
    assert.equal(r.debunk, true, h);
    assert.ok(r.sev <= 1, h);
  }
  assert.equal(c('Anything at all', { cls: 'factcheck' }).debunk, true);
});

// ── Parsers that know better ──────────────────────────────────────────────────
test('a parser-supplied severity is believed and its categories are kept', () => {
  const r = classify({ h: 'Tornado Warning issued for Lubbock County', cls: 'official', cat0: ['disaster'], sev0: 2 });
  assert.equal(r.sev, 2);
  assert.ok(r.cat.includes('disaster'));
});

test('a parser cannot lift a stated drill', () => {
  assert.equal(classify({ h: 'Emergency alert test for Fairfax County', cls: 'official', sev0: 3 }).sev, 0);
});

test('parser geo decides the country when the text cannot', () => {
  assert.equal(classify({ h: 'Martial law declared', cls: 'wire', geo: { cc: 'TH' } }).sev, 2);
  assert.equal(classify({ h: 'Martial law declared', cls: 'wire', geo: { cc: 'US' } }).sev, 3);
});

test('us is false without positive evidence and true with it', () => {
  assert.equal(c('Martial law declared').us, false);
  assert.equal(c('Riots in Ohio').us, true);
  assert.equal(c('FBI warns of threats').us, true);
  assert.equal(c('Tell us what you think').us, false);
});

// ── Real headlines from the same-day samples ──────────────────────────────────
test('real headlines from 2026-10-30 land where a human would put them', () => {
  const quiet = [
    'US tech stocks see sharp falls over AI cost fears',
    "Sir Ian McKellen leads tributes to 'beloved actor' Sir Patrick Stewart after his death at 86",
    'Pope Leo XIV becomes first pontiff to vote in a US election',
    'More than 43 million ballots cast so far in midterms early voting surge',
    'Three dead after two helicopters collide midair near Oregon airport',
    'Why Jalen Hurts played with blood clot and what it means for NFL',
    'EWR (Newark) on 2026-11-04',
    'konyaspor - galatasaray'
  ];
  for (const h of quiet) assert.equal(c(h).sev, 0, h);

  assert.ok(c("Trump says US voter fraud is 'rampant' - evidence suggests it is extremely rare").sev >= 1);
  assert.ok(c('Strike Threat Looms at Eight Los Angeles, Long Beach Port Terminals').w.includes('ports'));
  assert.ok(c('Greece Port Strike').cat.includes('labor'));
  assert.equal(c('Dockworkers worldwide strike against arms shipments').w.includes('ports'), true);
});

// ── Firehose and custom terms ─────────────────────────────────────────────────
test('prefilter passes what matters and drops ordinary posts', () => {
  for (const t of ['national guard in my town', 'Something big is coming', 'the polling place is on fire', 'Nov 4', 'ILWU picket', 'BOMB THREAT', 'it’s happening']) {
    assert.ok(prefilter(t), t);
  }
  for (const t of ['good morning everyone', 'my cat is asleep', 'おま国からお前に', '']) {
    assert.ok(!prefilter(t), t);
  }
  assert.equal(prefilter(null), false);
});

test('custom terms extend classify and prefilter at once, literally, with word boundaries', () => {
  try {
    assert.equal(prefilter('dryden county is quiet'), false);
    const inForce = setCustomTerms(['Dryden County', 'a.b', '(x+)+$', 'C++']);
    assert.deepEqual(inForce, ['Dryden County', 'a.b', '(x+)+$', 'C++']);

    assert.equal(prefilter('dryden county is quiet'), true);
    const r = c('Quiet day in dryden   county');
    assert.ok(r.w.includes('custom:Dryden County'), 'match is case and whitespace tolerant');
    assert.ok(!c('Quiet day in drydencounty').w.length, 'word boundaries hold');

    assert.ok(!c('axb is not a dot').w.length, 'a term is literal, not a regex');
    assert.ok(c('Learning C++ today').w.includes('custom:C++'));

    setCustomTerms([]);
    assert.equal(prefilter('dryden county is quiet'), false);
    assert.equal(c('Quiet day in Dryden County').w.length, 0);
  } finally {
    setCustomTerms([]);
  }
});

test('custom terms are validated the way the function validates them', () => {
  try {
    const long = 'x'.repeat(65);
    assert.deepEqual(setCustomTerms(['a', long, 42, null, '  ok  ', 'OK', 'bad\u0007term']), ['ok', 'bad term']);
    assert.equal(setCustomTerms(Array.from({ length: 60 }, (_, i) => 'term ' + i)).length, 40);
    assert.deepEqual(setCustomTerms('not a list'), []);
  } finally {
    setCustomTerms([]);
  }
});

// ── Limits ────────────────────────────────────────────────────────────────────
test('hostile input: oversized and nasty strings return quickly and never throw', () => {
  const t0 = Date.now();
  classify({ h: 'a'.repeat(1e6), x: '('.repeat(1e6), cls: 'social' });
  classify({ h: 'nov '.repeat(5000), x: 'attack on the '.repeat(5000), cls: 'social' });
  classify({ h: null, x: undefined });
  classify(null);
  prefilter('z'.repeat(1e6));
  assert.ok(Date.now() - t0 < 500, 'took ' + (Date.now() - t0) + ' ms');
});

test('throughput comfortably clears the 50 posts a second the firehose needs', () => {
  const lines = [
    'Protesters gather outside polling place in Maricopa County as National Guard deployed to Phoenix',
    'Good morning everyone, what a day',
    'Hearing that something big is coming Nov 4, stock up',
    'Lakers attack the rim in comeback win'
  ];
  const n = 4000;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) {
    const h = lines[i % lines.length];
    if (prefilter(h)) classify({ h, cls: 'social' });
  }
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  const rate = n / secs;
  assert.ok(rate > 1000, Math.round(rate) + ' posts/s');
});

test('every bucket is either a category or a named watch', () => {
  assert.deepEqual(BUCKETS, ['nov4', 'election', 'unrest', 'security', 'infra', 'cyber', 'military', 'rumor', 'ports']);
});
