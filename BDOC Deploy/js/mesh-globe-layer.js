// js/mesh-globe-layer.js
// Renders Meshtastic mesh nodes on the Cesium globe

const meshGlobeLayer = {
  entities: new Map(),
  refreshInterval: 30000, // 30 seconds
  refreshHandle: null,

  async init() {
    console.log('[Mesh Globe] Initializing mesh layer');

    // Initial load
    await this.fetchAndRender();

    // Auto-refresh every 30 seconds
    this.refreshHandle = setInterval(() => {
      this.fetchAndRender().catch(e => console.error('[Mesh Globe] Refresh error:', e));
    }, this.refreshInterval);
  },

  async fetchAndRender() {
    try {
      const response = await fetch('/.netlify/functions/mesh-nodes');
      const result = await response.json();

      if (!result.nodes || result.nodes.length === 0) {
        console.log('[Mesh Globe] No active mesh nodes');
        return;
      }

      console.log(`[Mesh Globe] Rendering ${result.count} nodes`);
      this.renderNodes(result.nodes);
    } catch (err) {
      console.error('[Mesh Globe] Fetch error:', err);
    }
  },

  renderNodes(nodes) {
    // Track which nodes are still active
    const activeNodeIds = new Set();

    for (const node of nodes) {
      activeNodeIds.add(node.node_id);

      // Convert lat/lon to Cesium Cartesian3
      const position = Cesium.Cartesian3.fromDegrees(
        node.longitude,
        node.latitude,
        node.altitude || 0
      );

      // Check if we already have this node
      if (this.entities.has(node.node_id)) {
        // Update existing
        const entity = this.entities.get(node.node_id);
        entity.position = position;
        entity.properties.lastHeard = new Date(node.last_heard);
      } else {
        // Create new entity
        const entity = viewer.entities.add({
          id: node.node_id,
          position,
          point: {
            pixelSize: 8,
            color: Cesium.Color.LIME,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2
          },
          label: {
            text: node.long_name || node.short_name || node.node_id,
            font: '12px IBM Plex Mono',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            pixelOffset: new Cesium.Cartesian2(0, -15),
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.6)
          },
          properties: {
            type: 'mesh_node',
            nodeId: node.node_id,
            hwModel: node.hw_model || 'unknown',
            lastHeard: new Date(node.last_heard)
          }
        });

        this.entities.set(node.node_id, entity);
        console.log(`[Mesh Globe] Added node: ${node.node_id}`);
      }
    }

    // Remove nodes that are no longer in the active set
    for (const [nodeId, entity] of this.entities.entries()) {
      if (!activeNodeIds.has(nodeId)) {
        viewer.entities.remove(entity);
        this.entities.delete(nodeId);
        console.log(`[Mesh Globe] Removed stale node: ${nodeId}`);
      }
    }
  },

  destroy() {
    if (this.refreshHandle) {
      clearInterval(this.refreshHandle);
    }
    for (const entity of this.entities.values()) {
      viewer.entities.remove(entity);
    }
    this.entities.clear();
  }
};

// Auto-init on page load if Cesium is ready
if (typeof Cesium !== 'undefined' && typeof viewer !== 'undefined') {
  meshGlobeLayer.init();
}
