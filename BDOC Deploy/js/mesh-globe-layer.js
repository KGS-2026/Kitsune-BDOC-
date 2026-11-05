// js/mesh-globe-layer.js
// Renders Meshtastic mesh nodes on the Cesium globe.
// NOTE: the globe viewer in this app is the global `V` (see js/cesium-init.js), NOT `viewer`.

const meshGlobeLayer = {
  entities: new Map(),
  refreshInterval: 30000,
  refreshHandle: null,
  enabled: true,

  get viewer() {
    return (typeof V !== 'undefined' && V) ? V : (typeof window !== 'undefined' ? window.V : null);
  },

  async init() {
    if (!this.viewer) { console.warn('[Mesh Globe] Cesium viewer (V) not ready; retrying in 2s'); setTimeout(() => this.init(), 2000); return; }
    console.log('[Mesh Globe] init');
    await this.fetchAndRender();
    if (this.notProvisioned) return;
    this.refreshHandle = setInterval(() => { this.fetchAndRender().catch(e => console.error('[Mesh Globe]', e)); }, this.refreshInterval);
  },

  async fetchAndRender() {
    let result;
    // p163s: every open tab polled every 30 s, even in the background and even when the
    // backend table does not exist, at a cost of 120 function calls per tab per hour.
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const res = await fetch('/.netlify/functions/mesh-nodes');
      if (!res.ok) {
        console.debug('[Mesh Globe] mesh-nodes HTTP', res.status);
        // 503 {status:'not_provisioned'} = mesh_nodes table missing (docs/mesh-setup.sql). It will not
        // fix itself during this visit, so stop polling until the next page load.
        if (res.status === 503) {
          let body = null; try { body = await res.json(); } catch (_) {}
          if (body && body.status === 'not_provisioned') {
            this.notProvisioned = true;
            if (this.refreshHandle) { clearInterval(this.refreshHandle); this.refreshHandle = null; }
            console.info('[Mesh Globe] mesh backend not provisioned; polling stopped');
          }
        }
        return;
      }
      result = await res.json();
    } catch (err) { console.debug('[Mesh Globe] fetch failed:', err.message); return; }
    if (!result || !Array.isArray(result.nodes)) return;
    this.renderNodes(result.nodes);
  },

  renderNodes(nodes) {
    const v = this.viewer;
    if (!v) return;
    const active = new Set();

    for (const node of nodes) {
      if (typeof node.latitude !== 'number' || typeof node.longitude !== 'number') continue;
      const id = 'mesh:' + node.node_id;
      active.add(id);
      const position = Cesium.Cartesian3.fromDegrees(node.longitude, node.latitude, node.altitude || 0);
      const existing = this.entities.get(id) || v.entities.getById(id);

      if (existing) {
        existing.position = position;
        continue;
      }
      const entity = v.entities.add({
        id,
        position,
        point: { pixelSize: 8, color: Cesium.Color.LIME, outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
                 disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: node.long_name || node.short_name || node.node_id, font: '12px monospace',
                 fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 1,
                 pixelOffset: new Cesium.Cartesian2(0, -15), showBackground: true,
                 backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
                 disableDepthTestDistance: Number.POSITIVE_INFINITY },
        properties: { type: 'mesh_node', nodeId: node.node_id, hwModel: node.hw_model || 'unknown', lastHeard: node.last_heard }
      });
      this.entities.set(id, entity);
    }

    for (const [id, entity] of this.entities.entries()) {
      if (!active.has(id)) { v.entities.remove(entity); this.entities.delete(id); }
    }
  },

  destroy() {
    if (this.refreshHandle) clearInterval(this.refreshHandle);
    const v = this.viewer;
    if (v) for (const e of this.entities.values()) v.entities.remove(e);
    this.entities.clear();
  }
};

if (typeof window !== 'undefined') {
  window.meshGlobeLayer = meshGlobeLayer;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => meshGlobeLayer.init());
  else meshGlobeLayer.init();
}
