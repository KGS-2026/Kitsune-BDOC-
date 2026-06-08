// ============================================================
// BDOC PHASE 2 MODULE: layers-infra.js
// Power plants + Oil/Gas infrastructure loaders
// Extracted from index.html lines 8787-8902 (Turn 7, 2026-04-22)
// Depends on (resolved lazily at call time via shared Script lexical env):
//   V (Cesium.Viewer), Cesium, layers, esc, af, us
//   powerplantEnts, oilgasEnts (still declared inline at top of main script)
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
// ═══ POWER PLANTS (Global via WRI Global Power Plant Database) ═══
function loadPowerPlants(){
  powerplantEnts.forEach(e=>V.entities.remove(e));powerplantEnts=[];
  const fuelColors={nuclear:'#DA3633',coal:'#555555',gas:'#FF8C00',oil:'#8B4513',hydro:'#4A9EFF',wind:'#00CC66',solar:'#FFD700',geothermal:'#FF4500',biomass:'#228B22',waste:'#996633',other:'#888888'};
  // Major power plants by type — curated dataset of strategically significant facilities
  const plants=[
    // NUCLEAR
    {n:'Palo Verde',lat:33.39,lon:-112.86,fuel:'nuclear',mw:3937,country:'US'},{n:'Grand Coulee',lat:47.95,lon:-118.98,fuel:'hydro',mw:6809,country:'US'},
    {n:'Kashiwazaki-Kariwa',lat:37.43,lon:138.60,fuel:'nuclear',mw:7965,country:'Japan'},{n:'Bruce',lat:44.33,lon:-81.60,fuel:'nuclear',mw:6384,country:'Canada'},
    {n:'Zaporizhzhia',lat:47.51,lon:34.59,fuel:'nuclear',mw:5700,country:'Ukraine'},{n:'Gravelines',lat:51.01,lon:2.11,fuel:'nuclear',mw:5460,country:'France'},
    {n:'Hanul',lat:37.09,lon:129.38,fuel:'nuclear',mw:5881,country:'South Korea'},{n:'Tianwan',lat:34.69,lon:119.46,fuel:'nuclear',mw:6680,country:'China'},
    {n:'Barakah',lat:23.96,lon:52.26,fuel:'nuclear',mw:5600,country:'UAE'},{n:'Kudankulam',lat:8.17,lon:77.71,fuel:'nuclear',mw:2000,country:'India'},
    {n:'Hinkley Point C',lat:51.21,lon:-3.13,fuel:'nuclear',mw:3260,country:'UK'},{n:'Olkiluoto',lat:61.24,lon:21.45,fuel:'nuclear',mw:2860,country:'Finland'},
    // COAL
    {n:'Tuoketuo',lat:40.22,lon:111.37,fuel:'coal',mw:6720,country:'China'},{n:'Taean',lat:36.75,lon:126.30,fuel:'coal',mw:6100,country:'South Korea'},
    {n:'Vindhyachal',lat:24.08,lon:82.66,fuel:'coal',mw:4760,country:'India'},{n:'Belchatow',lat:51.27,lon:19.33,fuel:'coal',mw:5354,country:'Poland'},
    {n:'Jänschwalde',lat:51.83,lon:14.47,fuel:'coal',mw:3000,country:'Germany'},{n:'Mundra',lat:22.74,lon:69.72,fuel:'coal',mw:4620,country:'India'},
    {n:'Medupi',lat:-23.68,lon:27.55,fuel:'coal',mw:4764,country:'South Africa'},{n:'Kusile',lat:-25.97,lon:29.25,fuel:'coal',mw:4800,country:'South Africa'},
    // GAS
    {n:'Surgut-2',lat:61.25,lon:73.38,fuel:'gas',mw:5597,country:'Russia'},{n:'Futtsu',lat:35.31,lon:139.84,fuel:'gas',mw:5040,country:'Japan'},
    {n:'West County Energy',lat:33.94,lon:-118.41,fuel:'gas',mw:2500,country:'US'},{n:'Jebel Ali',lat:25.06,lon:55.12,fuel:'gas',mw:8695,country:'UAE'},
    {n:'Shoaiba',lat:20.67,lon:39.51,fuel:'gas',mw:5600,country:'Saudi Arabia'},{n:'Didcot B',lat:51.62,lon:-1.26,fuel:'gas',mw:1510,country:'UK'},
    // HYDRO
    {n:'Three Gorges',lat:30.82,lon:111.00,fuel:'hydro',mw:22500,country:'China'},{n:'Itaipu',lat:-25.41,lon:-54.59,fuel:'hydro',mw:14000,country:'Brazil/Paraguay'},
    {n:'Guri',lat:7.77,lon:-63.00,fuel:'hydro',mw:10235,country:'Venezuela'},{n:'Tucurui',lat:-3.83,lon:-49.65,fuel:'hydro',mw:8370,country:'Brazil'},
    {n:'Sayano-Shushenskaya',lat:52.83,lon:91.37,fuel:'hydro',mw:6400,country:'Russia'},{n:'Robert-Bourassa',lat:53.78,lon:-77.45,fuel:'hydro',mw:5616,country:'Canada'},
    {n:'Xiluodu',lat:28.25,lon:103.65,fuel:'hydro',mw:13860,country:'China'},{n:'Baihetan',lat:27.13,lon:103.12,fuel:'hydro',mw:16000,country:'China'},
    // WIND
    {n:'Gansu Wind Farm',lat:40.3,lon:97.0,fuel:'wind',mw:7965,country:'China'},{n:'Jaisalmer Wind Park',lat:26.9,lon:70.9,fuel:'wind',mw:1064,country:'India'},
    {n:'Alta Wind',lat:35.07,lon:-118.35,fuel:'wind',mw:1547,country:'US'},{n:'Hornsea 2',lat:53.88,lon:1.8,fuel:'wind',mw:1386,country:'UK'},
    {n:'Dogger Bank',lat:54.75,lon:2.0,fuel:'wind',mw:3600,country:'UK'},{n:'Walney Extension',lat:54.05,lon:-3.55,fuel:'wind',mw:659,country:'UK'},
    // SOLAR
    {n:'Bhadla Solar Park',lat:27.5,lon:71.9,fuel:'solar',mw:2245,country:'India'},{n:'Huanghe Hydropower Hainan',lat:36.3,lon:100.6,fuel:'solar',mw:2200,country:'China'},
    {n:'Benban Solar Park',lat:24.5,lon:32.7,fuel:'solar',mw:1650,country:'Egypt'},{n:'Noor Abu Dhabi',lat:24.33,lon:55.37,fuel:'solar',mw:1177,country:'UAE'},
    {n:'Solar Star',lat:34.83,lon:-118.41,fuel:'solar',mw:579,country:'US'},{n:'Pavagada Solar Park',lat:14.1,lon:77.3,fuel:'solar',mw:2050,country:'India'}
  ];
  plants.forEach(p=>{
    const fc=fuelColors[p.fuel]||fuelColors.other;
    const clr=Cesium.Color.fromCssColorString(fc);
    powerplantEnts.push(V.entities.add({
      position:Cesium.Cartesian3.fromDegrees(p.lon,p.lat),
      point:{pixelSize:6,color:clr,outlineColor:Cesium.Color.BLACK,outlineWidth:1,disableDepthTestDistance:5e6,scaleByDistance:new Cesium.NearFarScalar(5e5,1.2,1e7,0.4)},
      label:{text:esc(p.n),font:'8px JetBrains Mono',fillColor:clr.withAlpha(0.85),outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,12),disableDepthTestDistance:5e6,scaleByDistance:new Cesium.NearFarScalar(3e5,1,3e6,0)},
      description:'<div style="font-family:\'JetBrains Mono\',monospace;padding:10px;color:#c8ccd6;background:#0d1117;border:1px solid '+esc(fc)+'">'+
        '<div style="font-size:12px;font-weight:700;color:'+esc(fc)+';margin-bottom:6px">'+esc(p.fuel.toUpperCase())+' POWER PLANT</div>'+
        '<div style="font-size:11px;font-weight:600">'+esc(p.n)+'</div>'+
        '<div style="font-size:10px;margin-top:4px">Capacity: <b>'+p.mw.toLocaleString()+' MW</b></div>'+
        '<div style="font-size:10px">Country: '+esc(p.country)+'</div>'+
        '<div style="font-size:8px;color:#8b949e;margin-top:6px">Source: WRI Global Power Plant Database</div></div>',
      show:layers.powerplants
    }));
  });
  af('#FFD700','Power Plants: '+plants.length+' major facilities loaded (nuclear/coal/gas/hydro/wind/solar)');us(1);
}

