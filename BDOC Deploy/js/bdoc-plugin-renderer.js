// js/bdoc-plugin-renderer.js
// Renders IPC-received plugin data (Wireshark / WiFi / Mesh / Aircraft / Shodan / Sensors)
// onto the Cesium globe.
//
// FIXES vs first draft:
//  - used `viewer`; the real global is `V` (js/cesium-init.js)
//  - GET on POST-only IPC paths (405) -> receiver now serves GET, and we read `.nodes`
//  - Cesium.Cesium3DTilesets.BoxGraphics is not a real API -> aircraft use a billboard-free point
//  - 6 sequential awaits per tick at 1s -> parallel + 2s, and backs off when IPC is down
//  - WiFi cleanup used a broken substring() key match, leaking entities forever

const pluginRenderer = {
  ipcUrl: 'http://127.0.0.1:9876/api/v1',
  pollInterval: 2000,
  pollHandle: null,
  online: false,
  failures: 0,
  layers: {
    wireshark: { enabled: true, path: 'wireshark/packet',     entities: new Map() },
    wifi:      { enabled: true, path: 'wifi/scan',            entities: new Map() },
    mesh:      { enabled: true, path: 'mesh/node',            entities: new Map() },
    aircraft:  { enabled: true, path: 'flightradar/aircraft', entities: new Map() },
    shodan:    { enabled: true, path: 'shodan/device',        entities: new Map() },
    sensor:    { enabled: true, path: 'sensor/reading',       entities: new Map() }
  },

  get viewer() {
    return (typeof V !== 'undefined' && V) ? V : (typeof window !== 'undefined' ? window.V : null);
  },

  async init() {
    if (!this.viewer) { setTimeout(() => this.init(), 2000); return; }
    try {
      const s = await this._json('status');
      this.online = !!s;
      console.log('[Plugin Renderer] IPC', this.online ? 'connected' : 'not detected');
    } catch (e) { console.log('[Plugin Renderer] IPC not detected (local apps not running)'); }
    this.pollHandle = setInterval(() => this.poll(), this.pollInterval);
  },

  async _json(path) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    try {
      const res = await fetch(`${this.ipcUrl}/${path}`, { signal: ctl.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; } finally { clearTimeout(t); }
  },

  async poll() {
    const jobs = Object.entries(this.layers)
      .filter(([, l]) => l.enabled)
      .map(([name, l]) => this._json(l.path).then(r => [name, r]));
    const results = await Promise.all(jobs);

    const anyOk = results.some(([, r]) => r && Array.isArray(r.nodes));
    if (!anyOk) {
      // IPC gone: back off so we don't spam a dead port, and clear stale geometry once.
      if (this.online) { this.online = false; this.clearAll(); console.log('[Plugin Renderer] IPC offline'); }
      this.failures++;
      if (this.failures === 5) { clearInterval(this.pollHandle); this.pollHandle = setInterval(() => this.poll(), 15000); }
      return;
    }
    if (!this.online) { console.log('[Plugin Renderer] IPC online'); }
    this.online = true; this.failures = 0;

    for (const [name, r] of results) {
      if (!r || !Array.isArray(r.nodes)) continue;
      const fn = { wireshark: 'renderWireshark', wifi: 'renderWiFi', mesh: 'renderMesh',
                   aircraft: 'renderAircraft', shodan: 'renderShodan', sensor: 'renderSensor' }[name];
      try { this[fn](r.nodes); } catch (e) { console.error(`[Plugin Renderer] ${name}:`, e.message); }
    }
  },

  // ---- helpers -------------------------------------------------------------
  _sync(layerName, wanted /* Map<id, addFn> */) {
    const v = this.viewer; if (!v) return;
    const layer = this.layers[layerName];
    for (const [id, addFn] of wanted) {
      if (!layer.entities.has(id)) {
        const e = addFn(v, id);
        if (e) layer.entities.set(id, e);
      }
    }
    for (const [id, e] of Array.from(layer.entities.entries())) {
      if (!wanted.has(id)) { v.entities.remove(e); layer.entities.delete(id); }
    }
  },

  _label(text, color) {
    return { text, font: '11px monospace', fillColor: color || Cesium.Color.WHITE,
             outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
             pixelOffset: new Cesium.Cartesian2(0, -16),
             disableDepthTestDistance: Number.POSITIVE_INFINITY };
  },

  // ---- layers --------------------------------------------------------------
  renderWireshark(packets) {
    const wanted = new Map();
    for (const p of packets) {
      if (!p.geo_src || !p.geo_dst) continue;                 // no geo => nothing to draw
      const id = `pkt:${p.src_ip}>${p.dst_ip}:${p.dst_port || 0}`;
      const color = p.protocol === 'TLS' ? Cesium.Color.DEEPSKYBLUE
                  : p.protocol === 'HTTP' ? Cesium.Color.YELLOW
                  : p.protocol === 'DNS' ? Cesium.Color.CYAN : Cesium.Color.WHITE;
      wanted.set(id, (v) => v.entities.add({
        id,
        polyline: {
          positions: [Cesium.Cartesian3.fromDegrees(p.geo_src.lon, p.geo_src.lat, 0),
                      Cesium.Cartesian3.fromDegrees(p.geo_dst.lon, p.geo_dst.lat, 0)],
          width: Math.max(1, Math.min(6, (p.packet_size || 0) / 400)),
          material: new Cesium.PolylineGlowMaterialProperty({ color: color.withAlpha(0.8), glowPower: 0.2 }),
          arcType: Cesium.ArcType.GEODESIC
        },
        properties: { type: 'wireshark_flow', src_ip: p.src_ip, dst_ip: p.dst_ip, protocol: p.protocol, packet_size: p.packet_size, port: p.dst_port }
      }));
    }
    this._sync('wireshark', wanted);
  },

  renderWiFi(scans) {
    const wanted = new Map();
    for (const scan of scans) {
      if (!scan.location) continue;
      for (const net of (scan.networks || [])) {
        const id = `wifi:${scan.location.lat},${scan.location.lon}:${net.bssid || net.ssid}`;
        const dbm = typeof net.signal_dbm === 'number' ? net.signal_dbm : -90;
        const strength = Math.max(0, Math.min(100, ((dbm + 90) / 60) * 100));
        const color = strength > 70 ? Cesium.Color.LIME : strength > 40 ? Cesium.Color.YELLOW : Cesium.Color.ORANGERED;
        wanted.set(id, (v) => v.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(scan.location.lon, scan.location.lat, 50),
          point: { pixelSize: 10, color: color.withAlpha(0.8), outlineColor: Cesium.Color.WHITE, outlineWidth: 1,
                   disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: this._label(`${net.ssid || '(hidden)'} ch${net.channel ?? '?'} ${dbm}dBm`),
          properties: { type: 'wifi_network', ssid: net.ssid, channel: net.channel, signal_dbm: dbm, security: net.security, vendor: net.vendor }
        }));
      }
    }
    this._sync('wifi', wanted);
  },

  renderMesh(nodes) {
    const wanted = new Map();
    for (const n of nodes) {
      const id = `ipcmesh:${n.node_id}`;
      wanted.set(id, (v) => v.entities.add({
        id,
        position: Cesium.Cartesian3.fromDegrees(n.longitude, n.latitude, n.altitude || 0),
        point: { pixelSize: 8, color: Cesium.Color.LIME, outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
                 disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: this._label(n.long_name || n.short_name || n.node_id),
        properties: { type: 'mesh_node', node_id: n.node_id, battery: n.battery_level, snr: n.snr, rssi: n.rssi, hw_model: n.hw_model }
      }));
    }
    this._sync('mesh', wanted);
  },

  renderAircraft(planes) {
    const wanted = new Map();
    for (const a of planes) {
      const id = `air:${a.icao}`;
      wanted.set(id, (v) => v.entities.add({
        id,
        position: Cesium.Cartesian3.fromDegrees(a.longitude, a.latitude, (a.altitude_ft || 0) * 0.3048),
        point: { pixelSize: 7, color: Cesium.Color.YELLOW, outlineColor: Cesium.Color.BLACK, outlineWidth: 1,
                 disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: this._label(a.callsign || a.icao, Cesium.Color.YELLOW),
        properties: { type: 'aircraft', callsign: a.callsign, airline: a.airline, origin: a.origin,
                      destination: a.destination, altitude_ft: a.altitude_ft, speed_knots: a.speed_knots, heading: a.heading }
      }));
    }
    this._sync('aircraft', wanted);
  },

  renderShodan(devices) {
    const wanted = new Map();
    for (const d of devices) {
      const id = `dev:${d.ip}`;
      const color = d.threat_level === 'critical' ? Cesium.Color.RED
                  : d.threat_level === 'high' ? Cesium.Color.ORANGE
                  : d.threat_level === 'medium' ? Cesium.Color.YELLOW : Cesium.Color.GRAY;
      wanted.set(id, (v) => v.entities.add({
        id,
        position: Cesium.Cartesian3.fromDegrees(d.longitude, d.latitude, 0),
        point: { pixelSize: 12, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
                 disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: this._label(d.hostname || d.ip),
        properties: { type: 'exposed_device', ip: d.ip, hostname: d.hostname, ports: d.ports,
                      vulnerabilities: d.vulnerabilities, threat_level: d.threat_level }
      }));
    }
    this._sync('shodan', wanted);
  },

  renderSensor(readings) {
    const wanted = new Map();
    for (const r of readings) {
      const id = `sen:${r.sensor_id}`;
      const range = Array.isArray(r.normal_range) ? r.normal_range : [-Infinity, Infinity];
      const tmin = typeof r.threshold_min === 'number' ? r.threshold_min : -Infinity;
      const tmax = typeof r.threshold_max === 'number' ? r.threshold_max : Infinity;
      const color = (r.value < tmin || r.value > tmax) ? Cesium.Color.RED
                  : (r.value < range[0] || r.value > range[1]) ? Cesium.Color.YELLOW : Cesium.Color.LIME;
      wanted.set(id, (v) => v.entities.add({
        id,
        position: Cesium.Cartesian3.fromDegrees(r.longitude, r.latitude, 0),
        point: { pixelSize: 10, color: color.withAlpha(0.85), outlineColor: Cesium.Color.WHITE, outlineWidth: 1,
                 disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: this._label(`${r.sensor_name || r.sensor_id}: ${r.value}${r.unit || ''}`),
        properties: { type: 'sensor_reading', sensor_name: r.sensor_name, value: r.value, unit: r.unit, status: r.status }
      }));
    }
    this._sync('sensor', wanted);
  },

  toggleLayer(name) {
    const l = this.layers[name];
    if (!l) return;
    l.enabled = !l.enabled;
    if (!l.enabled) {
      const v = this.viewer;
      if (v) for (const e of l.entities.values()) v.entities.remove(e);
      l.entities.clear();
    }
    return l.enabled;
  },

  clearAll() {
    const v = this.viewer; if (!v) return;
    for (const l of Object.values(this.layers)) {
      for (const e of l.entities.values()) v.entities.remove(e);
      l.entities.clear();
    }
  },

  destroy() { if (this.pollHandle) clearInterval(this.pollHandle); this.clearAll(); }
};

if (typeof window !== 'undefined') {
  window.pluginRenderer = pluginRenderer;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => pluginRenderer.init());
  else pluginRenderer.init();
}
