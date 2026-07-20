// ============================================================
// BDOC PHASE 2 MODULE: layers-air.js
// Air-related runtime: squawk emergency detection (Turn 8a)
// Future Turn 8b additions: aircraft icons + loadAircraft + loadSatellites
// Extracted from index.html lines 9058-9098 (Turn 8a, 2026-04-22)
// Depends on (resolved lazily at call time):
//   V (Cesium.Viewer), esc, af, msg, flyToTarget
//   EventLog (js/telemetry.js)
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
// ═══ SQUAWK CODE EMERGENCY DETECTION ═══
const SQUAWK_ALERTS = {
  '7500':{name:'HIJACK',color:'#ff0000',severity:'CRITICAL',desc:'Aircraft hijacking in progress'},
  '7600':{name:'COMMS FAILURE',color:'#ff6600',severity:'WARNING',desc:'Radio communications failure \u2014 NORDO'},
  '7700':{name:'EMERGENCY',color:'#DA3633',severity:'CRITICAL',desc:'General emergency declared'},
  '7400':{name:'UAV LOST LINK',color:'#4A9EFF',severity:'WARNING',desc:'Unmanned aircraft lost data link'},
};
// PERF FIX: Use Map for O(1) squawk dedup instead of O(n) array scan
const squawkAlertHistory = new Map();
// Phase 22: expose on window so BRIEFS.squawk in inline shell can read .size
window.squawkAlertHistory = squawkAlertHistory;

function checkSquawkCodes(aircraft) {
  if (!aircraft || !aircraft.length) return;
  aircraft.forEach(ac => {
    const sq = ac.squawk || '';
    const alert = SQUAWK_ALERTS[sq];
    if (!alert) return;
    const callsign = ac.cs || 'UNKNOWN';
    const hex = ac.hex || '?';
    const alt = ac.alt!=null ? ac.alt : '?';
    const lat = ac.lat!=null ? ac.lat : '?';
    const lon = ac.lon!=null ? ac.lon : '?';
    const key = hex + sq;
    const now = Date.now();
    const lastAlert = squawkAlertHistory.get(key);
    if (lastAlert && (now - lastAlert) < 300000) return;
    squawkAlertHistory.set(key, now);
    // Prune old entries periodically
    if (squawkAlertHistory.size > 100) { for(const[k,ts] of squawkAlertHistory){if(now-ts>300000)squawkAlertHistory.delete(k)} }
    const safeCs=esc(callsign.trim()),safeHex=esc(hex);
    const alertMsg = `\u26A0 SQUAWK ${sq} \u2014 ${alert.name}: ${safeCs} (${safeHex}) at ${alt}ft`;
    af(alert.color, alertMsg);
    msg('in', `<b style="color:${alert.color}">\u26A0 SQUAWK ${sq} \u2014 ${alert.name}</b><br><br><b>Callsign:</b> ${safeCs}<br><b>Hex:</b> ${safeHex}<br><b>Altitude:</b> ${alt} ft<br><b>Position:</b> ${lat}\u00B0, ${lon}\u00B0<br><b>Severity:</b> ${alert.severity}<br><b>Meaning:</b> ${alert.desc}`);
    EventLog.add(alert.severity==='CRITICAL'?'crit':'warn', alertMsg);
    if ('Notification' in window && Notification.permission==='granted') {
      new Notification(`BDOC: SQUAWK ${sq} \u2014 ${alert.name}`, {body:`${callsign.trim()} at ${alt}ft`});
    }
    if (V && lat!=='?' && lon!=='?') {
      flyToTarget(parseFloat(lon),parseFloat(lat),200000,2.0);
    }
  });
}

