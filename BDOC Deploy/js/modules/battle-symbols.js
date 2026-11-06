// ============================================================
// BDOC p175 MODULE: battle-symbols.js — real MIL-STD-2525C / APP-6 unit symbols for the
// Battle Tracker. Travon picked "Military symbols first" from the Battle Tracker ideas.
//
// Until now the UNIT tool drew hand-made look-alikes (buildNatoSVG in index.html): no planned
// or damaged status, no HQ / task force / dummy, and the size marks were one step off (a
// brigade showed XX, which is a division). This module builds a standard 15-character SIDC for
// every unit and draws it with the milsymbol library that the military-bases layer already
// loads (js/modules/milsymbol-loader.js). The same SIDC turns into the CoT type that ATAK,
// WinTAK and iTAK use to pick their icon, so exported units arrive as the right symbol.
//
// Pure helpers (catalogue, SIDC build/parse, CoT type, text cleaning) need no browser and are
// tested in tests/battle-symbols-p175.test.js. render() needs window.ms (milsymbol).
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
(function (root) {
  'use strict';
  // lookup tables have no prototype: a plan file's iconKey / aff of '__proto__' or 'constructor'
  // must find nothing, not an inherited Object member
  const dict = o => Object.assign(Object.create(null), o);

  // ── standard identity (SIDC position 2) ────────────────────────────────────────────────
  // value = the word the Battle Tracker has always stored ('friendly' … 'unknown'), so old
  // plans, the CoT picker and the label text keep working.
  const AFFILIATIONS = [
    { v: 'friendly', code: 'F', name: 'FRIEND' },
    { v: 'hostile', code: 'H', name: 'HOSTILE' },
    { v: 'neutral', code: 'N', name: 'NEUTRAL' },
    { v: 'unknown', code: 'U', name: 'UNKNOWN' },
    { v: 'afriend', code: 'A', name: 'ASSUMED FRIEND' },
    { v: 'suspect', code: 'S', name: 'SUSPECT' },
    { v: 'pending', code: 'P', name: 'PENDING' },
  ];
  const AFF_BY_V = dict(Object.fromEntries(AFFILIATIONS.map(a => [a.v, a])));
  const AFF_BY_CODE = dict(Object.fromEntries(AFFILIATIONS.map(a => [a.code, a])));
  // identities 2525C also allows (exercise, joker, faker, none) but the SIDE picker does not offer;
  // a pasted or imported code using one is refused or left as it is, never quietly made UNKNOWN
  const OTHER_AFF = dict({ G: 'EXERCISE PENDING', W: 'EXERCISE UNKNOWN', M: 'EXERCISE ASSUMED FRIEND', D: 'EXERCISE FRIEND', L: 'EXERCISE NEUTRAL', J: 'JOKER', K: 'FAKER', O: 'NONE SPECIFIED' });

  // ── status / operational condition (position 4) ────────────────────────────────────────
  const CONDITIONS = [
    { v: 'present', code: 'P', name: 'PRESENT' },
    { v: 'planned', code: 'A', name: 'PLANNED / ANTICIPATED' },
    { v: 'capable', code: 'C', name: 'FULLY CAPABLE' },
    { v: 'damaged', code: 'D', name: 'DAMAGED' },
    { v: 'destroyed', code: 'X', name: 'DESTROYED' },
    { v: 'full', code: 'F', name: 'FULL TO CAPACITY' },
  ];
  const COND_BY_V = dict(Object.fromEntries(CONDITIONS.map(c => [c.v, c])));
  const COND_BY_CODE = dict(Object.fromEntries(CONDITIONS.map(c => [c.code, c])));

  // ── echelon (position 12). Keys are the words the old SIZE picker stored. ──────────────
  const ECHELONS = [
    { v: 'none', code: '-', name: 'NONE', mark: '' },
    { v: 'team', code: 'A', name: 'TEAM / CREW', mark: 'Ø' },
    { v: 'squad', code: 'B', name: 'SQUAD', mark: '●' },
    { v: 'section', code: 'C', name: 'SECTION', mark: '●●' },
    { v: 'platoon', code: 'D', name: 'PLATOON / DETACHMENT', mark: '●●●' },
    { v: 'company', code: 'E', name: 'COMPANY / BATTERY / TROOP', mark: '|' },
    { v: 'battalion', code: 'F', name: 'BATTALION / SQUADRON', mark: '||' },
    { v: 'regiment', code: 'G', name: 'REGIMENT / GROUP', mark: '|||' },
    { v: 'brigade', code: 'H', name: 'BRIGADE', mark: 'X' },
    { v: 'division', code: 'I', name: 'DIVISION', mark: 'XX' },
    { v: 'corps', code: 'J', name: 'CORPS / MEF', mark: 'XXX' },
    { v: 'army', code: 'K', name: 'ARMY', mark: 'XXXX' },
    { v: 'armygroup', code: 'L', name: 'ARMY GROUP / FRONT', mark: 'XXXXX' },
  ];
  const ECH_BY_V = dict(Object.fromEntries(ECHELONS.map(e => [e.v, e])));
  const ECH_BY_CODE = dict(Object.fromEntries(ECHELONS.map(e => [e.code, e])));

  const STRENGTH = [
    { v: '', name: '—' },
    { v: '+', name: 'REINFORCED (+)' },
    { v: '-', name: 'REDUCED (−)' },
    { v: '±', name: 'REINFORCED & REDUCED (±)' },
  ];

  // ── catalogue: BATTLE_ICONS key → battle dimension + 6-char function ID (2525C) ────────
  // Keys match index.html BATTLE_ICONS so saved plans and the hand-drawn fallback line up.
  // dim: G ground, F special operations, A air, S sea surface, U subsurface.
  // kind: 'unit' takes echelon + HQ / task force / dummy; 'equip' and 'inst' do not.
  const CATALOG = dict({
    // GROUND COMBAT
    infantry: { dim: 'G', fn: 'UCI---', label: 'Infantry', cat: 'ground' },
    mechanized: { dim: 'G', fn: 'UCIZ--', label: 'Mechanized Infantry', cat: 'ground' },
    motorized: { dim: 'G', fn: 'UCIM--', label: 'Motorized Infantry', cat: 'ground' },
    light_armor: { dim: 'G', fn: 'UCII--', label: 'Infantry Fighting Vehicle', cat: 'ground' },
    airborne: { dim: 'G', fn: 'UCIA--', label: 'Airborne Infantry', cat: 'ground' },
    marine: { dim: 'G', fn: 'UCIN--', label: 'Marine / Naval Infantry', cat: 'ground' },
    armor: { dim: 'G', fn: 'UCA---', label: 'Armor / Tank', cat: 'ground' },
    antitank: { dim: 'G', fn: 'UCAA--', label: 'Anti-Armor', cat: 'ground' },
    recon: { dim: 'G', fn: 'UCR---', label: 'Reconnaissance', cat: 'ground' },
    cavalry: { dim: 'G', fn: 'UCRV--', label: 'Cavalry', cat: 'ground' },
    artillery: { dim: 'G', fn: 'UCF---', label: 'Field Artillery', cat: 'ground' },
    rocket_arty: { dim: 'G', fn: 'UCFRM-', label: 'Multiple Rocket Launcher', cat: 'ground' },
    mortar: { dim: 'G', fn: 'UCFM--', label: 'Mortar', cat: 'ground' },
    air_defense: { dim: 'G', fn: 'UCD---', label: 'Air Defense', cat: 'ground' },
    manpads: { dim: 'G', fn: 'UCDS--', label: 'Short-Range Air Defense', cat: 'ground' },
    sniper: { dim: 'G', fn: 'UCI---', label: 'Sniper Team', cat: 'ground', text: { additionalInformation: 'SNIPER' }, ech: 'team' },
    militia: { dim: 'G', fn: 'UCI---', label: 'Militia / Irregular', cat: 'ground', text: { additionalInformation: 'IRREGULAR' } },
    police: { dim: 'G', fn: 'UUL---', label: 'Law Enforcement / Police', cat: 'ground' },
    sof: { dim: 'F', fn: '------', label: 'Special Operations', cat: 'ground' },
    ranger: { dim: 'F', fn: 'GR----', label: 'Ranger', cat: 'ground' },
    // GROUND SUPPORT
    hq: { dim: 'G', fn: 'U-----', label: 'Headquarters', cat: 'support', hq: true },
    engineer: { dim: 'G', fn: 'UCE---', label: 'Engineer', cat: 'support' },
    combat_eng: { dim: 'G', fn: 'UCEC--', label: 'Combat Engineer', cat: 'support' },
    signal: { dim: 'G', fn: 'UUS---', label: 'Signal', cat: 'support' },
    cbrn: { dim: 'G', fn: 'UUA---', label: 'CBRN Defense', cat: 'support' },
    mp: { dim: 'G', fn: 'UULM--', label: 'Military Police', cat: 'support' },
    medical: { dim: 'G', fn: 'USM---', label: 'Medical', cat: 'support' },
    supply: { dim: 'G', fn: 'USS---', label: 'Supply', cat: 'support' },
    fuel: { dim: 'G', fn: 'USS3--', label: 'Supply Class III (Fuel / POL)', cat: 'support' },
    ammo: { dim: 'G', fn: 'USS5--', label: 'Supply Class V (Ammunition)', cat: 'support' },
    maintenance: { dim: 'G', fn: 'USX---', label: 'Maintenance', cat: 'support' },
    transport: { dim: 'G', fn: 'UST---', label: 'Transportation', cat: 'support' },
    psyops: { dim: 'F', fn: 'GP----', label: 'Psychological Operations', cat: 'support' },
    civil_affairs: { dim: 'F', fn: 'GC----', label: 'Civil Affairs', cat: 'support' },
    // AIR
    air: { dim: 'A', fn: 'MF----', label: 'Fixed Wing', cat: 'air' },
    fighter: { dim: 'A', fn: 'MFF---', label: 'Fighter', cat: 'air' },
    bomber: { dim: 'A', fn: 'MFB---', label: 'Bomber', cat: 'air' },
    transport_air: { dim: 'A', fn: 'MFC---', label: 'Cargo / Airlift', cat: 'air' },
    tanker: { dim: 'A', fn: 'MFK---', label: 'Tanker', cat: 'air' },
    awacs: { dim: 'A', fn: 'MFRW--', label: 'Airborne Early Warning', cat: 'air' },
    isr: { dim: 'A', fn: 'MFR---', label: 'Reconnaissance Aircraft', cat: 'air' },
    rotary: { dim: 'A', fn: 'MH----', label: 'Rotary Wing', cat: 'air' },
    attack_helo: { dim: 'A', fn: 'MHA---', label: 'Attack Helicopter', cat: 'air' },
    uav: { dim: 'A', fn: 'MFQ---', label: 'UAV / Drone', cat: 'air' },
    ucav: { dim: 'A', fn: 'MFQA--', label: 'Armed Drone / UCAV', cat: 'air' },
    // NAVAL
    naval: { dim: 'S', fn: '------', label: 'Surface Vessel', cat: 'naval' },
    carrier: { dim: 'S', fn: 'CLCV--', label: 'Aircraft Carrier', cat: 'naval' },
    destroyer: { dim: 'S', fn: 'CLDD--', label: 'Destroyer', cat: 'naval' },
    frigate: { dim: 'S', fn: 'CLFF--', label: 'Frigate / Corvette', cat: 'naval' },
    amphibious: { dim: 'S', fn: 'CA----', label: 'Amphibious Warfare Ship', cat: 'naval' },
    patrol_boat: { dim: 'S', fn: 'CP----', label: 'Patrol Boat', cat: 'naval' },
    mine_vessel: { dim: 'S', fn: 'CM----', label: 'Mine Warfare Vessel', cat: 'naval' },
    submarine: { dim: 'U', fn: 'S-----', label: 'Submarine', cat: 'naval' },
    ssbn: { dim: 'U', fn: 'SN----', label: 'Nuclear Submarine', cat: 'naval' },
    // CYBER / INFORMATION
    ew: { dim: 'G', fn: 'UUMSE-', label: 'Electronic Warfare', cat: 'cyber' },
    sigint: { dim: 'G', fn: 'UUMS--', label: 'Signals Intelligence', cat: 'cyber' },
    cyber: { dim: 'G', fn: 'UUI---', label: 'Information Operations / Cyber', cat: 'cyber' },
    jammer: { dim: 'G', fn: 'UUMSE-', label: 'Jammer / EW Attack', cat: 'cyber', text: { additionalInformation: 'JAM' } },
    radar: { dim: 'G', fn: 'ESR---', label: 'Radar', cat: 'cyber', kind: 'equip' },
  });
  for (const k of Object.keys(CATALOG)) {
    const c = CATALOG[k];
    if (!c.kind) c.kind = (c.dim === 'G' || c.dim === 'F') ? 'unit' : 'track';
  }

  // ── text amplifiers ───────────────────────────────────────────────────────────────────
  // milsymbol writes text straight into the SVG, and imported plan files come from other
  // people, so keep to the characters unit names use and the 2525C field lengths.
  const TEXT_FIELDS = { uniqueDesignation: 21, higherFormation: 21, staffComments: 20, additionalInformation: 20 };
  function cleanText(s, max) {
    return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9 .,:;/()#+\-*_]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 21);
  }

  // ── SIDC ──────────────────────────────────────────────────────────────────────────────
  // position 3 is a battle dimension for warfighting (S) and signals intelligence (I), but a category
  // for stability operations (O: violent activity, locations, operations, items, individual, group,
  // rape) and emergency management (E: incident, natural event, operations, infrastructure)
  const SIDC_RE = /^(?:[SI][PUAFNSHGWMDLJKO][PAGSUFXZ]|O[PUAFNSHGWMDLJKO][VLOIPGR]|E[PUAFNSHGWMDLJKO][INOF])[APCDXF][A-Z0-9-]{6}[A-Z0-9*-]{2}[A-Z0-9*-]{2}[A-Z0-9*-]$/;
  function isSIDC(s) { return typeof s === 'string' && SIDC_RE.test(s); }
  // what the code is drawn as, for the rules below: a 'unit' takes size, HQ / task force / dummy and
  // strength; 'equip' and 'inst' take none of them; a 'track' (air, sea, SIGINT, stability operations,
  // emergency management) keeps whatever positions 11-12 say
  function sidcKind(s) {
    if (!isSIDC(s)) return null;
    if (s[0] !== 'S') return 'track';
    const dim = s[2], f = s[4];
    return (dim === 'G' && f === 'E') ? 'equip' : (dim === 'G' && f === 'I') ? 'inst' : (dim === 'G' || dim === 'F') ? 'unit' : 'track';
  }
  // a code the controls can hold: valid, and its side is one of the seven the SIDE picker offers
  function isUsableSIDC(s) { return isSIDC(s) && !!AFF_BY_CODE[s[1]]; }
  // why a pasted code cannot be used, in words for the panel (null when it can)
  function sidcProblem(s) {
    if (!isSIDC(s)) return 'must be 15 characters of MIL-STD-2525C (e.g. SFGPUCI--------)';
    if (!AFF_BY_CODE[s[1]]) return 'side code ' + s[1] + (OTHER_AFF[s[1]] ? ' (' + OTHER_AFF[s[1]] + ')' : '') + ' is not supported here; use F, H, N, U, A, S or P';
    return null;
  }

  // position 11 (symbol modifier indicator) from the HQ / task force / feint-dummy flags
  function modIndicator(hq, tf, feint) {
    if (hq) return feint ? (tf ? 'D' : 'C') : (tf ? 'B' : 'A');
    if (tf) return feint ? 'G' : 'E';
    return feint ? 'F' : '-';
  }
  function modFlags(c) {
    return {
      hq: 'ABCD'.includes(c), tf: 'BDEG'.includes(c), feint: 'CDFG'.includes(c),
    };
  }

  // spec: {key | base (a pasted custom SIDC), aff, cond, ech, hq, tf, feint}. With a custom base
  // the scheme, dimension, function ID and country / order-of-battle (positions 13-15) are kept;
  // side and status always come from the controls, and so do size and HQ / task force / dummy on a
  // unit. Modifiers no control can show are kept from the pasted code: mobility and towed array
  // (M / N at position 11), a dummy installation (HB), region / command size (M / N at position 12),
  // and positions 11-12 of a track as they are.
  function buildSIDC(spec) {
    spec = spec || {};
    let scheme = 'S', dim, fn, kind, tail = '---', b11 = '-', b12 = '-';
    const c = CATALOG[spec.key];
    const custom = !c && isSIDC(spec.base);
    if (c) { dim = c.dim; fn = c.fn; kind = c.kind; }
    else if (custom) {
      scheme = spec.base[0]; dim = spec.base[2]; fn = spec.base.slice(4, 10); tail = spec.base.slice(12, 15);
      kind = sidcKind(spec.base); b11 = spec.base[10]; b12 = spec.base[11];
    } else { dim = 'G'; fn = 'U-----'; kind = 'unit'; }
    const aff = (AFF_BY_V[spec.aff] || AFF_BY_CODE[spec.aff] || AFF_BY_V.unknown).code;
    let st = (COND_BY_V[spec.cond] || COND_BY_CODE[spec.cond] || COND_BY_V.present).code;
    let p11 = '-', p12 = '-';
    if (custom && kind === 'track') { p11 = b11; p12 = b12; }
    else if (custom && (b11 === 'M' || b11 === 'N')) { p11 = b11; p12 = b12; }
    else if (kind === 'unit') {
      p11 = modIndicator(!!(spec.hq || (c && c.hq && spec.hq !== false)), !!spec.tf, !!spec.feint);
      p12 = (ECH_BY_V[spec.ech] || ECH_BY_CODE[spec.ech] || ECH_BY_V.none).code;
      if (custom && p12 === '-' && (b12 === 'M' || b12 === 'N')) p12 = b12;
    } else if (kind === 'inst') {
      p11 = 'H';
      if (custom && b12 === 'B') p12 = 'B';
    }
    return scheme + aff + dim + st + (fn + '------').slice(0, 6) + p11 + p12 + tail;
  }

  function parseSIDC(s) {
    if (!isSIDC(s)) return null;
    const p11 = s[10], p12 = s[11];
    // positions 11-12 mean HQ / task force / dummy + size only on a warfighting code; M / N at 11 is
    // mobility and H an installation, so 12 is not a size there either
    const std = s[0] === 'S';
    const f = std ? modFlags(p11) : { hq: false, tf: false, feint: false };
    return {
      scheme: s[0], affCode: s[1], aff: (AFF_BY_CODE[s[1]] || AFF_BY_V.unknown).v, dim: s[2],
      cond: (COND_BY_CODE[s[3]] || COND_BY_V.present).v, fn: s.slice(4, 10),
      hq: f.hq, tf: f.tf, feint: f.feint, installation: std && p11 === 'H',
      ech: (std && p11 !== 'M' && p11 !== 'N' && p11 !== 'H' && ECH_BY_CODE[p12]) ? ECH_BY_CODE[p12].v : 'none',
    };
  }

  // CoT type used by ATAK / WinTAK / iTAK to choose a 2525 icon: a-<identity>-<dimension>-<function…>
  const COT_AFF = dict({ F: 'f', H: 'h', N: 'n', U: 'u', A: 'a', S: 's', P: 'p', J: 'j', K: 'k', G: 'p', W: 'u', M: 'a', D: 'f', L: 'n' });
  function cotType(sidc) {
    if (!isSIDC(sidc) || sidc[0] !== 'S') return null;
    const a = COT_AFF[sidc[1]] || 'u';
    const dim = sidc[2] === 'Z' || sidc[2] === 'X' ? 'X' : sidc[2];
    const fn = sidc.slice(4, 10).split('-')[0];
    return ['a', a, dim].concat(fn.split('')).join('-');
  }
  // …and back, for CoT that arrives from TAK: a-f-G-U-C-I → SFGPUCI--------
  const CODE_BY_COT = dict({ f: 'F', h: 'H', n: 'N', u: 'U', a: 'A', s: 'S', p: 'P', j: 'J', k: 'K' });
  function sidcFromCot(type) {
    const p = String(type || '').split('-');
    if (p[0] !== 'a' || !CODE_BY_COT[p[1]] || !/^[PAGSUFX]$/.test(p[2] || '')) return null;
    const fnParts = p.slice(3);
    if (fnParts.some(x => !/^[A-Z0-9]$/.test(x))) return null;
    const fn = (fnParts.join('') + '------').slice(0, 6);
    const s = 'S' + CODE_BY_COT[p[1]] + p[2] + 'P' + fn + '-----';
    return isSIDC(s) ? s : null;
  }

  // ── names for popups / labels ─────────────────────────────────────────────────────────
  function describe(sidc, key) {
    const p = parseSIDC(sidc); if (!p) return null;
    const c = CATALOG[key];
    return {
      type: c ? c.label : 'Custom symbol',
      aff: (AFF_BY_CODE[p.affCode] || AFF_BY_V.unknown).name,
      cond: (COND_BY_V[p.cond] || COND_BY_V.present).name,
      ech: p.ech !== 'none' ? ECH_BY_V[p.ech].name : '',
      mods: [p.hq ? 'HEADQUARTERS' : '', p.tf ? 'TASK FORCE' : '', p.feint ? 'FEINT / DUMMY' : ''].filter(Boolean).join(', '),
    };
  }

  // ── rendering (needs milsymbol) ───────────────────────────────────────────────────────
  // milsymbol's anchor (the centre of the frame) is not the centre of its SVG once size marks,
  // HQ staffs or text sit around the frame. Pad the SVG so the anchor is the exact centre, so a
  // Cesium billboard with CENTER origin puts the frame on the clicked point at every scale.
  function hasMs() { return typeof root.ms !== 'undefined' && root.ms && typeof root.ms.Symbol === 'function'; }
  const _cache = new Map();
  function render(sidc, opt) {
    opt = opt || {};
    if (!hasMs() || !isSIDC(sidc)) return null;
    const text = {};
    for (const k of Object.keys(TEXT_FIELDS)) { const v = cleanText(opt[k], TEXT_FIELDS[k]); if (v) text[k] = v; }
    // field F, units only, written the 2525C way: (+) reinforced, (-) reduced, (±) both
    const RR = { '+': '(+)', '-': '(-)', '±': '(±)' };
    if (typeof opt.reinforcedReduced === 'string' && Object.prototype.hasOwnProperty.call(RR, opt.reinforcedReduced) && sidcKind(sidc) === 'unit') text.reinforcedReduced = RR[opt.reinforcedReduced];
    const size = Math.max(12, Math.min(120, +opt.size || 30));
    const color = typeof opt.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(opt.color) ? opt.color : null;
    const key = sidc + '|' + size + '|' + (color || '') + '|' + JSON.stringify(text) + '|' + (opt.outline === false ? 0 : 1);
    if (_cache.has(key)) return _cache.get(key);
    try {
      const o = Object.assign({ size, outlineWidth: opt.outline === false ? 0 : 3, outlineColor: 'rgba(5,8,12,0.85)', infoColor: '#E6E9EE', infoBackground: 'rgba(5,8,12,0.78)' }, text);
      if (color) o.colorMode = { Friend: color, Hostile: color, Neutral: color, Unknown: color, Civilian: color };
      const sym = new root.ms.Symbol(sidc, o);
      const svg = sym.asSVG(), a = sym.getAnchor(), z = sym.getSize();
      const W = Math.ceil(2 * Math.max(a.x, z.width - a.x)), H = Math.ceil(2 * Math.max(a.y, z.height - a.y));
      const dx = +(W / 2 - a.x).toFixed(2), dy = +(H / 2 - a.y).toFixed(2);
      const inner = svg.replace(/^<svg\b/, `<svg x="${dx}" y="${dy}"`);
      const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
      let uri;
      try { uri = 'data:image/svg+xml;base64,' + root.btoa(unescape(encodeURIComponent(wrapped))); }
      catch (_) { uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(wrapped); }
      // below = how far the drawing reaches under the anchor (0 for an HQ, whose anchor is the foot
      // of its staff), so a label can sit just under the symbol instead of under the padding
      const out = { uri, width: W, height: H, below: Math.max(0, +(z.height - a.y).toFixed(2)), valid: typeof sym.isValid === 'function' ? !!sym.isValid() : true };
      if (_cache.size > 400) _cache.clear();
      _cache.set(key, out);
      return out;
    } catch (e) { try { console.warn('[battle-symbols] render failed', sidc, e && e.message); } catch (_) {} return null; }
  }

  // milsymbol-loader.js only STARTS the CDN fetch; LazyLoader resolves when that loader file has
  // run, before window.ms exists. ensure() waits for the library itself (p175 loader:
  // BDOC.loadMilsymbol(), which also retries after an earlier failure). Resolves true / false.
  let _ensuring = null;
  function ensure(timeoutMs) {
    if (hasMs()) return Promise.resolve(true);
    if (_ensuring) return _ensuring;
    const L = root.BDOC && root.BDOC.LazyLoader;
    _ensuring = new Promise(resolve => {
      const t0 = Date.now(), limit = timeoutMs || 15000;
      let settled = false, guard = null, armed = false;
      const finish = ok => { if (settled) return; settled = true; clearTimeout(guard); clearTimeout(backstop); _ensuring = null; resolve(!!ok); };
      // the loader's own 15 s timeout starts only once milsymbol-loader.js has run, so the guard does
      // too (a slow first fetch of the loader file must not fail a load that is still in time);
      // the backstop only covers a loader file that never arrives
      const backstop = setTimeout(() => finish(hasMs()), limit + 20000);
      const wait = () => {
        if (!armed) { armed = true; guard = setTimeout(() => finish(hasMs()), limit + 1000); }
        if (hasMs()) return finish(true);
        const B = root.BDOC;
        if (B && typeof B.loadMilsymbol === 'function') { B.loadMilsymbol().then(() => finish(hasMs()), () => finish(false)); return; }
        if (root._milsymbolLoading && typeof root._milsymbolLoading.then === 'function') {
          root._milsymbolLoading.then(() => finish(hasMs()), () => finish(false));
          return;
        }
        if (Date.now() - t0 > limit) return finish(false);
        setTimeout(wait, 150);
      };
      if (L && typeof L.load === 'function') L.load('milsymbol-loader').then(wait, () => finish(false));
      else wait();
    });
    return _ensuring;
  }

  root.BDOCSym = {
    AFFILIATIONS, CONDITIONS, ECHELONS, STRENGTH, CATALOG, TEXT_FIELDS,
    AFF_BY_V, AFF_BY_CODE, COND_BY_V, ECH_BY_V, ECH_BY_CODE,
    OTHER_AFF, cleanText, isSIDC, isUsableSIDC, sidcProblem, sidcKind, buildSIDC, parseSIDC, modIndicator, cotType, sidcFromCot, describe,
    hasMs, render, ensure,
  };
})(typeof window !== 'undefined' ? window : globalThis);
