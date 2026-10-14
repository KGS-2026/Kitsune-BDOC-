// ============================================================
// BDOC P155 MODULE: net-builder.js — NETWORK BUILDER (Packet Tracer mode)
// ------------------------------------------------------------
// Drag real network gear onto the globe, cable it together, and watch traffic
// flow device-to-device. Two traffic sources:
//   1. LIVE  — packets captured by Wireshark/tshark on this machine, relayed by
//              tools/adapters/wireshark_adapter.py → tools/bdoc-ipc-receiver.js
//              (127.0.0.1:9876, GET /api/v1/wireshark/events?since=N).
//              Each packet's src/dst IP is matched to the devices you placed
//              (exact IP or CIDR). Public IPs with GeoIP appear as INTERNET hosts
//              at their real location; unknown LAN IPs appear as LAN hosts next to
//              your capture device, ready to be adopted.
//   2. SIM   — Packet Tracer style: PING between any two devices, or the built-in
//              demo traffic generator, with no capture rights needed.
// Packets ride the cables you drew (shortest hop path), each one an envelope
// labelled with protocol + TCP flags, so a SYN → SYN-ACK → ACK handshake is
// literally visible bouncing between the two devices.
//
// Depends on: V, Cesium, af(), esc(), BDOCRender (cesium-init.js), latLonToMGRS
// Loaded lazily: BDOC.LazyLoader.load('net-builder').then(()=>NetBuilder.open())
// © 2026 Kitsune Global Solutions LLC
// ============================================================
(function(){
'use strict';
if(window.NetBuilder)return;

const LS_KEY='bdoc_netbuilder_v1';
const IPC='http://127.0.0.1:9876/api/v1';

// ── catalogue ───────────────────────────────────────────────
const DEVICES={
  router:  {label:'Router',        color:'#4FC3F7'},
  switch:  {label:'Switch',        color:'#81D4FA'},
  firewall:{label:'Firewall',      color:'#FF7043'},
  server:  {label:'Server',        color:'#B39DDB'},
  pc:      {label:'PC',            color:'#E0E0E0'},
  laptop:  {label:'Laptop',        color:'#E0E0E0'},
  phone:   {label:'Phone',         color:'#A5D6A7'},
  ap:      {label:'Access Point',  color:'#CE93D8'},
  camera:  {label:'IP Camera',     color:'#FFD54F'},
  iot:     {label:'IoT Sensor',    color:'#69F0AE'},
  plc:     {label:'PLC / SCADA',   color:'#FFAB40'},
  mesh:    {label:'Meshtastic',    color:'#76FF03'},
  tower:   {label:'Cell Tower',    color:'#90A4AE'},
  sat:     {label:'Sat Terminal',  color:'#18FFFF'},
  cloud:   {label:'Internet',      color:'#90CAF9'},
  dish:    {label:'Sat Ground Stn', color:'#9CC4FF'}
};
const CABLES={
  cat6:   {label:'Copper Cat6',     color:'#4FC3F7', dash:0,  width:3},
  cross:  {label:'Crossover',       color:'#4FC3F7', dash:10, width:3},
  fiber:  {label:'Fiber',           color:'#FFA726', dash:0,  width:3.5},
  serial: {label:'Serial / WAN',    color:'#FF5252', dash:0,  width:3},
  coax:   {label:'Coax',            color:'#B0BEC5', dash:0,  width:3},
  wifi:   {label:'Wi-Fi',           color:'#CE93D8', dash:8,  width:2.5},
  lora:   {label:'LoRa / Mesh',     color:'#76FF03', dash:14, width:2.5},
  sat:    {label:'Satellite',       color:'#18FFFF', dash:4,  width:2}
};
const PROTO_COLORS={TCP:'#4FC3F7',TLS:'#448AFF',HTTP:'#FFEB3B',DNS:'#18FFFF',ICMP:'#FF80AB',ARP:'#FFD180',
  UDP:'#B388FF',SSH:'#69F0AE',RTSP:'#FFAB40',MQTT:'#76FF03',SMB:'#EA80FC',NTP:'#80CBC4',DHCP:'#FFF59D',
  MDNS:'#80DEEA',SNMP:'#BCAAA4',MODBUS:'#FF6E40',QUIC:'#82B1FF',IP:'#E0E0E0'};
const PROTO_FILTERS=['TCP','TLS','HTTP','DNS','ICMP','ARP','UDP','MESH','OTHER'];
// p156: Meshtastic portnums -> short labels (Wireshark for the mesh)
const MESH_LABELS={TEXT_MESSAGE_APP:'TEXT',POSITION_APP:'POS',NODEINFO_APP:'NODEINFO',ROUTING_APP:'ROUTING',TELEMETRY_APP:'TELEM',TRACEROUTE_APP:'TRACE',
  NEIGHBORINFO_APP:'NBRINFO',WAYPOINT_APP:'WAYPT',RANGE_TEST_APP:'RANGE',STORE_FORWARD_APP:'S&F',ATAK_PLUGIN:'ATAK',MAP_REPORT_APP:'MAPRPT',ADMIN_APP:'ADMIN',
  PRIVATE_APP:'SKY',SAT_DOWNLINK:'SAT'};
const MESH_SET=new Set(Object.values(MESH_LABELS).concat(['MESH']));
Object.assign(PROTO_COLORS,{SKY:'#9CC4FF',SAT:'#18FFFF',TEXT:'#76FF03',POS:'#B2FF59',NODEINFO:'#CCFF90',ROUTING:'#69F0AE',TELEM:'#A7FFEB',TRACE:'#EEFF41',NBRINFO:'#C6FF00',MESH:'#76FF03'});

// ── icons (Packet Tracer-ish line art, tinted per device) ───
function iconSvg(type,sel){
  const c=(DEVICES[type]||DEVICES.pc).color;
  const ring=sel?'#E8B349':'rgba(255,255,255,0.55)';
  const g={
    router:`<circle cx="24" cy="24" r="11" fill="none" stroke="${c}" stroke-width="2.4"/><path d="M24 13v-6M24 35v6M13 24H7M35 24h6" stroke="${c}" stroke-width="2.4"/><path d="M21 9l3-3 3 3M21 39l3 3 3-3M9 21l-3 3 3 3M39 21l3 3-3 3" stroke="${c}" stroke-width="2" fill="none"/>`,
    switch:`<rect x="8" y="16" width="32" height="16" rx="3" fill="none" stroke="${c}" stroke-width="2.4"/><path d="M13 21h20l-3-3M35 27H15l3 3" stroke="${c}" stroke-width="2" fill="none"/>`,
    firewall:`<rect x="9" y="11" width="30" height="26" rx="2" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M9 20h30M9 28h30M18 11v9M30 11v9M24 20v8M14 28v9M34 28v9" stroke="${c}" stroke-width="1.8"/>`,
    server:`<rect x="13" y="7" width="22" height="34" rx="2" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M13 17h22M13 27h22" stroke="${c}" stroke-width="1.8"/><circle cx="18" cy="12" r="1.6" fill="${c}"/><circle cx="18" cy="22" r="1.6" fill="${c}"/><circle cx="18" cy="32" r="1.6" fill="${c}"/>`,
    pc:`<rect x="8" y="10" width="32" height="21" rx="2" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M20 31v5M28 31v5M15 37h18" stroke="${c}" stroke-width="2.2"/>`,
    laptop:`<rect x="12" y="12" width="24" height="16" rx="2" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M7 33h34l-3-5H10z" fill="none" stroke="${c}" stroke-width="2.2"/>`,
    phone:`<rect x="16" y="7" width="16" height="34" rx="3" fill="none" stroke="${c}" stroke-width="2.2"/><circle cx="24" cy="36" r="1.7" fill="${c}"/>`,
    ap:`<circle cx="24" cy="30" r="3" fill="${c}"/><path d="M16 22a11 11 0 0 1 16 0M11 17a18 18 0 0 1 26 0" stroke="${c}" stroke-width="2.2" fill="none"/><path d="M14 38h20" stroke="${c}" stroke-width="2.2"/>`,
    camera:`<rect x="9" y="15" width="22" height="13" rx="3" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M31 18l8-4v15l-8-4M18 28l-3 9h8" stroke="${c}" stroke-width="2.2" fill="none"/>`,
    iot:`<rect x="15" y="15" width="18" height="18" rx="2" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M19 15v-5M24 15v-5M29 15v-5M19 33v5M24 33v5M29 33v5M15 19h-5M15 24h-5M15 29h-5M33 19h5M33 24h5M33 29h5" stroke="${c}" stroke-width="1.7"/>`,
    plc:`<rect x="10" y="11" width="28" height="26" rx="2" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M15 17h6M15 23h6M15 29h6" stroke="${c}" stroke-width="2"/><circle cx="31" cy="18" r="2" fill="${c}"/><circle cx="31" cy="25" r="2" fill="none" stroke="${c}" stroke-width="1.5"/>`,
    mesh:`<path d="M24 8v24" stroke="${c}" stroke-width="2.4"/><circle cx="24" cy="8" r="2.4" fill="${c}"/><rect x="17" y="30" width="14" height="10" rx="2" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M14 14a14 14 0 0 0 0 12M34 14a14 14 0 0 1 0 12" stroke="${c}" stroke-width="2" fill="none"/>`,
    tower:`<path d="M24 7l-9 34M24 7l9 34M18 27h12M20 19h8M16 35h16" stroke="${c}" stroke-width="2.1" fill="none"/><circle cx="24" cy="7" r="2.2" fill="${c}"/>`,
    sat:`<path d="M12 33a16 16 0 0 1 20-20z" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M22 23l10-10M14 41h18M23 33v8" stroke="${c}" stroke-width="2.2"/><circle cx="33" cy="12" r="2.2" fill="${c}"/>`,
    cloud:`<path d="M15 33h19a7 7 0 0 0 0-14 10 10 0 0 0-19-2 8 8 0 0 0 0 16z" fill="none" stroke="${c}" stroke-width="2.4"/>`,
    dish:`<path d="M10 30a16 16 0 0 0 22-22" fill="none" stroke="${c}" stroke-width="2.4"/><path d="M10 30L32 8M21 19l8 8M18 33l-3 7h14l-3-7" stroke="${c}" stroke-width="2.1" fill="none"/><circle cx="34" cy="6" r="2.2" fill="${c}"/><path d="M37 12a8 8 0 0 0-6-6" stroke="${c}" stroke-width="1.6" fill="none"/>`
  }[type]||'';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect x="1.5" y="1.5" width="45" height="45" rx="9" fill="rgba(8,12,20,0.88)" stroke="${ring}" stroke-width="${sel?3:1.2}"/>${g}</svg>`;
  return 'data:image/svg+xml;base64,'+btoa(svg);
}
function pduSvg(color){
  return 'data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="26" height="18" viewBox="0 0 26 18"><rect x="1" y="1" width="24" height="16" rx="2" fill="${color}" stroke="#000" stroke-width="1.2"/><path d="M1.5 2l11.5 8 11.5-8" fill="none" stroke="#000" stroke-width="1.3"/></svg>`);
}
const _pduIcon={};
function pduIcon(proto){const c=PROTO_COLORS[proto]||PROTO_COLORS.IP;return _pduIcon[c]||(_pduIcon[c]=pduSvg(c));}

// ── helpers ─────────────────────────────────────────────────
const uid=p=>p+Math.random().toString(36).slice(2,9);
const E=s=>(typeof esc==='function'?esc(s):String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
const toast=(c,m)=>{try{af(c,m)}catch(_){console.log('[NetBuilder]',m)}};
function ip4num(ip){const p=String(ip).trim().split('.');if(p.length!==4)return null;let n=0;for(const x of p){const v=+x;if(!(v>=0&&v<=255)||x==='')return null;n=n*256+v;}return n>>>0;}
function matchIp(spec,ip){
  spec=String(spec).trim();if(!spec)return -1;
  if(spec===ip)return 33;                                   // exact beats any CIDR
  const m=spec.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/);
  if(!m)return -1;
  const net=ip4num(m[1]),bits=+m[2],v=ip4num(ip);
  if(net===null||v===null||bits>32)return -1;
  const mask=bits===0?0:(~0<<(32-bits))>>>0;
  return ((net&mask)>>>0)===((v&mask)>>>0)?bits:-1;
}
function isPrivate(ip){
  const n=ip4num(ip);if(n===null)return /^(fe80|fc|fd|::1)/i.test(ip);
  const a=n>>>24,b=(n>>>16)&255;
  return a===10||a===127||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===169&&b===254)||a>=224;
}
function hav(a,b){const R=6371008.8,r=Math.PI/180,dl=(b.lat-a.lat)*r,dn=(b.lon-a.lon)*r;const x=Math.sin(dl/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
function screenToLL(pos){
  try{
    const ray=V.camera.getPickRay(pos);const g=ray&&V.scene.globe.pick(ray,V.scene);
    const c=g||V.camera.pickEllipsoid(pos);if(!c)return null;
    const k=Cesium.Cartographic.fromCartesian(c);return{lat:Cesium.Math.toDegrees(k.latitude),lon:Cesium.Math.toDegrees(k.longitude)};
  }catch(_){return null}
}
function groundH(lat,lon){try{const h=V.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lon,lat));return isFinite(h)?h:0}catch(_){return 0}}
// cable geometry: on the ground for short runs, a lifted 3D arc for long-haul links
function linkPath(a,b,peakFrac){
  const d=hav(a,b);
  if(d<4000)return{clamp:true,pos:[Cesium.Cartesian3.fromDegrees(a.lon,a.lat),Cesium.Cartesian3.fromDegrees(b.lon,b.lat)],dist:d};
  const n=Math.min(96,Math.max(16,Math.round(d/20000)));
  const peak=Math.min(d*(peakFrac||0.12),900000);
  const ha=groundH(a.lat,a.lon),hb=groundH(b.lat,b.lon);
  const g=new Cesium.EllipsoidGeodesic(Cesium.Cartographic.fromDegrees(a.lon,a.lat),Cesium.Cartographic.fromDegrees(b.lon,b.lat));
  const pos=[];
  for(let i=0;i<=n;i++){const t=i/n;const c=g.interpolateUsingFraction(t);pos.push(Cesium.Cartesian3.fromRadians(c.longitude,c.latitude,ha+(hb-ha)*t+Math.sin(Math.PI*t)*peak));}
  return{clamp:false,pos,dist:d};
}
function along(path,t){
  const p=path.pos;if(p.length===1)return p[0];
  if(!path._cum){path._cum=[0];for(let i=1;i<p.length;i++)path._cum.push(path._cum[i-1]+Cesium.Cartesian3.distance(p[i-1],p[i]));}
  const L=path._cum[path._cum.length-1]*Math.max(0,Math.min(1,t));
  let i=1;while(i<path._cum.length-1&&path._cum[i]<L)i++;
  const seg=path._cum[i]-path._cum[i-1]||1,f=(L-path._cum[i-1])/seg;
  return Cesium.Cartesian3.lerp(p[i-1],p[i],f,new Cesium.Cartesian3());
}

