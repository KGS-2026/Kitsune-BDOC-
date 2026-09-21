# BDOC Plugin Receiver Specification

**BDOC as Wide Receiver** — catches data from any local app running in the background.

## Overview

BDOC runs a **local IPC server** that external apps push data to. Each app (Wireshark, inSSIDer, Meshtastic, etc.) sends structured JSON payloads. BDOC receives, normalizes, and renders them on the globe.

## Architecture

```
Customer Machine (Offline-capable)
├── BDOC App (Electron/Web) ← Main UI
│   └── IPC Server: localhost:9876
│       ├── /api/v1/wireshark/packet
│       ├── /api/v1/wifi/scan
│       ├── /api/v1/mesh/node
│       ├── /api/v1/flightradar/aircraft
│       └── /api/v1/shodan/device
├── Wireshark (background) → sends packets to BDOC
├── inSSIDer (background) → sends WiFi scans to BDOC
├── Meshtastic Receptor (background) → sends mesh nodes to BDOC
├── FlightRadar Poller (background) → sends aircraft to BDOC
└── Custom Sensor (background) → sends any data to BDOC
```

## Data Flow

1. **App (QB)** runs in background, monitors system
2. **Sends POST** to `http://localhost:9876/api/v1/{source}/{datatype}`
3. **BDOC (WR)** receives, validates, caches
4. **Globe renders** in real-time
5. **Mesh broadcasts** if offline (optional)

## Receiver Endpoints

### Base URL
```
http://localhost:9876/api/v1
```

### 1. Wireshark Packet Capture
```
POST /wireshark/packet
Content-Type: application/json

{
  "timestamp": "2026-09-21T12:34:56.789Z",
  "src_ip": "192.168.1.100",
  "dst_ip": "8.8.8.8",
  "src_port": 54321,
  "dst_port": 443,
  "protocol": "TLS",
  "packet_size": 1500,
  "flags": "SYN",
  "geo_src": { "lat": 40.7128, "lon": -74.0060 },
  "geo_dst": { "lat": 37.3861, "lon": -122.0839 }
}
```

**Visualization:**
- Line from `geo_src` to `geo_dst` on globe
- Color: protocol (TLS=blue, HTTP=yellow, DNS=cyan)
- Thickness: packet size
- Pulse animation on transmission
- Click to see src/dst details

---

### 2. WiFi Network Scan (inSSIDer)
```
POST /wifi/scan
Content-Type: application/json

{
  "timestamp": "2026-09-21T12:34:56.789Z",
  "location": { "lat": 40.7128, "lon": -74.0060 },
  "networks": [
    {
      "ssid": "HomeNet",
      "bssid": "AA:BB:CC:DD:EE:FF",
      "channel": 6,
      "frequency_ghz": 2.4,
      "signal_dbm": -45,
      "signal_quality_percent": 90,
      "security": "WPA2",
      "vendor": "Netgear",
      "phytype": "802.11n"
    }
  ]
}
```

**Visualization:**
- Heatmap overlay at `location`: green (strong), yellow (weak), red (interference)
- Click network → shows SSID, channel, security, vendor
- Color-code by channel (1,6,11 in 2.4GHz → different colors)
- Overlap detection: red outline if channels conflict
- Signal strength trend: sparkline over 1 hour

---

### 3. Meshtastic Mesh Node
```
POST /mesh/node
Content-Type: application/json

{
  "timestamp": "2026-09-21T12:34:56.789Z",
  "node_id": "!abc12345",
  "long_name": "John's Device",
  "short_name": "John",
  "hw_model": "RAK4631",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "altitude": 15,
  "battery_level": 85,
  "snr": 10.5,
  "rssi": -95,
  "last_heard": "2026-09-21T12:34:56.789Z"
}
```

**Visualization:**
- Lime-green dot at coordinates
- Label: `long_name` or `short_name`
- Click → detail panel: battery, signal quality, last heard
- Mesh path overlay: lines to neighboring nodes (if hop info available)
- Status indicator: green=online, yellow=stale (>5m), red=offline (>1h)

---

### 4. Aircraft (FlightRadar24)
```
POST /flightradar/aircraft
Content-Type: application/json

{
  "timestamp": "2026-09-21T12:34:56.789Z",
  "icao": "a123456",
  "callsign": "UAL123",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "altitude_ft": 35000,
  "heading": 225,
  "speed_knots": 480,
  "aircraft_type": "B738",
  "airline": "United",
  "origin": "SFO",
  "destination": "LAX"
}
```

**Visualization:**
- Aircraft icon (rotated by heading) at coordinates
- Label: callsign (UAL123)
- Trail: 30-min history line behind aircraft
- Click → detail: route, altitude, speed, aircraft type
- Color: airline or aircraft type

