// ============================================================
// _lib/cyber-incidents.js — cyber incidents from the news, placed where they happened (p182).
// Pure: no fetch, no clock. cyber-incidents.js does the fetching.
//
// Why: the Cyber layer drew made-up hotspots ("US East Coast", "US West Coast")
// with random attack counts whenever Cloudflare Radar and DShield failed, which on
// the live site was always. This replaces it with reported incidents only.
//
// Place lookup reads the headline and summary, never guesses, and says how exact it is:
//   county  "Bucks County", or "X County" + its state named in the text
//   city    an incorporated US place WITH its state named ("Aliquippa, Pa.", "City of
//           Arkansas City" + "Kansas"), or a listed world city
//   state   a US state named in the text
//   country a country named, or its adjective ("French blood bank"), but never an
//           attacker's ("Russian hackers", "China-linked") since that is not where it happened
// US data: Census 2024 Gazetteer (public domain), in cyber-gazetteer.json.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
'use strict';
const GAZ = require('./cyber-gazetteer.json');

// ── text ─────────────────────────────────────────────────────
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', eacute: 'é',
  egrave: 'è', agrave: 'à', ccedil: 'ç', ecirc: 'ê', ocirc: 'ô', icirc: 'î', uuml: 'ü' };
function decode(s) {
  return String(s == null ? '' : s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return NAMED[e.toLowerCase()] != null ? NAMED[e.toLowerCase()] : m;
  });
}
function cdata(s) { const m = String(s || '').match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/); return m ? m[1] : s; }
// Decode twice: feeds often escape their HTML (&lt;p&gt;), so tags only appear after one pass.
function plain(s) { return decode(decode(cdata(s)).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1] : '';
}

