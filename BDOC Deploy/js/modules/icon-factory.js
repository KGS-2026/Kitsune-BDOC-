/* BDOC Icon Factory — P116
 * Runtime-composited, memoized SVG data-URI markers. No sprite sheet, no PNG
 * requests, no build step. Technique from liveuamap recon (re-derived, original
 * artwork/palette). N glyphs x M factions x 2 states from a small string table,
 * cached. Grid-down safe: generated from a ~KB table, survives an offline PWA
 * cache with zero extra bytes and zero CDN fetches.
 *
 * Usage:
 *   BDOCIcons.url('fire', 1)              -> data: URI string (39px)
 *   BDOCIcons.url('fire', 1, true)        -> hover variant (49px halo)
 *   BDOCIcons.leaflet('quake', 2)         -> L.icon (if Leaflet present)
 *   BDOCIcons.billboard('outage', 3)      -> {image, width, height} for Cesium
 */
(function (root) {
  'use strict';

  // Faction / side palette — BDOC's own ramps (NOT lifted from any competitor).
  // sh = shadow disc, g0 = gradient top, g1 = gradient bottom, glyph = optional glyph tint.
  var FACTION = {
    0: { sh: '#1a2230', g0: '#3a4a63', g1: '#232d3d' },              // unknown / grey-blue
    1: { sh: '#5a1414', g0: '#e0492c', g1: '#a81818' },              // hostile / red
    2: { sh: '#123a5e', g0: '#2b8fe0', g1: '#1c5aa0' },              // friendly / blue
    3: { sh: '#2a2a2a', g0: '#5d5d5d', g1: '#3a3a3a' },              // neutral / grey
    4: { sh: '#145018', g0: '#4fae34', g1: '#0c7a18' },              // civil / green
    5: { sh: '#6a5a10', g0: '#ffc84d', g1: '#e0a020', glyph: '#3a2a00' }, // caution / amber
    6: { sh: '#4a1060', g0: '#b04de0', g1: '#7a1ca0' }               // special / violet
  };

  // Glyph bodies — 100x100 viewBox, drawn WHITE (#fff) so faction tint applies
  // via string substitution. Simple, legible, original geometry.
  var GLYPH = {
    'default': '<circle cx="50" cy="50" r="14" fill="#fff"/>',
    'fire':    '<path d="M50 24c6 10 16 14 16 26a16 16 0 0 1-32 0c0-6 3-9 6-13 1 5 4 7 7 7-4-8 3-14 3-20z" fill="#fff"/>',
    'quake':   '<path d="M24 50h10l6-16 8 32 8-40 8 40 6-16h10" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>',
    'outage':  '<path d="M54 22 30 54h16l-6 24 26-34H50z" fill="#fff"/>',
    'cyber':   '<path d="M50 26a24 24 0 1 0 0 48 24 24 0 0 0 0-48zm0 10a14 14 0 1 1 0 28 14 14 0 0 1 0-28z" fill="#fff"/><circle cx="50" cy="50" r="5" fill="#fff"/>',
    'strike':  '<path d="M32 32l36 36M68 32L32 68" stroke="#fff" stroke-width="8" stroke-linecap="round"/>',
    'storm':   '<path d="M34 44a12 12 0 0 1 24-2 10 10 0 0 1 2 20H36a12 12 0 0 1-2-18z" fill="#fff"/><path d="M50 60l-6 12h8l-4 10" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>',
    'air':     '<path d="M50 24l6 20 20 8-20 4-6 20-6-20-20-4 20-8z" fill="#fff"/>',
    'naval':   '<path d="M28 52h44l-6 16H34zM46 30h8v22h-8z" fill="#fff"/>',
    'nuke':    '<path d="M50 34a16 16 0 1 0 0 32 16 16 0 0 0 0-32zm0 6v10l9 5a10 10 0 0 0-9-15z" fill="#fff"/><circle cx="50" cy="50" r="4" fill="#fff"/>',
    'alert':   '<path d="M50 26l24 44H26z" fill="#fff"/><rect x="47" y="44" width="6" height="14" fill="#3a2a00"/><rect x="47" y="60" width="6" height="6" fill="#3a2a00"/>'
  };

  var HEADER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">';
  var _cache = new Map();

  function build(name, side, hover) {
    var key = name + '-' + side + (hover ? '_o' : '');
    var hit = _cache.get(key);
    if (hit) return hit;

    var F = FACTION[side] || FACTION[0];
    var g = GLYPH[name] || GLYPH['default'];
    if (F.glyph) g = g.split('#fff').join(F.glyph);

    var halo = hover
      ? '<circle cx="50" cy="50" r="49" fill="' + (side === 5 ? '#fff' : '#ffc600') + '" opacity="0.9"/>'
      : '';

    var svg = HEADER
      + halo
      // shadow disc (1px offset)
      + '<circle cx="51" cy="52" r="41.5" fill="' + F.sh + '"/>'
      // glossy body
      + '<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="50" y1="8.5" x2="50" y2="91.5">'
      + '<stop offset="0" stop-color="' + F.g0 + '"/><stop offset="1" stop-color="' + F.g1 + '"/></linearGradient></defs>'
      + '<circle cx="50" cy="50" r="41.5" fill="url(#g)"/>'
      + g
      + '</svg>';

    // utf8 data URI: ~25% smaller than base64, no btoa CPU cost
    var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    _cache.set(key, url);
    return url;
  }

  var API = {
    url: build,
    factions: FACTION,
    glyphs: GLYPH,
    cacheSize: function () { return _cache.size; },
    // Register a new glyph at runtime (white-fill 100x100 viewBox path/shape string)
    addGlyph: function (name, body) { GLYPH[name] = body; },
    leaflet: function (name, side, hover) {
      if (typeof L === 'undefined' || !L.icon) return null;
      var s = hover ? 49 : 39;
      return L.icon({
        className: name + '-' + side,
        iconUrl: build(name, side, hover),
        iconSize: [s, s],
        iconAnchor: [s / 2, s / 2]   // center-anchored: fans cleanly around clusters
      });
    },
    // Cesium billboard descriptor
    billboard: function (name, side, hover) {
      var s = hover ? 49 : 39;
      return { image: build(name, side, hover), width: s, height: s };
    }
  };

  root.BDOCIcons = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : this);
