// ============================================================
// wire/parse — one parser per payload kind
// ============================================================
// WHY THIS EXISTS
// The wire reads about 130 feeds that all break the rules in their own way: Mastodon
// items have no title, Google Trends points every item at the same link, Cloudflare's
// <published> is a date next week, the DW feed is RDF, and a closing tag goes missing
// sooner or later. Each parser here was written against a capture of the live payload
// from 2026-10-30, not against what the format is supposed to look like.
//
// DESIGN NOTES
// - Tolerant of damage, strict about identity. A broken item is skipped, and an XML
//   parser is regex based (as proxy-newsgeo.js is) so one bad tag cannot lose the
//   document. But a body that is not the expected document at all throws, and that is
//   deliberate: the scheduler then reports the source as failing. An HTML error page
//   served with HTTP 200 must never read as "feed has no items", and for NTAS it must
//   never read as "no active advisory". See CLAUDE.md, Verification standard.
// - `u` doubles as identity. The published item id is sha1(canonical url || sid+guid),
//   so a shared url collapses distinct items into one. Parsers therefore give a
//   per-item url or ''. FAA and SWPC have no per-item page and use ''; a repeated link
//   inside an RSS document is treated as no link at all.
// - cat0/sev0 are only set where the feed itself knows. Everything else is left unset
//   for classify.js. sev0 values come from section 4 of the spec; where section 4 is
//   silent (GDACS colours, FAA ground stops, extreme NWS weather) the mapping is noted
//   beside the table and stays at or below 2, so it can never reach the page gate.
// - Stateless, except what is kept in the caller's ctx: faaSeen (which airport+type
//   pairs were already announced), usgsBig (M6+ quakes of the last 24 h, because the
//   source feed only spans one hour) and ctx.official (published as stats.official).

'use strict';

const { sha16, decodeEntities, cleanText, safeUrl, domainOf } = require('./util');

const H_MAX = 240;
const X_MAX = 280;
const MAX_ITEMS = 500; // hostile-feed bound, far above any feed in the catalog
const HOUR = 3600000;
const DAY = 24 * HOUR;

const nowOf = (ctx) => (ctx && typeof ctx.now === 'function' ? ctx.now() : Date.now());

function setOfficial(ctx, key, value) {
  if (!ctx) return;
  if (!ctx.official) ctx.official = {};
  ctx.official[key] = value;
}

// One newsroom with several domains. Corroboration counts distinct publishers, so if
// the BBC feed says bbc.co.uk and Google News says bbc.com, the BBC confirms itself and
// a single report reads as two. That is the failure the truth ladder exists to prevent.
const PUB_ALIAS = new Map([
  ['bbc.com', 'bbc.co.uk'],
  ['go.com', 'abcnews.go.com'],
  ['abcnews.com', 'abcnews.go.com'],
  ['skynews.com', 'sky.com'],
  ['nyt.com', 'nytimes.com'],
  ['cnn.io', 'cnn.com']
]);
const canonPub = (d) => PUB_ALIAS.get(d) || d;

// Every item leaves through here, so no parser can forget a sanitising step.
function mk(source, f) {
  const h = cleanText(f.h, H_MAX);
  if (!h) return null;
  let x = cleanText(f.x, X_MAX);
  // Many feeds repeat the title as the description. Keep only what the snippet adds.
  const stem = h.replace(/\u2026$/, '');
  if (x.startsWith(stem)) x = x.slice(stem.length).replace(/^[\s.,:;\u2013\u2014-]+/, '');
  else if (stem.startsWith(x.replace(/\u2026$/, ''))) x = '';
  const u = safeUrl(f.u);
  const item = {
    sid: source.id,
    sn: cleanText(f.sn || source.name, 80),
    cls: source.cls,
    guid: String(f.guid || u || sha16(h)).slice(0, 512),
    h,
    x,
    u,
    pt: Number.isFinite(f.pt) ? f.pt : null,
    pub: canonPub(f.pub || source.pub || domainOf(u) || domainOf(source.url)),
    firstPoll: false,
    off: source.cls === 'official'
  };
  if (f.geo) item.geo = f.geo;
  const cat0 = f.cat0 || source.cat0;
  if (cat0) item.cat0 = cat0;
  if (f.sev0 != null) item.sev0 = f.sev0;
  return item;
}

function toMs(v) {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(String(v).trim());
  return Number.isFinite(t) && t > 0 ? t : null;
}

function json(body, label) {
  try {
    return JSON.parse(String(body).replace(/^\uFEFF/, ''));
  } catch (_) {
    throw new Error(label + ': body is not JSON');
  }
}

// Posts have no headline, so one is made: the first sentence if that reads like one,
// otherwise as much as fits. The rest becomes the snippet.
function splitText(text) {
  if (text.length <= H_MAX) return { h: text, x: '' };
  const head = text.slice(0, H_MAX);
  const sentence = /^.{40,}?[.!?\u2026](?=\s)/.exec(head);
  let cut = sentence ? sentence[0].length : head.lastIndexOf(' ');
  if (cut < 40) cut = H_MAX;
  return { h: text.slice(0, cut).trim(), x: text.slice(cut).trim() };
}

