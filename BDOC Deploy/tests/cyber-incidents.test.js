// Cyber layer (p182): reported cyber incidents, placed where they happened.
//
// The headlines below are real ones the live collector saw on 2026-11-09 (or close copies of
// them), chosen for the mistakes the place finder made on the way: Maine-et-Loire is not Maine,
// Perry Johnson is not Perry, NY, "Iran-linked group" is the attacker and not the place,
// Arkansas City is in Kansas, Washington Post is not Washington state.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'netlify', 'functions');
const lib = require(path.join(FN, '_lib', 'cyber-incidents.js'));
const fn = require(path.join(FN, 'cyber-incidents.js'));

const NOW = Date.parse('2026-11-09T15:00:00Z');
const DAY = 86400e3;
const where = (title, summary = '') => {
  const p = lib.locate(title, summary);
  return p ? p.level + ':' + p.name + (p.state ? ',' + p.state : '') + ':' + p.cc : null;
};
const item = (title, o = {}) => ({
  title, link: o.link || 'https://example.org/' + encodeURIComponent(title).slice(0, 40), summary: o.summary || '',
  published: o.published || NOW - DAY, source: o.source || 'Outlet', feed: 'test', lang: o.lang || 'en'
});

// ── where it happened ────────────────────────────────────────
test('water systems are placed at the town, county or state the headline names', () => {
  assert.equal(where('Coordinated cyberattack disrupts water utilities in 30+ Minnesota communities'), 'state:Minnesota,MN:US');
  assert.equal(where('Hackers hit Municipal Water Authority of Aliquippa, Pa.'), 'city:Aliquippa,PA:US');
  assert.equal(where('Arkansas City, Kansas water treatment facility hit by cyberattack'), 'city:Arkansas City,KS:US', 'Arkansas City is in Kansas');
  assert.equal(where('Ransomware attack shuts Clayton County Water Authority billing in Georgia'), 'county:Clayton County,GA:US');
  assert.equal(where('Iran-linked group claims it hacked CA water utility serving the Central Valley'), 'state:California,CA:US', 'CA before a noun is California');
  assert.equal(where('Russian group hacked Quebec water treatment plant, gained access to control pumps and chlorine dosing: CSE'), 'country:Canada:CA');
});

test('the same county name in two states goes to the state the headline names', () => {
  assert.equal(where('Seminole County schools in Georgia shut systems after cyber incident'), 'county:Seminole County,GA:US');
  assert.equal(where('Seminole County Clerk closes Florida offices amid reported cyberattack'), 'county:Seminole County,FL:US');
  assert.equal(where('Spokane, Wash., schools hit by ransomware'), 'city:Spokane,WA:US');
});

test('France: blood plasma freezers and supermarkets are placed in France, not at a guessed town', () => {
  assert.equal(where('Hackers Hijacked French Blood Plasma Freezers, Changing Temperature Settings From −30°C to 110°C'), 'country:France:FR');
  assert.equal(where('Hackers turn up the heat in refrigerators at hundreds of supermarkets in France, sparking fires and food losses'), 'country:France:FR');
  assert.equal(where('Cyberattaque dans une pharmacie à Strasbourg : les données de santé de milliers de patients ont fuité'), 'city:Strasbourg:FR');
});

test('names that only look like places are not placed there', () => {
  assert.equal(where('Cyberattaque : le département de Maine-et-Loire visé'), null, 'Maine-et-Loire is not Maine');
  assert.equal(where('Perry Johnson & Associates breach exposes 9 million patients'), null, 'Perry Johnson is a company, not Perry, NY');
  assert.equal(where('Washington Post hit by cyberattack'), null, 'Washington alone is not Washington state');
});

