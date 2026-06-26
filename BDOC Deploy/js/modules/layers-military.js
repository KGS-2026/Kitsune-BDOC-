// ============================================================
// BDOC PHASE 2 MODULE: layers-military.js
// Military bases + branch-insignia icon machinery + loadMilBases()
// Extracted from index.html lines 9163-9612 (Turn 6b, 2026-04-22)
// Depends on (resolved lazily at call time):
//   V (Cesium.Viewer), Cesium, layers, esc, af, svgToDataUri, flyToTarget
//   EventLog (js/telemetry.js)
//   MILAIRFIELDS, milairfieldEnts (still inline; referenced only by upgradeUSBranchIcons at runtime)
// `var milbaseEnts` (was `let`) for window-binding consistency.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
// ═══ MILITARY BASES ═══
// NOTE: layers.milbases default is set in the inline shell's `const layers={...}` declaration.
// Setting it here would throw ReferenceError because this script loads BEFORE the inline shell
// defines `layers` — and the throw aborts script execution before `const MILBASES` runs,
// which silently disabled the GTA threat widget (Phase 2 regression, fixed 2026-05-03).
var milbaseEnts = [];
var MILBASES = [
  // ── US MIDDLE EAST ──
  {n:'Al Udeid AB',lat:25.12,lon:51.31,c:'QA',t:'USAF',d:'CENTCOM forward HQ and Combined Air Operations Center (CAOC). ~10,000 US personnel. Controls all coalition air operations across 21-nation AOR spanning Middle East, Central & South Asia. Houses 379th AEW, AFCENT, and coalition intelligence fusion center. KC-135/KC-10 tanker ops, C-17/C-130 airlift. Largest US facility in Middle East by personnel count.'},
  {n:'Al Dhafra AB',lat:24.25,lon:54.55,c:'AE',t:'USAF',d:'USAF forward presence in UAE. 380th AEW. Hosts F-35A Lightning II, F-22 Raptor rotational deployments, KC-10 Extender tankers, RQ-4 Global Hawk and U-2 Dragon Lady high-altitude ISR. Critical for Strait of Hormuz overwatch and Iranian airspace monitoring. ~3,500 US personnel.'},
  {n:'Camp Arifjan',lat:28.93,lon:48.10,c:'KW',t:'USA',d:'US Army primary base in Kuwait. Third Army/ARCENT forward HQ. ~13,000 personnel. Prepositioned war stocks (APS-5) including M1 Abrams, Bradley IFVs, and Patriot batteries. Key logistics hub connecting CENTCOM ground forces. 40km south of Kuwait City.'},
  {n:'Al Salem AB',lat:29.35,lon:47.52,c:'KW',t:'USAF',d:'Ali Al Salem Air Base. 386th AEW. Primary aerial port of debarkation (APOD) for all CENTCOM personnel and cargo entering theater. C-17/C-130 airlift hub processing 40,000+ passengers annually. Hosts expeditionary fighter and ISR squadrons on rotation.'},
  {n:'NSA Bahrain',lat:26.24,lon:50.60,c:'BH',t:'USN',d:'US 5th Fleet HQ and Naval Forces Central Command (NAVCENT). Controls naval operations across Arabian Gulf, Red Sea, Gulf of Oman, and parts of Indian Ocean. Hosts Combined Maritime Forces (CMF) — 34-nation naval coalition. SEAL Team and EOD units forward deployed. ~9,000 US personnel.'},
  {n:'Al Minhad AB',lat:25.02,lon:55.37,c:'AE',t:'USAF',d:'Coalition air base in UAE, 24km south of Dubai. Used by US, Australia, Canada, Netherlands, and New Zealand. Logistics and ISR hub supporting CENTCOM and AFRICOM operations. C-17 and aerial refueling staging point.'},
  {n:'Eskan Village',lat:24.55,lon:46.74,c:'SA',t:'USAF',d:'US military compound near Riyadh. US Military Training Mission (USMTM) to Saudi Arabia. Security cooperation, foreign military sales support, and Saudi National Guard modernization advisory. Low-profile US presence in Kingdom.'},
  {n:'Prince Sultan AB',lat:24.06,lon:47.58,c:'SA',t:'USAF',d:'Reactivated 2019 as CENTCOM forward operating location. Previously closed 2003. Houses Patriot PAC-3 and THAAD missile defense batteries protecting Saudi infrastructure. Fighter squadron rotations (F-15E/F-16). 378th AEW. Key to integrated air and missile defense architecture.'},
  {n:'Masirah Island',lat:20.68,lon:58.89,c:'OM',t:'USAF',d:'RAF Masirah, Oman. USAF forward operating location on island off Oman eastern coast. P-3C Orion and MQ-9 Reaper maritime patrol staging. Monitors Strait of Hormuz approaches and Arabian Sea shipping lanes. Cooperative Security Location with minimal permanent US footprint.'},
  // ── US EUROPE ──
  {n:'Incirlik AB',lat:37.00,lon:35.43,c:'TR',t:'USAF',d:'NATO forward operating base in southern Turkey. 39th ABW. Estimated 50 B61 tactical nuclear gravity bombs stored in underground vaults — largest US nuclear weapons stockpile in Europe. Critical for Middle East power projection. 10,000ft runway supports strategic bombers. Politically sensitive: Turkey has restricted US access during crises.'},
  {n:'Ramstein AB',lat:49.44,lon:7.60,c:'DE',t:'USAF',d:'USAFE-AFAFRICA HQ and NATO Allied Air Command. Largest US Air Force base outside CONUS. 86th AW. C-130J/C-5M/C-17 airlift hub processing 70% of all US cargo to/from Europe and Middle East. Houses USAF Air and Space Operations Center for European/African theater. ~9,200 military personnel. Adjacent to Landstuhl Regional Medical Center.'},
  {n:'Landstuhl RMC',lat:49.40,lon:7.55,c:'DE',t:'USA',d:'Largest US military hospital outside CONUS and only American Level I trauma center in Europe. Receives all combat casualties from CENTCOM, EUCOM, and AFRICOM theaters. 2,500+ staff. Annual patient volume 200,000+. Critical aeromedical evacuation hub — wounded transferred from theater to Landstuhl within 24-36 hours.'},
  {n:'Grafenwoehr',lat:49.70,lon:11.93,c:'DE',t:'USA',d:'7th Army Training Command (7th ATC). Largest US military training area in Europe at 41,000+ acres. Combined arms live-fire maneuver ranges, urban warfare training village, and NATO multinational exercises. 2nd Cavalry Regiment (Stryker) permanently stationed. Vilseck garrison adjacent. Major site for rotational armored brigade deployments to Eastern Europe.'},
  {n:'Aviano AB',lat:46.03,lon:12.60,c:'IT',t:'USAF',d:'31st Fighter Wing. F-16CM/DM Viper operations securing NATO southern flank. Primary USAF fighter base in southern Europe. Flew combat missions in Bosnia (1995), Kosovo (1999), and Libya (2011). B61 nuclear weapons storage capability. 4,500+ US personnel. Northern Italy — 80km north of Venice.'},
  {n:'NAS Sigonella',lat:37.40,lon:14.92,c:'IT',t:'USN',d:'"Hub of the Med." P-8A Poseidon maritime patrol, MQ-4C Triton BAMS UAS, EP-3E SIGINT relay. Supports 6th Fleet operations across the Mediterranean, Black Sea approaches, and North Africa. Intelligence fusion center. Key logistics node for Africa operations. Sicily location provides 360-degree coverage of Central Mediterranean.'},
  {n:'Naval Station Rota',lat:36.62,lon:-6.35,c:'ES',t:'USN',d:'Four Aegis BMD-capable destroyers (DDG) homeported — Forward Deployed Naval Forces-Europe. Strategic Atlantic/Mediterranean chokepoint at Strait of Gibraltar approaches. 6th Fleet logistics hub. Supports NATO Integrated Air and Missile Defense. Spanish-American base sharing agreement. ~3,200 US personnel.'},
  {n:'RAF Lakenheath',lat:52.41,lon:0.56,c:'UK',t:'USAF',d:'48th Fighter Wing "Liberty Wing." F-15E Strike Eagles and F-35A Lightning II — only F-35 base in Europe, operational since 2021. Primary USAF air superiority and strike base in UK. ~4,500 military personnel. 15 minutes flight time to North Sea. Nuclear weapons storage capable. Flew combat missions in every conflict since Desert Storm.'},
  {n:'RAF Mildenhall',lat:52.36,lon:0.49,c:'UK',t:'USAF',d:'100th Air Refueling Wing "Bloody Hundredth." KC-135 Stratotanker operations providing aerial refueling for all USAFE missions. MC-130J Commando II special operations. 352nd SOW — only AFSOC wing in Europe. Originally slated for closure but retained due to strategic value. 3,200+ US personnel.'},
  {n:'Thule AB',lat:76.53,lon:-68.70,c:'GL',t:'USSF',d:'Pituffik Space Base — northernmost US military installation (76°N). Space Force 12th Space Warning Squadron operating AN/FPS-132 BMEWS (Ballistic Missile Early Warning System) radar providing 3,000-mile detection of ICBMs launched over North Pole. Critical node in US nuclear early warning architecture. Also hosts satellite tracking. Extreme Arctic conditions — 24-hour darkness November through February.'},
  {n:'Keflavik NAS',lat:64.00,lon:-22.57,c:'IS',t:'USN',d:'P-8A Poseidon rotational deployments monitoring the GIUK Gap (Greenland-Iceland-UK) — critical ASW chokepoint for Russian submarine transit from Northern Fleet to Atlantic. Reactivated for regular US/NATO presence after 2006 drawdown. Iceland has no military — US provides defense under 1951 bilateral agreement.'},
  {n:'Lajes Field',lat:38.76,lon:-27.09,c:'PT',t:'USAF',d:'65th Air Base Group. Azores archipelago — mid-Atlantic staging base critical for transatlantic airlift and naval patrol. Declining US operations since 2012 drawdown. Portuguese Air Force primary tenant. Strategic value as mid-ocean refueling stop and hurricane hunter staging base.'},
  {n:'Camp Bondsteel',lat:42.36,lon:21.24,c:'XK',t:'USA',d:'Largest US base in Balkans. KFOR (NATO Kosovo Force) Regional Command East HQ. Built in 1999 during Kosovo intervention. ~7,000 troops at peak, now reduced. 955 acres with 25 helicopter landing pads. Named after SSG James Bondsteel, Vietnam Medal of Honor recipient.'},
  {n:'NSF Redzikowo',lat:54.48,lon:16.74,c:'PL',t:'USN',d:'Aegis Ashore Missile Defense System — operational December 2023. SM-3 Block IIA interceptors capable of engaging intermediate-range ballistic missiles. Part of European Phased Adaptive Approach (EPAA) missile shield. Paired with Deveselu site in Romania. Russia considers it a direct threat — major source of US-Russia tension.'},
  {n:'MK Air Base',lat:44.36,lon:28.49,c:'RO',t:'USAF',d:'Mihail Kogalniceanu Air Base. Rotational US forces for Black Sea deterrence. Enhanced Forward Presence since 2022 Ukraine invasion. ~3,000 US troops. Stryker and infantry rotations. F-16 and MQ-9 deployments. 30km from Black Sea coast — critical for monitoring Russian activity in Crimea and western Black Sea.'},
  {n:'NSA Souda Bay',lat:35.49,lon:24.12,c:'GR',t:'USN',d:'Naval Support Activity Souda Bay, Crete. Deep-water port accommodating aircraft carriers. Largest NATO ammunition storage facility in eastern Mediterranean. P-8A staging, SOF operations, and ISR hub. Controls approaches to Aegean Sea and eastern Mediterranean. Used extensively during Libya operations (2011).'},
  // ── US PACIFIC ──
  {n:'Kadena AB',lat:26.35,lon:127.77,c:'JP',t:'USAF',d:'18th Wing — largest combat wing in USAF. "Keystone of the Pacific." F-15C/D Eagles, KC-135 tankers, E-3 AWACS, HH-60 rescue. 11,000ft runway. ~18,000 US personnel (including dependents). Okinawa — 400nm from Taiwan, 800nm from Shanghai. First responder base for any Pacific contingency. Houses 353rd SOW special operations.'},
  {n:'Yokota AB',lat:35.75,lon:139.35,c:'JP',t:'USAF',d:'US Forces Japan (USFJ) HQ and 5th Air Force HQ. 374th Airlift Wing — C-130J Super Hercules, CV-22B Osprey, UH-1N. Primary airlift and special operations hub in western Pacific. Western Tokyo — coordinates all US military activity across Japan. 13,000+ US personnel. Disaster response coordination center for Pacific theater.'},
  {n:'Camp Humphreys',lat:36.96,lon:127.03,c:'KR',t:'USA',d:'US Forces Korea (USFK) HQ. Largest US overseas military base at 3,600 acres. ~28,500 US personnel. $10.7B expansion completed 2022. Houses 2nd Infantry Division, Eighth Army HQ, and theater-level intelligence. 60km south of Seoul — relocated from Yongsan to reduce vulnerability to North Korean artillery. Apache, Black Hawk, and Chinook helicopter fleets.'},
  {n:'Osan AB',lat:37.09,lon:127.03,c:'KR',t:'USAF',d:'51st Fighter Wing. A-10C Thunderbolt II and F-16C/D Fighting Falcon. Closest USAF base to the DMZ (48 miles). Would be first responder in Korean Peninsula conflict. Co-located with Korean Air Force. 7th AF HQ. THAAD and Patriot batteries in vicinity. "The Tip of the Spear."'},
  {n:'Andersen AFB',lat:13.58,lon:144.93,c:'GU',t:'USAF',d:'36th Wing. Strategic bomber continuous presence (CBP) — B-52H, B-1B, B-2A rotational deployments. "Power Projection Hub of the Pacific." THAAD missile defense battery. Massive munitions storage (Munitions Storage Area has largest weapons cache in Pacific). 2 x 11,000ft runways. 4,000+ troops surging to 12,000+ during exercises. $8.7B buildup for Marine relocation from Okinawa.'},
  {n:'Diego Garcia',lat:-7.32,lon:72.42,c:'IO',t:'USN',d:'British Indian Ocean Territory. Joint US-UK facility. B-52/B-1/B-2 bomber staging, KC-135 tanker operations. Maritime Prepositioning Ships (MPS) Squadron Two — 16 cargo ships with 30 days of supplies for a Marine brigade. Indian Ocean surveillance hub. Signals intelligence facilities. Supports operations across CENTCOM, AFRICOM, and INDOPACOM. Sovereignty disputed by Mauritius.'},
  {n:'MCAS Iwakuni',lat:34.15,lon:132.24,c:'JP',t:'USMC',d:'Marine Aircraft Group 12 (MAG-12). F-35B Lightning II (first forward-deployed F-35B squadron), F/A-18 Hornets, EA-18G Growlers. Only US military airfield in western Honshu. Dual-use with Japanese Maritime Self-Defense Force. Relocated carrier air wing assets from Atsugi 2018. 8,000+ US personnel.'},
  {n:'NSF Yokosuka',lat:35.29,lon:139.68,c:'JP',t:'USN',d:'Commander, US 7th Fleet HQ — largest forward-deployed naval force (50-70 ships, 150 aircraft, 27,000 sailors). USS Ronald Reagan (CVN-76) homeport. 12 ships homeported including Ticonderoga-class cruisers and Arleigh Burke destroyers. Largest US naval facility in the western Pacific. Ship Repair Facility handles complex maintenance. 26,000+ US personnel and dependents.'},
  {n:'Camp Zama',lat:35.49,lon:139.39,c:'JP',t:'USA',d:'US Army Japan (USARJ) HQ and I Corps forward element. Army intelligence and cyber operations in Pacific. 500th Military Intelligence Brigade. Counter-intelligence, SIGINT, and HUMINT coordination for western Pacific. Located 25 miles southwest of Tokyo in Kanagawa Prefecture.'},
  {n:'Fleet Activities Sasebo',lat:33.16,lon:129.72,c:'JP',t:'USN',d:'Forward-deployed amphibious ready group including LHD/LPD. Mine Countermeasures Division. Closest US naval base to potential Korean Peninsula and Taiwan contingencies. 4 ships homeported. USS America (LHA-6) class. Logistic hub for southwestern Japan/East China Sea operations. 7,000+ US personnel.'},
  {n:'Pearl Harbor',lat:21.35,lon:-157.97,c:'US',t:'USN',d:'Joint Base Pearl Harbor-Hickam (JBPHH). US Indo-Pacific Command (INDOPACOM) HQ — largest geographic combatant command covering 36 nations, 52% of earth\'s surface. Commander, Pacific Fleet (CPF) HQ — 200+ ships, 1,100 aircraft, 130,000 sailors. Historic site of December 7, 1941 attack. USS Arizona Memorial. Submarine base (Pearl Harbor is SUBPAC HQ). Hickam Field supports C-17 and F-22 operations.'},
  {n:'Schofield Barracks',lat:21.49,lon:-158.07,c:'US',t:'USA',d:'25th Infantry Division "Tropic Lightning." Largest Army installation in Hawaii at 17,725 acres. Multi-domain task force and Pacific-oriented light infantry. Jungle warfare training. Adjacent Wheeler Army Airfield (AH-64 Apache, UH-60 Black Hawk). 14,500 soldiers. Strategic reserve for INDOPACOM contingencies.'},
  {n:'Guantanamo Bay',lat:19.91,lon:-75.10,c:'CU',t:'USN',d:'Oldest US overseas base — naval station since 1903 under perpetual lease from Cuba. 45 sq miles. Detention facility for war-on-terror detainees (operational since 2002, reduced population). US maintains base despite Cuban government opposition. Only US military installation in a country with no diplomatic relations. Strategic Caribbean location.'},
  // ── US CONUS ──
  {n:'Pentagon',lat:38.87,lon:-77.06,c:'US',t:'DOD',d:'Department of Defense HQ. World\'s largest office building — 6.5M sq ft, 17.5 miles of corridors. ~23,000 military and civilian employees. Office of the Secretary of Defense, Joint Chiefs of Staff, all service secretariats. Arlington, Virginia. National Military Command Center (NMCC) handles nuclear command and control. Hit during 9/11 attacks — 184 killed.'},
  {n:'Ft Liberty (Bragg)',lat:35.14,lon:-79.00,c:'US',t:'USA',d:'XVIII Airborne Corps HQ. Home of 82nd Airborne Division (America\'s Guard of Honor), JSOC (Joint Special Operations Command — Delta Force/DEVGRU tasking authority), USASOC (Army Special Operations Command), USASWC (Special Warfare Center — Green Beret qualification). 251 sq miles. ~57,000 military. Largest military complex by population in the world. Pope Army Airfield adjacent for airborne operations.'},
  {n:'Ft Cavazos (Hood)',lat:31.14,lon:-97.78,c:'US',t:'USA',d:'III Corps "Phantom Corps" HQ. 1st Cavalry Division (largest division in US Army — 16,000 soldiers, M1A2 Abrams, M2A3 Bradley). Largest active-duty armored post in the free world at 340 sq miles. 3rd Cavalry Regiment (Stryker). 1st Medical Brigade. Robert Gray AAF on-post. Killeen, TX. ~45,000 soldiers.'},
  {n:'Ft Stewart',lat:31.87,lon:-81.61,c:'US',t:'USA',d:'3rd Infantry Division "Rock of the Marne" HQ. Largest Army installation east of the Mississippi at 280,000 acres. Mechanized infantry — M1A2 Abrams, M2A3 Bradley, M109A7 Paladin. Led the "Thunder Run" into Baghdad 2003. Hunter Army Airfield co-located (aviation brigade, Rangers). Hinesville, GA.'},
  {n:'Ft Campbell',lat:36.66,lon:-87.47,c:'US',t:'USA',d:'101st Airborne Division "Screaming Eagles" (Air Assault) — only air assault division in the world. 160th Special Operations Aviation Regiment "Night Stalkers" — flew the Bin Laden raid, provides rotary-wing support to JSOC. ~30,000 soldiers. Kentucky-Tennessee border. 105,000 acres. 200+ aircraft (AH-64 Apache, UH-60 Black Hawk, CH-47 Chinook).'},
  {n:'Ft Drum',lat:44.05,lon:-75.76,c:'US',t:'USA',d:'10th Mountain Division "Climb to Glory" — most deployed division since 9/11. Light infantry optimized for harsh terrain, Arctic, and mountain warfare. 107,000 acres in upstate New York near Canadian border. Mountain Warfare School. Extreme cold-weather training (-40°F winters). ~18,000 soldiers. Deployed to Afghanistan, Iraq, Syria, Africa.'},
  {n:'Ft Carson',lat:38.74,lon:-104.79,c:'US',t:'USA',d:'4th Infantry Division "Ivy" HQ. Mechanized/Stryker combined arms at 137,000 acres. High-altitude training (6,000ft elevation at base of Rocky Mountains). 10th Special Forces Group (Airborne) — Europe/Africa-focused Green Berets. 71st Ordnance Group (EOD). Colorado Springs. ~28,000 soldiers.'},
  {n:'Ft Riley',lat:39.06,lon:-96.83,c:'US',t:'USA',d:'1st Infantry Division "Big Red One" HQ — oldest continuously serving division in US Army (activated 1917). Combined arms training center. M1A2 Abrams, Bradley, Paladin. 101,000 acres in Kansas Flint Hills. Formerly home of the Buffalo Soldiers. ~15,000 soldiers.'},
  {n:'Ft Bliss',lat:31.81,lon:-106.41,c:'US',t:'USA',d:'1st Armored Division "Old Ironsides" HQ. 1.12 million acres — largest Army installation by area. Air Defense Artillery Center of Excellence. Patriot, THAAD, and Avenger training. Adjacent to White Sands Missile Range (2.2M acres of restricted airspace). Joint live-fire and maneuver training space larger than Rhode Island. El Paso, TX. ~33,000 soldiers.'},
  {n:'Ft Sill',lat:34.65,lon:-98.40,c:'US',t:'USA',d:'Fires Center of Excellence — Field Artillery and Air Defense Artillery School. All Army cannon crews, MLRS/HIMARS operators, and forward observers train here. Basic Combat Training site (~10,000 trainees at any time). Home of the artillery branch since 1869. 94,000 acres. Lawton, OK. Testing ground for new precision fires including Extended Range Cannon Artillery (ERCA).'},
  {n:'Ft Moore (Benning)',lat:32.36,lon:-84.95,c:'US',t:'USA',d:'Maneuver Center of Excellence — US Army Infantry School and Armor School. Ranger School (62-day leadership course, 40% graduation rate). Airborne School (jump school). Officer Candidate School. Sniper School. 182,000 acres. Columbus, GA. Where every infantry and armor officer in the Army is trained. Martin Army Community Hospital.'},
  {n:'Ft Eisenhower (Gordon)',lat:33.43,lon:-82.13,c:'US',t:'USA',d:'Cyber Center of Excellence — Army Cyber School, Signal School, Electronic Warfare. NSA/CSS Georgia — major NSA signals intelligence facility. Army Cyber Command elements. 56,000 acres. Augusta, GA. Trains all Army cyber operators, signal officers, and electronic warfare specialists. Growing as cyber becomes a warfighting domain.'},
  {n:'Ft Jackson',lat:34.02,lon:-80.96,c:'US',t:'USA',d:'Largest Army initial entry training (basic training) installation. ~50,000 soldiers trained annually — roughly 50% of all Army BCT. Also hosts Adjutant General School, Drill Sergeant Academy, and Army Chaplain Center. 52,000 acres. Columbia, SC.'},
  {n:'Ft Johnson (Polk)',lat:31.05,lon:-93.20,c:'US',t:'USA',d:'Joint Readiness Training Center (JRTC) — one of two Army Combat Training Centers. Brigades rotate through 34-day exercises against professional opposing force (OPFOR). Simulates near-peer combat in complex terrain. 198,000 acres of Louisiana pine forest. Essential pre-deployment validation site. Vernon Parish, LA.'},
  {n:'Ft Wainwright',lat:64.83,lon:-147.65,c:'US',t:'USA',d:'11th Airborne Division "Arctic Angels" (reactivated 2022) HQ. Only US Arctic-focused division. Stryker brigade, airborne infantry, Arctic warfare specialists. Interior Alaska — trains at -60°F. 1.6 million acres of training land including Donnelly Training Area. Fairbanks. Critical for Arctic sovereignty and deterrence against Russian Northern Fleet.'},
  {n:'JBLM',lat:47.09,lon:-122.58,c:'US',t:'USA',d:'Joint Base Lewis-McChord. I Corps HQ — two-star Pacific-oriented corps. 2nd Infantry Division (one brigade). 7th Infantry Division. 1st Special Forces Group (Airborne) — Asia-Pacific focused Green Berets. 1st SFG soldiers speak Mandarin, Korean, Thai, Tagalog. McChord Field: C-17 Globemaster III airlift. 87,000 acres. Tacoma, WA. ~40,000 military.'},
  {n:'JBER',lat:61.25,lon:-149.81,c:'US',t:'USAF',d:'Joint Base Elmendorf-Richardson. 11th Air Force HQ. F-22 Raptor — two squadrons (3rd Wing) provide air sovereignty over Alaska/Arctic approaches. NORAD Alaskan Region. C-17/C-130 airlift. 4th Brigade (Airborne), 25th Infantry Division — only airborne brigade in the Pacific. 73,000 acres. Anchorage. Russian aircraft intercepts a regular mission.'},
  {n:'Nellis AFB',lat:36.24,lon:-115.03,c:'US',t:'USAF',d:'USAF Warfare Center — develops and teaches advanced air combat tactics for the entire Air Force. Home of Red Flag, the world\'s most demanding air combat exercise (3-week multinational campaigns 4x/year). 414th Combat Training Squadron operates aggressor aircraft simulating adversary tactics. Nevada Test and Training Range — 2.9 million acres (largest contiguous airspace in CONUS). Las Vegas, NV.'},
  {n:'Creech AFB',lat:36.58,lon:-115.67,c:'US',t:'USAF',d:'432nd Wing/432nd Air Expeditionary Wing. Epicenter of USAF Remotely Piloted Aircraft (RPA) operations. MQ-9 Reaper pilots fly combat missions worldwide via satellite link from Nevada in real-time. 24/7/365 combat operations since 2001. Responsible for more airstrikes than any manned fighter wing. 39th Reconnaissance Squadron (RQ-170 Sentinel stealth drone). 35 miles northwest of Las Vegas.'},
  {n:'NSA Norfolk',lat:36.95,lon:-76.30,c:'US',t:'USN',d:'Naval Station Norfolk — world\'s largest naval station. 14 piers, 11 aircraft hangars, 4,600 acres. Homeport for aircraft carriers (CVN-69 Eisenhower, CVN-75 Truman, CVN-77 Bush, CVN-78 Ford, CVN-79 Kennedy), cruisers, destroyers, amphibious ships, submarines. Commander, Naval Forces Atlantic. ~75 ships homeported. 50,000+ military and civilian personnel. Norfolk, VA. Adjacent to NATO Allied Command Transformation (ACT) HQ.'},
  {n:'JBSA Lackland',lat:29.38,lon:-98.62,c:'US',t:'USAF',d:'Joint Base San Antonio — Lackland. All USAF enlisted basic military training (BMT) — every airman starts here (~35,000 trainees/year). 25th Air Force (now 16th AF) ISR enterprise. NSA/CSS Texas — major signals intelligence processing facility. USAF Security Forces academy. Defense Language Institute English Language Center. 37th Training Wing — largest training wing in USAF.'},
  {n:'Ft Meade',lat:39.11,lon:-76.73,c:'US',t:'USA',d:'National Security Agency (NSA) HQ — largest signals intelligence organization in the world. US Cyber Command (USCYBERCOM) HQ — conducts offensive and defensive cyber operations. Defense Information Systems Agency (DISA). Defense Courier Service. ~40,000 employees (largest workforce of any US military installation). 5,067 acres between DC and Baltimore. The most classified square footage in the United States.'},
  {n:'MCB Camp Lejeune',lat:34.62,lon:-77.36,c:'US',t:'USMC',d:'II Marine Expeditionary Force (II MEF) HQ — 47,000 Marines ready for global crisis response within 48 hours. 2nd Marine Division, 2nd Marine Logistics Group, 2nd Marine Aircraft Wing (at MCAS Cherry Point/New River). 246 sq miles. 14 miles of beach for amphibious assault training — the only facility on East Coast for ship-to-shore exercises. Camp Johnson and MCAS New River adjacent. Jacksonville, NC.'},
  {n:'MCB Camp Pendleton',lat:33.30,lon:-117.35,c:'US',t:'USMC',d:'I Marine Expeditionary Force (I MEF) HQ — primary Pacific-oriented Marine force. 1st Marine Division, 1st Marine Logistics Group, 3rd Marine Aircraft Wing. 125,000 acres of Southern California coastline — 17 miles of beachfront for amphibious training. Only West Coast facility for large-scale ship-to-shore operations. ~42,000 Marines. Adjacent to Miramar (F-35B) and Coronado (Navy SEALs). San Diego County.'},
  {n:'MCB Quantico',lat:38.52,lon:-77.32,c:'US',t:'USMC',d:'"Crossroads of the Marine Corps." Marine Corps University — Command and Staff College, War College, School of Advanced Warfighting. The Basic School (TBS) where all Marine officers are trained. Officer Candidates School (OCS). FBI Academy and DEA Training Academy co-located. Marine Corps Systems Command. 8,600 acres. 35 miles south of Washington, DC.'},
  {n:'MCAS Cherry Point',lat:34.90,lon:-76.88,c:'US',t:'USMC',d:'2nd Marine Aircraft Wing (2nd MAW) HQ. F-35B Lightning II (VMFA-542), AV-8B Harrier II transitioning to F-35. Fleet Readiness Center East (FRC East) — largest aircraft maintenance depot on East Coast, services F/A-18, AV-8B, H-53, V-22 for all services. 13,000ft runway. Havelock, NC.'},
  {n:'NAS Jacksonville',lat:30.24,lon:-81.68,c:'US',t:'USN',d:'Commander, Patrol and Reconnaissance Group (CPRG) HQ. P-8A Poseidon maritime patrol and ASW — primary platform hunting Russian and Chinese submarines. HSM (helicopter maritime strike) squadrons flying MH-60R Seahawk. Fleet Readiness Center Southeast. Largest Navy base in Southeast by area (3,400 acres). Jacksonville, FL.'},
  {n:'NAS Pensacola',lat:30.35,lon:-87.32,c:'US',t:'USN',d:'"Cradle of Naval Aviation" — established 1914. Naval Aviation Schools Command: all Navy, Marine Corps, and Coast Guard aviators begin flight training here. Naval Air Technical Training Center (NATTC) trains aviation maintenance crews. Blue Angels flight demonstration squadron homeport. National Naval Aviation Museum (largest naval aviation museum in the world). Pensacola, FL.'},
  {n:'NAS Oceana',lat:36.82,lon:-76.03,c:'US',t:'USN',d:'Navy\'s East Coast Master Jet Base. Strike Fighter Wing Atlantic (SFWL) HQ. 17 F/A-18E/F Super Hornet squadrons — largest concentration of strike fighters anywhere. Trains all East Coast carrier air wing strike fighter crews before deployment. 5,900+ personnel. Virginia Beach, VA. Dam Neck Annex (DEVGRU/SEAL Team Six) 5 miles southeast — see separate marker.'},
  {n:'Dam Neck Annex',lat:36.61,lon:-75.95,c:'US',t:'USN',d:'Naval Station Dam Neck — Virginia Beach, VA. Home of DEVGRU (Naval Special Warfare Development Group), classified as SEAL Team Six — the US military\'s most elite tier-1 counter-terrorism unit. DEVGRU conducted Operation Neptune Spear (Osama bin Laden raid, May 2011) and hundreds of classified direct-action missions. No public signage; heavy perimeter security; access by cleared personnel only. Also houses Fleet Combat Training Center Atlantic (FCTCLA), Naval Warfare Development Command (NWDC) elements, and multiple classified SIGINT/intel units. Distinct from NAS Oceana 5 miles north. Effectively a classified campus embedded in Virginia Beach city limits.'},
  {n:'SUBASE Kings Bay',lat:30.81,lon:-81.50,c:'US',t:'USN',d:'Naval Submarine Base Kings Bay — St. Marys, GA. East Coast homeport of the Ohio-class SSBN (ballistic missile submarine) fleet. Submarine Group 10 HQ. Six SSBNs homeported (USS Tennessee, Kentucky, Maryland, Rhode Island, Georgia, Wyoming class boats), each armed with up to 20 Trident II D5 SLBMs carrying MIRV warheads — collectively representing roughly 40% of all US deployed strategic nuclear warheads. Strategic Weapons Facility Atlantic (SWFLANT) stores, maintains, and loads Trident II D5 missiles and W76/W88 warheads on-site. 24/7/365 deterrent patrol cycle maintained since 1981. ~16,000 military and civilian personnel. The single most important nuclear facility on the US East Coast.'},
  {n:'NSA Northwest',lat:36.55,lon:-76.17,c:'US',t:'USN',d:'Naval Support Activity Northwest — Chesapeake, VA. Highly classified naval strategic communications complex. Houses VLF (Very Low Frequency) transmitter arrays operating on frequencies that penetrate seawater, enabling communication with deeply submerged SSBNs on deterrent patrol. Part of the Navy\'s Strategic Communications (STRATCOM) network — ensures ballistic missile submarines can receive Emergency Action Messages (EAMs) including nuclear launch authorization even at patrol depth. Critical node in US nuclear command and control architecture. Secure compound; restricted access. Also supports LANTFLT (Atlantic Fleet) communications infrastructure and operates classified antenna systems for SUBLANT (Submarine Force Atlantic).'},
  {n:'NAB Coronado',lat:32.68,lon:-117.17,c:'US',t:'USN',d:'Naval Special Warfare Command (NSWC) HQ — commands all Navy SEALs and Special Boat Teams. SEAL Teams 1, 3, 5, 7 based here. BUD/S (Basic Underwater Demolition/SEAL) training — 6-month selection course with ~75% attrition rate including "Hell Week." Naval Special Warfare Center. Silver Strand, Coronado Island, San Diego. The epicenter of US naval special operations.'},
  {n:'NAS Whidbey Island',lat:48.35,lon:-122.66,c:'US',t:'USN',d:'Electronic Attack Wing Pacific — all EA-18G Growler electronic warfare squadrons. P-8A Poseidon maritime patrol squadrons. Only US installation dedicated to airborne electronic attack. Growlers jam enemy radar and communications during combat operations. VP (patrol) squadrons conduct ASW and maritime ISR. Oak Harbor, WA. 7,600 personnel.'},
  {n:'MacDill AFB',lat:27.85,lon:-82.52,c:'US',t:'USAF',d:'US Central Command (CENTCOM) HQ — commands all military operations across Middle East, Central Asia, Egypt (21 countries, 4 million sq miles). US Special Operations Command (SOCOM) HQ — commands all special operations forces across all services (70,000 operators). Two 4-star commands on one base. 6th Air Refueling Wing (KC-135). Tampa, FL.'},
  {n:'Hurlburt Field',lat:30.43,lon:-86.69,c:'US',t:'USAF',d:'Air Force Special Operations Command (AFSOC) HQ. 1st Special Operations Wing — AC-130J Ghostrider gunships, MC-130J Commando II, CV-22B Osprey, U-28A Draco, MQ-9 Reaper. Conducts precision strike, personnel recovery, infiltration/exfiltration, and ISR for joint special operations worldwide. 24th SOW (Special Tactics — combat controllers, pararescue). Fort Walton Beach, FL.'},
  {n:'Luke AFB',lat:33.54,lon:-112.38,c:'US',t:'USAF',d:'56th Fighter Wing — largest fighter pilot training wing in the world. Primary F-35A Lightning II training base (6 squadrons). Also trains F-16 pilots for USAF and allied nations (Singapore, Taiwan, Italy, Turkey, Norway). Produces 80+ fighter pilots per year. 300+ flying days/year due to Arizona climate. Glendale, AZ (Phoenix metro).'},
  {n:'Shaw AFB',lat:33.97,lon:-80.47,c:'US',t:'USAF',d:'20th Fighter Wing — largest F-16CM combat wing in USAF with 3 fighter squadrons. 9th Air Force (AFCENT) HQ — commands all USAF operations in CENTCOM AOR from Shaw. SCAR (Strike Coordination and Reconnaissance) mission. Sumter, SC. Primary USAF Viper wing for Middle East deployments.'},
  {n:'Seymour Johnson AFB',lat:35.34,lon:-77.96,c:'US',t:'USAF',d:'4th Fighter Wing — F-15E Strike Eagle (dual-role air superiority and deep interdiction strike). 3 operational fighter squadrons. 916th Air Refueling Wing (AFRC KC-46A Pegasus). One of the most combat-deployed fighter wings since 9/11. Goldsboro, NC.'},
  {n:'Moody AFB',lat:30.97,lon:-83.19,c:'US',t:'USAF',d:'23rd Wing. HH-60W Jolly Green II (combat search and rescue). HC-130J Combat King II (aerial refueling of helicopters). A-29 Super Tucano (light attack/close air support). Guardian Angel weapon system — pararescuemen who recover downed aircrew behind enemy lines. Valdosta, GA.'},
  {n:'Beale AFB',lat:39.14,lon:-121.44,c:'US',t:'USAF',d:'9th Reconnaissance Wing — operates U-2 Dragon Lady (70,000ft altitude, single pilot, 12-hour missions) and RQ-4 Global Hawk (unmanned, 60,000ft, 32-hour endurance). The "Eyes of the Air Force." Provides strategic high-altitude ISR to combatant commanders worldwide. Only operational U-2 base. Marysville, CA.'},
  {n:'Travis AFB',lat:38.26,lon:-121.93,c:'US',t:'USAF',d:'60th Air Mobility Wing — largest air mobility wing in USAF. C-5M Super Galaxy (largest US military aircraft), C-17 Globemaster III, KC-10 Extender. "Gateway to the Pacific" — primary departure point for all airlift to INDOPACOM theater. David Grant USAF Medical Center. Fairfield, CA (between Sacramento and San Francisco).'},
  {n:'Fairchild AFB',lat:47.62,lon:-117.66,c:'US',t:'USAF',d:'92nd Air Refueling Wing — KC-135 Stratotanker. USAF SERE School (Survival, Evasion, Resistance, Escape) — all combat aircrew train here to survive if shot down and resist interrogation as POWs. One of the most intense military training courses. Spokane, WA.'},
  {n:'Mountain Home AFB',lat:43.04,lon:-115.87,c:'US',t:'USAF',d:'366th Fighter Wing "Gunfighters." F-15E Strike Eagle and F-15SG. Composite air wing model — different aircraft types in one wing for rapid deployment of a self-contained air combat package. 12,000 sq miles of training airspace. Mountain Home, ID.'},
  {n:'Cannon AFB',lat:34.38,lon:-103.32,c:'US',t:'USAF',d:'27th Special Operations Wing (AFSOC). MQ-9 Reaper (armed ISR), AC-130J Ghostrider (airborne gunship), CV-22 Osprey (tiltrotor infiltration), MC-130J Commando II. Conducts special operations air missions in support of SOCOM and geographic combatant commands. Clovis, NM.'},
  {n:'Holloman AFB',lat:32.85,lon:-106.10,c:'US',t:'USAF',d:'49th Wing. MQ-9 Reaper initial qualification training — all new USAF RPA pilots train here. German Air Force Tactical Training Center — Luftwaffe operates Tornado jets in the clear New Mexico skies. Adjacent to White Sands Missile Range. High-altitude desert environment ideal for flying year-round. Alamogordo, NM.'},
  {n:'Vandenberg SFB',lat:34.74,lon:-120.57,c:'US',t:'USSF',d:'Space Launch Delta 30. Only US military space launch facility for polar and sun-synchronous orbits (critical for spy satellite launches). Minuteman III ICBM test launches — operational missiles fired from silos in Montana/Wyoming to Kwajalein Atoll impact zone. SpaceX, ULA, and Firefly commercial launches. Santa Barbara County, CA coast.'},
  {n:'Patrick SFB',lat:28.24,lon:-80.61,c:'US',t:'USSF',d:'Space Launch Delta 45. Manages Eastern Range including Cape Canaveral Space Force Station — America\'s primary orbital launch site. 45th Weather Squadron provides launch weather forecasts. Supports NASA, SpaceX, ULA, and classified NRO launches. 45th Operations Group controls downrange tracking stations. Cocoa Beach, FL.'},
  {n:'Buckley SFB',lat:39.72,lon:-104.75,c:'US',t:'USSF',d:'Space Delta 4 (Missile Warning). SBIRS (Space Based Infrared System) ground station — processes satellite data detecting ballistic missile launches worldwide in real-time. Defense Support Program ground stations. NRO facilities. ANG F-16 alert aircraft. Aurora, CO (Denver metro).'},
  {n:'Peterson SFB',lat:38.81,lon:-104.72,c:'US',t:'USSF',d:'US Space Command (USSPACECOM) HQ — commands all military space operations. NORAD (North American Aerospace Defense Command) and US Northern Command (USNORTHCOM) HQ inside Cheyenne Mountain nearby. Space Operations Command (SpOC). Colorado Springs, CO. The nerve center of US military space and homeland defense.'},
  {n:'Schriever SFB',lat:38.80,lon:-104.53,c:'US',t:'USSF',d:'Space Delta 8 (Satellite Communications and Navigation Warfare) and Space Delta 9 (Orbital Warfare). GPS Master Control Station — operates the entire Global Positioning System constellation (31 satellites). Provides positioning, navigation, and timing for all US and allied military forces worldwide. Also operates AEHF and WGS military communications satellites. Colorado Springs.'},
  {n:'Scott AFB',lat:38.55,lon:-89.85,c:'US',t:'USAF',d:'US Transportation Command (USTRANSCOM) HQ — controls all military logistics, airlift, sealift, and surface transport for the entire Department of Defense. Air Mobility Command (AMC) HQ — commands all tanker and airlift aircraft. If it moves in the US military, it\'s coordinated from Scott. 375th Air Mobility Wing. Belleville, IL (St. Louis metro).'},
  {n:'Wright-Patterson AFB',lat:39.83,lon:-84.05,c:'US',t:'USAF',d:'Air Force Materiel Command (AFMC) HQ — responsible for research, development, testing, and acquisition of all USAF weapons systems. Air Force Research Laboratory (AFRL) — $4.6B annual R&D. National Air and Space Intelligence Center (NASIC) — produces intelligence on foreign aerospace threats. Air Force Institute of Technology (AFIT). National Museum of the US Air Force. Dayton, OH. Where the future of air and space power is built.'},
  // ── US CONUS — JOINT BASES ──
  {n:'Joint Base Andrews',lat:38.81,lon:-76.87,c:'US',t:'USAF',d:'89th Airlift Wing "The Doves." Home of Air Force One (VC-25A/B, modified 747-200) — SAM 28000 and SAM 29000. Presidential airlift for POTUS, VPOTUS, SecDef, and foreign heads of state. Only military airfield where the president boards Air Force One. 316th Wing manages joint operations. All major presidential foreign trips depart from Andrews. Marine Helicopter Squadron One (HMX-1) coordinates Marine One arrivals at the 12th Aviation Battalion. 10 miles SE of Washington DC. Every POTUS since FDR has used this field.'},
  {n:'JB Langley-Eustis',lat:37.08,lon:-76.36,c:'US',t:'USAF',d:'Joint Base Langley-Eustis. Air Combat Command (ACC) HQ — commands all USAF combat air forces (15th AF, 25th AF, and numbered air forces). 1st Fighter Wing — oldest continuously active fighter wing in USAF. F-22A Raptor air superiority: 2 operational squadrons of the world\'s premier stealth fighter. 192nd Fighter Wing (Virginia ANG, F-22A). Ft Eustis component: Army Transportation School, Avn Ctr elements. Hampton Roads, VA.'},
  {n:'JB McGuire-Dix-Lakehurst',lat:40.01,lon:-74.59,c:'US',t:'USAF',d:'Three-service Joint Base covering 42,000 acres. 305th Air Mobility Wing (C-17A Globemaster III, KC-10A Extender) + 87th Air Base Wing. Handles 40%+ of all DoD airlift departures from the eastern US — primary portal for troop and equipment deployment to Europe and Middle East. NJ Army National Guard and Navy Lakehurst (blimp history). Burlington County, NJ. FEMA Mass Casualty Exercise site.'},
  {n:'JB Charleston',lat:32.90,lon:-80.04,c:'US',t:'USAF',d:'437th Airlift Wing + 315th AW (AFRC C-17). C-17 Globemaster III — primary strategic airlift and heavy equipment transport to Africa, Europe, and CENTCOM. DLA Distribution depot co-located. Handles enormous DoD cargo flow via Charleston Harbor (adjacent commercial port). Air Mobility Command key node. Critical for SOF insertion (JSOC elements trained for rapid deployment from Charleston). South Carolina.'},
  {n:'JB Anacostia-Bolling',lat:38.83,lon:-77.02,c:'US',t:'USAF',d:'Defense Intelligence Agency (DIA) HQ — 17,000 employees, all-source military intelligence for combatant commanders and national-level customers. DIA produces foundational intelligence on foreign militaries, order of battle, weapons systems capabilities. 11th Wing (presidential helicopter fleet support — VH-3D Sea King, VH-60N Whitehawk). Washington Navy Yard adjacent (Navy Judge Advocate). Anacostia waterfront, Washington DC. Joint USAF-USN installation inside the capital.'},
  // ── US CONUS — NUCLEAR BOMBER & ICBM BASES ──
  {n:'Whiteman AFB',lat:38.72,lon:-93.55,c:'US',t:'USAF',d:'509th Bomb Wing "Spirits of Global Power." The ONLY B-2A Spirit stealth bomber base — all 20 operational aircraft stationed here. Each B-2 costs $2.1B. Can carry 80× 500lb bombs, 16× B61/B83 nuclear gravity bombs, or 16× MOP (Massive Ordnance Penetrator, 30,000 lbs) bunker-busters. Penetrates every known adversary air defense undetected. Nuclear-armed primary delivery platform for US Air-Leg of the nuclear triad. Also hosts 131st BW (Missouri ANG, B-2). AFGSC. 509th BW traces lineage to Enola Gay mission. Deployed to Afghanistan 2001, Libya 2011, Korea contingency plans. Knob Noster, MO.'},
  {n:'Offutt AFB',lat:41.12,lon:-95.91,c:'US',t:'USAF',d:'US Strategic Command (USSTRATCOM) HQ — commands ALL US strategic nuclear forces (ICBM, SSBN, bomber triad) plus Space, Cyberspace, Joint Electronic Warfare, and Missile Defense. E-4B Nightwatch "Doomsday Plane" (National Airborne Operations Center) — nuclear command post aircraft, one always on 24/7 strip alert to survive nuclear decapitation strike. If DC is destroyed, US nuclear retaliation is commanded from Offutt\'s E-4B. 55th Wing: RC-135V/W Rivet Joint (SIGINT), RC-135U Combat Sent, WC-135 Constant Phoenix (nuclear detonation sniffing), OC-135 Open Skies. Papillion, NE. Most strategically critical US Air Force base.'},
  {n:'Malmstrom AFB',lat:47.51,lon:-111.19,c:'US',t:'USAF',d:'341st Missile Wing. 150 Minuteman III ICBMs in 50 Missile Alert Facilities (MAFs) across 13,000 sq miles of north-central Montana. 15 Launch Control Centers (LCCs) — hardened underground capsules where 2-person missile combat crews maintain 24/7 nuclear launch alert. Each ICBM carries 1-3 W78/W87 warheads (300-475kt). All 150 missiles capable of striking any target in Russia or China within 30 minutes of presidential launch authorization. Air Force Global Strike Command. Great Falls, MT.'},
  {n:'Minot AFB',lat:48.42,lon:-101.36,c:'US',t:'USAF',d:'"The Only Mighty." World\'s ONLY dual nuclear-mission base: 5th Bomb Wing (B-52H Stratofortress — 18 aircraft, nuclear-certified for ALCM AGM-86B, LRSO, gravity bombs) + 91st Missile Wing (150 Minuteman III ICBMs across 15,000 sq miles of North Dakota). Air Force Global Strike Command. B-52H can carry 70,000 lbs weapons — 8 nuclear cruise missiles + 4 gravity bombs simultaneously. 2007 "bent spear" incident: ACMs accidentally flown to Barksdale. Ward County, ND. In any nuclear exchange, Minot is the top-3 adversary first-strike target.'},
  {n:'Ellsworth AFB',lat:44.15,lon:-103.10,c:'US',t:'USAF',d:'28th Bomb Wing — first base to receive B-21 Raider (declared Initial Operational Capability December 2024). The B-21 Raider is America\'s newest stealth bomber, replacing both B-1B and eventually B-2A. Flying wing design optimized for penetrating the most advanced integrated air defense systems (Russian S-500, Chinese HQ-9B). 114th FW (South Dakota ANG, F-16). Air Force Global Strike Command. Black Hills, western South Dakota. The B-21 program restores USAF strategic bomber capacity to 100+ aircraft by 2040s.'},
  {n:'Barksdale AFB',lat:32.50,lon:-93.66,c:'US',t:'USAF',d:'Air Force Global Strike Command (AFGSC) HQ — commands ALL USAF nuclear bomber and ICBM forces (~60,000 Airmen, 450 ICBMs, 60+ bombers). 2nd Bomb Wing (B-52H Stratofortress — 18 aircraft). 307th BW (AFRC B-52H). B-52 carries 70,000 lbs of weapons — conventional and nuclear. Most combat hours of any US bomber platform since 9/11. Nuclear gravity bombs B61-12 integration ongoing. Air-Launched Cruise Missile (ALCM) fleet. Bossier City, LA (Shreveport metro). AFGSC is the nuclear execution authority.'},
  {n:'Dyess AFB',lat:32.42,lon:-99.86,c:'US',t:'USAF',d:'7th Bomb Wing (B-1B Lancer "the Bone" — 24 aircraft). B-1B carries largest conventional weapons payload in USAF (75,000 lbs) — 24× JDAM, 24× JASSM-ER, or hypersonic AGM-183A ARRW development platform. Supersonically capable (Mach 1.25). Nuclear-retired since 1994 but best conventional strike bomber in USAF inventory. 317th Airlift Group (C-130J-30). Deployed continuously to CENTCOM/INDOPACOM. Abilene, TX. Air Force Global Strike Command.'},
  // ── US CONUS — ADDITIONAL USAF ──
  {n:'Tyndall AFB',lat:30.07,lon:-85.61,c:'US',t:'USAF',d:'325th Fighter Wing. F-22A Raptor formal training unit (ONLY F-22 FTU) — produces all new F-22 pilots. F-35A transitioning in 2025-2027. Rebuilt after category 5 Hurricane Michael (Oct 2018, $4.7B damage) as a model "base of the future" with microgrids, autonomous systems, and advanced infrastructure. 53rd Weapons Evaluation Group (GWEP — Gulf-Range Weapon Effectiveness Tests). Radar test ranges over Gulf of Mexico. Panama City, FL.'},
  {n:'Eielson AFB',lat:64.67,lon:-147.10,c:'US',t:'USAF',d:'354th Fighter Wing. Two squadrons of F-35A Lightning II — first Arctic-capable F-35 base. Russia intercepts occur 100+ miles south over Bering Sea with regularity. 168th Wing (Alaska ANG KC-135R tankers). Pacific Air Forces (PACAF). Joint Pacific Alaska Range Complex (JPARC) — 67,000 sq miles of airspace including Eielson and Ft Greely integration. Trains for Arctic air superiority and cold-weather operations (-40°F). Alaskan approach to the North Pole and Russia. Fairbanks area, AK.'},
  {n:'Maxwell AFB',lat:32.38,lon:-86.36,c:'US',t:'USAF',d:'Air University (AU) — the USAF\'s professional military education center. Air War College (O-6/Brigadier General equivalent), Air Command and Staff College (O-5 level), Squadron Officer School (O-3/O-4), School of Advanced Air and Space Studies (SAASS — "Jedi Knights"). Curtis LeMay Center for Doctrine Development and Education — where USAF doctrine is written. Air Force Historical Research Agency. Wright Brothers Hill. Montgomery, AL.'},
  {n:'Robins AFB',lat:32.64,lon:-83.59,c:'US',t:'USAF',d:'78th Air Base Wing. Warner Robins Air Logistics Complex (WR-ALC) — depot maintenance for F-15E, F-15C/D, C-130, H-60 helicopters: largest air logistics complex east of the Mississippi. Air Force Sustainment Center. 116th Air Control Wing (E-8C JSTARS — Ground Surveillance Radar aircraft, sole squadron of 16 aircraft). JSTARS provides real-time ground battle tracking. Macon area, GA. 26,000 DoD employees — largest single-site DoD employer in Georgia.'},
  {n:'Tinker AFB',lat:35.41,lon:-97.39,c:'US',t:'USAF',d:'Air Force Sustainment Center (AFSC) HQ. Oklahoma City Air Logistics Complex (OC-ALC) — depot: B-52H airframes, E-3 AWACS, KC-135, E-6B Mercury (TACAMO nuclear communications). 552nd Air Control Wing (all 16 E-3 Sentry AWACS in USAF). Boeing depot for B-52 Radar Modernization Program. Naval Aviation Center for JSTARS and E-6B. Oklahoma City metro. OC-ALC is the largest employer in Oklahoma.'},
  {n:'Hill AFB',lat:41.12,lon:-111.98,c:'US',t:'USAF',d:'388th Fighter Wing (first combat-coded F-35A wing, operational 2015) + 419th FW (AFRC F-35A). Ogden Air Logistics Complex (OO-ALC) — THE F-35 sustainment depot for all USAF F-35s (domestic and most international operators). Also maintains A-10, C-130, and Minuteman III ICBMs. Air Force Sustainment Center. Largest employer in Utah (~32,000). Ogden, UT. If the F-35 were grounded globally, Hill AFB is where it would be repaired.'},
  {n:'Edwards AFB',lat:34.91,lon:-117.88,c:'US',t:'USAF',d:'Air Force Test Center (AFTC). Air Force Test Pilot School (TPS) — trains military and NASA test pilots. Where every USAF aircraft is flight tested before entering service: B-21 Raider, F-35, F-22, B-2 were all proven here. 307,000+ sq miles of restricted airspace over Mojave Desert. Rogers Dry Lake — emergency shuttle landing strip. Chuck Yeager broke sound barrier here (Oct 14, 1947). Edwards is the birthplace of US aerospace — X-15, X-1, lifting bodies, all developed in this airspace. Antelope Valley, CA.'},
  {n:'Kirtland AFB',lat:35.05,lon:-106.57,c:'US',t:'USAF',d:'Air Force Nuclear Weapons Center (AFNWC) — manages all USAF nuclear weapon system development, life extension, safety, and delivery certifications. AFRL Directed Energy Directorate — world\'s most advanced high-energy laser and high-power microwave research. Sandia National Laboratories (SNL) adjacent — designs all US nuclear warheads. Kirtland Underground Munitions Storage Complex (KUMSC) — estimated ~2,000 B61 nuclear gravity bombs stored (largest US nuclear weapons stockpile). 58th Special Operations Wing (V-22 Osprey, MH-60 training). Albuquerque, NM.'},
  {n:'Cheyenne Mountain SFS',lat:38.74,lon:-104.85,c:'US',t:'USSF',d:'Cheyenne Mountain Space Force Station (formerly NORAD-ADCOM Combat Operations Center). Embedded inside 2,000-foot Cheyenne Mountain granite — 15 free-standing steel buildings on 1,319 giant springs, designed to absorb nuclear blast. NORAD Command Operations Center: monitors all aerospace threats to North America. Fuses data from SBIRS, BMEWS radar, and space surveillance — detects ballistic missile launches within 3 minutes. STRATCOM backup. Active modernization program "Cheyenne Mountain Complex Improvements." Colorado Springs area, CO.'},
  {n:'Raven Rock (Site R)',lat:39.72,lon:-77.47,c:'US',t:'DOD',d:'"The Rock." Raven Rock Mountain Complex — Alternate Joint Communications Center (AJCC). Underground Pentagon bored into Blue Ridge granite. Continuity of Government (COG) bunker for senior DoD leadership survival in nuclear war. Can house ~3,000 personnel. Back-up National Military Command Center (NMCC). Hardened C2 for strategic forces with EMP-protected communications. Classified since 1953. Shares COG mission with Mt. Weather (FEMA) and White House Situation Room. Blue Ridge Summit, PA (Adams County).'},
  // ── US CONUS — USAF OPERATIONAL BASES ──
  {n:'Eglin AFB',lat:30.5475,lon:-86.6407,c:'US',t:'USAF',d:'96th Test Wing. Largest USAF base by area (724 sq miles of Florida Panhandle + Gulf of Mexico). Air Armament Center — tests ALL air-delivered weapons: JDAM, JASSM-ER, AIM-120 AMRAAM, GBU-57 MOP (30,000-lb bunker buster), AGM-183A ARRW hypersonic. 7th Special Forces Group (Airborne). 1st SOW aviation support (Hurlburt). Air Force Munitions Center. 96,000+ employees. Valparaiso, FL. Where the entire US air-delivered weapons arsenal is validated before combat.'},
  {n:'Davis-Monthan AFB',lat:32.1665,lon:-110.8655,c:'US',t:'USAF',d:'355th Wing — last active-duty A-10C Thunderbolt II wing. 309th AMARG "The Boneyard" — 4,000+ aircraft in open-air Sonoran Desert storage (B-52, B-1, F-15, F-16, A-10, C-130 awaiting reactivation or parts). Value exceeds $35B. 563rd Rescue Group (HH-60W Jolly Green II combat SAR). Air Force Materiel Command. Tucson, AZ.'},
  {n:'Dover AFB',lat:39.1241,lon:-75.4642,c:'US',t:'USAF',d:'436th AW + 512th AW (AFRC). C-5M Super Galaxy — world\'s largest military cargo aircraft (270,000 lb payload). USAF Mortuary Affairs Operations Center — sole DoD facility processing all US service members killed overseas. Armed Forces Medical Examiner System. Primary East Coast strategic airlift node for Europe, CENTCOM, Africa. Delaware.'},
  {n:'Little Rock AFB',lat:34.9032,lon:-92.1371,c:'US',t:'USAF',d:'19th Airlift Wing. C-130J-30 Super Hercules formal training unit — only C-130J FTU in USAF; trains all pilots and loadmasters. Largest C-130 fleet in DoD. Tactical airdrop, airborne assault, SOF support. 314th AW (AFRC). Air Mobility Command. Pulaski County, AR.'},
  {n:'Grand Forks AFB',lat:47.958,lon:-97.3748,c:'US',t:'USAF',d:'319th ARW. KC-135R Stratotanker air refueling. RQ-4 Block 30 Global Hawk strategic ISR — patrols denied territory over Russia and China. Proximity to Canadian border and Arctic approach corridors. 148th FW (Minnesota ANG). Air Mobility/ACC. Grand Forks County, ND.'},
  {n:'Hanscom AFB',lat:42.4596,lon:-71.2769,c:'US',t:'USAF',d:'66th ABW. AFLCMC Battle Management C2 Directorate — acquires ABMS (Advanced Battle Management System, AWACS replacement), E-3 Sentry, and all C2 programs. MIT Lincoln Laboratory adjacent — pioneered SAGE radar defense. Air Force Research Laboratory. $7B+ annual acquisition. Bedford, MA.'},
  {n:'McConnell AFB',lat:37.6255,lon:-97.2516,c:'US',t:'USAF',d:'22nd ARW. KC-46A Pegasus primary formal training unit — trains all USAF KC-46 crews; only KC-46 FTU in USAF. 931st ARW (AFRC). Air refueling is the ultimate force multiplier — one tanker enables strike aircraft to reach any target on earth. Wichita, KS. Air Mobility Command.'},
  {n:'Keesler AFB',lat:30.414,lon:-88.9161,c:'US',t:'USAF',d:'81st Training Wing. Cyber/comms/weather training (AETC). 53rd Weather Reconnaissance Squadron "Hurricane Hunters" — WC-130J aircraft, only DoD platform certified to fly INTO Atlantic hurricanes, feeding NHC forecast data. 403rd Wing (AFRC WC-130J). Biloxi, MS.'},
  {n:'Goodfellow AFB',lat:31.4369,lon:-100.4019,c:'US',t:'USAF',d:'17th Training Wing. Joint intelligence training for ALL services — cryptologic language, SIGINT, imagery, and all-source analysts. Army, Navy, USMC, USSF, Coast Guard students alongside Airmen. Fire protection career field. AETC. San Angelo, TX.'},
  {n:'Altus AFB',lat:34.6545,lon:-99.2867,c:'US',t:'USAF',d:'97th Air Mobility Wing. Only C-17A Globemaster III FTU in USAF + KC-135/KC-46A training; ~1,500 aircrew trained annually. Air Mobility Command. Altus, OK.'},
  {n:'Francis E. Warren AFB',lat:41.1653,lon:-104.8651,c:'US',t:'USAF',d:'90th Missile Wing (AFGSC). 150 Minuteman III ICBMs spread across 12,600 sq miles of WY/NE/CO. 20th Air Force HQ (commands all USAF ICBM wings). Oldest active USAF installation (est. 1867). 24/7 nuclear deterrence alert since 1959. USSTRATCOM support. Cheyenne, WY.'},
  {n:'Los Angeles AFB',lat:33.9392,lon:-118.3911,c:'US',t:'USSF',d:'Space Systems Command (SSC) — acquires ALL US military satellites: GPS Block III, AEHF (nuclear-hardened comms), WGS (broadband SATCOM), SBIRS/OPIR (missile warning), space domain awareness. $13B+ annual budget. 61st ABG. Partners with Aerospace Corporation (FFRDC). El Segundo, CA. Every GPS-guided weapon depends on programs managed here.'},
  {n:'Arnold AFB',lat:35.3331,lon:-86.0707,c:'US',t:'USAF',d:'AEDC — Arnold Engineering Development Complex. World\'s largest aerospace ground test facility. 58 wind tunnels, altitude chambers, propulsion test cells. Tests every US aircraft/missile before flight: F-35 engine, B-21 aero, hypersonic vehicles, ICBM reentry bodies. Altitude sim to 300,000 ft. 704th Test Group. Tullahoma, TN. Named for Gen Hap Arnold.'},
  // ── US CONUS — SUBMARINE & NAVAL ──
  {n:'SUBASE New London',lat:41.45,lon:-72.10,c:'US',t:'USN',d:'"Home of the Submarine Force." Naval Submarine Base New London (actually in Groton, CT). Only submarine base on the US East Coast. 18+ nuclear attack submarines (SSNs) homeported — Los Angeles, Virginia, and Seawolf class. Naval Submarine School — trains every new US submariner in nuclear operations, tactics, and survival. Commander, Submarine Force Atlantic (COMSUBLANT). Electric Boat shipyard next door builds ALL US submarines. "Submarine Capital of the World." Groton, CT.'},
  {n:'Naval Base Guam',lat:13.44,lon:144.65,c:'GU',t:'USN',d:'Commander, Naval Forces Marianas. Apra Harbor — only US deep-water, typhoon-safe port in the western Pacific (between Pearl Harbor and Japan). Forward-deployed attack submarines (SSNs), guided missile destroyer (DDG) rotations, and P-8A maritime patrol. SSGN (Ohio-class guided missile submarine) visits and support. Marine Corps Base Camp Blaz under construction. THAAD battery. Expanding rapidly as US pivots to contest Chinese expansion — $9B in construction underway. 2,800nm from Shanghai, 1,500nm from Taiwan.'},
  {n:'NS Great Lakes',lat:42.30,lon:-87.84,c:'US',t:'USN',d:'Recruit Training Command (RTC) — the Navy\'s ONLY Boot Camp (consolidation of all training completed 2000). ~38,000 recruits trained annually through 8-week course. Naval Health Clinic. Naval Station Great Lakes A School (technical training for Hospitalman, Operations Specialist, etc.). The only place in the US Navy where sailors begin their service. North Chicago, IL (Lake Michigan shore). Named for Admiral Ernest King Memorial Lake, largest freshwater training body available.'},
  {n:'NAS Fallon',lat:39.42,lon:-118.70,c:'US',t:'USN',d:'"Top Gun." Naval Strike and Air Warfare Center (NSAWC) — Weapons and Tactics Wing of the Navy. TOPGUN (Naval Fighter Weapons School) relocated from Miramar in 1996. Carrier Air Wing integration training: every carrier air wing deploys to Fallon for 6 weeks before deployment, training combined strike packages (F/A-18E/F, EA-18G, E-2D, MH-60R/S). Naval Warfare Development Command. Desert ranges replicate all threat environments. Churchill County, NV. The movie "Top Gun" (1986, 2022) is based on training conducted here.'},
  {n:'NS Newport',lat:41.52,lon:-71.33,c:'US',t:'USN',d:'Naval War College (NWC) — America\'s oldest and most prestigious military graduate school (established 1884). Educates flag officers (O-7+) and senior civil servants. Curriculum: strategic theory, international law, joint military operations. Graduates include Chester Nimitz, Raymond Spruance. Surface Warfare Officers School (SWOS) — trains all surface warfare officers. Naval Justice School. Officer Training Command. Naval Undersea Warfare Center (NUWC) Division Newport — torpedo and ASW research. Narragansett Bay, RI.'},
  {n:'NS Mayport',lat:30.39,lon:-81.42,c:'US',t:'USN',d:'Commander, US 4th Fleet HQ — commands all US naval forces assigned to US Southern Command (Caribbean, Central and South America, ~68M sq miles). Homeport: 2 DDGs (Arleigh Burke-class destroyers), 1 LCS (Littoral Combat Ship), amphibious ships. Fleet Readiness Center Southeast (FRC-SE). Naval Station Mayport is the third largest US naval station by ship count. Atlantic Fleet training exercises, Carrier Strike Group deployments. Jacksonville, FL.'},
  {n:'NAS Patuxent River',lat:38.29,lon:-76.41,c:'US',t:'USN',d:'"Pax River." Naval Air Warfare Center Aircraft Division (NAWCAD). Where ALL US Navy and Marine Corps aircraft are flight tested and approved before entering fleet service — F-35B/C, F/A-18E/F, MH-60, E-2D, MQ-25. Naval Test Pilot School (NTPS) — trains military and civilian test pilots. ~5,000 scientists, engineers, and test pilots. MUOS (Mobile User Objective System) satellite ground station. "The place where naval aviation\'s future is decided." Southern Maryland, Chesapeake Bay shoreline.'},
  {n:'NAS Lemoore',lat:36.33,lon:-119.95,c:'US',t:'USN',d:'Commander, Strike Fighter Wing Pacific (SFWP) — West Coast Master Jet Base. 13 F/A-18E/F Super Hornet squadrons providing strike fighters for all West Coast carrier air wings (CVN-70, 72, 74, 76). VFA-122 "Flying Eagles" (Fleet Replacement Squadron — trains new Super Hornet pilots). F-35C transitioning fleet building. 7,800+ personnel. Kings County, Central Valley, California. Every West Coast carrier air wing deploys its strike fighters from this installation.'},
  // ── US CONUS — NAVY OPERATIONAL BASES ──
  {n:'Naval Base San Diego',lat:32.676,lon:-117.1187,c:'US',t:'USN',d:'HQ Commander Naval Surface Forces Pacific — commands all 85+ Pacific Fleet surface ships. Homeport: 50+ DDGs, CGs, LCS, and amphibious ships. Naval Medical Center San Diego. ~130,000 military, civilian, and family members. San Diego Bay, CA. Largest Navy base on US West Coast; primary Pacific Fleet surface warfare hub.'},
  {n:'Naval Base Kitsap Bangor',lat:47.7266,lon:-122.7236,c:'US',t:'USN',d:'Strategic Weapons Facility Pacific (SWFPAC) — nuclear warhead handling and storage. 8 Ohio-class SSBNs homeported, each armed with 20 Trident II D5 SLBMs (up to 8 W76/W88 warheads, 100–475kt). ~1,600+ deployed nuclear warheads at sea at any time. Commander Submarine Group 9. One of the most heavily secured installations in DoD. Kitsap County, WA.'},
  {n:'Naval Base Kitsap Bremerton',lat:47.5618,lon:-122.6373,c:'US',t:'USN',d:'Puget Sound Naval Shipyard (PSNS&IMF) — nuclear carrier refueling and complex overhaul (RCOH). USS Nimitz (CVN-68) and USS John C. Stennis (CVN-74) homeport. ~12,000 military and civilian workers. PSNS can drydock and refuel any nuclear ship in the fleet. Kitsap Peninsula, WA.'},
  {n:'Naval Base Point Loma',lat:32.6934,lon:-117.2506,c:'US',t:'USN',d:'Commander Submarine Force Pacific (COMSUBPAC) — commands 30+ Pacific Fleet SSNs and SSGNs. Ballast Point SSN homeport. NIWC Pacific (C4I research). 3rd Naval Special Warfare Group (NSW). San Diego, CA. All Pacific submarine operations are coordinated from this HQ.'},
  {n:'JEB Little Creek-Ft Story',lat:36.9146,lon:-76.1319,c:'US',t:'USN',d:'Joint Expeditionary Base Little Creek-Fort Story. Commander Navy Expeditionary Combat Command. Homeport for SEAL Teams 2, 4, 8, 10 — East Coast Naval Special Warfare. Amphibious Construction Battalions. EOD Mobile Units. Beach assault ranges. ~36,000 personnel. Virginia Beach, VA. Global SEAL team deployments originate here.'},
  {n:'NAS Key West',lat:24.5834,lon:-81.6694,c:'US',t:'USN',d:'"Fighter Town South." Air-to-air combat maneuvering training. NSAWC detachment. Fleet Adversary Squadrons (threat aircraft simulation). Joint Interoperability Air Combat Course. USCG Air Station Key West. JTF-Southeast counter-narcotics. Southernmost US military installation — 90 miles from Cuba. Monroe County, FL.'},
  {n:'NAS Whiting Field',lat:30.7118,lon:-87.0288,c:'US',t:'USN',d:'Training Air Wing Six. Primary flight training — T-6B Texan II (fixed-wing) and TH-57C/TH-73A helicopter tracks. More Navy and Marine Corps pilots earn wings here than at any other installation. Coast Guard Aviation Training Center. Santa Rosa County (Milton), FL. The pipeline that fills all carrier and helicopter squadrons begins here.'},
  {n:'NSF Dahlgren',lat:38.3273,lon:-77.0297,c:'US',t:'USN',d:'NSWC Dahlgren — primary Navy surface warfare research. Develops Tomahawk Block V, Naval Strike Missile, electromagnetic railgun, directed energy, AEGIS combat system upgrades. 51-mile over-water gun range (Potomac River). 4,000+ scientists. Ship self-defense. Ballistic missile defense. King George County, VA.'},
  {n:'Camp Blaz',lat:13.5795,lon:144.8415,c:'GU',t:'USMC',d:'Marine Corps Base Camp Blaz — first new USMC base in 70+ years (est. 2020). Named for BGen Vicente T. Blaz, first Guamanian Marine general and congressman. III MEF forward element. Staging for I MEF reinforcements. Marine Littoral Regiment (anti-ship, distributed Pacific ops). $8.7B INDOPACOM posture program. Barrigada, Guam.'},
  // ── US CONUS — MARINE CORPS ──
  {n:'MCAS Miramar',lat:32.87,lon:-117.14,c:'US',t:'USMC',d:'"Fightertown USA" (original Top Gun 1969-1996 location). Marine Aircraft Group 11 (MAG-11) — 3rd Marine Aircraft Wing (3rd MAW). F-35B Lightning II (STOVL — short takeoff/vertical landing for amphibious assault ships): VMFA-121, VMFA-211, VMFA-225. F-35C (carrier variant): VMFA-314 "Black Knights." EA-18G coordination via Navy. Massive combined arms air complex supporting I MEF (Camp Pendleton). San Diego, CA.'},
  {n:'MCRD San Diego',lat:32.72,lon:-117.13,c:'US',t:'USMC',d:'Marine Corps Recruit Depot San Diego — West Coast male basic training. All male recruits from west of the Mississippi River. 13-week boot camp including Crucible (54-hour final event). ~17,000 recruits annually. Rifle qualification at Edson Range (Camp Pendleton). East Side: Western Recruiting Region HQ. Oldest active USMC recruit depot (1919). Urban San Diego location — neighbors include San Diego International Airport. The most physically demanding training program in the US military services.'},
  {n:'MCRD Parris Island',lat:32.34,lon:-80.70,c:'US',t:'USMC',d:'"The Swamp." Marine Corps Recruit Depot Parris Island — East Coast male recruits (east of Mississippi) and ALL female Marine recruits. 13-week boot camp. ~20,000 recruits annually. Island surrounded by tidal marshes — no exit without detection. Female recruits have trained separately here since 1943. Site of 1956 Ribbon Creek incident (6 recruits drowned during nighttime march — led to major training reforms). Eastern Recruiting Region HQ. Beaufort County, SC.'},
  {n:'MCAS Yuma',lat:32.66,lon:-114.61,c:'US',t:'USMC',d:'Marine Air Weapons and Tactics Squadron One (MAWTS-1) — the USMC\'s premier aviation tactics and weapons employment school. All Marine aviation Weapons and Tactics Instructor (WTI) Course graduates here (6-week course, prerequisite for squadron-level tactics billets). Every Marine aviation platform integrates: F-35B, AH-1Z, UH-1Y, CH-53E/K, MV-22B, KC-130J. Yuma Proving Ground (US Army) adjacent for live-fire. 354 days of sunshine/year — ideal for aviation. Yuma, AZ.'},
  {n:'MCAS Beaufort',lat:32.48,lon:-80.72,c:'US',t:'USMC',d:'Marine Fighter Attack Training Squadron 501 (VMFAT-501) — primary East Coast F-35B and F-35C Formal Learning Center. VMFA-115 "Silver Eagles" (F-35C, carrier-based). F-35B pilots trained for LHD/LHA assault ship operations. Supports USS Bataan-class and America-class forward deployment of USMC aviation detachments. Air Station shares airfield with Beaufort County Airport. South Carolina Lowcountry — 60 miles north of Savannah, GA.'},
  {n:'MCAGCC 29 Palms',lat:34.07,lon:-116.16,c:'US',t:'USMC',d:'Marine Corps Air Ground Combat Center Twentynine Palms (MCAGCC). Largest active USMC installation — 640,000 acres of Mojave Desert. Home of Marine Air-Ground Task Force Training Command (MAGTFTC). Marine Rotational Force — CAX (Combined Arms Exercise): only place where MAGTF elements conduct full-scale integrated air-ground live fire exercises. Every deploying Marine Expeditionary Unit (MEU) and MEF validates here. ~11,000 Marines. Farthest CONUS garrison from any major metro area. San Bernardino County, CA.'},
  // ── US CONUS — USMC ADDITIONAL ──
  {n:'MCAS New River',lat:34.6545,lon:-77.4374,c:'US',t:'USMC',d:'2nd Marine Aircraft Wing tiltrotor and heavy lift hub. MV-22B Osprey (VMM-162, 261, 365) and CH-53E/K King Stallion heavy lift. HH-60 CSAR. Aviation combat element for East Coast MEUs. Adjacent to MCB Camp Lejeune — combined II MEF aviation-ground capability. Onslow County (Jacksonville), NC.'},
  {n:'MCB Hawaii',lat:21.4479,lon:-157.7587,c:'US',t:'USMC',d:'Marine Corps Base Hawaii (MCBH Kaneohe Bay). III MEF forward element. 3rd Marine Regiment — Pacific amphibious infantry. MCAS Kaneohe Bay: AH-1Z/UH-1Y attack and MV-22B Osprey. VMU-3 UAS operations. Pacific amphibious training ranges. Windward Oahu, HI.'},
  {n:'MCLB Albany',lat:31.5535,lon:-84.0844,c:'US',t:'USMC',d:'Marine Corps Logistics Command (MCLC) HQ. Manages Maritime Prepositioning Forces (MPF/APS-2) — equipment sets pre-positioned on ships for rapid MEF deployment. Organic industrial base: tracked vehicle and fire support system rebuild. Dougherty County (Albany), GA.'},
  // ── US CONUS — ARMY SPECIALIZED ──
  {n:'Ft Novosel (Rucker)',lat:31.33,lon:-85.72,c:'US',t:'USA',d:'Army Aviation Center of Excellence (USAACE). ALL US Army helicopter pilots trained here — AH-64 Apache, UH-60 Black Hawk, CH-47 Chinook, OH-58 Kiowa. Initial Entry Rotary Wing (IERW) course. Warrant Officer Candidate School (WOCS) — 75% of Army pilots are Warrant Officers. Aviation doctrine and tactics. Named for CW4 Vincent "Vinnie" Novosel, Medal of Honor (Vietnam, 1970). ~10,000 trainees at any time. Dale County, AL. Every Army aviator\'s career begins here.'},
  {n:'Fort Huachuca',lat:31.55,lon:-110.35,c:'US',t:'USA',d:'Army Intelligence Center of Excellence (USAICoE). Trains ALL Army intelligence officers and analysts (35-series MOS: Human Intelligence, Signals Intelligence, Imagery Intelligence, All-Source). Electronic Warfare training (EW). Network Enterprise Technology Command (NETCOM) — manages Army network infrastructure globally. NSA/CSS Arizona — major SIGINT processing facility. High-altitude (4,600ft), pristine electromagnetic environment for signals testing. Cochise County, AZ — 15 miles from Mexico. Apache country.'},
  {n:'Redstone Arsenal',lat:34.69,lon:-86.65,c:'US',t:'USA',d:'Army Materiel Command (AMC) HQ. Missile Defense Agency (MDA) — develops THAAD, Ground-Based Midcourse Defense (GMD/GBMD), Aegis BMD. Army Space and Missile Defense Command (USASMDC/ARSTRAT). Aviation and Missile Center of Excellence. Aviation and Missile Research, Development and Engineering Center (AMRDEC) — Hellfire, Patriot, HIMARS developed here. NASA Marshall Space Flight Center co-located — where Apollo-Saturn V designed. "Rocket City" Huntsville, AL. More rocket/missile R&D than any other location on earth.'},
  {n:'Fort Knox',lat:37.89,lon:-85.96,c:'US',t:'USA',d:'US Bullion Depository (Fort Knox Gold Vault) — stores ~147 million troy ounces of gold ($400B+) in hardened vault inside the installation. Army Armor Branch home. 1st Armored Brigade Combat Team (1ABCT). Human Resources Command (HRC) — manages career assignments for all 1M+ Army personnel (Active, Guard, Reserve). Army Cadet Command — manages all ROTC programs nationwide. Recruiting Command HQ. Louisville metro, KY. Vault has not been publicly audited since 1953.'},
  {n:'Fort Leavenworth',lat:39.36,lon:-94.93,c:'US',t:'USA',d:'"The Intellectual Center of the Army." Army Combined Arms Center (CAC) — develops all Army doctrine, concepts, and training. Command and General Staff College (CGSC) — ~1,200 US and 125+ allied officers earn master\'s degrees annually. School of Advanced Military Studies (SAMS) — elite 14-month program producing Army\'s top strategic planners ("Jedi Knights"). US Disciplinary Barracks (USDB) — the only maximum-security military prison in the US. Army University. Kansas City metro, KS. Oldest continuously operated US Army post west of the Mississippi (1827).'},
  {n:'Fort Leonard Wood',lat:37.74,lon:-92.14,c:'US',t:'USA',d:'Maneuver Support Center of Excellence (MSCoE). Three branch schools: US Army Engineer School (combat engineering, bridging, sappers), US Army Military Police School (law enforcement, corrections, physical security), US Army Chemical School (CBRN defense, decontamination, hazmat). Basic Combat Training (BCT) for ~50,000 trainees/year. One of largest BCT installations. Growing rapidly as cyber/electronic warfare integrated into engineer curricula. Waynesville, MO (Ozarks).'},
  {n:'Fort Irwin (NTC)',lat:35.27,lon:-116.69,c:'US',t:'USA',d:'National Training Center (NTC). 1,000-square-mile live maneuver battlefield in Mojave Desert. Army\'s premier combined arms force-on-force training environment. Brigade Combat Teams rotate through 14-day Combat Training Center (CTC) rotations against professional OPFOR. 11th Armored Cavalry Regiment "Blackhorse" — world\'s most capable OPFOR, simulating near-peer threat with real tanks, artillery, air defense, and electronic warfare. Every BCT validates here before major deployment. Full electromagnetic spectrum replication. Barstow, CA.'},
  {n:'Fort Belvoir',lat:38.71,lon:-77.16,c:'US',t:'USA',d:'National Geospatial-Intelligence Agency (NGA) HQ — processes ALL US satellite imagery and geospatial intelligence. Largest dedicated intelligence building in the world (2.3M sq ft). Army Intelligence and Security Command (INSCOM) HQ. Defense Contract Management Agency (DCMA). US Army Museum. Belvoir Research, Development, and Engineering Center (BRDEC). ~50,000 employees/contractors — major Northern Virginia intelligence hub within 15 miles of the Pentagon. Fairfax County, VA.'},
  {n:'Fort Detrick',lat:39.43,lon:-77.41,c:'US',t:'USA',d:'US Army Medical Research Institute of Infectious Diseases (USAMRIID) — America\'s primary biological defense research lab. BSL-4 (maximum biosafety) research on Ebola, Marburg, smallpox, hemorrhagic fevers, and potential bioweapon threats. National Interagency Biodefense Campus. National Cancer Institute (Frederick campus). Defense Health Agency operations. 1943-1969: primary US biological weapons offensive research site (officially dismantled by Nixon). Center of COVID-19 lab-leak hypothesis investigations. Frederick, MD.'},
  {n:'Aberdeen Proving Ground',lat:39.47,lon:-76.12,c:'US',t:'USA',d:'Army Test and Evaluation Command (ATEC) — every US Army weapons system tested here. Edgewood Chemical Biological Center (ECBC) — CBRN defense and chemical weapons detection research. Army Research Laboratory (ARL) — fundamental military science. Combat Capabilities Development Command (DEVCOM). Aberdeen was the site of WWI chemical warfare development (mustard gas testing). Every major Army vehicle from M1 Abrams to Stryker to JLTV was proven on Aberdeen test ranges. Harford County, MD, on Chesapeake Bay.'},
  {n:'Carlisle Barracks',lat:40.21,lon:-77.17,c:'US',t:'USA',d:'US Army War College (AWC) — strategic-level education for senior military leaders (O-6/Colonel and GS-15 civilian equivalents from 120+ nations). Master of Strategic Intelligence, Strategic Intelligence. Strategic Studies Institute (SSI) — Army think tank producing strategic assessments. Military Heritage Institute. US Army Heritage and Education Center. Named for Carlisle Indian Industrial School (1879-1918). Only US Army installation in Pennsylvania. Cumberland County, PA. Where generals learn to think strategically.'},
  {n:'Dugway Proving Ground',lat:40.19,lon:-112.95,c:'US',t:'USA',d:'West Desert Test Center. US Army\'s primary Chemical and Biological Defense testing installation. Tests CBRN protective equipment, detection systems, decontamination procedures, and medical countermeasures. Largest over-land restricted airspace in CONUS (~800,000 acres of Great Salt Lake Desert). Has tested chemical and biological agents in controlled environments. Extremely remote — 85 miles SW of Salt Lake City. Classified research facilities. Tooele County, UT. Nicknamed "Area 52."'},
  // ── US CONUS — ARMY SUSTAINMENT & WEAPONS ──
  {n:'Ft Gregg-Adams',lat:37.2511,lon:-77.338,c:'US',t:'USA',d:'Combined Arms Support Command (CASCOM). US Army Quartermaster School, Ordnance School, and Transportation School — sustains Army in the field (supply, maintenance, movement). Sustainment Center of Excellence. Army Logistics University. 16,000+ personnel. Prince George County (Hopewell-Petersburg), VA. Formerly Fort Lee, renamed May 2023.'},
  {n:'Picatinny Arsenal',lat:40.9462,lon:-74.553,c:'US',t:'USA',d:'DEVCOM Armaments Center. Joint Center of Excellence for Guns & Ammunition — develops ALL Army cannon, mortar, rocket, and missile warheads. M829A4 depleted uranium penetrator (Abrams 120mm). Extended-Range Cannon Artillery (ERCA) XM1299. ~3,000 scientists and engineers. Morris County, NJ. "The Home of American Firepower."'},
  {n:'Rock Island Arsenal',lat:41.5169,lon:-90.5418,c:'US',t:'USA',d:'Joint Manufacturing & Technology Center (JMTC) — only government-owned Army general manufacturing facility. Produces M777 howitzer components, gun mounts, recoil mechanisms. Also hosts Army Sustainment Command, First Army HQ, Army Contracting Command. Oldest active US defense plant. Rock Island, IL (Mississippi River/Quad Cities).'},
  {n:'Watervliet Arsenal',lat:42.7196,lon:-73.7087,c:'US',t:'USA',d:'Oldest continuously operating US Arsenal (1813). America\'s sole large-caliber cannon manufacturer — ALL M256 120mm Abrams gun tubes, M198/M777 howitzer barrels, M109A7 Paladin cannon tubes. Cannon Technology Center. In any major land war, every tank fires through a barrel made here. Albany County, NY.'},
  {n:'Anniston Army Depot',lat:33.635,lon:-85.9572,c:'US',t:'USA',d:'Armored vehicle reset and rebuild — M1A1/M1A2 SEP Abrams, M2/M3 Bradley IFVs, Stryker APCs after combat deployment. Chemical agent destruction completed 2011 (VX, GB neutralized). 4,100 civilian employees. After every major Army deployment, combat vehicles return here for complete restoration. Calhoun County (Anniston), AL.'},
  {n:'Red River Army Depot',lat:33.4293,lon:-94.3508,c:'US',t:'USA',d:'Bradley Fighting Vehicle, Stryker APC, and M88A2 Hercules armored recovery vehicle overhaul. Family of Medium Tactical Vehicles (FMTV) rebuild. ~6,000 civilian employees. 19,000-acre installation. Primary Army depot for vehicle fleet readiness during sustained operations. Bowie County (Texarkana), TX.'},
  {n:'Tobyhanna Army Depot',lat:41.1943,lon:-75.4273,c:'US',t:'USA',d:'DoD\'s largest electronics/C4ISR maintenance depot. Overhauls tactical radios, radar systems, night vision, satellite terminals, and combat vehicle electronics for all US services. ~3,300 civilian employees. Monroe County (Pocono Mountains), PA. Every electronic system on Army combat vehicles cycles through depot-level maintenance here.'},
  {n:'Detroit Arsenal',lat:42.4963,lon:-83.0436,c:'US',t:'USA',d:'PEO Ground Combat Systems — acquisition authority for M1 Abrams SEPv3/v4, M2 Bradley, Stryker, M109A7 Paladin, AMPV, XM30 MICV. Tank-automotive and Armaments Command (TACOM) Life Cycle Management Command. ~6,000 DoD employees. Warren, MI (Detroit metro). Where the Army\'s armored vehicle programs are managed and contracts awarded.'},
  // ── US AFRICA ──
  {n:'Camp Lemonnier',lat:11.55,lon:43.15,c:'DJ',t:'USN',d:'Only permanent US military base in Africa. Combined Joint Task Force-Horn of Africa (CJTF-HOA) HQ. ~4,500 personnel. MQ-9 Reaper and P-3C maritime patrol operations against al-Shabaab, ISIS-Somalia, and piracy. SOF staging base for East Africa operations. Djibouti — strategic chokepoint at Bab el-Mandeb strait controlling Red Sea/Gulf of Aden. China\'s first overseas base is 6 miles away.'},
  {n:'AB 201 Agadez',lat:16.97,lon:7.99,c:'NE',t:'USAF',d:'Air Base 201. $110M drone base in central Niger. MQ-9 Reaper armed ISR operations across the Sahel targeting ISIS and al-Qaeda affiliates. Largest US Air Force construction project in history in Africa. Became operational 2019. Status uncertain following 2023 Niger coup — Niger junta ordered US forces to leave. Represents shifting US posture in West Africa.'},
  {n:'Manda Bay',lat:-2.26,lon:40.90,c:'KE',t:'USA',d:'Camp Simba. Cooperative Security Location on Kenyan coast. Forward staging for ISR, strike, and special operations against al-Shabaab in Somalia. Small US footprint (~200-500 personnel). Attacked by al-Shabaab in January 2020 — 3 Americans killed. Hosts surveillance aircraft and special operations forces conducting cross-border missions.'},
  // ── RUSSIAN BASES ──
  {n:'Kaliningrad',lat:54.71,lon:20.51,c:'RU',t:'RU Navy',d:'Baltic Fleet HQ. Russian exclave between NATO members Poland and Lithuania — the most militarized zone in Europe. Iskander-M tactical ballistic missiles (nuclear-capable, 500km range). S-400 air defense systems. Bastion-P coastal missile systems. Creates an A2/AD (anti-access/area-denial) bubble over the entire Baltic Sea. Can strike Warsaw, Berlin, Stockholm, Copenhagen. Nuclear weapons storage confirmed by US intelligence.'},
  {n:'Sevastopol',lat:44.62,lon:33.53,c:'RU',t:'RU Navy',d:'Black Sea Fleet HQ since 1783. Illegally annexed with Crimea in 2014. Home to ~25 major surface combatants, Kilo-class submarines launching Kalibr cruise missiles at Ukraine, and naval infantry. Admiral Makarov-class frigates. Repeatedly struck by Ukrainian Neptune missiles and naval drones since 2022 — flagship Moskva sunk April 2022. Major dry dock destroyed October 2023. Operational capability significantly degraded.'},
  {n:'Khmeimim AB',lat:35.41,lon:35.95,c:'SY',t:'RU AF',d:'Russia\'s primary Middle Eastern air base, operational since September 2015 Syrian intervention. Su-35S, Su-34, Su-24M strike aircraft. S-400 Triumf and Pantsir-S1 air defense. 1,500+ Russian military personnel. Conducts air superiority, ground attack, and ISR missions in support of Assad regime. Two runways. Latakia province — Mediterranean coast. Forward projection of Russian air power beyond former Soviet space.'},
  {n:'Tartus Naval',lat:34.89,lon:35.89,c:'SY',t:'RU Navy',d:'Russia\'s only Mediterranean naval facility — 49th Operational Squadron support base. Underwent major expansion since 2017 (deepened harbor for larger ships). Logistic resupply point for Russian naval deployments to Mediterranean and Atlantic. Supports submarines. Russia\'s foothold in the eastern Mediterranean and critical to power projection in the region. Status uncertain following Assad regime fall.'},
  {n:'Murmansk',lat:68.97,lon:33.08,c:'RU',t:'RU Navy',d:'Northern Fleet HQ — Russia\'s most powerful naval fleet. SSBN bastion operations in Barents Sea (Delta IV and Borei-class ballistic missile submarines carrying 96+ nuclear warheads). Severomorsk naval base adjacent. Oscar-class SSGN cruise missile submarines. Admiral Kuznetsov carrier (perpetually in refit). Arctic operations command. Kola Peninsula — gateway to North Atlantic via GIUK Gap. Russia\'s primary nuclear second-strike force.'},
  {n:'Novorossiysk',lat:44.72,lon:37.77,c:'RU',t:'RU Navy',d:'Black Sea Fleet secondary base. New expanded naval base complex (Tsemess Bay) designed to supplement Sevastopol. 6 improved Kilo-class submarines (636.3 Varshavyanka) — "Black Hole" quiet diesel-electric boats launching Kalibr cruise missiles. Receiving assets relocated from Sevastopol due to Ukrainian strike vulnerability. Growing strategic importance.'},
  {n:'Vladivostok',lat:43.12,lon:131.90,c:'RU',t:'RU Navy',d:'Pacific Fleet HQ. Major surface combatant and submarine base. SSN (nuclear attack submarines), SSGN (cruise missile submarines) homeport. Slava-class cruiser Varyag. Udaloy-class destroyers. Controls approaches to Sea of Japan and critical for Far East maritime operations. Also a commercial port. 16 nautical miles from North Korean border. Hosts annual Vostok exercises.'},
  {n:'Petropavlovsk-Kamchatsky',lat:53.02,lon:158.65,c:'RU',t:'RU Navy',d:'Pacific Fleet SSBN base — Rybachiy submarine base at Vilyuchinsk. Borei-class SSBNs (each carrying 16 Bulava SLBMs with 6-10 MIRV warheads). The Pacific leg of Russia\'s nuclear triad. Patrol areas in Sea of Okhotsk protected by ASW surface ships and submarines. Deep-water port access to open Pacific. Extremely remote — accessible only by air or sea. One of the most strategic submarine bases in the world.'},
  {n:'Severodvinsk',lat:64.58,lon:39.83,c:'RU',t:'RU Navy',d:'Sevmash shipyard — every Russian nuclear submarine has been built here since 1938. Currently producing Borei-II class SSBNs (Project 955A) and Yasen-M class SSGNs (Project 885M — Russia\'s most advanced attack submarine). Also refitting Admiral Kuznetsov carrier. Zvezdochka shipyard handles submarine overhauls. White Sea coast. The single most critical military shipyard in Russia.'},
  {n:'Cam Ranh Bay',lat:11.95,lon:109.22,c:'VN',t:'RU Navy',d:'Former major Soviet naval base (1979-2002) — largest Soviet overseas installation at its peak. Now operates under a 2014 Russia-Vietnam maintenance agreement allowing Russian warship visits and submarine repairs. Strategically located on South China Sea. Vietnam balances Russian, Chinese, and US military relationships. Deep natural harbor.'},
  {n:'Erebuni',lat:40.12,lon:44.47,c:'AM',t:'RU AF',d:'Russian 3624th Air Base. MiG-29 fighters providing air defense for Russian-Armenian joint air defense system. Russian military presence in the Caucasus — a geopolitical counterweight to Turkey and NATO. Located at Yerevan airport. Russia\'s ability to maintain this base weakened after 2023 Armenia-Russia relations deterioration following Nagorno-Karabakh loss.'},
  {n:'Gyumri (102nd Base)',lat:40.79,lon:43.85,c:'AM',t:'RU Army',d:'102nd Russian Military Base. ~3,000 troops with T-72 tanks, BMP-2 IFVs, and S-300V air defense. Armenia\'s second-largest city, 10km from Turkish border. Russia\'s ground force anchor in the South Caucasus. Base agreement runs to 2044 but under strain as Armenia pivots toward Western partnerships following 2020 and 2023 Nagorno-Karabakh defeats.'},
  {n:'Kant AB',lat:42.85,lon:74.85,c:'KG',t:'RU AF',d:'CSTO (Collective Security Treaty Organization) combined air base in Kyrgyzstan. Su-25SM ground attack aircraft. Russian air presence in Central Asia for counter-terrorism and power projection. Located near Bishkek. Part of Russia\'s strategy to maintain military influence across former Soviet states and counter potential extremist spillover from Afghanistan.'},
  {n:'Port Sudan',lat:19.62,lon:37.22,c:'SD',t:'RU Navy',d:'Planned Russian naval logistics center — agreement signed 2020 for a 300-person facility with up to 4 ships including nuclear-powered vessels. Would give Russia its first Red Sea naval presence, monitoring Bab el-Mandeb chokepoint and Suez Canal approaches. Implementation delayed by Sudanese political instability and civil war (2023-present). If completed, significantly extends Russian maritime reach.'},
  {n:'Okhotsk',lat:59.35,lon:143.22,c:'RU',t:'RU Navy',d:'Sea of Okhotsk SSBN bastion — Russia treats this semi-enclosed sea as a protected sanctuary for ballistic missile submarine patrols. Defended by surface ships, attack submarines, and shore-based anti-ship missiles to prevent US/allied ASW forces from penetrating. Critical to the survivability of Russia\'s sea-based nuclear deterrent. Deep water (1,500m+) ideal for submarine operations.'},
  // ── CHINESE BASES ──
  {n:'Hainan/Yulin',lat:18.22,lon:109.55,c:'CN',t:'PLAN',d:'PLAN\'s most strategic submarine base. Underground submarine pens carved into mountainside at Yalong Bay — can shelter nuclear ballistic missile submarines (Type 094 Jin-class SSBNs, each carrying 12 JL-3 SLBMs). Invisible to satellite surveillance when docked inside. Also hosts Type 093 Shang-class SSNs. Direct deep-water access to South China Sea without passing chokepoints. China\'s primary sea-based nuclear deterrent.'},
  {n:'Djibouti (PLA)',lat:11.59,lon:43.15,c:'DJ',t:'PLA',d:'China\'s first overseas military base — PLA Support Base Djibouti, operational since 2017. ~2,000 troops. 400m pier can berth destroyers and amphibious ships. Overlooks Bab el-Mandeb strait (10% of global trade). Located 6 miles from US Camp Lemonnier. Officially for "peacekeeping and humanitarian" missions — actually projects Chinese naval power across Indian Ocean and East Africa. Reports of laser attacks on US aircraft from this facility.'},
  {n:'Fiery Cross Reef',lat:9.55,lon:112.89,c:'CN',t:'PLA',d:'Largest Chinese artificial island in the Spratly archipelago. Built from dredged sand starting 2014 — transformed a submerged reef into a 677-acre military outpost. 3,125m runway (fighter-capable), 4 hangars, radar arrays, HQ-9B SAM launchers, CIWS close-in weapons. Barracks for 200+. Satellite imagery shows J-11 fighters deployed. De facto unsinkable aircraft carrier controlling central South China Sea. Violates 2016 Hague ruling.'},
  {n:'Mischief Reef',lat:9.90,lon:115.54,c:'CN',t:'PLA',d:'Chinese artificial island in the Spratly chain, 135nm from Philippines (within Philippine EEZ). 2,644m runway, underground storage, radar/sensor arrays, anti-ship cruise missile launchers. Contested by Philippines — subject of 2016 Permanent Court of Arbitration ruling (China rejected). Combined with Fiery Cross and Subi Reefs, creates a triangle of overlapping military control across the Spratlys.'},
  {n:'Zhanjiang',lat:21.27,lon:110.36,c:'CN',t:'PLAN',d:'PLAN Southern Theater Navy HQ — commands all naval operations in South China Sea. Major surface combatant base housing Type 052D Luyang III destroyers, Type 054A Jiangkai II frigates, and Type 075 Yushen-class LHDs (amphibious assault ships). Largest PLAN fleet by vessel count. Primary staging point for South China Sea island garrisons and maritime militia operations. Guangdong Province.'},
  {n:'Qingdao',lat:36.07,lon:120.33,c:'CN',t:'PLAN',d:'PLAN Northern Theater Navy HQ. Aircraft carrier homeport — CV-16 Liaoning (ex-Soviet Kuznetsov-class) based here. Submarine base for conventional submarines. Hosts annual multinational naval exercises. Major naval training center. Shandong Province. The PLAN\'s carrier strike group operates primarily from this facility for Yellow Sea and western Pacific deployments.'},
  {n:'Ningbo',lat:29.87,lon:121.56,c:'CN',t:'PLAN',d:'PLAN Eastern Theater Navy HQ — the fleet responsible for any Taiwan contingency. Type 055 Renhai-class cruisers (most powerful surface combatants in PLAN, 112 VLS cells), Type 052D destroyers, Type 039A/B Yuan-class AIP submarines. Zhejiang Province. Would command the naval component of any Taiwan invasion force. 180nm from Taiwan. Also monitors Japanese/US naval activity in East China Sea.'},
  {n:'Dalian',lat:38.97,lon:121.58,c:'CN',t:'PLAN',d:'Dalian Shipbuilding Industry Co. — China\'s premier naval shipyard. Built CV-17 Shandong (China\'s first domestically designed carrier) and Type 055 cruisers. Currently constructing Type 003 Fujian-class carrier (CATOBAR, electromagnetic catapults — approaching US carrier technology). Also builds nuclear submarines. Dalian Naval Academy adjacent. Liaoning Province. The shipyard building China\'s blue-water navy.'},
  {n:'Wenchang',lat:19.61,lon:110.95,c:'CN',t:'PLA Rocket Force',d:'Wenchang Spacecraft Launch Site — China\'s newest and most advanced space launch center (operational 2016). Launches Long March 5 (heavy-lift, 25 tons to LEO), Long March 7, and Long March 8. Used for Tianwen Mars mission, Chang\'e lunar missions, and Tiangong space station modules. Coastal Hainan Island location enables equatorial launch efficiency and sea recovery of boosters.'},
  {n:'Jiuquan',lat:40.96,lon:100.28,c:'CN',t:'PLA Rocket Force',d:'Jiuquan Satellite Launch Center — China\'s oldest and most famous launch facility (established 1958). All Chinese crewed space missions (Shenzhou program) launch from here. Located in Gobi Desert, Inner Mongolia. Launches Long March 2F (crewed), Long March 2D, and commercial missions. Also conducts ICBM and ASAT (anti-satellite) weapons testing. Chinese "Cape Canaveral."'},
  {n:'Xichang',lat:28.25,lon:102.03,c:'CN',t:'PLA Rocket Force',d:'Xichang Satellite Launch Center — primary facility for geostationary orbit (GEO) missions. Launches BeiDou navigation satellites (China\'s GPS alternative — 46 satellites, global coverage since 2020), military communications satellites, and early warning satellites. Sichuan Province mountains. Two launch pads. China\'s most active launch site by annual mission count.'},
  {n:'Taiyuan',lat:38.85,lon:111.61,c:'CN',t:'PLA Rocket Force',d:'Taiyuan Satellite Launch Center — polar and sun-synchronous orbit launches. Military reconnaissance satellites, Earth observation, and weather satellites. Also serves as DF-41 ICBM (MIRV-capable, 12,000-15,000km range, 10 warheads) test launch facility. Shanxi Province. Expanding role as China accelerates nuclear warhead buildup (estimated 400→1,500 warheads by 2035).'},
  {n:'Korla',lat:41.76,lon:86.13,c:'CN',t:'PLA Army',d:'PLA Combined Arms Tactical Training Base — China\'s equivalent of the US National Training Center. Blue Force (OPFOR) conducts force-on-force exercises against rotating PLA brigades. Weapons testing range in Xinjiang\'s Bayingolin Prefecture. Also hosts testing for new armored vehicles, drones, and electronic warfare systems. Over 1,000 sq km of desert training area.'},
  {n:'Aksai Chin',lat:35.20,lon:79.90,c:'CN',t:'PLA Army',d:'PLA forward positions along the Line of Actual Control (LAC) — disputed India-China border at 14,000-17,000ft elevation. Site of 2020 Galwan Valley clash (20 Indian and estimated 40+ Chinese soldiers killed in hand-to-hand combat). China has built permanent heated barracks, helicopter pads, and road networks. Part of broader PLA infrastructure buildup in Tibet and western China challenging Indian territorial claims.'},
  // ── NATO BASES ──
  {n:'JFC Brunssum',lat:50.94,lon:5.97,c:'NL',t:'NATO',d:'Allied Joint Force Command Brunssum — one of two operational-level NATO HQs. Commands NATO Response Force rotations and would direct operations on NATO\'s northern and eastern flanks (Baltics, Poland, Scandinavia) during Article 5 conflict. Dutch-German Corps framework. Limburg, Netherlands.'},
  {n:'SHAPE Mons',lat:50.50,lon:3.97,c:'BE',t:'NATO',d:'Supreme Headquarters Allied Powers Europe — the political-military nerve center of NATO. Office of the Supreme Allied Commander Europe (SACEUR), always a US 4-star general (dual-hatted as EUCOM Commander). 5,000+ military/civilian from 31 nations. Where all major NATO military decisions are coordinated. Casteau, Belgium. Operational since 1967.'},
  {n:'JFC Naples',lat:40.85,lon:14.25,c:'IT',t:'NATO',d:'Allied Joint Force Command Naples — commands NATO\'s southern region (Mediterranean, Balkans, Middle East, North Africa). STRIKFORNATO (Naval Striking and Support Forces NATO). NATO Rapid Deployable Corps. Southern hub for NATO maritime operations. Lake Patria complex near Naples.'},
  {n:'Allied Land Command Izmir',lat:38.42,lon:27.14,c:'TR',t:'NATO',d:'LANDCOM — NATO Allied Land Command. Coordinates all NATO land forces operations, readiness, and training standardization across 31 member nations. Established 2012 from former HQ LANDSOUTHEAST. Plans large-scale ground force deployments. Izmir, Turkey.'},
  {n:'Northwood HQ',lat:51.63,lon:-0.42,c:'UK',t:'NATO',d:'NATO Maritime Command (MARCOM) — commands all NATO naval operations including Standing NATO Maritime Groups (SNMG1/SNMG2), mine countermeasures groups, and submarine surveillance. Coordinates anti-submarine warfare, naval exercises, and maritime domain awareness across the Atlantic and Mediterranean. Northwood, Greater London.'},
  // ── ROYAL NAVY / UK ──
  {n:'HMNB Clyde (Faslane)',lat:56.07,lon:-4.82,c:'UK',t:'Royal Navy',d:'Home of the UK\'s nuclear deterrent. 4 Vanguard-class SSBNs carrying Trident II D5 missiles (each submarine: 16 missiles, up to 8 warheads per missile). Continuous At-Sea Deterrent (CASD) maintained since 1969 — at least one SSBN always on patrol. Also bases Astute-class SSNs (UK\'s newest nuclear attack submarines). Gare Loch, Scotland. The UK\'s most strategically vital military installation.'},
  {n:'HMNB Devonport',lat:50.38,lon:-4.18,c:'UK',t:'Royal Navy',d:'Largest naval base in Western Europe at 650 acres. Nuclear submarine refitting and decommissioning (Devonport Royal Dockyard). Amphibious assault ships HMS Albion and HMS Bulwark homeport. Type 23 Duke-class frigates. Survey ships. Plymouth, Devon. Also handles nuclear-powered submarine reactor defueling — one of only a few facilities in the world capable of this.'},
  {n:'Akrotiri RAF',lat:34.59,lon:32.99,c:'CY',t:'UK',d:'British Sovereign Base Area on Cyprus — UK sovereign territory since 1960. Staging point for all British Middle East operations. RAF Typhoon FGR4 Quick Reaction Alert. Intelligence, surveillance, and signals intelligence facilities monitoring eastern Mediterranean, Middle East, and Russia. Used for strikes against ISIS in Syria/Iraq. 84 Sqn (helicopter SAR). Massive SIGINT radomes visible on satellite imagery.'},
  // ── FRENCH BASES ──
  {n:'Toulon',lat:43.10,lon:5.93,c:'FR',t:'French Navy',d:'Marine Nationale Mediterranean Fleet HQ. Homeport of aircraft carrier Charles de Gaulle (France\'s only carrier — nuclear-powered, Rafale M fighters, E-2C Hawkeye). Mistral-class LHDs (amphibious assault). Suffren-class SSNs (Barracuda — France\'s newest attack submarines). FOST (Force Océanique Stratégique) Mediterranean operations. France\'s most important naval base.'},
  {n:'Brest',lat:48.38,lon:-4.50,c:'FR',t:'French Navy',d:'French Atlantic Fleet and submarine force HQ. Ile Longue SSBN base (15km from Brest) — 4 Triomphant-class SSBNs carrying M51 SLBMs (6 MIRV warheads each). France\'s nuclear deterrent at sea. Atlantic patrol coordination. Brittany coast. Continuous deterrent patrol (Permanence à la Mer) maintained since 1972. Also home to French naval aviation patrol aircraft.'},
  {n:'Cherbourg',lat:49.64,lon:-1.62,c:'FR',t:'French Navy',d:'Naval Group (formerly DCNS) shipyard — builds all French nuclear submarines (SSBNs and SSNs). Currently constructing Suffren-class SSNs (Barracuda program) and designing SNLE 3G (next-generation SSBN). Also building conventional submarines for export (Scorpène class for India, Brazil, Malaysia). France\'s premier submarine construction facility. Normandy coast.'},
  {n:'Djibouti (France)',lat:11.55,lon:43.13,c:'DJ',t:'FR',d:'France\'s largest overseas military base — 1,500+ personnel including 13th Demi-Brigade of the Foreign Legion (13e DBLE), Rafale fighters (Détachement Air), naval vessels, and army armor. Pre-positioned force for Indian Ocean, East Africa, and Arabian Peninsula interventions. French Forces Djibouti (FFDj). France has maintained continuous military presence here since independence in 1977. Strategic Bab el-Mandeb chokepoint access.'},
  // ── GERMAN NAVY ──
  {n:'Kiel',lat:54.33,lon:10.14,c:'DE',t:'German Navy',d:'Deutsche Marine (German Navy) HQ. 1st Submarine Squadron — Type 212A AIP submarines (among the world\'s quietest conventional submarines using hydrogen fuel cells). Naval base at Kiel-Tirpitzhafen. NATO Centre of Excellence for Operations in Confined and Shallow Waters (COE CSW). Kiel Canal entrance — world\'s busiest artificial waterway. Schleswig-Holstein, Baltic coast.'},
  {n:'Wilhelmshaven',lat:53.51,lon:8.15,c:'DE',t:'German Navy',d:'German Fleet Command (Flottenkommando). Homeport for Baden-Württemberg-class (F125) and Brandenburg-class (F123) frigates. Einsatzflottille 2 (2nd Flotilla). Major North Sea naval base. Germany\'s primary surface combatant fleet. Participates in NATO Standing Maritime Groups and EU NAVFOR operations (counter-piracy, Mediterranean migration). Lower Saxony.'},
  // ── INDIA ──
  {n:'INS Kadamba (Karwar)',lat:14.81,lon:74.12,c:'IN',t:'Indian Navy',d:'Project Seabird — India\'s largest naval base under massive expansion ($3B+). When complete, will be the largest naval base in Asia. Western Fleet assets relocating from Mumbai. Deep-water berths for aircraft carrier INS Vikramaditya, destroyers, frigates, and submarines. Underground facilities for nuclear submarines. Karnataka coast. Designed to project power across Arabian Sea and Indian Ocean.'},
  {n:'INS Rajali (Arakkonam)',lat:13.07,lon:79.69,c:'IN',t:'Indian Navy',d:'Naval air station hosting Indian Navy\'s P-8I Neptune maritime patrol aircraft (8 aircraft, purchased from Boeing). Primary maritime ISR and ASW platform covering Bay of Bengal and Indian Ocean. Also operates Kamov Ka-31 AEW helicopters and Dornier 228 surveillance aircraft. Tamil Nadu. India\'s eyes over the eastern Indian Ocean and Chinese submarine approach routes.'},
  {n:'Agra AFB',lat:27.16,lon:78.04,c:'IN',t:'Indian AF',d:'Indian Air Force base housing Mirage 2000H/TH fighters — nuclear delivery capable under India\'s Strategic Forces Command. Played decisive role in 1999 Kargil War (laser-guided bomb strikes). Mirage 2000 is India\'s primary precision strike platform. Also home to Il-78 aerial refueling tankers. Uttar Pradesh. Strategic Air Command quick-reaction nuclear strike capability.'},
  {n:'Jaisalmer (Pokhran)',lat:26.92,lon:70.90,c:'IN',t:'Indian Army',d:'Pokhran Test Range — site of India\'s nuclear weapons tests. "Smiling Buddha" (1974, first test) and "Operation Shakti" (1998 — 5 devices including thermonuclear). Also a major desert warfare training center (Thar Desert). Integrated Test Range for missile testing. Rajasthan. India declared itself a nuclear weapons state from this location. 50km from Pakistan border.'},
  // ── PAKISTAN ──
  {n:'Sargodha AB',lat:32.05,lon:72.67,c:'PK',t:'Pakistan AF',d:'PAF\'s premier strike base. No. 14 Squadron "Tail Choppers" (F-16A/B Fighting Falcon) and JF-17 Thunder squadrons. Nuclear-capable strike delivery platform — believed to house Pakistan\'s air-delivered nuclear weapons. Central Pakistan location provides strategic depth. Major hardened aircraft shelters. Punjab Province. A primary target in any India-Pakistan nuclear scenario.'},
  {n:'Kamra AB',lat:33.87,lon:72.40,c:'PK',t:'Pakistan AF',d:'Pakistan Aeronautical Complex (PAC) — co-production facility for JF-17 Thunder fighter (joint Pakistan-China program). Mirage III/5 overhaul and life extension. MFI-17 Mushshak trainer production. AWC (Air Weapons Complex) develops and integrates air-launched weapons including cruise missiles. Pakistan\'s indigenous military aviation industry center. KPK Province.'},
  {n:'Masroor AB',lat:24.89,lon:66.94,c:'PK',t:'Pakistan AF',d:'PAF Southern Air Command HQ. Largest PAF base by area. F-16, JF-17, and Mirage squadrons. Air defense of Karachi (Pakistan\'s largest city, main port, and economic hub). Also defends approaches to Pakistan Navy facilities. Arabian Sea coastal defense. Naval air coordination. Sindh Province.'},
  // ── ASIA-PACIFIC / OCEANIA ──
  {n:'Pine Gap',lat:-23.80,lon:133.74,c:'AU',t:'AUS/US',d:'Joint Defence Facility Pine Gap — one of the most important intelligence facilities in the Western Hemisphere. CIA/NSA-operated satellite ground station processing SIGINT and GEOINT from geostationary satellites over the eastern hemisphere. Provides real-time missile launch detection, nuclear detonation detection, and battlefield communications intelligence. Critical node in Five Eyes (FVEY) intelligence sharing. Central Australia — chosen for satellite coverage geometry and remoteness. ~1,000 personnel.'},
  {n:'RAAF Tindal',lat:-14.52,lon:132.38,c:'AU',t:'RAAF',d:'RAAF\'s most northern continental base. F-35A Lightning II (75 Sqn). Currently undergoing $1.4B expansion for USAF rotational bomber deployments — fuel storage, apron expansion, and munitions facilities for B-52H Stratofortress operations. Part of AUKUS force posture initiative. 6 hours flying time from South China Sea. Northern Territory. Australia\'s frontline air combat base for Indo-Pacific.'},
  {n:'Jindalee (Laverton)',lat:-31.05,lon:136.81,c:'AU',t:'RAAF',d:'Jindalee Operational Radar Network (JORN) — over-the-horizon radar system detecting aircraft and ships at 1,000-3,000km range. Three transmitter/receiver sites creating a surveillance arc across Australia\'s northern and western approaches. Can detect stealth aircraft at ranges where conventional radar cannot. Provides early warning of air and maritime threats from Southeast Asia and the Indian Ocean. One of the most advanced OTH radar systems in the world.'},
  {n:'Changi Naval Base',lat:1.32,lon:103.98,c:'SG',t:'RSN',d:'Republic of Singapore Navy HQ. Changi Naval Base is the largest naval facility in Southeast Asia. Hosts US Navy logistics command (COMLOG WESTPAC) and Littoral Combat Ships on rotational deployment. Deep-water berth accommodates aircraft carriers — USS Ronald Reagan regularly visits. Strategic position at eastern entrance to Strait of Malacca (25% of global trade passes through). Also houses Singapore\'s Formidable-class stealth frigates and Archer-class submarines.'},
  {n:'Lumut Naval Base',lat:4.24,lon:100.62,c:'MY',t:'RMN',d:'Royal Malaysian Navy Western Fleet HQ. Lekiu-class frigates, Kedah-class patrol vessels. Patrols Strait of Malacca against piracy, smuggling, and illegal fishing. Located on Perak coast — western approaches to the strait. Coordinates with Singapore and Indonesia under Malacca Strait Patrol (MSP) arrangement. Malaysia\'s primary naval base for South China Sea territorial defense.'},
];

