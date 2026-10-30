// Tests for tools/wire/lib/{util,sources,parse}.js.
//
// The XML, JSON and HTML below are short excerpts of what the live feeds actually served
// on 2026-10-30, not what their formats say they should serve. Where a fixture is built
// by hand instead (an active NTAS bulletin, a live ground stop) the test says so, because
// those states were not available to capture.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  sha16, clamp, decodeEntities, stripTags, cleanText, canonUrl, safeUrl, domainOf
} = require('../tools/wire/lib/util');
const { SOURCES, gnSearchUrl, customSource } = require('../tools/wire/lib/sources');
const { parseBy, KINDS } = require('../tools/wire/lib/parse');

const src = (id) => {
  const s = SOURCES.find((x) => x.id === id);
  assert.ok(s, 'no source ' + id);
  return s;
};

const RSS_SOURCE = { id: 't', name: 'Test', cls: 'wire', kind: 'rss', url: 'https://feeds.example.com/rss', every: 60 };

// ── util ────────────────────────────────────────────────────────────────────

test('sha16 is the first 16 hex of sha1', () => {
  assert.strictEqual(sha16('abc'), 'a9993e364706816a');
});

test('clamp bounds a number', () => {
  assert.strictEqual(clamp(5, 0, 3), 3);
  assert.strictEqual(clamp(-1, 0, 3), 0);
});

test('decodeEntities handles numeric, hex, named and refuses to throw', () => {
  assert.strictEqual(decodeEntities('A&#8211;B &#xA0;C &amp; D &rsquo;'), 'A–B  C & D ’');
  assert.strictEqual(decodeEntities('&#128512;'), '\u{1F600}');
  assert.strictEqual(decodeEntities('&#99999999;'), '', 'past U+10FFFF must not throw');
  assert.strictEqual(decodeEntities('&#xD800;'), '', 'lone surrogate');
  assert.strictEqual(decodeEntities('&#0;'), '');
  assert.strictEqual(decodeEntities('&constructor;'), '&constructor;', 'no prototype lookups');
  assert.strictEqual(decodeEntities('&amp;lt;'), '&lt;', 'one pass only');
  assert.strictEqual(decodeEntities(null), '');
});

test('stripTags removes markup and the contents of script and style', () => {
  assert.strictEqual(stripTags('<b>Bold</b> text'), 'Bold text');
  assert.strictEqual(stripTags('a<script>alert(1)</script>b').replace(/\s/g, ''), 'ab');
  assert.strictEqual(stripTags('a<style>x{}</style>b').replace(/\s/g, ''), 'ab');
  assert.strictEqual(stripTags('x < y and 1 > 0'), 'x < y and 1 > 0', 'a bare < is not a tag');
  assert.strictEqual(stripTags('safe<img src=x onerror=alert(1)'), 'safe', 'tag cut off by truncation');
  assert.strictEqual(stripTags('before<!-- <b>note</b> -->after').replace(/\s+/g, ''), 'beforeafter');
});

test('cleanText sees through double encoding', () => {
  assert.strictEqual(cleanText('&amp;lt;img src=x onerror=alert(1)&amp;gt;Hello'), 'Hello');
  assert.strictEqual(cleanText('&lt;script&gt;alert(1)&lt;/script&gt;Hi'), 'Hi');
  assert.strictEqual(cleanText('<scr<script></script>ipt>alert(1)</script>Hi').includes('<'), false);
});

test('cleanText removes bidi overrides, controls and zero-width splitters', () => {
  assert.strictEqual(cleanText('safe‮txt.exe'), 'safetxt.exe');
  assert.strictEqual(cleanText('⁦isolate⁩'), 'isolate');
  assert.strictEqual(cleanText('mart​ial l­aw'), 'martial law');
  assert.strictEqual(cleanText('a\u0000b\u0007c\u009Fd'), 'abcd');
  assert.strictEqual(cleanText('&#x202E;flipped'), 'flipped', 'decoded before it is removed');
  assert.strictEqual(cleanText('  one\n\n\ttwo\r\nthree  '), 'one two three');
  assert.strictEqual(cleanText('<p>one</p><p>two</p>'), 'one two', 'block tags do not glue words');
});

test('cleanText truncates to max and never splits a surrogate pair', () => {
  const out = cleanText('word '.repeat(200), 240);
  assert.ok(out.length <= 240, 'got ' + out.length);
  assert.ok(out.endsWith('…'));
  const emoji = cleanText('\u{1F600}'.repeat(200), 240);
  assert.ok(emoji.length <= 240);
  assert.strictEqual(JSON.stringify(emoji).includes('\\ud83d"'), false);
  assert.ok(!/[\uD800-\uDBFF]$/.test(emoji.replace(/…$/, '')), 'no dangling high surrogate');
  assert.strictEqual(cleanText('short', 240), 'short');
  assert.strictEqual(cleanText(null, 240), '');
});

test('safeUrl allows only http and https with a host', () => {
  assert.strictEqual(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.strictEqual(safeUrl('  http://example.com/  '), 'http://example.com/');
  for (const bad of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', 'ftp://x.com/',
    'mailto:a@b.c', '/relative', 'example.com', '', null, undefined, 42, {}
  ]) {
    assert.strictEqual(safeUrl(bad), '', 'should reject ' + String(bad));
  }
  assert.strictEqual(safeUrl('https://reuters.com@evil.example/'), '', 'credentials hide the real host');
  assert.strictEqual(safeUrl('https://example.com/' + 'a'.repeat(3000)), '', 'absurd length');
  assert.ok(!/\s/.test(safeUrl('https://example.com/a\nb')), 'never hands on a newline');
});

test('canonUrl drops trackers and fragments, lowercases the host, keeps the rest', () => {
  assert.strictEqual(
    canonUrl('https://www.bbc.co.uk/news/articles/ck62ydn7dj9eo?at_medium=RSS&at_campaign=rss'),
    'https://www.bbc.co.uk/news/articles/ck62ydn7dj9eo'
  );
  assert.strictEqual(canonUrl('https://EXAMPLE.com/a?utm_source=x&id=7&fbclid=y#frag'), 'https://example.com/a?id=7');
  assert.strictEqual(canonUrl('https://example.com/a?gclid=1&ref=2&cmpid=3&ocid=4&UTM_MEDIUM=5'), 'https://example.com/a');
  assert.strictEqual(canonUrl('https://example.com/a?reference=keep'), 'https://example.com/a?reference=keep');
  assert.strictEqual(canonUrl('javascript:alert(1)'), '');
  assert.strictEqual(canonUrl(''), '');
});

test('canonUrl gives the same bytes with and without a tracker', () => {
  assert.strictEqual(canonUrl('https://x.com/p?q=a%20b&utm_source=z'), canonUrl('https://x.com/p?q=a%20b'));
});

test('domainOf returns the registrable domain', () => {
  assert.strictEqual(domainOf('https://www.reuters.com/world/x'), 'reuters.com');
  assert.strictEqual(domainOf('https://news.un.org/feed'), 'un.org');
  assert.strictEqual(domainOf('https://www.bbc.co.uk/news'), 'bbc.co.uk');
  assert.strictEqual(domainOf('https://feeds.bbci.co.uk/news'), 'bbci.co.uk');
  assert.strictEqual(domainOf('https://www.abc.net.au/news'), 'abc.net.au');
  assert.strictEqual(domainOf('https://smh.com.au/'), 'smh.com.au');
  assert.strictEqual(domainOf('reuters.com'), 'reuters.com', 'a bare domain is accepted');
  assert.strictEqual(domainOf('https://t.me/s/x'), 't.me');
  assert.strictEqual(domainOf('https://1.2.3.4/x'), '1.2.3.4');
  assert.strictEqual(domainOf(''), '');
  assert.strictEqual(domainOf('not a url at all'), '');
});

// ── sources ─────────────────────────────────────────────────────────────────

const SPEC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'LIVE-WIRE-SPEC.md'), 'utf8');
const SECTION_7 = SPEC.slice(SPEC.indexOf('## 7. Source catalog'), SPEC.indexOf('Politeness:'));

test('catalog entries are well formed and ids are unique', () => {
  const classes = new Set(['official', 'wire', 'specialist', 'aggregator', 'factcheck', 'osint', 'social', 'signal']);
  const ids = new Set();
  for (const s of SOURCES) {
    assert.ok(!ids.has(s.id), 'duplicate ' + s.id);
    ids.add(s.id);
    assert.ok(classes.has(s.cls), s.id + ' cls ' + s.cls);
    assert.ok(KINDS.includes(s.kind), s.id + ' kind ' + s.kind);
    assert.ok(s.every >= 60, s.id + ' every');
    assert.ok(s.name, s.id + ' name');
    assert.ok(safeUrl(s.url), s.id + ' url');
  }
  assert.strictEqual(SOURCES.length, 138);
});

