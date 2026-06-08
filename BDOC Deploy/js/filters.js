// ═══════════════════════════════════════════════════════════
// BDOC PHASE 2 MODULE: filters.js
// Visual filter toggle: CRT phosphor / NVG night-vision / FLIR thermal
// Extracted from index.html lines 1945-2047 (Turn 1, 2026-04-22)
// Depends on (defined in main inline script, loads first):
//   V (Cesium.Viewer), Cesium, EventLog, af()
// © 2026 Kitsune Global Solutions LLC
// ═══════════════════════════════════════════════════════════
// ═══ VISUAL FILTER TOGGLE ═══
let activeFilter=null;
let _flirTempInterval=null;
let _nvgGainInterval=null;
function togFilter(f,btn){
  // Clear all filter states
  document.body.classList.remove('filter-nvg','filter-flir','filter-crt');
  document.getElementById('vfxCrt').classList.remove('on');
  document.querySelectorAll('.fb').forEach(b=>b.classList.remove('a'));
  if(_flirTempInterval){clearInterval(_flirTempInterval);_flirTempInterval=null}
  if(_nvgGainInterval){clearInterval(_nvgGainInterval);_nvgGainInterval=null}
  const _nvgCes=document.getElementById('cesiumContainer');
  if(_nvgCes)_nvgCes.style.filter='';
  const _nvgBw=document.getElementById('nvgBloomWarn');if(_nvgBw)_nvgBw.style.display='none';

  if(activeFilter===f){
    activeFilter=null;
    if(V&&V.scene){
      V.scene.globe.enableLighting=true;
      V.scene.light=new Cesium.SunLight({intensity:2.0});
      // Restore globe minimumBrightness to default (may have been raised for NVG night mode)
      try{V.scene.globe.minimumBrightness=0.02}catch(_){}
      if(window._cityLightsLayer){window._cityLightsLayer.dayAlpha=0.0;window._cityLightsLayer.nightAlpha=0.9;window._cityLightsLayer.brightness=2.2}
      if(window._nightEarthLayer){window._nightEarthLayer.dayAlpha=0.0;window._nightEarthLayer.nightAlpha=0.6}
    }
    af('var(--t3)','Visual filter disengaged \u2014 normal mode');
    EventLog.add('info','Filter: OFF (normal mode)');return
  }
  activeFilter=f;if(btn)btn.classList.add('a');

  if(f==='crt'){
    document.body.classList.add('filter-crt');
    document.getElementById('vfxCrt').classList.add('on');
    af('var(--kf)','CRT MONITOR \u2014 Phosphor scanline emulation active');
    EventLog.add('info','Filter: CRT phosphor monitor');
  } else if(f==='nvg'){
    document.body.classList.add('filter-nvg');
    document.getElementById('vfxCrt').classList.add('on');
    if(V&&V.scene){
      V.scene.globe.enableLighting=true;
      V.scene.light=new Cesium.SunLight({intensity:0.05});
      if(window._cityLightsLayer){window._cityLightsLayer.dayAlpha=0.4;window._cityLightsLayer.nightAlpha=1.0;window._cityLightsLayer.brightness=3.5;window._cityLightsLayer.contrast=2.5}
      if(window._nightEarthLayer){window._nightEarthLayer.dayAlpha=0.15;window._nightEarthLayer.nightAlpha=0.9}
    }
    // Dynamic gain: adjust brightness based on sun angle at camera position
    function _nvgUpdateGain(){
      if(!V||!V.scene)return;
      const camCarto=V.camera.positionCartographic;
      const lat=Cesium.Math.toDegrees(camCarto.latitude);
      const lon=Cesium.Math.toDegrees(camCarto.longitude);
      // Compute sun position
      const sunPos=Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(V.clock.currentTime);
      const sunCart=Cesium.Cartesian3.clone(sunPos);
      // Transform from inertial to fixed frame
      const icrfToFixed=Cesium.Transforms.computeIcrfToFixedMatrix(V.clock.currentTime);
      if(icrfToFixed)Cesium.Matrix3.multiplyByVector(icrfToFixed,sunPos,sunCart);
      const sunCarto=Cesium.Cartographic.fromCartesian(sunCart);
      const sunLat=Cesium.Math.toDegrees(sunCarto.latitude);
      const sunLon=Cesium.Math.toDegrees(sunCarto.longitude);
      // Approximate sun elevation angle using spherical geometry
      const dLon=(sunLon-lon)*Math.PI/180;
      const sLat1=lat*Math.PI/180,sLat2=sunLat*Math.PI/180;
      const sinAlt=Math.sin(sLat1)*Math.sin(sLat2)+Math.cos(sLat1)*Math.cos(sLat2)*Math.cos(dLon);
      const sunAngle=Math.asin(Math.max(-1,Math.min(1,sinAlt)))*180/Math.PI;
      const ces=document.getElementById('cesiumContainer');
      const bw=document.getElementById('nvgBloomWarn');
      if(!ces)return;
      if(sunAngle<-6){
        // Full dark — raise globe minimumBrightness so CSS brightness(3.5) has something to amplify.
        // Without this, globe renders near-black (0.02) and 3.5× of near-black is still near-black.
        try{if(V&&V.scene&&V.scene.globe)V.scene.globe.minimumBrightness=0.28;}catch(_){}
        ces.style.filter='saturate(0) brightness(3.5) contrast(1.4) sepia(1) hue-rotate(60deg) saturate(8)';
        if(bw)bw.style.display='none';
      }else if(sunAngle<=10){
        try{if(V&&V.scene&&V.scene.globe)V.scene.globe.minimumBrightness=0.15;}catch(_){}
        ces.style.filter='saturate(0) brightness(1.8) contrast(1.2) sepia(1) hue-rotate(60deg) saturate(5)';
        if(bw)bw.style.display='none';
      }else{
        // Daytime with NVG — bloom warning, keep normal brightness floor
        try{if(V&&V.scene&&V.scene.globe)V.scene.globe.minimumBrightness=0.02;}catch(_){}
        ces.style.filter='saturate(0) brightness(0.4) contrast(2) sepia(1) hue-rotate(60deg) saturate(10)';
        if(bw)bw.style.display='block';
      }
    }
    _nvgUpdateGain();
    _nvgGainInterval=setInterval(_nvgUpdateGain,500);
    af('#00ff44','NVG ENGAGED \u2014 AN/PVS-31A binocular night vision simulation \u2014 dynamic gain active');
    EventLog.add('info','Filter: NVG \u2014 night vision engaged (dynamic gain)');
  } else if(f==='flir'){
    document.body.classList.add('filter-flir');
    if(V&&V.scene){V.scene.globe.enableLighting=false}
    // Simulate FLIR temp readout
    const tempEl=document.getElementById('flir-temp');
    if(tempEl){
      _flirTempInterval=setInterval(()=>{
        const base=18+Math.random()*12;
        tempEl.textContent=base.toFixed(1)+'\u00B0C';
      },2000);
      tempEl.textContent=(18+Math.random()*12).toFixed(1)+'\u00B0C';
    }
    // Update zoom readout based on camera height
    const zoomEl=document.getElementById('flir-zoom');
    if(zoomEl&&V){
      const h=V.camera.positionCartographic?.height||10000000;
      const z=h<5000?'8.0x':h<50000?'4.0x':h<500000?'2.0x':'1.0x';
      zoomEl.textContent=z;
    }
    af('var(--yl)','FLIR ENGAGED \u2014 Forward Looking Infrared / WHOT thermal imaging');
    EventLog.add('info','Filter: FLIR thermal imaging');
  }
}