// ═══ MILITARY ICON GENERATOR — US BRANCH INSIGNIA SVG MARKERS ═══
const _iconCache = new Map();
// ── Real SVG insignia: canvas-based renderer ──
// Loads actual branch SVG files, rasterizes at 64px on a dark disc with a faction-colored ring.
// Phase 26 (2026-06-01): STOPPED tinting the logo to a flat color — that flattened the real
// insignia into a colored blob. Now the genuine full-color emblem (silver/gold/bronze) is drawn
// at full opacity on a dark tactical disc, aspect-ratio preserved, with a thin faction ring so
// allegiance is still readable. SVG src is cache-busted (?v) because /*.svg is cached 1yr immutable.
const _svgIconCache = new Map();
const _BRANCH_SVG_VER = 'p54';
const _branchSVGFiles = {usa:'usa_star.svg',usaf:'usaf_wings.svg',usmc:'usmc_ega.svg',usn:'usn_emblem.svg',ussf:'ussf_delta.svg'};
// Phase 29 (2026-06-01): TRANSPARENT symbols — NO disc/white badge (per operator). Army/AF/Space
// Force keep real colors with a soft dark halo. Navy + Marines source files are dark, so they're
// recolored to their BRANCH colors (Navy blue / Marine scarlet) — visible on the globe AND meaningful.
const _branchTint = {usn:'#2f6fed', usmc:'#e0352f', usaf:'#c3ccd8'};  // Navy blue · Marine scarlet · Air Force silver
function renderBranchIcon(branch,color,size){
  const key=branch+'|'+color;
  if(_svgIconCache.has(key))return _svgIconCache.get(key);
  const file=_branchSVGFiles[branch];
  if(!file)return null;
  const tint=_branchTint[branch];
  const promise=new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      try{
        const c=document.createElement('canvas');
        c.width=c.height=size;
        const ctx=c.getContext('2d');
        const pad=Math.round(size*0.08);
        const box=size-pad*2;
        const iw=img.naturalWidth||box, ih=img.naturalHeight||box;
        const scale=Math.min(box/iw, box/ih);
        const dw=iw*scale, dh=ih*scale, dx=(size-dw)/2, dy=(size-dh)/2;
        // Render the symbol into a temp canvas at full fidelity.
        // Phase 30 (2026-06-26): emblems now render UNTINTED (full color) — the
        // old source-in tint flattened the EGA/Navy/AF emblem to a featureless
        // silhouette (the reason this path was disabled). Real emblem detail is
        // the whole point (Task 4: branch insignia per base). Only Navy + AF
        // source files that are near-black get a light recolor so they read on
        // a dark globe; USMC/USA/USSF keep their native colors.
        const tmp=document.createElement('canvas');tmp.width=tmp.height=size;const t=tmp.getContext('2d');
        t.drawImage(img,dx,dy,dw,dh);
        if(tint){
          // Tint only the OPAQUE silhouette while preserving internal alpha
          // gradients — applied as a soft multiply so emblem linework survives.
          t.globalCompositeOperation='source-atop';
          t.globalAlpha=0.55;
          t.fillStyle=tint;t.fillRect(0,0,size,size);
          t.globalAlpha=1.0;
          t.globalCompositeOperation='source-over';
        }
        // Composite onto output with a soft dark halo so it reads on bright land AND dark ocean
        ctx.shadowColor='rgba(0,0,0,0.7)';ctx.shadowBlur=Math.round(size*0.07);
        ctx.drawImage(tmp,0,0);
        ctx.shadowColor='transparent';ctx.shadowBlur=0;
        const dataUrl=c.toDataURL('image/png');
        _svgIconCache.set(key,dataUrl);
        resolve(dataUrl);
      }catch(e){console.warn('[MilIcon] Canvas render failed:',e);resolve(null)}
    };
    img.onerror=()=>{console.warn('[MilIcon] SVG load failed:',file);resolve(null)};
    img.crossOrigin='anonymous';
    img.src=file+'?v='+_BRANCH_SVG_VER;
  });
  _svgIconCache.set(key,promise);
  return promise;
}
// Pre-load all US branch icons, then upgrade billboards from hand-drawn to real SVG
async function upgradeUSBranchIcons(){
  const branches=['usa','usaf','usmc','usn','ussf'];
  const colors=new Set();
  // Phase 3 Turn 6 (2026-05-03): MILAIRFIELDS is lazy-loaded — guard with typeof
  // so this function doesn't throw on boot before user toggles airfields layer.
  const _hasAirfields = (typeof MILAIRFIELDS!=='undefined' && Array.isArray(MILAIRFIELDS));
  MILBASES.forEach(b=>{const br=getBranch(b.t);if(branches.includes(br))colors.add(br+'|'+getFactionColor(b.t,b.c))});
  if(_hasAirfields){MILAIRFIELDS.forEach(a=>{const br=getBranch(a.t);if(branches.includes(br))colors.add(br+'|'+getFactionColor(a.t,a.c||'US'))});}
  const tasks=[];
  colors.forEach(bc=>{const[br,col]=bc.split('|');tasks.push(renderBranchIcon(br,col,64))});
  const results=await Promise.allSettled(tasks);
  let upgraded=0;
  // Now update existing billboards with the real icons
  milbaseEnts.forEach((ent,i)=>{
    const b=MILBASES[i];if(!b)return;
    const br=getBranch(b.t);const col=getFactionColor(b.t,b.c);
    const cachedIcon=_svgIconCache.get(br+'|'+col);
    if(cachedIcon&&typeof cachedIcon==='string'&&ent.billboard){
      ent.billboard.image=cachedIcon;upgraded++;
    }
  });
  if(_hasAirfields && typeof milairfieldEnts!=='undefined'){
    milairfieldEnts.forEach((ent,i)=>{
      const a=MILAIRFIELDS[i];if(!a)return;
      const br=getBranch(a.t);const col=getFactionColor(a.t,a.c||'US');
      const cachedIcon=_svgIconCache.get(br+'|'+col);
      if(cachedIcon&&typeof cachedIcon==='string'&&ent.billboard){
        ent.billboard.image=cachedIcon;upgraded++;
      }
    });
  }
  if(upgraded>0){
    af('var(--gn)',`Upgraded ${upgraded} bases to real branch insignia (SVG\u2192Canvas)`);
    EventLog.add('info',`Military icons: ${upgraded} upgraded to real SVG branch insignia`);
  }
}
function getBranch(t){
  if(t==='USAF') return 'usaf';
  if(t==='USN') return 'usn';
  if(t==='USA') return 'usa';
  if(t==='USMC') return 'usmc';
  if(t==='USSF') return 'ussf';
  if(t==='DOD') return 'dod';
  if(t==='NATO') return 'nato';
  if(t==='PLA Rocket Force') return 'missile';
  if(['PLAAF','RU AF','French AF','UA AF','RAAF','Pakistan AF','Indian AF','RAF'].includes(t)||t.includes('AF')) return 'air';
  if(['PLAN','RU Navy','Royal Navy','French Navy','German Navy','Indian Navy','RSN','RMN','ROKN','JMSDF'].includes(t)||t.includes('Nav')) return 'naval';
  if(['PLA Army','PLA','AUS/US'].includes(t)) return 'ground';
  if(t==='FR') return 'fr';
  return 'ground';
}
// Phase 8A (2026-05-05): MIL-STD-2525C SIDC mapping. Returns proper NATO APP-6 / 2525C
// Symbol Identification Codes for use with the milsymbol library. SIDC structure (15 chars):
//   [Coding Scheme][Affiliation][Battle Dim][Status][Function ID 6 chars][Modifier 4 chars]
// Affiliation: F=Friendly, H=Hostile, N=Neutral, U=Unknown
// Battle Dim: G=Ground, A=Air, S=Sea Surface, U=Subsurface, P=Space, F=SOF
// Function IDs from the 2525C standard.
function getSIDC(branchType,countryCode,iconKind){
  // Affiliation: US/NATO/Allied=Friendly, RU/CN/IR/KP=Hostile, Other=Neutral
  const allied=new Set(['US','UK','FR','DE','IT','ES','PL','TR','NL','BE','CA','AU','NZ','JP','KR','IN','IL','SA','AE','QA','KW','BH','OM','AUS','GB']);
  const hostile=new Set(['RU','CN','IR','KP','SY','BY']);
  const aff=allied.has(countryCode)?'F':hostile.has(countryCode)?'H':'N';
  // Battle dimension and function: military airfield uses Air symbology
  if(iconKind==='airfield')return `S${aff}APMFA---*****`; // Airfield = SFAPMFA-----
  if(iconKind==='naval')return  `S${aff}SP------*****`;   // Sea surface combatant generic
  // Service-specific ground installations (military bases):
  if(branchType==='USAF')return `S${aff}AP------*****`; // Air, generic
  if(branchType==='USN')return  `S${aff}SP------*****`; // Sea surface
  if(branchType==='USMC')return `S${aff}GPUCI---*****`; // Ground unit infantry (Marines)
  if(branchType==='USA')return  `S${aff}GPIBA---*****`; // Ground installation, base
  if(branchType==='USSF')return `S${aff}PT------*****`; // Space track
  if(branchType==='DOD')return  `S${aff}GPIBA---*****`; // Generic base
  if(branchType==='NATO')return `S${aff}GPIBA---*****`;
  if(branchType==='missile'||branchType==='PLA Rocket Force')return `S${aff}GPUWS---*****`; // Surface-to-surface missile
  if(['PLAN','RU Navy','Royal Navy','French Navy','German Navy','Indian Navy','RSN','RMN','ROKN','JMSDF'].includes(branchType))return `S${aff}SP------*****`;
  if(['PLAAF','RU AF','French AF','UA AF','RAAF','Pakistan AF','Indian AF','RAF'].includes(branchType))return `S${aff}AP------*****`;
  return `S${aff}GPIBA---*****`; // Default = ground installation, base
}
// Phase 8A: MIL-STD-2525C symbol renderer using milsymbol library. Returns data URI.
// Falls back to legacy makeMilIcon hand-drawn SVG if milsymbol failed to load.
const _milstd2525Cache=new Map();
function makeMilSTD2525Icon(branchType,countryCode,iconKind,color,size){
  if(typeof ms==='undefined')return null; // library not loaded yet
  const key=branchType+'|'+(countryCode||'')+'|'+(iconKind||'')+'|'+color+'|'+(size||40);
  if(_milstd2525Cache.has(key))return _milstd2525Cache.get(key);
  try{
    const sidc=getSIDC(branchType,countryCode,iconKind);
    const sym=new ms.Symbol(sidc,{
      size:size||40,
      colorMode:{Friend:color,Hostile:color,Neutral:color,Unknown:color},
      fillOpacity:0.85,
      strokeWidth:2.5,
      monoColor:false
    });
    const uri='data:image/svg+xml;base64,'+btoa(sym.asSVG());
    _milstd2525Cache.set(key,uri);
    return uri;
  }catch(e){console.warn('[MIL-STD-2525]',e);return null}
}
function makeMilIcon(branch,color){
  const key=branch+'|'+color;
  if(_iconCache.has(key)) return _iconCache.get(key);
  const k='#000';
  // Dark circle background + colored ring for satellite visibility
  const bg=`<circle cx="32" cy="32" r="30" fill="#0a0e14" opacity="0.9"/><circle cx="32" cy="32" r="30" fill="none" stroke="${color}" stroke-width="1.8" opacity="0.7"/>`;
  let inner='';
  switch(branch){
    // ═══ U.S. ARMY — Mathematically precise 5-pointed star ═══
    // The Army Star: outer star at r=26, inner vertices at r=10
    case 'usa':
      inner=bg+`<polygon points="32,4 38.9,21.7 58.7,21.7 42.9,33.2 48.8,50.9 32,39.4 15.2,50.9 21.1,33.2 5.3,21.7 25.1,21.7" fill="${color}" stroke="${k}" stroke-width="1.5" stroke-linejoin="round"/>
        <polygon points="32,12 36.4,22.5 47.8,22.5 38.7,30 42.4,41.5 32,34 21.6,41.5 25.3,30 16.2,22.5 27.6,22.5" fill="#0a0e14" opacity="0.15"/>`;
      break;
    // ═══ U.S. AIR FORCE — Geometric angular wings with star ═══
    // Two swept parallelogram wings meeting at bottom vertex + 5-pointed star
    case 'usaf':
      inner=bg+
        // Left wing: bottom center → outer tip → inner upper → center top
        `<path d="M32,54 L3,22 L9,16 L20,12 L32,36 Z" fill="${color}" stroke="${k}" stroke-width="1" stroke-linejoin="round"/>` +
        // Right wing (mirror)
        `<path d="M32,54 L61,22 L55,16 L44,12 L32,36 Z" fill="${color}" stroke="${k}" stroke-width="1" stroke-linejoin="round"/>` +
        // Inner wing lines for depth
        `<line x1="32" y1="36" x2="12" y2="14" stroke="#0a0e14" stroke-width="0.6" opacity="0.3"/>
        <line x1="32" y1="36" x2="52" y2="14" stroke="#0a0e14" stroke-width="0.6" opacity="0.3"/>` +
        // Center star (5-pointed, r=6)
        `<polygon points="32,40 33.9,45.8 40,45.8 35.1,49.4 37,55.2 32,51.6 27,55.2 28.9,49.4 24,45.8 30.1,45.8" fill="${color}" stroke="${k}" stroke-width="0.8"/>
        <circle cx="32" cy="47.5" r="2.2" fill="#0a0e14" opacity="0.3"/>`;
      break;
    // ═══ U.S. MARINES — Eagle, Globe & Anchor (EGA) ═══
    // Eagle spread wings at top, globe circle in middle, anchor through center
    case 'usmc':
      inner=bg+
        // ── Eagle (top) ── spread wings with feather detail
        `<path d="M32,10 C28,8 24,6 18,7 C14,8 10,6 7,9 C10,10 14,9 18,11 C22,13 28,12 32,10 Z" fill="${color}" stroke="${k}" stroke-width="0.6"/>
        <path d="M32,10 C36,8 40,6 46,7 C50,8 54,6 57,9 C54,10 50,9 46,11 C42,13 36,12 32,10 Z" fill="${color}" stroke="${k}" stroke-width="0.6"/>` +
        // Eagle head/beak
        `<ellipse cx="32" cy="11.5" rx="3" ry="2.2" fill="${color}" stroke="${k}" stroke-width="0.5"/>
        <path d="M32,9.5 L34,8.5 L32.5,9.8" fill="${color}" stroke="${k}" stroke-width="0.3"/>` +
        // ── Globe (center) ── circle with meridian/parallel lines
        `<circle cx="32" cy="28" r="11.5" fill="none" stroke="${color}" stroke-width="2.5"/>
        <ellipse cx="32" cy="28" rx="6.5" ry="11.5" fill="none" stroke="${color}" stroke-width="0.8" opacity="0.5"/>
        <path d="M20.5,24 Q26,22 32,24 Q38,26 43.5,24" stroke="${color}" stroke-width="0.7" fill="none" opacity="0.4"/>
        <path d="M20.5,32 Q26,34 32,32 Q38,30 43.5,32" stroke="${color}" stroke-width="0.7" fill="none" opacity="0.4"/>` +
        // ── Anchor ── ring, shaft, crossbar, flukes
        `<circle cx="32" cy="16" r="2.5" fill="none" stroke="${color}" stroke-width="1.8"/>
        <line x1="32" y1="18.5" x2="32" y2="55" stroke="${color}" stroke-width="2.8"/>
        <line x1="24" y1="22" x2="40" y2="22" stroke="${color}" stroke-width="2"/>` +
        // Flukes with curved tips
        `<path d="M19,51 C24,44 28,46 32,54 C36,46 40,44 45,51" stroke="${color}" stroke-width="2.8" fill="none" stroke-linecap="round"/>
        <path d="M19,51 L15,54" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M45,51 L49,54" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`;
      break;
    // ═══ U.S. NAVY — Eagle with spread wings over anchor ═══
    case 'usn':
      inner=bg+
        // ── Eagle ── broad spread wings with curves
        `<path d="M32,12 C27,9 22,6 16,7 C12,8 8,6 5,9 C8,10 12,9 16,11 C20,13 27,13 32,11 Z" fill="${color}" stroke="${k}" stroke-width="0.6"/>
        <path d="M32,12 C37,9 42,6 48,7 C52,8 56,6 59,9 C56,10 52,9 48,11 C44,13 37,13 32,11 Z" fill="${color}" stroke="${k}" stroke-width="0.6"/>` +
        // Eagle body + shield
        `<ellipse cx="32" cy="14" rx="5.5" ry="4" fill="${color}" stroke="${k}" stroke-width="0.6"/>
        <path d="M28.5,13 L35.5,13 L35.5,18 L32,21 L28.5,18 Z" fill="#0a0e14" opacity="0.3" stroke="${color}" stroke-width="0.4"/>
        <line x1="32" y1="13" x2="32" y2="18" stroke="${color}" stroke-width="0.4" opacity="0.5"/>` +
        // ── Anchor ── ring, shaft, crossbar
        `<circle cx="32" cy="22" r="3" fill="none" stroke="${color}" stroke-width="2"/>
        <line x1="32" y1="25" x2="32" y2="53" stroke="${color}" stroke-width="3.2"/>
        <line x1="21" y1="34" x2="43" y2="34" stroke="${color}" stroke-width="2.5"/>` +
        // Flukes with proper curves
        `<path d="M17,49 C23,41 28,44 32,52 C36,44 41,41 47,49" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M17,49 L12,53" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M47,49 L52,53" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;
      break;
    // ═══ U.S. SPACE FORCE — Delta with inner cutout and orbits ═══
    case 'ussf':
      inner=bg+`<path d="M32,5 L50,56 L32,44 L14,56 Z" fill="${color}" stroke="${k}" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M32,18 L40,48 L32,40 L24,48 Z" fill="#0a0e14" opacity="0.3"/>
        <circle cx="32" cy="28" r="2.5" fill="${color}"/>
        <ellipse cx="32" cy="34" rx="20" ry="7" fill="none" stroke="${color}" stroke-width="0.8" opacity="0.35" transform="rotate(-25,32,34)"/>`;
      break;
    // ═══ DOD — Pentagon ═══
    case 'dod':
      inner=bg+`<polygon points="32,7 54,22 46,48 18,48 10,22" fill="${color}" stroke="${k}" stroke-width="1.5" stroke-linejoin="round"/>
        <polygon points="32,15 46,26 41,42 23,42 18,26" fill="#0a0e14" opacity="0.25"/>`;
      break;
    // ═══ NATO — 4-point compass star in circle ═══
    case 'nato':
      inner=bg+`<circle cx="32" cy="32" r="23" fill="none" stroke="${color}" stroke-width="2"/>
        <polygon points="32,7 35,27 32,23 29,27" fill="${color}"/>
        <polygon points="32,57 35,37 32,41 29,37" fill="${color}"/>
        <polygon points="7,32 27,29 23,32 27,35" fill="${color}"/>
        <polygon points="57,32 37,29 41,32 37,35" fill="${color}"/>
        <circle cx="32" cy="32" r="7.5" fill="${color}" stroke="${k}" stroke-width="1"/>`;
      break;
    // ═══ Rocket Force / Missile ═══
    case 'missile':
      inner=bg+`<path d="M32,5 L38,20 L37,20 L37,42 L44,50 L32,46 L20,50 L27,42 L27,20 L26,20 Z" fill="${color}" stroke="${k}" stroke-width="1" stroke-linejoin="round"/>
        <circle cx="32" cy="13" r="2.5" fill="#0a0e14" opacity="0.35"/>
        <path d="M20,50 L16,56 M44,50 L48,56" stroke="${color}" stroke-width="1.8"/>`;
      break;
    // ═══ Generic Air Force (foreign) / Airfield — star shape ═══
    case 'air': case 'airfield':
      inner=bg+`<polygon points="32,8 38,24 56,26 42,37 46,54 32,44 18,54 22,37 8,26 26,24" fill="${color}" stroke="${k}" stroke-width="1.2" stroke-linejoin="round"/>`;
      break;
    // ═══ Generic Navy (foreign) — anchor ═══
    case 'naval':
      inner=bg+`<circle cx="32" cy="16" r="5" fill="${color}" stroke="${k}" stroke-width="1.2"/>
        <line x1="32" y1="21" x2="32" y2="50" stroke="${color}" stroke-width="3.5"/>
        <line x1="19" y1="32" x2="45" y2="32" stroke="${color}" stroke-width="2.5"/>
        <path d="M15,47 C22,38 27,42 32,50 C37,42 42,38 49,47" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      break;
    // ═══ French Military — Tricolor ═══
    case 'fr':
      inner=bg+`<rect x="13" y="11" width="38" height="42" rx="3" fill="none" stroke="${color}" stroke-width="1.5"/>
        <rect x="13" y="11" width="13" height="42" fill="#0055A4" opacity="0.8" rx="3"/>
        <rect x="26" y="11" width="12" height="42" fill="#fff" opacity="0.5"/>
        <rect x="38" y="11" width="13" height="42" fill="#EF4135" opacity="0.8" rx="3"/>`;
      break;
    // ═══ Nuclear — Radiation trefoil ═══
    case 'nuclear':
      inner=bg+`<circle cx="32" cy="28" r="15" fill="${color}" stroke="${k}" stroke-width="1.5"/>
        <circle cx="32" cy="28" r="5.5" fill="#0a0e14"/>
        <path d="M32,13 L26,24 L38,24 Z" fill="#0a0e14" opacity="0.55"/>
        <path d="M18,37 L26,24 L32,34 Z" fill="#0a0e14" opacity="0.55"/>
        <path d="M46,37 L38,24 L32,34 Z" fill="#0a0e14" opacity="0.55"/>
        <path d="M32,43 L25,56 M32,43 L39,56 M32,43 L32,58" stroke="${color}" stroke-width="2.5"/>`;
      break;
    // ═══ Generic Ground Forces — X in rectangle ═══
    default:
      inner=bg+`<rect x="10" y="14" width="44" height="36" rx="3" fill="${color}" stroke="${k}" stroke-width="1.5"/>
        <line x1="14" y1="18" x2="50" y2="46" stroke="#0a0e14" stroke-width="3.5"/>
        <line x1="50" y1="18" x2="14" y2="46" stroke="#0a0e14" stroke-width="3.5"/>`;
  }
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${inner}</svg>`;
  const uri=svgToDataUri(svg);
  _iconCache.set(key,uri);
  return uri;
}

function getFactionColor(t,c){
  // US & Allied = green, Russia = red, China = orange, Other = cyan
  if(t.startsWith('US')||t==='DOD') return '#3FB950';
  if(t==='NATO') return '#00aaff';
  if(t.startsWith('RU ')||c==='RU') return '#DA3633';
  if(t.startsWith('PLA')||c==='CN') return '#E8B339';
  if(['Royal Navy','RAAF','AUS/US','RAF'].includes(t)||['UK','AU','CA','NZ'].includes(c)) return '#3FB950'; // Five Eyes = green
  if(['French Navy','French AF','FR'].includes(t)||c==='FR') return '#4488ff'; // France = blue
  if(['German Navy'].includes(t)||c==='DE') return '#4488ff'; // Germany = blue
  if(t==='UA AF'||c==='UA') return '#44ddff'; // Ukraine = light blue
  if(c==='KP') return '#ff0000'; // North Korea = red
  if(c==='IR') return '#ff4400'; // Iran = orange-red
  return '#00ccaa'; // other = teal
}
const _branchLabels={usa:'U.S. ARMY',usaf:'U.S. AIR FORCE',usn:'U.S. NAVY',usmc:'U.S. MARINES',ussf:'U.S. SPACE FORCE',dod:'DEPT OF DEFENSE',nato:'NATO',missile:'ROCKET FORCE',air:'AIR FORCE',naval:'NAVY',ground:'GROUND FORCES',fr:'FRENCH MILITARY'};
// ═══ ICAO STATION CODE LOOKUP ═══
// Maps base names → ICAO 4-letter identifier for AviationWeather.gov METAR fetch.
// Only air-capable installations with published METAR stations are listed.
// Phase 19b (2026-05-15)
const BASE_ICAO_MAP = {
  // ── US CONUS — Original bases ──
  'Ft Liberty (Bragg)':'KFBG','Ft Cavazos (Hood)':'KGRK','Ft Stewart':'KSVN',
  'Ft Campbell':'KHOP','Ft Drum':'KGTB','Ft Carson':'KPUB','Ft Riley':'KFRI',
  'Ft Bliss':'KBIF','Ft Sill':'KFSI','Ft Moore (Benning)':'KLSF',
  'Ft Eisenhower (Gordon)':'KAUG','Ft Johnson (Polk)':'KBAD',
  'Ft Wainwright':'PAFB','JBLM':'KTCM','JBER':'PAED',
  'Nellis AFB':'KLSV','Creech AFB':'KINS','NSA Norfolk':'KNGU',
  'JBSA Lackland':'KSKF','Ft Meade':'KBWI',
  'MCB Camp Lejeune':'KNCA','MCB Quantico':'KNYG',
  'MCAS Cherry Point':'KNKT','NAS Jacksonville':'KNIP',
  'NAS Pensacola':'KNPA','NAS Oceana':'KNTU',
  'NAB Coronado':'KNZY','NAS Whidbey Island':'KNUW',
  'MacDill AFB':'KMCF','Hurlburt Field':'KHRT',
  'Luke AFB':'KLUF','Shaw AFB':'KSSC',
  'Seymour Johnson AFB':'KGSB','Moody AFB':'KVAD',
  'Beale AFB':'KBAB','Travis AFB':'KSUU',
  'Fairchild AFB':'KSKA','Mountain Home AFB':'KMUO',
  'Cannon AFB':'KCVS','Holloman AFB':'KHMN',
  'Vandenberg SFB':'KVBG','Patrick SFB':'KCOF',
  'Buckley SFB':'KBKF','Peterson SFB':'KCOS',
  'Scott AFB':'KBLV','Wright-Patterson AFB':'KFFO',
  // ── US CONUS — New joint/nuclear/specialty bases ──
  'Joint Base Andrews':'KADW','JB Langley-Eustis':'KLFI',
  'JB McGuire-Dix-Lakehurst':'KWRI','JB Charleston':'KCHS',
  'JB Anacostia-Bolling':'KNAK',
  'Whiteman AFB':'KSZL','Offutt AFB':'KOFF',
  'Malmstrom AFB':'KGTF','Minot AFB':'KMIB',
  'Ellsworth AFB':'KRCA','Barksdale AFB':'KBAD',
  'Dyess AFB':'KDYS','Tyndall AFB':'KPAM',
  'Eielson AFB':'PAEI','Maxwell AFB':'KMXF',
  'Robins AFB':'KWRB','Tinker AFB':'KTIK',
  'Hill AFB':'KHIF','Edwards AFB':'KEDW',
  'Kirtland AFB':'KABQ',
  'NAS Fallon':'KNFL','NAS Patuxent River':'KNHK','NAS Lemoore':'KNLC',
  'Naval Base Guam':'PGUM',
  'MCAS Miramar':'KNKX','MCAS Yuma':'KNYL',
  'MCAS Beaufort':'KNBC','MCAGCC 29 Palms':'KNXP',
  'Ft Novosel (Rucker)':'KOZR','Ft Huachuca':'KFHU',
  'Redstone Arsenal':'KHUA','Fort Knox':'KFTK',
  'Fort Leavenworth':'KLVN','Fort Leonard Wood':'KTBN',
  'Fort Belvoir':'KDAA','Aberdeen Proving Ground':'KAPG',
  'Dugway Proving Ground':'KDPG',
  // ── US CONUS — USAF Operational (new p19b) ──
  'Eglin AFB':'KVPS','Davis-Monthan AFB':'KDMA','Dover AFB':'KDOV',
  'Little Rock AFB':'KLRF','Grand Forks AFB':'KRDR','Hanscom AFB':'KBED',
  'McConnell AFB':'KIAB','Keesler AFB':'KBIX','Goodfellow AFB':'KGSN',
  'Altus AFB':'KATS','Francis E. Warren AFB':'KFEW','Arnold AFB':'KTHA',
  // ── US CONUS — Navy/USMC Operational (new p19b) ──
  'NAS Key West':'KEYW','NAS Whiting Field':'KNDZ',
  'MCB Hawaii':'PHNG','Camp Blaz':'PGUM',
  'MCAS New River':'KNCA',
  // ── US CONUS — Army Sustainment (new p19b) ──
  'Ft Gregg-Adams':'KPTB',
  // ── OCONUS ──
  'Kadena AB':'RODN','Yokota AB':'RJTY','Camp Humphreys':'RKSK',
  'Osan AB':'RKSO','Andersen AFB':'PGUA','Diego Garcia':'FJDG',
  'MCAS Iwakuni':'RJOI','Pearl Harbor':'PHIK','Schofield Barracks':'PHHI',
  'Guantanamo Bay':'MUGM','Incirlik AB':'LTAG','Ramstein AB':'ETAR',
  'Landstuhl RMC':'ETAR','Grafenwoehr':'ETIC','Aviano AB':'LIPA',
  'NAS Sigonella':'LICZ','Naval Station Rota':'LERT',
  'RAF Lakenheath':'EGUL','RAF Mildenhall':'EGUN',
  'Thule AB':'BGTL','Keflavik NAS':'BIKF','Lajes Field':'LPLA',
  'Camp Bondsteel':'BKPR','NSA Souda Bay':'LGSA',
  'Al Udeid AB':'OTBH','Al Dhafra AB':'OMAM',
  'Camp Lemonnier':'HDAM','Masirah Island':'OOMA',
  'MK Air Base':'LRCK',
  'RAAF Tindal':'YPTN',
};

function loadMilBases() {
  if (!V) return;
  milbaseEnts.forEach(e => V.entities.remove(e));
  milbaseEnts = [];
  MILBASES.forEach(b => {
    if(isNaN(b.lat)||isNaN(b.lon)||!isFinite(b.lat)||!isFinite(b.lon))return;
    const branch = getBranch(b.t);
    const fColor = getFactionColor(b.t,b.c);
    // Phase 8A: prefer MIL-STD-2525C tactical symbol; fall back to hand-drawn SVG if lib unavailable
    const iconUri = makeMilSTD2525Icon(b.t, b.c, 'base', fColor, 48) || makeMilIcon(branch, fColor);
    const cesFColor = Cesium.Color.fromCssColorString(fColor);
    const brLabel = _branchLabels[branch]||branch.toUpperCase();
    const icao = BASE_ICAO_MAP[b.n] || '';
    milbaseEnts.push(V.entities.add({
      position:Cesium.Cartesian3.fromDegrees(b.lon,b.lat),
      billboard:{image:iconUri,width:44,height:44,scaleByDistance:new Cesium.NearFarScalar(5e4,1.5,1.5e7,0.7),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,15000000),verticalOrigin:Cesium.VerticalOrigin.CENTER,disableDepthTestDistance:5e6},
      label:{text:b.n,font:'bold 10px JetBrains Mono',fillColor:cesFColor,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.TOP,pixelOffset:new Cesium.Cartesian2(0,26),scaleByDistance:new Cesium.NearFarScalar(5e4,1,5e6,0),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,3000000),disableDepthTestDistance:5e6},
      description:`<div style="font-family:'JetBrains Mono',monospace;font-size:11px;max-width:400px;background:#0a0e14;padding:14px;border-radius:2px;border:1px solid ${fColor}22;color:#c8ccd6">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #1e2436">
          <div>
            <div style="color:${fColor};font-size:14px;font-weight:700;letter-spacing:1px">${esc(b.n)}</div>
            <div style="color:#4a5068;font-size:9px;margin-top:2px;letter-spacing:1.5px">${brLabel}</div>
          </div>
          <div style="padding:3px 8px;background:${fColor}14;border:1px solid ${fColor}33;border-radius:2px;font-size:8px;color:${fColor};letter-spacing:1px;font-weight:600">${b.t}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:10px;color:#7a8194">
          <tr><td style="padding:3px 0;width:35%"><b style="color:#4a5068">BRANCH</b></td><td style="color:#c8ccd6">${b.t}</td></tr>
          <tr><td style="padding:3px 0"><b style="color:#4a5068">COUNTRY</b></td><td style="color:#c8ccd6">${b.c}</td></tr>
          <tr><td style="padding:3px 0"><b style="color:#4a5068">POSITION</b></td><td style="color:#c8ccd6">${b.lat.toFixed(4)}\u00B0, ${b.lon.toFixed(4)}\u00B0</td></tr>
        </table>
        <div style="margin-top:8px;padding:8px;background:${fColor}08;border:1px solid ${fColor}14;border-radius:2px;font-size:10px;color:#8a8f9e;line-height:1.5">${esc(b.d)}</div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button onclick="if(parent.V)parent.flyToTarget(${b.lon},${b.lat},30000,1.2)" style="flex:1;padding:5px;background:#0a0e14;color:${fColor};border:1px solid ${fColor}33;border-radius:2px;cursor:pointer;font-family:monospace;font-size:9px;letter-spacing:.5px">\u25CE ZOOM</button>
          <button onclick="if(parent.V)parent.V.camera.flyTo({destination:parent.Cesium.Cartesian3.fromDegrees(${b.lon},${b.lat},500000),duration:1.2})" style="flex:1;padding:5px;background:#0a0e14;color:#7a8194;border:1px solid #1e2436;border-radius:2px;cursor:pointer;font-family:monospace;font-size:9px;letter-spacing:.5px">AREA VIEW</button>
          ${icao?`<button onclick="parent.showMetar('${icao}','${b.n.replace(/'/g,"\\'")}',${b.lat},${b.lon})" style="flex:1;padding:5px;background:rgba(74,158,255,0.07);color:#4A9EFF;border:1px solid rgba(74,158,255,0.28);border-radius:2px;cursor:pointer;font-family:monospace;font-size:9px;letter-spacing:.5px">\u2601 METAR</button>`:''}
        </div>
        <div style="margin-top:8px;font-size:7px;color:#1e2436;letter-spacing:1px;text-align:right">KITSUNE BDOC \u2014 MILINT</div>
      </div>`,
      show:layers.milbases,
    }));
    // Tag entity for baseReadout panel (Phase 19c)
    const _bEnt = milbaseEnts[milbaseEnts.length-1];
    _bEnt._base = b;
    _bEnt._icao = icao;
  });
  af('var(--gn)', `${MILBASES.length} military installations loaded`);
  EventLog.add('info', `Military bases: ${MILBASES.length} installations mapped`);
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 19c — BASE / AIRFIELD KPI READOUT PANEL
// Slide-in side panel with live METAR bars + GDELT event sparkline.
// Triggered by clicking any military base or airfield entity on the globe.
// ═══════════════════════════════════════════════════════════════════════

function hideBaseReadout(){
  const el=document.getElementById('baseReadout');
  if(el){el.classList.remove('show');el._baseName='';}
}
window.hideBaseReadout=hideBaseReadout;

// Render inline SVG sparkline from a 7-element array of counts (oldest→newest)
function _bsrSparkline(svgEl,data){
  if(!svgEl||!Array.isArray(data))return;
  const W=240,H=36,pad=4;
  const max=Math.max(...data,1);
  const xs=i=>pad+(i/(data.length-1||1))*(W-pad*2);
  const ys=v=>H-pad-(v/max)*(H-pad*2);
  const pts=data.map((v,i)=>`${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
  const area=`${pad},${H-pad} ${pts} ${(W-pad).toFixed(1)},${H-pad}`;
  svgEl.setAttribute('viewBox',`0 0 ${W} ${H}`);
  let html=`<defs><linearGradient id="bsrGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#00eeff" stop-opacity="0.22"/>
    <stop offset="100%" stop-color="#00eeff" stop-opacity="0.01"/>
  </linearGradient></defs>
  <polygon points="${area}" fill="url(#bsrGrad)"/>
  <polyline points="${pts}" fill="none" stroke="#00eeff" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  // Peak dot
  const peakIdx=data.indexOf(max);
  if(max>0)html+=`<circle cx="${xs(peakIdx).toFixed(1)}" cy="${ys(max).toFixed(1)}" r="2.5" fill="#00eeff" stroke="#0a0e14" stroke-width="1"/>`;
  svgEl.innerHTML=html;
}

// Fetch METAR and populate bars
async function _loadBaseMetar(icao){
  try{
    const r=await fetch(`/.netlify/functions/proxy-aw?type=metar&icao=${icao}`,{signal:AbortSignal.timeout(7000)});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();
    const m=Array.isArray(d)?d[0]:d;
    if(!m)throw new Error('empty');

    // Flight category badge
    const fcEl=document.getElementById('bsr-fc');
    if(fcEl){
      const fc=m.flight_category||'UNK';
      const FC={VFR:{c:'#22c55e',b:'rgba(34,197,94,0.15)',br:'rgba(34,197,94,0.35)'},
                MVFR:{c:'#60a5fa',b:'rgba(96,165,250,0.15)',br:'rgba(96,165,250,0.35)'},
                IFR:{c:'#f87171',b:'rgba(248,113,113,0.15)',br:'rgba(248,113,113,0.35)'},
                LIFR:{c:'#e879f9',b:'rgba(232,121,249,0.15)',br:'rgba(232,121,249,0.35)'}};
      const s=FC[fc]||{c:'#8a92a4',b:'rgba(138,146,164,0.10)',br:'rgba(138,146,164,0.25)'};
      fcEl.textContent=fc;
      fcEl.style.cssText=`font-size:10px;font-weight:700;padding:2px 9px;border-radius:3px;background:${s.b};color:${s.c};border:1px solid ${s.br};letter-spacing:1px`;
    }

    // Wind bar (50 kt = 100%)
    const wspd=parseFloat(m.wspd)||0;
    const wgst=m.wgst?` G${m.wgst}`:'';
    const wdir=m.wdir!==undefined?m.wdir+'°':'VRB';
    const wEl=document.getElementById('bsr-wind-val');
    const wBar=document.getElementById('bsr-wind-bar');
    if(wEl)wEl.textContent=`${wdir} @ ${wspd}${wgst} kt`;
    if(wBar)wBar.style.width=Math.min(wspd/50*100,100)+'%';

    // Visibility bar (10 SM = 100%)
    const vis=parseFloat(m.visib)||0;
    const vEl=document.getElementById('bsr-vis-val');
    const vBar=document.getElementById('bsr-vis-bar');
    if(vEl)vEl.textContent=vis+' SM';
    if(vBar)vBar.style.width=Math.min(vis/10*100,100)+'%';

    // Temp / altimeter
    const exEl=document.getElementById('bsr-metar-extra');
    if(exEl){
      const parts=[];
      if(m.temp!==undefined)parts.push(`${m.temp}°C / ${(m.temp*9/5+32).toFixed(0)}°F`);
      if(m.altim!==undefined)parts.push(`Alt ${parseFloat(m.altim).toFixed(2)} inHg`);
      exEl.textContent=parts.join(' · ');
    }
  }catch(e){
    const fcEl=document.getElementById('bsr-fc');
    if(fcEl){fcEl.textContent='METAR N/A';fcEl.style.cssText='font-size:9px;padding:2px 8px;border-radius:3px;background:rgba(90,99,120,0.15);color:#5a6378;border:1px solid rgba(90,99,120,0.25)';}
    const exEl=document.getElementById('bsr-metar-extra');
    if(exEl)exEl.textContent='Station data unavailable';
  }
}

// Fetch GDELT events near base coords, group by day, render sparkline
async function _loadBaseGdelt(name,lat,lon){
  const statusEl=document.getElementById('bsr-spark-status');
  const totalEl=document.getElementById('bsr-spark-total');
  const svgEl=document.getElementById('bsr-sparkline');
  try{
    const q=encodeURIComponent(name.replace(/\(.*?\)/g,'').trim());
    const r=await fetch(`/.netlify/functions/proxy-gdelt?query=${q}+military&timespan=7d&maxpoints=150`,
      {signal:AbortSignal.timeout(9000)});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const gd=await r.json();
    const features=(gd.features||[]);

    // Proximity filter ~300 km
    const nearby=features.filter(f=>{
      const c=f.geometry&&f.geometry.coordinates;
      if(!c)return false;
      const dx=(c[0]-lon)*Math.cos(lat*Math.PI/180)*111.32;
      const dy=(c[1]-lat)*111.32;
      return Math.sqrt(dx*dx+dy*dy)<300;
    });

    // Bucket by day (0=6 days ago … 6=today)
    const now=Date.now(), DAY=86400000;
    const buckets=Array(7).fill(0);
    nearby.forEach(f=>{
      const sd=f.properties&&f.properties.seendate; // YYYYMMDDTHHMMSSZ
      if(sd&&sd.length>=8){
        try{
          const ts=Date.UTC(+sd.slice(0,4),+sd.slice(4,6)-1,+sd.slice(6,8));
          const ago=Math.floor((now-ts)/DAY);
          if(ago>=0&&ago<7)buckets[6-ago]++;
        }catch(_){}
      }
    });
    // Fallback: if no timestamps parsed but events exist, scatter evenly
    if(buckets.every(b=>b===0)&&nearby.length>0){
      for(let i=0;i<nearby.length;i++)buckets[i%7]++;
    }

    const total=buckets.reduce((a,b)=>a+b,0);
    if(totalEl)totalEl.textContent=total?`${total} events near`:'No nearby events';
    if(statusEl)statusEl.style.display='none';
    _bsrSparkline(svgEl,buckets);
  }catch(e){
    if(statusEl)statusEl.textContent='Feed unavailable';
    _bsrSparkline(svgEl,[0,0,0,0,0,0,0]);
  }
}

// Build and show the base readout panel
function showBaseReadout(b,icao,fColor){
  const el=document.getElementById('baseReadout');
  if(!el)return;
  const brLabel=_branchLabels[getBranch(b.t)]||b.t.toUpperCase();
  const accent=fColor||'#00eeff';

  el.innerHTML=`
    <div class="acr-hdr" style="border-bottom:1px solid ${accent}33">
      <div class="acr-cs" style="color:${accent}">${esc(b.n)}</div>
      <div class="acr-cls" style="color:${accent}aa">${brLabel} · ${b.c||'US'}</div>
    </div>
    <div class="acr-tag">${esc(b.d||'Military installation')}</div>
    <div class="acr-coords" style="border-top:none;padding-top:4px">
      <div><span class="acr-lbl">LAT</span> <span class="acr-mono">${b.lat.toFixed(4)}°</span></div>
      <div><span class="acr-lbl">LON</span> <span class="acr-mono">${b.lon.toFixed(4)}°</span></div>
      ${icao?`<div><span class="acr-lbl">ICAO</span> <span class="acr-mono" style="color:${accent}">${icao}</span></div>`:''}
    </div>
    ${icao?`
    <div style="padding:8px 14px;border-top:1px solid rgba(0,212,255,0.08)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:8px;color:#5a6378;letter-spacing:1.2px;text-transform:uppercase">✈ METAR · LIVE</span>
        <span id="bsr-fc"></span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span style="font-size:8px;color:#8a92a4">Wind</span>
        <span id="bsr-wind-val" style="font-size:8px;color:#c8ccd6">Loading…</span>
      </div>
      <div class="bsr-bar-track"><div id="bsr-wind-bar" class="bsr-bar-fill"></div></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:2px;margin-top:6px">
        <span style="font-size:8px;color:#8a92a4">Visibility</span>
        <span id="bsr-vis-val" style="font-size:8px;color:#c8ccd6">--</span>
      </div>
      <div class="bsr-bar-track"><div id="bsr-vis-bar" class="bsr-bar-fill"></div></div>
      <div id="bsr-metar-extra" style="margin-top:5px;font-size:8px;color:#5a6378;letter-spacing:0.3px"></div>
    </div>`:'<div style="padding:6px 14px;font-size:8px;color:#3a4058;border-top:1px solid rgba(0,212,255,0.06)">No METAR station on file</div>'}
    <div style="padding:8px 14px 10px;border-top:1px solid rgba(0,212,255,0.08)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-size:8px;color:#5a6378;letter-spacing:1.2px;text-transform:uppercase">EVENT ACTIVITY · 7D</span>
        <span id="bsr-spark-total" style="font-size:8px;color:#8a92a4">--</span>
      </div>
      <svg id="bsr-sparkline" width="100%" height="36" viewBox="0 0 240 36" preserveAspectRatio="none" style="display:block"></svg>
      <div id="bsr-spark-status" style="font-size:8px;color:#5a6378;margin-top:3px;text-align:center">Loading…</div>
    </div>
    <div class="acr-actions">
      <button onclick="if(typeof flyToTarget==='function')flyToTarget(${b.lon},${b.lat},30000,1.2)">◎ ZOOM</button>
      ${icao?`<button onclick="if(typeof showMetar==='function')showMetar('${icao}','${b.n.replace(/'/g,"\\'")}',${b.lat},${b.lon})" style="color:#4a9eff">⛅ METAR</button>`:''}
      <button onclick="hideBaseReadout()" class="acr-close">CLOSE</button>
    </div>`;

  el.classList.add('show');

  // Kick off live fetches
  if(icao)_loadBaseMetar(icao);
  _loadBaseGdelt(b.n,b.lat,b.lon);
}

// Bind to Cesium selectedEntityChanged — listens for base + airfield entity clicks
function initBaseReadoutBinding(){
  if(!V||!V.selectedEntityChanged||V._baseReadoutBound)return;
  V._baseReadoutBound=true;
  V.selectedEntityChanged.addEventListener(ent=>{
    if(ent&&ent._base){
      showBaseReadout(ent._base,ent._icao||'',getFactionColor(ent._base.t,ent._base.c||'US'));
    }else if(ent&&ent._airfield){
      const a=ent._airfield;
      showBaseReadout(a,ent._icao||'',getFactionColor(a.t,a.c||'US'));
    }else{
      hideBaseReadout();
    }
  });
}
// Retry until Cesium viewer V is ready
(function bsrBindWhenReady(){
  if(typeof V!=='undefined'&&V&&V.selectedEntityChanged){initBaseReadoutBinding();}
  else{requestAnimationFrame(bsrBindWhenReady);}
})();
