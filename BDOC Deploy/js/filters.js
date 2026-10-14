// ═══════════════════════════════════════════════════════════
// BDOC PHASE 2 MODULE: filters.js
// Visual filter toggle: CRT phosphor / NVG night-vision / FLIR thermal
// Extracted from index.html lines 1945-2047 (Turn 1, 2026-04-22)
// Depends on (defined in main inline script, loads first):
//   V (Cesium.Viewer), Cesium, EventLog, af()
// © 2026 Kitsune Global Solutions LLC
// ═══════════════════════════════════════════════════════════
//
// P154 rewrite of NVG + FLIR (Travon bugs #2 and #5).
// Before: both modes were CSS filters stacked on the whole page — a 35% multiply
// overlay, a 28% black grid overlay, scanlines, and a scene light cut to 5%.
// Result: NVG too dim and nothing like a tube; FLIR inverted the sky to white,
// flipped every marker's colour, and drew a crosshair over the middle of the map.
// Now both are GPU post-process stages on the globe only (UI stays readable):
//   NVG  — image-intensifier model: gain → soft saturation (auto-brightness
//          control), highlight halo around lights, scintillation grain that rises
//          with gain, soft tube vignette, P43 green or P45 white phosphor.
//          Gain follows the real sun angle at the camera (night = high gain).
//   FLIR — heat estimated from the imagery (water/sky cold, vegetation mild,
//          bare ground/urban warm, emitters hot), slight thermal blur, palettes
//          WHOT / BHOT / IRONBOW. No reticle.
// ═══════════════════════════════════════════════════════════
// ═══ VISUAL FILTER TOGGLE ═══
let activeFilter=null;
let _flirTempInterval=null;
let _nvgGainInterval=null;
let _nvgStage=null,_flirStage=null,_flirZoomHook=null;
let _nvgUpdateGain=function(){};
const _FLIR_PALETTES=['WHOT','BHOT','IRONBOW'];
const _NVG_PHOSPHORS={P43:[0.36,1.0,0.42],P45:[0.86,0.94,1.0]};
function _lsGet(k,d){try{const v=localStorage.getItem(k);return v===null?d:v}catch(_){return d}}
function _lsSet(k,v){try{localStorage.setItem(k,v)}catch(_){}}
// ── NVG night-lights imagery (NASA Black Marble / Earth at Night, Ion asset 3812) ──
// Lazy-loaded on first NVG engage. dayAlpha/nightAlpha make Cesium blend it ONLY
// on the dark side of the terminator (requires globe.enableLighting=true), so city
// lights appear where it's actually night — a real sensor sim, not just a tint.
let _nvgNightLoading=null;
function _ensureNightLayer(){
  if(window._nightEarthLayer)return Promise.resolve(window._nightEarthLayer);
  if(_nvgNightLoading)return _nvgNightLoading;
  _nvgNightLoading=(async()=>{
    try{
      let layer;
      if(Cesium.ImageryLayer&&Cesium.ImageryLayer.fromProviderAsync&&Cesium.IonImageryProvider.fromAssetId){
        layer=Cesium.ImageryLayer.fromProviderAsync(Cesium.IonImageryProvider.fromAssetId(3812));
      }else{
        layer=new Cesium.ImageryLayer(new Cesium.IonImageryProvider({assetId:3812}));
      }
      layer.dayAlpha=0.0;   // invisible on the lit side
      layer.nightAlpha=0.0; // stays hidden until NVG engages
      layer.brightness=2.0;
      V.imageryLayers.add(layer); // top of stack — blends over basemap
      window._nightEarthLayer=layer;
      console.log('[NVG] Earth-at-Night imagery loaded (Ion 3812)');
      return layer;
    }catch(e){console.warn('[NVG] night imagery failed:',e.message);return null}
    finally{_nvgNightLoading=null}
  })();
  return _nvgNightLoading;
}

