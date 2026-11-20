'use strict';
/* global sb, aiffToWav */
const $ = s => document.querySelector(s);
const ROW = 28;
const IS_AIFF = e => e === 'aif' || e === 'aiff' || e === 'aifc';

let folders = [], missing = new Set(), byRoot = new Map();
let files = [], view = [], sel = -1, current = null;
let sortKey = 'name', sortDir = 1, typeFilter = new Set(), dirFilter = '';
let pathFilter = null; // a set of sounds picked on the map
let favs = new Set();
let tagsMap = {}, tagFilter = '', keyFilter = '', exactSearch = false;
const vocab = new Vocabulary();

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';
const fmtDur = d => { if (d === undefined) return ''; if (d === null) return '?'; if (d < 60) return d.toFixed(d < 10 ? 2 : 1) + 's'; const m = Math.floor(d / 60), s = Math.floor(d % 60); return m + ':' + String(s).padStart(2, '0'); };
const fmtClock = d => { if (!isFinite(d)) return '0:00.0'; const m = Math.floor(d / 60); return m + ':' + (d % 60).toFixed(1).padStart(4, '0'); };
function fmtFormat(m) {
  if (!m) return '';
  if (m.midi) return `${m.midi.tracks} ${m.midi.tracks === 1 ? 'track' : 'tracks'}${m.midi.ts ? ' ' + m.midi.ts : ''}`;
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
    gen: { inf: $('#gen-inf').value, loop: $('#gen-loop').checked, n: $('#gen-n').value, model: $('#gen-model').value, fmt: $('#gen-fmt').value, auto: $('#gen-auto').checked, dur: $('#gen-dur').value },
    ceiling: ed.ceiling, eqMode: ed.eqMode, keyTempo, ktFolders, soundColors, showWaves, bgPaused, midiBank: midiBankPath, midiNoMod, midiRev3: midiRev, midiCho3: midiCho, midiDly: dly, midiLock, video: vstate, colFit: 3, mapMode: window.mapMode || false, sideW, waveH, specW, colW, expanded: [...expanded].slice(0, 400), keyFilter, tagFilter, bpmMin: $('#bpmMin').value, bpmMax: $('#bpmMax').value,
    vol: +$('#vol').value, tape: ed.tape, eqOn: ed.eqOn, viewMode, selPath: current ? current.path : null, scroll: listEl.scrollTop
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
  r.key = tk || r.nk || an.key || m.midiKey || null; r.keyGuess = !tk && !r.nk && !!(an.key || m.midiKey);
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
  const parts = [...scanState.entries()].map(([root, st]) => st.check ? `Checking ${baseName(root)} for new sounds…` : `${st.live ? 'Scanning' : 'Rescanning'} ${baseName(root)}… ${st.n.toLocaleString()}`);
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
  if (current && !current.temp) {
    const p = current.path;
    current = null;
    for (const r of files) if (r.path === p) { current = r; break; }
  }
  rebuild();
}
// Start-up: a quick check per folder (only new or deleted files are read). A full scan only when nothing is known yet.
async function checkAll() {
  for (const root of folders) {
    if (scanState.has(root)) continue;
    if (!(byRoot.get(root) || []).length) { await scanRoot(root); continue; }
    const st = { live: false, staged: [], n: 0, received: 0, check: true };
    scanState.set(root, st); updateScanStatus();
    let r;
    try { r = await sb.check(root); } catch (e) { r = {}; }
    scanState.delete(root);
    if (r.missing) missing.add(root); else missing.delete(root);
    updateScanStatus(); buildSide(false);
    if (r.needsScan) await scanRoot(root);
  }
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
  // the browser's FileList cannot cross into the preload, so pass a plain list of the File objects
  let paths = [];
  try { paths = sb.pathsOf(Array.from(e.dataTransfer.files || [])); }
  catch (err) { setStatus('Could not read the dropped files: ' + err.message); return; }
  if (!paths.length) { if ((e.dataTransfer.files || []).length) setStatus('Could not read where the dropped files are. Try dropping them again.'); return; }
  const info = await sb.inspectPaths(paths);
  const dirs = info.filter(i => i.dir).map(i => i.path), sounds = info.filter(i => i.audio).map(i => i.path);
  if (sounds.length && $('#conv').classList.contains('show')) { convFromPath(sounds[0], sounds.length); return; }
  if (sounds.length) quickOpen(sounds[0], sounds.length);      // a sound file: quick edit, not added to the library
  if (dirs.length) addFolders(await sb.addPaths(dirs));          // a folder: added to the library
  if (!sounds.length && !dirs.length) setStatus('Drop a sound file for a quick edit, or a folder to add it to your library.');
});

/* ---------- Quick edit: one sound from anywhere, not added to the library ---------- */
function tempRecord(f) {
  const parent = f.path.replace(/[\\/][^\\/]*$/, '');
  return {
    path: f.path, name: f.name, ext: f.ext, size: f.size, mtime: f.mtime, root: null, dir: '', rootName: parent,
    base: f.name, meta: f.meta, dur: f.meta ? f.meta.dur : undefined, tags: [], key: null, bpm: null, hay: '',
    sn: natKey(f.name), sd: '', temp: true
  };
}
async function quickOpen(p, count = 1) {
  const known = files.find(r => r.path === p);
  if (known) { // already in the library: just open it there
    let i = view.indexOf(known);
    if (i < 0) { $('#search').value = ''; dirFilter = ''; tagFilter = ''; keyFilter = ''; $('#keyF').value = ''; applyFilter(false); buildSide(false); i = view.indexOf(known); }
    if (i >= 0) select(i, $('#autoplay').checked);
    return;
  }
  const f = await sb.openQuick(p);
  if (!f) { setStatus('This file cannot be opened.'); return; }
  const r = tempRecord(f);
  sel = -1; current = r; render();
  load(r, $('#autoplay').checked);
  if (count > 1) setStatus(`Opened ${f.name}. Quick edit works on one sound at a time.`, true);
}


/* ---------- Converter: one sound to MP3, WAV, AIFF or FLAC ---------- */
const CONV_Q = {
  mp3: [[128, '128 kbps', 'smallest'], [192, '192 kbps', 'good'], [256, '256 kbps', 'very good'], [320, '320 kbps', 'best']],
  wav: [[16, '16-bit', 'CD quality'], [24, '24-bit', 'studio'], [32, '32-bit float', 'for further editing']],
  aiff: [[16, '16-bit', 'CD quality'], [24, '24-bit', 'studio']],
  flac: [[16, '16-bit', 'CD quality'], [24, '24-bit', 'studio']]
};
const CONV_EXT = { mp3: 'mp3', wav: 'wav', aiff: 'aiff', flac: 'flac' };
const MP3_RATES = [32000, 44100, 48000];
const conv = { r: null, ab: null, fmt: 'mp3', q: { mp3: 320, wav: 24, aiff: 24, flac: 24 }, sr: 0, dir: null, busy: false, est: {}, token: 0, saved: null };
let convWorker = null, convSeq = 0;
const convPending = new Map();
function convCall(msg, onProgress) {
  if (!convWorker) {
    convWorker = new Worker('convert-worker.mjs', { type: 'module' });
    convWorker.onmessage = e => {
      const p = convPending.get(e.data.id); if (!p) return;
      if (e.data.progress != null) { p.prog && p.prog(e.data.progress); return; }
      convPending.delete(e.data.id);
      e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data);
    };
    convWorker.onerror = e => { for (const p of convPending.values()) p.rej(new Error(e.message || 'The converter stopped.')); convPending.clear(); convWorker = null; };
  }
  const id = ++convSeq;
  return new Promise((res, rej) => { convPending.set(id, { res, rej, prog: onProgress }); convWorker.postMessage({ ...msg, id }, (msg.channels || []).map(c => c.buffer)); });
}
const convSetStatus = (t, cls) => { const el = $('#conv-status'); el.textContent = t; el.className = cls || ''; };
const baseOf = n => n.replace(/\.[^.]+$/, '');
const srcBits = r => (r && r.meta && r.meta.bits) || 0;
function convTargetSr() {
  const sr = conv.ab.sampleRate;
  if (conv.sr) return conv.sr;
  return conv.fmt === 'mp3' && !MP3_RATES.includes(sr) ? (sr % 11025 === 0 ? 44100 : 48000) : sr;
}
function convSizes() {
  const ab = conv.ab, tsr = convTargetSr(), n = Math.ceil(ab.length * tsr / ab.sampleRate), dur = n / tsr;
  const ch = conv.fmt === 'mp3' ? Math.min(2, ab.numberOfChannels) : ab.numberOfChannels;
  const out = {};
  for (const [q] of CONV_Q[conv.fmt]) {
    if (conv.fmt === 'mp3') out[q] = Math.round(q * 125 * dur) + 1200;
    else if (conv.fmt === 'wav') out[q] = 44 + (q === 32 ? 12 : 0) + n * ch * q / 8;
    else if (conv.fmt === 'aiff') out[q] = 54 + n * ch * q / 8;
    else { const e = conv.est[q]; out[q] = e == null ? null : Math.round(e * tsr / ab.sampleRate); }
  }
  return out;
}
function convName() {
  const r = conv.r, ext = CONV_EXT[conv.fmt], q = conv.q[conv.fmt];
  const same = (r.ext === ext) || (r.ext === 'aif' && ext === 'aiff');
  const tsr = convTargetSr(), srTag = tsr !== conv.ab.sampleRate ? ` ${tsr / 1000} kHz` : '';
  const tag = conv.fmt === 'mp3' ? `${q} kbps` : `${q === 32 ? '32-bit float' : q + '-bit'}`;
  if (isMidiRec(r)) return baseOf(r.name) + ` [rendered${conv.fmt === 'mp3' ? ' ' + tag : ''}${srTag}].` + ext;
  return baseOf(r.name) + (same || srTag ? ` (${tag}${srTag})` : '') + '.' + ext;
}
function convRender() {
  const ab = conv.ab, r = conv.r;
  $('#conv-go').disabled = !ab || conv.busy;
  if (!r) { $('#conv-sname').textContent = 'No sound yet'; $('#conv-sinfo').textContent = 'Select a sound in your library, or drop any sound file here.'; $('#conv-q').innerHTML = ''; $('#conv-name').textContent = ''; return; }
  $('#conv-sname').textContent = r.name;
  const m = r.meta || {};
  $('#conv-sinfo').textContent = !ab ? (isMidiRec(r) ? 'Playing the song into audio with your settings…' : 'Reading the sound…') : isMidiRec(r) ? `MIDI played with your instruments, tempo and effects · ${ab.sampleRate / 1000} kHz · stereo · ${fmtDur(ab.duration)}` :
    [r.ext.toUpperCase(), (ab.sampleRate / 1000) + ' kHz', m.bits ? m.bits + '-bit' : m.kbps ? m.kbps + ' kbps' : '', ab.numberOfChannels === 1 ? 'mono' : ab.numberOfChannels === 2 ? 'stereo' : ab.numberOfChannels + ' channels', fmtDur(ab.duration), fmtSize(r.size)].filter(Boolean).join(' · ');
  if (!ab) return;
  $('#conv-fmt').value = conv.fmt;
  // sample rate: keep, or the two usual ones
  const sr = ab.sampleRate, keepOk = conv.fmt !== 'mp3' || MP3_RATES.includes(sr);
  if (!keepOk && conv.sr === 0) conv.sr = convTargetSr();
  const opts = [[0, `Keep (${sr / 1000} kHz)`, keepOk], [44100, '44.1 kHz', true], [48000, '48 kHz', true]].filter(o => o[2] && !(o[0] && o[0] === sr && keepOk));
  $('#conv-sr').innerHTML = opts.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('');
  $('#conv-sr').value = String(conv.sr);
  // quality, each with its size
  const sizes = convSizes(), cur = conv.q[conv.fmt];
  $('#conv-q').innerHTML = CONV_Q[conv.fmt].map(([q, name, note]) => {
    const s = sizes[q], approx = conv.fmt === 'mp3' || conv.fmt === 'flac';
    return `<label class="${q === cur ? 'on' : ''}"><input type="radio" name="convq" value="${q}" ${q === cur ? 'checked' : ''}><span class="qn">${name} <span class="hint">${note}</span></span><span class="qs">${s == null ? 'estimating…' : (approx ? 'about ' : '') + fmtSize(s)}</span></label>`;
  }).join('');
  if (conv.fmt === 'mp3' && ab.numberOfChannels > 2) $('#conv-q').insertAdjacentHTML('beforeend', '<div class="hint">MP3 holds two channels. The first two are used.</div>');
  const where = conv.dir ? conv.dir : (r.path.replace(/[\\/][^\\/]*$/, '') || 'the same folder');
  $('#conv-name').textContent = `Saves as “${convName()}” in ${where}`;
  $('#conv-pick').textContent = conv.dir ? 'Change folder…' : 'Choose folder…';
  document.querySelector(`input[name=cdest][value=${conv.dir ? 'pick' : 'next'}]`).checked = true;
  if (conv.fmt === 'flac' && CONV_Q.flac.some(([q]) => conv.est[q] == null)) convEstimate();
}
let convEstimating = false;
async function convEstimate() {
  if (convEstimating || !conv.ab) return;
  convEstimating = true;
  const t = conv.token, ab = conv.ab;
  try {
    for (const [q] of CONV_Q.flac) {
      if (conv.est[q] != null) continue;
      const channels = []; for (let c = 0; c < ab.numberOfChannels; c++) channels.push(ab.getChannelData(c).slice());
      const res = await convCall({ cmd: 'estimate', bits: q, sampleRate: ab.sampleRate, channels });
      if (t !== conv.token) break;
      conv.est[q] = res.size;
    }
  } catch (e) {} finally { convEstimating = false; }
  if (t === conv.token && $('#conv').classList.contains('show')) convRender();
}
async function convDecode(r) {
  if (isMidiRec(r)) return renderMidiAudio(r, p => { if (conv.r === r && !conv.ab) $('#conv-sinfo').textContent = `Playing the song into audio with your settings… ${Math.round(p * 100)}%`; });
  if (r === current && ed.orig) return ed.orig;
  let buf = await getBuffer(r);
  if (IS_AIFF(r.ext)) buf = aiffToWav(buf);
  const sr = (r.meta && r.meta.sr) || 48000;
  return new OfflineAudioContext(1, 1, sr).decodeAudioData(buf);
}
async function convLoad(r) {
  const t = ++conv.token;
  conv.r = r; conv.ab = null; conv.est = {}; conv.saved = null; conv.sr = 0;
  $('#conv-show').style.display = 'none'; convSetStatus('');
  // a sensible starting point: MP3 for anything lossless, WAV when the source is already compressed
  const lossy = ['mp3', 'ogg', 'm4a', 'aac', 'opus', 'wma'].includes(r.ext);
  conv.fmt = lossy || isMidiRec(r) ? 'wav' : 'mp3';
  const b = srcBits(r);
  const lossless = b === 16 ? 16 : b === 32 ? 32 : lossy ? 16 : 24;
  conv.q.wav = lossless; conv.q.aiff = conv.q.flac = Math.min(24, lossless);
  convRender();
  try {
    const ab = await convDecode(r);
    if (t !== conv.token) return;
    conv.ab = ab; convRender();
  } catch (e) {
    if (t !== conv.token) return;
    convSetStatus('This sound could not be read: ' + e.message, 'err');
  }
}
function openConvert(r) {
  $('#conv').classList.add('show');
  if (r && r !== conv.r) convLoad(r); else convRender();
  if (!r && !conv.r) convSetStatus('Select a sound in your library, or drop any sound file here.');
}
async function convFromPath(p, count = 1) {
  const known = files.find(r => r.path === p);
  let r = known;
  if (!r) { const f = await sb.openQuick(p); if (!f) { convSetStatus('This file cannot be opened.', 'err'); return; } r = tempRecord(f); }
  await convLoad(r);
  if (count > 1) convSetStatus(`Using ${r.name}. The converter works on one file at a time.`);
}
const closeConv = () => { if (!conv.busy) $('#conv').classList.remove('show'); };
$('#convBtn').onclick = () => openConvert(current);
$('#conv-close').onclick = closeConv;
$('#conv').addEventListener('mousedown', e => { if (e.target.id === 'conv') closeConv(); });
$('#conv').addEventListener('keydown', e => { if (e.key === 'Escape') closeConv(); e.stopPropagation(); });
$('#conv-fmt').onchange = e => { conv.fmt = e.target.value; conv.sr = 0; convRender(); };
$('#conv-sr').onchange = e => { conv.sr = +e.target.value; convRender(); };
$('#conv-q').addEventListener('change', e => { if (e.target.name === 'convq') { conv.q[conv.fmt] = +e.target.value; convRender(); } });
$('#conv-dest').addEventListener('change', async e => {
  if (e.target.name !== 'cdest') return;
  if (e.target.value === 'next') { conv.dir = null; convRender(); }
  else if (!conv.dir) { const d = await sb.convertFolder(); conv.dir = d || null; convRender(); }
});
$('#conv-pick').onclick = async () => { const d = await sb.convertFolder(); if (d) conv.dir = d; convRender(); };
$('#conv-show').onclick = () => { if (conv.saved) sb.showInFolder(conv.saved); };
$('#conv-go').onclick = async () => {
  if (conv.busy || !conv.ab) return;
  const ab = conv.ab, r = conv.r, fmt = conv.fmt, q = conv.q[fmt], tsr = convTargetSr(), name = convName(), t = conv.token;
  conv.busy = true; convRender(); $('#conv-show').style.display = 'none';
  const bar = $('#conv-bar'), fill = bar.firstElementChild;
  bar.style.visibility = 'visible'; fill.style.width = '0%';
  convSetStatus('Converting…');
  try {
    // sample rate change, if any, through the browser's high-quality resampler
    let src = ab;
    if (tsr !== ab.sampleRate) {
      const oc = new OfflineAudioContext(ab.numberOfChannels, Math.ceil(ab.length * tsr / ab.sampleRate), tsr);
      const s = oc.createBufferSource(); s.buffer = ab; s.connect(oc.destination); s.start();
      src = await oc.startRendering();
    }
    const nc = fmt === 'mp3' ? Math.min(2, src.numberOfChannels) : src.numberOfChannels;
    const channels = []; for (let c = 0; c < nc; c++) channels.push(src.getChannelData(c).slice());
    // the original bit depth lets a 16 or 24-bit file be copied exactly (not after a sample rate change)
    const sb0 = tsr === ab.sampleRate && !isMidiRec(r) && !['mp3', 'ogg', 'm4a', 'aac', 'opus', 'wma'].includes(r.ext) ? srcBits(r) : 0;
    const res = await convCall({ cmd: 'encode', fmt, bits: q, kbps: q, sampleRate: tsr, channels, srcBits: sb0 }, p => { fill.style.width = Math.round(p * 100) + '%'; });
    fill.style.width = '100%';
    const saved = await sb.convertSave(r.path, conv.dir, name, res.data.buffer);
    if (t !== conv.token) return;
    if (saved.error) { convSetStatus(saved.error, 'err'); return; }
    conv.saved = saved.path;
    convSetStatus(`Saved ${saved.path.replace(/^.*[\\/]/, '')} · ${fmtSize(res.data.length)}`, 'ok');
    $('#conv-show').style.display = '';
  } catch (e) {
    convSetStatus('The conversion did not work: ' + e.message, 'err');
  } finally {
    conv.busy = false; bar.style.visibility = 'hidden'; convRender();
  }
};

/* ---------- Filtering, sorting, sidebar ---------- */
let vocabDirty = true, vocabTimer = null;
function rebuild() {
  buildChips(true); buildSide(); buildTagList(); vocabDirty = true; applyFilter(false); queueAnalysis(); queueFingerprints();
  // prepare the spelling word list quietly once loading settles
  clearTimeout(vocabTimer);
  vocabTimer = setTimeout(() => { if (vocabDirty && !scanState.size) { vocab.build(files.map(r => r.hay)); vocabDirty = false; } }, 3000);
}