// ── state ───────────────────────────────────────────────────
const NB=window.NetBuilder={
  state:{version:1,devices:[],links:[]},
  ents:new Map(),          // id -> entity (devices, links, end lights)
  ghosts:new Map(),        // ip -> {id, lat, lon, kind, lastSeen, ent}
  ghostLinks:new Map(),    // key -> {ent,lastSeen}
  tool:'select', placeType:'router', cableType:'cat6',
  pending:null,            // first device of a cable or ping
  selected:null,
  live:false, seq:0, liveTimer:null, liveFails:0,
  sim:false, simTimer:null,
  paused:false, speed:1, filters:new Set(PROTO_FILTERS),
  pdus:[], pduLog:[], stats:{pkts:0,bytes:0,byProto:{}}, linkTraffic:new Map(),
  handler:null, open_:false
};

function load(){
  try{const s=JSON.parse(localStorage.getItem(LS_KEY)||'null');if(s&&Array.isArray(s.devices)&&Array.isArray(s.links))NB.state=s;}catch(_){}
}
function save(){try{localStorage.setItem(LS_KEY,JSON.stringify(NB.state))}catch(_){}}
const dev=id=>NB.state.devices.find(d=>d.id===id);

// ── rendering of topology ───────────────────────────────────
function drawDevice(d){
  const id='nb:dev:'+d.id;
  const old=NB.ents.get(id);if(old){try{V.entities.remove(old)}catch(_){}}
  const sel=NB.selected&&NB.selected.kind==='dev'&&NB.selected.id===d.id;
  const meta=DEVICES[d.type]||DEVICES.pc;
  const ipTxt=(d.ips||[]).filter(Boolean).slice(0,2).join(', ');
  const e=V.entities.add({
    id,name:(d.name||meta.label),
    position:Cesium.Cartesian3.fromDegrees(d.lon,d.lat),
    billboard:{image:iconSvg(d.type,sel),width:40,height:40,verticalOrigin:Cesium.VerticalOrigin.BOTTOM,
      heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:5e6,
      scaleByDistance:new Cesium.NearFarScalar(2e3,1.25,8e6,0.45)},
    label:{text:(d.name||meta.label)+(ipTxt?'\n'+ipTxt:''),font:'bold 10px JetBrains Mono',fillColor:Cesium.Color.WHITE,
      outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,showBackground:true,
      backgroundColor:Cesium.Color.fromCssColorString('#0a0e14').withAlpha(0.78),backgroundPadding:new Cesium.Cartesian2(5,3),
      verticalOrigin:Cesium.VerticalOrigin.TOP,pixelOffset:new Cesium.Cartesian2(0,6),heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance:5e6,scaleByDistance:new Cesium.NearFarScalar(2e3,1,6e6,0.35),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,9e6)},
    // close in, every device stands on a lit 3D plinth — the "avatar" on the ground
    cylinder:{length:24,topRadius:9,bottomRadius:11,material:Cesium.Color.fromCssColorString(meta.color).withAlpha(0.55),
      outline:true,outlineColor:Cesium.Color.fromCssColorString(meta.color),heightReference:Cesium.HeightReference.RELATIVE_TO_GROUND,
      distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,25000)},
    description:deviceCard(d)
  });
  e._nb={kind:'dev',id:d.id};
  NB.ents.set(id,e);
}
function deviceCard(d){
  const meta=DEVICES[d.type]||DEVICES.pc;
  const links=NB.state.links.filter(l=>l.a===d.id||l.b===d.id).map(l=>{const o=dev(l.a===d.id?l.b:l.a);return o?`${(CABLES[l.cable]||{}).label||l.cable} → ${E(o.name||'')}`:''}).filter(Boolean);
  return `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;background:#0a0e14;padding:12px;color:#E6E9EE;border:1px solid ${meta.color}55">
    <div style="color:${meta.color};font-weight:700;letter-spacing:1px">${E(meta.label.toUpperCase())} — ${E(d.name||'')}</div>
    <div style="margin-top:6px;color:#AEB4BE">IP: ${E((d.ips||[]).join(', ')||'—')}<br>MAC: ${E(d.mac||'—')}<br>${d.lat.toFixed(5)}°, ${d.lon.toFixed(5)}°</div>
    ${links.length?'<div style="margin-top:6px;color:#AEB4BE">LINKS:<br>'+links.join('<br>')+'</div>':''}
    ${d.notes?'<div style="margin-top:6px;white-space:pre-wrap">'+E(d.notes)+'</div>':''}</div>`;
}
function drawLink(l){
  const a=dev(l.a),b=dev(l.b);if(!a||!b)return;
  const id='nb:link:'+l.id;
  ['', ':la', ':lb'].forEach(s=>{const o=NB.ents.get(id+s);if(o){try{V.entities.remove(o)}catch(_){}NB.ents.delete(id+s);}});
  const c=CABLES[l.cable]||CABLES.cat6;
  const col=Cesium.Color.fromCssColorString(c.color);
  // radio links run almost straight (line of sight); wired long-haul links arc high between cities
  const path=linkPath(a,b,['lora','wifi'].includes(l.cable)?0.03:0.12);l._path=path;
  const sel=NB.selected&&NB.selected.kind==='link'&&NB.selected.id===l.id;
  const mat=c.dash?new Cesium.PolylineDashMaterialProperty({color:sel?Cesium.Color.fromCssColorString('#E8B349'):col,dashLength:c.dash}):(sel?Cesium.Color.fromCssColorString('#E8B349'):col);
  const e=V.entities.add({id,name:(c.label)+': '+(a.name||'')+' ↔ '+(b.name||''),
    polyline:{positions:path.pos,width:sel?c.width+3:c.width,material:mat,clampToGround:path.clamp,
      // terrain heights aren't loaded when a cable is drawn, so a raised link can dip under the hills: keep it visible through them
      depthFailMaterial:path.clamp?undefined:(c.dash?new Cesium.PolylineDashMaterialProperty({color:col.withAlpha(0.55),dashLength:c.dash}):new Cesium.ColorMaterialProperty(col.withAlpha(0.55))),
      arcType:path.clamp?Cesium.ArcType.GEODESIC:Cesium.ArcType.NONE},
    description:`<div style="font-family:monospace;font-size:11px;background:#0a0e14;padding:12px;color:#E6E9EE">${E(c.label)}<br>${E(a.name||'')} ↔ ${E(b.name||'')}<br>${(path.dist/1000).toFixed(path.dist<10000?2:0)} km</div>`});
  e._nb={kind:'link',id:l.id};NB.ents.set(id,e);
  // Packet Tracer port lights near each end: green = up, bright = traffic in last 10 s
  const mk=(t,side)=>{const le=V.entities.add({id:id+side,position:along(path,t),
    point:{pixelSize:7,color:Cesium.Color.fromCssColorString('#2ECC71'),outlineColor:Cesium.Color.BLACK,outlineWidth:1,
      heightReference:path.clamp?Cesium.HeightReference.CLAMP_TO_GROUND:Cesium.HeightReference.NONE,disableDepthTestDistance:5e6,
      distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,Math.max(60000,path.dist*6))}});le._nb={kind:'link',id:l.id};NB.ents.set(id+side,le);};
  const endT=Math.min(0.12,Math.max(0.02,25/Math.max(1,path.dist)));
  mk(endT,':la');mk(1-endT,':lb');
}
function redrawAll(){
  for(const e of NB.ents.values()){try{V.entities.remove(e)}catch(_){}}
  NB.ents.clear();
  NB.state.devices.forEach(drawDevice);
  NB.state.links.forEach(drawLink);
  kick();
}
function relinkDevice(id){NB.state.links.filter(l=>l.a===id||l.b===id).forEach(drawLink);}
// cables are built on web workers; keep rendering briefly so they appear without a camera nudge
let _settleT=null;
const kick=()=>{try{V.scene.requestRender();BDOCRender.hold('netbuilder-draw');clearTimeout(_settleT);_settleT=setTimeout(()=>{try{BDOCRender.release('netbuilder-draw')}catch(_){}},2500);}catch(_){}};

