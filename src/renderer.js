'use strict';
/* global sb, aiffToWav */
const $ = s => document.querySelector(s);
const ROW = 28;
const IS_AIFF = e => e === 'aif' || e === 'aiff' || e === 'aifc';

let folders = [], missing = new Set(), byRoot = new Map();
let files = [], view = [], sel = -1, current = null;
let sortKey = 'name', sortDir = 1, typeFilter = new Set(), dirFilter = '';
let favs = new Set();
let tagsMap = {}, tagFilter = '', keyFilter = '', exactSearch = false;
const vocab = new Vocabulary();

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
    sideW, waveH, specW, colW, expanded: [...expanded].slice(0, 400), keyFilter, tagFilter, bpmMin: $('#bpmMin').value, bpmMax: $('#bpmMax').value,
    vol: +$('#vol').value, tape: ed.tape, viewMode, selPath: current ? current.path : null, scroll: listEl.scrollTop
  }), 500);
}

/* ---------- Library loading ---------- */
function makeRecords(root, list) {
  const rootName = baseName(root);
  return list.map(f => {
    const dir = f.rel ? f.rel + '/' : '';
    const fromName = parseFileName(f.name);
    const r = {
      path: f.path, name: f.name, ext: f.ext, size: f.size, mtime: f.mtime, root, dir, rootName,
      dkey: root + '|' + dir, meta: f.meta, dur: f.meta ? f.meta.dur : undefined,
      base: rootName + '/' + dir + f.name, nk: fromName.key, nb: fromName.bpm,
      sn: natKey(f.name), sd: natKey(rootName + '/' + dir)
    };
    refreshRecord(r);
    return r;
  });
}
// Key and BPM: embedded tags first, then the file name, then what the analysis detected
function refreshRecord(r) {
  r.tags = tagsMap[r.path] || [];
  const m = r.meta || {}, an = m.an || {};
  const tk = parseKeyText(m.key), tb = m.bpm >= 40 && m.bpm <= 300 ? Math.round(m.bpm) : null;
  r.key = tk || r.nk || an.key || null; r.keyGuess = !tk && !r.nk && !!an.key;
  r.bpm = tb || r.nb || an.bpm || null; r.bpmGuess = !tb && !r.nb && !!an.bpm;
  r.hay = (r.base + ' ' + r.tags.join(' ') + (r.key ? ' ' + r.key + ' ' + r.key.replace(' min', ' minor').replace(' maj', ' major') : '') + (r.bpm ? ' ' + r.bpm + 'bpm' : '')).toLowerCase();
}
// Natural sort key: "Kick 2" comes before "Kick 10"
const natKey = t => t.toLowerCase().replace(/\d+/g, d => d.padStart(10, '0'));

/* A scan streams its files in batches. A folder with nothing shown yet fills in live;
   a folder already shown from the cache is checked quietly and swapped in when done. */
