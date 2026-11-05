'use strict';
/* global sb, aiffToWav */
const $ = s => document.querySelector(s);
const ROW = 28;
const IS_AIFF = e => e === 'aif' || e === 'aiff' || e === 'aifc';

let folders = [], missing = new Set(), byRoot = new Map();
let files = [], view = [], sel = -1, current = null;
let sortKey = 'name', sortDir = 1, typeFilter = new Set(), dirFilter = '';
let favs = new Set();

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';
const fmtDur = d => { if (d === undefined) return ''; if (d === null) return '?'; if (d < 60) return d.toFixed(d < 10 ? 2 : 1) + 's'; const m = Math.floor(d / 60), s = Math.floor(d % 60); return m + ':' + String(s).padStart(2, '0'); };
const fmtClock = d => { if (!isFinite(d)) return '0:00.0'; const m = Math.floor(d / 60); return m + ':' + (d % 60).toFixed(1).padStart(4, '0'); };
function fmtFormat(m) {
  if (!m) return '';
  const parts = [];
  if (m.sr) parts.push((m.sr % 1000 ? (m.sr / 1000).toFixed(1) : m.sr / 1000) + 'k');
  if (m.bits) parts.push(m.bits + '-bit');
  else if (m.kbps) parts.push(m.kbps + 'kbps');
  if (m.ch) parts.push(m.ch === 1 ? 'mono' : m.ch === 2 ? 'st' : m.ch + 'ch');
  return parts.join(' ');
}
const baseName = p => p.split(/[\\/]/).filter(Boolean).pop() || p;

/* ---------- Session memory ---------- */
let sessionTimer;
function saveSession() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => sb.saveSession({
    dirFilter, search: $('#search').value, sortKey, sortDir, types: [...typeFilter],
    favOnly: $('#favOnly').checked, autoplay: $('#autoplay').checked, loop: $('#loop').checked,
    vol: +$('#vol').value, selPath: current ? current.path : null, scroll: listEl.scrollTop
  }), 500);
}

/* ---------- Library loading ---------- */
function makeRecords(root, list) {
  const rootName = baseName(root);
  return list.map(f => {
    const dir = f.rel ? f.rel + '/' : '';
    return {
      path: f.path, name: f.name, ext: f.ext, size: f.size, mtime: f.mtime, root, dir, rootName,
      dkey: root + '|' + dir, meta: f.meta, dur: f.meta ? f.meta.dur : undefined,
      hay: (rootName + '/' + dir + f.name).toLowerCase()
    };
  });
}
async function scanRoot(root) {
  const r = await sb.scan(root);
  if (r.missing) missing.add(root); else missing.delete(root);
  byRoot.set(root, makeRecords(root, r.files));
}
function mergeAll() {
  files = [];
  for (const f of folders) { const list = byRoot.get(f); if (list) files.push(...list); }
  if (current) current = files.find(r => r.path === current.path) || null;
  rebuild();
}
async function scanAll() {
  $('#stats').textContent = 'Scanning…';
  for (const f of folders) { await scanRoot(f); mergeAll(); }
  mergeAll();
}
sb.on('scan-progress', ({ root, n }) => { $('#stats').textContent = `Scanning ${baseName(root)}… ${n.toLocaleString()} sounds`; });
sb.on('folder-changed', async root => { if (!folders.includes(root)) return; await scanRoot(root); mergeAll(); });

async function addFolders(newList) {
  const added = newList.filter(f => !folders.includes(f));
  folders = newList;
  for (const f of added) { await scanRoot(f); mergeAll(); }
  if (added.length) { dirFilter = added[0] + '|'; mergeAll(); saveSession(); }
}
$('#add').onclick = async () => addFolders(await sb.addFolder());
$('#rescan').onclick = scanAll;

let dragDepth = 0;
addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; document.body.classList.add('drag'); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drag'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('drag');
  if (e.dataTransfer.files.length) addFolders(await sb.addPaths(e.dataTransfer.files));
});