// ── topology edits ──────────────────────────────────────────
function addDevice(type,lat,lon,extra){
  const meta=DEVICES[type]||DEVICES.pc;
  const n=NB.state.devices.filter(d=>d.type===type).length+1;
  const d=Object.assign({id:uid('d'),type,name:meta.label+' '+n,lat,lon,ips:[],mac:'',notes:'',capture:false},extra||{});
  NB.state.devices.push(d);drawDevice(d);save();
  return d;
}
function addLink(a,b,cable){
  if(a===b)return null;
  if(NB.state.links.some(l=>(l.a===a&&l.b===b)||(l.a===b&&l.b===a))){toast('var(--yl)','Those two devices are already cabled');return null;}
  const l={id:uid('l'),a,b,cable:cable||NB.cableType};
  NB.state.links.push(l);drawLink(l);save();
  const A=dev(a),B=dev(b);toast('var(--bl)',`${(CABLES[l.cable]||{}).label}: ${A.name} ↔ ${B.name}`);
  return l;
}
function removeDevice(id){
  NB.state.links.filter(l=>l.a===id||l.b===id).forEach(l=>removeLink(l.id,true));
  NB.state.devices=NB.state.devices.filter(d=>d.id!==id);
  const e=NB.ents.get('nb:dev:'+id);if(e){try{V.entities.remove(e)}catch(_){}NB.ents.delete('nb:dev:'+id);}
  if(NB.selected&&NB.selected.id===id)select(null);
  save();kick();
}
function removeLink(id,quiet){
  NB.state.links=NB.state.links.filter(l=>l.id!==id);
  ['', ':la', ':lb'].forEach(s=>{const k='nb:link:'+id+s;const e=NB.ents.get(k);if(e){try{V.entities.remove(e)}catch(_){}NB.ents.delete(k);}});
  if(NB.selected&&NB.selected.id===id)select(null);
  if(!quiet){save();kick();}
}
function moveDevice(id,lat,lon){const d=dev(id);if(!d)return;d.lat=lat;d.lon=lon;const e=NB.ents.get('nb:dev:'+id);if(e)e.position=Cesium.Cartesian3.fromDegrees(lon,lat);}

// ── selection + property card ───────────────────────────────
function select(kind,id){
  const prev=NB.selected;NB.selected=kind?{kind,id}:null;
  if(prev&&prev.kind==='dev'&&dev(prev.id))drawDevice(dev(prev.id));
  if(prev&&prev.kind==='link'){const l=NB.state.links.find(x=>x.id===prev.id);if(l)drawLink(l);}
  if(kind==='dev'&&dev(id))drawDevice(dev(id));
  if(kind==='link'){const l=NB.state.links.find(x=>x.id===id);if(l)drawLink(l);}
  renderProps();kick();
}
function renderProps(){
  const el=document.getElementById('nbProps');if(!el)return;
  const s=NB.selected;
  if(!s){el.style.display='none';return;}
  el.style.display='block';
  if(s.kind==='dev'){
    const d=dev(s.id);if(!d){el.style.display='none';return;}
    const meta=DEVICES[d.type]||DEVICES.pc;
    const linkRows=NB.state.links.filter(l=>l.a===d.id||l.b===d.id).map(l=>{const o=dev(l.a===d.id?l.b:l.a);const t=NB.linkTraffic.get(l.id);return `<div class="nb-lr"><i style="background:${(CABLES[l.cable]||CABLES.cat6).color}"></i>${E((CABLES[l.cable]||{}).label||l.cable)} → ${E(o?o.name:'?')}${t?` <b>${t.pkts} pkts</b>`:''}</div>`}).join('')||'<div class="nb-dim">No cables yet — pick a cable type and click this device, then another.</div>';
    el.innerHTML=`<div class="nb-ph"><img src="${iconSvg(d.type,false)}"><div><b style="color:${meta.color}">${E(meta.label.toUpperCase())}</b><span>${d.lat.toFixed(5)}°, ${d.lon.toFixed(5)}°</span></div><button onclick="NetBuilder.select(null)">×</button></div>
      <label>NAME<input id="nbpName" value="${E(d.name||'')}"></label>
      <label>IP ADDRESSES <em>comma-separated · CIDR ok (192.168.10.0/24)</em><input id="nbpIps" value="${E((d.ips||[]).join(', '))}" placeholder="192.168.10.21"></label>
      <label>MAC<input id="nbpMac" value="${E(d.mac||'')}" placeholder="optional"></label>
      <label>NOTES<textarea id="nbpNotes" rows="2">${E(d.notes||'')}</textarea></label>
      <label class="nb-ck"><input type="checkbox" id="nbpCap" ${d.capture?'checked':''}> THIS IS MY CAPTURE MACHINE <em>(Wireshark runs here — unknown LAN IPs appear around it)</em></label>
      <div class="nb-sub">CABLES</div>${linkRows}
      <div class="nb-row"><button onclick="NetBuilder.flyTo('${d.id}')">FLY TO</button><button onclick="NetBuilder.startPing('${d.id}')">PING FROM HERE</button><button class="nb-danger" onclick="NetBuilder.removeDevice('${d.id}')">DELETE</button></div>`;
    const upd=()=>{d.name=document.getElementById('nbpName').value.trim();d.ips=document.getElementById('nbpIps').value.split(/[,\s]+/).map(x=>x.trim()).filter(Boolean);
      d.mac=document.getElementById('nbpMac').value.trim();d.notes=document.getElementById('nbpNotes').value;d.capture=document.getElementById('nbpCap').checked;
      if(d.capture)NB.state.devices.forEach(o=>{if(o!==d)o.capture=false});
      save();drawDevice(d);relinkDevice(d.id);kick();};
    ['nbpName','nbpIps','nbpMac','nbpNotes'].forEach(k=>{const i=document.getElementById(k);i.addEventListener('change',upd);i.addEventListener('keydown',ev=>ev.stopPropagation());});
    document.getElementById('nbpCap').addEventListener('change',upd);
  }else{
    const l=NB.state.links.find(x=>x.id===s.id);if(!l){el.style.display='none';return;}
    const a=dev(l.a),b=dev(l.b);const t=NB.linkTraffic.get(l.id);
    el.innerHTML=`<div class="nb-ph"><div><b>CABLE</b><span>${E(a?a.name:'?')} ↔ ${E(b?b.name:'?')} · ${((l._path&&l._path.dist||0)/1000).toFixed(2)} km</span></div><button onclick="NetBuilder.select(null)">×</button></div>
      <label>TYPE<select id="nbpCable">${Object.entries(CABLES).map(([k,c])=>`<option value="${k}" ${k===l.cable?'selected':''}>${c.label}</option>`).join('')}</select></label>
      ${t?`<div class="nb-dim">${t.pkts} packets · ${(t.bytes/1024).toFixed(1)} KB seen on this cable</div>`:''}
      <div class="nb-row"><button class="nb-danger" onclick="NetBuilder.removeLink('${l.id}')">DELETE CABLE</button></div>`;
    document.getElementById('nbpCable').addEventListener('change',e=>{l.cable=e.target.value;save();drawLink(l);kick();});
  }
}