// Type buttons: the counts follow the folder you are in. A click shows only that type
// (click it again to show all), Ctrl or Shift + click adds or removes one more type.
let chipsKey = '';
function buildChips(force) {
  const key = dirFilter + '|' + files.length + '|' + [...typeFilter].join(',');
  if (!force && key === chipsKey) return;
  chipsKey = key;
  const counts = {}, all = {};
  for (const r of files) { all[r.ext] = 1; if (!dirFilter || r.dkey.startsWith(dirFilter)) counts[r.ext] = (counts[r.ext] || 0) + 1; }
  for (const x of [...typeFilter]) if (!all[x]) typeFilter.delete(x);
  const shown = Object.keys(all).filter(x => counts[x] || typeFilter.has(x)).sort();
  $('#chips').innerHTML = shown.map(x => `<button class="chip${typeFilter.has(x) ? ' on' : ''}" data-x="${x}" title="Show only ${x.toUpperCase()} files · click again to show all · Ctrl+click to add another type">${x.toUpperCase()} ${(counts[x] || 0).toLocaleString()}</button>`).join(' ');
}
$('#chips').onclick = e => {
  const b = e.target.closest && e.target.closest('[data-x]'); if (!b) return;
  const x = b.dataset.x;
  if (e.ctrlKey || e.metaKey || e.shiftKey) typeFilter.has(x) ? typeFilter.delete(x) : typeFilter.add(x);
  else if (typeFilter.size === 1 && typeFilter.has(x)) typeFilter.clear();
  else typeFilter = new Set([x]);
  buildChips(true); applyFilter(); saveSession();
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
let revealedDir = null;
function buildSide(recount = true) {
  if (recount || !treeCache) treeCache = buildTree();
  const { counts, kids, rootCount } = treeCache;
  // make sure the selected folder is visible, once, when you arrive in it
  // (after that you can close any folder above it, and it stays closed)
  if (dirFilter && dirFilter !== revealedDir) {
    const bar = dirFilter.indexOf('|'), root = dirFilter.slice(0, bar + 1), parts = dirFilter.slice(bar + 1).split('/').filter(Boolean);
    if (parts.length) expanded.add(root);
    let acc = ''; for (let n = 0; n < parts.length - 1; n++) { acc += parts[n] + '/'; expanded.add(root + acc); }
  }
  revealedDir = dirFilter;
  const out = [`<div class="dir${dirFilter === '' ? ' on' : ''}" data-d=""><span class="tw"></span><span class="n">All sounds</span><b>${files.length.toLocaleString()}</b></div>`];
  const row = (key, name, count, depth, extra = '', title = '') => {
    const has = kids.has(key), open = expanded.has(key);
    out.push(`<div class="dir${extra}${dirFilter === key ? ' on' : ''}" data-d="${esc(key)}" style="padding-left:${4 + depth * 18}px" title="${esc(title || name)}"><span class="tw${has && open ? ' open' : ''}" data-tw="${has ? esc(key) : ''}" title="${has ? (open ? 'Close folder' : 'Open folder') : ''}">${has ? '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 1.8 6.7 5 3.5 8.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</span><span class="n">${esc(name)}</span>${ktFolders.includes(key) ? '<span class="kt" title="Key and tempo are detected in this folder">♪</span>' : ''}<b>${count.toLocaleString()}</b>${depth === 0 ? `<span class="x" data-rm="${esc(key.slice(0, -1))}" title="Remove from library (files are not deleted)">×</span>` : ''}</div>`);
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
  // the arrow: the click often lands on its drawing (svg, path), so look up to the arrow itself
  const twEl = e.target.closest && e.target.closest('.tw');
  const tw = twEl && twEl.dataset.tw;
  if (tw) { expanded.has(tw) ? expanded.delete(tw) : expanded.add(tw); buildSide(false); saveSession(); return; }
  const el = e.target.closest('.dir'); if (!el) return;
  const d = el.dataset.d, hasKids = !!el.querySelector('.tw[data-tw]:not([data-tw=""])');
  // clicking the folder you are already in opens or closes it; clicking another folder opens it
  if (d && d === dirFilter && hasKids) { expanded.has(d) ? expanded.delete(d) : expanded.add(d); buildSide(false); saveSession(); return; }
  dirFilter = d;
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
  // "Did you mean": a word that matches a few sounds while a far more common spelling exists
  let suggestion = null;
  if (!corrections.length && !exactSearch && terms.length) {
    let changed = false;
    const better = terms.map(t => {
      if (t.length < 4 || /^\d+$/.test(t)) return t;
      let n = 0; for (const r of files) { if (r.hay.includes(t)) { if (++n > 40) break; } }
      if (n > 40) return t;
      if (vocabDirty) { vocab.build(files.map(r => r.hay)); vocabDirty = false; }
      const w = vocab.suggest(t, n);
      if (w) { changed = true; return w; }
      return t;
    });
    if (changed) suggestion = better.join(' ');
  }
  const dy = $('#didyou');
  if (corrections.length) {
    const fixed = terms.map(t => { const c = corrections.find(x => x[0] === t); return c ? c[1] : t; }).join(' ');
    dy.innerHTML = `Showing results for <b>${esc(fixed)}</b>. <a id="exactLink">Search exactly for "${esc(raw)}" instead</a>`;
    dy.classList.add('show');
  } else if (suggestion) {
    dy.innerHTML = `Did you mean <a id="dymLink" data-q="${esc(suggestion)}"><b>${esc(suggestion)}</b></a>?`;
    dy.classList.add('show');
  } else if (exactSearch && raw) {
    dy.innerHTML = `Exact search for "${esc(raw)}". <a id="fuzzyLink">Allow spelling corrections</a>`;
    dy.classList.add('show');
  } else dy.classList.remove('show');
  buildChips();
  view = files.filter(r =>
    (!pathFilter || pathFilter.has(r.path)) &&
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
  $('#pfChip').style.display = pathFilter ? '' : 'none';
  if (pathFilter) $('#pfChip').textContent = `Picked on the map: ${pathFilter.size.toLocaleString()} ×`;
  if (window.mapViewChanged) mapViewChanged();
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
      else if (k === 'wave') r = num(a.meta && a.meta.fp ? a.meta.fp.t : null, b.meta && b.meta.fp ? b.meta.fp.t : null);
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
  const dym = e.target.closest && e.target.closest('#dymLink');
  if (dym) { $('#search').value = dym.dataset.q; exactSearch = false; applyFilter(); saveSession(); return; }
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
  $('#tagIn').style.display = r && !r.temp ? '' : 'none';
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

/* ---------- Sound colors: a fingerprint for every sound, in the background ---------- */
/* ---------- background listening that stays out of your way ---------- */
// the list refreshes at most a few times a second while sounds are being listened to,
// and the work slows down while you scroll, move or type
let lastInput = 0, bgRenderAt = 0, bgFilterAt = 0, bgPaused = false;
for (const ev of ['wheel', 'mousedown', 'keydown', 'pointermove']) addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true, capture: true });
function bgRefresh(filterToo) {
  const now = performance.now();
  if (filterToo && now - bgFilterAt > 5000) { bgFilterAt = bgRenderAt = now; applyFilter(false); return; }
  if (now - bgRenderAt > 700) { bgRenderAt = now; render(); }
}
function bgYield() {
  const busy = performance.now() - lastInput < 600;
  return new Promise(res => {
    // the MIDI synth renders live: give it the whole computer while it plays
    const t = () => !midiPlayer.paused ? setTimeout(t, 300) : setTimeout(res, busy ? 25 : isPlaying() ? 30 : 2);
    t();
  });
}
function bgWaitWhilePaused() { return new Promise(res => { const t = () => bgPaused ? setTimeout(t, 300) : res(); t(); }); }
function setBgPaused(on, quiet) { bgPaused = !!on; updateFpStatus(); updateAnStatus(); if (!quiet) saveSession(); }
function syncBgPause() {
  const b = $('#bgPause'); if (!b) return;
  const show = $('#fpstat').style.display !== 'none' || $('#anstat').style.display !== 'none';
  b.style.display = show ? '' : 'none';
  b.textContent = bgPaused ? 'Continue' : 'Pause';
  b.classList.toggle('on', bgPaused);
}

let fpSavedAt = 0;
// nothing listened to is lost when the window closes
addEventListener('beforeunload', () => { try { if (fpSave.length) sb.saveAnalysis(fpSave.splice(0)); if (anSave.length) sb.saveAnalysis(anSave.splice(0)); } catch (e) {} });
let soundColors = true, showWaves = true, fpBusy = false, fpCursor = 0, fpLeft = 0, fpAll = 0;
const fpSave = [];
const isMidiRec = r => !!r && (r.ext === 'mid' || r.ext === 'midi');
const isVideoExt = x => x === 'mp4' || x === 'm4v' || x === 'mov' || x === 'mkv';
const needsFp = r => soundColors && !isMidiRec(r) && !isVideoExt(r.ext) && !r.temp && r.size <= 200e6 && !(r.meta && r.meta.fp && r.meta.fp.v === SC_V) && !r.fpFailed;
function setSoundColors(on, fromUser) {
  soundColors = !!on;
  document.body.classList.toggle('nosc', !soundColors);
  $('#scToggle').checked = soundColors;
  waveCache = null; if (typeof drawWave === 'function' && ed.buf) drawWave();
  if (typeof applyCols === 'function') applyCols();
  if (fromUser) { render(); queueFingerprints(); saveSession(); }
}
$('#scToggle').onchange = e => setSoundColors(e.target.checked, true);
function setWaves(on, fromUser) {
  showWaves = !!on;
  document.body.classList.toggle('nowave', !showWaves);
  $('#wavesTog').checked = showWaves;
  if (fromUser) { applyCols(); render(); saveSession(); }
}
$('#wavesTog').onchange = e => setWaves(e.target.checked, true);
$('#fpstat').onclick = $('#anstat').onclick = $('#bgPause').onclick = () => setBgPaused(!bgPaused);
function queueFingerprints() {
  fpCursor = 0; fpLeft = 0; fpAll = 0;
  if (soundColors) for (const r of files) { if (!r.temp && r.size <= 200e6) fpAll++; if (needsFp(r)) fpLeft++; }
  updateFpStatus();
  if (fpLeft) pumpFingerprints();
}
function nextToFingerprint() {
  const top = Math.floor(listEl.scrollTop / ROW), end = Math.min(view.length, top + Math.ceil(listEl.clientHeight / ROW) + 1);
  for (let i = Math.max(0, top); i < end; i++) if (needsFp(view[i])) return view[i];
  if (current && needsFp(current)) return current;
  while (fpCursor < files.length) { const r = files[fpCursor++]; if (needsFp(r)) return r; }
  return null;
}
async function fingerprintRecord(r) {
  let buf = await getBuffer(r);
  if (IS_AIFF(r.ext)) buf = aiffToWav(buf);
  const SR = 22050;
  const ab = await new OfflineAudioContext(1, 1, SR).decodeAudioData(buf);
  const ch = []; for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) ch.push(ab.getChannelData(c).slice());
  return anCall(ch, SR, 'fp');
}
function updateFpStatus() {
  const el = $('#fpstat');
  if (soundColors && fpBusy && fpLeft > 0) {
    const done = Math.max(0, fpAll - fpLeft), pct = fpAll ? Math.floor(done / fpAll * 1000) / 10 : 0;
    el.textContent = `Sound colors: ${done.toLocaleString()} of ${fpAll.toLocaleString()} (${pct}%)` + (bgPaused ? ' · paused' : '');
    el.title = bgPaused ? 'Click to continue listening' : 'Each sound is listened to once. Results are saved and kept. Click to pause.'; el.style.display = '';
  } else el.style.display = 'none';
  syncBgPause();
}
async function pumpFingerprints() {
  if (fpBusy) return;
  fpBusy = true;
  let n = 0, r;
  while (soundColors && (r = nextToFingerprint())) {
    if (bgPaused) { updateFpStatus(); await bgWaitWhilePaused(); if (!soundColors) break; }
    let fp;
    try { fp = await fingerprintRecord(r); } catch (e) { r.fpFailed = true; fp = null; }
    fpLeft = Math.max(0, fpLeft - 1);
    if (fp) {
      r.meta = Object.assign(r.meta || {}, { fp });
      fpSave.push({ path: r.path, size: r.size, mtime: r.mtime, fp });
      if (fpSave.length >= 20 || performance.now() - fpSavedAt > 3000) { fpSavedAt = performance.now(); sb.saveAnalysis(fpSave.splice(0)); }
    }
    if (++n % 6 === 0) { bgRefresh(); updateFpStatus(); if (window.mapDataChanged) mapDataChanged(); }
    await bgYield();
    if (bgPaused) { updateFpStatus(); await bgWaitWhilePaused(); }
  }
  if (fpSave.length) sb.saveAnalysis(fpSave.splice(0));
  fpBusy = false; render(); updateFpStatus();
  if (sortKey === 'wave') applyFilter(false);
}
// the mini waveform in a list row; the last few thousand drawn are kept, so memory stays small on any library
const fpSvgs = new Map();
function miniWave(r) {
  const fp = r.meta && r.meta.fp;
  if (!soundColors || !showWaves) return '';
  if (!fp) return '<svg width="100" height="18" aria-hidden="true"><rect x="0" y="8.5" width="100" height="1" fill="#1E232D"/></svg>';
  const hit = fpSvgs.get(r.path); if (hit && hit.fp === fp) return hit.svg;
  const w = fp.w, n = w.length, W = 100, H = 20, mid = H / 2;
  const v = [...w].map(ch => Math.max(0.06, parseInt(ch, 36) / 35));
  let d = 'M0 ' + mid;
  for (let i = 0; i < n; i++) d += ' L' + (i / (n - 1) * W).toFixed(1) + ' ' + (mid - v[i] * mid * 0.92).toFixed(1);
  for (let i = n - 1; i >= 0; i--) d += ' L' + (i / (n - 1) * W).toFixed(1) + ' ' + (mid + v[i] * mid * 0.92).toFixed(1);
  const col = scColor(fp.t), noisy = fp.n > 0.6;
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d} Z" fill="${col}" fill-opacity="${noisy ? 0.45 : 0.9}"${noisy ? ` stroke="${col}" stroke-width="0.8" stroke-dasharray="1 1.4"` : ''}/></svg>`;
  if (fpSvgs.size >= 3000) fpSvgs.delete(fpSvgs.keys().next().value);
  fpSvgs.set(r.path, { fp, svg });
  return svg;
}
// big waveform: brightness along the sound, worked out once per sound
function colorTrack(buf) {
  if (ed.ctrack && ed.ctrack.buf === buf) return ed.ctrack;
  const sr = buf.sampleRate, len = buf.length, nch = Math.min(2, buf.numberOfChannels);
  let x = buf.getChannelData(0);
  if (nch > 1) { const y = buf.getChannelData(1), m = new Float32Array(len); for (let i = 0; i < len; i++) m[i] = (x[i] + y[i]) * 0.5; x = m; }
  const cols = 600, t = scTrack(x, sr, cols);
  ed.ctrack = { buf, dur: buf.duration, cols, c: Array.from(t, v => scColor(v)) };
  return ed.ctrack;
}
function waveColor(t) {
  if (!soundColors || !ed.buf) return '#7B8597';
  const tr = colorTrack(ed.buf), i = Math.max(0, Math.min(tr.cols - 1, Math.floor(t / tr.dur * tr.cols)));
  return tr.c[i];
}

function setPageTop() { document.documentElement.style.setProperty('--page-top', Math.round($('#filters').getBoundingClientRect().top) + 'px'); }
addEventListener('resize', setPageTop);
setTimeout(setPageTop, 0);

/* ---------- Background analysis: key and tempo for every sound ---------- */
const AN_V = 1;
let anWorker = null, anId = 0, anQueue = [], anBusy = false, anDone = 0, anTotal = 0;
const anJobs = new Map(), anSave = [];
function anCall(channels, sampleRate, cmd) {
  if (!anWorker) {
    anWorker = new Worker('analysis-worker.js');
    anWorker.onmessage = e => { const p = anJobs.get(e.data.id); if (p) { anJobs.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.result); } };
  }
  const id = ++anId;
  return new Promise((res, rej) => { anJobs.set(id, { res, rej }); anWorker.postMessage({ id, channels, sampleRate, cmd }, channels.map(c => c.buffer)); });
}
// No giant queue: sounds on screen go first, then a cursor walks the whole library
let anCursor = 0, anLeft = 0;
const needsAn = r => !r.temp && r.size <= 200e6 && ktEligible(r) && !(r.meta && r.meta.an && r.meta.an.v === AN_V) && !r.anFailed;
let anAll = 0, keyTempo = false; // key and tempo detection is off unless turned on
let ktFolders = [];                // or on only for chosen folders (their sidebar keys, e.g. "D:\\SFX|Music Loops/")
const ktActive = () => keyTempo || ktFolders.length > 0;
const ktEligible = r => !isMidiRec(r) && !isVideoExt(r.ext) && (keyTempo || ktFolders.some(k => r.dkey.startsWith(k)));
function queueAnalysis() {
  if (!ktActive()) { anLeft = 0; updateAnStatus(); return; }
  anCursor = 0; anLeft = 0; anAll = 0;
  for (const r of files) { if (r.size <= 200e6 && !r.temp && ktEligible(r)) anAll++; if (needsAn(r)) anLeft++; }
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
  return { v: AN_V, key: res.key, bpm: res.bpm };
}
function updateAnStatus() {
  const el = $('#anstat');
  if (anBusy && anLeft > 0) {
    // overall progress for the whole library, kept across restarts
    const total = anAll, done = Math.max(0, total - anLeft), pct = total ? Math.floor(done / total * 1000) / 10 : 0;
    el.textContent = `Key and tempo: ${done.toLocaleString()} of ${total.toLocaleString()} analyzed (${pct}%)` + (bgPaused ? ' · paused' : '');
    el.title = bgPaused ? 'Click to continue listening' : 'Results are saved as they come in and kept when you close the app or update it. Click to pause.'; el.style.display = ''; }
  else el.style.display = 'none';
  syncBgPause();
}
async function pumpAnalysis() {
  if (anBusy) return;
  anBusy = true;
  let sinceRefresh = 0, r;
  while (ktActive() && (r = nextToAnalyze())) {
    if (bgPaused) { updateAnStatus(); await bgWaitWhilePaused(); if (!ktActive()) break; }
    let an;
    try { an = await analyzeRecord(r); } catch (e) { an = { v: AN_V, err: 1 }; }
    r.meta = Object.assign(r.meta || {}, { an });
    refreshRecord(r);
    anDone++; anLeft = Math.max(0, anLeft - 1);
    anSave.push({ path: r.path, size: r.size, mtime: r.mtime, an });
    if (anSave.length >= 5) sb.saveAnalysis(anSave.splice(0)); // saved in small batches so a restart loses nothing
    bgRefresh(!!(keyFilter || $('#bpmMin').value || $('#bpmMax').value));
    updateAnStatus();
    await bgYield();
    if (bgPaused) { updateAnStatus(); await bgWaitWhilePaused(); }
  }
  if (anSave.length) sb.saveAnalysis(anSave.splice(0));
  anBusy = false; anDone = 0; anTotal = 0;
  vocabDirty = true;
  applyFilter(false); updateAnStatus();
}

/* ---------- Key and tempo on or off ---------- */
function setKeyTempo(on, fromUser) {
  keyTempo = !!on;
  document.body.classList.toggle('nokt', !ktActive());
  $('#ktToggle').checked = keyTempo;
  if (!ktActive()) {
    keyFilter = ''; $('#keyF').value = ''; $('#bpmMin').value = ''; $('#bpmMax').value = '';
    if (sortKey === 'key' || sortKey === 'bpm') sortKey = 'name';
  }
  applyCols();
  if (fromUser) { applyFilter(false); queueAnalysis(); saveSession(); buildSide(false); if ($('#settingsPage').classList.contains('show')) renderSettings(); }
}
$('#ktToggle').onchange = e => setKeyTempo(e.target.checked, true);
// Choose folders for key and tempo detection (right-click a folder in the sidebar)
function toggleKtFolder(key) {
  ktFolders = ktFolders.includes(key) ? ktFolders.filter(k => k !== key) : [...ktFolders, key];
  setKeyTempo(keyTempo, true);
}
const folderLabel = key => { const bar = key.indexOf('|'), root = key.slice(0, bar), rel = key.slice(bar + 1); return baseName(root) + (rel ? '/' + rel.slice(0, -1) : ''); };

// Refresh a folder: re-read it so new, changed or deleted sounds show right away
async function refreshFolder(key) {
  const bar = key.indexOf('|'), root = key.slice(0, bar), rel = key.slice(bar + 1);
  const label = folderLabel(key).split('/').pop();
  setStatus(`Refreshing ${label}…`, true);
  const r = await sb.refreshDir(root, rel);
  if (r.error) { setStatus(r.error); return; }
  const bits = [];
  if (r.added) bits.push(`${r.added} new`);
  if (r.changed) bits.push(`${r.changed} changed`);
  if (r.removed) bits.push(`${r.removed} removed`);
  setStatus(`${label} refreshed: ${bits.length ? bits.join(', ') : 'no changes'} (${r.total.toLocaleString()} sounds).`, true);
  setTimeout(() => { if ($('#status').textContent.includes('refreshed')) setStatus(''); }, 6000);
}
/* Right-click menu for folders */
const fmenu = $('#fmenu'); let fmenuKey = null;
$('#side').addEventListener('contextmenu', e => {
  const el = e.target.closest('.dir'); if (!el || !el.dataset.d) return;
  e.preventDefault();
  fmenuKey = el.dataset.d;
  const on = ktFolders.includes(fmenuKey), inherited = !on && ktFolders.some(k => fmenuKey.startsWith(k));
  $('#fm-kt').textContent = keyTempo ? 'Key and tempo: on for all folders (see Settings)' : on ? 'Stop detecting key and tempo here' : inherited ? 'Key and tempo: already on (a parent folder is chosen)' : 'Detect key and tempo here';
  $('#fm-kt').classList.toggle('dis', keyTempo || inherited);
  fmenu.style.display = 'block';
  fmenu.style.left = Math.min(e.clientX, innerWidth - fmenu.offsetWidth - 8) + 'px';
  fmenu.style.top = Math.min(e.clientY, innerHeight - fmenu.offsetHeight - 8) + 'px';
});
addEventListener('click', () => { fmenu.style.display = 'none'; });
fmenu.onclick = e => {
  const a = e.target.dataset && e.target.dataset.a, k = fmenuKey; if (!a || !k) return;
  const bar = k.indexOf('|');
  if (a === 'kt' && !e.target.classList.contains('dis')) toggleKtFolder(k);
  else if (a === 'open') sb.showFolder(k.slice(0, bar), k.slice(bar + 1));
  else if (a === 'only') { dirFilter = k; buildSide(false); applyFilter(); saveSession(); }
  else if (a === 'refresh') refreshFolder(k);
};

/* ---------- ElevenLabs: generate sound effects ---------- */
let genInfo = {}, genTagsEdited = false, genBusy = false;
const STOP = new Set('a an the and or of in on at to with from for by into over under near very slowly quickly softly loud quiet some sound sounds effect effects like that this then while its it is are be being as up down out off'.split(' '));
function autoTags(text) {
  const seen = new Set(), out = [];
  for (const w of wordsOf(text)) { if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w) || seen.has(w)) continue; seen.add(w); out.push(w); if (out.length >= 6) break; }
  return ['generated', ...out];
}
async function openGen() {
  const st = await sb.eleven.status();
  $('#gen-folder').textContent = st.folder;
  $('#gen').classList.add('show');
  if (!st.hasKey) { setGenStatus(st.unreadable ? 'Your saved API key could not be unlocked. Please paste it again in Settings.' : 'Add your ElevenLabs API key in Settings first.', true); $('#gen-go').textContent = 'Open Settings'; }
  else { setGenStatus(''); $('#gen-go').textContent = 'Generate'; }
  setTimeout(() => $('#gen-text').focus(), 0);
}
const closeGen = () => $('#gen').classList.remove('show');
function setGenStatus(t, err) { const el = $('#gen-status'); el.textContent = t; el.classList.toggle('err', !!err); }
$('#genBtn').onclick = openGen;
$('#gen-close').onclick = closeGen;
$('#gen').addEventListener('mousedown', e => { if (e.target.id === 'gen' && !genBusy) closeGen(); });
$('#gen').addEventListener('keydown', e => {
  if (e.key === 'Escape' && !genBusy) closeGen();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#gen-go').click();
  e.stopPropagation();
});
$('#gen-text').addEventListener('input', () => { if (!genTagsEdited) $('#gen-tags').value = autoTags($('#gen-text').value).join(', '); });
$('#gen-tags').addEventListener('input', () => { genTagsEdited = true; });
$('#gen-auto').onchange = e => { $('#gen-durwrap').style.display = e.target.checked ? 'none' : ''; };
$('#gen-durR').oninput = e => { $('#gen-dur').value = e.target.value; };
$('#gen-dur').onchange = e => { $('#gen-durR').value = e.target.value; };
async function waitForFile(p, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (files.some(r => r.path === p)) return true; await new Promise(r => setTimeout(r, 200)); }
  return false;
}
$('#gen-go').onclick = async () => {
  if (genBusy) return;
  if ($('#gen-go').textContent === 'Open Settings') { closeGen(); showTab('settings'); $('#keyIn').focus(); return; }
  const text = $('#gen-text').value.trim();
  if (!text) { setGenStatus('Describe the sound you want first.', true); return; }
  const n = +$('#gen-n').value || 1;
  const o = { text, influence: +$('#gen-inf').value, loop: $('#gen-loop').checked, model: $('#gen-model').value, format: $('#gen-fmt').value,
    duration: $('#gen-auto').checked ? null : +$('#gen-dur').value };
  const tags = splitTags($('#gen-tags').value || autoTags(text).join(','));
  genBusy = true; $('#gen-go').disabled = true;
  setGenStatus(n > 1 ? `Generating ${n} versions…` : 'Generating…');
  saveSession();
  const results = await Promise.all(Array.from({ length: n }, () => sb.eleven.generate(o)));
  genBusy = false; $('#gen-go').disabled = false;
  const ok = results.filter(r => r && r.path), bad = results.find(r => !r || r.error);
  if (!ok.length) { setGenStatus(bad ? bad.error : 'Something went wrong.', true); return; }
  if (results.some(r => r.folderAdded)) await addFolders(results.find(r => r.folderAdded).folders);
  for (const r of ok) genInfo[r.path] = { prompt: text, model: o.model };
  setTags(ok.map(r => r.path), tags);
  const list = $('#gen-results');
  for (const r of ok) {
    const name = baseName(r.path);
    list.insertAdjacentHTML('afterbegin', `<div class="gr"><span class="n" title="${esc(r.path)}">✦ ${esc(name)}</span><button data-open="${esc(r.path)}">Open</button></div>`);
  }
  setGenStatus(`${ok.length} sound${ok.length > 1 ? 's' : ''} saved and tagged${bad ? '. One version failed: ' + bad.error : '.'}`, !!bad);
  if (await waitForFile(ok[0].path)) quickOpen(ok[0].path);
};
$('#gen-results').onclick = e => { const p = e.target.dataset && e.target.dataset.open; if (p) { closeGen(); quickOpen(p); } };

