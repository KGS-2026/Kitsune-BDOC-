// js/bdoc-ipc-receiver.js
// BDOC IPC Server — receives data from local apps (Wireshark, inSSIDer, Meshtastic, etc.)
// Runs on port 9876, renders data on globe in real-time

const http = require('http');
const url = require('url');

const BDOCReceiver = {
  port: 9876,
  server: null,
  stores: {
    wireshark: new Map(),    // packet flows by ID
    wifi: new Map(),          // WiFi scans by timestamp
    mesh: new Map(),          // mesh nodes by node_id
    aircraft: new Map(),      // aircraft by ICAO
    shodan: new Map(),        // exposed devices by IP
    sensor: new Map()         // sensor readings by sensor_id
  },
  maxDataAge: 72 * 60 * 60 * 1000, // 72 hours
  messageQueue: [],           // IPC messages to send to Cesium

  init() {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(this.port, 'localhost', () => {
      console.log(`[BDOC Receiver] IPC server started on port ${this.port}`);
    });
  },

  handleRequest(req, res) {
    const pathname = url.parse(req.url).pathname;
    const method = req.method;

    // CORS + headers
    res.setHeader('Access-Control-Allow-Origin', 'localhost');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Route: POST /api/v1/{source}/{datatype}
    const match = pathname.match(/^\/api\/v1\/(\w+)\/(\w+)$/);
    if (!match) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const [_, source, datatype] = match;

    if (method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          this.handleData(source, datatype, data, res);
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON', code: 'PARSE_ERROR' }));
        }
      });
    } else if (method === 'GET' && pathname === '/api/v1/status') {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'running',
        uptime_ms: process.uptime() * 1000,
        stores: {
          wireshark: this.stores.wireshark.size,
          wifi: this.stores.wifi.size,
          mesh: this.stores.mesh.size,
          aircraft: this.stores.aircraft.size,
          shodan: this.stores.shodan.size,
          sensor: this.stores.sensor.size
        }
      }));
    } else {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  },

  handleData(source, datatype, data, res) {
    try {
      let id = null;

      switch (source) {
        case 'wireshark':
          if (datatype === 'packet') {
            id = `pkt-${data.src_ip}-${data.dst_ip}-${Date.now()}`;
            this.validatePacket(data);
            this.stores.wireshark.set(id, data);
          }
          break;

        case 'wifi':
          if (datatype === 'scan') {
            id = `wifi-${data.location.lat}-${data.location.lon}-${Date.now()}`;
            this.validateWiFiScan(data);
            this.stores.wifi.set(id, data);
          }
          break;

        case 'mesh':
          if (datatype === 'node') {
            id = data.node_id;
            this.validateMeshNode(data);
            this.stores.mesh.set(id, data);
          }
          break;

        case 'flightradar':
          if (datatype === 'aircraft') {
            id = data.icao;
            this.validateAircraft(data);
            this.stores.aircraft.set(id, data);
          }
          break;

        case 'shodan':
          if (datatype === 'device') {
            id = data.ip;
            this.validateDevice(data);
            this.stores.shodan.set(id, data);
          }
          break;

        case 'sensor':
          if (datatype === 'reading') {
            id = `sensor-${data.sensor_id}-${Date.now()}`;
            this.validateSensor(data);
            this.stores.sensor.set(id, data);
          }
          break;

        default:
          throw new Error(`Unknown source: ${source}`);
      }

      // Clean old data
      this.cleanOldData();

      // Queue message to Cesium
      this.messageQueue.push({
        source,
        datatype,
        id,
        timestamp: new Date().toISOString()
      });

      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'received',
        id,
        stored_at: new Date().toISOString()
      }));

      console.log(`[BDOC Receiver] ${source}/${datatype} received (ID: ${id})`);
    } catch (e) {
      console.error(`[BDOC Receiver] Error handling ${source}/${datatype}:`, e.message);
      res.writeHead(400);
      res.end(JSON.stringify({
        status: 'error',
        error: e.message,
        code: 'VALIDATION_ERROR'
      }));
    }
  },

  validatePacket(data) {
    if (!data.src_ip || !data.dst_ip) throw new Error('Missing src_ip or dst_ip');
    if (!data.protocol) throw new Error('Missing protocol');
    if (typeof data.packet_size !== 'number') throw new Error('Invalid packet_size');
  },

  validateWiFiScan(data) {
    if (!data.location || typeof data.location.lat !== 'number') {
      throw new Error('Missing or invalid location.lat');
    }
    if (typeof data.location.lon !== 'number') throw new Error('Invalid location.lon');
    if (!Array.isArray(data.networks)) throw new Error('networks must be array');
  },

  validateMeshNode(data) {
    if (!data.node_id) throw new Error('Missing node_id');
    if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
      throw new Error('Invalid coordinates');
    }
  },

  validateAircraft(data) {
    if (!data.icao || !data.callsign) throw new Error('Missing icao or callsign');
    if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
      throw new Error('Invalid coordinates');
    }
  },

  validateDevice(data) {
    if (!data.ip) throw new Error('Missing ip');
    if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
      throw new Error('Invalid coordinates');
    }
  },

  validateSensor(data) {
    if (!data.sensor_id || !data.sensor_name) throw new Error('Missing sensor_id or sensor_name');
    if (typeof data.value !== 'number') throw new Error('Invalid value');
    if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
      throw new Error('Invalid coordinates');
    }
  },

  cleanOldData() {
    const now = Date.now();
    for (const [store, map] of Object.entries(this.stores)) {
      for (const [id, data] of map.entries()) {
        const dataTime = new Date(data.timestamp).getTime();
        if (now - dataTime > this.maxDataAge) {
          map.delete(id);
        }
      }
    }
  },

  // Exposed API for Cesium to query data
  getWiresharkFlows() {
    return Array.from(this.stores.wireshark.values());
  },

  getWiFiScans() {
    return Array.from(this.stores.wifi.values());
  },

  getMeshNodes() {
    return Array.from(this.stores.mesh.values());
  },

  getAircraft() {
    return Array.from(this.stores.aircraft.values());
  },

  getShodanDevices() {
    return Array.from(this.stores.shodan.values());
  },

  getSensorReadings() {
    return Array.from(this.stores.sensor.values());
  },

  getMessageQueue() {
    const msgs = this.messageQueue.slice();
    this.messageQueue = [];
    return msgs;
  }
};

// Start receiver server
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BDOCReceiver;
}

// Auto-init if running in Node
if (typeof window === 'undefined') {
  BDOCReceiver.init();
}
