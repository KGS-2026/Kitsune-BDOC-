// ============================================================
// BDOC MODULE: nuke-sim.js — NUCLEAR DETONATION EFFECTS SIMULATOR
// NUKEMAP-style effect rings + fallout plume + shelter-in-range overlay.
// Lazy-loaded on first "Detonate Here" (right-click) or "nuke" chat command.
//
// EFFECTS MODEL: public Glasstone & Dolan scaling laws (cube-root for blast
// overpressure: r ∝ Y^1/3), anchored to NUKEMAP's published 350 kt values so
// the rings match NUKEMAP at 350 kt and scale correctly for other yields.
// This is an EFFECTS visualizer for civil-defense / preparedness — the same
// public modeling NUKEMAP uses. Values are labeled estimates.
//
// Depends on (resolved lazily at call time):
//   V (Cesium.Viewer), Cesium, esc, af, msg, layers, falloutEnts
//   EventLog (js/telemetry.js)
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
var nukeSimEnts = [];
var _nukeYield = 300;       // last-used yield (kt)
var _nukeSurface = false;   // surface burst → local fallout; airburst → negligible

// MODERN OPERATIONAL WARHEADS ONLY — current deployed arsenals (FAS/SIPRI public
// yield estimates). Historical/test devices (Little Boy 15kt, Tsar Bomba 50Mt) are
// intentionally excluded — they're not in any active arsenal and aren't a real threat.
// Yields are the same public figures NUKEMAP uses; this just scales the visualization.
var _NUKE_PRESETS = {
  'w76-2':{kt:8,   name:'W76-2',     info:'US low-yield Trident SLBM'},
  'b61':  {kt:50,  name:'B61-12',    info:'US variable-yield gravity bomb'},
  'b61-12':{kt:50, name:'B61-12',    info:'US variable-yield gravity bomb'},
  'w76':  {kt:90,  name:'W76-1',     info:'US Trident SLBM (most deployed)'},
  'w76-1':{kt:90,  name:'W76-1',     info:'US Trident SLBM (most deployed)'},
  'df-41':{kt:250, name:'DF-41',     info:'China road-mobile ICBM'},
  'df41': {kt:250, name:'DF-41',     info:'China road-mobile ICBM'},
  'w87':  {kt:300, name:'W87',       info:'US Minuteman III / Sentinel ICBM'},
  'w78':  {kt:335, name:'W78',       info:'US Minuteman III ICBM'},
  'w88':  {kt:455, name:'W88',       info:'US Trident D5 (max US SLBM)'},
  'yars': {kt:500, name:'RS-24 Yars',info:'Russia MIRV ICBM'},
  'rs-24':{kt:500, name:'RS-24 Yars',info:'Russia MIRV ICBM'},
  'sarmat':{kt:750,name:'RS-28 Sarmat',info:'Russia heavy ICBM (per-warhead est.)'},
};
// Resolve a number OR a warhead name to {kt, label}
function _resolveYield(tok){
  if(typeof tok==='number') return {kt:tok, label:null};
  const k=String(tok||'').toLowerCase().trim();
  if(_NUKE_PRESETS[k]) return {kt:_NUKE_PRESETS[k].kt, label:_NUKE_PRESETS[k].name+' — '+_NUKE_PRESETS[k].info};
  const n=parseFloat(k.replace(/[^0-9.]/g,''));
  return {kt:(isFinite(n)&&n>0)?n:300, label:null};
}

