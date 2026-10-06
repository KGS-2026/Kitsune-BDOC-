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

// MOTION MODEL INTEGRATION v2 (Turn 24 — per-frame render-behind interpolation)
// v1 BUG: assigned a static Cartesian3 once per poll — Cesium sampled it once and
// the aircraft still snapped. v2 feeds each poll fix to motionModel.updateFix()
// and binds entity.position to a per-hex CallbackProperty that Cesium evaluates
// EVERY FRAME, so positions glide between fixes (30s render-behind).
const _acPosProps = new Map(); // hex -> CallbackProperty (reused across polls)
function aircraftPositionProperty(hex, a) {
  // Feed the new fix into the motion model (spd stays in KNOTS here;
  // motion-model.js converts to m/s exactly once at ingestion).
  const hasMM = (typeof motionModel !== 'undefined') && motionModel && motionModel.updateFix;
  if (hasMM) {
    try { motionModel.updateFix(hex, a); } catch(e) { console.warn('[motionModel] updateFix:', e.message); }
  }
  let prop = _acPosProps.get(hex);
  if (!prop) {
    // Fallback position (raw last fix) if motion model is unavailable
    let lastRaw = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, (a.alt || 0) * 0.3048);
    prop = new Cesium.CallbackProperty(function(time, result) {
      if (hasMM || (typeof motionModel !== 'undefined' && motionModel)) {
        try {
          const p = motionModel.displayPosition(hex, result);
          if (p) return p;
        } catch(_) {}
      }
      return Cesium.Cartesian3.clone(prop._lastRaw || lastRaw, result);
    }, false); // isConstant=false -> evaluated per frame
    prop._lastRaw = lastRaw;
    _acPosProps.set(hex, prop);
  }
  // refresh the raw fallback each poll
  prop._lastRaw = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, (a.alt || 0) * 0.3048);
  return prop;
}
// Render hold: per-frame interpolation is invisible under requestRenderMode
// unless we keep frames flowing while aircraft are on screen.
function _airRenderHold(active) {
  try {
    if (window.BDOCRender) {
      if (active) BDOCRender.hold('air-motion');
      else BDOCRender.release('air-motion');
    }
  } catch(_) {}
}
// SECTION 11.5a: AIRCRAFT ICON GENERATION — Phase 14 type-aware (game-style silhouettes)
// Classify aircraft by description string (ICAO type code + name from adsb.lol .desc field)
// ─── ICAO TYPE DESIGNATOR -> SILHOUETTE FAMILY (p152) ────────────────────
// EXACT-match table. The previous substring regexes mis-sorted real traffic
// badly: GLF5 (Gulfstream V) -> fighter because it contains "F5"; C172 ->
// wide because it contains "C17"; B212 (Bell 212) -> bomber via "B21";
// F2TH (Falcon 2000) -> fighter via "F2". Measured against 1019 live
// aircraft, 42 civilian jets were drawn as fighters. Match whole codes only.
// 605 designators mapped.
const AC_TYPE_TABLE = {
  717:'jet',727:'jet',737:'jet',757:'jet',A10:'fighter',A109:'heli',A119:'heli',A124:'wide',
  A139:'heli',A149:'heli',A169:'heli',A189:'heli',A19N:'jet',A20N:'jet',A21N:'jet',A225:'wide',
  A306:'wide',A30B:'wide',A310:'jet',A318:'jet',A319:'jet',A320:'jet',A321:'jet',A332:'wide',
  A332MRTT:'tanker',A333:'wide',A337:'wide',A338:'wide',A339:'wide',A33X:'wide',A342:'wide',A343:'wide',
  A345:'wide',A346:'wide',A359:'wide',A35K:'wide',A388:'wide',A400:'wide',AC130:'wide',AEST:'prop',
  AH64:'heli',AJET:'fighter',AKNC:'drone',ALCA:'fighter',AN12:'wide',AN124:'wide',AN2:'prop',AN22:'wide',
  AN225:'wide',AN26:'wide',AN28:'prop',AN32:'wide',AN38:'prop',AN70:'wide',ANKA:'drone',ARJ2:'jet',
  AS32:'heli',AS35:'heli',AS36:'heli',AS50:'heli',AS55:'heli',AS65:'heli',ASTR:'bizjet',AT3:'prop',
  AT43:'prop',AT44:'prop',AT45:'prop',AT46:'prop',AT5:'prop',AT6:'prop',AT72:'prop',AT73:'prop',
  AT75:'prop',AT76:'prop',AT8:'prop',AV8B:'fighter',B06:'heli',B06T:'heli',B1:'bomber',B190:'prop',
  B1B:'bomber',B2:'bomber',B204:'heli',B205:'heli',B206:'heli',B21:'bomber',B212:'heli',B214:'heli',
  B222:'heli',B230:'heli',B350:'prop',B37M:'jet',B38M:'jet',B39M:'jet',B3XM:'jet',B407:'heli',
  B412:'heli',B427:'heli',B429:'heli',B430:'heli',B461:'jet',B462:'jet',B463:'jet',B505:'heli',
  B52:'wide',B525:'heli',B52H:'bomber',B703:'tanker',B712:'jet',B721:'jet',B722:'jet',B731:'jet',
  B732:'jet',B733:'jet',B734:'jet',B735:'jet',B736:'jet',B737:'jet',B738:'jet',B739:'jet',
  B73X:'jet',B741:'wide',B742:'wide',B743:'wide',B744:'wide',B747:'wide',B748:'wide',B74D:'wide',
  B74R:'wide',B74S:'wide',B752:'jet',B753:'jet',B757:'jet',B762:'wide',B763:'wide',B764:'wide',
  B767:'wide',B772:'wide',B773:'wide',B778:'wide',B779:'wide',B77L:'wide',B77W:'wide',B787:'wide',
  B788:'wide',B789:'wide',B78X:'wide',BCS1:'jet',BCS3:'jet',BE10:'prop',BE20:'prop',BE30:'prop',
  BE33:'prop',BE35:'prop',BE36:'prop',BE40:'prop',BE4W:'bizjet',BE50:'prop',BE55:'prop',BE58:'prop',
  BE60:'prop',BE65:'prop',BE76:'prop',BE80:'prop',BE88:'prop',BE95:'prop',BE99:'prop',BL17:'prop',
  BL8:'prop',BLCF:'bomber',C130:'wide',C135:'tanker',C150:'prop',C152:'prop',C160:'wide',C162:'prop',
  C17:'wide',C170:'prop',C172:'prop',C175:'prop',C177:'prop',C180:'prop',C182:'prop',C185:'prop',
  C188:'prop',C190:'prop',C195:'prop',C206:'prop',C207:'prop',C208:'prop',C210:'prop',C27J:'wide',
  C295:'wide',C30J:'wide',C337:'prop',C402:'prop',C404:'prop',C406:'prop',C421:'prop',C425:'prop',
  C441:'prop',C5:'wide',C500:'bizjet',C501:'bizjet',C510:'bizjet',C525:'bizjet',C526:'bizjet',C550:'bizjet',
  C551:'bizjet',C560:'bizjet',C56X:'bizjet',C5M:'wide',C650:'bizjet',C680:'bizjet',C68A:'bizjet',C700:'bizjet',
  C750:'bizjet',C77R:'prop',C82R:'prop',C919:'jet',CH4:'drone',CH47:'heli',CH5:'drone',CH53:'heli',
  CH70:'prop',CH7A:'prop',CL30:'bizjet',CL35:'bizjet',CL60:'bizjet',CL600:'bizjet',CL601:'bizjet',CL604:'bizjet',
  CL605:'bizjet',CL650:'bizjet',CN35:'wide',COL4:'prop',CP10:'prop',CQ10:'drone',CRJ:'jet',CRJ1:'bizjet',
  CRJ2:'jet',CRJ7:'jet',CRJ9:'jet',CRJX:'jet',CS100:'jet',CS300:'jet',D228:'prop',D328:'prop',
  DA40:'prop',DA42:'prop',DA62:'prop',DC10:'wide',DC85:'wide',DC86:'wide',DC87:'wide',DC91:'jet',
  DC93:'jet',DC94:'jet',DC95:'jet',DH8A:'prop',DH8B:'prop',DH8C:'prop',DH8D:'prop',DHC2:'prop',
  DHC3:'prop',DHC4:'prop',DHC6:'prop',DHC7:'prop',DV20:'prop',E110:'prop',E120:'prop',E135:'jet',
  E140:'jet',E145:'jet',E170:'jet',E190:'jet',E195:'jet',E290:'jet',E295:'jet',E3CF:'tanker',
  E3TF:'tanker',E45X:'jet',E50P:'bizjet',E545:'bizjet',E550:'bizjet',E55P:'bizjet',E6:'tanker',E75:'jet',
  E75L:'jet',E75S:'jet',E767:'tanker',EA18:'fighter',EA50:'bizjet',EA6B:'fighter',EC20:'heli',EC25:'heli',
  EC30:'heli',EC35:'heli',EC45:'heli',EC55:'heli',EC75:'heli',EH10:'heli',EN28:'heli',EPIC:'prop',
  ERJ:'jet',EUFI:'fighter',EXEC:'heli',EXPL:'heli',F1:'fighter',F100:'jet',F104:'fighter',F111:'fighter',
  F117:'fighter',F14:'fighter',F15:'fighter',F15C:'fighter',F15E:'fighter',F16:'fighter',F16C:'fighter',F18:'fighter',
  F18C:'fighter',F18E:'fighter',F22:'fighter',F2TH:'bizjet',F35:'fighter',F35A:'fighter',F35B:'fighter',F35C:'fighter',
  F4:'fighter',F5:'fighter',F70:'jet',F900:'bizjet',FA10:'bizjet',FA18:'fighter',FA20:'bizjet',FA50:'bizjet',
  FA6X:'bizjet',FA7X:'bizjet',FA8X:'bizjet',G150:'bizjet',G280:'bizjet',G650:'bizjet',GA8:'prop',GALX:'bizjet',
  GAZL:'heli',GHWK:'drone',GL5T:'bizjet',GL7T:'bizjet',GLAS:'prop',GLEX:'bizjet',GLF2:'bizjet',GLF3:'bizjet',
  GLF4:'bizjet',GLF5:'bizjet',GLF6:'bizjet',GRIP:'fighter',GY80:'prop',H1:'heli',H125:'heli',H130:'heli',
  H135:'heli',H145:'heli',H155:'heli',H160:'heli',H175:'heli',H25A:'bizjet',H25B:'bizjet',H25C:'bizjet',
  H369:'heli',H46:'heli',H47:'heli',H500:'heli',H53:'heli',H6:'bomber',H60:'heli',H64:'heli',
  H6K:'bomber',HA4T:'bizjet',HARR:'fighter',HAWK:'fighter',HC130:'wide',HDJT:'bizjet',HERN:'drone',HRON:'drone',
  HUCO:'heli',IL62:'wide',IL76:'wide',IL78:'tanker',IL86:'wide',IL96:'wide',J10:'fighter',J11:'fighter',
  J15:'fighter',J16:'fighter',J20:'fighter',J328:'prop',JAS39:'fighter',JCOM:'bizjet',K35E:'tanker',K35R:'tanker',
  KA26:'heli',KA32:'heli',KA50:'heli',KA52:'heli',KC10:'tanker',KC130:'wide',KC135:'tanker',KC30:'tanker',
  KC46:'tanker',KE3:'tanker',KFIR:'fighter',KODI:'prop',L101:'wide',L159:'fighter',L39:'fighter',L410:'prop',
  LC130:'wide',LEG2:'prop',LJ23:'bizjet',LJ24:'bizjet',LJ25:'bizjet',LJ28:'bizjet',LJ31:'bizjet',LJ35:'bizjet',
  LJ40:'bizjet',LJ45:'bizjet',LJ55:'bizjet',LJ60:'bizjet',LJ70:'bizjet',LJ75:'bizjet',LNC2:'prop',LNC4:'prop',
  LYNX:'heli',M2000:'fighter',M20P:'prop',M20T:'prop',M600:'prop',M700:'prop',MC130:'wide',MD11:'wide',
  MD80:'jet',MD81:'jet',MD82:'jet',MD83:'jet',MD87:'jet',MD88:'jet',MD90:'jet',MD95:'jet',
  MG15:'mig',MG17:'mig',MG19:'mig',MG21:'mig',MG23:'mig',MG25:'mig',MG27:'mig',MG29:'mig',
  MG31:'mig',MG33:'mig',MG35:'mig',MH60:'heli',MI17:'heli',MI2:'heli',MI24:'heli',MI26:'heli',
  MI38:'heli',MI8:'heli',MIG9:'mig',MIR2:'fighter',MIRA:'fighter',MO20:'prop',MQ1:'drone',MQ20:'drone',
  MQ25:'drone',MQ4:'drone',MQ8:'drone',MQ9:'drone',MRTT:'tanker',MU30:'bizjet',NH90:'heli',P180:'prop',
  P28A:'prop',P28B:'prop',P28R:'prop',P28T:'prop',P32R:'prop',P46T:'prop',PA18:'prop',PA20:'prop',
  PA22:'prop',PA23:'prop',PA24:'prop',PA27:'prop',PA30:'prop',PA31:'prop',PA32:'prop',PA34:'prop',
  PA38:'prop',PA44:'prop',PA46:'prop',PAY1:'prop',PAY2:'prop',PAY3:'prop',PAY4:'prop',PC12:'prop',
  PC21:'prop',PC24:'bizjet',PRED:'drone',PRM1:'bizjet',PUMA:'heli',R135:'tanker',R22:'heli',R44:'heli',
  R66:'heli',RALL:'prop',RC135:'tanker',REAP:'drone',RFAL:'fighter',RJ100:'jet',RJ1H:'jet',RJ70:'jet',
  RJ85:'jet',RQ1:'drone',RQ11:'drone',RQ20:'drone',RQ21:'drone',RQ4:'drone',RQ7:'drone',RV10:'prop',
  RV12:'prop',RV4:'prop',RV6:'prop',RV7:'prop',RV8:'prop',RV9:'prop',S22T:'prop',S61:'heli',
  S64:'heli',S70:'heli',S76:'heli',S92:'heli',SAVG:'prop',SB20:'prop',SBR1:'bizjet',SBR2:'bizjet',
  SF34:'prop',SF50:'bizjet',SHHD:'drone',SKUA:'heli',SR20:'prop',SR22:'prop',SR2T:'prop',SSJ1:'jet',
  SU15:'mig',SU17:'mig',SU20:'mig',SU22:'mig',SU24:'mig',SU25:'mig',SU27:'mig',SU30:'mig',
  SU33:'mig',SU34:'mig',SU35:'mig',SU37:'mig',SU57:'mig',SU95:'jet',SW3:'prop',SW4:'prop',
  T154:'jet',T204:'jet',T334:'jet',T38:'fighter',T45:'fighter',T6:'fighter',TB2:'drone',TBM7:'prop',
  TBM8:'prop',TBM9:'prop',TBMPC6:'prop',TIGR:'heli',TOR:'fighter',TORN:'fighter',TRIS:'tanker',TU16:'bomber',
  TU160:'bomber',TU22:'bomber',TU22M:'bomber',TU95:'bomber',UAV:'drone',UH1:'heli',UH60:'heli',ULAC:'prop',
  VC25:'tanker',VELO:'prop',WC130:'wide',WLG1:'drone',WLG2:'drone',WW24:'bizjet',XQ58:'drone',Y12:'prop',
  Y20:'wide',Y8:'wide',Y9:'wide',YK40:'jet',YK42:'jet'
};

