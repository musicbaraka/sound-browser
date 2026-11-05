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
    vol: +$('#vol').value, tape: ed.tape, viewMode, selPath: current ? current.path : null, scroll: listEl.scrollTop
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
let actx = null, masterGain = null, bus = null, analyser = null;
// Everything that plays goes through one bus: bus -> analyser (spectrum) and bus -> volume -> speakers
function ac() {
  if (!actx) {
    actx = new AudioContext();
    bus = actx.createGain();
    masterGain = actx.createGain(); masterGain.gain.value = +$('#vol').value;
    analyser = actx.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0.72; analyser.minDecibels = -120; analyser.maxDecibels = 0;
    bus.connect(analyser); bus.connect(masterGain); masterGain.connect(actx.destination);
    actx.createMediaElementSource(player).connect(bus);
  }
  return actx;
}
$('#vol').oninput = e => { if (masterGain) masterGain.gain.value = +e.target.value; saveSession(); };
$('#loop').onchange = e => { player.loop = e.target.checked; if (eSrc) eSrc.loop = e.target.checked; saveSession(); };
let blobUrl = null, loadToken = 0;

async function getBuffer(r) {
  const res = await fetch(sb.fileUrl(r.path));
  if (!res.ok) throw new Error('Could not open this file. It may have been moved or deleted.');
  return res.arrayBuffer();
}

/* Editor state. Times are in seconds of the original sound. */
const ed = { buf: null, selA: 0, selB: 0, speed: 1, semis: 0, tape: false, gain: 0, fadeIn: 0, fadeOut: 0, reverse: false, normalize: false, nr: 0, noise: null, noiseId: 0,
  out: null, outBuf: null, outPeak: 0, path: null, name: '', rendering: false };
const zoom = { t0: 0, t1: 0 };
const hasSel = () => ed.selB - ed.selA > 0.001;
const paramsChanged = () => ed.nr > 0 || ed.speed !== 1 || ed.semis !== 0 || ed.gain !== 0 || ed.fadeIn > 0 || ed.fadeOut > 0 || ed.reverse || ed.normalize;
const isEdited = () => !!ed.buf && (hasSel() || paramsChanged());
const srcDur = () => ed.buf ? ed.buf.duration : (player.duration || 0);

function select(i, play) {
  if (i < 0 || i >= view.length) return;
  sel = i; current = view[i];
  ensureVisible(i); render();
  load(current, play);
  saveSession();
}
async function load(r, play) {
  const t = ++loadToken;
  stopAll();
  $('#np-name').textContent = r.name;
  $('#np-dir').textContent = r.rootName + '/' + r.dir;
  setStatus('');
  resetEdit(false);
  ed.out = ed.outBuf = ed.path = null;
  ed.buf = null; peaks = null; zoom.t0 = 0; zoom.t1 = r.dur || 0; waveCache = null;
  drawWave(); drawResult(); updateClip();
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  let aiffBuf = null;
  if (IS_AIFF(r.ext)) {
    try { aiffBuf = aiffToWav(await getBuffer(r)); }
    catch (err) { if (t === loadToken) setStatus(err.message); return; }
    if (t !== loadToken) return;
    blobUrl = URL.createObjectURL(new Blob([aiffBuf], { type: 'audio/wav' }));
    player.src = blobUrl;
  } else {
    player.src = sb.fileUrl(r.path);
  }
  player.loop = $('#loop').checked;
  if (play) { ac().resume(); player.play().catch(() => {}); }
  // quick overview from cache, then full decode for editing
  const key = r.path + '|' + r.size + '|' + r.mtime;
  const cached = await dbGet(key);
  if (t !== loadToken) return;
  if (cached) { peaks = cached; drawWave(); }
  if (r.size > 400e6) { setStatus('This file is too large to edit here.'); return; }
  try {
    const buf = aiffBuf ? aiffBuf.slice(0) : await getBuffer(r);
    if (t !== loadToken) return;
    const sr = (r.meta && r.meta.sr) || 48000;
    const ab = await new OfflineAudioContext(1, 1, sr).decodeAudioData(buf);
    if (t !== loadToken) return;
    ed.buf = ab;
    if (r.dur == null) { r.dur = ab.duration; render(); }
    zoom.t0 = 0; zoom.t1 = ab.duration; waveCache = null;
    if (!cached) { peaks = computeOverview(ab); dbPut(key, peaks); }
    drawWave();
    if (isEdited()) changed(false); else updateAvg();
  } catch (e) { /* not decodable here; playback may still work */ }
}
player.onerror = () => { if (current && player.src) setStatus('This file format cannot be played (' + current.ext.toUpperCase() + ').'); };
player.onplay = () => { ac().resume(); peakHold = null; updatePlayBtn(); tick(); };
player.onpause = player.onended = () => { updatePlayBtn(); drawWave(); };
player.onloadedmetadata = () => {
  if (current && current.dur == null && isFinite(player.duration)) { current.dur = player.duration; render(); }
  if (!zoom.t1 && isFinite(player.duration)) zoom.t1 = player.duration;
  updateTime();
};
player.ontimeupdate = updateTime;

