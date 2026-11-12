'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeImage, Menu, safeStorage } = require('electron');
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
  flushIndexLog(true);
  for (const root of roots.keys()) writeCache(root, true);
}

/* Sound info index: loaded at start, then every change is appended to a small log file
   (rewriting one huge file for every change would be far too slow for big libraries) */
let indexLines = [], indexTimer = null;
function loadIndex() {
  const idx = readJSON('index.json', {});
  const logPath = path.join(DATA(), 'index-log.jsonl');
  let replayed = 0;
  try {
    for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
      if (!line) continue;
      try { const [p, entry] = JSON.parse(line); idx[p] = entry; replayed++; } catch (e) {}
    }
  } catch (e) {}
  if (replayed) {
    try { const f = path.join(DATA(), 'index.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(idx)); fs.renameSync(f + '.tmp', f); fs.rmSync(logPath, { force: true }); } catch (e) {}
  }
  return idx;
}
function indexPut(p, entry) {
  index[p] = entry;
  indexLines.push(JSON.stringify([p, entry]));
  if (!indexTimer) indexTimer = setTimeout(() => flushIndexLog(false), 2000);
}
function flushIndexLog(sync) {
  clearTimeout(indexTimer); indexTimer = null;
  if (!indexLines.length) return;
  const text = indexLines.join('\n') + '\n'; indexLines = [];
  const f = path.join(DATA(), 'index-log.jsonl');
  if (sync) { try { fs.appendFileSync(f, text); } catch (e) {} }
  else fsp.appendFile(f, text).catch(() => {});
}

let library, index, win;

/* ---------- Edited sounds: written as real WAV files so they can be dragged anywhere ---------- */
const editPaths = new Set();
let editSeq = 0;
const editsDir = () => path.join(DATA(), 'edits');
function cleanEdits() {
  try { fs.rmSync(editsDir(), { recursive: true, force: true }); } catch (e) {}
}
function safeName(n) {
  n = String(n).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 150);
  return n || 'edit.wav';
}
async function uniquePath(dir, name) {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name), i = 2;
  while (true) { try { await fsp.access(p); p = path.join(dir, `${base} ${i++}${ext}`); } catch (e) { return p; } }
}

/* ---------- Window ---------- */
function createWindow() {
  const b = readJSON('window.json', { width: 1280, height: 820 });
  win = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y, minWidth: 820, minHeight: 500,
    backgroundColor: '#111215', title: 'Sonalogue',
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
      if (!p || !allowed(p)) return new Response('Forbidden', { status: 403 });
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
const quickFiles = new Set(); // single files opened for a quick edit (not part of the library)
const allowed = p => quickFiles.has(p) || isInsideLibrary(p);
function isInsideLibrary(p) {
  const n = norm(p);
  return library.folders.some(f => { const r = norm(f); return n === r || n.startsWith(r.endsWith(path.sep) ? r : r + path.sep); });
}

/* ---------- Library: every folder's file list is kept in memory, cached on disk, and updated file by file ---------- */
const crypto = require('crypto');
const roots = new Map(); // root -> { files: Map(path -> file), scanning: Promise|null, pending: Set(rel), overflow, timer, cacheTimer }
const SKIP = new Set(['$RECYCLE.BIN', 'System Volume Information', 'node_modules']);
const isAudio = name => { const dot = name.lastIndexOf('.'); return dot > 0 && AUDIO_EXT.has(name.slice(dot + 1).toLowerCase()); };
const extOf = name => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
function rootState(root) {
  let st = roots.get(root);
  if (!st) { st = { files: null, scanning: null, pending: new Set(), overflow: false, timer: null, cacheTimer: null }; roots.set(root, st); }
  return st;
}
function fileRecord(root, full, name, stat) {
  return { path: full, name, ext: extOf(name), size: stat.size, mtime: Math.round(stat.mtimeMs), rel: path.relative(root, path.dirname(full)).split(path.sep).join('/') };
}
function withMeta(f) {
  const c = index[f.path];
  return c && c.size === f.size && c.mtime === f.mtime ? { ...f, meta: c } : f;
}

// Fast scan: several folders at once, file details read in parallel, results streamed in batches
async function scanTree(root, start, onBatch, known = null, added = null) {
  const out = [], dirs = [start];
  let batch = [], last = Date.now();
  const flush = force => {
    if (batch.length && (force || batch.length >= 3000 || Date.now() - last > 500)) { onBatch(batch); batch = []; last = Date.now(); }
  };
  async function doDir(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    const found = [];
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('._') || SKIP.has(e.name)) continue;
      if (e.isDirectory()) dirs.push(path.join(dir, e.name));
      else if (e.isFile() && isAudio(e.name)) found.push(e.name);
    }
    let todo = found;
    if (known) { // quick check: files already known in this folder are kept without reading them again
      const k = known.get(dir);
      todo = [];
      for (const n of found) { const f = k && k.get(n); if (f) out.push(f); else todo.push(n); }
    }
    for (let i = 0; i < todo.length; i += 64) {
      const chunk = todo.slice(i, i + 64);
      const stats = await Promise.all(chunk.map(n => fsp.stat(path.join(dir, n)).catch(() => null)));
      chunk.forEach((n, k) => { if (stats[k]) { const f = fileRecord(root, path.join(dir, n), n, stats[k]); out.push(f); batch.push(f); if (added) added.push(f); } });
      flush(false);
    }
  }
  await new Promise(resolve => {
    let active = 0;
    const next = () => {
      while (active < 8 && dirs.length) {
        active++;
        doDir(dirs.pop()).finally(() => { active--; next(); });
      }
      if (!active && !dirs.length) resolve();
    };
    next();
  });
  flush(true);
  return out;
}