test('the attacker\'s country is never the place', () => {
  assert.equal(where('North Korean hackers steal $40 million from Japanese exchange'), 'country:Japan:JP');
  assert.equal(where('Chinese hackers breach Texas county network'), 'state:Texas,TX:US');
  assert.equal(where('Italy’s Meloni blames pro-Russian hackers for leak of foreign minister’s data'), 'country:Italy:IT');
  assert.equal(where('Iranian hackers claim attack'), null, 'only the attacker is named, so no place');
});

// ── is it an incident, and which sector ──────────────────────
test('sectors: water, health (blood banks too), food, government, education', () => {
  assert.equal(lib.sectorOf('Coordinated cyberattack disrupts water utilities in 30+ Minnesota communities', ''), 'water');
  assert.equal(lib.sectorOf('French blood bank hit by hackers', ''), 'health', 'a blood bank is health, not finance');
  assert.equal(lib.sectorOf('Hackers disrupt refrigeration systems at European supermarkets', ''), 'food');
  assert.equal(lib.sectorOf('Seminole County Clerk closes Florida offices amid reported cyberattack', ''), 'government');
  assert.equal(lib.sectorOf('Cyberattack forces Jerome School District to cancel classes', ''), 'education');
  assert.equal(lib.sectorOf('Hackers strike', 'The wastewater plant was offline'), 'water', 'falls back to the summary');
});

test('drills, warnings, explainers, questions, advice and settlements are not incidents', () => {
  for (const h of [
    'Cyber drill simulates attack on county water system',
    'Water utilities warned to boost cyber defenses after Iranian attacks',
    'How did hackers get into the water plant?',
    'Hackers are turning up Europe’s freezers. Vermont businesses should check theirs.',
    'State attorneys general secure up to $10 million and corrective action plan from Perry Johnson companies after 2023 breach',
    'Microsoft patches zero-day exploited by ransomware gangs',
    'Man pleads guilty to hacking school district'
  ]) assert.equal(lib.isIncident(h), false, h);
  assert.equal(lib.isIncident('Winona County says it paid $128K after January ransomware attack'), true);
});

// ── one event, many headlines ────────────────────────────────
test('build: many outlets on one event become one incident with every source', () => {
  const out = lib.build([
    item('Hackers Hijacked French Blood Plasma Freezers, Changing Temperature Settings', { source: 'The Record', published: NOW - 3 * DAY }),
    item('French blood plasma freezers hacked, temperature set to 110C', { source: 'BleepingComputer', published: NOW - 2.5 * DAY }),
    item('Hackers set French blood plasma freezers to boiling point', { source: 'SecurityWeek', published: NOW - 2 * DAY }),
    item('Coordinated cyberattack disrupts water utilities in 30+ Minnesota communities', { published: NOW - 1 * DAY })
  ], NOW);
  assert.equal(out.length, 2);
  const blood = out.find(x => x.sector === 'health');
  assert.equal(blood.reports, 3);
  assert.deepEqual(blood.sources.map(s => s.name), ['The Record', 'BleepingComputer', 'SecurityWeek']);
  assert.equal(blood.published, new Date(NOW - 3 * DAY).toISOString(), 'first report');
  assert.equal(blood.latest, new Date(NOW - 2 * DAY).toISOString(), 'latest report');
  assert.equal(blood.place.cc, 'FR');
  assert.equal(out[0].sector, 'water', 'newest first');
});

test('build: different places do not merge even with similar words', () => {
  const out = lib.build([
    item('Ransomware attack hits Seminole County, Florida'),
    item('Ransomware attack hits Seminole County, Georgia')
  ], NOW);
  assert.equal(out.length, 2);
});

test('build: water stays for a year, other sectors for a month; non-incidents and future dates drop', () => {
  const out = lib.build([
    item('Hackers hit Municipal Water Authority of Aliquippa, Pa.', { published: NOW - 300 * DAY }),
    item('Ransomware attack hits Ohio hospital', { published: NOW - 60 * DAY }),
    item('Cyber drill simulates attack on county water system'),
    item('Ransomware hits Ohio clinic', { published: NOW + 5 * DAY })
  ], NOW);
  assert.deepEqual(out.map(x => x.title), ['Hackers hit Municipal Water Authority of Aliquippa, Pa.']);
});

