// ============================================================
// BDOC P91 MODULE: sitrep-engine.js
// LIVE SITREP GENERATOR — the app answers analyst questions itself.
//
// Born from an operator test the app FAILED (2026-07-21):
//   "What happened in Iran in the last 24h? What bases got hit?
//    Who was attacked? Casualties?"
// The globe showed dots; it could not answer. This engine can.
//
// How: browser-direct GDELT DOC 2.0 (residential IPs are not
// throttled) pulls last-24h reporting for a theater, then a
// regex NER pass extracts:
//   • casualty claims  (N killed / N injured / N missing)
//   • installations hit (gazetteer of ~60 named bases/sites +
//     generic "<Name> Air Base" patterns, hit-verb gated)
//   • actors           (who attacked whom, directional)
// Fused with our proxy-gdeltevents (geocoded kinetic events) for
// a per-theater event count. Rendered as a Kitsune AI answer card.
//
// NO LLM, NO API KEY, NO SERVER DEPENDENCE for the core path.
// Depends on shared lexical env: esc, msg (kitsune chat).
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

window.SITREP_THEATERS = {
  iran:    { name: 'IRAN / PERSIAN GULF', cc: ['IR'], lat: 32.4, lon: 53.7, h: 3.2e6, q: '(iran OR tehran OR irgc OR "strait of hormuz" OR "us strikes iran")' },
  ukraine: { name: 'UKRAINE THEATER',     cc: ['UP', 'RS'], lat: 48.4, lon: 31.2, h: 2.6e6, q: '(ukraine OR kyiv OR kharkiv OR "russian strike" OR zaporizhzhia)' },
  gaza:    { name: 'GAZA / ISRAEL / LEBANON', cc: ['IS', 'GZ', 'LE', 'WE'], lat: 32.2, lon: 35.2, h: 9e5, q: '(gaza OR israel OR idf OR hezbollah OR lebanon)' },
  israel:  { alias: 'gaza' },
  lebanon: { alias: 'gaza' },
  yemen:   { name: 'YEMEN / RED SEA',     cc: ['YM'], lat: 15.3, lon: 45.0, h: 2.2e6, q: '(yemen OR houthi OR "red sea" OR hodeidah)' },
  sudan:   { name: 'SUDAN CIVIL WAR',     cc: ['SU'], lat: 14.5, lon: 30.5, h: 2.8e6, q: '(sudan OR khartoum OR darfur OR rsf OR "el fasher")' },
  myanmar: { name: 'MYANMAR CIVIL WAR',   cc: ['BM'], lat: 21.0, lon: 96.5, h: 2.4e6, q: '(myanmar OR burma OR junta OR tatmadaw)' },
  sahel:   { name: 'SAHEL INSURGENCY',    cc: ['ML', 'NG', 'UV'], lat: 14.5, lon: 2.0, h: 3.2e6, q: '(mali OR niger OR "burkina faso" OR jnim)' },
  taiwan:  { name: 'TAIWAN STRAIT',       cc: ['TW', 'CH'], lat: 23.7, lon: 121.0, h: 2.2e6, q: '(taiwan OR "taiwan strait" OR pla OR "chinese military")' }
};

// Gazetteer of named military installations & strategic sites (Gulf/CENTCOM-heavy,
// plus the usual suspects elsewhere). Matched case-insensitively in titles.
window.SITREP_SITES = [
  'Al Udeid', 'Al Dhafra', 'Ali Al Salem', 'Al Salem', 'Isa Air Base', 'Al Asad',
  'Erbil', 'Tower 22', 'Prince Sultan', 'Fifth Fleet', 'NSA Bahrain', 'Camp Arifjan',
  'Al Tanf', 'Incirlik', 'Diego Garcia', 'Muwaffaq Salti', 'Azraq',
  // Iranian strategic sites
  'Kharg Island', 'Bandar Abbas', 'Natanz', 'Fordow', 'Isfahan', 'Bushehr',
  'Parchin', 'Khorramabad', 'Chabahar', 'Qeshm', 'Abadan', 'Darkhovin',
  // Israel / Levant
  'Nevatim', 'Ramon', 'Hatzerim', 'Dimona', 'Haifa', 'Ramat David', 'Dahiyeh',
  // Ukraine / Russia
  'Engels', 'Belbek', 'Saky', 'Khmeimim', 'Sevastopol', 'Zaporizhzhia',
  // Yemen / Red Sea
  'Hodeidah', 'Sanaa', 'Ras Isa',
  // Asia
  'Kadena', 'Andersen', 'Guam', 'Clark Air Base'
];