/* Edit preview runs through Web Audio */
let eSrc = null, eStart = 0;
function playEdit() {
  if (!ed.outBuf) return;
  stopAll();
  const c = ac(); c.resume();
  const s = c.createBufferSource();
  s.buffer = ed.outBuf; s.loop = $('#loop').checked;
  s.connect(bus);
  s.onended = () => { if (eSrc === s) { eSrc = null; updatePlayBtn(); drawWave(); drawResult(); } };
  eSrc = s; eStart = c.currentTime;
  s.start();
  peakHold = null;
  updatePlayBtn(); tick();
}
function stopAll() {
  if (!player.paused) player.pause();
  if (eSrc) { const s = eSrc; eSrc = null; try { s.stop(); } catch (e) {} }
  updatePlayBtn();
}
const isPlaying = () => !player.paused || !!eSrc;
function editPos() { if (!eSrc || !ed.outBuf) return -1; const d = ed.outBuf.duration, t = actx.currentTime - eStart; return eSrc.loop ? t % d : Math.min(t, d); }
function updatePlayBtn() { $('#play').textContent = isPlaying() ? '■' : '▶'; }
function playFrom(t) {
  stopAll(); ac().resume();
  player.currentTime = Math.max(0, t || 0);
  player.play().catch(() => {});
}
function play() { if (isEdited() && ed.outBuf) playEdit(); else playFrom(0); }
function togglePlay() {
  if (!current) { if (view.length) select(Math.max(sel, 0), true); return; }
  if (isPlaying()) { stopAll(); player.currentTime = 0; drawWave(); drawResult(); }
  else play();
}
$('#play').onclick = togglePlay;
$('#reveal').onclick = () => { if (current) sb.showInFolder(current.path); };

function updateTime() {
  $('#learnNoise').disabled = !hasSel() || !ed.buf;
  let s = fmtClock(player.currentTime) + ' / ' + fmtClock(srcDur());
  if (hasSel()) s += ` · <b>Selection ${ed.selA.toFixed(3)}s to ${ed.selB.toFixed(3)}s (${(ed.selB - ed.selA).toFixed(3)}s)</b>`;
  $('#np-time').innerHTML = s;
}
function setStatus(msg, ok) { const el = $('#status'); el.textContent = msg; el.classList.toggle('ok', !!ok); }

/* ---------- FFT, spectrogram and spectrum analyzer ---------- */
let viewMode = 'wave', waveHover = null;
const scv = $('#spec'), sgx = scv.getContext('2d');
let peakHold = null, liveData = null, specHover = null;
const avg = { db: null, n: 0, sr: 48000, what: '' };
const F_MIN = 20;

function setViewMode(m, silent) {
  viewMode = m === 'spec' ? 'spec' : 'wave';
  document.querySelectorAll('#vmode button').forEach(b => b.classList.toggle('on', b.dataset.m === viewMode));
  waveCache = null; drawWave();
  if (!silent) saveSession();
}
$('#vmode').addEventListener('mousedown', e => e.stopPropagation());
$('#vmode').onclick = e => { const m = e.target.dataset && e.target.dataset.m; if (m) setViewMode(m); };

const fftCache = new Map();
function fftTables(N) {
  let t = fftCache.get(N); if (t) return t;
  const bits = Math.log2(N), rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2), win = new Float32Array(N);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / N); sin[i] = -Math.sin(2 * Math.PI * i / N); }
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  t = { rev, cos, sin, win, re: new Float64Array(N), im: new Float64Array(N) };
  fftCache.set(N, t); return t;
}
// Power spectrum of a frame (Hann window). A full-scale sine reads 0 dB.
function powerSpectrum(frame, N, out) {
  const { rev, cos, sin, win, re, im } = fftTables(N);
  for (let i = 0; i < N; i++) { re[rev[i]] = frame[i] * win[i]; im[rev[i]] = 0; }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half;
        const tr = re[b] * cos[k] - im[b] * sin[k], ti = re[b] * sin[k] + im[b] * cos[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  const norm = 4 / (N * N * 0.25);
  for (let i = 0; i < N / 2; i++) out[i] = (re[i] * re[i] + im[i] * im[i]) * norm;
}
const toDb = p => 10 * Math.log10(p + 1e-14);

// Color map: black, violet, magenta, orange, pale yellow
const CMAP = (() => {
  const stops = [[0, 11, 12, 16], [0.3, 52, 24, 92], [0.55, 150, 40, 110], [0.78, 232, 120, 56], [1, 255, 244, 176]];
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255; let k = 0; while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [a, ...ca] = stops[k], [b, ...cb] = stops[k + 1], f = (v - a) / (b - a);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(ca[c] + (cb[c] - ca[c]) * f);
  }
  return lut;
})();
function yToFreq(y, H, sr) { const fmax = sr / 2; return F_MIN * Math.pow(fmax / F_MIN, 1 - y / H); }

