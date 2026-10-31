// KGS BDOC — Electron Main Process
// Runs BDOC as a native desktop app. Starts a local Express server to handle
// API proxies (replacing Netlify Functions), then loads the app in a BrowserWindow.
// Works completely offline — uses cached data and last-known API responses.

const { app, BrowserWindow, Menu, shell, dialog, ipcMain, Tray, nativeImage, Notification, powerMonitor } = require('electron');
const netSock = require('net');
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

// ── Grid-down tripwire ───────────────────────────────────────────────────────
// Watches the outside world and drops to offline mode by itself. It connects straight to
// several hosts by IP as well as name, because Wi-Fi with a dead uplink still reads "online"
// and a dead DNS must not read as a dead internet. Software cannot warn after power is gone
// on a laptop with no battery, so the heartbeat file reports that at the next start instead.
const BDOC_DIR = path.join(os.homedir(), '.bdoc');
const TRIP_FILE = path.join(BDOC_DIR, 'tripwire.json');   // {"failAfterSec": 45} to change it
const BEAT_FILE = path.join(BDOC_DIR, 'heartbeat.json');
const TRIP_LOG = path.join(BDOC_DIR, 'tripwire.log');
const PROBE_EVERY_MS = 10000;
const RECOVER_PROBES = 3;
const PROBES = (process.env.BDOC_PROBES || 'kgsbdoc.netlify.app:443,1.1.1.1:443,8.8.8.8:53,9.9.9.9:53')
  .split(',').map(p => p.split(':'));
let trip = null;
let probeFails = 0;
let probeOks = 0;
let cleanExit = false;

function tripLog(msg) {
  try {
    fs.mkdirSync(BDOC_DIR, { recursive: true });
    fs.appendFileSync(TRIP_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch (_) { /* a full disk must not stop the alarm */ }
}

function failLimit() {
  let sec = Number(process.env.BDOC_TRIP_SEC) || 45;
  try { sec = Number(JSON.parse(fs.readFileSync(TRIP_FILE, 'utf8')).failAfterSec) || sec; } catch (_) { /* default */ }
  return Math.max(1, Math.ceil(sec * 1000 / PROBE_EVERY_MS));
}

function probeHost([host, port]) {
  return new Promise(resolve => {
    const s = netSock.connect({ host, port: Number(port) });
    const end = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(4000, () => end(false));
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
  });
}

// Red bar and three beeps in the page. textContent only, and the text is ours.
function showAlarm(text, sound) {
  mainWindow?.webContents.executeJavaScript(`(function(){
    let b = document.getElementById('bdocTrip');
    if (!b) {
      b = document.createElement('div');
      b.id = 'bdocTrip';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:12px 16px;background:#DA3633;color:#fff;font:600 14px Inter,Arial,sans-serif;text-align:center;cursor:pointer';
      b.title = 'Click to dismiss';
      b.onclick = () => b.remove();
      document.body.appendChild(b);
    }
    b.textContent = ${JSON.stringify(text)};
    if (${!!sound}) {
      const a = new AudioContext();
      [0, 0.6, 1.2].forEach(t => { const o = a.createOscillator(); o.frequency.value = 880; o.connect(a.destination); o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.35); });
    }
  })()`).catch(() => {});
}

function raise(title, body) {
  tripLog(`${title}: ${body}`);
  try { new Notification({ title, body, urgency: 'critical' }).show(); } catch (_) { /* banner still shows */ }
  showAlarm(`${title} — ${body}`, true);
}

function tripped(reason) {
  trip = { reason, at: new Date().toLocaleTimeString() };
  raise('GRID-DOWN MODE', `${reason} at ${trip.at}. Running on the offline build.`);
  if (runMode === 'live') setMode('offline');
}

async function checkWorld() {
  const up = (await Promise.all(PROBES.map(probeHost))).some(Boolean);
  probeFails = up ? 0 : probeFails + 1;
  probeOks = up ? probeOks + 1 : 0;
  if (!trip && probeFails >= failLimit()) tripped('Internet lost');
  if (trip && probeOks >= RECOVER_PROBES) {
    const was = trip;
    trip = null;
    // Deliberately no automatic jump back: a flapping link must not reload the app under you.
    raise('INTERNET BACK', `Lost at ${was.at}. Use BDOC > Switch to Live Mode when ready.`);
  }
}

function beat() {
  try {
    fs.mkdirSync(BDOC_DIR, { recursive: true });
    fs.writeFileSync(BEAT_FILE, JSON.stringify({ ts: Date.now(), clean: cleanExit }));
  } catch (_) { /* best effort */ }
}

function startTripwire() {
  let last = null;
  try { last = JSON.parse(fs.readFileSync(BEAT_FILE, 'utf8')); } catch (_) { /* first run */ }
  if (last && !last.clean) {
    const when = new Date(last.ts).toLocaleString();
    setTimeout(() => raise('POWER OR CRASH', `BDOC did not shut down normally. Last alive ${when}.`), 6000);
  }
  beat();
  setInterval(() => { beat(); checkWorld().catch(() => {}); }, PROBE_EVERY_MS);
  powerMonitor.on('on-battery', () => raise('MAINS POWER LOST', 'Laptop is on battery.'));
  powerMonitor.on('on-ac', () => tripLog('mains power back'));
  powerMonitor.on('shutdown', () => { cleanExit = true; beat(); });
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
      autoplayPolicy: 'no-user-gesture-required', // the alarm must sound with nobody at the keys
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

  mainWindow.webContents.on('did-finish-load', () => {
    if (runMode === 'offline') addOfflineMap();
    if (trip) showAlarm(`GRID-DOWN MODE — ${trip.reason} at ${trip.at}. Running on the offline build.`, false);
  });
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
    createWindow().then(startTripwire);
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
  cleanExit = true;
  beat();
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