// Effect rings. radius350 = radius (km) at 350 kt from NUKEMAP; exp = yield scaling exponent.
// Blast uses 1/3 (physically exact). Thermal ~0.41, radiation ~0.19, fireball ~0.4.
const _NUKE_EFFECTS = [
  { key:'thermal1', label:'1st-degree burns',      radius350:14.1,  exp:0.41, color:'#ffd27f', fill:0.05 },
  { key:'blast1',   label:'Light blast (1 psi)',   radius350:13.93, exp:0.3333, color:'#4A9EFF', fill:0.05 },
  { key:'thermal3', label:'3rd-degree burns',      radius350:7.68,  exp:0.41, color:'#ff9933', fill:0.07 },
  { key:'blast5',   label:'Moderate blast (5 psi)',radius350:4.96,  exp:0.3333, color:'#E8B339', fill:0.10 },
  { key:'blast20',  label:'Heavy blast (20 psi)',  radius350:2.62,  exp:0.3333, color:'#ff6600', fill:0.12 },
  { key:'rad',      label:'Radiation (100 rem)',   radius350:1.30,  exp:0.19, color:'#3FB950', fill:0.14 },
  { key:'fireball', label:'Fireball',              radius350:0.698, exp:0.40, color:'#ff2200', fill:0.45 },
];

function _nukeRadiusKm(eff, yieldKt){
  return eff.radius350 * Math.pow(yieldKt / 350, eff.exp);
}
// Haversine distance (km) between two lat/lon points
function _nukeDistKm(lat1, lon1, lat2, lon2){
  const R=6371, toR=Math.PI/180;
  const dLat=(lat2-lat1)*toR, dLon=(lon2-lon1)*toR;
  const a=Math.sin(dLat/2)**2 + Math.cos(lat1*toR)*Math.cos(lat2*toR)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(a)));
}
// Destination lat/lon given start, bearing (deg), distance (km)
function _nukeDest(lat, lon, bearingDeg, distKm){
  const R=6371, toR=Math.PI/180, toD=180/Math.PI;
  const br=bearingDeg*toR, dr=distKm/R, lat1=lat*toR, lon1=lon*toR;
  const lat2=Math.asin(Math.sin(lat1)*Math.cos(dr)+Math.cos(lat1)*Math.sin(dr)*Math.cos(br));
  const lon2=lon1+Math.atan2(Math.sin(br)*Math.sin(dr)*Math.cos(lat1), Math.cos(dr)-Math.sin(lat1)*Math.sin(lat2));
  return { lat:lat2*toD, lon:((lon2*toD)+540)%360-180 };
}

// 3D MUSHROOM CLOUD (NUKEMAP3D-style) — size-accurate scale model.
// Cloud dims (km) at 350 kt from NUKEMAP, scaled by mild exponents (cloud
// dimensions scale weakly with yield). Built from Cesium primitives so no
// external model assets are needed and it works on any globe.
function _cloudDims(yieldKt){
  const s=(v,e)=>v*Math.pow(yieldKt/350,e);
  const topAlt=Math.max(1.2, s(16.25,0.21));   // cloud top altitude
  const capRH =Math.max(0.4, s(8.90,0.31));    // cap horizontal radius
  const capH  =Math.max(0.6, s(8.16,0.25));    // cap (head) height
  const capRV =capH/2;
  const capBase=Math.max(0.5, topAlt-capH);
  const capCenter=capBase+capRV;
  const stemR=Math.max(0.3, capRH*0.22);
  return {topAlt,capRH,capRV,capBase,capCenter,stemR};
}
function _buildMushroomCloud(lon,lat,d,yieldKt){
  const km=1000;
  // Stem — cylinder from ground up to cap base (axis is vertical by default)
  nukeSimEnts.push(V.entities.add({
    position:Cesium.Cartesian3.fromDegrees(lon,lat,(d.capBase/2)*km),
    cylinder:{length:d.capBase*km, topRadius:d.stemR*0.85*km, bottomRadius:d.stemR*km,
      material:Cesium.Color.fromCssColorString('#cfc8ba').withAlpha(0.42), outline:false},
    show:true
  }));
  // Cap — flattened ellipsoid mushroom head
  nukeSimEnts.push(V.entities.add({
    position:Cesium.Cartesian3.fromDegrees(lon,lat,d.capCenter*km),
    ellipsoid:{radii:new Cesium.Cartesian3(d.capRH*km,d.capRH*km,d.capRV*km),
      material:Cesium.Color.fromCssColorString('#e8e4d8').withAlpha(0.50), outline:false},
    description:`<div style="font-family:'JetBrains Mono',monospace;padding:10px;color:#c8ccd6;background:#0d1117;border:1px solid #e8e4d8">
      <div style="font-size:12px;font-weight:700;color:#e8e4d8;margin-bottom:6px">MUSHROOM CLOUD</div>
      <div style="font-size:10px">Top altitude: <b>${d.topAlt.toFixed(1)} km</b> (${(d.topAlt*0.621371).toFixed(1)} mi)</div>
      <div style="font-size:10px">Cap radius: <b>${d.capRH.toFixed(1)} km</b></div>
      <div style="font-size:8px;color:#6e7681;margin-top:6px">Size-accurate scale model — tilt the view to gauge its height vs. the city below</div></div>`,
    show:true
  }));
  // Fireball glow rising at ground zero
  const fbR=0.698*Math.pow(yieldKt/350,0.4);
  nukeSimEnts.push(V.entities.add({
    position:Cesium.Cartesian3.fromDegrees(lon,lat,fbR*km),
    ellipsoid:{radii:new Cesium.Cartesian3(fbR*km,fbR*km,fbR*km),
      material:Cesium.Color.fromCssColorString('#ff6a00').withAlpha(0.75), outline:false},
    show:true
  }));
}

