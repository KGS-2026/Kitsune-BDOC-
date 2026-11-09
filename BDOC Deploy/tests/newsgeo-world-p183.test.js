// War Room world news (p183): France 24, WION, Arirang News and desks from every region.
//
// The War Room map (proxy-newsgeo) only knew conflict theatres, so stories from Senegal, Krakow or
// Dhaka were dropped or pinned to the wrong country. The headlines below are copies of real ones the
// function saw on 2026-11-09, chosen for the mistakes it made on the way: "deadlock" and "Warner"
// read as war news, "Paris Hilton" read as Paris, a YouTube feed's Flash player read as a photo.
// fetch is stubbed: no test here touches the network.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const FN = path.join(__dirname, '..', 'netlify', 'functions');
const news = require(path.join(FN, 'proxy-newsgeo.js'));
const world = require(path.join(FN, '_lib', 'world-places.js'));

const feed = (id) => news.FEEDS.find(f => f.id === id);
const at = (t, d) => { const p = news.place(t, d); return p ? p.name : null; };
const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600e3).toISOString();
const rfc = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600e3).toUTCString();

function withFetch(routes, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = routes[url];
    return body == null
      ? { ok: false, status: 404, text: async () => '' }
      : { ok: true, status: 200, text: async () => body };
  };
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = real; });
}

