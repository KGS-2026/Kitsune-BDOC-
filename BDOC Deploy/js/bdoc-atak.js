// bdoc-atak.js — ATAK Protocol Stack / Military Doctrine Layer
// Phase 21 (2026-05-20) — Kitsune Global Solutions LLC (SDVOSB, CAGE: 174S8)
// Full doctrine port: CoT XML, CASEVAC 9-line/ZMIST, FOXEYE, FOXHOLE, FOXPRINT
// Skip only: PRC-152 serial, Rover Ethernet (hardware-bound, web-impossible)
// Requires: window.V (CesiumJS), latLonToMGRS(), calcBearing(), esc(), svgToDataUri(),
//           battleEntities[], attachMeta(), af(), EventLog

'use strict';

// ═══════════════════════════════════════════════════════════════════
// CURSOR-ON-TARGET (CoT) XML — TAK ECOSYSTEM INTEROP
// MIL-STD-2525D type codes + CoT 2.0 schema
// ═══════════════════════════════════════════════════════════════════
const COT_TYPES = {
  // Affiliation + dimension (MIL-STD-2525D → CoT mapping)
  friendly_ground:   'a-f-G-U-C',
  friendly_helo:     'a-f-A-M-H-H',
  friendly_fixed:    'a-f-A-M-F-Q',
  friendly_ship:     'a-f-S-X-H',
  hostile_ground:    'a-h-G-U-C',
  hostile_vehicle:   'a-h-G-E-V-C',
  hostile_air:       'a-h-A-M-F',
  neutral_ground:    'a-n-G',
  unknown_ground:    'a-u-G',
  // Tactical
  casevac:           'b-c-c',
  medevac:           'b-c-c-m',
  waypoint:          'b-r-f-h-c',
  route:             'b-m-r',
  beacon_distress:   'b-t-f',
  observation_post:  'a-f-G-U-C-O',
  fob:               'a-f-G-I-B-B-F',
  lz:                'a-f-G-I-B-X-LZ',
  rally:             'a-f-G-U-C-R',
  phase_line:        'b-m-r-w-c-f',
  engagement_area:   'b-m-r-w-c-z',
  // Sensor
  sensor_point:      'b-m-p-s-p-n',
};

/**
 * Build a CoT 2.0 XML event string.
 * @param {Object} opts - { cotType, uid, lat, lon, hae, callsign, team, remarks, staleMs, extra }
 * @returns {string} CoT XML
 */
