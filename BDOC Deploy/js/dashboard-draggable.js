// BDOC Dashboard Draggable - Simplified & Verified
// Makes sure panels are visible and draggable

const bdocDash = {
  locked: false,
  
  init() {
    // Force panels to be visible
    this.ensurePanelsVisible();
    this.attachDragHandlers();
    this.createLockButton();
    console.log('[BDOC Dashboard] Initialized - panels draggable');
  },

  ensurePanelsVisible() {
    const panels = ['sidebar', 'data-panel', 'entity-panel', 'top-bar'];
    
    panels.forEach(id => {
      const panel = document.getElementById(id);
      if (!panel) {
        console.warn(`[BDOC Dashboard] Panel #${id} not found`);
        return;
      }
      
      // Force visibility
      panel.style.display = 'block';
      panel.style.visibility = 'visible';
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      
      // Ensure it's positioned
      if (!panel.style.position || panel.style.position === 'static') {
        panel.style.position = 'fixed';
      }
      
      console.log(`[BDOC Dashboard] Panel #${id} visible`);
    });
  },

  attachDragHandlers() {
    const panelIds = ['sidebar', 'data-panel', 'entity-panel', 'top-bar'];
    
    panelIds.forEach(id => {
      const panel = document.getElementById(id);
      if (!panel) return;
      
      const header = panel.querySelector('.panel-header');
      if (!header) return;
      
      // Enable dragging on header
      header.style.cursor = 'grab';
      header.style.userSelect = 'none';
      header.style.touchAction = 'none';
      
      header.addEventListener('mousedown', (e) => this.dragStart(e, panel, id));
      header.addEventListener('touchstart', (e) => this.dragStart(e, panel, id), { passive: false });
    });
  },

  dragStart(e, panel, panelId) {
    if (this.locked) {
      console.log('[BDOC Dashboard] Panels locked - cannot drag');
      return;
    }
    
    e.preventDefault();
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const rect = panel.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;
    
    // Highlight while dragging
    panel.style.opacity = '0.9';
    panel.style.zIndex = '9999';
    
    const onMove = (e) => {
      const moveX = e.touches ? e.touches[0].clientX : e.clientX;
      const moveY = e.touches ? e.touches[0].clientY : e.clientY;
      
      let newX = moveX - offsetX;
      let newY = moveY - offsetY;
      
      // Clamp to viewport
      newX = Math.max(0, Math.min(newX, window.innerWidth - rect.width));
      newY = Math.max(0, Math.min(newY, window.innerHeight - rect.height));
      
      panel.style.left = newX + 'px';
      panel.style.top = newY + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };
    
    const onEnd = () => {
      panel.style.opacity = '1';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchend', onEnd);
      
      // Save position
      const pos = { left: panel.style.left, top: panel.style.top };
      console.log(`[BDOC Dashboard] Saved ${panelId}:`, pos);
    };
    
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);
  },

  createLockButton() {
    // Remove if exists
    const existing = document.getElementById('bdoc-lock-btn');
    if (existing) existing.remove();
    
    const btn = document.createElement('button');
    btn.id = 'bdoc-lock-btn';
    btn.innerHTML = '🔓 UNLOCK';
    btn.style.cssText = `
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10000;
      padding: 10px 16px;
      background: rgba(15, 17, 21, 0.8);
      border: 1px solid rgba(232, 179, 73, 0.3);
      color: #E8B349;
      font-family: 'IBM Plex Sans', sans-serif;
      font-size: 11px;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
      transition: all 150ms ease;
    `;
    
    btn.addEventListener('click', () => {
      this.locked = !this.locked;
      if (this.locked) {
        btn.innerHTML = '🔒 LOCKED';
        btn.style.background = 'rgba(232, 179, 73, 0.2)';
        btn.style.color = '#E8B349';
        console.log('[BDOC Dashboard] ✓ LOCKED - take screenshot now');
      } else {
        btn.innerHTML = '🔓 UNLOCK';
        btn.style.background = 'rgba(15, 17, 21, 0.8)';
        btn.style.color = '#D4F24E';
        console.log('[BDOC Dashboard] ✓ UNLOCKED - panels draggable again');
      }
    });
    
    document.body.appendChild(btn);
  }
};

// Initialize immediately on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => bdocDash.init(), 100); // Small delay to let DOM settle
  });
} else {
  setTimeout(() => bdocDash.init(), 100);
}