// ═══════════════════════════════════════════
// SECTION 11.5a/11.5b: AIRCRAFT + SATELLITES (Turn 8b, 2026-04-22)
// Extracted from index.html lines 5414-5985
// `let airTimer` kept as top-level lexical (visible across classic <script>s)
// Depends on: V, Cesium, layers, Health, Cache, safeFetch, esc, af, msg,
//   flyToTarget, formatCoord, formatElev, makeAircraftSVG (self),
//   _airEntMap (window mirror referenced by inline onclick), checkSquawkCodes (above)
// ═══════════════════════════════════════════
let airTimer=null;
let _satRecords=[];   // {satrec, ent, isISS} for real-time SGP4 re-propagation
let _satPosTimer=null; // 30s real-time position update timer
// SECTION 11.5a: AIRCRAFT ICON GENERATION — Phase 14 type-aware (game-style silhouettes)
// Classify aircraft by description string (ICAO type code + name from adsb.lol .desc field)
function classifyAircraftType(desc){
  if(!desc)return 'jet';
  const d=desc.toUpperCase();
  // Helicopters
  if(/\bH[0-9]{2,3}\b|HELI|EC[12]|R[24]4|AS3|AS5|UH-|CH-|AH-|MH-|MD5|S-?7[06]/.test(d))return 'heli';
  // Military fighters / attack
  if(/F-?[0-9]{1,3}|MIG|SU-?[0-9]|EUFI|J-?[0-9]{2}|RAFA|HARR|TYPH|GRIPN|HORN|TOMC|EAGL|FALC|VIPER|RAPTR|LIGHT|A-?10|AV-?8/.test(d))return 'fighter';
  // Wide-body / heavy
  if(/B7[4-9]|B-?7[4-9]|A3[3-9]|A-?3[3-9]|A380|MD11|DC-?10|DC-?8|IL-?[6-9]|AN-?[12]|C-?5|C-?17|KC-?[14]/.test(d))return 'wide';
  // Turboprop / regional prop
  if(/TURBO|PROP|DASH|ATR-?|BEEC|KING|TBM|PC-?12|CESS|PIPE|SR2[02]|C172|C182|C208/.test(d))return 'prop';
  // Business jet
  if(/GULF|G-?[IV456]+|GLEX|FAL[0-9]|CL[36]0|LEAR|CITA|EMB-?5[05]|HAWK|HONDA|PHEN|EMBR/.test(d))return 'bizjet';
  // Default narrow-body jet
  return 'jet';
}
// Render type-aware aircraft icon at given rotation
function makeAircraftSVG(color,size,heading,type){
  const s=size||24;const h=heading||0;const t=type||'jet';
  let path;
  // All shapes pointing UP (north) — Cesium rotates to match heading.
  switch(t){
    case 'heli':
      // Helicopter — fat body + dual rotor disc (horizontal bar = rotor blur effect)
      path=`<ellipse cx="16" cy="2.5" rx="13" ry="1.4" fill="${color}" opacity="0.45"/>
            <ellipse cx="16" cy="29.5" rx="6" ry="1.1" fill="${color}" opacity="0.45"/>
            <path d="M16,4 C12,4 11,11 11.5,18 C12,24 14,28 16,28 C18,28 20,24 20.5,18 C21,11 20,4 16,4 Z" fill="${color}" stroke="#000" stroke-width="1"/>`;
      break;
    case 'fighter':
      // Fighter — sharp dart, swept delta wings, twin tail
      path=`<path d="M16,2 L17.5,18 L28,20 L17.5,21 L18,26 L21,30 L16,28 L11,30 L14,26 L14.5,21 L4,20 L14.5,18 Z"
              fill="${color}" stroke="#000" stroke-width="1"/>`;
      break;
    case 'wide':
      // Wide-body — long fuselage, swept wings with engines, T-tail
      path=`<path d="M16,2 L17.5,11 L30,16 L17.5,17.5 L17.5,24 L23,28 L16,26 L9,28 L14.5,24 L14.5,17.5 L2,16 L14.5,11 Z"
              fill="${color}" stroke="#000" stroke-width="1.1"/>
            <circle cx="9" cy="15.5" r="1.2" fill="#000" opacity="0.4"/>
            <circle cx="23" cy="15.5" r="1.2" fill="#000" opacity="0.4"/>`;
      break;
    case 'prop':
      // Prop / turboprop — short body, straight wings, prop disc at nose
      path=`<ellipse cx="16" cy="3" rx="4.5" ry="0.8" fill="${color}" opacity="0.35"/>
            <path d="M16,4 L17,13 L27,15 L17,16.5 L17,22 L20,26 L16,25 L12,26 L15,22 L15,16.5 L5,15 L15,13 Z"
              fill="${color}" stroke="#000" stroke-width="1"/>`;
      break;
    case 'bizjet':
      // Bizjet — sleek narrow body, swept wings, aft-mounted engines
      path=`<path d="M16,3 L17,12 L24,16 L17,17 L17.3,23 L20,28 L16,26.5 L12,28 L14.7,23 L15,17 L8,16 L15,12 Z"
              fill="${color}" stroke="#000" stroke-width="0.9"/>`;
      break;
    default: // 'jet' — narrow-body airliner (737/A320 style)
      path=`<path d="M16,2 L17.5,10 L28,14 L17.5,15.5 L17.5,23 L22,27 L16,25.5 L10,27 L14.5,23 L14.5,15.5 L4,14 L14.5,10 Z"
              fill="${color}" stroke="#000" stroke-width="1.2"/>`;
  }
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 32 32">
    <g transform="rotate(${h},16,16)">${path}</g></svg>`;
  return svgToDataUri(svg);
}
// Altitude-based color coding (like ADS-B Exchange / FR24)
function altColor(alt){
  if(alt<=0) return '#888888';       // ground
  if(alt<1000) return '#00aa00';     // very low - green
  if(alt<5000) return '#33cc33';     // low - light green
  if(alt<10000) return '#88cc00';    // mid-low - yellow-green
  if(alt<20000) return '#cccc00';    // mid - yellow
  if(alt<30000) return '#E8B339';    // mid-high - orange
  if(alt<40000) return '#ff6600';    // high - dark orange
  return '#ff2200';                   // very high - red
}
// makeConflictSVG lives in layers-conflict.js — removed duplicate here (was dead code, never called from this module)
const _acIconCache={};
let _acIconCacheSize=0;
function getACIcon(color,heading,size,desc){
  const type=classifyAircraftType(desc);
  const key=color+'_'+Math.round(heading/5)*5+'_'+(size||24)+'_'+type;
  if(!_acIconCache[key]){
    // Evict oldest entries if cache exceeds 1500 (6 types × 72 headings × ~6 colors × 2 sizes = ~5184 worst-case)
    if(_acIconCacheSize>1500){const keys=Object.keys(_acIconCache);for(let i=0;i<300;i++){delete _acIconCache[keys[i]];_acIconCacheSize--}}
    _acIconCache[key]=makeAircraftSVG(color,size||24,Math.round(heading/5)*5,type);
    _acIconCacheSize++;
  }
  return _acIconCache[key];
}
// Convert OpenSky state vector array to normalized aircraft object
function parseOpenSkyState(s,regName){
  // OpenSky state vector indices:
  // 0=icao24, 1=callsign, 2=origin_country, 3=time_position, 4=last_contact,
  // 5=longitude, 6=latitude, 7=baro_altitude(m), 8=on_ground, 9=velocity(m/s),
  // 10=true_track, 11=vertical_rate, 12=sensors, 13=geo_altitude, 14=squawk,
  // 15=spi, 16=position_source
  if(!s[6]||!s[5]||!isFinite(s[6])||!isFinite(s[5]))return null;
  const hex=(s[0]||'').trim();
  const cs=(s[1]||'').trim();
  const alt=s[8]?0:Math.round((s[7]||0)*3.28084); // meters to feet
  const hdg=s[10]||0;
  const spd=s[9]?Math.round(s[9]*1.94384):0; // m/s to knots
  const squawk=(s[14]||'').toString();
  const isMil=isMilCallsign(cs);
  const isVIP=cs&&CFG.vipPrefixes.some(p=>cs.toUpperCase().startsWith(p));
  return{hex,lat:s[6],lon:s[5],alt,hdg,spd,cs,desc:s[2]||'Unknown',isMil,isVIP,reg:regName,squawk,src:'opensky'};
}
// ═══ FR24 ENRICHMENT — origin/destination/airline/aircraft-type ═══
// One call per loadAircraft() cycle (camera view bounds) — credit-safe.
// Populates _fr24EnrichMap (hex→data); aircraft from adsb.lol are enriched
// before their entity cards are built. Fails gracefully: missing = no route shown.
const _fr24EnrichMap = new Map();
// ── FR24 CREDIT BUDGET GUARD ────────────────────────────────────────────────
// Explorer plan = 60,000 credits/month. The "full" live-positions endpoint costs
// several credits PER CALL. Aircraft layer refreshes every 60s, so without this
// throttle we'd fire ~43k calls/month and blow the budget in days.
// 10-min throttle → ~4,300 calls/month worst case (24/7). Routes don't change
// mid-flight, so 10-min-stale route data is fine. RAISE this number to spend
// fewer credits; LOWER it (carefully) for fresher route data.
let _fr24LastFetch = 0;
const _FR24_MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

async function fetchFlightRadar24Enrichment() {
  if (!V || !V.scene) return;
  // Budget throttle — skip if we fetched recently (keeps last results in _fr24EnrichMap)
  if (Date.now() - _fr24LastFetch < _FR24_MIN_INTERVAL_MS) return;
  let lamin, lamax, lomin, lomax;
  try {
    // Only bother when zoomed to flight-tracking scale (< 7,000 km altitude)
    const height = V.camera.positionCartographic?.height || 5e6;
    if (height > 7e6) return;
    const rect = V.camera.computeViewRectangle(V.scene.globe.ellipsoid);
    if (!rect) return;
    lamin = Math.max(-90,  Cesium.Math.toDegrees(rect.south)).toFixed(3);
    lamax = Math.min(90,   Cesium.Math.toDegrees(rect.north)).toFixed(3);
    lomin = Math.max(-180, Cesium.Math.toDegrees(rect.west)).toFixed(3);
    lomax = Math.min(180,  Cesium.Math.toDegrees(rect.east)).toFixed(3);
  } catch (e) { return; }
  try {
    const res = await safeFetch('fr24', 'fr24_enrich',
      `/.netlify/functions/proxy-flightradar24?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`,
      { feedType: 'aircraft', staleOk: true, timeout: 8000 });
    const rows = res?.data?.data;
    if (!Array.isArray(rows)) return;
    _fr24LastFetch = Date.now(); // mark success — throttle the next call
    _fr24EnrichMap.clear();
    for (const a of rows) {
      const hex = (a.hex || '').toLowerCase().trim();
      if (!hex) continue;
      _fr24EnrichMap.set(hex, {
        orig:    (a.orig_iata || a.orig_icao || '').toUpperCase(),
        dest:    (a.dest_iata || a.dest_icao || '').toUpperCase(),
        airline: a.operating_as || a.painted_as || '',
        flight:  a.flight || '',
        acType:  a.type || ''
      });
    }
    console.log(`[FR24] enriched ${_fr24EnrichMap.size} aircraft with origin/dest data`);
  } catch (e) {
    console.warn('[Aircraft] FR24 enrichment failed (non-fatal):', e.message);
  }
}

// Convert adsb.lol aircraft object to normalized format
function parseAdsbLolAC(a,regName){
  if(!a.lat||!a.lon||!isFinite(a.lat)||!isFinite(a.lon))return null;
  const isMil=(a.dbFlags&1)||isMilCallsign(a.flight);
  const isVIP=a.flight&&CFG.vipPrefixes.some(p=>a.flight.trim().toUpperCase().startsWith(p));
  const cs=(a.flight||'').trim();
  const alt=a.alt_baro==='ground'?0:(a.alt_baro||0);
  const hdg=a.track||0;const spd=a.gs||0;
  const desc=a.desc||a.t||'Unknown';
  const squawk=a.squawk||'';
  return{hex:a.hex,lat:a.lat,lon:a.lon,alt,hdg,spd,cs,desc,isMil,isVIP,reg:regName,squawk,dbFlags:a.dbFlags,src:'adsb_lol'};
}
// Fetch aircraft from OpenSky Network (primary source)
async function fetchOpenSky(reg){
  // Convert center+radius to bounding box (approximate: 1 deg lat ≈ 111km, 1 deg lon ≈ 111km*cos(lat))
  const latR=reg.r/111;
  const lonR=reg.r/(111*Math.cos(reg.lat*Math.PI/180));
  const lamin=(reg.lat-latR).toFixed(2);
  const lamax=(reg.lat+latR).toFixed(2);
  const lomin=(reg.lon-lonR).toFixed(2);
  const lomax=(reg.lon+lonR).toFixed(2);
  // Try proxy first, fall back to direct API
  let res;
  try{
    res=await safeFetch('opensky',`osky_${reg.name}`,`/.netlify/functions/proxy-opensky?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`,{feedType:'aircraft',staleOk:true,timeout:15000});
    if(!res.data||!res.data.states)throw new Error('proxy empty');
  }catch(e){
    console.warn(`[Aircraft] OpenSky proxy failed for ${reg.name}, trying direct:`,e.message);
    try{
      const directUrl=`https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
      const r=await fetch(directUrl,{signal:AbortSignal.timeout(15000)});
      if(!r.ok)throw new Error('direct '+r.status);
      const data=await r.json();
      res={data,fromCache:false};
      Health.ok('opensky',data.states?.length||0);
    }catch(e2){
      console.warn(`[Aircraft] OpenSky direct also failed for ${reg.name}:`,e2.message);
      return[];
    }
  }
  if(!res.data||!res.data.states)return[];
  return res.data.states.map(s=>parseOpenSkyState(s,reg.name)).filter(Boolean);
}
// Fetch aircraft from adsb.lol (fallback source)
async function fetchAdsbLol(reg){
  // Try proxy first, fall back to direct API
  let res;
  try{
    res=await safeFetch('adsb_lol',`air_${reg.name}`,`/.netlify/functions/proxy-adsb?lat=${reg.lat}&lon=${reg.lon}&dist=${reg.r}`,{feedType:'aircraft',staleOk:true});
    if(!res.data||!res.data.ac)throw new Error('proxy empty');
  }catch(e){
    console.warn(`[Aircraft] adsb.lol proxy failed for ${reg.name}, trying direct:`,e.message);
    try{
      const directUrl=`https://api.adsb.lol/v2/lat/${reg.lat}/lon/${reg.lon}/dist/${reg.r}`;
      const r=await fetch(directUrl,{signal:AbortSignal.timeout(15000)});
      if(!r.ok)throw new Error('direct '+r.status);
      const data=await r.json();
      res={data,fromCache:false};
      Health.ok('adsb_lol',data.ac?.length||0);
    }catch(e2){
      console.warn(`[Aircraft] adsb.lol direct also failed for ${reg.name}:`,e2.message);
      return[];
    }
  }
  if(!res.data||!res.data.ac)return[];
  return res.data.ac.map(a=>parseAdsbLolAC(a,reg.name)).filter(Boolean);
}
// ═══ AIRCRAFT INTEL CARD BUILDER ═══
function buildAircraftCard(a){
  const isMil=a.isMil||a.isVIP;
  const typeColor=isMil?(a.isVIP?'#9b6abf':'#c4504a'):'#4A9EFF';
  const typeLabel=a.isVIP?'VIP / GOVERNMENT':isMil?'MILITARY':'CIVILIAN';
  const altStr=a.alt===0?'GROUND':a.alt.toLocaleString()+' ft';
  const flStr=a.alt>0?'FL'+Math.round(a.alt/100):'GND';
  const hdgCardinal=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const cardinal=hdgCardinal[Math.round(a.hdg/22.5)%16]||'';
  const mach=a.spd>0?(a.spd*0.00149).toFixed(2):'0.00';
  const onGround=a.alt===0;
  const squawkInfo=a.squawk?`<b>Squawk:</b> <span style="color:${['7500','7600','7700','7400'].includes(a.squawk)?'#c4504a':'#c8ccd6'}">${a.squawk}</span>${['7500','7600','7700','7400'].includes(a.squawk)?` <span style="color:#c4504a;font-weight:bold">EMERGENCY</span>`:''}`:'<b>Squawk:</b> N/A';
  return `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:420px;background:#0a0e14;padding:14px;border-radius:2px;border:1px solid ${typeColor}22;color:#c8ccd6">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #1e2436">
      <div>
        <div style="color:${typeColor};font-size:14px;font-weight:700;letter-spacing:1px">${esc(a.cs||a.hex)}</div>
        <div style="color:#4a5068;font-size:9px;margin-top:2px;letter-spacing:1.5px">${typeLabel}</div>
      </div>
      <div style="text-align:right">
        <div style="color:#c8ccd6;font-size:20px;font-weight:700">${flStr}</div>
        <div style="color:#4a5068;font-size:8px">${altStr}</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:10px;color:#7a8194">
      <tr><td style="padding:3px 0;width:40%"><b style="color:#4a5068">ICAO HEX</b></td><td style="color:#c8ccd6">${esc(a.hex)}</td></tr>
      <tr><td style="padding:3px 0"><b style="color:#4a5068">AIRCRAFT</b></td><td style="color:#c8ccd6">${esc(a.desc||'Unknown')}</td></tr>
      ${(a.flight)?`<tr><td style="padding:3px 0"><b style="color:#4a5068">FLIGHT #</b></td><td style="color:#c8ccd6">${esc(a.flight)}</td></tr>`:''}
      ${(a.orig||a.dest)?`<tr><td style="padding:3px 0"><b style="color:#4a5068">ROUTE</b></td><td style="color:#4A9EFF;font-weight:600">${esc(a.orig||'???')} \u2192 ${esc(a.dest||'???')}</td></tr>`:''}
      ${(a.airline)?`<tr><td style="padding:3px 0"><b style="color:#4a5068">AIRLINE</b></td><td style="color:#c8ccd6">${esc(a.airline)}</td></tr>`:''}
      <tr><td style="padding:3px 0"><b style="color:#4a5068">HEADING</b></td><td style="color:#c8ccd6">${a.hdg.toFixed(0)}\u00B0 ${cardinal}</td></tr>
      <tr><td style="padding:3px 0"><b style="color:#4a5068">SPEED</b></td><td style="color:#c8ccd6">${a.spd.toFixed(0)} kts ${a.spd>200?'(M'+mach+')':''}</td></tr>
      <tr><td style="padding:3px 0"><b style="color:#4a5068">POSITION</b></td><td style="color:#c8ccd6">${a.lat.toFixed(4)}\u00B0, ${a.lon.toFixed(4)}\u00B0</td></tr>
      <tr><td style="padding:3px 0" colspan="2">${squawkInfo}</td></tr>
      <tr><td style="padding:3px 0"><b style="color:#4a5068">STATUS</b></td><td style="color:${onGround?'#c4933f':'#4a8a5a'}">${onGround?'ON GROUND':'AIRBORNE'}</td></tr>
      <tr><td style="padding:3px 0"><b style="color:#4a5068">REGION</b></td><td style="color:#c8ccd6">${a.reg||'Unknown'}</td></tr>
    </table>
    ${isMil?`<div style="margin-top:8px;padding:6px 8px;background:rgba(196,80,74,0.06);border:1px solid rgba(196,80,74,0.12);border-radius:2px;font-size:9px">
      <span style="color:#c4504a;font-weight:600">CLASSIFICATION FLAGS:</span>
      <span style="color:#7a8194;margin-left:6px">${a.isVIP?'VIP/GOV':'MIL'}${a.dbFlags&1?' \u00B7 DB-CONFIRMED':''}${isMilCallsign(a.cs)?' \u00B7 CALLSIGN-MATCH':''}</span>
    </div>`:''}
    <div style="display:flex;gap:6px;margin-top:10px">
      <button onclick="if(parent.trackAircraft)parent.trackAircraft('${a.hex}','${(a.cs||a.hex).replace(/'/g,'')}')" style="flex:1;padding:5px;background:#0a0e14;color:#4A9EFF;border:1px solid rgba(74,158,255,0.2);border-radius:2px;cursor:pointer;font-family:monospace;font-size:9px;letter-spacing:.5px">\u25CE TRACK</button>
      <button onclick="if(parent.V)parent.V.camera.flyTo({destination:parent.Cesium.Cartesian3.fromDegrees(${a.lon},${a.lat},200000),duration:1})" style="flex:1;padding:5px;background:#0a0e14;color:#7a8194;border:1px solid #1e2436;border-radius:2px;cursor:pointer;font-family:monospace;font-size:9px;letter-spacing:.5px">AREA VIEW</button>
    </div>
    <div style="margin-top:8px;font-size:7px;color:#1e2436;letter-spacing:1px;text-align:right">KITSUNE BDOC \u2014 ${a.src==='opensky'?'OPENSKY':'ADS-B'} FEED</div>
  </div>`;
}
// Entity maps for update-in-place (PERF: avoids destroy/recreate every 60s)
const _airEntMap=new Map(); // hex -> Cesium entity (civilian)
const _milEntMap=new Map(); // hex -> Cesium entity (military/VIP)
// Flight trail history: hex -> [{lon,lat,alt},...] (max 5 positions)
const _acTrailHistory=new Map();
const _trailEntMap=new Map(); // hex -> Cesium polyline entity
let _trackedHex=null; // currently tracked aircraft hex for click-to-follow
function trackAircraft(hex,callsign){
  if(!V)return;
  const ent=_milEntMap.get(hex)||_airEntMap.get(hex);
  if(!ent)return;
  _trackedHex=hex;
  V.trackedEntity=ent;
  // Show tracking indicator
  let ti=document.getElementById('trackIndicator');
  if(!ti){
    ti=document.createElement('div');ti.id='trackIndicator';
    ti.style.cssText='position:fixed;top:48px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(10,14,22,0.92);border:1px solid rgba(74,158,255,0.3);padding:4px 14px;border-radius:2px;font-family:var(--m);font-size:10px;color:#4A9EFF;letter-spacing:1px;display:flex;align-items:center;gap:8px';
    document.body.appendChild(ti);
  }
  ti.innerHTML='\u25CE TRACKING: <span style="color:#c8ccd6;font-weight:600">'+esc(callsign)+'</span> <button onclick="untrackAircraft()" style="background:none;border:1px solid rgba(196,80,74,0.3);color:#c4504a;padding:2px 8px;border-radius:2px;cursor:pointer;font-family:var(--m);font-size:8px;letter-spacing:.5px;margin-left:4px">UNTRACK</button>';
  af('var(--kf)','Camera locked on '+callsign+' \u2014 click UNTRACK or select another entity to release');
}
function untrackAircraft(){
  if(V)V.trackedEntity=undefined;
  _trackedHex=null;
  const ti=document.getElementById('trackIndicator');if(ti)ti.remove();
  af('var(--t2)','Camera tracking released');
}
async function loadAircraft(){
  if(!V)return;
  milAC.length=0;allAC.length=0;
  let totalAir=0,totalMil=0;
  let primarySource='adsb_lol';
  let regionStats={ok:0,empty:0,fail:0};
  // Phase 14 fix (2026-05-12): adsb.lol PRIMARY — no auth, no rate limit, way more reliable.
  // OpenSky as fallback only — anonymous quota is 400 req/day total which dies in < 5 min with 6 regions polling.
  // Fire FR24 enrichment fetch IN PARALLEL with all region fetches — one call,
  // populates _fr24EnrichMap (hex→{orig,dest,airline,flight,acType}) before entities build.
  const [regionResults]=await Promise.all([
   Promise.allSettled(CFG.regions.map(async reg=>{
    let acList=[];
    try{acList=await fetchAdsbLol(reg)}catch(e){console.warn(`[BDOC AIR] adsb.lol failed for ${reg.name}:`,e.message)}
    if(acList.length===0){
      try{
        acList=await fetchOpenSky(reg);
        if(acList.length>0)primarySource='opensky';
      }catch(e){console.warn(`[BDOC AIR] OpenSky fallback failed for ${reg.name}:`,e.message)}
    }
    if(acList.length>0)regionStats.ok++;else regionStats.empty++;
    return acList;
  })),
  fetchFlightRadar24Enrichment().catch(e=>console.warn('[Aircraft] FR24 parallel fetch error:',e.message))
  ]);
  // Visible diagnostic when ALL regions return empty (operator can see this without opening console)
  if(regionStats.ok===0){
    af('var(--rd)','AIRCRAFT FEED: all 6 regions returned 0 — check Netlify proxy logs (proxy-adsb / proxy-opensky)');
    console.error('[BDOC AIR] Both adsb.lol and OpenSky returned 0 across all 6 COCOM regions. Check Netlify Functions logs.');
  }
  // PERF FIX: Use Set for O(1) dedup instead of O(n) array.find()
  const seenHex=new Set();
  const freshHex=new Set(); // track which aircraft are in the new data
  // PERF: coalesce hundreds of add/remove/position updates into one change notification.
  if(V&&V.entities&&V.entities.suspendEvents)V.entities.suspendEvents();
  regionResults.forEach(r=>{
    if(r.status!=='fulfilled')return;
    r.value.forEach(a=>{
      if(seenHex.has(a.hex))return;
      seenHex.add(a.hex);
      freshHex.add(a.hex);
      // Apply FR24 enrichment (origin/dest/airline) when available for this hex
      {const _e=_fr24EnrichMap.get((a.hex||'').toLowerCase());if(_e){if(_e.orig)a.orig=_e.orig;if(_e.dest)a.dest=_e.dest;if(_e.airline)a.airline=_e.airline;if(_e.flight&&!a.flight)a.flight=_e.flight;if(_e.acType&&(!a.desc||a.desc==='Unknown'))a.desc=_e.acType;}}
      // Flight trail: record current position before updating entity
      if(!_acTrailHistory.has(a.hex))_acTrailHistory.set(a.hex,[]);
      const trail=_acTrailHistory.get(a.hex);
      trail.push({lon:a.lon,lat:a.lat,alt:a.alt*0.3048});
      if(trail.length>20)trail.shift(); // cap at 20 positions (~20 min trail at 60s refresh)
      allAC.push(a);
      if(a.isMil||a.isVIP){
        milAC.push(a);
        const milColor=a.isVIP?'#4A9EFF':'#DA3633';
        // Phase 9A (2026-05-05): MIL-STD-2525C symbology for military aircraft when milsymbol lib loaded
        // SIDC: SFAPMF-----*** = Friendly Air Mobility Fighter | SFAPMR----- = Recon | SFAPMU----- = Utility
        // VIP gets SFAPMTL-- (transport leadership) — magenta SAM/Air Force One styling
        const milSidc=a.isVIP?'SFAPMTL------*':'SFAPMF--------*';
        const _ms=(typeof ms!=='undefined')?(()=>{try{return 'data:image/svg+xml;base64,'+btoa(new ms.Symbol(milSidc,{size:36,colorMode:{Friend:milColor},strokeWidth:2.4,fillOpacity:0.85}).asSVG())}catch(_){return null}})():null;
        const existing=_milEntMap.get(a.hex);
        if(existing){
          existing.position=Cesium.Cartesian3.fromDegrees(a.lon,a.lat,a.alt*0.3048);
          existing.billboard.image=getACIcon(milColor,a.hdg,32,a.desc);
          existing.billboard.heightReference=a.alt===0?Cesium.HeightReference.CLAMP_TO_GROUND:Cesium.HeightReference.NONE;
          existing.label.text=(a.cs||a.hex).substring(0,8);
          existing.description=buildAircraftCard(a);
          // Phase 14 fix: mil aircraft now show whenever AIR layer OR FORCE TRACK is on (was forcetrack-only)
          existing.show=layers.air||layers.forcetrack;
          existing._ac=a;
        }else{
          const ent=V.entities.add({position:Cesium.Cartesian3.fromDegrees(a.lon,a.lat,a.alt*0.3048),billboard:{image:getACIcon(milColor,a.hdg,32,a.desc),width:38,height:38,scaleByDistance:new Cesium.NearFarScalar(5e4,1.3,1e7,0.5),verticalOrigin:Cesium.VerticalOrigin.CENTER,heightReference:a.alt===0?Cesium.HeightReference.CLAMP_TO_GROUND:Cesium.HeightReference.NONE,disableDepthTestDistance:5e6},label:{text:(a.cs||a.hex).substring(0,8),font:'bold 10px JetBrains Mono',fillColor:Cesium.Color.fromCssColorString(milColor),outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.TOP,pixelOffset:new Cesium.Cartesian2(0,22),scaleByDistance:new Cesium.NearFarScalar(1e5,1,6e6,0.35),showBackground:true,backgroundColor:Cesium.Color.BLACK.withAlpha(0.6),backgroundPadding:new Cesium.Cartesian2(4,2),disableDepthTestDistance:5e6},description:buildAircraftCard(a),show:layers.air||layers.forcetrack});
          ent._ac=a;
          _milEntMap.set(a.hex,ent);
        }
        totalMil++;
      }else{
        const civColor=altColor(a.alt);
        const existing=_airEntMap.get(a.hex);
        if(existing){
          existing.position=Cesium.Cartesian3.fromDegrees(a.lon,a.lat,a.alt*0.3048);
          existing.billboard.image=getACIcon(civColor,a.hdg,28,a.desc);
          existing.billboard.heightReference=a.alt===0?Cesium.HeightReference.CLAMP_TO_GROUND:Cesium.HeightReference.NONE;
          existing.description=buildAircraftCard(a);
          // Phase 14: civilian planes show whenever AIR is on (was: AIR && !forcetrack)
          existing.show=layers.air;
          existing._ac=a; // attach data for FR24 side panel
        }else{
          const ent=V.entities.add({position:Cesium.Cartesian3.fromDegrees(a.lon,a.lat,a.alt*0.3048),billboard:{image:getACIcon(civColor,a.hdg,28,a.desc),width:26,height:26,scaleByDistance:new Cesium.NearFarScalar(5e4,1.1,1e7,0.35),verticalOrigin:Cesium.VerticalOrigin.CENTER,heightReference:a.alt===0?Cesium.HeightReference.CLAMP_TO_GROUND:Cesium.HeightReference.NONE,disableDepthTestDistance:5e6},description:buildAircraftCard(a),show:layers.air});
          ent._ac=a;
          _airEntMap.set(a.hex,ent);
        }
      }
      totalAir++;
    });
  });
  // PERF FIX: Remove only stale entities (aircraft no longer in feed) instead of removing ALL
  for(const[hex,ent]of _milEntMap){if(!freshHex.has(hex)){V.entities.remove(ent);_milEntMap.delete(hex)}}
  for(const[hex,ent]of _airEntMap){if(!freshHex.has(hex)){V.entities.remove(ent);_airEntMap.delete(hex)}}
  // Auto-untrack if tracked aircraft disappeared from feed
  if(_trackedHex&&!freshHex.has(_trackedHex)){
    V.trackedEntity=undefined;
    const ti=document.getElementById('trackIndicator');if(ti)ti.remove();
    _trackedHex=null;
  }
  // Flight trails: render/update polylines, prune stale
  // Phase 14: altitude-segmented FR24-style trail. Each segment colored by mean altitude of its two endpoints.
  // _trailEntMap value is now { segments: [entity,entity,...] } so we can rebuild per refresh.
  for(const[hex,trail]of _acTrailHistory){
    if(!freshHex.has(hex)){
      const te=_trailEntMap.get(hex);
      if(te&&te.segments)te.segments.forEach(seg=>V.entities.remove(seg));
      _trailEntMap.delete(hex);
      _acTrailHistory.delete(hex);
      continue;
    }
    if(trail.length<2)continue;
    const isMil=_milEntMap.has(hex);
    // Remove old segments then rebuild — simpler than diffing
    const old=_trailEntMap.get(hex);
    if(old&&old.segments)old.segments.forEach(seg=>V.entities.remove(seg));
    // PDF p5 fix: only the SELECTED/tracked aircraft draws a trail. Drawing a trail for
    // every plane produced a globe-wide spaghetti of glowing polylines that bloomed into
    // the "giant spheres/blobs" (p4). Gate on the tracked hex; everyone else gets no trail.
    const isTracked=(_trackedHex===hex);
    const segments=[];
    const layerOn=isMil?(layers.air||layers.forcetrack):layers.air;
    const showTrail=layerOn&&isTracked;
    if(!showTrail){_trailEntMap.set(hex,{segments});continue;}
    for(let i=1;i<trail.length;i++){
      const p0=trail[i-1],p1=trail[i];
      const meanAltFt=((p0.alt+p1.alt)/2)/0.3048;
      // altColor() returns FR24-style altitude color (defined earlier in this file)
      const c=Cesium.Color.fromCssColorString(altColor(meanAltFt)).withAlpha(0.85);
      segments.push(V.entities.add({
        polyline:{
          positions:Cesium.Cartesian3.fromDegreesArrayHeights([p0.lon,p0.lat,p0.alt,p1.lon,p1.lat,p1.alt]),
          width:isMil?4:2.5,
          material:new Cesium.PolylineGlowMaterialProperty({glowPower:0.28,color:c}),
          distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,8000000)
        },
        show:showTrail
      }));
    }
    _trailEntMap.set(hex,{segments});
  }
  // Resume Cesium change events — one render pass instead of N.
  if(V&&V.entities&&V.entities.resumeEvents)V.entities.resumeEvents();
  // Update legacy arrays for compatibility with other code (replay, export, etc.)
  airEnts=Array.from(_airEntMap.values());
  milEnts=Array.from(_milEntMap.values());
  document.getElementById('airV').textContent=totalAir.toLocaleString();
  document.getElementById('milV').textContent=totalMil;
  updateForcePanel();
  Anomaly.checkMilAnomaly(totalMil);
  History.recordAircraft(allAC);
  checkSquawkCodes(allAC);
  if(srcN===0||!airTimer)us(1);
  const srcLabel=primarySource==='opensky'?'OpenSky':'ADS-B';
  af('var(--bl)',`${srcLabel}: ${totalAir.toLocaleString()} aircraft \u2014 ${totalMil} military tracked`);
  if(totalMil>0)af('var(--rd)',`FORCE TRACKER: ${totalMil} military/VIP transponders active`);
}
function updateForcePanel(){
  const el=document.getElementById('ftList');
  if(!el)return;
  if(milAC.length===0){el.innerHTML='<div style="font-family:var(--m);font-size:8px;color:var(--t3)">No military transponders detected</div>';return}
  el.innerHTML=milAC.sort((a,b)=>b.alt-a.alt).map(a=>`<div class="ft-row" onclick="flyToAC(${a.lon},${a.lat})"><span class="ft-hex">${esc(a.hex)}</span><span class="ft-call">${esc(a.cs)||'\u2014'}</span><span class="ft-type">${esc(a.desc.substring(0,6))}</span><span style="color:${a.isVIP?'#4A9EFF':'var(--t3)'};font-size:7px;margin-left:4px">${esc(a.reg)}</span><span class="ft-alt">${a.alt===0?'GND':'FL'+Math.round(a.alt/100)}</span></div>`).join('');
}
function flyToAC(lon,lat){flyToTarget(lon,lat,80000,1.2)}
async function loadCables(){
  let res;
  try{
    res=await safeFetch('telegeography','cables','/cable-geo.json',{feedType:'cables',staleOk:true});
    if(!res.data||!res.data.features)throw new Error('local empty');
  }catch(e){
    console.warn('[Cables] Local file failed, trying proxy:',e.message);
    try{
      const r=await fetch('/.netlify/functions/proxy-cables?type=cables',{signal:AbortSignal.timeout(15000)});
      if(!r.ok)throw new Error('proxy '+r.status);
      const data=await r.json();
      if(!data.features)throw new Error('proxy empty');
      res={data,fromCache:false};
      Health.ok('telegeography',data.features?.length||0);
    }catch(e2){
      console.warn('[Cables] Proxy also failed, trying direct:',e2.message);
      try{
        const r=await fetch('https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',{signal:AbortSignal.timeout(20000)});
        if(!r.ok)throw new Error('direct '+r.status);
        const data=await r.json();
        res={data,fromCache:false};
        Health.ok('telegeography',data.features?.length||0);
      }catch(e3){
        console.error('[Cables] All sources failed:',e3.message);
        res={data:null,fromCache:false};
      }
    }
  }
  if(!res.data||!V)return;
  cableEnts.forEach(e=>V.entities.remove(e));cableEnts=[];
  // Color palette for cables — like submarinecablemap.com, different color per cable
  const cableColors=['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#00bcd4','#ff6b6b','#4ecdc4','#45b7d1','#96ceb4','#ffa07a','#87ceeb','#dda0dd','#98d8c8','#f7dc6f','#bb8fce','#85c1e9','#f1948a','#82e0aa','#f0b27a','#d7bde2','#a9cce3','#f9e79f','#abebc6'];
  let cnt=0,colorIdx=0;
  res.data.features.forEach(f=>{
    if(!f.geometry)return;
    const cableName=f.properties?.name||f.properties?.cable_name||'Unknown Cable';
    const color=cableColors[colorIdx%cableColors.length];
    colorIdx++;
    if(f.geometry.type==='MultiLineString'){
      f.geometry.coordinates.forEach(line=>{
        const pos=[];line.forEach(c=>{if(c&&typeof c[0]==='number'&&typeof c[1]==='number'&&isFinite(c[0])&&isFinite(c[1]))pos.push(c[0],c[1])});
        if(pos.length<4)return;
        cableEnts.push(V.entities.add({
          polyline:{
            positions:Cesium.Cartesian3.fromDegreesArray(pos),
            width:3,
            material:new Cesium.PolylineGlowMaterialProperty({glowPower:0.15,color:Cesium.Color.fromCssColorString(color).withAlpha(0.75)}),
            clampToGround:true
          },
          name:esc(cableName),
          description:`<div style="font-family:monospace;font-size:13px;background:#0d1117;color:#c8ccd6;padding:12px;max-width:350px"><b style="color:${color}">\u2B24 ${esc(cableName)}</b><br><br><b>Type:</b> Submarine Fiber Optic Cable<br><b>Source:</b> TeleGeography<br><br><span style="color:#8b949e">97% of intercontinental data flows through submarine cables. Cable damage can isolate entire nations.</span></div>`,
          show:layers.cable
        }));
        cnt++;
      });
    }
  });
  if(!res.fromCache){us(1);af('var(--pr)',`TeleGeography: ${cnt} submarine cable segments loaded (${colorIdx} cables)`)}
}
// [Phase 2 Turn 10] AI copilot (BRIEFS + sendQ) moved to js/kitsune-ai.js
// ═══════════════════════════════════════════
// SECTION 11.5: SATELLITE TRACKING (CelesTrak)
// Phase 31: 5 groups (stations/visual/gps-ops/glonass-ops/military),
// real-time 30s SGP4 position updates, ISS orbit trail.
// =====================================================
const _SAT_GROUPS=[
  {g:'stations',   col:'#00eeff', label:'Space Station'},
  {g:'visual',     col:'#ffffff', label:'Visually Bright'},
  {g:'gps-ops',    col:'#39d353', label:'GPS'},
  {g:'glo-ops',    col:'#ffa500', label:'GLONASS'},   // p81: was 'glonass-ops' — invalid group, CelesTrak returns "Invalid query"
  {g:'military',   col:'#DA3633', label:'US Military'},
];
// p81: parse 3-line TLE text into the record shape the render loop expects.
// CelesTrak GP FORMAT=json has NO TLE_LINE1/2 fields, and the bundled satellite.js
// only exposes twoline2satrec (no json2satrec) — so the JSON path could never
// produce a single satellite. Layer was silently dead ("feed empty").
function _parseTLE(txt){
  const lines=String(txt||'').split(/\r?\n/).map(l=>l.trimEnd()).filter(l=>l.length);
  const out=[];
  for(let i=0;i+2<lines.length;){
    if(lines[i+1][0]==='1'&&lines[i+2][0]==='2'){
      const l1=lines[i+1],l2=lines[i+2];
      out.push({
        OBJECT_NAME:lines[i].trim(),
        NORAD_CAT_ID:parseInt(l1.substring(2,7),10),
        TLE_LINE1:l1,TLE_LINE2:l2,
        INCLINATION:parseFloat(l2.substring(8,16))||0,
        MEAN_MOTION:parseFloat(l2.substring(52,63))||0
      });
      i+=3;
    }else i++;
  }
  return out;
}
async function loadSatellites(){
  if(!V)return;
  if(_satPosTimer){clearInterval(_satPosTimer);_satPosTimer=null;}
  try{
    // p81: browser-direct PRIMARY (CelesTrak sends CORS * and serves residential IPs in <1s,
    // but throttles AWS/datacenter — the Netlify proxy consistently 502s from Lambda).
    // NOTE: safeFetch never rejects (resolves {data:null} on failure), so fallback must be
    // gated on data presence — the old .catch() chain was unreachable and the layer died
    // whenever the proxy 502'd.
    const results=await Promise.all(_SAT_GROUPS.map(async({g})=>{
      let r=await safeFetch('celestrak','sats_'+g,`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`,{feedType:'satellites',staleOk:true,text:true}).catch(()=>null);
      if(!r||typeof r.data!=='string'||!r.data.includes('\n1 ')){
        r=await safeFetch('celestrak','sats_'+g,`/.netlify/functions/proxy-celestrak?group=${g}&format=tle`,{feedType:'satellites',staleOk:true,text:true}).catch(()=>null);
      }
      return r;
    }));
    const seen=new Set();const allSats=[];
    results.forEach((res,i)=>{
      const arr=(res&&typeof res.data==='string')?_parseTLE(res.data):[];
      arr.forEach(s=>{
        if(!s.TLE_LINE1||!s.TLE_LINE2)return;
        if(seen.has(s.NORAD_CAT_ID))return;
        seen.add(s.NORAD_CAT_ID);
        allSats.push({...s,_gi:i});
      });
    });
    if(!allSats.length){af('var(--yl)','Satellites: CelesTrak feed empty');return;}
    satEnts.forEach(e=>V.entities.remove(e));satEnts=[];
    _satRecords=[];
    const now=new Date();let count=0;
    allSats.forEach(sat=>{
      try{
        const satrec=satellite.twoline2satrec(sat.TLE_LINE1,sat.TLE_LINE2);
        const pv=satellite.propagate(satrec,now);
        if(!pv.position||typeof pv.position==='boolean')return;
        const gmst=satellite.gstime(now);
        const geo=satellite.eciToGeodetic(pv.position,gmst);
        const lat=satellite.degreesLat(geo.latitude);
        const lon=satellite.degreesLong(geo.longitude);
        const altKm=geo.height;
        if(isNaN(lat)||isNaN(lon)||altKm<100||altKm>50000)return;
        const n=sat.OBJECT_NAME||'';
        const isISS=/\bISS\b|ZARYA/i.test(n);
        const isCSS=/TIANGONG|TIANHE/i.test(n);
        const isGPS=sat._gi===2;
        const isGLO=sat._gi===3;
        const isMil=sat._gi===4||/USA[\s-]?\d|NOSS|TRUMPET|LACROSSE|ORION|MENTOR|MERCURY|INTRUDER|KEYHOLE|MISTY|CRYSTAL|ONYX|NEMESIS|NROL/i.test(n);
        const grp=_SAT_GROUPS[sat._gi]||_SAT_GROUPS[1];
        const col=isISS?'#00eeff':isCSS?'#ff6b35':isGPS?'#39d353':isGLO?'#ffa500':isMil?'#DA3633':grp.col;
        const sz=isISS||isCSS?7:isMil||isGPS||isGLO?4:2.5;
        const showLabel=isISS||isCSS||isMil||count<15;
        const inc=sat.INCLINATION||0;const period=sat.MEAN_MOTION?(1440/sat.MEAN_MOTION):0;
        const typeLabel=isISS?'SPACE STATION (ISS)':isCSS?'SPACE STATION (CSS)':isGPS?'GPS NAVIGATION SAT':isGLO?'GLONASS NAV SAT':isMil?'US MILITARY SAT':grp.label;
        const ent=V.entities.add({
          position:Cesium.Cartesian3.fromDegrees(lon,lat,altKm*1000),
          point:{pixelSize:sz,color:Cesium.Color.fromCssColorString(col).withAlpha(isISS||isCSS?1:isMil||isGPS||isGLO?0.85:0.6),disableDepthTestDistance:5e6},
          label:showLabel?{text:n.substring(0,16),font:isISS||isMil?'bold 9px JetBrains Mono':'8px JetBrains Mono',fillColor:Cesium.Color.fromCssColorString(col),outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(10,-3),scaleByDistance:new Cesium.NearFarScalar(5e5,1,2e7,0.2)}:undefined,
          description:`<div style="font-family:monospace;font-size:13px;padding:4px"><b style="color:${col}">${esc(n)}</b><br><br><b>Type:</b> ${typeLabel}<br><b>NORAD:</b> ${sat.NORAD_CAT_ID}<br><b>Alt:</b> ${Math.round(altKm)} km<br><b>Inc:</b> ${inc.toFixed(1)}°<br><b>Period:</b> ${period.toFixed(1)} min<br><small style="color:#888">SGP4 real-time</small></div>`,
          show:layers.sat
        });
        satEnts.push(ent);
        _satRecords.push({satrec,ent,isISS,isCSS});
        count++;
      }catch(e){}
    });
    _buildISSTrail();
    document.getElementById('satV').textContent=count;
    if(count>0){
      us(1);
      af('var(--gn)',`Satellites: ${count} tracked — GPS · GLONASS · Military · Stations (real-time SGP4)`);
      EventLog.add('info',`Satellites: ${count} tracked (5 groups, real-time SGP4)`);
      Health.ok('celestrak',count);
    }
    _satPosTimer=setInterval(()=>{
      if(!layers.sat||document.hidden)return;
      _updateSatPositions();
      _buildISSTrail();
    },30000);
  }catch(e){Health.err('celestrak',e);console.error('[SAT]',e);}
}
function _updateSatPositions(){
  if(!V||!_satRecords.length)return;
  const now=new Date();const gmst=satellite.gstime(now);
  _satRecords.forEach(({satrec,ent})=>{
    try{
      const pv=satellite.propagate(satrec,now);
      if(!pv.position||typeof pv.position==='boolean')return;
      const geo=satellite.eciToGeodetic(pv.position,gmst);
      const lat=satellite.degreesLat(geo.latitude);
      const lon=satellite.degreesLong(geo.longitude);
      const altKm=geo.height;
      if(isNaN(lat)||isNaN(lon)||altKm<100||altKm>50000)return;
      ent.position=Cesium.Cartesian3.fromDegrees(lon,lat,altKm*1000);
    }catch(e){}
  });
}
function _buildISSTrail(){
  if(!V)return;
  const issRec=_satRecords.find(r=>r.isISS||r.isCSS);
  if(!issRec)return;
  const pts=[];const base=Date.now();
  for(let i=0;i<=90;i++){
    try{
      const t=new Date(base+i*60000);
      const pv=satellite.propagate(issRec.satrec,t);
      if(!pv.position||typeof pv.position==='boolean')continue;
      const gmst=satellite.gstime(t);
      const geo=satellite.eciToGeodetic(pv.position,gmst);
      const lat=satellite.degreesLat(geo.latitude);
      const lon=satellite.degreesLong(geo.longitude);
      const altKm=geo.height;
      if(isNaN(lat)||isNaN(lon))continue;
      pts.push(lon,lat,altKm*1000);
    }catch(e){}
  }
  if(pts.length<6)return;
  const trailPos=Cesium.Cartesian3.fromDegreesArrayHeights(pts);
  let trail=V.entities.getById('_issOrbitTrail');
  if(!trail){
    trail=V.entities.add({id:'_issOrbitTrail',polyline:{positions:trailPos,width:1.5,material:Cesium.Color.fromCssColorString('#00eeff').withAlpha(0.25),clampToGround:false,arcType:Cesium.ArcType.NONE},show:layers.sat});
    satEnts.push(trail);
  }else{
    trail.polyline.positions=trailPos;
    trail.show=layers.sat;
  }
}
// PHASE 14 — FR24-STYLE AIRCRAFT READOUT PANEL
// Selected-aircraft side panel: aircraft photo + live telemetry.
// Photo from planespotters.net free public API (key-less, by ICAO hex).
// Listens to Cesium selectedEntityChanged and updates _acReadout DOM.
// ═══════════════════════════════════════════════════════════════════════
const _acPhotoCache=new Map();   // hex -> {url, thumb, photographer, link} | null (negative cache)
let _acPhotoInflight=new Set();  // hex currently being fetched
async function fetchAircraftPhoto(hex){
  if(!hex)return null;
  const h=hex.toLowerCase();
  if(_acPhotoCache.has(h))return _acPhotoCache.get(h);
  if(_acPhotoInflight.has(h))return null;
  _acPhotoInflight.add(h);
  try{
    const r=await fetch(`https://api.planespotters.net/pub/photos/hex/${h}`,{signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw new Error('http '+r.status);
    const data=await r.json();
    const photo=data&&data.photos&&data.photos[0];
    if(!photo){_acPhotoCache.set(h,null);return null}
    const out={
      thumb:photo.thumbnail_large&&photo.thumbnail_large.src||photo.thumbnail&&photo.thumbnail.src||'',
      photographer:photo.photographer||'',
      link:photo.link||''
    };
    _acPhotoCache.set(h,out);
    return out;
  }catch(e){
    _acPhotoCache.set(h,null); // negative-cache so we don't hammer the API
    return null;
  }finally{
    _acPhotoInflight.delete(h);
  }
}