function renderSpectrogram(ab, t0, t1, W, H) {
  const N = 4096, sr = ab.sampleRate, cols = Math.min(W, 1100);
  const off = document.createElement('canvas'); off.width = cols; off.height = H;
  const c = off.getContext('2d'), img = c.createImageData(cols, H), px = img.data;
  const chans = []; for (let ch = 0; ch < ab.numberOfChannels; ch++) chans.push(ab.getChannelData(ch));
  const nch = chans.length, frame = new Float32Array(N), pw = new Float32Array(N / 2);
  const bins = new Float32Array(H);
  for (let y = 0; y < H; y++) bins[y] = yToFreq(y + 0.5, H, sr) / sr * N;
  for (let x = 0; x < cols; x++) {
    const t = t0 + (x + 0.5) / cols * (t1 - t0);
    const s = Math.round(t * sr) - N / 2;
    for (let i = 0; i < N; i++) { const j = s + i; let v = 0; if (j >= 0 && j < ab.length) for (let ch = 0; ch < nch; ch++) v += chans[ch][j]; frame[i] = v / nch; }
    powerSpectrum(frame, N, pw);
    for (let y = 0; y < H; y++) {
      const b = bins[y], i0 = Math.min(N / 2 - 2, Math.floor(b)), fr = b - i0;
      // above ~1 bin per pixel, take the strongest bin in this pixel's range so detail is not lost
      let p;
      const b2 = y > 0 ? bins[y - 1] : b;
      if (b2 - b > 1.5) { p = 0; for (let k = Math.floor(b); k <= Math.min(N / 2 - 1, Math.ceil(b2)); k++) if (pw[k] > p) p = pw[k]; }
      else p = pw[i0] * (1 - fr) + pw[i0 + 1] * fr;
      const v = Math.max(0, Math.min(255, Math.round((toDb(p) + 110) / 110 * 255)));
      const o = (y * cols + x) * 4;
      px[o] = CMAP[v * 3]; px[o + 1] = CMAP[v * 3 + 1]; px[o + 2] = CMAP[v * 3 + 2]; px[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  if (cols === W) return off;
  const full = document.createElement('canvas'); full.width = W; full.height = H;
  const fc = full.getContext('2d'); fc.imageSmoothingEnabled = true; fc.drawImage(off, 0, 0, W, H);
  return full;
}

// Average spectrum of the edit (or the selection, or the whole sound) for when nothing is playing
function updateAvg() {
  let chans = null, sr = 48000, what = '';
  if (ed.out && ed.outBuf) { chans = ed.out; sr = ed.outBuf.sampleRate; what = 'Average of your edit'; }
  else if (ed.buf) {
    sr = ed.buf.sampleRate;
    const a = hasSel() ? Math.floor(ed.selA * sr) : 0, b = hasSel() ? Math.ceil(ed.selB * sr) : ed.buf.length;
    chans = []; for (let c = 0; c < ed.buf.numberOfChannels; c++) chans.push(ed.buf.getChannelData(c).subarray(a, b));
    what = hasSel() ? 'Average of selection' : 'Average of whole sound';
  }
  if (!chans || !chans[0].length) { avg.db = null; drawSpectrum(); return; }
  const N = 4096, len = chans[0].length, nch = chans.length;
  const frames = Math.max(1, Math.min(300, Math.ceil(len / (N / 2))));
  const hop = len > N ? (len - N) / Math.max(1, frames - 1) : 0;
  const acc = new Float64Array(N / 2), pw = new Float32Array(N / 2), frame = new Float32Array(N);
  for (let f = 0; f < frames; f++) {
    const s = Math.round(f * hop);
    for (let i = 0; i < N; i++) { const j = s + i; let v = 0; if (j < len) for (let c = 0; c < nch; c++) v += chans[c][j]; frame[i] = v / nch; }
    powerSpectrum(frame, N, pw);
    for (let i = 0; i < N / 2; i++) acc[i] += pw[i];
  }
  const db = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) db[i] = toDb(acc[i] / frames);
  Object.assign(avg, { db, n: N, sr, what });
  drawSpectrum();
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteName(f) {
  if (!(f > 8)) return '';
  const m = 69 + 12 * Math.log2(f / 440), r = Math.round(m), cents = Math.round((m - r) * 100);
  return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1) + (cents ? (cents > 0 ? ' +' : ' ') + cents + 'c' : '');
}
const fmtFreq = f => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + ' kHz' : Math.round(f) + ' Hz';
function label(ctx, text, x, y, W) {
  const dpr = devicePixelRatio || 1;
  ctx.font = `${11 * dpr}px "Segoe UI", sans-serif`;
  const w = ctx.measureText(text).width + 8 * dpr;
  x = Math.min(x, W - w - 2 * dpr); y = Math.max(14 * dpr, y);
  ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(x, y - 12 * dpr, w, 16 * dpr);
  ctx.fillStyle = '#fff'; ctx.fillText(text, x + 4 * dpr, y);
}

const DB_TOP = 0, DB_BOT = -96;
const ANALYSER_OFFSET = 13.6; // Web Audio's analyser reads a full-scale sine near -13.6 dB; shift it to 0 dBFS
function drawSpectrum() {
  const W = scv.width, H = scv.height, dpr = devicePixelRatio || 1;
  if (!W) return;
  sgx.clearRect(0, 0, W, H);
  const live = !!(analyser && isPlaying());
  let data, n, sr, offset = 0;
  if (live) {
    if (!liveData || liveData.length !== analyser.frequencyBinCount) liveData = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(liveData);
    data = liveData; n = analyser.fftSize; sr = actx.sampleRate; offset = ANALYSER_OFFSET;
    if (!peakHold || peakHold.length !== data.length) peakHold = new Float32Array(data.length).fill(-200);
    for (let i = 0; i < data.length; i++) peakHold[i] = Math.max(peakHold[i] - 0.25, data[i]);
  } else if (avg.db) { data = avg.db; n = avg.n; sr = avg.sr; }
  const fmax = (sr || 48000) / 2;
  const xToF = x => F_MIN * Math.pow(fmax / F_MIN, x / W);
  const fToX = f => Math.log(f / F_MIN) / Math.log(fmax / F_MIN) * W;
  const dbToY = d => (DB_TOP - d) / (DB_TOP - DB_BOT) * H;
  // grid
  sgx.font = `${10 * dpr}px "Segoe UI", sans-serif`;
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    if (f > fmax) continue;
    const x = Math.round(fToX(f));
    sgx.fillStyle = '#1f2228'; sgx.fillRect(x, 0, dpr, H);
    sgx.fillStyle = '#4a4e56'; sgx.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x + 3 * dpr, H - 4 * dpr);
  }
  for (const d of [-24, -48, -72]) { const y = Math.round(dbToY(d)); sgx.fillStyle = '#1f2228'; sgx.fillRect(0, y, W, dpr); sgx.fillStyle = '#4a4e56'; sgx.fillText(d + '', W - 22 * dpr, y - 2 * dpr); }
  $('#speclabel').textContent = live ? 'Live spectrum' : (avg.db ? avg.what : 'Spectrum');
  if (!data) return;
  // one value per pixel column: the loudest bin that falls in it
  const col = arr => {
    const ys = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const b0 = xToF(x) / sr * n, b1 = xToF(x + 1) / sr * n;
      let v;
      if (b1 - b0 < 1) { const i = Math.min(arr.length - 2, Math.floor(b0)), fr = b0 - i; v = arr[i] * (1 - fr) + arr[i + 1] * fr; }
      else { v = -Infinity; for (let i = Math.floor(b0); i < Math.min(arr.length, Math.ceil(b1)); i++) if (arr[i] > v) v = arr[i]; }
      ys[x] = dbToY(Math.max(DB_BOT - 10, v + offset));
    }
    return ys;
  };
  const ys = col(data);
  const grad = sgx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, live ? 'rgba(227,169,75,0.55)' : 'rgba(227,169,75,0.32)'); grad.addColorStop(1, 'rgba(227,169,75,0.02)');
  sgx.beginPath(); sgx.moveTo(0, H);
  for (let x = 0; x < W; x++) sgx.lineTo(x, ys[x]);
  sgx.lineTo(W, H); sgx.closePath(); sgx.fillStyle = grad; sgx.fill();
  sgx.beginPath(); for (let x = 0; x < W; x++) x ? sgx.lineTo(x, ys[x]) : sgx.moveTo(x, ys[x]);
  sgx.strokeStyle = live ? '#e3a94b' : '#b58a45'; sgx.lineWidth = dpr; sgx.stroke();
  if (live && peakHold) {
    const ps = col(peakHold);
    sgx.beginPath(); for (let x = 0; x < W; x++) x ? sgx.lineTo(x, ps[x]) : sgx.moveTo(x, ps[x]);
    sgx.strokeStyle = 'rgba(255,255,255,0.35)'; sgx.stroke();
  }
  if (specHover) {
    const x = specHover.x, f = xToF(x);
    const b = Math.min(data.length - 1, Math.round(f / sr * n));
    sgx.fillStyle = 'rgba(255,255,255,0.4)'; sgx.fillRect(Math.floor(x), 0, dpr, H);
    label(sgx, `${fmtFreq(f)}  ${noteName(f)}  ${(data[b] + offset).toFixed(0)} dB`, x + 8 * dpr, 16 * dpr, W);
  }
}
scv.addEventListener('mousemove', e => { const r = scv.getBoundingClientRect(); specHover = { x: (e.clientX - r.left) * scv.width / r.width }; if (!isPlaying()) drawSpectrum(); });
scv.addEventListener('mouseleave', () => { specHover = null; if (!isPlaying()) drawSpectrum(); });