test('catalog has every feed url the spec lists', () => {
  const urls = new Set(SOURCES.map((s) => s.url));
  const listed = [...SECTION_7.matchAll(/https?:\/\/[^\s`)]+/g)].map((m) => m[0])
    .filter((u) => !/<|stream\.wikimedia|gdeltproject|storage\.googleapis|bsky\.app/.test(u))
    .filter((u) => u !== 'https://news.google.com/rss/search?q=');
  assert.ok(listed.length > 90, 'spec scrape found only ' + listed.length);
  for (const u of listed) assert.ok(urls.has(u), 'missing ' + u);
});

test('catalog uses each Google News query from the spec verbatim', () => {
  const rows = [...SECTION_7.matchAll(/`(gn-[a-z0-9]+)` `([^`]+)` \((\d+)\)/g)];
  assert.strictEqual(rows.length, 10);
  for (const [, id, q, every] of rows) {
    assert.strictEqual(src(id).url, gnSearchUrl(q), id);
    assert.strictEqual(src(id).every, Number(every), id);
    assert.strictEqual(src(id).kind, 'gnews', id);
  }
  assert.strictEqual(src('reuters').url, gnSearchUrl('when:1h site:reuters.com'));
  assert.strictEqual(src('reuters').cls, 'wire');
  assert.strictEqual(src('ap').url, gnSearchUrl('when:1h site:apnews.com'));
  assert.strictEqual(src('ap').every, 90);
});

test('catalog keeps the spec polling intervals and special UAs', () => {
  assert.strictEqual(src('nws').every, 60);
  assert.strictEqual(src('bbc-us').every, 60);
  assert.strictEqual(src('guardian-us').every, 90);
  assert.strictEqual(src('npr').every, 120);
  assert.strictEqual(src('axios').every, 180);
  assert.strictEqual(src('dw').every, 300);
  assert.strictEqual(src('cisa-adv').every, 900);
  assert.strictEqual(src('eac').every, 1800);
  assert.strictEqual(src('gnet').every, 1800);
  assert.match(src('nws').ua, /support@kgsbdoc\.netlify\.app/);
  assert.match(src('tg-disclosetv').ua, /^Mozilla/);
  assert.strictEqual(src('tg-disclosetv').url, 'https://t.me/s/disclosetv');
  assert.strictEqual(src('tg-disclosetv').cls, 'osint');
  assert.strictEqual(src('war-rel').url, 'https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=9&Site=945&max=10');
});

test('catalog has the 12 metros, 10 telegram channels and none of the known dead', () => {
  assert.strictEqual(SOURCES.filter((s) => s.id.startsWith('gn-metro-')).length, 12);
  assert.strictEqual(src('gn-metro-washington-dc').url, 'https://news.google.com/rss/headlines/section/geo/Washington%20DC?hl=en-US&gl=US&ceid=US:en');
  assert.strictEqual(SOURCES.filter((s) => s.kind === 'telegram').length, 10);
  for (const dead of ['rawsalerts', 'AuroraIntel', 'BNONews', 'sentdefender', 'GeoConfirmed']) {
    assert.ok(!SOURCES.some((s) => s.url.includes('t.me/s/' + dead)), dead);
  }
  for (const dead of ['cnn.com', 'RSSWorldNews', 'washingtonpost.com', 'newsweek.com', 'reddit.com', 'bing.com', 'france24.com']) {
    assert.ok(!SOURCES.some((s) => s.url.includes(dead)), dead);
  }
  for (const stream of ['bsky', 'wiki', 'gdelt']) assert.ok(!SOURCES.some((s) => s.id === stream), stream);
});

test('gnSearchUrl encodes the query', () => {
  assert.strictEqual(
    gnSearchUrl('"a b" when:1d'),
    'https://news.google.com/rss/search?q=%22a%20b%22%20when%3A1d&hl=en-US&gl=US&ceid=US:en'
  );
});

test('customSource builds a quoted one-day Google News query', () => {
  const s = customSource('Port of Long Beach');
  assert.strictEqual(s.id, 'custom:port-of-long-beach');
  assert.strictEqual(s.cls, 'aggregator');
  assert.strictEqual(s.kind, 'gnews');
  assert.strictEqual(s.every, 300);
  assert.strictEqual(s.url, gnSearchUrl('"Port of Long Beach" when:1d'));
});

test('customSource cannot break out of its quotes and copes with non-Latin terms', () => {
  assert.strictEqual(customSource('a" OR "b').url, gnSearchUrl('"a OR b" when:1d'));
  const s = customSource('выборы');
  assert.match(s.id, /^custom:[0-9a-f]{16}$/);
});

// ── rss ─────────────────────────────────────────────────────────────────────

const BBC = `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
    <channel>
        <title><![CDATA[BBC News]]></title>
        <link>https://www.bbc.co.uk/news/world/us_and_canada</link>
        <item>
            <title><![CDATA[US inmate Christa Pike says she woke up 'confused and in pain' after failed execution]]></title>
            <description><![CDATA[It is Pike's first public statement since she survived an execution attempt by lethal injection in September. ]]></description>
            <link>https://www.bbc.co.uk/news/articles/ck62ydn7dj9eo?at_medium=RSS&amp;at_campaign=rss</link>
            <guid isPermaLink="false">https://www.bbc.co.uk/news/articles/ck62ydn7dj9eo#0</guid>
            <pubDate>Fri, 30 Oct 2026 15:59:17 GMT</pubDate>
            <media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/x.jpg"/>
        </item>
    </channel></rss>`;

test('rss: BBC item from the live feed', () => {
  const [item, ...rest] = parseBy('rss', BBC, src('bbc-us'));
  assert.strictEqual(rest.length, 0);
  assert.strictEqual(item.sid, 'bbc-us');
  assert.strictEqual(item.sn, 'BBC');
  assert.strictEqual(item.cls, 'wire');
  assert.strictEqual(item.guid, 'https://www.bbc.co.uk/news/articles/ck62ydn7dj9eo#0');
  assert.strictEqual(item.h, "US inmate Christa Pike says she woke up 'confused and in pain' after failed execution");
  assert.match(item.x, /^It is Pike's first public statement/);
  assert.strictEqual(item.u, 'https://www.bbc.co.uk/news/articles/ck62ydn7dj9eo?at_medium=RSS&at_campaign=rss');
  assert.strictEqual(item.pt, Date.UTC(2026, 9, 30, 15, 59, 17));
  assert.strictEqual(item.pub, 'bbc.co.uk');
  assert.strictEqual(item.firstPoll, false);
  assert.strictEqual(item.off, false);
  assert.strictEqual(item.geo, undefined);
  assert.strictEqual(item.sev0, undefined, 'unknown severity stays unset for classify.js');
});

const WH = `<rss version="2.0"><channel>
	<title>Presidential Actions &#8211; The White House</title>
	<item>
		<title>ADJUSTING IMPORTS OF ROBOTICS, INDUSTRIAL MACHINERY, AND THEIR PARTS</title>
		<link>https://www.whitehouse.gov/presidential-actions/2026/10/adjusting-imports/</link>
		<dc:creator><![CDATA[The White House]]></dc:creator>
		<pubDate>Wed, 28 Oct 2026 20:03:48 +0000</pubDate>
		<guid isPermaLink="false">https://www.whitehouse.gov/?p=53657</guid>
		<description><![CDATA[<p>BY THE PRESIDENT OF THE UNITED STATES OF AMERICA A PROCLAMATION 1. &#160;Within the past 90 days, the Secretary of Commerce [&#8230;]</p>
<p>The post <a href="https://www.whitehouse.gov/presidential-actions/2026/10/adjusting-imports/">ADJUSTING IMPORTS</a> appeared first on <a href="https://www.whitehouse.gov">The White House</a>.</p>
]]></description>
		<content:encoded><![CDATA[<div class="wp-block"><form role="search"><input></form><p>The full proclamation.</p></div>]]></content:encoded>
	</item>
</channel></rss>`;

test('rss: WordPress footer is removed and content:encoded is not used over description', () => {
  const [item] = parseBy('rss', WH, src('wh-actions'));
  assert.ok(!/appeared first on/.test(item.x), item.x);
  assert.match(item.x, /^BY THE PRESIDENT/);
  assert.ok(!item.x.includes('full proclamation'));
  assert.strictEqual(item.pt, Date.UTC(2026, 9, 28, 20, 3, 48));
  assert.strictEqual(item.off, true);
  assert.deepStrictEqual(item.cat0, ['gov']);
  assert.strictEqual(item.pub, 'whitehouse.gov');
});

const CLOUDFLARE = `<feed xml:lang="en-US" xmlns="http://www.w3.org/2005/Atom">
  <id>tag:www.cloudflarestatus.com,2005:/history</id>
  <link href="https://www.cloudflarestatus.com" rel="alternate" type="text/html"></link>
  <link href="https://www.cloudflarestatus.com/history.atom" rel="self" type="application/atom+xml"></link>
  <title>Cloudflare Status Status - Incident History</title>
  <entry>
    <id>tag:www.cloudflarestatus.com,2005:Incident/eg60wd5v5fn7</id>
    <published>2026-11-06T06:00:00Z</published>
    <updated>2026-10-28T18:09:57Z</updated>
    <link href="https://www.cloudflarestatus.com/incidents/eg60wd5v5fn7" rel="alternate" type="text/html"></link>
    <title>EWR (Newark) on 2026-11-06</title>
    <content type="html">&lt;p&gt;&lt;small&gt;Oct &lt;var data-var=&#39;date&#39;&gt;28&lt;/var&gt;, &lt;var data-var=&#39;time&#39;&gt;18:09&lt;/var&gt; UTC&lt;/small&gt;&lt;br&gt;&lt;strong&gt;Scheduled&lt;/strong&gt; - We will be performing scheduled maintenance in EWR (Newark) datacenter on 2026-11-06.&lt;/p&gt;</content>
  </entry>
</feed>`;

const GITHUB = `<feed xml:lang="en-US" xmlns="http://www.w3.org/2005/Atom">
  <link rel="alternate" type="text/html" href="https://www.githubstatus.com"/>
  <link rel="self" type="application/atom+xml" href="https://www.githubstatus.com/history.atom"/>
  <title>GitHub Status - Incident History</title>
  <entry>
    <id>tag:www.githubstatus.com,2005:Incident/31803952</id>
    <published>2026-10-30T15:02:51Z</published>
    <updated>2026-10-30T15:02:51Z</updated>
    <link rel="alternate" type="text/html" href="https://www.githubstatus.com/incidents/nxy2l0ssxm10"/>
    <title>Disruption with GitHub services</title>
    <content type="html">&lt;p&gt; &lt;small&gt;Oct &lt;var data-var='date'&gt;30&lt;/var&gt;, &lt;var data-var='time'&gt;15:02&lt;/var&gt; UTC&lt;/small&gt;&lt;br&gt; &lt;strong&gt;Resolved&lt;/strong&gt; - This incident has been resolved. &lt;/p&gt;</content>
  </entry>
</feed>`;

test('atom: a real incident uses href, the alternate link and the entry id', () => {
  const [item] = parseBy('rss', GITHUB, src('st-github'));
  assert.strictEqual(item.h, 'Disruption with GitHub services');
  assert.strictEqual(item.u, 'https://www.githubstatus.com/incidents/nxy2l0ssxm10');
  assert.strictEqual(item.guid, 'tag:www.githubstatus.com,2005:Incident/31803952');
  assert.strictEqual(item.pt, Date.UTC(2026, 9, 30, 15, 2, 51));
  assert.match(item.x, /Resolved - This incident has been resolved/);
  assert.deepStrictEqual(item.cat0, ['infra']);
});

test('status page: planned maintenance is not a live signal', () => {
  assert.deepStrictEqual(parseBy('rss', CLOUDFLARE, src('st-cloudflare')), []);
});

test('atom: a future <published> falls back to <updated>', () => {
  const [item] = parseBy('rss', CLOUDFLARE, RSS_SOURCE);
  assert.strictEqual(item.pt, Date.UTC(2026, 9, 28, 18, 9, 57));
  assert.strictEqual(item.u, 'https://www.cloudflarestatus.com/incidents/eg60wd5v5fn7');
});

const DW_RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
 <channel rdf:about="https://rss.dw.com/syndication/feeds/rss-en-world.4025.rdf">
  <title>World | Deutsche Welle</title>
  <dc:date>2026-10-30T17:05:29Z</dc:date>
  <items>
   <rdf:Seq>
    <rdf:li rdf:resource="https://www.dw.com/en/seoul-fears/a-79808098?maca=en-rss-en-world-4025-rdf"/>
   </rdf:Seq>
  </items>
 </channel>
 <item rdf:about="https://www.dw.com/en/seoul-fears/a-79808098?maca=en-rss-en-world-4025-rdf">
  <title>Seoul fears being sidelined as US reaches out to North Korea</title>
  <link>https://www.dw.com/en/seoul-fears/a-79808098?maca=en-rss-en-world-4025-rdf</link>
  <description>South Korea is watching talks closely.</description>
  <dc:date>2026-10-30T15:00:00Z</dc:date>
 </item>
</rdf:RDF>`;

test('rdf: DW items parse, the <items> index is not mistaken for an item, dc:date is used', () => {
  const items = parseBy('rss', DW_RDF, src('dw'));
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].h, 'Seoul fears being sidelined as US reaches out to North Korea');
  assert.strictEqual(items[0].pt, Date.UTC(2026, 9, 30, 15, 0, 0));
  assert.strictEqual(items[0].pub, 'dw.com');
});

const GDACS = `<rss version="2.0" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#" xmlns:gdacs="http://www.gdacs.org"><channel>
    <title>GDACS RSS information</title>
    <item>
      <title>Green earthquake (Magnitude 5.7M, Depth:10km) in Papua New Guinea 29/10/2026 03:26 UTC, Few people affected (in MMI&gt;=VII).</title>
      <description>On 10/29/2026 3:26:42 AM, an earthquake occurred in Papua New Guinea.</description>
      <link>http://www.gdacs.org/report.aspx?eventtype=EQ&amp;eventid=1574467</link>
      <pubDate>Thu, 29 Oct 2026 03:41:37 GMT</pubDate>
      <guid isPermaLink="false">EQ1574467</guid>
      <geo:Point>
        <geo:lat>-5.6991</geo:lat>
        <geo:long>141.9018</geo:long>
      </geo:Point>
      <gdacs:alertlevel>Green</gdacs:alertlevel>
      <gdacs:country>Papua New Guinea</gdacs:country>
      <gdacs:eventname />
    </item>
    <item>
      <title>Red cyclone in Madagascar</title>
      <link>http://www.gdacs.org/report.aspx?eventtype=TC&amp;eventid=1</link>
      <pubDate>Thu, 29 Oct 2026 04:00:00 GMT</pubDate>
      <guid isPermaLink="false">TC1</guid>
      <geo:Point><geo:lat>-18.1</geo:lat><geo:long>47.5</geo:long></geo:Point>
      <gdacs:alertlevel>Red</gdacs:alertlevel>
      <gdacs:country>Madagascar</gdacs:country>
    </item>
</channel></rss>`;

test('rss: GDACS gets geo:lat, geo:long, its colour as severity, and keeps its text', () => {
  const [green, red] = parseBy('rss', GDACS, src('gdacs'));
  assert.deepStrictEqual(green.geo, { p: 'Papua New Guinea', lat: -5.6991, lon: 141.9018, r: 50000 });
  assert.strictEqual(green.sev0, 0);
  assert.strictEqual(red.sev0, 2);
  assert.deepStrictEqual(green.cat0, ['disaster']);
  assert.match(green.h, /MMI>=VII/, 'an escaped > in a title is not a tag');
  assert.strictEqual(green.u, 'http://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1574467');
  assert.strictEqual(green.off, true);
});

const MASTODON = `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
    <title>#election</title>
    <item>
      <guid isPermaLink="true">https://sfba.social/@andybrwn/117530781007414809</guid>
      <link>https://sfba.social/@andybrwn/117530781007414809</link>
      <pubDate>Fri, 30 Oct 2026 16:23:15 +0000</pubDate>
      <description>&lt;p&gt;Justice Department subpoenas California &lt;a href="https://sfba.social/tags/election" class="mention hashtag" rel="nofollow noopener" target="_blank"&gt;#&lt;span&gt;election&lt;/span&gt;&lt;/a&gt; workers in probe of noncitizen voting&lt;/p&gt;</description>
      <category>election</category>
    </item>
</channel></rss>`;

test('rss: Mastodon has no <title>, so the post text becomes the headline', () => {
  const [item] = parseBy('rss', MASTODON, src('masto-election'));
  assert.strictEqual(item.h, 'Justice Department subpoenas California #election workers in probe of noncitizen voting');
  assert.strictEqual(item.x, '');
  assert.strictEqual(item.u, 'https://sfba.social/@andybrwn/117530781007414809');
  assert.strictEqual(item.pub, 'sfba.social');
  assert.strictEqual(item.cls, 'social');
});

test('rss: a post too long for a headline spills into the snippet', () => {
  const body = 'First sentence of this long post is a good headline for it. ' + 'Then a lot more text follows here. '.repeat(20);
  const xml = `<rss><channel><item><link>https://m.example/@a/1</link><description>${body}</description></item></channel></rss>`;
  const [item] = parseBy('rss', xml, RSS_SOURCE);
  assert.strictEqual(item.h, 'First sentence of this long post is a good headline for it.');
  assert.match(item.x, /^Then a lot more text/);
  assert.ok(item.x.length <= 280);
});

const TRENDS = `<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel>
		<title>Daily Search Trends</title>
		<item>
			<title>konyaspor - galatasaray</title>
			<ht:approx_traffic>1000+</ht:approx_traffic>
			<description/>
			<link>https://trends.google.com/trending/rss?geo=US</link>
			<pubDate>Fri, 30 Oct 2026 09:30:00 -0700</pubDate>
			<ht:news_item>
				<ht:news_item_title>Galatasaray&apos;da Osimhen gelismesi!</ht:news_item_title>
				<ht:news_item_snippet/>
				<ht:news_item_url>https://www.hurriyet.com.tr/sporarena/x-43360660</ht:news_item_url>
			</ht:news_item>
		</item>
		<item>
			<title>dwyane wade statue</title>
			<description/>
			<link>https://trends.google.com/trending/rss?geo=US</link>
			<pubDate>Fri, 30 Oct 2026 09:30:00 -0700</pubDate>
			<ht:news_item>
				<ht:news_item_title>Heat unveil updated Dwyane Wade statue</ht:news_item_title>
				<ht:news_item_url>https://www.espn.com/nba/story/_/id/50328871/heat</ht:news_item_url>
			</ht:news_item>
		</item>
</channel></rss>`;

test('rss: Trends items do not collapse into one, though the feed gives them all one link', () => {
  const items = parseBy('rss', TRENDS, src('gtrends'));
  assert.strictEqual(items.length, 2);
  const urls = items.map((i) => canonUrl(i.u));
  assert.notStrictEqual(urls[0], urls[1], 'the url is the item identity');
  assert.ok(urls.every(Boolean));
  assert.notStrictEqual(items[0].guid, items[1].guid);
  assert.strictEqual(items[0].x, "Galatasaray'da Osimhen gelismesi!");
  assert.strictEqual(items[0].pt, Date.UTC(2026, 9, 30, 16, 30, 0));
  assert.strictEqual(parseBy('rss', TRENDS, src('gtrends'))[0].guid, items[0].guid, 'guid is stable');
});

test('rss: a link repeated across items is dropped so items keep their own identity', () => {
  const xml = `<rss><channel>
    <item><title>Service impact: Increased invoke error rates</title><link>https://status.aws.amazon.com/</link><guid isPermaLink="false">https://status.aws.amazon.com/#apigateway-us-west-2_1793323718</guid><pubDate>Thu, 29 Oct 2026 18:28:38 PDT</pubDate></item>
    <item><title>Service disruption: Multiple services</title><link>https://status.aws.amazon.com/</link><guid isPermaLink="false">https://status.aws.amazon.com/#multipleservices-me-central-1_1789468030</guid></item>
  </channel></rss>`;
  const items = parseBy('rss', xml, src('st-aws'));
  assert.strictEqual(items.length, 2);
  assert.ok(items.every((i) => i.u === ''));
  assert.notStrictEqual(items[0].guid, items[1].guid);
  assert.strictEqual(items[0].pt, Date.parse('2026-10-29T18:28:38-07:00'), 'PDT parses');
});

test('rss: a lone item linking to the site root still has no url identity', () => {
  const xml = `<rss><channel><item><title>Incident</title><link>https://status.aws.amazon.com/</link><guid isPermaLink="false">a1</guid></item></channel></rss>`;
  const [item] = parseBy('rss', xml, src('st-aws'));
  assert.strictEqual(item.u, '', 'a shared root url would dedupe every later incident');
  assert.strictEqual(item.guid, 'a1');
});

const NHC = `<rss version="2.0"><channel>
    <title>NHC Atlantic</title>
    <item>
      <title>Atlantic Tropical Weather Outlook</title>
      <description><![CDATA[869 <br />ABNT20 KNHC 301118<br />Tropical cyclone formation is not expected.]]></description>
      <pubDate>Fri, 30 Oct 2026 11:18:59 GMT</pubDate>
      <link>https://www.nhc.noaa.gov/gtwo.php?basin=atlc</link>
      <guid>https://www.nhc.noaa.gov/gtwo.php?basin=atlc&amp;202610301118</guid>
    </item>
    <item>
      <title>There are no tropical cyclones at this time.</title>
      <description>No tropical cyclones as of Fri, 30 Oct 2026 17:10:14 GMT</description>
      <pubDate>Sat, 31 Oct 2026 23:18:59 GMT</pubDate>
      <link>https://www.nhc.noaa.gov/</link>
      <guid>https://www.nhc.noaa.gov/</guid>
    </item>
</channel></rss>`;

test('rss: NHC keeps a url per issuance so a new advisory is a new item', () => {
  const [outlook, none] = parseBy('rss', NHC, src('nhc-at'));
  assert.strictEqual(outlook.u, 'https://www.nhc.noaa.gov/gtwo.php?basin=atlc&202610301118');
  assert.strictEqual(none.u, '');
  assert.deepStrictEqual(outlook.cat0, ['disaster']);
});

test('rss: CISA Emergency Directive is sev 3, follow-up paperwork is not', () => {
  const xml = (title) => `<rss><channel><item><title>${title}</title><link>https://www.cisa.gov/a</link></item></channel></rss>`;
  assert.strictEqual(parseBy('rss', xml('ED 26-03: Emergency Directive on Cisco devices'), src('cisa-adv'))[0].sev0, 3);
  assert.strictEqual(parseBy('rss', xml('Supplemental Direction for Emergency Directive 24-01'), src('cisa-adv'))[0].sev0, undefined);
  assert.strictEqual(parseBy('rss', xml('Emergency Directive at a bakery'), RSS_SOURCE)[0].sev0, undefined, 'only CISA feeds');
});

// ── gnews ───────────────────────────────────────────────────────────────────

const GNEWS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><generator>NFE/5.0</generator><title>"ILWU OR "port strike" when:7d" - Google News</title><link>https://news.google.com/search?q=ILWU</link><item><title>ILWU Watchmen May Strike at LA/Long Beach, With Effects on Half the Port - The Maritime Executive</title><link>https://news.google.com/rss/articles/CBMirwFBVV95cUxObHBhd2F5?oc=5</link><guid isPermaLink="false">CBMirwFBVV95cUxObHBhd2F5</guid><pubDate>Wed, 28 Oct 2026 03:36:55 GMT</pubDate><description>&lt;a href="https://news.google.com/rss/articles/CBMirwFBVV95cUxObHBhd2F5?oc=5" target="_blank"&gt;ILWU Watchmen May Strike at LA/Long Beach, With Effects on Half the Port&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;The Maritime Executive&lt;/font&gt;</description><source url="https://maritime-executive.com">The Maritime Executive</source></item><item><title>Trump wins - again - and again - National Association of Wholesaler-Distributors</title><link>https://news.google.com/rss/articles/CBMi2?oc=5</link><guid isPermaLink="false">CBMi2</guid><pubDate>Wed, 28 Oct 2026 04:00:00 GMT</pubDate><description>x</description><source url="https://www.naw.org">National Association of Wholesaler-Distributors</source></item></channel></rss>`;

test('gnews: publisher comes from <source> and the suffix leaves the title', () => {
  const [a, b] = parseBy('gnews', GNEWS, src('gn-ports'));
  assert.strictEqual(a.h, 'ILWU Watchmen May Strike at LA/Long Beach, With Effects on Half the Port');
  assert.strictEqual(a.sn, 'The Maritime Executive');
  assert.strictEqual(a.pub, 'maritime-executive.com');
  assert.strictEqual(a.cls, 'aggregator');
  assert.strictEqual(a.guid, 'CBMirwFBVV95cUxObHBhd2F5');
  assert.strictEqual(a.u, 'https://news.google.com/rss/articles/CBMirwFBVV95cUxObHBhd2F5?oc=5');
  assert.strictEqual(a.x, '', 'the description only repeats the title');
  assert.strictEqual(a.pt, Date.UTC(2026, 9, 28, 3, 36, 55));
  assert.strictEqual(b.h, 'Trump wins - again - and again', 'only the publisher suffix goes');
  assert.strictEqual(b.pub, 'naw.org');
});

test('gnews: a hyphen in a headline survives when the tail is not the publisher', () => {
  const xml = `<rss><channel><item><title>Markets slide - analysts warn of more</title><link>https://news.google.com/rss/articles/A</link><source url="https://www.reuters.com">Reuters</source></item></channel></rss>`;
  assert.strictEqual(parseBy('gnews', xml, src('reuters'))[0].h, 'Markets slide - analysts warn of more');
});

test('gnews: Reuters via Google stays a wire item, and a source-less item recovers the name', () => {
  const xml = `<rss><channel><item><title>Fed holds rates - Reuters</title><link>https://news.google.com/rss/articles/B</link><guid>B</guid><source url="https://www.reuters.com">Reuters</source></item></channel></rss>`;
  const [item] = parseBy('gnews', xml, src('reuters'));
  assert.strictEqual(item.cls, 'wire');
  assert.strictEqual(item.sn, 'Reuters');
  assert.strictEqual(item.pub, 'reuters.com');
  const noSource = `<rss><channel><item><title>Fed holds rates - Reuters</title><link>https://news.google.com/rss/articles/C</link></item></channel></rss>`;
  assert.strictEqual(parseBy('gnews', noSource, src('gn-top'))[0].h, 'Fed holds rates');
});

test('publisher domains agree between a direct feed and Google News', () => {
  const direct = parseBy('rss', BBC, src('bbc-us'))[0].pub;
  const viaGoogle = parseBy('gnews', `<rss><channel><item><title>A - BBC</title><link>https://news.google.com/rss/articles/D</link><source url="https://www.bbc.com">BBC</source></item></channel></rss>`, src('gn-top'))[0].pub;
  assert.strictEqual(direct, viaGoogle, 'the BBC must not corroborate itself');
  const abc = parseBy('gnews', `<rss><channel><item><title>A - ABC News</title><link>https://news.google.com/rss/articles/E</link><source url="https://abcnews.go.com">ABC News</source></item></channel></rss>`, src('gn-top'))[0].pub;
  assert.strictEqual(abc, src('abc-us').pub);
  const sky = parseBy('gnews', `<rss><channel><item><title>A - Sky News</title><link>https://news.google.com/rss/articles/F</link><source url="https://news.sky.com">Sky News</source></item></channel></rss>`, src('gn-top'))[0].pub;
  assert.strictEqual(sky, src('sky-us').pub);
});

// ── telegram ────────────────────────────────────────────────────────────────

const TG = `<main class="tgme_main" data-url="/disclosetv"><section class="tgme_channel_history js-message_history">
<div class="tgme_widget_message_centered js-messages_more_wrap"><a href="/s/disclosetv?before=21975" class="tme_messages_more js-messages_more" data-before="21975"></a></div><div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="disclosetv/21975" data-view="eyJjIjotMTE3">
  <div class="tgme_widget_message_bubble">
    <div class="tgme_widget_message_author accent_color"><a class="tgme_widget_message_owner_name" href="https://t.me/disclosetv"><span dir="auto">Disclose.tv</span></a></div>
<div class="tgme_widget_message_text js-message_text" dir="auto">NEW - NBA announces partnership with Kalshi and  Polymarket.<br/><br/>Read here: <a href="https://www.disclose.tv/id/vqcczacds0/" target="_blank" rel="noopener">https://www.disclose.tv/id/vqcczacds0/</a><br/><br/><a href="https://t.me/disclostv" target="_blank">@disclostv</a></div><a class="tgme_widget_message_link_preview" href="https://disclose.tv/id/vqcczacds0">
  <div class="link_preview_title" dir="auto">NBA announces partnership with prediction markets Kalshi, Polymarket</div>
</a>
<div class="tgme_widget_message_footer compact js-message_footer">
  <div class="tgme_widget_message_info short js-message_info">
    <span class="tgme_widget_message_views">60.3K</span><span class="copyonly"> views</span><span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/disclosetv/21975"><time datetime="2026-10-26T17:24:20+00:00" class="time">17:24</time></a></span>
  </div>
</div>
  </div>
</div></div><div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="disclosetv/21976" data-view="eyJjIjot">
  <div class="tgme_widget_message_bubble">
<a class="tgme_widget_message_reply user-color-default" href="https://t.me/disclosetv/21973" ">
<div class="tgme_widget_message_author accent_color">
  <span class="tgme_widget_message_author_name" dir="auto">Disclose.tv</span>
</div>
<div class="tgme_widget_message_text js-message_reply_text" dir="auto">NEW - Anthropic says, &quot;the physical effects of climate change may increase our operating costs,&quot;</div>
</a>
<div class="tgme_widget_message_text js-message_text" dir="auto">JUST IN - Trump offers &#036;1,000,000 for anyone who reports voter fraud.<br/><br/>Applies to past elections too.<br/><br/>Source: <a href="https://truthsocial.com/@realDonaldTrump/117508870323063258" target="_blank" rel="noopener">https://truthsocial.com/@realDonaldTrump/117508870323063258</a></div>
<div class="tgme_widget_message_footer compact js-message_footer">
    <span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/disclosetv/21976"><time datetime="2026-10-26T18:22:51+00:00" class="time">18:22</time></a></span>
</div>
  </div>
</div></div><div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="disclosetv/21977">
  <a class="tgme_widget_message_photo_wrap" href="https://t.me/disclosetv/21977"></a>
  <span class="tgme_widget_message_meta"><time datetime="2026-10-26T19:39:29+00:00" class="time">19:39</time></span>
</div></div>
</section></main>`;

test('telegram: reads a post, drops the link boilerplate, keeps the footer time', () => {
  const items = parseBy('telegram', TG, src('tg-disclosetv'));
  assert.strictEqual(items.length, 2, 'the captionless photo has nothing to read');
  const [a, b] = items;
  assert.strictEqual(a.guid, 'disclosetv/21975');
  assert.strictEqual(a.h, 'NEW - NBA announces partnership with Kalshi and Polymarket.');
  assert.strictEqual(a.x, '');
  assert.strictEqual(a.u, 'https://t.me/disclosetv/21975');
  assert.strictEqual(a.pt, Date.UTC(2026, 9, 26, 17, 24, 20));
  assert.strictEqual(a.sn, 'Disclose.tv');
  assert.strictEqual(a.pub, 't.me');
  assert.strictEqual(a.cls, 'osint');
  assert.strictEqual(b.h, 'JUST IN - Trump offers $1,000,000 for anyone who reports voter fraud.');
  assert.strictEqual(b.x, 'Applies to past elections too.');
});

test('telegram: the quoted parent of a reply is not the post', () => {
  const b = parseBy('telegram', TG, src('tg-disclosetv'))[1];
  assert.ok(!/Anthropic/.test(b.h + b.x));
});

test('telegram: a page with no posts is a failure, not an empty channel', () => {
  assert.throws(() => parseBy('telegram', '<html><body>Telegram: Contact @x</body></html>', src('tg-disclosetv')), /no posts/);
});

test('telegram: a malformed data-post is ignored rather than turned into a url', () => {
  const html = '<div data-post="../../evil"><div class="tgme_widget_message_text js-message_text">Hello there</div></div><div data-post="good/5"><div class="tgme_widget_message_text js-message_text">Second</div></div>';
  const items = parseBy('telegram', html, src('tg-disclosetv'));
  assert.deepStrictEqual(items.map((i) => i.guid), ['good/5']);
});

test('telegram: a post with no text falls back to its link preview title', () => {
  const html = '<div data-post="c/9"><a class="tgme_widget_message_link_preview" href="https://x.example/"><div class="link_preview_title" dir="auto">Preview headline</div></a></div>';
  assert.strictEqual(parseBy('telegram', html, src('tg-disclosetv'))[0].h, 'Preview headline');
});

// ── truth ───────────────────────────────────────────────────────────────────

const TRUTH = `<rss version="2.0" xmlns:truth="https://truthsocial.com/ns" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:archive="https://www.trumpstruth.org/rss-extensions"><channel>
        <title><![CDATA[Trump’s Truth - Latest Posts]]></title>
                    <item>
                <title><![CDATA[Image post from October 30, 2026]]></title>
                <link>https://www.trumpstruth.org/statuses/42893</link>
                <description><![CDATA[<p><a href="https://conservativebrief.com/senate-race-poll-midterm-105503/" rel="nofollow"><span class="invisible">https://</span><span class="ellipsis">conservativebrief.com/senate-r</span><span class="invisible">ace-poll-midterm-105503/</span></a></p><p><a href="https://truth-archive.us-iad-1.linodeobjects.com/attachments/18781/0bc.png">View image</a></p>]]></description>
                <guid>https://www.trumpstruth.org/statuses/42893</guid>
                <pubDate>Fri, 30 Oct 2026 11:29:14 +0000</pubDate>
                <truth:originalUrl>https://truthsocial.com/@realDonaldTrump/117529624881658729</truth:originalUrl>
                <truth:originalId>117529624881658729</truth:originalId>
            </item>
                    <item>
                <title><![CDATA[Quote post from October 30, 2026]]></title>
                <link>https://www.trumpstruth.org/statuses/42885</link>
                <description><![CDATA[<p><span><br />RT: https://truthsocial.com/users/realDonaldTrump/statuses/117529619259512950</span></p><p><a href="https://truth-archive.us-iad-1.linodeobjects.com/attachments/18772/83a.png">View image</a></p><p>Quoted <a href="https://www.trumpstruth.org/statuses/42886">Donald J. Trump</a></p><blockquote><p></p><p><a href="https://truth-archive.us-iad-1.linodeobjects.com/attachments/18773/5cb.mp4">View video</a></p></blockquote>]]></description>
                <guid>https://www.trumpstruth.org/statuses/42885</guid>
                <pubDate>Fri, 30 Oct 2026 11:28:01 +0000</pubDate>
            </item>
                    <item>
                <title><![CDATA[Video post from October 30, 2026]]></title>
                <link>https://www.trumpstruth.org/statuses/42900</link>
                <description><![CDATA[<p>We will not allow them to steal this election. Stay strong!</p><p><a href="https://truth-archive.us-iad-1.linodeobjects.com/attachments/1/a.mp4">View video</a></p>]]></description>
                <guid>https://www.trumpstruth.org/statuses/42900</guid>
                <pubDate>Fri, 30 Oct 2026 12:00:00 +0000</pubDate>
            </item>
                    <item>
                <title><![CDATA[INFLATION IS WAY DOWN UNDER “TRUMP.” INCOME FOR PEOPLE & COMPANIES IS WAY UP! The Golden Age of America Is Upon Us.]]></title>
                <link>https://www.trumpstruth.org/statuses/42883</link>
                <description><![CDATA[<p>INFLATION IS WAY DOWN UNDER “TRUMP.” INCOME FOR PEOPLE &amp; COMPANIES IS WAY UP! The Golden Age of America Is Upon Us.</p>]]></description>
                <guid>https://www.trumpstruth.org/statuses/42883</guid>
                <pubDate>Fri, 30 Oct 2026 10:30:46 +0000</pubDate>
                <truth:originalUrl>https://truthsocial.com/@realDonaldTrump/117529394978444089</truth:originalUrl>
                <truth:originalId>117529394978444089</truth:originalId>
            </item>
</channel></rss>`;

test('truth: the headline comes from the post, not the placeholder title', () => {
  const items = parseBy('truth', TRUTH, src('truth'));
  assert.strictEqual(items.length, 4);
  assert.strictEqual(items[2].h, 'We will not allow them to steal this election. Stay strong!');
  assert.strictEqual(items[3].h, 'INFLATION IS WAY DOWN UNDER “TRUMP.” INCOME FOR PEOPLE & COMPANIES IS WAY UP! The Golden Age of America Is Upon Us.');
  assert.strictEqual(items[3].x, '', 'title and body are the same text');
  assert.strictEqual(items[3].guid, '117529394978444089');
  assert.strictEqual(items[3].u, 'https://truthsocial.com/@realDonaldTrump/117529394978444089');
  assert.strictEqual(items[3].pub, 'truthsocial.com');
  assert.strictEqual(items[3].cls, 'osint');
  assert.ok(items.every((i) => !/View (image|video)/.test(i.h + i.x)), 'archive chrome is gone');
});

test('truth: a post with only a link or only media is kept and says what it was', () => {
  const [linkPost, quote] = parseBy('truth', TRUTH, src('truth'));
  assert.strictEqual(linkPost.h, 'Image post from October 30, 2026');
  assert.strictEqual(linkPost.x, 'https://conservativebrief.com/senate-race-poll-midterm-105503/');
  assert.strictEqual(quote.h, 'Quote post from October 30, 2026');
  assert.strictEqual(quote.u, 'https://www.trumpstruth.org/statuses/42885', 'falls back to the archive link');
  assert.strictEqual(quote.guid, 'https://www.trumpstruth.org/statuses/42885');
});

// ── nws ─────────────────────────────────────────────────────────────────────

const nwsAlert = (props, geometry) => ({
  id: 'https://api.weather.gov/alerts/urn:oid:' + (props.id || 'x'),
  type: 'Feature',
  geometry: geometry === undefined ? null : geometry,
  properties: Object.assign({
    '@id': 'https://api.weather.gov/alerts/urn:oid:' + (props.id || 'x'),
    areaDesc: 'Dawson, TX; Gaines, TX',
    geocode: { SAME: ['048115'], UGC: ['TXC115', 'TXC165'] },
    sent: '2026-10-30T09:38:00-07:00',
    effective: '2026-10-30T09:38:00-07:00',
    status: 'Actual',
    messageType: 'Alert',
    severity: 'Severe',
    event: 'Flash Flood Warning',
    description: 'FFWMAF The National Weather Service in Midland/Odessa has issued a warning.',
    parameters: {}
  }, props, { id: 'urn:oid:' + (props.id || 'x') })
});
const nwsDoc = (...features) => JSON.stringify({ type: 'FeatureCollection', features });

test('nws: keeps Extreme, Severe and the civil set, drops the rest', () => {
  const ctx = {};
  const items = parseBy('nws', nwsDoc(
    nwsAlert({ id: 'a', event: 'Tornado Warning', severity: 'Extreme' }),
    nwsAlert({ id: 'b', event: 'Flash Flood Warning', severity: 'Severe' }),
    nwsAlert({ id: 'c', event: 'Civil Danger Warning', severity: 'Unknown' }),
    nwsAlert({ id: 'd', event: 'Special Weather Statement', severity: 'Moderate' }),
    nwsAlert({ id: 'e', event: 'Flood Advisory', severity: 'Minor' })
  ), src('nws'), ctx);
  assert.deepStrictEqual(items.map((i) => i.guid), ['urn:oid:a', 'urn:oid:b', 'urn:oid:c']);
  assert.deepStrictEqual(ctx.official.nws, { extreme: 1, severe: 1, civil: 1 });
});

test('nws: marine noise goes, even when it is rated Severe', () => {
  const marine = { geocode: { UGC: ['PZZ131', 'AMZ250'] }, areaDesc: 'Coastal Waters' };
  const items = parseBy('nws', nwsDoc(
    nwsAlert({ id: 'a', event: 'Gale Warning', severity: 'Severe' }),
    nwsAlert({ id: 'b', event: 'Small Craft Advisory', severity: 'Severe' }),
    nwsAlert({ id: 'c', event: 'Storm Warning', severity: 'Severe', ...marine }),
    nwsAlert({ id: 'd', event: 'Hurricane Warning', severity: 'Extreme', geocode: { UGC: ['FLZ001', 'GMZ700'] } })
  ), src('nws'));
  assert.deepStrictEqual(items.map((i) => i.guid), ['urn:oid:d'], 'a warning that also covers land stays');
});

test('nws: a Tsunami Warning over water zones is never treated as marine noise', () => {
  const items = parseBy('nws', nwsDoc(
    nwsAlert({ id: 't', event: 'Tsunami Warning', severity: 'Severe', geocode: { UGC: ['PZZ131'] } })
  ), src('nws'));
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].sev0, 3);
});