// ── routing: shortest hop path over the cables you drew ─────
function graphPath(a,b){
  if(a===b)return[a];
  const adj=new Map();
  for(const l of NB.state.links){(adj.get(l.a)||adj.set(l.a,[]).get(l.a)).push(l.b);(adj.get(l.b)||adj.set(l.b,[]).get(l.b)).push(l.a);}
  const prev=new Map([[a,null]]),q=[a];
  while(q.length){const x=q.shift();if(x===b)break;for(const y of (adj.get(x)||[]))if(!prev.has(y)){prev.set(y,x);q.push(y);}}
  if(!prev.has(b))return null;
  const out=[];for(let x=b;x!==null;x=prev.get(x))out.unshift(x);return out;
}
function linkBetween(a,b){return NB.state.links.find(l=>(l.a===a&&l.b===b)||(l.a===b&&l.b===a));}
function edgeDevice(fromId){
  // where traffic leaves your network: Internet cloud first, then firewall/router reachable from the source
  const order=['cloud','firewall','router','sat','tower'];
  for(const t of order){
    const cands=NB.state.devices.filter(d=>d.type===t);
    for(const c of cands){if(graphPath(fromId,c.id))return c;}
  }
  return null;
}

// ── IP → endpoint resolution (placed device, internet ghost, LAN ghost) ─
function deviceForIp(ip){
  let best=null,bestBits=-1;
  for(const d of NB.state.devices)for(const spec of (d.ips||[])){const b=matchIp(spec,ip);if(b>bestBits){bestBits=b;best=d;}}
  return best;
}
function captureDevice(){return NB.state.devices.find(d=>d.capture)||null;}
function ghostFor(ip,geo){
  let g=NB.ghosts.get(ip);
  if(g){g.lastSeen=Date.now();return g;}
  let lat,lon,kind;
  if(geo&&isFinite(geo.lat)&&isFinite(geo.lon)&&!isPrivate(ip)){lat=geo.lat;lon=geo.lon;kind='internet';}
  else{
    const cap=captureDevice()||NB.state.devices[0];
    let c;if(cap)c={lat:cap.lat,lon:cap.lon};else{const k=V.camera.positionCartographic;c={lat:Cesium.Math.toDegrees(k.latitude),lon:Cesium.Math.toDegrees(k.longitude)};}
    // fan unknown LAN hosts around the capture device so they don't stack
    const i=Array.from(NB.ghosts.values()).filter(x=>x.kind==='lan').length;
    const ang=i*2.399963,rad=0.0012*(1+Math.floor(i/8)*0.6);
    lat=c.lat+rad*Math.cos(ang);lon=c.lon+rad*Math.sin(ang)/Math.cos(c.lat*Math.PI/180);kind=/^!/.test(ip)?'mesh':isPrivate(ip)?'lan':'internet';
  }
  if(NB.ghosts.size>=300){let old=null;for(const x of NB.ghosts.values())if(!old||x.lastSeen<old.lastSeen)old=x;if(old){try{V.entities.remove(old.ent)}catch(_){}NB.ghosts.delete(old.ip);}}
  g={ip,lat,lon,kind,lastSeen:Date.now(),id:'nb:ghost:'+ip};
  const col=kind==='internet'?'#90CAF9':kind==='mesh'?'#76FF03':'#FFD54F';
  g.ent=V.entities.add({id:g.id,name:(kind==='internet'?'Internet host ':'LAN host ')+ip,position:Cesium.Cartesian3.fromDegrees(lon,lat),
    point:{pixelSize:9,color:Cesium.Color.fromCssColorString(col).withAlpha(0.9),outlineColor:Cesium.Color.BLACK,outlineWidth:1.5,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:5e6},
    label:{text:ip,font:'9px JetBrains Mono',fillColor:Cesium.Color.fromCssColorString(col),outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin:Cesium.VerticalOrigin.TOP,pixelOffset:new Cesium.Cartesian2(0,8),heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:5e6,
      distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,kind==='lan'?60000:4e6)},
    description:`<div style="font-family:monospace;font-size:11px;background:#0a0e14;padding:12px;color:#E6E9EE"><b>${kind==='internet'?'INTERNET HOST':'UNMAPPED LAN HOST'}</b><br>${E(ip)}<br><br><button onclick="parent.NetBuilder.adopt('${E(ip)}')" style="padding:5px 10px;background:#0a0e14;color:#E8B349;border:1px solid #E8B34966;cursor:pointer;font-family:monospace">ADOPT AS DEVICE</button></div>`});
  g.ent._nb={kind:'ghost',ip};
  NB.ghosts.set(ip,g);
  return g;
}
function endpoint(ip,geo){
  const d=deviceForIp(ip);
  if(d)return{kind:'dev',id:d.id,lat:d.lat,lon:d.lon,name:d.name};
  const g=ghostFor(ip,geo);
  return{kind:'ghost',ip,lat:g.lat,lon:g.lon,name:ip,g};
}
function ghostLink(a,b){
  const key=a.ip||a.id;const k2=b.ip||b.id;const k=key<k2?key+'|'+k2:k2+'|'+key;
  let gl=NB.ghostLinks.get(k);
  if(!gl){
    const path=linkPath(a,b);
    gl={k,path,lastSeen:Date.now(),ent:V.entities.add({id:'nb:gl:'+k,polyline:{positions:path.pos,width:1.5,clampToGround:path.clamp,
      arcType:path.clamp?Cesium.ArcType.GEODESIC:Cesium.ArcType.NONE,material:new Cesium.PolylineDashMaterialProperty({color:Cesium.Color.WHITE.withAlpha(0.35),dashLength:6})}})};
    NB.ghostLinks.set(k,gl);
  }
  gl.lastSeen=Date.now();
  return gl;
}
// Build the hop list a packet travels: [{path, from, to, reverse}]
function hopsFor(src,dst){
  const hops=[];
  const devHops=(ids)=>{for(let i=0;i<ids.length-1;i++){const l=linkBetween(ids[i],ids[i+1]);if(!l||!l._path)return false;hops.push({path:l._path,rev:l.a!==ids[i],link:l.id,at:ids[i+1]});}return true;};
  if(src.kind==='dev'&&dst.kind==='dev'){
    const p=graphPath(src.id,dst.id);
    if(p&&p.length>1&&devHops(p))return hops;
    hops.push({path:ghostLink(src,dst).path,rev:false,at:dst.id});return hops;
  }
  if(src.kind==='dev'&&dst.kind==='ghost'){
    const edge=dst.g.kind==='internet'?edgeDevice(src.id):null;
    if(edge&&edge.id!==src.id){const p=graphPath(src.id,edge.id);if(p&&devHops(p)){const e={kind:'dev',id:edge.id,lat:edge.lat,lon:edge.lon};const gl=ghostLink(e,dst);hops.push({path:gl.path,rev:!sameStart(gl.path,e),at:dst.ip});return hops;}}
    const gl=ghostLink(src,dst);hops.push({path:gl.path,rev:!sameStart(gl.path,src),at:dst.ip});return hops;
  }
  if(src.kind==='ghost'&&dst.kind==='dev'){
    const back=hopsFor(dst,src);   // mirror of the outbound route
    return back.reverse().map(h=>({path:h.path,rev:!h.rev,link:h.link,at:dst.id}));
  }
  const gl=ghostLink(src,dst);hops.push({path:gl.path,rev:!sameStart(gl.path,src),at:dst.ip});return hops;
}
function sameStart(path,pt){const p0=Cesium.Cartographic.fromCartesian(path.pos[0]);return Math.abs(Cesium.Math.toDegrees(p0.latitude)-pt.lat)<1e-6&&Math.abs(Cesium.Math.toDegrees(p0.longitude)-pt.lon)<1e-6;}

// ── PDU animation ───────────────────────────────────────────
const MAX_PDUS=90;
function launch(pkt,src,dst){
  const proto=pkt.protocol||'IP';
  const hops=hopsFor(src,dst);if(!hops.length)return;
  hops.forEach(h=>{if(h.link){const t=NB.linkTraffic.get(h.link)||{pkts:0,bytes:0,last:0};t.pkts++;t.bytes+=(pkt.packet_size||0);t.last=Date.now();NB.linkTraffic.set(h.link,t);}});
  if(NB.pdus.length>=MAX_PDUS)return;           // counted, just not animated
  const hopMs=Math.max(250,Math.min(1600,700/NB.speed));
  const tag=(pkt.tcp_flags&&proto!=='ARP'?proto+' '+pkt.tcp_flags:proto);
  const pdu={hops,start:performance.now(),hopMs,done:false};
  const clampFirst=hops[0].path.clamp;
  pdu.ent=V.entities.add({
    position:new Cesium.CallbackProperty(()=>pduPos(pdu),false),
    billboard:{image:pduIcon(proto),width:22,height:15,disableDepthTestDistance:5e6,
      heightReference:clampFirst?Cesium.HeightReference.CLAMP_TO_GROUND:Cesium.HeightReference.NONE,
      scaleByDistance:new Cesium.NearFarScalar(2e3,1.3,8e6,0.6)},
    label:{text:tag,font:'bold 9px JetBrains Mono',fillColor:Cesium.Color.fromCssColorString(PROTO_COLORS[proto]||'#fff'),outlineColor:Cesium.Color.BLACK,outlineWidth:3,
      style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-15),disableDepthTestDistance:5e6,
      heightReference:clampFirst?Cesium.HeightReference.CLAMP_TO_GROUND:Cesium.HeightReference.NONE,
      distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,3e6)}
  });
  NB.pdus.push(pdu);
  try{BDOCRender.hold('netbuilder')}catch(_){}
}
function pduPos(p){
  const t=(performance.now()-p.start)/p.hopMs;
  const i=Math.min(p.hops.length-1,Math.floor(t)),f=Math.min(1,t-i);
  const h=p.hops[i];
  return along(h.path,h.rev?1-f:f);
}
function tickPdus(){
  if(!NB.pdus.length)return;
  const now=performance.now();
  NB.pdus=NB.pdus.filter(p=>{
    if(NB.paused){p.start+=16;return true;}  // freeze in place while paused
    if(now-p.start>p.hopMs*p.hops.length+120){try{V.entities.remove(p.ent)}catch(_){}return false;}
    return true;
  });
  if(!NB.pdus.length){try{BDOCRender.release('netbuilder')}catch(_){}}
}