// Build the inner HTML for the readout panel given an aircraft data object
function buildAcReadout(a,photo){
  const isMil=a.isMil||a.isVIP;
  const accent=a.isVIP?'#9b6abf':isMil?'#ef4444':'#00d4ff';
  const typeLabel=a.isVIP?'VIP / GOV':isMil?'MILITARY':'CIVILIAN';
  const altStr=a.alt===0?'GND':a.alt.toLocaleString()+' ft';
  const flStr=a.alt>0?'FL'+Math.round(a.alt/100):'GND';
  const cardinals=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const cardinal=cardinals[Math.round((a.hdg||0)/22.5)%16]||'';
  const type=classifyAircraftType(a.desc);
  const typeMap={heli:'HELICOPTER',fighter:'FIGHTER',wide:'WIDE-BODY',prop:'TURBOPROP',bizjet:'BIZJET',jet:'NARROW-BODY JET'};
  const mach=a.spd>0?(a.spd*0.00149).toFixed(2):'';
  const photoBlock=photo&&photo.thumb?
    `<div class="acr-photo"><img src="${photo.thumb}" alt="aircraft"><div class="acr-photo-cred">© ${esc(photo.photographer||'planespotters.net')}</div></div>`:
    `<div class="acr-photo acr-photo-empty"><div class="acr-photo-spinner"></div><div style="font-size:9px;color:#5a6378;margin-top:6px;letter-spacing:1px">${photo===null?'NO PHOTO ON FILE':'LOADING IMAGE…'}</div></div>`;
  const squawkBadge=a.squawk?(['7500','7600','7700','7400'].includes(a.squawk)?`<span class="acr-sq acr-sq-em">SQ ${esc(a.squawk)}</span>`:`<span class="acr-sq">SQ ${esc(a.squawk)}</span>`):'';
  return `
    <div class="acr-hdr" style="border-bottom:1px solid ${accent}33">
      <div class="acr-cs" style="color:${accent}">${esc((a.cs||a.hex).trim())}</div>
      <div class="acr-cls" style="color:${accent}aa">${typeLabel} · ${typeMap[type]||'AIRCRAFT'}</div>
    </div>
    ${photoBlock}
    <div class="acr-tag">${esc(a.desc||'Unknown type')}</div>
    <div class="acr-grid">
      <div class="acr-cell"><div class="acr-lbl">ALTITUDE</div><div class="acr-val acr-val-lg">${flStr}</div><div class="acr-sub">${altStr}</div></div>
      <div class="acr-cell"><div class="acr-lbl">SPEED</div><div class="acr-val acr-val-lg">${(a.spd||0).toFixed(0)}</div><div class="acr-sub">kts${mach&&a.spd>200?' · M'+mach:''}</div></div>
      <div class="acr-cell"><div class="acr-lbl">HEADING</div><div class="acr-val acr-val-lg">${(a.hdg||0).toFixed(0)}°</div><div class="acr-sub">${cardinal}</div></div>
      <div class="acr-cell"><div class="acr-lbl">REGION</div><div class="acr-val">${esc(a.reg||'—')}</div><div class="acr-sub">${esc(a.src==='opensky'?'OpenSky':'ADS-B')}</div></div>
    </div>
    <div class="acr-coords">
      <div><span class="acr-lbl">LAT</span> <span class="acr-mono">${a.lat.toFixed(4)}°</span></div>
      <div><span class="acr-lbl">LON</span> <span class="acr-mono">${a.lon.toFixed(4)}°</span></div>
      <div><span class="acr-lbl">HEX</span> <span class="acr-mono">${esc(a.hex.toUpperCase())}</span> ${squawkBadge}</div>
    </div>
    <div class="acr-actions">
      <button onclick="if(window.trackAircraft)trackAircraft('${a.hex}','${(a.cs||a.hex).replace(/'/g,'')}')">◎ TRACK</button>
      <button onclick="if(parent.V)parent.V.camera.flyTo({destination:parent.Cesium.Cartesian3.fromDegrees(${a.lon},${a.lat},${Math.max(50000,a.alt*0.3048*8)}),duration:1.2})">FLY TO</button>
      <button onclick="hideAcReadout()" class="acr-close">CLOSE</button>
    </div>`;
}