/* ---------- Edit controls ---------- */
const speedR = $('#speedR'), speedN = $('#speedN'), pitchR = $('#pitchR'), pitchN = $('#pitchN'), gainR = $('#gainR'), gainN = $('#gainN');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function syncControls() {
  speedR.value = Math.log2(ed.speed); speedN.value = +ed.speed.toFixed(2);
  pitchR.value = Math.round(ed.semis); pitchN.value = +ed.semis.toFixed(1);
  gainR.value = clamp(ed.gain, -24, 24); gainN.value = ed.gain;
  $('#tape').checked = ed.tape; $('#reverse').checked = ed.reverse; $('#normalize').checked = ed.normalize;
  $('#fadeIn').value = ed.fadeIn; $('#fadeOut').value = ed.fadeOut;
  $('#pitchCtl').classList.toggle('off', ed.tape);
  $('#nrR').value = ed.nr; $('#nrN').value = ed.nr;
  $('#nrProf').textContent = ed.noise ? 'learned profile' : 'auto';
  $('#learnNoise').disabled = !hasSel() || !ed.buf;
}
function setSpeed(v) { ed.speed = clamp(+v || 1, 0.25, 4); if (ed.tape) ed.semis = 12 * Math.log2(ed.speed); changed(); }
function setPitch(v) { ed.semis = clamp(+v || 0, -24, 24); if (ed.tape) ed.speed = clamp(Math.pow(2, ed.semis / 12), 0.25, 4); changed(); }
speedR.oninput = () => setSpeed(Math.pow(2, +speedR.value));
speedN.onchange = () => setSpeed(speedN.value);
pitchR.oninput = () => setPitch(pitchR.value);
pitchN.onchange = () => setPitch(pitchN.value);
gainR.oninput = () => { ed.gain = +gainR.value; changed(); };
gainN.onchange = () => { ed.gain = clamp(+gainN.value || 0, -60, 24); changed(); };
$('#tape').onchange = e => { ed.tape = e.target.checked; if (ed.tape) ed.semis = 12 * Math.log2(ed.speed); changed(); };
$('#reverse').onchange = e => { ed.reverse = e.target.checked; changed(); };
$('#normalize').onchange = e => { ed.normalize = e.target.checked; changed(); };
$('#fadeIn').onchange = e => { ed.fadeIn = Math.max(0, +e.target.value || 0); changed(); };
$('#fadeOut').onchange = e => { ed.fadeOut = Math.max(0, +e.target.value || 0); changed(); };
speedR.ondblclick = () => setSpeed(1);
pitchR.ondblclick = () => setPitch(0);
gainR.ondblclick = () => { ed.gain = 0; changed(); };
$('#nrR').oninput = () => { ed.nr = +$('#nrR').value; changed(); };
$('#nrN').onchange = () => { ed.nr = clamp(Math.round(+$('#nrN').value || 0), 0, 100); changed(); };
$('#nrR').ondblclick = () => { ed.nr = 0; changed(); };
$('#learnNoise').onclick = async () => {
  if (!hasSel() || !ed.buf) return;
  const sr = ed.buf.sampleRate, a = Math.floor(ed.selA * sr), b = Math.ceil(ed.selB * sr);
  const chans = []; for (let c = 0; c < ed.buf.numberOfChannels; c++) chans.push(ed.buf.getChannelData(c).slice(a, b));
  const len = (ed.selB - ed.selA).toFixed(2);
  try {
    ed.noise = await workerCall({ cmd: 'profile', channels: chans });
    ed.noiseId++;
    ed.selA = ed.selB = 0;
    if (!ed.nr) ed.nr = 60;
    setStatus(`Noise learned from ${len}s. Adjust Clean to taste, or select the part to keep.`, true);
    changed();
  } catch (e) { setStatus('Could not learn the noise: ' + e.message); }
};
$('#resetEdit').onclick = () => { resetEdit(true); };
function resetEdit(rerender) {
  Object.assign(ed, { selA: 0, selB: 0, speed: 1, semis: 0, tape: ed.tape, gain: 0, fadeIn: 0, fadeOut: 0, reverse: false, normalize: false, nr: 0, noise: null });
  if (ed.tape) ed.semis = 0;
  syncControls();
  if (rerender) changed();
}
let renderTimer = null;
function changed(autoPlay = true) {
  syncControls(); updateTime(); drawWave();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderEdit(autoPlay), 180);
}

