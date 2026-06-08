// ============================================================
// BDOC PHASE 2 MODULE: layers-airfields.js
// Military airfields — MILAIRFIELDS const + loadMilAirfields()
// Extracted from index.html lines 9215-9300 (Turn 6c, 2026-04-22)
// Depends on (resolved lazily at call time):
//   V (Cesium.Viewer), Cesium, layers, esc, af, flyToTarget
//   EventLog (js/telemetry.js)
//   getBranch, getFactionColor, makeMilIcon, _branchLabels (js/modules/layers-military.js)
// `var milairfieldEnts` (was `let`) for window-binding consistency.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
var milairfieldEnts = [];
var MILAIRFIELDS = [
  // ── US BOMBER / ICBM / STRATEGIC ──
  {n:'Whiteman AFB',lat:38.73,lon:-93.55,t:'USAF',c:'US',d:'509th BW. B-2 Spirit stealth bomber sole operating base.'},
  {n:'Dyess AFB',lat:32.42,lon:-99.85,t:'USAF',c:'US',d:'7th BW. B-1B Lancer operations.'},
  {n:'Barksdale AFB',lat:32.50,lon:-93.66,t:'USAF',c:'US',d:'2nd BW. B-52H Stratofortress. AFGSC HQ.'},
  {n:'Minot AFB',lat:48.42,lon:-101.36,t:'USAF',c:'US',d:'5th BW B-52H + 91st MW Minuteman III ICBMs.'},
  {n:'F.E. Warren AFB',lat:41.15,lon:-104.87,t:'USAF',c:'US',d:'90th MW. Minuteman III ICBM wing. AFGSC.'},
  {n:'Malmstrom AFB',lat:47.51,lon:-111.18,t:'USAF',c:'US',d:'341st MW. Minuteman III ICBMs. 150 missiles.'},
  {n:'Ellsworth AFB',lat:44.15,lon:-103.10,t:'USAF',c:'US',d:'28th BW. B-1B Lancer. Future B-21 Raider base.'},
  {n:'Offutt AFB',lat:41.12,lon:-95.91,t:'USAF',c:'US',d:'USSTRATCOM HQ. 55th Wing. RC-135/E-6B Mercury. Nuclear C2.'},
  {n:'Tinker AFB',lat:35.42,lon:-97.39,t:'USAF',c:'US',d:'552nd ACW. E-3 AWACS. KC-135 depot. OC-ALC.'},
  {n:'Robins AFB',lat:32.64,lon:-83.59,t:'USAF',c:'US',d:'WR-ALC. E-8 JSTARS. Major depot maintenance. Warner Robins, GA.'},
  // ── US FIGHTER / TEST / TRAINING ──
  {n:'Tyndall AFB',lat:30.07,lon:-85.58,t:'USAF',c:'US',d:'325th FW. First operational F-35A training base.'},
  {n:'Eglin AFB',lat:30.47,lon:-86.53,t:'USAF',c:'US',d:'96th TW. Largest AF installation. Weapons testing.'},
  {n:'Edwards AFB',lat:34.91,lon:-117.88,t:'USAF',c:'US',d:'AFFTC. Flight test center. B-21 testing.'},
  {n:'Kunsan AB',lat:35.90,lon:126.62,t:'USAF',c:'KR',d:'8th Fighter Wing "Wolf Pack". F-16. Korea.'},
  {n:'Misawa AB',lat:40.70,lon:141.37,t:'USAF',c:'JP',d:'35th FW. F-16. Northern Japan. Pacific ISR hub.'},
  // ── US/NATO FORWARD (EUROPE) ──
  {n:'Moron AB',lat:37.18,lon:-5.62,t:'USAF',c:'ES',d:'USAF forward operating location in Spain. Tanker staging. AFRICOM ops.'},
  {n:'RAF Fairford',lat:51.68,lon:-1.79,t:'USAF',c:'GB',d:'B-52/B-2 forward deployment base. NATO bomber rotations. USAFE.'},
  // ── UK ──
  {n:'RAF Lossiemouth',lat:57.71,lon:-3.34,t:'RAF',c:'GB',d:'Typhoon FGR4. QRA North. P-8A Poseidon MPA. Scotland.'},
  // ── FRANCE ──
  {n:'BA 120 Cazaux',lat:44.53,lon:-1.13,t:'French AF',c:'FR',d:'Pilot training. Weapons school. Rafale/Mirage conversion.'},
  {n:'BA 125 Istres',lat:43.52,lon:4.93,t:'French AF',c:'FR',d:'Strategic air command. Rafale B nuclear strike. ASMP-A missiles.'},
  // ── RUSSIA STRATEGIC BOMBERS / ICBM ──
  {n:'Engels-2',lat:51.48,lon:46.20,t:'RU AF',c:'RU',d:'Russian strategic bomber base. Tu-160/Tu-95MS. Nuclear capable.'},
  {n:'Ukrainka',lat:51.17,lon:128.40,t:'RU AF',c:'RU',d:'326th Heavy Bomber Division. Tu-95MS. Far East strategic aviation.'},
  {n:'Shaykovka',lat:54.23,lon:34.18,t:'RU AF',c:'RU',d:'Tu-22M3 Backfire bombers. Long-range aviation. Kaluga Oblast.'},
  {n:'Savasleyka',lat:55.57,lon:43.23,t:'RU AF',c:'RU',d:'MiG-31 interceptor base. A-50 AWACS. Air defense fighters.'},
  {n:'Tiksi',lat:71.70,lon:128.90,t:'RU AF',c:'RU',d:'Arctic forward airfield. MiG-31 deployments. Northern Sea Route defense.'},
  {n:'Anadyr (Ugolny)',lat:64.74,lon:177.74,t:'RU AF',c:'RU',d:'Far northeast Russia. Tu-95 staging. Nuclear bomber dispersal.'},
  {n:'Shagol/Chelyabinsk',lat:55.30,lon:61.27,t:'RU AF',c:'RU',d:'MiG-31 interceptors. Kinzhal hypersonic missile carriers.'},
  {n:'Akhtubinsk',lat:48.32,lon:46.17,t:'RU AF',c:'RU',d:'Russian flight test center. New aircraft testing.'},
  // ── UKRAINE ──
  {n:'Poltava AB',lat:49.60,lon:34.55,t:'UA AF',c:'UA',d:'Ukrainian Air Force. Former Soviet bomber base. Potential NATO use.'},
  {n:'Starokonstantinov',lat:49.75,lon:27.20,t:'UA AF',c:'UA',d:'7th Tactical Aviation Brigade. Su-24M. Storm Shadow/SCALP strikes.'},
  // ── CHINA (H-6 / STRATEGIC) ──
  {n:'Dingxin AB',lat:40.30,lon:99.70,t:'PLAAF',c:'CN',d:'Chinese flight test center. J-20 stealth fighter testing.'},
  {n:'Hotan AB',lat:37.04,lon:79.87,t:'PLAAF',c:'CN',d:'Western China forward base. Near India border.'},
  {n:'Xi\'an (Yanliang)',lat:34.52,lon:109.12,t:'PLAAF',c:'CN',d:'CFTE flight test center. H-6K/N bomber production and testing.'},
  {n:'Nanjing (Lukou)',lat:31.74,lon:118.86,t:'PLAAF',c:'CN',d:'Eastern Theater H-6 bomber operations. Taiwan contingency.'},
];

