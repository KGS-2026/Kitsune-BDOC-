// ============================================================
// world-places.js — world cities and countries for placing news (p183).
//
// The War Room's own table (proxy-newsgeo.js GAZ) covers conflict theatres. Outlets from
// every region (France 24, WION, Arirang, Africanews, MercoPress…) report places outside it,
// so after that table: a capital or 1M+ city named in the text (Natural Earth 1:50m, public
// domain, built into world-cities.json), then a country (Google DSPL centres, CC BY 4.0).
// One compiled regex each, built once per cold start: the function places ~1,000 stories a call.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
'use strict';
const CITIES = require('./world-cities.json').cities;              // [name, cc, lat, lon]
const COUNTRIES = require('./cyber-gazetteer.json').countries;     // [cc, name, lat, lon]

// Georgia is also a US state, Jersey hides in "New Jersey", Guernsey rarely means the island.
const SKIP_COUNTRY = new Set(['GE', 'JE', 'GG']);
const ALIAS = {
  GB: ['United Kingdom', 'Britain', 'U.K.', 'UK'],
  CD: ['Democratic Republic of Congo', 'Democratic Republic of the Congo', 'DR Congo', 'DRC', 'Congo'],
  CG: ['Republic of Congo', 'Congo-Brazzaville'],
  CI: ['Ivory Coast', "Côte d'Ivoire", "Cote d'Ivoire"], CZ: ['Czechia'], MK: ['North Macedonia'], MM: ['Myanmar', 'Burma'],
  PS: ['Palestine', 'Palestinian territories'], SZ: ['Eswatini'], TL: ['East Timor'], CV: ['Cape Verde', 'Cabo Verde'],
  VA: ['Vatican'], FK: ['Falkland Islands', 'Falklands'], TR: ['Türkiye'], AE: ['UAE'],
  // Korean outlets (Arirang, Yonhap) write "S. Korea" and plain "Korea"; "North Korea" is longer, so it wins first.
  KR: ['South Korea', 'S. Korea', 'S.Korea', 'Korea', 'Republic of Korea'], KP: ['North Korea', 'N. Korea', 'N.Korea', 'DPRK']
};
// Also people's names or parts of other names ("Chad Daybell", "Jordan Peterson", "Niger Delta"):
// these count only when a capitalised word does not follow.
const NAMEISH = new Set(['Chad', 'Jordan', 'Niger']);
const DISPLAY = { CD: 'DR Congo', CG: 'Republic of Congo' };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const decode = (s) => String(s).replace(/&#39;/g, "'").replace(/&amp;/g, '&');

let IDX = null;
function idx() {
  if (IDX) return IDX;
  const city = new Map(CITIES.map(c => [c[0], c]));
  const centre = new Map(COUNTRIES.map(c => [c[0], c]));
  const country = new Map();                                       // name -> cc
  for (const [cc, raw] of COUNTRIES) {
    if (SKIP_COUNTRY.has(cc)) continue;
    const name = decode(raw).replace(/\s*\[[^\]]*\]/g, '').trim();
    if (name && !/^Congo$/.test(name)) country.set(name, cc);
  }
  for (const [cc, names] of Object.entries(ALIAS)) for (const n of names) country.set(n, cc);
  const re = (names) => new RegExp('(?<![\\p{L}\\p{N}-])(' + [...names].sort((a, b) => b.length - a.length).map(esc).join('|') + ')(?![\\p{L}\\p{N}-])', 'gu');
  IDX = { city, centre, country, cityRe: re(city.keys()), countryRe: re(country.keys()) };
  return IDX;
}

// Headlines in Title Case capitalise every word, so "a capitalised word follows" means nothing there.
function titleCase(text) {
  const w = String(text).split(/\s+/).filter(x => /^[\p{L}]{4,}/u.test(x));
  return w.length >= 4 && w.filter(x => /^\p{Lu}/u.test(x)).length / w.length > 0.7;
}

function firstMatch(re, text, ok) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) if (ok(m)) return m;
  return null;
}

// A capital or 1M+ city, in reading order. Not "Paris Hilton", "Chicago Bulls", "Manchester United":
// in sentence-case text a city directly followed by a capitalised word is skipped.
function cityIn(text) {
  if (!text) return null;
  const I = idx();
  const tc = titleCase(text);
  const m = firstMatch(I.cityRe, text, (m) => tc || !/^\s+\p{Lu}/u.test(text.slice(m.index + m[1].length)));
  if (!m) return null;
  const [name, cc, lat, lon] = I.city.get(m[1]);
  return { name, cc, lat, lon };
}

function countryIn(text) {
  if (!text) return null;
  const I = idx();
  const tc = titleCase(text);
  const m = firstMatch(I.countryRe, text, (m) => !NAMEISH.has(m[1]) || (!tc && !/^\s+\p{Lu}/u.test(text.slice(m.index + m[1].length))));
  if (!m) return null;
  const cc = I.country.get(m[1]);
  const c = I.centre.get(cc);
  return c ? { name: DISPLAY[cc] || decode(c[1]).replace(/\s*\[[^\]]*\]/g, '').trim(), cc, lat: c[2], lon: c[3] } : null;
}

module.exports = { cityIn, countryIn, titleCase };