function clearNukeSim(){
  if(V) nukeSimEnts.forEach(e=>{try{V.entities.remove(e)}catch(_){}});
  nukeSimEnts=[];
}

// Main entry: detonate at (lon,lat), yield kt. opts: {surface, windFromDeg, windMph}
function detonateNuke(lon, lat, yieldKt, opts){
  if(!V){af&&af('var(--rd)','Globe not ready');return;}
  opts=opts||{};
  const _r=_resolveYield(yieldKt);   // accepts a number OR a warhead name ("w87")
  yieldKt=Math.max(0.001, _r.kt);
  const presetLabel=_r.label;
  _nukeYield=yieldKt;
  _nukeSurface=!!opts.surface;
  clearNukeSim();

  // Draw rings largest → smallest so inner (brighter) rings sit on top
  const rings=_NUKE_EFFECTS.map(eff=>({eff, rKm:_nukeRadiusKm(eff,yieldKt)}))
                           .sort((a,b)=>b.rKm-a.rKm);
  rings.forEach(({eff,rKm})=>{
    const fillC=Cesium.Color.fromCssColorString(eff.color).withAlpha(eff.fill);
    const lineC=Cesium.Color.fromCssColorString(eff.color).withAlpha(0.55);
    nukeSimEnts.push(V.entities.add({
      position:Cesium.Cartesian3.fromDegrees(lon,lat),
      ellipse:{
        semiMajorAxis:rKm*1000, semiMinorAxis:rKm*1000,
        material:fillC, outline:true, outlineColor:lineC, outlineWidth:1.5,
        height:0, granularity:Cesium.Math.toRadians(1.0)
      },
      description:`<div style="font-family:'JetBrains Mono',monospace;padding:10px;color:#c8ccd6;background:#0d1117;border:1px solid ${eff.color}">
        <div style="font-size:12px;font-weight:700;color:${eff.color};margin-bottom:6px">${esc(eff.label)}</div>
        <div style="font-size:10px">Radius: <b>${rKm.toFixed(2)} km</b> (${(rKm*0.621371).toFixed(2)} mi)</div>
        <div style="font-size:10px;color:#8b949e">Yield: ${yieldKt.toLocaleString()} kt · ${_nukeSurface?'surface burst':'airburst'}</div>
        <div style="font-size:8px;color:#6e7681;margin-top:6px">Glasstone scaling — estimate</div></div>`,
      show:true
    }));
  });

  // Ground-zero marker
  nukeSimEnts.push(V.entities.add({
    position:Cesium.Cartesian3.fromDegrees(lon,lat),
    point:{pixelSize:9, color:Cesium.Color.fromCssColorString('#ff2200'), outlineColor:Cesium.Color.BLACK, outlineWidth:2, disableDepthTestDistance:5e6},
    label:{text:`☢ GROUND ZERO — ${yieldKt.toLocaleString()} kt`, font:'bold 11px JetBrains Mono', fillColor:Cesium.Color.fromCssColorString('#ff2200'), outlineColor:Cesium.Color.BLACK, outlineWidth:3, style:Cesium.LabelStyle.FILL_AND_OUTLINE, verticalOrigin:Cesium.VerticalOrigin.BOTTOM, pixelOffset:new Cesium.Cartesian2(0,-14), disableDepthTestDistance:5e6},
    show:true
  }));

  // 3D MUSHROOM CLOUD — the NUKEMAP3D revival. Only in 3D scene mode.
  const cloud=_cloudDims(yieldKt);
  const is3D=V.scene.mode===Cesium.SceneMode.SCENE3D;
  if(is3D) _buildMushroomCloud(lon,lat,cloud,yieldKt);

  // Fallout plume — surface bursts only (airburst = negligible local fallout, per NUKEMAP)
  let plumeKm=0;
  if(_nukeSurface){
    const windFrom = (opts.windFromDeg!=null)?opts.windFromDeg:225;   // wind blows FROM this bearing
    const downwind = (windFrom+180)%360;                              // plume extends toward here
    // Simplified WSEG-style plume length: scales ~Y^0.5; widened by stronger wind. Approximate.
    const windMph = (opts.windMph!=null)?opts.windMph:15;
    plumeKm = 38*Math.pow(yieldKt/350,0.5)*(0.6+windMph/37.5);
    const halfWidth = plumeKm*0.16;
    const tip=_nukeDest(lat,lon,downwind,plumeKm);
    const lWide=_nukeDest(lat,lon,(downwind-90+360)%360,halfWidth);
    const rWide=_nukeDest(lat,lon,(downwind+90)%360,halfWidth);
    const midL=_nukeDest(lWide.lat,lWide.lon,downwind,plumeKm*0.55);
    const midR=_nukeDest(rWide.lat,rWide.lon,downwind,plumeKm*0.55);
    const ring=[lon,lat, lWide.lon,lWide.lat, midL.lon,midL.lat, tip.lon,tip.lat, midR.lon,midR.lat, rWide.lon,rWide.lat];
    nukeSimEnts.push(V.entities.add({
      polygon:{
        hierarchy:Cesium.Cartesian3.fromDegreesArray(ring),
        material:Cesium.Color.fromCssColorString('#c8ff00').withAlpha(0.13),
        outline:true, outlineColor:Cesium.Color.fromCssColorString('#c8ff00').withAlpha(0.5), height:0
      },
      description:`<div style="font-family:'JetBrains Mono',monospace;padding:10px;color:#c8ccd6;background:#0d1117;border:1px solid #c8ff00">
        <div style="font-size:12px;font-weight:700;color:#c8ff00;margin-bottom:6px">FALLOUT PLUME (approximate)</div>
        <div style="font-size:10px">Downwind reach: <b>~${plumeKm.toFixed(0)} km</b></div>
        <div style="font-size:10px;color:#8b949e">Wind ${windMph} mph from ${windFrom}° → drifting ${downwind}°</div>
        <div style="font-size:8px;color:#6e7681;margin-top:6px">Simplified plume — direction/scale approximate, not a dose prediction</div></div>`,
      show:true
    }));
  }

  // Fallout-shelter overlay: how many shelters fall inside the largest blast ring?
  const outerKm=rings[0].rKm;
  let shelterMsg='';
  if(typeof falloutEnts!=='undefined' && falloutEnts.length){
    let inRange=0;
    falloutEnts.forEach(e=>{
      try{
        const c=e.position&&e.position.getValue&&e.position.getValue(V.clock.currentTime);
        if(!c)return;
        const carto=Cesium.Cartographic.fromCartesian(c);
        const slat=Cesium.Math.toDegrees(carto.latitude), slon=Cesium.Math.toDegrees(carto.longitude);
        if(_nukeDistKm(lat,lon,slat,slon)<=outerKm) inRange++;
      }catch(_){}
    });
    shelterMsg = inRange>0
      ? `<br><b style="color:#FFD700">☢ ${inRange} fallout shelter${inRange>1?'s':''}</b> inside the ${outerKm.toFixed(0)} km effect zone.`
      : `<br><span style="color:#8b949e">No loaded fallout shelters within the effect zone.</span>`;
  }else{
    shelterMsg = `<br><span style="color:#8b949e">Tip: enable the <b>Fallout Shelters</b> layer to see which shelters fall in range.</span>`;
  }

  // Effect summary to chat
  const fmt=km=>`${km.toFixed(2)} km / ${(km*0.621371).toFixed(2)} mi`;
  const rows=_NUKE_EFFECTS.map(eff=>`<tr><td style="padding:2px 8px 2px 0;color:${eff.color}">${esc(eff.label)}</td><td style="color:#c8ccd6">${fmt(_nukeRadiusKm(eff,yieldKt))}</td></tr>`).join('');
  if(typeof msg==='function'){
    msg('sy',`<b style="color:#ff2200">☢ NUCLEAR DETONATION — ${yieldKt.toLocaleString()} kt ${_nukeSurface?'surface burst':'airburst'}</b><br>`+
      (presetLabel?`<span style="font-size:9px;color:#E8B339">${esc(presetLabel)}</span><br>`:'')+
      `<span style="font-size:9px;color:#8b949e">${lat.toFixed(4)}°, ${lon.toFixed(4)}°</span>`+
      `<table style="font-size:10px;margin-top:8px;border-collapse:collapse">${rows}`+
      (is3D?`<tr><td style="padding:2px 8px 2px 0;color:#e8e4d8">Mushroom cloud top</td><td style="color:#c8ccd6">${cloud.topAlt.toFixed(1)} km / ${(cloud.topAlt*0.621371).toFixed(1)} mi</td></tr>`:'')+
      (plumeKm>0?`<tr><td style="padding:2px 8px 2px 0;color:#c8ff00">Fallout plume</td><td style="color:#c8ccd6">~${plumeKm.toFixed(0)} km downwind</td></tr>`:'')+
      `</table>${shelterMsg}`+
      `<br><span style="font-size:8px;color:#6e7681">${is3D?'Tilt the view (middle-drag) to see the 3D cloud. ':''}Effect radii are Glasstone-scaling estimates. Type <b>clear nuke</b> to remove.</span>`);
  }
  if(typeof af==='function') af('#ff2200',`Detonation: ${yieldKt.toLocaleString()} kt — ${_NUKE_EFFECTS.length} effect rings plotted`);
  if(typeof EventLog!=='undefined') EventLog.add('warn',`Nuke sim: ${yieldKt} kt ${_nukeSurface?'surface':'air'} at ${lat.toFixed(2)},${lon.toFixed(2)}`);

  // NUKEMAP3D moment: tilt the camera to an oblique vantage that frames both the
  // ground rings and the rising cloud. Skipped if opts.flyTo===false.
  if(is3D && opts.flyTo!==false){
    try{
      const frameKm=Math.max(outerKm, cloud.topAlt)*1.15;
      const sphere=new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon,lat,(cloud.topAlt*0.45)*1000), frameKm*1000);
      V.camera.flyToBoundingSphere(sphere,{
        offset:new Cesium.HeadingPitchRange(Cesium.Math.toRadians(25), Cesium.Math.toRadians(-28), frameKm*3000),
        duration:2.2
      });
    }catch(_){}
  }
}

// Expose for inline shell + chat commands
window.detonateNuke=detonateNuke;
window.clearNukeSim=clearNukeSim;
window._NUKE_PRESETS=_NUKE_PRESETS;