// ── XML helpers ─────────────────────────────────────────────────────────────

// Slice a document into blocks. A scanner, not one big regex: a lazy `<item.*?</item>`
// swallows the following item whole when a closing tag is missing, whereas here the
// next opening tag ends the block. CDATA is skipped so markup quoted inside an article
// body is not mistaken for structure.
function xmlBlocks(xml, names) {
  const re = new RegExp('<!\\[CDATA\\[|<(?:' + names + ')(?=[\\s/>])|</(?:' + names + ')\\s*>', 'gi');
  const out = [];
  let open = -1;
  let m;
  while ((m = re.exec(xml))) {
    if (m[0][1] === '!') {
      const end = xml.indexOf(']]>', re.lastIndex);
      if (end < 0) break;
      re.lastIndex = end + 3;
    } else if (m[0][1] === '/') {
      if (open >= 0) out.push(xml.slice(open, m.index));
      open = -1;
    } else {
      if (open >= 0) out.push(xml.slice(open, m.index));
      open = m.index;
    }
  }
  if (open >= 0) out.push(xml.slice(open));
  return out;
}

const childRes = new Map();

// Inner text of the first <name> child, raw. Handles self-closing tags, which a plain
// `<name[^>]*>…</name>` regex reads as an opening tag and runs on past.
function rawChild(block, name) {
  let re = childRes.get(name);
  if (!re) {
    re = {
      open: new RegExp('<' + name + '(?:\\s[^<>]*?)?(/)?>', 'i'),
      close: new RegExp('<!\\[CDATA\\[|</' + name + '\\s*>', 'gi')
    };
    childRes.set(name, re);
  }
  const m = re.open.exec(block);
  if (!m) return null;
  if (m[1]) return '';
  const start = m.index + m[0].length;
  re.close.lastIndex = start;
  let c;
  while ((c = re.close.exec(block))) {
    if (c[0][1] !== '!') return block.slice(start, c.index);
    const end = block.indexOf(']]>', re.close.lastIndex);
    if (end < 0) return block.slice(start);
    re.close.lastIndex = end + 3;
  }
  // No closing tag. The text runs to the next tag.
  const lt = block.indexOf('<', start);
  return block.slice(start, lt < 0 ? block.length : lt);
}

function xmlValue(raw) {
  if (raw == null) return '';
  return String(raw).replace(/<!\[CDATA\[([\s\S]*?)(?:\]\]>|$)/g, '$1').trim();
}

const value = (block, name) => xmlValue(rawChild(block, name));

function attr(tag, name) {
  const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
  return m ? decodeEntities(m[1] !== undefined ? m[1] : m[2]) : '';
}

// Atom carries its url in href, on one of several <link>s. rel=self is the feed.
function atomLink(block) {
  const re = /<link\b([^<>]*?)\/?>/gi;
  let best = '';
  let m;
  while ((m = re.exec(block))) {
    const href = attr(m[1], 'href');
    if (!href) continue;
    const rel = (attr(m[1], 'rel') || 'alternate').toLowerCase();
    if (rel === 'alternate') return href;
    if (!best && rel !== 'self' && rel !== 'replies' && rel !== 'edit') best = href;
  }
  return best;
}

// ── geo helpers ─────────────────────────────────────────────────────────────

function pointGeo(p, lat, lon, r, cc) {
  const la = Number(lat);
  const lo = Number(lon);
  if (lat == null || lon == null || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  const geo = { p: cleanText(p, 120), lat: la, lon: lo, r };
  if (cc) geo.cc = cc;
  return geo;
}

function metres(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Vertex average and the distance to the furthest vertex. The radius is the honest
// extent of the warned area, not a precise pin.
function ringGeo(p, ring, cc) {
  if (!Array.isArray(ring) || !ring.length) return null;
  const pts = ring.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (!pts.length) return null;
  const lon = pts.reduce((s, c) => s + c[0], 0) / pts.length;
  const lat = pts.reduce((s, c) => s + c[1], 0) / pts.length;
  const far = pts.reduce((m, c) => Math.max(m, metres(lat, lon, c[1], c[0])), 0);
  return pointGeo(p, +lat.toFixed(4), +lon.toFixed(4), Math.max(5000, Math.round(far)), cc);
}

// Centroids for alerts with no polygon, keyed by the postal code in a UGC zone id.
// Zone-based NWS alerts arrive with geometry null, and a state dot with a state-sized
// radius is the honest answer. Same reasoning as the gazetteer radii in proxy-newsgeo.
const STATE_R = 250000;
const STATES = {
  AL: [32.8, -86.8], AK: [64.0, -152.0], AZ: [34.3, -111.7], AR: [34.8, -92.4], CA: [37.2, -119.5],
  CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5], DC: [38.9, -77.0], FL: [28.6, -82.4],
  GA: [32.7, -83.4], HI: [20.8, -156.3], ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3],
  IA: [42.0, -93.5], KS: [38.5, -98.4], KY: [37.5, -85.3], LA: [31.0, -92.0], ME: [45.4, -69.2],
  MD: [39.0, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7],
  MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6], NH: [43.7, -71.6],
  NJ: [40.2, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.5, -100.5],
  OH: [40.3, -82.8], OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5],
  SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7],
  VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.4], WV: [38.6, -80.6], WI: [44.6, -89.9],
  WY: [43.0, -107.6], PR: [18.2, -66.4], VI: [18.3, -64.8], GU: [13.4, 144.8], AS: [-14.3, -170.7],
  MP: [15.2, 145.7]
};

