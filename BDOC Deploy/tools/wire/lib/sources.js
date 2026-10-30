// ============================================================
// wire/sources — the source catalog (data, not logic)
// ============================================================
// WHY THIS EXISTS
// docs/LIVE-WIRE-SPEC.md section 7 is the list of feeds verified from the droplet
// on 2026-10-30. This file is that list as data. Do not add a feed here that the
// spec does not name, and do not re-add one from its KNOWN DEAD list: CNN and WSJ
// World return HTTP 200 with content years old, which is exactly the lie the health
// panel exists to catch. bsky, wiki and gdelt are streams and live in their own
// modules.
//
// FIELDS
// id, name, cls, kind, url, every (seconds) are the contract.
// ua    overrides the honest default UA. NWS requires a contact; t.me serves its
//       preview pages to browsers.
// pub   the publisher's registrable domain when the feed host is not it. BBC feeds
//       come from feeds.bbci.co.uk and link to bbc.co.uk or bbc.com, and two of its
//       feeds must count as ONE publisher or the BBC "corroborates" itself.
// cat0  categories the parser can assert without reading the text.
// quiet silence is the normal state here (no storms, no outages, no NTAS advisory),
//       so a stale newest item says nothing about the feed's health.
// guidUrl take the item url from <guid>. NHC keeps <link> fixed per product and puts
//       the issuance in the guid, and the url is the item's identity, so with the bare
//       link every new advisory would dedupe against the first one.

'use strict';

const { sha16 } = require('./util');

const UA = 'KitsuneBDOC-Wire/1.0 (+https://kgsbdoc.netlify.app)';
const UA_NWS = 'KitsuneBDOC-Wire/1.0 (+https://kgsbdoc.netlify.app; support@kgsbdoc.netlify.app)';
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const GN_PARAMS = 'hl=en-US&gl=US&ceid=US:en';

function gnSearchUrl(q) {
  return 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&' + GN_PARAMS;
}

const row = (cls, kind, id, name, url, every, extra) => Object.assign({ id, name, cls, kind, url, every }, extra);
const official = (id, name, url, every, kind, extra) => row('official', kind || 'rss', id, name, url, every, extra);
const wire = (id, name, url, every, pub) => row('wire', 'rss', id, name, url, every, { pub });
const specialist = (id, name, url, every) => row('specialist', 'rss', id, name, url, every);
const factcheck = (id, name, url) => row('factcheck', 'rss', id, name, url, 300);
const aggregator = (id, name, url, every) => row('aggregator', 'gnews', id, name, url, every);
const telegram = (channel, name) => row('osint', 'telegram', 'tg-' + channel.toLowerCase(), name, 'https://t.me/s/' + channel, 120, { ua: UA_BROWSER, pub: 't.me' });
const statusPage = (id, name, url) => row('signal', 'rss', id, name, url, 300, { cat0: ['infra'], quiet: true, statusPage: true });
const metro = (place) => row('aggregator', 'gnews', 'gn-metro-' + place.toLowerCase().replace(/\s+/g, '-'), 'Google News ' + place,
  'https://news.google.com/rss/headlines/section/geo/' + encodeURIComponent(place) + '?' + GN_PARAMS, 300);

