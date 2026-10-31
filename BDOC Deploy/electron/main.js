// KGS BDOC — Electron Main Process
// Runs BDOC as a native desktop app. Starts a local Express server to handle
// API proxies (replacing Netlify Functions), then loads the app in a BrowserWindow.
// Works completely offline — uses cached data and last-known API responses.

const { app, BrowserWindow, Menu, shell, dialog, ipcMain, Tray, nativeImage } = require('electron');
const path  = require('path');
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const os    = require('os');

// Load .env.local for API keys (same format as Netlify env vars)
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length && !k.startsWith('#')) process.env[k.trim()] = v.join('=').trim();
  });
}

const LOCAL_PORT = 9080;
// P154 (Travon bug #22 "update for the downloadable app"): the desktop build served a
// frozen copy of index.html from inside the installer, so it never saw a single fix
// after the day it was built. Now: if the live site answers within 4 s, load IT
// (always current, real Netlify functions, service worker caches it for later
// grid-down use). Otherwise fall back to the bundled copy + local API server.
const LIVE_URL = 'https://kgsbdoc.netlify.app/';
const RELEASES_URL = 'https://github.com/KGS-2026/Kitsune-BDOC-/releases/latest';
let runMode = 'offline';
function liveReachable(timeoutMs = 4000) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    try {
      const req = https.request(LIVE_URL, { method: 'HEAD', timeout: timeoutMs }, res => { finish(res.statusCode > 0 && res.statusCode < 500); res.resume(); });
      req.on('timeout', () => { req.destroy(); finish(false); });
      req.on('error', () => finish(false));
      req.end();
    } catch (_) { finish(false); }
  });
}
let mainWindow = null;
let tray = null;
let localServer = null;

// ── Start local API proxy server ─────────────────────────────────────────────
function startLocalServer() {
  const { createServer } = require('./server');
  localServer = createServer();
  localServer.listen(LOCAL_PORT, '127.0.0.1', () => {
    console.log(`[BDOC] Local API server running on http://localhost:${LOCAL_PORT}`);
  });
  localServer.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[BDOC] Port ${LOCAL_PORT} in use — server already running`);
    }
  });
}

// ── Offline bundle ───────────────────────────────────────────────────────────
// Maps a CDN url to its copy in electron/vendor (see tools/desktop/vendor.js).
function vendorPath(raw) {
  const u = new URL(raw);
  const m = /\/cesium\/1\.146\.0\/(.+)$/.exec(u.pathname) || /\/cesium@1\.146\.0\/Build\/Cesium\/(.+)$/.exec(u.pathname);
  if (m) return '/vendor/cesium/' + m[1];
  if (u.hostname === 'fonts.googleapis.com') return null; // system fonts are fine offline
  return '/vendor/files/' + path.posix.basename(u.pathname);
}

// A bottom layer of Cesium's built-in world imagery. Every online basemap fails without a
// network, and this is what stops the globe from being black when they do.
function addOfflineMap() {
  mainWindow?.webContents.executeJavaScript(`(function wait(n){
    if (typeof V === 'undefined' || !V || typeof Cesium === 'undefined') { if (n < 240) setTimeout(() => wait(n + 1), 500); return; }
    if (window.__bdocOfflineMap) return;
    window.__bdocOfflineMap = true;
    Cesium.TileMapServiceImageryProvider.fromUrl('https://cdnjs.cloudflare.com/ajax/libs/cesium/1.146.0/Assets/Textures/NaturalEarthII')
      .then(p => V.imageryLayers.addImageryProvider(p, 0)).catch(e => console.warn('[offline map]', e));
  })(0)`).catch(() => {});
}

// ~/.bdoc/unlock on a machine opens every layer in offline mode. The cloud account cannot be
// checked without a network, and being locked out of paid tools in a grid-down is the failure
// this app exists to prevent. Auth.checkDevKey already honours this on localhost. A file named
// bdoc-unlock beside the portable exe does the same, so a USB copy works on a spare laptop.
function offlineUrl() {
  const beside = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  const unlocked = [path.join(os.homedir(), '.bdoc', 'unlock'), path.join(beside, 'bdoc-unlock')].some(f => fs.existsSync(f));
  return `http://localhost:${LOCAL_PORT}/${unlocked ? '?dev=local' : ''}`;
}

function setMode(mode) {
  runMode = mode;
  mainWindow.setTitle(mode === 'live' ? 'KGS BDOC — LIVE (auto-updating)' : 'KGS BDOC — OFFLINE (bundled build)');
  mainWindow.loadURL(mode === 'live' ? LIVE_URL : offlineUrl());
}

