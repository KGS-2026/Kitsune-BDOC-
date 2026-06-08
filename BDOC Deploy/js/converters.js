// ============================================================
// BDOC PHASE 2 MODULE: converters.js
// Pure formatters: coordinates (DMS/DM/decimal), elevation, big numbers
// Extracted from index.html (Turn 4, 2026-04-22):
//   - toDMS / toDM / formatCoord / formatElev   (was lines 6211-6231)
//   - formatTrillion / formatDollars            (was lines 8628-8634)
// Depends on (defined in main inline script):
//   BDOC_Settings.coordFormat   ('dms' | 'dm' | 'dd')
//   BDOC_Settings.units         ('metric' | 'imperial' | 'nautical')
// All functions are top-level `function` declarations -> auto-hoisted to window.
// Cross-script lexical resolution: BDOC_Settings is `const` in the inline
// script; classic scripts share the global lexical environment, so bare-name
// reference resolves at call time (all callers are async — safe).
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
// ═══ COORDINATE / ELEVATION FORMATTERS ═══
// DMS formatter
function toDMS(deg,isLat){
  const abs=Math.abs(deg);const d=Math.floor(abs);const mf=(abs-d)*60;const m=Math.floor(mf);const s=((mf-m)*60).toFixed(1);
  const dir=isLat?(deg>=0?'N':'S'):(deg>=0?'E':'W');
  return d+'°'+String(m).padStart(2,'0')+"'"+String(s).padStart(4,'0')+'"'+dir;
}
function toDM(deg,isLat){
  const abs=Math.abs(deg);const d=Math.floor(abs);const m=((abs-d)*60).toFixed(3);
  const dir=isLat?(deg>=0?'N':'S'):(deg>=0?'E':'W');
  return d+'°'+m+"'"+dir;
}
function formatCoord(deg,isLat){
  const fmt=BDOC_Settings.coordFormat;
  if(fmt==='dd')return deg.toFixed(6)+'°';
  if(fmt==='dm')return toDM(deg,isLat);
  return toDMS(deg,isLat);
}
function formatElev(m){
  if(BDOC_Settings.units==='imperial')return(m*3.28084).toFixed(0)+' ft';
  if(BDOC_Settings.units==='nautical')return(m*3.28084).toFixed(0)+' ft';
  return m.toFixed(0)+' m';
}
// ═══ BIG-NUMBER FORMATTERS ═══
function formatTrillion(n){
  if(n>=1e12)return(n/1e12).toFixed(3)+'T';
  if(n>=1e9)return(n/1e9).toFixed(2)+'B';
  if(n>=1e6)return(n/1e6).toFixed(1)+'M';
  return n.toLocaleString();
}
function formatDollars(n){return'$'+formatTrillion(n)}