// Settings: API key and folder
async function renderEleven() {
  const st = await sb.eleven.status();
  $('#genFolderPath').textContent = st.folder;
  const ks = $('#keyStatus'); ks.className = 'lead2';
  ks.textContent = st.hasKey ? `A key ending in …${st.last4} is saved. It is protected by ${isMac ? 'your Mac Keychain' : 'Windows'} for your user account only.`
    : st.unreadable ? 'A key was saved before, but it could not be unlocked on this computer. Please paste it again once.' : 'No key saved yet.';
  if (st.unreadable) ks.classList.add('err');
  $('#keyRemove').style.display = st.hasKey || st.unreadable ? '' : 'none';
}
$('#getKey').onclick = () => sb.eleven.openSite();
$('#keySave').onclick = async () => {
  const k = $('#keyIn').value.trim(); if (!k) { $('#keyIn').focus(); return; }
  await sb.eleven.setKey(k); $('#keyIn').value = '';
  await renderEleven();
  $('#keyTest').click();
};
$('#keyTest').onclick = async () => {
  const ks = $('#keyStatus'); ks.className = 'lead2'; ks.textContent = 'Testing…';
  const r = await sb.eleven.test();
  ks.className = 'lead2 ' + (r.ok ? 'ok' : 'err'); ks.textContent = r.message;
};
$('#keyRemove').onclick = async () => { if (confirm('Remove the saved ElevenLabs API key from this computer?')) { await sb.eleven.setKey(''); renderEleven(); } };
$('#keyIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('#keySave').click(); e.stopPropagation(); });
$('#genFolderChange').onclick = async () => { $('#genFolderPath').textContent = await sb.eleven.chooseFolder(); };

/* ---------- Mac: Finder instead of Explorer, and the right words elsewhere ---------- */
let isMac = false;
function macWording(st) {
  isMac = true;
  const walk = n => {
    if (n.nodeType === 3) { if (/Explorer|Ctrl\+/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/Explorer/g, 'Finder').replace(/Ctrl\+/g, 'Cmd+'); return; }
    if (n.nodeType !== 1 || n.tagName === 'SCRIPT') return;
    if (n.title && /Explorer|Ctrl\+/.test(n.title)) n.title = n.title.replace(/Explorer/g, 'Finder').replace(/Ctrl\+/g, 'Cmd+');
    for (const c of n.childNodes) walk(c);
  };
  walk(document.body);
  const meta = document.querySelector('.about .meta');
  if (meta) meta.innerHTML = `<span id="about-ver"></span> · Mac · ${st.manualUpdates ? 'New versions are announced in the app' : 'Updates install automatically'}`;
}

/* ---------- Tabs: Library / About ---------- */
function showTab(t) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  const top = $('header').offsetHeight + 'px';
  for (const [tab, id] of [['about', '#aboutPage'], ['settings', '#settingsPage']]) {
    const el = $(id); el.style.top = top; el.classList.toggle('show', t === tab);
  }
  if (t === 'settings') { renderSettings(); renderEleven(); }
}
// Settings page
function renderSettings() {
  $('#ktList').innerHTML = ktFolders.length
    ? ktFolders.map(k => `<div class="frow"><div style="min-width:0"><div class="fn">♪ ${esc(folderLabel(k))}</div><div class="fp">${(files.filter(r => r.dkey.startsWith(k)).length).toLocaleString()} sounds, including subfolders</div></div><span></span><span></span><button data-ktrm="${esc(k)}">Remove</button></div>`).join('')
    : '<p class="lead2">No folders chosen. Right-click any folder in the sidebar and choose <b>Detect key and tempo here</b>.</p>';
  const counts = new Map();
  for (const r of files) counts.set(r.root, (counts.get(r.root) || 0) + 1);
  $('#setFolders').innerHTML = folders.length ? folders.map(f => `<div class="frow"><div style="min-width:0"><div class="fn">${esc(baseName(f))}${missing.has(f) ? ' <span style="color:#e07a5f;font-weight:400">(not found)</span>' : ''}</div><div class="fp" title="${esc(f)}">${esc(f)}</div></div>`
    + `<span class="fc">${(counts.get(f) || 0).toLocaleString()} sounds</span><button data-rescan="${esc(f)}">Rescan</button><button data-remove="${esc(f)}">Remove</button></div>`).join('')
    : '<p class="lead2">No folders yet. Add one, or drop a folder onto the window.</p>';
}
$('#setFolders').onclick = async e => {
  const rs = e.target.dataset && e.target.dataset.rescan, rm = e.target.dataset && e.target.dataset.remove;
  if (rs) { e.target.textContent = 'Rescanning…'; e.target.disabled = true; await scanRoot(rs); renderSettings(); }
  if (rm && confirm(`Remove "${baseName(rm)}" from your library?\n\nYour files are not deleted. You can add the folder again at any time.`)) {
    folders = await sb.removeFolder(rm); byRoot.delete(rm); missing.delete(rm);
    if (dirFilter.startsWith(rm + '|')) dirFilter = '';
    mergeAll(true); saveSession(); renderSettings();
  }
};
$('#ktList').onclick = e => { const k = e.target.dataset && e.target.dataset.ktrm; if (k) { toggleKtFolder(k); renderSettings(); } };
$('#setAdd').onclick = async () => { await addFolders(await sb.addFolder()); renderSettings(); };
$('#setRescanAll').onclick = async () => { await scanAll(); renderSettings(); };
$('#openData').onclick = () => sb.openDataFolder();
$('#resetLayout').onclick = () => {
  colW = { ...COL_DEF }; sideW = 250; waveH = 112; specW = 300;
  applyCols(); applySizes();
  requestAnimationFrame(() => { fitDefaultCols(); applyCols(); saveSession(); }); // measure after the sidebar is back to its size
  $('#resetLayout').textContent = 'Layout reset'; setTimeout(() => { $('#resetLayout').textContent = 'Reset columns and panel sizes'; }, 1500);
};
// the app title works as a home button
$('#home').onclick = () => { if (!genBusy) closeGen(); closeModal(); showTab('lib'); };
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
      + `<span class="wv">${miniWave(r)}</span>`
      + `<span class="nm" title="${esc(r.path)}">${esc(r.name)}</span>`
      + `<span class="dr" title="${esc(r.rootName + '/' + r.dir)}">${esc(shortDir(r))}</span>`
      + `<span class="ky${r.keyGuess ? ' guess' : ''}" title="${r.key ? (r.keyGuess ? 'Detected by listening' : 'From the file name or tags') : ''}">${r.key || ''}</span>`
      + `<span class="bp${r.bpmGuess ? ' guess' : ''}" title="${r.bpm ? (r.bpmGuess ? 'Detected by listening' : 'From the file name or tags') : ''}">${r.bpm || ''}</span>`
      + `<span class="tp">${r.ext.toUpperCase()}</span>`
      + `<span class="fm">${fmtFormat(r.meta)}</span>`
      + `<span class="du">${fmtDur(r.dur)}</span>`
      + `<span class="sz">${fmtSize(r.size)}</span></div>`;
  }
  spacer.innerHTML = html;
}
listEl.addEventListener('scroll', () => { lastInput = performance.now(); $('#colwrap').scrollLeft = listEl.scrollLeft; render(); saveSession(); });
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
  else if (a === 'convert') openConvert(r);
  else if (a === 'tagall') openTagAll();
};