/* ---------- Rendering the edit ---------- */
let worker = null, jobId = 0;
const pending = new Map();
function getWorker() {
  if (!worker) {
    worker = new Worker('edit-worker.js', { type: 'module' });
    worker.onmessage = e => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.channels || e.data.profile); } };
  }
  return worker;
}
function workerCall(msg) { return processInWorker(msg); }
function processInWorker(msg) {
  const id = ++jobId;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); getWorker().postMessage({ id, ...msg }, msg.channels.map(c => c.buffer)); });
}
async function renderEdit(autoPlay) {
  const t = loadToken, r = current;
  if (!r || !ed.buf) { ed.out = ed.outBuf = ed.path = null; updateClip(); drawResult(); return; }
  if (!isEdited()) { ed.out = ed.outBuf = ed.path = null; updateClip(); drawResult(); updateAvg(); return; }
  const sr = ed.buf.sampleRate;
  const a = hasSel() ? Math.floor(ed.selA * sr) : 0;
  const b = hasSel() ? Math.ceil(ed.selB * sr) : ed.buf.length;
  const channels = [];
  for (let c = 0; c < ed.buf.numberOfChannels; c++) channels.push(ed.buf.getChannelData(c).slice(a, b));
  const settings = { speed: ed.speed, semis: ed.tape ? 0 : ed.semis, tape: ed.tape, reverse: ed.reverse, nrDb: ed.nr * 0.3, noiseId: ed.noise ? ed.noiseId : 0 };
  const sigOf = () => JSON.stringify([current && current.path, hasSel() ? Math.floor(ed.selA * sr) : 0, hasSel() ? Math.ceil(ed.selB * sr) : ed.buf.length, ed.speed, ed.tape ? 0 : ed.semis, ed.tape, ed.reverse, ed.nr, ed.noise ? ed.noiseId : 0, ed.gain, ed.fadeIn, ed.fadeOut, ed.normalize]);
  const sig = sigOf();
  ed.rendering = true; updateClip();
  let out;
  try { out = await processInWorker({ channels, sampleRate: sr, ...settings, profile: ed.noise }); }
  catch (e) { ed.rendering = false; setStatus('Processing failed: ' + e.message); updateClip(); return; }
  if (t !== loadToken || !ed.buf || sig !== sigOf()) return;
  // volume, normalize, fades
  const len = out[0].length;
  let peak = 0;
  for (const ch of out) for (let i = 0; i < len; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
  let g = Math.pow(10, ed.gain / 20);
  if (ed.normalize && peak > 0) g *= Math.pow(10, -0.3 / 20) / peak;
  const minFade = hasSel() ? Math.round(0.002 * sr) : 0; // tiny fades avoid clicks at cut points
  const fi = Math.min(len, Math.max(minFade, Math.round(ed.fadeIn / 1000 * sr)));
  const fo = Math.min(len, Math.max(minFade, Math.round(ed.fadeOut / 1000 * sr)));
  for (const ch of out) {
    for (let i = 0; i < len; i++) {
      let v = ch[i] * g;
      if (i < fi) v *= i / fi;
      if (i >= len - fo) v *= (len - 1 - i) / fo;
      ch[i] = v;
    }
  }
  ed.outPeak = peak * g;
  ed.out = out;
  const ob = ac().createBuffer(out.length, len, sr);
  out.forEach((ch, c) => ob.copyToChannel(ch, c));
  ed.outBuf = ob;
  ed.name = editName(r);
  ed.path = null;
  ed.rendering = false;
  rwaveCache = null;
  updateClip(); drawResult(); updateAvg();
  if (autoPlay && $('#autoplay').checked) playEdit();
  // write the WAV so it is ready to drag
  try {
    const p = await sb.writeEdit(ed.name, encodeWav(out, sr, ed.buf.numberOfChannels));
    if (ed.outBuf === ob) { ed.path = p; updateClip(); }
  } catch (e) { setStatus('Could not prepare the file: ' + e.message); }
}
function editName(r) {
  const base = r.name.replace(/\.[^.]+$/, '');
  const parts = [];
  if (ed.speed !== 1) parts.push(+ed.speed.toFixed(2) + 'x');
  if (Math.abs(ed.semis) > 0.04 && !ed.tape) parts.push((ed.semis > 0 ? '+' : '') + +ed.semis.toFixed(1) + 'st');
  if (ed.tape && ed.speed !== 1) parts.push('tape');
  if (ed.reverse) parts.push('rev');
  if (ed.nr > 0) parts.push('clean');
  if (ed.gain) parts.push((ed.gain > 0 ? '+' : '') + ed.gain + 'dB');
  if (!parts.length) parts.push(hasSel() ? 'cut' : 'edit');
  return `${base} [${parts.join(' ')}].wav`;
}
function encodeWav(chs, sr, nch) {
  const len = chs[0].length, bps = 3, block = nch * bps, data = len * block;
  const ab = new ArrayBuffer(44 + data), v = new DataView(ab);
  const w = (o, s) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + data, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * block, true); v.setUint16(32, block, true); v.setUint16(34, 24, true);
  w(36, 'data'); v.setUint32(40, data, true);
  const u8 = new Uint8Array(ab);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nch; c++) {
    let s = Math.round(Math.max(-1, Math.min(1, chs[c][i])) * 8388607);
    if (s < 0) s += 16777216;
    u8[o++] = s & 255; u8[o++] = (s >> 8) & 255; u8[o++] = (s >> 16) & 255;
  }
  return ab;
}
function updateClip() {
  const clip = $('#clip'), ready = !!ed.outBuf;
  clip.classList.toggle('empty', !ready);
  $('#saveEdit').disabled = !ed.path;
  if (ed.rendering) { $('#clip-name').textContent = 'Processing…'; return; }
  if (!ready) {
    $('#clip-name').textContent = current ? 'Select a part or change a setting' : 'Nothing selected';
    $('#clip-sub').textContent = 'Then drag your edit into any folder';
    return;
  }
  $('#clip-name').textContent = ed.name;
  const clipWarn = ed.outPeak > 1 ? ' · clipping, lower the volume' : '';
  $('#clip-sub').textContent = `${fmtDur(ed.outBuf.duration)} · ${ed.outBuf.sampleRate / 1000}k 24-bit WAV${clipWarn}${ed.path ? ' · drag me into any folder' : ''}`;
}
$('#clip').addEventListener('dragstart', e => { e.preventDefault(); if (ed.path) sb.startDrag(ed.path); });
$('#clip').addEventListener('click', () => { if (ed.outBuf) { if (eSrc) stopAll(); else playEdit(); } });
$('#saveEdit').onclick = async () => {
  if (!ed.path || !current) return;
  const dest = await sb.saveEdit(ed.path, current.path);
  if (dest) setStatus('Saved as ' + baseName(dest), true); else setStatus('Could not save next to the original.');
};

