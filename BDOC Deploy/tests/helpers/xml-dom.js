// A small, strict XML → DOM parser for node tests, standing in for the browser's DOMParser.
// It covers what CoT files use: elements, attributes, text, CDATA, comments, processing
// instructions and the five predefined + numeric character references. It skips a DOCTYPE
// (with or without an internal subset) WITHOUT expanding anything, so a test can show that
// js/bdoc-cot-import.js refuses DTDs itself. Anything not well-formed returns a document whose
// root is <parsererror>, the way Firefox reports it (Chrome inserts one; both are found by
// getElementsByTagName('parsererror')).
'use strict';

class Node {
  constructor(type) { this.nodeType = type; this.childNodes = []; this.parentNode = null; }
  get textContent() {
    if (this.nodeType === 3 || this.nodeType === 4) return this.nodeValue;
    return this.childNodes.filter(n => n.nodeType !== 8 && n.nodeType !== 7).map(n => n.textContent).join('');
  }
}
class Text extends Node { constructor(v, cdata) { super(cdata ? 4 : 3); this.nodeValue = v; } }
class Element extends Node {
  constructor(qname) {
    super(1);
    this.nodeName = this.tagName = qname;
    const i = qname.indexOf(':');
    this.localName = i >= 0 ? qname.slice(i + 1) : qname;
    this._attrs = new Map();
  }
  getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
  hasAttribute(n) { return this._attrs.has(n); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  getElementsByTagName(n) {
    const out = [];
    const walk = el => { for (const c of el.childNodes) if (c.nodeType === 1) { if (n === '*' || c.nodeName === n) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}
class Document extends Node {
  constructor() { super(9); }
  get documentElement() { return this.childNodes.find(n => n.nodeType === 1) || null; }
  getElementsByTagName(n) {
    const r = this.documentElement;
    if (!r) return [];
    return (n === '*' || r.nodeName === n ? [r] : []).concat(r.getElementsByTagName(n));
  }
}

const NAME = /^[A-Za-z_:][A-Za-z0-9_:.\-]*/;
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function decode(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);|&/g, (m, e) => {
    if (!e) throw new Error('bare &');
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      // XML 1.0 Char production
      if (!(cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0xD7FF) || (cp >= 0xE000 && cp <= 0xFFFD) || (cp >= 0x10000 && cp <= 0x10FFFF))) throw new Error('bad char ref');
      return String.fromCodePoint(cp);
    }
    if (!Object.prototype.hasOwnProperty.call(ENT, e)) throw new Error('undefined entity ' + e);
    return ENT[e];
  });
}

function parse(src) {
  const doc = new Document();
  const stack = [doc];
  let i = 0, rootSeen = false;
  const top = () => stack[stack.length - 1];
  const add = n => { n.parentNode = top(); top().childNodes.push(n); };
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(src)) throw new Error('control character');
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const text = src.slice(i, lt < 0 ? src.length : lt);
    if (text) {
      if (stack.length === 1) { if (/\S/.test(text)) throw new Error('text outside the root'); }
      else { if (text.includes(']]>')) throw new Error(']]> in text'); add(new Text(decode(text))); }
    }
    if (lt < 0) break;
    i = lt;
    if (src.startsWith('<?', i)) {
      const e = src.indexOf('?>', i); if (e < 0) throw new Error('open PI');
      i = e + 2; continue;
    }
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4); if (e < 0) throw new Error('open comment');
      i = e + 3; continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      if (stack.length === 1) throw new Error('CDATA outside the root');
      const e = src.indexOf(']]>', i); if (e < 0) throw new Error('open CDATA');
      add(new Text(src.slice(i + 9, e), true)); i = e + 3; continue;
    }
    if (src.startsWith('<!DOCTYPE', i)) {
      if (rootSeen) throw new Error('DOCTYPE after the root');
      let j = i + 9, depth = 0;
      for (; j < src.length; j++) { const ch = src[j]; if (ch === '[') depth++; else if (ch === ']') depth--; else if (ch === '>' && depth <= 0) break; }
      if (j >= src.length) throw new Error('open DOCTYPE');
      i = j + 1; continue;
    }
    if (src[i + 1] === '/') {
      const m = NAME.exec(src.slice(i + 2));
      if (!m) throw new Error('bad end tag');
      const close = src.indexOf('>', i);
      if (close < 0 || src.slice(i + 2 + m[0].length, close).trim()) throw new Error('bad end tag');
      const open = top();
      if (stack.length === 1 || open.nodeName !== m[0]) throw new Error('mismatched end tag </' + m[0] + '>');
      stack.pop(); i = close + 1; continue;
    }
    const m = NAME.exec(src.slice(i + 1));
    if (!m) throw new Error('bad start tag');
    if (stack.length === 1) { if (rootSeen) throw new Error('second root element'); rootSeen = true; }
    const el = new Element(m[0]);
    let j = i + 1 + m[0].length;
    for (;;) {
      const ws = /^\s*/.exec(src.slice(j))[0]; j += ws.length;
      if (src.startsWith('/>', j)) { add(el); j += 2; break; }
      if (src[j] === '>') { add(el); stack.push(el); j += 1; break; }
      if (!ws) throw new Error('attributes need white space');
      const an = NAME.exec(src.slice(j));
      if (!an) throw new Error('bad attribute');
      j += an[0].length;
      const eq = /^\s*=\s*(["'])/.exec(src.slice(j));
      if (!eq) throw new Error('attribute without a quoted value');
      j += eq[0].length;
      const end = src.indexOf(eq[1], j);
      if (end < 0) throw new Error('open attribute value');
      const raw = src.slice(j, end);
      if (raw.includes('<')) throw new Error('< in attribute value');
      if (el._attrs.has(an[0])) throw new Error('duplicate attribute');
      el._attrs.set(an[0], decode(raw).replace(/[\t\n\r]/g, ' '));
      j = end + 1;
    }
    i = j;
  }
  if (stack.length !== 1) throw new Error('unclosed element <' + top().nodeName + '>');
  if (!doc.documentElement) throw new Error('no root element');
  return doc;
}

class DOMParser {
  constructor() { DOMParser.calls++; }
  parseFromString(src, type) {
    if (type !== 'application/xml' && type !== 'text/xml') throw new Error('unsupported type ' + type);
    try { return parse(String(src)); } catch (e) {
      const d = new Document();
      const pe = new Element('parsererror');
      pe.childNodes.push(new Text(String(e.message)));
      d.childNodes.push(pe);
      return d;
    }
  }
}
DOMParser.calls = 0;

module.exports = { DOMParser, parse };
