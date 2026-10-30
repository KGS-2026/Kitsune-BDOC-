#!/usr/bin/env node
// ============================================================
// tools/wire/dev-server.js — local harness for the LIVE WIRE UI
// ============================================================
// WHY THIS EXISTS
// The wire is owner-only behind Supabase, a Netlify function and a daemon on the
// droplet. Nobody should need all three to look at a row height. This serves the
// repo folder and fakes everything behind the UI, with zero dependencies:
//
//   node tools/wire/dev-server.js          then open http://localhost:9091/__wire/
//
// HOW THE FAKE GETS IN WITHOUT A BACK DOOR
// js/bdoc-wire.js has no test hook, on purpose. When this server sends wire.html it
// swaps the Supabase CDN tag for /__wire/shim.js, which defines a fake window.supabase
// (auth plus a Realtime channel backed by Server-Sent Events). Production never has
// that script, so there is nothing to switch on. This server binds 127.0.0.1 only
// and refuses any other Host header. netlify.toml 404s /tools/*, so none of this ships.
//
// ?mode= on the page URL picks a state. The shim turns it into the fake access token,
// and the mock function reads the token back, so every state goes through the same
// fetch path production uses. ?mode= on the function URL works too, for curl.
//
//   live       collector healthy, items and status upgrades arriving
//   offline    no heartbeats, newest snapshot 25 min old
//   nonowner   signed in, function answers 403
//   signedout  no session. Any email and password work. Password "mfa" walks the TOTP
//              step (code 123456), password "fail" shows a Supabase-style error.
//   degraded   socket refuses to join, snapshots fresh, so polling
//   dying      30 s of heartbeats, then the collector stops
//   expire     session lapses 25 s after load (401 mid-watch)
//   503        function fails closed
//   netdown    function connection is destroyed (fetch throws)
//   empty      snapshot with 0 items
//   nosnap     function has no snapshot stored
//   stale      heartbeats arrive, snapshot is 11 min old
//   sockflap   socket drops every 20 s and has to reconnect
//
// EVERY HEADLINE HERE IS FICTIONAL TEST DATA unless it is one of the classifier fixture
// lines quoted in docs/LIVE-WIRE-SPEC.md §4. The shim pins a DEV FIXTURE tag on the page
// so a screenshot from this harness cannot be mistaken for the live wire.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 9091;
const HOST = '127.0.0.1';
const ROOT = path.resolve(__dirname, '..', '..');
const TOPIC = 'dev-wire-topic-not-a-secret';
const MIN = 60000;
const MODES = ['live', 'offline', 'nonowner', 'signedout', 'degraded', 'dying', 'expire', '503', 'netdown', 'empty', 'nosnap', 'stale', 'sockflap'];
const SUPABASE_TAG = /<script[^>]*supabase-js[^>]*><\/script>/;

const hex = seed => crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 16);

// ── Fixture ──

function item(seed, ageMin, over) {
  const t = over.now - ageMin * MIN;
  const id = hex(seed);
  const base = {
    id, c: id, t, pt: t - 90000, src: 'bbc-us', sn: 'BBC', cls: 'wire', h: '', x: '',
    u: 'https://example.com/story/' + id, cat: [], w: [], sev: 0, st: 'reported', n: 1, fresh: true
  };
  const out = Object.assign(base, over);
  delete out.now;
  return out;
}