// ── packet intake (live + sim) ──────────────────────────────
function protoBucket(p){const k=(p||'IP').toUpperCase();return MESH_SET.has(k)?'MESH':PROTO_FILTERS.includes(k)?k:(k==='QUIC'||k==='DHCP'||k==='NTP'||k==='MDNS'?'UDP':'OTHER');}
function ingest(pkt,origin){
  if(!pkt||!pkt.src_ip||!pkt.dst_ip)return;
  NB.stats.pkts++;NB.stats.bytes+=(pkt.packet_size||0);
  const pr=(pkt.protocol||'IP').toUpperCase();NB.stats.byProto[pr]=(NB.stats.byProto[pr]||0)+1;
  if(!NB.filters.has(protoBucket(pr)))return;
  if(pkt.broadcast){
    // a mesh broadcast is one RF transmission heard by every radio neighbour of the sender
    const src=endpoint(pkt.src_ip);
    logPdu(pkt,src,{name:'broadcast'},origin);
    if(NB.paused||src.kind!=='dev')return;
    for(const l of NB.state.links){
      if(l.a!==src.id&&l.b!==src.id)continue;
      if(!['lora','wifi','sat'].includes(l.cable))continue;
      const o=dev(l.a===src.id?l.b:l.a);if(!o)continue;
      launch(pkt,src,{kind:'dev',id:o.id,lat:o.lat,lon:o.lon,name:o.name});
    }
    return;
  }
  const src=endpoint(pkt.src_ip,pkt.geo_src),dst=endpoint(pkt.dst_ip,pkt.geo_dst);
  logPdu(pkt,src,dst,origin);
  if(!NB.paused)launch(pkt,src,dst);
}
function meshToPkt(e){
  const label=MESH_LABELS[e.portnum]||(typeof e.portnum==='string'?e.portnum.replace(/_APP$/,''):'MESH');
  const bc=!e.to||e.to==='^all'||e.to==='!ffffffff';
  const hop=(e.hop_limit!=null&&e.hop_start!=null)?` · hop ${e.hop_start-e.hop_limit}/${e.hop_start}`:'';
  const sig=e.snr!=null?` · ${e.snr} dB`:'';
  return {protocol:label,src_ip:String(e.from),dst_ip:bc?'^all':String(e.to),broadcast:bc,packet_size:e.size||0,
    info:(e.info||(e.text?'"'+e.text.slice(0,60)+'"':label))+hop+sig};
}
function logPdu(p,src,dst,origin){
  const info=p.info||(p.tcp_flags?`${p.src_port||''} → ${p.dst_port||''} [${p.tcp_flags}]`:(p.icmp_type===8?'Echo request':p.icmp_type===0?'Echo reply':(p.dst_port?`→ :${p.dst_port}`:'')));
  NB.pduLog.unshift({t:new Date(),src:src.name||p.src_ip,dst:dst.name||p.dst_ip,sip:p.src_ip,dip:p.dst_ip,proto:(p.protocol||'IP').toUpperCase(),info,size:p.packet_size||0,origin,sid:src.id||null});
  if(NB.pduLog.length>250)NB.pduLog.length=250;
  NB._logDirty=true;
}
function renderLog(){
  if(!NB._logDirty)return;NB._logDirty=false;
  const el=document.getElementById('nbLogRows');if(!el)return;
  el.innerHTML=NB.pduLog.slice(0,120).map(r=>`<tr${r.sid?` onclick="NetBuilder.flyTo('${r.sid}')"`:''}><td>${r.t.toTimeString().slice(0,8)}</td><td title="${E(r.sip)}">${E(r.src)}</td><td title="${E(r.dip)}">${E(r.dst)}</td><td><i style="background:${PROTO_COLORS[r.proto]||'#ddd'}"></i>${E(r.proto)}</td><td>${E(r.info)}</td></tr>`).join('');
  const st=document.getElementById('nbStats');
  if(st){const top=Object.entries(NB.stats.byProto).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>`${k} ${v}`).join(' · ');
    st.textContent=`${NB.stats.pkts} pkts · ${(NB.stats.bytes/1048576).toFixed(2)} MB${top?' · '+top:''}`;}
}
// LIVE: poll the local receiver's event stream
async function pollLive(){
  if(!NB.live)return;
  try{
    const ctl=new AbortController();const to=setTimeout(()=>ctl.abort(),1500);
    const r=await fetch(`${IPC}/wireshark/events?since=${NB.seq}&limit=600`,{signal:ctl.signal,cache:'no-store'});clearTimeout(to);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const j=await r.json();
    if(NB.seq===0&&j.seq)NB.seq=Math.max(0,j.seq-(j.events||[]).length);
    for(const e of (j.events||[]))ingest(e,'live');
    if(j.seq)NB.seq=j.seq;
    try{   // p156: mesh RF packets (grid_down_gateway.py / skybridge.py) ride the same LIVE switch
      const rm=await fetch(`${IPC}/mesh/events?since=${NB.meshSeq||0}&limit=600`,{cache:'no-store'});
      if(rm.ok){const jm=await rm.json();if(!NB.meshSeq&&jm.seq)NB.meshSeq=Math.max(0,jm.seq-(jm.events||[]).length);
        for(const e of (jm.events||[]))ingest(meshToPkt(e),'mesh');if(jm.seq)NB.meshSeq=jm.seq;}
    }catch(_){}
    NB.liveFails=0;setLiveBadge('LIVE','#3DFFB0');
  }catch(e){
    NB.liveFails++;
    setLiveBadge(NB.liveFails>3?'NO RECEIVER':'CONNECTING…',NB.liveFails>3?'#FF6B66':'#E8B349');
    // Chrome 141+ asks before a website may talk to 127.0.0.1 ("access other apps and services on this device")
    if(NB.liveFails===4)toast('var(--yl)','Network Builder: no packet receiver reachable. Start it with: node tools/bdoc-ipc-receiver.js  and  python3 tools/adapters/wireshark_adapter.py — if Chrome asked to access apps on this device, click Allow (site settings → Local network access).');
  }
  NB.liveTimer=setTimeout(pollLive,NB.liveFails>3?3000:500);
}
function setLiveBadge(t,c){const b=document.getElementById('nbLiveBadge');if(b){b.textContent=t;b.style.color=c;b.style.borderColor=c+'88';}}
function toggleLive(on){
  NB.live=typeof on==='boolean'?on:!NB.live;
  const b=document.getElementById('nbLiveBtn');if(b)b.classList.toggle('on',NB.live);
  clearTimeout(NB.liveTimer);
  if(NB.live){NB.seq=0;NB.meshSeq=0;NB.liveFails=0;setLiveBadge('CONNECTING…','#E8B349');try{window.pluginRenderer&&pluginRenderer.enable()}catch(_){}pollLive();}
  else setLiveBadge('OFF','#8B919A');
}

// SIM: Packet Tracer "simple PDU" ping + a background traffic generator
function ipOf(d){return (d.ips||[]).find(x=>!x.includes('/'))||null;}
function startPing(fromId){
  NB.tool='ping';NB.pending=fromId?{kind:'ping',id:fromId}:null;markTool();
  toast('var(--yl)',fromId?'PING: click the destination device':'PING: click the source device, then the destination');
}
function ping(aId,bId){
  const a=dev(aId),b=dev(bId);if(!a||!b)return;
  const A={kind:'dev',id:a.id,lat:a.lat,lon:a.lon,name:a.name},B={kind:'dev',id:b.id,lat:b.lat,lon:b.lon,name:b.name};
  const path=graphPath(a.id,b.id);
  const sip=ipOf(a)||'(no ip)',dip=ipOf(b)||'(no ip)';
  if(!path){
    logPdu({protocol:'ICMP',src_ip:sip,dst_ip:dip,info:'Destination host unreachable — no cable path',packet_size:98},A,B,'sim');
    toast('var(--rd)',`PING ${a.name} → ${b.name}: FAILED — no cabled path between them`);
    flashFail(a);return;
  }
  const req={protocol:'ICMP',src_ip:sip,dst_ip:dip,icmp_type:8,packet_size:98,info:'Echo request'};
  logPdu(req,A,B,'sim');launch(req,A,B);
  const hopsN=path.length-1;const back=Math.max(250,Math.min(1600,700/NB.speed))*hopsN+150;
  setTimeout(()=>{const rep={protocol:'ICMP',src_ip:dip,dst_ip:sip,icmp_type:0,packet_size:98,info:`Echo reply · ${hopsN} hop${hopsN>1?'s':''}`};logPdu(rep,B,A,'sim');launch(rep,B,A);
    toast('var(--gn)',`PING ${a.name} → ${b.name}: reply over ${hopsN} hop${hopsN>1?'s':''}`);},back);
}
function flashFail(d){
  const e=V.entities.add({position:Cesium.Cartesian3.fromDegrees(d.lon,d.lat),label:{text:'✕ UNREACHABLE',font:'bold 12px JetBrains Mono',fillColor:Cesium.Color.fromCssColorString('#FF5252'),
    outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-52),heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:5e6}});
  kick();setTimeout(()=>{try{V.entities.remove(e)}catch(_){}kick();},2500);
}
const SIM_PLAYS=[
  // [src role, dst role, proto, flags, info, dport]
  ['laptop','dns','DNS',null,'DNS query example.com',53],['dns','laptop','DNS',null,'DNS answer 93.184.215.14',0],
  ['laptop','web','TCP','SYN','',443],['web','laptop','TCP','SYN-ACK','',0],['laptop','web','TCP','ACK','',443],
  ['laptop','web','TLS','PSH-ACK','TLS Client Hello',443],['web','laptop','TLS','ACK','TLS Server Hello + cert',0],
  ['camera','server','RTSP',null,'RTP video',554],['iot','server','MQTT','PSH-ACK','MQTT PUBLISH sensors/temp',1883],
  ['pc','server','SMB','PSH-ACK','SMB2 Read',445],['server','pc','SMB','PSH-ACK','SMB2 Read Response',0],
  ['phone','ap','DNS',null,'DNS api.weather.gov',53]
];
function simRole(role){
  const pick=t=>NB.state.devices.filter(d=>d.type===t);
  const map={laptop:['laptop','pc'],pc:['pc','laptop'],phone:['phone','laptop'],camera:['camera'],iot:['iot','plc','mesh'],server:['server'],ap:['ap','router'],dns:['cloud'],web:['cloud']};
  for(const t of (map[role]||[role])){const c=pick(t);if(c.length)return c[Math.floor(Math.random()*c.length)];}
  return null;
}
function toggleSim(on){
  NB.sim=typeof on==='boolean'?on:!NB.sim;
  const b=document.getElementById('nbSimBtn');if(b)b.classList.toggle('on',NB.sim);
  clearInterval(NB.simTimer);
  if(!NB.sim)return;
  if(NB.state.devices.length<2){toast('var(--yl)','Place at least two cabled devices (or press DEMO NETWORK) to simulate traffic');NB.sim=false;if(b)b.classList.remove('on');return;}
  let i=0;
  NB.simTimer=setInterval(()=>{
    if(NB.paused)return;
    const [sr,dr,proto,flags,info,dport]=SIM_PLAYS[i++%SIM_PLAYS.length];
    let s=simRole(sr),d=simRole(dr);
    if(!s||!d||s===d){const all=NB.state.links;if(!all.length)return;const l=all[Math.floor(Math.random()*all.length)];s=dev(l.a);d=dev(l.b);}
    const sip=ipOf(s)||('10.0.0.'+(2+NB.state.devices.indexOf(s))),dip=ipOf(d)||('10.0.0.'+(2+NB.state.devices.indexOf(d)));
    const pkt={protocol:proto,src_ip:sip,dst_ip:dip,dst_port:dport,packet_size:proto==='RTSP'?1400:120,info,tcp_flags:flags||undefined};
    const A={kind:'dev',id:s.id,lat:s.lat,lon:s.lon,name:s.name},B={kind:'dev',id:d.id,lat:d.lat,lon:d.lon,name:d.name};
    NB.stats.pkts++;NB.stats.byProto[proto]=(NB.stats.byProto[proto]||0)+1;
    if(!NB.filters.has(protoBucket(proto)))return;
    logPdu(pkt,A,B,'sim');launch(pkt,A,B);
  },Math.max(120,520/NB.speed));
}

