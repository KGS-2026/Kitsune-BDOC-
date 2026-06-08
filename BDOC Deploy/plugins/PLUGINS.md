# KITSUNE BDOC — Integration Plugins
## Kitsune Global Solutions LLC · SDVOSB · CAGE: 174S8

Three companion tools that bridge enterprise security platforms into BDOC globe.

---

## 1. SPLUNK — Tactical Feed (`plugins/splunk/`)

**What:** Splunk app that exports SIEM events to BDOC-compatible GeoJSON.

**Install:**
1. Copy `bdoc_tactical_feed/` folder to `$SPLUNK_HOME/etc/apps/`
2. Restart Splunk
3. Navigate to Apps → BDOC Tactical Feed

**Included:**
- `savedsearches.conf` — 5 pre-built searches (Threats, APT, Anomalies, Auth Failures, Malware)
- `bdoc_dashboard.xml` — Dark-themed Splunk dashboard with threat map
- `bdoc_export.py` — CLI tool to convert Splunk CSV → GeoJSON

**Usage:**
```bash
# Export from Splunk CLI
splunk search '| savedsearch "BDOC - Threat Events (Last 24h)"' -output csv > threats.csv
python bin/bdoc_export.py -i threats.csv -o bdoc_threats.geojson

# Or push directly to BDOC API
python bin/bdoc_export.py --stdin --push https://your-bdoc/api/ingest
```

---

## 2. WIRESHARK — Threat Export (`plugins/wireshark/`)

**What:** Lua plugin that analyzes packet captures and exports threat indicators.

**Install:**
1. Copy `bdoc_threat_export.lua` to Wireshark plugins folder:
   - Windows: `%APPDATA%\Wireshark\plugins\`
   - Linux: `~/.local/lib/wireshark/plugins/`
2. Restart Wireshark (or Ctrl+Shift+L to reload)

**Features:**
- Detects port scans, brute force, C2 beaconing, DNS tunneling, data exfil
- Flags 24 suspicious ports (Metasploit, TOR, RDP, Docker API, etc.)
- Classifies all public IPs by threat severity

**Usage:**
1. Capture packets normally
2. Tools → BDOC Threat Export
3. Run `python bdoc_geo_enrich.py bdoc_wireshark_export.geojson` to add geolocation
4. Import enriched GeoJSON into BDOC

---

## 3. inSSIDer — WiFi Intelligence (`plugins/inssider/`)

**What:** Companion tool that converts WiFi scan data into BDOC SIGINT overlay.

**Supported Sources:**
- inSSIDer CSV export
- Wigle.net CSV export
- Live Windows/Linux WiFi scan
- Manual JSON input

**Features:**
- Security classification (WPA3/WPA2/WPA/WEP/OPEN)
- Rogue AP detection (default SSIDs, open networks)
- Hidden network identification
- Vendor lookup from MAC OUI (50+ manufacturers)
- Signal strength mapping

**Usage:**
```bash
# From inSSIDer export
python bdoc_wifi_intel.py --inssider scan.csv --location 33.749,-84.388

# From Wigle wardrive data
python bdoc_wifi_intel.py --wigle wigle_export.csv

# Live scan (no external tools needed)
python bdoc_wifi_intel.py --live --location 33.749,-84.388

# Import output into BDOC via File → Import GeoJSON
```

---

All plugins output standard GeoJSON with BDOC-specific metadata fields.
Import any output file into BDOC via **File → Import GeoJSON**.
