'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { Readable } = require('stream');
const { autoUpdater } = require('electron-updater');

const AUDIO_EXT = new Set(['wav', 'wave', 'mp3', 'aif', 'aiff', 'aifc', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'webm', 'caf', 'wma']);
const MIME = { wav: 'audio/wav', wave: 'audio/wav', mp3: 'audio/mpeg', aif: 'audio/aiff', aiff: 'audio/aiff', aifc: 'audio/aiff', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', webm: 'audio/webm', caf: 'audio/x-caf', wma: 'audio/x-ms-wma' };

if (!app.requestSingleInstanceLock()) { app.quit(); }

protocol.registerSchemesAsPrivileged([
  { scheme: 'sbfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } }
]);

/* ---------- Persistent store (JSON files in the user's AppData folder) ---------- */
const DATA = () => app.getPath('userData');
function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA(), name), 'utf8')); } catch (e) { return fallback; }
}
const pendingWrites = new Map();
function writeJSON(name, obj, delay = 400) {
  clearTimeout(pendingWrites.get(name));
  pendingWrites.set(name, setTimeout(() => {
    pendingWrites.delete(name);
    const file = path.join(DATA(), name), tmp = file + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, file); } catch (e) { console.error('save failed', name, e); }
  }, delay));
}
function flushWrites() {
  for (const [name, t] of pendingWrites) { clearTimeout(t); }
  pendingWrites.clear();
  try { fs.writeFileSync(path.join(DATA(), 'library.json'), JSON.stringify(library)); } catch (e) {}
  try { fs.writeFileSync(path.join(DATA(), 'index.json'), JSON.stringify(index)); } catch (e) {}
}

let library, index, win;

/* ---------- Window ---------- */
function createWindow() {
  const b = readJSON('window.json', { width: 1280, height: 820 });
  win = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y, minWidth: 820, minHeight: 500,
    backgroundColor: '#111215', title: 'Sound Browser',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  if (b.maximized) win.maximize();
  const saveBounds = () => { if (!win.isMinimized()) writeJSON('window.json', { ...win.getNormalBounds(), maximized: win.isMaximized() }); };
  win.on('resize', saveBounds); win.on('move', saveBounds);
  win.loadFile(path.join(__dirname, 'index.html'));
}
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

/* ---------- Serve local audio to the window, with seeking (Range) support ---------- */
function registerProtocol() {
  protocol.handle('sbfile', async (req) => {
    try {
      const p = new URL(req.url).searchParams.get('p');
      if (!p || !isInsideLibrary(p)) return new Response('Forbidden', { status: 403 });
      const st = await fsp.stat(p);
      const ext = path.extname(p).slice(1).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      const range = req.headers.get('range');
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
        if (m && !m[1] && m[2]) { start = Math.max(0, st.size - parseInt(m[2], 10)); end = st.size - 1; }
        end = Math.min(end, st.size - 1);
        if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
        return new Response(Readable.toWeb(fs.createReadStream(p, { start, end })), {
          status: 206,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes' }
        });
      }
      return new Response(Readable.toWeb(fs.createReadStream(p)), {
        status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': type, 'Content-Length': String(st.size), 'Accept-Ranges': 'bytes' }
      });
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  });
}
function norm(p) { return process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p); }
function isInsideLibrary(p) {
  const n = norm(p);
  return library.folders.some(f => { const r = norm(f); return n === r || n.startsWith(r.endsWith(path.sep) ? r : r + path.sep); });
}

/* ---------- Scanning ---------- */
async function scanFolder(root, onProgress) {
  const out = [];
  let lastReport = 0;
  async function walk(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === '$RECYCLE.BIN' || e.name === 'System Volume Information') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      if (!e.isFile()) continue;
      const dot = e.name.lastIndexOf('.');
      const ext = dot > 0 ? e.name.slice(dot + 1).toLowerCase() : '';
      if (!AUDIO_EXT.has(ext)) continue;
      let st;
      try { st = await fsp.stat(full); } catch (err) { continue; }
      out.push({ path: full, name: e.name, ext, size: st.size, mtime: Math.round(st.mtimeMs), rel: path.relative(root, dir).split(path.sep).join('/') });
      if (out.length - lastReport >= 250) { lastReport = out.length; onProgress(out.length); }
    }
  }
  await walk(root);
  return out;
}

/* ---------- Folder watching: new or deleted sounds show up on their own ---------- */
const watchers = new Map();
function watchFolder(root) {
  if (watchers.has(root)) return;
  try {
    let t;
    const w = fs.watch(root, { recursive: true }, () => {
      clearTimeout(t);
      t = setTimeout(() => { if (win) win.webContents.send('folder-changed', root); }, 1500);
    });
    w.on('error', () => {});
    watchers.set(root, w);
  } catch (e) { /* recursive watching is not available on every system */ }
}
function unwatchFolder(root) { const w = watchers.get(root); if (w) { w.close(); watchers.delete(root); } }

