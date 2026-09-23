// js/bdoc-offline-store.js
// Grid-down persistence layer for BDOC.
//
// WHY: every data path in BDOC assumed a reachable server (Netlify functions ->
// Supabase). When the grid or the ISP drops, those all fail and the globe goes
// blank. This store keeps the last known state ON DEVICE in IndexedDB so the
// operator still has a picture, and queues anything produced while offline for
// replay when a link returns.
//
// Design rules:
//  - Never throw into callers. A storage failure must degrade, not break the map.
//  - Bounded. A tactical device can't fill its disk with stale telemetry.
//  - Source-tagged. Operators must be able to tell live data from stale data.
//
// Stores:
//   entities  - last known state per feature (mesh nodes, aircraft, sensors...)
//   tiles     - operator-pinned AOI imagery for offline map rendering
//   outbox    - records created offline, replayed when a link returns
//   meta      - sync bookkeeping

const BDOCOfflineStore = {
  DB_NAME: 'bdoc-offline',
  DB_VERSION: 1,
  db: null,

  // Retention caps (oldest evicted first).
  LIMITS: { entities: 20000, tiles: 4000, outbox: 5000 },

  async open() {
    if (this.db) return this.db;
    if (!('indexedDB' in self)) { console.warn('[offline] IndexedDB unavailable'); return null; }
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('entities')) {
            const s = db.createObjectStore('entities', { keyPath: 'key' });
            s.createIndex('by_source', 'source');
            s.createIndex('by_updated', 'updated_ms');
          }
          if (!db.objectStoreNames.contains('tiles')) {
            const s = db.createObjectStore('tiles', { keyPath: 'url' });
            s.createIndex('by_added', 'added_ms');
          }
          if (!db.objectStoreNames.contains('outbox')) {
            db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta', { keyPath: 'k' });
          }
        };
      });
      return this.db;
    } catch (e) {
      console.warn('[offline] open failed:', e && e.message);
      return null;
    }
  },

  _tx(store, mode) {
    return this.db.transaction(store, mode).objectStore(store);
  },

  _wrap(req) {
    return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  },

  /**
   * Persist a batch of records for one source.
   * @param {string} source  'mesh'|'aircraft'|'sensor'|'wifi'|'satimg'|...
   * @param {Array<object>} records must each have a stable `id`
   * @param {string} origin  'network' (came from a server) or 'mesh' (came in over radio)
   */
  async putEntities(source, records, origin = 'network') {
    if (!(await this.open()) || !Array.isArray(records) || !records.length) return 0;
    const now = Date.now();
    try {
      const store = this._tx('entities', 'readwrite');
      let n = 0;
      for (const r of records) {
        const id = r.id ?? r.node_id ?? r.icao ?? r.sensor_id ?? r.ip;
        if (id === undefined || id === null) continue;
        store.put({ key: `${source}:${id}`, source, origin, updated_ms: now, data: r });
        n++;
      }
      await this._setMeta(`last_sync_${source}`, now);
      this._evict('entities', this.LIMITS.entities, 'by_updated');
      return n;
    } catch (e) { console.warn('[offline] putEntities:', e && e.message); return 0; }
  },

  /** Read back everything for a source, newest first. */
  async getEntities(source, maxAgeMs = null) {
    if (!(await this.open())) return [];
    try {
      const idx = this._tx('entities', 'readonly').index('by_source');
      const rows = await this._wrap(idx.getAll(IDBKeyRange.only(source)));
      const cutoff = maxAgeMs ? Date.now() - maxAgeMs : 0;
      return rows
        .filter(r => !maxAgeMs || r.updated_ms >= cutoff)
        .sort((a, b) => b.updated_ms - a.updated_ms)
        .map(r => ({ ...r.data, _stale_ms: Date.now() - r.updated_ms, _origin: r.origin }));
    } catch (e) { console.warn('[offline] getEntities:', e && e.message); return []; }
  },

  /** Queue a record produced while offline, for replay on reconnect. */
  async queueOutbound(endpoint, payload) {
    if (!(await this.open())) return false;
    try {
      this._tx('outbox', 'readwrite').put({ endpoint, payload, queued_ms: Date.now(), attempts: 0 });
      return true;
    } catch (e) { console.warn('[offline] queueOutbound:', e && e.message); return false; }
  },

  /** Replay queued records. Returns {sent, failed, remaining}. */
  async flushOutbox(fetchImpl = fetch) {
    if (!(await this.open())) return { sent: 0, failed: 0, remaining: 0 };
    let sent = 0, failed = 0;
    try {
      const all = await this._wrap(this._tx('outbox', 'readonly').getAll());
      for (const rec of all) {
        try {
          const res = await fetchImpl(rec.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rec.payload)
          });
          if (res.ok) {
            this._tx('outbox', 'readwrite').delete(rec.id);
            sent++;
          } else if (res.status >= 400 && res.status < 500) {
            // Permanently bad payload — drop it rather than retry forever.
            this._tx('outbox', 'readwrite').delete(rec.id);
            failed++;
          } else { failed++; }
        } catch (e) { failed++; }
      }
      const remaining = (await this._wrap(this._tx('outbox', 'readonly').getAll())).length;
      return { sent, failed, remaining };
    } catch (e) {
      console.warn('[offline] flushOutbox:', e && e.message);
      return { sent, failed, remaining: -1 };
    }
  },

  /** Pin a map tile / image blob for offline rendering. */
  async putTile(url, blob) {
    if (!(await this.open())) return false;
    try {
      this._tx('tiles', 'readwrite').put({ url, blob, added_ms: Date.now(), bytes: blob.size || 0 });
      this._evict('tiles', this.LIMITS.tiles, 'by_added');
      return true;
    } catch (e) { console.warn('[offline] putTile:', e && e.message); return false; }
  },

  async getTile(url) {
    if (!(await this.open())) return null;
    try {
      const r = await this._wrap(this._tx('tiles', 'readonly').get(url));
      return r ? r.blob : null;
    } catch (e) { return null; }
  },

  async _setMeta(k, v) {
    try { this._tx('meta', 'readwrite').put({ k, v }); } catch (e) { /* non-fatal */ }
  },

  async getMeta(k) {
    if (!(await this.open())) return null;
    try { const r = await this._wrap(this._tx('meta', 'readonly').get(k)); return r ? r.v : null; }
    catch (e) { return null; }
  },

  /** Trim a store to `limit` rows, dropping oldest first. */
  async _evict(storeName, limit, indexName) {
    try {
      const count = await this._wrap(this._tx(storeName, 'readonly').count());
      if (count <= limit) return;
      const overflow = count - limit;
      const idx = this._tx(storeName, 'readwrite').index(indexName);
      let removed = 0;
      await new Promise(resolve => {
        idx.openCursor().onsuccess = (e) => {
          const cur = e.target.result;
          if (!cur || removed >= overflow) return resolve();
          cur.delete(); removed++; cur.continue();
        };
      });
    } catch (e) { /* eviction is best-effort */ }
  },

  /** Storage footprint + freshness, for the HUD. */
  async stats() {
    if (!(await this.open())) return null;
    try {
      const out = { entities: 0, tiles: 0, outbox: 0, quota_mb: null, used_mb: null };
      for (const s of ['entities', 'tiles', 'outbox']) {
        out[s] = await this._wrap(this._tx(s, 'readonly').count());
      }
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        out.quota_mb = Math.round((est.quota || 0) / 1048576);
        out.used_mb = Math.round((est.usage || 0) / 1048576);
      }
      return out;
    } catch (e) { return null; }
  },

  /** Ask the browser not to evict us under storage pressure. Critical for field use. */
  async requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const already = await navigator.storage.persisted();
        if (already) return true;
        return await navigator.storage.persist();
      }
    } catch (e) { /* ignore */ }
    return false;
  }
};

if (typeof window !== 'undefined') window.BDOCOfflineStore = BDOCOfflineStore;
if (typeof module !== 'undefined' && module.exports) module.exports = BDOCOfflineStore;