const SOURCES = [
  // ── official ────────────────────────────────────────────────────────────
  official('nws', 'NWS', 'https://api.weather.gov/alerts/active?status=actual&message_type=alert', 60, 'nws', { ua: UA_NWS, pub: 'weather.gov', quiet: true }),
  official('usgs', 'USGS', 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson', 60, 'usgs', { pub: 'usgs.gov', quiet: true }),
  official('emsc', 'EMSC', 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=20&minmag=4.5', 120, 'emsc', { pub: 'seismicportal.eu', quiet: true }),
  official('ntas', 'DHS NTAS', 'https://www.dhs.gov/ntas/1.1/alerts.xml', 120, 'ntas', { pub: 'dhs.gov', quiet: true }),
  official('faa', 'FAA NAS Status', 'https://nasstatus.faa.gov/api/airport-status-information', 60, 'faa', { pub: 'faa.gov', quiet: true }),
  official('nhc-at', 'NHC Atlantic', 'https://www.nhc.noaa.gov/index-at.xml', 300, 'rss', { pub: 'noaa.gov', cat0: ['disaster'], quiet: true, guidUrl: true }),
  official('nhc-ep', 'NHC East Pacific', 'https://www.nhc.noaa.gov/index-ep.xml', 300, 'rss', { pub: 'noaa.gov', cat0: ['disaster'], quiet: true, guidUrl: true }),
  official('cisa-adv', 'CISA Advisories', 'https://www.cisa.gov/cybersecurity-advisories/all.xml', 900, 'rss', { pub: 'cisa.gov', cat0: ['cyber'] }),
  official('cisa-news', 'CISA News', 'https://www.cisa.gov/news.xml', 600, 'rss', { pub: 'cisa.gov', cat0: ['cyber'] }),
  official('doj', 'DOJ', 'https://www.justice.gov/news/rss?type=press_release&m=1', 300, 'rss', { pub: 'justice.gov', cat0: ['gov'] }),
  official('wh-news', 'White House News', 'https://www.whitehouse.gov/news/feed/', 180, 'rss', { pub: 'whitehouse.gov', cat0: ['gov'] }),
  official('wh-actions', 'White House Actions', 'https://www.whitehouse.gov/presidential-actions/feed/', 180, 'rss', { pub: 'whitehouse.gov', cat0: ['gov'] }),
  official('fedreg', 'Federal Register', 'https://www.federalregister.gov/api/v1/documents.rss?conditions%5Btype%5D%5B%5D=PRESDOCU&order=newest', 600, 'rss', { pub: 'federalregister.gov', cat0: ['gov'] }),
  official('war-news', 'Dept of War News', 'https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10', 300, 'rss', { pub: 'war.gov', cat0: ['military'] }),
  official('war-rel', 'Dept of War Releases', 'https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=9&Site=945&max=10', 300, 'rss', { pub: 'war.gov', cat0: ['military'] }),
  official('fed', 'Federal Reserve', 'https://www.federalreserve.gov/feeds/press_all.xml', 600, 'rss', { pub: 'federalreserve.gov', cat0: ['finance'] }),
  official('eac', 'EAC', 'https://www.eac.gov/rss.xml', 1800, 'rss', { pub: 'eac.gov', cat0: ['election'] }),
  official('un', 'UN News', 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', 300, 'rss', { pub: 'un.org' }),
  official('gdacs', 'GDACS', 'https://www.gdacs.org/xml/rss.xml', 300, 'rss', { pub: 'gdacs.org', cat0: ['disaster'], quiet: true }),
  official('swpc', 'NOAA SWPC', 'https://services.swpc.noaa.gov/products/alerts.json', 300, 'swpc', { pub: 'noaa.gov', cat0: ['disaster'], quiet: true }),
  official('eonet', 'NASA EONET', 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=20', 600, 'eonet', { pub: 'nasa.gov', cat0: ['disaster'], quiet: true }),
  official('fema', 'FEMA', 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?%24orderby=declarationDate%20desc&%24top=10', 600, 'fema', { pub: 'fema.gov', cat0: ['disaster'], quiet: true }),

  // ── wire ────────────────────────────────────────────────────────────────
  wire('bbc-top', 'BBC', 'https://feeds.bbci.co.uk/news/rss.xml', 60, 'bbc.co.uk'),
  wire('bbc-us', 'BBC', 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', 60, 'bbc.co.uk'),
  wire('bbc-world', 'BBC', 'https://feeds.bbci.co.uk/news/world/rss.xml', 60, 'bbc.co.uk'),
  wire('cbs-latest', 'CBS News', 'https://www.cbsnews.com/latest/rss/main', 60, 'cbsnews.com'),
  wire('cbs-us', 'CBS News', 'https://www.cbsnews.com/latest/rss/us', 60, 'cbsnews.com'),
  wire('cbs-pol', 'CBS News', 'https://www.cbsnews.com/latest/rss/politics', 60, 'cbsnews.com'),
  wire('nyt-home', 'NYT', 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', 60, 'nytimes.com'),
  wire('nyt-us', 'NYT', 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml', 60, 'nytimes.com'),
  wire('nyt-pol', 'NYT', 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', 60, 'nytimes.com'),
  wire('nyt-world', 'NYT', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 60, 'nytimes.com'),

  wire('guardian-us', 'Guardian', 'https://www.theguardian.com/us-news/rss', 90, 'theguardian.com'),
  wire('guardian-world', 'Guardian', 'https://www.theguardian.com/world/rss', 90, 'theguardian.com'),
  wire('abc-top', 'ABC News', 'https://abcnews.go.com/abcnews/topstories', 90, 'abcnews.go.com'),
  wire('fox-latest', 'Fox News', 'https://moxie.foxnews.com/google-publisher/latest.xml', 90, 'foxnews.com'),
  wire('fox-us', 'Fox News', 'https://moxie.foxnews.com/google-publisher/us.xml', 90, 'foxnews.com'),
  wire('fox-pol', 'Fox News', 'https://moxie.foxnews.com/google-publisher/politics.xml', 90, 'foxnews.com'),
  wire('hill', 'The Hill', 'https://thehill.com/news/feed/', 90, 'thehill.com'),
  wire('hill-camp', 'The Hill', 'https://thehill.com/homenews/campaign/feed/', 90, 'thehill.com'),
  wire('aljazeera', 'Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml', 90, 'aljazeera.com'),

  wire('npr', 'NPR', 'https://feeds.npr.org/1001/rss.xml', 120, 'npr.org'),
  wire('npr-pol', 'NPR', 'https://feeds.npr.org/1014/rss.xml', 120, 'npr.org'),
  wire('nbc-top', 'NBC News', 'https://feeds.nbcnews.com/nbcnews/public/news', 120, 'nbcnews.com'),
  wire('nbc-pol', 'NBC News', 'https://feeds.nbcnews.com/nbcnews/public/politics', 120, 'nbcnews.com'),
  wire('politico', 'Politico', 'https://rss.politico.com/politics-news.xml', 120, 'politico.com'),
  wire('bloom-pol', 'Bloomberg', 'https://feeds.bloomberg.com/politics/news.rss', 120, 'bloomberg.com'),
  wire('bloom-mkts', 'Bloomberg', 'https://feeds.bloomberg.com/markets/news.rss', 120, 'bloomberg.com'),
  wire('cnbc', 'CNBC', 'https://www.cnbc.com/id/100003114/device/rss/rss.html', 120, 'cnbc.com'),

  wire('abc-us', 'ABC News', 'https://abcnews.go.com/abcnews/usheadlines', 180, 'abcnews.go.com'),
  wire('abc-pol', 'ABC News', 'https://abcnews.go.com/abcnews/politicsheadlines', 180, 'abcnews.go.com'),
  wire('wsj-us', 'WSJ', 'https://feeds.content.dowjones.io/public/rss/RSSUSnews', 180, 'wsj.com'),
  wire('axios', 'Axios', 'https://api.axios.com/feed/', 180, 'axios.com'),
  wire('pbs', 'PBS NewsHour', 'https://www.pbs.org/newshour/feeds/rss/headlines', 180, 'pbs.org'),

  wire('dw', 'DW', 'https://rss.dw.com/rdf/rss-en-world', 300, 'dw.com'),
  wire('sky-world', 'Sky News', 'https://feeds.skynews.com/feeds/rss/world.xml', 300, 'sky.com'),
  wire('sky-us', 'Sky News', 'https://feeds.skynews.com/feeds/rss/us.xml', 300, 'sky.com'),
  wire('time', 'TIME', 'https://time.com/feed/', 300, 'time.com'),

  // Reuters and AP publish no usable RSS, so they come through Google News but keep
  // the wire class: what is being read is their reporting, not an aggregation of it.
  row('wire', 'gnews', 'reuters', 'Reuters', gnSearchUrl('when:1h site:reuters.com'), 90, { pub: 'reuters.com' }),
  row('wire', 'gnews', 'ap', 'AP', gnSearchUrl('when:1h site:apnews.com'), 90, { pub: 'apnews.com' }),

  // ── specialist ──────────────────────────────────────────────────────────
  specialist('courthouse', 'Courthouse News', 'https://www.courthousenews.com/feed/', 120),
  specialist('votebeat', 'Votebeat', 'https://www.votebeat.org/arc/outboundfeeds/rss/', 120),

  specialist('breakingdef', 'Breaking Defense', 'https://breakingdefense.com/feed/', 300),
  specialist('defnews', 'Defense News', 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml', 300),
  specialist('miltimes', 'Military Times', 'https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml', 300),
  specialist('twz', 'The War Zone', 'https://www.twz.com/feed', 300),
  specialist('usni', 'USNI News', 'https://news.usni.org/feed', 300),
  specialist('defone', 'Defense One', 'https://www.defenseone.com/rss/all/', 300),
  specialist('taskpurpose', 'Task & Purpose', 'https://taskandpurpose.com/feed/', 300),
  specialist('record', 'The Record', 'https://therecord.media/feed', 300),
  specialist('bleeping', 'BleepingComputer', 'https://www.bleepingcomputer.com/feed/', 300),
  specialist('cyberscoop', 'CyberScoop', 'https://cyberscoop.com/feed/', 300),
  specialist('secweek', 'SecurityWeek', 'https://www.securityweek.com/feed/', 300),
  specialist('darkread', 'Dark Reading', 'https://www.darkreading.com/rss.xml', 300),
  specialist('thn', 'The Hacker News', 'https://feeds.feedburner.com/TheHackersNews', 300),
  specialist('krebs', 'Krebs on Security', 'https://krebsonsecurity.com/feed/', 300),
  specialist('elb', 'Election Law Blog', 'https://electionlawblog.org/?feed=rss2', 300),

  specialist('wotr', 'War on the Rocks', 'https://warontherocks.com/feed/', 600),
  specialist('stateline', 'Stateline', 'https://stateline.org/feed/', 600),
  specialist('propublica', 'ProPublica', 'https://www.propublica.org/feeds/propublica/main', 600),
  specialist('justsec', 'Just Security', 'https://www.justsecurity.org/feed/', 600),

  specialist('bellingcat', 'Bellingcat', 'https://www.bellingcat.com/feed/', 1800),
  specialist('crisis', 'Crisis Group', 'https://www.crisisgroup.org/rss.xml', 1800),
  specialist('gnet', 'GNET', 'https://gnet-research.org/feed/', 1800),

  // ── factcheck ───────────────────────────────────────────────────────────
  factcheck('fc-factcheck', 'FactCheck.org', 'https://www.factcheck.org/feed/'),
  factcheck('fc-leadstories', 'Lead Stories', 'https://leadstories.com/atom.xml'),
  factcheck('fc-snopes', 'Snopes', 'https://www.snopes.com/feed/'),

  // ── aggregator (Google News; sn and pub come from each item's <source>) ─────
  aggregator('gn-top', 'Google News Top', 'https://news.google.com/rss?' + GN_PARAMS, 120),
  aggregator('gn-us', 'Google News US', 'https://news.google.com/rss/headlines/section/topic/NATION?' + GN_PARAMS, 120),
  aggregator('gn-nov4', 'Google News Nov 4', gnSearchUrl('("November 4" OR "Nov. 4") (threat OR warning OR attack OR protest OR strike OR unrest OR emergency OR shutdown OR blackout OR rumor) when:1d'), 180),
  aggregator('gn-election', 'Google News Election', gnSearchUrl('election (threat OR "bomb threat" OR "polling place" OR swatting OR "drop box" OR intimidation) when:1h'), 120),
  aggregator('gn-guard', 'Google News Guard', gnSearchUrl('"National Guard" OR "martial law" OR "Insurrection Act" when:1h'), 120),
  aggregator('gn-unrest', 'Google News Unrest', gnSearchUrl('(protest OR riot OR curfew OR "state of emergency") United States when:1h'), 120),
  aggregator('gn-grid', 'Google News Grid', gnSearchUrl('blackout OR "power outage" OR substation OR "grid attack" when:1h'), 180),
  aggregator('gn-cyber', 'Google News Cyber', gnSearchUrl('cyberattack OR ransomware OR "data breach" when:1h'), 180),
  aggregator('gn-mil', 'Google News Military', gnSearchUrl('airstrike OR missile OR mobilization OR DEFCON when:1h'), 180),
  aggregator('gn-outage', 'Google News Outage', gnSearchUrl('"911 outage" OR "cell service" OR "internet outage" OR "banking outage" when:1h'), 180),
  aggregator('gn-ports', 'Google News Ports', gnSearchUrl('ILWU OR "Local 26" OR "port strike" Los Angeles OR "Long Beach" when:1d'), 300),
  aggregator('gn-rumor', 'Google News Rumor', gnSearchUrl('rumor OR hoax OR "fact check" election when:1d'), 300),
  // Named anchors for Nov. 3-4, from live coverage on 2026-10-30: DOJ subpoenas to L.A. County
  // election workers returnable Nov. 4, and the No Kings post-election call that night.
  aggregator('gn-subpoena', 'Google News Subpoenas', gnSearchUrl('"grand jury" subpoena election (workers OR officials) when:1d'), 180),
  aggregator('gn-polls', 'Google News Polling Sites', gnSearchUrl('("polling place" OR "polling site" OR "vote center") (evacuated OR shooting OR "bomb threat" OR "suspicious package" OR closed OR lockdown) when:1d'), 120),
  aggregator('gn-monitors', 'Google News Monitors', gnSearchUrl('"election monitors" OR "poll monitors" OR "federal agents" polling when:1d'), 180),
  aggregator('gn-nokings', 'Google News No Kings', gnSearchUrl('"No Kings" when:1d'), 300),
  aggregator('gn-iran', 'Google News Iran', gnSearchUrl('Iran (attack OR strike OR retaliation OR missile) "United States" when:1h'), 180),
  metro('Washington DC'),
  metro('New York'),
  metro('Los Angeles'),
  metro('Chicago'),
  metro('Philadelphia'),
  metro('Atlanta'),
  metro('Detroit'),
  metro('Phoenix'),
  metro('Milwaukee'),
  metro('Las Vegas'),
  metro('Houston'),
  metro('Miami'),

  // ── osint ───────────────────────────────────────────────────────────────
  row('osint', 'truth', 'truth', 'Trump Truth Social', 'https://trumpstruth.org/feed', 120, { pub: 'truthsocial.com' }),
  row('osint', 'rss', 'netblocks', 'NetBlocks', 'https://mastodon.social/@netblocks.rss', 300, { pub: 'netblocks.org', cat0: ['infra'] }),
  telegram('disclosetv', 'Disclose.tv'),
  telegram('insiderpaper', 'Insider Paper'),
  telegram('OSINTdefender', 'OSINTdefender'),
  telegram('Faytuks_Network', 'Faytuks Network'),
  telegram('ClashReport', 'Clash Report'),
  telegram('warmonitors', 'War Monitors'),
  telegram('CIG_telegram', 'CIG'),
  telegram('spravdi', 'Spravdi'),
  telegram('intelslava', 'Intel Slava'),
  telegram('nexta_live', 'NEXTA Live'),

  // ── social ──────────────────────────────────────────────────────────────
  row('social', 'rss', 'masto-election', 'Mastodon #election', 'https://mastodon.social/tags/election.rss', 300),
  row('social', 'rss', 'masto-uspol', 'Mastodon #uspol', 'https://mastodon.social/tags/uspol.rss', 300),
  row('social', 'rss', 'masto-breaking', 'Mastodon #breakingnews', 'https://mastodon.social/tags/breakingnews.rss', 300),
  row('social', 'hn', 'hn', 'Hacker News', 'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=30', 120, { pub: 'ycombinator.com' }),

  // ── signal ──────────────────────────────────────────────────────────────
  row('signal', 'rss', 'gtrends', 'Google Trends', 'https://trends.google.com/trending/rss?geo=US', 300, { pub: 'trends.google.com' }),
  statusPage('st-cloudflare', 'Cloudflare Status', 'https://www.cloudflarestatus.com/history.atom'),
  statusPage('st-aws', 'AWS Status', 'https://status.aws.amazon.com/rss/all.rss'),
  statusPage('st-gcp', 'Google Cloud Status', 'https://status.cloud.google.com/en/feed.atom'),
  statusPage('st-github', 'GitHub Status', 'https://www.githubstatus.com/history.atom'),
  statusPage('st-do', 'DigitalOcean Status', 'https://status.digitalocean.com/history.atom')
];

// A watch term from the owner becomes its own Google News query. The term is quoted so
// it stays a literal phrase; `"` is removed from it so it cannot break out of the quotes.
function customSource(term) {
  const clean = String(term).replace(/["\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return {
    id: 'custom:' + (slug || sha16(clean)),
    name: 'Watch: ' + clean,
    cls: 'aggregator',
    kind: 'gnews',
    url: gnSearchUrl('"' + clean + '" when:1d'),
    every: 300,
    term: clean
  };
}

module.exports = { SOURCES, gnSearchUrl, customSource, UA, UA_NWS, UA_BROWSER };