function toggleFav(r) {
  if (!r || r.temp) return;
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
const audioEl = $('#player');
let player = audioEl;          // the audio element, or the MIDI player when a MIDI file is open (same controls)
let actx = null, masterGain = null, bus = null, analyser = null;
// Everything that plays goes through one bus: bus -> analyser (spectrum) and bus -> volume -> speakers
function ac() {
  if (!actx) {
    actx = new AudioContext();
    bus = actx.createGain();
    masterGain = actx.createGain(); masterGain.gain.value = +$('#vol').value;
    analyser = actx.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0.72; analyser.minDecibels = -120; analyser.maxDecibels = 0;
    bus.connect(analyser); bus.connect(masterGain); masterGain.connect(actx.destination);
    actx.createMediaElementSource(audioEl).connect(bus);
  }
  return actx;
}
$('#vol').oninput = e => { if (masterGain) masterGain.gain.value = +e.target.value; saveSession(); };
const syncLoopBtn = () => $('#loopBtn').classList.toggle('on', $('#loop').checked);
const toggleLoop = () => { const l = $('#loop'); l.checked = !l.checked; l.dispatchEvent(new Event('change')); };
$('#loop').onchange = e => { player.loop = e.target.checked; if (eSrc) eSrc.loop = e.target.checked; syncLoopBtn(); saveSession(); };
$('#loopBtn').onclick = toggleLoop;
let blobUrl = null, loadToken = 0;

async function getBuffer(r) {
  const res = await fetch(sb.fileUrl(r.path));
  if (!res.ok) throw new Error('Could not open this file. It may have been moved or deleted.');
  return res.arrayBuffer();
}

/* Editor state. Times are in seconds of the original sound. */
const ed = { buf: null, selA: 0, selB: 0, speed: 1, semis: 0, tape: false, gain: 0, fadeIn: 0, fadeOut: 0, reverse: false, normalize: false, nr: 0, noise: null, noiseId: 0, clean: '', cleanAuto: null, af: false, afBusy: false, afReport: '', cleanNote: '', maxDb: 0, ceiling: -0.3, limitDb: 0, place: '', placeAmt: 1, eq: EQ_BANDS.map(() => 0), eqOn: false, eqMode: 'graphic', peq: PEQ_DEFAULT(), stage: null,
  orig: null, specOps: [], specUndo: [], specSel: [], specVer: 0, tool: '', brushPx: 14, specAct: 'heal', specDb: 12, previewAt: -1,
  out: null, outBuf: null, outPeak: 0, path: null, name: '', rendering: false };
const zoom = { t0: 0, t1: 0 };
const hasSel = () => !videoDoc && ed.selB - ed.selA > 0.001;   // a video keeps its full length, so its sound stays in sync
const eqActive = () => ed.eqOn && (ed.eqMode === 'param' ? peqActive(ed.peq) : ed.eq.some(g => g));
const eqSetting = () => ed.eqMode === 'param' ? ed.peq : ed.eq;
const curCoefs = sr => ed.eqMode === 'param' ? peqCoefs(ed.peq, sr) : eqCoefs(ed.eq, sr);
const paramsChanged = () => ed.specOps.length > 0 || eqActive() || !!ed.place || ed.maxDb > 0 || !!ed.clean || ed.speed !== 1 || ed.semis !== 0 || ed.gain !== 0 || ed.fadeIn > 0 || ed.fadeOut > 0 || ed.reverse || ed.normalize;
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
  $('#np-dir').textContent = (r.temp ? r.rootName + '  ·  Quick edit, not in your library' : r.rootName + '/' + r.dir) + (genInfo[r.path] ? `  ·  ✦ "${genInfo[r.path].prompt}"` : '');
  showTags();
  setStatus('');
  resetEdit(false);
  ed.out = ed.outBuf = ed.path = null;
  ed.buf = null; peaks = null; zoom.t0 = 0; zoom.t1 = r.dur || 0; fz.a = 0; fz.b = 1; waveCache = null;
  midiDoc = null; player = isMidiRec(r) ? midiPlayer : audioEl;
  document.body.classList.toggle('midimode', isMidiRec(r));
  closeVideo();
  drawWave(); drawResult(); updateClip();
  if (isMidiRec(r)) { loadMidi(r, play, t); return; }
  if (isVideoExt(r.ext) || (r.ext === 'webm' && r.meta && r.meta.video)) { loadVideo(r, play, t); return; }
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
    ed.buf = ab; ed.orig = ab;
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

/* ---------- Video: fix the sound of a video, keep the picture untouched ---------- */
// The soundtrack is read out of the video, edited like any sound, then written back into a copy of the
// video. The picture's packets are copied as they are (no re-encoding), so it keeps its exact quality.
let videoDoc = null, mbMod = null, mp3Registered = false;
async function mb() { return mbMod || (mbMod = await import('./vendor/mediabunny/mediabunny.min.mjs')); }
function rangeSource(M, r) {
  return new M.CustomSource({ getSize: () => r.size, read: async (a, b) => new Uint8Array(await sb.readRange(r.path, a, b)), maxCacheSize: 64 << 20 });
}
function closeVideo() {
  videoDoc = null;
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  document.body.classList.remove('videomode');
  const v = $('#vprev'); if (v && v.src) { v.pause(); v.removeAttribute('src'); v.load(); }
  $('#saveEdit').textContent = 'Save next to original';
}
async function loadVideo(r, play, t) {
  const M = await mb();
  setStatus('Reading the sound from the video…', true);
  let input = null, ab, info;
  try {
    input = new M.Input({ source: rangeSource(M, r), formats: M.ALL_FORMATS });
    const vt = await input.getPrimaryVideoTrack(), tracks = await input.getAudioTracks(), at = tracks[0];
    if (!at) { if (t === loadToken) setStatus('This video has no sound to fix.'); return; }
    const dur = await input.computeDuration();
    if (dur > 3 * 3600) { setStatus('This video is longer than 3 hours, too long to fix here.'); return; }
    const t0 = await at.getFirstTimestamp(), sr = at.sampleRate, nc = Math.min(2, at.numberOfChannels);
    const end = Math.max(dur, t0), len = Math.max(1, Math.round((end - t0) * sr));
    const chans = Array.from({ length: nc }, () => new Float32Array(len));
    const sink = new M.AudioBufferSink(at);
    let lastPct = -1;
    for await (const { buffer, timestamp } of sink.buffers()) {
      if (t !== loadToken) return;
      const at0 = Math.round((timestamp - t0) * sr);
      for (let c = 0; c < nc; c++) { const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)); const n = Math.min(src.length, len - at0); if (n > 0 && at0 >= 0) chans[c].set(n < src.length ? src.subarray(0, n) : src, at0); }
      const pct = Math.floor((timestamp - t0) / (end - t0) * 100);
      if (pct >= lastPct + 10) { lastPct = pct; setStatus(`Reading the sound from the video… ${pct}%`, true); }
    }
    ab = new AudioBuffer({ numberOfChannels: nc, length: len, sampleRate: sr });
    chans.forEach((c, i) => ab.copyToChannel(c, i));
    info = { t0, sr, nc, tracks: tracks.length, hasVideo: !!vt, codec: at.codec, w: vt ? vt.displayWidth : 0, h: vt ? vt.displayHeight : 0, vcodec: vt ? vt.codec : null };
  } catch (e) {
    if (t !== loadToken) return;
    // the sound could not be decoded for editing: still let it play, through the normal media player
    let codec = '';
    try { const at = input && (await input.getAudioTracks())[0]; codec = at ? (at.codec || '') : ''; } catch (_) {}
    const names = { ac3: 'Dolby Digital (AC-3)', eac3: 'Dolby Digital Plus (E-AC-3)', alac: 'Apple Lossless (ALAC)', dts: 'DTS' };
    const what = codec ? names[codec] || codec.toUpperCase() : '';
    player.src = sb.fileUrl(r.path); player.loop = $('#loop').checked;
    document.body.classList.add('videomode');
    const v = $('#vprev'); v.src = sb.fileUrl(r.path); v.muted = true;
    setStatus(`This video plays, but its sound${what ? ' is in ' + what + ', which' : ''} cannot be opened for fixing here yet${what ? '' : ' (' + (e.message || e) + ')'}.`);
    if (play) { ac().resume(); player.play().catch(() => setStatus('This video cannot be played here' + (what ? ': its sound is ' + what : '') + '.')); }
    return;
  }
  if (t !== loadToken) return;
  videoDoc = { r, ...info };
  document.body.classList.toggle('videomode', info.hasVideo);
  ed.buf = ab; ed.orig = ab;
  if (r.dur == null) { r.dur = ab.duration; render(); }
  zoom.t0 = 0; zoom.t1 = ab.duration; waveCache = null;
  peaks = computeOverview(ab);
  // play the soundtrack from memory (every video format, even uncompressed sound in MOV)
  const chs = []; for (let c = 0; c < ab.numberOfChannels; c++) chs.push(ab.getChannelData(c));
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(new Blob([encodeWav(chs, ab.sampleRate, ab.numberOfChannels)], { type: 'audio/wav' }));
  player.src = blobUrl; player.loop = $('#loop').checked;
  if (info.hasVideo) { const v = $('#vprev'); v.src = sb.fileUrl(r.path); v.muted = true; v.currentTime = 0; }
  $('#saveEdit').textContent = 'Save fixed video';
  drawWave(); updateAvg();
  setStatus(`Video${info.w ? ` ${info.w}×${info.h}` : ''} · sound ${info.sr / 1000} kHz ${info.nc === 1 ? "mono" : "stereo"}${info.tracks > 1 ? ` · ${info.tracks} audio tracks, the first one is shown` : ''}. Fix the sound, then Save fixed video: the picture is copied as it is.`, true);
  if (play) { ac().resume(); player.play().catch(() => {}); }
}
/* the video preview: docked over the spectrum (three sizes), undocked anywhere in the window, or popped out */
const vbox = $('#vbox'), DOCK_SIZES = [220, 320, 460];
let vstate = { dock: 1, float: false, x: null, y: null, w: 420 };
function applyVbox() {
  const root = document.documentElement.style;
  root.setProperty('--vdock', DOCK_SIZES[vstate.dock] + 'px');
  vbox.classList.toggle('float', vstate.float);
  if (vstate.float) {
    const W = innerWidth, H = innerHeight, w = clamp(vstate.w || 420, 200, W - 20), h = w * 9 / 16;
    const x = clamp(vstate.x == null ? W - w - 30 : vstate.x, 0, W - 80), y = clamp(vstate.y == null ? 90 : vstate.y, 0, H - 60);
    root.setProperty('--vx', x + 'px'); root.setProperty('--vy', y + 'px'); root.setProperty('--vw', w + 'px');
    vbox.style.width = w + 'px'; vbox.style.height = h + 'px';
  } else { vbox.style.width = ''; vbox.style.height = ''; }
  $('#vFloat').textContent = vstate.float ? '⊡' : '⧉';
  $('#vFloat').title = vstate.float ? 'Dock it back over the spectrum' : 'Undock: drag it anywhere in the window, resize it from the corner. Double-click it to dock it again';
  $('#vSize').style.display = vstate.float ? 'none' : '';
}
$('#vSize').onclick = e => { e.stopPropagation(); vstate.dock = (vstate.dock + 1) % DOCK_SIZES.length; applyVbox(); saveSession(); };
$('#vFloat').onclick = e => { e.stopPropagation(); vstate.float = !vstate.float; applyVbox(); saveSession(); };
$('#vPip').onclick = async e => {
  e.stopPropagation();
  try { await $('#vprev').requestPictureInPicture(); vbox.classList.add('away'); }
  catch (err) { setStatus('This video cannot pop out: ' + err.message); }
};
$('#vBack').onclick = () => { if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {}); };
$('#vprev').addEventListener('leavepictureinpicture', () => vbox.classList.remove('away'));
vbox.addEventListener('dblclick', e => { if (vstate.float && !e.target.closest('button')) { vstate.float = false; applyVbox(); saveSession(); } });
// move it by dragging; the bottom-right corner resizes it (and the size is kept)
vbox.addEventListener('mousedown', e => {
  if (!vstate.float || e.button !== 0 || e.target.closest('button')) return;
  const r = vbox.getBoundingClientRect();
  if (e.clientX > r.right - 18 && e.clientY > r.bottom - 18) {           // the resize corner
    const up = () => { removeEventListener('mouseup', up); vstate.w = vbox.getBoundingClientRect().width; vbox.style.height = (vstate.w * 9 / 16) + 'px'; saveSession(); };
    addEventListener('mouseup', up); return;
  }
  e.preventDefault();
  const dx = e.clientX - r.left, dy = e.clientY - r.top;
  const mv = ev => { vstate.x = ev.clientX - dx; vstate.y = ev.clientY - dy; applyVbox(); };
  const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); saveSession(); };
  addEventListener('mousemove', mv); addEventListener('mouseup', up);
});
addEventListener('resize', () => { if (vstate.float) applyVbox(); });
applyVbox();
// the preview follows playback (original or edit: same timeline, since a video keeps its length)
function syncVideoPreview() {
  if (!videoDoc || !videoDoc.hasVideo) return;
  const v = $('#vprev'); if (!v.src) return;
  const playing = !player.paused || !!eSrc;
  const t = eSrc ? editPos() * ed.speed : player.currentTime;
  if (Math.abs(v.currentTime - t) > (playing ? 0.15 : 0.02)) v.currentTime = t;
  if (playing && v.paused) v.play().catch(() => {}); else if (!playing && !v.paused) v.pause();
}
setInterval(syncVideoPreview, 120);
// MP4 sound when the computer has no AAC encoder: MP3 frames from the LAME encoder
async function registerMp3(M) {
  if (mp3Registered) return; mp3Registered = true;
  const { Mp3Encoder } = await import('./vendor/lame.mjs');
  const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], RATES = [44100, 48000, 32000];
  class LameEncoder extends M.CustomAudioEncoder {
    static supports(codec) { return codec === 'mp3'; }
    init() { const c = this.config; this.sr = c.sampleRate; this.nc = Math.min(2, c.numberOfChannels); this.enc = new Mp3Encoder(this.nc, this.sr, 320); this.pend = new Uint8Array(0); this.frames = 0; }
    pushBytes(b) {
      if (!b || !b.length) return;
      const all = new Uint8Array(this.pend.length + b.length); all.set(this.pend); all.set(b, this.pend.length);
      let i = 0;
      while (i + 4 <= all.length) {
        if (all[i] !== 0xff || (all[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
        const br = BITRATES[(all[i + 2] >> 4) & 15] * 1000, sr = RATES[(all[i + 2] >> 2) & 3], pad = (all[i + 2] >> 1) & 1;
        if (!br || !sr) { i++; continue; }
        const flen = Math.floor(144 * br / sr) + pad;
        if (i + flen > all.length) break;
        const pkt = new M.EncodedPacket(all.slice(i, i + flen), 'key', this.frames * 1152 / this.sr, 1152 / this.sr);
        this.onPacket(pkt, this.frames === 0 ? { decoderConfig: { codec: 'mp3', sampleRate: this.sr, numberOfChannels: this.nc } } : undefined);
        this.frames++; i += flen;
      }
      this.pend = all.slice(i);
    }
    encode(sample) {
      const n = sample.numberOfFrames, toI16 = f => { const o = new Int16Array(n); for (let k = 0; k < n; k++) { const v = Math.round(f[k] * 32767); o[k] = v > 32767 ? 32767 : v < -32768 ? -32768 : v; } return o; };
      const L = new Float32Array(n); sample.copyTo(L, { planeIndex: 0, format: 'f32-planar' });
      let R = null; if (this.nc > 1) { R = new Float32Array(n); sample.copyTo(R, { planeIndex: Math.min(1, sample.numberOfChannels - 1), format: 'f32-planar' }); }
      this.pushBytes(R ? this.enc.encodeBuffer(toI16(L), toI16(R)) : this.enc.encodeBuffer(toI16(L)));
    }
    flush() { this.pushBytes(this.enc.flush()); }
    close() {}
  }
  M.registerEncoder(LameEncoder);
}
async function saveVideo() {
  if (!videoDoc || !current || !ed.out) return;
  const M = await mb(), r = videoDoc.r, sr = videoDoc.sr, out = ed.out, nc = out.length;
  const fmt = r.ext === 'mov' ? new M.MovOutputFormat() : r.ext === 'webm' ? new M.WebMOutputFormat() : r.ext === 'mkv' ? new M.MkvOutputFormat() : new M.Mp4OutputFormat();
  // the sound codec: what the container expects and this computer can write
  let codec, bitrate;
  if (r.ext === 'mov') { codec = 'pcm-s16'; }
  else if (r.ext === 'webm' || r.ext === 'mkv') { codec = 'opus'; bitrate = 192000; }
  else if (await M.canEncodeAudio('aac', { numberOfChannels: nc, sampleRate: sr, bitrate: 256000 })) { codec = 'aac'; bitrate = 256000; }
  else { await registerMp3(M); codec = 'mp3'; bitrate = 320000; }
  const lead = codec === 'mp3' ? 1105 : 0;   // the MP3 encoder and decoder delay: start that much later so the sound lands in sync
  const id = await sb.videoOpen(r.path);
  if (!id) { setStatus('Could not save next to the original.'); return; }
  let ok = false;
  $('#saveEdit').disabled = true;
  try {
    const input = new M.Input({ source: rangeSource(M, r), formats: M.ALL_FORMATS });
    const first = (await input.getAudioTracks())[0];
    const target = new M.StreamTarget(new WritableStream({ write: c => sb.videoWrite(id, c.position, c.data) }), { chunked: true });
    const output = new M.Output({ format: fmt, target });
    const conv = await M.Conversion.init({
      input, output,
      video: { forceTranscode: false },
      audio: track => track !== first ? {} : {
        codec, bitrate, forceTranscode: true, numberOfChannels: nc, sampleRate: sr,
        process: sample => {
          const n = sample.numberOfFrames, at = Math.round((sample.timestamp - videoDoc.t0) * sr) + lead;
          const data = new Float32Array(n * nc);
          for (let c = 0; c < nc; c++) { const ch = out[c]; for (let k = 0; k < n; k++) { const j = at + k; data[c * n + k] = j >= 0 && j < ch.length ? ch[j] : 0; } }
          const o = new M.AudioSample({ data, format: 'f32-planar', numberOfChannels: nc, sampleRate: sr, timestamp: sample.timestamp });
          sample.close();
          return o;
        }
      }
    });
    if (!conv.isValid) throw new Error('this video cannot be rewritten (' + conv.discardedTracks.map(d => d.reason).join(', ') + ')');
    conv.onProgress = p => setStatus(`Saving the fixed video… ${Math.round(p * 100)}%`, true);
    await conv.execute();
    ok = true;
  } catch (e) {
    setStatus('The video could not be saved: ' + (e.message || e));
  } finally {
    const dest = await sb.videoClose(id, ok);
    $('#saveEdit').disabled = !ed.path;
    if (ok && dest) setStatus(`Saved ${baseName(dest)}: the picture is untouched, the sound is your fix (${codec === 'pcm-s16' ? 'uncompressed' : codec.toUpperCase()}).`, true);
  }
}

/* ---------- MIDI: the notes drawn as a piano roll, played by a built-in General MIDI synth ---------- */
let midiDoc = null, midiBytes = null, midiEng = null, midiEngLoading = null;
async function midiEngine() {
  if (midiEng) return midiEng;
  if (midiEngLoading) return midiEngLoading;
  midiEngLoading = (async () => {
    const c = ac();
    const mod = await import('./vendor/spessasynth/spessasynth.mjs');
    await c.audioWorklet.addModule('vendor/spessasynth/spessasynth_processor.min.js');
    const synth = new mod.WorkletSynthesizer(c);
    midiDelay = makeDelay(c); synth.connect(midiDelay.input); midiDelay.output.connect(bus); midiDelay.set();
    await synth.isReady;
    await loadMidiBank(synth, midiBankPath);
    synth.eventHandler.addEvent('presetListChange', 'sonalogue', () => buildMidiPanel());
    const seq = new mod.Sequencer(synth, { skipToFirstNoteOn: false });
    seq.loopCount = 0;
    seq.eventHandler.addEvent('songEnded', 'sonalogue', () => {
      if (midiPlayer.paused) return;
      if (midiPlayer.loop) { seq.currentTime = 0; seq.play(); return; }
      midiPlayer.paused = true; midiPlayer._pos = 0; clearInterval(midiPlayer._timer);
      if (midiPlayer.onended) midiPlayer.onended();
    });
    midiEng = { synth, seq, loadedFor: null };
    return midiEng;
  })();
  try { return await midiEngLoading; } finally { midiEngLoading = null; }
}
const midiPlayer = {
  isMidi: true, paused: true, loop: false, src: '', volume: 1, _pos: 0, _dur: 0, _timer: 0, _want: 0,
  get duration() { return this._dur; },
  get currentTime() { return !this.paused && midiEng ? Math.min(this._dur, midiEng.seq.currentTime) : this._pos; },
  set currentTime(v) { this._pos = Math.max(0, Math.min(this._dur, v || 0)); if (!this.paused && midiEng) midiEng.seq.currentTime = this._pos; },
  async play() {
    if (!midiBytes || !current) return;
    const want = ++this._want, path = current.path;
    if (!midiEng) setStatus('Loading the MIDI instruments…', true);
    let e;
    try { e = await midiEngine(); } catch (err) { setStatus('The MIDI player could not start: ' + err.message); return; }
    if (want !== this._want || !current || current.path !== path) return;
    if (e.loadedFor !== path) {
      e.seq.loadNewSongList([{ binary: midiBytes.slice(0), fileName: current.name }]);
      e.loadedFor = path;
      for (let i = 0; i < 100 && !(e.seq.duration > 0); i++) await new Promise(r => setTimeout(r, 20));
      if (want !== this._want) return;
      midiInfoStatus();
    }
    applyMidiParts(); applyMidiFx();
    ac().resume();
    e.seq.playbackRate = midiRate;
    e.seq.currentTime = this._pos;
    e.seq.play();
    this.paused = false;
    clearInterval(this._timer); this._timer = setInterval(() => { if (this.ontimeupdate) this.ontimeupdate(); }, 250);
    if (this.onplay) this.onplay();
  },
  pause() {
    this._want++;
    if (this.paused) return;
    if (midiEng) { this._pos = Math.min(this._dur, midiEng.seq.currentTime); midiEng.seq.pause(); midiEng.synth.stopAll(true); } // silence at once, no ringing tails
    this.paused = true; clearInterval(this._timer);
    if (this.onpause) this.onpause();
  }
};
async function loadMidi(r, play, t) {
  try {
    const buf = await getBuffer(r);
    if (t !== loadToken) return;
    midiBytes = new Uint8Array(buf);
    midiDoc = parseMidi(midiBytes);
  } catch (e) { if (t === loadToken) setStatus('This MIDI file could not be read: ' + e.message); return; }
  midiPlayer._dur = midiDoc.dur; midiPlayer._pos = 0; midiPlayer.loop = $('#loop').checked;
  midiRate = 1; syncMidiTempo();
  midiByCh(midiDoc); bendHeld = null; midiTrans = 0; if (modHeld != null && modHeld !== 0) modHeld = null; if (midiNoMod) modHeld = 0; syncWheels();
  if (midiEng) midiEng.loadedFor = null;
  zoom.t0 = 0; zoom.t1 = midiDoc.dur; midiRollCache = null;
  if (r.dur == null) { r.dur = midiDoc.dur; render(); }
  drawWave(); updateTime(); drawSpectrum();
  midiInfoStatus();
  buildMidiPanel(); syncBankLabel();
  if (play) midiPlayer.play();
  else midiEngine().then(buildMidiPanel).catch(() => {});   // get the instruments ready while you look
}
/* ---------- Instruments for each part, and your own sound bank ---------- */
let midiLock = '', midiBankPath = '', midiNoMod = false, midiRev = 0, midiCho = 0;   // dry by default: the synth's reverb tail wavers                 // '' = the built-in GeneralUser GS bank
const midiParts = new Map();           // per file: { all: 'bank:prog', ch: { [n]: { p, mute } } }
const partsOf = () => { const k = current && current.path; if (!midiParts.has(k)) midiParts.set(k, { all: '', ch: {} }); return midiParts.get(k); };
async function bankBuffer(p) {
  if (p) {
    try { const res = await fetch(sb.fileUrl(p)); if (!res.ok) throw new Error('missing'); return [await res.arrayBuffer(), p]; }
    catch (e) { setStatus('Your sound bank could not be opened, so the built-in sounds are used.'); }
  }
  const sf = await sb.readAsset('sounds/GeneralUser-GS.sf2');
  return [sf.buffer.slice(sf.byteOffset, sf.byteOffset + sf.byteLength), ''];
}
async function loadMidiBank(synth, p) {
  let buf; [buf, p] = await bankBuffer(p);
  await synth.soundBankManager.addSoundBank(buf, 'main');
  midiBankPath = p;
  syncBankLabel();
}
function syncBankLabel() {
  const el = $('#mpBank'); if (!el) return;
  el.innerHTML = 'Sound bank: <b>' + (midiBankPath ? esc(baseName(midiBankPath)) : 'GeneralUser GS (built-in)') + '</b>';
  $('#mpBankReset').style.display = midiBankPath ? '' : 'none';
}
async function setMidiBank(p) {
  midiBankPath = p || ''; saveSession(); syncBankLabel();
  if (!midiEng) return;
  const wasPlaying = !midiPlayer.paused;
  if (wasPlaying) midiPlayer.pause();
  setStatus('Loading the sound bank…', true);
  await loadMidiBank(midiEng.synth, midiBankPath);
  midiEng.loadedFor = null;       // reload the song so every part picks its sound from the new bank
  midiInfoStatus();
  if (wasPlaying) midiPlayer.play();
}
$('#mpBankPick').onclick = async () => { const p = await sb.pickSoundBank(); if (p) setMidiBank(p); };
$('#mpBankReset').onclick = () => setMidiBank('');
// the instruments on offer: what the loaded bank has (General MIDI names until it is loaded)
function presetOptions(drums) {
  const list = midiEng && midiEng.synth.presetList && midiEng.synth.presetList.length ? midiEng.synth.presetList : null;
  if (!list) {
    if (drums) return [['128:0', 'Standard kit'], ['128:8', 'Room kit'], ['128:16', 'Power kit'], ['128:24', 'Electronic kit'], ['128:25', 'TR-808 kit'], ['128:32', 'Jazz kit'], ['128:40', 'Brush kit'], ['128:48', 'Orchestra kit']];
    return GM_NAMES.map((n, i) => ['0:' + i, (i + 1) + ' ' + n]);
  }
  const out = [], seen = new Set();
  for (const pr of list) {
    const isDrum = !!pr.isGMGSDrum || pr.bankMSB === 128;
    if (isDrum !== !!drums) continue;
    const v = (isDrum ? 128 : pr.bankMSB) + ':' + pr.program;
    if (seen.has(v)) continue; seen.add(v);
    out.push([v, (isDrum ? '' : (pr.bankMSB ? pr.bankMSB + '/' : '') + (pr.program + 1) + ' ') + pr.name, pr.bankMSB, pr.program]);
  }
  return out.sort((a, b) => (a[2] - b[2]) || (a[3] - b[3]));
}
function buildMidiPanel() {
  if (!midiDoc) { $('#mpParts').innerHTML = ''; return; }
  // what the file does besides notes
  const k = midiDoc.controls || {}, parts = list => list.length > 6 ? list.length + ' parts' : (list.length === 1 ? 'part ' : 'parts ') + list.join(', ');
  const bits = [];
  if (k.mod) bits.push(`mod wheel <b>${k.mod.toLocaleString()}×</b> (${parts(k.modCh)})`);
  if (k.bend) bits.push(`pitch bend <b>${k.bend.toLocaleString()}×</b> (${parts(k.bendCh)})`);
  if (k.pressure) bits.push(`aftertouch <b>${k.pressure.toLocaleString()}×</b> (${parts(k.pressCh || [])})`);
  $('#mpMsgs').innerHTML = bits.length ? 'This file uses ' + (bits.length > 2 ? bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1] : bits.join(' and ')) : 'No mod wheel, pitch bend or aftertouch in this file';
  $('#mpNoMod').checked = midiNoMod;
  const ps = partsOf(), mel = presetOptions(false), kits = presetOptions(true);
  const opt = (list, sel) => list.map(([v, n]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');
  $('#mpAll').innerHTML = `<option value="">As written</option>` + opt(mel, midiLock || ps.all);
  $('#mpLock').classList.toggle('on', !!midiLock); $('#mpLock').textContent = midiLock ? 'Locked' : 'Lock';
  const trIdx = new Map(); midiDoc.tracks.forEach((t, i) => trIdx.set(t.i, i));
  $('#mpParts').innerHTML = midiDoc.channels.map(c => {
    const o = ps.ch[c.ch] || {}, color = c.drums ? '#9AA3B4' : ROLL_COLORS[(trIdx.get(c.track) ?? c.ch) % ROLL_COLORS.length];
    const written = c.drums ? 'Drums' : GM_NAMES[c.program] || 'Program ' + (c.program + 1);
    return `<div class="mp-part${o.mute ? ' muted' : ''}" data-ch="${c.ch}"><i style="background:${color}"></i><span class="nm" title="${c.name ? esc(c.name) + ' · ' : ''}channel ${c.ch + 1} · written for ${esc(written)} · ${c.notes} notes">${esc(c.name || written)}<small>ch ${c.ch + 1}</small></span>`
      + `<select data-ch="${c.ch}" title="Instrument for this part">`
      + `<option value="">${c.drums ? 'Drums (as written)' : esc(written)}</option>${opt(c.drums ? kits : mel, o.p || '')}</select>`
      + `<button data-mute="${c.ch}" class="${o.mute ? 'on' : ''}" title="Mute this part">M</button></div>`;
  }).join('');
}
function applyMidiParts() {
  if (!midiEng || !midiDoc) return;
  const s = midiEng.synth, ps = partsOf();
  for (const c of midiDoc.channels) {
    const mc = s.midiChannels[c.ch]; if (!mc) continue;
    const o = ps.ch[c.ch] || {}, pick = o.p || (!c.drums && (midiLock || ps.all)) || '';
    mc.setSystemParameter('presetLock', false);
    const [bank, prog] = pick ? pick.split(':').map(Number) : [c.drums ? 128 : 0, c.drums ? 0 : c.program];
    if (pick || !midiPlayer.paused) { s.controllerChange(c.ch, 0, bank === 128 ? 0 : bank); s.programChange(c.ch, prog); }
    if (pick) mc.setSystemParameter('presetLock', true);
    mc.setSystemParameter('isMuted', !!o.mute);
  }
  applyMidiWheels();
}
$('#mpNoMod').onchange = e => { setModHeld(e.target.checked ? 0 : null); };
/* ---------- Beside the piano roll: the mod wheel and transpose ----------
   The mod wheel shows what the file does as it plays. Grab it to take over; it stays until you hand it back to the file.
   (The file's pitch bend is shown as a lane under the notes. Holding the bend is kept in code but has no knob.) */
let modHeld = null, bendHeld = null, midiTrans = 0;
function midiByCh(doc) {
  const split = ev => { const m = new Map(); for (const e of ev || []) { if (!m.has(e.ch)) m.set(e.ch, []); m.get(e.ch).push(e); } return m; };
  doc.modCh = split(doc.modLane); doc.bendCh = split(doc.bendLane); doc.pressCh = split(doc.pressLane);
}
function laneAt(list, t, dflt) {   // the value in force at time t (it holds until the next change)
  if (!list || !list.length || list[0].t > t) return dflt;
  let lo = 0, hi = list.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].t <= t) lo = m; else hi = m - 1; }
  return list[lo].v;
}
function fileMod(t) { let v = 0; if (midiDoc && midiDoc.modCh) for (const l of midiDoc.modCh.values()) v = Math.max(v, laneAt(l, t, 0)); return v; }
function fileBend(t) { let v = 0; if (midiDoc && midiDoc.bendCh) for (const l of midiDoc.bendCh.values()) { const x = laneAt(l, t, 0); if (Math.abs(x) > Math.abs(v)) v = x; } return v; }
function applyMidiWheels(s = midiEng && midiEng.synth, render = false) {
  if (!s || !midiDoc) return;
  if (!render) s.setSystemParameter('keyShift', midiTrans);   // drums are never transposed (a render gets it from the snapshot)
  for (let ch = 0; ch < 16; ch++) {
    const mc = s.midiChannels[ch]; if (!mc) continue;
    mc.lockController(1, false);
    if (modHeld != null) { s.controllerChange(ch, 1, modHeld); mc.lockController(1, true); }
    // "No vibrato" also holds aftertouch at 0: a General MIDI synth plays aftertouch as vibrato too
    mc.lockMIDIParameter('pressure', false);
    if (modHeld === 0) { s.channelPressure(ch, 0); mc.lockMIDIParameter('pressure', true); }
    mc.lockMIDIParameter('pitchWheel', false);
    if (bendHeld != null) { s.pitchWheel(ch, bendHeld + 8192); mc.lockMIDIParameter('pitchWheel', true); }
  }
}
// hand a wheel back to the file: it picks up the file's value right away, not at the file's next move
function releaseToFile(which) {
  if (!midiEng || !midiDoc) return;
  const s = midiEng.synth, t = player.currentTime || 0;
  for (let ch = 0; ch < 16; ch++) {
    const mc = s.midiChannels[ch]; if (!mc) continue;
    if (which === 'mod') { mc.lockController(1, false); s.controllerChange(ch, 1, laneAt(midiDoc.modCh && midiDoc.modCh.get(ch), t, 0)); mc.lockMIDIParameter('pressure', false); s.channelPressure(ch, laneAt(midiDoc.pressCh && midiDoc.pressCh.get(ch), t, 0)); }
    else { mc.lockMIDIParameter('pitchWheel', false); s.pitchWheel(ch, laneAt(midiDoc.bendCh && midiDoc.bendCh.get(ch), t, 0) + 8192); }
  }
}
function setModHeld(v) {
  const was = modHeld; modHeld = v;
  midiNoMod = v === 0; saveSession();
  if (v == null) { if (was != null) releaseToFile('mod'); } else applyMidiWheels();
  syncWheels();
}
function setBendHeld(v) { bendHeld = v; if (v == null) releaseToFile('bend'); else applyMidiWheels(); syncWheels(); }
function setTranspose(n) {
  midiTrans = clamp(Math.round(+n || 0), -24, 24);
  if (midiEng) midiEng.synth.setSystemParameter('keyShift', midiTrans);
  midiRollCache = null; drawWave(); syncWheels();
}
const knobAt = (el, f) => { el.style.top = `calc((100% - 16px) * ${(1 - clamp(f, 0, 1)).toFixed(4)})`; };
function syncWheels() {
  if (!midiDoc) return;
  const t = player.currentTime || 0, fm = fileMod(t), fb = fileBend(t);
  const m = modHeld != null ? modHeld : fm, b = bendHeld != null ? bendHeld : fb;
  knobAt($('#whMod .wknob'), m / 127); knobAt($('#whMod .wfile'), fm / 127);
  $('#whMod').classList.toggle('held', modHeld != null);
  $('#whModV').textContent = m;
  $('#whMod0').classList.toggle('on', modHeld === 0);
  $('#whFollow').classList.toggle('on', modHeld == null);
  $('#whFollow').title = modHeld == null ? 'The mod wheel follows the file' : `You are holding the mod wheel at ${modHeld}, so the file's mod wheel is ignored. Click to hand it back to the file.`;
  $('#mpTrans').value = midiTrans;
  $('#mpNoMod').checked = modHeld === 0;
}
for (const [id, which] of [['#whMod', 'mod']]) {
  const tr = $(id + ' .wtr');
  const at = e => { const r = tr.getBoundingClientRect(); return clamp(1 - (e.clientY - r.top - 8) / Math.max(1, r.height - 16), 0, 1); };
  const set = e => { const f = at(e); if (which === 'mod') { modHeld = Math.round(f * 127); applyMidiWheels(); syncWheels(); } else setBendHeld(Math.round(f * 16383) - 8192); };
  tr.onpointerdown = e => { if (e.button) return; tr.setPointerCapture(e.pointerId); tr.classList.add('drag'); set(e); };
  tr.onpointermove = e => { if (tr.hasPointerCapture(e.pointerId)) set(e); };
  tr.onpointerup = tr.onpointercancel = e => {
    tr.classList.remove('drag');
    if (which === 'bend') setBendHeld(null); else setModHeld(modHeld);   // the mod wheel stays where you left it
  };
  tr.ondblclick = () => { if (which === 'mod') setModHeld(null); };
}
$('#whMod0').onclick = () => setModHeld(modHeld === 0 ? null : 0);
$('#whFollow').onclick = () => setModHeld(null);
$('#mpTrans').onchange = e => setTranspose(e.target.value);
$('#mpTrans').ondblclick = () => setTranspose(0);
$('#whTdn').onclick = () => setTranspose(midiTrans - 1);
$('#whTup').onclick = () => setTranspose(midiTrans + 1);
// tempo: the file's own BPM is the starting point; the slider plays it slower or faster (25% to 200%)
let midiRate = 1;
const midiBaseBpm = () => (midiDoc && midiDoc.bpm) || 120;
function syncMidiTempo() {
  $('#mpTempo').value = Math.round(midiRate * 100);
  $('#mpBpm').value = Math.round(midiBaseBpm() * midiRate);
  $('#mpTempo').title = `${Math.round(midiRate * 100)}% of the file's ${Math.round(midiBaseBpm())} BPM · double-click to go back to it`;
  if (midiEng) midiEng.seq.playbackRate = midiRate;
  syncDelayUi(); if (midiDelay) midiDelay.set();
}
function setMidiRate(r) { midiRate = clamp(r, 0.25, 2); syncMidiTempo(); midiInfoStatus(); }
$('#mpTempo').oninput = e => setMidiRate(+e.target.value / 100);
$('#mpTempo').ondblclick = () => setMidiRate(1);
$('#mpBpm').onchange = e => setMidiRate((+e.target.value || midiBaseBpm()) / midiBaseBpm());
// reverb and chorus amounts for the MIDI synth (the file's own sends still decide which parts get how much)
function applyMidiFx(s = midiEng && midiEng.synth) {
  $('#mpRev').value = $('#mpRevN').value = midiRev; $('#mpCho').value = $('#mpChoN').value = midiCho;
  if (!s) return;
  // most MIDI files send nothing to the effects, so the slider sets each part's send (and, near the top, a little extra level)
  s.setSystemParameter('reverbGain', 1 + Math.max(0, midiRev - 70) / 30);
  s.setSystemParameter('chorusGain', 1 + Math.max(0, midiCho - 70) / 30);
  for (let ch = 0; ch < 16; ch++) {
    const mc = s.midiChannels[ch]; if (!mc) continue;
    for (const [cc, v] of [[91, midiRev], [93, midiCho]]) {
      mc.lockController(cc, false);
      s.controllerChange(ch, cc, Math.round(Math.min(100, v) * 1.27));
      mc.lockController(cc, true);
    }
  }
}
for (const [r, n, set] of [['#mpRev', '#mpRevN', v => { midiRev = v; }], ['#mpCho', '#mpChoN', v => { midiCho = v; }]]) {
  const on = e => { const v = clamp(Math.round(+e.target.value || 0), 0, 100); set(v); applyMidiFx(); saveSession(); };
  $(r).oninput = on; $(n).onchange = on;
  $(r).ondblclick = () => { set(0); applyMidiFx(); saveSession(); };
}
/* ---------- Delay: echoes after the synth, in time with the song or in milliseconds ---------- */
const dly = { mix: 0, fb: 35, ms: 350, sync: '1/8d' };
const DLY_BEATS = { '1/4': 1, '1/8': 0.5, '1/8d': 0.75, '1/16': 0.25, '1/4t': 2 / 3, '1/2': 2 };
let midiDelay = null;
const delaySec = () => dly.sync in DLY_BEATS ? DLY_BEATS[dly.sync] * 60 / (midiBaseBpm() * midiRate) : clamp(dly.ms, 10, 2000) / 1000;
function makeDelay(ctx) {
  const input = ctx.createGain(), output = ctx.createGain(), dl = ctx.createDelay(4), fb = ctx.createGain(), wet = ctx.createGain(), tone = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
  // each echo a little darker and lighter in the lows, like a tape or analog delay, so repeats sit behind the notes
  tone.type = 'lowpass'; tone.frequency.value = 5500; hp.type = 'highpass'; hp.frequency.value = 120;
  input.connect(output); input.connect(dl); dl.connect(tone); tone.connect(hp); hp.connect(fb); fb.connect(dl); hp.connect(wet); wet.connect(output);
  const set = () => {
    const t = ctx.currentTime, ramp = ctx instanceof OfflineAudioContext ? 0 : 0.03;
    const p = (a, v) => ramp ? a.setTargetAtTime(v, t, ramp) : (a.value = v);
    p(dl.delayTime, delaySec()); p(fb.gain, clamp(dly.fb, 0, 90) / 100); p(wet.gain, clamp(dly.mix, 0, 100) / 100);
  };
  return { input, output, set };
}
function syncDelayUi() {
  $('#mpDly').value = $('#mpDlyN').value = dly.mix; $('#mpDlyFb').value = $('#mpDlyFbN').value = dly.fb;
  $('#mpDlySync').value = dly.sync in DLY_BEATS ? dly.sync : 'ms';
  $('#mpDlyMs').value = Math.round(delaySec() * 1000);
  $('#mpDlyMs').title = dly.sync in DLY_BEATS ? `${Math.round(delaySec() * 1000)} ms at ${Math.round(midiBaseBpm() * midiRate)} BPM. Type a number to set the time yourself.` : 'Time between echoes, in milliseconds';
}
const setDelay = o => { Object.assign(dly, o); syncDelayUi(); if (midiDelay) midiDelay.set(); saveSession(); };
$('#mpDly').oninput = $('#mpDlyN').onchange = e => setDelay({ mix: clamp(Math.round(+e.target.value || 0), 0, 100) });
$('#mpDly').ondblclick = () => setDelay({ mix: 0 });
$('#mpDlyFb').oninput = $('#mpDlyFbN').onchange = e => setDelay({ fb: clamp(Math.round(+e.target.value || 0), 0, 90) });
$('#mpDlyFb').ondblclick = () => setDelay({ fb: 35 });
$('#mpDlySync').onchange = e => setDelay(e.target.value === 'ms' ? { sync: 'ms', ms: Math.round(delaySec() * 1000) } : { sync: e.target.value });
$('#mpDlyMs').onchange = e => setDelay({ sync: 'ms', ms: clamp(Math.round(+e.target.value || 350), 10, 2000) });
syncDelayUi();