// One of each thing the UI must handle, in a realistic mix, newest first after sorting.
function fixtureItems(now) {
  const n = { now };
  const a = hex('story-ports');
  const b = hex('story-bomb');
  const c = hex('story-substation');
  const list = [
    // official
    item('nws-civil', 2, { ...n, src: 'nws', sn: 'NWS', cls: 'official', st: 'official', sev: 2, cat: ['security'],
      h: 'Civil Danger Warning for Clark County, NV: police report a hazardous materials release near Henderson',
      x: 'Shelter in place until further notice. Avoid the area of Boulder Highway and Lake Mead Parkway.',
      geo: { p: 'Henderson, NV', lat: 36.04, lon: -114.98, r: 20000, cc: 'US' } }),
    item('cisa-ed', 6, { ...n, src: 'cisa-news', sn: 'CISA', cls: 'official', st: 'official', sev: 3, cat: ['cyber'],
      h: 'CISA issues Emergency Directive on actively exploited flaw in edge firewalls',
      x: 'Federal civilian agencies must apply mitigations within 48 hours. Exploitation has been observed.' }),
    item('usgs-m63', 11, { ...n, src: 'usgs', sn: 'USGS', cls: 'official', st: 'official', sev: 2, cat: ['disaster'],
      h: 'M 6.3 - 41 km SW of Ferndale, California',
      geo: { p: 'Ferndale, CA', lat: 40.31, lon: -124.68, r: 80000, cc: 'US' } }),
    item('doj-arrests', 19, { ...n, src: 'doj', sn: 'Justice Department', cls: 'official', st: 'official', sev: 1, cat: ['election', 'gov'],
      h: 'Justice Department announces charges over threats to election workers in Fulton County',
      geo: { p: 'Atlanta, GA', lat: 33.75, lon: -84.39, r: 25000, cc: 'US' } }),
    item('nhc', 31, { ...n, src: 'nhc-at', sn: 'NHC', cls: 'official', st: 'official', sev: 1, cat: ['disaster'],
      h: 'Tropical Storm Warning issued for the Florida Keys', geo: { p: 'Key West, FL', lat: 24.56, lon: -81.78, r: 90000, cc: 'US' } }),
    item('wh-msg', 44, { ...n, src: 'wh-news', sn: 'White House', cls: 'official', st: 'official', cat: ['gov'], h: 'Presidential Message on National Apprenticeship Week' }),
    item('fed-board', 58, { ...n, src: 'fed', sn: 'Federal Reserve', cls: 'official', st: 'official', cat: ['finance'], h: 'Federal Reserve Board announces approval of application by a community bank holding company' }),
    item('gdacs', 66, { ...n, src: 'gdacs', sn: 'GDACS', cls: 'official', st: 'official', cat: ['disaster'], h: 'Green earthquake alert (Magnitude 5.2M) in Papua New Guinea',
      geo: { p: 'Papua New Guinea', lat: -6.1, lon: 147.2, r: 200000, cc: 'PG' } }),

    // one story, three outlets: collapses to one row in SIGNAL, three rows in ALL
    item('ports-1', 3, { ...n, c: a, src: 'reuters', sn: 'Reuters', cls: 'wire', st: 'corroborated', sev: 1, n: 3, cat: ['labor'], w: ['nov4', 'ports', 'custom:long beach'],
      h: 'Strike deadline at LA-LB ports expected to be delayed to Nov. 4: PMA',
      x: 'The Pacific Maritime Association said talks continue. A walkout at the two ports would affect about 40 percent of US container imports.',
      geo: { p: 'Long Beach, CA', lat: 33.77, lon: -118.19, r: 15000, cc: 'US' } }),
    item('ports-2', 9, { ...n, c: a, src: 'gn-ports', sn: 'Los Angeles Times', cls: 'aggregator', st: 'corroborated', sev: 1, n: 3, cat: ['labor'], w: ['nov4', 'ports'],
      h: 'Port strike deadline pushed to Nov. 4 as talks continue', pt: now - 11 * MIN }),
    item('ports-3', 14, { ...n, c: a, src: 'ap', sn: 'AP', cls: 'wire', st: 'corroborated', sev: 1, n: 3, cat: ['labor'], w: ['nov4', 'ports'],
      h: 'West Coast dockworkers and employers extend strike deadline' }),

    item('bomb-1', 4, { ...n, c: b, src: 'nbc-pol', sn: 'NBC News', cls: 'wire', st: 'corroborated', sev: 2, n: 4, cat: ['election', 'security'],
      h: 'Bomb threats reported at polling places in two Pennsylvania counties, officials say',
      x: 'County officials said early voting sites were evacuated and swept. No devices were found.',
      geo: { p: 'Philadelphia, PA', lat: 39.95, lon: -75.16, r: 40000, cc: 'US' } }),
    item('bomb-2', 5, { ...n, c: b, src: 'reuters', sn: 'Reuters', cls: 'wire', st: 'corroborated', sev: 2, n: 4, cat: ['election', 'security'], h: 'Pennsylvania early voting sites evacuated after emailed bomb threats' }),
    item('bomb-3', 7, { ...n, c: b, src: 'gn-election', sn: 'WHYY', cls: 'aggregator', st: 'corroborated', sev: 2, n: 4, cat: ['election'], h: 'Delaware County early voting resumes after threat' }),
    item('bomb-4', 8, { ...n, c: b, src: 'masto-breaking', sn: 'mastodon.social', cls: 'social', st: 'corroborated', sev: 2, n: 4, cat: ['election'], h: 'bomb threats at PA polling places, stay safe everyone' }),

    item('sub-1', 13, { ...n, c, src: 'cbs-us', sn: 'CBS News', cls: 'wire', st: 'corroborated', sev: 2, n: 2, cat: ['infra', 'security'],
      h: 'Substation attack knocks out power to 40,000 in Phoenix suburbs, utility says',
      geo: { p: 'Mesa, AZ', lat: 33.42, lon: -111.83, r: 25000, cc: 'US' } }),
    item('sub-2', 15, { ...n, c, src: 'gn-grid', sn: 'Arizona Republic', cls: 'aggregator', st: 'corroborated', sev: 2, n: 2, cat: ['infra'], h: 'Crews restore power after substation damage in the East Valley' }),

    // single outlet
    item('curfew', 18, { ...n, src: 'gn-unrest', sn: 'Detroit Free Press', cls: 'aggregator', sev: 2, cat: ['unrest'], w: ['custom:detroit'],
      h: 'Curfew declared in downtown Detroit after overnight unrest', geo: { p: 'Detroit, MI', lat: 42.33, lon: -83.05, r: 12000, cc: 'US' } }),
    item('aclu', 23, { ...n, src: 'gn-election', sn: 'Nevada Current', cls: 'aggregator', sev: 1, cat: ['election'],
      h: 'ACLU seeks emergency order over alleged voter intimidation at Las Vegas rec center',
      geo: { p: 'Las Vegas, NV', lat: 36.17, lon: -115.14, r: 20000, cc: 'US' } }),
    item('ohio-rw', 27, { ...n, src: 'record', sn: 'The Record', cls: 'specialist', sev: 1, cat: ['cyber', 'election'], h: 'Ransomware attack takes county election website offline in Ohio' }),
    item('usni', 36, { ...n, src: 'usni', sn: 'USNI News', cls: 'specialist', sev: 1, cat: ['military'], h: 'Second carrier strike group moves into the Eastern Mediterranean' }),
    item('goats', 41, { ...n, src: 'fox-us', sn: 'Fox News', sev: 1, cat: ['disaster'], h: 'National Guard Saves Goats From Flood' }),
    item('acquit', 52, { ...n, src: 'bbc-world', sn: 'BBC', sev: 1, cat: ['military'], h: 'Court acquits ex-generals accused of planning martial law at burger joint',
      geo: { p: 'Seoul', lat: 37.57, lon: 126.98, r: 30000, cc: 'KR' } }),
    item('stocks', 49, { ...n, src: 'cnbc', sn: 'CNBC', cat: ['finance'], h: 'Stocks close mixed ahead of the jobs report' }),
    item('recirc', 16, { ...n, src: 'gn-top', sn: 'Newsbreak', cls: 'aggregator', sev: 1, cat: ['election'], fresh: false, pt: now - 53 * 3600000,
      h: 'Election officials warn of drop box tampering in Oregon' }),

    // fact checks
    item('fc-ventura', 12, { ...n, src: 'fc-leadstories', sn: 'Lead Stories', cls: 'factcheck', st: 'disputed', sev: 1, cat: ['election', 'rumor'],
      h: 'Fact Check: Does a punched hole in a Ventura County ballot envelope prove election rigging?' }),
    item('fc-text', 21, { ...n, src: 'fc-snopes', sn: 'Snopes', cls: 'factcheck', st: 'disputed', sev: 1, cat: ['rumor'], w: ['nov4'],
      h: 'No, the Nov. 4 national emergency text message is not real' }),

    // chatter
    item('tg-guard', 1, { ...n, src: 'tg-osintdefender', sn: 'OSINTdefender', cls: 'osint', st: 'unverified', sev: 1, cat: ['rumor', 'unrest'], w: ['nov4'],
      h: 'Hearing that National Guard units are staging outside Detroit ahead of Nov 4. Unconfirmed.',
      geo: { p: 'Detroit, MI', lat: 42.33, lon: -83.05, r: 30000, cc: 'US' } }),
    item('bsky-money', 2, { ...n, src: 'bsky', sn: 'Bluesky', cls: 'social', st: 'unverified', sev: 1, cat: ['rumor', 'finance'], w: ['nov4'],
      h: 'something big is coming on nov 4, get your money out of the banks now, they do not want you to know' }),
    item('masto-cell', 10, { ...n, src: 'masto-uspol', sn: 'mastodon.social', cls: 'social', st: 'unverified', sev: 1, cat: ['infra'],
      h: 'reports of cell service dropping across parts of Milwaukee, anyone else seeing this?',
      geo: { p: 'Milwaukee, WI', lat: 43.04, lon: -87.91, r: 20000, cc: 'US' } }),
    item('netblocks', 22, { ...n, src: 'netblocks', sn: 'NetBlocks', cls: 'osint', st: 'unverified', sev: 1, cat: ['infra'], h: 'Metrics show a disruption to internet connectivity in northern Iraq' }),
    item('tg-clash', 29, { ...n, src: 'tg-clashreport', sn: 'Clash Report', cls: 'osint', st: 'unverified', sev: 1, cat: ['military'], h: 'Unconfirmed: air defense activity reported near the Syrian coast' }),
    item('truth', 34, { ...n, src: 'truth', sn: 'Truth Social archive', cls: 'osint', st: 'unverified', cat: ['election'], h: 'Post with a link to a Senate race poll' }),
    item('hn', 26, { ...n, src: 'hn', sn: 'Hacker News', cls: 'social', st: 'unverified', h: 'Show HN: A tiny SQLite-backed feed reader' }),
    item('chili', 39, { ...n, src: 'masto-election', sn: 'mastodon.social', cls: 'social', st: 'unverified', h: 'anyone have a good election night chili recipe' }),

    // signal
    item('cf', 17, { ...n, src: 'st-cloudflare', sn: 'Cloudflare status', cls: 'signal', st: 'unverified', sev: 1, cat: ['infra'], h: 'Elevated errors in Ashburn (IAD)' }),
    item('wiki', 24, { ...n, src: 'wiki', sn: 'Wikipedia', cls: 'signal', st: 'unverified', cat: ['unrest'], h: 'Edit surge: 2026 Detroit curfew' }),
    item('trends', 33, { ...n, src: 'gtrends', sn: 'Google Trends', cls: 'signal', st: 'unverified', h: 'Trending in the US: power outage' }),

    // custom watch hit at sev 0 must still show in SIGNAL
    item('custom', 37, { ...n, src: 'gn-us', sn: 'Press-Telegram', cls: 'aggregator', w: ['custom:long beach'], h: 'Long Beach city council delays vote on the waterfront plan' })
  ];
  return list.concat(hostileItems(now));
}