test('build: a breach notice counts when its first lines name the attack', () => {
  const out = lib.build([
    item('Hospital notifies patients of data security incident', { summary: 'A ransomware attack in September encrypted systems at the Ohio hospital.' }),
    item('Hospital notifies patients of new parking rules', { summary: 'Hackers are not involved.' })
  ], NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].sector, 'health');
});

// ── feeds ────────────────────────────────────────────────────
const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Hackers hit Municipal Water Authority of Aliquippa, Pa. &amp; others]]></title>
<link>https://therecord.media/aliquippa</link><pubDate>Mon, 09 Nov 2026 12:00:00 GMT</pubDate>
<description><![CDATA[<p>The attack on the <b>booster station</b>&nbsp;was claimed by an Iran-linked group.</p>]]></description></item>
<item><title>No link</title><link>javascript:alert(1)</link><pubDate>Mon, 09 Nov 2026 12:00:00 GMT</pubDate></item>
<item><title>No date</title><link>https://x.example/a</link></item>
</channel></rss>`;
const GOOGLE = `<rss><channel><item><title>Seminole County schools in Georgia shut systems after cyber incident - WALB</title>
<link>https://news.google.com/rss/articles/abc</link><pubDate>Sun, 08 Nov 2026 22:00:00 GMT</pubDate>
<description>&lt;a href="x"&gt;long google blurb&lt;/a&gt;</description><source url="https://www.walb.com">WALB</source></item></channel></rss>`;
const ATOM = `<feed><entry><title>Cyberattaque contre une mairie</title><link rel="alternate" href="https://www.zataz.com/mairie"/>
<published>2026-11-07T08:00:00Z</published><summary>La commune a été visée.</summary></entry></feed>`;

test('parseFeed: RSS with CDATA and entities, Google News outlet suffix, Atom links; bad links and dates skipped', () => {
  const r = lib.parseFeed(RSS, { id: 'therecord', name: 'The Record' });
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Hackers hit Municipal Water Authority of Aliquippa, Pa. & others');
  assert.equal(r[0].summary, 'The attack on the booster station was claimed by an Iran-linked group.');
  assert.equal(r[0].source, 'The Record');
  assert.equal(r[0].published, Date.parse('2026-11-09T12:00:00Z'));

  const g = lib.parseFeed(GOOGLE, { id: 'gn-local', name: 'Google News', google: true });
  assert.equal(g[0].title, 'Seminole County schools in Georgia shut systems after cyber incident');
  assert.equal(g[0].source, 'WALB', 'the outlet, not "Google News"');
  assert.equal(g[0].summary, '', 'Google blurbs are dropped');

  const a = lib.parseFeed(ATOM, { id: 'zataz', name: 'ZATAZ', lang: 'fr' });
  assert.equal(a[0].link, 'https://www.zataz.com/mairie');
  assert.equal(a[0].lang, 'fr');
});

test('advisories: CISA titles newest first, capped', () => {
  const xml = '<rss><channel>' + [1, 3, 2].map(d => `<item><title>CISA Releases Advisory ${d}</title><link>https://www.cisa.gov/a${d}</link><pubDate>${new Date(Date.UTC(2026, 10, d)).toUTCString()}</pubDate></item>`).join('') + '</channel></rss>';
  const out = lib.advisories(xml, 2);
  assert.deepEqual(out.map(a => a.title), ['CISA Releases Advisory 3', 'CISA Releases Advisory 2']);
});

