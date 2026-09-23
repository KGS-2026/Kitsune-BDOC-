// BDOC Dashboard Controller
// Manages glassmorphism UI, live data updates, and entity selection

const dashboardUI = {
  init() {
    this.setupTimeDisplay();
    this.setupLayerList();
    this.setupEventLog();
    this.setupEntityPanel();
    this.setupAnimations();
    console.log('[Dashboard] Initialized');
  },

  setupTimeDisplay() {
    const timeEl = document.getElementById('current-time');
    if (!timeEl) return;
    
    setInterval(() => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      const secs = String(now.getSeconds()).padStart(2, '0');
      timeEl.textContent = `${hours}:${mins}:${secs}`;
    }, 1000);
  },

  setupLayerList() {
    const layerListEl = document.getElementById('layer-list');
    if (!layerListEl) return;

    // Listen for layer updates from auth.js
    window.addEventListener('bdoc:layers-updated', (e) => {
      this.renderLayers(e.detail || []);
    });

    // Initial render
    if (window.auth && window.auth.enabledLayers) {
      this.renderLayers(Object.keys(window.auth.enabledLayers));
    }
  },

  renderLayers(layerNames) {
    const layerListEl = document.getElementById('layer-list');
    if (!layerListEl) return;

    layerListEl.innerHTML = '';

    layerNames.forEach(layerName => {
      const isEnabled = window.auth?.enabledLayers?.[layerName] ?? false;
      const item = document.createElement('div');
      item.className = 'layer-item';
      item.innerHTML = `
        <label style="display:flex;align-items:center;flex:1;">
          <input type="checkbox" ${isEnabled ? 'checked' : ''} 
                 onchange="dashboardUI.toggleLayer('${layerName}', this.checked)">
          <span>${layerName}</span>
        </label>
        <span class="status-dot ${isEnabled ? 'live' : 'offline'}" 
              style="margin-right:8px;"></span>
      `;
      layerListEl.appendChild(item);
    });
  },

  toggleLayer(layerName, enabled) {
    if (window.auth && typeof window.auth.toggleLayer === 'function') {
      window.auth.toggleLayer(layerName, enabled);
    }
  },

  setupEventLog() {
    const eventListEl = document.getElementById('event-list');
    if (!eventListEl) return;

    // Listen for BDOC events
    window.addEventListener('bdoc:event', (e) => {
      this.addEvent(e.detail);
    });

    // Mesh network events
    window.addEventListener('mesh:position', (e) => {
      this.addEvent({
        type: 'position',
        message: `${e.detail.sender}: ${e.detail.latitude.toFixed(4)}, ${e.detail.longitude.toFixed(4)}`,
        critical: false,
        timestamp: new Date()
      });
    });

    window.addEventListener('mesh:message', (e) => {
      this.addEvent({
        type: 'message',
        message: `${e.detail.sender}: ${e.detail.text}`,
        critical: false,
        timestamp: new Date()
      });
    });
  },

  addEvent(event) {
    const eventListEl = document.getElementById('event-list');
    if (!eventListEl) return;

    const item = document.createElement('div');
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    item.className = `event-item ${event.critical ? 'critical' : ''}`;
    item.innerHTML = `
      <span class="event-time">${timeStr}</span>
      ${event.message}
    `;

    eventListEl.insertBefore(item, eventListEl.firstChild);

    // Keep only last 50 events
    while (eventListEl.children.length > 50) {
      eventListEl.removeChild(eventListEl.lastChild);
    }
  },

  setupEntityPanel() {
    const closeBtn = document.getElementById('entity-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        document.getElementById('entity-panel').classList.remove('show');
      });
    }

    // Listen for entity selection from globe click
    window.addEventListener('bdoc:entity-selected', (e) => {
      this.showEntityPanel(e.detail);
    });
  },

  showEntityPanel(entity) {
    const panel = document.getElementById('entity-panel');
    const title = document.getElementById('entity-title');
    const content = document.getElementById('entity-content');

    if (!panel || !title || !content) return;

    title.textContent = entity.name || 'Entity Details';

    // Build entity details HTML
    let html = '';
    
    if (entity.position) {
      html += `
        <div class="data-row">
          <span class="data-label">Latitude</span>
          <span class="data-value">${entity.position.latitude?.toFixed(6) || '—'}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Longitude</span>
          <span class="data-value">${entity.position.longitude?.toFixed(6) || '—'}</span>
        </div>
      `;
    }

    if (entity.altitude !== undefined) {
      html += `
        <div class="data-row">
          <span class="data-label">Altitude</span>
          <span class="data-value accent">${entity.altitude.toFixed(0)} ft</span>
        </div>
      `;
    }

    if (entity.speed !== undefined) {
      html += `
        <div class="data-row">
          <span class="data-label">Speed</span>
          <span class="data-value accent">${entity.speed.toFixed(1)} kt</span>
        </div>
      `;
    }

    if (entity.heading !== undefined) {
      html += `
        <div class="data-row">
          <span class="data-label">Heading</span>
          <span class="data-value">${entity.heading.toFixed(0)}°</span>
        </div>
      `;
    }

    if (entity.signal) {
      html += `
        <div class="data-row">
          <span class="data-label">Signal</span>
          <span class="data-value ${entity.signal > -100 ? '' : 'danger'}">${entity.signal} dBm</span>
        </div>
      `;
    }

    if (entity.updated) {
      const ageMs = Date.now() - new Date(entity.updated).getTime();
      const ageSec = Math.floor(ageMs / 1000);
      const ageStr = ageSec < 60 ? `${ageSec}s ago` : ageSec < 3600 ? `${Math.floor(ageSec/60)}m ago` : '> 1h';
      
      html += `
        <div class="data-row">
          <span class="data-label">Last Update</span>
          <span class="data-value">${ageStr}</span>
        </div>
      `;
    }

    if (html === '') {
      html = '<div style="color:rgba(255,255,255,0.5);text-align:center;padding:20px;">No data available</div>';
    }

    content.innerHTML = html;
    panel.classList.add('show');
  },

  setupAnimations() {
    // Micro-interactions: fade in panels on load
    const panels = document.querySelectorAll('.glass-panel');
    panels.forEach((panel, idx) => {
      panel.style.opacity = '0';
      panel.style.animation = `slideIn ${150 + idx * 50}ms var(--easing-smooth) forwards`;
    });
  },

  // Update live stats
  updateStats(stats) {
    const grid = document.getElementById('stats-grid');
    if (!grid) return;

    grid.innerHTML = '';
    Object.entries(stats).forEach(([key, value]) => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `
        <div class="stat-label">${key}</div>
        <div class="stat-value">${typeof value === 'number' ? value.toLocaleString() : value}</div>
      `;
      grid.appendChild(card);
    });
  },

  setSystemStatus(status, isLive = true) {
    const statusEl = document.getElementById('system-status');
    const dot = document.querySelector('.status-dot');
    
    if (statusEl) statusEl.textContent = status;
    if (dot) {
      dot.className = `status-dot ${isLive ? 'live' : isLive === false ? 'offline' : 'stale'}`;
    }
  }
};

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => dashboardUI.init());
} else {
  dashboardUI.init();
}
