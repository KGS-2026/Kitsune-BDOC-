// BDOC Dashboard Draggable Panels
// Allows repositioning of all HUD elements, then locks them in place

const dashboardDraggable = {
  dragging: false,
  locked: false,
  dragOffsetX: 0,
  dragOffsetY: 0,
  currentPanel: null,
  storedPositions: {},

  init() {
    this.makePanelsDraggable();
    this.loadStoredPositions();
    this.setupLockToggle();
    console.log('[Dashboard Draggable] Initialized - all panels draggable');
  },

  makePanelsDraggable() {
    const draggablePanels = [
      '#sidebar',
      '#data-panel',
      '#entity-panel',
      '#top-bar'
    ];

    draggablePanels.forEach(selector => {
      const panel = document.querySelector(selector);
      if (!panel) return;

      const header = panel.querySelector('.panel-header');
      if (!header) return;

      // Make header draggable handle
      header.style.cursor = 'grab';
      header.addEventListener('mousedown', (e) => this.startDrag(e, panel));
      header.addEventListener('touchstart', (e) => this.startDrag(e, panel));
    });
  },

  startDrag(e, panel) {
    if (this.locked) return;
    if (e.button === 2) return; // Ignore right-click

    e.preventDefault();
    this.dragging = true;
    this.currentPanel = panel;

    // Get initial position
    const rect = panel.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    this.dragOffsetX = clientX - rect.left;
    this.dragOffsetY = clientY - rect.top;

    // Visual feedback
    panel.style.opacity = '0.95';
    panel.style.zIndex = '999';

    document.addEventListener('mousemove', (e) => this.drag(e));
    document.addEventListener('touchmove', (e) => this.drag(e));
    document.addEventListener('mouseup', () => this.stopDrag());
    document.addEventListener('touchend', () => this.stopDrag());
  },

  drag(e) {
    if (!this.dragging || !this.currentPanel) return;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const x = clientX - this.dragOffsetX;
    const y = clientY - this.dragOffsetY;

    // Constrain to viewport
    const maxX = window.innerWidth - this.currentPanel.offsetWidth;
    const maxY = window.innerHeight - this.currentPanel.offsetHeight;

    const clampedX = Math.max(0, Math.min(x, maxX));
    const clampedY = Math.max(0, Math.min(y, maxY));

    this.currentPanel.style.left = clampedX + 'px';
    this.currentPanel.style.top = clampedY + 'px';
    this.currentPanel.style.right = 'auto';
    this.currentPanel.style.bottom = 'auto';
  },

  stopDrag() {
    if (!this.dragging || !this.currentPanel) return;

    this.dragging = false;
    this.currentPanel.style.opacity = '1';

    // Save position
    const id = this.currentPanel.id;
    this.storedPositions[id] = {
      left: this.currentPanel.style.left,
      top: this.currentPanel.style.top
    };
    this.savePositions();

    this.currentPanel = null;

    // Remove event listeners
    document.removeEventListener('mousemove', (e) => this.drag(e));
    document.removeEventListener('touchmove', (e) => this.drag(e));
    document.removeEventListener('mouseup', () => this.stopDrag());
    document.removeEventListener('touchend', () => this.stopDrag());
  },

  savePositions() {
    try {
      localStorage.setItem('bdoc_panel_positions', JSON.stringify(this.storedPositions));
    } catch (e) {
      console.warn('[Dashboard] Could not save positions:', e);
    }
  },

  loadStoredPositions() {
    try {
      const stored = localStorage.getItem('bdoc_panel_positions');
      if (stored) {
        this.storedPositions = JSON.parse(stored);
        Object.entries(this.storedPositions).forEach(([id, pos]) => {
          const panel = document.getElementById(id);
          if (panel) {
            panel.style.left = pos.left;
            panel.style.top = pos.top;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
          }
        });
      }
    } catch (e) {
      console.warn('[Dashboard] Could not load positions:', e);
    }
  },

  setupLockToggle() {
    // Create lock button in top-right corner
    const lockBtn = document.createElement('button');
    lockBtn.id = 'panel-lock-btn';
    lockBtn.className = 'btn-glass';
    lockBtn.innerHTML = '🔓 UNLOCK';
    lockBtn.style.cssText = `
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 1000;
      font-size: 11px;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.8);
      cursor: pointer;
      border-radius: 8px;
      font-weight: 600;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
      font-family: 'IBM Plex Sans', sans-serif;
    `;

    lockBtn.addEventListener('mouseenter', () => {
      lockBtn.style.background = 'rgba(255, 255, 255, 0.12)';
      lockBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    });

    lockBtn.addEventListener('mouseleave', () => {
      lockBtn.style.background = 'rgba(255, 255, 255, 0.08)';
      lockBtn.style.borderColor = 'rgba(255, 255, 255, 0.1)';
    });

    lockBtn.addEventListener('click', () => this.toggleLock(lockBtn));

    document.body.appendChild(lockBtn);
  },

  toggleLock(btn) {
    this.locked = !this.locked;

    if (this.locked) {
      btn.innerHTML = '🔒 LOCKED';
      btn.style.background = 'rgba(232, 179, 73, 0.15)';
      btn.style.borderColor = 'rgba(232, 179, 73, 0.3)';
      btn.style.color = '#E8B349';

      // Disable dragging on locked panels
      const headers = document.querySelectorAll('.panel-header');
      headers.forEach(h => h.style.cursor = 'default');

      // Keep threat index and lat/lon draggable
      this.allowDraggable(['#threat-index', '#coord-display']);

      console.log('[Dashboard] Panels LOCKED');
    } else {
      btn.innerHTML = '🔓 UNLOCK';
      btn.style.background = 'rgba(255, 255, 255, 0.08)';
      btn.style.borderColor = 'rgba(255, 255, 255, 0.1)';
      btn.style.color = 'rgba(255, 255, 255, 0.8)';

      // Enable dragging on all panels
      const headers = document.querySelectorAll('.panel-header');
      headers.forEach(h => h.style.cursor = 'grab');

      console.log('[Dashboard] Panels UNLOCKED');
    }
  },

  allowDraggable(selectors) {
    // Re-enable dragging only for specific panels
    selectors.forEach(selector => {
      const panel = document.querySelector(selector);
      if (!panel) return;
      const header = panel.querySelector('.panel-header');
      if (header) header.style.cursor = 'grab';
    });
  }
};

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => dashboardDraggable.init());
} else {
  dashboardDraggable.init();
}
