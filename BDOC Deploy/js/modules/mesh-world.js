// ============================================================
// BDOC P155 MODULE: mesh-world.js — MESHTASTIC WORLD MAP + RELAY ROUTER
// ------------------------------------------------------------
// Every Meshtastic node on Earth that reports to the public MQTT maps (~20k with
// a position), merged server-side by netlify/functions/proxy-meshworld.js from
// meshtastic.liamcottle.net + meshmap.net. Drawn as GPU point primitives so the
// whole planet stays smooth.
//
// ROUTE A MESSAGE: pick where you are (a node, your GPS, or a map point) and the
// target (a node or a map point). BDOC finds the chain of nodes to bounce through:
//   · measured RF neighbour links (NeighborInfo, with SNR)      — best evidence
//   · "heard by MQTT gateway" links (may already be relayed)    — medium
//   · predicted in-range links (distance only, same region/preset) — weakest
// within Meshtastic's hop limit (default 3 relays, max 7), and says why each hop
// is there. No path → shows the gap and where a relay node would close it.
//
// Depends on: V, Cesium, af(), BDOCRender
// Loaded lazily: BDOC.LazyLoader.load('mesh-world').then(()=>MeshWorld.enable())
// © 2026 Kitsune Global Solutions LLC
// ============================================================
(function(){
'use strict';
if(window.MeshWorld)return;

const SRC='/.netlify/functions/proxy-meshworld';
const REFRESH_MS=10*60*1000;
const R_EARTH=6371008.8;
const ROLE_GROUP=r=>{r=r||'';if(/ROUTER|REPEATER/.test(r))return'router';if(r==='CLIENT_BASE')return'base';if(/TRACKER|TAK|LOST/.test(r))return'tracker';if(r==='SENSOR')return'sensor';return'client';};
const GROUP_COL={router:'#FFAB40',base:'#40C4FF',client:'#76FF03',tracker:'#FF4081',sensor:'#FFEB3B'};
const GROUP_LBL={router:'Router / repeater',base:'Client base',client:'Client',tracker:'Tracker / TAK',sensor:'Sensor'};
const SNR_CLASSES=[{min:0,col:'#00E676',lbl:'≥ 0 dB'},{min:-10,col:'#FFD740',lbl:'−10…0 dB'},{min:-99,col:'#FF6E40',lbl:'< −10 dB'},{min:null,col:'#B0BEC5',lbl:'no SNR'}];

const MW=window.MeshWorld={
  on:false,data:null,loadedAt:0,timer:null,
  pts:null,labels:null,lines:null,routeEnts:[],
  opts:{ageH:24,rf:true,gw:false,labels:true,rangeKm:8,maxRelays:3},
  from:null,to:null,pickMode:null,sel:null,handler:null,_g:null
};
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=(c,m)=>{try{af(c,m)}catch(_){console.log('[MeshWorld]',m)}};
const kick=()=>{try{V.scene.requestRender()}catch(_){}};
// Entity polylines build their geometry on web workers; in on-demand render mode the
// finished line only appears on the NEXT frame, which may never come. Render
// continuously for a moment after adding them.
let _settleT=null;
function settle(ms){try{BDOCRender.hold('meshworld-draw');clearTimeout(_settleT);_settleT=setTimeout(()=>{try{BDOCRender.release('meshworld-draw')}catch(_){}},ms||3500);}catch(_){kick();}}
const hex=id=>'!'+(id>>>0).toString(16).padStart(8,'0');
function km(aLat,aLon,bLat,bLon){const r=Math.PI/180,dl=(bLat-aLat)*r,dn=(bLon-aLon)*r;const x=Math.sin(dl/2)**2+Math.cos(aLat*r)*Math.cos(bLat*r)*Math.sin(dn/2)**2;return 2*R_EARTH*Math.asin(Math.sqrt(x))/1000;}
function ago(sec){const s=Date.now()/1000-sec;if(s<90)return Math.max(0,Math.round(s))+' s ago';if(s<5400)return Math.round(s/60)+' min ago';if(s<172800)return Math.round(s/3600)+' h ago';return Math.round(s/86400)+' d ago';}

// ── data ────────────────────────────────────────────────────
async function load(){
  const ctl=new AbortController();const to=setTimeout(()=>ctl.abort(),25000);
  try{
    setStatus('Loading world node map…');
    const r=await fetch(SRC,{signal:ctl.signal});
    const j=await r.json();
    if(!r.ok||!Array.isArray(j.nodes))throw new Error(j.error||('HTTP '+r.status));
    const N=j.nodes.length;
    const d={raw:j,N,lat:new Float64Array(N),lon:new Float64Array(N),alt:new Float32Array(N),t:new Float64Array(N),grp:new Array(N),byId:new Map()};
    j.nodes.forEach((n,i)=>{d.lat[i]=n[1];d.lon[i]=n[2];d.alt[i]=Math.max(0,Math.min(5000,n[3]||0));d.t[i]=n[9];d.grp[i]=ROLE_GROUP(j.dict.role[n[7]]);d.byId.set(n[0],i);});
    d.nbr=Array.from({length:N},()=>[]);
    j.links.forEach((l,k)=>{d.nbr[l[0]].push(k);d.nbr[l[1]].push(k);});
    MW.data=d;MW.loadedAt=Date.now();MW._g=null;
    draw();
    setStatus(null);
    return true;
  }catch(e){
    setStatus('Node map unavailable: '+(e.name==='AbortError'?'timed out':e.message)+' — retrying in 2 min');
    clearTimeout(MW.timer);MW.timer=setTimeout(()=>{if(MW.on)load();},120000);
    return false;
  }finally{clearTimeout(to);}
}
const node=i=>MW.data.raw.nodes[i];
const nodeName=i=>{const n=node(i);return n[5]||n[4]||hex(n[0]);};
const fresh=i=>Date.now()/1000-MW.data.t[i]<=MW.opts.ageH*3600;
const dictv=(k,v)=>v>=0?MW.data.raw.dict[k][v]:null;

// ── drawing (primitives, not entities: 20k points stay at 60 fps) ─
function clearPrims(){
  ['pts','labels','lines'].forEach(k=>{if(MW[k]){try{V.scene.primitives.remove(MW[k])}catch(_){}MW[k]=null;}});
}
function pos(i,lift){const d=MW.data;return Cesium.Cartesian3.fromDegrees(d.lon[i],d.lat[i],d.alt[i]+(lift||25));}
function horizon(){const h=Math.max(1,V.camera.positionCartographic.height);return Math.sqrt((R_EARTH+h)**2-R_EARTH**2)*0.98;}
function arc(aLat,aLon,aH,bLat,bLon,bH,segs){
  const g=new Cesium.EllipsoidGeodesic(Cesium.Cartographic.fromDegrees(aLon,aLat),Cesium.Cartographic.fromDegrees(bLon,bLat));
  const dist=g.surfaceDistance||0;const n=segs||Math.max(2,Math.min(24,Math.ceil(dist/15000)));const lift=Math.min(dist*0.04,25000);
  const out=[];for(let s=0;s<=n;s++){const t=s/n,c=g.interpolateUsingFraction(t);out.push(Cesium.Cartesian3.fromRadians(c.longitude,c.latitude,aH+(bH-aH)*t+Math.sin(Math.PI*t)*lift+30));}
  return out;
}
function draw(){
  if(!MW.data||!MW.on)return;
  clearPrims();
  const d=MW.data,dd=horizon();
  MW.pts=V.scene.primitives.add(new Cesium.PointPrimitiveCollection({blendOption:Cesium.BlendOption.OPAQUE_AND_TRANSLUCENT}));
  const sbd=new Cesium.NearFarScalar(2e4,1.6,1.2e7,0.55);
  const black=Cesium.Color.BLACK.withAlpha(0.85);
  const colCache={};
  for(let i=0;i<d.N;i++){
    const g=d.grp[i];const recent=Date.now()/1000-d.t[i]<3600;
    const ck=g+(recent?1:0);
    const col=colCache[ck]||(colCache[ck]=Cesium.Color.fromCssColorString(GROUP_COL[g]).withAlpha(recent?1:0.62));
    MW.pts.add({position:pos(i),pixelSize:g==='router'?7:5,color:col,outlineColor:black,outlineWidth:1,
      scaleByDistance:sbd,disableDepthTestDistance:dd,id:{mw:i},show:fresh(i)});
  }
  // links: one shared material per class keeps this to a handful of draw calls
  MW.lines=V.scene.primitives.add(new Cesium.PolylineCollection());
  const mats=SNR_CLASSES.map(c=>Cesium.Material.fromType('Color',{color:Cesium.Color.fromCssColorString(c.col).withAlpha(0.75)}));
  const gwMat=Cesium.Material.fromType('Color',{color:Cesium.Color.fromCssColorString('#82B1FF').withAlpha(0.28)});
  const order=d.raw.links.map((l,k)=>k).sort((a,b)=>clsOf(d.raw.links[a])-clsOf(d.raw.links[b]));
  MW._lineByLink=new Map();
  for(const k of order){
    const l=d.raw.links[k];const a=l[0],b=l[1];
    const pl=MW.lines.add({positions:arc(d.lat[a],d.lon[a],d.alt[a],d.lat[b],d.lon[b],d.alt[b]),width:l[3]===0?1.6:1,
      material:l[3]===0?mats[clsOf(l)]:gwMat,id:{mwl:k},show:false});
    MW._lineByLink.set(k,pl);
  }
  MW.labels=V.scene.primitives.add(new Cesium.LabelCollection());
  applyVisibility();refreshLabels();renderPanel();kick();
}
function clsOf(l){if(l[3]!==0)return 9;if(l[2]===null)return 3;return l[2]>=0?0:l[2]>=-10?1:2;}
function applyVisibility(){
  const d=MW.data;if(!d||!MW.pts)return;
  for(let i=0;i<d.N;i++)MW.pts.get(i).show=fresh(i);
  for(const [k,pl] of MW._lineByLink){const l=d.raw.links[k];pl.show=(l[3]===0?MW.opts.rf:MW.opts.gw)&&fresh(l[0])&&fresh(l[1]);}
  kick();
}
function onCamera(){
  if(!MW.on||!MW.pts)return;
  const dd=horizon();const n=MW.pts.length;for(let i=0;i<n;i++)MW.pts.get(i).disableDepthTestDistance=dd;
  refreshLabels();
}
function refreshLabels(){
  if(!MW.labels)return;MW.labels.removeAll();
  if(!MW.opts.labels)return;
  const h=V.camera.positionCartographic.height;if(h>140000){kick();return;}
  const c=V.camera.pickEllipsoid(new Cesium.Cartesian2(V.scene.canvas.clientWidth/2,V.scene.canvas.clientHeight/2));if(!c)return;
  const k=Cesium.Cartographic.fromCartesian(c),cLat=Cesium.Math.toDegrees(k.latitude),cLon=Cesium.Math.toDegrees(k.longitude);
  const rad=Math.max(4,h/1000*1.1),d=MW.data,cand=[];
  const dLat=rad/111,dLon=rad/(111*Math.max(0.15,Math.cos(cLat*Math.PI/180)));
  for(let i=0;i<d.N;i++){if(Math.abs(d.lat[i]-cLat)>dLat||Math.abs(d.lon[i]-cLon)>dLon||!fresh(i))continue;cand.push([km(cLat,cLon,d.lat[i],d.lon[i]),i]);}
  // routers first (they are what you bounce off), then nearest; capped so names stay readable
  cand.sort((a,b)=>(d.grp[b[1]]==='router')-(d.grp[a[1]]==='router')||a[0]-b[0]);
  const font='10px JetBrains Mono';
  for(const [,i] of cand.slice(0,h<40000?90:45)){const n=node(i);
    MW.labels.add({position:pos(i),text:(n[4]||'')+(n[5]&&n[5]!==n[4]?' · '+n[5].slice(0,18):''),font,fillColor:Cesium.Color.fromCssColorString(GROUP_COL[d.grp[i]]),
      outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(7,-7),
      horizontalOrigin:Cesium.HorizontalOrigin.LEFT,disableDepthTestDistance:horizon(),scale:0.95});}
  kick();
}

// ── graph + routing ─────────────────────────────────────────
// Edge list (typed arrays). Virtual vertices N (from) and N+1 (to) are appended
// for "my location" / map-point ends.
function compatible(i,j){
  const n=node(i),m=node(j);
  const pi=dictv('preset',n[10]),pj=dictv('preset',m[10]);if(pi&&pj&&pi!==pj)return false;
  const ri=dictv('region',n[11]),rj=dictv('region',m[11]);if(ri&&rj&&ri!=='UNSET'&&rj!=='UNSET'&&ri!==rj)return false;
  return true;
}
function rangeFor(i){return MW.opts.rangeKm*(MW.data.grp[i]==='router'?2:1);}
function grid(cellKm){
  const d=MW.data,g=new Map();
  for(let i=0;i<d.N;i++){if(!fresh(i))continue;const k=Math.floor(d.lat[i]*111/cellKm)+':'+Math.floor(d.lon[i]*111*Math.cos(d.lat[i]*Math.PI/180)/cellKm);(g.get(k)||g.set(k,[]).get(k)).push(i);}
  return g;
}
function nearby(g,cellKm,lat,lon,maxKm,cap){
  const y=Math.floor(lat*111/cellKm),x=Math.floor(lon*111*Math.cos(lat*Math.PI/180)/cellKm),span=Math.ceil(maxKm/cellKm),out=[];
  for(let dy=-span;dy<=span;dy++)for(let dx=-span;dx<=span;dx++){const c=g.get((y+dy)+':'+(x+dx));if(!c)continue;
    for(const j of c){const dk=km(lat,lon,MW.data.lat[j],MW.data.lon[j]);if(dk<=maxKm)out.push([dk,j]);}}
  out.sort((a,b)=>a[0]-b[0]);return cap?out.slice(0,cap):out;
}
function buildGraph(){
  const key=[MW.opts.ageH,MW.opts.rangeKm,MW.opts.gw].join('|');
  if(MW._g&&MW._g.key===key)return MW._g;
  const d=MW.data,U=[],Vv=[],C=[],K=[],S=[],D=[];
  const seen=new Set();
  const add=(a,b,c,k,s,dist)=>{const kk=a<b?a+':'+b:b+':'+a;if(seen.has(kk))return;seen.add(kk);U.push(a);Vv.push(b);C.push(c);K.push(k);S.push(s);D.push(dist);};
  for(const l of d.raw.links){
    const [a,b,snr,kind]=l;if(!fresh(a)||!fresh(b))continue;if(kind===1&&!MW.opts.gw)continue;
    const dist=km(d.lat[a],d.lon[a],d.lat[b],d.lon[b]);
    if(kind===0)add(a,b,1+(snr!==null&&snr<-7?Math.min(2,(-7-snr)*0.12):0)+dist/400,0,snr,dist);
    else add(a,b,1.6+dist/120,1,null,dist);
  }
  if(MW.opts.rangeKm>0){
    const cell=Math.max(2,MW.opts.rangeKm),g=grid(cell);
    for(let i=0;i<d.N;i++){if(!fresh(i))continue;
      for(const [dk,j] of nearby(g,cell,d.lat[i],d.lon[i],rangeFor(i)*1,24)){
        if(j===i)continue;const R=Math.max(rangeFor(i),rangeFor(j));if(dk>R||!compatible(i,j))continue;
        add(i,j,2+2*(dk/R)**2,2,null,dk);}
    }
    MW._grid={g,cell};
  }
  MW._g={key,U,V:Vv,C,K,S,D,n:U.length};
  return MW._g;
}
function endpointEdges(end,vid){
  // a node end maps straight to its index; a location end becomes a virtual vertex
  if(end.kind==='node')return{v:end.i,extra:[]};
  const R=MW.opts.rangeKm||8;const {g,cell}=MW._grid||(()=>{const c=Math.max(2,R);return MW._grid={g:grid(c),cell:c};})();
  const extra=nearby(g,cell,end.lat,end.lon,Math.max(R,2)*2,30).filter(([dk,j])=>dk<=rangeFor(j)*1.0||dk<=R).map(([dk,j])=>[vid,j,2+2*(dk/Math.max(R,rangeFor(j)))**2,2,null,dk]);
  return{v:vid,extra};
}
// Hop-limited Bellman–Ford: cheapest path using at most H edges.
function bf(G,extra,M,src,dst,H){
  const U=G.U.concat(extra.map(e=>e[0])),Vv=G.V.concat(extra.map(e=>e[1])),C=G.C.concat(extra.map(e=>e[2]));
  const E2=U.length;let dist=new Float64Array(M).fill(Infinity);dist[src]=0;
  const prev=[],via=[];
  for(let h=1;h<=H;h++){
    const nd=Float64Array.from(dist),pv=new Int32Array(M).fill(-1),ve=new Int32Array(M).fill(-1);let changed=false;
    for(let e=0;e<E2;e++){const a=U[e],b=Vv[e],c=C[e];
      if(dist[a]+c<nd[b]){nd[b]=dist[a]+c;pv[b]=a;ve[b]=e;changed=true;}
      if(dist[b]+c<nd[a]){nd[a]=dist[b]+c;pv[a]=b;ve[a]=e;changed=true;}}
    prev.push(pv);via.push(ve);dist=nd;if(!changed)break;
  }
  if(!isFinite(dist[dst]))return null;
  const path=[dst],edges=[];let v=dst;
  for(let h=prev.length-1;h>=0&&v!==src;h--){const u=prev[h][v];if(u===-1)continue;edges.unshift(via[h][v]);path.unshift(u);v=u;}
  if(v!==src)return null;
  const meta=e=>e<G.n?{k:G.K[e],s:G.S[e],d:G.D[e]}:{k:2,s:null,d:extra[e-G.n][5]};
  return{path,hops:edges.map(meta),cost:dist[dst]};
}
function component(G,extra,M,start){
  const adj=Array.from({length:M},()=>[]);
  const add=(a,b)=>{adj[a].push(b);adj[b].push(a);};
  for(let e=0;e<G.n;e++)add(G.U[e],G.V[e]);extra.forEach(e=>add(e[0],e[1]));
  const seen=new Uint8Array(M);seen[start]=1;const q=[start];
  while(q.length){const x=q.pop();for(const y of adj[x])if(!seen[y]){seen[y]=1;q.push(y);}}
  return seen;
}
function endLL(end){return end.kind==='node'?{lat:MW.data.lat[end.i],lon:MW.data.lon[end.i]}:{lat:end.lat,lon:end.lon};}
function route(){
  if(!MW.data)return;
  if(!MW.from||!MW.to){toast('var(--yl)','Pick both FROM and TO');return;}
  clearRoute();
  const t0=performance.now();
  const G=buildGraph(),N=MW.data.N,M=N+2;
  const A=endpointEdges(MW.from,N),B=endpointEdges(MW.to,N+1);
  const extra=A.extra.concat(B.extra);
  if(A.v===B.v){showRoute({msg:'FROM and TO are the same node.'});return;}
  const limit=MW.opts.maxRelays+1;            // relays + 1 = links
  let r=bf(G,extra,M,A.v,B.v,limit),over=false;
  if(!r){r=bf(G,extra,M,A.v,B.v,40);over=!!r;}
  const ms=Math.round(performance.now()-t0);
  if(r){drawRoute(r);showRoute({r,over,ms});return;}
  // no path: show the closest approach between what FROM can reach and what TO can reach
  const sa=component(G,extra,M,A.v),sb=component(G,extra,M,B.v);
  const ia=[],ib=[];for(let i=0;i<N;i++){if(sa[i])ia.push(i);if(sb[i])ib.push(i);}
  const la=ia.length?null:endLL(MW.from),lb=ib.length?null:endLL(MW.to);
  let best=null;
  const pa=ia.length?ia:[-1],pb=ib.length?ib:[-1];
  const step=Math.max(1,Math.ceil(pa.length*pb.length/4e6));
  for(let x=0;x<pa.length;x+=step)for(const j of pb){
    const P=pa[x]<0?la:{lat:MW.data.lat[pa[x]],lon:MW.data.lon[pa[x]]},Q=j<0?lb:{lat:MW.data.lat[j],lon:MW.data.lon[j]};
    const dk=km(P.lat,P.lon,Q.lat,Q.lon);if(!best||dk<best.d)best={d:dk,P,Q,a:pa[x],b:j};}
  drawGap(best);showRoute({gap:best,ms,na:ia.length,nb:ib.length});
}
function routeCol(){if(!MW._routeCol||MW._routeCol.isDestroyed())MW._routeCol=V.scene.primitives.add(new Cesium.PolylineCollection());return MW._routeCol;}
function clearRoute(){MW.routeEnts.forEach(e=>{try{V.entities.remove(e)}catch(_){}});MW.routeEnts=[];if(MW._routeCol&&!MW._routeCol.isDestroyed())MW._routeCol.removeAll();kick();}
function drawRoute(r){
  const d=MW.data,pts=r.path.map(v=>v<d.N?{lat:d.lat[v],lon:d.lon[v],h:d.alt[v]}:Object.assign({h:0},endLL(v===d.N?MW.from:MW.to)));
  const all=[];
  for(let i=0;i<pts.length-1;i++){const s=arc(pts[i].lat,pts[i].lon,pts[i].h,pts[i+1].lat,pts[i+1].lon,pts[i+1].h);if(i)s.shift();all.push(...s);}
  // Drawn in our own PolylineCollection (synchronous). As entity polylines the route was built
  // on a worker and, next to 15k mesh links, did not show until something else changed.
  const gold=Cesium.Color.fromCssColorString('#FFC940');
  const rc=routeCol();
  rc.add({positions:all,width:16,material:Cesium.Material.fromType('Color',{color:gold.withAlpha(0.3)})});
  rc.add({positions:all,width:5,material:Cesium.Material.fromType('Color',{color:gold})});
  pts.forEach((p,i)=>{
    const lbl=i===0?'START':i===pts.length-1?'TARGET':'RELAY '+i;
    MW.routeEnts.push(V.entities.add({position:Cesium.Cartesian3.fromDegrees(p.lon,p.lat,p.h+30),
      point:{pixelSize:i===0||i===pts.length-1?13:10,color:Cesium.Color.fromCssColorString(i===0?'#00E676':i===pts.length-1?'#FF5252':'#E8B349'),outlineColor:Cesium.Color.BLACK,outlineWidth:2,disableDepthTestDistance:5e6},
      label:{text:lbl,font:'bold 11px JetBrains Mono',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset:new Cesium.Cartesian2(0,-18),disableDepthTestDistance:5e6,showBackground:true,backgroundColor:Cesium.Color.fromCssColorString('#0a0e14').withAlpha(0.8)}}));
  });
  frame(pts);
  settle();
}
const RF_GAP_MAX_KM=150; // beyond this, relays on the ground are not a realistic fix (oceans, continents)
function drawGap(g){
  if(!g)return;
  const red=Cesium.Color.fromCssColorString('#FF5252');
  routeCol().add({positions:arc(g.P.lat,g.P.lon,0,g.Q.lat,g.Q.lon,0,g.d>300?64:24),width:3,material:Cesium.Material.fromType('PolylineDash',{color:red,dashLength:14})});
  if(g.d>RF_GAP_MAX_KM){kick();return;}
  const R=MW.opts.rangeKm||8,n=Math.max(1,Math.ceil(g.d/(R*2))-1);
  const geo=new Cesium.EllipsoidGeodesic(Cesium.Cartographic.fromDegrees(g.P.lon,g.P.lat),Cesium.Cartographic.fromDegrees(g.Q.lon,g.Q.lat));
  const pins=Math.min(n,12);
  for(let s=1;s<=pins;s++){const c=geo.interpolateUsingFraction(s/(pins+1));
    MW.routeEnts.push(V.entities.add({position:Cesium.Cartesian3.fromRadians(c.longitude,c.latitude,0),
      billboard:{image:relayPin(),width:22,height:30,verticalOrigin:Cesium.VerticalOrigin.BOTTOM,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:5e6},
      label:{text:'PLACE RELAY',font:'bold 9px JetBrains Mono',fillColor:red,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset:new Cesium.Cartesian2(0,-34),heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:5e6,distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,2e6)}}));}
  frame([g.P,g.Q]);
  settle();
}
// fly so the whole route is visible to the right of this panel
function frame(pts){
  try{
    let w=Infinity,e=-Infinity,so=Infinity,n=-Infinity;
    pts.forEach(p=>{w=Math.min(w,p.lon);e=Math.max(e,p.lon);so=Math.min(so,p.lat);n=Math.max(n,p.lat);});
    const dx=Math.max(0.02,e-w),dy=Math.max(0.02,n-so);
    V.camera.flyTo({destination:Cesium.Rectangle.fromDegrees(w-dx*0.75,so-dy*0.3,e+dx*0.6,n+dy*0.3),duration:1.4});
  }catch(_){}
}
let _pin=null;
function relayPin(){return _pin||(_pin='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30"><path d="M11 29C11 29 2 17 2 11a9 9 0 0 1 18 0c0 6-9 18-9 18z" fill="#FF5252" stroke="#000" stroke-width="1.5"/><path d="M11 5v9M7 8a5 5 0 0 0 0 6M15 8a5 5 0 0 1 0 6" stroke="#fff" stroke-width="1.6" fill="none"/></svg>'));}

