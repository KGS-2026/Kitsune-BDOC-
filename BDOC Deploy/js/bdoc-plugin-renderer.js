// js/bdoc-plugin-renderer.js
// Renders data from IPC receiver onto Cesium globe
// Handles: Wireshark flows, WiFi heatmaps, Mesh nodes, Aircraft, Exposed devices, Sensors

const pluginRenderer = {
  ipcUrl: 'http://localhost:9876/api/v1',
  pollInterval: 1000, // Query IPC every 1s
  pollHandle: null,
  layers: {
    wireshark: { enabled: true, entities: new Map() },
    wifi: { enabled: true, entities: new Map() },
    mesh: { enabled: true, entities: new Map() },
    aircraft: { enabled: true, entities: new Map() },
    shodan: { enabled: true, entities: new Map() },
    sensor: { enabled: true, entities: new Map() }
  },

  async init() {
    console.log('[Plugin Renderer] Initializing IPC renderer');

    // Check if IPC server is running
    try {
      const status = await fetch(`${this.ipcUrl}/status`).then(r => r.json());
      console.log('[Plugin Renderer] IPC server ready:', status);
    } catch (e) {
      console.warn('[Plugin Renderer] IPC server not responding (will retry):', e.message);
    }

    // Start polling IPC for new data
    this.pollHandle = setInterval(() => this.pollIPC(), this.pollInterval);
  },

  async pollIPC() {
    try {
      // Get Wireshark flows
      const wireshark = await fetch(`${this.ipcUrl}/wireshark/packet`)
        .then(r => r.json())
        .then(d => d.nodes || [])
        .catch(e => []);
      this.renderWiresharkFlows(wireshark);

      // Get WiFi scans
      const wifi = await fetch(`${this.ipcUrl}/wifi/scan`)
        .then(r => r.json())
        .then(d => d.nodes || [])
        .catch(e => []);
      this.renderWiFiScans(wifi);

      // Get Mesh nodes
      const mesh = await fetch(`${this.ipcUrl}/mesh/node`)
        .then(r => r.json())
        .then(d => d.nodes || [])
        .catch(e => []);
      this.renderMeshNodes(mesh);

      // Get Aircraft
      const aircraft = await fetch(`${this.ipcUrl}/flightradar/aircraft`)
        .then(r => r.json())
        .then(d => d.nodes || [])
        .catch(e => []);
      this.renderAircraft(aircraft);

      // Get Exposed devices
      const shodan = await fetch(`${this.ipcUrl}/shodan/device`)
        .then(r => r.json())
        .then(d => d.nodes || [])
        .catch(e => []);
      this.renderShodanDevices(shodan);

      // Get Sensor readings
      const sensor = await fetch(`${this.ipcUrl}/sensor/reading`)
        .then(r => r.json())
        .then(d => d.nodes || [])
        .catch(e => []);
      this.renderSensorReadings(sensor);
    } catch (e) {
      console.debug('[Plugin Renderer] Poll error:', e.message);
    }
  },

  renderWiresharkFlows(packets) {
    if (!this.layers.wireshark.enabled) return;

    const activePackets = new Set();
    for (const pkt of packets) {
      const id = `pkt-${pkt.src_ip}-${pkt.dst_ip}`;
      activePackets.add(id);

      if (!this.layers.wireshark.entities.has(id)) {
        const srcPos = Cesium.Cartesian3.fromDegrees(pkt.geo_src.lon, pkt.geo_src.lat, 0);
        const dstPos = Cesium.Cartesian3.fromDegrees(pkt.geo_dst.lon, pkt.geo_dst.lat, 0);

        // Color by protocol
        let color = Cesium.Color.WHITE;
        if (pkt.protocol === 'TLS') color = Cesium.Color.BLUE;
        else if (pkt.protocol === 'HTTP') color = Cesium.Color.YELLOW;
        else if (pkt.protocol === 'DNS') color = Cesium.Color.CYAN;

        const entity = viewer.entities.add({
          id,
          polyline: {
            positions: [srcPos, dstPos],
            width: 2,
            material: color.withAlpha(0.6),
            clampToGround: false
          },
          properties: {
            type: 'wireshark_flow',
            src_ip: pkt.src_ip,
            dst_ip: pkt.dst_ip,
            protocol: pkt.protocol,
            packet_size: pkt.packet_size,
            port: pkt.dst_port
          }
        });

        this.layers.wireshark.entities.set(id, entity);
      }
    }

    // Remove inactive flows
    for (const [id, entity] of this.layers.wireshark.entities.entries()) {
      if (!activePackets.has(id)) {
        viewer.entities.remove(entity);
        this.layers.wireshark.entities.delete(id);
      }
    }
  },

  renderWiFiScans(scans) {
    if (!this.layers.wifi.enabled) return;

    const activeScans = new Set();
    for (const scan of scans) {
      const id = `wifi-${scan.location.lat}-${scan.location.lon}`;
      activeScans.add(id);

      if (!this.layers.wifi.entities.has(id)) {
        for (const net of scan.networks) {
          const netId = `${id}-${net.bssid}`;

          // Signal strength: -30 dBm (strong) to -90 dBm (weak)
          const strength = Math.max(0, Math.min(100, (net.signal_dbm + 90) * 10 / 6));
          const color = strength > 70 ? Cesium.Color.LIME
                      : strength > 40 ? Cesium.Color.YELLOW
                      : Cesium.Color.RED;

          const entity = viewer.entities.add({
            id: netId,
            position: Cesium.Cartesian3.fromDegrees(scan.location.lon, scan.location.lat, 100),
            point: {
              pixelSize: 10,
              color: color.withAlpha(0.7),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 1
            },
            label: {
              text: net.ssid,
              font: '11px IBM Plex Sans',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 1,
              pixelOffset: new Cesium.Cartesian2(0, -20)
            },
            properties: {
              type: 'wifi_network',
              ssid: net.ssid,
              channel: net.channel,
              signal_dbm: net.signal_dbm,
              security: net.security,
              vendor: net.vendor
            }
          });

          this.layers.wifi.entities.set(netId, entity);
        }
      }
    }

    // Remove inactive scans
    for (const [id, entity] of this.layers.wifi.entities.entries()) {
      if (!activeScans.has(id.substring(0, id.lastIndexOf('-')))) {
        viewer.entities.remove(entity);
        this.layers.wifi.entities.delete(id);
      }
    }
  },

  renderMeshNodes(nodes) {
    if (!this.layers.mesh.enabled) return;

    const activeNodes = new Set();
    for (const node of nodes) {
      const id = node.node_id;
      activeNodes.add(id);

      if (!this.layers.mesh.entities.has(id)) {
        const entity = viewer.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(node.longitude, node.latitude, node.altitude || 0),
          point: {
            pixelSize: 8,
            color: Cesium.Color.LIME,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2
          },
          label: {
            text: node.long_name || node.short_name || id,
            font: '11px IBM Plex Mono',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            pixelOffset: new Cesium.Cartesian2(0, -15)
          },
          properties: {
            type: 'mesh_node',
            node_id: id,
            battery: node.battery_level,
            snr: node.snr,
            rssi: node.rssi,
            hw_model: node.hw_model
          }
        });

        this.layers.mesh.entities.set(id, entity);
      }
    }

    // Remove inactive nodes
    for (const [id, entity] of this.layers.mesh.entities.entries()) {
      if (!activeNodes.has(id)) {
        viewer.entities.remove(entity);
        this.layers.mesh.entities.delete(id);
      }
    }
  },

  renderAircraft(planes) {
    if (!this.layers.aircraft.enabled) return;

    const activeAircraft = new Set();
    for (const plane of planes) {
      const id = plane.icao;
      activeAircraft.add(id);

      if (!this.layers.aircraft.entities.has(id)) {
        const entity = viewer.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(plane.longitude, plane.latitude, plane.altitude_ft * 0.3048),
          model: {
            uri: Cesium.Cesium3DTilesets.BoxGraphics, // Placeholder
            scale: 100000
          },
          label: {
            text: plane.callsign,
            font: '12px IBM Plex Mono',
            fillColor: Cesium.Color.YELLOW,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            pixelOffset: new Cesium.Cartesian2(0, -20)
          },
          properties: {
            type: 'aircraft',
            callsign: plane.callsign,
            airline: plane.airline,
            origin: plane.origin,
            destination: plane.destination,
            altitude_ft: plane.altitude_ft,
            speed_knots: plane.speed_knots,
            heading: plane.heading
          }
        });

        this.layers.aircraft.entities.set(id, entity);
      }
    }

    // Remove inactive aircraft
    for (const [id, entity] of this.layers.aircraft.entities.entries()) {
      if (!activeAircraft.has(id)) {
        viewer.entities.remove(entity);
        this.layers.aircraft.entities.delete(id);
      }
    }
  },

  renderShodanDevices(devices) {
    if (!this.layers.shodan.enabled) return;

    const activeDevices = new Set();
    for (const dev of devices) {
      const id = dev.ip;
      activeDevices.add(id);

      if (!this.layers.shodan.entities.has(id)) {
        // Threat level colors
        let color = Cesium.Color.ORANGE;
        if (dev.threat_level === 'critical') color = Cesium.Color.RED;
        else if (dev.threat_level === 'high') color = Cesium.Color.ORANGE;
        else if (dev.threat_level === 'medium') color = Cesium.Color.YELLOW;

        const entity = viewer.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(dev.longitude, dev.latitude, 0),
          point: {
            pixelSize: 12,
            color,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2
          },
          label: {
            text: dev.hostname || dev.ip,
            font: '10px IBM Plex Mono',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            pixelOffset: new Cesium.Cartesian2(0, -18)
          },
          properties: {
            type: 'exposed_device',
            ip: dev.ip,
            hostname: dev.hostname,
            ports: dev.ports,
            vulnerabilities: dev.vulnerabilities,
            threat_level: dev.threat_level
          }
        });

        this.layers.shodan.entities.set(id, entity);
      }
    }

    // Remove inactive devices
    for (const [id, entity] of this.layers.shodan.entities.entries()) {
      if (!activeDevices.has(id)) {
        viewer.entities.remove(entity);
        this.layers.shodan.entities.delete(id);
      }
    }
  },

  renderSensorReadings(readings) {
    if (!this.layers.sensor.enabled) return;

    const activeReadings = new Set();
    for (const reading of readings) {
      const id = `${reading.sensor_id}-${reading.timestamp}`;
      activeReadings.add(id);

      if (!this.layers.sensor.entities.has(id)) {
        // Color by threshold
        let color = Cesium.Color.GREEN;
        if (reading.value < reading.threshold_min || reading.value > reading.threshold_max) {
          color = Cesium.Color.RED;
        } else if (reading.value < reading.normal_range[0] || reading.value > reading.normal_range[1]) {
          color = Cesium.Color.YELLOW;
        }

        const entity = viewer.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(reading.longitude, reading.latitude, 0),
          point: {
            pixelSize: 10,
            color: color.withAlpha(0.7),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1
          },
          label: {
            text: `${reading.sensor_name}: ${reading.value}${reading.unit}`,
            font: '11px IBM Plex Mono',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            pixelOffset: new Cesium.Cartesian2(0, -18)
          },
          properties: {
            type: 'sensor_reading',
            sensor_name: reading.sensor_name,
            value: reading.value,
            unit: reading.unit,
            status: reading.status
          }
        });

        this.layers.sensor.entities.set(id, entity);
      }
    }
  },

  toggleLayer(layer) {
    if (this.layers[layer]) {
      this.layers[layer].enabled = !this.layers[layer].enabled;
      console.log(`[Plugin Renderer] ${layer} layer toggled: ${this.layers[layer].enabled}`);
    }
  },

  destroy() {
    if (this.pollHandle) clearInterval(this.pollHandle);
    for (const layer of Object.values(this.layers)) {
      for (const entity of layer.entities.values()) {
        viewer.entities.remove(entity);
      }
      layer.entities.clear();
    }
  }
};

// Auto-init when Cesium is ready
if (typeof Cesium !== 'undefined' && typeof viewer !== 'undefined') {
  pluginRenderer.init();
}