const scanState = new Map();
async function scanRoot(root) {
  const live = !(byRoot.get(root) || []).length;
  const st = { live, staged: [], n: 0, received: 0 };
  scanState.set(root, st);
  updateScanStatus();
  let r;
  try { r = await sb.scan(root); } catch (e) { r = { root, count: 0, failed: true }; }
  // "scan finished" can arrive before the last batches of files: wait until every file is in
  for (let t = 0; !r.missing && !r.failed && st.received < r.count && t < 600; t++) await new Promise(res => setTimeout(res, 50));
  if (!r.missing && !r.failed && st.received < r.count) { scanState.delete(root); updateScanStatus(); return; } // incomplete: keep what is shown
  scanState.delete(root);
  if (r.missing) { missing.add(root); }
  else {
    missing.delete(root);
    if (!live) byRoot.set(root, st.staged);
  }
  mergeAll(true);
  updateScanStatus();
}
sb.on('scan-batch', ({ root, n, files: list }) => {
  const st = scanState.get(root); if (!st) return;
  st.n = Math.max(st.n, n);
  st.received += list.length;
  const recs = makeRecords(root, list);
  if (st.live) {
    let cur = byRoot.get(root); if (!cur) { cur = []; byRoot.set(root, cur); }
    for (const r of recs) cur.push(r);
    scheduleMerge();
  } else for (const r of recs) st.staged.push(r);
  updateScanStatus();
});
function updateScanStatus() {
  const parts = [...scanState.entries()].map(([root, st]) => `${st.live ? 'Scanning' : 'Checking'} ${baseName(root)}… ${st.n.toLocaleString()}`);
  const el = $('#scanstat');
  el.textContent = parts.join(' · ');
  el.style.display = parts.length ? '' : 'none';
}
// Only the files that changed on disk are updated
sb.on('files-changed', ({ root, upsert, remove, removeDirs }) => {
  const list = byRoot.get(root); if (!list) return;
  const rm = new Set(remove), pres = removeDirs.flatMap(d => [d + '\\', d + '/']);
  const up = new Map(makeRecords(root, upsert).map(r => [r.path, r]));
  const next = [];
  for (const r of list) {
    if (rm.has(r.path) || (pres.length && pres.some(p => r.path.startsWith(p)))) continue;
    const u = up.get(r.path);
    if (u) { next.push(u); up.delete(r.path); } else next.push(r);
  }
  for (const r of up.values()) next.push(r);
  byRoot.set(root, next);
  scheduleMerge();
});
sb.on('folder-changed', root => { if (folders.includes(root) && !scanState.has(root)) scanRoot(root); });

