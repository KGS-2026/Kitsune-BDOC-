// KGS BDOC — Electron Preload Script
// Runs in renderer context with access to limited Node APIs.
// Exposes offline-specific utilities to the web app.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('BDOC_Electron', {
  isElectron: true,
  // p157c: was hardcoded '8.0' and drifted from package.json (8.1.0), so the
  // app could not tell the user which build they were actually running — and
  // an update check comparing against it would always be wrong. Read the real
  // version from Electron instead of retyping it.
  version: ipcRenderer.sendSync('bdoc-app-version'),
  platform: process.platform,
  online: () => require('net').isIP('8.8.8.8') !== 0,
  // Tell main process to open external URLs in default browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // Get local cache stats
  getCacheDir: () => {
    const os = require('os');
    const path = require('path');
    return path.join(os.homedir(), '.bdoc', 'cache');
  }
});

// Override fetch to route Netlify function calls to local server
// (Belt-and-suspenders — the webRequest intercept in main.js handles this at network level)
window.addEventListener('DOMContentLoaded', () => {
  // Show offline indicator in app when network drops
  window.addEventListener('offline', () => {
    document.title = '⚠ OFFLINE — KGS BDOC';
  });
  window.addEventListener('online', () => {
    document.title = 'KGS BDOC — Global Intelligence Platform';
  });
});
