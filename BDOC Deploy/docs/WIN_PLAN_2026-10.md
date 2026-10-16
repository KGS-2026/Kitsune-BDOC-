# BDOC — How it wins (Oct 14, 2026)

## The position
Don't compete with God's Eye View on who has the prettiest world feed. They're spectator products: they watch the world, they run on the internet, and they're gone when the internet goes down.

BDOC's lane is the **command post**. One person at a laptop runs their own area with their own team over their own radios. It keeps running with the grid and internet down, and it can prove on camera that nothing leaves the machine.

Nobody in the recon does all three. The closest is ATAK plus Meshtastic, which has no command-post globe and no satellite data over the mesh.

Don't build the pitch on "ATAK feeds the FBI." ATAK-CIV is open source and runs without a server, and TAK users in a gun-tuber's comments will tear that line apart. Pitch only what the reviewer can verify himself.

## The review a Garand Thumb–type films, and what BDOC needs to pass it
1. **Pull the internet; the map, terrain, team positions, messages and satellite weather keep working.**
   - Built: Skybridge, mesh gateway, offline store.
   - Missing: offline map and terrain packs. Google, Esri and Cesium tiles can't legally be cached, so the packs have to come from public-domain data: USGS 3DEP elevation, NAIP 60 cm imagery, OSM/Protomaps.
2. **Real Wireshark next to BDOC in "Sovereign Mode" shows zero packets going to the internet.**
   - Missing, and it would fail today. BDOC currently talks to:
     - Plausible analytics, which receives workspace names and command-palette labels.
     - Esri, Cesium ion and Google, which see where you're looking.
     - Supabase.
     - 58 Netlify proxies.
3. **The team shows on the map with no server: Meshtastic positions, plus ATAK users on the mesh through the ATAK plugin.**
   - Partial: the gateway forwards every packet and Network Builder labels ATAK_PLUGIN packets, but nothing decodes TAK packets into icons on the map yet.
4. **"Where do I put the relay": terrain line of sight plus a LoRa link budget between two clicks.**
   - Missing. Mesh World routes by distance, not terrain.
5. **Print a 1:25k MGRS map of the area, with overlays, for whoever doesn't have a laptop.**
   - Partial: MGRS and jsPDF are in the code, but there's no map print for the area.

## Fix before any reviewer touches it
- **Paid tiers unlock from the browser console.** Typing `BDOC_Auth.tier='enterprise'` gives anyone every paid feature; my own test harness does exactly that. The paid data needs checks on the server side, in the proxies.
- **Fake live data.** There are 40 hardcoded webcams and 19 dark-fleet ships at fixed positions. One click and the reviewer calls it fake.
- **Map credits are hidden** (`creditContainer: document.createElement('div')`). That breaks Esri's and Google's attribution terms.
- **Esri basemap.** It uses the keyless tile URL. Esri wants an ArcGIS account (there's a free tier) and "Powered by Esri" on screen.
- **License traps from the recon:** OpenSky, TeleGeography, ACLED, Broadcastify.
- Already handled: the `?dev=` backdoor from the August audit now only works on localhost.

## Google 3D tiles: what's actually happening
- **Your Google key isn't used.** The 3D Photo button pulls Google's tiles through **Cesium ion asset 2275207** with the ion token (`js/cesium-init.js` ~line 1215). The config function hands your paid Google key to every browser, and nothing uses it.
- **That path is licensed by your Cesium plan, not by Google billing.**
  - The free Community plan is personal and non-commercial only.
  - Commercial is $149/mo, but covers use "within your organization." Cesium says to contact them for anything used outside it, and a SaaS sold to customers is outside it.
- **Paying isn't the issue; the license terms are.** Even switched to your paid key, Google's content terms (the same ones Cesium passes through) say:
  - No use "with or near a non-Google map." BDOC lays Google's tiles over Esri.
  - No High Risk Activities, which the terms define to include **"emergency response services."** That is exactly the EM-coordinator use.
  - No caching and no offline use, which rules it out for grid-down.
  - Attribution must show, and BDOC hides it.
- **Fix:**
  - Point 3D Photo at your paid key directly.
  - Make it a standalone showcase view: Esri off, Google logo and credits on.
  - Lock it out of Sovereign and offline modes.
  - Build the real product on public-domain data you're allowed to cache and sell.

## The infrastructure moat: a BDOC Node feeder network
This is the playbook FlightAware and Flightradar24 used. FR24 made $41.4M at a 52% margin, mostly on volunteer receivers who get a free paid plan in exchange for their data.

- **One solar box per site, about $1,000–1,200:**
  - Skybridge receive for GOES and Meteor.
  - ADS-B 1090 receiver.
  - AIS receiver on the coast.
  - Meshtastic router.
  - 200 W panel and 100 Ah LiFePO4 battery: about 3 days with no sun at roughly 15 W draw.
- **A mesh-only relay costs about $150–250.**
- **Host a node, get Pro free.** Every node adds coverage, aircraft and ship data, and grid-down reach.
- **You own the data.** Your own ADS-B and AIS replace OpenSky (non-commercial) and AISStream (key and connection limits). That data can be sold; Liveuamap sells API access at $150/mo and $1,000+/mo.
- **Hilltop and rooftop site agreements are what a competitor can't copy** by pushing 30 commits a day.
- **10 Georgia sites cost about $11k.** At that point "you get data when the grid goes down" is backed by hardware you own, not just software.

## Build order (each one about the size of p155 or p156)
1. **p157 — Sovereign Mode and review cleanup.**
   - One switch cuts every outbound call.
   - Local-only profile.
   - Live readout of every outside host BDOC contacts.
   - Remove or label the fake webcams and dark fleet.
   - Restore map credits and fix the Google path.
   - Server-side tier checks.
2. **p158 — Offline area packs.** Draw a box, download a county's 3DEP terrain, NAIP imagery and OSM data, run it in airplane mode, and print MGRS maps.
3. **p159 — Team over mesh.** Decode Meshtastic and ATAK plugin positions into team icons, and add a terrain line-of-sight relay planner.
4. **BDOC Node v1.** Parts list, build sheet, Pi image and feeder sign-up.