let mergeTimer = null, lastMerge = 0;
function scheduleMerge() {
  if (mergeTimer) return;
  const wait = Math.max(150, (scanState.size ? 1500 : 300) - (Date.now() - lastMerge));
  mergeTimer = setTimeout(() => { mergeTimer = null; mergeAll(false); }, wait);
}
function mergeAll(final) {
  clearTimeout(mergeTimer); mergeTimer = null; lastMerge = Date.now();
  let all = [];
  for (const f of folders) { const list = byRoot.get(f); if (list) all = all.concat(list); }
  all.sort((a, b) => a.sn < b.sn ? -1 : a.sn > b.sn ? 1 : a.path < b.path ? -1 : 1);
  files = all;
  if (current) {
    const p = current.path;
    current = null;
    for (const r of files) if (r.path === p) { current = r; break; }
  }
  rebuild();
}
async function scanAll() {
  for (const f of folders) if (!scanState.has(f)) await scanRoot(f);
}
async function addFolders(newList) {
  const added = newList.filter(f => !folders.includes(f));
  folders = newList;
  for (const f of added) { expanded.add(f + '|'); }
  if (added.length) { dirFilter = added[0] + '|'; saveSession(); }
  for (const f of added) await scanRoot(f);
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
let vocabDirty = true, vocabTimer = null;
function rebuild() {
  buildChips(); buildSide(); buildTagList(); vocabDirty = true; applyFilter(false); queueAnalysis();
  // prepare the spelling word list quietly once loading settles
  clearTimeout(vocabTimer);
  vocabTimer = setTimeout(() => { if (vocabDirty && !scanState.size) { vocab.build(files.map(r => r.hay)); vocabDirty = false; } }, 3000);
}

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

// Folder tree: counts for every folder, but only the open branches are drawn
const expanded = new Set();
let treeCache = null;
function buildTree() {
  const counts = new Map(), kids = new Map(), rootCount = new Map();
  for (const r of files) {
    rootCount.set(r.root, (rootCount.get(r.root) || 0) + 1);
    let parent = r.root + '|', p = '', i = 0;
    const d = r.dir;
    while (i < d.length) {
      const j = d.indexOf('/', i); if (j < 0) break;
      p = d.slice(0, j + 1);
      const key = r.root + '|' + p;
      const c = counts.get(key);
      if (c === undefined) { counts.set(key, 1); let k = kids.get(parent); if (!k) { k = []; kids.set(parent, k); } k.push(key); }
      else counts.set(key, c + 1);
      parent = key; i = j + 1;
    }
  }
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  for (const k of kids.values()) k.sort((a, b) => coll.compare(a, b));
  return { counts, kids, rootCount };
}
function buildSide(recount = true) {
  if (recount || !treeCache) treeCache = buildTree();
  const { counts, kids, rootCount } = treeCache;
  // make sure the selected folder is visible
  if (dirFilter) {
    const bar = dirFilter.indexOf('|'), root = dirFilter.slice(0, bar + 1), parts = dirFilter.slice(bar + 1).split('/').filter(Boolean);
    expanded.add(root);
    let acc = ''; for (let n = 0; n < parts.length - 1; n++) { acc += parts[n] + '/'; expanded.add(root + acc); }
  }
  const out = [`<div class="dir${dirFilter === '' ? ' on' : ''}" data-d=""><span class="tw"></span><span class="n">All sounds</span><b>${files.length.toLocaleString()}</b></div>`];
  const row = (key, name, count, depth, extra = '', title = '') => {
    const has = kids.has(key), open = expanded.has(key);
    out.push(`<div class="dir${extra}${dirFilter === key ? ' on' : ''}" data-d="${esc(key)}" style="padding-left:${4 + depth * 14}px" title="${esc(title || name)}"><span class="tw" data-tw="${has ? esc(key) : ''}">${has ? (open ? '▾' : '▸') : ''}</span><span class="n">${esc(name)}</span><b>${count.toLocaleString()}</b>${depth === 0 ? `<span class="x" data-rm="${esc(key.slice(0, -1))}" title="Remove from library (files are not deleted)">×</span>` : ''}</div>`);
    if (has && open) for (const c of kids.get(key)) row(c, c.slice(c.indexOf('|') + 1, -1).split('/').pop(), counts.get(c), depth + 1);
  };
  for (const root of folders) {
    const miss = missing.has(root), sc = scanState.get(root);
    const label = baseName(root) + (miss ? ' (not found)' : sc && sc.live ? ' (scanning…)' : '');
    row(root + '|', label, rootCount.get(root) || 0, 0, ' root' + (miss ? ' missing' : ''), root + (miss ? ' (not found: drive unplugged or folder moved)' : ''));
  }
  const tc = tagCounts();
  if (tc.length) {
    out.push(`<div class="side-h">Tags</div>`);
    for (const [t, n] of tc) out.push(`<div class="tag${tagFilter === t.toLowerCase() ? ' on' : ''}" data-tag="${esc(t)}"><span class="n"># ${esc(t)}</span><b>${n}</b></div>`);
  }
  const side = $('#side'), top = side.scrollTop;
  side.innerHTML = out.join('');
  side.scrollTop = top;
}
$('#side').onclick = async e => {
  const tg = e.target.closest('.tag');
  if (tg) { const t = tg.dataset.tag.toLowerCase(); tagFilter = tagFilter === t ? '' : t; buildSide(); applyFilter(); saveSession(); return; }
  const rm = e.target.dataset && e.target.dataset.rm;
  if (rm) {
    e.stopPropagation();
    folders = await sb.removeFolder(rm);
    byRoot.delete(rm); missing.delete(rm);
    if (dirFilter.startsWith(rm + '|')) dirFilter = '';
    mergeAll(); saveSession();
    return;
  }
  const tw = e.target.dataset && e.target.dataset.tw;
  if (tw) { expanded.has(tw) ? expanded.delete(tw) : expanded.add(tw); buildSide(false); saveSession(); return; }
  const el = e.target.closest('.dir'); if (!el) return;
  dirFilter = el.dataset.d;
  if (dirFilter) expanded.add(dirFilter);
  buildSide(false);
  applyFilter(); saveSession();
};

function applyFilter(resetScroll = true) {
  const raw = $('#search').value.trim();
  const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const favOnly = $('#favOnly').checked;
  const bmin = +$('#bpmMin').value || 0, bmax = +$('#bpmMax').value || 0;
  // spelling help: a word that matches nothing is swapped for the closest words in your library
  const corrections = [];
  const termSets = terms.map(t => {
    if (exactSearch || files.some(r => r.hay.includes(t))) return [t];
    if (vocabDirty) { vocab.build(files.map(r => r.hay)); vocabDirty = false; }
    const c = vocab.correct(t);
    if (c.length) { corrections.push([t, c[0]]); return c; }
    return [t];
  });
  const dy = $('#didyou');
  if (corrections.length) {
    const fixed = terms.map(t => { const c = corrections.find(x => x[0] === t); return c ? c[1] : t; }).join(' ');
    dy.innerHTML = `Showing results for <b>${esc(fixed)}</b>. <a id="exactLink">Search exactly for "${esc(raw)}" instead</a>`;
    dy.classList.add('show');
  } else if (exactSearch && raw) {
    dy.innerHTML = `Exact search for "${esc(raw)}". <a id="fuzzyLink">Allow spelling corrections</a>`;
    dy.classList.add('show');
  } else dy.classList.remove('show');
  view = files.filter(r =>
    (!dirFilter || r.dkey.startsWith(dirFilter)) &&
    (!typeFilter.size || typeFilter.has(r.ext)) &&
    (!favOnly || favs.has(r.path)) &&
    (!tagFilter || r.tags.some(t => t.toLowerCase() === tagFilter)) &&
    (!keyFilter || r.key === keyFilter) &&
    (!bmin || (r.bpm && r.bpm >= bmin)) && (!bmax || (r.bpm && r.bpm <= bmax)) &&
    termSets.every(set => set.some(w => r.hay.includes(w))));
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
  // files are kept sorted by name, and filtering keeps that order, so name sorting is free
  if (k === 'name') { if (d < 0) view.reverse(); }
  else {
    const num = (x, y) => { x = x ?? Infinity; y = y ?? Infinity; return x === y ? 0 : x < y ? -1 : 1; };
    const str = (x, y) => x < y ? -1 : x > y ? 1 : 0;
    view.sort((a, b) => {
      let r;
      if (k === 'dir') r = str(a.sd, b.sd);
      else if (k === 'ext') r = str(a.ext, b.ext);
      else if (k === 'size') r = a.size - b.size;
      else if (k === 'dur') r = num(a.dur, b.dur);
      else if (k === 'fmt') r = num(a.meta && a.meta.sr, b.meta && b.meta.sr) || num(a.meta && a.meta.bits, b.meta && b.meta.bits);
      else if (k === 'fav') r = favs.has(b.path) - favs.has(a.path);
      else if (k === 'key') r = (a.key ? ALL_KEYS.indexOf(a.key) : 99) - (b.key ? ALL_KEYS.indexOf(b.key) : 99);
      else if (k === 'bpm') r = num(a.bpm, b.bpm);
      return (r || str(a.sn, b.sn)) * d;
    });
  }
  document.querySelectorAll('#cols span').forEach(s => s.classList.toggle('on', s.dataset.k === sortKey));
}
$('#cols').onclick = e => {
  if (e.target.classList.contains('cr')) return;
  const k = e.target.dataset && e.target.dataset.k; if (!k) return;
  if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
  applyFilter(); saveSession();
};
let searchTimer;
$('#search').oninput = () => { exactSearch = false; clearTimeout(searchTimer); searchTimer = setTimeout(() => { applyFilter(); saveSession(); }, 120); };
$('#favOnly').onchange = () => { applyFilter(); saveSession(); };
$('#autoplay').onchange = saveSession;

/* ---------- Key / BPM filters and spelling banner ---------- */
$('#keyF').onchange = e => { keyFilter = e.target.value; applyFilter(); saveSession(); };
$('#bpmMin').onchange = $('#bpmMax').onchange = () => { applyFilter(); saveSession(); };
$('#didyou').onclick = e => {
  if (e.target.id === 'exactLink') { exactSearch = true; applyFilter(); }
  else if (e.target.id === 'fuzzyLink') { exactSearch = false; applyFilter(); }
};

/* ---------- Tags ---------- */
function tagCounts() {
  const m = new Map();
  for (const r of files) for (const t of r.tags) { const k = t.toLowerCase(); const e = m.get(k); e ? e[1]++ : m.set(k, [t, 1]); }
  return [...m.values()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
}
function buildTagList() { $('#tagList').innerHTML = tagCounts().map(([t]) => `<option value="${esc(t)}">`).join(''); }
function showTags() {
  const r = current;
  $('#tagIn').style.display = r ? '' : 'none';
  $('#tagchips').innerHTML = r ? r.tags.map(t => `<span class="chipt">${esc(t)}<i data-rt="${esc(t)}" title="Remove tag">×</i></span>`).join('') : '';
}
function setTags(paths, add = [], remove = []) {
  const rm = new Set(remove.map(t => t.toLowerCase()));
  for (const p of paths) {
    let list = (tagsMap[p] || []).filter(t => !rm.has(t.toLowerCase()));
    for (const t of add) if (!list.some(x => x.toLowerCase() === t.toLowerCase())) list.push(t);
    if (list.length) tagsMap[p] = list; else delete tagsMap[p];
  }
  sb.saveTags(tagsMap);
  const set = new Set(paths);
  for (const r of files) if (set.has(r.path)) refreshRecord(r);
  if (tagFilter && !tagCounts().some(([t]) => t.toLowerCase() === tagFilter)) tagFilter = '';
  buildSide(); buildTagList(); vocabDirty = true; applyFilter(false); showTags();
}
const splitTags = v => v.split(',').map(t => t.trim().replace(/\s+/g, ' ')).filter(Boolean).map(t => t.slice(0, 40));
$('#tagIn').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); const t = splitTags(e.target.value); if (current && t.length) setTags([current.path], t); e.target.value = ''; }
  else if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); }
});
$('#tagchips').onclick = e => { const t = e.target.dataset && e.target.dataset.rt; if (t && current) setTags([current.path], [], [t]); };
function openTagAll() {
  $('#modal-t').textContent = `Add a tag to all ${view.length.toLocaleString()} sounds shown`;
  $('#modal').classList.add('show'); $('#modal-in').value = ''; setTimeout(() => $('#modal-in').focus(), 0);
}
const closeModal = () => $('#modal').classList.remove('show');
$('#modal-cancel').onclick = closeModal;
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
$('#modal-ok').onclick = () => { const t = splitTags($('#modal-in').value); if (t.length) setTags(view.map(r => r.path), t); closeModal(); };
$('#modal-in').addEventListener('keydown', e => { if (e.key === 'Enter') $('#modal-ok').click(); else if (e.key === 'Escape') closeModal(); });