const cachePath = root => path.join(DATA(), 'cache', crypto.createHash('sha1').update(root).digest('hex') + '.json');
function loadCache(root) {
  try {
    const c = JSON.parse(fs.readFileSync(cachePath(root), 'utf8'));
    if (c.root !== root) return null;
    const m = new Map();
    for (const [rel, name, size, mtime] of c.files) {
      const full = rel ? path.join(root, ...rel.split('/'), name) : path.join(root, name);
      m.set(full, { path: full, name, ext: extOf(name), size, mtime, rel });
    }
    return m;
  } catch (e) { return null; }
}
function writeCache(root, sync) {
  const st = roots.get(root);
  if (!st || !st.files) return;
  clearTimeout(st.cacheTimer); st.cacheTimer = null;
  const data = JSON.stringify({ v: 1, root, files: [...st.files.values()].map(f => [f.rel, f.name, f.size, f.mtime]) });
  const file = cachePath(root);
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (e) {}
  if (sync) { try { fs.writeFileSync(file, data); } catch (e) {} }
  else fsp.writeFile(file + '.tmp', data).then(() => fsp.rename(file + '.tmp', file)).catch(() => {});
}
function scheduleCache(root) {
  const st = roots.get(root);
  if (st && !st.cacheTimer) st.cacheTimer = setTimeout(() => writeCache(root, false), 8000);
}

async function fullScan(root, sender) {
  const st = rootState(root);
  if (st.scanning) return st.scanning;
  st.scanning = (async () => {
    try { await fsp.access(root); } catch (e) { return { root, missing: true, count: 0 }; }
    let n = 0;
    const list = await scanTree(root, root, b => { n += b.length; if (!sender.isDestroyed()) sender.send('scan-batch', { root, n, files: b.map(withMeta) }); });
    st.files = new Map(list.map(f => [f.path, f]));
    writeCache(root, false);
    return { root, count: list.length };
  })();
  try { return await st.scanning; }
  finally { st.scanning = null; if (st.pending.size || st.overflow) processChanges(root); }
}

// Start-up check: list every folder and compare with what is known. Only new files are read,
// so a big library is checked in seconds instead of re-reading every file.
async function quickCheck(root) {
  const st = rootState(root);
  if (st.scanning) return st.scanning;
  if (!st.files) return { root, needsScan: true };
  st.scanning = (async () => {
    try { await fsp.access(root); } catch (e) { return { root, missing: true }; }
    const known = new Map();
    for (const f of st.files.values()) {
      const d = path.dirname(f.path);
      let m = known.get(d); if (!m) { m = new Map(); known.set(d, m); }
      m.set(f.name, f);
    }
    const added = [];
    const list = await scanTree(root, root, () => {}, known, added);
    const next = new Map(list.map(f => [f.path, f]));
    const remove = [];
    for (const p of st.files.keys()) if (!next.has(p)) remove.push(p);
    st.files = next;
    if (added.length || remove.length) {
      if (win) win.webContents.send('files-changed', { root, upsert: added.map(withMeta), remove, removeDirs: [] });
      writeCache(root, false);
    }
    return { root, count: list.length, added: added.length, removed: remove.length };
  })();
  try { return await st.scanning; }
  finally { st.scanning = null; if (st.pending.size || st.overflow) processChanges(root); }
}