// ═══ OIL & GAS INFRASTRUCTURE (Major refineries, pipelines, LNG terminals) ═══
function loadOilGas(){
  oilgasEnts.forEach(e=>V.entities.remove(e));oilgasEnts=[];
  const typeColors={refinery:'#FF8C00',lng:'#00BFFF',pipeline_start:'#CC6600',oilfield:'#1a1a1a',gasfield:'#8B4513'};
  const facilities=[
    // MAJOR REFINERIES
    {n:'Jamnagar Refinery',lat:22.28,lon:69.67,type:'refinery',bpd:1240000,country:'India',op:'Reliance'},
    {n:'Paraguana Refinery',lat:11.75,lon:-70.22,type:'refinery',bpd:955000,country:'Venezuela',op:'PDVSA'},
    {n:'SK Ulsan',lat:35.50,lon:129.39,type:'refinery',bpd:840000,country:'South Korea',op:'SK Energy'},
    {n:'Ruwais Refinery',lat:24.11,lon:52.73,type:'refinery',bpd:837000,country:'UAE',op:'ADNOC'},
    {n:'Ras Tanura',lat:26.64,lon:50.16,type:'refinery',bpd:550000,country:'Saudi Arabia',op:'Saudi Aramco'},
    {n:'Jurong Island',lat:1.27,lon:103.70,type:'refinery',bpd:592000,country:'Singapore',op:'ExxonMobil/Shell'},
    {n:'Port Arthur',lat:29.87,lon:-93.93,type:'refinery',bpd:630000,country:'US',op:'Motiva (Aramco)'},
    {n:'Galveston Bay',lat:29.37,lon:-94.91,type:'refinery',bpd:585000,country:'US',op:'Marathon'},
    {n:'Pernis',lat:51.88,lon:4.38,type:'refinery',bpd:404000,country:'Netherlands',op:'Shell'},
    {n:'Antwerp Refinery',lat:51.24,lon:4.38,type:'refinery',bpd:360000,country:'Belgium',op:'TotalEnergies'},
    {n:'Omsk Refinery',lat:54.93,lon:73.32,type:'refinery',bpd:400000,country:'Russia',op:'Gazprom Neft'},
    {n:'Abadan Refinery',lat:30.34,lon:48.30,type:'refinery',bpd:400000,country:'Iran',op:'NIOC'},
    // LNG TERMINALS
    {n:'Sabine Pass LNG',lat:29.74,lon:-93.86,type:'lng',mtpa:30,country:'US',op:'Cheniere'},
    {n:'Qatargas LNG',lat:25.88,lon:51.53,type:'lng',mtpa:77,country:'Qatar',op:'QatarEnergy'},
    {n:'Gorgon LNG',lat:-20.53,lon:115.57,type:'lng',mtpa:15.6,country:'Australia',op:'Chevron'},
    {n:'Yamal LNG',lat:71.28,lon:72.10,type:'lng',mtpa:17.5,country:'Russia',op:'Novatek'},
    {n:'Ichthys LNG',lat:-12.56,lon:130.76,type:'lng',mtpa:8.9,country:'Australia',op:'INPEX'},
    {n:'Cameron LNG',lat:29.77,lon:-93.34,type:'lng',mtpa:13.5,country:'US',op:'Sempra'},
    {n:'Bintulu LNG',lat:3.17,lon:113.07,type:'lng',mtpa:29.3,country:'Malaysia',op:'Petronas'},
    {n:'Bonny Island LNG',lat:4.41,lon:7.16,type:'lng',mtpa:22,country:'Nigeria',op:'NLNG'},
    // KEY CHOKEPOINT INFRASTRUCTURE
    {n:'Strait of Hormuz Terminal',lat:26.57,lon:56.25,type:'pipeline_start',note:'~21M bpd transit',country:'Iran/Oman'},
    {n:'SUMED Pipeline (Ain Sukhna)',lat:29.59,lon:32.33,type:'pipeline_start',note:'2.5M bpd capacity',country:'Egypt'},
    {n:'Baku-Tbilisi-Ceyhan Start',lat:40.41,lon:49.87,type:'pipeline_start',note:'1M bpd Caspian oil',country:'Azerbaijan'},
    {n:'Nord Stream Landfall (Lubmin)',lat:54.14,lon:13.67,type:'pipeline_start',note:'Damaged 2022 — offline',country:'Germany'},
    {n:'Druzhba Pipeline (Mozyr)',lat:52.05,lon:29.25,type:'pipeline_start',note:'1M bpd to Europe',country:'Belarus'},
    {n:'TurkStream Landfall',lat:41.73,lon:28.00,type:'pipeline_start',note:'31.5 bcm/yr gas',country:'Turkey'},
    {n:'Ghawar Field',lat:25.38,lon:49.40,type:'oilfield',note:'Largest oilfield ~3.8M bpd',country:'Saudi Arabia'},
    {n:'Burgan Field',lat:28.97,lon:47.77,type:'oilfield',note:'2nd largest ~1.7M bpd',country:'Kuwait'},
    {n:'Safaniyah Field',lat:28.11,lon:49.17,type:'oilfield',note:'Largest offshore ~1.5M bpd',country:'Saudi Arabia'},
    {n:'Permian Basin (Midland)',lat:31.99,lon:-102.08,type:'oilfield',note:'~5.9M bpd US shale',country:'US'},
    {n:'South Pars/North Dome',lat:26.64,lon:52.06,type:'gasfield',note:'Largest gas field in world',country:'Iran/Qatar'}
  ];
  facilities.forEach(f=>{
    const tc=typeColors[f.type]||'#888';
    const clr=Cesium.Color.fromCssColorString(tc);
    const icon=f.type==='refinery'?'&#9981;':f.type==='lng'?'&#10052;':f.type==='oilfield'?'&#9679;':f.type==='gasfield'?'&#9670;':'&#9644;';
    const capLine=f.bpd?'Capacity: <b>'+f.bpd.toLocaleString()+' bpd</b>':f.mtpa?'Capacity: <b>'+f.mtpa+' MTPA LNG</b>':f.note?'<b>'+esc(f.note)+'</b>':'';
    oilgasEnts.push(V.entities.add({
      position:Cesium.Cartesian3.fromDegrees(f.lon,f.lat),
      point:{pixelSize:7,color:clr,outlineColor:Cesium.Color.BLACK,outlineWidth:1.5,disableDepthTestDistance:5e6,scaleByDistance:new Cesium.NearFarScalar(5e5,1.2,1e7,0.4)},
      label:{text:esc(f.n),font:'8px JetBrains Mono',fillColor:clr.withAlpha(0.85),outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,12),disableDepthTestDistance:5e6,scaleByDistance:new Cesium.NearFarScalar(3e5,1,3e6,0)},
      description:'<div style="font-family:\'JetBrains Mono\',monospace;padding:10px;color:#c8ccd6;background:#0d1117;border:1px solid '+esc(tc)+'">'+
        '<div style="font-size:12px;font-weight:700;color:'+esc(tc)+';margin-bottom:6px">'+esc(f.type.replace('_',' ').toUpperCase())+'</div>'+
        '<div style="font-size:11px;font-weight:600">'+esc(f.n)+'</div>'+
        (f.op?'<div style="font-size:10px;margin-top:4px">Operator: '+esc(f.op)+'</div>':'')+
        (capLine?'<div style="font-size:10px;margin-top:2px">'+capLine+'</div>':'')+
        '<div style="font-size:10px">Country: '+esc(f.country)+'</div>'+
        '<div style="font-size:8px;color:#8b949e;margin-top:6px">Source: EIA / OPEC / Industry reports</div></div>',
      show:layers.oilgas
    }));
  });
  af('#FF8C00','Oil & Gas: '+facilities.length+' facilities loaded (refineries/LNG/pipelines/fields)');us(1);
}