// ── panel ───────────────────────────────────────────────────
function injectCss(){
  if(document.getElementById('mwCss'))return;
  const s=document.createElement('style');s.id='mwCss';
  s.textContent=`
#mwPanel{position:fixed;left:calc(var(--lw,248px) + 14px);top:64px;z-index:119;width:318px;max-height:calc(100vh - 150px);overflow-y:auto;display:none;
  background:rgba(9,12,19,0.86);backdrop-filter:blur(18px) saturate(120%);-webkit-backdrop-filter:blur(18px) saturate(120%);border:1px solid rgba(255,255,255,0.14);border-radius:14px;
  padding:12px;font-family:var(--m,'JetBrains Mono',monospace);color:#E6E9EE;font-size:10px;box-shadow:0 12px 40px rgba(0,0,0,0.5);scrollbar-width:thin}
#mwPanel.show{display:block}
body:has(.lp.shut) #mwPanel{left:14px}
body:has(#nbProps[style*="block"]) #mwPanel{left:calc(var(--lw,248px) + 318px)}
#mwPanel.min > :not(.mw-h){display:none}
#mwPanel .mw-h{display:flex;align-items:center;gap:6px}
#mwPanel .mw-h b{color:#76FF03;letter-spacing:2px;font-size:10px;flex:1}
#mwPanel .mw-h button{background:none;border:none;color:#8B919A;font-size:14px;cursor:pointer;padding:0 3px}
#mwPanel .mw-st{color:#8B919A;font-size:9px;margin:4px 0 8px}
#mwPanel .mw-sec{margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08)}
#mwPanel .mw-sh{font-size:8px;letter-spacing:1.6px;color:#8B919A;margin-bottom:5px}
#mwPanel input[type=text],#mwPanel select{width:100%;box-sizing:border-box;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.14);border-radius:5px;color:#E6E9EE;font-family:inherit;font-size:10.5px;padding:5px 7px}
#mwPanel button.mw-b{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);color:#E6E9EE;font-family:inherit;font-size:9px;letter-spacing:.8px;padding:4px 8px;border-radius:5px;cursor:pointer}
#mwPanel button.mw-b:hover{border-color:#76FF03}
#mwPanel button.mw-b.go{background:rgba(118,255,3,0.14);border-color:#76FF03;color:#fff;font-weight:700}
#mwPanel button.mw-b.on{background:rgba(232,179,73,0.2);border-color:#E8B349}
#mwPanel .mw-row{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:5px}
#mwPanel .mw-end{flex:1;min-width:0;padding:5px 7px;border-radius:5px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#mwPanel .mw-end i{font-style:normal;color:#8B919A;font-size:8px;letter-spacing:1px;margin-right:5px}
#mwPanel label.mw-ck{display:inline-flex;align-items:center;gap:4px;margin-right:8px;color:#AEB4BE;font-size:9px;cursor:pointer}
#mwPanel label.mw-ck input{accent-color:#76FF03;margin:0}
#mwPanel .mw-lg{display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;font-size:9px;color:#AEB4BE}
#mwPanel .mw-lg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:-1px;box-shadow:0 0 0 1px #000}
#mwPanel .mw-lg s{display:inline-block;width:14px;height:3px;margin-right:5px;vertical-align:2px;text-decoration:none}
#mwPanel .mw-res div,#mwPanel .mw-hop{padding:4px 6px;border-radius:4px;cursor:pointer}
#mwPanel .mw-res div:hover,#mwPanel .mw-hop:hover{background:rgba(255,255,255,0.06)}
#mwPanel .mw-hop{display:grid;grid-template-columns:18px 1fr;gap:2px 6px;cursor:default}
#mwPanel .mw-hop em{grid-column:2;font-style:normal;color:#8B919A;font-size:8.5px}
#mwPanel .mw-n{color:#E8B349;font-weight:700}
#mwPanel .mw-warn{margin-top:6px;padding:6px 8px;border-radius:5px;background:rgba(255,82,82,0.1);border:1px solid rgba(255,82,82,0.35);color:#FFB3B0;font-size:9px;line-height:1.45}
#mwPanel .mw-ok{margin-top:6px;padding:6px 8px;border-radius:5px;background:rgba(118,255,3,0.08);border:1px solid rgba(118,255,3,0.3);color:#CCFF90;font-size:9px;line-height:1.45}
#mwPanel .mw-kv{display:grid;grid-template-columns:76px 1fr;gap:2px 6px;font-size:9.5px}
#mwPanel .mw-kv span:nth-child(odd){color:#8B919A}
#mwPanel .mw-attr{margin-top:10px;font-size:8px;color:#5C636B;line-height:1.4}
`;
  document.head.appendChild(s);
}
function setStatus(m){MW._status=m;renderPanel();}
function renderPanel(){
  let p=document.getElementById('mwPanel');
  if(!MW.on){if(p)p.classList.remove('show');return;}
  if(!p){injectCss();p=document.createElement('div');p.id='mwPanel';document.body.appendChild(p);p.addEventListener('keydown',e=>e.stopPropagation());}
  p.classList.add('show');
  const d=MW.data;
  const st=MW._status?E(MW._status):d?`${d.N.toLocaleString()} nodes · ${d.raw.links.filter(l=>l[3]===0).length.toLocaleString()} measured RF links · ${E(ago(Date.parse(d.raw.generated)/1000))}`:'';
  const end=(e,lbl)=>`<div class="mw-end"><i>${lbl}</i>${e?E(e.label):'<span style="color:#5C636B">not set</span>'}</div>`;
  const pick=w=>`<button class="mw-b${MW.pickMode===w?' on':''}" onclick="MeshWorld.pick('${w}')" title="Click a node or anywhere on the map">PICK</button>`;
  p.innerHTML=`<div class="mw-h"><b>📡 MESHTASTIC WORLD</b><button title="Collapse" onclick="this.closest('#mwPanel').classList.toggle('min')">–</button><button title="Hide layer" onclick="MeshWorld.disable(true)">×</button></div>
  <div class="mw-st">${st}</div>
  <input type="text" id="mwSearch" placeholder="Find node: name, short name or !hex id" autocomplete="off">
  <div class="mw-res" id="mwRes"></div>
  <div class="mw-sec"><div class="mw-sh">ROUTE A MESSAGE</div>
    <div class="mw-row">${end(MW.from,'FROM')}${pick('from')}<button class="mw-b" onclick="MeshWorld.fromGps()" title="Use this device's GPS">GPS</button></div>
    <div class="mw-row">${end(MW.to,'TO')}${pick('to')}</div>
    <div class="mw-row"><span style="color:#8B919A;font-size:8.5px;width:100%">Unmeasured links count as in range up to <b id="mwRk" style="color:#E6E9EE">${MW.opts.rangeKm} km</b> (×2 for routers on high ground)</span>
      <input type="range" id="mwRange" min="0" max="40" step="1" value="${MW.opts.rangeKm}" style="flex:1;accent-color:#76FF03"></div>
    <div class="mw-row"><span style="color:#8B919A;font-size:8.5px">MAX RELAYS</span>
      <select id="mwHops" style="width:auto">${[1,2,3,4,5,6,7].map(n=>`<option ${n===MW.opts.maxRelays?'selected':''} value="${n}">${n}${n===3?' (default)':n===7?' (max)':''}</option>`).join('')}</select>
      <button class="mw-b go" onclick="MeshWorld.route()">FIND ROUTE</button><button class="mw-b" onclick="MeshWorld.clear()">CLEAR</button></div>
    <div id="mwOut">${MW._out||''}</div></div>
  <div id="mwCard">${MW.sel!=null&&d?card(MW.sel):''}</div>
  <div class="mw-sec"><div class="mw-sh">SHOW</div>
    <label class="mw-ck"><input type="checkbox" id="mwRf" ${MW.opts.rf?'checked':''}>RF links</label>
    <label class="mw-ck"><input type="checkbox" id="mwGw" ${MW.opts.gw?'checked':''}>Gateway hears</label>
    <label class="mw-ck"><input type="checkbox" id="mwLb" ${MW.opts.labels?'checked':''}>Names</label>
    <div class="mw-row"><span style="color:#8B919A;font-size:8.5px">HEARD WITHIN</span><select id="mwAge" style="width:auto">${[[1,'1 hour'],[24,'24 hours'],[72,'3 days'],[168,'7 days']].map(([v,l])=>`<option value="${v}" ${v===MW.opts.ageH?'selected':''}>${l}</option>`).join('')}</select></div>
    <div class="mw-lg" style="margin-top:7px">${Object.keys(GROUP_COL).map(g=>`<span><i style="background:${GROUP_COL[g]}"></i>${GROUP_LBL[g]}</span>`).join('')}
      ${SNR_CLASSES.map(c=>`<span><s style="background:${c.col}"></s>${c.lbl}</span>`).join('')}<span><s style="background:#82B1FF;opacity:.6"></s>gateway heard</span></div></div>
  <div class="mw-attr">Positions, roles and neighbour SNR come from nodes that publish to public Meshtastic MQTT (meshtastic.liamcottle.net, meshmap.net), refreshed every 10 min. Nodes that never uplink to MQTT are not on any public map. Predicted links are distance-only — terrain and antenna height decide the real range.</div>`;
  wirePanel();
}
function wirePanel(){
  const q=document.getElementById('mwSearch');
  q.oninput=()=>{const v=q.value.trim().toLowerCase(),out=document.getElementById('mwRes');if(!v||!MW.data){out.innerHTML='';return;}
    const hits=[];const nodes=MW.data.raw.nodes;
    for(let i=0;i<nodes.length&&hits.length<8;i++){const n=nodes[i];if((n[4]||'').toLowerCase().includes(v)||(n[5]||'').toLowerCase().includes(v)||hex(n[0]).includes(v.replace(/^!?/,'!')))hits.push(i);}
    out.innerHTML=hits.map(i=>`<div onclick="MeshWorld.focus(${i})"><b style="color:${GROUP_COL[MW.data.grp[i]]}">${E(node(i)[4]||'')}</b> ${E(node(i)[5]||'')} <span style="color:#5C636B">${hex(node(i)[0])} · ${ago(MW.data.t[i])}</span></div>`).join('')||'<div style="color:#5C636B;cursor:default">No match</div>';};
  const rg=document.getElementById('mwRange');rg.oninput=()=>{MW.opts.rangeKm=+rg.value;document.getElementById('mwRk').textContent=rg.value+' km';};
  document.getElementById('mwHops').onchange=e=>{MW.opts.maxRelays=+e.target.value;};
  const ck=(id,k,after)=>{document.getElementById(id).onchange=e=>{MW.opts[k]=e.target.checked;after();};};
  ck('mwRf','rf',applyVisibility);ck('mwGw','gw',applyVisibility);ck('mwLb','labels',refreshLabels);
  document.getElementById('mwAge').onchange=e=>{MW.opts.ageH=+e.target.value;applyVisibility();refreshLabels();};
}
function card(i){
  const n=node(i),d=MW.data;const g=d.grp[i];
  const nb=d.nbr[i].map(k=>d.raw.links[k]).filter(l=>l[3]===0).map(l=>{const j=l[0]===i?l[1]:l[0];return{j,snr:l[2],dk:km(d.lat[i],d.lon[i],d.lat[j],d.lon[j])};}).sort((a,b)=>(b.snr??-99)-(a.snr??-99));
  const gws=d.nbr[i].filter(k=>d.raw.links[k][3]===1).length;
  const batt=n[8]<0?'—':n[8]>100?'external power':n[8]+'%';
  return `<div class="mw-sec"><div class="mw-sh" style="color:${GROUP_COL[g]}">${E(dictv('role',n[7])||'NODE')}</div>
  <div style="font-size:12px;font-weight:700;margin-bottom:5px">${E(n[5]||n[4]||hex(n[0]))} <span style="color:#8B919A;font-weight:400">${E(n[4]||'')}</span></div>
  <div class="mw-kv"><span>ID</span><span>${hex(n[0])}</span><span>HEARD</span><span>${ago(n[9])}</span><span>HARDWARE</span><span>${E(dictv('hw',n[6])||'—')}</span>
  <span>PRESET</span><span>${E(dictv('preset',n[10])||'unknown')}</span><span>REGION</span><span>${E(dictv('region',n[11])||'unknown')}</span>
  <span>BATTERY</span><span>${batt}</span><span>ALTITUDE</span><span>${n[3]?n[3]+' m':'—'}</span><span>POSITION</span><span>${n[1].toFixed(4)}, ${n[2].toFixed(4)}</span></div>
  <div class="mw-sh" style="margin-top:8px">HEARS DIRECTLY (${nb.length})${gws?` · heard by ${gws} gateway${gws>1?'s':''}`:''}</div>
  ${nb.slice(0,10).map(x=>`<div class="mw-hop" style="cursor:pointer" onclick="MeshWorld.focus(${x.j})"><span class="mw-n">↔</span><span>${E(nodeName(x.j))}</span><em>${x.snr==null?'SNR —':'SNR '+x.snr+' dB'} · ${x.dk.toFixed(1)} km</em></div>`).join('')||'<div style="color:#5C636B;font-size:9px">No NeighborInfo published by this node or its neighbours.</div>'}
  <div class="mw-row"><button class="mw-b" onclick="MeshWorld.setEnd('from',${i})">ROUTE FROM</button><button class="mw-b" onclick="MeshWorld.setEnd('to',${i})">ROUTE TO</button><button class="mw-b" onclick="MeshWorld.focus(${i},true)">FLY TO</button></div></div>`;
}
function showRoute(o){
  let h='';
  if(o.msg)h=`<div class="mw-warn">${E(o.msg)}</div>`;
  else if(o.r){
    const d=MW.data,path=o.r.path,relays=path.length-2;
    const name=v=>v<d.N?nodeName(v):(v===d.N?MW.from.label:MW.to.label);
    const why=hp=>hp.k===0?`measured RF · SNR ${hp.s==null?'—':hp.s+' dB'}`:hp.k===1?'heard by MQTT gateway (may be relayed)':'predicted in range — no measurement';
    const weak=o.r.hops.filter(x=>x.k===2).length;
    h=`<div class="${o.over?'mw-warn':'mw-ok'}"><b>${relays} relay${relays===1?'':'s'}</b> · ${path.length-1} link${path.length===2?'':'s'} · ${o.r.hops.reduce((s,x)=>s+x.d,0).toFixed(1)} km${o.over?`<br>Needs ${relays} relays — more than your MAX RELAYS (${MW.opts.maxRelays}). ${relays<=7?`Set Hop Limit to ${relays} on your node (LoRa settings).`:'Meshtastic caps hop limit at 7, so this will not deliver over RF alone.'}`:`<br>Hop Limit ${Math.max(relays,1)}+ on your node covers it${relays>3?' (default is 3)':''}.`}${weak?`<br>${weak} of the links are distance-only guesses.`:''}</div>`;
    h+=path.map((v,i)=>`<div class="mw-hop"${v<d.N?` style="cursor:pointer" onclick="MeshWorld.focus(${v})"`:''}><span class="mw-n">${i===0?'▶':i===path.length-1?'◎':i}</span><span>${E(name(v))}</span>${i<path.length-1?`<em>↓ ${o.r.hops[i].d.toFixed(1)} km · ${why(o.r.hops[i])}</em>`:''}</div>`).join('');
  }else if(o.gap){
    const g=o.gap,R=MW.opts.rangeKm||8;
    h=`<div class="mw-warn"><b>No path</b> within ${MW.opts.ageH} h of activity${MW.opts.rangeKm?` and ${MW.opts.rangeKm} km predicted range`:''}.<br>
      FROM reaches ${o.na.toLocaleString()} node${o.na===1?'':'s'}, TO reaches ${o.nb.toLocaleString()}. Closest gap between the two meshes: <b>${g.d.toFixed(1)} km</b>
      (${g.a>=0?E(nodeName(g.a)):'your position'} ↔ ${g.b>=0?E(nodeName(g.b)):'target'}).<br>
      ${g.d<=RF_GAP_MAX_KM?`Close it with ~${Math.max(1,Math.ceil(g.d/(R*2))-1)} relay node${Math.ceil(g.d/(R*2))-1>1?'s':''} on high ground along the red line (pins), or raise the range slider if you have line-of-sight.<br>`:`Too far for ground relays — only an internet bridge or a satellite link connects these two meshes.<br>`}
      Internet bridge: a node on each side with MQTT uplink + downlink on the same channel.</div>`;
  }
  if(o.ms!=null)h+=`<div style="color:#5C636B;font-size:8px;margin-top:4px">computed in ${o.ms} ms</div>`;
  MW._out=h;const el=document.getElementById('mwOut');if(el)el.innerHTML=h;
}