// Everything here must render as harmless literal text, or not render at all.
function hostileItems(now) {
  const n = { now };
  return [
    item('x-img', 5.5, { ...n, src: 'gn-election', sn: 'Evil Wire', cls: 'aggregator', sev: 2, cat: ['election'],
      h: '<img src=x onerror=alert(1)> Polling place evacuated in Tucson',
      u: 'javascript:alert(document.domain)',
      x: '<svg/onload=alert(2)> snippet with <b>markup</b> and &lt;entities&gt;',
      geo: { p: '<img src=x onerror=alert(9)>', lat: 32.22, lon: -110.97, r: 15000, cc: 'US' } }),
    item('x-script', 7.5, { ...n, src: '<script>alert(3)</script>', sn: '<b onmouseover=alert(3)>Bold Wire</b>', sev: 1, cat: ['rumor'],
      h: '<script>window.__pwned=1</script>Officials deny the claim',
      u: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' }),
    item('x-vb', 20, { ...n, sev: 1, cat: ['rumor'], h: '"><iframe src=javascript:alert(4)></iframe> vbscript link', u: 'vbscript:msgbox(1)' }),
    item('x-rel', 25, { ...n, sev: 1, cat: ['rumor'], h: 'Protocol-relative link must not render as a link', u: '//evil.example/phish' }),
    item('x-case', 28, { ...n, sev: 1, cat: ['rumor'], h: 'Mixed-case javascript link', u: 'JaVaScRiPt:alert(5)' }),
    item('x-nl', 30, { ...n, sev: 1, cat: ['rumor'], h: 'Newline-split javascript link', u: 'java\nscript:alert(6)' }),
    item('x-user', 32, { ...n, sev: 1, cat: ['rumor'], h: 'Userinfo link pretending to be bbc.com', u: 'https://bbc.com@evil.example/' }),
    item('x-rtl', 35, { ...n, sev: 1, cat: ['rumor'], h: '\u202eetadpu lacitirc a ton si sihT' }),
    item('x-long', 38, { ...n, sev: 1, cat: ['rumor'], h: 'Unbroken' + 'A'.repeat(400) }),
    item('x-tags', 40, { ...n, sev: 1, cat: ['"><img src=x onerror=alert(7)>', 'election'], w: ['<img src=x onerror=alert(8)>'], h: 'Hostile tags: the watch tag must print as text, the category must drop' }),
    item('x-geo', 42, { ...n, sev: 2, cat: ['unrest'], h: 'Junk coordinates must not reach the globe', geo: { p: 'Nowhere', lat: 'NaN', lon: 9999, r: -1, cc: 'XX' } }),
    item('x-enum', 43, { ...n, sev: 99, st: 'constructor', cls: '__proto__', n: -5, cat: 'not-an-array', w: 7, h: 'Bad enums: reads as unverified, never as critical' }),
    item('x-future', 0, { ...n, t: now + 864e7, h: 'Stamped 100 days in the future, must not pin to the top', sev: 1, cat: ['rumor'] }),
    { id: '<img src=x>', c: 'x', t: now, h: 'Bad id, must be dropped', sev: 3, st: 'official', cls: 'official' },
    { id: hex('x-noh'), t: now, h: '', sev: 3 },
    'not an object'
  ];
}

function seedSeries(name, level) {
  let x = 0;
  for (const ch of name) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  const out = [];
  for (let i = 0; i < 60; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    const noise = ((x >>> 16) % 100) / 100;
    out.push(Math.floor(noise * level + (noise > 0.9 ? level : 0)));
  }
  return out;
}

function perMin(watch) {
  const pm = {
    nov4: seedSeries('nov4', 3), election: seedSeries('election', 9), unrest: seedSeries('unrest', 4),
    security: seedSeries('security', 3), infra: seedSeries('infra', 2), cyber: seedSeries('cyber', 3),
    military: seedSeries('military', 4), rumor: seedSeries('rumor', 2), ports: seedSeries('ports', 1)
  };
  // A clear surge on two buckets, so the SURGE state is on screen.
  pm.rumor = pm.rumor.map((v, i) => (i >= 55 ? v + 8 : Math.min(v, 1)));
  pm.nov4 = pm.nov4.map((v, i) => (i >= 55 ? v + 6 : Math.min(v, 1)));
  for (const t of watch) pm['custom:' + t] = seedSeries('custom:' + t, 2);
  return pm;
}

const CATALOG = [
  ['nws', 'NWS alerts', 'official', 'nws', 60], ['usgs', 'USGS quakes', 'official', 'usgs', 60], ['emsc', 'EMSC', 'official', 'emsc', 120],
  ['ntas', 'DHS NTAS', 'official', 'ntas', 120], ['faa', 'FAA NAS status', 'official', 'faa', 60], ['cisa-news', 'CISA news', 'official', 'rss', 600],
  ['doj', 'Justice Department', 'official', 'rss', 300], ['wh-news', 'White House news', 'official', 'rss', 180], ['fedreg', 'Federal Register', 'official', 'rss', 600],
  ['fema', 'FEMA declarations', 'official', 'fema', 600], ['eac', 'EAC', 'official', 'rss', 1800], ['gdacs', 'GDACS', 'official', 'rss', 300],
  ['bbc-top', 'BBC Top', 'wire', 'rss', 60], ['bbc-us', 'BBC US', 'wire', 'rss', 60], ['cbs-us', 'CBS US', 'wire', 'rss', 60], ['nyt-us', 'NYT US', 'wire', 'rss', 60],
  ['guardian-us', 'Guardian US', 'wire', 'rss', 90], ['fox-us', 'Fox US', 'wire', 'rss', 90], ['hill', 'The Hill', 'wire', 'rss', 90], ['npr', 'NPR', 'wire', 'rss', 120],
  ['nbc-pol', 'NBC Politics', 'wire', 'rss', 120], ['politico', 'Politico', 'wire', 'rss', 120], ['reuters', 'Reuters via GN', 'wire', 'gnews', 90], ['ap', 'AP via GN', 'wire', 'gnews', 90],
  ['votebeat', 'Votebeat', 'specialist', 'rss', 120], ['courthouse', 'Courthouse News', 'specialist', 'rss', 120], ['record', 'The Record', 'specialist', 'rss', 300],
  ['usni', 'USNI News', 'specialist', 'rss', 300], ['krebs', 'Krebs on Security', 'specialist', 'rss', 300], ['elb', 'Election Law Blog', 'specialist', 'rss', 300],
  ['fc-snopes', 'Snopes', 'factcheck', 'rss', 300], ['fc-leadstories', 'Lead Stories', 'factcheck', 'rss', 300],
  ['gn-nov4', 'GN nov4', 'aggregator', 'gnews', 180], ['gn-election', 'GN election', 'aggregator', 'gnews', 120], ['gn-unrest', 'GN unrest', 'aggregator', 'gnews', 120],
  ['truth', 'Truth archive', 'osint', 'truth', 120], ['netblocks', 'NetBlocks', 'osint', 'rss', 300], ['tg-osintdefender', 'OSINTdefender', 'osint', 'telegram', 120],
  ['masto-uspol', 'Mastodon #uspol', 'social', 'rss', 300], ['hn', 'Hacker News', 'social', 'hn', 120], ['gtrends', 'Google Trends', 'signal', 'rss', 300],
  ['st-cloudflare', 'Cloudflare status', 'signal', 'atom', 300], ['st-aws', 'AWS status', 'signal', 'rss', 300]
];

function health(now) {
  return {
    ts: now,
    up: 86400,
    sources: CATALOG.map(([id, n, cls, kind, every], i) => {
      const s = { id, n, cls, kind, every, ok: true, lastOk: now - (i % 7) * 13000 - 4000, lastErr: null, err: null, newest: now - (i + 2) * 4 * MIN, c1h: (i * 7) % 23, c24h: (i * 31) % 240, fails: 0, stale: false };
      if (id === 'fema') return Object.assign(s, { ok: false, lastOk: now - 42 * MIN, lastErr: now - MIN, err: 'HTTP 503 <html>gateway</html>', fails: 7 });
      if (id === 'st-aws') return Object.assign(s, { ok: false, lastOk: now - 3 * 3600000, lastErr: now - MIN, err: 'timeout after 15000 ms', fails: 12 });
      if (id === 'eac') return Object.assign(s, { ok: false, stale: true, err: 'stale', newest: now - 3 * 864e5 });
      if (id === 'krebs') return Object.assign(s, { ok: false, lastOk: null, lastErr: null, newest: null, c1h: 0, c24h: 0 });
      return s;
    }),
    streams: { bsky: { ok: true, lastEvent: now - 900, perMin: 2812 }, wiki: { ok: false, lastEvent: now - 4 * MIN, perMin: 0 } }
  };
}

function stats(now, watch, ntasActive) {
  return {
    items1m: 37,
    items1h: 1204,
    perMin: perMin(watch),
    official: {
      ntas: { active: !!ntasActive, title: ntasActive ? 'Bulletin: heightened threat environment (fixture)' : '' },
      faa: { stops: 0, delays: 3, closures: 4, updated: now - 2 * MIN },
      nws: { extreme: 2, severe: 11, civil: 1 },
      usgs: { m6p24h: 1 }
    }
  };
}

function buildSnapshot(now, items, watch) {
  return { v: 1, ts: now, generated: new Date(now).toISOString(), items: items.slice(0, 600), health: health(now), stats: stats(now, watch, false) };
}

// ── Simulated collector ──

const LIVE_POOL = [
  { src: 'gn-unrest', sn: 'WXYZ Detroit', cls: 'aggregator', sev: 1, st: 'reported', cat: ['unrest'], h: 'Protest march planned downtown as city extends curfew hours' },
  { src: 'bsky', sn: 'Bluesky', cls: 'social', sev: 1, st: 'unverified', cat: ['rumor'], w: ['nov4'], h: 'my cousin in the guard says be prepared for nov 4, stock up now' },
  { src: 'tg-faytuks', sn: 'Faytuks Network', cls: 'osint', sev: 1, st: 'unverified', cat: ['military'], h: 'Unconfirmed reports of drone activity near a Gulf port' },
  { src: 'nws', sn: 'NWS', cls: 'official', sev: 2, st: 'official', cat: ['disaster'], h: 'Evacuation Immediate issued for Marion County, FL', geo: { p: 'Ocala, FL', lat: 29.19, lon: -82.14, r: 30000, cc: 'US' } },
  { src: 'bleeping', sn: 'BleepingComputer', cls: 'specialist', sev: 1, st: 'reported', cat: ['cyber'], h: 'Hackers claim breach of a county voter registration vendor' },
  { src: 'cnbc', sn: 'CNBC', cls: 'wire', sev: 0, st: 'reported', cat: ['finance'], h: 'Treasury yields edge higher before the jobs report' },
  { src: 'masto-uspol', sn: 'mastodon.social', cls: 'social', sev: 1, st: 'unverified', cat: ['election'], h: 'long lines reported at early voting sites in Maricopa' },
  { src: 'gn-election', sn: '<img src=x onerror=alert(11)>', cls: 'aggregator', sev: 1, st: 'reported', cat: ['election'], u: 'javascript:alert(12)', h: 'Live hostile item <img src=x onerror=alert(13)> must arrive as text' },
  { src: 'bbc-us', sn: 'BBC', cls: 'wire', sev: 3, st: 'corroborated', n: 3, cat: ['infra'], h: 'Regional 911 outage hits three carriers across Arizona, officials say', geo: { p: 'Phoenix, AZ', lat: 33.45, lon: -112.07, r: 90000, cc: 'US' } },
  { src: 'hn', sn: 'Hacker News', cls: 'social', sev: 0, st: 'unverified', h: 'Ask HN: What are you building this weekend?' }
];

const sim = { items: [], watch: ['long beach', 'detroit'], seq: 0, pool: 0, clients: new Set(), started: 0 };

function pushLive() {
  const now = Date.now();
  const batch = [];
  const count = 1 + (sim.seq % 3 === 0 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const tpl = LIVE_POOL[sim.pool++ % LIVE_POOL.length];
    const id = hex('live-' + (++sim.seq));
    batch.push(Object.assign({ id, c: id, t: now, pt: now - 40000, u: 'https://example.com/live/' + id, x: '', w: [], cat: [], n: 1, fresh: true }, tpl));
  }
  // Every fourth tick a rumor climbs the ladder, so a status change lands on a row in place.
  const upd = [];
  const rumor = sim.items.find(it => it.st === 'unverified' && it.sev === 1);
  if (rumor && sim.seq % 4 === 0) {
    const step = { c: rumor.c, st: 'corroborated', n: 2 + (sim.seq % 3), sev: 2 };
    Object.assign(rumor, { st: step.st, n: step.n, sev: step.sev });
    upd.push(step);
  }
  sim.items = batch.concat(sim.items).slice(0, 600);
  return { items: batch, upd };
}

function hbPayload(now) {
  const h = health(now);
  return { ts: now, up: Math.floor((now - sim.started) / 1000), ok: h.sources.filter(s => s.ok).length, total: h.sources.length, items1m: 30 + (now % 17), official: stats(now, sim.watch, false).official };
}

function sse(res, event, data) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
}

function collectorRunning(client, now) {
  if (client.mode === 'offline') return false;
  if (client.mode === 'dying') return now - client.loaded < 30000;
  return true;
}

function startSimulator() {
  sim.started = Date.now();
  sim.items = fixtureItems(sim.started);
  setInterval(() => {
    const now = Date.now();
    if (![...sim.clients].some(c => collectorRunning(c, now))) return;
    const payload = pushLive();
    for (const c of sim.clients) if (collectorRunning(c, now) && !c.res.writableEnded) sse(c.res, 'b', payload);
  }, 4000);
  setInterval(() => {
    const now = Date.now();
    for (const c of sim.clients) if (collectorRunning(c, now) && !c.res.writableEnded) sse(c.res, 'hb', hbPayload(now));
  }, 15000);
}

// ── Mock function ──

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function tokenOf(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return m ? m[1] : '';
}

// Token form: dev.<mode>.<pageLoadMs>
function parseToken(token) {
  const parts = token.split('.');
  return parts[0] === 'dev' ? { mode: parts[1] || 'live', loaded: Number(parts[2]) || Date.now() } : null;
}

function wireBody(ageSec, snapshot) {
  return { owner: true, topic: TOPIC, snapshot, watch: sim.watch, ageSec };
}

function handleWire(req, res, url) {
  const explicit = url.searchParams.get('mode');
  const token = parseToken(tokenOf(req));
  if (!explicit && !token) return json(res, 401, { error: 'unauthorized' });
  const mode = explicit || token.mode;
  const loaded = token ? token.loaded : Date.now();
  const now = Date.now();

  if (mode === 'nonowner') return json(res, 403, { error: 'forbidden' });
  if (mode === 'signedout') return json(res, 401, { error: 'unauthorized' });
  if (mode === '503') return json(res, 503, { error: 'storage unavailable' });
  if (mode === 'netdown') { req.socket.destroy(); return undefined; }
  if (mode === 'expire' && now - loaded > 25000) return json(res, 401, { error: 'unauthorized' });

  if (req.method === 'POST' && url.searchParams.get('action') === 'watch') return handleWatch(req, res);
  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
  if (url.searchParams.get('probe') === '1') return json(res, 200, { owner: true });

  if (mode === 'nosnap') return json(res, 200, wireBody(null, null));
  if (mode === 'empty') return json(res, 200, wireBody(12, Object.assign(buildSnapshot(now, [], sim.watch), { ts: now - 12000 })));

  let age = 20 + Math.floor((now / 1000) % 40);
  if (mode === 'offline') age = 1500;
  if (mode === 'stale') age = 660;
  if (mode === 'dying') age = Math.max(age, now - loaded < 30000 ? 20 : (now - loaded - 30000) / 1000 + 200);
  const snap = buildSnapshot(now - age * 1000, sim.items, sim.watch);
  return json(res, 200, wireBody(Math.round(age), snap));
}

function handleWatch(req, res) {
  let raw = '';
  req.on('data', d => { raw += d; if (raw.length > 8192) req.destroy(); });
  req.on('end', () => {
    let terms;
    try { terms = JSON.parse(raw).terms; } catch (_) { return json(res, 400, { error: 'body must be JSON' }); }
    if (!Array.isArray(terms)) return json(res, 400, { error: 'terms must be an array' });
    if (terms.length > 40) return json(res, 400, { error: 'at most 40 terms' });
    const clean = [];
    for (const t of terms) {
      const s = String(t).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
      if (s.length < 2 || s.length > 64) return json(res, 400, { error: 'each term must be 2 to 64 characters' });
      // Lets the error path be exercised, with hostile text in the message on purpose.
      if (/reject/i.test(s)) return json(res, 400, { error: '<img src=x onerror=alert(10)> term refused by the dev server' });
      clean.push(s);
    }
    sim.watch = clean;
    return json(res, 200, { ok: true, watch: sim.watch });
  });
}

function handleStream(req, res, url) {
  const mode = url.searchParams.get('mode') || 'live';
  const loaded = Number(url.searchParams.get('loaded')) || Date.now();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  const client = { res, mode, loaded };
  sim.clients.add(client);
  const now = Date.now();
  if (collectorRunning(client, now)) sse(res, 'hb', hbPayload(now));
  let flap = 0;
  if (mode === 'sockflap') flap = setTimeout(() => res.end(), 20000);
  req.on('close', () => {
    clearTimeout(flap);
    sim.clients.delete(client);
  });
}

// ── Browser side of the fake. Serialized with toString(), so node --check covers it. ──

function shimMain() {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || 'live';
  const loaded = Date.now();
  const session = t => ({ access_token: t, user: { id: 'dev-user', email: 'dev@localhost' } });
  const listeners = new Set();
  const emit = (evt, sess) => listeners.forEach(fn => fn(evt, sess));
  let aal = 'aal2';
  let token = mode === 'signedout' ? null : 'dev.' + mode + '.' + loaded;  // a reload starts over

  const currentSession = () => (token ? session(token) : null);

  class FakeChannel {
    constructor() { this.handlers = {}; this.es = null; this.cb = null; }
    on(type, filter, fn) { this.handlers[filter.event] = fn; return this; }
    subscribe(cb) {
      this.cb = cb;
      if (mode === 'degraded') { setTimeout(() => cb('CHANNEL_ERROR'), 300); return this; }
      const es = new EventSource('/__wire/stream?mode=' + encodeURIComponent(mode) + '&loaded=' + loaded);
      this.es = es;
      es.addEventListener('open', () => cb('SUBSCRIBED'));
      for (const name of ['b', 'hb']) {
        es.addEventListener(name, e => {
          const fn = this.handlers[name];
          if (fn) fn({ payload: JSON.parse(e.data) });
        });
      }
      es.addEventListener('error', () => { es.close(); cb('CLOSED'); });
      return this;
    }
    close() {
      if (this.es) this.es.close();
      if (this.cb) this.cb('CLOSED');     // real supabase-js fires this too
    }
  }

  const channels = new Set();
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: currentSession() }, error: null }),
      refreshSession: () => Promise.resolve(mode === 'expire' && token && token.indexOf('dev.expire') === 0
        ? { data: { session: null }, error: { message: 'Refresh Token Not Found' } }
        : { data: { session: currentSession() }, error: null }),
      onAuthStateChange: fn => {
        listeners.add(fn);
        return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
      },
      signInWithPassword: ({ password }) => {
        if (password === 'fail') return Promise.resolve({ data: {}, error: { message: 'Invalid login credentials' } });
        if (password === 'mfa') aal = 'aal1';
        token = 'dev.live.' + loaded;
        const s = currentSession();
        emit('SIGNED_IN', s);
        return Promise.resolve({ data: { user: s.user, session: s }, error: null });
      },
      signOut: () => {
        token = null;
        emit('SIGNED_OUT', null);
        return Promise.resolve({ error: null });
      },
      mfa: {
        getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: aal, nextLevel: 'aal2' }, error: null }),
        listFactors: () => Promise.resolve({ data: { totp: [{ id: 'dev-factor' }] }, error: null }),
        challenge: () => Promise.resolve({ data: { id: 'dev-challenge' }, error: null }),
        verify: ({ code }) => {
          if (code !== '123456') return Promise.resolve({ error: { message: 'Invalid TOTP code entered' } });
          aal = 'aal2';
          return Promise.resolve({ error: null });
        }
      }
    },
    channel: () => {
      const ch = new FakeChannel();
      channels.add(ch);
      return ch;
    },
    removeChannel: ch => {
      channels.delete(ch);
      ch.close();
      return Promise.resolve('ok');
    }
  };
  window.supabase = { createClient: () => client };
  window.__wireDev = { client, openChannels: () => channels.size };

  const tag = document.createElement('a');
  tag.href = '/__wire/';
  tag.textContent = 'DEV FIXTURE · ' + mode;
  tag.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99999;padding:3px 6px;background:#E8B349;color:#0E1116;font:600 10px monospace;letter-spacing:.06em;text-decoration:none';
  const pin = () => document.body.appendChild(tag);
  if (document.body) pin(); else document.addEventListener('DOMContentLoaded', pin);
}