// verbs that indicate a site was actually struck (vs merely mentioned)
var SITREP_HITVERBS = /\b(hit|struck|strikes?|hits|attacked|bombed|shelled|targeted|damaged|destroyed|missile|drone)\b/i;

// actor detection — directional "X → Y" patterns
var SITREP_ACTORS = [
  { rx: /\b(?:US|U\.S\.|American|CENTCOM|Pentagon)\b.{0,60}\b(?:strikes?|bombs?|hits?|attacks?|targets?)\b.{0,60}\b(?:Iran|Iranian|IRGC|Tehran|Houthi)/i, txt: 'US → Iran (strikes on Iranian targets)' },
  { rx: /\b(?:Iran|Iranian|IRGC|Tehran)\b.{0,60}\b(?:strikes?|attacks?|fires?|launches?|missiles?|drones?|hits?|targets?)\b.{0,60}\b(?:US|U\.S\.|American|base|Israel|embassy|Gulf|Kuwait|Bahrain|Qatar|UAE|Saudi|Jordan)/i, txt: 'Iran → US/allied targets (missile & drone attacks)' },
  { rx: /\b(?:Israel|Israeli|IDF|IAF)\b.{0,60}\b(?:strikes?|bombs?|hits?|attacks?|kills?|targets?)\b/i, txt: 'Israel → strikes (IDF/IAF operations)' },
  { rx: /\b(?:Hezbollah)\b.{0,60}\b(?:launches?|fires?|attacks?|strikes?|drones?|missiles?)\b/i, txt: 'Hezbollah → Israel (rockets/drones)' },
  { rx: /\b(?:Houthi|Ansar Allah)\b.{0,60}\b(?:attacks?|strikes?|missiles?|drones?|targets?|fires?)\b/i, txt: 'Houthi → shipping/regional targets' },
  { rx: /\b(?:Russia|Russian)\b.{0,60}\b(?:strikes?|attacks?|missiles?|drones?|shells?|hits?)\b.{0,60}\b(?:Ukraine|Ukrainian|Kyiv|Kharkiv)/i, txt: 'Russia → Ukraine (missile/drone strikes)' },
  { rx: /\b(?:Ukraine|Ukrainian)\b.{0,60}\b(?:strikes?|attacks?|drones?|hits?|targets?)\b.{0,60}\b(?:Russia|Russian|Crimea|refinery|tanker)/i, txt: 'Ukraine → Russia (deep strikes)' },
  { rx: /\b(?:RSF|Rapid Support)\b.{0,60}\b(?:attacks?|shells?|kills?|strikes?)\b/i, txt: 'RSF → attacks (Sudan)' }
];