function buildCoT(opts) {
  const now = opts.time || new Date();
  const fmt = d => d.toISOString().replace(/\.\d{3}Z$/, '.00Z');
  const staleDate = new Date(now.getTime() + (opts.staleMs || 300000)); // 5 min default
  const uid = opts.uid || ('BDOC-' + Math.random().toString(36).slice(2,10).toUpperCase());
  const cotType = COT_TYPES[opts.cotType] || opts.cotType || 'a-u-G';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<event version="2.0" uid="${uid}" type="${cotType}"
  time="${fmt(now)}" start="${fmt(now)}" stale="${fmt(staleDate)}"
  how="h-g-i-g-o" access="Unclassified">
  <point lat="${(opts.lat||0).toFixed(7)}" lon="${(opts.lon||0).toFixed(7)}"
    hae="${(opts.hae||0).toFixed(1)}" ce="9999999.0" le="9999999.0"/>
  <detail>
    <contact callsign="${(opts.callsign||'BDOC').replace(/[<>&"']/g,'')}"/>
    ${opts.team ? `<__group name="${opts.team.replace(/[<>&"']/g,'')}" role="Team Member"/>` : ''}
    <uid Droid="${uid}"/>
    <remarks>${(opts.remarks||'').replace(/[<>&]/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}
    </remarks>
    ${opts.extra || ''}
    <_flow-tags_ KGS_BDOC="${new Date().toISOString()}"/>
  </detail>
</event>`;
}

/** Trigger browser download of a CoT XML file */
function downloadCoT(xml, filename) {
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'bdoc-cot.xml';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// CoT store: uid → xml (for on-demand export from entity popups)
window._cotStore = window._cotStore || new Map();
window._downloadCotXml = (uid) => {
  const xml = window._cotStore.get(uid);
  if (xml) downloadCoT(xml, `BDOC-CoT-${uid}.xml`);
  else if (typeof af === 'function') af('var(--yl)', 'CoT XML not found for this marker');
};


// ═══════════════════════════════════════════════════════════════════
// CASEVAC 9-LINE + ZMIST (FM 4-02 / JFIRE 2016 Appendix G)
// Full doctrine — verbatim field set per DoD standard
// ═══════════════════════════════════════════════════════════════════
function showCASEVACModal(lat, lon) {
  const mgrs  = (typeof latLonToMGRS === 'function') ? latLonToMGRS(lat, lon, 4) : lat.toFixed(4)+','+lon.toFixed(4);
  const ts    = new Date().toISOString().slice(0,19)+'Z';

  // Inject CSS once
  if (!document.getElementById('bdocAtakStyles')) {
    const sty = document.createElement('style');
    sty.id = 'bdocAtakStyles';
    sty.textContent = `
      #casevacModal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        width:580px;max-height:84vh;overflow-y:auto;
        background:#0a0e14;border:1px solid #ff444455;border-radius:4px;
        font-family:'JetBrains Mono',monospace;color:#c8ccd6;
        z-index:9999;padding:20px 22px;box-shadow:0 0 50px rgba(255,68,68,0.2);}
      #casevacModal *{box-sizing:border-box}
      .cv-sect{margin-bottom:14px}
      .cv-sect-hdr{font-size:8px;color:#ff4444;letter-spacing:2px;margin-bottom:8px;border-bottom:1px solid #ff444422;padding-bottom:4px}
      .cv-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
      .cv-row.full{grid-template-columns:1fr}
      .cv-field label{font-size:8px;color:#4a5068;display:block;margin-bottom:3px;letter-spacing:1px}
      .cv-field input,.cv-field select,.cv-field textarea{
        width:100%;background:#060911;border:1px solid #1e2a3a;
        color:#c8ccd6;font-family:inherit;font-size:10px;
        padding:5px 8px;border-radius:2px;outline:none}
      .cv-field input:focus,.cv-field select:focus{border-color:#ff444466}
      .cv-pax{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
      .cv-pax-item{display:flex;align-items:center;gap:5px;font-size:10px}
      .cv-pax-item input{width:44px;padding:4px;border-radius:2px}
      .zmist-card{background:#060911;border:1px solid #ff444422;padding:10px;
        border-radius:2px;margin-bottom:8px;display:flex;flex-direction:column;gap:7px}
      .zmist-card label{font-size:8px;color:#4a5068;display:block;margin-bottom:2px;letter-spacing:1px}
      .zmist-card input,.zmist-card select{
        width:100%;background:#0a0e14;border:1px solid #1e2a3a;
        color:#c8ccd6;font-family:inherit;font-size:10px;padding:4px 7px;border-radius:2px;outline:none}
      .zmist-card .cv-row2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      .cv-btn-primary{flex:1;background:#1a0a0a;border:2px solid #ff4444;color:#ff4444;
        font-family:inherit;font-size:11px;font-weight:700;padding:10px;cursor:pointer;
        border-radius:2px;letter-spacing:2px}
      .cv-btn-sec{background:#0a0e14;border:1px solid #4a5068;color:#4a5068;
        font-family:inherit;font-size:10px;padding:10px 14px;cursor:pointer;border-radius:2px}
      .cv-btn-add{background:#0a1a14;border:1px solid #3FB95044;color:#3FB950;
        font-size:9px;font-family:inherit;padding:4px 10px;cursor:pointer;border-radius:2px;margin-top:2px}
    `;
    document.head.appendChild(sty);
  }

  // Remove existing
  document.getElementById('casevacModal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'casevacModal';
  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #ff444433;padding-bottom:10px">
      <div style="color:#ff4444;font-size:14px;font-weight:700;letter-spacing:2px">⚕ CASEVAC 9-LINE REQUEST</div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:8px;color:#4a5068">${ts}</span>
        <button onclick="document.getElementById('casevacModal').remove()" style="background:none;border:none;color:#4a5068;cursor:pointer;font-size:18px;line-height:1">✕</button>
      </div>
    </div>

    <!-- LINE 1 -->
    <div class="cv-sect">
      <div class="cv-sect-hdr">LINE 1 — LOCATION OF PICK-UP SITE</div>
      <div class="cv-row full"><div class="cv-field">
        <label>MGRS / GRID (auto-populated)</label>
        <input id="cv1" type="text" value="${mgrs}" placeholder="MGRS or lat,lon"/>
      </div></div>
    </div>

    <!-- LINE 2 -->
    <div class="cv-sect">
      <div class="cv-sect-hdr">LINE 2 — RADIO FREQUENCY / CALLSIGN / SUFFIX</div>
      <div class="cv-row">
        <div class="cv-field"><label>FREQUENCY (MHz)</label><input id="cv2freq" type="text" placeholder="38.500.0"/></div>
        <div class="cv-field"><label>CALLSIGN / SUFFIX</label><input id="cv2call" type="text" placeholder="VIPER 6 / A"/></div>
      </div>
    </div>

    <!-- LINE 3 -->
    <div class="cv-sect">
      <div class="cv-sect-hdr">LINE 3 — NUMBER OF PATIENTS BY PRECEDENCE</div>
      <div class="cv-pax">
        <div class="cv-pax-item"><span style="color:#ff0000;font-weight:700">A</span> Urgent<input id="cv3a" type="number" min="0" value="0" class="cv-pax-num" style="width:44px;background:#060911;border:1px solid #1e2a3a;color:#c8ccd6;font-family:inherit;font-size:10px;padding:4px;border-radius:2px"/></div>
        <div class="cv-pax-item"><span style="color:#ff3300;font-weight:700">B</span> Urg-Surg<input id="cv3b" type="number" min="0" value="0" class="cv-pax-num" style="width:44px;background:#060911;border:1px solid #1e2a3a;color:#c8ccd6;font-family:inherit;font-size:10px;padding:4px;border-radius:2px"/></div>
        <div class="cv-pax-item"><span style="color:#ff6600;font-weight:700">C</span> Priority<input id="cv3c" type="number" min="0" value="0" class="cv-pax-num" style="width:44px;background:#060911;border:1px solid #1e2a3a;color:#c8ccd6;font-family:inherit;font-size:10px;padding:4px;border-radius:2px"/></div>
        <div class="cv-pax-item"><span style="color:#E8B339;font-weight:700">D</span> Routine<input id="cv3d" type="number" min="0" value="0" class="cv-pax-num" style="width:44px;background:#060911;border:1px solid #1e2a3a;color:#c8ccd6;font-family:inherit;font-size:10px;padding:4px;border-radius:2px"/></div>
        <div class="cv-pax-item">E Conv<input id="cv3e" type="number" min="0" value="0" class="cv-pax-num" style="width:44px;background:#060911;border:1px solid #1e2a3a;color:#c8ccd6;font-family:inherit;font-size:10px;padding:4px;border-radius:2px"/></div>
      </div>
    </div>

    <!-- LINES 4-9 -->
    <div class="cv-sect">
      <div class="cv-sect-hdr">LINES 4–9 — EQUIPMENT / TYPE / SECURITY / MARKING / STATUS / NBC</div>
      <div class="cv-row">
        <div class="cv-field"><label>LINE 4 — Special Equipment</label>
          <select id="cv4"><option value="A">A — None</option><option value="B">B — Hoist</option><option value="C">C — Extraction equipment</option><option value="D">D — Ventilator</option></select>
        </div>
        <div class="cv-field"><label>LINE 5 — Patient Type</label>
          <div style="display:flex;gap:10px;margin-top:6px">
            <label style="font-size:10px;color:#7a8194">L Litter<input id="cv5l" type="number" min="0" value="0" style="width:44px;margin-left:5px;background:#060911;border:1px solid #1e2a3a;color:#c8ccd6;font-family:inherit;font-size:10px;padding:4px;border-radius:2px"/></label>
            <label style="font-size:10px;color:#7a8194">A Ambul<input id="cv5a" type="number" min="0" value="0" style="width:44px;margin-left:5px;background:#060911;border:1px solid #1e2a3a;color:#c8ccd6;font-family:inherit;font-size:10px;padding:4px;border-radius:2px"/></label>
          </div>
        </div>
      </div>
      <div class="cv-row">
        <div class="cv-field"><label>LINE 6 — Security at PUP</label>
          <select id="cv6"><option value="N">N — No enemy troops</option><option value="P">P — Possible enemy</option><option value="E">E — Enemy in area</option><option value="X">X — Enemy, armed escort req.</option></select>
        </div>
        <div class="cv-field"><label>LINE 7 — Marking PUP Site</label>
          <select id="cv7"><option value="A">A — Panels</option><option value="B">B — Pyrotechnic</option><option value="C">C — Smoke signal</option><option value="D">D — None</option><option value="E">E — Other</option></select>
        </div>
      </div>
      <div class="cv-row">
        <div class="cv-field"><label>LINE 8 — Nationality / Status</label>
          <select id="cv8"><option value="A">A — US Military</option><option value="B">B — US Civilian</option><option value="C">C — Non-US Military</option><option value="D">D — Non-US Civilian</option><option value="E">E — Enemy POW</option></select>
        </div>
        <div class="cv-field"><label>LINE 9 — NBC Contamination</label>
          <select id="cv9"><option value="N">N — None</option><option value="B">B — Biological</option><option value="C">C — Chemical</option><option value="R">R — Radiological</option></select>
        </div>
      </div>
    </div>

    <!-- ZMIST -->
    <div class="cv-sect">
      <div class="cv-sect-hdr">ZMIST — CASUALTY REPORT (per patient)</div>
      <div id="zmistContainer">
        <div class="zmist-card">
          <div class="cv-row2">
            <div><label>Z — ZAP# / ID (Last4 + Blood Type)</label><input type="text" placeholder="e.g. 4821O+"/></div>
            <div><label>M — Mechanism of Injury</label><select><option>GSW — Gunshot wound</option><option>BLAST — IED/Blast</option><option>FRAG — Fragmentation</option><option>BURN — Thermal burn</option><option>FALL — Fall/blunt impact</option><option>VEHICULAR — Vehicle accident</option><option>CRUSH — Crush injury</option><option>ILLNESS — Medical illness</option><option>OTHER</option></select></div>
          </div>
          <div><label>I — Injuries Sustained</label><input type="text" placeholder="e.g. GSW right thigh, penetrating; no exit wound"/></div>
          <div><label>S — Signs &amp; Symptoms / Vitals</label><input type="text" placeholder="e.g. HR 110, BP 90/60, GCS 13, active hemorrhage controlled"/></div>
          <div><label>T — Treatments Given (TCCC)</label><input type="text" placeholder="e.g. TQ applied right thigh @1347, hemostatic gauze, 1L NS IV, airways clear"/></div>
        </div>
      </div>
      <button class="cv-btn-add" onclick="window._addZMIST()">+ ADD CASUALTY</button>
    </div>

    <!-- HLZ Brief -->
    <div class="cv-sect">
      <div class="cv-sect-hdr">HLZ BRIEF (Helicopter Landing Zone — optional)</div>
      <div class="cv-field"><label>GRID / ELEVATION / OBSTACLES / SURFACE / APPROACH</label>
        <input id="cvHlz" type="text" placeholder="e.g. 18SVK412917, 230m MSL, power lines N, firm soil, approach from S heading 180°"/>
      </div>
    </div>

    <!-- Additional remarks -->
    <div class="cv-sect">
      <div class="cv-field"><label>ADDITIONAL REMARKS</label>
        <input id="cvRemarks" type="text" placeholder="Enemy TIC, ongoing firefight, etc."/>
      </div>
    </div>

    <!-- Action buttons -->
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="cv-btn-primary" onclick="window._submitCASEVAC(${lat},${lon})">⚕ PLACE CASEVAC</button>
      <button class="cv-btn-sec" onclick="document.getElementById('casevacModal').remove()">CANCEL</button>
    </div>
  `;
  document.body.appendChild(modal);
}

// Add a ZMIST casualty card
window._addZMIST = function() {
  const c = document.getElementById('zmistContainer');
  if (!c) return;
  const d = document.createElement('div');
  d.className = 'zmist-card';
  d.innerHTML = `
    <div style="display:flex;justify-content:space-between">
      <span style="font-size:8px;color:#4a5068">CASUALTY #${c.children.length+1}</span>
      <button onclick="this.closest('.zmist-card').remove()" style="background:none;border:none;color:#4a5068;cursor:pointer;font-size:11px">— remove</button>
    </div>
    <div class="cv-row2">
      <div><label>Z — ZAP# / ID</label><input type="text" placeholder="Last4+BloodType"/></div>
      <div><label>M — Mechanism</label><select><option>GSW</option><option>BLAST</option><option>FRAG</option><option>BURN</option><option>FALL</option><option>VEHICULAR</option><option>CRUSH</option><option>ILLNESS</option><option>OTHER</option></select></div>
    </div>
    <div><label>I — Injuries</label><input type="text" placeholder="Injuries sustained"/></div>
    <div><label>S — Signs &amp; Symptoms</label><input type="text" placeholder="Vitals, consciousness level"/></div>
    <div><label>T — Treatment Given</label><input type="text" placeholder="TCCC treatments applied"/></div>
  `;
  c.appendChild(d);
};

// Submit CASEVAC and place on globe
window._submitCASEVAC = function(lat, lon) {
  if (!window.V) { alert('Globe not initialized'); return; }

  const g = id => document.getElementById(id);
  const gv = id => (g(id)?.value || '').trim();
  const gi = id => parseInt(g(id)?.value) || 0;

  const l1 = gv('cv1') || (typeof latLonToMGRS==='function'?latLonToMGRS(lat,lon,4):'');
  const l2 = `${gv('cv2freq')} / ${gv('cv2call')}`.replace(/\s*\/\s*$/,'');
  const urgent=gi('cv3a'), urgSurg=gi('cv3b'), priority=gi('cv3c'), routine=gi('cv3d'), conv=gi('cv3e');
  const l4=gv('cv4'), litter=gi('cv5l'), ambul=gi('cv5a');
  const l6=gv('cv6'), l7=gv('cv7'), l8=gv('cv8'), l9=gv('cv9');
  const hlz=gv('cvHlz'), remarks=gv('cvRemarks');
  const totalPax = urgent+urgSurg+priority+routine+conv;

  // Precedence → color
  const prec = urgent>0?'URGENT':urgSurg>0?'URGENT-SURG':priority>0?'PRIORITY':'ROUTINE';
  const colMap = {URGENT:'#ff0000','URGENT-SURG':'#ff2200',PRIORITY:'#ff6600',ROUTINE:'#E8B339'};
  const col = colMap[prec]||'#ff0000';

  // Collect ZMIST
  const zmistCards = Array.from(document.querySelectorAll('.zmist-card')).map(card => {
    const ins = card.querySelectorAll('input,select');
    return { z:ins[0]?.value||'', m:ins[1]?.value||'', i:ins[2]?.value||'', s:ins[3]?.value||'', t:ins[4]?.value||'' };
  });

  const ts  = new Date().toISOString().slice(0,19)+'Z';
  const mgrs = l1;
  const uid = 'BDOC-CASEVAC-'+Date.now();

  // 9-line formatted text
  const nineLine = [
    `1. ${l1}`,
    `2. ${l2||'N/A'}`,
    `3. A:${urgent} B:${urgSurg} C:${priority} D:${routine} E:${conv} (${totalPax} PAX)`,
    `4. ${l4}`, `5. L:${litter} A:${ambul}`,
    `6. ${l6}`, `7. ${l7}`, `8. ${l8}`, `9. ${l9}`
  ].join('\n');

  // SVG medical cross icon
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="15" fill="${col}" opacity="0.12"/>
    <circle cx="16" cy="16" r="15" fill="none" stroke="${col}" stroke-width="2.5"/>
    <rect x="13" y="5" width="6" height="22" rx="1" fill="${col}"/>
    <rect x="5" y="13" width="22" height="6" rx="1" fill="${col}"/>
  </svg>`;

  // CoT XML extra fields
  const zmistXml = zmistCards.filter(z=>z.z||z.i).map(z=>`
    <_zmist zap="${z.z.replace(/"/g,'')}" mechanism="${z.m.replace(/"/g,'')}" injuries="${z.i.replace(/"/g,'')}" signs="${z.s.replace(/"/g,'')}" treatment="${z.t.replace(/"/g,'')}"/>`).join('');

  const cotXml = buildCoT({
    cotType:'casevac', uid, lat, lon,
    callsign:`CASEVAC-${prec}`, staleMs:3600000, // stale 1hr
    remarks: nineLine,
    extra:`<_casevac line1="${l1}" freq="${gv('cv2freq')}" callsign="${gv('cv2call')}"
      precedence="${prec}" pax="${totalPax}" litter="${litter}" ambulatory="${ambul}"
      equipment="${l4}" security="${l6}" marking="${l7}" nationality="${l8}" nbc="${l9}"
      hlz="${hlz}" uid="${uid}"/>${zmistXml}`
  });
  window._cotStore.set(uid, cotXml);

  // Phase 24 (2026-05-23): esc() all user-entered ZMIST fields before injecting into
  // Cesium description HTML — description renders in an InfoBox iframe as raw HTML.
  const _e = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const zmistHtml = zmistCards.filter(z=>z.z||z.i).map((z,i)=>`
    <div style="background:#060911;border:1px solid ${col}22;padding:8px;border-radius:2px;margin-bottom:6px;font-size:9px">
      <b style="color:${col}">CASUALTY ${i+1} — ${_e(z.z)||'UNKNOWN'}</b><br>
      <span style="color:#4a5068">MECH:</span> ${_e(z.m)||'—'}<br>
      <span style="color:#4a5068">INJURY:</span> ${_e(z.i)||'—'}<br>
      <span style="color:#4a5068">SIGNS:</span> ${_e(z.s)||'—'}<br>
      <span style="color:#4a5068">TX:</span> ${_e(z.t)||'—'}
    </div>`).join('');

  const ent = V.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    billboard:{image:svgToDataUri(svg),width:32,height:32,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:5e6,scaleByDistance:new Cesium.NearFarScalar(1e4,1.3,5e6,0.4)},
    label:{text:`⚕ ${prec}\n${totalPax} PAX`,font:'bold 9px JetBrains Mono',fillColor:Cesium.Color.fromCssColorString(col),outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.TOP,pixelOffset:new Cesium.Cartesian2(0,18),heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,showBackground:true,backgroundColor:Cesium.Color.BLACK.withAlpha(0.88),backgroundPadding:new Cesium.Cartesian2(5,3),disableDepthTestDistance:5e6,scaleByDistance:new Cesium.NearFarScalar(1e4,1,4e6,0)},
    description:`<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:440px;background:#0a0e14;padding:16px;border:2px solid ${col}55;border-radius:3px;color:#c8ccd6">
      <div style="color:${col};font-size:13px;font-weight:700;letter-spacing:2px;margin-bottom:10px">⚕ CASEVAC 9-LINE — ${prec}</div>
      <pre style="font-family:inherit;font-size:9px;color:#a8b2c0;white-space:pre-wrap;line-height:1.7;margin:0 0 12px;background:#060911;padding:8px;border-radius:2px;border:1px solid ${col}22">${_e(nineLine)}</pre>
      ${zmistHtml}
      ${hlz?`<div style="margin-top:8px;font-size:9px;background:#060911;padding:6px 8px;border-radius:2px;border:1px solid ${col}22"><b style="color:#4a5068">HLZ:</b> ${_e(hlz)}</div>`:''}
      ${remarks?`<div style="margin-top:6px;font-size:9px;color:#7a8194"><b style="color:#4a5068">REMARKS:</b> ${_e(remarks)}</div>`:''}
      <div style="display:flex;gap:6px;margin-top:12px">
        <button onclick="window._downloadCotXml('${uid}')" style="flex:1;padding:6px 10px;background:#0a0e14;border:1px solid ${col}55;color:${col};font-family:inherit;font-size:9px;cursor:pointer;border-radius:2px;letter-spacing:1px">⬇ EXPORT CoT XML (TAK)</button>
      </div>
      <div style="margin-top:8px;font-size:7px;color:#1e2436;text-align:right;letter-spacing:1px">${ts} — KITSUNE BDOC / FM 4-02</div>
    </div>`,
    name:`CASEVAC ${prec} — ${ts}`
  });

  if (window.battleEntities) battleEntities.push(ent);
  if (typeof attachMeta==='function') attachMeta(ent,{label:`CASEVAC ${prec}`,comment:nineLine,type:'casevac',color:col});
  document.getElementById('casevacModal')?.remove();
  if (typeof af==='function') af('var(--rd)',`⚕ CASEVAC ${prec} (${totalPax} PAX) at ${mgrs}`);
  if (typeof EventLog!=='undefined') EventLog.add('warn',`CASEVAC ${prec} ${totalPax}PAX at ${lat.toFixed(4)},${lon.toFixed(4)}`);
};


// ═══════════════════════════════════════════════════════════════════
// FOXEYE — Live R&B Tracking Tool (KGS BDOC)
// Track and intercept: FROM point → TO point, ETA + color coding
// ═══════════════════════════════════════════════════════════════════
let _bloodhound = null; // {fromLat,fromLon,toLat,toLon,speed_mps,lineEnt,lblEnt}

function startBloodhound(fromLat, fromLon, fromLabel) {
  stopBloodhound();
  _bloodhound = { fromLat, fromLon, fromLabel:fromLabel||'FROM', toLat:null, toLon:null, step:'awaiting_to' };
  if (typeof af==='function') af('var(--yl)','🐕 BLOODHOUND active — right-click target to set TO point. ESC to cancel.');
  const s = document.getElementById('bp-status');
  if (s) s.textContent = 'BLOODHOUND: Right-click the target location or marker.';
  // Expose step to context menu handler
  window._bloodhoundPending = true;
}

function setBloodhoundTo(toLat, toLon, toLabel) {
  if (!_bloodhound) return;
  _bloodhound.toLat = toLat; _bloodhound.toLon = toLon; _bloodhound.toLabel = toLabel||'TARGET';
  window._bloodhoundPending = false;
  // Prompt for speed
  const sp = prompt('BLOODHOUND: Tracker speed (km/h) for ETA?\nLeave blank to skip ETA.','');
  _bloodhound.speed_mps = (sp&&sp.trim()) ? parseFloat(sp)/3.6 : null;
  _refreshBloodhound();
  // Auto-refresh every 30s if speed given
  if (_bloodhound.speed_mps) {
    _bloodhound._interval = setInterval(_refreshBloodhound, 30000);
  }
}

function _refreshBloodhound() {
  if (!_bloodhound || _bloodhound.toLat===null || !window.V) return;
  const bh = _bloodhound;
  // Remove old entities
  ['lineEnt','lblEnt','fromEnt','toEnt'].forEach(k=>{
    if (bh[k]&&V.entities.contains(bh[k])) try{V.entities.remove(bh[k])}catch(_){}
  });

  const brg = (typeof calcBearing==='function') ? calcBearing(bh.fromLat,bh.fromLon,bh.toLat,bh.toLon) : 0;
  const R = 6371000;
  const dLat=(bh.toLat-bh.fromLat)*Math.PI/180, dLon=(bh.toLon-bh.fromLon)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(bh.fromLat*Math.PI/180)*Math.cos(bh.toLat*Math.PI/180)*Math.sin(dLon/2)**2;
  const distM = R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  const distKm = (distM/1000).toFixed(2);
  const distNm = (distM/1852).toFixed(1);

  let etaTxt='', etaMin=null;
  let lineCol = Cesium.Color.fromCssColorString('#00ff88');
  if (bh.speed_mps&&bh.speed_mps>0) {
    etaMin = distM/bh.speed_mps/60;
    const h=Math.floor(etaMin/60), m=Math.floor(etaMin%60);
    etaTxt = `\nETA ${h>0?h+'h ':''}`+m+'min';
    // ATAK ETA color scheme: >6min=green, 3-6=orange, 1-3=yellow, <1=red
    if      (etaMin<=1)  lineCol=Cesium.Color.RED;
    else if (etaMin<=3)  lineCol=Cesium.Color.YELLOW;
    else if (etaMin<=6)  lineCol=Cesium.Color.fromCssColorString('#ff8800');
    // else stays green
  }

  bh.lineEnt = V.entities.add({
    polyline:{positions:Cesium.Cartesian3.fromDegreesArray([bh.fromLon,bh.fromLat,bh.toLon,bh.toLat]),
      width:2.5,
      material:new Cesium.PolylineDashMaterialProperty({color:lineCol.withAlpha(0.85),dashLength:16}),
      clampToGround:true}
  });
  bh.lblEnt = V.entities.add({
    position:Cesium.Cartesian3.fromDegrees((bh.fromLon+bh.toLon)/2,(bh.fromLat+bh.toLat)/2),
    label:{text:`🐕 ${distKm}km | ${distNm}nm | ${brg.toFixed(1)}°${etaTxt}`,
      font:'bold 10px JetBrains Mono',fillColor:lineCol,outlineColor:Cesium.Color.BLACK,outlineWidth:3,
      style:Cesium.LabelStyle.FILL_AND_OUTLINE,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,
      showBackground:true,backgroundColor:Cesium.Color.BLACK.withAlpha(0.88),
      backgroundPadding:new Cesium.Cartesian2(6,3),disableDepthTestDistance:5e6}
  });
  // From/To markers
  bh.fromEnt = V.entities.add({position:Cesium.Cartesian3.fromDegrees(bh.fromLon,bh.fromLat),
    point:{pixelSize:8,color:Cesium.Color.fromCssColorString('#00ff88'),outlineColor:Cesium.Color.BLACK,outlineWidth:2,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:5e6},
    label:{text:bh.fromLabel||'FROM',font:'8px JetBrains Mono',fillColor:Cesium.Color.fromCssColorString('#00ff88'),outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,12),heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:5e6}});
  bh.toEnt = V.entities.add({position:Cesium.Cartesian3.fromDegrees(bh.toLon,bh.toLat),
    point:{pixelSize:10,color:lineCol,outlineColor:Cesium.Color.WHITE,outlineWidth:2,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:5e6},
    label:{text:bh.toLabel||'TARGET',font:'bold 8px JetBrains Mono',fillColor:lineCol,outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,12),heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:5e6}});

  if (typeof af==='function') af('var(--bl)',`🦊 FOXEYE: ${distKm}km | ${brg.toFixed(1)}°${etaTxt}`);
}