// ── input ───────────────────────────────────────────────────
function bindInput(){
  if(MW.handler)return;
  MW.handler=new Cesium.ScreenSpaceEventHandler(V.scene.canvas);
  MW.handler.setInputAction(c=>{
    if(!MW.on||!MW.data)return;
    let hit=null;
    try{const p=V.scene.pick(c.position);if(p&&p.id&&p.id.mw!==undefined)hit=p.id.mw;}catch(_){}
    if(MW.pickMode){
      const w=MW.pickMode;MW.pickMode=null;
      if(hit!=null)setEnd(w,hit);
      else{let ll=null;try{const ray=V.camera.getPickRay(c.position);const g=V.scene.globe.pick(ray,V.scene)||V.camera.pickEllipsoid(c.position);if(g){const k=Cesium.Cartographic.fromCartesian(g);ll={lat:Cesium.Math.toDegrees(k.latitude),lon:Cesium.Math.toDegrees(k.longitude)};}}catch(_){}
        if(ll)MW[w]={kind:'loc',lat:ll.lat,lon:ll.lon,label:`map point ${ll.lat.toFixed(4)}, ${ll.lon.toFixed(4)}`};renderPanel();}
      return;
    }
    if(hit!=null){MW.sel=hit;renderPanel();highlight(hit);}
  },Cesium.ScreenSpaceEventType.LEFT_CLICK);
  MW._camCb=V.camera.changed.addEventListener(()=>{if(MW.on)onCamera();});
  MW._moveCb=V.camera.moveEnd.addEventListener(()=>{if(MW.on)refreshLabels();});
}
let _hl=null;
function highlight(i){
  if(_hl){try{V.entities.remove(_hl)}catch(_){}}
  const d=MW.data;
  _hl=V.entities.add({position:Cesium.Cartesian3.fromDegrees(d.lon[i],d.lat[i],d.alt[i]+25),point:{pixelSize:18,color:Cesium.Color.TRANSPARENT,outlineColor:Cesium.Color.fromCssColorString('#E8B349'),outlineWidth:3,disableDepthTestDistance:5e6}});
  kick();
}
function setEnd(w,i){MW[w]={kind:'node',i,label:nodeName(i)+' ('+hex(node(i)[0])+')'};MW.pickMode=null;renderPanel();}