/* ---------- MIDI to audio: render the song with every setting you hear, faster than real time ---------- */
async function renderMidiAudio(r, onProgress) {
  if (!current || r.path !== current.path || !midiDoc) throw new Error('Select the MIDI file in your library first.');
  const e = await midiEngine();
  if (e.loadedFor !== r.path) {
    e.seq.loadNewSongList([{ binary: midiBytes.slice(0), fileName: r.name }]); e.loadedFor = r.path;
    for (let i = 0; i < 100 && !(e.seq.duration > 0); i++) await new Promise(res => setTimeout(res, 20));
    if (!midiPlayer.paused) { /* already playing this one */ } else e.seq.pause();
  }
  const held = bendHeld; bendHeld = null;          // the pitch wheel always springs back for a render
  applyMidiParts(); applyMidiFx(); applyMidiWheels();
  bendHeld = held;
  await new Promise(res => setTimeout(res, 60));
  const snapshot = await e.synth.getSnapshot();
  const song = await e.seq.getMIDI();
  const [bank] = await bankBuffer(midiBankPath);
  const sr = 48000, dt = delaySec(), fb = clamp(dly.fb, 0, 90) / 100;
  const echo = dly.mix > 0 ? Math.min(12, dt * (fb > 0.01 ? Math.log(0.001) / Math.log(fb) : 1) + dt) : 0;
  const songSec = midiDoc.dur / midiRate, total = songSec + 4 + echo;
  const oc = new OfflineAudioContext({ numberOfChannels: 2, sampleRate: sr, length: Math.ceil(total * sr) });
  const mod = await import('./vendor/spessasynth/spessasynth.mjs');
  await oc.audioWorklet.addModule('vendor/spessasynth/spessasynth_processor.min.js');
  const synth = new mod.WorkletSynthesizer(oc);
  const d = makeDelay(oc); synth.connect(d.input); d.output.connect(oc.destination); d.set();
  for (let t = 1; t < total - 0.5; t += 1) oc.suspend(t).then(() => { if (onProgress) onProgress(t / total); oc.resume(); });
  await synth.startOfflineRender({ midiSequence: song, snapshot, soundBankList: [{ soundBankBuffer: bank, bankOffset: 0 }], loopCount: 0, sequencerOptions: { skipToFirstNoteOn: false, initialPlaybackRate: midiRate } });
  // the snapshot carries instruments and mutes; transpose, the wheels and the effect sends are set again on the render synth
  const keep = bendHeld; bendHeld = null; applyMidiWheels(synth, true); applyMidiFx(synth); bendHeld = keep;
  const ab = await oc.startRendering();
  // trim the silence after the last echo or reverb tail, keep a short fade, and keep peaks under 0 dBFS
  const L = ab.getChannelData(0), R = ab.getChannelData(1);
  let end = Math.min(ab.length, Math.ceil((songSec + 0.2) * sr)), peak = 0;
  for (let i = 0; i < ab.length; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (v > peak) peak = v; if (v > 0.0003 && i > end) end = i; }
  end = Math.min(ab.length, end + Math.round(0.25 * sr));
  const out = new AudioBuffer({ numberOfChannels: 2, length: end, sampleRate: sr }), fade = Math.round(0.1 * sr), k = peak > 0.989 ? 0.989 / peak : 1;
  for (const [src, c] of [[L, 0], [R, 1]]) {
    const o = src.slice(0, end); for (let i = 0; i < end; i++) o[i] *= k * (i > end - fade ? (end - i) / fade : 1);
    out.copyToChannel(o, c);
  }
  return out;
}
$('#mpAll').onchange = e => {
  if (midiLock) { midiLock = e.target.value; saveSession(); buildMidiPanel(); }   // locked: the new choice is locked too ("As written" unlocks)
  else partsOf().all = e.target.value;
  applyMidiParts();
};
// lock the All parts instrument for every MIDI file you open
$('#mpLock').onclick = () => {
  if (midiLock) { midiLock = ''; partsOf().all = ''; }
  else {
    const v = $('#mpAll').value;
    if (!v) { setStatus('Choose an instrument in All parts first, then lock it.'); return; }
    midiLock = v;
  }
  saveSession(); buildMidiPanel(); applyMidiParts();
  const n = midiLock && $('#mpAll').selectedOptions[0];
  setStatus(midiLock ? `Every MIDI file now plays with ${n ? n.textContent.replace(/^\d+\s*/, '') : 'this instrument'}. Click Locked to go back to the file's own instruments.` : 'Unlocked. Each file plays with its own instruments again.', true);
};
$('#mpParts').onchange = e => { const ch = e.target.dataset.ch; if (ch == null) return; const ps = partsOf(); ps.ch[ch] = { ...(ps.ch[ch] || {}), p: e.target.value }; applyMidiParts(); };
$('#mpParts').onclick = e => {
  const b = e.target.closest && e.target.closest('[data-mute]'); if (!b) return;
  const ch = b.dataset.mute, ps = partsOf(); ps.ch[ch] = { ...(ps.ch[ch] || {}), mute: !(ps.ch[ch] || {}).mute };
  buildMidiPanel(); applyMidiParts();
};
function midiInfoStatus() {
  if (!midiDoc) return;
  const tr = midiDoc.tracks.length, n = midiDoc.notes.length;
  setStatus(`MIDI · ${tr} ${tr === 1 ? 'track' : 'tracks'} · ${n.toLocaleString()} notes${midiDoc.bpm ? ' · ' + Math.round(midiDoc.bpm) + ' BPM' + (midiRate !== 1 ? ` (playing at ${Math.round(midiDoc.bpm * midiRate)})` : '') : ''}${midiDoc.timeSig ? ' · ' + midiDoc.timeSig : ''} · played with the built-in General MIDI sounds`, true);
}
// the MIDI player answers to the same events as the audio element
for (const k of ['onplay', 'onpause', 'onended', 'ontimeupdate']) midiPlayer[k] = audioEl[k];
// one color per track; drums in gray
const ROLL_COLORS = ['#C08CFF', '#5BE3FF', '#FF8A4C', '#F5D97D', '#FF7DB0', '#8FA8FF', '#E6EAF2', '#D9A6FF'];
let midiRollCache = null;
function drawPianoRoll(W, H) {
  const dpr = devicePixelRatio || 1, doc = midiDoc;
  const key = zoom.t0 + '|' + zoom.t1 + '|' + W + '|' + H + '|' + midiTrans, tr = midiTrans;
  if (!midiRollCache || midiRollCache.key !== key) {
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const c = off.getContext('2d');
    let lo = 127, hi = 0;
    for (const x of doc.notes) if (x.ch !== 9) { if (x.n + tr < lo) lo = x.n + tr; if (x.n + tr > hi) hi = x.n + tr; }
    if (lo > hi) { lo = 35; hi = 81; }
    lo = Math.max(0, lo - 2); hi = Math.min(127, hi + 2);
    const drumH = doc.notes.some(x => x.ch === 9) ? Math.round(H * 0.16) : 0;
    const hasMod = doc.modLane && doc.modLane.some(e => e.v > 0), hasBend = doc.bendLane && doc.bendLane.some(e => e.v !== 0), hasPress = doc.pressLane && doc.pressLane.some(e => e.v > 0);
    const laneH = Math.round(H * 0.11), lanes = (hasMod ? 1 : 0) + (hasBend ? 1 : 0) + (hasPress ? 1 : 0);
    const pH = H - drumH - lanes * laneH;
    const rowH = pH / (hi - lo + 1), span = zoom.t1 - zoom.t0 || 1;
    // black keys a shade darker, C lines labeled
    for (let n = lo; n <= hi; n++) {
      const y = pH - (n - lo + 1) * rowH;
      if ([1, 3, 6, 8, 10].includes(n % 12)) { c.fillStyle = '#0B0E14'; c.fillRect(0, y, W, rowH); }
      if (n % 12 === 0) { c.fillStyle = '#1A2030'; c.fillRect(0, Math.round(y + rowH), W, dpr); c.fillStyle = '#6B7383'; c.font = `${10 * dpr}px Inter, sans-serif`; c.fillText('C' + (n / 12 - 1), 4 * dpr, y + rowH - 3 * dpr); }
    }
    // controller lanes under the notes: the mod wheel (violet) and pitch bend (cyan, centered), all parts together
    let ly = pH;
    const span0 = zoom.t1 - zoom.t0 || 1, tx = t => (t - zoom.t0) / span0 * W;
    const drawLane = (ev, name, color, bipolar) => {
      c.fillStyle = '#090B10'; c.fillRect(0, ly, W, laneH); c.fillStyle = '#1E232D'; c.fillRect(0, ly, W, dpr);
      if (bipolar) { c.fillStyle = '#141922'; c.fillRect(0, ly + laneH / 2, W, dpr); }
      // per channel, the value holds until the next change
      const byCh = new Map(); for (const e of ev) { if (!byCh.has(e.ch)) byCh.set(e.ch, []); byCh.get(e.ch).push(e); }
      c.strokeStyle = color; c.lineWidth = 1.5 * dpr; c.globalAlpha = 0.9;
      for (const list of byCh.values()) {
        c.beginPath(); let prevY = null;
        for (let i = 0; i < list.length; i++) {
          const e = list[i], x = tx(e.t), y = bipolar ? ly + laneH / 2 - (e.v / 8192) * (laneH / 2 - 2 * dpr) : ly + laneH - 2 * dpr - (e.v / 127) * (laneH - 4 * dpr);
          if (prevY == null) c.moveTo(x, y); else { c.lineTo(x, prevY); c.lineTo(x, y); }
          prevY = y;
          if (i === list.length - 1) c.lineTo(W, y);
        }
        c.stroke();
      }
      c.globalAlpha = 1; c.fillStyle = '#6B7383'; c.font = `${10 * dpr}px Inter, sans-serif`; c.fillText(name, 4 * dpr, ly + 11 * dpr);
      ly += laneH;
    };
    if (hasMod) drawLane(doc.modLane, 'Mod wheel', '#C08CFF', false);
    if (hasBend) drawLane(doc.bendLane, 'Pitch bend', '#5BE3FF', true);
    if (hasPress) drawLane(doc.pressLane, 'Aftertouch', '#FF8A4C', false);
    if (drumH) { c.fillStyle = '#0B0E14'; c.fillRect(0, ly, W, drumH); c.fillStyle = '#1E232D'; c.fillRect(0, ly, W, dpr); c.fillStyle = '#6B7383'; c.font = `${10 * dpr}px Inter, sans-serif`; c.fillText('Drums', 4 * dpr, ly + 12 * dpr); }
    const dY = ly;
    // bar lines from the tempo
    if (doc.bpm) {
      const beats = +(doc.timeSig || '4/4').split('/')[0] || 4, bar = 60 / doc.bpm * beats;
      if ((span / bar) < W / (12 * dpr)) { c.fillStyle = '#141922'; for (let b = Math.ceil(zoom.t0 / bar) * bar; b < zoom.t1; b += bar) c.fillRect(Math.round((b - zoom.t0) / span * W), 0, dpr, H); }
    }
    const trIdx = new Map(); doc.tracks.forEach((t, i) => trIdx.set(t.i, i));
    const minW = Math.max(1, dpr);
    for (const x of doc.notes) {
      if (x.t + x.d < zoom.t0 || x.t > zoom.t1) continue;
      const nx = (x.t - zoom.t0) / span * W, nw = Math.max(minW, x.d / span * W - (x.d / span * W > 3 * dpr ? dpr : 0));
      c.globalAlpha = 0.45 + 0.55 * x.v / 127;
      if (x.ch === 9) { const dy = dY + 4 * dpr + ((x.n - 35) / 47) * (drumH - 8 * dpr); c.fillStyle = '#9AA3B4'; c.fillRect(nx, Math.max(dY + 2 * dpr, Math.min(H - 3 * dpr, dy)), Math.max(minW, Math.min(nw, 3 * dpr)), 2 * dpr); }
      else { c.fillStyle = ROLL_COLORS[(trIdx.get(x.tr) ?? x.ch) % ROLL_COLORS.length]; c.fillRect(nx, pH - (x.n + tr - lo + 1) * rowH + 0.5, nw, Math.max(1, rowH - 1)); }
    }
    c.globalAlpha = 1;
    midiRollCache = { key, img: off };
  }
  g.drawImage(midiRollCache.img, 0, 0);
}

/* Edit preview runs through Web Audio */
let eSrc = null, eStart = 0;
let eGain = null;
function playEdit(offset = 0) {
  if (!ed.outBuf) return;
  const c = ac(); c.resume();
  // a running edit fades out over 20 ms while the new one fades in, so live changes don't click
  const old = eSrc, oldG = eGain;
  if (old && offset > 0) { eSrc = null; const t0 = c.currentTime; oldG.gain.setValueAtTime(1, t0); oldG.gain.linearRampToValueAtTime(0, t0 + 0.02); try { old.stop(t0 + 0.03); } catch (e) {} if (!player.paused) player.pause(); }
  else stopAll();
  const s = c.createBufferSource(), g = c.createGain();
  s.buffer = ed.outBuf; s.loop = $('#loop').checked;
  s.connect(g); g.connect(bus);
  if (offset > 0) { g.gain.setValueAtTime(0, c.currentTime); g.gain.linearRampToValueAtTime(1, c.currentTime + 0.02); }
  s.onended = () => { if (eSrc === s) { eSrc = null; if (!player.isMidi) player.currentTime = 0; updatePlayBtn(); drawWave(); drawResult(); } };
  eSrc = s; eGain = g; eStart = c.currentTime - offset;
  s.start(0, offset);
  if (!offset) peakHold = null;
  updatePlayBtn(); tick();
}
function stopAll() {
  if (!audioEl.paused) audioEl.pause();
  if (!midiPlayer.paused) midiPlayer.pause();
  if (eSrc) { const s = eSrc; eSrc = null; try { s.stop(); } catch (e) {} }
  updatePlayBtn();
}
const isPlaying = () => !player.paused || !!eSrc;
function editPos() { if (!eSrc || !ed.outBuf) return -1; const d = ed.outBuf.duration, t = actx.currentTime - eStart; return eSrc.loop ? t % d : Math.min(t, d); }
function updatePlayBtn() { $('#play').textContent = isPlaying() ? '■' : '▶'; }
// a time in the source to the same moment in the edit (-1 if it is not in the edit)
function srcToOut(t) {
  if (ed.reverse) return -1;
  const a = hasSel() ? ed.selA : 0, b = hasSel() ? ed.selB : srcDur();
  if (t < a || t > b) return -1;
  return (t - a) / ed.speed;
}
function playFrom(t) {
  if (ed.specOps.length && ed.outBuf && !hasSel()) { const o = srcToOut(t || 0); if (o >= 0 && o < ed.outBuf.duration) { playEdit(Math.max(o, 0.0001)); return; } }
  stopAll(); ac().resume();
  player.currentTime = Math.max(0, t || 0);
  player.play().catch(() => {});
}
// the same moment of the edit back in the source
function outToSrc(o) {
  const a = hasSel() ? ed.selA : 0, b = hasSel() ? ed.selB : srcDur();
  return ed.reverse ? Math.max(a, b - o * ed.speed) : Math.min(b, a + o * ed.speed);
}
// play continues from where you stopped (or clicked); at the very end it starts over
function play() {
  const d = srcDur();
  let t = player.currentTime || 0;
  if (!d || t >= d - 0.05) t = 0;
  if (isEdited() && ed.outBuf) {
    const o = srcToOut(t);
    if (t > 0 && o > 0 && o < ed.outBuf.duration - 0.05) playEdit(o); else playEdit();
  } else playFrom(t);
}
function togglePlay() {
  if (!current) { if (view.length) select(Math.max(sel, 0), true); return; }
  if (isPlaying()) {
    // stop keeps your place: the playhead stays where you stopped
    const at = eSrc ? outToSrc(editPos()) : player.currentTime;
    stopAll(); player.currentTime = Math.max(0, at || 0); drawWave(); drawResult(); updateTime();
  }
  else play();
}
$('#play').onclick = togglePlay;
$('#reveal').onclick = () => { if (current) sb.showInFolder(current.path); };

function updateTime() {
  if (player.isMidi && midiDoc) syncWheels();
  updateWaveHint();
  $('#learnNoise').disabled = !hasSel() || !ed.buf;
  let s = fmtClock(player.currentTime) + ' / ' + fmtClock(srcDur());
  if (hasSel()) s += ` · <b>Selection ${ed.selA.toFixed(3)}s to ${ed.selB.toFixed(3)}s (${(ed.selB - ed.selA).toFixed(3)}s)</b>`;
  $('#np-time').innerHTML = s;
}
function setStatus(msg, ok) { const el = $('#status'); el.textContent = msg; el.title = msg; el.classList.toggle('ok', !!ok); }

/* ---------- FFT, spectrogram and spectrum analyzer ---------- */
let viewMode = 'wave', waveHover = null;
const scv = $('#spec'), sgx = scv.getContext('2d');
let peakHold = null, liveData = null, specHover = null, frozen = null; // frozen: the last moment heard, kept after playback stops
const avg = { db: null, n: 0, sr: 48000, what: '' };
const F_MIN = 20;

// View: 'wave', 'spec' or 'both' (waveform on top, spectrogram below, same timeline)
function setViewMode(m, silent) {
  viewMode = m === 'spec' || m === 'both' ? m : 'wave';
  setTimeout(syncSpecTools);
  const on = { wave: viewMode !== 'spec', spec: viewMode !== 'wave' };
  document.querySelectorAll('#vmode button').forEach(b => b.classList.toggle('on', on[b.dataset.m]));
  waveCache = null; drawWave();
  if (!silent) saveSession();
}
$('#vmode').addEventListener('mousedown', e => e.stopPropagation());
// the two buttons are switches; at least one stays on
$('#vmode').onclick = e => {
  const m = e.target.dataset && e.target.dataset.m; if (!m) return;
  const on = { wave: viewMode !== 'spec', spec: viewMode !== 'wave' };
  on[m] = !on[m];
  if (!on.wave && !on.spec) on[m === 'wave' ? 'spec' : 'wave'] = true;
  setViewMode(on.wave && on.spec ? 'both' : on.spec ? 'spec' : 'wave');
};
// in split view, the spectrogram takes the lower part of the panel
const specTop = H => viewMode === 'both' ? Math.round(H * 0.42) : 0;
function renderView(buf, t0, t1, W, H) {
  if (viewMode === 'wave') return renderBufferWave(buf, t0, t1, W, H, waveColor);
  if (viewMode === 'spec') return renderSpectrogram(buf, t0, t1, W, H);
  const top = specTop(H), c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.drawImage(renderBufferWave(buf, t0, t1, W, top, waveColor), 0, 0);
  x.drawImage(renderSpectrogram(buf, t0, t1, W, H - top), 0, top);
  x.fillStyle = '#1E232D'; x.fillRect(0, top - 1, W, 2);
  return c;
}

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
// frequency zoom: the part of the full range (0 top, 1 bottom) shown on the spectrogram
const fz = { a: 0, b: 1 };
const fzOn = () => fz.a > 0.0001 || fz.b < 0.9999;
function yToFreq(y, H, sr) { const fmax = sr / 2, u = fz.a + (y / H) * (fz.b - fz.a); return F_MIN * Math.pow(fmax / F_MIN, 1 - u); }

