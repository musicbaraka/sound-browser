'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('sb', {
  state: () => ipcRenderer.invoke('state'),
  addFolder: () => ipcRenderer.invoke('add-folder'),
  pathsOf: (files) => [...files].map(f => webUtils.getPathForFile(f)).filter(Boolean),
  addPaths: (paths) => ipcRenderer.invoke('add-paths', paths),
  inspectPaths: (paths) => ipcRenderer.invoke('inspect-paths', paths),
  openQuick: (p) => ipcRenderer.invoke('open-quick', p),
  removeFolder: (f) => ipcRenderer.invoke('remove-folder', f),
  libraryLoad: () => ipcRenderer.invoke('library-load'),
  scan: (root) => ipcRenderer.invoke('scan', root),
  check: (root) => ipcRenderer.invoke('check', root),
  meta: (list) => ipcRenderer.invoke('meta', list),
  saveTags: (tags) => ipcRenderer.invoke('save-tags', tags),
  saveAnalysis: (list) => ipcRenderer.invoke('save-analysis', list),
  saveFavorites: (favs) => ipcRenderer.invoke('save-favorites', favs),
  saveSession: (s) => ipcRenderer.invoke('save-session', s),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  showFolder: (root, rel) => ipcRenderer.invoke('show-folder', root, rel),
  eleven: {
    status: () => ipcRenderer.invoke('eleven-status'),
    openSite: () => ipcRenderer.invoke('open-eleven-site'),
    setKey: (k) => ipcRenderer.invoke('eleven-set-key', k),
    test: () => ipcRenderer.invoke('eleven-test'),
    chooseFolder: () => ipcRenderer.invoke('eleven-choose-folder'),
    generate: (o) => ipcRenderer.invoke('eleven-generate', o)
  },
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  writeEdit: (name, data) => ipcRenderer.invoke('write-edit', name, data),
  saveEdit: (src, original) => ipcRenderer.invoke('save-edit', src, original),
  startDrag: (p) => ipcRenderer.send('start-drag', p),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  openDownload: () => ipcRenderer.invoke('open-download'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  fileUrl: (p) => 'sbfile://f/?p=' + encodeURIComponent(p),
  on: (ch, cb) => {
    if (!['scan-batch', 'files-changed', 'folder-changed', 'update'].includes(ch)) return;
    ipcRenderer.on(ch, (e, data) => cb(data));
  }
});
