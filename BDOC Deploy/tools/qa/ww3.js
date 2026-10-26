(async()=>{
  const log=[];const ok=(n,c,d)=>log.push((c?'PASS ':'FAIL ')+n+(d?' — '+d:''));
  const sl=ms=>new Promise(r=>setTimeout(r,ms));
  const errs=[];window.addEventListener('error',e=>errs.push(e.message));
  window.prompt=(m,d)=>d||'5,10,25';window.confirm=()=>true;
  try{
    BDOC_Auth.tier='enterprise';if(!battleMode)enterBattleMode();
    const b0=battleEntities.length;
    // ── Taiwan Strait WW3 picture ──
    // friendly units (3 affiliations)
    const aff=document.getElementById('bp-affiliation');
    aff.value='friendly';for(const[la,lo]of[[24.1,120.5],[24.2,120.6],[23.9,120.4]])placeBattleUnit(la,lo);
    aff.value='hostile';for(const[la,lo]of[[24.5,118.1],[24.6,118.3],[24.4,118.0],[25.0,119.0]])placeBattleUnit(la,lo);
    aff.value='neutral';placeBattleUnit(24.0,121.0);
    ok('8 units (3 affiliations)',battleEntities.length-b0===8,'be +'+(battleEntities.length-b0));
    // every tactical marker
    let i=0;for(const t of Object.keys(TACTICAL_MARKERS)){placeTacticalMarker(t,24.0+i*0.05,120.0+i*0.05);i++}
    // building outline (polygon)
    setBattleTool('outline');const n1=battleEntities.length;
    for(const[la,lo]of[[24.15,120.65],[24.15,120.66],[24.16,120.66],[24.16,120.65]])handleOutlineClick(la,lo);
    finishOutline();ok('building outline',battleEntities.length>n1,'be +'+(battleEntities.length-n1));
    // zone / EA / minefield
    setBattleTool('polygon');const n2=battleEntities.length;for(const[la,lo]of[[24.3,119.5],[24.3,119.8],[24.5,119.8]])handlePolygonClick(la,lo);finishPolygon();
    setBattleTool('engagement_area');for(const[la,lo]of[[24.6,119.5],[24.6,119.8],[24.8,119.8]])handlePolygonClick(la,lo);finishTacticalZone('engagement_area');
    setBattleTool('minefield_area');for(const[la,lo]of[[23.6,119.5],[23.6,119.8],[23.8,119.8]])handlePolygonClick(la,lo);finishTacticalZone('minefield_area');
    ok('zone + EA + minefield',battleEntities.length-n2===3,'be +'+(battleEntities.length-n2));
    // lines
    const n3=battleEntities.length;
    for(const t of['phase_line','feba','coord_line','msr']){setBattleTool(t);handleLineClick(24.0,119.0+Math.random()*.1);handleLineClick(24.5,119.2);handleLineClick(25.0,119.0);finishTacticalLine(t)}
    ok('PL/FEBA/FSCL/MSR',battleEntities.length-n3===4,'be +'+(battleEntities.length-n3));
    // circle, rect, range rings, bullseye, casevac, annotation
    const n4=battleEntities.length;
    setBattleTool('circle');handleCircleClick(24.2,120.2);handleCircleClick(24.25,120.25);
    setBattleTool('rect');handleRectClick(23.5,120.0);handleRectClick(23.7,120.3);
    setBattleTool('range_rings');placeRangeRings(24.5,118.2);
    setBattleTool('bullseye');placeBullseye(24.3,119.6);
    setBattleTool('casevac');placeCASEVAC(24.12,120.55);
    setBattleTool('annotation');placeAnnotation(24.05,120.45);
    ok('circle/rect/rings/bullseye/casevac/annotation',battleEntities.length-n4>=5,'be +'+(battleEntities.length-n4));
    // comment/tag on an entity
    const unit=battleEntities.find(e=>e&&!Array.isArray(e)&&battleMeta.get(e)&&battleMeta.get(e).type!=='tactical');
    let cm='n/a';try{const m=battleMeta.get(unit);m.comment='2/7 Cav holding, low on Class V';m.label=m.label+' #TAG1';unit.description=buildEntityPopup({title:m.label,lat:24.1,lon:120.5,comment:m.comment,color:m.color||'#fff'});cm=m.comment}catch(e){cm='ERR '+e.message}
    ok('comment/tag on unit',cm.startsWith('2/7'),cm);
    // undo once, delete one
    const n5=battleEntities.length;BDOCUndo.undo();ok('undo',battleEntities.length===n5-1,n5+'→'+battleEntities.length);
    const n6=battleEntities.length;BDOCUndo.remove(battleEntities[0]);ok('delete one',battleEntities.length===n6-1,n6+'→'+battleEntities.length);
    // exports
    const gj=BDOCPlan.toGeoJSON();const ty={};gj.features.forEach(f=>{ty[f.geometry.type]=(ty[f.geometry.type]||0)+1});
    ok('GeoJSON geometry mix',gj.features.length>=20&&ty.Polygon>0&&ty.LineString>0,JSON.stringify(ty));
    let cot='';try{cot=buildCoT?String(BDOCPlan.cotEvents().length)+' CoT events':'no buildCoT'}catch(e){cot='ERR '+e.message}ok('CoT export',/^\d+ CoT/.test(cot)&&parseInt(cot)>0,cot);
    // save
    await sl(2500);const r=await Promise.race([BDOCPlan.saveNow(),sl(8000).then(()=>'TO')]);
    const d=await Promise.race([BDOCOfflineStore.getMeta('battle_plan_v1'),sl(5000).then(()=>null)]);
    ok('autosave',d&&d.items.length===battleEntities.length,'saved='+(d?d.items.length:null)+' be='+battleEntities.length+' saveNow='+r);
    window.__expect=battleEntities.length;
    ok('no JS errors',errs.length===0,errs.slice(0,3).join(' | '));
    for(const id of['bdocWelcome','bdocFirstRun','outageBanner','casevacModal','cotCasevacModal','bdocCasevac']){const m=document.getElementById(id);if(m)m.style.display='none'}document.querySelectorAll('[id^=bdocFirstRun]').forEach(m=>m.style.display='none');document.querySelectorAll('div').forEach(d=>{if(d.textContent.includes('CASEVAC 9-LINE REQUEST')&&getComputedStyle(d).position==='fixed')d.style.display='none'});
    try{V.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(119.6,24.2,260000),duration:0})}catch(_){}await sl(2500);
  }catch(e){log.push('HARNESS ERR '+e.message+' @ '+(e.stack||'').split('\n')[1])}
  return log.join('\n');
})()