test('nws: severity follows section 4', () => {
  const sev = (event, severity) => parseBy('nws', nwsDoc(nwsAlert({ event, severity })), src('nws'))[0].sev0;
  assert.strictEqual(sev('Nuclear Power Plant Warning', 'Unknown'), 3);
  assert.strictEqual(sev('Radiological Hazard Warning', 'Extreme'), 3);
  assert.strictEqual(sev('Tsunami Warning', 'Extreme'), 3);
  for (const e of ['Civil Danger Warning', 'Civil Emergency Message', 'Law Enforcement Warning', 'Evacuation Immediate', 'Shelter In Place Warning']) {
    assert.strictEqual(sev(e, 'Severe'), 2, e);
  }
  assert.strictEqual(sev('911 Telephone Outage Emergency', 'Minor'), 1);
  assert.strictEqual(sev('Tornado Warning', 'Extreme'), 1);
  assert.strictEqual(sev('Flash Flood Warning', 'Severe'), 0);
});

test('nws: a drill or a cancellation is dropped even if the url filter were bypassed', () => {
  const items = parseBy('nws', nwsDoc(
    nwsAlert({ id: 'a', event: 'Tsunami Warning', severity: 'Extreme', status: 'Test' }),
    nwsAlert({ id: 'b', event: 'Civil Danger Warning', status: 'Exercise' }),
    nwsAlert({ id: 'c', event: 'Tornado Warning', severity: 'Extreme', messageType: 'Cancel' })
  ), src('nws'));
  assert.deepStrictEqual(items, []);
});

