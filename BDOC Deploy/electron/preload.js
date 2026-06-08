// KGS BDOC — Electron Preload Script
// Runs in renderer context with access to limited Node APIs.
// Exposes offline-specific utilities to the web app.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('BDOC_Electron', {
  isElectron: true,
  version: '8.0',
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