function renderSpectrogram(ab, t0, t1, W, H) {
  const sr = ab.sampleRate, cols = Math.min(W, 1100), spp = (t1 - t0) * sr / cols;
  // zoomed into frequencies: finer frequency detail; zoomed far into time: finer time detail
  const N = fz.b - fz.a < 0.35 ? 8192 : spp < 400 ? 2048 : 4096;
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
  ctx.font = `${11 * dpr}px Inter, sans-serif`;
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
    frozen = { path: current && current.path, n, sr };
  } else if (frozen && current && frozen.path === current.path && liveData) {
    // stopped: hold the last moment you heard (and the peaks just before it), until the next play or another sound
    data = liveData; n = frozen.n; sr = frozen.sr; offset = ANALYSER_OFFSET;
  } else if (avg.db) { data = avg.db; n = avg.n; sr = avg.sr; }
  const held = !live && data === liveData && !!liveData;
  const fmax = (sr || 48000) / 2;
  const xToF = x => F_MIN * Math.pow(fmax / F_MIN, x / W);
  const fToX = f => Math.log(f / F_MIN) / Math.log(fmax / F_MIN) * W;
  const dbToY = d => (DB_TOP - d) / (DB_TOP - DB_BOT) * H;
  // grid
  sgx.font = `${10 * dpr}px Inter, sans-serif`;
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    if (f > fmax) continue;
    const x = Math.round(fToX(f));
    sgx.fillStyle = '#141922'; sgx.fillRect(x, 0, dpr, H);
    sgx.fillStyle = '#6B7383'; sgx.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x + 3 * dpr, H - 4 * dpr);
  }
  for (const d of [-24, -48, -72]) { const y = Math.round(dbToY(d)); sgx.fillStyle = '#141922'; sgx.fillRect(0, y, W, dpr); sgx.fillStyle = '#6B7383'; sgx.fillText(d + '', W - 22 * dpr, y - 2 * dpr); }
  specMap = { W, H, fToX, xToF };
  $('#speclabel').textContent = live ? 'Live spectrum' : held ? 'Last moment heard' : (avg.db ? avg.what : 'Spectrum');
  if (!data) { drawEqOverlay(); return; }
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
  grad.addColorStop(0, live ? 'rgba(192,140,255,0.55)' : 'rgba(192,140,255,0.30)'); grad.addColorStop(1, 'rgba(192,140,255,0.02)');
  sgx.beginPath(); sgx.moveTo(0, H);
  for (let x = 0; x < W; x++) sgx.lineTo(x, ys[x]);
  sgx.lineTo(W, H); sgx.closePath(); sgx.fillStyle = grad; sgx.fill();
  sgx.beginPath(); for (let x = 0; x < W; x++) x ? sgx.lineTo(x, ys[x]) : sgx.moveTo(x, ys[x]);
  sgx.strokeStyle = live ? '#C08CFF' : '#8A6FC0'; sgx.lineWidth = dpr; sgx.stroke();
  if ((live || held) && peakHold && peakHold.length === data.length) {
    const ps = col(peakHold);
    sgx.beginPath(); for (let x = 0; x < W; x++) x ? sgx.lineTo(x, ps[x]) : sgx.moveTo(x, ps[x]);
    sgx.strokeStyle = 'rgba(255,255,255,0.35)'; sgx.stroke();
  }
  drawEqOverlay();
  if (specHover && !ed.eqOn) {
    const x = specHover.x, f = xToF(x);
    const b = Math.min(data.length - 1, Math.round(f / sr * n));
    sgx.fillStyle = 'rgba(255,255,255,0.4)'; sgx.fillRect(Math.floor(x), 0, dpr, H);
    label(sgx, `${fmtFreq(f)}  ${noteName(f)}  ${(data[b] + offset).toFixed(0)} dB`, x + 8 * dpr, 16 * dpr, W);
  }
}
/* ---------- Graphic EQ, drawn over the spectrum ---------- */
let specMap = null, eqDrag = -1, eqHover = -1;
const eqSr = () => ed.buf ? ed.buf.sampleRate : 48000;
const eqR = () => ed.eqMode === 'param' ? PEQ_RANGE : EQ_RANGE;
const EQ_PAD = 30; // room at the top for the EQ buttons
const eqY = g => { const H = scv.height, pad = EQ_PAD * (devicePixelRatio || 1); return H / 2 - g / eqR() * (H / 2 - pad); };
function drawEqOverlay() {
  if (!ed.eqOn || !specMap) return;
  const { W, H, fToX, xToF } = specMap, dpr = devicePixelRatio || 1, sr = eqSr();
  sgx.fillStyle = 'rgba(14,15,18,0.35)'; sgx.fillRect(0, 0, W, H);
  sgx.fillStyle = 'rgba(255,255,255,0.18)'; sgx.fillRect(0, Math.round(eqY(0)), W, dpr);
  const coefs = curCoefs(sr), R = eqR();
  if (coefs.length) {
    sgx.beginPath();
    for (let x = 0; x < W; x += dpr) { const f = Math.min(sr / 2 - 1, xToF(x)), y = eqY(clamp(eqResponseDb(coefs, f, sr), -R * 1.3, R * 1.3)); x ? sgx.lineTo(x, y) : sgx.moveTo(x, y); }
    sgx.strokeStyle = '#C08CFF'; sgx.lineWidth = 2 * dpr; sgx.stroke();
  }
  if (ed.eqMode === 'param') { drawPeqNodes(W, H, dpr, fToX); return; }
  EQ_BANDS.forEach((f, i) => {
    const x = Math.round(fToX(f)), on = f < sr * 0.45, y = eqY(ed.eq[i]);
    sgx.fillStyle = on ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)'; sgx.fillRect(x - dpr, eqY(EQ_RANGE), 2 * dpr, eqY(-EQ_RANGE) - eqY(EQ_RANGE));
    if (!on) return;
    const hot = i === eqDrag || i === eqHover;
    sgx.fillStyle = hot ? '#E7D4FF' : '#C08CFF'; sgx.fillRect(x - 7 * dpr, y - 4 * dpr, 14 * dpr, 8 * dpr);
  });
  const b = eqDrag >= 0 ? eqDrag : eqHover;
  if (b >= 0) { const f = EQ_BANDS[b], g = ed.eq[b]; label(sgx, `${f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz'}  ${g > 0 ? '+' : ''}${g.toFixed(1)} dB`, fToX(f) + 10 * dpr, H - 20 * dpr, W); }
}
// parametric points: numbered dots; cuts sit on the 0 dB line at their corner
const PEQ_NAMES = { lowcut: 'Low cut', lowshelf: 'Low shelf', bell: 'Bell', highshelf: 'High shelf', highcut: 'High cut' };
const peqPos = (b, fToX) => ({ x: fToX(b.f), y: eqY(b.type === 'lowcut' || b.type === 'highcut' ? 0 : b.g) });
function drawPeqNodes(W, H, dpr, fToX) {
  sgx.font = `600 ${10 * dpr}px Inter, sans-serif`; sgx.textAlign = 'center'; sgx.textBaseline = 'middle';
  ed.peq.forEach((b, i) => {
    if (b.f >= eqSr() * 0.49) return;
    const { x, y } = peqPos(b, fToX), hot = i === eqDrag || i === eqHover, r = (hot ? 9 : 8) * dpr;
    sgx.beginPath(); sgx.arc(x, y, r, 0, 6.2832);
    if (b.on) { sgx.fillStyle = hot ? '#E7D4FF' : '#C08CFF'; sgx.fill(); sgx.fillStyle = '#1A0B2E'; }
    else { sgx.strokeStyle = 'rgba(154,163,180,0.8)'; sgx.lineWidth = 1.5 * dpr; sgx.stroke(); sgx.fillStyle = 'rgba(154,163,180,0.9)'; }
    sgx.fillText(String(i + 1), x, y + 0.5 * dpr);
  });
  sgx.textAlign = 'start'; sgx.textBaseline = 'alphabetic';
  const i = eqDrag >= 0 ? eqDrag : eqHover;
  if (i >= 0) {
    const b = ed.peq[i], cut = b.type === 'lowcut' || b.type === 'highcut';
    const txt = `${i + 1} · ${PEQ_NAMES[b.type]}  ${fmtFreq(b.f)}${cut ? '' : `  ${b.g > 0 ? '+' : ''}${b.g.toFixed(1)} dB`}${b.type === 'bell' || cut ? `  Q ${b.q.toFixed(2)}` : ''}${b.on ? '' : '  (off)'}`;
    label(sgx, txt, Math.min(W - 10, peqPos(b, fToX).x + 12 * dpr), H - 20 * dpr, W);
  }
}
function peqAt(p) {
  if (!specMap) return -1;
  let best = -1, bd = (14 * (devicePixelRatio || 1)) ** 2;
  ed.peq.forEach((b, i) => { if (b.f >= eqSr() * 0.49) return; const q = peqPos(b, specMap.fToX), d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}
function peqDragTo(i, p) {
  const b = ed.peq[i], sr = eqSr();
  let f = clamp(specMap.xToF(p.x), 20, sr * 0.45);
  const d = Math.pow(10, Math.floor(Math.log10(f)) - 2); f = Math.round(f / d) * d; // 3 significant figures
  b.f = f; b.on = true;
  if (b.type !== 'lowcut' && b.type !== 'highcut') {
    let g = (scv.height / 2 - p.y) / (scv.height / 2 - EQ_PAD * (devicePixelRatio || 1)) * PEQ_RANGE;
    g = clamp(Math.round(g * 10) / 10, -PEQ_RANGE, PEQ_RANGE); if (Math.abs(g) < 0.4) g = 0;
    b.g = g;
  }
  eqChanged();
}
function setEqMode(m) {
  ed.eqMode = m === 'param' ? 'param' : 'graphic';
  syncControls(); drawSpectrum(); saveSession();
  if (ed.eqOn) eqChanged();
}
function eqBandAt(x) {
  if (!specMap) return -1;
  let best = -1, bd = 1e9;
  EQ_BANDS.forEach((f, i) => { if (f >= eqSr() * 0.45) return; const d = Math.abs(specMap.fToX(f) - x); if (d < bd) { bd = d; best = i; } });
  return bd < 40 * (devicePixelRatio || 1) ? best : -1;
}
function eqSetFromY(i, y) {
  let g = (scv.height / 2 - y) / (scv.height / 2 - EQ_PAD * (devicePixelRatio || 1)) * EQ_RANGE;
  g = clamp(Math.round(g * 2) / 2, -EQ_RANGE, EQ_RANGE);
  if (Math.abs(g) < 0.75) g = 0; // sticks to 0
  if (g !== ed.eq[i]) { ed.eq[i] = g; eqChanged(); } else drawSpectrum();
}
let eqTimer = null;
function eqChanged() {
  drawSpectrum();
  clearTimeout(renderTimer); clearTimeout(eqTimer);
  eqTimer = setTimeout(() => renderEdit(true, true), 40);
}
function toggleEq() {
  if (midiDoc) return; ed.eqOn = !ed.eqOn; syncControls(); drawSpectrum(); saveSession(); if (ed.eqMode === 'param' ? peqActive(ed.peq) : ed.eq.some(g => g)) eqChanged(); }
$('#eqBtn').onclick = toggleEq;
$('#eqFlat').onclick = () => { if (ed.eqMode === 'param') ed.peq = PEQ_DEFAULT(); else ed.eq = EQ_BANDS.map(() => 0); eqChanged(); };
$('#eqMode').onclick = e => { const b = e.target.closest('button'); if (b) setEqMode(b.dataset.q); };
const specXY = e => { const r = scv.getBoundingClientRect(); return { x: (e.clientX - r.left) * scv.width / r.width, y: (e.clientY - r.top) * scv.height / r.height }; };
scv.addEventListener('mousedown', e => {
  if (!ed.eqOn || e.button !== 0) return;
  if (ed.eqMode === 'param') {
    const p = specXY(e), i = peqAt(p); if (i < 0) return;
    e.preventDefault(); eqDrag = i;
    const mv = ev => peqDragTo(i, specXY(ev));
    const up = () => { eqDrag = -1; drawSpectrum(); removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up); drawSpectrum();
    return;
  }
  const p = specXY(e), i = eqBandAt(p.x);
  if (i < 0) return;
  e.preventDefault(); eqDrag = i; eqSetFromY(i, p.y);
  const mv = ev => eqSetFromY(i, specXY(ev).y);
  const up = () => { eqDrag = -1; drawSpectrum(); removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
  addEventListener('mousemove', mv); addEventListener('mouseup', up);
});
scv.addEventListener('dblclick', e => {
  if (!ed.eqOn || ed.eqMode !== 'param') return;
  const i = peqAt(specXY(e)); if (i < 0) return;
  ed.peq[i] = PEQ_DEFAULT()[i]; eqChanged();
});
scv.addEventListener('contextmenu', e => {
  if (!ed.eqOn || ed.eqMode !== 'param') return;
  const i = peqAt(specXY(e)); if (i < 0) return;
  e.preventDefault(); ed.peq[i].on = !ed.peq[i].on; eqChanged();
});
scv.addEventListener('wheel', e => {
  if (!ed.eqOn || ed.eqMode !== 'param') return;
  const i = peqAt(specXY(e)); if (i < 0) return;
  e.preventDefault();
  const b = ed.peq[i]; if (b.type === 'lowshelf' || b.type === 'highshelf') return;
  const lo = b.type === 'bell' ? 0.3 : 0.5, hi = b.type === 'bell' ? 12 : 2.5;
  b.q = clamp(Math.round(b.q * Math.exp(-e.deltaY * 0.0015) * 100) / 100, lo, hi); b.on = true;
  eqHover = i; eqChanged();
}, { passive: false });
scv.addEventListener('dblclick', e => { if (!ed.eqOn || ed.eqMode === 'param') return; const i = eqBandAt(specXY(e).x); if (i >= 0 && ed.eq[i]) { ed.eq[i] = 0; eqChanged(); } });
scv.addEventListener('mousemove', e => { if (ed.eqOn && eqDrag < 0) { const h = ed.eqMode === 'param' ? peqAt(specXY(e)) : eqBandAt(specXY(e).x); if (h !== eqHover) { eqHover = h; if (!isPlaying()) drawSpectrum(); } } });
scv.addEventListener('mouseleave', () => { if (eqHover >= 0) { eqHover = -1; if (!isPlaying()) drawSpectrum(); } });
scv.addEventListener('mousemove', e => { const r = scv.getBoundingClientRect(); specHover = { x: (e.clientX - r.left) * scv.width / r.width }; if (!isPlaying()) drawSpectrum(); });
scv.addEventListener('mouseleave', () => { specHover = null; if (!isPlaying()) drawSpectrum(); });

/* ---------- Edit controls ---------- */
const speedR = $('#speedR'), speedN = $('#speedN'), pitchR = $('#pitchR'), pitchN = $('#pitchN'), gainR = $('#gainR'), gainN = $('#gainN');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function syncControls() {
  syncSpecTools();
  $('#eqBtn').classList.toggle('on', ed.eqOn); $('#eqMode').style.display = ed.eqOn ? '' : 'none'; $('#eqMode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.q === ed.eqMode)); $('#eqFlat').style.display = ed.eqOn ? '' : 'none'; scv.classList.toggle('eq', ed.eqOn);
  speedR.value = Math.log2(ed.speed); speedN.value = +ed.speed.toFixed(2);
  pitchR.value = Math.round(ed.semis); pitchN.value = +ed.semis.toFixed(1);
  gainR.value = clamp(ed.gain, -24, 24); gainN.value = ed.gain;
  $('#tape').checked = ed.tape; $('#reverse').checked = ed.reverse; $('#normalize').checked = ed.normalize;
  $('#fadeIn').value = ed.fadeIn; $('#fadeOut').value = ed.fadeOut;
  $('#pitchCtl').classList.toggle('off', ed.tape);
  $('#nrR').value = ed.nr; $('#nrN').value = ed.nr; $('#cleanSel').value = ed.clean;
  $('#nrCtl').classList.toggle('off', !ed.clean || ed.clean === 'hum' || ed.clean === 'rumble');
  $('#maxR').value = ed.maxDb; $('#maxN').value = ed.maxDb; $('#ceilN').value = ed.ceiling;
  $('#placeSel').value = ed.place; $('#placeR').value = Math.round(ed.placeAmt * 100); $('#placeAmtCtl').classList.toggle('off', !ed.place);
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
// Clean presets: one click for the usual problems
const CLEAN_DEFAULT = { noise: 50, hiss: 60, voice: 50 };
$('#cleanSel').onchange = e => { ed.clean = e.target.value; if (CLEAN_DEFAULT[ed.clean] && !ed.nr) ed.nr = CLEAN_DEFAULT[ed.clean]; changed(); };
$('#nrR').oninput = () => { ed.nr = +$('#nrR').value; if (!ed.clean && ed.nr > 0) ed.clean = 'noise'; changed(); };
$('#maxR').oninput = () => { ed.maxDb = +$('#maxR').value; changed(); };
$('#placeSel').innerHTML = '<option value="">Original space</option>' + Object.entries(PLACES).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
$('#placeSel').onchange = e => { ed.place = e.target.value; changed(); };
$('#placeR').oninput = () => { ed.placeAmt = +$('#placeR').value / 100; changed(); };
$('#placeR').ondblclick = () => { ed.placeAmt = 1; changed(); };
$('#maxN').onchange = () => { ed.maxDb = clamp(+$('#maxN').value || 0, 0, 30); changed(); };
$('#maxR').ondblclick = () => { ed.maxDb = 0; changed(); };
$('#ceilN').onchange = () => { ed.ceiling = clamp(+$('#ceilN').value || -0.3, -12, 0); changed(); saveSession(); };
$('#nrN').onchange = () => { ed.nr = clamp(Math.round(+$('#nrN').value || 0), 0, 100); if (!ed.clean && ed.nr > 0) ed.clean = 'noise'; changed(); };
$('#nrR').ondblclick = () => { ed.nr = 0; changed(); };
$('#learnNoise').onclick = async () => {
  if (!hasSel() || !ed.buf) return;
  const sr = ed.buf.sampleRate, a = Math.floor(ed.selA * sr), b = Math.ceil(ed.selB * sr);
  const chans = []; for (let c = 0; c < ed.buf.numberOfChannels; c++) chans.push(ed.buf.getChannelData(c).slice(a, b));
  const len = (ed.selB - ed.selA).toFixed(2);
  try {
    ed.noise = (await workerCall({ cmd: 'profile', channels: chans })).profile;
    ed.noiseId++;
    ed.selA = ed.selB = 0;
    if (!ed.nr) ed.nr = 60;
    if (!ed.clean || ed.clean === 'hum' || ed.clean === 'rumble') ed.clean = 'noise';
    setStatus(`Noise learned from ${len}s. Adjust Clean to taste, or select the part to keep.`, true);
    changed();
  } catch (e) { setStatus('Could not learn the noise: ' + e.message); }
};
$('#resetEdit').onclick = () => { resetEdit(true); };
function resetEdit(rerender) {
  Object.assign(ed, { selA: 0, selB: 0, speed: 1, semis: 0, tape: ed.tape, gain: 0, fadeIn: 0, fadeOut: 0, reverse: false, normalize: false, nr: 0, noise: null, clean: '', cleanAuto: null, af: false, afReport: '', declicked: null, cleanNote: '', maxDb: 0, place: '', placeAmt: 1, eq: EQ_BANDS.map(() => 0), peq: PEQ_DEFAULT() });
  if (ed.tape) ed.semis = 0;
  // spectral fixes go too: back to the sound as it was loaded
  if (ed.specOps.length && ed.orig) { ed.buf = ed.orig; waveCache = null; }
  ed.specOps = []; ed.specUndo = []; ed.specSel = []; ed.specVer++;
  syncControls();
  if (rerender) changed();
}
/* ---------- Auto Fix: listen, decide, set the tools, set the level ---------- */
const AF_LUFS = -16, AF_CEIL = -1;
const fmtS = t => t < 1 ? Math.round(t * 1000) + ' ms' : t.toFixed(1) + ' s';
async function autoFix() {
  if (!ed.buf || ed.afBusy || ed.specBusy) return;
  const t = loadToken;
  ed.afBusy = true; $('#autoFix').disabled = true;
  stopAll(); clearTimeout(renderTimer);
  resetEdit(false);
  setStatus('Listening to the sound…');
  try {
    const src = ed.buf, sr = src.sampleRate;
    const chans = []; for (let c = 0; c < src.numberOfChannels; c++) chans.push(src.getChannelData(c).slice());
    const { plan } = await workerCall({ cmd: 'analyze', channels: chans.map(c => c.slice()), sampleRate: sr }); // copies: the worker takes ownership
    if (t !== loadToken) return;
    if (plan.silent) { setStatus('This sound is silent. Nothing to fix.'); return; }
    const did = [];
    // 1. clicks and pops: healed in the spectrogram, above 800 Hz where clicks live
    if (plan.clicks.length) {
      setStatus('Removing clicks…', true);
      const n = await declickApply('normal', true);
      clearTimeout(renderTimer);
      if (t !== loadToken) return;
      if (n) did.push(`removed ${n} click${n === 1 ? '' : 's'}`);
    }
    // 2. silence at the start and end
    if (plan.trim && !videoDoc) {   // a video keeps its length
      ed.selA = plan.trim.a; ed.selB = plan.trim.b;
      const parts = []; if (plan.trim.lead) parts.push(fmtS(plan.trim.lead) + ' at the start'); if (plan.trim.tail) parts.push(fmtS(plan.trim.tail) + ' at the end');
      did.push('trimmed silence (' + parts.join(', ') + ')');
    }
    // 3. hum and noise
    if (plan.hum || plan.noise) {
      ed.clean = 'auto';
      ed.cleanAuto = { hum: !!plan.hum, hiss: !!(plan.noise && plan.noise.hiss) };
      ed.nr = plan.noise ? Math.round(plan.noise.strength * 100) : 0;
      if (plan.hum) did.push(`removed ${plan.hum.f0} Hz hum`);
      if (plan.noise) did.push(`reduced ${plan.noise.hiss ? 'hiss' : 'background noise'} (${ed.nr}%)`);
    }
    // 4. EQ: rumble cut and harsh spots, on the parametric EQ where you can see and move them
    if (plan.lowcut || (plan.harsh && plan.harsh.length)) {
      const peq = PEQ_DEFAULT();
      if (plan.lowcut) { Object.assign(peq[0], { f: plan.lowcut, on: true }); did.push(plan.dc ? 'centered the wave' : `cut rumble under ${plan.lowcut} Hz`); }
      (plan.harsh || []).forEach((h, i) => { Object.assign(peq[2 + i * 2 > 4 ? 4 : 2 + i * 2], { f: h.f, g: h.g, q: h.q, on: true }); did.push(`softened a harsh ring at ${fmtFreq(h.f)}`); });
      ed.peq = peq; ed.eqMode = 'param'; ed.eqOn = true;
    }
    ed.af = true; ed.ceiling = AF_CEIL;
    syncControls(); drawWave(); drawSpectrum();
    // 5. level, measured on the fixed sound
    setStatus('Setting the level…');
    if (paramsChanged() || hasSel()) await renderEdit(false); else { ed.out = null; }
    if (t !== loadToken) return;
    const out = ed.out || chans;
    let peak = 0; for (const ch of out) for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
    const peakDb = 20 * Math.log10(peak + 1e-12), lufs = integratedLoudness(out, sr), len = out[0].length / sr;
    const short = len < 3;
    let gain = 0, maxDb = 0, level = '';
    if (short) {
      const need = AF_CEIL - peakDb;
      if (need >= 0.5) maxDb = Math.min(24, Math.floor(need * 2) / 2);
      else if (need < -0.1) gain = Math.round(need * 10) / 10;
    } else if (isFinite(lufs)) {
      const need = AF_LUFS - lufs, headroom = AF_CEIL - peakDb;
      if (need >= 0.5) {
        maxDb = Math.floor(Math.min(need, 24, Math.max(0, headroom) + 4) * 2) / 2;
        if (maxDb > headroom + 0.5) {
          // the limiter has to work: check it really makes the sound louder (on drums it can just flatten the hits)
          ed.gain = 0; ed.maxDb = maxDb; await renderEdit(false);
          if (t !== loadToken) return;
          const got = ed.out ? integratedLoudness(ed.out, sr) - lufs : 0;
          if (got < (maxDb - Math.max(0, headroom)) * 0.6 + Math.max(0, headroom)) maxDb = Math.max(0, Math.floor(headroom * 2) / 2);
        }
        if (maxDb < 0.5) maxDb = 0;
      } else if (headroom < -0.1) { gain = Math.round(headroom * 10) / 10; }
    }
    ed.gain = gain; ed.maxDb = maxDb;
    syncControls();
    if (!paramsChanged() && !hasSel()) {
      ed.af = false; await renderEdit(false);
      setStatus('This sound already sounds clean. Nothing to fix' + (plan.skipped.length ? ` (left ${plan.skipped.join(' and ')} as is).` : '.'), true);
      return;
    }
    await renderEdit(false);
    if (t !== loadToken) return;
    if (!level && ed.out && (maxDb || gain)) {
      const now = integratedLoudness(ed.out, sr);
      level = maxDb ? `raised the level by ${maxDb} dB (${short ? 'peaks at ' + AF_CEIL + ' dB' : 'now ' + now.toFixed(0) + ' LUFS'})` : `lowered the level by ${-gain} dB so it does not clip`;
    }
    if (level) did.push(level);
    ed.afReport = 'Auto Fix: ' + did.join(', ') + '.' + (plan.skipped.length ? ` Left ${plan.skipped.join(' and ')} as is.` : '');
    setStatus(ed.afReport.replace(/^Auto Fix: (.)/, (m, c) => 'Auto Fix ' + c) + ' Press O to compare.', true);
    $('#autoFix').title = ed.afReport;
    syncAb();
    playEdit();
  } catch (e) {
    setStatus('Auto Fix did not work: ' + e.message);
  } finally {
    ed.afBusy = false; $('#autoFix').disabled = false;
  }
}
// Compare: the original and the edit, from the same moment
function abToggle() {
  if (!ed.buf || !ed.outBuf) { setStatus('Nothing to compare yet. Try Auto Fix or change a setting first.'); return; }
  const a = hasSel() ? ed.selA : 0;
  if (eSrc) {
    const pos = editPos(), t0 = ed.reverse ? a : a + pos * ed.speed;
    stopAll(); ac().resume(); player.currentTime = Math.max(0, t0); player.play().catch(() => {});
    setStatus('Original · press O for the edit', true);
  } else {
    const o = !player.paused ? srcToOut(player.currentTime) : 0;
    playEdit(o > 0 && o < ed.outBuf.duration ? o : 0);
    setStatus((ed.af ? 'Fixed' : 'Your edit') + ' · press O for the original', true);
  }
  syncAb();
}
function syncAb() { const b = $('#abBtn'); if (b) b.disabled = !ed.outBuf; }
$('#autoFix').onclick = autoFix;
$('#abBtn').onclick = abToggle;
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
    worker.onmessage = e => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data); } };
  }
  return worker;
}
function workerCall(msg) { return processInWorker(msg); }
function processInWorker(msg) {
  const id = ++jobId;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); getWorker().postMessage({ id, ...msg }, msg.channels.map(c => c.buffer)); });
}
async function renderEdit(autoPlay, live) {
  const t = loadToken, r = current;
  if (!r || !ed.buf) { ed.out = ed.outBuf = ed.path = null; updateClip(); drawResult(); return; }
  if (!isEdited()) { ed.out = ed.outBuf = ed.path = null; updateClip(); drawResult(); updateAvg(); return; }
  const sr = ed.buf.sampleRate;
  const a = hasSel() ? Math.floor(ed.selA * sr) : 0;
  const b = hasSel() ? Math.ceil(ed.selB * sr) : ed.buf.length;
  const channels = [];
  for (let c = 0; c < ed.buf.numberOfChannels; c++) channels.push(ed.buf.getChannelData(c).slice(a, b));
  const settings = { speed: ed.speed, semis: ed.tape ? 0 : ed.semis, tape: ed.tape, reverse: ed.reverse, clean: ed.clean ? { mode: ed.clean, strength: ed.nr / 100, ...(ed.clean === 'auto' ? ed.cleanAuto : null) } : null, noiseId: ed.noise ? ed.noiseId : 0 };
  const preSigOf = () => JSON.stringify([current && current.path, hasSel() ? Math.floor(ed.selA * sr) : 0, hasSel() ? Math.ceil(ed.selB * sr) : ed.buf.length, ed.speed, ed.tape ? 0 : ed.semis, ed.tape, ed.reverse, ed.clean, ed.clean === 'auto' ? ed.cleanAuto : 0, ed.nr, ed.noise ? ed.noiseId : 0, ed.place, ed.placeAmt, ed.specVer]);
  const sigOf = () => preSigOf() + JSON.stringify([ed.gain, ed.fadeIn, ed.fadeOut, ed.normalize, ed.maxDb, ed.ceiling, eqActive() ? [ed.eqMode, eqSetting()] : 0]);
  const preSig = preSigOf();
  // where playback is now, so a live EQ change can carry on from the same spot
  const swapPos = !live ? -1 : eSrc ? editPos() : (!player.paused && !hasSel() && ed.speed === 1 && !ed.reverse ? player.currentTime : -1);
  let out;
  if (ed.stage && ed.stage.sig === preSig) out = ed.stage.out.map(c => c.slice()); // only the EQ or the level changed: skip the slow part
  else {
  ed.rendering = true; updateClip();
  let cleanInfo = {};
  try { const res = await processInWorker({ channels, sampleRate: sr, ...settings, profile: ed.noise }); out = res.channels; cleanInfo = res.info || {}; }
  catch (e) { ed.rendering = false; setStatus('Processing failed: ' + e.message); updateClip(); return; }
  if (t !== loadToken || !ed.buf || preSig !== preSigOf()) return;
  ed.cleanNote = cleanInfo.humHz ? `hum at ${cleanInfo.humHz} Hz removed (${cleanInfo.notches} overtones)` : cleanInfo.humHz === 0 ? 'no hum found' : '';
  // place it: room, wall, device or distance
  if (ed.place) {
    try { out = await placeIt(out, sr, ed.place, ed.placeAmt); }
    catch (e) { setStatus('Could not place the sound: ' + e.message); }
    if (t !== loadToken || !ed.buf || preSig !== preSigOf()) return;
  }
  ed.stage = { sig: preSig, out: out.map(c => c.slice()) };
  }
  // graphic EQ
  if (eqActive()) applyCoefs(out, curCoefs(sr));
  // volume, normalize, fades
  const len = out[0].length;
  let peak = 0;
  for (const ch of out) for (let i = 0; i < len; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
  let g = Math.pow(10, ed.gain / 20);
  if (ed.normalize && peak > 0) g *= Math.pow(10, -0.3 / 20) / peak;
  if (g !== 1) for (const ch of out) for (let i = 0; i < len; i++) ch[i] *= g;
  // maximizer: louder, with a look-ahead limiter holding every peak under the ceiling
  ed.limitDb = 0;
  if (ed.maxDb > 0) { const m = maximize(out, sr, ed.maxDb, ed.ceiling); ed.limitDb = m.reductionDb; }
  const minFade = hasSel() ? Math.round(0.002 * sr) : 0; // tiny fades avoid clicks at cut points
  const fi = Math.min(len, Math.max(minFade, Math.round(ed.fadeIn / 1000 * sr)));
  const fo = Math.min(len, Math.max(minFade, Math.round(ed.fadeOut / 1000 * sr)));
  if (fi || fo) for (const ch of out) {
    for (let i = 0; i < fi; i++) ch[i] *= i / fi;
    for (let i = Math.max(fi, len - fo); i < len; i++) ch[i] *= (len - 1 - i) / fo;
  }
  ed.outPeak = 0; for (const ch of out) for (let i = 0; i < len; i++) { const v = Math.abs(ch[i]); if (v > ed.outPeak) ed.outPeak = v; }
  ed.out = out;
  const ob = ac().createBuffer(out.length, len, sr);
  out.forEach((ch, c) => ob.copyToChannel(ch, c));
  ed.outBuf = ob;
  ed.name = editName(r);
  ed.path = null;
  ed.rendering = false;
  rwaveCache = null;
  updateClip(); drawResult(); updateAvg();
  if (swapPos >= 0 && swapPos < ob.duration) playEdit(swapPos);
  else if (ed.previewAt >= 0) { const o = srcToOut(ed.previewAt); ed.previewAt = -1; if (o >= 0 && o < ob.duration) playEdit(Math.max(o, 0.0001)); }
  else if (autoPlay && $('#autoplay').checked) playEdit();
  // write the WAV so it is ready to drag
  try {
    const p = await sb.writeEdit(ed.name, encodeWav(out, sr, out.length));
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
  if (ed.af) parts.push('fixed');
  if (ed.clean && !ed.af) parts.push({ noise: 'denoise', hiss: 'dehiss', hum: 'dehum', rumble: 'derumble', voice: 'voice clean' }[ed.clean] || 'clean');
  if (ed.specOps.length && !ed.af) parts.push(ed.specOps.every(o => o.action === 'declick') ? 'declicked' : 'repaired');
  if (eqActive() && !ed.af) parts.push('eq');
  if (ed.place) parts.push(PLACES[ed.place].label.replace(/\s*\(.*\)/, '').toLowerCase() + (ed.placeAmt < 1 ? ' ' + Math.round(ed.placeAmt * 100) + '%' : ''));
  if (ed.maxDb > 0 && !ed.af) parts.push('max+' + ed.maxDb + 'dB');
  if (ed.gain) parts.push((ed.gain > 0 ? '+' : '') + ed.gain + 'dB');
  const isCut = hasSel() && (ed.selA > 0.0005 || ed.selB < srcDur() - 0.0005);
  if (!parts.length) parts.push(isCut ? 'cut' : 'edit');
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
  syncAb();
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
  const cleanNote = ed.cleanNote ? ' · ' + ed.cleanNote : '';
  const clipWarn = ed.outPeak > 1.0001 ? ' · clipping, lower the volume or use Maximize' : ed.maxDb > 0 ? ` · limiter up to ${ed.limitDb.toFixed(1)} dB · peak ${(20 * Math.log10(ed.outPeak || 1e-9)).toFixed(1)} dB` : '';
  $('#clip-sub').textContent = `${fmtDur(ed.outBuf.duration)} · ${ed.outBuf.sampleRate / 1000}k 24-bit WAV${cleanNote}${clipWarn}${ed.path ? ' · drag me into any folder' : ''}`;
}
$('#clip').addEventListener('dragstart', e => { e.preventDefault(); if (ed.path) sb.startDrag(ed.path); });
$('#clip').addEventListener('click', () => { if (ed.outBuf) { if (eSrc) stopAll(); else playEdit(); } });
$('#saveEdit').onclick = async () => {
  if (videoDoc) return saveVideo();
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
    c.fillStyle = '#141922'; c.fillRect(0, Math.round(mid), W, 1); c.fillStyle = typeof color === 'function' ? '#5A6272' : color;
    if (spp <= 2) { // zoomed in to sample level: draw the actual wave line
      if (typeof color === 'function') { c.strokeStyle = color((t0 + t1) / 2); }
      c.beginPath();
      for (let x = 0; x < W; x++) { const i = Math.floor(s0 + x * spp); const v = i >= 0 && i < d.length ? d[i] : 0; x ? c.lineTo(x, mid - v * k) : c.moveTo(x, mid - v * k); }
      c.lineWidth = Math.max(1, (devicePixelRatio || 1)); c.stroke();
    } else {
      const stride = Math.max(1, Math.floor(spp / 400));
      const fn = typeof color === 'function' ? color : null; let last = '';
      for (let x = 0; x < W; x++) {
        if (fn) { const cc = fn(t0 + (x + 0.5) / W * (t1 - t0)); if (cc !== last) { c.fillStyle = cc; last = cc; } }
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
  if (midiDoc) drawPianoRoll(W, H);
  else if (ed.buf) {
    const key = zoom.t0 + '|' + zoom.t1 + '|' + W + '|' + H + '|' + midiTrans, tr = midiTrans;
    const k2 = key + '|' + viewMode + '|' + fz.a + '|' + fz.b;
    if (viewMode !== 'wave' && waveCache && waveCache.key !== k2 && waveCache.mode === viewMode && performance.now() - lastWheel < 250) {
      // while zooming, stretch the last spectrogram and redraw it sharp when the wheel stops
      const span = zoom.t1 - zoom.t0, x = (waveCache.t0 - zoom.t0) / span * W, w = (waveCache.t1 - waveCache.t0) / span * W;
      g.drawImage(waveCache.img, x, 0, w, H);
      clearTimeout(specTimer); specTimer = setTimeout(drawWave, 260);
    } else {
      if (!waveCache || waveCache.key !== k2) waveCache = { key: k2, mode: viewMode, t0: zoom.t0, t1: zoom.t1, img: renderView(ed.buf, zoom.t0, zoom.t1, W, H) };
      g.drawImage(waveCache.img, 0, 0);
    }
  } else if (peaks) {
    const mid = H / 2, N = peaks.mn.length, k = mid * 0.92 / 127;
    g.fillStyle = '#4A5262';
    for (let x = 0; x < W; x++) { const i = Math.floor(x / W * N); g.fillRect(x, mid - peaks.mx[i] * k, 1, Math.max(1, (peaks.mx[i] - peaks.mn[i]) * k)); }
  } else { g.fillStyle = '#1E232D'; g.fillRect(0, H / 2, W, 1); return; }
  const dpr = devicePixelRatio || 1;
  if (hasSel()) {
    const a = tToX(ed.selA), b = tToX(ed.selB);
    g.fillStyle = 'rgba(192,140,255,0.10)'; g.fillRect(a, 0, b - a, H);
    g.fillStyle = '#C08CFF'; g.fillRect(a, 0, dpr, H); g.fillRect(b - dpr, 0, dpr, H);
  }
  drawSpecSel(W, H);
  if (ed.buf && viewMode !== 'wave' && fzOn()) { // which frequencies are shown when zoomed in
    const top = specTop(H), h = H - top, sr = ed.buf.sampleRate;
    label(g, `${fmtFreq(yToFreq(h, h, sr))} to ${fmtFreq(yToFreq(0, h, sr))} · double-click for all`, W - 10, top + 16 * dpr, W);
  }
  // where Declick rebuilt the sound: small violet marks along the top
  if (ed.declicked && ed.specOps.some(o => o.action === 'declick')) {
    const dpr = devicePixelRatio || 1; g.fillStyle = '#C08CFF';
    for (const [a, z] of ed.declicked) { if (z < zoom.t0 || a > zoom.t1) continue; const x = tToX((a + z) / 2); g.beginPath(); g.moveTo(x - 4 * dpr, 0); g.lineTo(x + 4 * dpr, 0); g.lineTo(x, 6 * dpr); g.fill(); }
  }
  // playhead
  let ph = -1;
  if (!player.paused || player.currentTime > 0) ph = player.currentTime;
  const ep = editPos();
  if (ep >= 0) { const a = hasSel() ? ed.selA : 0, b = hasSel() ? ed.selB : srcDur(); ph = ed.reverse ? b - ep * ed.speed : a + ep * ed.speed; }
  if (ph >= 0 && ph >= zoom.t0 && ph <= zoom.t1) { g.save(); g.shadowColor = 'rgba(192,140,255,0.95)'; g.shadowBlur = 12 * dpr; g.fillStyle = '#fff'; g.fillRect(Math.floor(tToX(ph)), 0, 2 * dpr, H); g.restore(); }
  // frequency readout under the mouse in spectrogram view
  if (viewMode !== 'wave' && ed.buf && waveHover && waveHover.y >= specTop(H) && !(ed.tool && ed.specSel.length)) {
    const top = specTop(H), f = yToFreq(waveHover.y - top, H - top, ed.buf.sampleRate);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, Math.floor(waveHover.y), W, dpr);
    label(g, fmtFreq(f) + '  ' + noteName(f), waveHover.x + 10 * dpr, waveHover.y - 6 * dpr, W);
  }
  // zoom indicator
  const d = srcDur();
  if (d && (zoom.t0 > 0 || zoom.t1 < d)) {
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0, H - 3 * dpr, W, 3 * dpr);
    g.fillStyle = '#C08CFF'; g.fillRect(zoom.t0 / d * W, H - 3 * dpr, Math.max(2, (zoom.t1 - zoom.t0) / d * W), 3 * dpr);
  }
}
function drawResult() {
  const W = rcanvas.width, H = rcanvas.height;
  rg.clearRect(0, 0, W, H);
  if (!ed.outBuf) { rg.fillStyle = '#1E232D'; rg.fillRect(0, H / 2, W, 1); return; }
  if (!rwaveCache) rwaveCache = renderBufferWave(ed.outBuf, 0, ed.outBuf.duration, W, H, '#C08CFF');
  rg.drawImage(rwaveCache, 0, 0);
  const ep = editPos();
  if (ep >= 0) { rg.fillStyle = '#fff'; rg.fillRect(Math.floor(ep / ed.outBuf.duration * W), 0, devicePixelRatio || 1, H); }
}
function tick() { drawWave(); drawResult(); drawSpectrum(); if (player.isMidi) syncWheels(); if (isPlaying()) requestAnimationFrame(tick); else { updatePlayBtn(); drawSpectrum(); } }

/* ---------- Spectral editing: pick a sound on the spectrogram and remove, reduce or heal it ---------- */
const specArea = H => ({ top: specTop(H), h: H - specTop(H) });
function canvasXY(e) { const r = canvas.getBoundingClientRect(), sx = canvas.width / r.width; return { x: clamp((e.clientX - r.left) * sx, 0, canvas.width), y: (e.clientY - r.top) * sx, sx }; }
function syncSpecTools() {
  const bar = $('#spectools'), show = viewMode !== 'wave' && !!current;
  bar.style.display = show ? '' : 'none';
  $('#wavebox').classList.toggle('spec', show);
  bar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', ed.tool === b.dataset.tool));
  $('#brushSize').style.display = ed.tool === 'brush' ? '' : 'none';
  $('#wandOpts').style.display = ed.tool === 'wand' ? '' : 'none';
  bar.querySelectorAll('[data-act]').forEach(b => b.classList.toggle('ready', ed.specSel.length > 0));
  $('#specUndo').disabled = !ed.specOps.length;
  $('#specUndo').title = ed.specOps.length ? `Undo the last fix (${ed.specOps.length} so far) · ${isMac ? 'Cmd' : 'Ctrl'}+Z` : 'Nothing to undo yet';
  canvas.classList.toggle('spectool', !!ed.tool && show);
}
function setTool(t) {
  if (viewMode === 'wave') setViewMode('spec');
  ed.tool = ed.tool === t ? '' : t;
  syncSpecTools(); updateTime(); drawWave();
}
function specMouseDown(e) {
  if (!ed.tool || viewMode === 'wave' || !ed.buf) return false;
  const p = canvasXY(e), H = canvas.height, { top, h } = specArea(H);
  if (p.y < top) return false;
  e.preventDefault();
  const span = zoom.t1 - zoom.t0, tOf = x => zoom.t0 + x / canvas.width * span, uOf = y => fz.a + clamp((y - top) / h, 0, 1) * (fz.b - fz.a);
  if (ed.tool === 'wand') { wandAt(tOf(p.x), uOf(p.y), e.shiftKey); return true; }
  if (!e.shiftKey) ed.specSel = [];
  let shape;
  if (ed.tool === 'box') { const t = tOf(p.x), u = uOf(p.y); shape = { kind: 'box', t0: t, t1: t, u0: u, u1: u }; }
  else {
    const r = ed.brushPx * p.sx;
    shape = { kind: 'brush', pts: [[tOf(p.x), uOf(p.y)]], rt: r / canvas.width * span, ru: r / h * (fz.b - fz.a) };
  }
  ed.specSel.push(shape);
  let last = p;
  const mv = ev => {
    const q = canvasXY(ev);
    if (shape.kind === 'box') { shape.t1 = tOf(q.x); shape.u1 = uOf(q.y); }
    else {
      // keep the stroke continuous: a dab every third of the brush size
      const r = ed.brushPx * q.sx, d = Math.hypot(q.x - last.x, q.y - last.y), step = r / 3;
      if (d < step) return;
      const n = Math.ceil(d / step);
      for (let i = 1; i <= n; i++) { const x = last.x + (q.x - last.x) * i / n, y = last.y + (q.y - last.y) * i / n; shape.pts.push([tOf(x), uOf(y)]); }
      last = q;
    }
    drawWave();
  };
  const up = () => {
    removeEventListener('mousemove', mv); removeEventListener('mouseup', up);
    // a click without dragging a box selects nothing
    if (shape.kind === 'box' && (Math.abs(shape.t1 - shape.t0) < 0.002 || Math.abs(shape.u1 - shape.u0) < 0.004)) ed.specSel.pop();
    syncSpecTools(); updateTime(); drawWave();
  };
  addEventListener('mousemove', mv); addEventListener('mouseup', up);
  drawWave();
  return true;
}
function drawSpecSel(W, H) {
  if (viewMode === 'wave' || !ed.buf) return;
  const { top, h } = specArea(H), span = zoom.t1 - zoom.t0, X = t => (t - zoom.t0) / span * W, Y = u => top + (u - fz.a) / (fz.b - fz.a) * h;
  const dpr = devicePixelRatio || 1;
  if (ed.specSel.length) {
    const o = document.createElement('canvas'); o.width = W; o.height = H; const c = o.getContext('2d');
    c.fillStyle = '#E6EAF2';   // white reads best over the spectrogram's violets and oranges
    for (const s of ed.specSel) {
      if (s.kind === 'box') c.fillRect(Math.min(X(s.t0), X(s.t1)), Math.min(Y(s.u0), Y(s.u1)), Math.abs(X(s.t1) - X(s.t0)), Math.abs(Y(s.u1) - Y(s.u0)));
      else if (s.kind === 'rects') { for (const [a, b, u0, u1] of s.r) c.fillRect(X(a), Y(u0), Math.max(1, X(b) - X(a)), Math.max(1, Y(u1) - Y(u0))); }
      else { const rx = s.rt / span * W, ry = s.ru / (fz.b - fz.a) * h; for (const [t, u] of s.pts) { c.beginPath(); c.ellipse(X(t), Y(u), Math.max(1, rx), Math.max(1, ry), 0, 0, 2 * Math.PI); c.fill(); } }
    }
    g.save(); g.globalAlpha = 0.33; g.drawImage(o, 0, 0); g.restore();
    g.save(); g.strokeStyle = '#FFFFFF'; g.lineWidth = dpr; g.setLineDash([5 * dpr, 3 * dpr]);
    for (const s of ed.specSel) if (s.kind === 'box') g.strokeRect(Math.min(X(s.t0), X(s.t1)) + 0.5, Math.min(Y(s.u0), Y(s.u1)) + 0.5, Math.abs(X(s.t1) - X(s.t0)), Math.abs(Y(s.u1) - Y(s.u0)));
    g.restore();
    // what is selected, in words
    const b = specBounds();
    if (b) label(g, `${b.t0.toFixed(2)}s to ${b.t1.toFixed(2)}s · ${fmtFreq(b.f0)} to ${fmtFreq(b.f1)}`, Math.min(X(b.t1) + 8 * dpr, W - 10), Math.max(top + 14 * dpr, Y(b.u0) + 12 * dpr), W);
  }
  // brush outline under the mouse
  if (ed.tool === 'brush' && waveHover && waveHover.y >= top) {
    const r = ed.brushPx * (canvas.width / canvas.getBoundingClientRect().width);
    g.save(); g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = dpr; g.beginPath(); g.arc(waveHover.x, waveHover.y, r, 0, 2 * Math.PI); g.stroke(); g.restore();
  }
}
// the Wand: click a sound, the worker finds its shape around that spot (8 seconds either side)
async function wandAt(t, u, add) {
  if (!ed.buf || ed.specBusy) return;
  const buf = ed.buf, sr = buf.sampleRate, fmax = sr / 2, f = F_MIN * Math.pow(fmax / F_MIN, 1 - u);
  const a = Math.max(0, Math.floor((t - 8) * sr)), z = Math.min(buf.length, Math.ceil((t + 8) * sr)), off = a / sr;
  const channels = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) channels.push(buf.getChannelData(c).slice(a, z));
  ed.specBusy = true; setStatus('Finding that sound…');
  let res;
  try { res = await workerCall({ cmd: 'wand', channels, sampleRate: sr, t: t - off, f, opts: { harmonics: $('#wandHarm').checked, tol: $('#wandTol').value }, fmin: F_MIN }); }
  catch (e) { ed.specBusy = false; setStatus('The Wand did not work: ' + e.message); return; }
  ed.specBusy = false;
  if (ed.buf !== buf) return;
  const info = res.info || {};
  if (!res.shapes || !res.shapes.length) { setStatus('Nothing stands out there. Click right on the sound, or try Wide.'); return; }
  for (const s of res.shapes) for (const r of s.r) { r[0] += off; r[1] += off; }
  if (!add) ed.specSel = [];
  ed.specSel.push(...res.shapes);
  setStatus(info.mode === 'tone'
    ? `Selected a tone at ${fmtFreq(info.f)}${info.harmonics ? ` with ${info.harmonics} harmonic${info.harmonics === 1 ? '' : 's'}` : ''}, ${(info.t1 - info.t0).toFixed(2)} s long · now Heal, Remove or Reduce`
    : `Selected a sound from ${(info.t0 + off).toFixed(2)} s to ${(info.t1 + off).toFixed(2)} s, ${fmtFreq(info.f0)} to ${fmtFreq(info.f1)} · now Heal, Remove or Reduce`);
  $('#status').classList.add('ok');
  syncSpecTools(); updateTime(); drawWave();
}
function specBounds() {
  if (!ed.specSel.length || !ed.buf) return null;
  let t0 = 1e9, t1 = -1e9, u0 = 1e9, u1 = -1e9;
  for (const s of ed.specSel) {
    if (s.kind === 'box') { t0 = Math.min(t0, s.t0, s.t1); t1 = Math.max(t1, s.t0, s.t1); u0 = Math.min(u0, s.u0, s.u1); u1 = Math.max(u1, s.u0, s.u1); }
    else if (s.kind === 'rects') for (const [a, b, c, d] of s.r) { t0 = Math.min(t0, a); t1 = Math.max(t1, b); u0 = Math.min(u0, c); u1 = Math.max(u1, d); }
    else for (const [t, u] of s.pts) { t0 = Math.min(t0, t - s.rt); t1 = Math.max(t1, t + s.rt); u0 = Math.min(u0, u - s.ru); u1 = Math.max(u1, u + s.ru); }
  }
  const fmax = ed.buf.sampleRate / 2, fOf = u => F_MIN * Math.pow(fmax / F_MIN, 1 - clamp(u, 0, 1));
  return { t0: Math.max(0, t0), t1: Math.min(srcDur(), t1), u0, u1, f0: fOf(u1), f1: fOf(u0) };
}
async function specApply(action) {
  if (!ed.buf) return;
  if (!ed.specSel.length) { setStatus(viewMode === 'wave' ? 'Open the spectrogram, then draw a box or paint over the sound you want to fix.' : 'First draw a box or paint over the sound you want to fix.'); if (!ed.tool) setTool('box'); return; }
  if (ed.specBusy) return;
  const t = loadToken, src = ed.buf, sr = src.sampleRate, b = specBounds();
  const op = { action, db: ed.specDb, shapes: JSON.parse(JSON.stringify(ed.specSel)) };
  const channels = []; for (let c = 0; c < src.numberOfChannels; c++) channels.push(src.getChannelData(c).slice());
  ed.specBusy = true; setStatus(action === 'heal' ? 'Healing…' : action === 'remove' ? 'Removing…' : 'Reducing…');
  let res;
  try { res = await workerCall({ cmd: 'spectral', channels, sampleRate: sr, op, fmin: F_MIN }); }
  catch (e) { ed.specBusy = false; setStatus('That fix did not work: ' + e.message); return; }
  ed.specBusy = false;
  if (t !== loadToken || ed.buf !== src) return;
  const nb = new AudioBuffer({ length: src.length, numberOfChannels: src.numberOfChannels, sampleRate: sr });
  res.channels.forEach((c, i) => nb.copyToChannel(c, i));
  ed.specUndo.push(src); if (ed.specUndo.length > 20) ed.specUndo.shift();
  ed.specOps.push(op); ed.specVer++;
  ed.buf = nb; waveCache = null; ed.specSel = [];
  setStatus({ heal: 'Healed', remove: 'Removed', reduce: `Turned down by ${ed.specDb} dB` }[action] + ` · ${b.t0.toFixed(2)}s to ${b.t1.toFixed(2)}s · ${isMac ? 'Cmd' : 'Ctrl'}+Z to undo`);
  ed.previewAt = Math.max(0, b.t0 - 0.6); // play it back from just before the fix
  syncSpecTools(); changed(false);
}
// Declick: only the clicks are rebuilt (see declick.mjs); undo like the other repairs
async function declickApply(strength, quiet) {
  if (!ed.buf || ed.specBusy) return 0;
  const t = loadToken, src = ed.buf, sr = src.sampleRate;
  const b = ed.specSel.length ? specBounds() : hasSel() ? { t0: ed.selA, t1: ed.selB } : { t0: 0, t1: src.duration };
  const where = ed.specSel.length || hasSel() ? `${b.t0.toFixed(2)}s to ${b.t1.toFixed(2)}s` : 'the whole sound';
  strength = strength || $('#clickSens').value;
  const channels = []; for (let c = 0; c < src.numberOfChannels; c++) channels.push(src.getChannelData(c).slice());
  ed.specBusy = true; if (!quiet) setStatus('Looking for clicks…', true);
  let res;
  try { res = await workerCall({ cmd: 'declick', channels, sampleRate: sr, opts: { t0: b.t0, t1: b.t1, strength } }); }
  catch (e) { ed.specBusy = false; setStatus('Declick did not work: ' + e.message); return 0; }
  ed.specBusy = false;
  if (t !== loadToken || ed.buf !== src) return 0;
  if (!res.count) { if (!quiet) setStatus(`No clicks found in ${where}${strength !== 'strong' ? '. Try Strong to look harder.' : '.'}`, true); return 0; }
  const nb = new AudioBuffer({ length: src.length, numberOfChannels: src.numberOfChannels, sampleRate: sr });
  res.channels.forEach((c, i) => nb.copyToChannel(c, i));
  ed.specUndo.push(src); if (ed.specUndo.length > 20) ed.specUndo.shift();
  ed.specOps.push({ action: 'declick', strength }); ed.specVer++;
  ed.buf = nb; waveCache = null; ed.specSel = [];
  ed.declicked = res.spots;
  if (!quiet) {
    const total = res.spots.reduce((s, [a, z]) => s + (z - a), 0) * 1000;
    setStatus(`Removed ${res.count} click${res.count === 1 ? '' : 's'} in ${where} · ${total < 10 ? total.toFixed(1) : Math.round(total)} ms rebuilt in total, the rest is untouched · ${isMac ? 'Cmd' : 'Ctrl'}+Z to undo`, true);
    ed.previewAt = Math.max(0, res.spots[0][0] - 0.6);
    syncSpecTools(); changed(false);
  }
  return res.count;
}
$('#declickBtn').onclick = () => declickApply();
function specUndo() {
  if (!ed.specOps.length) return;
  const undone = ed.specOps.pop(); if (undone && undone.action === 'declick') ed.declicked = null; ed.buf = ed.specUndo.pop() || ed.orig; ed.specVer++;
  if (!ed.specOps.length) ed.buf = ed.orig;
  waveCache = null; setStatus('Undone');
  syncSpecTools(); changed(false);
}
$('#spectools').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.tool) setTool(b.dataset.tool);
  else if (b.dataset.act) specApply(b.dataset.act);
  else if (b.id === 'specUndo') specUndo();
});
$('#specDb').onchange = e => { ed.specDb = +e.target.value; };
$('#brushSize').oninput = e => { ed.brushPx = +e.target.value; drawWave(); };

