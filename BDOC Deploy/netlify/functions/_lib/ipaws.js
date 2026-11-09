// ============================================================
// _lib/ipaws.js — FEMA IPAWS national alerts (p181). Pure: no fetch, no clock.
//
// FEMA sends national alerts and the nationwide EAS test through IPAWS as CAP 1.2
// and publishes a public copy with no key:
//   BASE/public/recent/<ISO time>   active public CAP alerts sent since that time
//   BASE/feed                       Atom list of recent EAS messages (event code only)
//   BASE/eas/<id>                   one EAS message, 403 once it has expired
// FEMA's archive (OpenFEMA IpawsArchivedAlerts) shows the 2023-10-04 national test in
// that public data: EAN 18:18:01Z and NPT 18:20:03Z, both from ipaws@fema.dhs.gov.
// tests/fixtures/ipaws-*.xml are those two messages.
//
// Two traps the fixtures show:
//   - FEMA marks the test severity Extreme and status Actual, so neither tells a test
//     from the real thing. The event code (NPT) and the text ("This is only a test") do.
//   - The 2023 phone test went out as EAN ("National Alert", WEAHandling Presidential)
//     with "THIS IS A TEST" in the text. EAN alone does not mean an emergency.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
'use strict';

const BASE = 'https://apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest';

// SAME event codes that only FEMA may originate (47 CFR 11.31).
const NATIONAL = {
  EAN: 'National Emergency Alert',
  NPT: 'Nationwide Test of the Emergency Alert System',
  NIC: 'National Information Center notice',
  NMN: 'Network Message Notification',
  EAT: 'Emergency Action Termination'
};

// A local office cannot send a national code through IPAWS, but if one ever shows up
// from another sender it is not a national alert, and BDOC never banners it as one.
const FEMA_SENDER = /@fema\.(?:dhs\.)?gov$/i;
const TEST_TEXT = /\b(?:this is (?:only )?a test|esta es una prueba|esto es solo una prueba|es solo una prueba)\b/i;
const SIG_RE = /<(?:[\w-]+:)?Signature\b[\s\S]*?<\/(?:[\w-]+:)?Signature>/g;
const RANK = { emergency: 0, notice: 1, test: 2 };
const MIN = 60e3;

function decode(s) {
  if (s == null) return '';
  const str = String(s);
  const cdata = str.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return str.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    const l = e.toLowerCase();
    if (l === 'amp') return '&';
    if (l === 'lt') return '<';
    if (l === 'gt') return '>';
    if (l === 'quot') return '"';
    if (l === 'apos') return "'";
    const n = l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  }).trim();
}

