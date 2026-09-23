// js/bdoc-link-manager.js
// Decides WHERE BDOC gets data from, and degrades cleanly when the grid drops.
//
// Link tiers, best first:
//   1. cloud  - Netlify functions / Supabase       (normal internet)
//   2. local  - BDOC IPC receiver on 127.0.0.1:9876 (LAN/self-hosted, no WAN needed)
//   3. mesh   - Meshtastic serial/TCP via the local receiver (radio only, no IP)
//   4. cache  - IndexedDB last known state          (nothing works, show last picture)
//
// navigator.onLine is NOT trusted: it reports link-layer state, so a device on
// wifi with a dead uplink still reads "online". We probe real endpoints.

const BDOCLinkManager = {
  state: 'unknown',           // cloud | local | mesh | cache
  lastGood: {},               // tier -> timestamp
  probeIntervalMs: 20000,
  handle: null,
  listeners: [],

  ENDPOINTS: {
    cloud: '/.netlify/functions/config',
    local: 'http://127.0.0.1:9876/api/v1/status'
  },

  async init() {
    await this.probe();
    this.handle = setInterval(() => this.probe(), this.probeIntervalMs);
    // Link-layer events are a hint to re-probe immediately, not a source of truth.
    window.addEventListener('online', () => this.probe());
    window.addEventListener('offline', () => this.probe());
  },

  onChange(fn) { this.listeners.push(fn); },

  _emit(prev) {
    if (prev === this.state) return;
    console.log(`[link] ${prev} -> ${this.state}`);
    for (const fn of this.listeners) {
      try { fn(this.state, prev); } catch (e) { console.warn('[link] listener:', e && e.message); }
    }
  },

  async _reachable(url, timeoutMs = 4000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      return res.ok;
    } catch (e) { return false; }
    finally { clearTimeout(t); }
  },

  async probe() {
    const prev = this.state;
    const now = Date.now();

    if (await this._reachable(this.ENDPOINTS.cloud)) {
      this.state = 'cloud';
      this.lastGood.cloud = now;
      this._emit(prev);
      // A link came back: push anything we captured while dark.
      if (prev && prev !== 'cloud' && window.BDOCOfflineStore) {
        const r = await window.BDOCOfflineStore.flushOutbox();
        if (r.sent) console.log(`[link] replayed ${r.sent} queued records`);
      }
      return this.state;
    }

    const localStatus = await this._localStatus();
    if (localStatus) {
      // The IPC receiver is up. If it is actually hearing radio traffic we are
      // on mesh; otherwise it is just a local server with no feed.
      const meshCount = localStatus.stores ? (localStatus.stores['mesh/node'] || 0) : 0;
      this.state = meshCount > 0 ? 'mesh' : 'local';
      this.lastGood[this.state] = now;
      this._emit(prev);
      return this.state;
    }

    this.state = 'cache';
    this._emit(prev);
    return this.state;
  },

  async _localStatus() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    try {
      const res = await fetch(this.ENDPOINTS.local, { signal: ctl.signal, cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
    finally { clearTimeout(t); }
  },

  isDegraded() { return this.state === 'mesh' || this.state === 'cache'; },

  /**
   * Fetch data for a source using the best available link, always persisting
   * what we get and always returning SOMETHING (cache) if every link is dead.
   */
  async fetchSource(source, cloudUrl, localPath) {
    const store = window.BDOCOfflineStore;

    if (this.state === 'cloud' && cloudUrl) {
      try {
        const res = await fetch(cloudUrl, { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          const rows = j.nodes || j.data || [];
          if (rows.length && store) await store.putEntities(source, rows, 'network');
          return { rows, origin: 'cloud', stale: false };
        }
      } catch (e) { /* fall through to degraded paths */ }
    }

    if ((this.state === 'local' || this.state === 'mesh') && localPath) {
      try {
        const res = await fetch(`http://127.0.0.1:9876/api/v1/${localPath}`, { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          const rows = j.nodes || [];
          if (rows.length && store) {
            await store.putEntities(source, rows, this.state === 'mesh' ? 'mesh' : 'network');
          }
          return { rows, origin: this.state, stale: false };
        }
      } catch (e) { /* fall through to cache */ }
    }

    if (store) {
      const rows = await store.getEntities(source);
      return { rows, origin: 'cache', stale: true };
    }
    return { rows: [], origin: 'none', stale: true };
  },

  destroy() { if (this.handle) clearInterval(this.handle); }
};

if (typeof window !== 'undefined') window.BDOCLinkManager = BDOCLinkManager;
if (typeof module !== 'undefined' && module.exports) module.exports = BDOCLinkManager;