// Show/hide/refresh the FR24-style side panel
function showAcReadout(a){
  const el=document.getElementById('acReadout');
  if(!el||!a)return;
  el.innerHTML=buildAcReadout(a,_acPhotoCache.get(a.hex.toLowerCase())||undefined);
  el.classList.add('show');
  // Trigger async photo fetch — when it returns, re-render only the photo block
  fetchAircraftPhoto(a.hex).then(photo=>{
    if(!el.classList.contains('show'))return;
    if(el.dataset.hex!==a.hex.toLowerCase())return; // user moved on
    el.innerHTML=buildAcReadout(a,photo);
  });
  el.dataset.hex=a.hex.toLowerCase();
}
function hideAcReadout(){
  const el=document.getElementById('acReadout');
  if(el){el.classList.remove('show');el.dataset.hex=''}
}
window.hideAcReadout=hideAcReadout;
window.showAcReadout=showAcReadout;

// Wire to Cesium selectedEntityChanged — fires when user clicks an aircraft
function initAcReadoutBinding(){
  if(!V||!V.selectedEntityChanged||V._acReadoutBound)return;
  V._acReadoutBound=true;
  V.selectedEntityChanged.addEventListener(ent=>{
    if(ent&&ent._ac){
      showAcReadout(ent._ac);
    }else{
      // Only auto-hide if a non-aircraft was selected; manual close stays closed
      const el=document.getElementById('acReadout');
      if(el&&!ent)el.classList.remove('show');
    }
  });
}
// Try to bind now; if V isn't ready, retry on next animation frame
(function bindWhenReady(){
  if(typeof V!=='undefined'&&V&&V.selectedEntityChanged){initAcReadoutBinding()}
  else{requestAnimationFrame(bindWhenReady)}
})();
