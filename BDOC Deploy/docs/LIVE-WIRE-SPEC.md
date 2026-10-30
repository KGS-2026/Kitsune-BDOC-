# LIVE WIRE — real-time intelligence feed (owner-only)

Build p160. Directive from Travon, 2026-10-30: "I need to know in real time what is
going on… chatter and rumors about things happening on the 4th of November… there
should be a live scraper… as the owner I should be able to see everything in real
time."

This doc is the contract between the collector, the Netlify function and the client.
Change the contract here first.

## 0. Ground rules (non-negotiable)

1. **Every byte from a feed is hostile.** Headlines, posts and URLs are attacker-
   controlled. The client renders with `textContent` only; it never assigns
   `innerHTML` with feed data. URLs pass `safeUrl()` (http/https only) on BOTH the
   collector and the client. Feed text never goes into a Cesium `description`: the
   InfoBox iframe is `allow-scripts allow-same-origin`, so that is an account takeover.
   No images are loaded from feed URLs (a poster could log the owner's IP).
   Feed text is never passed to an LLM in this build (prompt injection).
2. **No inbound ports on the droplet.** It holds all of Hermes's secrets. The
   collector only makes outbound connections.
3. **Rumor is not fact.** Every item carries a truth status (§3). A social post on its
   own is `unverified`, caps at sev 1, and can never page. This is the whole point of
   the feature: separate chatter from confirmed reporting.
4. **No alert fatigue (Travon's P110 doctrine, 2026-08-04).** Everything lands in the
   feed. Only the catastrophic tier reaches Telegram.
5. **Backlog never alerts.** A restart or a first poll must not page anyone.
6. **Honest health.** A dead feed shows as dead. HTTP 200 with stale content is not
   "live" (CNN and WSJ World do exactly this today). Never display "LIVE" unless a
   heartbeat proves it.
7. **Zero npm dependencies in the daemon.** Node 22 built-ins only (fetch, WebSocket,
   node:sqlite, node:zlib, node:crypto).
8. **Headline + ≤280-char snippet + link only.** No full-article storage.
9. Daemon libs are CommonJS and importable on Node 20 (CI). `node:sqlite` is required
   lazily inside `store.js`; `WebSocket` is injected or read at runtime, never at import.

## 1. Architecture

```
 ~115 sources ─► bdoc-wire daemon (droplet, systemd, Node 22, /opt/bdoc-wire)
                  ingest → normalize → classify → cluster → store (SQLite)
                     │
                     ├─ every ≤2s ─► Supabase Realtime Broadcast (secret topic)
                     │                 └─► owner's browser, measured 30–114 ms
                     ├─ every 60s ─► POST /.netlify/functions/wire (Netlify Blobs)
                     │                 └─► owner GET: backfill + fallback poll
                     └─ catastrophic ► Telegram Bot API → Travon's phone
```

Why this shape: the droplet opens no port; Realtime gives real push; Blobs gives a
second independent path, so losing Realtime degrades to ~90 s latency, not silence.

## 2. Files

```
tools/wire/wire.js            daemon entry
tools/wire/lib/util.js        hash, decode, canonUrl, safeUrl, clamp, log
tools/wire/lib/sources.js     source catalog (data)
tools/wire/lib/fetcher.js     polite HTTP + scheduler + health
tools/wire/lib/parse.js       one parser per payload kind
tools/wire/lib/streams.js     Jetstream + Wikimedia consumers
tools/wire/lib/gdelt.js       GKG 15-min ingestion
tools/wire/lib/classify.js    categories, watch, severity, noise
tools/wire/lib/cluster.js     story clustering, truth status
tools/wire/lib/gazetteer.js   geocode()
tools/wire/lib/alert.js       page gate + Telegram sender
tools/wire/lib/store.js       SQLite persistence
tools/wire/lib/publish.js     Realtime batcher + snapshot poster
tools/wire/lib/pipeline.js    raw item → published item
tools/wire/dev-server.js      local harness for the UI (not deployed anywhere)
tools/wire/bdoc-wire.service  systemd unit
tools/wire/deploy.sh          install to /opt/bdoc-wire
tools/wire/README.md
netlify/functions/wire.mjs
netlify/functions/_lib/owner.mjs
js/bdoc-wire-boot.js          tiny owner probe + top-bar button (loaded for everyone)
js/bdoc-wire.js               the feed UI (loaded only when opened)
css/bdoc-wire.css
wire.html                     standalone page at /wire (phone, second monitor)
tests/wire-*.test.js
```

## 3. Data contract

### RawItem (parsers → pipeline)

```js
{ sid, sn, cls, guid, h, x, u, pt, pub, geo, cat0, sev0, firstPoll, off }
```
`sid` source id · `sn` display name (the PUBLISHER for aggregators, e.g. "Reuters") ·
`cls` source class · `guid` stable per-source id · `h` headline · `x` snippet ·
`u` url · `pt` published epoch ms or null · `pub` publisher domain, e.g. `reuters.com` ·
`geo` optional `{p,lat,lon,r,cc}` · `cat0`/`sev0` optional parser-supplied category
list and severity (official feeds know their own severity) · `firstPoll` true when this
source has never been polled in this DB · `off` true for official-state items.

### Item (published)

```js
{
  id:  '16-hex',            // sha1(canonical url || sid+guid), first 16 hex
  c:   '16-hex',            // cluster id: id of the first item in the story
  t:   1793377888000,       // when WE saw it. First-poll backfill: t = pt (so history sorts right)
  pt:  1793377800000,       // published, clamped to <= t. null if the source gives none
  src: 'bbc-us', sn: 'BBC', cls: 'wire',
  h:   'headline ≤240', x: 'snippet ≤280 or empty', u: 'https://…' /* or '' */,
  cat: ['unrest'],          // §4
  w:   ['nov4'],            // watch hits; custom terms as 'custom:<term>'
  sev: 0,                   // 0 info · 1 notable · 2 high · 3 critical
  st:  'reported',          // official | corroborated | reported | unverified | disputed
  n:   1,                   // independent publishers in the story
  geo: { p:'Long Beach, CA', lat:33.77, lon:-118.19, r:15000, cc:'US' }, // optional
  fresh: true               // pt within 45 min of t
}
```

Source classes (`cls`): `official` · `wire` · `specialist` · `aggregator` · `factcheck` ·
`osint` · `social` · `signal`.

**Truth status ladder** (computed per story):
- `official`: any item in the story from cls `official`.
- `corroborated`: ≥2 distinct publisher domains among wire/specialist/aggregator.
- `reported`: exactly 1 such publisher.
- `unverified`: only osint/social/signal.
- `disputed`: a `factcheck` item joined the story, or the headline itself says it is
  false (debunked, hoax, no evidence, fake, false claim). Disputed beats everything
  except official, and a disputed story never pages.

`sev` displayed = base severity capped by status: `unverified` → max 1. When wire
outlets later corroborate, the story's sev rises and an update goes out.

### Realtime (channel = `WIRE_TOPIC`, public broadcast, secret topic name)

- event `b`: `{ items: Item[], upd: [{c, st, n, sev}] }`. Flushed at most every 2 s;
  flushed immediately if any item has sev ≥ 2. Payload ≤ 200 KB (split if larger).
- event `hb` every 15 s: `{ ts, up, ok, total, items1m, official }`.

### Snapshot (POST to the function every 60 s)

```js
{ v:1, ts, generated:'ISO', items: Item[≤600], health, stats }
health = { ts, up, sources:[{id,n,cls,kind,every,ok,lastOk,lastErr,err,newest,c1h,c24h,fails}],
           streams:{ bsky:{ok,lastEvent,perMin}, wiki:{ok,lastEvent,perMin} } }
stats  = { items1m, items1h, perMin:{ <bucket>: [60 ints, oldest→newest] },
           official:{ ntas:{active,title}, faa:{stops,delays,closures,updated},
                      nws:{extreme,severe,civil}, usgs:{m6p24h} } }
```
Item selection: every sev ≥ 1 item from the last 24 h (up to 450), then fill by recency.
`perMin` buckets: `nov4 election unrest security infra cyber military rumor ports` plus
`custom:<term>`.

### Function `/.netlify/functions/wire`

| Call | Auth | Result |
|---|---|---|
| `GET ?probe=1` | Bearer JWT | `{owner:true}`, or `{owner:false}` for a valid non-owner (no blob read) |
| `GET` | Bearer owner JWT | `{owner:true, topic, snapshot, watch, ageSec}` |
| `POST` (snapshot) | header `x-wire-key` | stores it; replies `{ok:true, watch}` |
| `POST ?action=watch` `{terms:[…]}` | Bearer owner JWT | replaces custom terms; `{ok:true, watch}` |

No token or bad token → 401. Valid non-owner → 403, except the probe, which answers 200
`{owner:false}` so a paying customer's console stays clean. Fail CLOSED when `BDOC_OWNER_IDS` or
`WIRE_INGEST_KEY` is unset. Always `Cache-Control: no-store`. Owner is matched on the
Supabase user **id** (immutable), never on email or tier. Env: `BDOC_OWNER_IDS`
(comma-separated UUIDs), `WIRE_INGEST_KEY`, `WIRE_TOPIC`. Custom terms: ≤40, each 2–64
chars, literal phrases (never regex), control characters stripped.

Functions v2 `.mjs` is required for Blobs (see `push-subscribe.mjs`). Do not import the
CommonJS `guard.js` / `_supabase.js` from `.mjs`: esbuild's ESM output shims `require`
and a builtin require throws at call time. `_lib/owner.mjs` stands alone and reads the
same env names (`SUPABASE_URL`, default `https://ulgxbqhbgbyxlzoyxcus.supabase.co`;
anon key env `supabase`).

The service worker must NOT touch this path (no cache, ever): add a bare `return` beside
the `/ping` exception, so owner data never lands in Cache Storage.

## 4. Classification

Categories: `election` `unrest` `security` `military` `cyber` `infra` `disaster` `health`
`finance` `gov` `labor` `rumor`.

`classify({h,x,cls,cat0,sev0}) → { cat, w, sev, noise, drill, rumor, debunk, us }`

**Watch `nov4`.** Date mention regex covers: `Nov 4`, `Nov. 4`, `November 4`, `November
4th`, `4th of November`, `4 November`, `11/4`, `#nov4`, `#november4`. Then:
- Drop as noise if it is a date range (`Oct. 29-Nov. 4`, `Nov. 4-7`).
- Drop as noise when a routine-event term matches (meet, meeting, opens, open house,
  opener, playoff, game, match, tournament, concert, tour, festival, fair, workshop,
  webinar, earnings, results, dividend, book club, pantry, ceremony, auction, screening,
  premiere, launch, sale, expires, enrollment, board, commission, council, foliage,
  flashbacks, this week in history, birthdays, streaming, new movies) UNLESS a
  strong-signal term also matches (attack, threat, warning, rumor, plot, protest, march,
  strike, walkout, shutdown, blackout, outage, riot, unrest, emergency, evacuat, martial,
  insurrection, national guard, civil war, coup, false flag, cyber, bomb, shoot, terror,
  militia, collapse, bank run, something big, be prepared, stock up, get ready, it's
  happening).
- Exercises and drills are never signal.

Real fixtures that MUST behave (all pulled from live feeds on 2026-10-30):

| Headline | Expect |
|---|---|
| Planning and Zoning Commission to meet Nov. 4 | no nov4 |
| Forum Flashbacks: Oct. 29-Nov. 4 | no nov4 |
| EMU is Motor City MACtion Ready for Nov. 4 | no nov4 |
| Amcor (AMCR) Could Be 9% Undervalued Ahead Of November 4 Earnings | no nov4 |
| Temple airport to host emergency response exercise Nov. 4 | drill, no nov4 |
| Strike deadline at LA-LB ports expected to be delayed to Nov. 4: PMA | nov4 + ports + labor |
| Colorado National Guard has helped rescues 50 people and 20 pets amid flooding | sev ≤ 1 |
| National Guard Saves Goats From Flood | sev ≤ 1 |
| Zelensky Extends Martial Law and Mobilization Until 2027 | sev ≤ 1, us false |
| Court acquits ex-generals accused of planning martial law at burger joint | sev ≤ 1, us false |
| ACLU seeks emergency order over alleged voter intimidation at Las Vegas rec center | election, sev ≥ 1 |
| Trump invokes Insurrection Act | sev 3 |
| Fact Check: Does a punched hole in a Ventura County ballot envelope prove election rigging? | debunk, election |

**Severity.**
- **3 critical** requires an asserted event: martial law declared/imposed in the US,
  Insurrection Act invoked, national emergency declared, mass-casualty terror attack,
  nationwide blackout or outage, nuclear detonation, declaration of war, assassination
  of a senior official, attack on a polling place or election office with casualties,
  NTAS bulletin issued, CISA Emergency Directive, M7+ quake, Tsunami Warning, Nuclear
  Power Plant / Radiological Hazard Warning.
- **2 high**: riot, curfew, National Guard deployed for civil disorder, bomb threat at
  polling places, election office evacuated, active shooter, substation attack, cyberattack
  on critical infrastructure, port strike begins, M6+ quake, Civil Danger / Civil
  Emergency / Law Enforcement / Evacuation Immediate / Shelter In Place alerts.
- **1 notable**: protests, threats, election disputes, DOJ/court actions on the
  election, cyber incidents, military movements, any `nov4` or `rumor` hit.
- **0 info**: everything else. Kept, visible only in the ALL view.

Downgrades: conditional language (could, may, might, would, if, considers, weighs,
fears of, threat of, ahead of, plans to) drops sev 3 → 2. Retrospective language
(anniversary, years ago, trial, sentenced, appeal, acquit, convicted, history), opinion
or explainer forms (opinion, column, op-ed, analysis, explainer, what to know, how to,
guide, preview, podcast, quiz, review) cap at 1. Sports and entertainment cap at 0.
Drills, exercises and tests cap at 0.

**Rumor language** (`rumor` category and bucket): rumor, unconfirmed, unverified, "hearing
that", "reports of", insider says, leaked, "something big/bad is coming", "be prepared",
"stock up", "get your money out", "stay home", "false flag", "they don't want you to
know", combined with election, nov4, guard, martial, grid, bank or similar context.

**Firehose filter.** `prefilter(text)` is one compiled regex over all watch and strong
terms. Bluesky posts and Wikipedia titles that miss it are counted, never stored.

## 5. Clustering

`cluster.add(item) → { cluster, isNew, changed }`. Tokens: lowercase, strip the
` - Publisher` suffix Google News appends, drop stopwords, light plural stemming. Match
against stories from the last 12 h with an inverted index, using IDF-weighted overlap ≥
0.6 and ≥3 shared tokens. Prefer under-clustering: a miss means "reported" instead of
"corroborated", while a false match means a fake confirmation and could page someone.

Independent publishers are counted by registrable domain. Same publisher twice = 1.

## 6. Page gate (Telegram)

`shouldPage(cluster, ctx)` true only when ALL hold: base sev 3 · status `official` or
`corroborated` · not disputed · not drill · newest item `fresh` · no item in the story
is the only one from a `firstPoll` batch · daemon up > 5 min · story not already paged ·
≤6 pages/hour and ≤20/day. Message is plain text (no `parse_mode`, feed text is hostile):

```
BDOC WIRE — CRITICAL · CORROBORATED (3 outlets)
<headline>
<source> · <hh:mm> UTC
<url>
Live: https://kgsbdoc.netlify.app/wire
```

## 7. Source catalog (verified from the droplet 2026-10-30)

Fresh = newest item under 24 h with real content. Everything below passed that test
unless marked. `every` is seconds.

**official**
- `nws` https://api.weather.gov/alerts/active?status=actual&message_type=alert (60, kind nws). Keep severity Extreme/Severe plus the civil set; 229 of ~300 live alerts are marine noise (Gale Warning, Small Craft Advisory) and must be dropped. Civil set: Civil Danger Warning, Civil Emergency Message, Law Enforcement Warning, Local Area Emergency, Evacuation Immediate, Shelter In Place Warning, Nuclear Power Plant Warning, Radiological Hazard Warning, Hazardous Materials Warning, 911 Telephone Outage Emergency.
- `usgs` https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson (60, usgs)
- `emsc` https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=20&minmag=4.5 (120, emsc)
- `ntas` https://www.dhs.gov/ntas/1.1/alerts.xml (120, ntas). Empty `<alerts></alerts>` today means NO active advisory; that state is itself shown to the owner.
- `faa` https://nasstatus.faa.gov/api/airport-status-information (60, faa)
- `nhc-at` https://www.nhc.noaa.gov/index-at.xml · `nhc-ep` https://www.nhc.noaa.gov/index-ep.xml (300, rss)
- `cisa-adv` https://www.cisa.gov/cybersecurity-advisories/all.xml (900, rss; 5.7 MB)
- `cisa-news` https://www.cisa.gov/news.xml (600)
- `doj` https://www.justice.gov/news/rss?type=press_release&m=1 (300)
- `wh-news` https://www.whitehouse.gov/news/feed/ · `wh-actions` https://www.whitehouse.gov/presidential-actions/feed/ (180)
- `fedreg` https://www.federalregister.gov/api/v1/documents.rss?conditions%5Btype%5D%5B%5D=PRESDOCU&order=newest (600)
- `war-news` https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10 · `war-rel` same with ContentType=9 (300)
- `fed` https://www.federalreserve.gov/feeds/press_all.xml (600)
- `eac` https://www.eac.gov/rss.xml (1800)
- `un` https://news.un.org/feed/subscribe/en/news/all/rss.xml (300)
- `gdacs` https://www.gdacs.org/xml/rss.xml (300, rss with geo:lat/geo:long)
- `swpc` https://services.swpc.noaa.gov/products/alerts.json (300, swpc)
- `eonet` https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=20 (600, eonet)
- `fema` https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?%24orderby=declarationDate%20desc&%24top=10 (600, fema)

**wire** (rss)
60s: `bbc-top` https://feeds.bbci.co.uk/news/rss.xml · `bbc-us` https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml · `bbc-world` https://feeds.bbci.co.uk/news/world/rss.xml · `cbs-latest` https://www.cbsnews.com/latest/rss/main · `cbs-us` https://www.cbsnews.com/latest/rss/us · `cbs-pol` https://www.cbsnews.com/latest/rss/politics · `nyt-home` https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml · `nyt-us` https://rss.nytimes.com/services/xml/rss/nyt/US.xml · `nyt-pol` https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml · `nyt-world` https://rss.nytimes.com/services/xml/rss/nyt/World.xml
90s: `guardian-us` https://www.theguardian.com/us-news/rss · `guardian-world` https://www.theguardian.com/world/rss · `abc-top` https://abcnews.go.com/abcnews/topstories · `fox-latest` https://moxie.foxnews.com/google-publisher/latest.xml · `fox-us` https://moxie.foxnews.com/google-publisher/us.xml · `fox-pol` https://moxie.foxnews.com/google-publisher/politics.xml · `hill` https://thehill.com/news/feed/ · `hill-camp` https://thehill.com/homenews/campaign/feed/ · `aljazeera` https://www.aljazeera.com/xml/rss/all.xml
120s: `npr` https://feeds.npr.org/1001/rss.xml · `npr-pol` https://feeds.npr.org/1014/rss.xml · `nbc-top` https://feeds.nbcnews.com/nbcnews/public/news · `nbc-pol` https://feeds.nbcnews.com/nbcnews/public/politics · `politico` https://rss.politico.com/politics-news.xml · `bloom-pol` https://feeds.bloomberg.com/politics/news.rss · `bloom-mkts` https://feeds.bloomberg.com/markets/news.rss · `cnbc` https://www.cnbc.com/id/100003114/device/rss/rss.html
180s: `abc-us` https://abcnews.go.com/abcnews/usheadlines · `abc-pol` https://abcnews.go.com/abcnews/politicsheadlines · `wsj-us` https://feeds.content.dowjones.io/public/rss/RSSUSnews · `axios` https://api.axios.com/feed/ · `pbs` https://www.pbs.org/newshour/feeds/rss/headlines
300s: `dw` https://rss.dw.com/rdf/rss-en-world · `sky-world` https://feeds.skynews.com/feeds/rss/world.xml · `sky-us` https://feeds.skynews.com/feeds/rss/us.xml · `time` https://time.com/feed/
Via Google News (90s): `reuters` query `when:1h site:reuters.com` · `ap` query `when:1h site:apnews.com`

KNOWN DEAD, do not add: CNN rss (200 but newest item years old), WSJ RSSWorldNews (same), WaPo (502), Newsweek (406), Times of Israel (403), Kyiv Independent (404), France24 (html), Stripes (404), Lawfare (403), SPLC (403), ACLED (404), ISW (403), PolitiFact (404), FBI press (403), DHS news (404), FEMA news (403), HHS (403), OFAC (404), ReliefWeb (406), Reddit (403/429), Bing News (stale).

**specialist** (rss)
120s: `courthouse` https://www.courthousenews.com/feed/ · `votebeat` https://www.votebeat.org/arc/outboundfeeds/rss/
300s: `breakingdef` https://breakingdefense.com/feed/ · `defnews` https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml · `miltimes` https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml · `twz` https://www.twz.com/feed · `usni` https://news.usni.org/feed · `defone` https://www.defenseone.com/rss/all/ · `taskpurpose` https://taskandpurpose.com/feed/ · `record` https://therecord.media/feed · `bleeping` https://www.bleepingcomputer.com/feed/ · `cyberscoop` https://cyberscoop.com/feed/ · `secweek` https://www.securityweek.com/feed/ · `darkread` https://www.darkreading.com/rss.xml · `thn` https://feeds.feedburner.com/TheHackersNews · `krebs` https://krebsonsecurity.com/feed/ · `elb` https://electionlawblog.org/?feed=rss2
600s: `wotr` https://warontherocks.com/feed/ · `stateline` https://stateline.org/feed/ · `propublica` https://www.propublica.org/feeds/propublica/main · `justsec` https://www.justsecurity.org/feed/
1800s: `bellingcat` https://www.bellingcat.com/feed/ · `crisis` https://www.crisisgroup.org/rss.xml · `gnet` https://gnet-research.org/feed/

**factcheck** (rss, 300s): `fc-factcheck` https://www.factcheck.org/feed/ · `fc-leadstories` https://leadstories.com/atom.xml · `fc-snopes` https://www.snopes.com/feed/

**aggregator** (Google News RSS, kind `gnews`, 120–300s). Base
`https://news.google.com/rss/search?q=<q>&hl=en-US&gl=US&ceid=US:en`. Each item's publisher
comes from `<source url="…">Name</source>` and the title's ` - Publisher` suffix is
stripped. `sn` = publisher name, `pub` = publisher domain.
- `gn-top` https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en · `gn-us` https://news.google.com/rss/headlines/section/topic/NATION?hl=en-US&gl=US&ceid=US:en (120)
- `gn-nov4` `("November 4" OR "Nov. 4") (threat OR warning OR attack OR protest OR strike OR unrest OR emergency OR shutdown OR blackout OR rumor) when:1d` (180)
- `gn-election` `election (threat OR "bomb threat" OR "polling place" OR swatting OR "drop box" OR intimidation) when:1h` (120)
- `gn-guard` `"National Guard" OR "martial law" OR "Insurrection Act" when:1h` (120)
- `gn-unrest` `(protest OR riot OR curfew OR "state of emergency") United States when:1h` (120)
- `gn-grid` `blackout OR "power outage" OR substation OR "grid attack" when:1h` (180)
- `gn-cyber` `cyberattack OR ransomware OR "data breach" when:1h` (180)
- `gn-mil` `airstrike OR missile OR mobilization OR DEFCON when:1h` (180)
- `gn-outage` `"911 outage" OR "cell service" OR "internet outage" OR "banking outage" when:1h` (180)
- `gn-ports` `ILWU OR "Local 26" OR "port strike" Los Angeles OR "Long Beach" when:1d` (300)
- `gn-rumor` `rumor OR hoax OR "fact check" election when:1d` (300)
- Named Nov. 3-4 anchors from live coverage on 2026-10-30: `gn-subpoena`, `gn-polls`, `gn-monitors`, `gn-nokings`, `gn-iran`. Queries in `tools/wire/lib/sources.js`. Default custom watch terms live in `wire-core.mjs` until the owner first saves a list.
- Metro (300, kind gnews, url `https://news.google.com/rss/headlines/section/geo/<Place>?hl=en-US&gl=US&ceid=US:en`): Washington DC, New York, Los Angeles, Chicago, Philadelphia, Atlanta, Detroit, Phoenix, Milwaukee, Las Vegas, Houston, Miami.

**osint**: `truth` https://trumpstruth.org/feed (120, kind truth: third-party archive of Truth Social; the title is a placeholder like "Video post from October 30, 2026", so take the headline from the description) · `netblocks` https://mastodon.social/@netblocks.rss (300)
Telegram public previews (kind telegram, https://t.me/s/<channel>, browser UA, 120s, cls osint): disclosetv, insiderpaper, OSINTdefender, Faytuks_Network, ClashReport, warmonitors, CIG_telegram, spravdi, intelslava, nexta_live. Dead or empty, do not add: rawsalerts, AuroraIntel, BNONews, bellingcat, Breaking911, sentdefender, IntelCrab, NOELreports, AlertsUSA_News, GeoConfirmed.

**social**: `bsky` Bluesky Jetstream (wss://jetstream{1,2}.us-{east,west}.bsky.network/subscribe?wantedCollections=app.bsky.feed.post; ~48 posts/s, ~43 KB/s measured; failover across the 4 hosts; resume with `cursor`; ignore replies; per-DID cap 10/hour; link `https://bsky.app/profile/<did>/post/<rkey>`) · `masto-election` https://mastodon.social/tags/election.rss · `masto-uspol` https://mastodon.social/tags/uspol.rss · `masto-breaking` https://mastodon.social/tags/breakingnews.rss (300) · `hn` https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=30 (120, kind hn)

**signal**: `wiki` Wikimedia SSE https://stream.wikimedia.org/v2/stream/recentchange (enwiki, namespace 0: new-article titles matching an event pattern; edit surge ≥12 edits by ≥6 users in 10 min, once per title per 6 h) · `gtrends` https://trends.google.com/trending/rss?geo=US (300) · status pages (300, rss/atom): `st-cloudflare` https://www.cloudflarestatus.com/history.atom · `st-aws` https://status.aws.amazon.com/rss/all.rss · `st-gcp` https://status.cloud.google.com/en/feed.atom · `st-github` https://www.githubstatus.com/history.atom · `st-do` https://status.digitalocean.com/history.atom

**gdelt**: 15-min GKG. `http://data.gdeltproject.org/gdeltv2/lastupdate.txt`, then the zip from `https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/<stamp>.gkg.csv.zip`. Port the unzip and column logic from `netlify/functions/proxy-gdelt.js` (col 10 = V2Locations, lat at index 5; `<PAGE_TITLE>` in col 26). Emit ≤200 rows per file whose title hits `prefilter`. cls `aggregator`.

Politeness: honest UA `KitsuneBDOC-Wire/1.0 (+https://kgsbdoc.netlify.app)`; NWS needs a
contact in the UA (`support@kgsbdoc.netlify.app`). Conditional GET with ETag /
Last-Modified. Per-host gap 1.5 s for news.google.com, 3 s for t.me, 250 ms otherwise.
Global concurrency 8. Backoff on failure `min(every × 2^fails, 900 s)`, honoring
`Retry-After`. Body cap 8 MB. ±10 % jitter. Timeout 15 s.

## 8. Ingest rules

- Drop items with `pt` older than 72 h. Items older than 6 h are marked seen, not stored.
- First poll of a source: `firstPoll=true`, `t = pt ?? now`. Never pages.
- Dedupe by `id` across restarts (SQLite `seen`, kept 14 d). Items kept 30 d.
- A stalled stream reconnects: no message for 30 s on Jetstream or Wikimedia.
- Publishing never blocks ingest. Queues are bounded (5000) and drop oldest, and the
  drop count is reported in health.
- Custom watch terms arrive in the snapshot POST response. Each one adds a Google News
  source and extends the firehose filter without a restart.

## 9. Client

Two mounts of one module, `BDOCWire`:
- **Panel** in the main app: right side, like `#camPanel` (`position:fixed; top:0; right:0;
  bottom:0; width:560px; z-index:10500`). Opened from an owner-only `WIRE` status item
  in `.tb-r`. Row click flies the globe to `geo` (viewer global is `V`, not `viewer`).
- **Page** at `/wire`: full screen, phone-first, works without Cesium. Has its own
  sign-in (password + TOTP, same logic as `js/auth.js` lines ~150–173, ~265–281), and
  shares the session because it is the same origin and storage key.

Non-owners never see the button: `bdoc-wire-boot.js` probes once for signed-in users only,
on load and on `SIGNED_IN`. Never await Supabase inside `onAuthStateChange` (documented
deadlock, see `auth.js` p157 note): defer with `setTimeout(0)`. Attach the token
explicitly. `window.Auth` does not exist; use `window.BDOC_Auth.client`.

Connection: get the session → `GET wire` → render snapshot → subscribe to `topic` →
reconcile with `GET wire` every 60 s (30 s when the socket is down). Merging is idempotent
by `id`. Reconnect the channel with backoff.

Header (always visible): `● LIVE` only if a heartbeat arrived in the last 45 s, otherwise
`● DEGRADED` (polling) or `● COLLECTOR OFFLINE` with the age of the last heartbeat. Plus
sources ok/total and items in the last minute.

Views: `SIGNAL` (default: sev ≥ 1 or any watch hit) · `CHATTER` (osint + social) ·
`OFFICIAL` · `ALL`. Category filters. Text search. Min severity.

Row: time · status dot + status word · source · headline · category tags · `+N outlets`.
Unverified rows carry the word UNVERIFIED. Disputed rows carry DISPUTED. Critical rows
get a red left rule. Opens the source in a new tab with `rel="noopener noreferrer"`.

Side rail (desktop) / collapsible sections (phone): `STATE` (NTAS, FAA, NWS, USGS) ·
`WATCH` (per-bucket sparkline + per-minute rate, add/remove custom terms) · `SOURCES`
(health, dead ones first).

Limits: 2000 items in memory, 400 DOM rows, rAF batching, no reflow per item. When the
user has scrolled down, do not move the list; show `N NEW`. Sev 3: optional tone and
Notification, both off until the user turns them on. Relative times tick once per second
for visible rows only.

Design (`docs/hermes/bdoc-design-system.md`, as amended by p159): quiet gray chrome, one
amber accent `#E8B349`, danger `#DA3633`, ok `#3FB950`. Surfaces `#0E1116` `#13171F`
`#181D26`. Hairlines `rgba(255,255,255,0.07)`. Text `#E6E9EE` `#9BA1A8` `#5C636B`.
Radius 2–3 px. No glow, no glass, no emoji, no pills: status is a dot plus mono text.
Inter for UI, JetBrains Mono for data. Minimum text size 10 px. No inline scripts in
`wire.html`, so a future enforced CSP keeps working.

## 10. Daemon env

`WIRE_TOPIC` `WIRE_INGEST_KEY` `SUPABASE_URL` `SUPABASE_PUBLISHABLE_KEY` `WIRE_SITE`
(default https://kgsbdoc.netlify.app) `TELEGRAM_BOT_TOKEN` `TELEGRAM_CHAT_ID` `WIRE_DB`
(default /var/lib/bdoc-wire/wire.db). `WIRE_DRY=1` logs instead of publishing or paging.

systemd: `DynamicUser=yes`, `StateDirectory=bdoc-wire`, `EnvironmentFile=/etc/bdoc-wire/env`,
`Restart=always`, `RestartSec=3`, `MemoryMax=600M`, `CPUQuota=70%`, `NoNewPrivileges=yes`,
`ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `ProtectKernelTunables=yes`,
`ProtectControlGroups=yes`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`. It must
not be able to read `/root`.