// ── public API ──────────────────────────────────────────────
async function enable(){
  if(!window.V)return;
  MW.on=true;bindInput();renderPanel();
  if(!MW.data||Date.now()-MW.loadedAt>REFRESH_MS)await load();else draw();
  clearInterval(MW._iv);MW._iv=setInterval(()=>{if(MW.on&&!document.hidden)load();},REFRESH_MS);
}
function disable(fromPanel){
  MW.on=false;MW.pickMode=null;clearInterval(MW._iv);clearTimeout(MW.timer);
  clearPrims();clearRoute();if(_hl){try{V.entities.remove(_hl)}catch(_){}_hl=null;}
  renderPanel();kick();
  if(fromPanel){const row=document.querySelector('.ly[data-layer="meshworld"]');if(row&&row.classList.contains('on')){row.classList.remove('on');try{layers.meshworld=false}catch(_){}}}
}
Object.assign(MW,{enable,disable,route,load,
  clear(){MW.from=MW.to=null;MW._out='';clearRoute();renderPanel();},
  pick(w){MW.pickMode=MW.pickMode===w?null:w;renderPanel();if(MW.pickMode)toast('var(--gn)',`Click a node or a map point for ${w.toUpperCase()}`);},
  setEnd,
  focus(i,fly){MW.sel=i;renderPanel();highlight(i);const d=MW.data;
    if(fly!==false)V.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(d.lon[i],d.lat[i],Math.min(V.camera.positionCartographic.height,60000)),duration:1.2});},
  fromGps(){
    if(!navigator.geolocation){toast('var(--rd)','No GPS available in this browser');return;}
    navigator.geolocation.getCurrentPosition(p=>{MW.from={kind:'loc',lat:p.coords.latitude,lon:p.coords.longitude,label:`my position ±${Math.round(p.coords.accuracy)} m`};renderPanel();
      V.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(p.coords.longitude,p.coords.latitude,80000),duration:1.2});},
      e=>toast('var(--rd)','GPS: '+e.message),{enableHighAccuracy:true,timeout:12000});
  },
  _bf:bf,_buildGraph:buildGraph
});
})();
