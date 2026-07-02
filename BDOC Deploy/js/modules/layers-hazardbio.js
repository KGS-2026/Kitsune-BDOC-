// ═══════════════════════════════════════════════════════════
// BDOC MODULE: layers-hazardbio.js — BIOLOGICAL HAZARD LAYER
// Phase 2 moat feature (2026-07-02). Research-grade species observations
// (iNaturalist via proxy-hazardbio) for medically-significant species:
// ticks, venomous snakes, venomous spiders, stinging insects, scorpions.
// Viewport-driven: fetches what the camera sees; refetches on big moves.
// Depends on: V, Cesium, layers, af(), EventLog
// © 2026 Kitsune Global Solutions LLC
// ═══════════════════════════════════════════════════════════
var hazardBioEnts = [];
var _hazbioCats = {
  ticks:    { color:'#E8B349', label:'TICKS',           risk:'Lyme, RMSF, alpha-gal. Grass/brush contact = exposure. Permethrin-treat, tuck, check every 4h.' },
  vsnakes:  { color:'#ff4444', label:'VENOMOUS SNAKES', risk:'Pit vipers + coral snakes. Watch hand/foot placement; deadfall, rock ledges, water edges.' },
  vspiders: { color:'#c86bff', label:'VENOMOUS SPIDERS',risk:'Widow + recluse. Woodpiles, outbuildings, gear left overnight. Shake out boots.' },
  vinsects: { color:'#ff9500', label:'STINGING INSECTS',risk:'Hornets/wasps/fire ants. Anaphylaxis risk — ground nests in disturbed soil.' },
  scorp:    { color:'#66ffcc', label:'SCORPIONS',       risk:'Nocturnal, under debris/rocks. Shake out boots and sleep systems.' }
};
var _hazbioActive = new Set();   // active sub-categories
var _hazbioLastFetch = { key:'', t:0 };
var _hazbioMoveHandler = null;

function _hazbioBounds(){
  try{
    const rect = V.camera.computeViewRectangle(V.scene.globe.ellipsoid);
    if(!rect) return null;
    return {
      nelat: Math.min(90, Cesium.Math.toDegrees(rect.north)).toFixed(3),
      nelng: Math.min(180, Cesium.Math.toDegrees(rect.east)).toFixed(3),
      swlat: Math.max(-90, Cesium.Math.toDegrees(rect.south)).toFixed(3),
      swlng: Math.max(-180, Cesium.Math.toDegrees(rect.west)).toFixed(3)
    };
  }catch(e){ return null; }
}