// Mouse: drag to select (or move a selection edge), click to play from a point, wheel to zoom
let drag = null;
canvas.addEventListener('mousedown', e => {
  if (!srcDur() || e.button !== 0) return;
  if (midiDoc) { const r = canvas.getBoundingClientRect(); playFrom(xToT((e.clientX - r.left) * canvas.width / r.width)); e.preventDefault(); return; }
  if (specMouseDown(e)) return;
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
  $('#wavehint').textContent = !current ? 'Drop any sound file here for a quick edit'
    : midiDoc ? 'Click anywhere to play from there · wheel to zoom · double-click to see all'
    : ed.tool && viewMode !== 'wave' ? (ed.specSel.length ? 'Now Remove, Reduce or Heal · Shift adds more · Esc clears' : ed.tool === 'box' ? 'Draw a box around the sound you want to fix · Shift adds more · Ctrl+wheel zooms frequencies' : ed.tool === 'wand' ? 'Click the sound you want to fix · Shift adds more · Ctrl+wheel zooms frequencies' : 'Paint over the sound you want to fix · Shift adds more · Ctrl+wheel zooms frequencies')
    : hasSel() ? 'Drag the highlighted part into any folder or your DAW · click it to hear it · Esc to clear'
    : 'Drag to select · wheel to zoom · double-click to see all · drop a sound file here for a quick edit';
}
addEventListener('mousemove', e => {
  if (!drag) {
    if (e.target === canvas) {
      const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width, x = (e.clientX - rect.left) * sx;
      const edge = hasSel() && (Math.abs(x - tToX(ed.selA)) < 6 * sx || Math.abs(x - tToX(ed.selB)) < 6 * sx);
      const grab = !edge && inGrabZone(x);
      canvas.draggable = grab;
      const inSpec = ed.tool && viewMode !== 'wave' && (e.clientY - rect.top) * sx >= specTop(canvas.height);
      if (inSpec) { canvas.draggable = false; canvas.style.cursor = ed.tool === 'brush' ? 'none' : 'crosshair'; return; }
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
canvas.addEventListener('mousemove', e => { const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width; waveHover = { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sx }; if (viewMode !== 'wave' && !isPlaying()) drawWave(); });
canvas.addEventListener('mouseleave', () => { waveHover = null; if (!isPlaying()) drawWave(); });
// Ctrl+A (Cmd+A) selects the whole sound, not the text of the window
function selectAllWave() {
  const d = srcDur(); if (!d || !ed.buf) return;
  if (ed.selA === 0 && Math.abs(ed.selB - d) < 1e-6) return;
  ed.selA = 0; ed.selB = d; changed(true);
}
sb.on('undo', () => {
  const a = document.activeElement;
  if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && ['search', 'text', 'number', 'password'].includes(a.type)))) document.execCommand('undo');
  else specUndo();
});
sb.on('select-all', () => {
  const a = document.activeElement;
  if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && ['search', 'text', 'number', 'password'].includes(a.type)))) a.select();
  else if (!document.querySelector('.page.show') && !$('#gen').classList.contains('show')) selectAllWave();
});
canvas.addEventListener('dblclick', () => { const d = srcDur(); if (!d) return; zoom.t0 = 0; zoom.t1 = d; fz.a = 0; fz.b = 1; drawWave(); });
canvas.addEventListener('wheel', e => {
  const d = srcDur(); if (!d || (!ed.buf && !midiDoc)) return;
  e.preventDefault();
  lastWheel = performance.now();
  const rect = canvas.getBoundingClientRect(), f = (e.clientX - rect.left) / rect.width;
  // Ctrl+wheel (a pinch on a trackpad) over the spectrogram zooms into frequencies
  const yc = (e.clientY - rect.top) * canvas.height / rect.height, top = specTop(canvas.height);
  if ((e.ctrlKey || e.altKey) && viewMode !== 'wave' && yc >= top) {
    const v = (yc - top) / (canvas.height - top), at = fz.a + v * (fz.b - fz.a);
    let span = clamp((fz.b - fz.a) * Math.pow(1.0025, e.deltaY), 0.03, 1);
    let a = clamp(at - v * span, 0, 1 - span); fz.a = a; fz.b = a + span;
    drawWave(); return;
  }
  let span = zoom.t1 - zoom.t0;
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    const dt = (e.shiftKey ? e.deltaY : e.deltaX) / rect.width * span;
    let t0 = clamp(zoom.t0 + dt, 0, d - span); zoom.t0 = t0; zoom.t1 = t0 + span;
  } else {
    const at = zoom.t0 + f * span;
    const minSpan = ed.buf ? Math.max(64 / ed.buf.sampleRate, 0.002) : 0.25; // MIDI: down to a quarter second
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
const COLS = ['fav', 'wave', 'name', 'dir', 'key', 'bpm', 'ext', 'fmt', 'dur', 'size'];
const COL_DEF = { fav: 28, wave: 120, name: 340, dir: 380, key: 66, bpm: 52, ext: 54, fmt: 132, dur: 66, size: 76 };
let colW = { ...COL_DEF }, specW = 300;
function visibleCols() { return COLS.filter(c => (ktActive() || (c !== 'key' && c !== 'bpm')) && (c !== 'wave' || (soundColors && showWaves))); }
function applyCols() {
  const root = document.documentElement.style;
  const cols = visibleCols();
  root.setProperty('--cols', cols.map(c => colW[c] + 'px').join(' '));
  root.setProperty('--row-w', (cols.reduce((a, c) => a + colW[c], 0) + 16) + 'px');
  root.setProperty('--spec-w', specW + 'px');
}
function fitDefaultCols() { // share the free width between Name and Folder, so the list fits without scrolling sideways
  const others = visibleCols().filter(c => c !== 'name' && c !== 'dir').reduce((a, c) => a + colW[c], 0) + 16;
  const free = Math.max(400, listEl.clientWidth - others - 16); // room for the scrollbar too
  colW.dir = Math.min(360, Math.round(free * 0.38)); colW.name = free - colW.dir;
}
// the last two folders of a path; the full path shows on hover
function shortDir(r) {
  const parts = (r.rootName + '/' + r.dir).split('/').filter(Boolean);
  return parts.length <= 2 ? parts.join('/') + '/' : '…/' + parts.slice(-2).join('/') + '/';
}
const colText = {
  name: r => r.name, dir: r => shortDir(r), key: r => r.key || '', bpm: r => String(r.bpm || ''),
  ext: r => r.ext.toUpperCase(), fmt: r => fmtFormat(r.meta), dur: r => fmtDur(r.dur), size: r => fmtSize(r.size)
};
function autoFit(c) { // double-click a column edge: fit the widest text, like Excel
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = getComputedStyle($('#list')).font || '13px Inter, sans-serif';
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
  if ($('#gen').classList.contains('show')) return;
  if (document.querySelector('.page.show')) { if (e.key === 'Escape') showTab('lib'); return; }
  const typing = e.target.tagName === 'INPUT' && ['search', 'text', 'number'].includes(e.target.type);
  if (e.target.tagName === 'INPUT' && e.target.type === 'range' && e.key.startsWith('Arrow')) return;
  const move = d => { if (!view.length) return; const n = sel < 0 ? 0 : Math.min(view.length - 1, Math.max(0, sel + d)); select(n, $('#autoplay').checked); };
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'a' || e.key === 'A') && !typing) { e.preventDefault(); selectAllWave(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  else if (e.key === 'F5') { e.preventDefault(); if (dirFilter) refreshFolder(dirFilter); else folders.forEach(f => refreshFolder(f + '|')); }
  else if (e.key === 'PageDown') { e.preventDefault(); move(Math.floor(listEl.clientHeight / ROW)); }
  else if (e.key === 'PageUp') { e.preventDefault(); move(-Math.floor(listEl.clientHeight / ROW)); }
  else if (e.key === 'Enter' && e.target.type === 'number') { e.target.blur(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (sel < 0) move(0); else play(); }
  else if (e.key === 'Escape' && typing) { if (e.target.id === 'search') { e.target.value = ''; applyFilter(); saveSession(); } e.target.blur(); }
  else if (typing) return;
  else if (e.key === 'Escape' && ed.specSel.length) { ed.specSel = []; updateTime(); drawWave(); }
  else if (e.key === 'Escape') { if (hasSel()) { ed.selA = ed.selB = 0; changed(false); } }
  else if (e.key === ' ') { e.preventDefault(); if (e.target.blur) e.target.blur(); togglePlay(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); player.currentTime = Math.min(player.duration || 0, player.currentTime + 2); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); player.currentTime = Math.max(0, player.currentTime - 2); }
  else if (e.key === 'r' || e.key === 'R') { ed.reverse = !ed.reverse; changed(); }
  else if (e.key === 's' || e.key === 'S') setViewMode(viewMode === 'wave' ? 'spec' : viewMode === 'spec' ? 'both' : 'wave');
  else if (e.key === 'f' || e.key === 'F') toggleFav(current);
  else if (e.key === 'q' || e.key === 'Q') toggleEq();
  else if ((e.key === 'c' || e.key === 'C') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) openConvert(current);
  else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !typing) { e.preventDefault(); specUndo(); }
  else if ((e.key === 'b' || e.key === 'B') && !typing && !e.ctrlKey && !e.metaKey) setTool('box');
  else if ((e.key === 'p' || e.key === 'P') && !typing && !e.ctrlKey && !e.metaKey) setTool('brush');
  else if ((e.key === 'w' || e.key === 'W') && !typing && !e.ctrlKey && !e.metaKey) setTool('wand');
  else if ((e.key === 'h' || e.key === 'H') && !typing && ed.specSel.length) specApply('heal');
  else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && ed.specSel.length) { e.preventDefault(); specApply('remove'); }
  else if (e.key === 'e' || e.key === 'E') { if (current) sb.showInFolder(current.path); }
  else if (e.key === 'l' || e.key === 'L') toggleLoop();
  else if ((e.key === 'k' || e.key === 'K') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) declickApply();
  else if (e.key === 'Home' && !typing && current) { if (isPlaying()) { if (eSrc) playEdit(); else playFrom(0); } else { player.currentTime = 0; drawWave(); updateTime(); } }
  else if ((e.key === 'a' || e.key === 'A') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) autoFix();
  else if ((e.key === 'o' || e.key === 'O') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) abToggle();
  else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
});