// Refresh one folder (and its subfolders) on request: re-read it and report what changed
async function refreshDir(root, rel) {
  const st = rootState(root);
  while (st.scanning) { try { await st.scanning; } catch (e) {} }
  if (!st.files) return { error: 'This folder has not been scanned yet.' };
  const dir = rel ? path.join(root, ...rel.split('/').filter(Boolean)) : root;
  try { await fsp.access(dir); } catch (e) { return { error: 'This folder was not found. It may have been moved or renamed.' }; }
  const list = await scanTree(root, dir, () => {});
  const now = new Map(list.map(f => [f.path, f])), pre = dir === root ? '' : dir + path.sep;
  const upsert = [], remove = [];
  let added = 0, changed = 0;
  for (const p of [...st.files.keys()]) if ((!pre || p.startsWith(pre)) && !now.has(p)) { st.files.delete(p); remove.push(p); }
  for (const f of list) {
    const o = st.files.get(f.path);
    if (!o) added++; else if (o.size !== f.size || o.mtime !== f.mtime) changed++; else continue;
    st.files.set(f.path, f); upsert.push(withMeta(f));
  }
  if (upsert.length || remove.length) { if (win) win.webContents.send('files-changed', { root, upsert, remove, removeDirs: [] }); scheduleCache(root); }
  return { added, removed: remove.length, changed, total: list.length };
}

/* ---------- Folder watching: only the files that changed are updated ---------- */
const watchers = new Map();
function watchFolder(root) {
  if (watchers.has(root)) return;
  try {
    const w = fs.watch(root, { recursive: true }, (type, filename) => {
      const st = rootState(root);
      if (!filename) st.overflow = true; else st.pending.add(String(filename));
      if (st.pending.size > 20000) { st.overflow = true; st.pending.clear(); }
      clearTimeout(st.timer);
      st.timer = setTimeout(() => processChanges(root), 1200);
    });
    w.on('error', () => {});
    watchers.set(root, w);
  } catch (e) { /* recursive watching is not available on every system */ }
}
function unwatchFolder(root) { const w = watchers.get(root); if (w) { w.close(); watchers.delete(root); } }

async function processChanges(root) {
  const st = rootState(root);
  if (st.scanning || !st.files) return; // handled once the scan finishes
  if (st.overflow) {
    st.overflow = false; st.pending.clear();
    if (win) win.webContents.send('folder-changed', root); // too many changes at once: rescan in the background
    return;
  }
  const rels = [...st.pending]; st.pending.clear();
  const upsert = [], remove = [], removeDirs = [];
  const seen = new Set();
  for (const rel of rels) {
    const full = path.join(root, rel);
    if (seen.has(full)) continue; seen.add(full);
    if (path.basename(full).startsWith('.')) continue;
    let stat = null;
    try { stat = await fsp.stat(full); } catch (e) {}
    if (!stat) {
      if (st.files.delete(full)) { remove.push(full); continue; }
      const pre = full + path.sep; let any = false;
      for (const p of st.files.keys()) if (p.startsWith(pre)) { st.files.delete(p); any = true; }
      if (any) removeDirs.push(full);
      continue;
    }
    if (stat.isDirectory()) {
      const list = await scanTree(root, full, () => {});
      const now = new Set(list.map(f => f.path)), pre = full + path.sep;
      for (const p of [...st.files.keys()]) if (p.startsWith(pre) && !now.has(p)) { st.files.delete(p); remove.push(p); }
      for (const f of list) { const o = st.files.get(f.path); if (!o || o.size !== f.size || o.mtime !== f.mtime) { st.files.set(f.path, f); upsert.push(withMeta(f)); } }
      continue;
    }
    if (!stat.isFile() || !isAudio(full)) continue;
    const f = fileRecord(root, full, path.basename(full), stat), o = st.files.get(full);
    if (!o || o.size !== f.size || o.mtime !== f.mtime) { st.files.set(full, f); upsert.push(withMeta(f)); }
  }
  if (upsert.length || remove.length || removeDirs.length) {
    if (win) win.webContents.send('files-changed', { root, upsert, remove, removeDirs });
    scheduleCache(root);
  }
}

