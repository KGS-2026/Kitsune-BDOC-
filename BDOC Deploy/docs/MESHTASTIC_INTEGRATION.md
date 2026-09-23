# BDOC Meshtastic Integration

Connect a Meshtastic mesh network to BDOC to receive offline positioning, messages, and telemetry from deployed nodes. This is ideal for air-gapped operations, disaster response, and remote areas without cellular/internet.

## Quick Start

### 1. Install Dependencies

```bash
pip install meshtastic aiohttp websockets
```

### 2. Run the Receptor

#### Option A: With Hardware (Meshtastic Node)

```bash
# Auto-detect serial port
python meshtastic_receptor.py

# Explicit serial port (Linux/macOS)
python meshtastic_receptor.py --port /dev/ttyUSB0

# Windows
python meshtastic_receptor.py --port COM3

# Network-connected node
python meshtastic_receptor.py --tcp 192.168.1.100
```

#### Option B: Test Mode (No Hardware)

```bash
# Generate fake mesh data for 60 seconds
python meshtastic_receptor.py --test --duration 60

# Continuous test
python meshtastic_receptor.py --test --duration 3600
```

### 3. Run Supabase Migration

1. Go to Supabase Dashboard → Your Project → SQL Editor
2. Copy the contents of `docs/mesh-setup.sql`
3. Run as a new query
4. Tables created: `mesh_nodes`, `mesh_messages`, `mesh_trail`, `mesh_telemetry`

## Architecture

```
[Meshtastic Hardware] --USB--> [meshtastic_receptor.py]
                                       |
                                     HTTP POST
                                       |
                            [BDOC Netlify Function]
                            /.netlify/functions/mesh-ingest
                                       |
                                  Supabase Tables
                                       |
        [BDOC Web App] <-- Real-time subscription <-- [mesh_nodes, mesh_messages]
```

## Data Flow

### Position Events
- **Source**: Meshtastic POSITION_APP
- **Stored in**: `mesh_nodes` (latest), `mesh_trail` (history)
- **Fields**: lat, lon, altitude, rssi, snr
- **Display**: Real-time markers on BDOC globe

### Text Messages
- **Source**: Meshtastic TEXT_MESSAGE_APP
- **Stored in**: `mesh_messages`
- **Fields**: sender, recipient, text, hop_limit, rssi, snr
- **Display**: Message log in BDOC tactical console

### Telemetry
- **Source**: Meshtastic TELEMETRY_APP
- **Stored in**: `mesh_telemetry`
- **Fields**: battery, voltage, channel_util, air_util_tx
- **Display**: Node health indicators

### Node Info
- **Source**: Meshtastic NODEINFO_APP
- **Stored in**: `mesh_nodes`
- **Fields**: node_id, long_name, short_name, hw_model
- **Display**: Node list and metadata

## Configuration

### Custom Endpoint

By default, the receptor sends data to the live BDOC deployment. To use a local/dev endpoint:

```bash
python meshtastic_receptor.py --http http://localhost:3000/.netlify/functions/mesh-ingest
```

### Environment Variables

The mesh-ingest function uses `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from Netlify env vars. No additional config needed.

## Testing the Flow

1. Start the receptor in test mode:
   ```bash
   python meshtastic_receptor.py --test --duration 120
   ```

2. Check Supabase in real-time:
   - Go to Supabase Dashboard → `mesh_nodes` → data should appear
   - Go to `mesh_messages` → messages should appear

3. In BDOC, add a **Mesh Network** layer:
   - Layer → + New → Custom → GeoJSON
   - Query: `SELECT * FROM mesh_nodes WHERE latitude IS NOT NULL`
   - Render as markers with node name

## Deployment

To deploy as a systemd service on your BDOC droplet:

```bash
# Create service file
sudo tee /etc/systemd/system/bdoc-mesh.service > /dev/null <<EOF
[Unit]
Description=BDOC Meshtastic Receptor
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/Kitsune-BDOC-/BDOC\ Deploy
ExecStart=/usr/bin/python3 meshtastic_receptor.py --tcp 192.168.1.100
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable bdoc-mesh
sudo systemctl start bdoc-mesh

# Check status
sudo systemctl status bdoc-mesh
sudo journalctl -u bdoc-mesh -f
```

## Troubleshooting

### "meshtastic library not installed"
```bash
pip install meshtastic
```

### "Connection refused" on TCP mode
- Ensure your Meshtastic device is powered on and reachable
- Check the IP address: `meshtastic --info`

### No data appearing in Supabase
- Check receptor logs for HTTP errors
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set in Netlify env
- Test the endpoint: `curl -X POST https://kgsbdoc.netlify.app/.netlify/functions/mesh-ingest -H 'Content-Type: application/json' -d '{"source":"meshtastic","type":"position","timestamp":"2026-09-19T12:00:00Z","data":{"sender":"!deadbeef","latitude":30.5,"longitude":-85.0}}'`

### Receptor disconnects intermittently
- Check USB/serial stability
- Reduce data rate or increase retry delays in the script
- Use TCP mode instead of serial if possible

## Links

- [Meshtastic Hardware](https://meshtastic.org/docs/overview/)
- [Meshtastic Python API](https://meshtastic.org/docs/developers/python/)
- [BDOC Layer System](../IMPLEMENTATION_PLAN.md)