// casualty claim extraction from a title. Returns [{n, kind, title, url}]
function sitrepCasualties(title) {
  var out = [];
  // normalize small word-numbers so "Two US troops killed" parses
  var norm = title.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi, function (w) {
    return { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }[w.toLowerCase()];
  });
  // up to three descriptor words between the number and the casualty keyword
  // ("220 US troops casualties", "3 Iranian soldiers killed", "85+ students dead")
  var rx = /(\d[\d,]*)\+?\s*(?:[A-Za-z'-]+\s+){0,3}?(killed|dead|deaths?|died|injured|wounded|hurt|missing|casualties)/gi;
  var m;
  while ((m = rx.exec(norm)) !== null) {
    var n = parseInt(m[1].replace(/,/g, ''), 10);
    if (!isFinite(n) || n <= 0 || n > 500000) continue;
    var kind = /killed|dead|death|died/i.test(m[2]) ? 'killed' : (/injured|wounded|hurt/i.test(m[2]) ? 'injured' : (/missing/i.test(m[2]) ? 'missing' : 'casualties'));
    out.push({ n: n, kind: kind });
  }
  return out;
}

window.generateSitrep = async function (target) {
  var key = String(target || 'iran').toLowerCase().trim();
  var t = SITREP_THEATERS[key];
  if (t && t.alias) t = SITREP_THEATERS[t.alias];
  if (!t) { msg('sy', '<b>SITREP</b><br><br>Unknown theater "' + esc(key) + '".<br>Available: <b>' + Object.keys(SITREP_THEATERS).filter(function (k) { return !SITREP_THEATERS[k].alias; }).join(', ') + '</b>'); return; }

  // ── fetch 1: GDELT DOC 24h reporting (browser-direct) + fetch 2: our geocoded kinetic events — in parallel
  var docUrl = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(t.q) + '&mode=artlist&format=json&timespan=24h&maxrecords=250&sort=hybridrel';
  var results = await Promise.allSettled([
    fetch(docUrl, { signal: AbortSignal.timeout(20000) }).then(function (r) { return r.json(); }),
    fetch('/.netlify/functions/proxy-gdeltevents?files=16', { signal: AbortSignal.timeout(40000) }).then(function (r) { return r.json(); })
  ]);

  var docRes = results[0].status === 'fulfilled' ? results[0].value : null;
  // SW offline-fallback or GDELT rate-limit both yield a shape without .articles — treat as miss
  var arts = (docRes && Array.isArray(docRes.articles)) ? docRes.articles : [];

  // FALLBACK: browser-direct blocked (datacenter IP throttling / offline SW response)
  // → route through our Netlify proxy-gdelt, which returns FeatureCollection of articles.
  if (!arts.length) {
    try {
      var pq = t.q.replace(/[()"]/g, '').split(' OR ').join(' OR ');
      var pr = await fetch('/.netlify/functions/proxy-gdelt?query=' + encodeURIComponent(pq) + '&timespan=24h&maxrecords=150', { signal: AbortSignal.timeout(30000) });
      var pd = await pr.json();
      arts = ((pd && pd.features) || []).map(function (f) {
        var p = f.properties || {};
        return { title: p.name || '', url: p.url || '', domain: p.domain || '', seendate: p.seendate || '' };
      }).filter(function (a) { return a.title; });
    } catch (e) { console.warn('[SITREP proxy fallback]', e); }
  }

  var evAll = (results[1].status === 'fulfilled' && results[1].value && results[1].value.events) || [];
  var evs = evAll.filter(function (e) { return t.cc.indexOf(e.cc) !== -1; });

  // ── P92: PLOT THE ANSWER — SITREP incidents become map markers, camera flies to theater.
  // "Does the map have markers where the incidents happened?" — it does now.
  window._sitrepEnts = window._sitrepEnts || [];
  var plotIncidents = function () {
    try {
      if (typeof V === 'undefined' || typeof Cesium === 'undefined') return 0;
      // clear previous SITREP markers (one active SITREP overlay at a time)
      window._sitrepEnts.forEach(function (e) { try { V.entities.remove(e); } catch (_) {} });
      window._sitrepEnts = [];
      var codeMeta = function (c, root) {
        if (root === '20') return { icon: '☢', label: 'MASS VIOLENCE', color: '#ff2d78' };
        if (c === '195' || c === '1951' || c === '1952') return { icon: '✈', label: 'AIR/DRONE STRIKE', color: '#ff6b35' };
        if (c === '194') return { icon: '⚓', label: 'NAVAL/BLOCKADE', color: '#00b4d8' };
        if (c === '193') return { icon: '⚔', label: 'GROUND CLASH', color: '#DA3633' };
        if (c === '186') return { icon: '🎯', label: 'ASSASSINATION ATTEMPT', color: '#E8B339' };
        if (/^183/.test(c)) return { icon: '💣', label: 'BOMBING/IED', color: '#ff6b35' };
        return root === '18' ? { icon: '✖', label: 'ASSAULT', color: '#E8B339' } : { icon: '⚔', label: 'ARMED ENGAGEMENT', color: '#DA3633' };
      };
      evs.forEach(function (ev, i) {
        var meta = codeMeta(ev.code, ev.root);
        var labeled = i < 12 || ev.m >= 15; // label the salient ones, dot the rest
        window._sitrepEnts.push(V.entities.add({
          position: Cesium.Cartesian3.fromDegrees(ev.lon, ev.lat),
          point: { pixelSize: labeled ? 9 : 6, color: Cesium.Color.fromCssColorString(meta.color).withAlpha(0.95), outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: labeled ? { text: meta.icon + ' ' + meta.label, font: '10px JetBrains Mono', fillColor: Cesium.Color.fromCssColorString(meta.color), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -16), disableDepthTestDistance: Number.POSITIVE_INFINITY } : undefined,
          description: '<div style="font-family:\'JetBrains Mono\',monospace;padding:12px;color:#c8ccd6;background:#0a0e14;border:1px solid ' + meta.color + ';max-width:400px">' +
            '<div style="font-size:12px;font-weight:700;color:' + meta.color + '">' + meta.icon + ' ' + meta.label + '</div>' +
            '<div style="font-size:8px;color:#8b949e;letter-spacing:1px;margin:4px 0 8px">SITREP INCIDENT · LAST ~4H · GEOCODED</div>' +
            '<div style="font-size:10px">Location: <b>' + esc(ev.place || 'unknown') + '</b></div>' +
            '<div style="font-size:10px">Media salience: <b>' + ev.m + ' mentions</b></div>' +
            (ev.url ? '<a href="' + esc(ev.url) + '" target="_blank" rel="noopener" style="color:#00ddff;font-size:9px">Read source →</a>' : '') + '</div>'
        }));
      });
      // fly the camera to the theater so the operator SEES the answer
      if (t.lat && evs.length) V.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, t.h || 2.5e6), duration: 2.2 });
      return window._sitrepEnts.length;
    } catch (e) { console.warn('[SITREP plot]', e); return 0; }
  };
  var plotted = plotIncidents();
  var plotNote = plotted ? '<br><span style="font-size:9px;color:#3FB950">▣ ' + plotted + ' incident markers plotted on the globe — camera moving to theater. Click any marker for details. Type "clear sitrep" to remove.</span>' : '';

  // LAST RESORT: no article titles at all → events-only SITREP (kinetic events still
  // carry type, place, salience and source links — a real answer, just thinner).
  if (!arts.length && evs.length) {
    var codeName = function (c, root) {
      if (root === '20') return 'MASS VIOLENCE';
      if (c === '195' || c === '1951' || c === '1952') return 'AIR/DRONE STRIKE';
      if (c === '194') return 'NAVAL/BLOCKADE';
      if (c === '193') return 'GROUND CLASH';
      if (c === '186') return 'ASSASSINATION ATTEMPT';
      if (/^183/.test(c)) return 'BOMBING/IED';
      return root === '18' ? 'ASSAULT' : 'ARMED ENGAGEMENT';
    };
    var top2 = evs.slice().sort(function (a, b) { return b.m - a.m; }).slice(0, 10);
    var h2 = '<b>⚡ LIVE SITREP — ' + esc(t.name) + '</b> <span style="font-size:9px;color:#E8B339">(EVENTS-ONLY MODE — news feed unreachable)</span><br>' +
      '<span style="font-size:9px;color:#8b949e">LAST ~4H · ' + evs.length + ' GEOCODED KINETIC EVENTS</span><br><br>';
    top2.forEach(function (ev) {
      h2 += '&bull; <b>' + codeName(ev.code, ev.root) + '</b> — ' + esc(ev.place) + ' <span style="color:#8b949e">(' + ev.m + ' mentions)</span>' +
        (ev.url ? ' <a href="' + esc(ev.url) + '" target="_blank" rel="noopener" style="color:#00ddff">source</a>' : '') + '<br>';
    });
    h2 += '<br><span style="font-size:8px;color:#4a5068">GDELT 2.0 Event DB. Full narrative SITREP unavailable — news API unreachable from this connection; retry in ~60s.</span>';
    msg('sy', h2 + plotNote);
    return;
  }

  if (!arts.length && !evs.length) {
    msg('sy', '<b>SITREP — ' + t.name + '</b><br><br>⚠ No live reporting retrievable right now (GDELT may be rate-limiting). Try again in ~60s.');
    return;
  }

  // dedupe articles by normalized title (wire stories repeat everywhere)
  var seen = {}; var uniq = [];
  arts.forEach(function (a) {
    var k = (a.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
    if (!k || seen[k]) return; seen[k] = 1; uniq.push(a);
  });

  // ── NER pass over titles ──
  var casualties = [];     // {n, kind, title, url}
  var siteHits = {};       // site → {mentions, hitTitles:[]}
  var actorHits = {};      // txt → count
  uniq.forEach(function (a) {
    var title = a.title || '';
    sitrepCasualties(title).forEach(function (c) {
      casualties.push({ n: c.n, kind: c.kind, title: title, url: a.url || '', domain: a.domain || '' });
    });
    var hitVerb = SITREP_HITVERBS.test(title);
    SITREP_SITES.forEach(function (s) {
      if (title.toLowerCase().indexOf(s.toLowerCase()) !== -1) {
        siteHits[s] = siteHits[s] || { mentions: 0, hit: false, sample: null };
        siteHits[s].mentions++;
        if (hitVerb) { siteHits[s].hit = true; if (!siteHits[s].sample) siteHits[s].sample = { title: title, url: a.url || '' }; }
      }
    });
    // generic "<Name> Air Base / airbase" catch for bases not in gazetteer
    var g = title.match(/([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)?)\s+(?:Air\s*Base|airbase|air\s*field|naval\s*base)/);
    if (g && hitVerb) {
      var name = g[1] + ' Air Base';
      siteHits[name] = siteHits[name] || { mentions: 0, hit: false, sample: null };
      siteHits[name].mentions++; siteHits[name].hit = true;
      if (!siteHits[name].sample) siteHits[name].sample = { title: title, url: a.url || '' };
    }
    SITREP_ACTORS.forEach(function (ac) { if (ac.rx.test(title)) actorHits[ac.txt] = (actorHits[ac.txt] || 0) + 1; });
  });

  // ── assemble the card ──
  var kMax = 0, iMax = 0, kSrc = null, iSrc = null;
  casualties.forEach(function (c) {
    if (c.kind === 'killed' && c.n > kMax) { kMax = c.n; kSrc = c; }
    if (c.kind === 'injured' && c.n > iMax) { iMax = c.n; iSrc = c; }
  });

  var hitSites = Object.keys(siteHits).filter(function (s) { return siteHits[s].hit; })
    .sort(function (a, b) { return siteHits[b].mentions - siteHits[a].mentions; });
  var actors = Object.keys(actorHits).sort(function (a, b) { return actorHits[b] - actorHits[a]; });

  var html = '<b>⚡ LIVE SITREP — ' + esc(t.name) + '</b><br>' +
    '<span style="font-size:9px;color:#8b949e">LAST 24H · ' + uniq.length + ' UNIQUE REPORTS · ' + evs.length + ' GEOCODED KINETIC EVENTS · GENERATED ' + new Date().toISOString().slice(11, 16) + 'Z</span><br><br>';

  if (actors.length) {
    html += '<b style="color:#DA3633">WHO IS ATTACKING WHOM:</b><br>';
    actors.slice(0, 5).forEach(function (a) { html += '&bull; ' + esc(a) + ' <span style="color:#8b949e">(' + actorHits[a] + ' rpts)</span><br>'; });
    html += '<br>';
  }

  if (hitSites.length) {
    html += '<b style="color:#ff6b35">INSTALLATIONS / SITES REPORTED HIT OR TARGETED:</b><br>';
    hitSites.slice(0, 10).forEach(function (s) {
      var sh = siteHits[s];
      html += '&bull; <b>' + esc(s) + '</b> <span style="color:#8b949e">(' + sh.mentions + ' rpts)</span>' +
        (sh.sample ? ' — <a href="' + esc(sh.sample.url) + '" target="_blank" rel="noopener" style="color:#00ddff">source</a>' : '') + '<br>';
    });
    html += '<br>';
  }

  html += '<b style="color:#E8B339">CASUALTY CLAIMS (24H REPORTING — UNVERIFIED):</b><br>';
  if (kMax || iMax) {
    if (kMax) html += '&bull; Highest killed figure: <b>' + kMax.toLocaleString() + '</b>' + (kSrc ? ' — <a href="' + esc(kSrc.url) + '" target="_blank" rel="noopener" style="color:#00ddff">' + esc(kSrc.domain || 'source') + '</a>' : '') + '<br>';
    if (iMax) html += '&bull; Highest injured figure: <b>' + iMax.toLocaleString() + '</b>' + (iSrc ? ' — <a href="' + esc(iSrc.url) + '" target="_blank" rel="noopener" style="color:#00ddff">' + esc(iSrc.domain || 'source') + '</a>' : '') + '<br>';
    var others = casualties.filter(function (c) { return c !== kSrc && c !== iSrc; }).slice(0, 4);
    others.forEach(function (c) { html += '&bull; ' + c.n.toLocaleString() + ' ' + c.kind + ' — <span style="color:#8b949e">' + esc(c.title.slice(0, 80)) + '</span><br>'; });
  } else {
    html += '&bull; No numeric casualty claims parsed from 24h titles.<br>';
  }
  html += '<br>';

  var top = uniq.slice(0, 6);
  if (top.length) {
    html += '<b style="color:#c8ccd6">TOP REPORTING:</b><br>';
    top.forEach(function (a) {
      html += '&bull; <a href="' + esc(a.url || '#') + '" target="_blank" rel="noopener" style="color:#c8ccd6;text-decoration:none">' + esc((a.title || '').slice(0, 95)) + '</a> <span style="color:#4a5068;font-size:9px">' + esc(a.domain || '') + '</span><br>';
    });
  }

  html += '<br><span style="font-size:8px;color:#4a5068">Machine-extracted from GDELT global media monitoring + GDELT 2.0 Event DB. Claims are media-reported and UNVERIFIED — cross-check before operational use. Casualty figures may include partisan claims.</span>';

  msg('sy', html + plotNote);
};