---

### 5. Exposed Device (Shodan/Censys)
```
POST /shodan/device
Content-Type: application/json

{
  "timestamp": "2026-09-21T12:34:56.789Z",
  "ip": "203.0.113.42",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "hostname": "router.example.com",
  "ports": [22, 80, 443, 8080],
  "services": ["ssh", "http", "https", "http-proxy"],
  "vulnerabilities": ["CVE-2024-1234"],
  "threat_level": "high",
  "last_seen": "2026-09-21T12:00:00Z"
}
```

**Visualization:**
- Red warning diamond at coordinates (indicates threat)
- Click → detail: IP, hostname, open ports, vulnerabilities, threat level
- Pulse animation intensity = threat level
- Cluster markers if multiple devices in same area

---

### 6. Custom Sensor Data
```
POST /sensor/reading
Content-Type: application/json

{
  "timestamp": "2026-09-21T12:34:56.789Z",
  "sensor_id": "temp-01",
  "sensor_name": "Downtown Thermometer",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "value": 72.5,
  "unit": "°F",
  "normal_range": [60, 85],
  "threshold_min": 50,
  "threshold_max": 95,
  "status": "normal"
}
```

**Visualization:**
- Circle at coordinates, color by value range (blue=cold, red=hot)
- Label: `sensor_name` + value
- Click → detail: full reading, range, thresholds
- Trend: sparkline of last 24h readings

---

## Response Format (All Endpoints)

**Success (200):**
```json
{
  "status": "received",
  "id": "msg-abc123",
  "stored_at": "2026-09-21T12:34:56.789Z"
}
```

**Error (400):**
```json
{
  "status": "error",
  "error": "Invalid packet: missing src_ip",
  "code": "VALIDATION_ERROR"
}
```

**Server unavailable (503):**
```json
{
  "status": "offline",
  "message": "BDOC not running"
}
```

---

## Client Implementation Examples

### Wireshark Plugin (tcpdump → BDOC)
```bash
#!/bin/bash
# Listen to network traffic, forward to BDOC

tcpdump -i any -l | while read line; do
  # Parse tcpdump output, extract src/dst IP, port, protocol
  # POST to http://localhost:9876/api/v1/wireshark/packet
  curl -X POST http://localhost:9876/api/v1/wireshark/packet \
    -H "Content-Type: application/json" \
    -d '{"src_ip":"...","dst_ip":"...","protocol":"..."}'
done
```

### inSSIDer Integration (Python)
```python
import requests
import subprocess
import json
import time

BDOC_URL = "http://localhost:9876/api/v1/wifi/scan"

def scan_wifi():
    result = subprocess.run(
        ["nmcli", "device", "wifi", "list"],
        capture_output=True, text=True
    )
    # Parse nmcli output, extract SSID, signal, security
    # GET geolocation (GPS or IP-based)
    payload = {
        "timestamp": time.time(),
        "location": {"lat": ..., "lon": ...},
        "networks": [...]
    }
    requests.post(BDOC_URL, json=payload)

# Run every 30 seconds
while True:
    scan_wifi()
    time.sleep(30)
```

### Meshtastic Receptor (already built)
```python
# mesh-receptor.py already sends to:
# POST http://localhost:9876/api/v1/mesh/node
```

---

## Offline Mode

When BDOC has **no internet**, it:
1. **Caches all received data** in local SQLite DB
2. **Renders on globe** from cache
3. **Broadcasts to mesh** (if Meshtastic enabled) so other devices see the data
4. **Syncs on reconnect** when internet returns

---

## Security

- **No authentication required** (runs on localhost, customer's machine)
- **Rate limiting:** 1000 msg/min per endpoint
- **Data retention:** 72 hours by default (configurable)
- **No external sends** (data stays on device unless customer opts to sync to cloud)

---

## BDOC Globe Integration

Each data source gets a **layer toggle**:
- ☐ Wireshark (Packet Flows)
- ☐ WiFi Scans (Heatmap)
- ☐ Mesh Nodes (Lime Dots)
- ☐ Aircraft (Icons + Trails)
- ☐ Exposed Devices (Red Warnings)
- ☐ Custom Sensors (Value Circles)

All render simultaneously, **no performance hit** (uses Cesium instancing + spatial indexing).

---

## Next Steps

1. Build **Node.js IPC server** in BDOC (port 9876)
2. Implement **receiver handlers** for each endpoint
3. Build **layer toggles** in UI
4. Create **sample clients** (wireshark-poller, wifi-scanner, etc.)
5. Test offline + online sync
