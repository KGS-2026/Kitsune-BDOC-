// ============================================================
// bdoc-cyber-map.js — Cyber layer: reported incidents where they happened (p182).
//
// Replaces the old layer, which drew made-up hotspots ("US East Coast", "US West Coast")
// with random attack counts and random arcs whenever its sources failed (always, on live).
// Now every pin is a reported incident from cyber news, local news or CISA, placed from
// the article text at county, town, state or country level, and it says which.
// Data: /.netlify/functions/cyber-incidents (15-min CDN cache). Feed text is escaped
// before it goes into an info box and set with textContent in the panel.
// p184: origin lines. When a report names who did it ("Iran-linked group", "Russian hackers",
// "Volt Typhoon"), a glowing arc runs from that country to the victim's pin, with an arrowhead
// at the victim. Only reports that name an attacker get a line; nothing is guessed.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
(function () {
  'use strict';

  var ENDPOINT = '/.netlify/functions/cyber-incidents';
  var REFRESH_MS = 10 * 60e3;
  var LS = 'bdoc_cyber_map';
  var SECTORS = [
    ['water', 'Water', '#2D9CDB'], ['health', 'Health / blood', '#E5484D'], ['food', 'Food / grocery', '#F5A524'],
    ['energy', 'Energy', '#F0D000'], ['government', 'Government', '#A78BFA'], ['education', 'Schools', '#22C55E'],
    ['transport', 'Transport', '#14B8A6'], ['finance', 'Finance', '#84CC16'], ['telecom', 'Telecom', '#EC4899'],
    ['retail', 'Retail', '#FB923C'], ['other', 'Other', '#9CA3AF']
  ];
  var COLOR = {}, LABEL = {};
  SECTORS.forEach(function (s) { COLOR[s[0]] = s[2]; LABEL[s[0]] = s[1]; });
  var PRECISION = { county: 'county', city: 'town', state: 'state (no town named)', country: 'country (no town named)' };
  var RING_KM = { state: 180, country: 380 };
  var FLY_H = { county: 260e3, city: 160e3, state: 1.4e6, country: 3.2e6 };
  // Origin line colours: the four countries named most often get their own, the rest share one.
  var ORIGIN_COLOR = { RU: '#FF5D5D', CN: '#FFB020', IR: '#3DDC97', KP: '#C084FC' };
  var ORIGIN_OTHER = '#7DD3FC';
  function originColor(cc) { return ORIGIN_COLOR[cc] || ORIGIN_OTHER; }

  var V = null, ents = null, data = null, byKey = {}, timer = null, isOn = function () { return true; };
  var counts = { pins: 0, arcs: 0, origins: 0 };
  var prefs = loadPrefs();

  function loadPrefs() {
    var p = { days: 30, off: [], arcs: true };
    try {
      var s = JSON.parse(localStorage.getItem(LS) || '{}');
      if (s && [7, 30, 365].indexOf(s.days) >= 0) p.days = s.days;
      if (s && Array.isArray(s.off)) p.off = s.off;
      if (s && s.arcs === false) p.arcs = false;
    } catch (_) {}
    return p;
  }
  function savePrefs() { try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch (_) {} }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function safeUrl(u) { return /^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : ''; }
  function day(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); }
  function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }

  function inWindow(x) { return Date.now() - Date.parse(x.latest || x.published) <= prefs.days * 86400e3; }
  function visible() {
    if (!data) return [];
    return data.incidents.filter(function (x) { return inWindow(x) && prefs.off.indexOf(x.sector) < 0; });
  }
  // A story placed only in "United States" has no useful spot (the centre is in Kansas): list it, don't pin it.
  function mappable(p) { return !!p && !(p.level === 'country' && p.cc === 'US'); }
  function placeKey(p) { return [p.level, p.name, p.state, p.cc].join('|'); }
  function placeName(p) { return p.name + (p.state && p.level !== 'state' ? ', ' + p.state : ''); }
  // An origin line needs a named attacker and a victim with a pin.
  function arcable(x) { return !!(x.origin && x.origin.cc && isFinite(x.origin.lat) && isFinite(x.origin.lon) && mappable(x.place)); }
  function originLine(x) { return 'From ' + x.origin.name + ' (as reported: “' + x.origin.why + '”)'; }

  // ── map ────────────────────────────────────────────────────
  function clearMap() {
    if (!V || !ents) return;
    ents.forEach(function (e) { try { V.entities.remove(e); } catch (_) {} });
    ents.length = 0;
    byKey = {};
    counts = { pins: 0, arcs: 0, origins: 0 };
  }

  // Great-circle arc from a to b, lifted in the middle (higher for longer lines). Returns
  // [lon, lat, height, ...] for Cartesian3.fromDegreesArrayHeights.
  function arcPoints(a, b, n) {
    var C = Cesium;
    var g = new C.EllipsoidGeodesic(C.Cartographic.fromDegrees(a.lon, a.lat), C.Cartographic.fromDegrees(b.lon, b.lat));
    var peak = Math.min(Math.max(g.surfaceDistance * 0.12, 250e3), 3.2e6);
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, c = g.interpolateUsingFraction(t);
      out.push(C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude), 4 * peak * t * (1 - t) + 15e3);
    }
    return out;
  }

  function describeArc(o, p, list) {
    var col = originColor(o.cc);
    var h = '<div style="font-family:system-ui,sans-serif;font-size:12px;color:#d6dae3;background:#0b0f16;padding:12px;max-width:440px">' +
      '<div style="font:600 10px/1.4 monospace;letter-spacing:.08em;color:' + col + ';margin-bottom:8px">ATTACK ORIGIN AS REPORTED · ' +
      esc(o.name.toUpperCase()) + ' → ' + esc(placeName(p).toUpperCase()) + '</div>';
    list.slice(0, 12).forEach(function (x) {
      var link = safeUrl(x.link);
      h += '<div style="border-left:3px solid ' + col + ';padding:4px 0 6px 8px;margin-bottom:8px">' +
        '<div style="font:600 9px monospace;color:#8b93a7;letter-spacing:.06em">' + esc(LABEL[x.sector].toUpperCase()) + ' · ' + esc(day(x.published)) +
        (x.reports > 1 ? ' · ' + x.reports + ' REPORTS' : '') + '</div>' +
        '<div style="margin:2px 0 3px;line-height:1.35">' + (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer" style="color:#e6e9ee">' + esc(x.title) + '</a>' : esc(x.title)) + '</div>' +
        '<div style="font-size:10px;color:' + col + '">Named in the report as: “' + esc(x.origin.why) + '”</div></div>';
    });
    h += '<div style="font-size:10px;color:#6b7387;margin-top:6px">The line shows who the reports name: officials, researchers or the attackers’ own claims. ' +
      'Attribution is often a claim or a suspicion; BDOC has not confirmed it.</div></div>';
    return h;
  }

  function describeOrigin(o, list) {
    var col = originColor(o.cc);
    var h = '<div style="font-family:system-ui,sans-serif;font-size:12px;color:#d6dae3;background:#0b0f16;padding:12px;max-width:440px">' +
      '<div style="font:600 10px/1.4 monospace;letter-spacing:.08em;color:' + col + ';margin-bottom:8px">NAMED AS THE ATTACKER · ' + esc(o.name.toUpperCase()) +
      ' · ' + list.length + ' INCIDENT' + (list.length === 1 ? '' : 'S') + '</div>';
    list.slice(0, 15).forEach(function (x) {
      var link = safeUrl(x.link);
      h += '<div style="padding:3px 0 6px">' + (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer" style="color:#e6e9ee">' + esc(x.title) + '</a>' : esc(x.title)) +
        '<div style="font-size:10px;color:#8b93a7">' + esc(day(x.published)) + ' · ' + esc(mappable(x.place) ? placeName(x.place) : x.place ? 'United States (no state named)' : 'place not named') +
        ' · “' + esc(x.origin.why) + '”</div></div>';
    });
    h += '<div style="font-size:10px;color:#6b7387;margin-top:6px">The pin is the country’s centre, not a known location. Attribution as reported, not confirmed by BDOC.</div></div>';
    return h;
  }

  // Origin lines and origin markers for the incidents in view.
  function drawArcs(list) {
    var C = Cesium, lines = {}, from = {};
    list.forEach(function (x) {
      if (!x.origin || !x.origin.cc) return;
      (from[x.origin.cc] = from[x.origin.cc] || { o: x.origin, list: [] }).list.push(x);
      if (!arcable(x)) return;
      var k = x.origin.cc + '>' + placeKey(x.place);
      (lines[k] = lines[k] || { o: x.origin, p: x.place, list: [] }).list.push(x);
    });
    Object.keys(lines).forEach(function (k) {
      var L = lines[k], col = C.Color.fromCssColorString(originColor(L.o.cc));
      var pts = arcPoints(L.o, L.p, 40);
      var n = L.list.length, name = L.o.name + ' → ' + placeName(L.p) + ' (as reported)', desc = describeArc(L.o, L.p, L.list);
      ents.push(V.entities.add({
        name: name, description: desc,
        polyline: { positions: C.Cartesian3.fromDegreesArrayHeights(pts.slice(0, 37 * 3)), width: 2.4 + Math.min(3, n),
          material: new C.PolylineGlowMaterialProperty({ glowPower: 0.22, color: col.withAlpha(0.8) }), arcType: C.ArcType.NONE }
      }));
      // Arrowhead over the last stretch, pointing at the victim.
      ents.push(V.entities.add({
        name: name, description: desc,
        polyline: { positions: C.Cartesian3.fromDegreesArrayHeights(pts.slice(34 * 3)), width: 9 + Math.min(4, n),
          material: new C.PolylineArrowMaterialProperty(col.withAlpha(0.95)), arcType: C.ArcType.NONE }
      }));
      counts.arcs++;
    });
    Object.keys(from).forEach(function (cc) {
      var F = from[cc], col = C.Color.fromCssColorString(originColor(cc)), n = F.list.length;
      ents.push(V.entities.add({
        name: F.o.name + ' — named as the attacker in ' + n + ' report' + (n === 1 ? '' : 's'),
        position: C.Cartesian3.fromDegrees(F.o.lon, F.o.lat),
        point: { pixelSize: 10 + Math.min(6, n), color: C.Color.BLACK.withAlpha(0.6), outlineColor: col, outlineWidth: 3, disableDepthTestDistance: 5e6 },
        label: { text: F.o.name.toUpperCase() + ' · ATTACKER IN ' + n, font: '600 11px JetBrains Mono, monospace',
          fillColor: col, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new C.Cartesian2(0, 24), distanceDisplayCondition: new C.DistanceDisplayCondition(0, 2.2e7), disableDepthTestDistance: 5e6 },
        description: describeOrigin(F.o, F.list)
      }));
      counts.origins++;
    });
  }

  function describe(p, list) {
    var h = '<div style="font-family:system-ui,sans-serif;font-size:12px;color:#d6dae3;background:#0b0f16;padding:12px;max-width:440px">' +
      '<div style="font:600 10px/1.4 monospace;letter-spacing:.08em;color:#8b93a7;margin-bottom:8px">CYBER INCIDENTS · ' + esc(placeName(p).toUpperCase()) +
      ' · PLACED BY ' + esc(PRECISION[p.level] || p.level).toUpperCase() + '</div>';
    list.slice(0, 20).forEach(function (x) {
      var link = safeUrl(x.link);
      h += '<div style="border-left:3px solid ' + COLOR[x.sector] + ';padding:4px 0 6px 8px;margin-bottom:8px">' +
        '<div style="font:600 9px monospace;color:' + COLOR[x.sector] + ';letter-spacing:.06em">' + esc(LABEL[x.sector].toUpperCase()) + ' · ' + esc(day(x.published)) +
        (x.reports > 1 ? ' · ' + x.reports + ' REPORTS' : '') + '</div>' +
        '<div style="margin:2px 0 3px;line-height:1.35">' + (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer" style="color:#e6e9ee">' + esc(x.title) + '</a>' : esc(x.title)) + '</div>' +
        (x.origin ? '<div style="font-size:10px;color:' + originColor(x.origin.cc) + ';margin-bottom:2px">' + esc(originLine(x)) + '</div>' : '') +
        '<div style="font-size:10px;color:#8b93a7">' + (x.sources || []).slice(0, 6).map(function (s) {
          var u = safeUrl(s.link);
          return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" style="color:#8b93a7">' + esc(s.name) + '</a>' : esc(s.name);
        }).join(' · ') + '</div></div>';
    });
    if (list.length > 20) h += '<div style="font-size:10px;color:#8b93a7">+ ' + (list.length - 20) + ' more in this period</div>';
    h += '<div style="font-size:10px;color:#6b7387;margin-top:6px">Placed from the article text. Reported by the outlets above; BDOC has not confirmed them.</div></div>';
    return h;
  }

  function draw() {
    clearMap();
    if (!V || !window.Cesium) return;
    var groups = {};
    visible().forEach(function (x) {
      if (!mappable(x.place)) return;
      var k = placeKey(x.place);
      (groups[k] = groups[k] || { p: x.place, list: [] }).list.push(x);
    });
    var order = SECTORS.map(function (s) { return s[0]; });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], p = g.p;
      g.list.sort(function (a, b) { return Date.parse(b.latest || b.published) - Date.parse(a.latest || a.published); });
      var top = g.list.slice().sort(function (a, b) { return order.indexOf(a.sector) - order.indexOf(b.sector); })[0].sector;
      var col = Cesium.Color.fromCssColorString(COLOR[top]);
      var n = g.list.length;
      var size = (p.level === 'country' ? 12 : p.level === 'state' ? 11 : 9) + Math.min(8, Math.round(Math.log2(n) * 2));
      var opts = {
        name: placeName(p) + ' — ' + n + ' incident' + (n === 1 ? '' : 's'),
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        point: { pixelSize: size, color: col.withAlpha(0.9), outlineColor: Cesium.Color.BLACK.withAlpha(0.7), outlineWidth: 2, disableDepthTestDistance: 5e6 },
        label: {
          text: placeName(p) + (n > 1 ? ' (' + n + ')' : ''), font: '600 11px JetBrains Mono, monospace',
          fillColor: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -size - 6),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, p.level === 'country' || p.level === 'state' ? 1.2e7 : 4e6),
          disableDepthTestDistance: 5e6
        },
        description: describe(p, g.list)
      };
      // A state or country pin is not a precise spot: draw the uncertainty as a faint ring.
      if (RING_KM[p.level]) {
        opts.ellipse = { semiMajorAxis: RING_KM[p.level] * 1000, semiMinorAxis: RING_KM[p.level] * 1000, height: 0,
          material: col.withAlpha(0.06), outline: true, outlineColor: col.withAlpha(0.35) };
      }
      var ent = V.entities.add(opts);
      ents.push(ent);
      byKey[k] = ent;
      counts.pins++;
    });
    if (prefs.arcs) drawArcs(visible());
    panel();
  }

  function flyToOrigin(cc) {
    if (!V || !data) return;
    var hit = visible().filter(function (x) { return x.origin && x.origin.cc === cc; });
    if (!hit.length) return;
    var o = hit[0].origin, targets = hit.filter(arcable).map(function (x) { return x.place; });
    // Look from above the middle of the lines so origin and victims are both in view.
    var lat = o.lat, lon = o.lon, far = 9e6;
    if (targets.length) {
      var t = targets[0];
      var g = new Cesium.EllipsoidGeodesic(Cesium.Cartographic.fromDegrees(o.lon, o.lat), Cesium.Cartographic.fromDegrees(t.lon, t.lat));
      var mid = g.interpolateUsingFraction(0.5);
      lat = Cesium.Math.toDegrees(mid.latitude); lon = Cesium.Math.toDegrees(mid.longitude);
      far = Math.min(Math.max(g.surfaceDistance * 1.3, 4e6), 2e7);
    }
    V.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, far), duration: 1.6 });
  }

  function flyTo(x) {
    if (!V || !mappable(x.place)) return;
    var p = x.place;
    V.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, FLY_H[p.level] || 1e6), duration: 1.4 });
    var ent = byKey[placeKey(p)];
    if (ent) setTimeout(function () { try { V.selectedEntity = ent; } catch (_) {} }, 1500);
  }

  // ── panel (#cyberHud) ───────────────────────────────────────
  function panel() {
    var hud = document.getElementById('cyberHud');
    if (!hud) return;
    hud.textContent = '';
    var muted = 'color:var(--text-tertiary,#8b93a7)';

    var head = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--bdr,#232a36)');
    head.appendChild(el('span', 'font-weight:600;letter-spacing:.12em;font-size:10px', 'CYBER INCIDENTS'));
    head.appendChild(el('span', muted + ';font-size:10px', data ? 'updated ' + new Date(data.checked).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'loading…'));
    hud.appendChild(head);

    if (!data) { hud.appendChild(el('div', muted, 'Reading cyber news and CISA…')); return; }
    if (data.error) { hud.appendChild(el('div', 'color:#E8B349', 'Incident feed unavailable right now (' + data.error + '). Nothing is shown rather than a guess.')); return; }

    var win = el('div', 'display:flex;gap:4px;margin-bottom:8px');
    [[7, '7 DAYS'], [30, '30 DAYS'], [365, '1 YEAR']].forEach(function (w) {
      var b = el('button', 'flex:1;font:600 9px monospace;letter-spacing:.06em;padding:4px 0;border-radius:2px;cursor:pointer;border:1px solid ' +
        (prefs.days === w[0] ? '#DA3633;background:rgba(218,54,51,.18);color:#fff' : 'var(--bdr2,#2b3342);background:transparent;color:var(--text-secondary,#aab1c2)'), w[1]);
      b.type = 'button';
      b.addEventListener('click', function () { prefs.days = w[0]; savePrefs(); draw(); });
      win.appendChild(b);
    });
    hud.appendChild(win);

    var inWin = data.incidents.filter(inWindow);
    var count = {};
    inWin.forEach(function (x) { count[x.sector] = (count[x.sector] || 0) + 1; });
    var chips = el('div', 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px');
    SECTORS.forEach(function (s) {
      var off = prefs.off.indexOf(s[0]) >= 0;
      var c = el('button', 'font:600 9px monospace;padding:3px 6px;border-radius:2px;cursor:pointer;border:1px solid ' + s[2] + ';' +
        (off ? 'background:transparent;color:' + s[2] + ';opacity:.45' : 'background:' + s[2] + '22;color:' + s[2]), s[1] + ' ' + (count[s[0]] || 0));
      c.type = 'button';
      c.title = off ? 'Show ' + s[1] : 'Hide ' + s[1];
      c.addEventListener('click', function () {
        prefs.off = off ? prefs.off.filter(function (k) { return k !== s[0]; }) : prefs.off.concat([s[0]]);
        savePrefs(); draw();
      });
      chips.appendChild(c);
    });
    hud.appendChild(chips);

    // Water: which US states, the question that started this layer.
    var water = data.incidents.filter(function (x) { return x.sector === 'water' && Date.now() - Date.parse(x.latest || x.published) <= 365 * 86400e3; });
    var ws = {};
    water.forEach(function (x) { if (x.place && x.place.cc === 'US' && x.place.state) { (ws[x.place.state] = ws[x.place.state] || []).push(x); } });
    var wbox = el('div', 'border:1px solid #2D9CDB55;background:#2D9CDB12;border-radius:2px;padding:6px 8px;margin-bottom:8px');
    wbox.appendChild(el('div', 'font:600 9px monospace;letter-spacing:.08em;color:#2D9CDB;margin-bottom:4px', 'WATER SYSTEMS HIT · US STATES · LAST 12 MONTHS'));
    var states = Object.keys(ws).sort(function (a, b) { return ws[b].length - ws[a].length; });
    if (!states.length) wbox.appendChild(el('div', muted + ';font-size:10px', 'No reported attack on a US water system placed in the last 12 months.'));
    var srow = el('div', 'display:flex;flex-wrap:wrap;gap:4px');
    states.forEach(function (st) {
      var b = el('button', 'font:600 10px monospace;padding:2px 6px;border:1px solid #2D9CDB;background:transparent;color:#cfe8f7;border-radius:2px;cursor:pointer',
        st + ' ' + ws[st].length);
      b.type = 'button';
      b.title = ws[st].map(function (x) { return x.title; }).join('\n');
      b.addEventListener('click', function () {
        var x = ws[st][0];
        if (prefs.days < 365 || prefs.off.indexOf('water') >= 0) { prefs.days = 365; prefs.off = prefs.off.filter(function (k) { return k !== 'water'; }); savePrefs(); draw(); }
        flyTo(x);
      });
      srow.appendChild(b);
    });
    wbox.appendChild(srow);
    var abroad = water.filter(function (x) { return x.place && x.place.cc !== 'US'; }).length;
    var noState = water.filter(function (x) { return !x.place || (x.place.cc === 'US' && !x.place.state); }).length;
    var more = [];
    if (abroad) more.push(abroad + ' outside the US');
    if (noState) more.push(noState + ' that name no state');
    if (more.length) wbox.appendChild(el('div', muted + ';font-size:10px;margin-top:4px', '+ ' + more.join(', ') + ' (1 YEAR view lists them).'));
    hud.appendChild(wbox);

    // Where the attacks came from, as the reports say.
    var inView = visible();
    var named = inView.filter(function (x) { return x.origin && x.origin.cc; });
    var by = {};
    named.forEach(function (x) { (by[x.origin.cc] = by[x.origin.cc] || { o: x.origin, n: 0, lines: 0 }).n++; if (arcable(x)) by[x.origin.cc].lines++; });
    var obox = el('div', 'border:1px solid #FF5D5D44;background:#FF5D5D0D;border-radius:2px;padding:6px 8px;margin-bottom:8px');
    var ohead = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px');
    ohead.appendChild(el('span', 'font:600 9px monospace;letter-spacing:.08em;color:#FF8A8A', 'WHERE ATTACKS CAME FROM · AS REPORTED'));
    var tog = el('button', 'font:600 9px monospace;padding:2px 6px;border-radius:2px;cursor:pointer;border:1px solid #FF8A8A;' +
      (prefs.arcs ? 'background:#FF5D5D33;color:#fff' : 'background:transparent;color:#FF8A8A;opacity:.6'), prefs.arcs ? 'LINES ON' : 'LINES OFF');
    tog.type = 'button';
    tog.title = prefs.arcs ? 'Hide the origin lines' : 'Show the origin lines';
    tog.addEventListener('click', function () { prefs.arcs = !prefs.arcs; savePrefs(); draw(); });
    ohead.appendChild(tog);
    obox.appendChild(ohead);
    var ccs = Object.keys(by).sort(function (a, b) { return by[b].n - by[a].n; });
    if (!ccs.length) obox.appendChild(el('div', muted + ';font-size:10px', 'No report in this period names an attacker' + (prefs.days < 365 ? ' (try 1 YEAR).' : '.')));
    ccs.forEach(function (cc) {
      var r = by[cc];
      var row = el('button', 'display:flex;width:100%;align-items:center;gap:6px;padding:3px 0;border:0;background:transparent;cursor:pointer;text-align:left;color:var(--text-primary,#e6e9ee);font:11px var(--m,monospace)');
      row.type = 'button';
      row.appendChild(el('span', 'flex:0 0 14px;height:3px;border-radius:2px;background:' + originColor(cc)));
      row.appendChild(el('span', 'flex:1', r.o.name));
      row.appendChild(el('span', muted + ';font-size:10px', r.n + ' named' + (r.lines ? ' · ' + r.lines + ' on map' : '')));
      row.title = 'Show the lines from ' + r.o.name;
      row.addEventListener('click', function () { if (!prefs.arcs) { prefs.arcs = true; savePrefs(); draw(); } flyToOrigin(cc); });
      obox.appendChild(row);
    });
    obox.appendChild(el('div', muted + ';font-size:9px;line-height:1.4;margin-top:4px',
      named.length + ' of ' + inView.length + ' incidents in view name an attacker; the rest get no line. A line runs from the country the report names ' +
      '(officials, researchers or the attackers’ own claim) to the victim, arrow at the victim. Not confirmed by BDOC.'));
    hud.appendChild(obox);

    var list = visible().sort(function (a, b) { return Date.parse(b.latest || b.published) - Date.parse(a.latest || a.published); });
    hud.appendChild(el('div', 'font:600 9px monospace;letter-spacing:.08em;' + muted + ';margin:4px 0', 'LATEST · ' + list.length + ' IN VIEW · ' + list.filter(function (x) { return mappable(x.place); }).length + ' ON THE MAP'));
    list.slice(0, 25).forEach(function (x) {
      var onMap = mappable(x.place);
      var row = el('div', 'display:flex;gap:6px;align-items:flex-start;padding:4px 0;border-bottom:1px solid var(--bdr,#1c222d);cursor:' + (onMap ? 'pointer' : 'default'));
      row.appendChild(el('span', 'flex:0 0 8px;height:8px;margin-top:4px;border-radius:50%;background:' + COLOR[x.sector]));
      var body = el('div', 'flex:1;min-width:0');
      body.appendChild(el('div', 'font-size:11px;line-height:1.3;color:var(--text-primary,#e6e9ee)', x.title));
      body.appendChild(el('div', muted + ';font-size:9px;margin-top:2px',
        day(x.published) + ' · ' + (!x.place ? 'place not named' : onMap ? placeName(x.place) : 'United States (no state named)') + (x.reports > 1 ? ' · ' + x.reports + ' reports' : '') + ' · ' + (x.source || '')));
      if (x.origin) body.appendChild(el('div', 'font-size:9px;margin-top:1px;color:' + originColor(x.origin.cc), originLine(x)));
      row.appendChild(body);
      var u = safeUrl(x.link);
      if (u) {
        var a = el('a', 'flex:0 0 auto;color:var(--text-tertiary,#8b93a7);text-decoration:none;font-size:11px', '↗');
        a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = 'Open the article';
        a.addEventListener('click', function (e) { e.stopPropagation(); });
        row.appendChild(a);
      }
      if (onMap) row.addEventListener('click', function () { flyTo(x); });
      hud.appendChild(row);
    });

    if (data.advisories && data.advisories.length) {
      hud.appendChild(el('div', 'font:600 9px monospace;letter-spacing:.08em;' + muted + ';margin:10px 0 4px', 'CISA ADVISORIES (NATIONAL, NOT MAPPED)'));
      data.advisories.slice(0, 4).forEach(function (a) {
        var u = safeUrl(a.link);
        var row = el(u ? 'a' : 'div', 'display:block;font-size:10px;line-height:1.3;padding:3px 0;color:var(--text-secondary,#aab1c2);text-decoration:none', day(a.published) + ' · ' + a.title);
        if (u) { row.href = u; row.target = '_blank'; row.rel = 'noopener noreferrer'; }
        hud.appendChild(row);
      });
    }
    hud.appendChild(el('div', muted + ';font-size:9px;line-height:1.4;margin-top:8px',
      'Pins come from reported incidents only, placed from the article text at county, town, state or country level. A faint ring means only the state or country is known. Stories that name no place, or only "the US", are listed, not mapped. Lines run only where a report names the attacker.'));
  }

  // ── load ───────────────────────────────────────────────────
  function fetchData() {
    return fetch(ENDPOINT).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.j || !Array.isArray(res.j.incidents)) throw new Error('bad response');
        if (!res.ok && !res.j.incidents.length) throw new Error(res.j.error || 'feed error');
        data = res.j;
      })
      .catch(function (e) { if (!data) data = { error: String(e && e.message || e), incidents: [], advisories: [] }; });
  }

  function load(viewer, entities, on) {
    V = viewer; ents = entities;
    if (typeof on === 'function') isOn = on;
    panel();
    return fetchData().then(function () {
      draw();
      if (timer) clearTimeout(timer);
      window._cyberRefreshTimer = timer = setTimeout(function () { if (isOn()) load(V, ents); }, REFRESH_MS);
      var placed = data && data.incidents ? visible().filter(function (x) { return mappable(x.place); }).length : 0;
      return placed;
    });
  }

  window.BDOCCyberMap = {
    load: load,
    clear: function () { clearMap(); if (timer) clearTimeout(timer); timer = null; },
    // The newest reported incident (for the news ticker), or null before the layer has loaded.
    latest: function () {
      if (!data || !data.incidents || !data.incidents.length) return null;
      return data.incidents.slice().sort(function (a, b) { return Date.parse(b.latest || b.published) - Date.parse(a.latest || a.published); })[0];
    },
    // Incidents in one sector reported in the last N hours (used by the cross-layer checks).
    recent: function (sector, hours) {
      if (!data || !data.incidents) return [];
      var since = Date.now() - hours * 3600e3;
      return data.incidents.filter(function (x) { return x.sector === sector && Date.parse(x.latest || x.published) >= since; });
    },
    state: function () { return { prefs: prefs, incidents: data ? data.incidents.length : 0, pins: counts.pins, arcs: counts.arcs, origins: counts.origins, error: data && data.error }; }
  };
})();