test('nws: polygon gives a centroid and an honest radius', () => {
  const ring = [[-102.6, 32.5], [-101.8, 32.5], [-101.8, 33.0], [-102.6, 33.0], [-102.6, 32.5]];
  const [item] = parseBy('nws', nwsDoc(nwsAlert({}, { type: 'Polygon', coordinates: [ring] })), src('nws'));
  assert.strictEqual(item.geo.p, 'Dawson, TX');
  assert.strictEqual(item.geo.cc, 'US');
  assert.ok(Math.abs(item.geo.lat - 32.7) < 0.15, 'lat ' + item.geo.lat);
  assert.ok(Math.abs(item.geo.lon + 102.28) < 0.2, 'lon ' + item.geo.lon);
  assert.ok(item.geo.r > 30000 && item.geo.r < 90000, 'radius ' + item.geo.r);
});

test('nws: a zone alert with null geometry falls back to the state centroid', () => {
  const [item] = parseBy('nws', nwsDoc(nwsAlert({
    areaDesc: 'Ruby Mountains and East Humboldt Range',
    geocode: { UGC: ['NVZ038'] }
  })), src('nws'));
  assert.strictEqual(item.geo.lat, 39.3);
  assert.strictEqual(item.geo.lon, -116.6);
  assert.strictEqual(item.geo.r, 250000);
  assert.strictEqual(item.geo.p, 'Ruby Mountains and East Humboldt Range');
});