/* ---------- Audio info (length, sample rate, bit depth), cached on disk ---------- */
let mm = null;
async function getMeta(file) {
  const key = file.path;
  const c = index[key];
  if (c && c.size === file.size && c.mtime === file.mtime && c.parsed) return c;
  let info = { size: file.size, mtime: file.mtime, dur: null, parsed: true };
  if (c && c.size === file.size && c.mtime === file.mtime && c.an) info.an = c.an;
  await parseMeta(file.path, info);
  indexPut(key, info);
  return info;
}
async function parseMeta(p, info) {
  mm = mm || require('music-metadata');
  try {
    const r = await mm.parseFile(p, { skipCovers: true, skipPostHeaders: true });
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
  return info;
}

/* ---------- IPC ---------- */
function setupIPC() {
  ipcMain.handle('state', () => ({ folders: library.folders, favorites: library.favorites, tags: library.tags, gen: library.gen || {}, session: library.session, version: app.getVersion(), dataPath: DATA(), platform: process.platform, manualUpdates: MANUAL_UPDATES }));
  ipcMain.handle('open-download', () => shell.openExternal('https://github.com/musicbaraka/sound-browser/releases/latest'));
  ipcMain.handle('open-data-folder', () => shell.openPath(DATA()));
  ipcMain.handle('save-tags', (e, tags) => { library.tags = tags; writeJSON('library.json', library); });
  ipcMain.handle('save-analysis', (e, list) => {
    for (const { path: p, size, mtime, an } of list) {
      const c = index[p];
      indexPut(p, c && c.size === size && c.mtime === mtime ? { ...c, an } : { size, mtime, an });
    }
  });

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
        if (st.isDirectory() && !library.folders.includes(p)) { library.folders.push(p); watchFolder(p); }
      } catch (err) {}
    }
    writeJSON('library.json', library);
    return library.folders;
  });
  ipcMain.handle('inspect-paths', (e, paths) => Promise.all(paths.map(async p => {
    try { const st = await fsp.stat(p); return { path: p, dir: st.isDirectory(), audio: st.isFile() && isAudio(path.basename(p)) }; }
    catch (err) { return { path: p }; }
  })));
  // Quick edit: open one sound from anywhere without adding its folder to the library
  ipcMain.handle('open-quick', async (e, p) => {
    try {
      const st = await fsp.stat(p);
      if (!st.isFile() || !isAudio(path.basename(p))) return null;
      quickFiles.add(p);
      const f = { path: p, name: path.basename(p), ext: extOf(path.basename(p)), size: st.size, mtime: Math.round(st.mtimeMs) };
      f.meta = await parseMeta(p, { size: f.size, mtime: f.mtime, dur: null });
      return f;
    } catch (err) { return null; }
  });
  ipcMain.handle('remove-folder', (e, f) => {
    library.folders = library.folders.filter(x => x !== f);
    unwatchFolder(f);
    roots.delete(f);
    fsp.rm(cachePath(f), { force: true }).catch(() => {});
    writeJSON('library.json', library);
    return library.folders;
  });
  ipcMain.handle('library-load', async () => {
    const out = [];
    for (const root of library.folders) {
      const st = rootState(root);
      if (!st.files) st.files = loadCache(root);
      let missing = false;
      try { await fsp.access(root); } catch (e) { missing = true; }
      out.push({ root, missing, cached: !!st.files, files: st.files ? [...st.files.values()].map(withMeta) : [] });
    }
    return out;
  });
  ipcMain.handle('scan', (e, root) => fullScan(root, e.sender));
  ipcMain.handle('check', (e, root) => quickCheck(root));
  ipcMain.handle('refresh-dir', (e, root, rel) => library.folders.includes(root) ? refreshDir(root, rel || '') : { error: 'Unknown folder.' });
  ipcMain.handle('meta', async (e, list) => {
    const res = {};
    let i = 0;
    const worker = async () => { while (i < list.length) { const f = list[i++]; res[f.path] = await getMeta(f); } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return res;
  });
  ipcMain.handle('save-favorites', (e, favs) => { library.favorites = favs; writeJSON('library.json', library); });
  ipcMain.handle('save-session', (e, s) => { library.session = s; writeJSON('library.json', library, 1000); });
  ipcMain.handle('show-in-folder', (e, p) => { if (allowed(p)) shell.showItemInFolder(p); });
  ipcMain.handle('show-folder', (e, root, rel) => {
    if (!library.folders.includes(root)) return;
    const p = rel ? path.join(root, ...rel.split('/').filter(Boolean)) : root;
    shell.openPath(p);
  });
  ipcMain.handle('write-edit', async (e, name, data) => {
    const dir = path.join(editsDir(), String(++editSeq));
    await fsp.mkdir(dir, { recursive: true });
    const p = path.join(dir, safeName(name));
    await fsp.writeFile(p, Buffer.from(data));
    editPaths.add(p);
    // keep only the last few renders on disk
    const old = path.join(editsDir(), String(editSeq - 12));
    fsp.rm(old, { recursive: true, force: true }).then(() => {
      for (const q of editPaths) if (q.startsWith(old + path.sep)) editPaths.delete(q);
    }).catch(() => {});
    return p;
  });
  ipcMain.handle('save-edit', async (e, src, original) => {
    if (!editPaths.has(src) || !allowed(original)) return null;
    const dest = await uniquePath(path.dirname(original), path.basename(src));
    await fsp.copyFile(src, dest);
    return dest;
  });
  ipcMain.on('start-drag', (e, p) => {
    if (!allowed(p) && !editPaths.has(p)) return;
    e.sender.startDrag({ file: p, icon: dragIcon });
  });

  // Converter: one file at a time, saved next to the original or in a folder the user picked here
  const convertDirs = new Set();
  ipcMain.handle('convert-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Where should the converted file be saved?', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    convertDirs.add(r.filePaths[0]);
    return r.filePaths[0];
  });
  ipcMain.handle('convert-save', async (e, src, dir, name, data) => {
    if (dir ? !convertDirs.has(dir) : !allowed(src)) return { error: 'This location is not allowed.' };
    try {
      const dest = await uniquePath(dir || path.dirname(src), safeName(name));
      await fsp.writeFile(dest, Buffer.from(data));
      quickFiles.add(dest); // so it can be shown in its folder
      return { path: dest };
    } catch (err) {
      return { error: err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'EROFS' ? 'That folder cannot be written to. Choose another folder.' : err.message };
    }
  });
  ipcMain.handle('check-updates', () => checkForUpdates(true));
  ipcMain.handle('install-update', () => { flushWrites(); autoUpdater.quitAndInstall(true, true); });
}
let dragIcon;

