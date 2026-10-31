// ============================================================
// wire/util — the choke point every feed byte passes through
// ============================================================
// WHY THIS EXISTS
// Headlines, snippets and URLs on the wire are attacker-controlled, and the page
// that shows them is opened by the owner, the one account worth stealing. Spec
// ground rule 1 says every byte is hostile, so sanitising lives here once rather
// than in fifteen parsers: fix it here and every source is fixed.
//
// DESIGN NOTES
// - Zero dependencies and CommonJS: this runs on Node 22 on the droplet and Node 20
//   in CI (spec ground rules 7 and 9).
// - cleanText decodes BEFORE it strips, and repeats. Feeds double-encode, so a
//   single pass over `&amp;lt;img onerror=…&amp;gt;` leaves live-looking markup.
//   The client renders textContent anyway; this is the second lock on the door.
// - The entity table is a Map, not an object literal: `&constructor;` must not
//   resolve to Object's constructor.

'use strict';

const crypto = require('crypto');

function sha16(str) {
  return crypto.createHash('sha1').update(String(str)).digest('hex').slice(0, 16);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// Entities that actually turn up in these feeds. Anything unknown is left as text.
const NAMED = new Map(Object.entries({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', bull: '•', middot: '·',
  rsquo: '’', lsquo: '‘', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', deg: '°',
  euro: '€', pound: '£', cent: '¢', yen: '¥', sect: '§', para: '¶',
  times: '×', divide: '÷', plusmn: '±', frac12: '½', frac14: '¼',
  aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä', atilde: 'ã',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  iacute: 'í', igrave: 'ì', iuml: 'ï',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', ouml: 'ö', otilde: 'õ',
  uacute: 'ú', ugrave: 'ù', uuml: 'ü', ntilde: 'ñ', ccedil: 'ç', szlig: 'ß',
  shy: '­', zwj: '‍', zwnj: '‌', lrm: '‎', rlm: '‏'
}));

function decodeEntities(s) {
  if (s == null) return '';
  return String(s).replace(
    /&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g,
    (all, dec, hex, name) => {
      if (name) {
        const v = NAMED.has(name) ? NAMED.get(name) : NAMED.get(name.toLowerCase());
        return v === undefined ? all : v;
      }
      const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
      // Zero, surrogates and anything past U+10FFFF would make fromCodePoint throw
      // or produce broken strings. A feed must not be able to crash a parse this way.
      if (!cp || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '';
      return String.fromCodePoint(cp);
    }
  );
}

// Block tags become a space so `</p><p>` does not glue two sentences together.
const BLOCK_TAG = /<\/?(?:br|p|div|li|ul|ol|tr|td|th|table|h[1-6]|blockquote|pre|hr|section|article)\b[^<>]*>/gi;

function stripTags(s) {
  if (s == null) return '';
  return String(s)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
    .replace(BLOCK_TAG, ' ')
    .replace(/<\/?[a-zA-Z!?][^<>]*>/g, '')
    // A tag cut off by truncation has no `>`; it is still a tag.
    .replace(/<\/?[a-zA-Z!?][^<>]*$/, '');
}

// C0/C1 controls (tab, LF and CR survive to be collapsed as whitespace), soft hyphen,
// bidi marks, overrides and isolates, and the zero-width characters used to split a
// keyword past a filter. ZWJ and ZWNJ stay: emoji sequences and Persian need them.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜​‎‏‪-‮⁠-⁤⁦-⁯﻿￹-￻]/g;

// A description can be megabytes of article HTML. Nothing past this ever reaches a
// 280-character snippet, so do not spend regex time on it.
const CLEAN_INPUT_MAX = 20000;

function truncate(t, max) {
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xD800 && last <= 0xDBFF) cut = cut.slice(0, -1); // never split a surrogate pair
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.7) cut = cut.slice(0, sp);
  return cut.replace(/[\s.,;:]+$/, '') + '…';
}