// ── demo network (Packet Tracer starter lab, built where you're looking) ─
function demoNetwork(){
  const k=V.camera.positionCartographic;let lat=Cesium.Math.toDegrees(k.latitude),lon=Cesium.Math.toDegrees(k.longitude);
  if(k.height>3e6){lat=33.749;lon=-84.388;}   // zoomed out: drop it in Atlanta
  const off=(dLat,dLon)=>[lat+dLat,lon+dLon/Math.cos(lat*Math.PI/180)];
  const P=(t,name,ips,dLat,dLon,extra)=>{const [a,b]=off(dLat,dLon);return addDevice(t,a,b,Object.assign({name,ips},extra||{}));};
  // offsets in degrees: a ~5 x 3 km campus, uplink on the left, LAN fanned out to the right
  const inet=P('cloud','Internet',['8.8.8.8','93.184.215.14'],0.010,-0.026);
  const fw=P('firewall','Edge Firewall',['203.0.113.10'],0.010,-0.016);
  const rtr=P('router','Core Router',['192.168.10.1'],0.010,-0.006);
  const sw=P('switch','Access Switch',['192.168.10.2'],0.002,0.000);
  const lap=P('laptop','Ops Laptop',['192.168.10.21'],-0.008,-0.012,{capture:true});
  const pc=P('pc','Analyst PC',['192.168.10.22'],-0.010,-0.003);
  const cam=P('camera','Gate Camera',['192.168.10.60'],-0.010,0.006);
  const nvr=P('server','NVR',['192.168.10.50'],-0.006,0.014);
  const ap=P('ap','Wi-Fi AP',['192.168.10.3'],0.010,0.010);
  const ph=P('phone','Field Phone',['192.168.10.40'],0.016,0.018);
  const iot=P('iot','Weather Sensor',['192.168.10.70'],0.006,0.022);
  // remote site ~ 350 km away over fiber, Packet Tracer "WAN" style
  const [ra,rb]=off(2.4,-2.1);
  const rr=addDevice('router',ra,rb,{name:'Remote Router',ips:['10.20.0.1']});
  const srv=addDevice('server',ra-0.006,rb,{name:'Data Server',ips:['10.20.0.10']});
  addLink(inet.id,fw.id,'fiber');addLink(fw.id,rtr.id,'cat6');addLink(rtr.id,sw.id,'cat6');
  addLink(sw.id,lap.id,'cat6');addLink(sw.id,pc.id,'cat6');addLink(sw.id,ap.id,'cat6');addLink(ap.id,ph.id,'wifi');
  addLink(sw.id,cam.id,'cat6');addLink(sw.id,nvr.id,'cat6');addLink(ap.id,iot.id,'wifi');
  addLink(rtr.id,rr.id,'fiber');addLink(rr.id,srv.id,'cat6');
  select(null);
  // frame the campus in the part of the screen the dock doesn't cover
  V.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(lon-0.002,lat-0.062,7400),orientation:{heading:0,pitch:Cesium.Math.toRadians(-52),roll:0},duration:1.6});
  toast('var(--gn)','Demo network built — press SIM TRAFFIC, or LIVE with the adapter in --demo-lan mode');
}

// p156: Skybridge demo -- satellite -> dish -> Pi -> mesh gateway -> relays -> laptops.
// Node ids match `python tools/skybridge.py demo`, so its simulated RF traffic animates here.
function skybridgeDemo(){
  const P=(t,name,ips,lat,lon,extra)=>addDevice(t,lat,lon,Object.assign({name,ips},extra||{}));
  const sat=P('sat','GOES-19 (75.2°W)',['GOES-19'],0.0,-75.2,{notes:'Geostationary sub-satellite point. HRIT/EMWIN downlink 1694.1 MHz.'});
  // co-located in reality; spread a few km here so every device stays readable
  const gs=P('dish','Ground Station',['GS-ATL'],34.030,-84.640,{notes:'1.2 m dish + LNA/filter + SDR, solar powered.'});
  const pi=P('server','Skybridge Pi',['10.0.0.5'],34.035,-84.560,{notes:'SatDump/goestools -> tools/skybridge.py'});
  const gw=P('mesh','Mesh Gateway · Kennesaw Mtn',['!b0c00001'],33.977,-84.578,{notes:'Meshtastic router on high ground, dedicated Skybridge channel.'});
  const r1=P('mesh','Relay Marietta',['!b0c00002'],33.930,-84.470);
  const r2=P('mesh','Relay Midtown',['!b0c00003'],33.790,-84.385);
  const l1=P('laptop','Field Laptop (offline)',['!b0c00011'],33.700,-84.300,{capture:true});
  const l2=P('laptop','Shelter Laptop',['!b0c00012'],33.840,-84.560);
  addLink(sat.id,gs.id,'sat');addLink(gs.id,pi.id,'coax');addLink(pi.id,gw.id,'serial');
  addLink(gw.id,r1.id,'lora');addLink(r1.id,r2.id,'lora');addLink(r2.id,l1.id,'lora');addLink(r1.id,l2.id,'lora');
  select(null);
  // north-up, tilted: the whole mesh above the dock, the satellite downlink running off to the south
  V.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(-84.47,33.19,68000),orientation:{heading:0,pitch:Cesium.Math.toRadians(-52),roll:0},duration:1.8});
  toast('var(--gn)','Skybridge demo built — press LIVE WIRESHARK, then run: python tools/skybridge.py demo --loop 0');
}