/* ---------- ElevenLabs sound effects ---------- */
// Each user brings their own API key. Windows: protected for this user account. Mac: kept in the Keychain-backed safe storage.
const ELEVEN = process.env.SB_ELEVEN_BASE || 'https://api.elevenlabs.io';
const secretsFile = () => path.join(DATA(), 'secrets.json');
const { dpapi } = require('./dpapi');
let keyCache = null; // { key, unreadable }
async function loadElevenKey() {
  if (keyCache) return keyCache;
  let j = null;
  try { j = JSON.parse(fs.readFileSync(secretsFile(), 'utf8')); } catch (e) {}
  if (!j || !j.eleven) return (keyCache = { key: '' });
  try {
    let key = '';
    if (j.method === 'dpapi') key = Buffer.from(await dpapi('Unprotect', j.eleven), 'base64').toString('utf8');
    else if (j.enc) key = safeStorage.decryptString(Buffer.from(j.eleven, 'base64'));
    else key = Buffer.from(j.eleven, 'base64').toString('utf8');
    keyCache = { key };
    if (process.platform === 'win32' && j.method !== 'dpapi') saveElevenKey(key).catch(() => {}); // move to the sturdier protection
  } catch (e) {
    keyCache = { key: '', unreadable: true }; // keep the file; tell the user instead of acting as if there was no key
  }
  return keyCache;
}
async function saveElevenKey(key) {
  key = String(key || '').trim().replace(/^['"“”‘’]+|['"“”‘’]+$/g, '').trim(); // forgive quotes and line breaks from copy-paste
  let data = {};
  if (key) {
    const raw = Buffer.from(key, 'utf8').toString('base64');
    if (process.platform === 'win32') {
      try { data = { method: 'dpapi', eleven: await dpapi('Protect', raw) }; } catch (e) { data = null; }
    }
    if (!data || !data.eleven) {
      const enc = safeStorage.isEncryptionAvailable();
      data = { enc, eleven: enc ? safeStorage.encryptString(key).toString('base64') : raw };
    }
  }
  const f = secretsFile();
  fs.writeFileSync(f + '.tmp', JSON.stringify(data)); fs.renameSync(f + '.tmp', f);
  keyCache = { key };
}
const getElevenKey = async () => (await loadElevenKey()).key;
const genFolder = () => library.genFolder || path.join(app.getPath('documents'), 'Sound Browser', 'Generated');
// ElevenLabs errors: { detail: { status, message } } or a list of validation errors
async function elevenErrorInfo(res) {
  let status = '', text = '';
  try {
    const j = await res.json(), d = j.detail;
    if (typeof d === 'string') text = d;
    else if (Array.isArray(d)) text = d.map(x => x.msg).join(' ');
    else if (d) { status = d.status || d.code || ''; text = d.message || ''; }
    else text = j.message || '';
  } catch (e) {}
  return { code: res.status, status: String(status), text };
}
function elevenMessage(info, feature) {
  const t = info.text ? ` (ElevenLabs says: ${info.text})` : '';
  if (info.status === 'missing_permissions' || info.code === 403)
    return `Your API key is valid but is not allowed to use ${feature}. On elevenlabs.io, open Developers, then API Keys, edit this key and turn on "${feature}" (or make the key unrestricted).${t}`;
  if (info.code === 401) return `ElevenLabs did not accept this API key. Copy it again from elevenlabs.io (Developers, API Keys) and paste it in Settings.${t}`;
  if (info.code === 402 || /quota|credit/i.test(info.status + info.text)) return `Your ElevenLabs account is out of credits for this.${t}`;
  if (info.code === 429) return `ElevenLabs is busy or you reached your limit. Wait a moment and try again.${t}`;
  if (info.code === 422 || info.code === 400) return `ElevenLabs could not use these settings. Some formats need a higher plan.${t}`;
  return `ElevenLabs answered with error ${info.code}.${t}`;
}
function slugName(text) {
  const t = String(text).replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (t.length > 60 ? t.slice(0, 60).replace(/\s+\S*$/, '') : t) || 'Sound effect';
}
function setupEleven() {
  ipcMain.handle('open-eleven-site', () => shell.openExternal('https://elevenlabs.io/app/settings/api-keys'));
  ipcMain.handle('eleven-status', async () => { const c = await loadElevenKey(), k = c.key; return { hasKey: !!k, unreadable: !!c.unreadable, last4: k ? k.slice(-4) : '', folder: genFolder() }; });
  ipcMain.handle('eleven-set-key', async (e, key) => { await saveElevenKey(key); const k = await getElevenKey(); return { hasKey: !!k, last4: k ? k.slice(-4) : '' }; });
  ipcMain.handle('eleven-test', async () => {
    const key = await getElevenKey(); if (!key) return { ok: false, message: 'No API key saved yet.' };
    if (/\s/.test(key)) return { ok: false, message: 'The key contains spaces. Paste only the key itself, which starts with sk_.' };
    try {
      const res = await fetch(ELEVEN + '/v1/user', { headers: { 'xi-api-key': key } });
      if (!res.ok) {
        const info = await elevenErrorInfo(res);
        // a key limited to certain features cannot read account details, but it is still a valid key
        if (info.status === 'missing_permissions' || info.code === 403)
          return { ok: true, message: 'Key accepted. It is a limited key, so credits cannot be shown here. Make sure it allows Sound Effects.' };
        return { ok: false, message: elevenMessage(info, 'User') };
      }
      const j = await res.json().catch(() => ({}));
      const sub = j.subscription || {};
      const left = sub.character_limit != null && sub.character_count != null ? (sub.character_limit - sub.character_count).toLocaleString() + ' credits left' : '';
      return { ok: true, message: ['Connected', sub.tier ? `${sub.tier} plan` : '', left].filter(Boolean).join(' · ') };
    } catch (err) { return { ok: false, message: 'Could not reach ElevenLabs. Check your internet connection.' }; }
  });
  ipcMain.handle('eleven-choose-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Where should generated sounds be saved?', properties: ['openDirectory', 'createDirectory'], defaultPath: genFolder() });
    if (r.canceled || !r.filePaths[0]) return genFolder();
    library.genFolder = r.filePaths[0]; writeJSON('library.json', library);
    return genFolder();
  });
  ipcMain.handle('eleven-generate', async (e, o) => {
    const key = await getElevenKey();
    if (!key) return { error: 'Add your ElevenLabs API key in Settings first.' };
    const body = { text: String(o.text || '').trim(), model_id: o.model || 'eleven_text_to_sound_v2', prompt_influence: o.influence ?? 0.3 };
    if (!body.text) return { error: 'Describe the sound you want.' };
    if (o.duration) body.duration_seconds = Math.min(30, Math.max(0.5, +o.duration));
    if (o.loop) body.loop = true;
    const fmt = o.format || 'mp3_44100_128';
    let res;
    try {
      res = await fetch(`${ELEVEN}/v1/sound-generation?output_format=${encodeURIComponent(fmt)}`, {
        method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/*' }, body: JSON.stringify(body)
      });
    } catch (err) { return { error: 'Could not reach ElevenLabs. Check your internet connection.' }; }
    if (!res.ok) return { error: elevenMessage(await elevenErrorInfo(res), 'Sound Effects') };
    const audio = Buffer.from(await res.arrayBuffer());
    const folder = genFolder();
    await fsp.mkdir(folder, { recursive: true });
    const ext = fmt.startsWith('wav') ? 'wav' : fmt.startsWith('opus') ? 'opus' : fmt.startsWith('pcm') ? 'wav' : 'mp3';
    let data = audio;
    if (fmt.startsWith('pcm')) { // raw PCM: add a WAV header
      const rate = +fmt.split('_')[1], h = Buffer.alloc(44);
      h.write('RIFF', 0); h.writeUInt32LE(36 + audio.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
      h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(audio.length, 40);
      data = Buffer.concat([h, audio]);
    }
    const file = await uniquePath(folder, `${slugName(body.text)}.${ext}`);
    await fsp.writeFile(file, data);
    let folderAdded = false;
    if (!isInsideLibrary(file)) { library.folders.push(folder); watchFolder(folder); folderAdded = true; }
    library.gen = library.gen || {};
    library.gen[file] = { prompt: body.text, model: body.model_id, duration: body.duration_seconds || null, influence: body.prompt_influence, loop: !!body.loop, date: new Date().toISOString() };
    writeJSON('library.json', library);
    return { path: file, folder, folderAdded, folders: library.folders };
  });
}

/* ---------- Automatic updates from GitHub Releases ---------- */
function sendUpdate(status, extra = {}) { if (win) win.webContents.send('update', { status, ...extra }); }
// macOS only installs updates for apps signed with an Apple Developer ID. Until the Mac version is signed,
// it announces new versions and opens the download page instead of installing them itself.
const MANUAL_UPDATES = process.platform === 'darwin' && !fs.existsSync(path.join(process.resourcesPath || '', 'mac-signed'));
function setupUpdates() {
  autoUpdater.autoDownload = !MANUAL_UPDATES;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate('checking'));
  autoUpdater.on('update-available', i => sendUpdate(MANUAL_UPDATES ? 'available' : 'downloading', { version: i.version, percent: 0 }));
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
  library.folders = library.folders || []; library.favorites = library.favorites || []; library.session = library.session || {}; library.tags = library.tags || {};
  index = loadIndex();
  cleanEdits();
  try { dragIcon = nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname, '..', 'build', 'drag.png'))); } catch (e) { dragIcon = null; }
  if (!dragIcon || dragIcon.isEmpty()) { // drawn in code, so a drag always has a picture under the mouse
    const W = 32, px = Buffer.alloc(W * W * 4);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, bar = x % 6 < 3 && Math.abs(y - 16) < 4 + ((x * 7) % 11); px[o] = 75; px[o + 1] = 169; px[o + 2] = 227; px[o + 3] = bar ? 255 : 0; }
    dragIcon = nativeImage.createFromBitmap(px, { width: W, height: W });
  }
  // Mac apps need the standard menu (Cmd+Q, copy and paste in text fields); Windows does not show one
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { label: 'Edit', submenu: [
    // Cmd+Z: undo typing in a field, otherwise undo the last spectral repair
    { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: (i, w) => w && w.webContents.send('undo') }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
    // Cmd+A: the page decides (text in a field, otherwise the whole sound)
    { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: (i, w) => w && w.webContents.send('select-all') }] }, { role: 'windowMenu' }]) : null);
  registerProtocol();
  setupIPC();
  setupEleven();
  library.folders.forEach(watchFolder);
  createWindow();
  setupUpdates();
});
app.on('before-quit', flushWrites);
app.on('window-all-closed', () => app.quit());