function stopBloodhound() {
  if (!_bloodhound) return;
  const bh=_bloodhound;
  if (bh._interval) clearInterval(bh._interval);
  ['lineEnt','lblEnt','fromEnt','toEnt'].forEach(k=>{
    if (bh[k]&&window.V&&V.entities.contains(bh[k])) try{V.entities.remove(bh[k])}catch(_){}
  });
  _bloodhound=null;
  window._bloodhoundPending=false;
  if (typeof af==='function') af('var(--t3)','FOXEYE cleared');
}


// ═══════════════════════════════════════════════════════════════════
// FOXPRINT — Breadcrumb trails for live-tracked entities
// Records positions for ADS-B aircraft, AIS ships, Meshtastic nodes
// ═══════════════════════════════════════════════════════════════════
const _trackHistory = new Map(); // entityId → { positions:[], polyEnt, maxPts, color }
const TRACK_MAX_POINTS = 200;
const TRACK_MIN_DIST_M = 200; // only record if moved >200m

function recordTrackPosition(entityId, lat, lon, color) {
  if (!window.V || !window.layers?.trackHistory) return;
  let track = _trackHistory.get(entityId);
  if (!track) {
    track = { positions:[], polyEnt:null, maxPts:TRACK_MAX_POINTS, color:color||'#00aaff', entityId };
    _trackHistory.set(entityId, track);
  }
  // Check minimum distance
  if (track.positions.length >= 2) {
    // positions array is [lon0, lat0, lon1, lat1, ...] — index -2 = last lon, -1 = last lat
    const lastLon=track.positions[track.positions.length-2];
    const lastLat=track.positions[track.positions.length-1];
    const R=6371000, dLat=(lat-lastLat)*Math.PI/180, dLon=(lon-lastLon)*Math.PI/180;
    const a=Math.sin(dLat/2)**2+Math.cos(lastLat*Math.PI/180)*Math.cos(lat*Math.PI/180)*Math.sin(dLon/2)**2;
    const dist=R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
    if (dist < TRACK_MIN_DIST_M) return; // Too close — skip
  }
  // Append position
  track.positions.push(lon, lat); // Cesium uses lon,lat order in DegreesArray
  // Trim to max
  if (track.positions.length/2 > track.maxPts) {
    track.positions.splice(0, 2); // Remove oldest point
  }
  // Redraw polyline
  if (track.polyEnt && V.entities.contains(track.polyEnt)) {
    try { V.entities.remove(track.polyEnt); } catch(_) {}
  }
  if (track.positions.length >= 4) {
    track.polyEnt = V.entities.add({
      polyline:{
        positions:Cesium.Cartesian3.fromDegreesArray(track.positions),
        width:1.5,
        material:Cesium.Color.fromCssColorString(track.color).withAlpha(0.45),
        clampToGround:true
      }
    });
  }
}