/* ---------- Background analysis: key and tempo for every sound ---------- */
const AN_V = 1;
let anWorker = null, anId = 0, anQueue = [], anBusy = false, anDone = 0, anTotal = 0;
const anJobs = new Map(), anSave = [];
function anCall(channels, sampleRate) {
  if (!anWorker) {
    anWorker = new Worker('analysis-worker.js');
    anWorker.onmessage = e => { const p = anJobs.get(e.data.id); if (p) { anJobs.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.result); } };
  }
  const id = ++anId;
  return new Promise((res, rej) => { anJobs.set(id, { res, rej }); anWorker.postMessage({ id, channels, sampleRate }, channels.map(c => c.buffer)); });
}
// No giant queue: sounds on screen go first, then a cursor walks the whole library
let anCursor = 0, anLeft = 0;
const needsAn = r => r.size <= 200e6 && !(r.meta && r.meta.an && r.meta.an.v === AN_V) && !r.anFailed;
function queueAnalysis() {
  anCursor = 0; anLeft = 0;
  for (const r of files) if (needsAn(r)) anLeft++;
  anTotal = anDone + anLeft;
  pumpAnalysis();
}
function nextToAnalyze() {
  const top = Math.floor(listEl.scrollTop / ROW), end = Math.min(view.length, top + Math.ceil(listEl.clientHeight / ROW) + 1);
  for (let i = Math.max(0, top); i < end; i++) if (needsAn(view[i])) return view[i];
  if (current && needsAn(current)) return current;
  while (anCursor < files.length) { const r = files[anCursor++]; if (needsAn(r)) return r; }
  return null;
}
async function analyzeRecord(r) {
  let buf = await getBuffer(r);
  if (IS_AIFF(r.ext)) buf = aiffToWav(buf);
  const SR = 11025;
  const ab = await new OfflineAudioContext(1, 1, SR).decodeAudioData(buf);
  const len = Math.min(ab.length, SR * 120);
  const ch = [];
  for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) ch.push(ab.getChannelData(c).slice(0, len));
  const res = await anCall(ch, SR);
  return { v: AN_V, key: res.key, bpm: res.bpm, kc: res.keyConf, bc: res.bpmConf };
}
function updateAnStatus() {
  const el = $('#anstat');
  if (anBusy && anLeft > 0) { el.textContent = `Analyzing keys and tempo… ${anDone.toLocaleString()} of ${anTotal.toLocaleString()}`; el.style.display = ''; }
  else el.style.display = 'none';
}
async function pumpAnalysis() {
  if (anBusy) return;
  anBusy = true;
  let sinceRefresh = 0, r;
  while ((r = nextToAnalyze())) {
    let an;
    try { an = await analyzeRecord(r); } catch (e) { an = { v: AN_V, err: 1 }; }
    r.meta = Object.assign(r.meta || {}, { an });
    refreshRecord(r);
    anDone++; anLeft = Math.max(0, anLeft - 1);
    anSave.push({ path: r.path, size: r.size, mtime: r.mtime, an });
    if (anSave.length >= 25) sb.saveAnalysis(anSave.splice(0));
    if (++sinceRefresh >= 20) {
      sinceRefresh = 0;
      if (keyFilter || $('#bpmMin').value || $('#bpmMax').value) applyFilter(false); else render();
    } else if (sinceRefresh % 4 === 0) render();
    updateAnStatus();
    await new Promise(res => setTimeout(res, isPlaying() ? 40 : 2));
  }
  if (anSave.length) sb.saveAnalysis(anSave.splice(0));
  anBusy = false; anDone = 0; anTotal = 0;
  vocabDirty = true;
  applyFilter(false); updateAnStatus();
}