/* ---------- Waveform: overview cache, zoom, selection ---------- */
const canvas = $('#wave'), g = canvas.getContext('2d');
const rcanvas = $('#rwave'), rg = rcanvas.getContext('2d');
let peaks = null, waveCache = null, rwaveCache = null, lastWheel = 0, specTimer = null;
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
function computeOverview(ab) {
  const len = ab.length, step = Math.max(1, Math.floor(len / N_PEAKS));
  const mn = new Int8Array(N_PEAKS), mx = new Int8Array(N_PEAKS);
  const chans = []; for (let c = 0; c < ab.numberOfChannels; c++) chans.push(ab.getChannelData(c));
  for (let i = 0; i < N_PEAKS; i++) {
    let lo = 0, hi = 0;
    const s = i * step, e = Math.min(len, s + step);
    for (const d of chans) for (let j = s; j < e; j++) { const v = d[j]; if (v < lo) lo = v; else if (v > hi) hi = v; }
    mn[i] = Math.max(-127, Math.round(lo * 127)); mx[i] = Math.min(127, Math.round(hi * 127));
  }
  return { mn, mx };
}
function sizeCanvas() {
  const dpr = devicePixelRatio || 1;
  scv.width = scv.clientWidth * dpr; scv.height = scv.clientHeight * dpr;
  canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
  rcanvas.width = rcanvas.clientWidth * dpr; rcanvas.height = rcanvas.clientHeight * dpr;
  waveCache = rwaveCache = null;
  drawWave(); drawResult(); drawSpectrum();
}
// Draw channel data of buffer between t0 and t1 into an offscreen canvas
function renderBufferWave(ab, t0, t1, W, H, color) {
  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const c = off.getContext('2d');
  const sr = ab.sampleRate, nch = ab.numberOfChannels, laneH = H / nch;
  const s0 = t0 * sr, spp = (t1 - t0) * sr / W;
  c.fillStyle = color; c.strokeStyle = color;
  for (let ch = 0; ch < nch; ch++) {
    const d = ab.getChannelData(ch), mid = laneH * ch + laneH / 2, k = laneH / 2 * 0.92;
    c.fillStyle = '#202329'; c.fillRect(0, Math.round(mid), W, 1); c.fillStyle = color;
    if (spp <= 2) { // zoomed in to sample level: draw the actual wave line
      c.beginPath();
      for (let x = 0; x < W; x++) { const i = Math.floor(s0 + x * spp); const v = i >= 0 && i < d.length ? d[i] : 0; x ? c.lineTo(x, mid - v * k) : c.moveTo(x, mid - v * k); }
      c.lineWidth = Math.max(1, (devicePixelRatio || 1)); c.stroke();
    } else {
      const stride = Math.max(1, Math.floor(spp / 400));
      for (let x = 0; x < W; x++) {
        const a = Math.max(0, Math.floor(s0 + x * spp)), b = Math.min(d.length, Math.floor(s0 + (x + 1) * spp));
        let lo = 0, hi = 0;
        for (let i = a; i < b; i += stride) { const v = d[i]; if (v < lo) lo = v; else if (v > hi) hi = v; }
        c.fillRect(x, mid - hi * k, 1, Math.max(1, (hi - lo) * k));
      }
    }
  }
  return off;
}
function tToX(t) { return (t - zoom.t0) / (zoom.t1 - zoom.t0) * canvas.width; }
function xToT(x) { return zoom.t0 + x / canvas.width * (zoom.t1 - zoom.t0); }
function drawWave() {
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  if (ed.buf) {
    const key = zoom.t0 + '|' + zoom.t1 + '|' + W + '|' + H;
    const k2 = key + '|' + viewMode;
    if (viewMode === 'spec' && waveCache && waveCache.key !== k2 && waveCache.mode === 'spec' && performance.now() - lastWheel < 250) {
      // while zooming, stretch the last spectrogram and redraw it sharp when the wheel stops
      const span = zoom.t1 - zoom.t0, x = (waveCache.t0 - zoom.t0) / span * W, w = (waveCache.t1 - waveCache.t0) / span * W;
      g.drawImage(waveCache.img, x, 0, w, H);
      clearTimeout(specTimer); specTimer = setTimeout(drawWave, 260);
    } else {
      if (!waveCache || waveCache.key !== k2) waveCache = { key: k2, mode: viewMode, t0: zoom.t0, t1: zoom.t1, img: viewMode === 'spec' ? renderSpectrogram(ed.buf, zoom.t0, zoom.t1, W, H) : renderBufferWave(ed.buf, zoom.t0, zoom.t1, W, H, '#6b707a') };
      g.drawImage(waveCache.img, 0, 0);
    }
  } else if (peaks) {
    const mid = H / 2, N = peaks.mn.length, k = mid * 0.92 / 127;
    g.fillStyle = '#6b707a';
    for (let x = 0; x < W; x++) { const i = Math.floor(x / W * N); g.fillRect(x, mid - peaks.mx[i] * k, 1, Math.max(1, (peaks.mx[i] - peaks.mn[i]) * k)); }
  } else { g.fillStyle = '#2a2d33'; g.fillRect(0, H / 2, W, 1); return; }
  const dpr = devicePixelRatio || 1;
  if (hasSel()) {
    const a = tToX(ed.selA), b = tToX(ed.selB);
    g.fillStyle = 'rgba(227,169,75,0.18)'; g.fillRect(a, 0, b - a, H);
    g.fillStyle = '#e3a94b'; g.fillRect(a, 0, dpr, H); g.fillRect(b - dpr, 0, dpr, H);
  }
  // playhead
  let ph = -1;
  if (!player.paused || player.currentTime > 0) ph = player.currentTime;
  const ep = editPos();
  if (ep >= 0) { const a = hasSel() ? ed.selA : 0, b = hasSel() ? ed.selB : srcDur(); ph = ed.reverse ? b - ep * ed.speed : a + ep * ed.speed; }
  if (ph >= 0 && ph >= zoom.t0 && ph <= zoom.t1) { g.fillStyle = '#fff'; g.fillRect(Math.floor(tToX(ph)), 0, dpr, H); }
  // frequency readout under the mouse in spectrogram view
  if (viewMode === 'spec' && ed.buf && waveHover) {
    const f = yToFreq(waveHover.y, H, ed.buf.sampleRate);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, Math.floor(waveHover.y), W, dpr);
    label(g, fmtFreq(f) + '  ' + noteName(f), waveHover.x + 10 * dpr, waveHover.y - 6 * dpr, W);
  }
  // zoom indicator
  const d = srcDur();
  if (d && (zoom.t0 > 0 || zoom.t1 < d)) {
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0, H - 3 * dpr, W, 3 * dpr);
    g.fillStyle = '#e3a94b'; g.fillRect(zoom.t0 / d * W, H - 3 * dpr, Math.max(2, (zoom.t1 - zoom.t0) / d * W), 3 * dpr);
  }
}
function drawResult() {
  const W = rcanvas.width, H = rcanvas.height;
  rg.clearRect(0, 0, W, H);
  if (!ed.outBuf) { rg.fillStyle = '#2a2d33'; rg.fillRect(0, H / 2, W, 1); return; }
  if (!rwaveCache) rwaveCache = renderBufferWave(ed.outBuf, 0, ed.outBuf.duration, W, H, '#e3a94b');
  rg.drawImage(rwaveCache, 0, 0);
  const ep = editPos();
  if (ep >= 0) { rg.fillStyle = '#fff'; rg.fillRect(Math.floor(ep / ed.outBuf.duration * W), 0, devicePixelRatio || 1, H); }
}
function tick() { drawWave(); drawResult(); drawSpectrum(); if (isPlaying()) requestAnimationFrame(tick); else { updatePlayBtn(); drawSpectrum(); } }