function clearTrackHistory(entityId) {
  const track = _trackHistory.get(entityId);
  if (!track) return;
  if (track.polyEnt&&window.V&&V.entities.contains(track.polyEnt)) try{V.entities.remove(track.polyEnt)}catch(_){}
  _trackHistory.delete(entityId);
}

function clearAllTrackHistory() {
  _trackHistory.forEach((track,id) => clearTrackHistory(id));
  if (typeof af==='function') af('var(--t3)','Track history cleared');
}


// ═══════════════════════════════════════════════════════════════════
// FOXHOLE — Entry/Exit alert zones
// ═══════════════════════════════════════════════════════════════════
const _geofences = new Map(); // id → geofence object

function createGeofence(lonLatArray, label, color, onEntry, onExit) {
  if (!window.V || lonLatArray.length < 6) return null;
  const id = 'GF-' + Date.now();
  const col = color || '#00ffcc';
  const clr = Cesium.Color.fromCssColorString(col);
  const positions = Cesium.Cartesian3.fromDegreesArray(lonLatArray);

  const ent = V.entities.add({
    polygon:{hierarchy:new Cesium.PolygonHierarchy(positions),material:clr.withAlpha(0.07),outline:true,outlineColor:clr.withAlpha(0.65),outlineWidth:2,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND},
    label:{text:`⬡ FENCE\n${label}`,font:'bold 9px JetBrains Mono',fillColor:clr,outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,showBackground:true,backgroundColor:Cesium.Color.BLACK.withAlpha(0.75),backgroundPadding:new Cesium.Cartesian2(4,2),disableDepthTestDistance:5e6},
    position:Cesium.Cartesian3.fromDegrees(lonLatArray[0],lonLatArray[1]),
    name:'GEO FENCE: '+label
  });

  // Ray-cast point-in-polygon (2D, lon=x, lat=y)
  function pip(lat, lon) {
    let inside=false;
    const n=lonLatArray.length/2;
    for(let i=0,j=n-1;i<n;j=i++){
      const xi=lonLatArray[i*2],yi=lonLatArray[i*2+1];
      const xj=lonLatArray[j*2],yj=lonLatArray[j*2+1];
      if(((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/(yj-yi)+xi)) inside=!inside;
    }
    return inside;
  }

  const gf={id,lonLatArray,label,color:col,ent,active:true,inside:new Set(),pip,
    onEntry:onEntry||null, onExit:onExit||null};
  _geofences.set(id, gf);

  if (window.battleEntities) battleEntities.push(ent);
  if (typeof af==='function') af('var(--bl)',`⬡ Geofence "${label}" active`);
  return id;
}

function removeGeofence(id) {
  const gf=_geofences.get(id);
  if(!gf)return;
  if(gf.ent&&window.V&&V.entities.contains(gf.ent))try{V.entities.remove(gf.ent)}catch(_){}
  _geofences.delete(id);
}

// Geofence check — called from polling intervals; pass array of {id,name,lat,lon}
function checkGeofences(trackedEntities) {
  if(_geofences.size===0)return;
  _geofences.forEach(gf=>{
    if(!gf.active)return;
    (trackedEntities||[]).forEach(t=>{
      const wasInside=gf.inside.has(t.id);
      const isInside=gf.pip(t.lat,t.lon);
      if(isInside&&!wasInside){
        gf.inside.add(t.id);
        const msg=`⬡ BREACH ENTRY: "${t.name||t.id}" → FENCE "${gf.label}"`;
        if(typeof af==='function') af('var(--rd)',msg);
        if(typeof EventLog!=='undefined') EventLog.add('warn',msg);
        if(gf.onEntry) gf.onEntry(t,gf);
      } else if(!isInside&&wasInside){
        gf.inside.delete(t.id);
        const msg=`⬡ FENCE EXIT: "${t.name||t.id}" ← FENCE "${gf.label}"`;
        if(typeof af==='function') af('var(--yl)',msg);
        if(typeof EventLog!=='undefined') EventLog.add('info',msg);
        if(gf.onExit) gf.onExit(t,gf);
      }
    });
  });
}


// ═══════════════════════════════════════════════════════════════════
// GLOBAL API — Exposed on window.BDOC_ATAK
// ═══════════════════════════════════════════════════════════════════
window.BDOC_ATAK = {
  // CoT XML
  buildCoT, downloadCoT, COT_TYPES,
  // CASEVAC
  showCASEVACModal,
  // Bloodhound
  startBloodhound, setBloodhoundTo, stopBloodhound,
  // FOXPRINT
  recordTrackPosition, clearTrackHistory, clearAllTrackHistory,
  // FOXHOLE
  createGeofence, removeGeofence, checkGeofences,
  // Geofence store (for external access)
  get geofences() { return _geofences; },
  get bloodhound() { return _bloodhound; }
};

console.log('[BDOC-ATAK] Module loaded — CoT/CASEVAC/GhostTrail/GeoFence/TrackHistory ready');