function cleanText(s, max) {
  if (s == null) return '';
  let t = String(s);
  if (t.length > CLEAN_INPUT_MAX) t = t.slice(0, CLEAN_INPUT_MAX);
  for (let i = 0; i < 3; i++) {
    const next = stripTags(decodeEntities(t));
    if (next === t) break;
    t = next;
  }
  t = t.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  return max ? truncate(t, max) : t;
}

const URL_MAX = 2048;

function safeUrl(u) {
  if (typeof u !== 'string') return '';
  const s = u.trim();
  if (!s || s.length > URL_MAX) return '';
  let p;
  try { p = new URL(s); } catch (_) { return ''; }
  if (p.protocol !== 'http:' && p.protocol !== 'https:') return '';
  if (!p.hostname) return '';
  // https://reuters.com@evil.example/ reads as Reuters and goes to evil.example.
  if (p.username || p.password) return '';
  // The URL parser forgives tabs, newlines and backslashes; do not hand those on.
  return /^https?:\/\/[^\s\\\u0000-\u001f\u007f]*$/i.test(s) ? s : p.href;
}

const TRACKING = /^(?:utm_.*|fbclid|gclid|ref|cmpid|ocid|at_.*)$/i;

function canonUrl(u) {
  const safe = safeUrl(u);
  if (!safe) return '';
  const p = new URL(safe);
  p.hash = '';
  if (p.search) {
    // Filter the raw query rather than use searchParams, which re-encodes every value:
    // the same article with and without a tracker must come out byte-identical.
    const kept = p.search.slice(1).split('&').filter((kv) => {
      if (!kv) return false;
      const key = kv.split('=')[0];
      let name = key;
      try { name = decodeURIComponent(key); } catch (_) { /* keep the raw key */ }
      return !TRACKING.test(name);
    });
    p.search = kept.length ? '?' + kept.join('&') : '';
  }
  return p.href;
}

// Second-level labels that sit under a country code, so bbc.co.uk is the publisher
// and not co.uk. Counting publishers on the wrong label would merge every UK outlet.
const CC_SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ne', 'or', 'go', 'gob', 'gouv', 'mil']);

function domainOf(u) {
  if (!u) return '';
  const s = String(u).trim();
  let host;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s).hostname;
  } catch (_) {
    return '';
  }
  host = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!host) return '';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  return parts.slice(tld.length === 2 && CC_SECOND_LEVEL.has(sld) ? -3 : -2).join('.');
}

function log(level, msg, obj) {
  const base = { ts: new Date().toISOString(), level: String(level), msg: String(msg) };
  const rec = {};
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) rec[k] = obj[k] instanceof Error ? obj[k].message : obj[k];
  } else if (obj !== undefined) {
    rec.data = obj;
  }
  let line;
  try {
    line = JSON.stringify(Object.assign(rec, base));
  } catch (_) {
    line = JSON.stringify(base); // circular or BigInt payload: keep the message
  }
  process.stdout.write(line + '\n');
}

// V8 stores a substring as a pointer into its parent, so one short guid or url can hold a
// whole feed body, or a 20 MB GDELT file, in memory for as long as that string is kept. On
// the first live run this leaked about 2 MB a minute and crashed the collector at its heap
// limit after 2.5 hours, with every item count still inside its cap. So whatever outlives a
// poll gets its own copy. A Buffer round trip, because the usual string tricks can hand back
// a rope or slice that still points at the parent.
function own(s) {
  return typeof s === 'string' ? Buffer.from(s, 'utf8').toString('utf8') : s;
}

const RAW_STRINGS = ['guid', 'h', 'x', 'u', 'sn', 'pub'];

function ownItem(it) {
  for (const k of RAW_STRINGS) if (typeof it[k] === 'string') it[k] = own(it[k]);
  if (it.geo && typeof it.geo.p === 'string') it.geo.p = own(it.geo.p);
  return it;
}

module.exports = { sha16, clamp, decodeEntities, stripTags, cleanText, canonUrl, safeUrl, domainOf, log, own, ownItem };