// ── the feeds ────────────────────────────────────────────────
test('France 24, WION and Arirang News are in the feed list, with world desks beside them', () => {
  for (const id of ['france24', 'wion', 'arirang', 'rfi', 'yonhap', 'africanews', 'dawn', 'scmp', 'mercopress', 'ukrinform', 'gn-ap', 'gn-reuters']) {
    assert.ok(feed(id), id + ' is missing');
  }
  assert.strictEqual(feed('france24').name, 'France 24');
  assert.strictEqual(feed('arirang').name, 'Arirang News');
  assert.match(feed('arirang').url, /^https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=/);
  assert.ok(feed('wion').google, 'WION comes through Google News, so its titles need the outlet suffix removed');
  const ids = new Set();
  for (const f of news.FEEDS) {
    assert.match(f.url, /^https:\/\//, f.id + ' must be https');
    assert.ok(!ids.has(f.id), 'duplicate feed id ' + f.id);
    ids.add(f.id);
  }
  assert.ok(news.FEEDS.length >= 35);
});

test('Google News items credit the outlet and lose the " - Outlet" tail', async () => {
  const xml = `<rss><channel><item>
    <title>India evacuates nationals as fighting spreads in Sudan - WION</title>
    <link>https://news.google.com/rss/articles/abc</link>
    <pubDate>${rfc(1)}</pubDate>
    <description>&lt;a href="x"&gt;India evacuates&lt;/a&gt; google summary</description>
    <source url="https://www.wionews.com">WION</source></item></channel></rss>`;
  const f = feed('wion');
  await withFetch({ [f.url]: xml }, async () => {
    const r = await news.fetchFeed(f);
    assert.ok(r.ok);
    assert.strictEqual(r.items[0].title, 'India evacuates nationals as fighting spreads in Sudan');
    assert.strictEqual(r.items[0].src, 'WION');
    assert.strictEqual(r.items[0].desc, '', 'Google summaries repeat the title with markup, so they are left out');
  });
});

const ARIRANG = (entries) => `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">${entries}</feed>`;
const ytEntry = (id, title, hoursAgo, linkPath) => `<entry>
  <id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId>
  <title>${title}</title>
  <link rel="alternate" href="https://www.youtube.com/${linkPath || 'watch?v=' + id}"/>
  <author><name>Arirang News</name></author>
  <published>${iso(hoursAgo)}</published><updated>${iso(hoursAgo / 2)}</updated>
  <media:group><media:title>${title}</media:title>
   <media:content url="https://www.youtube.com/v/${id}?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i3.ytimg.com/vi/${id}/hqdefault.jpg" width="480" height="360"/>
   <media:description>Subscribe to Arirang News</media:description></media:group></entry>`;

test('Arirang News (YouTube feed): link, published time, thumbnail and video link; never the Flash player', async () => {
  const f = feed('arirang');
  const xml = ARIRANG(ytEntry('6HJTb3bTOnw', 'N. Korea fires ballistic missile into East Sea: JCS', 2, 'shorts/6HJTb3bTOnw')
    + ytEntry('Ll-R5gaZKUc', 'S. Korea&#39;s military raises alert after drone incursion', 3));
  await withFetch({ [f.url]: xml }, async () => {
    const r = await news.fetchFeed(f);
    assert.strictEqual(r.items.length, 2);
    const [a, b] = r.items;
    assert.strictEqual(a.link, 'https://www.youtube.com/shorts/6HJTb3bTOnw');
    assert.strictEqual(a.src, 'Arirang News');
    assert.ok(Math.abs(Date.parse(a.pub) - (Date.now() - 2 * 3600e3)) < 60e3, 'published, not updated');
    assert.strictEqual(a.img, 'https://i3.ytimg.com/vi/6HJTb3bTOnw/hqdefault.jpg');
    assert.strictEqual(a.video, 'https://www.youtube.com/watch?v=6HJTb3bTOnw', 'a Short is still a video link');
    assert.strictEqual(b.title, "S. Korea's military raises alert after drone incursion");
    assert.strictEqual(b.video, 'https://www.youtube.com/watch?v=Ll-R5gaZKUc');
    for (const it of r.items) assert.doesNotMatch(String(it.img), /youtube\.com\/v\//);
  });
});

test('a picture in media:content is still used when the feed marks it as one (or does not say)', async () => {
  const f = feed('france24');
  const xml = `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel>
    <item><title>Gunmen kill 12 in attack on village in northern Burkina Faso</title><link>https://www.france24.com/en/a1</link>
      <pubDate>${rfc(1)}</pubDate><media:content url="https://s.france24.com/a1.jpg" medium="image"/></item>
    <item><title>Drone strike hits fuel depot near Kharkiv</title><link>https://www.france24.com/en/a2</link>
      <pubDate>${rfc(1)}</pubDate><media:content url="https://s.france24.com/a2.jpg?w=1&amp;h=2"/></item>
    <item><title>Riot police clash with protesters in Nairobi</title><link>https://www.france24.com/en/a3</link>
      <pubDate>${rfc(1)}</pubDate><media:content url="https://s.france24.com/a3.mp4" type="video/mp4"/></item>
  </channel></rss>`;
  await withFetch({ [f.url]: xml }, async () => {
    const r = await news.fetchFeed(f);
    assert.deepStrictEqual(r.items.map(i => i.img), ['https://s.france24.com/a1.jpg', 'https://s.france24.com/a2.jpg?w=1&h=2', null]);
    assert.strictEqual(r.items[2].video, 'https://s.france24.com/a3.mp4');
  });
});

test('links that are not http(s) never reach the card', async () => {
  const f = feed('rfi');
  const xml = `<rss><channel>
    <item><title>Army deploys troops to Bamako after attack</title><link>javascript:alert(1)</link><pubDate>${rfc(1)}</pubDate></item>
    <item><title>Army deploys troops to Bamako after attack</title><link>data:text/html,x</link><pubDate>${rfc(1)}</pubDate></item>
    <item><title>Army deploys troops to Bamako after attack</title><link>https://www.rfi.fr/en/ok</link><pubDate>${rfc(1)}</pubDate>
      <enclosure url="javascript:alert(2).jpg" type="image/jpeg"/></item>
  </channel></rss>`;
  await withFetch({ [f.url]: xml }, async () => {
    const r = await news.fetchFeed(f);
    assert.strictEqual(r.items.length, 1);
    assert.strictEqual(r.items[0].link, 'https://www.rfi.fr/en/ok');
    assert.strictEqual(r.items[0].img, null);
  });
});

test('the map gets placed world stories; old, future-dated and non-conflict stories stay off', async () => {
  const f24 = feed('france24'), ari = feed('arirang');
  const routes = {
    [f24.url]: `<rss><channel>
      <item><title>Senegal navy intercepts migrant boat, 7 dead</title><link>https://www.france24.com/en/1</link><pubDate>${rfc(2)}</pubDate></item>
      <item><title>Shooting at Krakow shopping centre leaves two injured</title><link>https://www.france24.com/en/2</link><pubDate>${rfc(3)}</pubDate></item>
      <item><title>Old: Senegal army clashes with rebels in Casamance</title><link>https://www.france24.com/en/3</link><pubDate>${rfc(60)}</pubDate></item>
      <item><title>Future: Explosion in Dakar port</title><link>https://www.france24.com/en/4</link><pubDate>${rfc(-5)}</pubDate></item>
      <item><title>COP31 talks reach deadlock in Antalya</title><link>https://www.france24.com/en/5</link><pubDate>${rfc(1)}</pubDate></item>
    </channel></rss>`,
    [ari.url]: ARIRANG(ytEntry('aaaaaaaaaaa', 'N. Korea fires ballistic missile into East Sea', 1)
      + ytEntry('bbbbbbbbbbb', '[Weather] Rain on east coast, Seoul at 0 degrees tomorrow', 1))
  };
  await withFetch(routes, async () => {
    const res = await news.handler({ queryStringParameters: { max: '160' } });
    assert.strictEqual(res.statusCode, 200);
    const j = JSON.parse(res.body);
    const got = Object.fromEntries(j.features.map(x => [x.properties.title, x.properties]));
    assert.strictEqual(got['Senegal navy intercepts migrant boat, 7 dead'].place, 'Senegal');
    assert.strictEqual(got['Senegal navy intercepts migrant boat, 7 dead'].domain, 'France 24');
    assert.strictEqual(got['Shooting at Krakow shopping centre leaves two injured'].place, 'Krakow');
    assert.strictEqual(got['Shooting at Krakow shopping centre leaves two injured'].precision, 'city');
    assert.strictEqual(got['N. Korea fires ballistic missile into East Sea'].domain, 'Arirang News');
    assert.strictEqual(got['N. Korea fires ballistic missile into East Sea'].video, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    assert.ok(!got['Old: Senegal army clashes with rebels in Casamance'], 'older than 48 h');
    assert.ok(!got['Future: Explosion in Dakar port'], 'dated hours ahead');
    assert.ok(!got['COP31 talks reach deadlock in Antalya'], 'deadlock is not war news');
    assert.ok(!got['[Weather] Rain on east coast, Seoul at 0 degrees tomorrow'], 'weather is not war news');
    assert.strictEqual(j._stats.feedsTotal, news.FEEDS.length);
    assert.strictEqual(j._status, 'partial', 'the other feeds answered 404 here');
  });
});

// ── where it happened ────────────────────────────────────────
test('stories are placed at the most precise place the headline names', () => {
  assert.strictEqual(at('Senegal navy intercepts migrant boat, 7 dead'), 'Senegal');
  assert.strictEqual(at('Shooting at Krakow shopping centre leaves two injured', 'Police in Poland said...'), 'Krakow');
  assert.strictEqual(at('Bangladesh challenges ousted PM Hasina verdict', 'Hasina has been living in India since'), 'Bangladesh');
  assert.strictEqual(at('Russian drones hit power station in Kharkiv'), 'kharkiv', 'the theatre table still answers first for its cities');
  assert.strictEqual(at('Floods kill dozens in Dhaka slums'), 'Dhaka');
  assert.strictEqual(at('Rebels seize town in DR Congo'), 'DR Congo');
  assert.strictEqual(at('Chad army repels Boko Haram attack near Lake Chad border'), 'Chad');
  assert.strictEqual(at('Gunmen attack bus in Côte d\'Ivoire'), 'Côte d\'Ivoire');
  assert.strictEqual(at('Protests in São Paulo turn violent'), 'São Paulo');
  assert.strictEqual(at('S. Korea\'s military raises alert after drone incursion'), 'South Korea');
  assert.strictEqual(at('N. Korea fires ballistic missile into East Sea'), 'North Korea');
  assert.strictEqual(at('Troops deployed', 'Soldiers were sent to Mexico City after the blast'), 'Mexico City');
  assert.strictEqual(at('Explosion at chemical plant kills four'), null, 'no place, no pin');
});

test('people, teams and other names are not places', () => {
  assert.strictEqual(world.cityIn('Paris Hilton attacked by photographers'), null);
  assert.strictEqual(world.cityIn('Manchester United fans riot after defeat'), null);
  assert.strictEqual(world.countryIn('Chad Daybell sentenced to death'), null);
  assert.strictEqual(world.countryIn('Militants attack oil pipeline in the Niger Delta'), null);
  assert.strictEqual(world.countryIn('Jordan Peterson warns of crisis'), null);
  assert.strictEqual(world.countryIn('New Jersey police shooting'), null, 'Jersey is not the island');
  assert.strictEqual(world.countryIn('Georgia sheriff says gunman killed'), null, 'Georgia is not the country');
  assert.strictEqual(world.cityIn('Paris police disperse protest').name, 'Paris');
  assert.strictEqual(world.cityIn('Riot police clash with protesters in Paris').name, 'Paris');
  // Title Case headlines capitalise every word, so "followed by a capital" proves nothing there.
  assert.ok(world.titleCase('Gunmen Storm Hotel In Mogadishu Killing Three'));
  assert.strictEqual(world.cityIn('Gunmen Storm Hotel In Mogadishu Killing Three').name, 'Mogadishu');
});

test('the desktop app runs the War Room function locally and the credits page names the new sources', () => {
  const fs = require('fs');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'electron', 'server.js'), 'utf8');
  assert.match(srv, /for \(const fn of \['proxy-newsgeo', /);
  const credits = fs.readFileSync(path.join(__dirname, '..', 'sources.html'), 'utf8');
  for (const name of ['France 24', 'WION', 'Arirang News', 'Yonhap', 'Africanews', 'MercoPress', 'Natural Earth']) {
    assert.ok(credits.includes(name), 'sources.html should credit ' + name);
  }
  assert.match(credits, /plays no news video/);
});

test('words that only look like war news are not counted', () => {
  assert.deepStrictEqual(news.classify('COP31 climate talks end in deadlock'), []);
  assert.deepStrictEqual(news.classify('David Warner hits century as Australia win'), []);
  assert.deepStrictEqual(news.classify('Minister denied any wrongdoing'), []);
  assert.deepStrictEqual(news.classify('Report a bombshell for the government'), []);
  assert.deepStrictEqual(news.classify('Raiders beat Chiefs 24-21'), []);
  assert.deepStrictEqual(news.classify('Studio wraps photo shoot in Lagos'), []);
  assert.deepStrictEqual(news.classify('Russell Brand sentenced to 10 years for rape and sexual assault'), []);
  assert.ok(news.classify('Gunmen assault army post near Gao').includes('attack'));
  assert.ok(news.classify('Roadside IED kills three soldiers').includes('attack'));
  assert.ok(news.classify('Officials warn of new strikes').includes('escalation'));
  assert.ok(news.classify('Gunmen killing villagers').includes('casualty'));
});