// Mouse: drag to select (or move a selection edge), click to play from a point, wheel to zoom
let drag = null;
canvas.addEventListener('mousedown', e => {
  if (!srcDur() || e.button !== 0) return;
  const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width;
  const x = (e.clientX - rect.left) * sx, t = xToT(x);
  const near = 6 * sx;
  if (hasSel() && Math.abs(x - tToX(ed.selA)) < near) drag = { mode: 'a', x0: x };
  else if (hasSel() && Math.abs(x - tToX(ed.selB)) < near) drag = { mode: 'b', x0: x };
  else drag = { mode: 'new', x0: x, t0: t };
  e.preventDefault();
});
addEventListener('mousemove', e => {
  if (!drag) {
    if (e.target === canvas && hasSel()) {
      const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width, x = (e.clientX - rect.left) * sx;
      canvas.style.cursor = Math.abs(x - tToX(ed.selA)) < 6 * sx || Math.abs(x - tToX(ed.selB)) < 6 * sx ? 'ew-resize' : 'text';
    }
    return;
  }
  const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width;
  const x = clamp((e.clientX - rect.left) * sx, 0, canvas.width), t = clamp(xToT(x), 0, srcDur());
  if (drag.mode === 'new') { if (Math.abs(x - drag.x0) < 3 * sx) return; ed.selA = Math.min(drag.t0, t); ed.selB = Math.max(drag.t0, t); }
  else if (drag.mode === 'a') { ed.selA = Math.min(t, ed.selB - 0.001); }
  else { ed.selB = Math.max(t, ed.selA + 0.001); }
  if (ed.selA > ed.selB) [ed.selA, ed.selB] = [ed.selB, ed.selA];
  drag.moved = true;
  updateTime(); drawWave();
});
addEventListener('mouseup', e => {
  if (!drag) return;
  const d = drag; drag = null;
  if (!d.moved && d.mode === 'new') {
    // a click: clear the selection and play the original from here
    if (hasSel()) { ed.selA = ed.selB = 0; changed(false); }
    playFrom(d.t0);
    return;
  }
  if (d.moved) changed(true);
});
canvas.addEventListener('mousemove', e => { const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width; waveHover = { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sx }; if (viewMode === 'spec' && !isPlaying()) drawWave(); });
canvas.addEventListener('mouseleave', () => { waveHover = null; if (!isPlaying()) drawWave(); });
canvas.addEventListener('dblclick', () => { const d = srcDur(); if (!d) return; zoom.t0 = 0; zoom.t1 = d; drawWave(); });
canvas.addEventListener('wheel', e => {
  const d = srcDur(); if (!d || !ed.buf) return;
  e.preventDefault();
  lastWheel = performance.now();
  const rect = canvas.getBoundingClientRect(), f = (e.clientX - rect.left) / rect.width;
  let span = zoom.t1 - zoom.t0;
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    const dt = (e.shiftKey ? e.deltaY : e.deltaX) / rect.width * span;
    let t0 = clamp(zoom.t0 + dt, 0, d - span); zoom.t0 = t0; zoom.t1 = t0 + span;
  } else {
    const at = zoom.t0 + f * span;
    const minSpan = Math.max(64 / ed.buf.sampleRate, 0.002);
    span = clamp(span * Math.pow(1.0015, e.deltaY), minSpan, d);
    let t0 = clamp(at - f * span, 0, d - span); zoom.t0 = t0; zoom.t1 = t0 + span;
  }
  drawWave();
}, { passive: false });