// A globe that records calls, so the panel can be checked with no Cesium and no GPU.
// It logs an error if a marker ever carries more than position and point.
function fakeCesiumMain() {
  const log = document.getElementById('log');
  const note = line => { log.textContent = line + '\n' + log.textContent; };
  const calls = { flyTo: [], violations: [] };
  class CustomDataSource {
    constructor(name) {
      this.name = name;
      const values = new Set();
      this.entities = {
        values,
        add(e) {
          const keys = Object.keys(e).sort().join(',');
          if (keys !== 'point,position') { calls.violations.push(keys); console.error('[fake cesium] marker carries extra fields:', keys); }
          values.add(e);
          note('marker add ' + JSON.stringify(e.position) + ' ' + e.point.color);
          return e;
        },
        remove(e) { values.delete(e); return true; }
      };
    }
  }
  window.Cesium = {
    CustomDataSource,
    Cartesian3: { fromDegrees: (lon, lat, h) => ({ lon, lat, h }) },
    Color: { fromCssColorString: s => s }
  };
  const sources = new Set();
  window.V = {
    camera: { flyTo(o) { calls.flyTo.push(o); note('camera.flyTo ' + JSON.stringify(o.destination)); } },
    dataSources: { add(ds) { sources.add(ds); return Promise.resolve(ds); }, remove(ds) { sources.delete(ds); note('data source removed'); return true; } },
    scene: { requestRender() {} }
  };
  window.__fakeGlobe = { calls, sources, markers: () => [...sources].reduce((n, d) => n + d.entities.values.size, 0) };
}

