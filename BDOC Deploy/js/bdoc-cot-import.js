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

  // why an event was not placed, in words for the toast
  const REASONS = Object.freeze({
    drawing: 'drawings / shapes',
    route: 'routes',
    other: 'chat, tasking and other non-map messages',
    position: 'no valid position',
    type: 'no readable CoT type',
    duplicate: 'repeats of the same uid, newest kept',
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

  // a note: printable text, lines kept, at most `max` characters
  function cleanNote(s, max) {
    return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(CTRL_RE, '').replace(/\t/g, ' ')
      .split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max || 1000);
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
    if (type.startsWith('b-m-p-') || type === 'b-r-f-h-c' || type.startsWith('b-r-f-h-c-') || (type.startsWith('b-a-o-') && type !== 'b-a-o-can')) return 'marker';
    return 'other';
  }

  // how a plain marker is drawn: a fixed glyph and colour per kind (nothing from the file)
  const ID_COL = { f: '#2D72D2', a: '#2D72D2', h: '#DA3633', s: '#DA3633', j: '#DA3633', k: '#DA3633', n: '#3FB950', u: '#E8B349', p: '#E8B349' };
  function markerStyle(type) {
    const t = String(type || '');
    if (t.startsWith('b-r-f-h-c')) return { kind: 'CASEVAC / MEDEVAC REQUEST', glyph: '+', color: '#FF4444' };
    if (t.startsWith('b-a-o-')) return { kind: 'EMERGENCY ALERT', glyph: '!', color: '#FF4444' };
    if (t.startsWith('b-m-p-w')) return { kind: 'WAYPOINT', glyph: 'W', color: '#E8B349' };
    if (t.startsWith('b-m-p-c')) return { kind: 'CHECKPOINT', glyph: 'C', color: '#E8B349' };
    if (t.startsWith('b-m-p-s')) return { kind: 'SPOT / POINT', glyph: '•', color: '#E8B349' };
    if (t.startsWith('b-m-p')) return { kind: 'MAP POINT', glyph: '•', color: '#E8B349' };
    const id = t.split('-')[1];
    return { kind: 'TAK MARKER (no 2525C symbol)', glyph: '?', color: Object.prototype.hasOwnProperty.call(ID_COL, id) ? ID_COL[id] : '#E8B349' };
  }

  // one <event> → a record { kind: 'unit' | 'marker' | 'skip', … }
  function readEvent(el, Sym) {
    const rawType = attr(el, 'type').trim();
    const cls = classify(rawType);
    const r = { kind: 'skip', reason: null, uid: cleanUid(attr(el, 'uid')), type: cls === 'type' ? '' : rawType, time: Date.parse(attr(el, 'time')) };
    if (cls === 'type' || cls === 'drawing' || cls === 'route' || cls === 'other') { r.reason = cls; return r; }
    const pt = kid(el, 'point');
    const lat = num(attr(pt, 'lat')), lon = num(attr(pt, 'lon'));
    // 0, 0 is what TAK sends for "no fix", not a place
    if (!pt || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) { r.reason = 'position'; return r; }
    r.lat = lat; r.lon = lon;
    const det = kid(el, 'detail');
    const callsign = attr(kid(det, 'contact'), 'callsign');
    const rm = kid(det, 'remarks');
    // BDOC's export adds "SIDC … · Higher: …" after the note; take it out of the note and keep its values
    let rSidc = '', higher = '';
    const note = cleanNote(rm ? rm.textContent : '', 4000).split('\n').filter(line => {
      const m = rSidc ? null : BDOC_LINE_RE.exec(line.trim());
      if (m) { rSidc = m[1]; higher = m[2] || ''; return false; }
      return true;
    }).join('\n');
    r.comment = cleanNote(note, 1000);
    r.callsign = cleanLabel(callsign, 40);
    if (cls === 'unit') {
      let sidc = '', from = '';
      // the full code from remarks, while it still names this type: a side or type changed in TAK wins
      if (rSidc && Sym.isUsableSIDC(rSidc) && Sym.cotType(rSidc) === rawType) { sidc = rSidc; from = 'remarks'; }
      else { const s = Sym.sidcFromCot(rawType); if (s && Sym.isUsableSIDC(s)) { sidc = s; from = 'type'; } }
      if (sidc) {
        return Object.assign(r, { kind: 'unit', sidc, sidcFrom: from, designation: Sym.cleanText(callsign, 21), higher: from === 'remarks' ? Sym.cleanText(higher, 21) : '' });
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
      if (r.uid) {
        const j = at.get(r.uid);
        if (j !== undefined) {
          // TAK keeps the newest report of a uid: a later copy wins unless its time is older
          const old = res.records[j];
          skip('duplicate');
          if (!(Number.isFinite(old.time) && Number.isFinite(r.time) && old.time > r.time)) res.records[j] = r;
          return;
        }
        at.set(r.uid, res.records.length);
      }
      res.records.push(r);
    });
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

  // a unit record → the state index.html draws (stateFromSidc + designation / higher unit)
  function unitState(rec, Sym, hasIcon) {
    const st = stateFromSidc(rec.sidc, Sym, hasIcon);
    if (!st) return null;
    st.higher = rec.higher || '';
    // BDOC sends "FRIEND Infantry" (or "FRIEND Custom symbol") as the callsign of a unit with no
    // designation: that is not a name
    const c = !st.custom && Sym.CATALOG[st.key];
    const a = Sym.AFF_BY_V[st.aff], side = a ? a.name : '';
    // (the export cuts the callsign at 40 characters, so compare the cut, trimmed text)
    const cs = Sym.cleanText(rec.callsign, 40).trim();
    const auto = [side + ' Custom symbol'].concat(c ? [side + ' ' + c.label] : []).map(x => Sym.cleanText(x, 40).trim());
    st.designation = auto.includes(cs) ? '' : (rec.designation || '');
    return st;
  }

  root.BDOCCot = Object.freeze({ MAX_BYTES, MAX_EVENTS, REASONS, TYPE_RE, parse, classify, markerStyle, stateFromSidc, unitState, cleanLabel, cleanNote });
})(typeof window !== 'undefined' ? window : globalThis);
