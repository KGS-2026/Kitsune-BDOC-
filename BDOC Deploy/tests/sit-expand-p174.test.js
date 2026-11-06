// p174 — Travon: "double click on one, it shoots off to the side of the bar and gets really big ...
// double click it and it goes back". SIT cards (analyst briefs and the live GDELT feed) expand into
// #sitExpand beside the INTEL panel. Also fixes the live feed cards, which read an <a href> out of
// properties.html that proxy-gdelt no longer sends, so every card showed its headline twice.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const HTML = read('index.html'), SW = read('service-worker.js'), GD = read('netlify/functions/proxy-gdelt.js');
const SM = HTML.slice(HTML.indexOf('const SituationManager=(()=>{'), HTML.indexOf('window.SituationManager=SituationManager;'));

test('the live feed reads the fields proxy-gdelt actually sends', () => {
  for (const f of ['name:', 'url:', 'domain:', 'place:', 'seendate:']) assert.ok(GD.includes(f), `proxy sends ${f}`);
  assert.doesNotMatch(SM, /rawHtml\.match\(\/href=/, 'old html-scraping is gone');
  assert.match(SM, /title:String\(p\.name\|\|''\)\.trim\(\)\|\|'Intel event',place:String\(p\.place\|\|p\.country\|\|''\),domain:String\(p\.domain\|\|''\)/);
  assert.match(SM, /url:safeUrl\(String\(p\.url\|\|''\)\),seen:_gdTime\(p\.seendate\)/);
  // card text is escaped and the card carries only an index
  assert.match(SM, /data-osint="\$\{i\}"/);
  assert.match(SM, /<div class="sit-title" style="font-size:9px">\$\{esc\(it\.title\)\}<\/div>/);
  assert.match(SM, /<div class="sit-meta">\$\{esc\(\[it\.place,it\.domain,it\.seen\?_ago\(it\.seen\):''\]\.filter\(Boolean\)\.join\(' · '\)\)\}<\/div>/);
});

test('GDELT seendate parses as UTC', () => {
  const src = SM.match(/function _gdTime\(s\)\{[^\n]*\}/)[0];
  const ctx = vm.createContext({}); vm.runInContext(src + ';this.f=_gdTime;', ctx);
  assert.equal(ctx.f('20261106T001500Z'), Date.UTC(2026, 10, 6, 0, 15, 0));
  assert.equal(ctx.f(''), 0); assert.equal(ctx.f('garbage'), 0); assert.equal(ctx.f(undefined), 0);
});

test('double-click expands, double-click / Esc / ✕ shrinks, single click still opens a brief', () => {
  assert.match(SM, /document\.addEventListener\('dblclick',e=>\{\s*const card=e\.target\.closest&&e\.target\.closest\('#spBody \.sit-card'\);if\(!card\)return;/);
  assert.match(SM, /if\(_xSrc===card&&x&&x\.classList\.contains\('sx-open'\)\)_collapse\(\);else _expand\(card\);/);
  assert.match(SM, /x\.addEventListener\('dblclick',e=>\{if\(e\.target\.closest\('button'\)\)return;_collapse\(\);\}\)/);
  assert.match(SM, /document\.addEventListener\('keydown',e=>\{if\(e\.key==='Escape'\)_collapse\(\);\}\)/);
  assert.match(SM, /x\.querySelector\('\.sx-x'\)\.addEventListener\('click',_collapse\)/);
  // the brief's single click waits so a double-click can cancel it (no detail view flashing open)
  assert.match(SM, /closest\('#spBody \.sit-card\[data-sit\]'\)[\s\S]{0,80}clearTimeout\(_clickT\)[\s\S]{0,200}_clickT=setTimeout\([\s\S]{0,140}_renderDetail\(s\);\},260\)/);
  assert.doesNotMatch(SM, /onclick="SituationManager\.openSit\(/, 'inline single-click handler replaced');
  assert.match(SM, /data-sit="\$\{esc\(s\.id\)\}"/);
  // panel close, tab switch, open detail and back all shrink it
  assert.match(SM, /_syncPositions\(false\);_clearArcs\(\);_collapse\(\);/);
  assert.match(SM, /const prev=_tab;_tab=t;_collapse\(\);/);
  assert.match(SM, /openSit\(id\)\{const s=_sits\.find\(x=>x\.id===id\);if\(!s\)return;_collapse\(\);/);
  assert.match(SM, /back\(\)\{_view='list';_active=null;_clearArcs\(\);_collapse\(\);_renderList\(\);\}/);
});

test('expanded view escapes every piece of feed text and opens links safely', () => {
  const body = SM.slice(SM.indexOf('function _expand(card){'), SM.indexOf('function _collapse(){'));
  const html = body.slice(body.indexOf('x.innerHTML='), body.indexOf("x.querySelector('.sx-x')"));
  const interps = [...html.matchAll(/\$\{([^`]*?)\}(?=[^}]*?(`|<))/g)].map(m => m[1]);
  assert.ok(interps.length >= 6, 'found the template interpolations');
  for (const e of interps) assert.ok(/esc|^d\.url&&|^isFinite/.test(e) || /^\[d\.place/.test(e), 'unescaped interpolation: ' + e);
  assert.match(html, /\[d\.place,d\.source,when\]\.filter\(Boolean\)\.map\(esc\)\.join/);
  assert.match(body, /window\.open\(d\.url,'_blank','noopener'\)/);
  assert.doesNotMatch(html, /href=/, 'no feed URL is written into markup');
});

test('the expanded panel sits beside the INTEL panel and above other floating controls', () => {
  assert.match(SM, /#sitExpand\{position:fixed;left:calc\(var\(--lw,248px\) \+ 12px\);top:calc\(var\(--tbh,56px\) \+ 10px\);z-index:130;/);
  assert.match(SM, /body\.ai-open #sitExpand\{width:min\(640px,calc\(100vw - var\(--lw,248px\) - var\(--rw,360px\) - 40px\)\)\}/);
  assert.match(SM, /#sitExpand \.sx-title\{font-size:21px;/);
  assert.match(SM, /#sitExpand p\{margin:0;font-size:14px;/);
  assert.match(SM, /@media\(max-width:767px\)\{#sitExpand,body\.ai-open #sitExpand\{left:8px;right:8px;width:auto;/);
});

test('service worker bumped for p174', () => {
  assert.match(SW, /^const SW_VERSION = 'bdoc-v176';  \/\/ p174:/m);
  assert.match(SW, /^\/\/ \(prev\) const SW_VERSION = 'bdoc-v175';  \/\/ p173:/m);
});
