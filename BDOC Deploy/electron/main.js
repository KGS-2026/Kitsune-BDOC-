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

// ── Create main window ────────────────────────────────────────────────────────
function createWindow() {
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

  // Override Netlify Function paths to use local server
  // The app's /.netlify/functions/* calls get redirected to localhost:9080
  mainWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: ['*://*/*/.netlify/functions/*', '*://*/api/*'] },
    (details, callback) => {
      const url = new URL(details.url);
      const localUrl = `http://localhost:${LOCAL_PORT}${url.pathname}${url.search}`;
      callback({ redirectURL: localUrl });
    }
  );

  // Load the app — use local server for all content
  const appUrl = `http://localhost:${LOCAL_PORT}`;
  mainWindow.loadURL(appUrl);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('new-window', (event, url) => {
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App menu ──────────────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: 'BDOC',
      submenu: [
        { label: 'About KGS BDOC', click: () => dialog.showMessageBox({ title: 'KGS BDOC', message: 'KGS BDOC v8.0\nKitsune Global Solutions LLC\nOffline tactical intelligence platform', type: 'info' }) },
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
    if (!url.startsWith(`http://localhost:${LOCAL_PORT}`)) {
      event.preventDefault();
    }
  });
});