// <name> or <prefix:name>, with or without attributes. "sender" never matches <senderName>.
function tagRe(name, flags) {
  return new RegExp('<(?:[\\w-]+:)?' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?' + name + '>', flags);
}
function one(xml, name) { const m = xml.match(tagRe(name)); return m ? decode(m[1]) : ''; }
function all(xml, name) {
  const out = [], re = tagRe(name, 'g');
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function pairs(xml, name) {
  return all(xml, name).map(b => ({ name: one(b, 'valueName'), value: one(b, 'value') }));
}
function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
function iso(t) { return new Date(t).toISOString(); }

function parseInfo(b) {
  const params = pairs(b, 'parameter');
  const param = (n) => (params.find(q => q.name === n) || {}).value || '';
  const audio = all(b, 'resource')
    .map(r => ({ mime: one(r, 'mimeType'), uri: one(r, 'uri') }))
    .find(r => /^audio\//i.test(r.mime) && /^https:\/\/[^\s"'<>]+$/i.test(r.uri));
  return {
    language: one(b, 'language') || 'en-US',
    event: one(b, 'event'),
    severity: one(b, 'severity'),
    urgency: one(b, 'urgency'),
    headline: one(b, 'headline'),
    description: one(b, 'description'),
    instruction: one(b, 'instruction'),
    senderName: one(b, 'senderName'),
    expires: one(b, 'expires'),
    codes: pairs(b, 'eventCode').filter(c => /^SAME$/i.test(c.name)).map(c => c.value.toUpperCase()),
    weaHandling: param('WEAHandling'),
    cmam: param('CMAMlongtext') || param('CMAMtext'),
    audio: audio ? audio.uri : '',
    areas: all(b, 'area').map(a => one(a, 'areaDesc')).filter(Boolean)
  };
}

function parseAlert(x) {
  const head = x.replace(tagRe('info', 'g'), '');
  return {
    identifier: one(head, 'identifier'),
    sender: one(head, 'sender'),
    sent: one(head, 'sent'),
    status: one(head, 'status'),
    msgType: one(head, 'msgType'),
    scope: one(head, 'scope'),
    references: one(head, 'references'),
    info: all(x, 'info').map(parseInfo)
  };
}

// A single <alert>, or FEMA's <ns1:alerts> wrapper holding many.
function parseCap(xml) {
  const src = String(xml || '').replace(SIG_RE, '');
  return all(src, 'alert').map(parseAlert).filter(a => a.identifier);
}

function isPresidential(i) { return /^presidential$/i.test(i.weaHandling); }

// One national alert in the shape the app and the push use, or null.
function nationalOf(a, now) {
  if (!a || !FEMA_SENDER.test(a.sender || '')) return null;
  if (!/^(?:actual|test)$/i.test(a.status || '')) return null;      // Exercise, System, Draft never banner
  if (a.scope && !/^public$/i.test(a.scope)) return null;
  if (!/^(?:alert|update)$/i.test(a.msgType || 'Alert')) return null;
  const infos = (a.info || []).filter(i => i.codes.some(c => NATIONAL[c]) || isPresidential(i));
  if (!infos.length) return null;

  const code = infos.map(i => i.codes.find(c => NATIONAL[c])).find(Boolean) || 'EAN';
  const sent = Date.parse(a.sent);
  if (!Number.isFinite(sent)) return null;
  const ends = infos.map(i => Date.parse(i.expires)).filter(Number.isFinite);
  const expires = ends.length ? Math.max(...ends) : sent + 60 * MIN;
  if (expires <= now) return null;

  const langs = {};
  for (const i of infos) {
    const k = /^es/i.test(i.language) ? 'es' : 'en';
    if (langs[k]) continue;
    langs[k] = {
      event: clip(i.event || NATIONAL[code], 120),
      headline: clip(i.headline || i.event || NATIONAL[code], 200),
      text: clip(i.description || i.cmam, 1500),
      instruction: clip(i.instruction, 600),
      audio: i.audio
    };
  }
  const words = infos.map(i => [i.headline, i.description, i.cmam].join(' ')).join(' ');
  const test = code === 'NPT' || /^test$/i.test(a.status) || TEST_TEXT.test(words);
  return {
    id: a.identifier,
    code,
    kind: test ? 'test' : code === 'EAN' ? 'emergency' : 'notice',
    test,
    presidential: infos.some(isPresidential),
    sender: a.sender,
    sent: iso(sent),
    expires: iso(expires),
    langs,
    source: 'ipaws'
  };
}

function refIds(refs) {
  return String(refs || '').trim().split(/\s+/).map(r => r.split(',')[1]).filter(Boolean);
}

// Active national alerts. A FEMA Cancel or Update retires the messages it references.
function nationalList(alerts, now) {
  const gone = new Set();
  for (const a of alerts) {
    if (/^(?:cancel|update)$/i.test(a.msgType) && FEMA_SENDER.test(a.sender || '')) refIds(a.references).forEach(id => gone.add(id));
  }
  const out = [];
  for (const a of alerts) {
    const n = nationalOf(a, now);
    if (n && !gone.has(n.id)) out.push(n);
  }
  return out;
}

function isEasUrl(u) { return typeof u === 'string' && /^https:\/\/apps\.fema\.gov\/IPAWSOPEN_EAS_SERVICE\/rest\/eas\/\d+$/.test(u); }

function attr(s, name) { const m = s.match(new RegExp('\\b' + name + '="([^"]*)"')); return m ? decode(m[1]) : ''; }

function parseEasFeed(xml) {
  return all(String(xml || ''), 'entry').map(e => {
    const cats = {};
    const re = /<category\b([^>]*)\/?>/g;
    let m;
    while ((m = re.exec(e))) cats[attr(m[1], 'label')] = attr(m[1], 'term');
    const link = e.match(/<link\b([^>]*)\/?>/);
    return {
      url: link ? attr(link[1], 'href') : '',
      code: String(cats.event || one(e, 'title')).toUpperCase(),
      statefips: cats.statefips || '',
      updated: one(e, 'updated')
    };
  }).filter(x => x.url);
}

// The EAS feed names the code before the full message can be read. Used only when the
// message itself is not readable, so the banner still appears, in BDOC's own words.
function fromEasEntry(en, now) {
  if (!en || !NATIONAL[en.code] || !isEasUrl(en.url)) return null;
  const t = Date.parse(en.updated);
  if (!(t > now - 60 * MIN) || t > now + 5 * MIN) return null;
  const test = en.code === 'NPT';
  const text = test
    ? 'FEMA is running a nationwide test of the Emergency Alert System. No action is needed.'
    : en.code === 'EAN'
      ? 'FEMA has sent a national alert over the Emergency Alert System. Check TV or radio now.'
      : 'FEMA has sent a national notice over the Emergency Alert System.';
  return {
    id: 'eas-' + en.url.match(/(\d+)$/)[1],
    code: en.code,
    kind: test ? 'test' : en.code === 'EAN' ? 'emergency' : 'notice',
    test,
    presidential: false,
    sender: 'IPAWS EAS feed',
    sent: iso(t),
    expires: iso(t + 30 * MIN),
    langs: { en: { event: NATIONAL[en.code], headline: NATIONAL[en.code], text, instruction: '', audio: '' } },
    source: 'ipaws-eas',
    partial: true
  };
}

// True when two records are the same broadcast: same code within 15 minutes.
function sameBroadcast(a, b) {
  return a.code === b.code && Math.abs(Date.parse(a.sent) - Date.parse(b.sent)) < 15 * MIN;
}

// Full messages win over EAS-feed stand-ins; most urgent first, then newest.
function mergeNational(list) {
  const out = [];
  for (const n of list.filter(x => !x.partial)) if (!out.some(o => o.id === n.id)) out.push(n);
  for (const p of list.filter(x => x.partial)) if (!out.some(o => o.id === p.id || sameBroadcast(o, p))) out.push(p);
  return out.sort((a, b) => (RANK[a.kind] - RANK[b.kind]) || (Date.parse(b.sent) - Date.parse(a.sent)));
}

function titleOf(n) {
  if (n.kind === 'emergency') return n.presidential ? 'PRESIDENTIAL ALERT · FEMA' : 'NATIONAL ALERT · FEMA';
  if (n.kind === 'test') return n.code === 'NPT' ? 'NATIONWIDE TEST · FEMA' : 'NATIONAL ALERT TEST · FEMA';
  return 'FEMA NOTICE';
}

function pushPayload(n, now) {
  const L = n.langs.en || n.langs.es || {};
  return JSON.stringify({
    title: titleOf(n),
    body: clip((L.headline || '') + (L.text ? ' · ' + L.text : ''), 400),
    url: '/#govalert',
    severity: n.kind === 'emergency' ? 'critical' : 'info',
    tag: 'gov:' + n.id,
    ts: now
  });
}

module.exports = {
  BASE, NATIONAL, FEMA_SENDER,
  decode, parseCap, nationalOf, nationalList, parseEasFeed, isEasUrl,
  fromEasEntry, sameBroadcast, mergeNational, titleOf, pushPayload
};