// RSS 2.0 items and Atom entries.
function parseFeed(xml, feed) {
  const src = String(xml || '');
  const out = [];
  const re = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let m;
  while ((m = re.exec(src))) {
    const b = m[0];
    let link = plain(tag(b, 'link'));
    if (!link) { const h = b.match(/<link\b[^>]*href="([^"]+)"/i); link = h ? decode(h[1]) : ''; }
    if (!/^https?:\/\//i.test(link)) continue;
    let title = plain(tag(b, 'title'));
    const outlet = plain(tag(b, 'source'));
    if (outlet && title.endsWith(' - ' + outlet)) title = title.slice(0, -(outlet.length + 3));
    const when = Date.parse(plain(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')));
    const summary = feed.google ? '' : clip(plain(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded')), 600);
    if (!title || !Number.isFinite(when)) continue;
    out.push({ title: clip(title, 240), link, summary, published: when, source: outlet || feed.name, feed: feed.id, lang: feed.lang || 'en' });
  }
  return out;
}

// ── is it an incident, and in which sector ───────────────────
const ATTACK = /\b(?:cyber[- ]?attack\w*|cyber[- ]?incident\w*|cybersecurity incident|ransomware|hack(?:ed|ers?|ing)?|breach(?:ed|es)?|data (?:leak|theft)|leak(?:ed|s)? data|ddos|intrusion|compromised|extortion|wiper|malware attack|cyberattaque\w*|cyber-?attaque\w*|piratage|pirat[ée]e?s?|rançongiciel|fuite de données|attaque informatique)\b/i;
const NOT_INCIDENT = /\b(?:patch(?:es|ed)?|vulnerabilit\w+|CVE-\d|zero-day flaw|webinar|podcast|how to|tips|funding|raises \$|acquir\w+|acquisition|award|conference|survey|study finds|report finds|arrest\w*|sentenc\w+|charged|indict\w+|pleads?|extradit\w+|guilty|lawsuit|settle\w*|class action|opinion|explainer|week in review|recap|roundup|drills?|simulation|tabletop|exercise|boost\w* (?:cyber )?defen[cs]es|defend\w*|protecting|lessons|unaffected|plan ahead|defen[cs]e for|everything you need|what to know|what we know|here's (?:how|what)|how (?:did|do|are|to|hackers)|are hackers|could (?:they|hackers)|warn\w*|risks?|researchers?|exploit\w* (?:flaw|bug|vulnerab)|authentication bypass|flaw|bug|threats? grow|should|corrective action)\b|\?\s*$/i;
const REPORTED = /\b(?:notif\w+|disclos\w+|reports?|confirms?|investigat\w+|outage|disrupt\w+|offline|systems? down|incident)\b/i;

const SECTORS = [
  ['water', /\b(?:water (?:utilit\w+|system|systems|treatment|authority|district|department|plant|works|company|supply|infrastructure|facilit\w+|sector|tower|provider)|wastewater|drinking water|municipal water|american water|eau potable|réseau d'eau|traitement des eaux)\b/i],
  ['health', /\b(?:hospital\w*|health ?care|health system|healthcare|clinic\w*|medical|patients?|blood|plasma|pharmac\w+|nursing home|h[ôo]pita\w+|sang|clinique|sant[ée])\b/i],
  ['food', /\b(?:supermarket\w*|grocer\w*|food|foods|restaurant\w*|meat|dairy|farm\w*|agricultur\w+|supermarch[ée]\w*|alimentaire|grande distribution)\b/i],
  ['energy', /\b(?:power grid|electric\w*|utility|utilities|pipeline|oil|natural gas|gas company|nuclear|energy|solar|wind farm|[ée]nergie|[ée]lectricit[ée])\b/i],
  ['government', /\b(?:county|city of|town of|municipal\w*|city hall|city council|government|ministry|state agency|department of|police|sheriff|court|council|mairie|ministère|collectivit[ée]\w*|pr[ée]fecture|commune)\b/i],
  ['education', /\b(?:school\w*|universit\w+|college|district schools|students?|[ée]cole|lyc[ée]e|universit[ée])\b/i],
  ['transport', /\b(?:airport|airline|port of|shipping|rail\w*|transit|transport\w*|logistics|a[ée]roport)\b/i],
  ['finance', /\b(?:bank\w*|credit union|payments?|financial|insurer|insurance|banque)\b/i],
  ['telecom', /\b(?:telecom\w*|carrier|isp|internet provider|mobile operator|op[ée]rateur)\b/i],
  ['retail', /\b(?:retail\w*|store\w*|shop\w*|e-commerce|magasin\w*)\b/i]
];
function isIncident(text) { return ATTACK.test(text) && !NOT_INCIDENT.test(text); }
function sectorOf(title, summary) {
  for (const [k, re] of SECTORS) if (re.test(title)) return k;
  for (const [k, re] of SECTORS) if (re.test(summary)) return k;
  return 'other';
}

// ── places ───────────────────────────────────────────────────
const STATES = [
  ['AL', 'Alabama', 'Ala.'], ['AK', 'Alaska', ''], ['AZ', 'Arizona', 'Ariz.'], ['AR', 'Arkansas', 'Ark.'],
  ['CA', 'California', 'Calif.'], ['CO', 'Colorado', 'Colo.'], ['CT', 'Connecticut', 'Conn.'], ['DE', 'Delaware', 'Del.'],
  ['DC', 'District of Columbia', 'D.C.'], ['FL', 'Florida', 'Fla.'], ['GA', 'Georgia', 'Ga.'], ['HI', 'Hawaii', ''],
  ['ID', 'Idaho', ''], ['IL', 'Illinois', 'Ill.'], ['IN', 'Indiana', 'Ind.'], ['IA', 'Iowa', ''], ['KS', 'Kansas', 'Kan.'],
  ['KY', 'Kentucky', 'Ky.'], ['LA', 'Louisiana', 'La.'], ['ME', 'Maine', ''], ['MD', 'Maryland', 'Md.'],
  ['MA', 'Massachusetts', 'Mass.'], ['MI', 'Michigan', 'Mich.'], ['MN', 'Minnesota', 'Minn.'], ['MS', 'Mississippi', 'Miss.'],
  ['MO', 'Missouri', 'Mo.'], ['MT', 'Montana', 'Mont.'], ['NE', 'Nebraska', 'Neb.'], ['NV', 'Nevada', 'Nev.'],
  ['NH', 'New Hampshire', 'N.H.'], ['NJ', 'New Jersey', 'N.J.'], ['NM', 'New Mexico', 'N.M.'], ['NY', 'New York', 'N.Y.'],
  ['NC', 'North Carolina', 'N.C.'], ['ND', 'North Dakota', 'N.D.'], ['OH', 'Ohio', ''], ['OK', 'Oklahoma', 'Okla.'],
  ['OR', 'Oregon', 'Ore.'], ['PA', 'Pennsylvania', 'Pa.'], ['RI', 'Rhode Island', 'R.I.'], ['SC', 'South Carolina', 'S.C.'],
  ['SD', 'South Dakota', 'S.D.'], ['TN', 'Tennessee', 'Tenn.'], ['TX', 'Texas', ''], ['UT', 'Utah', ''], ['VT', 'Vermont', 'Vt.'],
  ['VA', 'Virginia', 'Va.'], ['WA', 'Washington', 'Wash.'], ['WV', 'West Virginia', 'W.Va.'], ['WI', 'Wisconsin', 'Wis.'],
  ['WY', 'Wyoming', 'Wyo.'], ['PR', 'Puerto Rico', '']
];
const STATE_NAME = Object.fromEntries(STATES.map(s => [s[0], s[1]]));

// Major world cities BDOC can place with confidence (US places come from the Census file).
// Words that are also ordinary English (Nice, Tours, Nancy) are left out on purpose.
const WORLD_CITIES = [
  ['Paris', 'FR', 48.857, 2.352], ['Lyon', 'FR', 45.764, 4.836], ['Marseille', 'FR', 43.296, 5.370], ['Toulouse', 'FR', 43.605, 1.444],
  ['Nantes', 'FR', 47.218, -1.554], ['Strasbourg', 'FR', 48.573, 7.752], ['Montpellier', 'FR', 43.611, 3.877], ['Bordeaux', 'FR', 44.838, -0.579],
  ['Lille', 'FR', 50.629, 3.057], ['Rennes', 'FR', 48.117, -1.678], ['Grenoble', 'FR', 45.188, 5.724], ['Rouen', 'FR', 49.443, 1.100],
  ['Toulon', 'FR', 43.124, 5.928], ['Dijon', 'FR', 47.322, 5.041], ['Brest', 'FR', 48.390, -4.486], ['Caen', 'FR', 49.183, -0.371],
  ['Limoges', 'FR', 45.833, 1.262], ['Metz', 'FR', 49.120, 6.176], ['Amiens', 'FR', 49.895, 2.302], ['Reims', 'FR', 49.258, 4.032],
  ['Orléans', 'FR', 47.903, 1.909], ['Le Havre', 'FR', 49.494, 0.108], ['London', 'GB', 51.507, -0.128], ['Manchester', 'GB', 53.481, -2.243],
  ['Berlin', 'DE', 52.520, 13.405], ['Munich', 'DE', 48.135, 11.582], ['Madrid', 'ES', 40.417, -3.704], ['Barcelona', 'ES', 41.385, 2.173],
  ['Rome', 'IT', 41.903, 12.496], ['Milan', 'IT', 45.464, 9.190], ['Brussels', 'BE', 50.850, 4.352], ['Amsterdam', 'NL', 52.368, 4.904],
  ['Tokyo', 'JP', 35.676, 139.650], ['Sydney', 'AU', -33.869, 151.209], ['Melbourne', 'AU', -37.814, 144.963], ['Toronto', 'CA', 43.653, -79.383],
  ['Montreal', 'CA', 45.502, -73.567], ['Vancouver', 'CA', 49.283, -123.121]
];

const COUNTRY_ALIAS = {
  US: ['United States', 'U.S.', 'USA', 'États-Unis', 'Etats-Unis'], GB: ['United Kingdom', 'U.K.', 'UK', 'Britain', 'England', 'Scotland', 'Wales', 'Royaume-Uni'],
  FR: ['France'], DE: ['Germany', 'Allemagne'], ES: ['Spain', 'Espagne'], IT: ['Italy', 'Italie'], BE: ['Belgium', 'Belgique'], CH: ['Switzerland', 'Suisse'],
  NL: ['Netherlands', 'Holland', 'Pays-Bas'], CZ: ['Czechia', 'Czech Republic'], KR: ['South Korea'], AE: ['UAE', 'United Arab Emirates'],
  TR: ['Turkey', 'Türkiye', 'Turquie'], CI: ['Ivory Coast', "Côte d'Ivoire"], MA: ['Morocco', 'Maroc'], DZ: ['Algeria', 'Algérie'],
  TN: ['Tunisia', 'Tunisie'], SN: ['Senegal', 'Sénégal'], CA: ['Canada', 'Québec', 'Quebec', 'Ontario', 'British Columbia', 'Alberta'], RU: ['Russia', 'Russie'], CN: ['China', 'Chine'], JP: ['Japan', 'Japon']
};
const DEMONYM = {
  French: 'FR', français: 'FR', française: 'FR', françaises: 'FR', British: 'GB', German: 'DE', Italian: 'IT', Spanish: 'ES', Dutch: 'NL',
  Belgian: 'BE', Swiss: 'CH', Austrian: 'AT', Swedish: 'SE', Norwegian: 'NO', Danish: 'DK', Finnish: 'FI', Polish: 'PL', Czech: 'CZ',
  Irish: 'IE', Portuguese: 'PT', Greek: 'GR', Romanian: 'RO', Ukrainian: 'UA', Russian: 'RU', Israeli: 'IL', Iranian: 'IR', Turkish: 'TR',
  Saudi: 'SA', Emirati: 'AE', Indian: 'IN', Pakistani: 'PK', Chinese: 'CN', Japanese: 'JP', 'South Korean': 'KR', 'North Korean': 'KP',
  Taiwanese: 'TW', Australian: 'AU', Canadian: 'CA', Mexican: 'MX', Brazilian: 'BR', Argentine: 'AR', Colombian: 'CO', Chilean: 'CL',
  'South African': 'ZA', Nigerian: 'NG', Kenyan: 'KE', Egyptian: 'EG', Singaporean: 'SG', Malaysian: 'MY', Indonesian: 'ID', Thai: 'TH',
  Vietnamese: 'VN', Filipino: 'PH', American: 'US'
};
// "Russian hackers", "China-linked", "pro-Iranian group": who attacked, not where.
const ACTOR_AFTER = /^(?:-?\s*(?:linked|backed|nexus|aligned|sponsored|based|affiliated|style)\b|\s+(?:state[- ]sponsored\s+|state[- ]backed\s+|government\s+)?(?:hackers?|hacking|hacktivists?|group|groups|gang|gangs|apt|threat actors?|actors?|spies|spy|intelligence|military|cyber ?criminals?|cybercriminals?|operatives|ransomware gang|pirates?|hackeurs?|cyber ?attacks?|attacks?)\b|\s+(?:hacks?|hacked|attacked|targets?|targeted|launch\w*|behind|blamed|denies|struck|strikes?)\b)/i;
// "blamed on Iran", "attributed to Russia", "backed by China".
const ACTOR_BEFORE = /\b(?:by|blames?|blamed on|accuse[sd]?|attributed to|tied to|ties to|linked to|backed by|suspects?|pro)[\s-]+$/i;

// Ordinary words that are also US town names. Without a strong pattern they never place a story.
const COMMON = new Set(('media industry energy security commerce ransom protection normal liberty independence union center centre data cloud ' +
  'patch alert power water city town village mobile hope enterprise progress justice victory freedom unity paradise reading ' +
  'phoenix aurora orange marion jackson lincoln madison franklin clinton washington springfield salem georgetown fairview ' +
  'riverside greenville bristol dover chester ' +
  'police county state national federal american general national university college hospital school health').split(/\s+/));

let IDX = null;
function index() {
  if (IDX) return IDX;
  const countyByName = new Map();          // "bucks county" -> [{name, st, lat, lon}]
  const statePts = {};
  for (const [name, st, lat, lon] of GAZ.counties) {
    const k = name.toLowerCase();
    if (!countyByName.has(k)) countyByName.set(k, []);
    countyByName.get(k).push({ name, st, lat, lon });
    (statePts[st] = statePts[st] || []).push([lat, lon]);
  }
  const stateCenter = {};
  for (const [st, pts] of Object.entries(statePts)) {
    const lat = pts.reduce((a, p) => a + p[0], 0) / pts.length, lon = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    stateCenter[st] = [Math.round(lat * 100) / 100, Math.round(lon * 100) / 100];
  }
  stateCenter.AK = [64.0, -150.0];            // the Aleutians cross 180°, so the mean is useless
  const placesByState = {};
  const placeCount = new Map();
  for (const [name, st, lat, lon] of GAZ.places) {
    if (name.length < 4) continue;
    (placesByState[st] = placesByState[st] || []).push({ name, st, lat, lon });
    placeCount.set(name, (placeCount.get(name) || 0) + 1);
  }
  const country = {};
  for (const [cc, name, lat, lon] of GAZ.countries) country[cc] = { cc, name, lat, lon };
  const countryNames = [];
  for (const [cc, , ,] of GAZ.countries) countryNames.push([country[cc].name, cc]);
  for (const [cc, names] of Object.entries(COUNTRY_ALIAS)) for (const n of names) countryNames.push([n, cc]);
  countryNames.sort((a, b) => b[0].length - a[0].length);
  IDX = { countyByName, stateCenter, placesByState, placeCount, country, countryNames, stateRe: {} };
  return IDX;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// US states named in the text. "Kansas City", "Delaware County" and a plain "Washington"
// (the government) do not count. Longest names first, and each match is blanked out, so
// "West Virginia" is not also "Virginia" and "New Mexico" is not also Mexico.
// Returns a Map of state -> position of its first mention, in reading order.
function statesIn(text) {
  let t = ' ' + text + ' ';
  const pos = new Map();
  const add = (st, off) => { if (!pos.has(st) || off < pos.get(st)) pos.set(st, off); };
  const blank = (m) => ' '.repeat(m.length);
  t = t.replace(/\bWashington,? D\.?C\.?\b|\bD\.C\.\b/g, (m, off) => { add('DC', off); return blank(m); });
  t = t.replace(/\bWashington (?:state|State)\b|\bWashington's\b(?= [A-Z])|,\s*Wash\.(?!\w)/g, (m, off) => { add('WA', off); return blank(m); });
  const byLen = STATES.filter(s => s[0] !== 'DC').sort((a, b) => b[1].length - a[1].length);
  for (const [st, name, ap] of byLen) {
    if (st === 'WA') continue;
    // Not "Maine-et-Loire", not "Kansas City", not "Delaware County".
    t = t.replace(new RegExp('(?<![-\\w])' + esc(name) + '(?![-\\w])(?!\\s+(?:City|County|Parish|Street|Avenue|Ave\\.|Road|Blvd))', 'g'), (m, off) => { add(st, off); return blank(m); });
    if (ap) t = t.replace(new RegExp(',\\s*' + esc(ap) + '(?!\\w)', 'g'), (m, off) => { add(st, off); return blank(m); });
  }
  // Postal code right after "Town, " (e.g. "Aliquippa, PA"), or before what it describes
  // ("hacked CA water utility"). Codes that are also words (IN, OR, ME, OK, HI) only the first way.
  t.replace(/[A-Za-z][a-z]+,\s+([A-Z]{2})(?![A-Za-z])/g, (m, st, off) => { if (STATE_NAME[st]) add(st, off); return m; });
  t.replace(/(?<![\w.])([A-Z]{2})\s+(?:water|county|city|town|hospital|hospitals|school|schools|state|utility|utilities|officials?|agency|agencies)\b/g,
    (m, st, off) => { if (STATE_NAME[st] && !/^(?:IN|OR|ME|OK|HI|US)$/.test(st)) add(st, off); return m; });
  return new Map([...pos.entries()].sort((a, b) => a[1] - b[1]));
}

function countyIn(text, states) {
  const I = index();
  const re = /((?:[A-Z][A-Za-z'’.-]*\s+){1,4})(County|Parish|Borough|Census Area)\b/g;
  let m, best = null;
  while ((m = re.exec(text))) {
    const words = m[1].trim().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const name = (words.slice(i).join(' ') + ' ' + m[2]).replace(/’/g, "'");
      const hits = I.countyByName.get(name.toLowerCase());
      if (!hits) continue;
      const inState = hits.filter(h => states.has(h.st));
      const pick = inState.length === 1 ? inState[0] : (!states.size && hits.length === 1 ? hits[0] : null);
      if (pick) { best = pick; break; }
    }
    if (best) break;
  }
  return best;
}

function placeIn(text, states) {
  const I = index();
  for (const st of states.keys()) {
    const list = I.placesByState[st];
    if (!list) continue;
    if (!I.stateRe[st]) {
      const names = [...new Set(list.map(p => p.name))].sort((a, b) => b.length - a.length);
      I.stateRe[st] = new RegExp('\\b(' + names.map(esc).join('|') + ')\\b', 'g');
    }
    const re = I.stateRe[st];
    re.lastIndex = 0;
    let m;
    const ap = (STATES.find(s => s[0] === st) || [])[2];
    while ((m = re.exec(text))) {
      const name = m[1];
      const after = text.slice(m.index + name.length, m.index + name.length + 24);
      const before = text.slice(Math.max(0, m.index - 12), m.index);
      // Strong: "Aliquippa, Pennsylvania" / "Aliquippa, Pa." / "City of Arkansas City".
      const strong = new RegExp('^,\\s*(?:' + esc(STATE_NAME[st]) + (ap ? '|' + esc(ap) : '') + '|' + st + ')(?![a-z])').test(after) ||
        /\b(?:City|Town|Village|Borough|Township) of\s*$/i.test(before);
      // Medium: "in Muleshoe" with Texas named elsewhere, and not an ordinary word. Not when a
      // capitalised word follows: "Perry Johnson" is a company, not Perry, N.Y.
      const medium = /\b(?:in|of|at|near|from)\s+$/i.test(before) && !COMMON.has(name.toLowerCase()) && name.length >= 5 &&
        !/^\s+[A-Z]/.test(after);
      if (strong || medium) {
        const hit = list.find(p => p.name === name);
        if (hit && name !== STATE_NAME[st]) return hit;
      }
    }
  }
  return null;
}

function worldCityIn(text) {
  for (const [name, cc, lat, lon] of WORLD_CITIES) {
    if (new RegExp('\\b' + esc(name) + '\\b').test(text)) return { name, cc, lat, lon };
  }
  return null;
}

function countriesIn(text) {
  const I = index();
  let t = ' ' + text + ' ';
  const found = [];
  const blank = (s) => ' '.repeat(s.length);
  for (const [name, cc] of I.countryNames) {
    if (name.length < 4 && !/^(?:UK|USA|UAE|U\.S\.|U\.K\.)$/.test(name)) continue;
    const re = new RegExp('(^|[^\\w-])' + esc(name) + '(?![\\w])', 'g');
    t = t.replace(re, (m, pre, off) => {
      const rest = t.slice(off + m.length, off + m.length + 40);
      const before = t.slice(Math.max(0, off - 30), off + pre.length);
      if (!ACTOR_AFTER.test(rest) && !ACTOR_BEFORE.test(before)) found.push([off, cc]);
      return pre + blank(m.slice(pre.length));
    });
  }
  for (const [word, cc] of Object.entries(DEMONYM).sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp('(^|[^\\w-])(pro-)?' + esc(word) + '(?![\\w])', 'gi');
    t = t.replace(re, (m, pre, pro, off) => {
      const rest = t.slice(off + m.length, off + m.length + 40);
      const before = t.slice(Math.max(0, off - 30), off + pre.length);
      const actor = !!pro || ACTOR_AFTER.test(rest) || ACTOR_BEFORE.test(before);
      const cased = /^[A-ZÉ]/.test(m.slice(pre.length)) || /^fran[çc]ais/i.test(word);
      if (!actor && cased) found.push([off, cc]);
      return pre + blank(m.slice(pre.length));
    });
  }
  // In reading order, so the first country named is the one used.
  return found.sort((a, b) => a[0] - b[0]).map(x => x[1]);
}

// The most exact place the text supports, or null.
function locate(title, summary) {
  const I = index();
  const text = (title + ' . ' + (summary || '')).slice(0, 900);
  const states = statesIn(text);
  const county = countyIn(text, states);
  if (county) return { level: 'county', name: county.name, state: county.st, cc: 'US', lat: county.lat, lon: county.lon };
  const town = placeIn(text, states);
  if (town) return { level: 'city', name: town.name, state: town.st, cc: 'US', lat: town.lat, lon: town.lon };
  if (states.size) {
    // The first state the headline names wins; then the first in the summary.
    const first = [...statesIn(title).keys()][0] || [...states.keys()][0];
    const c = I.stateCenter[first];
    if (c) return { level: 'state', name: STATE_NAME[first], state: first, cc: 'US', lat: c[0], lon: c[1] };
  }
  const city = worldCityIn(text);
  if (city) return { level: 'city', name: city.name, state: '', cc: city.cc, lat: city.lat, lon: city.lon };
  const cs = countriesIn(title);
  const cc = cs[0] || countriesIn(text)[0];
  if (cc && I.country[cc]) {
    const c = I.country[cc];
    return { level: 'country', name: c.name, state: '', cc, lat: c.lat, lon: c.lon };
  }
  return null;
}

// ── dedupe across outlets ────────────────────────────────────
const STOP = new Set('the a an of in on at to for and or as by from with after over into amid says say said is are was were be has have new its it this that'.split(' '));
function shingle(title) {
  return new Set(title.toLowerCase().replace(/[^a-z0-9à-ÿ\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
}
function similar(a, b) {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / Math.max(1, Math.min(a.size, b.size));
}

const MAX_AGE = { water: 400, default: 31 };   // days

function build(items, now) {
  const kept = [];
  for (const it of items) {
    const age = (now - it.published) / 86400e3;
    if (age < -1) continue;
    // The headline must be about an attack. A breach notice ("Hospital notifies patients")
    // counts when its first lines name the attack.
    const attackish = ATTACK.test(it.title) ||
      (ATTACK.test(it.summary.slice(0, 300)) && REPORTED.test(it.title));
    if (!attackish || NOT_INCIDENT.test(it.title)) continue;
    const sector = sectorOf(it.title, it.summary);
    if (age > (MAX_AGE[sector] || MAX_AGE.default)) continue;
    kept.push({ ...it, sector, place: locate(it.title, it.summary), words: shingle(it.title) });
  }
  kept.sort((a, b) => a.published - b.published);
  const groups = [];
  const key = (p) => p ? [p.level, p.name, p.state, p.cc].join('|') : '';
  // One event, many headlines: same place, same sector, within 4 days, a few words in common
  // ("French blood bank hit…" / "Hackers set French blood bank to boiling point").
  // Unplaced headlines merge only when they are nearly the same words.
  // Two places that cannot both be true (other country, other state, another town at the same
  // level) never merge, however alike the words: "Ransomware hits Seminole County, Florida" and
  // "..., Georgia" are two incidents. A state and a town inside it can.
  const clash = (a, b) => !!(a && b && (a.cc !== b.cc || (a.state && b.state && a.state !== b.state) || (a.level === b.level && a.name !== b.name)));
  const same = (x, it) => {
    if (Math.abs(x.published - it.published) >= 4 * 86400e3) return false;
    if (clash(x.place, it.place)) return false;
    const s = similar(x.words, it.words);
    if (x.place && it.place && key(x.place) === key(it.place) && (x.sector === it.sector || x.sector === 'other' || it.sector === 'other')) return s >= 0.25;
    return s >= 0.6;
  };
  for (const it of kept) {
    const g = groups.find(x => same(x, it));
    if (g) {
      g.reports = (g.reports || 1) + 1;
      g.latest = Math.max(g.latest || g.published, it.published);
      for (const w of it.words) g.words.add(w);
      if (!g.sources.some(s => s.name === it.source)) g.sources.push({ name: it.source, link: it.link });
      if (!g.place && it.place) g.place = it.place;
      else if (g.place && it.place && RANK[it.place.level] < RANK[g.place.level]) g.place = it.place;
      if (g.sector === 'other' && it.sector !== 'other') g.sector = it.sector;
      continue;
    }
    groups.push({ ...it, words: new Set(it.words), reports: 1, sources: [{ name: it.source, link: it.link }] });
  }
  return groups
    .sort((a, b) => b.published - a.published)
    .slice(0, 400)
    .map((g, i) => ({
      id: 'c' + i + '-' + g.published.toString(36),
      title: g.title, link: g.link, source: g.source, sources: g.sources.slice(0, 8), reports: g.reports,
      published: new Date(g.published).toISOString(), latest: new Date(g.latest || g.published).toISOString(),
      sector: g.sector, lang: g.lang, place: g.place
    }));
}
const RANK = { county: 0, city: 1, state: 2, country: 3 };

// CISA advisories: national, so listed, not mapped.
function advisories(xml, max = 8) {
  return parseFeed(xml, { id: 'cisa', name: 'CISA', google: true })
    .sort((a, b) => b.published - a.published).slice(0, max)
    .map(a => ({ title: a.title, link: a.link, published: new Date(a.published).toISOString() }));
}

module.exports = { decode, plain, parseFeed, isIncident, sectorOf, statesIn, countyIn, placeIn, countriesIn, locate, build, advisories, STATE_NAME };