function _hazbioMakeIcon(color){
  // biohazard-adjacent warning diamond — distinct from every other layer glyph
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 32 32">
    <path d="M16 3 L29 16 L16 29 L3 16 Z" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="1.6"/>
    <path d="M16 9 L16 18" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="16" cy="22.5" r="1.6" fill="${color}"/></svg>`;
  return svgToDataUri(svg);
}

async function loadHazardBio(){
  if(!V) return;
  const b = _hazbioBounds();
  if(!b) return;
  const cats = [..._hazbioActive];
  if(!cats.length) return;
  const key = cats.join(',')+'|'+b.nelat+'|'+b.swlng;
  // Skip redundant refetch (same cats + near-identical viewport within 60s)
  if(key === _hazbioLastFetch.key && Date.now()-_hazbioLastFetch.t < 60000) return;
  _hazbioLastFetch = { key, t: Date.now() };
  // Camera too high → observations are point data; cap at continent scale
  const h = V.camera.positionCartographic?.height || 0;
  if(h > 9e6){ af('var(--yl)','Bio-hazard layer: zoom in to regional level for species data'); return; }

  hazardBioEnts.forEach(e=>{try{V.entities.remove(e)}catch(_){}});
  hazardBioEnts = [];
  let total = 0;
  await Promise.all(cats.map(async cat=>{
    const c = _hazbioCats[cat];
    try{
      const res = await fetch(`/.netlify/functions/proxy-hazardbio?category=${cat}&nelat=${b.nelat}&nelng=${b.nelng}&swlat=${b.swlat}&swlng=${b.swlng}&limit=200`,{signal:AbortSignal.timeout(10000)});
      if(!res.ok) throw new Error('hazardbio '+res.status);
      const j = await res.json();
      const icon = _hazbioMakeIcon(c.color);
      (j.data||[]).forEach(o=>{
        total++;
        hazardBioEnts.push(V.entities.add({
          name: (o.common||o.sci||'Hazard species'),
          position: Cesium.Cartesian3.fromDegrees(o.lon, o.lat),
          billboard: { image: icon, width: 26, height: 26, scaleByDistance: new Cesium.NearFarScalar(5e4,1.2,3e6,0.4), verticalOrigin: Cesium.VerticalOrigin.CENTER, disableDepthTestDistance: 5e6 },
          description: `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:360px;background:#0a0e14;padding:14px;border-radius:2px;border:1px solid ${c.color}33;color:#c8ccd6">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #1e2436">
              <b style="color:${c.color};letter-spacing:1px">${c.label}</b>
              <span style="font-size:8px;color:#4a5068">${o.date||''}</span></div>
            <div style="font-size:13px;font-weight:700;margin-bottom:2px">${(o.common||o.sci||'').replace(/[<>&]/g,'')}</div>
            <div style="font-size:9px;color:#667;font-style:italic;margin-bottom:8px">${(o.sci||'').replace(/[<>&]/g,'')}</div>
            ${o.photo?`<img src="${o.photo}" style="width:100%;max-height:170px;object-fit:cover;border-radius:2px;margin-bottom:8px" onerror="this.style.display='none'">`:''}
            <div style="background:${c.color}11;border:1px solid ${c.color}33;border-radius:2px;padding:7px;font-size:9px;line-height:1.5;margin-bottom:6px"><b style="color:${c.color}">FIELD RISK:</b> ${c.risk}</div>
            <div style="font-size:8px;color:#4a5068">Research-grade observation \u2014 ${Number(o.lat).toFixed(4)}, ${Number(o.lon).toFixed(4)}<br>Source: iNaturalist community science</div>
          </div>`,
          show: true
        }));
      });
    }catch(e){ console.warn('[hazardbio] '+cat, e.message); }
  }));
  af('var(--gn)',`Bio-hazard layer: ${total} verified observations in view \u2014 ${cats.map(x=>_hazbioCats[x].label).join(', ')}`);
  try{EventLog.add('info','HazardBio: '+total+' obs loaded ('+cats.join(',')+')')}catch(_){}
  // Refetch on significant camera moves (debounced)
  if(!_hazbioMoveHandler){
    let t=null;
    _hazbioMoveHandler = V.camera.moveEnd.addEventListener(()=>{
      if(!layers.hazardbio) return;
      clearTimeout(t); t=setTimeout(()=>loadHazardBio(), 1200);
    });
  }
}

function toggleHazardBioCat(cat, el){
  if(_hazbioActive.has(cat)){ _hazbioActive.delete(cat); if(el)el.classList.remove('on'); }
  else { _hazbioActive.add(cat); if(el)el.classList.add('on'); }
  _hazbioLastFetch = { key:'', t:0 }; // force refetch
  if(_hazbioActive.size===0){
    hazardBioEnts.forEach(e=>{try{V.entities.remove(e)}catch(_){}});
    hazardBioEnts=[];
    return;
  }
  loadHazardBio();
}

function hideHazardBio(){
  hazardBioEnts.forEach(e=>{try{V.entities.remove(e)}catch(_){}});
  hazardBioEnts=[];
}
window.loadHazardBio = loadHazardBio;
window.toggleHazardBioCat = toggleHazardBioCat;
window.hideHazardBio = hideHazardBio;
