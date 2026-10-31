// The only bridge from electron/tools.html to the Tool Bridge. main.js also checks the caller.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('BDOCTools', {
  list: () => ipcRenderer.invoke('tools:list'),
  run: (id, input) => ipcRenderer.invoke('tools:run', id, input),
  ensureAI: () => ipcRenderer.invoke('tools:ensure-ai')
});