// ── Create main window ────────────────────────────────────────────────────────
async function createWindow() {
  if (process.env.BDOC_FORCE_OFFLINE !== '1' && await liveReachable()) runMode = 'live';
  const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1920, width),
    height: Math.min(1080, height),
    minWidth: 1024,
    minHeight: 600,
    title: 'KGS BDOC — Global Intelligence Platform',
    backgroundColor: '#0E1116',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
    }
  });

  // CDN files come from the bundle whenever the app runs offline, so the globe still starts
  // with no internet. Live mode passes everything through untouched.
  mainWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: ['https://cdnjs.cloudflare.com/*', 'https://cdn.jsdelivr.net/*', 'https://unpkg.com/*', 'https://fonts.googleapis.com/*'] },
    (details, callback) => {
      if (runMode !== 'offline') return callback({});
      const local = vendorPath(details.url);
      callback(local ? { redirectURL: `http://localhost:${LOCAL_PORT}${local}` } : { cancel: true });
    }
  );

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-finish-load', () => { if (runMode === 'offline') addOfflineMap(); });
  // Live site unreachable mid-load (Wi-Fi drop, grid-down) → fall back to the bundled copy
  mainWindow.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && runMode === 'live' && code !== -3) setMode('offline');
  });
  setMode(runMode);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App menu ──────────────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: 'BDOC',
      submenu: [
        { label: 'Check for Desktop Update…', click: () => shell.openExternal(RELEASES_URL) },
        { label: 'Running Mode', click: () => dialog.showMessageBox({ title: 'BDOC mode', message: runMode === 'live' ? 'LIVE — loading kgsbdoc.netlify.app. Web fixes arrive automatically.' : 'OFFLINE — bundled build ' + app.getVersion() + '. Reconnect and restart to load the live version.', type: 'info' }) },
        { label: 'Switch to Offline Mode', click: () => setMode('offline') },
        { label: 'Switch to Live Mode', click: () => setMode('live') },
        { label: 'About KGS BDOC', click: () => dialog.showMessageBox({ title: 'KGS BDOC', message: 'KGS BDOC v' + app.getVersion() + '\nKitsune Global Solutions LLC\nOffline tactical intelligence platform', type: 'info' }) },
        { type: 'separator' },
        { label: 'Clear Cache & Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => {
          if (mainWindow) mainWindow.webContents.executeJavaScript(`
            navigator.serviceWorker.ready.then(reg => reg.active && reg.active.postMessage('CLEAR_CACHE'));
            setTimeout(() => location.reload(true), 500);
          `);
        }},
        { type: 'separator' },
        { role: 'quit', label: 'Exit BDOC' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Fullscreen (F11)' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ]
    },
    {
      label: 'Intelligence',
      submenu: [
        { label: 'Export KML', accelerator: 'CmdOrCtrl+Shift+K', click: () => mainWindow?.webContents.executeJavaScript('exportKML && exportKML()') },
        { label: 'Export GeoJSON', click: () => mainWindow?.webContents.executeJavaScript('exportGeoJSON && exportGeoJSON()') },
        { label: 'Generate Intel Brief (PDF)', click: () => mainWindow?.webContents.executeJavaScript('genPDF && genPDF()') },
        { type: 'separator' },
        { label: 'Screenshot', accelerator: 'CmdOrCtrl+Shift+P', click: () => mainWindow?.webContents.executeJavaScript('captureScreen && captureScreen()') },
      ]
    },
    {
      label: 'Offline',
      submenu: [
        { label: 'Cache Status', click: showCacheStatus },
        { label: 'Force Cache All Assets', click: () => mainWindow?.webContents.executeJavaScript(`
          navigator.serviceWorker.ready.then(reg => {
            console.log('[SW] Cache rebuild triggered');
            reg.update();
          });
        `)},
        { type: 'separator' },
        { label: 'Connection Status', click: () => mainWindow?.webContents.executeJavaScript(`
          alert('Status: ' + (navigator.onLine ? 'ONLINE' : 'OFFLINE (GRID DOWN MODE)'));
        `)},
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function showCacheStatus() {
  try {
    const result = await mainWindow?.webContents.executeJavaScript(`
      (async () => {
        const keys = await caches.keys();
        let total = 0;
        for (const k of keys) {
          const c = await caches.open(k);
          const r = await c.keys();
          total += r.length;
        }
        return { caches: keys.length, entries: total };
      })()
    `);
    dialog.showMessageBox({
      title: 'BDOC Cache Status',
      message: `Cache buckets: ${result?.caches ?? 'unknown'}\nCached entries: ${result?.entries ?? 'unknown'}\n\nWhen offline, BDOC uses this cached data.\nReconnect to internet to update the cache.`,
      type: 'info'
    });
  } catch(e) {
    dialog.showMessageBox({ title: 'Cache', message: 'Unable to read cache status.', type: 'warning' });
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────
// p157c: preload.js called both of these and NEITHER existed.
//   - 'bdoc-app-version' is sendSync; with no handler the renderer BLOCKS
//     forever, so the preload bridge never finishes and window.BDOC_Electron
//     is undefined — the app silently loses its desktop features.
//   - 'open-external' was invoked for every external link and the promise
//     just rejected, so links did nothing.
ipcMain.on('bdoc-app-version', (e) => { e.returnValue = app.getVersion(); });
ipcMain.handle('open-external', async (_e, url) => {
  try {
    const u = new URL(String(url));
    // Only ever hand http(s) to the OS browser. Never file:, never custom
    // schemes — shell.openExternal on an arbitrary scheme is a known RCE path.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    await shell.openExternal(u.href);
    return true;
  } catch (_) { return false; }
});

// ── Electron lifecycle ────────────────────────────────────────────────────────
app.whenReady().then(() => {
  startLocalServer();
  setTimeout(() => {
    buildMenu();
    createWindow();
  }, 800); // Give server time to start
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (localServer) localServer.close();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (localServer) localServer.close();
});

// Security: prevent navigation to external URLs
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith(`http://localhost:${LOCAL_PORT}`) || url.startsWith(LIVE_URL)) return;
    // Sign-in and billing leave the app and come back. The old filter blocked both, so
    // Google sign-in, Subscribe and the billing portal silently did nothing here.
    let host = '';
    try { host = new URL(url).hostname; } catch (_) { /* not navigable */ }
    if (/(^|\.)(supabase\.co|accounts\.google\.com)$/.test(host)) return;
    event.preventDefault();
    if (/^https:/i.test(url)) shell.openExternal(url);
  });
});