// ── GPU stages ─────────────────────────────────────────────
const _NVG_FS=`
uniform sampler2D colorTexture;
uniform float u_gain;
uniform float u_noise;
uniform float u_seed;
uniform float u_vignette;
uniform vec3 u_phosphor;
in vec2 v_textureCoordinates;
float _h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float _lum(vec3 c){return dot(c,vec3(0.299,0.587,0.114));}
void main(){
  vec2 uv=v_textureCoordinates;
  vec2 px=1.0/czm_viewport.zw;
  float L=_lum(texture(colorTexture,uv).rgb);
  // tube halo: bright sources bleed into their neighbourhood
  float halo=0.0;
  for(int i=0;i<8;i++){
    float a=float(i)*0.7853982;
    vec2 o=vec2(cos(a),sin(a))*px*7.0;
    halo+=max(_lum(texture(colorTexture,uv+o).rgb)-0.55,0.0);
  }
  halo*=0.125;
  // intensifier: gain then soft saturation (ABC keeps highlights from clipping)
  float I=1.0-exp(-(L*u_gain+halo*3.0));
  // scintillation — shot noise, stronger at high gain
  float n=(_h(uv*czm_viewport.zw+vec2(u_seed*97.0,u_seed*57.0))-0.5)*u_noise;
  I=clamp(I+n,0.0,1.0);
  // soft tube vignette
  vec2 d=(uv-0.5)*vec2(czm_viewport.z/czm_viewport.w,1.0);
  float vig=1.0-u_vignette*smoothstep(0.50,1.05,length(d));
  vec3 col=u_phosphor*(I*vig)+u_phosphor*0.03;
  out_FragColor=vec4(col,1.0);
}`;
const _FLIR_FS=`
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float u_palette;
uniform float u_seed;
in vec2 v_textureCoordinates;
float _h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float _heat(vec3 c){
  float L=dot(c,vec3(0.299,0.587,0.114));
  float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b));
  float sat=mx>0.001?(mx-mn)/mx:0.0;
  float water=smoothstep(0.02,0.16,c.b-max(c.r,c.g));
  float veg=smoothstep(0.01,0.12,c.g-max(c.r,c.b));
  float bare=(1.0-sat)*smoothstep(0.12,0.5,L)*(1.0-smoothstep(0.80,0.95,L));
  float cloud=smoothstep(0.78,0.95,L)*(1.0-sat);
  float emit=smoothstep(0.55,0.9,sat*mx)*(1.0-water);
  float t=0.34+0.42*bare+0.12*veg-0.30*water-0.48*cloud+0.22*L+0.55*emit;
  return clamp(t,0.0,1.0);
}
vec3 _iron(float t){
  vec3 c0=vec3(0.0),c1=vec3(0.12,0.0,0.42),c2=vec3(0.58,0.0,0.55),c3=vec3(0.93,0.24,0.06),c4=vec3(1.0,0.72,0.0),c5=vec3(1.0,1.0,0.86);
  if(t<0.2)return mix(c0,c1,t/0.2);
  if(t<0.4)return mix(c1,c2,(t-0.2)/0.2);
  if(t<0.6)return mix(c2,c3,(t-0.4)/0.2);
  if(t<0.8)return mix(c3,c4,(t-0.6)/0.2);
  return mix(c4,c5,(t-0.8)/0.2);
}
void main(){
  vec2 uv=v_textureCoordinates;
  vec2 px=1.0/czm_viewport.zw;
  // thermal sensors are soft — 5-tap blur of the heat field
  float t=_heat(texture(colorTexture,uv).rgb)*0.4;
  t+=_heat(texture(colorTexture,uv+vec2(px.x*1.5,0.0)).rgb)*0.15;
  t+=_heat(texture(colorTexture,uv-vec2(px.x*1.5,0.0)).rgb)*0.15;
  t+=_heat(texture(colorTexture,uv+vec2(0.0,px.y*1.5)).rgb)*0.15;
  t+=_heat(texture(colorTexture,uv-vec2(0.0,px.y*1.5)).rgb)*0.15;
  // contrast stretch — thermal AGC spreads the scene across the full grey scale
  t=smoothstep(0.18,0.84,t);
  // space and sky radiate cold
  if(texture(depthTexture,uv).r>=0.9999999)t=0.03;
  t=clamp(t+(_h(uv*czm_viewport.zw+u_seed*61.0)-0.5)*0.035,0.0,1.0);
  vec3 col;
  if(u_palette<0.5)col=vec3(t);
  else if(u_palette<1.5)col=vec3(1.0-t);
  else col=_iron(t);
  out_FragColor=vec4(col,1.0);
}`;
function _stage(name,fs,uniforms){
  const st=new Cesium.PostProcessStage({name:name,fragmentShader:fs,uniforms:uniforms});
  V.scene.postProcessStages.add(st);
  return st;
}
function _ensureNvgStage(){
  if(_nvgStage)return _nvgStage;
  const ph=_NVG_PHOSPHORS[_lsGet('bdoc_nvg_phosphor','P43')]||_NVG_PHOSPHORS.P43;
  _nvgStage=_stage('bdoc_nvg',_NVG_FS,{u_gain:2.0,u_noise:0.08,u_seed:0.0,u_vignette:0.55,u_phosphor:new Cesium.Cartesian3(ph[0],ph[1],ph[2])});
  // new grain pattern per rendered frame (no forced render loop — idle stays idle)
  V.scene.preRender.addEventListener(function(){if(_nvgStage&&_nvgStage.enabled)_nvgStage.uniforms.u_seed=Math.random();});
  return _nvgStage;
}
function _ensureFlirStage(){
  if(_flirStage)return _flirStage;
  _flirStage=_stage('bdoc_flir',_FLIR_FS,{u_palette:+_lsGet('bdoc_flir_palette','0')||0,u_seed:0.0});
  V.scene.preRender.addEventListener(function(){if(_flirStage&&_flirStage.enabled)_flirStage.uniforms.u_seed=Math.random();});
  return _flirStage;
}
function _setFilterBloom(off){
  window._bdocFilterBloomOff=!!off;
  try{if(window._bdocRetuneBloom)window._bdocRetuneBloom()}catch(_){}
}
function _sunAngleAtCamera(){
  const camCarto=V.camera.positionCartographic;
  const lat=Cesium.Math.toDegrees(camCarto.latitude);
  const lon=Cesium.Math.toDegrees(camCarto.longitude);
  const sunPos=Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(V.clock.currentTime);
  const sunCart=Cesium.Cartesian3.clone(sunPos);
  const icrfToFixed=Cesium.Transforms.computeIcrfToFixedMatrix(V.clock.currentTime);
  if(icrfToFixed)Cesium.Matrix3.multiplyByVector(icrfToFixed,sunPos,sunCart);
  const sunCarto=Cesium.Cartographic.fromCartesian(sunCart);
  const sunLat=Cesium.Math.toDegrees(sunCarto.latitude);
  const sunLon=Cesium.Math.toDegrees(sunCarto.longitude);
  const dLon=(sunLon-lon)*Math.PI/180;
  const sLat1=lat*Math.PI/180,sLat2=sunLat*Math.PI/180;
  const sinAlt=Math.sin(sLat1)*Math.sin(sLat2)+Math.cos(sLat1)*Math.cos(sLat2)*Math.cos(dLon);
  return Math.asin(Math.max(-1,Math.min(1,sinAlt)))*180/Math.PI;
}
function _disableStages(){
  if(_nvgStage)_nvgStage.enabled=false;
  if(_flirStage)_flirStage.enabled=false;
  if(_flirZoomHook){try{_flirZoomHook()}catch(_){}_flirZoomHook=null}
  // every mode switch starts from the normal globe (NVG night / FLIR turn lighting off)
  try{V.scene.globe.enableLighting=true;if(window._nightEarthLayer)window._nightEarthLayer.show=false;}catch(_){}
  _setFilterBloom(false);
}
// NVG phosphor swap (P43 green ↔ P45 white phosphor) — Shift+2 or the HUD chip
function toggleNvgPhosphor(){
  const next=_lsGet('bdoc_nvg_phosphor','P43')==='P43'?'P45':'P43';
  _lsSet('bdoc_nvg_phosphor',next);
  if(_nvgStage){const ph=_NVG_PHOSPHORS[next];_nvgStage.uniforms.u_phosphor=new Cesium.Cartesian3(ph[0],ph[1],ph[2]);}
  const chip=document.getElementById('nvg-phosphor');if(chip)chip.textContent=next==='P43'?'P43 GREEN':'P45 WHITE';
  try{V.scene.requestRender()}catch(_){}
  af('#00ff44','NVG phosphor: '+(next==='P43'?'P43 green':'P45 white'));
}
function cycleFlirPalette(){
  const cur=+_lsGet('bdoc_flir_palette','0')||0;
  const next=(cur+1)%_FLIR_PALETTES.length;
  _lsSet('bdoc_flir_palette',String(next));
  if(_flirStage)_flirStage.uniforms.u_palette=next;
  const el=document.getElementById('flir-pal');if(el)el.textContent=_FLIR_PALETTES[next];
  try{V.scene.requestRender()}catch(_){}
}
function clearVisualFilter(){
  if(activeFilter){togFilter(activeFilter,null);}
}
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
  if(V&&V.scene)_disableStages();

  if(activeFilter===f){
    activeFilter=null;
    if(V&&V.scene){
      V.scene.globe.enableLighting=true;
      V.scene.light=new Cesium.SunLight({intensity:2.0});
      // Restore globe minimumBrightness to default (may have been raised for NVG night mode)
      try{V.scene.globe.minimumBrightness=0.02}catch(_){}
      if(window._cityLightsLayer){window._cityLightsLayer.dayAlpha=0.0;window._cityLightsLayer.nightAlpha=0.9;window._cityLightsLayer.brightness=2.2}
      // P154: hide the Black Marble layer outright. Its dayAlpha=0 only works when the
      // terrain has NO vertex normals — BDOC boots with 3D terrain (normals on), so
      // the old "nightAlpha 0.6" left city lights painted over the DAYTIME globe.
      if(window._nightEarthLayer){window._nightEarthLayer.show=false;window._nightEarthLayer.alpha=1.0}
      try{V.scene.requestRender()}catch(_){}
    }
    af('var(--t3)','Visual filter disengaged — normal mode');
    EventLog.add('info','Filter: OFF (normal mode)');return
  }
  activeFilter=f;if(btn)btn.classList.add('a');
  else{const b=document.querySelector('.fb[data-f="'+f+'"]');if(b)b.classList.add('a');}

  if(f==='crt'){
    document.body.classList.add('filter-crt');
    document.getElementById('vfxCrt').classList.add('on');
    af('var(--kf)','CRT MONITOR — Phosphor scanline emulation active');
    EventLog.add('info','Filter: CRT phosphor monitor');
  } else if(f==='nvg'){
    document.body.classList.add('filter-nvg');
    if(V&&V.scene){
      V.scene.globe.enableLighting=true;           // terminator stays real
      V.scene.light=new Cesium.SunLight({intensity:2.0}); // normal light — the TUBE supplies the gain, not a dimmed sun
      _ensureNightLayer().then(layer=>{
        if(layer&&activeFilter==='nvg'){
          layer.nightAlpha=1.0;   // per-pixel terminator when terrain has no normals…
          layer.dayAlpha=0.0;
          layer.brightness=1.15;  // the tube's gain stage amplifies — a hot layer here
          layer.contrast=1.2;     // saturated whole metro areas into one green blob
          _nvgUpdateGain();       // …and camera-sun alpha below covers 3D terrain mode
          try{V.scene.requestRender()}catch(_){}
        }
      });
      if(window._cityLightsLayer){window._cityLightsLayer.dayAlpha=0.0;window._cityLightsLayer.nightAlpha=1.0;window._cityLightsLayer.brightness=3.0;window._cityLightsLayer.contrast=2.0}
      _setFilterBloom(true);      // the tube model draws its own halos
      const st=_ensureNvgStage();st.enabled=true;
    }
    const chip=document.getElementById('nvg-phosphor');if(chip)chip.textContent=_lsGet('bdoc_nvg_phosphor','P43')==='P43'?'P43 GREEN':'P45 WHITE';
    // Auto-gain follows the real sun angle at the camera (this is what ABC does on a tube)
    _nvgUpdateGain=function(){
      if(!V||!V.scene||!_nvgStage||activeFilter!=='nvg')return;
      let sun=0;try{sun=_sunAngleAtCamera()}catch(_){}
      const u=_nvgStage.uniforms;
      let mode;
      // Night: a tube sees terrain by starlight/skyglow — Cesium's lit globe is pitch
      // black there, so lighting goes off and the gain stage does the "amplification"
      // (lower gain, heavy grain). Day: real lighting, gain near unity.
      if(sun<-6){u.u_gain=2.3;u.u_noise=0.19;mode='NIGHT';V.scene.globe.enableLighting=false;}
      else if(sun<=10){u.u_gain=2.1;u.u_noise=0.12;mode='TWILIGHT';V.scene.globe.enableLighting=false;}
      else{u.u_gain=1.9;u.u_noise=0.05;mode='DAY';V.scene.globe.enableLighting=true;}
      // City lights only where the camera is actually in darkness (see note in OFF path)
      const nl=window._nightEarthLayer;
      // Black Marble is opaque black except the lights — key the black out so the
      // lights sit ON the terrain instead of painting over it.
      if(nl){const ch=V.camera.positionCartographic.height||1e6;const zoomK=Math.max(0.12,Math.min(1,(ch-30000)/270000));const a=0.7*zoomK*Math.max(0,Math.min(1,(4-sun)/10));nl.show=a>0.01;nl.alpha=a;try{nl.colorToAlpha=Cesium.Color.BLACK;nl.colorToAlphaThreshold=0.22;}catch(_){}}
      const gEl=document.getElementById('nvg-gain');if(gEl)gEl.textContent='GAIN '+mode;
      const bw=document.getElementById('nvgBloomWarn');if(bw)bw.style.display=mode==='DAY'?'block':'none';
    }
    _nvgUpdateGain();
    _nvgGainInterval=setInterval(_nvgUpdateGain,1000);
    try{V.scene.requestRender()}catch(_){}
    af('#00ff44','NVG ENGAGED — intensifier sim: auto-gain by sun angle, halos, grain. Shift+2 swaps green/white phosphor.');
    EventLog.add('info','Filter: NVG — GPU intensifier model (auto-gain, halo, scintillation)');
  } else if(f==='flir'){
    document.body.classList.add('filter-flir');
    if(V&&V.scene){
      V.scene.globe.enableLighting=false;  // thermal doesn't care about the terminator
      if(window._nightEarthLayer)window._nightEarthLayer.show=false;
      _setFilterBloom(true);
      const st=_ensureFlirStage();st.enabled=true;
      st.uniforms.u_palette=+_lsGet('bdoc_flir_palette','0')||0;
    }
    const pal=document.getElementById('flir-pal');if(pal)pal.textContent=_FLIR_PALETTES[+_lsGet('bdoc_flir_palette','0')||0];
    // Zoom/FOV readout tracks the camera (was frozen at whatever height FLIR was engaged)
    const zoomEl=document.getElementById('flir-zoom');
    const fovEl=document.getElementById('flir-fov');
    const upd=function(){
      if(!V||!zoomEl)return;
      const h=V.camera.positionCartographic?.height||10000000;
      zoomEl.textContent=h<5000?'8.0x':h<50000?'4.0x':h<500000?'2.0x':'1.0x';
      if(fovEl)fovEl.textContent=h<50000?'NAR FOV':h<500000?'MED FOV':'WIDE FOV';
    };
    upd();
    try{V.camera.changed.addEventListener(upd);_flirZoomHook=function(){V.camera.changed.removeEventListener(upd)};}catch(_){}
    try{V.scene.requestRender()}catch(_){}
    af('var(--yl)','FLIR ENGAGED — thermal sim (click the palette chip to cycle WHOT / BHOT / IRONBOW)');
    EventLog.add('info','Filter: FLIR thermal imaging');
  }
}
window.togFilter=togFilter;
window.clearVisualFilter=clearVisualFilter;
window.cycleFlirPalette=cycleFlirPalette;
window.toggleNvgPhosphor=toggleNvgPhosphor;