function loadMilAirfields() {
  if (!V) return;
  milairfieldEnts.forEach(e => V.entities.remove(e));
  milairfieldEnts = [];
  MILAIRFIELDS.forEach(a => {
    if(isNaN(a.lat)||isNaN(a.lon)||!isFinite(a.lat)||!isFinite(a.lon))return;
    const branch = getBranch(a.t);
    const fColor = getFactionColor(a.t,a.c||'US');
    // Phase 8A: MIL-STD-2525C airfield symbol (SFAPMFA-----), fallback to hand-drawn
    const iconUri = (typeof makeMilSTD2525Icon==='function'?makeMilSTD2525Icon(a.t, a.c||'US', 'airfield', fColor, 46):null) || makeMilIcon(branch==='ground'?'airfield':branch, fColor);
    const cesFColor = Cesium.Color.fromCssColorString(fColor);
    const brLabel = _branchLabels[branch]||'MILITARY AIRFIELD';
    milairfieldEnts.push(V.entities.add({
      position:Cesium.Cartesian3.fromDegrees(a.lon,a.lat),
      billboard:{image:iconUri,width:42,height:42,scaleByDistance:new Cesium.NearFarScalar(5e4,1.4,1.5e7,0.65),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,15000000),verticalOrigin:Cesium.VerticalOrigin.CENTER,disableDepthTestDistance:5e6},
      label:{text:a.n,font:'bold 9px JetBrains Mono',fillColor:cesFColor,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.TOP,pixelOffset:new Cesium.Cartesian2(0,24),scaleByDistance:new Cesium.NearFarScalar(5e4,1,5e6,0),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,2500000),disableDepthTestDistance:5e6},
      description:`<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:400px;background:#0a0e14;padding:14px;border-radius:2px;border:1px solid ${fColor}22;color:#c8ccd6">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #1e2436">
          <div>
            <div style="color:${fColor};font-size:14px;font-weight:700;letter-spacing:1px">\u2708 ${esc(a.n)}</div>
            <div style="color:#4a5068;font-size:9px;margin-top:2px;letter-spacing:1.5px">${brLabel} \u2014 AIRFIELD</div>
          </div>
          <div style="padding:3px 8px;background:${fColor}14;border:1px solid ${fColor}33;border-radius:2px;font-size:8px;color:${fColor};letter-spacing:1px;font-weight:600">${a.t}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:10px;color:#7a8194">
          <tr><td style="padding:3px 0;width:35%"><b style="color:#4a5068">BRANCH</b></td><td style="color:#c8ccd6">${a.t}</td></tr>
          <tr><td style="padding:3px 0"><b style="color:#4a5068">POSITION</b></td><td style="color:#c8ccd6">${a.lat.toFixed(4)}\u00B0, ${a.lon.toFixed(4)}\u00B0</td></tr>
        </table>
        <div style="margin-top:8px;padding:8px;background:${fColor}08;border:1px solid ${fColor}14;border-radius:2px;font-size:10px;color:#8a8f9e;line-height:1.5">${esc(a.d)}</div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button onclick="if(parent.V)parent.flyToTarget(${a.lon},${a.lat},30000,1.2)" style="flex:1;padding:5px;background:#0a0e14;color:${fColor};border:1px solid ${fColor}33;border-radius:2px;cursor:pointer;font-family:monospace;font-size:9px;letter-spacing:.5px">\u25CE ZOOM</button>
          <button onclick="if(parent.V)parent.V.camera.flyTo({destination:parent.Cesium.Cartesian3.fromDegrees(${a.lon},${a.lat},500000),duration:1.2})" style="flex:1;padding:5px;background:#0a0e14;color:#7a8194;border:1px solid #1e2436;border-radius:2px;cursor:pointer;font-family:monospace;font-size:9px;letter-spacing:.5px">AREA VIEW</button>
        </div>
        <div style="margin-top:8px;font-size:7px;color:#1e2436;letter-spacing:1px;text-align:right">KITSUNE BDOC \u2014 MILINT</div>
      </div>`,
      show:layers.milairfields,
    }));
    // Tag entity for baseReadout panel (Phase 19c)
    const _aEnt = milairfieldEnts[milairfieldEnts.length-1];
    _aEnt._airfield = a;
    _aEnt._icao = '';  // airfields use name-based GDELT only; no dedicated METAR ICAO in this dataset
  });
  af('var(--gn)', `${MILAIRFIELDS.length} military airfields loaded`);
  EventLog.add('info', `Military airfields: ${MILAIRFIELDS.length} mapped`);
}