// ── the function ─────────────────────────────────────────────
function fakeFetch(map) {
  return async (url) => {
    for (const [k, v] of Object.entries(map)) {
      if (url.includes(k)) return v instanceof Error ? Promise.reject(v) : { ok: true, status: 200, text: async () => v };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
}

test('collect: one feed down is reported by name and the rest still map', async () => {
  const feeds = [{ id: 'a', name: 'A', url: 'https://a.example/feed' }, { id: 'b', name: 'B', url: 'https://b.example/feed' }, { id: 'g', name: 'Google News', google: true, url: 'https://news.google.com/x' }];
  const out = await fn.collect({ now: NOW, feeds, fetchImpl: fakeFetch({ 'a.example': RSS, 'b.example': new Error('timeout'), 'news.google.com': GOOGLE, 'cisa.gov': '<rss></rss>' }) });
  assert.equal(out.ok, true);
  assert.equal(out.feeds.a, 'ok');
  assert.equal(out.feeds.b, 'timeout');
  assert.equal(out.feeds.cisa, 'ok');
  assert.deepEqual(out.incidents.map(x => x.place && x.place.name).sort(), ['Aliquippa', 'Seminole County']);
});

test('handler: GET only; all feeds down answers 502 with a short cache and no incidents', async () => {
  const r405 = await fn.handler({ httpMethod: 'POST' });
  assert.equal(r405.statusCode, 405);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const r = await fn.handler({ httpMethod: 'GET' });
    assert.equal(r.statusCode, 502);
    assert.match(r.headers['Netlify-CDN-Cache-Control'], /s-maxage=60/);
    const body = JSON.parse(r.body);
    assert.equal(body.ok, false);
    assert.deepEqual(body.incidents, []);
  } finally { globalThis.fetch = realFetch; }
});

test('every feed is keyless https', () => {
  for (const f of fn.FEEDS) assert.match(f.url, /^https:\/\/[^?]*(\?q=|$|\/)/, f.id);
  assert.ok(fn.FEEDS.length >= 12);
});

// ── the page ─────────────────────────────────────────────────
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
const CLIENT = fs.readFileSync(path.join(ROOT, 'js', 'bdoc-cyber-map.js'), 'utf8');

test('the made-up hotspots, random counts and random arcs are gone', () => {
  for (const gone of ["'US East Coast'", "'US West Coast'", 'SIMULATED', 'updateCyberHUD', 'Math.random()*5000', 'ATTACKS/HR', "'Threat level: ELEVATED"])
    assert.ok(!HTML.includes(gone), gone + ' still in index.html');
  assert.ok(!/Math\.random/.test(CLIENT), 'the client never invents data');
  assert.match(HTML, /<span class="ly-n">Cyber Incidents<\/span>/);
  assert.match(HTML, /<script src="js\/bdoc-cyber-map\.js\?v=p182"><\/script>/);
  assert.match(HTML, /BDOCCyberMap\.load\(V,cyberEnts,\(\)=>layers\.cyber\)/);
});

test('service worker v185 precaches the cyber map client; the desktop server runs the function', () => {
  assert.match(SW, /const SW_VERSION = 'bdoc-v185';/);
  assert.match(SW, /\(prev\) const SW_VERSION = 'bdoc-v184';/);
  assert.ok(SW.includes("'/js/bdoc-cyber-map.js?v=p182'"));
  const srv = fs.readFileSync(path.join(ROOT, 'electron', 'server.js'), 'utf8');
  assert.match(srv, /'gov-alert', 'cyber-incidents'\]/);
});

