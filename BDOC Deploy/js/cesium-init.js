// ============================================================
// BDOC PHASE 2 MODULE: cesium-init.js
// Cesium.Viewer construction + atmosphere/skybox/lighting/imagery layers
// Extracted from index.html lines 1267-1916 (Turn 12, 2026-04-22)
// Loaded AFTER the inline shell <script> so CFG, `let V`, and helper functions
// (togL, etc.) are all defined by the time this top-level code runs.
// `var toggle3DTerrain`/`var setBasemap` etc. land on `window` because they're
// at top level here (originally inside a try{} where var-hoisting kept them global).
// Depends on:
//   CFG, V (let V from shell — assigned via shared Script lexical env),
//   Cesium (global from cesium.js), document, window, EventLog, console
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
// ═══════════════════════════════════════════
// SECTION 7: CESIUM INIT
// ═══════════════════════════════════════════
Cesium.Ion.defaultAccessToken=CFG.keys.cesium;
try{
V=new Cesium.Viewer('cesiumContainer',{animation:false,baseLayerPicker:false,fullscreenButton:false,vrButton:false,geocoder:false,homeButton:false,infoBox:true,sceneModePicker:false,selectionIndicator:true,timeline:false,navigationHelpButton:false,creditContainer:document.createElement('div'),contextOptions:{webgl:{preserveDrawingBuffer:true}},baseLayer:new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",credit:"ESRI",maximumLevel:19}))});
const s=V.scene;
// ── INFOBOX SCRIPT FIX (Cesium 1.104) ──
// Cesium sandboxes the infoBox iframe as "allow-same-origin allow-popups allow-forms"
// — deliberately OMITTING allow-scripts as an XSS guard. That kills every onclick
// button inside entity description cards (Zoom In/Out, Go Back, SAT VIEW, etc.).
// All card HTML is built by OUR code from trusted API data (escaped via esc()),
// so re-enabling scripts is safe here. The frame exists immediately after viewer
// construction; set the sandbox once and force a reload so it takes effect.
try{
  if(V.infoBox&&V.infoBox.frame){
    V.infoBox.frame.setAttribute('sandbox','allow-same-origin allow-scripts allow-popups allow-forms');
    V.infoBox.frame.src='about:blank';
  }
}catch(e){console.warn('[infoBox sandbox fix]',e)}
// ── GOOGLE EARTH-GRADE RENDERING ──
s.backgroundColor=Cesium.Color.fromCssColorString('#000000');
s.globe.baseColor=Cesium.Color.fromCssColorString('#0a1628'); // Deep ocean blue when tiles haven't loaded
s.globe.showGroundAtmosphere=true;s.globe.enableLighting=true;s.globe.depthTestAgainstTerrain=true;
s.fog.enabled=true;s.fog.density=0.00003;s.fog.minimumBrightness=0.03;
// Atmosphere scattering — match Google Earth's clean blue limb
s.globe.atmosphereLightIntensity=10.0;
s.globe.atmosphereRayleighCoefficient=new Cesium.Cartesian3(5.5e-6,13.0e-6,28.4e-6);
s.globe.atmosphereMieCoefficient=new Cesium.Cartesian3(21e-6,21e-6,21e-6);
s.globe.atmosphereMieAnisotropy=0.9;
s.globe.lightingFadeOutDistance=1e7;s.globe.lightingFadeInDistance=2e7;
s.globe.nightFadeOutDistance=1e7;s.globe.nightFadeInDistance=5e7;
// Sky atmosphere — clean blue glow, no color artifacts
s.skyAtmosphere.hueShift=0.0;s.skyAtmosphere.saturationShift=0.0;s.skyAtmosphere.brightnessShift=0.0;
s.skyAtmosphere.show=true;
// High-DPI rendering — sharper text and labels
if(window.devicePixelRatio>1){s.globe.maximumScreenSpaceError=1.5}else{s.globe.maximumScreenSpaceError=2}
// Anti-aliasing
s.postProcessStages.fxaa.enabled=true;
// ═══ BLOOM — glow on bright markers/city-lights (spike 2026-06-25, the "alive" aesthetic) ═══
// Only pixels brighter than threshold bloom, so terrain/ocean stay crisp; bright billboards/lights glow.
try{
  const _bloom=s.postProcessStages.bloom;
  _bloom.enabled=true;
  _bloom.uniforms.glowOnly=false;
  _bloom.uniforms.contrast=140;
  _bloom.uniforms.brightness=0.1;    // slightly positive = more pixels bloom, tracers/markers glow visibly
  _bloom.uniforms.delta=1.2;
  _bloom.uniforms.sigma=3.5;         // wider blur = softer, more visible halo
  _bloom.uniforms.stepSize=1.0;
}catch(e){console.warn('[BDOC bloom]',e)}
// ═══ CAMERA CONTROLLER — Google-Earth-style joystick feel ═══
// Phase 14 fix (2026-05-12): Cesium defaults park tilt on middle-click — most users have no middle button.
// Map RIGHT_DRAG + CTRL+LEFT_DRAG + PINCH onto tilt. Clamp zoom range. Tune inertia so the camera doesn't snap-stop.
try{
  const ssc=s.screenSpaceCameraController;
  ssc.minimumZoomDistance=1.5;
  ssc.maximumZoomDistance=25000000;
  ssc.enableTilt=true;
  ssc.enableLook=true;
  ssc.enableRotate=true;
  ssc.enableTranslate=true;
  ssc.enableZoom=true;
  ssc.inertiaSpin=0.5;
  ssc.inertiaTranslate=0.5;
  ssc.inertiaZoom=0.6;
  ssc.tiltEventTypes=[
    Cesium.CameraEventType.RIGHT_DRAG,
    Cesium.CameraEventType.PINCH,
    {eventType:Cesium.CameraEventType.LEFT_DRAG,modifier:Cesium.KeyboardEventModifier.CTRL}
  ];
  ssc.zoomEventTypes=[Cesium.CameraEventType.WHEEL,Cesium.CameraEventType.PINCH];
  ssc.rotateEventTypes=[Cesium.CameraEventType.LEFT_DRAG];
  ssc.lookEventTypes=[
    {eventType:Cesium.CameraEventType.LEFT_DRAG,modifier:Cesium.KeyboardEventModifier.SHIFT}
  ];
  console.log('[BDOC] Camera controller configured — RIGHT_DRAG tilt, SHIFT+LEFT look-around');
}catch(camErr){console.warn('[BDOC] Camera controller config failed:',camErr.message)}
// ═══ HD MILKY WAY SKYBOX (v2 — pixel-accurate dense starfield) ═══
(function(){
const SZ=2048;
function H(s,i){return((Math.sin(s+i*127.1)*43758.5453)%1+1)%1;}
function H2(s,i){return((Math.sin(s+i*269.5)*17624.87)%1+1)%1;}
function H3(s,i){return((Math.sin(s+i*431.3)*28947.12)%1+1)%1;}
function mkFace(seed,mwI,mwY,mwH){
var c=document.createElement('canvas');c.width=c.height=SZ;
var ctx=c.getContext('2d');
// Black space
ctx.fillStyle='#000003';ctx.fillRect(0,0,SZ,SZ);
var id=ctx.getImageData(0,0,SZ,SZ),d=id.data;
// --- Pass 1: Milky Way glow (paint before stars so stars sit on top) ---
if(mwI>0){
var cy=SZ*mwY,bh=SZ*mwH;
// Precompute wave per x — avoids 4M+ redundant Math.sin calls (saves ~800ms across 6 faces)
var waveArr=new Float32Array(SZ);
for(var wx=0;wx<SZ;wx++) waveArr[wx]=Math.sin(wx*0.003+seed)*0.3+0.7;
for(var y=0;y<SZ;y++){
var dy=Math.abs(y-cy)/(bh*0.5);
if(dy>1)continue;
var band=Math.exp(-dy*dy*3)*mwI;
for(var x2=0;x2<SZ;x2++){
var p=(y*SZ+x2)*4;
// Warm MW glow
var wave=waveArr[x2];
var glow=band*wave;
d[p]+=Math.min(255-d[p],glow*28|0);
d[p+1]+=Math.min(255-d[p+1],glow*24|0);
d[p+2]+=Math.min(255-d[p+2],glow*18|0);
}
}
// Nebula patches — very subtle colored regions
for(var n=0;n<6;n++){
var nx=H(seed+900,n)*SZ,ny=cy-bh*0.25+H2(seed+900,n)*bh*0.5;
var nr=40+H3(seed+900,n)*80;
var cr=n%3===0?35:n%3===1?15:25,cg=n%3===0?12:n%3===1?20:10,cb=n%3===0?8:n%3===1?35:28;
for(var py=Math.max(0,ny-nr|0);py<Math.min(SZ,ny+nr|0);py++){
for(var px=Math.max(0,nx-nr|0);px<Math.min(SZ,nx+nr|0);px++){
var dd=Math.sqrt((px-nx)*(px-nx)+(py-ny)*(py-ny));
if(dd>nr)continue;
var f=Math.exp(-dd*dd/(nr*nr*0.3))*mwI*0.4;
var pp=(py*SZ+px)*4;
d[pp]+=Math.min(255-d[pp],f*cr|0);
d[pp+1]+=Math.min(255-d[pp+1],f*cg|0);
d[pp+2]+=Math.min(255-d[pp+2],f*cb|0);
}}
}
}
// --- Pass 2: Background star dust — 40000 single-pixel faint stars ---
for(var i=0;i<40000;i++){
var sx=H(seed,i)*SZ|0,sy=H2(seed,i)*SZ|0;
if(sx<0||sx>=SZ||sy<0||sy>=SZ)continue;
var br=H3(seed,i);
var a=20+br*60|0;
var p2=(sy*SZ+sx)*4;
d[p2]=Math.min(255,d[p2]+a);d[p2+1]=Math.min(255,d[p2+1]+a);d[p2+2]=Math.min(255,d[p2+2]+a);
}
// --- Pass 3: Bright stars — 800 visible stars, 1-2px ---
for(var i=0;i<800;i++){
var sx=H(seed+5000,i)*SZ|0,sy=H2(seed+5000,i)*SZ|0;
if(sx<1||sx>=SZ-1||sy<1||sy>=SZ-1)continue;
var br=H3(seed+5000,i);
var a2=120+br*135|0;
// Color temperature
var tc=H(seed+8000,i);
var r2=a2,g2=a2,b2=a2;
if(tc>0.92){r2=a2*0.75|0;g2=a2*0.85|0;b2=a2;}// blue-white
else if(tc>0.84){r2=a2;g2=a2*0.9|0;b2=a2*0.7|0;}// warm yellow
else if(tc>0.80){r2=a2;g2=a2*0.7|0;b2=a2*0.5|0;}// orange
var p3=(sy*SZ+sx)*4;
d[p3]=Math.min(255,r2);d[p3+1]=Math.min(255,g2);d[p3+2]=Math.min(255,b2);d[p3+3]=255;
// Top 15% brightest get a 1px cross for subtle sparkle
if(br>0.85){
var arms=[[0,-1],[0,1],[-1,0],[1,0]];
for(var ai=0;ai<4;ai++){var ap=((sy+arms[ai][1])*SZ+(sx+arms[ai][0]))*4;
d[ap]=Math.min(255,d[ap]+(a2*0.3|0));d[ap+1]=Math.min(255,d[ap+1]+(a2*0.3|0));d[ap+2]=Math.min(255,d[ap+2]+(a2*0.3|0));}
}
}
// --- Pass 4: MW dense star clusters (extra pixels in band) ---
if(mwI>0){
var cy2=SZ*mwY,bh2=SZ*mwH;
for(var i=0;i<20000*mwI;i++){
var sx=H(seed+20000,i)*SZ|0;
var sy=cy2-bh2*0.3+H2(seed+20000,i)*bh2*0.6|0;
if(sx<0||sx>=SZ||sy<0||sy>=SZ)continue;
var a3=15+H3(seed+20000,i)*50|0;
var p4=(sy*SZ+sx)*4;
d[p4]=Math.min(255,d[p4]+a3);d[p4+1]=Math.min(255,d[p4+1]+a3);d[p4+2]=Math.min(255,d[p4+2]+(a3*0.85|0));
}
}
ctx.putImageData(id,0,0);
return c;
}
s.skyBox=new Cesium.SkyBox({sources:{
positiveX:mkFace(1,0.85,0.48,0.45),
negativeX:mkFace(2,0.65,0.52,0.42),
positiveY:mkFace(3,0.25,0.85,0.30),
negativeY:mkFace(4,0.15,0.15,0.25),
positiveZ:mkFace(5,1.0,0.50,0.50),
negativeZ:mkFace(6,0.45,0.50,0.40)
}});
s.sun.glowFactor=2.5;s.sun.show=true;
s.moon.show=true;s.moon.textureUrl=undefined; // Use Cesium default moon texture
console.log('[BDOC] HD Milky Way skybox v2 — 6 faces @ '+SZ+'px, 60k+ stars/face');
})();
}catch(e){
  const c=document.getElementById('cesiumContainer');
  c.style.background='radial-gradient(ellipse at 50% 45%,#141830 0%,#0a0e1a 60%)';
  c.innerHTML='<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;font-family:JetBrains Mono,monospace"><div style="font-size:56px;margin-bottom:14px">\uD83C\uDF0D</div><div style="font-size:11px;letter-spacing:3px;color:#444">INITIALIZING 3D GLOBE</div><div style="font-size:9px;color:#333;margin-top:8px">Replace YOUR_CESIUM_ION_TOKEN in the CFG object above</div><div style="font-size:8px;color:#292940;margin-top:4px">ion.cesium.com \u2192 sign up \u2192 get token \u2192 paste in code</div></div>';
}
// ── NON-FATAL SUBSYSTEMS (isolated try/catch — failures logged, viewer survives) ──
try{
// ═══ 3D TERRAIN + BUILDINGS (toggle via left panel buttons) ═══
// Terrain is toggled via existing 3D TERRAIN button — not forced at init to avoid breaking imagery
// var (not let): must escape this try{} block to be visible from setBasemap()/toggle3DTerrain() in sibling try blocks
var _buildingsTileset=null;
const s=V.scene;
const il=s.globe.imageryLayers.get(0);
il._isBaseLayer=true; // Tag base layer for setBasemap() removal
// Match Google Earth color grade — slightly warm, vivid greens, deep oceans
il.brightness=1.05;il.contrast=1.2;il.saturation=1.15;il.gamma=0.95;
// ═══ PERSISTENT BORDERS + LABELS OVERLAY ═══
// Single high-res label layer — no stacking, no blur
// var (not let): setBasemap() lives in a sibling try{} block and needs access — let would block-scope these
var _bordersLayer=null,_labelsLayer=null;
(function initBordersOverlay(){
  // CartoDB Dark Labels — thin clean white text on satellite, @2x retina, NO stacking
  const labelsProvider=new Cesium.UrlTemplateImageryProvider({
    url:'https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png',
    credit:'CartoDB',maximumLevel:18
  });
  _labelsLayer=V.imageryLayers.addImageryProvider(labelsProvider);
  _labelsLayer._isBordersOverlay=true;
  _labelsLayer.alpha=1.0;
  // Phase 15 fix (2026-05-13): togLy('borders') was reading _bordersLayer which was always null,
  // so the BORDERS toggle did nothing. Alias both to the same CartoDB layer (dark_only_labels
  // contains country/state outlines AND city labels — one layer, both purposes).
  _bordersLayer=_labelsLayer;
})();
V.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(50,25,18000000),duration:0});
// ═══ CESIUM RENDER ERROR RECOVERY (Phase 15c 2026-05-13) ═══
// Multi-stage recovery: removes last primitive (3D tilesets) → last entity (markers/polylines)
// → nukes problem layers as a last resort. Throttled to avoid recovery-loop death spiral.
(function(){
  let recoveryAttempts=0;
  let lastRecoveryT=0;
  // Phase 15f: clear Cesium's built-in error overlay + nudge re-render — runs after every recovery
  function clearErrorOverlayAndRetry(){
    setTimeout(()=>{
      try{
        const container=document.getElementById('cesiumContainer');
        if(container){
          const errPanels=container.querySelectorAll('.cesium-widget-errorPanel');
          errPanels.forEach(p=>p.remove());
        }
        if(V&&V.scene&&V.scene.requestRender)V.scene.requestRender();
      }catch(_){}
    },120);
  }
  V.scene.renderError.addEventListener(function(scene,error){
    const now=performance.now();
    if(now-lastRecoveryT<500){return} // debounce — Cesium re-fires error on next frame
    lastRecoveryT=now;
    recoveryAttempts++;
    console.error('[BDOC] Cesium render error #'+recoveryAttempts+':',error);
    EventLog.add('crit','Cesium render error #'+recoveryAttempts+': '+error.message);
    af('var(--rd)','RENDER ERROR: '+error.message.substring(0,80)+' — recovering ('+recoveryAttempts+'/5)…');

    let recovered=false;

    // STAGE 1: remove last-added 3D tileset primitive
    try{
      const prims=V.scene.primitives;
      for(let i=prims.length-1;i>=0;i--){
        const p=prims.get(i);
        if(p instanceof Cesium.Cesium3DTileset){
          console.warn('[BDOC] Removing last 3D tileset to recover:',p);
          try{
            if(typeof _google3dOn!=='undefined'&&_googleTileset===p){_google3dOn=false;_googleTileset=null;const b=document.getElementById('btnGoogle3d');if(b)b.classList.remove('bm-active')}
            if(typeof _ion2521176On!=='undefined'&&_ion2521176Tileset===p){_ion2521176On=false;_ion2521176Tileset=null;const b=document.getElementById('btnIon2521176');if(b)b.classList.remove('bm-active')}
            if(typeof _3dBuildingsOn!=='undefined'&&_buildingsTileset===p){_3dBuildingsOn=false;_buildingsTileset=null;const b=document.getElementById('btn3d');if(b)b.classList.remove('bm-active')}
          }catch(_){}
          prims.remove(p);
          af('var(--yl)','Removed problematic 3D tileset — toggle it back on to retry');
          recovered=true;
          break;
        }
      }
    }catch(e){console.error('[BDOC] Primitive recovery failed:',e)}

    // STAGE 1.5: scan all entities for invalid / NaN / Infinity positions — primary cause of RangeError crash
    if(!recovered){
      try{
        const ents=V.entities.values;
        const t=V.clock.currentTime;
        const bad=[];
        // Cap scan at 2000 entities to avoid blocking the main thread
        const scanLimit=Math.min(ents.length,2000);
        for(let i=0;i<scanLimit;i++){
          try{
            const e=ents[i];
            if(e&&e.position){
              const pos=typeof e.position.getValue==='function'?e.position.getValue(t):e.position;
              if(pos instanceof Cesium.Cartesian3){
                const carto=Cesium.Cartographic.fromCartesian(pos);
                if(!carto||!isFinite(carto.latitude)||!isFinite(carto.longitude)||!isFinite(carto.height)){
                  bad.push(e);
                }
              }
            }
          }catch(_){/* non-position entity — skip */}
        }
        if(bad.length>0){
          bad.forEach(e=>{try{V.entities.remove(e)}catch(_){}});
          console.warn('[BDOC] Stage 1.5: removed '+bad.length+' entities with invalid positions');
          af('var(--yl)','Removed '+bad.length+' entities with invalid coordinates — render restored');
          recovered=true;
        }
      }catch(e){console.error('[BDOC] Stage 1.5 entity scan failed:',e)}
    }

    // STAGE 2: remove last-added entity if no tileset/invalid-entity was removed
    if(!recovered){
      try{
        const ents=V.entities.values;
        if(ents.length>0){
          const last=ents[ents.length-1];
          console.warn('[BDOC] Removing last entity to recover:',last.id||'(no id)');
          V.entities.remove(last);
          recovered=true;
        }
      }catch(e){console.error('[BDOC] Entity recovery failed:',e)}
    }

    // STAGE 3: if recovery has failed 5+ times, nuke everything
    if(recoveryAttempts>=5){
      console.error('[BDOC] Recovery exhausted — nuking all primitives + entities');
      af('var(--rd)','RENDER RESET — clearing all overlays. Reload if globe stays black.');
      try{V.entities.removeAll()}catch(_){}
      try{
        const prims=V.scene.primitives;
        for(let i=prims.length-1;i>=0;i--){
          const p=prims.get(i);
          if(p instanceof Cesium.Cesium3DTileset)prims.remove(p);
        }
      }catch(_){}
      recoveryAttempts=0;
    }

    // ALWAYS run STAGE 4 after any recovery attempt
    clearErrorOverlayAndRetry();
  });

  // Debug helper: window.BDOC.diagnoseRender() — dump scene contents
  window.BDOC=window.BDOC||{};
  window.BDOC.diagnoseRender=function(){
    const prims=V.scene.primitives;
    const tilesets=[];
    for(let i=0;i<prims.length;i++){
      const p=prims.get(i);
      if(p instanceof Cesium.Cesium3DTileset){
        tilesets.push({index:i,ready:p.ready,boundingSphere:p.boundingSphere,url:p.resource&&p.resource.url||'?'});
      }
    }
    const report={
      entityCount:V.entities.values.length,
      primitiveCount:prims.length,
      tilesets,
      cameraHeight:V.camera.positionCartographic&&V.camera.positionCartographic.height,
      depthTestAgainstTerrain:V.scene.globe.depthTestAgainstTerrain,
      recoveryAttempts
    };
    console.table(report.tilesets);
    console.log('[BDOC diagnoseRender]',report);
    return report;
  };
})();
// ═══ NAVIGATION WIDGET — Google Earth-style controls ═══
// var (not const): inline onclick handlers (zoom in/out, globe-home) and keydown listener live in different scope and need access — const would block-scope this to the try{}
var CamCtrl={
  tilt(delta){if(!V)return;V.camera.lookUp(delta)},
  tiltUp(){this.tilt(Cesium.Math.toRadians(15))},
  tiltDown(){this.tilt(Cesium.Math.toRadians(-15))},
  rotate(delta){if(!V)return;V.camera.rotateRight(delta)},
  rotateLeft(){this.rotate(Cesium.Math.toRadians(-15))},
  rotateRight(){this.rotate(Cesium.Math.toRadians(15))},
  resetNorth(){
    if(!V)return;
    const pos=V.camera.positionCartographic;
    V.camera.flyTo({
      destination:Cesium.Cartesian3.fromRadians(pos.longitude,pos.latitude,pos.height),
      orientation:{heading:0,pitch:V.camera.pitch,roll:0},
      duration:0.6
    });
  },
  resetTilt(){
    if(!V)return;
    const pos=V.camera.positionCartographic;
    V.camera.flyTo({
      destination:Cesium.Cartesian3.fromRadians(pos.longitude,pos.latitude,pos.height),
      orientation:{heading:V.camera.heading,pitch:Cesium.Math.toRadians(-45),roll:0},
      duration:0.8
    });
  },
  topDown(){
    if(!V)return;
    const pos=V.camera.positionCartographic;
    V.camera.flyTo({
      destination:Cesium.Cartesian3.fromRadians(pos.longitude,pos.latitude,pos.height),
      orientation:{heading:V.camera.heading,pitch:Cesium.Math.toRadians(-90),roll:0},
      duration:0.8
    });
  },
  goGlobal(){
    if(!V)return;
    V.camera.flyTo({
      destination:Cesium.Cartesian3.fromDegrees(50,25,18000000),
      orientation:{heading:0,pitch:Cesium.Math.toRadians(-90),roll:0},
      duration:1.5
    });
  },
  zoomIn(){
    if(!V)return;
    const pos=V.camera.positionCartographic;
    const h=Math.max(pos.height*0.6,100);
    V.camera.flyTo({
      destination:Cesium.Cartesian3.fromRadians(pos.longitude,pos.latitude,h),
      orientation:{heading:V.camera.heading,pitch:V.camera.pitch,roll:0},
      duration:0.4
    });
  },
  zoomOut(){
    if(!V)return;
    const pos=V.camera.positionCartographic;
    const h=Math.min(pos.height*1.7,40000000);
    V.camera.flyTo({
      destination:Cesium.Cartesian3.fromRadians(pos.longitude,pos.latitude,h),
      orientation:{heading:V.camera.heading,pitch:V.camera.pitch,roll:0},
      duration:0.4
    });
  },
  zoomToHeight(h){
    if(!V)return;
    h=Math.max(100,Math.min(40000000,h));
    const pos=V.camera.positionCartographic;
    V.camera.flyTo({
      destination:Cesium.Cartesian3.fromRadians(pos.longitude,pos.latitude,h),
      orientation:{heading:V.camera.heading,pitch:V.camera.pitch,roll:0},
      duration:0.3
    });
  }
};
// Unified flyTo helper
function flyToTarget(lon,lat,alt,dur){
  if(!V)return;
  dur=dur||1.2;
  const pitch=alt<100000?-45:alt<500000?-60:-90;
  V.camera.flyTo({
    destination:Cesium.Cartesian3.fromDegrees(lon,lat,alt),
    orientation:{heading:Cesium.Math.toRadians(0),pitch:Cesium.Math.toRadians(pitch),roll:0},
    duration:dur,
    easingFunction:Cesium.EasingFunction.CUBIC_IN_OUT
  });
}
window.CamCtrl=CamCtrl;
window.flyToTarget=flyToTarget;

// ═══ NAV WIDGET INTERACTION HANDLERS ═══
(function(){
  const compassEl=document.getElementById('nw-compass');
  const compassRing=document.getElementById('nw-compass-ring');
  const lookEl=document.getElementById('nw-look');
  const lookKnob=document.getElementById('nw-look-knob');
  const zslider=document.getElementById('nw-zslider');
  const zthumb=document.getElementById('nw-zthumb');
  if(!compassEl||!lookEl||!zslider)return;

  // — COMPASS RING: drag to rotate heading —
  let compassDrag=false,compassStartAngle=0,compassStartHeading=0;
  function compassAngle(e){
    const r=compassEl.getBoundingClientRect();
    const cx=r.left+r.width/2, cy=r.top+r.height/2;
    return Math.atan2(e.clientY-cy,e.clientX-cx);
  }
  compassEl.addEventListener('mousedown',function(e){
    e.preventDefault();
    // Click near center = reset north
    const r=compassEl.getBoundingClientRect();
    const dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2);
    if(Math.sqrt(dx*dx+dy*dy)<12){CamCtrl.resetNorth();return}
    compassDrag=true;
    compassStartAngle=compassAngle(e);
    compassStartHeading=V?V.camera.heading:0;
  });
  document.addEventListener('mousemove',function(e){
    if(!compassDrag||!V)return;
    const delta=compassAngle(e)-compassStartAngle;
    const newHeading=compassStartHeading+delta;
    const pos=V.camera.positionCartographic;
    V.camera.setView({
      destination:Cesium.Cartesian3.fromRadians(pos.longitude,pos.latitude,pos.height),
      orientation:{heading:newHeading,pitch:V.camera.pitch,roll:0}
    });
  });
  document.addEventListener('mouseup',function(){compassDrag=false});

  // Update compass ring rotation to match camera heading
  function updateCompass(){
    if(!V)return;
    const deg=Cesium.Math.toDegrees(V.camera.heading);
    compassRing.style.transform='rotate('+(-deg)+'deg)';
    requestAnimationFrame(updateCompass);
  }
  requestAnimationFrame(updateCompass);

  // — LOOK-AROUND JOYSTICK: drag to tilt + rotate —
  // Phase 14 fix (2026-05-12): old impl applied rotation per mousemove event (1000Hz on gaming mice = instant snap).
  // New impl stores joystick offset and applies rotation in a rAF loop at 60fps, scaled by frame delta.
  let lookDrag=false,lookCX=0,lookCY=0,lookOffX=0,lookOffY=0,lookLastT=0;
  const LOOK_MAX_R=24;
  // Per-second rotation rates at max deflection (radians/sec). Tuned for Google-Earth feel.
  const LOOK_ROT_RATE=0.9;  // ~52°/sec max heading rate
  const LOOK_TILT_RATE=0.7; // ~40°/sec max tilt rate
  lookEl.addEventListener('mousedown',function(e){
    e.preventDefault();
    lookDrag=true;
    lookOffX=0;lookOffY=0;
    const r=lookEl.getBoundingClientRect();
    lookCX=r.left+r.width/2;
    lookCY=r.top+r.height/2;
    lookLastT=performance.now();
  });
  document.addEventListener('mousemove',function(e){
    if(!lookDrag)return;
    const dx=e.clientX-lookCX,dy=e.clientY-lookCY;
    lookOffX=Math.max(-LOOK_MAX_R,Math.min(LOOK_MAX_R,dx));
    lookOffY=Math.max(-LOOK_MAX_R,Math.min(LOOK_MAX_R,dy));
    lookKnob.style.transform='translate('+lookOffX+'px,'+lookOffY+'px)';
  });
  document.addEventListener('mouseup',function(){
    if(lookDrag){
      lookDrag=false;
      lookOffX=0;lookOffY=0;
      lookKnob.style.transform='translate(0,0)';
    }
  });
  // rAF loop: applies rotation rate × frame delta. Independent of mouse polling rate.
  function lookTick(t){
    if(lookDrag&&V&&(lookOffX!==0||lookOffY!==0)){
      const dt=Math.min(0.05,(t-lookLastT)/1000); // cap dt @ 50ms (prevents huge jump after tab switch)
      lookLastT=t;
      const xFrac=lookOffX/LOOK_MAX_R,yFrac=lookOffY/LOOK_MAX_R;
      try{
        if(xFrac!==0)V.camera.rotateRight(xFrac*LOOK_ROT_RATE*dt);
        if(yFrac!==0)V.camera.lookUp(-yFrac*LOOK_TILT_RATE*dt);
      }catch(_){}
    }else{
      lookLastT=t;
    }
    requestAnimationFrame(lookTick);
  }
  requestAnimationFrame(lookTick);

  // — ZOOM SLIDER —
  const MIN_H=200,MAX_H=40000000;
  let zDrag=false;
  function heightToSliderPct(h){
    // Log scale: slider 0=top(close) to 1=bottom(far)
    const logMin=Math.log(MIN_H),logMax=Math.log(MAX_H);
    return (Math.log(Math.max(MIN_H,Math.min(MAX_H,h)))-logMin)/(logMax-logMin);
  }
  function sliderPctToHeight(pct){
    const logMin=Math.log(MIN_H),logMax=Math.log(MAX_H);
    return Math.exp(logMin+pct*(logMax-logMin));
  }
  function updateZoomThumb(){
    if(!V||!zthumb||!zslider)return;
    const pct=heightToSliderPct(V.camera.positionCartographic.height);
    const sliderH=zslider.offsetHeight-16;
    zthumb.style.top=(4+pct*sliderH)+'px';
    requestAnimationFrame(updateZoomThumb);
  }
  requestAnimationFrame(updateZoomThumb);

  function zoomFromEvent(e){
    const r=zslider.getBoundingClientRect();
    const pct=Math.max(0,Math.min(1,(e.clientY-r.top-4)/(r.height-16)));
    CamCtrl.zoomToHeight(sliderPctToHeight(pct));
  }
  zslider.addEventListener('mousedown',function(e){e.preventDefault();zDrag=true;zoomFromEvent(e)});
  document.addEventListener('mousemove',function(e){if(zDrag)zoomFromEvent(e)});
  document.addEventListener('mouseup',function(){zDrag=false});

  // — RIGHT PANEL open/close: update widget position —
  const nw=document.getElementById('nav-widget');
  if(nw){
    new MutationObserver(function(){
      const rp=document.getElementById('rp');
      if(rp&&rp.classList.contains('shut'))nw.classList.add('rp-closed');
      else nw.classList.remove('rp-closed');
    }).observe(document.body,{childList:true,subtree:true,attributes:true});
  }
})();
// Auto-untrack when user selects a different entity
// [Phase 3 Turn 8] layers-air.js is lazy — guard refs so this listener doesn't throw before it loads.
V.selectedEntityChanged.addEventListener(function(){
  try{
    if(typeof _trackedHex==='undefined'||!_trackedHex||!V.selectedEntity)return;
    if(typeof _milEntMap==='undefined'||typeof _airEntMap==='undefined')return;
    const isTracked=(_milEntMap.get(_trackedHex)===V.selectedEntity||_airEntMap.get(_trackedHex)===V.selectedEntity);
    if(!isTracked&&typeof untrackAircraft==='function')untrackAircraft();
  }catch(_){/* layers-air.js not loaded yet */}
});
}catch(e){console.warn('[BDOC] Base layers / Nav widget init failed:',e.message)}
try{
// ═══════════════════════════════════════════
// BASEMAP SWITCHER (Satellite, Hybrid, Terrain, Streets, Topo, Dark)
// ═══════════════════════════════════════════
let _currentBasemap='satellite';
const BASEMAPS={
  dark:{url:'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',credit:'CartoDB Dark Matter',brightness:1.6,contrast:1.3,saturation:0.4},
  satellite:{type:'arcgis',credit:'ESRI World Imagery',brightness:1.0,contrast:1.1,saturation:1.0},
  hybrid:{type:'arcgis_labels',credit:'ESRI + OSM Labels',brightness:1.0,contrast:1.1,saturation:1.0},
  terrain:{url:'https://tile.opentopomap.org/{z}/{x}/{y}.png',credit:'OpenTopoMap',brightness:1.0,contrast:1.1,saturation:0.8},
  streets:{url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',credit:'OpenStreetMap',brightness:1.05,contrast:1.05,saturation:1.1,isLight:true},
  topo:{url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',credit:'ESRI World Topo',brightness:1.0,contrast:1.1,saturation:0.9}
};
function setBasemap(name){
  if(!V||!BASEMAPS[name])return;
  const bm=BASEMAPS[name];
  const il2=V.imageryLayers;
  // Remove the tagged base layer (not by index — other layers may have shifted it)
  for(let i=0;i<il2.length;i++){if(il2.get(i)._isBaseLayer){il2.remove(il2.get(i));break}}
  // Also remove any existing label overlays (prevents duplicate labels on repeated hybrid clicks)
  for(let i=il2.length-1;i>=0;i--){if(il2.get(i)._isLabelsOverlay){il2.remove(il2.get(i))}}
  // Hide persistent labels when hybrid adds its own (prevent double); restore on other basemaps
  if(_labelsLayer){
    if(bm.type==='arcgis_labels'){_labelsLayer.show=false}
    else{_labelsLayer.show=layers.borders}
  }
  if(_bordersLayer){
    if(bm.type==='arcgis_labels'){_bordersLayer.show=false}
    else{_bordersLayer.show=layers.borders}
  }
  let provider;
  if(bm.type==='arcgis'||bm.type==='arcgis_labels'){
    provider=new Cesium.UrlTemplateImageryProvider({url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',credit:bm.credit,maximumLevel:19});
  }else{
    provider=new Cesium.UrlTemplateImageryProvider({url:bm.url,credit:bm.credit});
  }
  const newLayer=il2.addImageryProvider(provider);
  il2.lowerToBottom(newLayer);
  newLayer._isBaseLayer=true; // Tag for future removal
  newLayer.brightness=bm.brightness;newLayer.contrast=bm.contrast;newLayer.saturation=bm.saturation;
  if(bm.type==='arcgis_labels'){
    // ESRI reference overlay — white state/country borders + city labels on satellite
    const refProvider=new Cesium.UrlTemplateImageryProvider({url:'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',credit:'ESRI Reference',maximumLevel:19});
    const refLayer=il2.addImageryProvider(refProvider);
    refLayer._isLabelsOverlay=true;
    refLayer.alpha=0.85;
    // ESRI transportation overlay — highways/roads
    const roadsProvider=new Cesium.UrlTemplateImageryProvider({url:'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',credit:'ESRI Transportation',maximumLevel:19});
    const roadsLayer=il2.addImageryProvider(roadsProvider);
    roadsLayer._isLabelsOverlay=true;
    roadsLayer.alpha=0.6;
  }
  // Adjust globe styling for light vs dark basemaps
  const isDark=(name==='dark'||bm.isDark);
  V.scene.backgroundColor=isDark?Cesium.Color.fromCssColorString('#0a0e1a'):Cesium.Color.fromCssColorString('#1a2332');
  V.scene.globe.baseColor=isDark?Cesium.Color.fromCssColorString('#121830'):Cesium.Color.fromCssColorString('#2a3a4a');
  // Update button states
  document.querySelectorAll('.bm-btn').forEach(b=>b.classList.remove('bm-active'));
  const activeBtn=document.querySelector(`.bm-btn[data-bm="${name}"]`);
  if(activeBtn)activeBtn.classList.add('bm-active');
  _currentBasemap=name;
  EventLog.add('info',`Basemap: ${name.charAt(0).toUpperCase()+name.slice(1)}`);
  af('var(--bl)',`Map style: ${name.toUpperCase()}`);
}
// ═══ 3D TOGGLE FUNCTIONS ═══
let _3dBuildingsOn=false,_3dTerrainOn=false;
function toggle3DBuildings(){
  if(!V)return;
  _3dBuildingsOn=!_3dBuildingsOn;
  if(_3dBuildingsOn){
    // Create buildings tileset on first enable
    if(!_buildingsTileset){
      try{
        _buildingsTileset=V.scene.primitives.add(Cesium.createOsmBuildings());
        // Style: subtle dark blue tint, lighter edges visible against satellite
        _buildingsTileset.style=new Cesium.Cesium3DTileStyle({
          color:{conditions:[
            ["${feature['building']==='commercial'}","color('#3a6888',0.9)"],
            ["${feature['building']==='residential'}","color('#4a5a6a',0.9)"],
            ["true","color('#556677',0.9)"]
          ]}
        });
        if(_buildingsTileset.readyPromise){_buildingsTileset.readyPromise.then(()=>{
          console.log('[BDOC] OSM 3D Buildings ready — tiles loading');
          af('var(--gn)','3D Buildings loaded successfully');
        }).catch(e=>{
          console.warn('[BDOC] OSM Buildings readyPromise rejected:',e);
          af('var(--rd)','3D Buildings failed to load — check Cesium Ion token');
        })}else{console.log('[BDOC] OSM 3D Buildings added (no readyPromise — Cesium 1.107+)');af('var(--gn)','3D Buildings loaded successfully')}
        console.log('[BDOC] OSM 3D Buildings initializing...');
      }catch(e){console.warn('[BDOC] OSM Buildings failed:',e);_3dBuildingsOn=false;const _btnFail=document.getElementById('btn3d');if(_btnFail)_btnFail.classList.remove('bm-active');af('var(--rd)','3D Buildings error: '+e.message);return;}
    } else {
      _buildingsTileset.show=true;
    }
    af('var(--bl)','3D Buildings: ON — zoom into a city to see (loading tiles...)');
  } else {
    if(_buildingsTileset)_buildingsTileset.show=false;
    af('var(--bl)','3D Buildings: OFF');
  }
  const btn=document.getElementById('btn3d');
  if(btn)btn.classList.toggle('bm-active',_3dBuildingsOn);
}
// var-assigned async function expression (not `async function` declaration): legacy block-scope hoisting in try{} works for `function` decls but NOT for `async function` decls — so the inline onclick="toggle3DTerrain()" hits ReferenceError. var-binding hoists the name and lets the assignment land at try-block exec time.
var toggle3DTerrain=async function toggle3DTerrain(){
  if(!V)return;
  _3dTerrainOn=!_3dTerrainOn;
  const btn=document.getElementById('btnTerrain');
  const revert=(msg)=>{
    try{V.terrainProvider=new Cesium.EllipsoidTerrainProvider()}catch(_){}
    try{V.scene.globe.depthTestAgainstTerrain=true}catch(_){}
    _3dTerrainOn=false;
    if(btn)btn.classList.remove('bm-active');
    af('var(--rd)',msg);
  };
  if(_3dTerrainOn){
    if(!CFG||!CFG.keys||!CFG.keys.cesium||CFG.keys.cesium.length<20){
      revert('3D Terrain: missing/invalid Cesium Ion token');
      return;
    }
    try{
      // requestVertexNormals MUST be true — globe.enableLighting=true (init line 24) renders unlit terrain near-black.
      // requestWaterMask:false to keep payload light.
      let tp;
      const opts={requestWaterMask:false,requestVertexNormals:true};
      if(Cesium.createWorldTerrainAsync){
        tp=await Cesium.createWorldTerrainAsync(opts);
      }else if(Cesium.createWorldTerrain){
        tp=Cesium.createWorldTerrain(opts);
      }else if(Cesium.CesiumTerrainProvider&&Cesium.CesiumTerrainProvider.fromUrl){
        tp=await Cesium.CesiumTerrainProvider.fromUrl(Cesium.IonResource.fromAssetId(1),opts);
      }else if(Cesium.Terrain&&Cesium.Terrain.fromWorldTerrain){
        tp=await Cesium.Terrain.fromWorldTerrain(opts);
      }
      // Guard: if no API matched, tp is undefined — assigning undefined wipes the renderer.
      if(!tp){revert('3D Terrain: no compatible Cesium terrain API in this build');return}
      // Suspend depth-test while tiles hydrate — otherwise imagery is culled against an empty depth buffer and the surface goes transparent.
      V.scene.globe.depthTestAgainstTerrain=false;
      // Listen for tile-fetch failures (bad token, quota, network) — provider resolves OK then 401s on every tile.
      let firstError=true;
      if(tp.errorEvent&&tp.errorEvent.addEventListener){
        tp.errorEvent.addEventListener((err)=>{
          if(!firstError)return;firstError=false;
          console.warn('[BDOC] Terrain tile error:',err);
          revert('3D Terrain: tile fetch failed — '+(err&&err.message?err.message:'check Ion token/quota'));
        });
      }
      V.terrainProvider=tp;
      V.scene.requestRender();
      // Re-enable depth-test once tiles have actually loaded — not a guessed 2-second timer.
      // Hook tileLoadProgressEvent: fires with queue length. When it hits 0, the visible area is hydrated.
      let restored=false;
      const onProgress=function(remaining){
        if(restored||!_3dTerrainOn)return;
        if(remaining===0){
          restored=true;
          try{V.scene.globe.tileLoadProgressEvent.removeEventListener(onProgress)}catch(_){}
          try{V.scene.globe.depthTestAgainstTerrain=true;V.scene.requestRender()}catch(_){}
          console.log('[BDOC] World Terrain loaded successfully');
          af('var(--bl)','3D Terrain: ON — zoom into mountains to see elevation');
        }
      };
      try{V.scene.globe.tileLoadProgressEvent.addEventListener(onProgress)}catch(_){}
      // Safety fallback: if progress event never reports 0 (offline / blocked), restore after 4s.
      setTimeout(()=>{
        if(restored||!_3dTerrainOn)return;
        restored=true;
        try{V.scene.globe.tileLoadProgressEvent.removeEventListener(onProgress)}catch(_){}
        try{V.scene.globe.depthTestAgainstTerrain=true;V.scene.requestRender()}catch(_){}
        console.log('[BDOC] World Terrain fallback timer restored depth-test');
        af('var(--bl)','3D Terrain: ON — zoom into mountains to see elevation');
      },4000);
    }catch(e){
      console.warn('[BDOC] World Terrain failed:',e);
      revert('3D Terrain: failed to load — '+e.message);
      return;
    }
  }else{
    V.terrainProvider=new Cesium.EllipsoidTerrainProvider();
    V.scene.globe.depthTestAgainstTerrain=true;
    af('var(--bl)','3D Terrain: OFF');
  }
  if(btn)btn.classList.toggle('bm-active',_3dTerrainOn);
};

// ═══ GOOGLE PHOTOREAL 3D TILES (via Cesium Ion asset 2275207) ═══
// Google captures photoreal city meshes (airplane LIDAR + ground photos).
// Google contributed those tiles to Cesium Ion as asset 2275207 — accessible with our Ion token.
// We do NOT need a Google Maps Platform API key for this path. No Google billing involved.
// Old code (pre-p14) was hitting tile.googleapis.com directly with a hardcoded Google key — that's gone.
let _googleTileset=null;
let _google3dOn=false;
async function toggleGoogle3D(){
  if(!BDOC_Auth.canAccess('google3d')){showMo();return}
  if(!V){af('var(--rd)','Globe not initialized');return}
  _google3dOn=!_google3dOn;
  const btn=document.getElementById('btnGoogle3d');
  if(_google3dOn){
    if(!_googleTileset){
      try{
        af('var(--yl)','Google 3D Tiles: loading photorealistic imagery via Cesium Ion…');
        // Use Ion asset 2275207 — operator's library has this. Bypasses Google Maps API key entirely.
        if(Cesium.Cesium3DTileset.fromIonAssetId){
          _googleTileset=await Cesium.Cesium3DTileset.fromIonAssetId(2275207,{maximumScreenSpaceError:8,preloadWhenHidden:false});
        }else if(Cesium.IonResource&&Cesium.IonResource.fromAssetId){
          // Older Cesium fallback
          _googleTileset=new Cesium.Cesium3DTileset({url:Cesium.IonResource.fromAssetId(2275207),maximumScreenSpaceError:8});
        }else{
          throw new Error('Cesium version does not support Ion 3D Tiles loading');
        }
        V.scene.primitives.add(_googleTileset);
        console.log('[BDOC] Google 3D Photoreal loaded from Ion asset 2275207');
        af('var(--gn)','Google 3D Photorealistic Tiles: LOADED — zoom into any city + right-click drag to tilt');
        if(_buildingsTileset&&_3dBuildingsOn){_buildingsTileset.show=false}
      }catch(e){
        console.warn('[BDOC] Google 3D Tiles Ion load failed:',e);
        af('var(--rd)','Google 3D Tiles error: '+(e.message||e));
        _google3dOn=false;
        _googleTileset=null;
        if(btn)btn.classList.remove('bm-active');
        return;
      }
    }else{
      _googleTileset.show=true;
      if(_buildingsTileset&&_3dBuildingsOn)_buildingsTileset.show=false;
      af('var(--bl)','Google 3D Photorealistic Tiles: ON');
    }
  }else{
    if(_googleTileset)_googleTileset.show=false;
    if(_buildingsTileset&&_3dBuildingsOn)_buildingsTileset.show=true;
    af('var(--bl)','Google 3D Photorealistic Tiles: OFF');
  }
  if(btn)btn.classList.toggle('bm-active',_google3dOn);
}
// Phase 15 fix (2026-05-13): function decl inside try{} block is NOT hoisted to window in strict mode.
// Inline onclick="toggleGoogle3D()" was hitting ReferenceError. Explicit export resolves it.
window.toggleGoogle3D=toggleGoogle3D;

// ═══ ION ASSET 2521176 (operator-supplied — Phase 14b 2026-05-12) ═══
// Loaded with the exact pattern from Cesium docs: viewer.scene.primitives.add(await Cesium.Cesium3DTileset.fromIonAssetId(2521176))
// Stays as a separate toggle so it doesn't conflict with Google 3D / OSM Buildings / Terrain.
let _ion2521176Tileset=null;
let _ion2521176On=false;
async function toggleIon2521176(){
  if(!V){af('var(--rd)','Globe not initialized');return}
  _ion2521176On=!_ion2521176On;
  const btn=document.getElementById('btnIon2521176');
  if(_ion2521176On){
    if(!_ion2521176Tileset){
      try{
        af('var(--yl)','Ion asset 2521176: loading…');
        if(Cesium.Cesium3DTileset.fromIonAssetId){
          _ion2521176Tileset=await Cesium.Cesium3DTileset.fromIonAssetId(2521176);
        }else if(Cesium.IonResource&&Cesium.IonResource.fromAssetId){
          _ion2521176Tileset=new Cesium.Cesium3DTileset({url:Cesium.IonResource.fromAssetId(2521176)});
        }else{
          throw new Error('Cesium version does not support Ion 3D Tiles loading');
        }
        V.scene.primitives.add(_ion2521176Tileset);
        console.log('[BDOC] Ion asset 2521176 loaded:',_ion2521176Tileset);
        // Phase 15c (2026-05-13): validate bounding sphere BEFORE auto-flying.
        // Some Ion assets return NaN/Infinity bounds which crash createPotentiallyVisibleSet.
        try{
          const bs=_ion2521176Tileset.boundingSphere;
          if(bs&&bs.center&&isFinite(bs.center.x)&&isFinite(bs.center.y)&&isFinite(bs.center.z)&&isFinite(bs.radius)&&bs.radius>0&&bs.radius<1e9){
            V.camera.flyToBoundingSphere(bs,{duration:2.0});
            af('var(--gn)','Ion 2521176: LOADED — flying to tileset bounds');
          }else{
            console.warn('[BDOC] Ion 2521176 has invalid boundingSphere — staying at current view',bs);
            af('var(--yl)','Ion 2521176: loaded but bounds are invalid — manually zoom to find it');
          }
        }catch(e){console.warn('[BDOC] Ion 2521176 flyToBoundingSphere failed:',e)}
      }catch(e){
        console.warn('[BDOC] Ion 2521176 load failed:',e);
        af('var(--rd)','Ion 2521176 error: '+(e.message||e));
        _ion2521176On=false;
        _ion2521176Tileset=null;
        if(btn)btn.classList.remove('bm-active');
        return;
      }
    }else{
      _ion2521176Tileset.show=true;
      // Re-fly to bounds on re-enable
      try{if(_ion2521176Tileset.boundingSphere)V.camera.flyToBoundingSphere(_ion2521176Tileset.boundingSphere,{duration:1.5})}catch(_){}
      af('var(--bl)','Ion 2521176: ON');
    }
  }else{
    if(_ion2521176Tileset)_ion2521176Tileset.show=false;
    af('var(--bl)','Ion 2521176: OFF');
  }
  if(btn)btn.classList.toggle('bm-active',_ion2521176On);
}
window.toggleIon2521176=toggleIon2521176;
// Phase 15: export the other inline-onclicked basemap/3D toggles too — same try{} block-scope issue
try{if(typeof toggle3DBuildings==='function')window.toggle3DBuildings=toggle3DBuildings}catch(_){}
try{if(typeof toggle3DTerrain==='function')window.toggle3DTerrain=toggle3DTerrain}catch(_){}
try{if(typeof setBasemap==='function')window.setBasemap=setBasemap}catch(_){}
}catch(e){console.warn('[BDOC] Basemap / 3D layers init failed:',e.message)}
// setTimeSpeed lives in the sibling try{} block — export after its declaration runs at top level
try{if(typeof setTimeSpeed==='function')window.setTimeSpeed=setTimeSpeed}catch(_){}

// ═══════════════════════════════════════════
// DAY/NIGHT CYCLE + CITY LIGHTS + CLOUDS
// ═══════════════════════════════════════════
try {
  // Day/Night lighting — sun follows real time
  V.scene.globe.enableLighting=true;
  V.scene.light=new Cesium.SunLight({intensity:2.2});
  // Night side: subtle glow so terrain is barely visible (Google Earth style)
  try{if('minimumBrightness' in V.scene.globe) V.scene.globe.minimumBrightness=0.02}catch(e){}
  window._cityLightsLayer=null;
  window._nightEarthLayer=null;
  // Make sure the clock is running in real time so the sun position matches the real world
  V.clock.shouldAnimate=true;
  V.clock.currentTime=Cesium.JulianDate.now();
  V.clock.multiplier=1; // 1x real time
  V.clock.clockStep=Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER; // sync to system clock, allow time acceleration
  // PERF FIX: Removed preRender listener that ran 60fps unnecessarily.
  // Day/night alpha is set once here and updated only in togFilter() when user changes modes.
  V.scene.skyAtmosphere.show=true;
  V.scene.globe.atmosphereLightIntensity=3.0;
  V.scene.globe.atmosphereBrightnessShift=0.15;
  console.log('[BDOC] Day/night cycle + city lights initialized');
} catch(dnErr) {
  console.warn('[BDOC] Day/night cycle init failed:', dnErr);
}
// ═══ TIME CONTROLS FOR DAY/NIGHT ═══
try {
  const ftbEl=document.querySelector('.ftb');
  if(ftbEl){
    const timeDiv=document.createElement('div');
    timeDiv.className='st';
    timeDiv.style.cssText='margin:0 6px;display:flex;align-items:center';
    timeDiv.innerHTML=`<select id="timeSpeed" onchange="setTimeSpeed(this.value)" style="background:rgba(13,17,23,0.9);border:1px solid var(--bdr);color:var(--t2);font-family:var(--m);font-size:8px;padding:3px 6px;border-radius:3px;cursor:pointer;"><option value="0">⏱ REAL-TIME</option><option value="60">1 MIN/SEC</option><option value="600">10 MIN/SEC</option><option value="3600">1 HR/SEC</option><option value="86400">1 DAY/SEC</option></select>`;
    ftbEl.parentNode.insertBefore(timeDiv,ftbEl);
  }
} catch(tcErr){}
let timeMultiplier=0;let timeInterval=null;
function setTimeSpeed(mult){
  timeMultiplier=parseInt(mult);
  if(timeInterval)clearInterval(timeInterval);
  if(timeMultiplier>0){
    timeInterval=setInterval(()=>{
      if(V&&V.clock){V.clock.currentTime=Cesium.JulianDate.addSeconds(V.clock.currentTime,timeMultiplier,new Cesium.JulianDate())}
    },1000);
    EventLog.add('info','Time acceleration: '+timeMultiplier+'s/sec');
  } else {
    if(V&&V.clock){V.clock.currentTime=Cesium.JulianDate.now()}
    EventLog.add('info','Time: Real-time mode');
  }
}
// Auto-collapse left panel on non-ultrawide screens for more globe space

// ── Phase 2 Turn 12: kick off bootFeeds now that all Cesium helpers exist ──
// bootFeeds is defined in the inline shell (which executed before this script).
// It calls toggle3DTerrain (var-declared above → on window) so calling it here,
// AFTER all cesium-init.js top-level code has run, is the safe sequencing point.
if(typeof bootFeeds==='function'){bootFeeds()}
else{console.warn('[BDOC] bootFeeds not found — boot sequence skipped')}
// Phase 22 fix: install click/battle handlers now that V exists
// (was if(V){} at module scope in inline script — V undefined at that point)
if(typeof _initBattleClickHandlers==='function'){_initBattleClickHandlers()}
else{console.warn('[BDOC] _initBattleClickHandlers not found — click handlers skipped')}

// ── 2026-05-03 regression fix: cursor lat/lon HUD ──
// initCursorCoords was an IIFE in the inline shell. After Phase 2 Turn 12 moved this
// script to load AFTER the inline shell, V was undefined when the IIFE ran, so the
// MOUSE_MOVE handler was never installed. Call it here, where V is guaranteed up.
if(typeof initCursorCoords==='function'){try{initCursorCoords();}catch(e){console.error('[BDOC] initCursorCoords threw:',e)}}
else{console.warn('[BDOC] initCursorCoords not found — cursor coords disabled');}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 14c — CINEMATIC TOUR + BOLD COUNTRY LABELS + COCOM ROUTE LINES
// Translates the "Shuto4ka After Effects map promo" aesthetic into Cesium.
// ═══════════════════════════════════════════════════════════════════════
window.BDOC = window.BDOC || {};

// ── BIG COUNTRY LABELS — visible from space, fade out as you zoom in ──
BDOC.MajorLabels = (function(){
  const NATIONS = [
    {n:'UNITED STATES',lat:39.5,lon:-98.5},
    {n:'CANADA',lat:56.0,lon:-106.0},
    {n:'MEXICO',lat:23.6,lon:-102.5},
    {n:'BRAZIL',lat:-14.2,lon:-51.9},
    {n:'ARGENTINA',lat:-38.4,lon:-63.6},
    {n:'UNITED KINGDOM',lat:54.0,lon:-2.0},
    {n:'FRANCE',lat:46.6,lon:2.2},
    {n:'GERMANY',lat:51.2,lon:10.5},
    {n:'ITALY',lat:42.5,lon:12.6},
    {n:'SPAIN',lat:40.5,lon:-3.7},
    {n:'POLAND',lat:51.9,lon:19.1},
    {n:'UKRAINE',lat:48.4,lon:31.2},
    {n:'TURKEY',lat:39.0,lon:35.2},
    {n:'EGYPT',lat:26.8,lon:30.8},
    {n:'SAUDI ARABIA',lat:23.9,lon:45.1},
    {n:'IRAN',lat:32.4,lon:53.7},
    {n:'IRAQ',lat:33.2,lon:43.7},
    {n:'ISRAEL',lat:31.0,lon:34.9},
    {n:'NIGERIA',lat:9.1,lon:8.7},
    {n:'SOUTH AFRICA',lat:-30.6,lon:22.9},
    {n:'RUSSIA',lat:61.5,lon:105.3},
    {n:'CHINA',lat:35.9,lon:104.2},
    {n:'INDIA',lat:20.6,lon:78.96},
    {n:'PAKISTAN',lat:30.4,lon:69.3},
    {n:'JAPAN',lat:36.2,lon:138.3},
    {n:'SOUTH KOREA',lat:35.9,lon:127.8},
    {n:'NORTH KOREA',lat:40.3,lon:127.5},
    {n:'INDONESIA',lat:-0.8,lon:113.9},
    {n:'AUSTRALIA',lat:-25.3,lon:133.8},
    {n:'PHILIPPINES',lat:12.9,lon:121.8},
    {n:'VIETNAM',lat:14.1,lon:108.3},
    {n:'THAILAND',lat:15.9,lon:101.0},
  ];
  let entities = [];
  let on = false;
  function build(){
    if(!V||entities.length)return;
    NATIONS.forEach(c=>{
      entities.push(V.entities.add({
        position:Cesium.Cartesian3.fromDegrees(c.lon,c.lat),
        label:{
          text:c.n,
          font:'bold 14px "JetBrains Mono",monospace',
          fillColor:Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.92),
          outlineColor:Cesium.Color.BLACK.withAlpha(0.95),
          outlineWidth:3,
          style:Cesium.LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin:Cesium.HorizontalOrigin.CENTER,
          verticalOrigin:Cesium.VerticalOrigin.CENTER,
          // Visible from globe view (1e6 m) out to deep space (3e7 m), fade out when zoomed in
          scaleByDistance:new Cesium.NearFarScalar(2e6,1.2,3e7,0.55),
          distanceDisplayCondition:new Cesium.DistanceDisplayCondition(1.5e6,2.5e7),
          // Phase 15 fix: was Number.POSITIVE_INFINITY which made labels show through the globe on the far side.
          // No disableDepthTestDistance — labels get properly occluded by the globe.
          showBackground:false
        },
        show:true
      }));
    });
    on=true;
    console.log('[BDOC] Major country labels: '+entities.length+' nations');
  }
  function toggle(){
    if(!entities.length){build();return}
    on=!on;
    entities.forEach(e=>e.show=on);
    if(typeof af==='function')af('var(--bl)','Country labels: '+(on?'ON':'OFF'));
  }
  return {build,toggle,get on(){return on}};
})();

// Build country labels AFTER Cesium settles (Phase 15f: was synchronous at load — could overlap
// with terrain/imagery hydration and trigger render-array errors). 2.5s defer gives the boot
// sequence time to finish before adding 32 label entities at once.
setTimeout(()=>{
  try{BDOC.MajorLabels.build()}catch(e){console.warn('[BDOC] MajorLabels build failed:',e)}
},2500);

// ── COCOM ROUTE LINES — glowing arcs between key regions (animated) ──
BDOC.RouteLines = (function(){
  // Stylized routes between key strategic hubs (mirroring the promo's connection lines)
  const ROUTES = [
    {from:[-77.04,38.91],to:[2.35,48.86],lbl:'WASHINGTON ⇄ PARIS'},      // DC-Paris
    {from:[-77.04,38.91],to:[139.69,35.69],lbl:'WASHINGTON ⇄ TOKYO'},     // DC-Tokyo
    {from:[2.35,48.86],to:[37.62,55.75],lbl:'PARIS ⇄ MOSCOW'},            // Paris-Moscow
    {from:[37.62,55.75],to:[116.40,39.90],lbl:'MOSCOW ⇄ BEIJING'},        // Moscow-Beijing
    {from:[116.40,39.90],to:[77.21,28.61],lbl:'BEIJING ⇄ DELHI'},          // Beijing-Delhi
    {from:[51.42,35.69],to:[35.21,31.78],lbl:'TEHRAN ⇄ JERUSALEM'},        // Tehran-Jerusalem
    {from:[-118.24,34.05],to:[151.21,-33.87],lbl:'LA ⇄ SYDNEY'},           // LA-Sydney
    {from:[28.98,41.00],to:[55.27,25.20],lbl:'ISTANBUL ⇄ DUBAI'},          // Istanbul-Dubai
  ];
  let entities = [];
  let on = false;
  function buildArc(p0,p1,steps){
    // Great-circle arc with altitude bump for visibility on globe
    const pts=[];
    const c0=Cesium.Cartographic.fromDegrees(p0[0],p0[1]);
    const c1=Cesium.Cartographic.fromDegrees(p1[0],p1[1]);
    const geodesic=new Cesium.EllipsoidGeodesic(c0,c1);
    const N=steps||64;
    const distance=geodesic.surfaceDistance;
    for(let i=0;i<=N;i++){
      const t=i/N;
      const interp=geodesic.interpolateUsingFraction(t);
      // Parabolic altitude bump (max ~6% of arc length, capped at 800km)
      const alt=Math.min(800000,distance*0.06)*Math.sin(Math.PI*t);
      pts.push(interp.longitude*180/Math.PI,interp.latitude*180/Math.PI,alt);
    }
    return pts;
  }
  function build(){
    if(!V||entities.length)return;
    ROUTES.forEach(r=>{
      const positions=buildArc(r.from,r.to,72);
      entities.push(V.entities.add({
        polyline:{
          positions:Cesium.Cartesian3.fromDegreesArrayHeights(positions),
          width:2.5,
          // Animated dashed glow — looks like signals/data flowing along the arc
          material:new Cesium.PolylineDashMaterialProperty({
            color:Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.85),
            dashLength:18,
            gapColor:Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.06)
          })
        },
        show:false  // default OFF — user opts in via button
      }));
      // Add small glow nodes at each endpoint
      [r.from,r.to].forEach(p=>{
        entities.push(V.entities.add({
          position:Cesium.Cartesian3.fromDegrees(p[0],p[1]),
          point:{
            pixelSize:6,
            color:Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.9),
            outlineColor:Cesium.Color.WHITE.withAlpha(0.6),
            outlineWidth:1.5,
            // Phase 15 fix: was POSITIVE_INFINITY — caused route nodes on far side of globe to show through.
            disableDepthTestDistance:5e6,
            scaleByDistance:new Cesium.NearFarScalar(1e6,1.6,3e7,0.7)
          },
          show:false
        }));
      });
    });
    console.log('[BDOC] Route lines built: '+ROUTES.length+' arcs');
  }
  function toggle(){
    if(!entities.length)build();
    on=!on;
    entities.forEach(e=>e.show=on);
    if(typeof af==='function')af('var(--bl)','Route arcs: '+(on?'ON':'OFF'));
    const btn=document.getElementById('btnRouteArcs');
    if(btn)btn.classList.toggle('bm-active',on);
  }
  return {build,toggle,get on(){return on}};
})();