function panelMain() {
  const btn = document.getElementById('toggle');
  btn.addEventListener('click', () => window.BDOCWire.toggle({ client: window.__wireDev.client, embedded: true }));
  window.BDOCWire.onCount(n => { btn.textContent = n ? 'WIRE ' + n : 'WIRE'; });
  btn.click();
}

const PANEL_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wire panel harness</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap">
<style>html,body{height:100%;margin:0;background:#0a0e14;color:#9BA1A8;font:12px monospace;overflow:hidden}
#cesiumContainer{position:absolute;inset:0;padding:16px;background:#0a0e14}#toggle{position:fixed;left:16px;top:16px;z-index:5;height:32px;padding:0 14px;background:#13171F;color:#E6E9EE;border:1px solid #333;font:12px monospace;cursor:pointer}
#log{margin-top:56px;white-space:pre-wrap}</style></head>
<body><div id="cesiumContainer">FAKE GLOBE (records marker and camera calls)<pre id="log"></pre></div><button id="toggle">WIRE</button>
<script src="/__wire/shim.js"></script><script src="/__wire/fake-cesium.js"></script>
<script src="/js/bdoc-wire.js?v=p160"></script><script src="/__wire/panel.js"></script></body></html>`;

function indexPage() {
  const links = MODES.map(m => `<li><a href="/wire.html?mode=${m}">${m}</a> &middot; <a href="/__wire/panel?mode=${m}">panel</a></li>`).join('');
  return `<!DOCTYPE html><meta charset="UTF-8"><title>Wire dev harness</title><body style="background:#0E1116;color:#E6E9EE;font:14px/1.7 monospace;padding:24px"><h1 style="font-size:15px">LIVE WIRE dev harness</h1><ul>${links}</ul></body>`;
}

// ── Static ──

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

function rewriteWireHtml(html) {
  return html.replace(SUPABASE_TAG, '<script src="/__wire/shim.js"></script>');
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (_) { return send(res, 400, 'text/plain', 'bad path'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  const inside = file === ROOT || file.startsWith(ROOT + path.sep);
  const dotted = path.relative(ROOT, file).split(path.sep).some(s => s.startsWith('.'));
  if (!inside || dotted) return send(res, 404, 'text/plain', 'not found');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'text/plain', 'not found');
    return send(res, 200, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', buf);
  });
  return undefined;
}

function handle(req, res) {
  // A page on another site cannot reach this through DNS rebinding.
  const host = (req.headers.host || '').split(':')[0];
  if (host !== 'localhost' && host !== '127.0.0.1') return send(res, 403, 'text/plain', 'localhost only');
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (p === '/.netlify/functions/config') return json(res, 200, { supabase_url: 'http://localhost:' + PORT, supabase_anon_key: 'dev-anon-key' });
  if (p === '/.netlify/functions/wire') return handleWire(req, res, url);
  if (p === '/__wire/' || p === '/__wire') return send(res, 200, TYPES['.html'], indexPage());
  if (p === '/__wire/stream') return handleStream(req, res, url);
  if (p === '/__wire/shim.js') return send(res, 200, TYPES['.js'], '(' + shimMain.toString() + ')();');
  if (p === '/__wire/fake-cesium.js') return send(res, 200, TYPES['.js'], '(' + fakeCesiumMain.toString() + ')();');
  if (p === '/__wire/panel.js') return send(res, 200, TYPES['.js'], '(' + panelMain.toString() + ')();');
  if (p === '/__wire/panel') return send(res, 200, TYPES['.html'], PANEL_PAGE);
  if (p === '/wire' || p === '/wire.html') {
    return fs.readFile(path.join(ROOT, 'wire.html'), 'utf8', (err, html) =>
      (err ? send(res, 500, 'text/plain', 'wire.html missing') : send(res, 200, TYPES['.html'], rewriteWireHtml(html))));
  }
  return serveStatic(res, p);
}

function start() {
  startSimulator();
  const server = http.createServer(handle);
  server.listen(PORT, HOST, () => {
    console.log('LIVE WIRE dev harness: http://localhost:' + PORT + '/__wire/');
    console.log('Page: http://localhost:' + PORT + '/wire.html   Panel: http://localhost:' + PORT + '/__wire/panel');
  });
  return server;
}

if (require.main === module) start();

module.exports = { fixtureItems, hostileItems, buildSnapshot, rewriteWireHtml, MODES, TOPIC };
