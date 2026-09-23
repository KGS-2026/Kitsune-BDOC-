// js/dashboard-draggable.js
// Draggable HUD panels. Positions persist in localStorage.
// FIX: el.style.display = 'block !important' is silently ignored by the CSSOM.
//      Use setProperty(name, value, 'important').

const bdocUI = {
  locked: false,
  PANELS: ['sidebar', 'top-bar', 'data-panel', 'entity-panel'],
  STORE_KEY: 'bdoc_panel_positions',

  init() {
    const found = this.PANELS.filter(id => document.getElementById(id));
    if (!found.length) { console.warn('[BDOC UI] no dashboard panels in DOM — nothing to drag'); return; }
    console.log('[BDOC UI] panels found:', found.join(', '));
    this.locked = localStorage.getItem('bdoc_panels_locked') === '1';
    this.restorePositions();
    this.setupDragging();
    this.createLockButton();
  },

  force(el, prop, val) { el.style.setProperty(prop, val, 'important'); },

  restorePositions() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(this.STORE_KEY) || '{}'); } catch (e) { saved = {}; }
    for (const id of this.PANELS) {
      const el = document.getElementById(id);
      if (!el) continue;
      this.force(el, 'position', 'fixed');
      if (id !== 'entity-panel') { this.force(el, 'display', 'block'); this.force(el, 'visibility', 'visible'); }
      const pos = saved[id];
      if (pos) {
        this.force(el, 'left', pos.left); this.force(el, 'top', pos.top);
        this.force(el, 'right', 'auto');  this.force(el, 'bottom', 'auto');
      }
    }
  },

  savePositions() {
    const out = {};
    for (const id of this.PANELS) {
      const el = document.getElementById(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out[id] = { left: r.left + 'px', top: r.top + 'px' };
    }
    localStorage.setItem(this.STORE_KEY, JSON.stringify(out));
  },

  setupDragging() {
    for (const id of this.PANELS) {
      const panel = document.getElementById(id);
      if (!panel) continue;
      // Fall back to the panel itself if it has no .panel-header handle.
      const handle = panel.querySelector('.panel-header') || panel;
      handle.style.cursor = 'grab';
      handle.style.userSelect = 'none';
      handle.style.touchAction = 'none';

      let dragging = false, offX = 0, offY = 0;

      const down = (e) => {
        if (this.locked) return;
        if (e.target.closest('input,button,select,textarea,a')) return;
        dragging = true;
        const r = panel.getBoundingClientRect();
        offX = e.clientX - r.left; offY = e.clientY - r.top;
        this.force(panel, 'z-index', '10000');
        panel.style.opacity = '0.92';
        handle.style.cursor = 'grabbing';
        handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
      };
      const move = (e) => {
        if (!dragging) return;
        const r = panel.getBoundingClientRect();
        const x = Math.min(Math.max(0, e.clientX - offX), window.innerWidth  - r.width);
        const y = Math.min(Math.max(0, e.clientY - offY), window.innerHeight - r.height);
        this.force(panel, 'left', x + 'px'); this.force(panel, 'top', y + 'px');
        this.force(panel, 'right', 'auto');  this.force(panel, 'bottom', 'auto');
      };
      const up = () => {
        if (!dragging) return;
        dragging = false;
        panel.style.opacity = '1';
        handle.style.cursor = 'grab';
        this.savePositions();
      };

      // Pointer events => works for mouse AND touch, and beats the Cesium canvas handlers.
      handle.addEventListener('pointerdown', down);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }
  },

  setLocked(v) {
    this.locked = v;
    localStorage.setItem('bdoc_panels_locked', v ? '1' : '0');
  },

  createLockButton() {
    if (document.getElementById('bdoc-lock-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'bdoc-lock-btn';
    const paint = () => {
      btn.textContent = this.locked ? 'LOCKED' : 'DRAG TO POSITION';
      btn.style.color = this.locked ? '#D4F24E' : '#E8B349';
      btn.style.borderColor = this.locked ? 'rgba(212,242,78,.5)' : 'rgba(232,179,73,.5)';
    };
    btn.style.cssText = 'position:fixed;top:8px;right:8px;z-index:10001;padding:8px 14px;' +
      'background:rgba(15,17,21,.72);border:1px solid rgba(232,179,73,.5);border-radius:6px;' +
      'font:600 11px/1 monospace;letter-spacing:.08em;cursor:pointer;';
    paint();
    btn.addEventListener('click', () => { this.setLocked(!this.locked); paint(); });
    document.body.appendChild(btn);
  }
};

if (typeof window !== 'undefined') {
  window.bdocUI = bdocUI;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(() => bdocUI.init(), 300));
  else setTimeout(() => bdocUI.init(), 300);
}