test('nws: headline names the event and first areas, snippet loses the product id', () => {
  const [item] = parseBy('nws', nwsDoc(nwsAlert({ areaDesc: 'A, TX; B, TX; C, TX; D, TX; E, TX' })), src('nws'));
  assert.strictEqual(item.h, 'Flash Flood Warning: A, TX; B, TX; C, TX +2 more');
  assert.match(item.x, /^The National Weather Service/);
  assert.strictEqual(item.pt, Date.parse('2026-10-30T16:38:00Z'));
  assert.strictEqual(item.u, 'https://api.weather.gov/alerts/urn:oid:x');
  const [named] = parseBy('nws', nwsDoc(nwsAlert({ parameters: { NWSheadline: ['FREEZE WARNING IN EFFECT'] } })), src('nws'));
  assert.strictEqual(named.x, 'FREEZE WARNING IN EFFECT');
});

// ── usgs / emsc ─────────────────────────────────────────────────────────────

const USGS = (features) => JSON.stringify({ type: 'FeatureCollection', metadata: { count: features.length }, features });
const quake = (id, mag, time) => ({
  type: 'Feature',
  properties: {
    mag, place: '42 km SE of Sykiá, Greece', time, updated: time + 1000,
    url: 'https://earthquake.usgs.gov/earthquakes/eventpage/' + id, tsunami: 0, type: 'earthquake',
    title: 'M ' + mag + ' - 42 km SE of Sykiá, Greece'
  },
  geometry: { type: 'Point', coordinates: [24.2284, 39.7308, 10] },
  id
});

