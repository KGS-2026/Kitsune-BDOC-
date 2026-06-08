// ============================================================
// BDOC PHASE 2 MODULE: layers-conflict.js
// Conflict events + Territory control overlay
// Extracted from index.html lines 2655-2735 + 2919-3059 (Turn 9, 2026-04-22)
// Depends on (resolved lazily at call time):
//   V (Cesium.Viewer), Cesium, layers, Health, esc, af, us
//   confEnts, territoryEnts (declared in shell at index.html line 1442 — shared via Script lexical env)
//   simplifyCoords used only inside loadTerritoryControl
//   _territoryDataSource referenced from togLayer (index.html line 2137) — kept on Script env
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================

// Local copy — also defined in layers-air.js; duplicated here so conflict layer works independently
function makeConflictSVG(color,pulseColor){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
    <circle cx="10" cy="10" r="8" fill="${color}" opacity="0.3" stroke="${pulseColor||color}" stroke-width="1.5"/>
    <circle cx="10" cy="10" r="4" fill="${color}" opacity="0.9"/>
    <line x1="10" y1="2" x2="10" y2="6" stroke="${color}" stroke-width="1.5"/>
    <line x1="10" y1="14" x2="10" y2="18" stroke="${color}" stroke-width="1.5"/>
    <line x1="2" y1="10" x2="6" y2="10" stroke="${color}" stroke-width="1.5"/>
    <line x1="14" y1="10" x2="18" y2="10" stroke="${color}" stroke-width="1.5"/>
  </svg>`;
  return svgToDataUri(svg);
}

// ═══ CONFLICTS ═══
function loadConflicts(){
  if(!V)return;
  Health.start('conflicts');
  const events=[
    {name:'South Pars Gas Plant Strike',lat:27.50,lon:52.60,lv:5,type:'strike',date:'2026-03-18',desc:'Israeli Air Force struck the South Pars (Iranian) natural gas processing plant. The natural gas field is the largest in the world. Additional Iranian energy infrastructure was hit in Asaluyeh.',news:'https://news.google.com/search?q=south+pars+strike+2026'},
    {name:'Isfahan \u2014 Nuclear Site',lat:32.63,lon:51.68,lv:5,type:'strike',date:'2026-05',desc:'Natanz enrichment facility nearby. Repeated Israeli strikes reported. Key nuclear infrastructure target.',news:'https://news.google.com/search?q=natanz+strike+2026'},
    {name:'Tehran \u2014 IRGC HQ',lat:35.70,lon:51.42,lv:5,type:'military',date:'2026-05',desc:'IRGC command and control. Aerospace Force HQ. Ballistic missile coordination center.',news:'https://news.google.com/search?q=iran+irgc+2026'},
    {name:'Bushehr Nuclear Plant',lat:28.83,lon:50.89,lv:4,type:'nuclear',date:'2026-05',desc:'Operational nuclear power plant. Russian-built. Potential strike target.',news:'https://news.google.com/search?q=bushehr+nuclear+2026'},
    {name:'Bandar Abbas Naval Base',lat:27.15,lon:56.28,lv:5,type:'naval',date:'2026-05',desc:'IRIN main fleet base. Fast attack craft. Anti-ship missile batteries. Controls Hormuz approach.',news:'https://news.google.com/search?q=bandar+abbas+naval+2026'},
    {name:'Kharg Island Oil Terminal',lat:29.23,lon:50.32,lv:4,type:'infrastructure',date:'2026-05',desc:'90% of Iranian oil exports. Critical economic target.',news:'https://news.google.com/search?q=kharg+island+oil+2026'},
    {name:'Qom \u2014 Assembly of Experts',lat:34.64,lon:50.88,lv:5,type:'strike',date:'2026-05',desc:'Religious and political leadership site. IAF strikes reported on Assembly of Experts gathering.',news:'https://news.google.com/search?q=qom+strike+2026'},
    {name:'Chabahar Port',lat:25.30,lon:60.64,lv:3,type:'naval',date:'2026-05',desc:'Strategic deep-water port on Gulf of Oman developed by India ($340M investment). Bypasses Strait of Hormuz — alternate trade route to Afghanistan and Central Asia. Iranian Navy presence. US exempted Chabahar from Iran sanctions due to strategic value. IRIN 4th Naval District. Potential naval escalation point if Hormuz conflict spreads.',news:'https://news.google.com/search?q=chabahar+port+iran+2026'},
    {name:'Strait of Hormuz',lat:26.57,lon:56.25,lv:5,type:'chokepoint',date:'2026-05',desc:'20% of global oil transit. IRGC fast boats. Mine threat. USN carrier group presence.',news:'https://news.google.com/search?q=strait+hormuz+2026'},
    {name:'F-35 Emergency Landing',lat:27.00,lon:56.80,lv:5,type:'strike',date:'2026-03-19',desc:'USAF F-35 makes emergency landing after allegedly being hit by Iranian fire near Strait of Hormuz.',news:'https://news.google.com/search?q=f-35+emergency+landing+iran+2026'},
    {name:'Gaza City',lat:31.50,lon:34.47,lv:5,type:'strike',date:'2026-05',desc:'Active IDF ground operations. Urban warfare. Massive destruction.',news:'https://news.google.com/search?q=gaza+2026'},
    {name:'Rafah Crossing',lat:31.25,lon:34.25,lv:5,type:'ground',date:'2026-05',desc:'Border crossing point. IDF operations in area. Humanitarian corridor disputes.',news:'https://news.google.com/search?q=rafah+crossing+2026'},
    {name:'Khan Younis',lat:31.35,lon:34.30,lv:5,type:'ground',date:'2026-05',desc:'Southern Gaza — major IDF ground operations zone. Heavy urban combat with Hamas Rafah Brigade remnants. Extensive tunnel network beneath the city. 400,000+ displaced civilians. Hospital infrastructure destroyed. IDF 98th Division and Givati Brigade conducting clearing operations. Second-largest city in Gaza.',news:'https://news.google.com/search?q=khan+younis+gaza+2026'},
    {name:'Bakhmut / Chasiv Yar',lat:48.60,lon:38.00,lv:5,type:'ground',date:'2026-05',desc:'Grinding positional warfare. Russian assault operations. Ukrainian defense in depth.',news:'https://news.google.com/search?q=bakhmut+chasiv+yar+2026'},
    {name:'Avdiivka Front',lat:48.14,lon:37.75,lv:5,type:'ground',date:'2026-05',desc:'Russian forces advanced after Ukrainian withdrawal. Active artillery exchanges.',news:'https://news.google.com/search?q=avdiivka+2026'},
    {name:'Zaporizhzhia NPP',lat:47.51,lon:34.59,lv:4,type:'nuclear',date:'2026-05',desc:'Largest nuclear plant in Europe. Russian-occupied. IAEA monitoring. Shelling risk.',news:'https://news.google.com/search?q=zaporizhzhia+nuclear+2026'},
    {name:'Sevastopol Naval Base',lat:44.62,lon:33.53,lv:4,type:'naval',date:'2026-05',desc:'Russian Black Sea Fleet HQ. Ukrainian USV/missile attacks degrading fleet capability.',news:'https://news.google.com/search?q=sevastopol+naval+2026'},
    {name:'Kursk \u2014 Ukrainian Incursion',lat:51.73,lon:36.19,lv:4,type:'ground',date:'2026-05',desc:'Ukrainian forces crossed into Russian territory. Counter-offensive operations.',news:'https://news.google.com/search?q=kursk+ukraine+incursion+2026'},
    {name:'Hodeidah Port \u2014 Yemen',lat:14.80,lon:42.95,lv:4,type:'strike',date:'2026-05',desc:'Houthi naval base. US/UK strikes on missile and drone launch sites.',news:'https://news.google.com/search?q=hodeidah+strike+2026'},
    {name:'Bab el-Mandeb Strait',lat:12.58,lon:43.33,lv:4,type:'chokepoint',date:'2026-05',desc:'Houthi anti-ship attacks. Commercial shipping rerouting. Naval coalition patrols.',news:'https://news.google.com/search?q=bab+el+mandeb+2026'},
    {name:'Khartoum',lat:15.59,lon:32.53,lv:4,type:'ground',date:'2026-05',desc:'Urban warfare between SAF and RSF. Civilian mass casualties. City largely destroyed.',news:'https://news.google.com/search?q=khartoum+sudan+2026'},
    {name:'El Fasher \u2014 Darfur',lat:13.63,lon:25.35,lv:4,type:'ground',date:'2026-05',desc:'RSF siege. Massive humanitarian crisis. Genocide warnings from UN.',news:'https://news.google.com/search?q=el+fasher+darfur+2026'},
    {name:'Myitkyina \u2014 Kachin',lat:25.38,lon:97.40,lv:3,type:'ground',date:'2026',desc:'Kachin Independence Army (KIA) vs Myanmar military junta (Tatmadaw). KIA controls large swathes of Kachin State — jade mining revenue funds resistance. Part of broader Three Brotherhood Alliance offensive that has shattered junta control across northern Myanmar. Tatmadaw losing territory at fastest rate since coup. Chinese border influence zone.',news:'https://news.google.com/search?q=kachin+myanmar+resistance+2026'},
    {name:'Naypyidaw',lat:19.76,lon:96.07,lv:3,type:'military',date:'2026',desc:'Myanmar military junta capital. Purpose-built administrative city (pop. ~1M). Resistance forces from multiple ethnic armies and People\'s Defense Forces (PDF) closing in from north, east, and west. Junta controls shrinking territory — estimated 40-50% of Myanmar now held by resistance. SAC (State Administration Council) increasingly isolated. Airstrikes on civilians in resistance-held areas.',news:'https://news.google.com/search?q=myanmar+resistance+naypyidaw+2026'},
    {name:'Kinmen Islands',lat:24.45,lon:118.38,lv:2,type:'military',date:'2026',desc:'Taiwanese-held island chain just 2km from Xiamen, China. 6,000 ROC troops garrisoned. PLA conducts regular military exercises in surrounding waters. Would be first target in any Taiwan invasion scenario. Tourist destination with Cold War-era tunnels and artillery positions still maintained. China Coast Guard increased patrols — gray zone pressure campaign.',news:'https://news.google.com/search?q=kinmen+taiwan+china+2026'},
    {name:'Scarborough Shoal',lat:15.13,lon:117.76,lv:3,type:'naval',date:'2026',desc:'Philippines-China standoff. Coast guard water cannon incidents. US FON ops.',news:'https://news.google.com/search?q=scarborough+shoal+2026'},
    {name:'Mischief Reef',lat:9.90,lon:115.53,lv:2,type:'military',date:'2026',desc:'Chinese artificial island constructed 2014-2016 on a submerged reef in the Spratly Islands, 135nm inside the Philippine EEZ. Features a 2,644m runway capable of hosting J-11B fighters and H-6K bombers, underground munitions storage, radar/sensor arrays, anti-ship cruise missile launchers (YJ-12B), and HQ-9B SAM batteries. The 2016 Permanent Court of Arbitration ruled China has no legal basis for its claims — Beijing rejected the ruling outright. Combined with Fiery Cross and Subi Reef, creates an overlapping triangle of military control that effectively commands the central Spratlys. Philippine coast guard and navy vessels report persistent shadowing by Chinese maritime militia. The island hosts a garrison estimated at 200+ personnel with rotating PLA Navy and PLA Air Force detachments.',news:'https://news.google.com/search?q=mischief+reef+south+china+sea+2026'},
    {name:'Idlib Province',lat:35.93,lon:36.63,lv:3,type:'ground',date:'2026',desc:'Last major opposition-held territory in Syria, home to ~4 million people including 2.8 million IDPs. Hayat Tahrir al-Sham (HTS), a former al-Qaeda affiliate rebranded under Abu Mohammed al-Julani, controls the Salvation Government civil administration. Turkish observation posts ring the southern deconfliction line per the 2018 Sochi agreement with Russia. Russian and Syrian air forces conduct periodic strikes on alleged militant positions. The M4 and M5 highways remain contested — their control is a key Damascus demand. HTS has been consolidating power by eliminating rival factions and establishing governance structures including courts, police, and taxation. Humanitarian conditions remain dire with overwhelmed IDP camps along the Turkish border at Bab al-Hawa and Atmeh.',news:'https://news.google.com/search?q=idlib+syria+2026'},
    {name:'Al-Tanf Base',lat:33.52,lon:38.81,lv:2,type:'military',date:'2026',desc:'US Army garrison at the Syria-Iraq-Jordan tri-border, manned by ~200 US special operations forces and ~300 Maghaweir al-Thawra (MaT) Syrian opposition fighters. A 55km deconfliction zone surrounds the base, blocking the Tehran-Baghdad-Damascus highway — Iran\'s primary land corridor for weapons transfers to Hezbollah. Iran-backed militias (Kata\'ib Hezbollah, Liwa Fatemiyoun) maintain positions just outside the zone and conduct periodic probing attacks with drones and rockets. The base has been targeted over 80 times since October 2023. US forces maintain HIMARS, counter-UAS systems, and ISR capability. Russia regularly demands US withdrawal, calling the presence illegal under international law. The base\'s strategic value lies entirely in disrupting Iranian logistics rather than holding territory.',news:'https://news.google.com/search?q=al-tanf+base+syria+2026'},
    {name:'Cabo Delgado \u2014 Mozambique',lat:-12.33,lon:40.35,lv:3,type:'ground',date:'2026',desc:'ISIS-affiliated insurgency (Ansar al-Sunna / ASWJ, locally known as "al-Shabaab" though unrelated to the Somali group) has displaced over 1 million people since 2017. The insurgents target the $20B TotalEnergies Mozambique LNG project — the largest single foreign investment in Africa — which remains suspended since the March 2021 Palma attack. Rwanda deployed ~2,500 RDF troops in 2021 and SADC Mission in Mozambique (SAMIM) added ~2,000 from Tanzania, South Africa, and others. Combined forces recaptured Mocimboa da Praia port but insurgents shifted to guerrilla tactics in the dense bush. Attacks continue against villages, supply convoys, and isolated military positions. Rich natural gas reserves (127 Tcf offshore) make stabilization critical for East African energy security.',news:'https://news.google.com/search?q=cabo+delgado+mozambique+insurgency+2026'},
    {name:'Niamey \u2014 Niger',lat:13.51,lon:2.11,lv:2,type:'military',date:'2026',desc:'Military junta under General Abdourahamane Tchiani seized power in July 2023 coup, expelling 1,100 French troops from Air Base 201 (Niamey) and Air Base 101 (Agadez) — formerly the US\'s largest drone base in Africa at $110M. Niger joined the Alliance of Sahel States (AES) with Mali and Burkina Faso, all three withdrawing from ECOWAS. Russian Africa Corps (successor to Wagner Group) now provides security training and has deployed personnel to Niamey. The junta ended the US military cooperation agreement, forcing withdrawal of ~1,000 US troops and MQ-9 Reaper drones by September 2024. Niger is a critical uranium supplier (EU gets ~25% from Nigerien mines via Orano/Areva). Jihadist groups (ISGS, JNIM) continue expanding across the tri-border region with Burkina Faso and Mali despite — or enabled by — the security transition chaos.',news:'https://news.google.com/search?q=niger+military+junta+russia+2026'},
  ];
  confEnts.forEach(e=>V.entities.remove(e));confEnts=[];
  const colors={strike:'#DA3633',ground:'#ff6600',military:'#ff4488',naval:'#4488ff',nuclear:'#ffff00',chokepoint:'#E8B339',infrastructure:'#4A9EFF'};
  events.forEach(ev=>{
    const col=Cesium.Color.fromCssColorString(colors[ev.type]||'#E8B339');
    const hexCol=colors[ev.type]||'#E8B339';
    // Rich popup with news link, date, and Zoom/Go Back buttons (like guerillamap)
    const newsLink=ev.news?`<span style="color:var(--t3);font-size:10px">OSINT Source: Verified</span><br>`:'';
    const threatLabel=ev.lv>=5?'CRITICAL':ev.lv>=4?'HIGH':ev.lv>=3?'ELEVATED':ev.lv>=2?'MODERATE':'LOW';
    const threatColor=ev.lv>=5?'#ff0000':ev.lv>=4?'#ff4400':ev.lv>=3?'#E8B339':ev.lv>=2?'#E8B339':'#88aa00';
    const popupDesc=`<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:420px;background:#0a0e14;padding:14px;border-radius:2px;border:1px solid ${hexCol}22;color:#c8ccd6">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #1e2436">
        <div>
          <div style="color:${hexCol};font-size:14px;font-weight:700;letter-spacing:1px">${esc(ev.name)}</div>
          <div style="display:flex;gap:6px;margin-top:4px;align-items:center">
            <span style="padding:2px 6px;background:${hexCol}15;border:1px solid ${hexCol}33;border-radius:2px;font-size:8px;color:${hexCol};letter-spacing:1px;font-weight:600">${esc(ev.type).toUpperCase()}</span>
            <span style="color:#4a5068;font-size:9px">${esc(ev.date)}</span>
          </div>
        </div>
        <div style="text-align:center">
          <div style="padding:4px 8px;background:${threatColor}12;border:1px solid ${threatColor}33;border-radius:2px">
            <div style="color:${threatColor};font-size:10px;font-weight:700;letter-spacing:.5px">${threatLabel}</div>
            <div style="color:${threatColor};font-size:8px;margin-top:1px">${'&#9733;'.repeat(ev.lv)}${'&#9734;'.repeat(5-ev.lv)}</div>
          </div>
        </div>
      </div>
      <div style="padding:8px;background:rgba(255,255,255,0.02);border:1px solid #1e2436;border-radius:2px;font-size:10px;color:#8a8f9e;line-height:1.5">${esc(ev.desc)}</div>
      ${newsLink?'<div style="margin-top:6px;padding:4px 8px;background:rgba(0,204,255,0.04);border-left:2px solid #00ccff44;font-size:9px;color:#4A9EFF">OSINT SOURCE VERIFIED</div>':''}
      <table style="width:100%;border-collapse:collapse;font-size:10px;color:#7a8194;margin-top:8px">
        <tr><td style="padding:2px 0;width:35%"><b style="color:#4a5068">POSITION</b></td><td style="color:#c8ccd6">${Math.abs(ev.lat).toFixed(4)}\u00B0${ev.lat>=0?'N':'S'}, ${Math.abs(ev.lon).toFixed(4)}\u00B0${ev.lon>=0?'E':'W'}</td></tr>
      </table>
      <div style="display:flex;gap:6px;margin-top:10px">
        <button onclick="if(parent.V)parent.flyToTarget(${ev.lon},${ev.lat},50000,1.2)" style="flex:1;padding:5px;background:#0a0e14;color:${hexCol};border:1px solid ${hexCol}33;border-radius:2px;cursor:pointer;font-family:monospace;font-size:9px;letter-spacing:.5px">\u25CE ZOOM</button>
        <button onclick="if(parent.V)parent.V.camera.flyTo({destination:parent.Cesium.Cartesian3.fromDegrees(${ev.lon},${ev.lat},500000),duration:1.2})" style="flex:1;padding:5px;background:#0a0e14;color:#7a8194;border:1px solid #1e2436;border-radius:2px;cursor:pointer;font-family:monospace;font-size:9px;letter-spacing:.5px">AREA VIEW</button>
        <button onclick="if(parent.V)parent.V.camera.flyTo({destination:parent.Cesium.Cartesian3.fromDegrees(50,25,18000000),duration:1.5})" style="flex:1;padding:5px;background:#0a0e14;color:#4a5068;border:1px solid #1e2436;border-radius:2px;cursor:pointer;font-family:monospace;font-size:9px;letter-spacing:.5px">GLOBAL</button>
      </div>
      <div style="margin-top:8px;font-size:7px;color:#1e2436;letter-spacing:1px;text-align:right">KITSUNE BDOC \u2014 CONFLICT MONITOR</div>
    </div>`;
    // Phase 15 fix (2026-05-13): Number.POSITIVE_INFINITY here was making far-side conflict markers visible through the globe.
    // Switch to 5e6 so depth test runs once the camera is > 5000 km from the marker (i.e., when looking at the opposite side of Earth).
    confEnts.push(V.entities.add({position:Cesium.Cartesian3.fromDegrees(ev.lon,ev.lat),billboard:{image:makeConflictSVG(hexCol,'#fff'),width:ev.lv>=5?24:ev.lv>=4?20:16,height:ev.lv>=5?24:ev.lv>=4?20:16,scaleByDistance:new Cesium.NearFarScalar(1e5,1.2,1e7,0.4),verticalOrigin:Cesium.VerticalOrigin.CENTER,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:5e6},label:{text:ev.name,font:ev.lv>=4?'bold 10px JetBrains Mono':'9px JetBrains Mono',fillColor:col,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.TOP,pixelOffset:new Cesium.Cartesian2(0,14),scaleByDistance:new Cesium.NearFarScalar(5e5,1,8e6,0.3),showBackground:true,backgroundColor:Cesium.Color.BLACK.withAlpha(0.5),backgroundPadding:new Cesium.Cartesian2(4,2),disableDepthTestDistance:5e6},description:popupDesc,show:layers.conf}));
    const ringR=ev.lv>=5?30000:ev.lv>=4?20000:ev.lv>=3?15000:10000;
    confEnts.push(V.entities.add({position:Cesium.Cartesian3.fromDegrees(ev.lon,ev.lat),ellipse:{semiMajorAxis:ringR,semiMinorAxis:ringR,material:col.withAlpha(0.04),outline:true,outlineColor:col.withAlpha(0.2),height:0,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND},show:layers.conf}));
  });
  document.getElementById('conV').textContent=events.length;
  Health.ok('conflicts',events.length);
  us(1);af('var(--rd)',`${events.length} conflict zone markers loaded \u2014 verifying live GDELT feed...`);
  // Live GDELT conflict events \u2014 overlay real-time news-geocoded events on top of static zones
  fetch('/.netlify/functions/proxy-gdelt?query=war+OR+attack+OR+airstrike+OR+battle+OR+offensive+OR+troops+OR+missile&timespan=48h&maxpoints=150')
    .then(r=>r.json())
    .then(gd=>{
      if(!gd.features||!gd.features.length)return;
      let gdCount=0;
      gd.features.forEach(f=>{
        if(!f.geometry||!f.geometry.coordinates)return;
        const[lon,lat]=f.geometry.coordinates;
        if(isNaN(lat)||isNaN(lon))return;
        const locName=f.properties?.name||'INTEL EVENT';
        const rawHtml=f.properties?.html||'';
        const safeHtml=typeof DOMPurify!=='undefined'?DOMPurify.sanitize(rawHtml.slice(0,800)):rawHtml.replace(/<script[^>]*>.*?<\/script>/gi,'').slice(0,800);
        const lm=rawHtml.match(/href=["']([^"']+)["'][^>]*>([^<]{8,100})</);
        const link=lm?.[1]||'';const headline=lm?.[2]?.trim()||locName;
        const srcDom=link?link.replace(/^https?:\/\/(www\.)?/,'').split('/')[0]:'GDELT';
        confEnts.push(V.entities.add({
          position:Cesium.Cartesian3.fromDegrees(lon,lat),
          point:{pixelSize:5,color:Cesium.Color.fromCssColorString('#4A9EFF').withAlpha(0.75),outlineColor:Cesium.Color.WHITE.withAlpha(0.35),outlineWidth:1,disableDepthTestDistance:5e6},
          description:`<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:400px;background:#0a0e14;padding:12px;border-radius:2px;border:1px solid #4A9EFF22;color:#c8ccd6">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #1e2436">
              <div style="color:#4A9EFF;font-size:11px;font-weight:700;letter-spacing:1px">\u26a1 LIVE OSINT \u2014 GDELT 48H</div>
              <div style="padding:2px 6px;background:#4A9EFF11;border:1px solid #4A9EFF33;border-radius:2px;font-size:8px;color:#4A9EFF">OPEN SOURCE</div>
            </div>
            <div style="font-weight:600;margin-bottom:6px;color:#c8ccd6">${esc(locName)}</div>
            <div style="font-size:10px;color:#8a8f9e;margin-bottom:6px">${esc(headline)}</div>
            ${safeHtml?`<div style="font-size:9px;color:#4a5068;border-top:1px solid #1e2436;padding-top:6px;margin-top:4px">SOURCE: ${esc(srcDom)}</div>`:''}
            ${link?`<a href="${safeUrl(link)}" target="_blank" rel="noopener noreferrer" style="display:block;margin-top:8px;padding:5px;background:#4A9EFF11;border:1px solid #4A9EFF33;border-radius:2px;color:#4A9EFF;text-decoration:none;font-size:9px;text-align:center;font-family:monospace">OPEN SOURCE \u2192</a>`:''}
            <div style="margin-top:8px;font-size:7px;color:#1e2436;letter-spacing:1px;text-align:right">KITSUNE BDOC \u2014 GDELT PROJECT</div>
          </div>`,
          show:layers.conf
        }));
        gdCount++;
      });
      const el=document.getElementById('conV');
      if(el)el.textContent=events.length+'+'+gdCount;
      af('var(--bl)',`Conflict: ${events.length} analyst zones + ${gdCount} live GDELT events (48h)`);
    })
    .catch(e=>console.warn('[Conflict GDELT]',e));
}

// ═══ TERRITORY CONTROL OVERLAY ═══
// ═══ TERRITORY CONTROL OVERLAY ═══
// Loads REAL frontline data from DeepStateMap via GitHub (updated daily)
// var (not let) so binding lands on window — togLy 'territory' branch may reference
// _territoryDataSource BEFORE this module is lazy-loaded (Phase 3 Turn 3).
var _territoryDataSource=null;
// Simplify a coordinate ring by keeping every Nth point (Douglas-Peucker lite)
function simplifyCoords(coords,maxPoints){
  if(!coords||coords.length<=maxPoints)return coords;
  const step=Math.ceil(coords.length/maxPoints);
  const simplified=[];
  for(let i=0;i<coords.length;i+=step)simplified.push(coords[i]);
  // Ensure ring is closed for polygons
  if(coords.length>0&&(simplified[simplified.length-1][0]!==coords[0][0]||simplified[simplified.length-1][1]!==coords[0][1])){
    simplified.push(coords[0]);
  }
  return simplified;
}
// Simplify GeoJSON features to prevent Cesium crash from overly complex polygons
function simplifyGeoJSON(geojson,maxPointsPerRing){
  if(!geojson||!geojson.features)return geojson;
  const mp=maxPointsPerRing||200;
  geojson.features=geojson.features.filter(f=>{
    if(!f.geometry)return false;
    try{
      const g=f.geometry;
      if(g.type==='Polygon'){
        g.coordinates=g.coordinates.map(ring=>simplifyCoords(ring,mp));
      }else if(g.type==='MultiPolygon'){
        g.coordinates=g.coordinates.map(poly=>poly.map(ring=>simplifyCoords(ring,mp)));
      }
      // Skip features with invalid/empty geometries
      if(g.type==='Polygon'&&(!g.coordinates[0]||g.coordinates[0].length<4))return false;
      if(g.type==='MultiPolygon'&&g.coordinates.length===0)return false;
      return true;
    }catch(e){return false}
  });
  return geojson;
}
async function loadTerritoryControl(){
  if(!V)return;
  // Try today, then yesterday, then day before (data updates at 03:00 UTC)
  const dates=[];
  for(let i=0;i<5;i++){
    const d=new Date();d.setDate(d.getDate()-i);
    dates.push(d.toISOString().split('T')[0]);
  }
  let geojson=null;let usedDate='';
  for(const dt of dates){
    const url=`https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data/deepstatemap_data_${dt}.geojson`;
    try{
      const res=await fetch(url);
      if(res.ok){geojson=await res.json();usedDate=dt;break}
    }catch(e){console.warn(`[Territory] Failed to fetch ${dt}:`,e)}
  }
  if(!geojson){
    console.warn('[Territory] No DeepStateMap data available, using fallback');
    loadTerritoryFallback();
    return;
  }
  // Remove previous territory data
  if(_territoryDataSource){
    V.dataSources.remove(_territoryDataSource,true);
    _territoryDataSource=null;
  }
  territoryEnts.forEach(e=>V.entities.remove(e));territoryEnts=[];
  // PERF FIX: Simplify complex polygons to max 200 points per ring to prevent Cesium crash
  geojson=simplifyGeoJSON(geojson,200);
  // Color coding by feature name/type
  const colorMap={
    'occupied before 24.02.2022':{fill:'#880022',alpha:0.35,stroke:'#cc0033'},
    'occupied after 24.02.2022':{fill:'#cc2233',alpha:0.25,stroke:'#ff3344'},
    'occupied crimea':{fill:'#880022',alpha:0.35,stroke:'#cc0033'},
    'default':{fill:'#cc3344',alpha:0.2,stroke:'#ff3344'}
  };
  try{
    const ds=await Cesium.GeoJsonDataSource.load(geojson,{
      stroke:Cesium.Color.RED.withAlpha(0.6),
      fill:Cesium.Color.RED.withAlpha(0.2),
      strokeWidth:2,
      clampToGround:true
    });
    // Style each entity based on its properties
    ds.entities.values.forEach(ent=>{
      const props=ent.properties;
      const name=props?.name?._value||props?.NAME?._value||props?.description?._value||'Occupied Territory';
      let cm=colorMap.default;
      const nameLower=name.toLowerCase();
      for(const[key,val]of Object.entries(colorMap)){
        if(key!=='default'&&nameLower.includes(key)){cm=val;break}
      }
      if(ent.polygon){
        ent.polygon.material=Cesium.Color.fromCssColorString(cm.fill).withAlpha(cm.alpha);
        ent.polygon.outline=true;
        ent.polygon.outlineColor=Cesium.Color.fromCssColorString(cm.stroke).withAlpha(0.6);
      }
      ent.description=`<div style="font-family:'Segoe UI',monospace;font-size:13px;max-width:400px;background:#1a1a2e;padding:12px;border-radius:6px;border:1px solid #ff334444">
        <b style="color:#ff3344;font-size:14px">${esc(name)}</b><br>
        <span style="color:#888;font-size:10px">TERRITORY CONTROL</span><br><br>
        <span style="color:#ccc">Territory occupied by Russia. Boundaries updated daily from DeepStateMap OSINT data.</span><br><br>
        <span style="color:#888;font-size:9px">Data: ${usedDate} | Source: deepstatemap.live via GitHub</span><br><br>
        <div style="display:flex;gap:6px">
          <button onclick="if(parent.V)parent.V.camera.flyTo({destination:parent.Cesium.Cartesian3.fromDegrees(36,48,800000),duration:1.5})" style="padding:4px 12px;background:#0a0e1a;color:#00ccff;border:1px solid #00ccff44;border-radius:3px;cursor:pointer;font-family:monospace;font-size:10px">Zoom to Front</button>
          <button onclick="if(parent.V)parent.V.camera.flyTo({destination:parent.Cesium.Cartesian3.fromDegrees(50,25,18000000),duration:1.5})" style="padding:4px 12px;background:#0a0e1a;color:#aaa;border:1px solid #aaa4;border-radius:3px;cursor:pointer;font-family:monospace;font-size:10px">Go Back</button>
        </div>
      </div>`;
      ent.show=layers.territory;
    });
    _territoryDataSource=ds;
    V.dataSources.add(ds);
    const featureCount=geojson.features?geojson.features.length:0;
    af('var(--rd)',`Territory control: ${featureCount} zones loaded from DeepStateMap (${usedDate})`);
    EventLog.add('info',`Territory data loaded: ${usedDate} — ${featureCount} features`);
  }catch(e){
    console.error('[Territory] GeoJSON render error:',e);
    af('var(--yl)','Territory: GeoJSON too complex, using simplified fallback');
    loadTerritoryFallback();
  }
}
// Fallback: simple hardcoded polygons if live data unavailable
function loadTerritoryFallback(){
  if(!V)return;
  territoryEnts.forEach(e=>V.entities.remove(e));territoryEnts=[];
  const zones=[
    {name:'Crimea (occupied since 2014)',coords:[33.60,44.40,32.50,44.95,33.00,45.50,33.80,46.15,34.80,46.20,36.60,45.45,36.70,45.10,35.40,44.80,34.20,44.50,33.60,44.40]},
    {name:'Donetsk Oblast (occupied)',coords:[37.50,48.80,36.90,48.30,37.10,47.80,37.50,47.30,38.00,47.10,38.80,47.00,39.60,47.20,39.80,47.80,39.50,48.20,38.80,48.50,38.00,48.70,37.50,48.80]},
    {name:'Luhansk Oblast (occupied)',coords:[38.00,48.70,38.80,48.50,39.50,48.20,39.80,47.80,39.80,48.60,39.60,49.20,39.00,49.50,38.30,49.30,38.00,48.70]},
    {name:'Zaporizhzhia (partial)',coords:[34.80,46.20,35.00,46.80,35.80,47.20,36.50,47.40,36.90,47.00,36.60,46.50,36.00,46.00,35.20,45.80,34.80,46.20]},
    {name:'Kherson (partial)',coords:[32.90,46.00,33.20,46.60,33.80,46.80,34.50,46.80,34.80,46.20,34.20,45.80,33.50,45.50,32.90,46.00]},
  ];
  zones.forEach(z=>{
    territoryEnts.push(V.entities.add({
      polygon:{hierarchy:Cesium.Cartesian3.fromDegreesArray(z.coords),material:Cesium.Color.RED.withAlpha(0.2),outline:true,outlineColor:Cesium.Color.RED.withAlpha(0.5),height:0},
      description:`<div style="font-family:monospace;font-size:13px;background:#1a1a2e;padding:12px;border-radius:6px;border:1px solid #ff334444"><b style="color:#ff3344">${z.name}</b><br><br><span style="color:#888">Fallback data — live DeepStateMap feed unavailable</span></div>`,
      show:layers.territory
    }));
  });
  // Frontline
  territoryEnts.push(V.entities.add({
    polyline:{positions:Cesium.Cartesian3.fromDegreesArray([36.19,51.73,36.00,50.50,36.50,49.50,37.00,49.00,37.50,48.80,37.80,48.50,37.50,48.00,37.20,47.60,36.80,47.20,36.00,46.80,35.20,46.50,34.50,46.30]),width:3,material:new Cesium.PolylineDashMaterialProperty({color:Cesium.Color.RED.withAlpha(0.8),dashLength:12}),clampToGround:true},
    show:layers.territory
  }));
  af('var(--yl)','Territory control: fallback data (live feed unavailable)');
}