/* ---------- Audio info (length, sample rate, bit depth), cached on disk ---------- */
let mm = null;
async function getMeta(file) {
  const key = file.path;
  const c = index[key];
  if (c && c.size === file.size && c.mtime === file.mtime) return c;
  mm = mm || require('music-metadata');
  let info = { size: file.size, mtime: file.mtime, dur: null };
  try {
    const r = await mm.parseFile(file.path, { skipCovers: true, skipPostHeaders: true });
    const f = r.format;
    info.dur = typeof f.duration === 'number' && isFinite(f.duration) ? +f.duration.toFixed(3) : null;
    if (f.sampleRate) info.sr = f.sampleRate;
    if (f.bitsPerSample) info.bits = f.bitsPerSample;
    if (f.numberOfChannels) info.ch = f.numberOfChannels;
    if (f.bitrate && !f.bitsPerSample) info.kbps = Math.round(f.bitrate / 1000);
    const t = r.common;
    if (t.bpm) info.bpm = Math.round(t.bpm);
    if (t.key) info.key = String(t.key);
  } catch (e) { /* unreadable header, leave blank */ }
  index[key] = info;
  writeJSON('index.json', index, 3000);
  return info;
}

/* ---------- IPC ---------- */
function setupIPC() {
  ipcMain.handle('state', () => ({ folders: library.folders, favorites: library.favorites, session: library.session, version: app.getVersion() }));

  ipcMain.handle('add-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add a sound folder', properties: ['openDirectory', 'multiSelections'] });
    if (r.canceled) return library.folders;
    for (const f of r.filePaths) if (!library.folders.includes(f)) { library.folders.push(f); watchFolder(f); }
    writeJSON('library.json', library);
    return library.folders;
  });
  ipcMain.handle('add-paths', async (e, paths) => {
    for (const p of paths) {
      try {
        const st = await fsp.stat(p);
        const dir = st.isDirectory() ? p : path.dirname(p);
        if (!library.folders.includes(dir)) { library.folders.push(dir); watchFolder(dir); }
      } catch (err) {}
    }
    writeJSON('library.json', library);
    return library.folders;
  });
  ipcMain.handle('remove-folder', (e, f) => {
    library.folders = library.folders.filter(x => x !== f);
    unwatchFolder(f);
    writeJSON('library.json', library);
    return library.folders;
  });
  ipcMain.handle('scan', async (e, root) => {
    try { await fsp.access(root); } catch (err) { return { root, missing: true, files: [] }; }
    const files = await scanFolder(root, n => e.sender.send('scan-progress', { root, n }));
    // attach whatever is already known about each file
    for (const f of files) {
      const c = index[f.path];
      if (c && c.size === f.size && c.mtime === f.mtime) f.meta = c;
    }
    return { root, files };
  });
  ipcMain.handle('meta', async (e, list) => {
    const res = {};
    let i = 0;
    const worker = async () => { while (i < list.length) { const f = list[i++]; res[f.path] = await getMeta(f); } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return res;
  });
  ipcMain.handle('save-favorites', (e, favs) => { library.favorites = favs; writeJSON('library.json', library); });
  ipcMain.handle('save-session', (e, s) => { library.session = s; writeJSON('library.json', library, 1000); });
  ipcMain.handle('show-in-folder', (e, p) => { if (isInsideLibrary(p)) shell.showItemInFolder(p); });
  ipcMain.on('start-drag', (e, p) => {
    if (!isInsideLibrary(p)) return;
    e.sender.startDrag({ file: p, icon: dragIcon });
  });

  ipcMain.handle('check-updates', () => checkForUpdates(true));
  ipcMain.handle('install-update', () => { flushWrites(); autoUpdater.quitAndInstall(true, true); });
}
let dragIcon;

/* ---------- Automatic updates from GitHub Releases ---------- */
function sendUpdate(status, extra = {}) { if (win) win.webContents.send('update', { status, ...extra }); }
function setupUpdates() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate('checking'));
  autoUpdater.on('update-available', i => sendUpdate('downloading', { version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', p => sendUpdate('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-not-available', () => sendUpdate('latest'));
  autoUpdater.on('update-downloaded', i => sendUpdate('ready', { version: i.version }));
  autoUpdater.on('error', err => sendUpdate('error', { message: String(err && err.message || err).split('\n')[0] }));
  if (app.isPackaged) {
    setTimeout(() => checkForUpdates(false), 4000);
    setInterval(() => checkForUpdates(false), 30 * 60 * 1000);
  }
}
function checkForUpdates(manual) {
  if (!app.isPackaged) { sendUpdate(manual ? 'dev' : 'idle'); return; }
  autoUpdater.checkForUpdates().catch(() => {});
}

/* ---------- Start ---------- */
app.whenReady().then(() => {
  library = readJSON('library.json', { folders: [], favorites: [], session: {} });
  library.folders = library.folders || []; library.favorites = library.favorites || []; library.session = library.session || {};
  index = readJSON('index.json', {});
  dragIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'drag.png'));
  if (dragIcon.isEmpty()) dragIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHklEQVQ4T2P8z8DwnwEJMDIyMjIyMgyqgFEDRg0AAP2UBR9xFSJ1AAAAAElFTkSuQmCC');
  Menu.setApplicationMenu(null);
  registerProtocol();
  setupIPC();
  library.folders.forEach(watchFolder);
  createWindow();
  setupUpdates();
});
app.on('before-quit', flushWrites);
app.on('window-all-closed', () => app.quit());