test('usgs: maps a feature and sets severity by magnitude', () => {
  const t = Date.UTC(2026, 9, 30, 10, 0, 0);
  const items = parseBy('usgs', USGS([quake('a', 4.7, t), quake('b', 6.1, t), quake('c', 7.0, t)]), src('usgs'));
  assert.deepStrictEqual(items.map((i) => i.sev0), [0, 2, 3]);
  const [a] = items;
  assert.strictEqual(a.h, 'M 4.7 - 42 km SE of Sykiá, Greece');
  assert.strictEqual(a.guid, 'a');
  assert.strictEqual(a.pt, t);
  assert.strictEqual(a.u, 'https://earthquake.usgs.gov/earthquakes/eventpage/a');
  assert.deepStrictEqual(a.geo, { p: '42 km SE of Sykiá, Greece', lat: 39.7308, lon: 24.2284, r: 10000 });
  assert.deepStrictEqual(a.cat0, ['disaster']);
  assert.strictEqual(a.off, true);
});

test('usgs: m6p24h spans polls, though the feed only covers an hour, and ages out', () => {
  let t = Date.UTC(2026, 9, 30, 10, 0, 0);
  const ctx = { now: () => t };
  parseBy('usgs', USGS([quake('a', 6.2, t), quake('small', 5.0, t)]), src('usgs'), ctx);
  assert.deepStrictEqual(ctx.official.usgs, { m6p24h: 1 });
  t += 2 * 3600000;
  parseBy('usgs', USGS([quake('b', 6.5, t)]), src('usgs'), ctx);
  assert.deepStrictEqual(ctx.official.usgs, { m6p24h: 2 });
  parseBy('usgs', USGS([quake('b', 6.5, t)]), src('usgs'), ctx);
  assert.deepStrictEqual(ctx.official.usgs, { m6p24h: 2 }, 'a repeat is not a new quake');
  t += 23 * 3600000;
  parseBy('usgs', USGS([]), src('usgs'), ctx);
  assert.deepStrictEqual(ctx.official.usgs, { m6p24h: 1 });
});

const EMSC = `{"type":"FeatureCollection","metadata":{"count":1},"features":[{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [ 142.3977, 40.2415, -60.0 ] },
  "id": "20261030_0000068",
  "properties": {
    "source_id": "2082714", "source_catalog": "EMSC-RTS",
    "lastupdate": "2026-10-30T07:38:28.007646Z",
    "time": "2026-10-30T04:58:31.71Z",
    "flynn_region": "NEAR EAST COAST OF HONSHU, JAPAN",
    "lat": 40.2415, "lon": 142.3977, "depth": 60.0, "evtype": "ke",
    "auth": "EMSC", "mag": 4.6, "magtype": "mb", "unid": "20261030_0000068"
  }
}]}`;

test('emsc: maps a feature, a readable region and geo', () => {
  const [item] = parseBy('emsc', EMSC, src('emsc'));
  assert.strictEqual(item.h, 'M 4.6 - Near East Coast Of Honshu, Japan');
  assert.strictEqual(item.guid, '20261030_0000068');
  assert.strictEqual(item.u, 'https://www.seismicportal.eu/eventdetails.html?unid=20261030_0000068');
  assert.strictEqual(item.pt, Date.parse('2026-10-30T04:58:31.71Z'));
  assert.strictEqual(item.geo.lat, 40.2415);
  assert.strictEqual(item.geo.lon, 142.3977);
  assert.strictEqual(item.sev0, 0);
});

// ── ntas ────────────────────────────────────────────────────────────────────

test('ntas: an empty <alerts> root means no advisory, and that is a stated fact', () => {
  const ctx = {};
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n<alerts>\n</alerts>\n';
  assert.deepStrictEqual(parseBy('ntas', body, src('ntas'), ctx), []);
  assert.deepStrictEqual(ctx.official.ntas, { active: false, title: null });
});

test('ntas: a page that is not the feed never reads as "no advisory"', () => {
  const ctx = {};
  assert.throws(() => parseBy('ntas', '<html><body>Access Denied</body></html>', src('ntas'), ctx), /no <alerts> root/);
  assert.throws(() => parseBy('ntas', '', src('ntas'), ctx), /no <alerts> root/);
  assert.strictEqual(ctx.official, undefined, 'the old state must not be overwritten');
});

// Hand-built: no bulletin was active on 2026-10-30, so no real one could be captured.
test('ntas: an active bulletin is sev 3 and sets the state', () => {
  const ctx = { now: () => Date.UTC(2026, 9, 30) };
  const body = `<alerts><alert start="2026/10/30 13:00" end="2027/01/30 12:59" type="National Terrorism Advisory System Bulletin" link="https://www.dhs.gov/ntas/advisory/bulletin-1"><summary><![CDATA[Heightened threat environment.]]></summary><details>More here.</details></alert></alerts>`;
  const [item] = parseBy('ntas', body, src('ntas'), ctx);
  assert.strictEqual(item.h, 'NTAS: National Terrorism Advisory System Bulletin');
  assert.strictEqual(item.x, 'Heightened threat environment.');
  assert.strictEqual(item.u, 'https://www.dhs.gov/ntas/advisory/bulletin-1');
  assert.strictEqual(item.sev0, 3);
  assert.deepStrictEqual(item.cat0, ['security']);
  assert.strictEqual(item.off, true);
  assert.deepStrictEqual(ctx.official.ntas, { active: true, title: item.h });
});

test('ntas: a bulletin in a shape we do not recognise still reaches the owner', () => {
  const ctx = {};
  const items = parseBy('ntas', '<alerts><alert><weird>x</weird></alert></alerts>', src('ntas'), ctx);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].h, 'NTAS advisory issued');
  assert.strictEqual(items[0].sev0, 3);
  assert.strictEqual(ctx.official.ntas.active, true);
});

test('ntas: an expired bulletin left in the feed is not active', () => {
  const ctx = { now: () => Date.UTC(2026, 9, 30) };
  const body = '<alerts><alert start="2026/01/01 00:00" end="2026/06/01 00:00" type="Bulletin"></alert></alerts>';
  assert.deepStrictEqual(parseBy('ntas', body, src('ntas'), ctx), []);
  assert.strictEqual(ctx.official.ntas.active, false);
});

// ── faa ─────────────────────────────────────────────────────────────────────

const FAA = `<AIRPORT_STATUS_INFORMATION><Update_Time>Fri Oct 30 16:42:38 2026 GMT</Update_Time><Dtd_File>http://www.fly.faa.gov/AirportStatus.dtd</Dtd_File><Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>SAN</ARPT><Reason>airport volume</Reason><Avg>32 minutes</Avg><Max>56 minutes</Max></Ground_Delay></Ground_Delay_List></Delay_type><Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List><Delay><ARPT>DAL</ARPT><Reason>WX:Rain</Reason><Arrival_Departure Type="Departure"><Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay><Delay><ARPT>LAS</ARPT><Reason>WX:Thunderstorms</Reason><Arrival_Departure Type="Departure"><Min>31 minutes</Min><Max>45 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay></Arrival_Departure_Delay_List></Delay_type><Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>SNA</ARPT><Reason>!SNA 10/051 SNA AD AP CLSD DLY 0630-1315 2610270630-2610311315</Reason><Start>Oct 27 at 06:30 UTC.</Start><Reopen>Oct 31 at 13:15 UTC.</Reopen></Airport></Airport_Closure_List></Delay_type><Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>LAX</ARPT><Reason>!LAX 05/277 LAX AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR CTC ATLANTIC AVIATION 310-258-9884 2605271826-2705281600</Reason><Start>May 27 at 18:26 UTC.</Start><Reopen>May 28 at 16:00 UTC.</Reopen></Airport><Airport><ARPT>SAN</ARPT><Reason>!SAN 10/004 SAN AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC PPR 619-298-7704 2610011633-2701010800</Reason><Start>Oct 01 at 16:33 UTC.</Start><Reopen>Jan 01 at 08:00 UTC.</Reopen></Airport></Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>`;

test('faa: reads every section of the live payload', () => {
  const ctx = {};
  const items = parseBy('faa', FAA, src('faa'), ctx);
  assert.deepStrictEqual(items.map((i) => i.h), [
    'Ground delay at SAN: airport volume',
    'Departure delays at DAL: WX:Rain',
    'Departure delays at LAS: WX:Thunderstorms',
    'Airport closure at SNA: !SNA 10/051 SNA AD AP CLSD DLY 0630-1315 2610270630-2610311315'
  ]);
  assert.strictEqual(items[0].x, 'Average 32 minutes, max 56 minutes');
  assert.strictEqual(items[1].x, '16 minutes to 30 minutes, Increasing');
  assert.strictEqual(items[3].x, 'From Oct 27 at 06:30 UTC. until Oct 31 at 13:15 UTC.');
  assert.ok(items.every((i) => i.u === ''), 'a shared url would merge every event into one id');
  assert.ok(items.every((i) => i.pt === Date.UTC(2026, 9, 30, 16, 42, 38)));
  assert.deepStrictEqual(items[0].cat0, ['infra']);
  assert.deepStrictEqual(ctx.official.faa, { stops: 0, delays: 3, closures: 1, updated: Date.UTC(2026, 9, 30, 16, 42, 38) });
});

test('faa: a standing general-aviation NOTAM is not an airport closure', () => {
  const items = parseBy('faa', FAA, src('faa'));
  assert.ok(!items.some((i) => /^Airport closure at (LAX|SAN)/.test(i.h)), 'LAX and SAN are open');
});

test('faa: an airport+type pair is announced once, and again only if it returns', () => {
  const ctx = {};
  assert.strictEqual(parseBy('faa', FAA, src('faa'), ctx).length, 4);
  assert.strictEqual(parseBy('faa', FAA, src('faa'), ctx).length, 0, 'unchanged on the next poll');

  const noLas = FAA.replace(/<Delay><ARPT>LAS[\s\S]*?<\/Delay>/, '');
  assert.strictEqual(parseBy('faa', noLas, src('faa'), ctx).length, 0, 'a pair leaving emits nothing');
  assert.strictEqual(ctx.official.faa.delays, 2);
  const back = parseBy('faa', FAA, src('faa'), ctx);
  assert.deepStrictEqual(back.map((i) => i.h), ['Departure delays at LAS: WX:Thunderstorms']);
});

test('faa: the same airport under a new type is a new pair', () => {
  const ctx = {};
  parseBy('faa', FAA, src('faa'), ctx);
  const withStop = FAA.replace('</AIRPORT_STATUS_INFORMATION>',
    '<Delay_type><Name>Ground Stops</Name><Ground_Stop_List><Program><ARPT>DAL</ARPT><Reason>equipment</Reason><End_Time>5:00 pm EDT</End_Time></Program></Ground_Stop_List></Delay_type></AIRPORT_STATUS_INFORMATION>');
  const items = parseBy('faa', withStop, src('faa'), ctx);
  assert.deepStrictEqual(items.map((i) => i.h), ['Ground stop at DAL: equipment']);
  assert.strictEqual(items[0].x, 'Until 5:00 pm EDT');
  assert.strictEqual(items[0].sev0, 1);
  assert.strictEqual(ctx.official.faa.stops, 1);
});