/* ---------- Filtering, sorting, sidebar ---------- */
function rebuild() { buildChips(); buildSide(); applyFilter(false); }

function buildChips() {
  const counts = {};
  for (const r of files) counts[r.ext] = (counts[r.ext] || 0) + 1;
  for (const x of [...typeFilter]) if (!counts[x]) typeFilter.delete(x);
  $('#chips').innerHTML = Object.keys(counts).sort().map(x => `<button class="chip${typeFilter.has(x) ? ' on' : ''}" data-x="${x}">${x.toUpperCase()} ${counts[x].toLocaleString()}</button>`).join(' ');
}
$('#chips').onclick = e => {
  const x = e.target.dataset && e.target.dataset.x; if (!x) return;
  typeFilter.has(x) ? typeFilter.delete(x) : typeFilter.add(x);
  buildChips(); applyFilter(); saveSession();
};

function buildSide() {
  let html = `<div class="dir${dirFilter === '' ? ' on' : ''}" data-d=""><span class="n">All sounds</span><b>${files.length.toLocaleString()}</b></div>`;
  for (const root of folders) {
    const list = byRoot.get(root) || [];
    const counts = new Map();
    for (const r of list) {
      const parts = r.dir.split('/').filter(Boolean);
      let p = '';
      for (const part of parts) { p += part + '/'; counts.set(p, (counts.get(p) || 0) + 1); }
    }
    const rk = root + '|';
    const miss = missing.has(root);
    html += `<div class="dir root${dirFilter === rk ? ' on' : ''}${miss ? ' missing' : ''}" data-d="${esc(rk)}" title="${esc(root)}${miss ? ' (not found: drive unplugged or folder moved)' : ''}"><span class="n">${esc(baseName(root))}${miss ? ' (not found)' : ''}</span><b>${list.length.toLocaleString()}</b><span class="x" data-rm="${esc(root)}" title="Remove from library (files are not deleted)">×</span></div>`;
    const dirs = [...counts.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    for (const d of dirs) {
      const parts = d.split('/').filter(Boolean);
      const key = rk + d;
      html += `<div class="dir${dirFilter === key ? ' on' : ''}" data-d="${esc(key)}" style="padding-left:${10 + parts.length * 12}px" title="${esc(d)}"><span class="n">${esc(parts[parts.length - 1])}</span><b>${counts.get(d).toLocaleString()}</b></div>`;
    }
  }
  $('#side').innerHTML = html;
}
$('#side').onclick = async e => {
  const rm = e.target.dataset && e.target.dataset.rm;
  if (rm) {
    e.stopPropagation();
    folders = await sb.removeFolder(rm);
    byRoot.delete(rm); missing.delete(rm);
    if (dirFilter.startsWith(rm + '|')) dirFilter = '';
    mergeAll(); saveSession();
    return;
  }
  const el = e.target.closest('.dir'); if (!el) return;
  dirFilter = el.dataset.d;
  $('#side').querySelectorAll('.dir.on').forEach(x => x.classList.remove('on'));
  el.classList.add('on');
  applyFilter(); saveSession();
};

function applyFilter(resetScroll = true) {
  const terms = $('#search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const favOnly = $('#favOnly').checked;
  view = files.filter(r =>
    (!dirFilter || r.dkey.startsWith(dirFilter)) &&
    (!typeFilter.size || typeFilter.has(r.ext)) &&
    (!favOnly || favs.has(r.path)) &&
    terms.every(t => r.hay.includes(t)));
  sortView();
  sel = current ? view.indexOf(current) : -1;
  let total = 0; for (const r of view) total += r.size;
  $('#stats').textContent = files.length ? `${view.length.toLocaleString()} of ${files.length.toLocaleString()} sounds · ${fmtSize(total)}` : 'No sounds yet';
  $('#empty').style.display = folders.length ? 'none' : 'flex';
  if (resetScroll) listEl.scrollTop = sel >= 0 ? Math.max(0, sel * ROW - 100) : 0;
  render();
}
const cmp = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
function sortView() {
  const k = sortKey, d = sortDir;
  const num = (x, y) => { x = x ?? Infinity; y = y ?? Infinity; return x === y ? 0 : x < y ? -1 : 1; };
  view.sort((a, b) => {
    let r;
    if (k === 'name') r = cmp(a.name, b.name);
    else if (k === 'dir') r = cmp(a.rootName + a.dir, b.rootName + b.dir) || cmp(a.name, b.name);
    else if (k === 'ext') r = cmp(a.ext, b.ext) || cmp(a.name, b.name);
    else if (k === 'size') r = a.size - b.size;
    else if (k === 'dur') r = num(a.dur, b.dur);
    else if (k === 'fmt') r = num(a.meta && a.meta.sr, b.meta && b.meta.sr) || num(a.meta && a.meta.bits, b.meta && b.meta.bits);
    else if (k === 'fav') r = (favs.has(b.path) - favs.has(a.path)) || cmp(a.name, b.name);
    return (r || cmp(a.path, b.path)) * d;
  });
  document.querySelectorAll('#cols span').forEach(s => s.classList.toggle('on', s.dataset.k === sortKey));
}
$('#cols').onclick = e => {
  const k = e.target.dataset && e.target.dataset.k; if (!k) return;
  if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
  applyFilter(); saveSession();
};
let searchTimer;
$('#search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { applyFilter(); saveSession(); }, 120); };
$('#favOnly').onchange = () => { applyFilter(); saveSession(); };
$('#autoplay').onchange = saveSession;

/* ---------- Virtual list ---------- */
const listEl = $('#list'), spacer = $('#spacer');
let renderQueued = false;
function render() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(doRender); } }
function doRender() {
  renderQueued = false;
  spacer.style.height = view.length * ROW + 'px';
  const top = listEl.scrollTop, h = listEl.clientHeight;
  const start = Math.max(0, Math.floor(top / ROW) - 8);
  const end = Math.min(view.length, Math.ceil((top + h) / ROW) + 8);
  let html = '';
  for (let i = start; i < end; i++) {
    const r = view[i];
    if (!r.meta) wantMeta(r);
    const fav = favs.has(r.path);
    html += `<div class="row${i === sel ? ' sel' : ''}" data-i="${i}" draggable="true" style="top:${i * ROW}px">`
      + `<span class="star${fav ? ' on' : ''}" data-star="1">${fav ? '★' : '☆'}</span>`
      + `<span class="nm" title="${esc(r.path)}">${esc(r.name)}</span>`
      + `<span class="dr" title="${esc(r.rootName + '/' + r.dir)}">${esc(r.rootName + '/' + r.dir)}</span>`
      + `<span class="tp">${r.ext.toUpperCase()}</span>`
      + `<span class="fm">${fmtFormat(r.meta)}</span>`
      + `<span class="du">${fmtDur(r.dur)}</span>`
      + `<span class="sz">${fmtSize(r.size)}</span></div>`;
  }
  spacer.innerHTML = html;
}
listEl.addEventListener('scroll', () => { render(); saveSession(); });
addEventListener('resize', () => { render(); sizeCanvas(); });

listEl.addEventListener('click', e => {
  const row = e.target.closest('.row'); if (!row) return;
  const i = +row.dataset.i;
  if (e.target.dataset.star) { toggleFav(view[i]); return; }
  select(i, true);
});
listEl.addEventListener('dragstart', e => {
  const row = e.target.closest('.row'); if (!row) return;
  e.preventDefault();
  sb.startDrag(view[+row.dataset.i].path);
});

/* Right-click menu */
const menu = $('#menu'); let menuRec = null;
listEl.addEventListener('contextmenu', e => {
  const row = e.target.closest('.row'); if (!row) return;
  e.preventDefault();
  menuRec = view[+row.dataset.i];
  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = Math.min(e.clientY, innerHeight - menu.offsetHeight - 8) + 'px';
});
addEventListener('click', () => { menu.style.display = 'none'; });
menu.onclick = e => {
  const a = e.target.dataset.a, r = menuRec; if (!a || !r) return;
  if (a === 'play') select(view.indexOf(r), true);
  else if (a === 'fav') toggleFav(r);
  else if (a === 'reveal') sb.showInFolder(r.path);
  else if (a === 'copy') navigator.clipboard.writeText(r.path).catch(() => {});
};

function toggleFav(r) {
  if (!r) return;
  favs.has(r.path) ? favs.delete(r.path) : favs.add(r.path);
  sb.saveFavorites([...favs]);
  if ($('#favOnly').checked) applyFilter(false); else render();
}
function ensureVisible(i) {
  const top = i * ROW, h = listEl.clientHeight;
  if (top < listEl.scrollTop) listEl.scrollTop = top;
  else if (top + ROW > listEl.scrollTop + h) listEl.scrollTop = top + ROW - h;
}

/* ---------- Audio info for visible rows (cached on disk by the app) ---------- */
let metaWanted = new Map(), metaTimer = null, metaBusy = false;
function wantMeta(r) {
  if (r.metaPending) return;
  r.metaPending = true; metaWanted.set(r.path, r);
  if (!metaTimer) metaTimer = setTimeout(flushMeta, 60);
}
async function flushMeta() {
  metaTimer = null;
  if (metaBusy) { metaTimer = setTimeout(flushMeta, 100); return; }
  const batch = [...metaWanted.values()].slice(-60);
  for (const r of batch) metaWanted.delete(r.path);
  if (!batch.length) return;
  metaBusy = true;
  try {
    const res = await sb.meta(batch.map(r => ({ path: r.path, size: r.size, mtime: r.mtime })));
    for (const r of batch) { const m = res[r.path]; if (m) { r.meta = m; if (r.dur === undefined || r.dur === null) r.dur = m.dur; } }
  } catch (e) {}
  metaBusy = false;
  render();
  if (metaWanted.size) metaTimer = setTimeout(flushMeta, 10);
}

/* ---------- Playback ---------- */
const player = $('#player');
$('#vol').oninput = e => { player.volume = +e.target.value; saveSession(); };
$('#loop').onchange = e => { player.loop = e.target.checked; saveSession(); };
let blobUrl = null, loadToken = 0;
const convCache = new Map();

async function getBuffer(r) {
  const res = await fetch(sb.fileUrl(r.path));
  if (!res.ok) throw new Error('Could not open this file. It may have been moved or deleted.');
  return res.arrayBuffer();
}
async function wavFromAiff(r) {
  if (convCache.has(r.path)) return convCache.get(r.path);
  const buf = aiffToWav(await getBuffer(r));
  convCache.set(r.path, buf);
  if (convCache.size > 6) convCache.delete(convCache.keys().next().value);
  return buf;
}

function select(i, play) {
  if (i < 0 || i >= view.length) return;
  sel = i; current = view[i];
  ensureVisible(i); render();
  load(current, play);
  saveSession();
}
async function load(r, play) {
  const t = ++loadToken;
  $('#np-name').textContent = r.name;
  $('#np-dir').textContent = r.rootName + '/' + r.dir;
  $('#status').textContent = '';
  peaks = null; drawWave();
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  let aiffBuf = null;
  if (IS_AIFF(r.ext)) {
    try { aiffBuf = await wavFromAiff(r); }
    catch (err) { if (t === loadToken) $('#status').textContent = err.message; return; }
    if (t !== loadToken) return;
    blobUrl = URL.createObjectURL(new Blob([aiffBuf], { type: 'audio/wav' }));
    player.src = blobUrl;
  } else {
    player.src = sb.fileUrl(r.path);
  }
  player.loop = $('#loop').checked;
  if (play) player.play().catch(() => {});
  loadPeaks(r, t, aiffBuf);
}
player.onerror = () => { if (current && player.src) $('#status').textContent = 'This file format cannot be played (' + current.ext.toUpperCase() + ').'; };
player.onplay = () => { $('#play').textContent = '■'; tick(); };
player.onpause = player.onended = () => { $('#play').textContent = '▶'; drawWave(); };
player.onloadedmetadata = () => {
  if (current && (current.dur == null) && isFinite(player.duration)) { current.dur = player.duration; render(); }
  updateTime();
};
player.ontimeupdate = updateTime;
function updateTime() { $('#np-time').textContent = fmtClock(player.currentTime) + ' / ' + fmtClock(player.duration); }

function togglePlay() {
  if (!current) { if (view.length) select(Math.max(sel, 0), true); return; }
  if (player.paused) { if (player.ended) player.currentTime = 0; player.play().catch(() => {}); }
  else { player.pause(); player.currentTime = 0; }
}
$('#play').onclick = togglePlay;
$('#reveal').onclick = () => { if (current) sb.showInFolder(current.path); };

/* ---------- Waveforms (cached in the app's database) ---------- */
const canvas = $('#wave'), g = canvas.getContext('2d');
let peaks = null, actx = null;
const N_PEAKS = 1000;
let dbP = null;
function db() {
  if (!dbP) dbP = new Promise((res, rej) => {
    const q = indexedDB.open('soundbrowser', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('peaks');
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  return dbP;
}
async function dbGet(k) { try { const d = await db(); return await new Promise(res => { const q = d.transaction('peaks').objectStore('peaks').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch (e) { return undefined; } }
async function dbPut(k, v) { try { const d = await db(); d.transaction('peaks', 'readwrite').objectStore('peaks').put(v, k); } catch (e) {} }

async function loadPeaks(r, t, aiffBuf) {
  const key = r.path + '|' + r.size + '|' + r.mtime;
  const cached = await dbGet(key);
  if (t !== loadToken) return;
  if (cached) { peaks = cached; drawWave(); return; }
  if (r.size > 300e6) return;
  try {
    const buf = aiffBuf ? aiffBuf.slice(0) : await getBuffer(r);
    if (t !== loadToken) return;
    actx = actx || new AudioContext();
    const ab = await actx.decodeAudioData(buf);
    const len = ab.length, step = Math.max(1, Math.floor(len / N_PEAKS));
    const mn = new Int8Array(N_PEAKS), mx = new Int8Array(N_PEAKS);
    const chans = []; for (let c = 0; c < ab.numberOfChannels; c++) chans.push(ab.getChannelData(c));
    for (let i = 0; i < N_PEAKS; i++) {
      let lo = 0, hi = 0;
      const s = i * step, e = Math.min(len, s + step);
      for (const d of chans) for (let j = s; j < e; j++) { const v = d[j]; if (v < lo) lo = v; else if (v > hi) hi = v; }
      mn[i] = Math.max(-127, Math.round(lo * 127)); mx[i] = Math.min(127, Math.round(hi * 127));
    }
    const p = { mn, mx };
    dbPut(key, p);
    if (r.dur == null) { r.dur = ab.duration; render(); }
    if (t === loadToken) { peaks = p; drawWave(); }
  } catch (e) { /* no waveform for this file; playback may still work */ }
}
function sizeCanvas() {
  const dpr = devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
  drawWave();
}
function drawWave() {
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  const mid = H / 2;
  if (!peaks) { g.fillStyle = '#2a2d33'; g.fillRect(0, mid, W, 1); return; }
  const prog = player.duration ? player.currentTime / player.duration : 0;
  const N = peaks.mn.length, k = mid * 0.95 / 127;
  for (let x = 0; x < W; x++) {
    const i = Math.floor(x / W * N);
    const top = mid - peaks.mx[i] * k, bot = mid - peaks.mn[i] * k;
    g.fillStyle = x / W < prog ? '#e3a94b' : '#5a5f69';
    g.fillRect(x, top, 1, Math.max(1, bot - top));
  }
  if (prog > 0) { g.fillStyle = '#fff'; g.fillRect(Math.floor(prog * W), 0, Math.max(1, devicePixelRatio || 1), H); }
}
function tick() { drawWave(); if (!player.paused) requestAnimationFrame(tick); }
canvas.onclick = e => {
  if (!player.duration) return;
  const rect = canvas.getBoundingClientRect();
  player.currentTime = (e.clientX - rect.left) / rect.width * player.duration;
  if (player.paused) player.play().catch(() => {});
  drawWave();
};

/* ---------- Keyboard ---------- */
document.addEventListener('keydown', e => {
  const typing = e.target.tagName === 'INPUT' && (e.target.type === 'search' || e.target.type === 'text');
  const move = d => { if (!view.length) return; const n = sel < 0 ? 0 : Math.min(view.length - 1, Math.max(0, sel + d)); select(n, $('#autoplay').checked); };
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  else if (e.key === 'PageDown') { e.preventDefault(); move(Math.floor(listEl.clientHeight / ROW)); }
  else if (e.key === 'PageUp') { e.preventDefault(); move(-Math.floor(listEl.clientHeight / ROW)); }
  else if (e.key === 'Enter') { e.preventDefault(); if (sel < 0) move(0); else { player.currentTime = 0; player.play().catch(() => {}); } }
  else if (e.key === 'Escape' && typing) { e.target.value = ''; applyFilter(); saveSession(); e.target.blur(); }
  else if (typing) return;
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); player.currentTime = Math.min(player.duration || 0, player.currentTime + 2); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); player.currentTime = Math.max(0, player.currentTime - 2); }
  else if (e.key === 'f' || e.key === 'F') toggleFav(current);
  else if (e.key === 'e' || e.key === 'E') { if (current) sb.showInFolder(current.path); }
  else if (e.key === 'l' || e.key === 'L') { const l = $('#loop'); l.checked = !l.checked; player.loop = l.checked; saveSession(); }
  else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
});

/* ---------- Updates ---------- */
const upd = $('#upd'), updText = $('#upd-text'), updBtn = $('#upd-btn');
let updVersion = '';
sb.on('update', u => {
  if (u.version) updVersion = u.version;
  const chk = $('#chk');
  if (u.status === 'downloading') { upd.classList.add('show'); updBtn.style.display = 'none'; updText.textContent = `Downloading update ${updVersion}… ${u.percent || 0}%`; }
  else if (u.status === 'ready') { upd.classList.add('show'); updBtn.style.display = ''; updText.textContent = `Version ${updVersion} is ready.`; }
  else if (u.status === 'checking') chk.textContent = 'Checking…';
  else if (u.status === 'latest') chk.textContent = 'Up to date';
  else if (u.status === 'dev') chk.textContent = 'Dev mode';
  else if (u.status === 'error') { chk.textContent = 'Update check failed'; chk.title = u.message || ''; }
  if (['latest', 'error', 'dev'].includes(u.status)) setTimeout(() => { chk.textContent = 'Check for updates'; }, 6000);
});
updBtn.onclick = () => sb.installUpdate();
$('#chk').onclick = () => sb.checkUpdates();

/* ---------- Start ---------- */
(async function start() {
  sizeCanvas();
  const st = await sb.state();
  $('#ver').textContent = 'v' + st.version;
  folders = st.folders; favs = new Set(st.favorites);
  const s = st.session || {};
  if (s.search) $('#search').value = s.search;
  if (s.sortKey) { sortKey = s.sortKey; sortDir = s.sortDir || 1; }
  if (s.types) typeFilter = new Set(s.types);
  if (s.dirFilter) dirFilter = s.dirFilter;
  $('#favOnly').checked = !!s.favOnly;
  if (s.autoplay === false) $('#autoplay').checked = false;
  $('#loop').checked = !!s.loop;
  if (typeof s.vol === 'number') $('#vol').value = s.vol;
  player.volume = +$('#vol').value;
  if (!folders.length) { applyFilter(); return; }
  await scanAll();
  if (s.selPath) {
    const i = view.findIndex(r => r.path === s.selPath);
    if (i >= 0) { sel = i; current = view[i]; listEl.scrollTop = s.scroll || Math.max(0, i * ROW - 100); ensureVisible(i); render(); load(current, false); }
  }
})();