function stateGeo(code, p) {
  const c = Object.prototype.hasOwnProperty.call(STATES, code) ? STATES[code] : null;
  return c ? pointGeo(p, c[0], c[1], STATE_R, 'US') : null;
}

// ── rss / atom / rdf ────────────────────────────────────────────────────────

const FEED_ROOT = /<(?:rss|feed|rdf:RDF|channel)[\s>]/i;

// Statuspage marks planned work with these status words, and Cloudflare's feed is
// mostly that. Planned maintenance is not a live signal.
const MAINTENANCE = /\bscheduled maintenance\b|\b(?:Scheduled|In progress|Verifying|Completed)\s*<\/strong>/i;

// §4 sev 3. Not every mention counts: "Supplemental Direction for ED 24-01" and the
// closure of an old directive are paperwork, not a new emergency.
const EMERGENCY_DIRECTIVE = /\bemergency directive\b/i;
const DIRECTIVE_PAPERWORK = /\b(?:supplemental|closed?|closes|closing|retires?|retired|revoked?|revokes|rescind(?:s|ed)?|sunset)\b/i;

// GDACS colours are the feed's own severity. Section 4 does not name them. Green is
// routine, Orange is notable, Red is high, and sev 3 stays with the quake rule.
const GDACS_SEV = new Map([['green', 0], ['orange', 1], ['red', 2]]);

function snippet(raw) {
  return cleanText(raw, 1500)
    .replace(/\s*The post .{1,500}? appeared first on .{1,160}$/i, '') // WordPress footer
    .replace(/\s*\[(?:\u2026|\.\.\.)\]\s*$/, '\u2026')
    .trim();
}

function itemTime(b) {
  const pub = toMs(value(b, 'pubDate')) ?? toMs(value(b, 'dc:date')) ?? toMs(value(b, 'published'));
  const upd = toMs(value(b, 'updated'));
  // Status pages put the maintenance window in <published>, a date in the future, and
  // the time the notice went up in <updated>. On normal feeds published comes first.
  if (pub != null && upd != null) return Math.min(pub, upd);
  return pub != null ? pub : upd;
}

// A site root cannot identify an item. AWS links every incident to its status home page,
// and a one-item feed would slip past the repeat check below and burn that url forever.
function isRootUrl(u) {
  try {
    const p = new URL(u);
    return p.pathname === '/' && !p.search;
  } catch (_) {
    return false;
  }
}