function classifyAircraftType(desc){
  if(!desc)return 'jet';
  const d=String(desc).toUpperCase().trim();

  // ── 1. EXACT ICAO type-code lookup (authoritative) ───────────────────────
  // ADS-B feeds supply a 4-char ICAO designator (field `t`). Substring regex
  // against these is catastrophic — "GLF5" contains "F5", "C172" contains
  // "C17", "B212" contains "B21" — so match the whole code and nothing else.
  const code = d.split(/[\s\/(]/)[0].replace(/[^A-Z0-9-]/g,'');
  const T = AC_TYPE_TABLE[code];
  if(T) return T;

  // ── 2. Unknown code: fall back to cautious description matching ──────────
  // These run ONLY when the exact table missed, and every pattern is anchored
  // to a word boundary on both sides to avoid the substring trap above.
  if(/\b(MQ|RQ|XQ|CQ)-?\d+\b|\bREAPER\b|\bPREDATOR\b|\bGLOBAL HAWK\b|\bTRITON\b|\bBAYRAKTAR\b|\bTB-?2\b|\bHERON\b|\bSHAHED\b|\bUAV\b|\bUCAV\b|\bDRONE\b|\bUNMANNED\b/.test(d))return 'drone';
  if(/\bB-?(1|1B|2|21|52)\b|\bLANCER\b|\bSTRATOFORTRESS\b|\bTU-?(16|22|95|160)\b|\bBACKFIRE\b|\bBLACKJACK\b|\bH-?6\b/.test(d))return 'bomber';
  if(/\bKC-?\d+\b|\bMRTT\b|\bVOYAGER\b|\bSTRATOTANKER\b|\bPEGASUS\b|\bEXTENDER\b|\bIL-?78\b|\bTANKER\b/.test(d))return 'tanker';
  if(/\bMIG-?\d+\b|\bFULCRUM\b|\bFLANKER\b|\bFOXBAT\b|\bFOXHOUND\b|\bFROGFOOT\b|\bSU-?\d+\b/.test(d))return 'mig';
  if(/\bF-?\d{1,3}[A-Z]?\b|\bF\/A-?\d+[A-Z]?\b|\bRAFALE\b|\bTYPHOON\b|\bGRIPEN\b|\bHORNET\b|\bTOMCAT\b|\bEAGLE\b|\bRAPTOR\b|\bLIGHTNING\b|\bA-?10\b|\bAV-?8\b|\bHARRIER\b/.test(d))return 'fighter';
  if(/\bHELICOPTER\b|\bHELI\b|\bROTOR\b/.test(d))return 'heli';
  if(/\bTURBOPROP\b|\bPROP\b|\bPISTON\b|\bCESSNA\b|\bPIPER\b|\bBEECH\b/.test(d))return 'prop';
  if(/\bGULFSTREAM\b|\bLEARJET\b|\bCITATION\b|\bCHALLENGER\b|\bGLOBAL EXPRESS\b|\bDASSAULT FALCON\b|\bPHENOM\b|\bHAWKER\b/.test(d))return 'bizjet';
  if(/\bA3[4-8]\d\b|\bB7[4-8]\d\b|\bWIDE-?BODY\b|\bMD-?11\b|\bDC-?10\b/.test(d))return 'wide';

  return 'jet';
}
// Render type-aware aircraft icon at given rotation
// ─── AIRCRAFT GLYPHS (real vector artwork supplied by Travon, p150) ───────
// Each entry is the ORIGINAL path data from his SVG, untouched, plus a
// transform that maps that file's native viewBox into our 32x32 marker box
// (centred, 30u wide, nose-up). Geometry is never rewritten — only framed —
// so the shapes stay exactly as drawn.
//
// Fill is applied on the <g>, not the paths (hardcoded fills were stripped),
// which is what lets the engine inject live tint: altitude banding, red on
// selection. Rotation for heading is applied by the caller on top of `t`.
const AC_GLYPHS = {
  // source artwork: Boeing 747.svg
  wide: {t:'translate(1.000 1.000) scale(0.06000)', d:`<g><path d="m249.83 55.59s-62.94 4.13.12 388.82c62.82-384.73-.12-388.82-.12-388.82zm-15.17 36.45c-.07 0-.13-.06-.13-.13 0-5.46 4.43-9.89 9.89-9.89h10.83c5.46 0 9.89 4.43 9.89 9.89 0 .07-.06.13-.13.13z"/><g><g><path d="m452.41 285.83c-.19-3.9-2.5-7.37-6.03-9.05l-51.68-24.63.29-15.64c.07-3.6-2.8-6.58-6.4-6.65l-2.3-.04c-3.6-.07-6.58 2.8-6.65 6.4l-.16 8.68-60.78-28.96.18-15.09c.07-3.6-2.8-6.58-6.4-6.65l-2.3-.04c-3.6-.07-6.58 2.8-6.65 6.4l.17 8.23-21.4-10.2c-.65 20.17-2.03 43.05-4.35 69.05l26.63-.77 148.29 29.05z"/><path d="m217.43 198.62-21.23 10.13.19-8.25c-.07-3.6-3.05-6.47-6.65-6.4l-2.3.04c-3.6.07-6.47 3.05-6.4 6.65l.21 15.08-60.78 29.01-.17-8.68c-.07-3.6-3.05-6.47-6.65-6.4l-2.3.04c-3.6.07-6.47 3.05-6.4 6.65l.3 15.64-51.65 24.68c-3.52 1.68-5.83 5.16-6.02 9.06l-.48 10.1 148.27-29.14 26.44.74c-2.32-25.95-3.72-48.8-4.38-68.95z"/></g><g><path d="m238.66 404.4-44.93 20.46-6.51 12.52 54.92-10.56c-1.21-7.63-2.37-15.11-3.48-22.42z"/><path d="m257.75 426.83 54.92 10.53-6.52-12.51-44.94-20.43c-1.1 7.31-2.26 14.79-3.46 22.41z"/></g></g></g>`},
  // source artwork: Boeing 2 engine.svg
  jet: {t:'translate(1.000 1.000) scale(0.05001)', d:`<g> <g> <path d="M555.768,422.125v-48.992L343.478,216.529c0.648-41.274,0.595-83.026-0.708-125.594C340.395,40.641,320.915,0,299.913,0 c-20.995,0-40.475,40.641-42.849,90.935c-1.302,42.568-1.356,84.321-0.708,125.594L44.059,373.134v48.992l215.76-88.871 c2.709,66.227,6.021,131.851,8.404,197.849l-65.685,36.371v32.351l97.375-16.986l97.369,16.986v-32.351l-65.67-36.371 c2.374-65.998,5.678-131.622,8.404-197.849L555.768,422.125z"/> <g> <rect x="138.92" y="248.809" width="39.716" height="66.667"/> <rect x="421.191" y="248.809" width="39.716" height="66.667"/> </g> </g> </g>`},
  // source artwork: small boeing.svg
  bizjet: {t:'translate(1.000 1.000) scale(0.06667)', d:`<g><g><g clip-rule="evenodd" fill-rule="evenodd"><path d="m57.4 256v23.1h133.3v-84.8z"/><path d="m259.8 194.3v84.8h133.3v-23.1z"/><path d="m317.2 193.6v18.3l28.1 13v-31.3z"/><path d="m105.3 193.6v31.3l28.1-13v-18.3z"/><path d="m196.1 341-38.4 17.8v23.2h48.9c-2.3-7.5-4.3-14.6-5.9-20.7-1.7-7-3.3-13.8-4.6-20.3z"/><path d="m292.6 358.7-38.3-17.7c-1.3 6.5-2.9 13.3-4.6 20.2-1.6 6.1-3.6 13.2-5.9 20.7h48.7v-23.2z"/><path d="m198.8 296c.1 4.2.3 17 4.3 38.4 1.5 7.9 3.3 16.2 5.5 24.8 1.9 7.3 4.4 16.2 7.4 25.5 2.6 8.3 5.5 16.6 8.5 24.8.1.1.2.5.7.5s.6-.4.7-.5c3-8.1 5.9-16.5 8.5-24.8 3-9.3 5.5-18.1 7.4-25.5 2.2-8.6 4-16.9 5.5-24.8 4-21.4 4.2-34.2 4.3-38.5v-190.5c-.4-16.8-4.9-32.9-13-46.8-3.9-6.6-9.7-13.5-12.9-17-.2-.2-.4-.3-.6-.3-.2 0-.4 0-.6.3-3.2 3.5-9.1 10.4-12.9 17-8.1 13.9-12.6 30-13 46.8z"/></g></g></g>`},
  // source artwork: F-22.svg
  fighter: {t:'translate(1.000 1.000) scale(0.05001)', d:`<g> <path d="M514.805,403.155l-146.22-130.804l-8.409-90.627c0,0,0,0-32.233-31.767C327.475,27.562,299.913,0,299.913,0 s-27.562,27.562-28.028,149.957c-32.235,31.767-32.235,31.767-32.235,31.767l-8.409,90.627L85.021,403.155v57.095l123.329,35.401 l-52.789,45.78v43.912l55.591,14.482l56.058-46.248v-0.134h11.66l9.462,9.462h11.579h11.579l9.462-9.462h11.66v0.134l56.058,46.248 l55.591-14.482v-43.912l-52.789-45.78l123.33-35.401v-57.095H514.805z"/> </g>`},
  // source artwork: Russian Mig.svg
  mig: {t:'translate(1.000 1.000) scale(0.46875)', d:`<path d="m36.925 36.278 20.375 1.453-.269-1.265-11.25-5.719a1.384 1.384 0 0 1 -.74-1.143l-.107-2.921-1.117 1.952a1.357 1.357 0 0 1 -1.777.538l-5.826-2.96a1.358 1.358 0 0 1 -.727-1.2v-9.27l-3.487-7.818-3.485 7.818v9.272a1.358 1.358 0 0 1 -.727 1.2l-5.826 2.96a1.357 1.357 0 0 1 -1.777-.538l-1.117-1.952-.107 2.915a1.384 1.384 0 0 1 -.74 1.143l-11.25 5.723-.271 1.265 20.373-1.453a1.325 1.325 0 0 1 1.238.646 1.341 1.341 0 0 1 .013 1.4l-8.773 14.56v.552l6.957-3.97a1.313 1.313 0 0 1 1.332 0 1.35 1.35 0 0 1 .673 1.171v2.3h6.97v-2.3a1.35 1.35 0 0 1 .673-1.171 1.291 1.291 0 0 1 .673-.175 1.274 1.274 0 0 1 .659.175l6.957 3.97v-.552l-8.773-14.56a1.341 1.341 0 0 1 .013-1.4 1.325 1.325 0 0 1 1.24-.646z"/>`},
  // source artwork: globle master military.svg
  tanker: {t:'translate(1.000 1.000) scale(0.05001)', d:`<g> <g> <path d="M336.631,328.036l63.703,15.112l169.094,69.832l-6.206-41.447L335.692,177.913c-0.855-27.326-2.172-53.827-4.215-76.855 C322.009-5.475,299.913,0.049,299.913,0.049s-22.096-5.524-31.564,101.01c-2.051,23.028-3.367,49.529-4.215,76.855L36.598,371.532 L30.4,412.98l169.094-69.832l63.702-15.112c0.477,35.475,1.203,59.481,1.203,59.481s1.015,48.938,16.346,124.657l-76.953,61.735 v25.919l93.564-18.457c0.915,3.322,4.2,3.322,5.115,0l93.564,18.457v-25.919l-76.945-61.735 c15.331-75.719,16.331-124.657,16.331-124.657S336.155,363.511,336.631,328.036z"/> <g> <rect x="387.658" y="197.572" width="25.117" height="103.302"/> <rect x="187.053" y="197.572" width="25.109" height="103.296"/> </g> <g> <rect x="471.948" y="267.266" width="25.109" height="95.475"/> <rect x="102.771" y="267.266" width="25.117" height="95.475"/> </g> </g> </g>`},
  // source artwork: military-drone.svg
  drone: {t:'translate(1.000 1.000) scale(0.00750)', d:`<g><path d="m950 1763.75c0-64.342-52.325-116.667-116.667-116.667s-116.667 52.325-116.667 116.667v302.429l233.334-170.508z"/><path d="m3283.333 1763.75c0-64.342-52.325-116.667-116.667-116.667s-116.667 52.325-116.667 116.667v131.921l233.333 170.508v-302.429z"/><path d="m716.667 3455.417h233.333v291.667h-233.333z"/><path d="m3050 3455.417h233.333v291.667h-233.333z"/><g><path d="m3750 2551.833v786.917h-918.167l-481.833-267.75v-432.25c0-32.083-26.25-58.333-58.333-58.333s-58.333 26.25-58.333 58.333v408.333h-175v301.875c-18.083-6.708-37.917-10.208-58.333-10.208s-40.25 3.5-58.333 10.208v-301.875h-175v-408.333c0-32.083-26.25-58.333-58.333-58.333s-58.333 26.25-58.333 58.333v432.25l-481.833 267.75h-918.169v-786.917l440.708-322.292c.292 0 .292-.292.583-.292l349.709-255.499 609-445.083v468.417c0 32.083 26.25 58.333 58.333 58.333s58.333-26.25 58.333-58.333v-653.042c0-80.5-23.625-158.375-68.25-225.167-31.5-47.542-48.417-102.958-48.417-160.417v-150.5c0-238 136.5-453.25 350-555.042 213.5 101.792 350 317.042 350 555.042v150.5c0 57.458-16.917 112.875-48.417 160.417-44.625 66.792-68.25 144.667-68.25 225.167v653.042c0 32.083 26.25 58.333 58.333 58.333s58.333-26.25 58.333-58.333v-468.417l609 445.083 349.708 255.5c.292 0 .292.292.583.292z"/></g><g><path d="m1899.375 3656.667c-69.125 20.709-156.042 32.084-249.375 32.084-203.292 0-408.333-54.25-408.333-175s205.042-175 408.333-175c93.333 0 180.25 11.375 249.375 32.083-34.417 23.917-59.5 60.083-69.417 102.375-3.208 12.833-4.958 26.542-4.958 40.542s1.75 27.708 4.958 40.542c9.917 42.29 35 78.457 69.417 102.374z"/></g><g><path d="m2758.333 3513.75c0 120.75-205.042 175-408.333 175-93.333 0-180.25-11.375-249.375-32.083 34.417-23.917 59.5-60.083 69.417-102.375 3.208-12.833 4.958-26.542 4.958-40.542s-1.75-27.708-4.958-40.542c-9.917-42.292-35-78.458-69.417-102.375 69.125-20.708 156.042-32.083 249.375-32.083 203.292 0 408.333 54.25 408.333 175z"/></g><g><circle cx="2000" cy="3513.75" r="58.333"/></g></g>`},
  // source artwork: 2 engine plane.svg
  prop: {t:'rotate(45 16 16) translate(1.000 1.000) scale(0.46875)', d:`<g><path d="m63.61 41.42-.32-.31c-.54-.54-1.56-.76-2.28-.5l-9.97 3.68c-.4-.53-.82-1-1.22-1.4l-12.12-12.85c.33-.14.63-.33.9-.57l21.06-18.24c1.43-1.25 1.51-3.36.17-4.71l-.4-.39c-1.34-1.35-3.89-1.87-5.65-1.17l-17.05 6.79-4.15-4.15c-1.61-1.61-4.23-1.61-5.84 0-1.61 1.6-1.61 4.22 0 5.84l1.63 1.63-3.26 1.3c-.08.03-.15.07-.23.11l-8.11-8.6c-2.34-2.35-13.87-9.94-16.3-7.51s5.16 13.96 7.51 16.31l8.55 8.2c-.02.05-.05.09-.06.14l-1.3 3.26-1.63-1.63c-1.61-1.61-4.23-1.61-5.84 0-1.61 1.62-1.61 4.23 0 5.84l4.15 4.15-6.78 17.04c-.7 1.77-.19 4.31 1.17 5.66l.38.39c1.35 1.35 3.47 1.27 4.72-.17l18.23-21.06c.19-.21.34-.45.47-.7l12.7 12.17c.4.4.88.81 1.43 1.21l-3.66 9.94c-.26.71-.03 1.74.5 2.28l.32.31c.54.54 1.39.52 1.9-.05l9.61-10.74 10.74-9.61c.54-.49.57-1.35.03-1.89z"/></g>`}
};

function makeAircraftSVG(color,size,heading,type){
  // p150: prefer Travon's real artwork when a family has it. The fallback
  // below is the hand-drawn set, kept for families with no supplied art
  // (heli, bomber) so nothing renders blank.
  const art = AC_GLYPHS[type];
  if(art){
    return svgToDataUri(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">`+
      `<g transform="rotate(${heading||0} 16 16)">`+
        `<g transform="${art.t}" fill="${color}" stroke="#000" stroke-width="0.8"`+
        ` stroke-linejoin="round" vector-effect="non-scaling-stroke">${art.d}</g>`+
      `</g></svg>`
    );
  }
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
    case 'drone':
      // UCAV / MALE drone — slender fuselage, very high aspect-ratio straight
      // wing, V-tail, bulbous sensor nose. Reads distinctly from 'prop' at
      // small sizes because the wing is long and perfectly straight.
      path=`<path d="M16,3.5 C14.9,3.5 14.2,4.6 14.2,6 L14.2,11.5
                     L1.5,12.6 L1.5,15.8 L14.2,15.2 L14.2,21
                     L9.5,27.5 L11.8,28.4 L16,23.5 L20.2,28.4 L22.5,27.5
                     L17.8,21 L17.8,15.2 L30.5,15.8 L30.5,12.6 L17.8,11.5
                     L17.8,6 C17.8,4.6 17.1,3.5 16,3.5 Z"
              fill="${color}" stroke="#000" stroke-width="0.9"
              stroke-linejoin="round"/>`;
      break;
    case 'bomber':
      // Strategic bomber — blended flying-wing delta. Deliberately the widest
      // planform in the set; at a glance it should never be confused with
      // 'wide' (which has a visible tube fuselage + engine pods).
      path=`<path d="M16,2.5 L19,12 L30.5,22 L29,24.5 L17.6,19.5 L17.2,26 L20,30 L16,28.4 L12,30 L14.8,26 L14.4,19.5 L3,24.5 L1.5,22 L13,12 Z"
              fill="${color}" stroke="#000" stroke-width="1"/>`;
      break;
    case 'tanker':
      // Tanker / strategic airlift — heavy tube with four engine pods and a
      // refuelling boom hint at the tail. Split out of 'wide' because KC-135
      // and KC-46 orbits are tactically meaningful, not just "a big plane".
      path=`<path d="M16,2 L17.6,11 L30,16 L17.6,17.6 L17.6,24 L23,28 L16,26 L9,28 L14.4,24 L14.4,17.6 L2,16 L14.4,11 Z"
              fill="${color}" stroke="#000" stroke-width="1.1"/>
            <circle cx="7.5" cy="15.4" r="1.1" fill="#000" opacity="0.4"/>
            <circle cx="11" cy="14.6" r="1.1" fill="#000" opacity="0.4"/>
            <circle cx="21" cy="14.6" r="1.1" fill="#000" opacity="0.4"/>
            <circle cx="24.5" cy="15.4" r="1.1" fill="#000" opacity="0.4"/>
            <path d="M16,26 L16,30.5" stroke="${color}" stroke-width="1.4" stroke-linecap="round" opacity="0.8"/>`;
      break;
    default: // 'jet' — narrow-body airliner (737/A320 style)
      path=`<path d="M16,2 L17.5,10 L28,14 L17.5,15.5 L17.5,23 L22,27 L16,25.5 L10,27 L14.5,23 L14.5,15.5 L4,14 L14.5,10 Z"
              fill="${color}" stroke="#000" stroke-width="1.2"/>`;
  }
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 32 32">
    <g transform="rotate(${h},16,16)">${path}</g></svg>`;
  return svgToDataUri(svg);
}
// Altitude-based color coding — ADSBx-grade piecewise LUT with hue-indexed
// lightness correction (verified from globe.adsbexchange.com bundle 2026-08-09).
// Five breakpoints in the first 9000ft = max color resolution where it matters
// (approach/departure/helicopters). Cruise traffic all looks similar, intentionally.
// Lightness is corrected per hue because HSL perceived-brightness is wildly non-linear
// (yellow at L=50 blazes; blue at L=50 disappears). Result: every altitude reads equally
// legible against the dark Cesium globe.
const _ALT_HUE = [[0,20],[2000,32.5],[4000,43],[6000,54],[8000,72],[9000,85],
                  [11000,140],[40000,300],[51000,360]];
const _ALT_LIGHT = [[0,53],[20,50],[32,54],[40,52],[46,51],[50,46],[60,43],[80,41],
                    [100,41],[120,41],[140,41],[160,40],[180,40],[190,44],[198,50],
                    [200,58],[220,58],[240,58],[255,55],[266,55],[270,58],[280,58],
                    [290,47],[300,43],[310,48],[320,48],[340,52],[360,53]];
const _lerpLUT=(lut,x)=>{
  if(x<=lut[0][0])return lut[0][1];
  for(let i=lut.length-1;i>=0;--i){
    if(x>lut[i][0]){
      if(i===lut.length-1)return lut[i][1];
      const [x0,y0]=lut[i],[x1,y1]=lut[i+1];
      return y0+(y1-y0)*(x-x0)/(x1-x0);
    }
  }
  return lut[0][1];
};
const _hsl2rgb=(h,s,l)=>{
  s/=100;l/=100;
  const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l);
  const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));
  return `#${[f(0),f(8),f(4)].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('')}`;
};
// LRU-ish cache keyed on quantized altitude + stale flag: ~99% hit rate in practice
const _altColorCache=new Map();
function altColor(alt,staleSec){
  if(alt==null)return '#c0c0c0';
  if(alt<=0)return '#506070';         // ground — slightly blue-tinted dark
  // adaptive quantization: fine below 8000ft, coarse above (cruise = same color anyway)
  const step=alt<8000?50:200;
  const q=step*Math.round(alt/step);
  const stale=staleSec&&staleSec>15?1:0;
  const key=q*2+stale;
  let c=_altColorCache.get(key);
  if(c)return c;
  let h=_lerpLUT(_ALT_HUE,q);
  let s=88;
  let lv=_lerpLUT(_ALT_LIGHT,h);
  if(stale){s=Math.max(0,s-35);lv=Math.min(100,lv+9);} // desaturate+brighten = stale
  c=_hsl2rgb(h,s,lv);
  if(_altColorCache.size>400)_altColorCache.clear(); // simple evict, rare
  _altColorCache.set(key,c);
  return c;
}
// makeConflictSVG lives in layers-conflict.js — removed duplicate here (was dead code, never called from this module)
const _acIconCache={};
let _acIconCacheSize=0;
function getACIcon(color,heading,size,desc){
  const type=classifyAircraftType(desc);
  const key=color+'_'+Math.round(heading/5)*5+'_'+(size||24)+'_'+type;
  if(!_acIconCache[key]){
    // Evict oldest entries if cache exceeds 2200 (9 types × 72 headings × ~6 colors × 2 sizes = ~7776 worst-case)
    if(_acIconCacheSize>2200){const keys=Object.keys(_acIconCache);for(let i=0;i<300;i++){delete _acIconCache[keys[i]];_acIconCacheSize--}}
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
  // ── LEGAL GATE (Turn 24): OpenSky's ToS restrict the free API to research &
  // non-commercial use. BDOC is a commercial product, so OpenSky is DISABLED
  // unless explicitly re-enabled (localStorage bdoc_opensky_ok='1' — set this
  // only under an OpenSky commercial license or in a research deployment).
  // adsb.lol (ODbL) remains the primary source and carries the full load.
  try{
    if(localStorage.getItem('bdoc_opensky_ok')!=='1'){
      return[];
    }
  }catch(_){ return[]; }
  // Browser-direct PRIMARY (p86): OpenSky throttles AWS/datacenter IPs, so the Netlify
  // proxy 502s ~always ("operation aborted due to timeout" after its 7s internal cap) —
  // same pattern as CelesTrak/GDELT. Old order wasted a 15s doomed proxy attempt per
  // region per cycle and spammed console warnings. Proxy kept as data-gated fallback
  // (it injects OPENSKY_USER/PASS Basic Auth if configured, and covers client networks
  // that block opensky-network.org directly).
  let res=null;
  try{
    const directUrl=`https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
    const r=await fetch(directUrl,{signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error('direct '+r.status);
    const data=await r.json();
    if(!data||!data.states)throw new Error('direct empty');
    res={data,fromCache:false};
    Health.ok('opensky',data.states.length||0);
  }catch(e){
    try{
      const p=await safeFetch('opensky',`osky_${reg.name}`,`/.netlify/functions/proxy-opensky?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`,{feedType:'aircraft',staleOk:true,timeout:12000});
      if(p&&p.data&&p.data.states)res=p; // data-gated — safeFetch never rejects, resolves {data:null} on failure
    }catch(e2){/* fall through */}
    if(!res){
      console.warn(`[Aircraft] OpenSky unavailable for ${reg.name} (direct: ${e.message}; proxy also empty)`);
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
// P111: position plausibility state — hex -> {lat,lon,t,tooFast}
const _acLastPos=new Map();
function _acPlausible(a){
  const now=Date.now()/1000;
  const prev=_acLastPos.get(a.hex);
  if(!prev){_acLastPos.set(a.hex,{lat:a.lat,lon:a.lon,t:now,tooFast:0});return true;}
  const dt=now-prev.t;
  // haversine metres
  const R=6371000,toR=Math.PI/180;
  const dLat=(a.lat-prev.lat)*toR,dLon=(a.lon-prev.lon)*toR;
  const h=Math.sin(dLat/2)**2+Math.cos(prev.lat*toR)*Math.cos(a.lat*toR)*Math.sin(dLon/2)**2;
  const dist=2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  const derivedMach=dist/(dt+0.4)/343;              // +0.4s guard against div-by-zero spike
  const gsKt=Math.max(a.spd||0,prev.spd||0)+10+(a.src==='opensky'?0:100); // +100kt MLAT slack
  const gate=(a.alt<=0?60:Math.max(gsKt/666,0.05)); // ground taxiing gated 10x tighter
  if(derivedMach>gate && (prev.tooFast|0)<1){
    // reject ONCE — roll back to prior fix, remember we bounced
    prev.tooFast=(prev.tooFast|0)+1;
    a.lat=prev.lat;a.lon=prev.lon;
    return true; // keep the aircraft visible at its last good position
  }
  // accept — leaky decay of the reject budget (earns a full rejection again after ~6 good updates)
  _acLastPos.set(a.hex,{lat:a.lat,lon:a.lon,t:now,spd:a.spd,tooFast:Math.max(-5,(prev.tooFast|0)-0.8)});
  return true;
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
      // P111: ADSBx-grade position plausibility filter (Mach domain, leaky hysteresis).
      // MLAT/TIS-B feeds emit garbage jumps; naive trackers draw a lightning bolt across
      // the map. We reject in Mach (668 kt/M1) gated on the aircraft's OWN reported gs, and
      // — critically — reject at most ONE jump in a row: two consecutive "impossible" jumps
      // the same way means the OLD fix was wrong, so we accept. Intelligence ethos: never
      // draw a fabricated position, but never freeze on a stale one either.
      if(!_acPlausible(a)) return;
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
          existing.position=aircraftPositionProperty(a.hex,a);
          existing.billboard.image=getACIcon(milColor,a.hdg,32,a.desc);
          existing.billboard.heightReference=a.alt===0?Cesium.HeightReference.CLAMP_TO_GROUND:Cesium.HeightReference.NONE;
          existing.label.text=(a.cs||a.hex).substring(0,8);
          existing.description=buildAircraftCard(a);
          // Phase 14 fix: mil aircraft now show whenever AIR layer OR FORCE TRACK is on (was forcetrack-only)
          existing.show=layers.air||layers.forcetrack;
          existing._ac=a;
        }else{
          const ent=V.entities.add({position:aircraftPositionProperty(a.hex,a),billboard:{image:getACIcon(milColor,a.hdg,32,a.desc),width:38,height:38,scaleByDistance:new Cesium.NearFarScalar(5e4,1.3,1e7,0.5),verticalOrigin:Cesium.VerticalOrigin.CENTER,heightReference:a.alt===0?Cesium.HeightReference.CLAMP_TO_GROUND:Cesium.HeightReference.NONE,disableDepthTestDistance:5e6},label:{text:(a.cs||a.hex).substring(0,8),font:'bold 10px JetBrains Mono',fillColor:Cesium.Color.fromCssColorString(milColor),outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.TOP,pixelOffset:new Cesium.Cartesian2(0,22),scaleByDistance:new Cesium.NearFarScalar(1e5,1,6e6,0.35),showBackground:true,backgroundColor:Cesium.Color.BLACK.withAlpha(0.6),backgroundPadding:new Cesium.Cartesian2(4,2),disableDepthTestDistance:5e6},description:buildAircraftCard(a),show:layers.air||layers.forcetrack});
          ent._ac=a;
          _milEntMap.set(a.hex,ent);
        }
        totalMil++;
      }else{
        const civColor=altColor(a.alt);
        const existing=_airEntMap.get(a.hex);
        if(existing){
          existing.position=aircraftPositionProperty(a.hex,a);
          existing.billboard.image=getACIcon(civColor,a.hdg,28,a.desc);
          existing.billboard.heightReference=a.alt===0?Cesium.HeightReference.CLAMP_TO_GROUND:Cesium.HeightReference.NONE;
          existing.description=buildAircraftCard(a);
          // Phase 14: civilian planes show whenever AIR is on (was: AIR && !forcetrack)
          existing.show=layers.air;
          existing._ac=a; // attach data for FR24 side panel
        }else{
          const ent=V.entities.add({position:aircraftPositionProperty(a.hex,a),billboard:{image:getACIcon(civColor,a.hdg,28,a.desc),width:26,height:26,scaleByDistance:new Cesium.NearFarScalar(5e4,1.1,1e7,0.35),verticalOrigin:Cesium.VerticalOrigin.CENTER,heightReference:a.alt===0?Cesium.HeightReference.CLAMP_TO_GROUND:Cesium.HeightReference.NONE,disableDepthTestDistance:5e6},description:buildAircraftCard(a),show:layers.air});
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
  // Prune motion model history + position properties for stale aircraft
  if(typeof motionModel!=='undefined'&&motionModel&&motionModel.pruneStaleAircraft){
    try{motionModel.pruneStaleAircraft(freshHex)}catch(e){console.warn('[motionModel] pruneStaleAircraft failed:',e.message)}
  }
  for(const hex of _acPosProps.keys()){if(!freshHex.has(hex))_acPosProps.delete(hex)}
  // Keep frames flowing while aircraft are visible (per-frame CallbackProperty
  // interpolation is invisible under requestRenderMode without a hold).
  _airRenderHold((layers.air||layers.forcetrack)&&(totalAir>0||totalMil>0));
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