test('faa: a nightly closure is routine, an unplanned one is notable', () => {
  const sevOf = (reason) => parseBy('faa', `<AIRPORT_STATUS_INFORMATION><Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>DCA</ARPT><Reason>${reason}</Reason></Airport></Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>`, src('faa'))[0].sev0;
  assert.strictEqual(sevOf('!SNA AD AP CLSD DLY 0630-1315'), 0);
  assert.strictEqual(sevOf('!DCA AD AP CLSD'), 1);
});

test('faa: guids change between episodes so a later return is not deduped forever', () => {
  let t = Date.UTC(2026, 9, 30, 1, 0, 0);
  const first = parseBy('faa', FAA, src('faa'), { now: () => t })[0];
  t += 12 * 3600000;
  const later = parseBy('faa', FAA, src('faa'), { now: () => t })[0];
  assert.notStrictEqual(first.guid, later.guid);
  t = Date.UTC(2026, 9, 30, 1, 30, 0);
  const restart = parseBy('faa', FAA, src('faa'), { now: () => t })[0];
  assert.strictEqual(first.guid, restart.guid, 'a restart mid-episode must dedupe');
});

test('faa: anything but the status document is a failure', () => {
  assert.throws(() => parseBy('faa', '<html>Service Unavailable</html>', src('faa'), {}), /airport status/);
});

// ── swpc / eonet / fema / hn ────────────────────────────────────────────────

const SWPC = JSON.stringify([
  { product_id: 'EF3A', issue_datetime: '2026-10-30 14:59:54.440', message: 'Space Weather Message Code: ALTEF3\r\nSerial Number: 3762\r\nIssue Time: 2026 Oct 30 1459 UTC\r\n\r\nCONTINUED ALERT: Electron 2MeV Integral Flux exceeded 1,000pfu\nContinuation of Serial Number: 3761\nBegin Time: 2026 Oct 23 1140 UTC\n\nYesterday Maximum 2MeV Flux: 1228 pfu' },
  { product_id: 'A20F', issue_datetime: '2026-10-29 19:10:52.657', message: 'Space Weather Message Code: WATA20\r\nSerial Number: 1134\r\nIssue Time: 2026 Oct 29 1910 UTC\r\n\r\nWATCH: Geomagnetic Storm Category G1 Predicted \nHighest Storm Level Predicted by Day:\nOct 30:  None (Below G1)   Oct 31:  G1 (Minor)' },
  { product_id: 'K09A', issue_datetime: '2026-10-29 19:10:52.657', message: 'Space Weather Message Code: ALTK09\r\nSerial Number: 1\r\nIssue Time: 2026 Oct 29 1910 UTC\r\n\r\nALERT: Geomagnetic K-index of 9 \nThreshold Reached' }
]);

test('swpc: the message body supplies the headline, issue time is UTC', () => {
  const [a, b, c] = parseBy('swpc', SWPC, src('swpc'));
  assert.strictEqual(a.h, 'CONTINUED ALERT: Electron 2MeV Integral Flux exceeded 1,000pfu');
  assert.match(a.x, /^Continuation of Serial Number: 3761/);
  assert.strictEqual(a.guid, 'ALTEF3-3762');
  assert.strictEqual(a.pt, Date.UTC(2026, 9, 30, 14, 59, 54, 440));
  assert.strictEqual(a.u, '', 'a shared url would merge every alert into one id');
  assert.strictEqual(b.h, 'WATCH: Geomagnetic Storm Category G1 Predicted');
  assert.strictEqual(a.sev0, 0);
  assert.strictEqual(c.sev0, 1);
});

const EONET = `{"title":"EONET Events","events":[{
  "id":"EONET_25827","title":"Wildfire South Tank Trail, Perry, Mississippi","description":null,
  "link":"https://eonet.gsfc.nasa.gov/api/v3/events/EONET_25827","closed":null,
  "categories":[{"id":"wildfires","title":"Wildfires"}],
  "sources":[{"id":"IRWIN","url":"https://irwin.doi.gov/observer/incidents/2026-MSMNF-000680"}],
  "geometry":[{"magnitudeValue":1000.00,"magnitudeUnit":"acres","date":"2026-10-28T18:02:00Z","type":"Point","coordinates":[-89.097783,31.085833]}]
},{
  "id":"EONET_25729","title":"Tropical Cyclone Arnab","description":null,
  "link":"https://eonet.gsfc.nasa.gov/api/v3/events/EONET_25729","closed":null,
  "categories":[{"id":"severeStorms","title":"Severe Storms"}],"sources":[],
  "geometry":[
    {"magnitudeValue":35.00,"magnitudeUnit":"kts","date":"2026-10-25T18:00:00Z","type":"Point","coordinates":[89.3,15.6]},
    {"magnitudeValue":55.00,"magnitudeUnit":"kts","date":"2026-10-28T06:00:00Z","type":"Point","coordinates":[81.8,16.4]}
  ]
}]}`;

test('eonet: the newest fix on a track gives the time and position', () => {
  const [fire, storm] = parseBy('eonet', EONET, src('eonet'));
  assert.strictEqual(fire.h, 'Wildfire South Tank Trail, Perry, Mississippi');
  assert.strictEqual(fire.x, 'Wildfires, 1000 acres');
  assert.strictEqual(fire.u, 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_25827');
  assert.strictEqual(fire.geo.lat, 31.085833);
  assert.strictEqual(fire.geo.lon, -89.097783);
  assert.strictEqual(storm.pt, Date.UTC(2026, 9, 28, 6, 0, 0));
  assert.strictEqual(storm.geo.lat, 16.4);
  assert.strictEqual(storm.geo.lon, 81.8);
});

test('eonet: a polygon event still gets a position', () => {
  const body = JSON.stringify({ events: [{ id: 'E', title: 'Ice', link: 'https://e.example/E', geometry: [{ date: '2026-10-28T06:00:00Z', type: 'Polygon', coordinates: [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]] }] }] });
  const [item] = parseBy('eonet', body, src('eonet'));
  assert.ok(item.geo.lat > 10 && item.geo.lat < 12);
});

const FEMA = JSON.stringify({
  metadata: { top: 3, count: 0 },
  DisasterDeclarationsSummaries: [
    { femaDeclarationString: 'DR-4955-FL', disasterNumber: 4955, state: 'FL', declarationType: 'DR', declarationDate: '2026-10-27T00:00:00.000Z', incidentType: 'Hurricane', declarationTitle: 'HURRICANE ISAIAS', designatedArea: 'Washington (County)' },
    { femaDeclarationString: 'DR-4955-FL', disasterNumber: 4955, state: 'FL', declarationType: 'DR', declarationDate: '2026-10-27T00:00:00.000Z', incidentType: 'Hurricane', declarationTitle: 'HURRICANE ISAIAS', designatedArea: 'Jackson (County)' },
    { femaDeclarationString: 'EM-3600-TX', disasterNumber: 3600, state: 'TX', declarationType: 'EM', declarationDate: '2026-10-20T00:00:00.000Z', incidentType: 'Flood', declarationTitle: 'SEVERE FLOODING', designatedArea: 'Harris (County)' }
  ]
});

test('fema: one item per declaration, not one per county', () => {
  const [dr, em, ...rest] = parseBy('fema', FEMA, src('fema'));
  assert.strictEqual(rest.length, 0);
  assert.strictEqual(dr.guid, 'DR-4955-FL');
  assert.strictEqual(dr.h, 'Major disaster declaration DR-4955-FL: HURRICANE ISAIAS (FL)');
  assert.strictEqual(dr.x, 'Hurricane: Washington (County); Jackson (County)');
  assert.strictEqual(dr.u, 'https://www.fema.gov/disaster/4955');
  assert.strictEqual(dr.pt, Date.UTC(2026, 9, 27));
  assert.strictEqual(dr.geo.cc, 'US');
  assert.strictEqual(dr.geo.lat, 28.6);
  assert.match(em.h, /^Emergency declaration EM-3600-TX/);
});

const HN = `{"exhaustive":{"nbHits":false},"hits":[{"author":"pretext","created_at":"2026-10-30T16:42:46Z","created_at_i":1793378566,"num_comments":0,"objectID":"50306484","points":1,"story_id":50306484,"title":"OpenAI Private Intelligence","url":"https://openai.com/business/private-intelligence/"},{"objectID":"50306999","title":"Ask HN: Anyone else?","created_at_i":1793378000}],"hitsPerPage":2}`;

test('hn: a hit becomes a social item linking to its discussion', () => {
  const [a, b] = parseBy('hn', HN, src('hn'));
  assert.strictEqual(a.h, 'OpenAI Private Intelligence');
  assert.strictEqual(a.guid, '50306484');
  assert.strictEqual(a.u, 'https://news.ycombinator.com/item?id=50306484', 'the outlet url belongs to the outlet');
  assert.strictEqual(a.pt, 1793378566000);
  assert.strictEqual(a.cls, 'social');
  assert.strictEqual(b.u, 'https://news.ycombinator.com/item?id=50306999');
});

// ── hostile and malformed input ─────────────────────────────────────────────

test('malformed: a missing </item> does not swallow the next item', () => {
  const xml = `<rss><channel>
    <item><title>One</title><link>https://example.com/1</link>
    <item><title>Two</title><link>https://example.com/2</link></item>
  </channel></rss>`;
  const items = parseBy('rss', xml, RSS_SOURCE);
  assert.deepStrictEqual(items.map((i) => i.h), ['One', 'Two']);
  assert.deepStrictEqual(items.map((i) => i.u), ['https://example.com/1', 'https://example.com/2']);
});

test('malformed: a document cut off mid-item still yields the complete items', () => {
  const xml = BBC.replace('</item>', '</item><item><title>Next story that gets cut');
  const items = parseBy('rss', xml.slice(0, xml.indexOf('that gets cut') + 4), src('bbc-us'));
  assert.strictEqual(items[0].guid, 'https://www.bbc.co.uk/news/articles/ck62ydn7dj9eo#0');
});

test('malformed: truncation inside CDATA does not throw', () => {
  const xml = '<rss><channel><item><title>Good</title><link>https://e.com/1</link></item><item><title><![CDATA[Half a tit';
  const items = parseBy('rss', xml, RSS_SOURCE);
  assert.strictEqual(items[0].h, 'Good');
  assert.strictEqual(items[1].h, 'Half a tit');
});

test('malformed: an unclosed <title> stops at the next tag', () => {
  const xml = '<rss><channel><item><title>Lost closing tag<link>https://e.com/1</link></item></channel></rss>';
  const [item] = parseBy('rss', xml, RSS_SOURCE);
  assert.strictEqual(item.h, 'Lost closing tag');
  assert.strictEqual(item.u, 'https://e.com/1');
});

test('malformed: </item> quoted inside CDATA is content, not structure', () => {
  const xml = '<rss><channel><item><title>Real</title><link>https://e.com/1</link><description><![CDATA[A post about </item><item><title>Fake</title> markup]]></description></item></channel></rss>';
  const items = parseBy('rss', xml, RSS_SOURCE);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].h, 'Real');
  assert.ok(!items[0].x.includes('<'), items[0].x);
});