// ── CINEMATIC TOUR — pre-scripted camera flythrough of strategic regions ──
// Mirrors the Shuto4ka promo cadence: globe overview → COCOMs → globe.
BDOC.CinematicTour = (function(){
  const STOPS = [
    {lbl:'GLOBAL OVERVIEW',         lon:30,   lat:20,    h:20000000, dur:3.0},
    {lbl:'CONUS · NORTHCOM',         lon:-98,  lat:39,    h:5500000,  dur:3.5},
    {lbl:'EUCOM · NATO',             lon:14,   lat:50,    h:4000000,  dur:3.5},
    {lbl:'CENTCOM · MIDDLE EAST',    lon:51,   lat:33,    h:3800000,  dur:3.5},
    {lbl:'RUSSIA',                   lon:90,   lat:60,    h:6000000,  dur:3.5},
    {lbl:'INDOPACOM · CHINA · INDIA',lon:100,  lat:30,    h:5500000,  dur:3.5},
    {lbl:'JAPAN · KOREA',            lon:130,  lat:37,    h:3500000,  dur:3.0},
    {lbl:'GLOBAL OVERVIEW',          lon:30,   lat:20,    h:20000000, dur:3.5},
  ];
  let running = false;
  let abortRequested = false;
  let bannerEl = null;
  function ensureBanner(){
    if(bannerEl)return bannerEl;
    bannerEl=document.createElement('div');
    bannerEl.id='tourBanner';
    bannerEl.innerHTML='<div class="tour-lbl"></div><button class="tour-skip" onclick="BDOC.CinematicTour.stop()">SKIP TOUR ✕</button>';
    document.body.appendChild(bannerEl);
    return bannerEl;
  }
  async function start(){
    if(!V||running)return;
    running=true;abortRequested=false;
    ensureBanner();
    bannerEl.classList.add('show');
    if(typeof af==='function')af('var(--bl)','Cinematic tour started — '+STOPS.length+' stops');
    for(const s of STOPS){
      if(abortRequested)break;
      const lblEl=bannerEl.querySelector('.tour-lbl');
      if(lblEl)lblEl.textContent=s.lbl;
      await new Promise(resolve=>{
        V.camera.flyTo({
          destination:Cesium.Cartesian3.fromDegrees(s.lon,s.lat,s.h),
          orientation:{heading:0,pitch:Cesium.Math.toRadians(-75),roll:0},
          duration:s.dur,
          complete:resolve,
          cancel:resolve,
          easingFunction:Cesium.EasingFunction.CUBIC_IN_OUT
        });
      });
      // Brief pause between stops
      if(!abortRequested)await new Promise(r=>setTimeout(r,800));
    }
    stop();
  }
  function stop(){
    abortRequested=true;
    running=false;
    if(bannerEl)bannerEl.classList.remove('show');
    try{V.camera.cancelFlight&&V.camera.cancelFlight()}catch(_){}
    if(typeof af==='function')af('var(--bl)','Cinematic tour ended');
  }
  return {start,stop,get running(){return running}};
})();
window.startCinematicTour=()=>BDOC.CinematicTour.start();
window.toggleRouteArcs=()=>BDOC.RouteLines.toggle();
window.toggleCountryLabels=()=>BDOC.MajorLabels.toggle();

