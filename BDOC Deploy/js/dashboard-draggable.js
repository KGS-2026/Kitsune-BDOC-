// BDOC Dashboard Draggable - Minimal & Working
const bdocUI = {
  locked: false,
  
  init() {
    console.log('[BDOC] Dashboard init starting');
    
    // Force panels visible IMMEDIATELY
    this.showAllPanels();
    
    // Attach drag handlers
    this.setupDragging();
    
    // Create lock button
    this.createLockButton();
    
    console.log('[BDOC] Dashboard ready - panels visible');
  },

  showAllPanels() {
    const panels = ['sidebar', 'data-panel', 'entity-panel', 'top-bar'];
    panels.forEach(id => {
      const el = document.getElementById(id);
      if (!el) {
        console.warn(`[BDOC] Missing #${id}`);
        return;
      }
      
      // FORCE VISIBILITY
      el.style.display = 'block !important';
      el.style.visibility = 'visible !important';
      el.style.opacity = '1 !important';
      el.style.position = 'fixed';
      el.style.zIndex = '100';
      
      console.log(`[BDOC] Panel visible: #${id}`);
    });
  },

  setupDragging() {
    ['sidebar', 'data-panel', 'entity-panel', 'top-bar'].forEach(id => {
      const panel = document.getElementById(id);
      if (!panel) return;
      
      const header = panel.querySelector('.panel-header');
      if (!header) return;
      
      header.style.cursor = 'grab';
      header.style.userSelect = 'none';
      
      let isDragging = false;
      let offsetX = 0, offsetY = 0;
      
      const onMouseDown = (e) => {
        if (this.locked) return;
        isDragging = true;
        const rect = panel.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        panel.style.zIndex = '10000';
        panel.style.opacity = '0.9';
      };
      
      const onMouseMove = (e) => {
        if (!isDragging) return;
        const x = Math.max(0, e.clientX - offsetX);
        const y = Math.max(0, e.clientY - offsetY);
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      };
      
      const onMouseUp = () => {
        if (isDragging) {
          isDragging = false;
          panel.style.zIndex = '100';
          panel.style.opacity = '1';
        }
      };
      
      header.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  },

  createLockButton() {
    const btn = document.createElement('button');
    btn.innerHTML = '🔓 DRAG TO POSITION';
    btn.style.cssText = `
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10001;
      padding: 12px 20px;
      background: rgba(232, 179, 73, 0.2);
      border: 1px solid rgba(232, 179, 73, 0.5);
      color: #E8B349;
      font-family: monospace;
      font-size: 12px;
      font-weight: bold;
      cursor: pointer;
      border-radius: 6px;
      transition: all 200ms;
    `;
    
    btn.addEventListener('click', () => {
      this.locked = !this.locked;
      btn.innerHTML = this.locked ? '🔒 LOCKED' : '🔓 DRAG TO POSITION';
      btn.style.color = this.locked ? '#D4F24E' : '#E8B349';
    });
    
    document.body.appendChild(btn);
  }
};

// Init on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => bdocUI.init(), 200);
  });
} else {
  setTimeout(() => bdocUI.init(), 200);
}