test('malformed: </title> quoted inside a CDATA title does not end it', () => {
  const xml = '<rss><channel><item><title><![CDATA[A </title> B]]></title><link>https://e.com/1</link></item></channel></rss>';
  assert.strictEqual(parseBy('rss', xml, RSS_SOURCE)[0].h, 'A B');
});

test('malformed: self-closing tags do not run on into later tags', () => {
  const xml = '<rss><channel><item><title/><description>Body is the headline</description><link>https://e.com/1</link></item></channel></rss>';
  assert.strictEqual(parseBy('rss', xml, RSS_SOURCE)[0].h, 'Body is the headline');
});

test('malformed: numeric entities and CDATA in every position', () => {
  const xml = `<rss><channel><item>
    <title>Presidential Actions &#8211; The &#x57;hite House &#038; more</title>
    <link><![CDATA[https://e.com/a?x=1&y=2]]></link>
    <description>&#60;b&#62;Bold&#60;/b&#62; &#8230;</description>
  </item></channel></rss>`;
  const [item] = parseBy('rss', xml, RSS_SOURCE);
  assert.strictEqual(item.h, 'Presidential Actions – The White House & more');
  assert.strictEqual(item.u, 'https://e.com/a?x=1&y=2');
  assert.strictEqual(item.x, 'Bold …');
});

test('malformed: an unparseable date is null, not NaN and not now', () => {
  const xml = '<rss><channel><item><title>T</title><link>https://e.com/1</link><pubDate>next tuesday-ish</pubDate></item></channel></rss>';
  assert.strictEqual(parseBy('rss', xml, RSS_SOURCE)[0].pt, null);
});

test('malformed: an item with nothing to show is skipped', () => {
  const xml = '<rss><channel><item><link>https://e.com/1</link></item><item><title>   </title></item><item><title>Kept</title></item></channel></rss>';
  assert.deepStrictEqual(parseBy('rss', xml, RSS_SOURCE).map((i) => i.h), ['Kept']);
});

test('malformed: an HTML error page served as 200 is a failure, not an empty feed', () => {
  assert.throws(() => parseBy('rss', '<!doctype html><html><body><h1>403 Forbidden</h1></body></html>', RSS_SOURCE), /not a feed/);
  assert.throws(() => parseBy('gnews', '<html><body>Our systems have detected unusual traffic</body></html>', RSS_SOURCE), /not a feed/);
  assert.throws(() => parseBy('truth', '<html></html>', RSS_SOURCE), /not a feed/);
  assert.throws(() => parseBy('rss', '', RSS_SOURCE), /not a feed/);
});

test('malformed: a valid feed with no items is fine', () => {
  assert.deepStrictEqual(parseBy('rss', '<rss version="2.0"><channel><title>x</title></channel></rss>', RSS_SOURCE), []);
  assert.deepStrictEqual(parseBy('rss', '<feed xmlns="http://www.w3.org/2005/Atom"><title>x</title></feed>', RSS_SOURCE), []);
});

test('malformed: JSON parsers throw on an error page and on the wrong shape', () => {
  for (const kind of ['nws', 'usgs', 'emsc', 'swpc', 'eonet', 'fema', 'hn']) {
    assert.throws(() => parseBy(kind, '<html>503</html>', { id: kind }), /not JSON/, kind);
    assert.throws(() => parseBy(kind, '{"nope":true}', { id: kind }), undefined, kind);
  }
});

test('malformed: junk elements in JSON arrays are skipped, not fatal', () => {
  assert.strictEqual(parseBy('usgs', '{"features":[null,{},{"properties":null}]}', src('usgs')).length, 0);
  assert.strictEqual(parseBy('nws', '{"features":[null,{"properties":{}}]}', src('nws')).length, 0);
  assert.strictEqual(parseBy('hn', '{"hits":[null,{"title":"no id"}]}', src('hn')).length, 0);
  assert.strictEqual(parseBy('swpc', '[null,{},{"message":5}]', src('swpc')).length, 0);
  assert.strictEqual(parseBy('fema', '{"DisasterDeclarationsSummaries":[null,{}]}', src('fema')).length, 0);
  assert.strictEqual(parseBy('eonet', '{"events":[null]}', src('eonet')).length, 0);
});

test('malformed: coordinates out of range give no geo rather than a bad one', () => {
  const body = USGS([{ id: 'x', type: 'Feature', properties: { mag: 5, title: 'M 5', time: 1 }, geometry: { coordinates: [999, 999, 1] } }]);
  assert.strictEqual(parseBy('usgs', body, src('usgs'))[0].geo, undefined);
});

test('parseBy refuses an unknown kind', () => {
  assert.throws(() => parseBy('nope', '', {}), /unknown kind/);
  assert.throws(() => parseBy('constructor', '', {}), /unknown kind/);
});

test('hostile: a javascript: link is dropped to empty in every url position', () => {
  const rss = '<rss><channel><item><title>T</title><link>javascript:alert(document.cookie)</link></item></channel></rss>';
  assert.strictEqual(parseBy('rss', rss, RSS_SOURCE)[0].u, '');
  const entity = '<rss><channel><item><title>T</title><link>java&#115;cript:alert(1)</link></item></channel></rss>';
  assert.strictEqual(parseBy('rss', entity, RSS_SOURCE)[0].u, '');
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>T</title><link href="javascript:alert(1)"/></entry></feed>';
  assert.strictEqual(parseBy('rss', atom, RSS_SOURCE)[0].u, '');
  const gn = '<rss><channel><item><title>T - P</title><link>javascript:alert(1)</link><source url="javascript:alert(1)">P</source></item></channel></rss>';
  const g = parseBy('gnews', gn, { id: 'x', cls: 'aggregator', url: 'https://news.google.com/x' })[0];
  assert.strictEqual(g.u, '');
  assert.ok(!g.pub.includes('javascript'), g.pub);
  const usgs = USGS([{ id: 'x', type: 'Feature', properties: { mag: 5, title: 'M 5', time: 1, url: 'javascript:alert(1)' }, geometry: { coordinates: [1, 1, 1] } }]);
  assert.strictEqual(parseBy('usgs', usgs, src('usgs'))[0].u, '');
  const eonet = JSON.stringify({ events: [{ id: 'E', title: 'T', link: 'data:text/html,x' }] });
  assert.strictEqual(parseBy('eonet', eonet, src('eonet'))[0].u, '');
});

test('hostile: an HTML tag in a title or snippet is stripped', () => {
  const xml = `<rss><channel><item>
    <title><![CDATA[<img src=x onerror=alert(1)>Breaking <b>news</b><script>steal()</script>]]></title>
    <link>https://e.com/1</link>
    <description>&lt;iframe src="//evil"&gt;&lt;/iframe&gt;Snippet &lt;a href="javascript:x"&gt;link&lt;/a&gt;</description>
  </item></channel></rss>`;
  const [item] = parseBy('rss', xml, RSS_SOURCE);
  assert.strictEqual(item.h, 'Breaking news');
  assert.strictEqual(item.x, 'Snippet link');
});

test('hostile: tags are stripped from JSON feeds and telegram too', () => {
  const hn = JSON.stringify({ hits: [{ objectID: '1', title: '<svg onload=alert(1)>Hello', created_at_i: 1 }] });
  assert.strictEqual(parseBy('hn', hn, src('hn'))[0].h, 'Hello');
  const tg = '<div data-post="c/1"><div class="tgme_widget_message_text js-message_text">&lt;img src=x onerror=alert(1)&gt;Hi there</div></div>';
  assert.strictEqual(parseBy('telegram', tg, src('tg-disclosetv'))[0].h, 'Hi there');
  const nws = nwsDoc(nwsAlert({ event: 'Civil Danger Warning', areaDesc: '<b>County</b>' }));
  assert.strictEqual(parseBy('nws', nws, src('nws'))[0].h, 'Civil Danger Warning: County');
});

test('hostile: lengths are enforced on every parser path', () => {
  const long = 'x'.repeat(5000);
  const spaced = 'word '.repeat(1000);
  const checks = [
    parseBy('rss', `<rss><channel><item><title>${long}</title><description>${spaced}</description><link>https://e.com/1</link></item></channel></rss>`, RSS_SOURCE)[0],
    parseBy('rss', `<rss><channel><item><description>${spaced}</description><link>https://e.com/2</link></item></channel></rss>`, RSS_SOURCE)[0],
    parseBy('hn', JSON.stringify({ hits: [{ objectID: '1', title: long }] }), src('hn'))[0],
    parseBy('telegram', `<div data-post="c/1"><div class="js-message_text">${spaced}<br/>${spaced}</div></div>`, src('tg-disclosetv'))[0],
    parseBy('gnews', `<rss><channel><item><title>${long}</title><link>https://n.example/1</link></item></channel></rss>`, RSS_SOURCE)[0],
    parseBy('truth', `<rss><channel><item><title>${spaced}</title><description><![CDATA[<p>${spaced}</p>]]></description></item></channel></rss>`, RSS_SOURCE)[0]
  ];
  for (const item of checks) {
    assert.ok(item.h.length <= 240, 'h ' + item.h.length);
    assert.ok(item.x.length <= 280, 'x ' + item.x.length);
  }
});

test('hostile: a feed cannot make the parser run away', () => {
  const many = '<rss><channel>' + '<item><title>x</title></item>'.repeat(20000) + '</channel></rss>';
  const started = Date.now();
  assert.strictEqual(parseBy('rss', many, RSS_SOURCE).length, 500);
  assert.ok(Date.now() - started < 3000, 'took ' + (Date.now() - started) + ' ms');
  const openers = '<rss><channel><item><title>' + '<a '.repeat(50000);
  parseBy('rss', openers, RSS_SOURCE);
});

test('every raw item has the contract fields', () => {
  const samples = [
    parseBy('rss', BBC, src('bbc-us'))[0],
    parseBy('gnews', GNEWS, src('gn-ports'))[0],
    parseBy('telegram', TG, src('tg-disclosetv'))[0],
    parseBy('truth', TRUTH, src('truth'))[0],
    parseBy('nws', nwsDoc(nwsAlert({})), src('nws'))[0],
    parseBy('emsc', EMSC, src('emsc'))[0],
    parseBy('faa', FAA, src('faa'))[0],
    parseBy('swpc', SWPC, src('swpc'))[0],
    parseBy('eonet', EONET, src('eonet'))[0],
    parseBy('fema', FEMA, src('fema'))[0],
    parseBy('hn', HN, src('hn'))[0]
  ];
  for (const r of samples) {
    for (const k of ['sid', 'sn', 'cls', 'guid', 'h', 'x', 'u', 'pt', 'pub', 'firstPoll', 'off']) {
      assert.ok(k in r, r.sid + ' missing ' + k);
    }
    assert.strictEqual(typeof r.guid, 'string');
    assert.ok(r.guid.length > 0, r.sid);
    assert.ok(r.h.length > 0, r.sid);
    assert.ok(r.pub.length > 0, r.sid + ' pub');
    assert.ok(r.pt === null || Number.isFinite(r.pt), r.sid + ' pt');
  }
});
