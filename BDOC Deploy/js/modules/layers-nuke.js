// ============================================================
// BDOC PHASE 2 MODULE: layers-nuke.js
// Nuclear test site layer — NUKESITES const + loadNukeSites()
// Extracted from index.html lines 9613-9675 (Turn 6a, 2026-04-22)
// Depends on (defined in main inline script):
//   V (Cesium.Viewer), Cesium, layers (object), makeMilIcon(), esc(), af()
//   EventLog (defined in js/telemetry.js)
// All references resolve lazily inside loadNukeSites() — safe load order.
// `var nukeEnts` (was `let`) for explicit window-binding consistency with other layer arrays.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
var nukeEnts = [];
var NUKESITES = [
  {n:'Nevada Test Site (NNSS)',lat:37.05,lon:-116.05,c:'US',tests:928,d:'1,021 tests (1951-1992). 828 underground. Now NNSA Stockpile Stewardship.'},
  {n:'Semipalatinsk',lat:50.07,lon:78.43,c:'KZ',tests:456,d:'Soviet primary test site (1949-1989). 456 tests. Massive contamination.'},
  {n:'Marshall Islands',lat:11.60,lon:165.38,c:'MH',tests:67,d:'Bikini/Enewetak Atolls. 67 tests including Castle Bravo (15MT).'},
  {n:'Novaya Zemlya',lat:73.40,lon:55.00,c:'RU',tests:224,d:'Tsar Bomba (50MT) tested here. 224 tests. Arctic archipelago.'},
  {n:'Mururoa Atoll',lat:-21.83,lon:-138.92,c:'FR',tests:181,d:'French Pacific test site (1966-1996). 181 tests.'},
  {n:'Lop Nur',lat:41.55,lon:88.70,c:'CN',tests:45,d:'Chinese test site. 45 tests (1964-1996). First Chinese bomb 1964.'},
  {n:'Pokhran',lat:27.10,lon:71.75,c:'IN',tests:6,d:'Indian tests. Smiling Buddha (1974), Shakti (1998). 6 total tests.'},
  {n:'Ras Koh Hills',lat:28.77,lon:64.95,c:'PK',tests:6,d:'Pakistani tests (1998). Response to Indian Shakti tests. 6 detonations.'},
  {n:'Punggye-ri',lat:41.28,lon:129.09,c:'KP',tests:6,d:'DPRK test site. 6 tests (2006-2017). Partially collapsed 2017. Monitoring ongoing.'},
  {n:'Reggane',lat:26.32,lon:0.07,c:'DZ',tests:4,d:'French Sahara tests (1960-1961). 4 atmospheric tests.'},
  {n:'Maralinga',lat:-30.16,lon:131.61,c:'AU',tests:7,d:'British tests in Australia (1956-1963). 7 major tests.'},
  {n:'Monte Bello Islands',lat:-20.41,lon:115.55,c:'AU',tests:3,d:'British tests (1952-1956). Operation Hurricane \u2014 first British atomic test.'},
];

function loadNukeSites() {
  if (!V) return;
  nukeEnts.forEach(e => V.entities.remove(e));
  nukeEnts = [];
  const NUKE_COLOR='#E8B339';
  const iconUri = makeMilIcon('nuclear', NUKE_COLOR);
  NUKESITES.forEach(s => {
    if(isNaN(s.lat)||isNaN(s.lon)||!isFinite(s.lat)||!isFinite(s.lon)||isNaN(s.tests))return;
    nukeEnts.push(V.entities.add({
      position:Cesium.Cartesian3.fromDegrees(s.lon,s.lat),
      billboard:{image:iconUri,width:34,height:34,scaleByDistance:new Cesium.NearFarScalar(1e5,1.5,1.2e7,0.45),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,8000000),verticalOrigin:Cesium.VerticalOrigin.CENTER,disableDepthTestDistance:5e6},
      label:{text:'\u2622 '+s.n,font:'bold 10px JetBrains Mono',fillColor:Cesium.Color.YELLOW,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.TOP,pixelOffset:new Cesium.Cartesian2(0,18),scaleByDistance:new Cesium.NearFarScalar(1e5,1,8e6,0.2),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,5000000),disableDepthTestDistance:5e6},
      description:`<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:400px;background:#0a0e14;padding:14px;border-radius:2px;border:1px solid #E8B33922;color:#c8ccd6">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #1e2436">
          <div>
            <div style="color:#E8B339;font-size:14px;font-weight:700;letter-spacing:1px">\u2622 ${esc(s.n)}</div>
            <div style="color:#4a5068;font-size:9px;margin-top:2px;letter-spacing:1.5px">NUCLEAR TEST SITE</div>
          </div>
          <div style="text-align:right">
            <div style="color:#E8B339;font-size:20px;font-weight:700">${s.tests}</div>
            <div style="color:#4a5068;font-size:8px">TESTS</div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:10px;color:#7a8194">
          <tr><td style="padding:3px 0;width:35%"><b style="color:#4a5068">COUNTRY</b></td><td style="color:#c8ccd6">${s.c}</td></tr>
          <tr><td style="padding:3px 0"><b style="color:#4a5068">POSITION</b></td><td style="color:#c8ccd6">${s.lat.toFixed(4)}\u00B0, ${s.lon.toFixed(4)}\u00B0</td></tr>
        </table>
        <div style="margin-top:8px;padding:8px;background:rgba(255,204,0,0.03);border:1px solid rgba(255,204,0,0.08);border-radius:2px;font-size:10px;color:#8a8f9e;line-height:1.5">${esc(s.d)}</div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button onclick="if(parent.V)parent.flyToTarget(${s.lon},${s.lat},50000,1.2)" style="flex:1;padding:5px;background:#0a0e14;color:#E8B339;border:1px solid rgba(255,204,0,0.2);border-radius:2px;cursor:pointer;font-family:monospace;font-size:9px;letter-spacing:.5px">\u25CE ZOOM</button>
          <button onclick="if(parent.V)parent.V.camera.flyTo({destination:parent.Cesium.Cartesian3.fromDegrees(${s.lon},${s.lat},500000),duration:1.2})" style="flex:1;padding:5px;background:#0a0e14;color:#7a8194;border:1px solid #1e2436;border-radius:2px;cursor:pointer;font-family:monospace;font-size:9px;letter-spacing:.5px">AREA VIEW</button>
        </div>
        <div style="margin-top:8px;font-size:7px;color:#1e2436;letter-spacing:1px;text-align:right">KITSUNE BDOC \u2014 NUCLEAR INTEL</div>
      </div>`,
      show:layers.nukes,
    }));
    nukeEnts.push(V.entities.add({
      position:Cesium.Cartesian3.fromDegrees(s.lon,s.lat),
      ellipse:{semiMajorAxis:Math.min(s.tests*200,50000),semiMinorAxis:Math.min(s.tests*200,50000),material:Cesium.Color.YELLOW.withAlpha(0.05),outline:true,outlineColor:Cesium.Color.YELLOW.withAlpha(0.15),height:0},
      show:layers.nukes,
    }));
  });
  af('var(--yl)', `${NUKESITES.length} nuclear test sites loaded \u2014 ${NUKESITES.reduce((a,s)=>a+s.tests,0)} total tests`);
  EventLog.add('info', `Nuclear sites: ${NUKESITES.length} locations, ${NUKESITES.reduce((a,s)=>a+s.tests,0)} total detonations`);
}
