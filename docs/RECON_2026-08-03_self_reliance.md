# BDOC RECON REPORT — Self-Reliance & Competitive Edge Sweep
Date: 2026-08-03 | Prepared by Hermes | Endpoints marked ✅ were live-verified from the HERMES droplet today.

## PART 1 — CYBER THREAT SOURCES (free, pullable now)

### Verified live today
- ✅ **IODA (Georgia Tech)** — `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/summary` — country/region/ASN-level INTERNET OUTAGE detection (BGP + active probing + darknet). No auth. THE missing layer: nobody in the consumer space plots this. Maps directly onto BDOC's causal fusion engine.
- ✅ **NOAA SWPC scales** — `https://services.swpc.noaa.gov/products/noaa-scales.json` — already partially integrated.
- **ransomware.live v2** — already in Sentinel. PRO key is FREE (my.ransomware.live) → 500k calls/mo vs 1 req/min anon. ACTION: register free key, then it becomes a BDOC map layer (victims geocoded by country/sector).
- **CISA KEV** — already in Sentinel. Also add `https://www.cisa.gov/cybersecurity-advisories/all.xml` (advisories RSS) for ICS/OT alerts — water/grid relevant.
- **SANS ISC** — `https://isc.sans.edu/api/infocon?json` (in Sentinel) plus `https://isc.sans.edu/api/topports/records/10?json` (attack-port trends).

### Needs (free) auth key now — abuse.ch consolidated to Auth-Key in 2025
- **ThreatFox / URLhaus / Feodo / SSLBL** — `https://threatfox-api.abuse.ch/api/v1/` etc. now return `Unauthorized` without a free auth key from `auth.abuse.ch`. IOCs with geo potential (C2 server locations by country). ACTION: register free key.
- **Cloudflare Radar** — `api.cloudflare.com/client/v4/radar/*` — needs free CF account token. Gives L7/L3 attack volumes by country pair, outage annotations, traffic anomalies. Excellent map layer (attack origin→target arcs).
- **GreyNoise Community API** — free tier, IP context (scanner vs benign).
- **AlienVault OTX** — free key, pulse feeds of IOCs.
- **NVD CVE API 2.0** — free key raises rate limits; KEV already covers "actively exploited."
- **OpenPhish feed (community)** — free txt feed of phishing URLs.