function rssRow(b, source) {
  let link = decodeEntities(value(b, 'link'));
  if (!link) link = atomLink(b);
  const guidTag = /<guid\b([^<>]*)>/i.exec(b);
  const guid = decodeEntities(value(b, 'guid') || value(b, 'id'));
  // RSS says a guid is a permalink unless it says otherwise.
  if (!link && guid && !(guidTag && /isPermaLink\s*=\s*["']false/i.test(guidTag[1]))) link = guid;
  // See guidUrl in sources.js: the link stands still and the guid names the issuance.
  if (source.guidUrl && safeUrl(guid)) link = guid;
  return {
    title: cleanText(value(b, 'title'), 2000),
    link: safeUrl(link),
    guid,
    body: value(b, 'description') || value(b, 'summary') || value(b, 'content') || value(b, 'content:encoded'),
    pt: itemTime(b)
  };
}

function feedGeo(b) {
  let lat = value(b, 'geo:lat');
  let lon = value(b, 'geo:long');
  if (!lat || !lon) {
    const point = value(b, 'georss:point').split(/\s+/);
    if (point.length === 2) { lat = point[0]; lon = point[1]; }
  }
  if (!lat || !lon) return null;
  return pointGeo(value(b, 'gdacs:country'), lat, lon, 50000);
}

function parseRss(body, source) {
  const blocks = xmlBlocks(body, 'item|entry').slice(0, MAX_ITEMS);
  if (!blocks.length && !FEED_ROOT.test(body)) throw new Error('not a feed');
  const rows = blocks.map((b) => rssRow(b, source));

  // A link shared by items identifies none of them. Trends points every item at the feed.
  const uses = new Map();
  for (const r of rows) if (r.link) uses.set(r.link, (uses.get(r.link) || 0) + 1);

  const out = [];
  rows.forEach((r, i) => {
    const b = blocks[i];
    if (source.statusPage && MAINTENANCE.test(decodeEntities(r.body))) return;

    let h = r.title;
    let x = snippet(r.body);
    if (!h) { // Mastodon: no <title>, the post is the description
      const parts = splitText(cleanText(r.body, 4000));
      h = parts.h;
      x = parts.x;
    }
    const link = uses.get(r.link) === 1 && !isRootUrl(r.link) ? r.link : '';
    const f = { guid: r.guid || link || sha16(h + '|' + (r.pt || '')), h, x, u: link, pt: r.pt };

    if (b.includes('<ht:news_item')) {
      // Trends. Its top article changes while a term trends, and the url is identity,
      // so the stable link is the term's own page. The article becomes the snippet.
      f.x = value(b, 'ht:news_item_title');
      f.u = 'https://trends.google.com/trends/explore?geo=US&q=' + encodeURIComponent(h);
    }

    const geo = feedGeo(b);
    if (geo) f.geo = geo;

    const level = value(b, 'gdacs:alertlevel').toLowerCase();
    if (level) f.sev0 = GDACS_SEV.has(level) ? GDACS_SEV.get(level) : 0;

    if (/^cisa-/.test(source.id || '') && EMERGENCY_DIRECTIVE.test(h) && !DIRECTIVE_PAPERWORK.test(h)) f.sev0 = 3;

    out.push(mk(source, f));
  });
  return out;
}

// ── gnews ───────────────────────────────────────────────────────────────────

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

// Google appends " - Publisher" to every title. Left in place it would split the same
// story into a different token set per outlet and quietly defeat clustering.
function stripPublisher(title, publisher) {
  // Google sometimes sends a title that is nothing but " - Reuters". Trimmed, that no longer
  // ends in " - Reuters", so without this it reaches the feed as a headline.
  if (/^-\s/.test(title)) return '';
  if (publisher && title.toLowerCase().endsWith((' - ' + publisher).toLowerCase())) {
    return title.slice(0, title.length - publisher.length - 3).trim();
  }
  const i = title.lastIndexOf(' - ');
  if (i <= 0) return title;
  const tail = title.slice(i + 3);
  if (!publisher) return title.slice(0, i).trim();
  const a = squash(tail);
  const b = squash(publisher);
  return a && b && (a.includes(b) || b.includes(a)) ? title.slice(0, i).trim() : title;
}

function parseGnews(body, source) {
  const blocks = xmlBlocks(body, 'item').slice(0, MAX_ITEMS);
  if (!blocks.length && !FEED_ROOT.test(body)) throw new Error('not a feed');
  const out = [];
  for (const b of blocks) {
    const title = cleanText(value(b, 'title'), 2000);
    const tag = /<source\b([^<>]*)>/i.exec(b);
    const publisher = cleanText(value(b, 'source'), 80);
    const link = safeUrl(decodeEntities(value(b, 'link')));
    out.push(mk(source, {
      guid: decodeEntities(value(b, 'guid')) || link,
      h: stripPublisher(title, publisher),
      x: '', // the description only repeats the title
      u: link,
      pt: toMs(value(b, 'pubDate')),
      sn: publisher || source.name,
      pub: domainOf(tag ? attr(tag[1], 'url') : '') || source.pub
    }));
  }
  return out;
}

// ── telegram ────────────────────────────────────────────────────────────────

// Inner HTML of a div, counting nested divs so a stray one cannot end it early.
function divInner(html, start) {
  const re = /<div\b|<\/div\s*>/gi;
  re.lastIndex = start;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return html.slice(start);
}

const TG_POST = /^[A-Za-z0-9_]{1,64}\/\d{1,12}$/;
const BARE_LINK_LINE = /^(?:[\w ]{0,24}:\s*)?(?:https?:\/\/\S+|@\w+)$/i;

function parseTelegram(body, source) {
  const marks = [...body.matchAll(/<div\b[^>]*\bdata-post="([^"]+)"[^>]*>/g)];
  // A channel with its preview switched off answers 200 with a landing page and no posts.
  if (!marks.length) throw new Error('telegram: no posts on page');
  const out = [];
  marks.slice(-MAX_ITEMS).forEach((m, i, list) => {
    const post = m[1];
    if (!TG_POST.test(post)) return;
    const next = list[i + 1];
    const block = body.slice(m.index, next ? next.index : body.length);

    // js-message_text only: a reply also quotes its parent, as js-message_reply_text.
    const open = /<div\b[^>]*\bjs-message_text\b[^>]*>/.exec(block);
    const lines = open
      ? divInner(block, open.index + open[0].length)
        .split(/<br\s*\/?>/i)
        .map((l) => cleanText(l))
        .filter((l) => l && !BARE_LINK_LINE.test(l))
      : [];

    let h = '';
    let x = '';
    if (lines.length) {
      const pair = lines[0].length < 20 && lines.length > 1; // "BREAKING:" on its own line
      const parts = splitText(pair ? lines[0] + ' ' + lines[1] : lines[0]);
      h = parts.h;
      x = [parts.x].concat(lines.slice(pair ? 2 : 1)).filter(Boolean).join(' ');
    } else {
      const title = /<div\b[^>]*\blink_preview_title\b[^>]*>/.exec(block);
      if (title) h = cleanText(divInner(block, title.index + title[0].length));
    }
    if (!h) return; // media with no caption says nothing to read

    const when = /<time\b[^>]*\bdatetime="([^"]+)"/.exec(block);
    out.push(mk(source, { guid: post, h, x, u: 'https://t.me/' + post, pt: toMs(when && when[1]) }));
  });
  return out;
}

// ── truth ───────────────────────────────────────────────────────────────────

const TRUTH_PLACEHOLDER = /^(?:\w+ )?post from [a-z]+ \d{1,2}, \d{4}$/i;

function parseTruth(body, source) {
  const blocks = xmlBlocks(body, 'item').slice(0, MAX_ITEMS);
  if (!blocks.length && !FEED_ROOT.test(body)) throw new Error('not a feed');
  const out = [];
  for (const b of blocks) {
    const title = cleanText(value(b, 'title'), 4000);
    const placeholder = TRUTH_PLACEHOLDER.test(title);
    const html = value(b, 'description');
    const quote = /<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/i.exec(html);

    // Strip the archive's own chrome so that what is left is what the post said.
    const scrub = (s) => cleanText(s
      .replace(/<a\b[^>]*>\s*View (?:image|video|media|audio)\s*<\/a>/gi, ' ')
      .replace(/<p>\s*Quoted\b[\s\S]*?<\/p>/gi, ' '), 4000)
      .replace(/\bRT:\s*https?:\/\/\S+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const said = scrub(html.replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, ' ')) || scrub(quote ? quote[1] : '');
    const text = said || (placeholder ? '' : title);

    // A link or a photo with no words: keep the post, and say what it was.
    const words = text.replace(/https?:\/\/\S+/g, '').trim();
    const parts = words ? splitText(text) : { h: title, x: text };

    const link = decodeEntities(value(b, 'link'));
    const guid = decodeEntities(value(b, 'guid'));
    out.push(mk(source, {
      guid: value(b, 'truth:originalId') || guid || link,
      h: parts.h,
      x: parts.x,
      u: safeUrl(decodeEntities(value(b, 'truth:originalUrl'))) || link,
      pt: toMs(value(b, 'pubDate'))
    }));
  }
  return out;
}

// ── nws ─────────────────────────────────────────────────────────────────────

// §7: the civil set survives whatever its severity field says.
const CIVIL = new Set([
  'Civil Danger Warning', 'Civil Emergency Message', 'Law Enforcement Warning',
  'Local Area Emergency', 'Evacuation Immediate', 'Shelter In Place Warning',
  'Nuclear Power Plant Warning', 'Radiological Hazard Warning',
  'Hazardous Materials Warning', '911 Telephone Outage Emergency'
]);
// §4.
const NWS_CRITICAL = new Set(['Tsunami Warning', 'Nuclear Power Plant Warning', 'Radiological Hazard Warning']);
const NWS_HIGH = new Set([
  'Civil Danger Warning', 'Civil Emergency Message', 'Law Enforcement Warning',
  'Evacuation Immediate', 'Shelter In Place Warning'
]);
// §7: 229 of about 300 live alerts are marine. Some of those carry severity Severe, so
// the severity test alone does not remove them.
const MARINE_EVENT = /\b(?:gale|small craft|marine|hazardous seas|freezing spray|hurricane force wind|low water advisory|brisk wind)\b/i;
const MARINE_ZONE = /^(?:AM|AN|GM|LC|LE|LH|LM|LO|LS|PH|PK|PM|PS|PZ|SL)Z/;

function nwsAreas(areaDesc) {
  const areas = String(areaDesc || '').split(';').map((a) => a.trim()).filter(Boolean);
  const shown = areas.slice(0, 3).join('; ');
  return areas.length > 3 ? shown + ' +' + (areas.length - 3) + ' more' : shown;
}

function nwsGeo(f, p) {
  const area = String(p.areaDesc || '').split(';')[0].trim();
  const g = f.geometry;
  if (g && g.type === 'Polygon') {
    const geo = ringGeo(area, g.coordinates && g.coordinates[0], 'US');
    if (geo) return geo;
  }
  if (g && g.type === 'MultiPolygon') {
    const geo = ringGeo(area, g.coordinates && g.coordinates[0] && g.coordinates[0][0], 'US');
    if (geo) return geo;
  }
  const ugc = p.geocode && Array.isArray(p.geocode.UGC) ? p.geocode.UGC[0] : '';
  const code = /^[A-Z]{2}/.test(ugc || '') ? ugc.slice(0, 2) : (/,\s*([A-Z]{2})\b/.exec(p.areaDesc || '') || [])[1];
  return stateGeo(code, area);
}

function parseNws(body, source, ctx) {
  const doc = json(body, 'nws');
  if (!doc || !Array.isArray(doc.features)) throw new Error('nws: no features');
  const counts = { extreme: 0, severe: 0, civil: 0 };
  const out = [];
  for (const f of doc.features) {
    const p = f && f.properties;
    if (!p) continue;
    // The url already asks for these, but a drill must never pass on the url alone.
    if (p.status && p.status !== 'Actual') continue;
    if (p.messageType === 'Cancel') continue;

    const event = String(p.event || '');
    const civil = CIVIL.has(event);
    if (!civil && p.severity !== 'Extreme' && p.severity !== 'Severe') continue;
    if (!civil && !NWS_CRITICAL.has(event)) {
      const zones = p.geocode && Array.isArray(p.geocode.UGC) ? p.geocode.UGC : [];
      if (MARINE_EVENT.test(event) || (zones.length && zones.every((z) => MARINE_ZONE.test(z)))) continue;
    }

    if (civil) counts.civil++;
    if (p.severity === 'Extreme') counts.extreme++;
    if (p.severity === 'Severe') counts.severe++;

    let sev0 = 0;
    if (NWS_CRITICAL.has(event)) sev0 = 3;
    else if (NWS_HIGH.has(event)) sev0 = 2;
    else if (civil || p.severity === 'Extreme') sev0 = 1; // §4 is silent; notable, never paged

    const line = p.parameters && Array.isArray(p.parameters.NWSheadline) ? p.parameters.NWSheadline[0] : '';
    let cat0 = ['disaster'];
    if (event === '911 Telephone Outage Emergency') cat0 = ['infra'];
    else if (civil) cat0 = ['security'];
    out.push(mk(source, {
      guid: p.id || f.id,
      h: [event, nwsAreas(p.areaDesc)].filter(Boolean).join(': '),
      x: line || String(p.description || '').replace(/^\s*[A-Z0-9]{6}\s+/, ''), // AWIPS product id
      u: p['@id'] || f.id,
      pt: toMs(p.sent) ?? toMs(p.effective),
      geo: nwsGeo(f, p),
      cat0,
      sev0
    }));
  }
  setOfficial(ctx, 'nws', counts);
  return out;
}

// ── usgs / emsc ─────────────────────────────────────────────────────────────

const quakeSev = (mag) => (mag >= 7 ? 3 : mag >= 6 ? 2 : 0); // §4

function parseUsgs(body, source, ctx) {
  const doc = json(body, 'usgs');
  if (!doc || !Array.isArray(doc.features)) throw new Error('usgs: no features');
  const out = [];
  const now = nowOf(ctx);
  // The feed spans one hour but the stat is 24 h, so the count has to be kept here.
  const big = ctx ? (ctx.usgsBig || (ctx.usgsBig = new Map())) : null;
  for (const f of doc.features) {
    const p = f && f.properties;
    if (!p) continue;
    const mag = Number(p.mag);
    const c = f.geometry && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : [];
    const pt = toMs(p.time);
    if (big && mag >= 6 && pt != null) big.set(String(f.id), pt);
    out.push(mk(source, {
      guid: f.id,
      h: p.title || 'M ' + mag + ' - ' + p.place,
      x: Number.isFinite(c[2]) ? 'Depth ' + c[2] + ' km' : '',
      u: p.url,
      pt,
      geo: pointGeo(p.place, c[1], c[0], 10000),
      cat0: ['disaster'],
      sev0: quakeSev(mag)
    }));
  }
  if (big) {
    for (const [id, t] of big) if (now - t > DAY) big.delete(id);
    setOfficial(ctx, 'usgs', { m6p24h: big.size });
  }
  return out;
}

const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s,(/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

function parseEmsc(body, source) {
  const doc = json(body, 'emsc');
  if (!doc || !Array.isArray(doc.features)) throw new Error('emsc: no features');
  const out = [];
  for (const f of doc.features) {
    const p = f && f.properties;
    if (!p) continue;
    const mag = Number(p.mag);
    if (!Number.isFinite(mag)) continue;
    const region = titleCase(p.flynn_region);
    const unid = p.unid || f.id;
    out.push(mk(source, {
      guid: unid,
      h: 'M ' + mag + ' - ' + region,
      x: Number.isFinite(Number(p.depth)) && p.depth != null ? 'Depth ' + p.depth + ' km' : '',
      u: unid ? 'https://www.seismicportal.eu/eventdetails.html?unid=' + encodeURIComponent(unid) : '',
      pt: toMs(p.time),
      geo: pointGeo(region, p.lat, p.lon, 15000),
      cat0: ['disaster'],
      sev0: quakeSev(mag)
    }));
  }
  return out;
}

// ── ntas ────────────────────────────────────────────────────────────────────

// No bulletin was active when this was written, so the shape of a live <alert> could
// not be captured. It is read loosely on purpose: any <alert> at all counts as active
// and emits, even if nothing inside it is recognised. A bulletin that parses badly
// must still reach the owner. An empty <alerts> root is the real "no advisory".
function parseNtas(body, source, ctx) {
  if (!/<alerts[\s/>]/i.test(body)) throw new Error('ntas: no <alerts> root');
  const now = nowOf(ctx);
  const out = [];
  for (const b of xmlBlocks(body, 'alert').slice(0, 20)) {
    const open = /^<alert\b([^<>]*?)\/?>/i.exec(b);
    const tag = open ? open[1] : '';
    const start = toMs(attr(tag, 'start')) ?? toMs(value(b, 'start'));
    const end = toMs(attr(tag, 'end')) ?? toMs(value(b, 'end'));
    if (end != null && end < now) continue;
    const title = attr(tag, 'title') || value(b, 'title') || attr(tag, 'type') || value(b, 'type');
    const summary = value(b, 'summary') || value(b, 'details') || value(b, 'description');
    const link = attr(tag, 'link') || attr(tag, 'href') || decodeEntities(value(b, 'link'));
    out.push(mk(source, {
      guid: link || sha16(title + '|' + (start || '') + '|' + summary.slice(0, 200)),
      h: title ? 'NTAS: ' + title : 'NTAS advisory issued',
      x: summary,
      u: link,
      pt: start,
      cat0: ['security'],
      sev0: 3
    }));
  }
  const items = out.filter(Boolean);
  setOfficial(ctx, 'ntas', { active: items.length > 0, title: items.length ? items[0].h : null });
  return items;
}

// ── faa ─────────────────────────────────────────────────────────────────────

const faaType = (name) => {
  if (/ground stop/i.test(name)) return 'stop';
  if (/closure/i.test(name)) return 'closure';
  if (/ground delay/i.test(name)) return 'gdp';
  return 'delay';
};

// The list holds standing NOTAMs like "AD AP CLSD TO NON SKED TRANSIENT GA ACFT": LAX
// is open, it just refuses unscheduled private aircraft. Counting those would show
// LAX, LAS and SAN closed on an ordinary day.
const FAA_PARTIAL = /\bCLSD\s+TO\b/i;

// An episode bucket keeps the guid stable across a restart mid-episode (same id, so
// deduped) while letting the same pair announce again on a later occasion.
const FAA_EPISODE = 6 * HOUR;

function faaRows(section) {
  const marks = [...section.matchAll(/<ARPT>([\s\S]*?)<\/ARPT>/gi)];
  return marks.map((m, i) => ({
    arpt: cleanText(m[1], 8).toUpperCase(),
    rest: section.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : section.length)
  }));
}

function faaText(type, arpt, rest) {
  const reason = cleanText(value(rest, 'Reason'), 200);
  if (type === 'stop') {
    const until = cleanText(value(rest, 'End_Time'), 40);
    return { h: 'Ground stop at ' + arpt + ': ' + reason, x: until ? 'Until ' + until : '' };
  }
  if (type === 'gdp') {
    const avg = cleanText(value(rest, 'Avg'), 30);
    const max = cleanText(value(rest, 'Max'), 30);
    return { h: 'Ground delay at ' + arpt + ': ' + reason, x: [avg && 'Average ' + avg, max && 'max ' + max].filter(Boolean).join(', ') };
  }
  if (type === 'closure') {
    const start = cleanText(value(rest, 'Start'), 40);
    const reopen = cleanText(value(rest, 'Reopen'), 40);
    return { h: 'Airport closure at ' + arpt + ': ' + reason, x: [start && 'From ' + start, reopen && 'until ' + reopen].filter(Boolean).join(' ') };
  }
  const tag = /<Arrival_Departure\b([^<>]*)>/i.exec(rest);
  const dir = tag ? attr(tag[1], 'Type') : '';
  const min = cleanText(value(rest, 'Min'), 30);
  const max = cleanText(value(rest, 'Max'), 30);
  const trend = cleanText(value(rest, 'Trend'), 30);
  return {
    h: (dir || 'General') + ' delays at ' + arpt + ': ' + reason,
    x: [min && max ? min + ' to ' + max : min || max, trend].filter(Boolean).join(', ')
  };
}

function parseFaa(body, source, ctx) {
  if (!/<AIRPORT_STATUS_INFORMATION\b/i.test(body)) throw new Error('faa: not an airport status document');
  const updated = toMs(value(body, 'Update_Time'));
  const counts = { stops: 0, delays: 0, closures: 0, updated };
  const current = new Map();

  for (const section of xmlBlocks(body, 'Delay_type')) {
    const type = faaType(value(section, 'Name'));
    for (const { arpt, rest } of faaRows(section)) {
      if (!arpt) continue;
      if (type === 'closure' && FAA_PARTIAL.test(value(rest, 'Reason'))) continue;
      const key = arpt + '|' + type;
      if (current.has(key)) continue;
      current.set(key, { type, arpt, rest });
      if (type === 'stop') counts.stops++;
      else if (type === 'closure') counts.closures++;
      else counts.delays++;
    }
  }

  const seen = ctx && ctx.faaSeen instanceof Set ? ctx.faaSeen : null;
  const episode = Math.floor(nowOf(ctx) / FAA_EPISODE);
  const out = [];
  for (const [key, row] of current) {
    if (seen && seen.has(key)) continue;
    const text = faaText(row.type, row.arpt, row.rest);
    // A nightly curfew-style closure ("DLY") is routine. §4 is silent on FAA, so stops
    // and unplanned closures are notable and nothing here can reach the page gate.
    const routine = row.type === 'closure' && /\bDLY\b/.test(value(row.rest, 'Reason'));
    const notable = (row.type === 'stop' || row.type === 'closure') && !routine;
    out.push(mk(source, {
      guid: key + '|' + episode,
      h: text.h,
      x: text.x,
      u: '', // no per-event page, and a shared url would merge every event into one id
      pt: updated,
      cat0: ['infra'],
      sev0: notable ? 1 : 0
    }));
  }
  if (ctx) ctx.faaSeen = new Set(current.keys());
  setOfficial(ctx, 'faa', counts);
  return out;
}

// ── swpc / eonet / fema / hn ────────────────────────────────────────────────

function parseSwpc(body, source) {
  const rows = json(body, 'swpc');
  if (!Array.isArray(rows)) throw new Error('swpc: not a list');
  const out = [];
  for (const r of rows) {
    if (!r || typeof r.message !== 'string') continue;
    const msg = r.message;
    const code = (/Message Code:\s*([A-Z0-9]+)/.exec(msg) || [])[1] || r.product_id || '';
    const serial = (/Serial Number:\s*(\d+)/.exec(msg) || [])[1] || r.issue_datetime || '';
    const lines = msg.split(/\r?\n\r?\n/).slice(1).join('\n').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const stamp = String(r.issue_datetime || '');
    out.push(mk(source, {
      guid: code + '-' + serial,
      h: lines[0],
      x: lines.slice(1).join(' '),
      u: '', // every alert would share the one products page
      pt: toMs(stamp ? stamp.replace(' ', 'T') + 'Z' : ''),
      cat0: ['disaster'],
      sev0: /\bG[45]\b|K-index of [89]\b/.test(lines[0]) ? 1 : 0 // grid-relevant storms
    }));
  }
  return out;
}

function parseEonet(body, source) {
  const doc = json(body, 'eonet');
  if (!doc || !Array.isArray(doc.events)) throw new Error('eonet: no events');
  const out = [];
  for (const e of doc.events) {
    if (!e) continue;
    const track = Array.isArray(e.geometry) ? e.geometry : [];
    const g = track[track.length - 1] || {}; // storms grow a track; the last fix is the latest
    const c = g.coordinates;
    const geo = g.type === 'Point' && Array.isArray(c)
      ? pointGeo(e.title, c[1], c[0], 25000)
      : ringGeo(e.title, Array.isArray(c) ? c[0] : null);
    const cat = Array.isArray(e.categories) && e.categories[0] ? e.categories[0].title : '';
    const size = g.magnitudeValue != null ? g.magnitudeValue + ' ' + (g.magnitudeUnit || '') : '';
    out.push(mk(source, {
      guid: e.id,
      h: e.title,
      x: [cat, size].filter(Boolean).join(', '),
      u: e.link,
      pt: toMs(g.date),
      geo,
      cat0: ['disaster']
    }));
  }
  return out;
}

const FEMA_TYPES = { DR: 'Major disaster declaration', EM: 'Emergency declaration', FM: 'Fire management declaration', FS: 'Fire suppression declaration' };

function parseFema(body, source) {
  const doc = json(body, 'fema');
  const rows = doc && doc.DisasterDeclarationsSummaries;
  if (!Array.isArray(rows)) throw new Error('fema: no rows');
  // The API returns one row per county. The event is the declaration.
  const byDecl = new Map();
  for (const r of rows) {
    if (!r) continue;
    const key = r.femaDeclarationString || String(r.disasterNumber || '');
    if (!key) continue;
    if (!byDecl.has(key)) byDecl.set(key, { r, areas: [] });
    if (r.designatedArea) byDecl.get(key).areas.push(r.designatedArea);
  }
  const out = [];
  for (const [key, { r, areas }] of byDecl) {
    const label = Object.prototype.hasOwnProperty.call(FEMA_TYPES, r.declarationType) ? FEMA_TYPES[r.declarationType] : 'Declaration';
    out.push(mk(source, {
      guid: key,
      h: label + ' ' + key + ': ' + r.declarationTitle + ' (' + r.state + ')',
      x: [r.incidentType, areas.join('; ')].filter(Boolean).join(': '),
      u: r.disasterNumber ? 'https://www.fema.gov/disaster/' + encodeURIComponent(r.disasterNumber) : '',
      pt: toMs(r.declarationDate),
      geo: stateGeo(r.state, r.state),
      cat0: ['disaster']
    }));
  }
  return out;
}

function parseHn(body, source) {
  const doc = json(body, 'hn');
  if (!doc || !Array.isArray(doc.hits)) throw new Error('hn: no hits');
  const out = [];
  for (const hit of doc.hits) {
    if (!hit || !hit.objectID) continue;
    // The discussion page, not the story's own url. That url is also the wire outlet's
    // identity, so a story posted here first would mark the outlet's item as already
    // seen, and real reporting would be filed as a social post.
    out.push(mk(source, {
      guid: hit.objectID,
      h: hit.title,
      x: '',
      u: 'https://news.ycombinator.com/item?id=' + encodeURIComponent(hit.objectID),
      pt: Number.isFinite(hit.created_at_i) ? hit.created_at_i * 1000 : toMs(hit.created_at)
    }));
  }
  return out;
}

// ── dispatch ────────────────────────────────────────────────────────────────

const PARSERS = new Map([
  ['rss', parseRss], ['gnews', parseGnews], ['telegram', parseTelegram], ['truth', parseTruth],
  ['nws', parseNws], ['usgs', parseUsgs], ['emsc', parseEmsc], ['ntas', parseNtas], ['faa', parseFaa],
  ['swpc', parseSwpc], ['eonet', parseEonet], ['fema', parseFema], ['hn', parseHn]
]);

function parseBy(kind, body, source, ctx) {
  const parser = PARSERS.get(kind);
  if (!parser) throw new Error('unknown kind: ' + kind);
  return parser(body == null ? '' : String(body), source || {}, ctx).filter(Boolean).slice(0, MAX_ITEMS);
}

module.exports = { parseBy, KINDS: [...PARSERS.keys()] };