/* ---------- Updates ---------- */
const upd = $('#upd'), updText = $('#upd-text'), updBtn = $('#upd-btn');
let updVersion = '';
sb.on('update', u => {
  if (u.version) updVersion = u.version;
  const chk = $('#chk');
  if (u.status === 'downloading') { upd.classList.add('show'); updBtn.style.display = 'none'; updText.textContent = `Downloading update ${updVersion}… ${u.percent || 0}%`; }
  else if (u.status === 'available') { upd.classList.add('show'); updBtn.style.display = ''; updBtn.textContent = 'Download'; updBtn.dataset.manual = '1'; updText.textContent = `Version ${updVersion} is available.`; }
  else if (u.status === 'ready') { upd.classList.add('show'); updBtn.style.display = ''; updText.textContent = `Version ${updVersion} is ready.`; }
  else if (u.status === 'checking') chk.textContent = 'Checking…';
  else if (u.status === 'latest') chk.textContent = 'Up to date';
  else if (u.status === 'dev') chk.textContent = 'Dev mode';
  else if (u.status === 'error') { chk.textContent = 'Update check failed'; chk.title = u.message || ''; }
  if (['latest', 'error', 'dev'].includes(u.status)) setTimeout(() => { chk.textContent = 'Check for updates'; }, 6000);
});
updBtn.onclick = () => updBtn.dataset.manual ? sb.openDownload() : sb.installUpdate();
$('#chk').onclick = () => sb.checkUpdates();

/* ---------- Start ---------- */
(async function start() {
  sizeCanvas();
  const st = await sb.state();
  if (st.platform === 'darwin') macWording(st);
  $('#ver').textContent = 'v' + st.version; $('#dataPath').textContent = st.dataPath || ''; $('#about-ver').textContent = 'Version ' + st.version;
  folders = st.folders; favs = new Set(st.favorites); tagsMap = st.tags || {}; genInfo = st.gen || {};
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
  $('#loop').checked = !!s.loop; syncLoopBtn();
  if (typeof s.vol === 'number') $('#vol').value = s.vol;
  if (s.tape) { ed.tape = true; syncControls(); }
  if (s.viewMode) setViewMode(s.viewMode, true);
  if (s.eqOn) { ed.eqOn = true; syncControls(); }
  if (s.sideW) sideW = s.sideW;
  if (s.waveH) waveH = s.waveH;
  if (s.specW) specW = s.specW;
  if (s.gen) { const g = s.gen; $('#gen-inf').value = g.inf ?? 0.3; $('#gen-loop').checked = !!g.loop; $('#gen-n').value = g.n || 1; $('#gen-model').value = g.model || 'eleven_text_to_sound_v2'; $('#gen-fmt').value = g.fmt || 'mp3_44100_128'; $('#gen-auto').checked = g.auto !== false; $('#gen-dur').value = $('#gen-durR').value = g.dur || 5; $('#gen-durwrap').style.display = $('#gen-auto').checked ? 'none' : ''; }
  if (typeof s.ceiling === 'number') ed.ceiling = s.ceiling;
  if (Array.isArray(s.ktFolders)) ktFolders = s.ktFolders;
  setWaves(s.showWaves !== false, false);
  if (s.bgPaused) setBgPaused(true, true);
  if (s.midiBank) midiBankPath = s.midiBank;
  midiNoMod = !!s.midiNoMod;
  if (s.video) { vstate = { ...vstate, ...s.video }; applyVbox(); }
  if (typeof s.midiLock === 'string') midiLock = s.midiLock;
  if (typeof s.midiRev3 === 'number') midiRev = s.midiRev3; if (typeof s.midiCho3 === 'number') midiCho = s.midiCho3;
  if (s.midiDly && typeof s.midiDly === 'object') { Object.assign(dly, s.midiDly); syncDelayUi(); }
  applyMidiFx();
  setSoundColors(s.soundColors !== false, false);
  if (s.eqMode === 'param') ed.eqMode = 'param';
  if (s.mapMode && window.setMapMode) setTimeout(() => setMapMode(true, true), 0);
  setKeyTempo(!!s.keyTempo, false);
  if (s.colW && s.colFit === 3) colW = { ...COL_DEF, ...s.colW }; else { if (s.colW) colW = { ...COL_DEF, ...s.colW }; fitDefaultCols(); setTimeout(saveSession, 0); }
  applyCols();
  applySizes();
  updateWaveHint();
  ac();
  audioEl.volume = +$('#vol').value;
  if (Array.isArray(s.expanded)) s.expanded.forEach(k => expanded.add(k));
  if (!folders.length) { applyFilter(); return; }
  const lib = await sb.libraryLoad();
  for (const r of lib) {
    if (r.missing) missing.add(r.root);
    if (r.files.length) byRoot.set(r.root, makeRecords(r.root, r.files));
    if (!s.expanded) expanded.add(r.root + '|');
  }
  mergeAll(true);
  checkAll(); // look for anything added or removed while the app was closed
  if (s.selPath) {
    const i = view.findIndex(r => r.path === s.selPath);
    if (i >= 0) { sel = i; current = view[i]; listEl.scrollTop = s.scroll || Math.max(0, i * ROW - 100); ensureVisible(i); render(); load(current, false); }
  }
})();
