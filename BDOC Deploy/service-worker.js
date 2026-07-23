// KGS BDOC — Service Worker
// Enables offline operation and caches all critical assets after first online load.
// Strategies: Cache-first for static assets, Stale-while-revalidate for API data.
// Cache names include version so bumping SW_VERSION forces a cache refresh on deploy.

const SW_VERSION = 'bdoc-v105';
const STATIC_CACHE  = SW_VERSION + '-static';
const CDN_CACHE     = SW_VERSION + '-cdn';
const API_CACHE     = SW_VERSION + '-api';
const TILE_CACHE    = SW_VERSION + '-tiles';

// All local assets to pre-cache on install
const STATIC_PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/bdoc.css?v=p31',
  '/js/telemetry.js?v=p31',
  '/js/converters.js?v=p31',
  '/js/data.js?v=p31',
  '/js/auth.js?v=p70',
  '/js/filters.js?v=p31',
  '/js/kitsune-ai.js?v=p93',
  '/js/bdoc-atak.js?v=p31',
  '/js/cesium-init.js?v=p31',
  '/js/modules/layers-military.js?v=p31',
  '/js/modules/layers-conflict.js?v=p31',
  '/js/modules/layers-infra.js?v=p31',
  '/js/modules/layers-air.js?v=p31',
  '/js/modules/layers-nuke.js?v=p31',
  '/js/modules/nuke-sim.js?v=p31',
  '/js/modules/layers-airfields.js?v=p31',
  '/cable-geo.json',
  '/landing-point-geo.json',
  '/assets/fallout-shelters-us.kml?v=p31',
  '/usa_star.svg',
  '/usaf_wings.svg',
  '/usmc_ega.svg',
  '/usn_emblem.svg',
  '/ussf_delta.svg',
  '/robots.txt',
];

// CDN hostnames to cache when first fetched (CesiumJS, milsymbol, DOMPurify)
const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
];

// Map tile hostnames to cache for offline globe rendering
const TILE_HOSTS = [
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
  'tile.openstreetmap.org',
  'stamen-tiles.a.ssl.fastly.net',
];

// ── Install: pre-cache all static assets ────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_PRECACHE.filter(url => !url.includes('undefined'))))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Install cache failed:', err))
  );
});

// ── Activate: delete old caches ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  const validCaches = [STATIC_CACHE, CDN_CACHE, API_CACHE, TILE_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('bdoc-') && !validCaches.includes(k))
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: route requests to appropriate strategy ────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET, chrome-extension, and websocket requests
  if (event.request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // HTML / navigation — NETWORK-FIRST so a new deploy is seen immediately
  // (cache-first on index.html was why fresh deploys required 2 reloads / never showed).
  if (url.origin === self.location.origin &&
      (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html'))) {
    event.respondWith(networkFirst(event.request, STATIC_CACHE));
    return;
  }
  // Other static local assets (versioned JS/CSS/SVG) — Cache-first
  if (url.origin === self.location.origin &&
      !url.pathname.startsWith('/.netlify/') &&
      !url.pathname.startsWith('/api/')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  // CDN resources (CesiumJS, milsymbol, etc.) — Cache-first after first load
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(cacheFirst(event.request, CDN_CACHE));
    return;
  }

  // Map tiles — Cache-first with large tile cache
  if (TILE_HOSTS.some(h => url.hostname.includes(h)) ||
      url.pathname.match(/\/tile\/\d+\/\d+\/\d+\.(png|jpg|jpeg|webp)/)) {
    event.respondWith(cacheFirst(event.request, TILE_CACHE));
    return;
  }

  // Netlify Functions / API proxies — Stale-while-revalidate
  // Returns last cached data immediately, updates in background when online
  if (url.pathname.startsWith('/.netlify/functions/') ||
      url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(event.request, API_CACHE));
    return;
  }

  // Everything else — Network-first with cache fallback
  event.respondWith(networkFirst(event.request, STATIC_CACHE));
});

// ── Strategies ───────────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request, { ignoreSearch: false });
  if (cached) return cached;
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    // Truly offline and not cached
    return offlineFallback(request);
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  // Fire network request in background
  const networkPromise = fetch(request, { signal: AbortSignal.timeout(8000) })
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  // Return cached immediately if available, else wait for network
  return cached || (await networkPromise) || offlineFallback(request);
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

function offlineFallback(request) {
  const url = new URL(request.url);
  // Return offline shell for navigation requests
  if (request.mode === 'navigate') {
    return caches.match('/index.html');
  }
  // Return empty JSON for API requests
  if (url.pathname.includes('/.netlify/') || url.pathname.includes('/api/')) {
    return new Response(JSON.stringify({
      error: 'OFFLINE — No cached data available. Last data shown is from your previous session.',
      offline: true,
      timestamp: Date.now()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response('', { status: 408 });
}

// ── Background Sync: queue failed API requests ───────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'bdoc-sync') {
    event.waitUntil(syncCachedData());
  }
});

async function syncCachedData() {
  // When back online, notify the app
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'SYNC_COMPLETE', timestamp: Date.now() }));
}

// ── Message handler: allow app to control SW ─────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
