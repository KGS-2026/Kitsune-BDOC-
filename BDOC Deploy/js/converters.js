// ============================================================
// BDOC PHASE 2 MODULE: converters.js
// Pure formatters: coordinates (DMS/DM/decimal), elevation, big numbers
// Extracted from index.html (Turn 4, 2026-04-22):
//   - toDMS / toDM / formatCoord / formatElev   (was lines 6211-6231)
//   - formatTrillion / formatDollars            (was lines 8628-8634)
// Depends on (defined in main inline script):
//   BDOC_Settings.coordFormat   ('dms' | 'dm' | 'dd' | 'mgrs'), BDOC_Settings.mgrsDigits (6|8|10)
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
  // P156g: round to 0.1" first and carry, so 59.96" reads 0.0" of the next minute, not 60.0"
  const abs=Math.abs(deg);const t=Math.round(abs*36000);   // tenths of an arc-second
  const d=Math.floor(t/36000),m=Math.floor((t%36000)/600),s=((t%600)/10).toFixed(1);
  const dir=isLat?(deg>=0?'N':'S'):(deg>=0?'E':'W');
  return d+'°'+String(m).padStart(2,'0')+"'"+String(s).padStart(4,'0')+'"'+dir;
}
function toDM(deg,isLat){
  const abs=Math.abs(deg);const t=Math.round(abs*60000);   // thousandths of an arc-minute (same carry fix)
  const d=Math.floor(t/60000),m=((t%60000)/1000).toFixed(3);
  const dir=isLat?(deg>=0?'N':'S'):(deg>=0?'E':'W');
  return d+'°'+m+"'"+dir;
}
function formatCoord(deg,isLat){
  const fmt=BDOC_Settings.coordFormat;
  if(fmt==='dd')return deg.toFixed(6)+'°';
  // P156g: in MGRS mode the grid itself is in the MGRS field; lat/lon stay as plain decimals
  if(fmt==='mgrs')return deg.toFixed(5)+'°';
  if(fmt==='dm')return toDM(deg,isLat);
  return toDMS(deg,isLat);
}
// ═══ P156g: MGRS — display at the operator's precision, and parse typed grids ═══
// Spaced the way a grid is read on a radio: "16S GC 39708 34977". digits = total numeric
// digits (6 = 100 m, 8 = 10 m, 10 = 1 m); default from Settings → Coordinates.
// latLonToMGRS() (index.html) is the encoder: verified against the `mgrs` library.
function formatMGRS(lat,lon,digits){
  const d=digits||(BDOC_Settings&&BDOC_Settings.mgrsDigits)||8;
  const p=Math.max(1,Math.min(5,Math.round(d/2)));
  if(typeof latLonToMGRS!=='function')return '';
  const g=latLonToMGRS(lat,lon,p);
  const m=/^(\d{2}[C-X])([A-Z]{2})(\d+)$/.exec(g);
  if(!m)return g==='UPS'?'UPS (polar — no MGRS)':g;
  const h=m[3].length/2;
  return m[1]+' '+m[2]+' '+m[3].slice(0,h)+' '+m[3].slice(h);
}
// Inverse of latLonToMGRS. Accepts lowercase, spaces, a leading-zero-less zone and 0–10
// digits ("16SGC3970834977", "16s gc 39708 34977", "4QFJ 1823 5688", "16SGC"). Returns the
// CENTRE of the square at that precision as {lat,lon,precision}, or null if it isn't a grid.
// Same lettering scheme as the encoder; band minimum-northing table as in proj4js/mgrs.
function parseMGRS(input){
  const s=String(input||'').toUpperCase().replace(/\s+/g,'');
  const m=/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d{0,10})$/.exec(s);
  if(!m)return null;
  const zone=+m[1];if(zone<1||zone>60)return null;
  const band=m[2],digits=m[5];
  if(digits.length%2)return null;
  const half=digits.length/2,unit=half?Math.pow(10,5-half):100000;
  const e=half?parseInt(digits.slice(0,half),10)*unit:0,n=half?parseInt(digits.slice(half),10)*unit:0;
  const set=(zone-1)%6;
  const ci=['ABCDEFGH','JKLMNPQR','STUVWXYZ'][set%3].indexOf(m[3]);if(ci<0)return null;
  const ri='ABCDEFGHJKLMNPQRSTUV'.indexOf(m[4]);if(ri<0)return null;
  const MIN={C:1100000,D:2000000,E:2800000,F:3700000,G:4600000,H:5500000,J:6400000,K:7300000,L:8200000,M:9100000,
    N:0,P:800000,Q:1700000,R:2600000,S:3500000,T:4400000,U:5300000,V:6200000,W:7000000,X:7900000};
  let n100k=((ri-(set%2===0?0:5))%20+20)%20*100000;
  while(n100k<MIN[band])n100k+=2000000;
  const easting=(ci+1)*100000+e+unit/2,northing=n100k+n+unit/2;
  // UTM → geographic (WGS-84)
  const a=6378137,e2=0.00669437999014,k0=0.9996,ep2=e2/(1-e2);
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const x=easting-500000,y=band<'N'?northing-10000000:northing;
  const mu=(y/k0)/(a*(1-e2/4-3*e2*e2/64-5*e2*e2*e2/256));
  const phi1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1*e1/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu);
  const sp=Math.sin(phi1),cp=Math.cos(phi1),tp=Math.tan(phi1);
  const N1=a/Math.sqrt(1-e2*sp*sp),T1=tp*tp,C1=ep2*cp*cp,R1=a*(1-e2)/Math.pow(1-e2*sp*sp,1.5),D=x/(N1*k0);
  const lat=(phi1-(N1*tp/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24+(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720))*180/Math.PI;
  const lon=(zone-1)*6-180+3+((D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120)/cp)*180/Math.PI;
  // the decoded point must sit in (or right at the edge of) its latitude band
  const bi='CDEFGHJKLMNPQRSTUVWX'.indexOf(band),bLo=-80+8*bi,bHi=band==='X'?84:bLo+8;
  const slack=unit>=100000?3:1;   // a bare 100 km square's centre can sit past the band edge
  if(!(lat>=bLo-slack&&lat<=bHi+slack))return null;
  return {lat,lon:((lon+540)%360)-180,precision:unit};   // squares on the 180° meridian wrap
}
// Search-box helper: an MGRS grid or "lat, lon" decimal pair → {lat,lon,label,precision}.
function parseCoordQuery(q){
  const g=parseMGRS(q);
  if(g)return {lat:g.lat,lon:g.lon,precision:g.precision,label:'GRID '+formatMGRS(g.lat,g.lon,Math.max(2,10-2*Math.round(Math.log10(g.precision))))};
  const d=/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(q||''));
  if(d){const lat=+d[1],lon=+d[2];if(Math.abs(lat)<=90&&Math.abs(lon)<=180)return {lat,lon,precision:10,label:lat.toFixed(5)+', '+lon.toFixed(5)}}
  return null;
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