/* ---------- Tabs: Library / About ---------- */
function showTab(t) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  const ap = $('#aboutPage');
  ap.style.top = $('header').offsetHeight + 'px';
  ap.classList.toggle('show', t === 'about');
}
$('#tabs').onclick = e => { const t = e.target.dataset && e.target.dataset.tab; if (t) showTab(t); };

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
      + `<span class="ky${r.keyGuess ? ' guess' : ''}" title="${r.key ? (r.keyGuess ? 'Detected by listening' : 'From the file name or tags') : ''}">${r.key || ''}</span>`
      + `<span class="bp${r.bpmGuess ? ' guess' : ''}" title="${r.bpm ? (r.bpmGuess ? 'Detected by listening' : 'From the file name or tags') : ''}">${r.bpm || ''}</span>`
      + `<span class="tp">${r.ext.toUpperCase()}</span>`
      + `<span class="fm">${fmtFormat(r.meta)}</span>`
      + `<span class="du">${fmtDur(r.dur)}</span>`
      + `<span class="sz">${fmtSize(r.size)}</span></div>`;
  }
  spacer.innerHTML = html;
}
listEl.addEventListener('scroll', () => { $('#colwrap').scrollLeft = listEl.scrollLeft; render(); saveSession(); });
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
  else if (a === 'tagall') openTagAll();
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
    for (const r of batch) { const m = res[r.path]; if (m) { r.meta = Object.assign(r.meta || {}, m); if (r.dur === undefined || r.dur === null) r.dur = m.dur; refreshRecord(r); } }
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
  showTags();
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
  updateWaveHint();
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
  else if (inGrabZone(x)) { drag = { mode: 'grab', x0: x, t0: t }; return; } // let the native drag start
  else drag = { mode: 'new', x0: x, t0: t };
  e.preventDefault();
});
// The highlighted part can be dragged straight out of the waveform into any folder or app
function inGrabZone(x) {
  if (!hasSel()) return false;
  const a = tToX(ed.selA), b = tToX(ed.selB), m = 6 * (canvas.width / canvas.getBoundingClientRect().width);
  return x > a + m && x < b - m;
}
canvas.addEventListener('dragstart', e => {
  e.preventDefault();
  drag = null;
  if (ed.path) sb.startDrag(ed.path);
  else setStatus('One moment, your edit is still being prepared. Try again in a second.');
});
function updateWaveHint() {
  $('#wavehint').textContent = hasSel()
    ? 'Drag the highlighted part into any folder or your DAW · click it to hear it · Esc to clear'
    : 'Drag to select · wheel to zoom · double-click to see all';
}
addEventListener('mousemove', e => {
  if (!drag) {
    if (e.target === canvas) {
      const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width, x = (e.clientX - rect.left) * sx;
      const edge = hasSel() && (Math.abs(x - tToX(ed.selA)) < 6 * sx || Math.abs(x - tToX(ed.selB)) < 6 * sx);
      const grab = !edge && inGrabZone(x);
      canvas.draggable = grab;
      canvas.style.cursor = edge ? 'ew-resize' : grab ? (ed.path ? 'grab' : 'progress') : 'text';
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
  if (d.mode === 'grab') { if (ed.outBuf) playEdit(); return; } // a click on the highlighted part plays it
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

/* ---------- Resizable sidebar and waveform ---------- */
let sideW = 250, waveH = 112;
function applySizes() {
  document.documentElement.style.setProperty('--side-w', sideW + 'px');
  document.documentElement.style.setProperty('--wave-h', waveH + 'px');
  sizeCanvas(); render();
}
function grip(el, onMove, onReset) {
  el.addEventListener('mousedown', e => {
    e.preventDefault();
    el.classList.add('on'); document.body.classList.add('resizing');
    const move = ev => onMove(ev);
    const up = () => { el.classList.remove('on'); document.body.classList.remove('resizing'); removeEventListener('mousemove', move); removeEventListener('mouseup', up); saveSession(); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  });
  el.addEventListener('dblclick', () => { onReset(); saveSession(); });
}
let sizeRaf = 0;
const sizeSoon = () => { if (!sizeRaf) sizeRaf = requestAnimationFrame(() => { sizeRaf = 0; applySizes(); }); };
grip($('#sideGrip'), e => { sideW = clamp(Math.round(e.clientX), 160, Math.min(900, innerWidth - 420)); sizeSoon(); }, () => { sideW = 250; applySizes(); });
grip($('#footGrip'), e => {
  const fixed = $('footer').getBoundingClientRect().bottom - $('#wave').getBoundingClientRect().bottom; // controls below the waveform
  const top = $('#wave').getBoundingClientRect().top - $('footer').getBoundingClientRect().top;      // controls above it
  waveH = clamp(Math.round(innerHeight - e.clientY - fixed - top), 70, Math.max(70, innerHeight - 330));
  sizeSoon();
}, () => { waveH = 112; applySizes(); });
grip($('#specGrip'), e => { specW = clamp(Math.round($('#viz').getBoundingClientRect().right - e.clientX - 5), 180, Math.max(180, innerWidth - 500)); applyCols(); sizeSoon(); }, () => { specW = 300; applyCols(); applySizes(); });

/* ---------- Resizable columns, like a spreadsheet ---------- */
const COLS = ['fav', 'name', 'dir', 'key', 'bpm', 'ext', 'fmt', 'dur', 'size'];
const COL_DEF = { fav: 28, name: 340, dir: 380, key: 66, bpm: 52, ext: 54, fmt: 132, dur: 66, size: 76 };
let colW = { ...COL_DEF }, specW = 300;
function applyCols() {
  const root = document.documentElement.style;
  root.setProperty('--cols', COLS.map(c => colW[c] + 'px').join(' '));
  root.setProperty('--row-w', (COLS.reduce((a, c) => a + colW[c], 0) + 16) + 'px');
  root.setProperty('--spec-w', specW + 'px');
}
function fitDefaultCols() { // first run: share the free width between Name and Folder
  const others = COLS.filter(c => c !== 'name' && c !== 'dir').reduce((a, c) => a + colW[c], 0) + 16;
  const free = Math.max(400, listEl.clientWidth - others - 4);
  colW.name = Math.round(free * 0.45); colW.dir = free - colW.name;
}
const colText = {
  name: r => r.name, dir: r => r.rootName + '/' + r.dir, key: r => r.key || '', bpm: r => String(r.bpm || ''),
  ext: r => r.ext.toUpperCase(), fmt: r => fmtFormat(r.meta), dur: r => fmtDur(r.dur), size: r => fmtSize(r.size)
};
function autoFit(c) { // double-click a column edge: fit the widest text, like Excel
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = getComputedStyle($('#list')).font || '13px "Segoe UI", sans-serif';
  const head = $(`#cols span[data-k="${c}"]`);
  let w = ctx.measureText(head ? head.textContent : '').width;
  const n = Math.min(view.length, 4000);
  for (let i = 0; i < n; i++) w = Math.max(w, ctx.measureText(colText[c](view[i])).width);
  colW[c] = Math.round(clamp(w + 24, 40, 1400));
  applyCols(); saveSession();
}
$('#cols').addEventListener('mousedown', e => {
  if (!e.target.classList.contains('cr')) return;
  e.preventDefault(); e.stopPropagation();
  const c = e.target.parentElement.dataset.k, x0 = e.clientX, w0 = colW[c], h = e.target;
  h.classList.add('on'); document.body.classList.add('resizing');
  let raf = 0;
  const move = ev => { colW[c] = Math.max(36, Math.round(w0 + ev.clientX - x0)); if (!raf) raf = requestAnimationFrame(() => { raf = 0; applyCols(); }); };
  const up = () => { h.classList.remove('on'); document.body.classList.remove('resizing'); removeEventListener('mousemove', move); removeEventListener('mouseup', up); saveSession(); };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
});
$('#cols').addEventListener('dblclick', e => { if (e.target.classList.contains('cr')) autoFit(e.target.parentElement.dataset.k); });

/* ---------- Keyboard ---------- */
document.addEventListener('keydown', e => {
  if (e.target.id === 'tagIn' || e.target.id === 'modal-in') return;
  if ($('#aboutPage').classList.contains('show')) { if (e.key === 'Escape') showTab('lib'); return; }
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
  $('#ver').textContent = 'v' + st.version; $('#about-ver').textContent = 'Version ' + st.version;
  folders = st.folders; favs = new Set(st.favorites); tagsMap = st.tags || {};
  $('#keyF').innerHTML = '<option value="">Any key</option>' + ALL_KEYS.map(k => `<option value="${k}">${k.replace(' maj', ' major').replace(' min', ' minor')}</option>`).join('');
  const s = st.session || {};
  if (s.keyFilter) { keyFilter = s.keyFilter; $('#keyF').value = keyFilter; }
  if (s.tagFilter) tagFilter = s.tagFilter;
  if (s.bpmMin) $('#bpmMin').value = s.bpmMin;
  if (s.bpmMax) $('#bpmMax').value = s.bpmMax;
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
  if (s.sideW) sideW = s.sideW;
  if (s.waveH) waveH = s.waveH;
  if (s.specW) specW = s.specW;
  if (s.colW) colW = { ...COL_DEF, ...s.colW }; else fitDefaultCols();
  applyCols();
  applySizes();
  ac();
  player.volume = +$('#vol').value;
  if (Array.isArray(s.expanded)) s.expanded.forEach(k => expanded.add(k));
  if (!folders.length) { applyFilter(); return; }
  const lib = await sb.libraryLoad();
  for (const r of lib) {
    if (r.missing) missing.add(r.root);
    if (r.files.length) byRoot.set(r.root, makeRecords(r.root, r.files));
    if (!s.expanded) expanded.add(r.root + '|');
  }
  mergeAll(true);
  scanAll(); // check for anything that changed while the app was closed
  if (s.selPath) {
    const i = view.findIndex(r => r.path === s.selPath);
    if (i >= 0) { sel = i; current = view[i]; listEl.scrollTop = s.scroll || Math.max(0, i * ROW - 100); ensureVisible(i); render(); load(current, false); }
  }
})();