// The client runs in a stub page: feed text with markup must come out escaped in the info box
// and as plain text in the panel, and links must be http(s).
function runClient(payload) {
  const made = [];
  const node = () => {
    const n = { style: {}, children: [], textContent: '', listeners: {}, set innerHTML(v) { throw new Error('innerHTML used in panel'); } };
    n.appendChild = (c) => { n.children.push(c); return c; };
    n.addEventListener = (t, f) => { n.listeners[t] = f; };
    return n;
  };
  const hud = node();
  const ctx = {
    console, setTimeout: () => 1, clearTimeout: () => {}, Date, JSON, Math,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: (id) => (id === 'cyberHud' ? hud : null), createElement: () => node() },
    fetch: async () => ({ ok: true, json: async () => payload }),
    Cesium: {
      Cartesian3: { fromDegrees: (x, y, z) => ({ x, y, z }) }, Cartesian2: function (x, y) { this.x = x; this.y = y; },
      Color: { fromCssColorString: () => ({ withAlpha: () => ({}) }), BLACK: { withAlpha: () => ({}) } },
      LabelStyle: { FILL_AND_OUTLINE: 2 }, DistanceDisplayCondition: function () {}
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CLIENT, ctx);
  const viewer = { entities: { add: (o) => { made.push(o); return o; }, remove: () => {} }, camera: { flyTo: () => {} } };
  const ents = [];
  return ctx.BDOCCyberMap.load(viewer, ents).then((placed) => ({ placed, made, hud, ents, api: ctx.BDOCCyberMap }));
}
const allText = (n) => (n.textContent || '') + n.children.map(allText).join('');

test('client: pins per place, escaped info box, plain-text panel, javascript: links dropped', async () => {
  const t = new Date(NOW).toISOString();
  const evil = '<img src=x onerror=alert(1)> Ransomware hits water plant';
  const payload = {
    ok: true, checked: t, advisories: [{ title: 'CISA <b>advisory</b>', link: 'javascript:alert(1)', published: t }],
    incidents: [
      { id: 'a', title: evil, link: 'javascript:alert(2)', source: 'X', sources: [{ name: '<script>', link: 'https://ok.example/a' }], reports: 1, published: t, latest: t, sector: 'water',
        place: { level: 'city', name: 'Aliquippa', state: 'PA', cc: 'US', lat: 40.6, lon: -80.2 } },
      { id: 'b', title: 'Second Aliquippa report', link: 'https://ok.example/b', source: 'Y', sources: [], reports: 2, published: t, latest: t, sector: 'water',
        place: { level: 'city', name: 'Aliquippa', state: 'PA', cc: 'US', lat: 40.6, lon: -80.2 } },
      { id: 'c', title: 'Unplaced report', link: 'https://ok.example/c', source: 'Z', sources: [], reports: 1, published: t, latest: t, sector: 'other', place: null },
      { id: 'd', title: 'Mapping attacks on U.S. water systems', link: 'https://ok.example/d', source: 'Z', sources: [], reports: 1, published: t, latest: t, sector: 'water',
        place: { level: 'country', name: 'United States', state: '', cc: 'US', lat: 39.8, lon: -98.6 } }
    ]
  };
  const r = await runClient(payload);
  assert.equal(r.made.length, 1, 'two incidents at one place make one pin; "United States" alone gets no pin in Kansas');
  assert.equal(r.placed, 2);
  assert.ok(allText(r.hud).includes('United States (no state named)'));
  assert.ok(allText(r.hud).includes('1 that name no state'));
  const d = r.made[0].description;
  assert.ok(!d.includes('<img') && !d.includes('<script>'), 'markup from feeds is escaped');
  assert.ok(d.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!/href="javascript:/i.test(d), 'javascript: links are not linked');
  assert.ok(d.includes('href="https://ok.example/a"'));
  const text = allText(r.hud);
  assert.ok(text.includes('WATER SYSTEMS HIT'));
  assert.ok(text.includes('PA 2'), 'water tally by state');
  assert.ok(text.includes(evil), 'panel shows the title as text');
  assert.ok(text.includes('Unplaced report') && text.includes('place not named'));
  assert.equal(r.api.recent('water', 24).length, 3, 'recent() counts every water report, pinned or not');
});

test('client: feed down shows a plain message and draws nothing', async () => {
  const r = await runClient({ ok: false, error: 'all feeds down', incidents: [], advisories: [] });
  assert.equal(r.made.length, 0);
  assert.match(allText(r.hud), /unavailable/);
});
