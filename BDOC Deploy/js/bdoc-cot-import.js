// ============================================================
// BDOC p177: bdoc-cot-import.js — CoT import (TAK → BDOC) for the Battle Tracker.
//
// p175 made Battle Tracker units real MIL-STD-2525C symbols and exports them to ATAK / WinTAK /
// iTAK as their exact CoT type. This is the way back: a .cot / .xml file holding one <event> or an
// <events> list is read here, and index.html (_cotImportText) places each event on the map.
//
//   a-…  (an atom: unit, vehicle, aircraft, ship …) → a unit, drawn as its 2525C symbol. The full
//        SIDC BDOC writes into <remarks> ("SIDC SFGPUCI---E---") wins while it still names the
//        same CoT type, so BDOC → TAK → BDOC keeps HQ / size / status; a type changed in TAK wins.
//   b-m-p-… (spot, waypoint, checkpoint), b-r-f-h-c (CASEVAC), b-a-o-… (911 / TIC alerts),
//        and an a- type BDOC cannot draw → a plain marker that keeps its TAK type.
//   u-d-… drawings, b-m-r routes, chat, tasking, pings … → skipped and counted.
//
// The file comes from someone else, so: DOMParser only (no eval), no DTD at all (no entity
// expansion), size and event caps, numbers must be plain decimals in range, and every string is
// cleaned before it can reach a label, a toast (innerHTML), a popup or milsymbol.
// Pure functions: tests/cot-import-p177.test.js runs them in node with a small XML DOM.
//
// p186 (found by review, each with a test in tests/tak-roundtrip-p186.test.js):
// - cleanNote took quadratic time on a long run of spaces inside <remarks> (200 KB froze the tab for
//   50 s). It trims line ends in linear time now.
// - BDOC's "SIDC …" line is the LAST such line in <remarks> (a note may hold one of its own), and it
//   is read before the note is cut, so a long note no longer loses it.
// - A code TAK has no type for (emergency management, stability operations …) goes out as its side's
//   plain ground type. It is still trusted on the way back in while the type is that plain type,
//   so opening BDOC's own export no longer turns such a unit into infantry.
// - The callsign is kept as the unit's display name (any script, original case). It used to be
//   squeezed into the 2525C text field only: "Сокіл-1" became "-1", and went back to TAK that way.
// - An alert followed by its cancel (b-a-o-can, same uid) is not placed.
// - BDOC's own "HOSTILE Infantry" style callsign is never a name, whatever side or type TAK changed.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
(function (root) {
  'use strict';
  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_EVENTS = 2000;
  // a-f-G-U-C-I, b-m-p-s-p-loc, u-d-c-c … one letter, then dash-separated parts
  const TYPE_RE = /^[a-z](?:-[A-Za-z0-9]{1,12}){1,15}$/;
  // a plain decimal: no hex, no "Infinity", no "NaN", no empty string
  const NUM_RE = /^\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d{1,3})?\s*$/;
  // control and invisible line-breaking characters; \t and \n are handled separately
  const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF\uFFFE\uFFFF]/g;
  // the line BDOC's own export adds to <remarks> (js/bdoc-plan.js cotEvents)
  const BDOC_LINE_RE = /^SIDC ([A-Z0-9*-]{15})(?: · Higher: (.*))?$/;

  // The CoT type BDOC's export gives a unit whose code TAK has no type for: its side's plain ground
  // type (js/bdoc-atak.js COT_TYPES, chosen by side in index.html pickCoT). A test pins the two together.
  const GENERIC_TYPE = Object.freeze({ f: 'a-f-G-U-C', h: 'a-h-G-U-C', n: 'a-n-G', u: 'a-u-G' });
  // CoT identity letter → the four sides those plain types exist for
  const SIDE_OF = Object.freeze({ f: 'f', a: 'f', h: 'h', s: 'h', j: 'h', k: 'h', n: 'n', u: 'u', p: 'u' });
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // why an event was not placed, in words for the toast
  const REASONS = Object.freeze({
    drawing: 'drawings / shapes',
    route: 'routes',
    other: 'chat, tasking and other non-map messages',
    position: 'no valid position',
    type: 'no readable CoT type',
    duplicate: 'repeats of the same uid, newest kept',
    cancelled: 'alerts cancelled later in the file',
    limit: 'over the ' + MAX_EVENTS + '-event limit',
  });

  const nameOf = el => String((el && (el.localName || el.nodeName)) || '');
  function kids(el, n) {
    const out = [], c = el && el.childNodes;
    if (!c) return out;
    for (let i = 0; i < c.length; i++) { const k = c[i]; if (k && k.nodeType === 1 && (!n || nameOf(k) === n)) out.push(k); }
    return out;
  }
  const kid = (el, n) => kids(el, n)[0] || null;
  const attr = (el, a) => { const v = el && typeof el.getAttribute === 'function' ? el.getAttribute(a) : null; return v == null ? '' : String(v); };
  const num = s => (NUM_RE.test(s) ? Number(s) : NaN);

  // a note: printable text, lines kept, at most `max` characters.
  // p186: line ends are trimmed with trimEnd(), which is linear. The regex it replaced (\s+ then $)
  // backtracks over every run of spaces that is not at a line end: quadratic time on a hostile file.
  function cleanNote(s, max) {
    return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(CTRL_RE, '').replace(/\t/g, ' ')
      .split('\n').map(l => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max || 1000);
  }
  // a marker label is drawn as plain text, but it also reaches toasts and the undo message (innerHTML),
  // so markup characters go; letters of any script stay
  function cleanLabel(s, max) {
    return String(s == null ? '' : s).replace(CTRL_RE, '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 40);
  }
  // the uid only matches units and goes back out through xmlEsc; anything over 128 characters is not a TAK uid
  function cleanUid(s) {
    const u = String(s == null ? '' : s).replace(CTRL_RE, '').replace(/\s/g, ' ').trim();
    return u && u.length <= 128 ? u : '';
  }

  function classify(type) {
    if (!TYPE_RE.test(type)) return 'type';
    if (type.startsWith('a-')) return 'unit';
    if (type.startsWith('u-d-')) return 'drawing';
    if (type === 'b-m-r' || type.startsWith('b-m-r-')) return 'route';
    // an alert being cancelled: it takes the alert with the same uid off the list (parse)
    if (type === 'b-a-o-can') return 'cancel';
    if (type.startsWith('b-m-p-') || type === 'b-r-f-h-c' || type.startsWith('b-r-f-h-c-') || type.startsWith('b-a-o-')) return 'marker';
    // what BDOC itself sent for a CASEVAC 9-line before p186 (not a TAK type): still a CASEVAC here
    if (type === 'b-c-c' || type === 'b-c-c-m') return 'marker';
    return 'other';
  }

  // how a plain marker is drawn: a fixed glyph and colour per kind (nothing from the file)
  const ID_COL = { f: '#2D72D2', a: '#2D72D2', h: '#DA3633', s: '#DA3633', j: '#DA3633', k: '#DA3633', n: '#3FB950', u: '#E8B349', p: '#E8B349' };
  function markerStyle(type) {
    const t = String(type || '');
    if (t.startsWith('b-r-f-h-c') || t === 'b-c-c' || t === 'b-c-c-m') return { kind: 'CASEVAC / MEDEVAC REQUEST', glyph: '+', color: '#FF4444' };
    if (t.startsWith('b-a-o-')) return { kind: 'EMERGENCY ALERT', glyph: '!', color: '#FF4444' };
    if (t.startsWith('b-m-p-w')) return { kind: 'WAYPOINT', glyph: 'W', color: '#E8B349' };
    if (t.startsWith('b-m-p-c')) return { kind: 'CHECKPOINT', glyph: 'C', color: '#E8B349' };
    if (t.startsWith('b-m-p-s')) return { kind: 'SPOT / POINT', glyph: '•', color: '#E8B349' };
    if (t.startsWith('b-m-p')) return { kind: 'MAP POINT', glyph: '•', color: '#E8B349' };
    const id = t.split('-')[1];
    return { kind: 'TAK MARKER (no 2525C symbol)', glyph: '?', color: Object.prototype.hasOwnProperty.call(ID_COL, id) ? ID_COL[id] : '#E8B349' };
  }

  // which of the four sides a 2525C code is on, through the symbol module's own affiliation table
  function sideOfCode(code, Sym) {
    const t = Sym.cotType('S' + code[1] + 'GP-----------');
    const id = t ? t.split('-')[1] : '';
    return own(SIDE_OF, id) ? SIDE_OF[id] : '';
  }
  // The 2525C text field takes A-Z, 0-9 and a few marks, 21 characters. A callsign that fits goes in.
  // One that would lose letters or digits ("Müller", "Сокіл-1", a 30-character name) stays out of the
  // symbol: it is shown, and sent back to TAK, as the unit's name instead (p186).
  const lettersOf = s => String(s).toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
  function designationOf(callsign, Sym) {
    const d = Sym.cleanText(callsign, 21);
    return d && lettersOf(d) === lettersOf(callsign) ? d : '';
  }

  // one <event> → a record { kind: 'unit' | 'marker' | 'cancel' | 'skip', … }
  function readEvent(el, Sym) {
    const rawType = attr(el, 'type').trim();
    const cls = classify(rawType);
    const r = { kind: 'skip', reason: null, uid: cleanUid(attr(el, 'uid')), type: cls === 'type' ? '' : rawType, time: Date.parse(attr(el, 'time')) };
    if (cls === 'cancel') { r.kind = 'cancel'; return r; }       // names an alert by uid; it has no place of its own
    if (cls === 'type' || cls === 'drawing' || cls === 'route' || cls === 'other') { r.reason = cls; return r; }
    const pt = kid(el, 'point');
    const lat = num(attr(pt, 'lat')), lon = num(attr(pt, 'lon'));
    // 0, 0 is what TAK sends for "no fix", not a place
    if (!pt || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) { r.reason = 'position'; return r; }
    r.lat = lat; r.lon = lon;
    const det = kid(el, 'detail');
    const callsign = attr(kid(det, 'contact'), 'callsign');
    const rm = kid(det, 'remarks');
    // BDOC's export adds "SIDC … · Higher: …" after the note. p186: take the LAST such line out (a note
    // may hold one of its own higher up) and keep its values, on the whole text before the note is cut
    // (a note near the old 4000-character cut used to push BDOC's line off the end).
    let rSidc = '', higher = '';
    const lines = cleanNote(rm ? rm.textContent : '', MAX_BYTES).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = BDOC_LINE_RE.exec(lines[i].trim());
      if (m) { rSidc = m[1]; higher = m[2] || ''; lines.splice(i, 1); break; }
    }
    r.comment = cleanNote(lines.join('\n'), 1000);
    r.callsign = cleanLabel(callsign, 40);
    if (cls === 'unit') {
      let sidc = '', from = '';
      // The full code from remarks, while it still names this type: a side or type changed in TAK wins.
      // p186: a code TAK has no type for went out as its side's plain ground type; while the type is
      // still that, the code is BDOC's own (it used to come back as plain infantry).
      const usable = !!rSidc && Sym.isUsableSIDC(rSidc);
      const ct = usable ? Sym.cotType(rSidc) : null;
      if (usable && (ct ? ct === rawType : GENERIC_TYPE[sideOfCode(rSidc, Sym)] === rawType)) { sidc = rSidc; from = 'remarks'; }
      else { const s = Sym.sidcFromCot(rawType); if (s && Sym.isUsableSIDC(s)) { sidc = s; from = 'type'; } }
      if (sidc) {
        return Object.assign(r, { kind: 'unit', sidc, sidcFrom: from, designation: designationOf(r.callsign, Sym), higher: from === 'remarks' ? Sym.cleanText(higher, 21) : '' });
      }
      // an a- type BDOC cannot draw (joker / faker side, a function it cannot read) stays a marker
    }
    const style = markerStyle(rawType);
    return Object.assign(r, { kind: 'marker', style, label: r.callsign || style.kind });
  }

  // text → { records, counts, skipped, total, error }
  function parse(text, opt) {
    opt = opt || {};
    const Sym = opt.Sym || root.BDOCSym, DP = opt.DOMParser || root.DOMParser;
    const res = { records: [], counts: { unit: 0, marker: 0, skip: 0 }, skipped: {}, total: 0, error: null };
    const fail = m => { res.error = m; return res; };
    const skip = why => { res.skipped[why] = (res.skipped[why] || 0) + 1; res.counts.skip++; };
    if (!Sym || typeof Sym.sidcFromCot !== 'function') return fail('the military symbol module is not loaded');
    if (typeof DP !== 'function') return fail('this browser cannot read XML');
    if (typeof text !== 'string') return fail('not a text file');
    if (text.length > MAX_BYTES) return fail('the file is larger than 8 MB');
    text = text.replace(/^\uFEFF/, '');
    // CoT never declares a DTD. Refusing one here means no entity expansion ("billion laughs") and
    // no external entities, whatever the browser's XML parser would do with them.
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) return fail('it declares a DOCTYPE or entities, which CoT files never do');
    let doc;
    try { doc = new DP().parseFromString(text, 'application/xml'); } catch (_) { return fail('it is not well-formed XML'); }
    const top = doc && doc.documentElement;
    if (!top || (typeof doc.getElementsByTagName === 'function' && doc.getElementsByTagName('parsererror').length)) return fail('it is not well-formed XML');
    const list = nameOf(top) === 'event' ? [top] : kids(top, 'event');
    if (!list.length) return fail('there is no CoT <event> in it');
    res.total = list.length;
    const at = new Map();   // uid → index in records (a Map, so '__proto__' is just a string)
    list.forEach((el, i) => {
      if (i >= MAX_EVENTS) { skip('limit'); return; }
      let r;
      try { r = readEvent(el, Sym); } catch (_) { r = { kind: 'skip', reason: 'type' }; }
      if (r.kind === 'skip') { skip(r.reason || 'type'); return; }
      if (r.kind === 'cancel' && !r.uid) { skip('other'); return; }
      if (r.uid) {
        const j = at.get(r.uid);
        if (j !== undefined) {
          // TAK keeps the newest report of a uid: a later copy wins unless its time is older.
          // p186: when the newest report is a cancel (b-a-o-can), the alert it names is not placed.
          const old = res.records[j];
          const newer = !(Number.isFinite(old.time) && Number.isFinite(r.time) && old.time > r.time);
          const win = newer ? r : old, lose = newer ? old : r;
          skip(lose.kind === 'cancel' ? 'other' : win.kind === 'cancel' ? 'cancelled' : 'duplicate');
          res.records[j] = win;
          return;
        }
        at.set(r.uid, res.records.length);
      }
      res.records.push(r);
    });
    // a cancel that stands is a message, not a thing on the map
    res.records = res.records.filter(r => { if (r.kind !== 'cancel') return true; skip('other'); return false; });
    for (const r of res.records) res.counts[r.kind]++;
    return res;
  }

  // The unit controls for an imported code. A library type that draws exactly this code keeps its
  // plain-English name and no custom code. Anything else (a function the library does not list,
  // positions 13-15 set …) keeps the exact code as a custom SIDC, with the closest library type
  // for the simple offline icon. hasIcon(k) says whether index.html has a fallback icon for k.
  const DIM_KEY = { G: 'infantry', F: 'sof', A: 'air', S: 'naval', U: 'submarine' };
  function stateFromSidc(sd, Sym, hasIcon) {
    const p = Sym.parseSIDC(sd);
    if (!p) return null;
    const st = { key: '', aff: p.aff, cond: p.cond, ech: p.ech, strength: '', hq: p.hq, tf: p.tf, feint: p.feint, designation: '', higher: '', custom: '', customRaw: '' };
    const fn = sd.slice(4, 10);
    let near = '', best = -1;
    for (const k of Object.keys(Sym.CATALOG)) {
      const c = Sym.CATALOG[k];
      if (c.dim !== sd[2] || (hasIcon && !hasIcon(k))) continue;
      if (c.fn === fn && !c.text) {
        // the same rule _bpUnitVisual uses to draw a library unit
        const ech = (c.ech && st.ech === 'none') ? c.ech : st.ech;
        if (Sym.buildSIDC({ key: k, aff: st.aff, cond: st.cond, ech, hq: st.hq || undefined, tf: st.tf, feint: st.feint }) === sd) { st.key = k; return st; }
      }
      // closest type for the offline icon: the longest shared start of the function ID (not the HQ type)
      if (c.hq || c.text) continue;
      let n = 0; while (n < 6 && c.fn[n] === fn[n] && fn[n] !== '-') n++;
      if (n > best) { best = n; near = k; }
    }
    const dflt = Object.prototype.hasOwnProperty.call(DIM_KEY, sd[2]) ? DIM_KEY[sd[2]] : 'infantry';
    return Object.assign(st, { key: near || dflt, custom: sd, customRaw: sd });
  }

  // BDOC sends "FRIEND Infantry" (or "FRIEND Custom symbol") as the callsign of a unit that has no
  // designation: that is not a name. p186: every side with every type label counts, because TAK may
  // have changed the side or the type since BDOC sent it ("FRIEND Infantry" on a unit that is now
  // hostile armour used to become its designation). typeLabels: more type names the page knows
  // (its offline icon library). The set is built once per symbol module and label list.
  let autoFor = null, autoMore = null, autoSet = null;
  function isAutoLabel(callsign, Sym, typeLabels) {
    const more = Array.isArray(typeLabels) ? typeLabels : null;
    if (!autoSet || autoFor !== Sym || autoMore !== more) {
      const labels = Object.keys(Sym.CATALOG).map(k => Sym.CATALOG[k].label).concat(['Custom symbol'], more || []);
      const sides = Object.keys(Sym.AFF_BY_V).map(v => Sym.AFF_BY_V[v].name);
      autoSet = new Set(); autoFor = Sym; autoMore = more;
      // (the export cuts the callsign at 40 characters, so compare the cut, trimmed text)
      for (const s of sides) for (const l of labels) autoSet.add(Sym.cleanText(s + ' ' + l, 40).trim());
    }
    const cs = Sym.cleanText(callsign, 40).trim();
    return !!cs && autoSet.has(cs);
  }

  // a unit record → the state index.html draws (stateFromSidc + name / designation / higher unit)
  function unitState(rec, Sym, hasIcon, typeLabels) {
    const st = stateFromSidc(rec.sidc, Sym, hasIcon);
    if (!st) return null;
    st.higher = rec.higher || '';
    const auto = isAutoLabel(rec.callsign, Sym, typeLabels);
    st.designation = auto ? '' : (rec.designation || '');
    // p186: the callsign as TAK wrote it is the unit's name whenever the symbol's text field cannot
    // carry it unchanged (case, other scripts, length). The page shows it and sends it back to TAK.
    st.name = auto || !rec.callsign || rec.callsign === st.designation ? '' : rec.callsign;
    return st;
  }

  root.BDOCCot = Object.freeze({ MAX_BYTES, MAX_EVENTS, REASONS, TYPE_RE, GENERIC_TYPE, parse, classify, markerStyle, stateFromSidc, unitState, isAutoLabel, cleanLabel, cleanNote });
})(typeof window !== 'undefined' ? window : globalThis);