/* ---------- Keyboard ---------- */
document.addEventListener('keydown', e => {
  const typing = e.target.tagName === 'INPUT' && ['search', 'text', 'number'].includes(e.target.type);
  if (e.target.tagName === 'INPUT' && e.target.type === 'range' && e.key.startsWith('Arrow')) return;
  const move = d => { if (!view.length) return; const n = sel < 0 ? 0 : Math.min(view.length - 1, Math.max(0, sel + d)); select(n, $('#autoplay').checked); };
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  else if (e.key === 'PageDown') { e.preventDefault(); move(Math.floor(listEl.clientHeight / ROW)); }
  else if (e.key === 'PageUp') { e.preventDefault(); move(-Math.floor(listEl.clientHeight / ROW)); }
  else if (e.key === 'Enter' && e.target.type === 'number') { e.target.blur(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (sel < 0) move(0); else play(); }
  else if (e.key === 'Escape' && typing) { if (e.target.id === 'search') { e.target.value = ''; applyFilter(); saveSession(); } e.target.blur(); }
  else if (typing) return;
  else if (e.key === 'Escape') { if (hasSel()) { ed.selA = ed.selB = 0; changed(false); } }
  else if (e.key === ' ') { e.preventDefault(); if (e.target.blur) e.target.blur(); togglePlay(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); player.currentTime = Math.min(player.duration || 0, player.currentTime + 2); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); player.currentTime = Math.max(0, player.currentTime - 2); }
  else if (e.key === 'r' || e.key === 'R') { ed.reverse = !ed.reverse; changed(); }
  else if (e.key === 's' || e.key === 'S') setViewMode(viewMode === 'wave' ? 'spec' : 'wave');
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
  if (s.tape) { ed.tape = true; syncControls(); }
  if (s.viewMode) setViewMode(s.viewMode, true);
  ac();
  player.volume = +$('#vol').value;
  if (!folders.length) { applyFilter(); return; }
  await scanAll();
  if (s.selPath) {
    const i = view.findIndex(r => r.path === s.selPath);
    if (i >= 0) { sel = i; current = view[i]; listEl.scrollTop = s.scroll || Math.max(0, i * ROW - 100); ensureVisible(i); render(); load(current, false); }
  }
})();
