'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('sb', {
  state: () => ipcRenderer.invoke('state'),
  addFolder: () => ipcRenderer.invoke('add-folder'),
  addPaths: (files) => ipcRenderer.invoke('add-paths', [...files].map(f => webUtils.getPathForFile(f)).filter(Boolean)),
  removeFolder: (f) => ipcRenderer.invoke('remove-folder', f),
  scan: (root) => ipcRenderer.invoke('scan', root),
  meta: (list) => ipcRenderer.invoke('meta', list),
  saveFavorites: (favs) => ipcRenderer.invoke('save-favorites', favs),
  saveSession: (s) => ipcRenderer.invoke('save-session', s),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  startDrag: (p) => ipcRenderer.send('start-drag', p),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  fileUrl: (p) => 'sbfile://f/?p=' + encodeURIComponent(p),
  on: (ch, cb) => {
    if (!['scan-progress', 'folder-changed', 'update'].includes(ch)) return;
    ipcRenderer.on(ch, (e, data) => cb(data));
  }
});