// ── import / export ─────────────────────────────────────────
function exportJson(){
  const blob=new Blob([JSON.stringify({bdoc_netbuilder:1,exported:new Date().toISOString(),devices:NB.state.devices,links:NB.state.links.map(({_path,...l})=>l)},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='bdoc-network-'+new Date().toISOString().slice(0,10)+'.bdocnet.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function importJson(){
  const i=document.createElement('input');i.type='file';i.accept='.json,application/json';
  i.onchange=()=>{const f=i.files[0];if(!f)return;f.text().then(t=>{const j=JSON.parse(t);if(!Array.isArray(j.devices)||!Array.isArray(j.links))throw new Error('not a BDOC network file');
    NB.state={version:1,devices:j.devices,links:j.links};save();redrawAll();toast('var(--gn)',`Imported ${j.devices.length} devices, ${j.links.length} cables`);}).catch(e=>toast('var(--rd)','Import failed: '+e.message));};
  i.click();
}
function clearAll(){
  if(!confirm(`Remove all ${NB.state.devices.length} devices and ${NB.state.links.length} cables?`))return;
  NB.state={version:1,devices:[],links:[]};save();select(null);redrawAll();clearGhosts();
}
function clearGhosts(){for(const g of NB.ghosts.values()){try{V.entities.remove(g.ent)}catch(_){}}NB.ghosts.clear();for(const gl of NB.ghostLinks.values()){try{V.entities.remove(gl.ent)}catch(_){}}NB.ghostLinks.clear();kick();}
function adopt(ip){
  const g=NB.ghosts.get(ip);if(!g)return;
  try{V.entities.remove(g.ent)}catch(_){}NB.ghosts.delete(ip);
  const d=addDevice(g.kind==='internet'?'server':'pc',g.lat,g.lon,{ips:[ip],name:(g.kind==='internet'?'Host ':'LAN ')+ip});
  const cap=captureDevice();
  if(g.kind==='lan'&&cap){const sw=NB.state.devices.find(x=>x.type==='switch'&&graphPath(cap.id,x.id));addLink((sw||cap).id,d.id,'cat6');}
  try{V.selectedEntity=undefined}catch(_){}
}

// ── input: place / move / cable / ping / delete ─────────────
function pickNb(pos){
  try{
    const arr=V.scene.drillPick(pos,6,10,10);
    for(const p of arr){const e=p&&p.id;if(e&&e._nb)return e._nb;}
  }catch(_){}
  return null;
}
function bindInput(){
  if(NB.handler)return;
  const h=NB.handler=new Cesium.ScreenSpaceEventHandler(V.scene.canvas);
  let drag=null;
  h.setInputAction(c=>{
    if(!NB.open_)return;
    if(NB.tool!=='select')return;
    const hit=pickNb(c.position);
    if(hit&&hit.kind==='dev'){drag={id:hit.id,moved:false};V.scene.screenSpaceCameraController.enableInputs=false;}
  },Cesium.ScreenSpaceEventType.LEFT_DOWN);
  h.setInputAction(m=>{
    if(!drag)return;
    const ll=screenToLL(m.endPosition);if(!ll)return;
    drag.moved=true;moveDevice(drag.id,ll.lat,ll.lon);
    NB.state.links.filter(l=>l.a===drag.id||l.b===drag.id).forEach(drawLink);kick();
  },Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  h.setInputAction(()=>{
    if(!drag)return;
    V.scene.screenSpaceCameraController.enableInputs=true;
    if(drag.moved){save();const d=dev(drag.id);if(d){drawDevice(d);}NB._suppressClick=performance.now();}
    drag=null;
  },Cesium.ScreenSpaceEventType.LEFT_UP);
  h.setInputAction(c=>{
    if(!NB.open_)return;
    if(NB._suppressClick&&performance.now()-NB._suppressClick<250)return;
    const hit=pickNb(c.position);
    const ll=screenToLL(c.position);
    switch(NB.tool){
      case 'place':
        if(ll){addDevice(NB.placeType,ll.lat,ll.lon);}
        break;
      case 'cable':
        if(!hit||hit.kind!=='dev'){toast('var(--yl)','CABLE: click a device');break;}
        if(!NB.pending){NB.pending={kind:'cable',id:hit.id};select('dev',hit.id);toast('var(--yl)',`${(CABLES[NB.cableType]||{}).label}: now click the device to connect to (ESC cancels)`);}
        else{const a=NB.pending.id;NB.pending=null;addLink(a,hit.id,NB.cableType);select(null);}
        break;
      case 'ping':
        if(!hit||hit.kind!=='dev'){toast('var(--yl)','PING: click a device');break;}
        if(!NB.pending){NB.pending={kind:'ping',id:hit.id};toast('var(--yl)','PING: now click the destination device');}
        else{const a=NB.pending.id;NB.pending=null;ping(a,hit.id);}
        break;
      case 'delete':
        if(hit&&hit.kind==='dev')removeDevice(hit.id);
        else if(hit&&hit.kind==='link')removeLink(hit.id);
        else if(hit&&hit.kind==='ghost'){const g=NB.ghosts.get(hit.ip);if(g){try{V.entities.remove(g.ent)}catch(_){}NB.ghosts.delete(hit.ip);kick();}}
        break;
      default:
        if(hit&&hit.kind==='dev')select('dev',hit.id);
        else if(hit&&hit.kind==='link')select('link',hit.id);
        else select(null);
    }
  },Cesium.ScreenSpaceEventType.LEFT_CLICK);
  // drag a device straight off the palette onto the globe
  const cv=V.scene.canvas;
  cv.addEventListener('dragover',e=>{if(NB.open_&&e.dataTransfer&&Array.from(e.dataTransfer.types||[]).includes('text/nb-device'))e.preventDefault();});
  cv.addEventListener('drop',e=>{
    if(!NB.open_)return;const t=e.dataTransfer&&e.dataTransfer.getData('text/nb-device');if(!t)return;e.preventDefault();
    const r=cv.getBoundingClientRect();const ll=screenToLL(new Cesium.Cartesian2(e.clientX-r.left,e.clientY-r.top));
    if(ll)addDevice(t,ll.lat,ll.lon);
  });
  document.addEventListener('keydown',e=>{
    if(!NB.open_)return;const tg=e.target&&e.target.tagName;if(tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT')return;
    if(e.key==='Escape'&&NB.pending){NB.pending=null;toast('var(--t3)','Cancelled');}
    if((e.key==='Delete'||e.key==='Backspace')&&NB.selected){e.preventDefault();e.stopImmediatePropagation();if(NB.selected.kind==='dev')removeDevice(NB.selected.id);else removeLink(NB.selected.id);}
  },true);
  // housekeeping: PDU expiry, port lights, ghost-link fade, log repaint
  V.scene.preRender.addEventListener(tickPdus);
  setInterval(renderLog,400);
  setInterval(()=>{
    const now=Date.now();
    for(const [k,gl] of NB.ghostLinks){if(now-gl.lastSeen>45000){try{V.entities.remove(gl.ent)}catch(_){}NB.ghostLinks.delete(k);}}
    for(const l of NB.state.links){const t=NB.linkTraffic.get(l.id);const hot=t&&now-t.last<10000;
      ['la','lb'].forEach(s=>{const e=NB.ents.get('nb:link:'+l.id+':'+s);if(e&&e.point){const want=hot?'#7CFFB2':'#2ECC71';if(e._light!==want){e._light=want;e.point.color=Cesium.Color.fromCssColorString(want);e.point.pixelSize=hot?9:7;}}});}
    if(NB.open_)try{V.scene.requestRender()}catch(_){}   // plain request: no render hold from the housekeeping tick
  },1000);
}

// ── panel UI ────────────────────────────────────────────────
function injectCss(){
  if(document.getElementById('nbCss'))return;
  const s=document.createElement('style');s.id='nbCss';
  s.textContent=`
#nbDock{position:fixed;left:calc(var(--lw,248px) + 14px);right:calc(var(--rw,360px) + 14px);bottom:64px;z-index:120;display:none;flex-direction:column;gap:6px;
  background:rgba(9,12,19,0.86);backdrop-filter:blur(18px) saturate(120%);-webkit-backdrop-filter:blur(18px) saturate(120%);border:1px solid rgba(255,255,255,0.14);border-radius:14px;
  padding:8px 12px;font-family:var(--m,'JetBrains Mono',monospace);color:#E6E9EE;box-shadow:0 12px 40px rgba(0,0,0,0.5);max-height:46vh}
body:has(.rp.shut) #nbDock{right:14px} body:has(.rp.mini) #nbDock{right:56px}
#nbDock.show{display:flex}
#nbDock .nb-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#nbDock .nb-title{font-size:10px;font-weight:700;letter-spacing:2px;color:#E8B349;margin-right:4px}
#nbDock .nb-sec{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:0 6px;border-left:1px solid rgba(255,255,255,0.10)}
#nbDock .nb-sec:first-of-type{border-left:none}
#nbDock .nb-lbl{font-size:8px;letter-spacing:1.5px;color:#8B919A;margin-right:2px}
#nbDock button,#nbProps button{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);color:#E6E9EE;font-family:inherit;font-size:9px;letter-spacing:.8px;padding:4px 8px;border-radius:5px;cursor:pointer}
#nbDock button:hover,#nbProps button:hover{border-color:#E8B349}
#nbDock button.on{background:rgba(232,179,73,0.18);border-color:#E8B349;color:#fff}
#nbDock .nb-dev{width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:7px}
#nbDock .nb-dev img{width:26px;height:26px;pointer-events:none}
#nbDock .nb-more{display:none} #nbDock.more .nb-more{display:flex}
#nbDock.min > :not(.nb-top:first-child):not(.nb-corner){display:none} #nbDock.min .nb-top:first-child > .nb-sec{display:none}
#nbDock .nb-right{margin-left:auto;display:flex;gap:4px;align-items:center}
#nbDock .nb-corner{position:absolute;top:6px;right:8px;display:flex;gap:4px}
#nbDock .nb-corner button{padding:2px 7px}
#nbDock > .nb-top:first-child{padding-right:62px}
#nbDock .nb-cab{display:inline-flex;align-items:center;gap:4px;padding:4px 6px}
#nbDock .nb-cab i{display:inline-block;width:16px;height:3px;border-radius:2px}
#nbDock .nb-danger,#nbProps .nb-danger{color:#FF6B66;border-color:rgba(255,107,102,0.4)}
#nbLiveBadge{font-size:8px;letter-spacing:1.5px;padding:2px 6px;border:1px solid;border-radius:4px}
#nbLog{display:none;overflow:auto;max-height:min(20vh,190px);border-top:1px solid rgba(255,255,255,0.08);padding-top:4px}
#nbDock.log #nbLog{display:block}
#nbLog table{width:100%;border-collapse:collapse;font-size:9.5px}
#nbLog th{position:sticky;top:0;background:rgba(9,12,19,0.95);text-align:left;color:#8B919A;font-weight:600;letter-spacing:1px;font-size:8px;padding:3px 6px}
#nbLog td{padding:2px 6px;border-top:1px solid rgba(255,255,255,0.04);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
#nbLog tr[onclick]{cursor:pointer} #nbLog tr:hover td{background:rgba(255,255,255,0.05)}
#nbLog i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;vertical-align:-1px}
#nbStats{font-size:9px;color:#AEB4BE;white-space:nowrap}
#nbFilters label{font-size:8.5px;color:#AEB4BE;display:inline-flex;align-items:center;gap:3px;margin-right:4px;cursor:pointer}
#nbFilters input{accent-color:#E8B349;margin:0}
#nbProps{position:fixed;left:calc(var(--lw,248px) + 14px);top:64px;z-index:121;width:290px;display:none;
  background:rgba(9,12,19,0.88);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,0.14);border-radius:14px;padding:12px;
  font-family:var(--m,'JetBrains Mono',monospace);color:#E6E9EE;font-size:10px;box-shadow:0 12px 40px rgba(0,0,0,0.5)}
#nbProps .nb-ph{display:flex;align-items:center;gap:8px;margin-bottom:8px}
#nbProps .nb-ph img{width:34px;height:34px}
#nbProps .nb-ph div{flex:1;display:flex;flex-direction:column;gap:2px}
#nbProps .nb-ph span{color:#8B919A;font-size:9px}
#nbProps label{display:block;font-size:8px;letter-spacing:1.3px;color:#8B919A;margin:6px 0 0}
#nbProps label em{font-style:normal;color:#5C636B;letter-spacing:0}
#nbProps input:not([type=checkbox]),#nbProps textarea,#nbProps select{width:100%;box-sizing:border-box;margin-top:3px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.14);border-radius:5px;color:#E6E9EE;font-family:inherit;font-size:10.5px;padding:5px 7px}
#nbProps .nb-ck{display:flex;gap:6px;align-items:flex-start;color:#AEB4BE;font-size:8.5px;letter-spacing:.5px}
#nbProps .nb-sub{margin-top:9px;font-size:8px;letter-spacing:1.5px;color:#8B919A}
#nbProps .nb-lr{font-size:9.5px;margin-top:3px;color:#E6E9EE}
#nbProps .nb-lr i{display:inline-block;width:12px;height:3px;border-radius:2px;margin-right:6px;vertical-align:2px}
#nbProps .nb-lr b{color:#7CFFB2;font-weight:600}
#nbProps .nb-dim{color:#8B919A;font-size:9px;margin-top:4px}
#nbProps .nb-row{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
`;
  document.head.appendChild(s);
}
function buildDock(){
  if(document.getElementById('nbDock'))return;
  injectCss();
  const d=document.createElement('div');d.id='nbDock';
  const devBtns=Object.entries(DEVICES).map(([k,v])=>`<button class="nb-dev" draggable="true" data-dev="${k}" title="${v.label} — click then click the map, or drag onto the map"><img src="${iconSvg(k,false)}"></button>`).join('');
  const cabBtns=Object.entries(CABLES).map(([k,v])=>`<button class="nb-cab" data-cab="${k}" title="${v.label}: click it, then click two devices"><i style="background:${v.dash?`repeating-linear-gradient(90deg,${v.color} 0 4px,transparent 4px 7px)`:v.color}"></i>${{cat6:'Cat6',cross:'X-over',fiber:'Fiber',serial:'Serial',coax:'Coax',wifi:'Wi-Fi',lora:'LoRa',sat:'Sat'}[k]}</button>`).join('');
  d.innerHTML=`<div class="nb-top">
    <span class="nb-title">🖧 NETWORK BUILDER</span>
    <div class="nb-sec"><span class="nb-lbl">TOOL</span>
      <button data-tool="select" title="Click to inspect, drag to move">SELECT</button>
      <button data-tool="ping" title="Packet Tracer simple PDU: click source, then destination">PING</button>
      <button data-tool="delete" class="nb-danger" title="Click a device, cable or host to remove it">DELETE</button></div>
    <div class="nb-sec"><span class="nb-lbl">DEVICES</span>${devBtns}</div>
  </div>
  <div class="nb-corner"><button id="nbMinBtn" title="Collapse / expand">–</button><button id="nbCloseBtn" title="Close (your network stays saved)">✕</button></div>
  <div class="nb-top">
    <div class="nb-sec"><span class="nb-lbl">CABLES</span>${cabBtns}</div>
    <div class="nb-sec"><span class="nb-lbl">TRAFFIC</span>
      <button id="nbLiveBtn" title="Packets captured by Wireshark on this machine (needs tools/bdoc-ipc-receiver.js + tools/adapters/wireshark_adapter.py)">● LIVE WIRESHARK</button><span id="nbLiveBadge">OFF</span>
      <button id="nbSimBtn" title="Simulated traffic across the devices you placed">SIM</button>
      <button id="nbPauseBtn">❚❚</button>
      <input id="nbSpeed" type="range" min="0.25" max="3" step="0.25" value="1" title="Animation speed" style="width:56px;accent-color:#E8B349">
      <button id="nbLogBtn">EVENTS</button></div>
    <div class="nb-sec"><button id="nbDemoBtn" title="Build a starter lab where you're looking">DEMO NETWORK</button><button id="nbMoreBtn" title="Filters, export, import, clear">MORE ▾</button></div>
    <div class="nb-right"><span id="nbStats"></span></div>
  </div>
  <div class="nb-top nb-more">
    <div class="nb-sec" id="nbFilters"><span class="nb-lbl">SHOW</span>${PROTO_FILTERS.map(p=>`<label><input type="checkbox" data-f="${p}" checked>${p}</label>`).join('')}</div>
    <div class="nb-sec"><button id="nbSkyBtn" title="Satellite -> ground station -> mesh -> laptop, matching tools/skybridge.py demo">SKYBRIDGE DEMO</button><button id="nbExpBtn">EXPORT</button><button id="nbImpBtn">IMPORT</button><button id="nbClrBtn" class="nb-danger">CLEAR ALL</button></div>
  </div>
  <div id="nbLog"><table><thead><tr><th>TIME</th><th>FROM</th><th>TO</th><th>TYPE</th><th>INFO</th></tr></thead><tbody id="nbLogRows"></tbody></table></div>`;
  document.body.appendChild(d);
  const p=document.createElement('div');p.id='nbProps';document.body.appendChild(p);
  d.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{NB.tool=b.dataset.tool;NB.pending=null;markTool();
    toast('var(--bl)',{select:'SELECT: click a device to edit it, drag to move it',ping:'PING: click source device, then destination',delete:'DELETE: click what to remove'}[NB.tool]);});
  d.querySelectorAll('[data-dev]').forEach(b=>{
    b.onclick=()=>{NB.tool='place';NB.placeType=b.dataset.dev;NB.pending=null;markTool();toast('var(--bl)',`PLACE ${DEVICES[NB.placeType].label}: click the map (repeat to place more)`);};
    b.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/nb-device',b.dataset.dev);e.dataTransfer.effectAllowed='copy';});
  });
  d.querySelectorAll('[data-cab]').forEach(b=>b.onclick=()=>{NB.tool='cable';NB.cableType=b.dataset.cab;NB.pending=null;markTool();toast('var(--bl)',`${CABLES[NB.cableType].label}: click the first device, then the second`);});
  document.getElementById('nbLiveBtn').onclick=()=>toggleLive();
  document.getElementById('nbSimBtn').onclick=()=>toggleSim();
  document.getElementById('nbPauseBtn').onclick=e=>{NB.paused=!NB.paused;e.target.classList.toggle('on',NB.paused);e.target.textContent=NB.paused?'▶':'❚❚';e.target.title=NB.paused?'Resume':'Pause';};
  document.getElementById('nbMinBtn').onclick=()=>d.classList.toggle('min');
  document.getElementById('nbMoreBtn').onclick=e=>{d.classList.toggle('more');e.target.classList.toggle('on',d.classList.contains('more'));};
  document.getElementById('nbSpeed').oninput=e=>{NB.speed=+e.target.value;if(NB.sim){toggleSim(false);toggleSim(true);}};
  document.getElementById('nbLogBtn').onclick=e=>{d.classList.toggle('log');e.target.classList.toggle('on',d.classList.contains('log'));NB._logDirty=true;renderLog();};
  d.querySelectorAll('#nbFilters input').forEach(i=>i.onchange=()=>{if(i.checked)NB.filters.add(i.dataset.f);else NB.filters.delete(i.dataset.f);});
  document.getElementById('nbDemoBtn').onclick=demoNetwork;
  document.getElementById('nbExpBtn').onclick=exportJson;
  document.getElementById('nbSkyBtn').onclick=skybridgeDemo;
  document.getElementById('nbImpBtn').onclick=importJson;
  document.getElementById('nbClrBtn').onclick=clearAll;
  document.getElementById('nbCloseBtn').onclick=()=>close();
  d.addEventListener('keydown',e=>e.stopPropagation());
  markTool();
}
function markTool(){
  const d=document.getElementById('nbDock');if(!d)return;
  d.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('on',NB.tool===b.dataset.tool));
  d.querySelectorAll('[data-dev]').forEach(b=>b.classList.toggle('on',NB.tool==='place'&&NB.placeType===b.dataset.dev));
  d.querySelectorAll('[data-cab]').forEach(b=>b.classList.toggle('on',NB.tool==='cable'&&NB.cableType===b.dataset.cab));
  try{V.scene.canvas.style.cursor=NB.tool==='place'?'copy':(NB.tool==='cable'||NB.tool==='ping')?'crosshair':NB.tool==='delete'?'not-allowed':''}catch(_){}
}

// ── public API ──────────────────────────────────────────────
function open(){
  if(!V)return;
  buildDock();bindInput();
  if(!NB._loaded){load();redrawAll();NB._loaded=true;}
  NB.open_=true;setVisible(true);document.getElementById('nbDock').classList.add('show');
  if(!NB.state.devices.length)toast('var(--bl)','NETWORK BUILDER: pick a device and click the map (or drag it on), choose a cable and click two devices. DEMO NETWORK builds a starter lab.');
}
// closing hides the network (still saved); opening brings it back
function setVisible(on){
  for(const e of NB.ents.values())e.show=on;
  for(const g of NB.ghosts.values())g.ent.show=on;
  for(const gl of NB.ghostLinks.values())gl.ent.show=on;
  if(!on){NB.pdus.forEach(p=>{try{V.entities.remove(p.ent)}catch(_){}});NB.pdus=[];try{BDOCRender.release('netbuilder')}catch(_){}}
  kick();
}
function close(){
  NB.open_=false;NB.tool='select';NB.pending=null;markTool();
  if(NB.live)toggleLive(false);if(NB.sim)toggleSim(false);
  setVisible(false);
  const d=document.getElementById('nbDock');if(d)d.classList.remove('show');
  select(null);try{V.scene.canvas.style.cursor=''}catch(_){}
}
function flyTo(id){const d=dev(id);if(d)V.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(d.lon,d.lat-0.01,2500),orientation:{heading:0,pitch:Cesium.Math.toRadians(-45),roll:0},duration:1.1});}
Object.assign(NB,{skybridgeDemo,open,close,toggle:()=>NB.open_?close():open(),select,removeDevice,removeLink,flyTo,startPing,ping,adopt,ingest,toggleLive,toggleSim,demoNetwork,
  exportJson,importJson,addDevice,addLink,graphPath,matchIp,_hopsFor:hopsFor});
})();