### Top integration order (uniqueness × map-value × cost)
1. IODA outages layer (no auth, nobody has it, fusion-engine fuel)
2. ransomware.live map layer (free PRO key; we already parse it)
3. Cloudflare Radar attack/outage annotations (free token)
4. CISA ICS advisories (water/grid — matches our audience's fear profile)
5. abuse.ch ThreatFox C2 geomap (free key)

## PART 2 — SATELLITE / WEATHER SELF-RELIANCE

### Free API tier (works today)
- ✅ **CelesTrak GP** — `https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=json` — live TLEs, no auth. With satellite.js (browser lib) BDOC can plot live satellite positions + pass predictions CLIENT-SIDE — works offline once TLEs cached. Cheap, flashy, useful.
- ✅ **SatNOGS DB + Network** — `https://db.satnogs.org/api/` — open community ground-station network; actual downlinked telemetry/observations from amateur+weather sats, open API. This IS "other people's antennas, free."
- **NOAA GOES imagery** — free on AWS Open Data (`noaa-goes19` S3, no auth) + `cdn.star.nesdis.noaa.gov` for ready PNG tiles/loops. Full-disk imagery every 10 min.
- **Iowa State Mesonet NEXRAD WMS** — free radar tiles (already known-good pattern for Leaflet).
- **RainViewer API** — free radar mosaic tiles, global.
- **Open-Meteo** — already integrated (air quality). Also has 16-day forecast, marine, flood (GloFAS river discharge!), climate — all free no key. Flood API = another unique layer.
- **NASA GIBS** — free WMTS satellite imagery tiles (MODIS/VIIRS true color daily).
- **Copernicus Data Space** — free account: Sentinel-1 SAR (sees through clouds/night — flood & ship detection), Sentinel-2 optical. Heavier lift, real GEOINT credibility.

### Direct reception (the self-reliance play) — REAL and cheap
- **RTL-SDR v4 dongle (~$35) + V-dipole antenna (~$15)**: receives NOAA-15/18/19 APT at 137 MHz and Meteor-M N2-3/N2-4 LRPT (better res). Software: **SatDump** (free, actively maintained, does APT+LRPT+GOES). Receiving is LEGAL in the US (unencrypted downlinks).
- **GOES HRIT with ~$150 setup** (SAWbird+ LNA + small dish/grid antenna + RTL-SDR): full-disk imagery direct from the bird, no internet. This is the grid-down weather feed.
- NOAA-15/18/19 status caveat: aging, NOAA has begun decommissioning steps — Meteor LRPT + GOES HRIT are the future-proof paths.
- Ham/GMRS note: RECEIVING needs no license; transmitting on mesh (LoRa ISM band) needs none either.

## PART 3 — MESHTASTIC GRID-DOWN ARCHITECTURE

- **Hardware**: Heltec V3 / LILYGO T-Beam / RAK WisBlock, $25–60 per node. LoRa 915 MHz ISM (US), license-free.
- **Browser link**: **@meshtastic/js** (official JS lib) — a PWA can talk to a node over **Web Bluetooth or Web Serial** (Chrome/Edge; NOT iOS Safari). BDOC could pair with a Meshtastic node directly from the browser. Also Meshtastic Web Client exists as prior art (runs on the node itself via WiFi).
- **Bandwidth truth**: LoRa longfast ≈ sub-1 kbps effective, ~230-byte packets. NO imagery. What fits: alert headlines, lat/lon + type codes, GTA score changes, SITREP one-liners. That's exactly BDOC's alert format.
- **Realistic grid-down stack** (~$250 total): RTL-SDR ($35) + antenna ($15–50) → SatDump on a laptop/Pi → local BDOC desktop (Electron, planned) renders imagery offline → BDOC composes 200-byte alert packets → Meshtastic node ($40) broadcasts to mesh → other users' BDOC PWAs paired to their own $30 nodes receive + plot. MQTT bridge extends mesh over any surviving internet.
- **Prior art to study**: ATAK has Meshtastic plugin (proves demand); Meshtastic MQTT public broker shows global mesh traffic (could even be a BDOC layer: "live mesh nodes near you").

## PART 4 — COMPETITIVE FIELD (honest)

- **ATAK/CivTAK**: free, military-grade, HUGE feature set — but desktop/Android, steep learning curve, ugly onboarding, no curated live OSINT feeds out of the box. BDOC wins on: zero-install browser, curated feeds, causal fusion, consumer UX. BDOC should EXPORT CoT (Cursor-on-Target XML) so ATAK users can consume BDOC feeds — makes us a feed provider to their ecosystem, not a rival.
- **S2 Underground (Ghost Net)**: respected vet audience (our exact market), free docs/videos, DIY ethos — but it's tooling+tradecraft, not a polished product. Potential ALLY/reviewer more than competitor.
- **Liveuamap**: conflict news map, $500+/mo API, no fusion, no infra layers, no offline.
- **Palantir Gotham**: enterprise only, no consumer tier. Not a competitor at $10/mo — an aspiration.
- **Disaster dashboards (PDC DisasterAWARE etc.)**: gov/org-focused, no consumer subscriptions, no cyber layers.
- **White space BDOC can own**: (1) IODA internet-outage layer, (2) causal fusion (already live — genuinely nobody consumer-side has it), (3) CoT export from browser, (4) Meshtastic grid-down broadcast, (5) offline scenario simulation (Electron plan), (6) mesh-node map layer.

### 3 highest-leverage gaps to close for the veteran/EM market
1. **CoT/ATAK export** — instant credibility with the exact Grand Thumb / vet audience; small build (CoT is simple XML over UDP/file).
2. **Grid-down demo video** — RTL-SDR → BDOC → Meshtastic working end-to-end once, on camera. That's the marketing moment for this market.
3. **Free abuse.ch/ransomware.live/CF Radar keys + IODA layer** — makes the cyber picture visibly deeper than any competitor screenshot.

## BUDGET
- Software/APIs: $0 (all free tiers; 3 free key registrations needed: ransomware.live PRO, abuse.ch, Cloudflare)
- Grid-down hardware pilot: ~$90 minimum (RTL-SDR + dipole + 1 Heltec node) to ~$250 full (GOES dish + 2 nodes)
