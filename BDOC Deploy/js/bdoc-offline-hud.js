// js/bdoc-offline-hud.js
// Shows the operator WHICH link they are on and HOW STALE the picture is.
//
// In a grid-down scenario the most dangerous failure is not a blank screen --
// it is a screen that looks normal while showing three-hour-old positions.
// This badge exists so "stale" is never mistaken for "live".

const BDOCOfflineHUD = {
  el: null,
  detailEl: null,
  timer: null,

  STATES: {
    cloud: { label: 'ONLINE',    color: '#2ED573', desc: 'Internet link up' },
    local: { label: 'LOCAL',     color: '#E8B349', desc: 'Local server only — no internet' },
    mesh:  { label: 'MESH',      color: '#D4F24E', desc: 'Radio mesh only — grid down' },
    cache: { label: 'CACHED',    color: '#FF4757', desc: 'No link — last known picture' },
    unknown: { label: '...',     color: '#888',    desc: 'Checking links' }
  },

  init() {
    if (document.getElementById('bdoc-link-badge')) return;

    const wrap = document.createElement('div');
    wrap.id = 'bdoc-link-badge';
    wrap.style.cssText = [
      'position:fixed', 'top:8px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:10002', 'display:flex', 'flex-direction:column', 'align-items:center',
      'gap:2px', 'padding:6px 14px', 'border-radius:8px',
      'background:rgba(15,17,21,0.82)', 'border:1px solid rgba(255,255,255,0.10)',
      'box-shadow:0 8px 32px rgba(0,0,0,0.3)', 'backdrop-filter:blur(10px)',
      '-webkit-backdrop-filter:blur(10px)',
      'font-family:IBM Plex Mono,ui-monospace,monospace', 'cursor:pointer',
      'user-select:none', 'transition:all 150ms ease'
    ].join(';');

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const dot = document.createElement('span');
    dot.id = 'bdoc-link-dot';
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#888;flex:0 0 auto;';

    const txt = document.createElement('span');
    txt.id = 'bdoc-link-text';
    txt.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:.08em;color:#fff;';
    txt.textContent = '...';

    row.appendChild(dot); row.appendChild(txt);

    const detail = document.createElement('div');
    detail.id = 'bdoc-link-detail';
    detail.style.cssText = 'font-size:9px;color:rgba(255,255,255,.55);letter-spacing:.04em;';

    wrap.appendChild(row); wrap.appendChild(detail);
    wrap.title = 'Click for offline storage detail';
    wrap.addEventListener('click', () => this.showDetail());

    document.body.appendChild(wrap);
    this.el = wrap; this.detailEl = detail;

    if (window.BDOCLinkManager) {
      window.BDOCLinkManager.onChange((s) => this.render(s));
      this.render(window.BDOCLinkManager.state);
    }
    this.timer = setInterval(() => this.refreshAge(), 10000);
  },

  render(state) {
    const s = this.STATES[state] || this.STATES.unknown;
    const dot = document.getElementById('bdoc-link-dot');
    const txt = document.getElementById('bdoc-link-text');
    if (!dot || !txt) return;

    dot.style.background = s.color;
    dot.style.boxShadow = `0 0 8px ${s.color}`;
    txt.textContent = s.label;
    txt.style.color = s.color;
    if (this.detailEl) this.detailEl.textContent = s.desc;

    // Degraded links pulse so they cannot be ignored in peripheral vision.
    dot.style.animation = (state === 'cache' || state === 'mesh')
      ? 'bdocPulse 1.4s ease-in-out infinite' : 'none';

    if (!document.getElementById('bdoc-pulse-kf')) {
      const st = document.createElement('style');
      st.id = 'bdoc-pulse-kf';
      st.textContent = '@keyframes bdocPulse{0%,100%{opacity:1}50%{opacity:.35}}';
      document.head.appendChild(st);
    }
  },

  async refreshAge() {
    if (!window.BDOCOfflineStore || !this.detailEl) return;
    const lm = window.BDOCLinkManager;
    if (!lm || lm.state === 'cloud') return;

    const last = await window.BDOCOfflineStore.getMeta('last_sync_mesh');
    if (!last) return;
    const mins = Math.floor((Date.now() - last) / 60000);
    const age = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
    this.detailEl.textContent = `last data ${age}`;
  },

  async showDetail() {
    const store = window.BDOCOfflineStore;
    const lm = window.BDOCLinkManager;
    const stats = store ? await store.stats() : null;
    const persisted = store ? await store.requestPersistence() : false;

    const lines = [
      `LINK      : ${lm ? lm.state.toUpperCase() : 'unknown'}`,
      stats ? `ENTITIES  : ${stats.entities}` : 'ENTITIES  : n/a',
      stats ? `TILES     : ${stats.tiles}` : '',
      stats ? `QUEUED    : ${stats.outbox}` : '',
      stats && stats.used_mb !== null ? `STORAGE   : ${stats.used_mb} MB / ${stats.quota_mb} MB` : '',
      `PERSISTED : ${persisted ? 'yes (protected from eviction)' : 'no'}`
    ].filter(Boolean);

    alert('BDOC OFFLINE STATUS\n\n' + lines.join('\n'));
  }
};

if (typeof window !== 'undefined') {
  window.BDOCOfflineHUD = BDOCOfflineHUD;
  const boot = async () => {
    if (window.BDOCOfflineStore) await window.BDOCOfflineStore.requestPersistence();
    if (window.BDOCLinkManager) await window.BDOCLinkManager.init();
    BDOCOfflineHUD.init();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
