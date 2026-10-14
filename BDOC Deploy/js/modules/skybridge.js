// ============================================================
// BDOC P156 MODULE: skybridge.js — SATELLITE DATA OVER MESH, DECODED ON THE GLOBE
// ------------------------------------------------------------
// The receive end of tools/skybridge.py. A ground station turns satellite products
// into compact binary messages and broadcasts them over Meshtastic (private port 256).
// tools/grid_down_gateway.py hands every packet the customer's radio hears to the
// local receiver (127.0.0.1:9876, GET /api/v1/mesh/events). This module:
//   1. reassembles the chunks (any order, duplicates, one lost chunk rebuilt from parity),
//   2. checks CRC32, inflates,
//   3. turns the bits back into pixels (cloud tops / storms), warning polygons and
//      bulletins on the map, and keeps them in IndexedDB so they survive a reload with
//      no internet.
// Wire format: see the header of tools/skybridge.py ("BDSB/1").
// © 2026 Kitsune Global Solutions LLC
// ============================================================
(function(){
'use strict';
if(window.Skybridge)return;

const IPC='http://127.0.0.1:9876/api/v1';
const MAGIC=0xB1,PARITY=0xFF,HDR=8;
const PRODUCTS={1:'ir',2:'vis',3:'storm',4:'lightning',9:'other'};
const PRODUCT_LABEL={ir:'IR cloud tops',vis:'Visible clouds',storm:'Storm cells',lightning:'Lightning density',other:'Raster'};
const EVENTS=['Other','Tornado Warning','Severe Thunderstorm Warning','Flash Flood Warning','Flood Warning','Extreme Wind Warning',
  'Snow Squall Warning','Special Marine Warning','Hurricane Warning','Tropical Storm Warning','Storm Surge Warning','Winter Storm Warning',
  'Blizzard Warning','Red Flag Warning','Tornado Watch','Severe Thunderstorm Watch','Hurricane Watch','Tsunami Warning',
  'Civil Emergency Message','Shelter In Place Warning','Evacuation Immediate','Fire Warning'];
// NWS warning colours where they exist
const EV_COL={'Tornado Warning':'#FF2D2D','Severe Thunderstorm Warning':'#FFA500','Flash Flood Warning':'#3DDC84','Flood Warning':'#00C853',
  'Extreme Wind Warning':'#FF8C00','Snow Squall Warning':'#C71585','Special Marine Warning':'#FFA07A','Hurricane Warning':'#DC143C',
  'Tropical Storm Warning':'#B22222','Storm Surge Warning':'#B524F7','Winter Storm Warning':'#FF69B4','Blizzard Warning':'#FF4500',
  'Red Flag Warning':'#FF1493','Tornado Watch':'#FFFF00','Severe Thunderstorm Watch':'#DB7093','Hurricane Watch':'#FF00FF',
  'Tsunami Warning':'#FD6347','Civil Emergency Message':'#FFB6C1','Shelter In Place Warning':'#FA8072','Evacuation Immediate':'#7FFF00','Fire Warning':'#A0522D'};
const PRIORITY=['ROUTINE','PRIORITY','IMMEDIATE','FLASH'];

const SB=window.Skybridge={
  on:false,seq:0,fails:0,timer:null,
  msgs:new Map(),done:new Map(),
  rasters:new Map(),   // product -> {obj, ent}
  warnings:null,       // {obj, ents:[]}
  bulletins:[],
  style:'clouds',show:{raster:true,warnings:true},
  stats:{rf:0,chunks:0,messages:0,recovered:0,bad:0,last:0}
};
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=(c,m)=>{try{af(c,m)}catch(_){console.log('[Skybridge]',m)}};
// ground rectangles/polygons are built on web workers; in on-demand render mode the finished
// primitive only shows on a later frame, so keep rendering for a moment after each draw
let _settleT=null;
const kick=()=>{try{V.scene.requestRender();BDOCRender.hold('skybridge-draw');clearTimeout(_settleT);_settleT=setTimeout(()=>{try{BDOCRender.release('skybridge-draw')}catch(_){}},3000);}catch(_){}};

// ── binary helpers ──────────────────────────────────────────
const CRC_T=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(u8){let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=CRC_T[(c^u8[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function b64(s){const bin=atob(s);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;}
async function inflateRaw(u8){
  const ds=new DecompressionStream('deflate-raw');
  const out=new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
const u16=(u,o)=>(u[o]<<8)|u[o+1];
const i16=(u,o)=>{const v=u16(u,o);return v&0x8000?v-0x10000:v;};
const u32=(u,o)=>((u[o]<<24)>>>0)+(u[o+1]<<16)+(u[o+2]<<8)+u[o+3];

// ── reassembly (mirror of tools/skybridge.py Reassembler) ───
function feed(u8){
  if(u8.length<HDR||u8[0]!==MAGIC)return null;
  const mid=u16(u8,1),seq=u8[3],n=u8[4],mlen=u16(u8,6);
  if(SB.done.has(mid)&&Date.now()-SB.done.get(mid)<3600e3)return null;
  let st=SB.msgs.get(mid);
  if(!st||st.n!==n||st.len!==mlen){st={n,len:mlen,data:new Map(),parity:null,t:Date.now()};SB.msgs.set(mid,st);}
  const payload=u8.slice(HDR);
  if(seq===PARITY)st.parity=payload;else if(seq<n)st.data.set(seq,payload);
  SB.stats.chunks++;
  return tryComplete(mid);
}
function tryComplete(mid){
  const st=SB.msgs.get(mid);const n=st.n;let recovered=null;
  if(st.data.size<n){
    const missing=[];for(let i=0;i<n;i++)if(!st.data.has(i))missing.push(i);
    if(missing.length!==1||!st.parity)return null;
    const m=missing[0],full=st.parity.length,size=m<n-1?full:st.len-(n-1)*full;
    const rec=new Uint8Array(st.parity);
    for(const p of st.data.values())for(let k=0;k<p.length;k++)rec[k]^=p[k];
    st.data.set(m,rec.slice(0,size));recovered=m;
  }
  const msg=new Uint8Array(st.len);let off=0;
  for(let i=0;i<n;i++){const p=st.data.get(i);msg.set(p.subarray(0,Math.min(p.length,st.len-off)),off);off+=p.length;if(off>=st.len)break;}
  SB.msgs.delete(mid);SB.done.set(mid,Date.now());
  return {mid,msg,chunks:n,recovered};
}
async function parse(msg){
  const body=msg.subarray(0,msg.length-4);
  if(crc32(body)!==u32(msg,msg.length-4))throw new Error('CRC mismatch');
  const type=body[0],product=body[1],t=u32(body,2),b=body.subarray(6);
  if(type===1){
    const s=i16(b,0)/100,w=i16(b,2)/100,n=i16(b,4)/100,e=i16(b,6)/100,W=u16(b,8),H=u16(b,10),bits=b[12],codec=b[13];
    let data=b.subarray(14);if(codec===1)data=await inflateRaw(data);
    const per=8/bits,mask=(1<<bits)-1,cells=new Uint8Array(W*H);
    for(let i=0;i<W*H;i++){const byte=data[(i/per)|0];cells[i]=(byte>>(8-bits*((i%per)+1)))&mask;}
    return {type:'raster',product:PRODUCTS[product]||'other',time:t,bbox:[s,w,n,e],w:W,h:H,bits,cells};
  }
  if(type===2){
    const cnt=b[0];let o=1;const polys=[];
    for(let k=0;k<cnt;k++){
      const ev=b[o],exp=u32(b,o+1),np=b[o+5];o+=6;const pts=[];
      for(let j=0;j<np;j++){pts.push([i16(b,o+2)/100,i16(b,o)/100]);o+=4;}
      polys.push({event:EVENTS[ev]||'Other',expires:exp,coords:pts});
    }
    return {type:'polygons',time:t,polygons:polys};
  }
  if(type===3){
    let data=b.subarray(1);if(b[0]===1)data=await inflateRaw(data);
    return {type:'text',priority:product,time:t,text:new TextDecoder().decode(data)};
  }
  throw new Error('unknown message type '+type);
}

// ── rendering ───────────────────────────────────────────────
function rasterCanvas(obj){
  const c=document.createElement('canvas');c.width=obj.w;c.height=obj.h;
  const g=c.getContext('2d'),img=g.createImageData(obj.w,obj.h),max=(1<<obj.bits)-1;
  for(let i=0;i<obj.cells.length;i++){
    const lv=obj.cells[i]/max,o=i*4;
    if(SB.style==='ink'){        // e-ink: black ink on paper, like a Kindle
      const v=Math.round(235-lv*225);img.data[o]=v;img.data[o+1]=v;img.data[o+2]=v-6;img.data[o+3]=215;
    }else{                       // clouds: white over the map, clear sky transparent
      img.data[o]=255;img.data[o+1]=255;img.data[o+2]=255;img.data[o+3]=Math.round(lv*lv*215+(lv>0?35:0));
    }
  }
  g.putImageData(img,0,0);return c;
}
// rasters go in as an imagery layer: it drapes on terrain like any basemap and shows on the
// next frame (a ground-clamped rectangle is built on a worker and could stay invisible)
async function drawRaster(obj){
  const prev=SB.rasters.get(obj.product);
  const [s,w,n,e]=obj.bbox;
  const url=rasterCanvas(obj).toDataURL('image/png');
  const rect=Cesium.Rectangle.fromDegrees(w,s,e,n);
  const prov=Cesium.SingleTileImageryProvider.fromUrl?await Cesium.SingleTileImageryProvider.fromUrl(url,{rectangle:rect}):new Cesium.SingleTileImageryProvider({url,rectangle:rect});
  const layer=V.imageryLayers.addImageryProvider(prov);
  layer.show=SB.show.raster;
  if(prev&&prev.layer){try{V.imageryLayers.remove(prev.layer,true)}catch(_){}}
  SB.rasters.set(obj.product,{obj,layer});
  kick();
}
function drawWarnings(obj){
  if(SB.warnings)SB.warnings.ents.forEach(e=>{try{V.entities.remove(e)}catch(_){}});
  const now=Date.now()/1000,ents=[];
  obj.polygons.forEach(p=>{
    if(p.expires&&p.expires<now)return;
    const col=Cesium.Color.fromCssColorString(EV_COL[p.event]||'#E0E0E0');
    const ring=p.coords.concat([p.coords[0]]);
    const flat=ring.flat();
    const until=p.expires?new Date(p.expires*1000).toISOString().slice(11,16)+'Z':'';
    ents.push(V.entities.add({name:p.event,polygon:{hierarchy:Cesium.Cartesian3.fromDegreesArray(flat),material:col.withAlpha(SB.style==='ink'?0.12:0.22),
      classificationType:Cesium.ClassificationType.TERRAIN},show:SB.show.warnings,
      description:`<div style="font-family:monospace;font-size:11px;background:#0a0e14;padding:12px;color:#E6E9EE"><b style="color:${EV_COL[p.event]||'#fff'}">${E(p.event.toUpperCase())}</b><br>until ${E(until)}<br>Received over the BDOC mesh (Skybridge) — no internet used.</div>`}));
    ents.push(V.entities.add({polyline:{positions:Cesium.Cartesian3.fromDegreesArray(flat),width:3,material:SB.style==='ink'?Cesium.Color.BLACK:col,clampToGround:true},show:SB.show.warnings}));
    const c=p.coords.reduce((a,q)=>[a[0]+q[0]/p.coords.length,a[1]+q[1]/p.coords.length],[0,0]);
    ents.push(V.entities.add({position:Cesium.Cartesian3.fromDegrees(c[0],c[1]),show:SB.show.warnings,
      label:{text:p.event.replace(' Warning','').toUpperCase()+(until?' · '+until:''),font:'bold 10px JetBrains Mono',fillColor:col,outlineColor:Cesium.Color.BLACK,outlineWidth:3,
        style:Cesium.LabelStyle.FILL_AND_OUTLINE,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:5e6,distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,1.5e6)}}));
  });
  SB.warnings={obj,ents};
}
function addBulletin(obj){
  SB.bulletins.unshift(obj);if(SB.bulletins.length>20)SB.bulletins.length=20;
  if(SB._restoring)return;
  toast(obj.priority>=2?'var(--rd)':'var(--yl)',`SKYBRIDGE ${PRIORITY[obj.priority]||''}: ${obj.text.slice(0,140)}`);
  try{EventLog.add(obj.priority>=2?'alert':'info','Skybridge bulletin: '+obj.text.slice(0,200))}catch(_){}
}
function render(obj){
  if(obj.type==='raster')drawRaster(obj).catch(e=>console.warn('[Skybridge] raster draw',e));else if(obj.type==='polygons')drawWarnings(obj);else if(obj.type==='text')addBulletin(obj);
  SB.stats.messages++;SB.stats.last=Date.now();renderPanel();kick();
}
function persist(obj){
  try{
    if(!window.BDOCOfflineStore)return;
    const rec=Object.assign({},obj,{id:obj.type==='raster'?'raster-'+obj.product:obj.type==='polygons'?'warnings':'text-'+obj.time+'-'+(obj._mid||0)});
    if(rec.cells)rec.cells=Array.from(rec.cells);
    BDOCOfflineStore.putEntities('skybridge',[rec],'mesh');
  }catch(_){}
}
async function restore(){
  try{
    if(!window.BDOCOfflineStore)return;
    const recs=await BDOCOfflineStore.getEntities('skybridge',24*3600e3);
    SB._restoring=true;
    (recs||[]).sort((a,b)=>(a.time||0)-(b.time||0)).forEach(r=>{const o=r.data||r;if(o.cells)o.cells=Uint8Array.from(o.cells);if(o.type)render(o);});
  }catch(_){}
  SB._restoring=false;
}

// ── intake ──────────────────────────────────────────────────
async function handleChunk(u8){
  const done=feed(u8);if(!done)return;
  try{
    const obj=await parse(done.msg);obj._chunks=done.chunks;obj._recovered=done.recovered;obj._mid=done.mid;
    if(done.recovered!=null)SB.stats.recovered++;
    render(obj);persist(obj);
  }catch(e){SB.stats.bad++;console.warn('[Skybridge] message',done.mid,'dropped:',e.message);renderPanel();}
}
async function poll(){
  if(!SB.on)return;
  try{
    const ctl=new AbortController(),to=setTimeout(()=>ctl.abort(),1500);
    const r=await fetch(`${IPC}/mesh/events?since=${SB.seq}&limit=1000`,{signal:ctl.signal,cache:'no-store'});clearTimeout(to);
    const j=await r.json();
    for(const ev of (j.events||[])){
      SB.stats.rf++;
      if(ev.payload_b64&&(ev.portnum==='PRIVATE_APP'||ev.portnum_num===256||ev.portnum===256))await handleChunk(b64(ev.payload_b64));
    }
    if(j.seq)SB.seq=j.seq;SB.fails=0;
  }catch(e){SB.fails++;}
  renderPanel();
  SB.timer=setTimeout(poll,SB.fails>3?4000:1000);
}

// ── panel ───────────────────────────────────────────────────
function css(){
  if(document.getElementById('sbCss'))return;
  const s=document.createElement('style');s.id='sbCss';
  s.textContent=`#sbPanel{position:fixed;right:calc(var(--rw,360px) + 14px);top:64px;z-index:119;width:300px;max-height:calc(100vh - 160px);overflow-y:auto;display:none;
  background:rgba(9,12,19,0.86);backdrop-filter:blur(18px) saturate(120%);-webkit-backdrop-filter:blur(18px) saturate(120%);border:1px solid rgba(255,255,255,0.14);border-radius:14px;
  padding:12px;font-family:var(--m,'JetBrains Mono',monospace);color:#E6E9EE;font-size:10px;box-shadow:0 12px 40px rgba(0,0,0,0.5);scrollbar-width:thin}
body:has(.rp.shut) #sbPanel{right:14px} body:has(.rp.mini) #sbPanel{right:56px}
#sbPanel.show{display:block} #sbPanel.min > :not(.sb-h){display:none}
#sbPanel .sb-h{display:flex;align-items:center;gap:6px} #sbPanel .sb-h b{flex:1;color:#9CC4FF;letter-spacing:2px}
#sbPanel .sb-h button{background:none;border:none;color:#8B919A;font-size:14px;cursor:pointer}
#sbPanel .sb-st{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:8px 0}
#sbPanel .sb-st div{background:rgba(255,255,255,0.04);border-radius:6px;padding:5px;text-align:center}
#sbPanel .sb-st b{display:block;font-size:13px;color:#fff} #sbPanel .sb-st span{font-size:7.5px;letter-spacing:1px;color:#8B919A}
#sbPanel .sb-sec{margin-top:9px;padding-top:7px;border-top:1px solid rgba(255,255,255,0.08)}
#sbPanel .sb-sh{font-size:8px;letter-spacing:1.6px;color:#8B919A;margin-bottom:5px}
#sbPanel .sb-msg{margin:4px 0}#sbPanel .sb-bar{height:5px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;margin-top:3px}
#sbPanel .sb-bar i{display:block;height:100%;background:#9CC4FF}
#sbPanel .sb-prod{display:flex;justify-content:space-between;gap:6px;padding:4px 0;cursor:pointer} #sbPanel .sb-prod:hover{color:#fff}
#sbPanel .sb-bl{padding:5px 7px;border-radius:5px;background:rgba(255,255,255,0.04);margin:4px 0;line-height:1.4}
#sbPanel .sb-bl em{font-style:normal;font-size:8px;letter-spacing:1px}
#sbPanel label{display:inline-flex;gap:4px;align-items:center;margin-right:8px;color:#AEB4BE;cursor:pointer} #sbPanel input{accent-color:#9CC4FF;margin:0}
#sbPanel button.sb-b{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);color:#E6E9EE;font-family:inherit;font-size:9px;padding:4px 8px;border-radius:5px;cursor:pointer}
#sbPanel button.sb-b.on{border-color:#9CC4FF;background:rgba(156,196,255,0.15)}
#sbPanel .sb-dim{color:#5C636B;font-size:8.5px;line-height:1.45}`;
  document.head.appendChild(s);
}
function renderPanel(){
  let p=document.getElementById('sbPanel');
  if(!SB.on){if(p)p.classList.remove('show');return;}
  if(!p){css();p=document.createElement('div');p.id='sbPanel';document.body.appendChild(p);}
  p.classList.add('show');
  const live=SB.fails<=3,st=SB.stats;
  const pending=Array.from(SB.msgs.entries()).map(([mid,m])=>{const pct=Math.round(100*m.data.size/m.n);
    return `<div class="sb-msg">msg ${mid} · ${m.data.size}/${m.n} chunks${m.parity?' + parity':''}<div class="sb-bar"><i style="width:${pct}%"></i></div></div>`;}).join('')||'<div class="sb-dim">Nothing in flight.</div>';
  const prods=Array.from(SB.rasters.values()).map(({obj})=>`<div class="sb-prod" onclick="Skybridge.flyTo('${obj.product}')"><span>▦ ${E(PRODUCT_LABEL[obj.product]||obj.product)} ${obj.w}×${obj.h}</span><span style="color:#8B919A">${ago(obj.time)}</span></div>`).join('')
    +(SB.warnings?`<div class="sb-prod" onclick="Skybridge.flyTo('warnings')"><span>⚠ ${SB.warnings.obj.polygons.length} warning areas</span><span style="color:#8B919A">${ago(SB.warnings.obj.time)}</span></div>`:'');
  const bl=SB.bulletins.slice(0,5).map(b=>`<div class="sb-bl"><em style="color:${b.priority>=2?'#FF6B66':'#E8B349'}">${PRIORITY[b.priority]||''} · ${ago(b.time)}</em><br>${E(b.text)}</div>`).join('');
  p.innerHTML=`<div class="sb-h"><b>🛰 SKYBRIDGE</b><span style="font-size:8px;color:${live?'#3DFFB0':'#FF6B66'}">${live?'● RX':'NO RECEIVER'}</span><button onclick="this.closest('#sbPanel').classList.toggle('min')">–</button><button onclick="Skybridge.disable(true)">×</button></div>
  <div class="sb-dim" style="margin-top:4px">Satellite data received by a BDOC ground station, sent as binary over the mesh, rebuilt here. Works with no internet.</div>
  <div class="sb-st"><div><b>${st.rf}</b><span>RF PKTS</span></div><div><b>${st.chunks}</b><span>CHUNKS</span></div><div><b>${st.messages}</b><span>DECODED</span></div><div><b>${st.recovered}</b><span>FEC SAVES</span></div></div>
  <div class="sb-sec"><div class="sb-sh">IN FLIGHT</div>${pending}</div>
  <div class="sb-sec"><div class="sb-sh">ON THE MAP</div>${prods||'<div class="sb-dim">No products yet.</div>'}
    <div style="margin-top:6px"><label><input type="checkbox" ${SB.show.raster?'checked':''} onchange="Skybridge.toggle('raster',this.checked)">Clouds</label><label><input type="checkbox" ${SB.show.warnings?'checked':''} onchange="Skybridge.toggle('warnings',this.checked)">Warnings</label>
    <button class="sb-b ${SB.style==='ink'?'on':''}" onclick="Skybridge.setStyle(Skybridge.style==='ink'?'clouds':'ink')">${SB.style==='ink'?'E-INK ✓':'E-INK'}</button></div></div>
  <div class="sb-sec"><div class="sb-sh">BULLETINS</div>${bl||'<div class="sb-dim">None received.</div>'}</div>
  ${live?'':`<div class="sb-sec sb-dim">Start the receiver and the radio gateway on this machine:<br>node tools/bdoc-ipc-receiver.js<br>python tools/grid_down_gateway.py --serial COM5<br>No radio? python tools/skybridge.py demo</div>`}`;
}
function ago(t){const s=Date.now()/1000-t;return s<90?Math.max(0,Math.round(s))+'s ago':s<5400?Math.round(s/60)+'m ago':Math.round(s/3600)+'h ago';}

// ── API ─────────────────────────────────────────────────────
Object.assign(SB,{
  async enable(){if(!window.V)return;SB.on=true;renderPanel();try{window.pluginRenderer&&pluginRenderer.enable()}catch(_){}if(!SB._restored){SB._restored=true;await restore();}clearTimeout(SB.timer);poll();},
  disable(fromPanel){SB.on=false;clearTimeout(SB.timer);renderPanel();
    if(fromPanel){const row=document.querySelector('.ly[data-layer="skybridge"]');if(row&&row.classList.contains('on')){row.classList.remove('on');try{layers.skybridge=false}catch(_){}}}},
  toggle(k,on){SB.show[k]=on;if(k==='raster')SB.rasters.forEach(r=>{if(r.layer)r.layer.show=on;});else if(SB.warnings)SB.warnings.ents.forEach(e=>e.show=on);kick();},
  setStyle(s){SB.style=s;SB.rasters.forEach(r=>drawRaster(r.obj));if(SB.warnings)drawWarnings(SB.warnings.obj);renderPanel();kick();},
  flyTo(k){let bb;if(k==='warnings'&&SB.warnings){const pts=SB.warnings.obj.polygons.flatMap(p=>p.coords);bb=[Math.min(...pts.map(q=>q[1])),Math.min(...pts.map(q=>q[0])),Math.max(...pts.map(q=>q[1])),Math.max(...pts.map(q=>q[0]))];}
    else{const r=SB.rasters.get(k);if(r)bb=r.obj.bbox;}
    if(bb)V.camera.flyTo({destination:Cesium.Rectangle.fromDegrees(bb[1]-0.3,bb[0]-0.3,bb[3]+0.3,bb[2]+0.3),duration:1.2});},
  _feed:handleChunk,_parse:parse
});
})();
