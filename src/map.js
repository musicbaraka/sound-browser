'use strict';
/* Sound map: every analyzed sound as a dot. Across: dark and deep to bright and airy (its color).
   Up and down: smooth to noisy. Sweep to listen, click to open, Shift+drag to pick a set.
   Shares the window's globals with renderer.js (view, files, select, ...). */

let mapMode = false;
const mcv = $('#mapcv'), mg = mcv.getContext('2d');
const mov = $('#mapov'), mo = mov.getContext('2d');
const MAP = {
  pts: [], x: null, y: null, s: null, b: null,        // records, world positions 0..1, size, color bucket
  cx: 0.5, cy: 0.5, zoom: 1,                          // view: centre and zoom
  sx: null, sy: null, grid: null, cell: 0,            // screen positions and a grid for finding the dot under the mouse
  hover: -1, picked: null, dirty: true, img: null, imgView: null, labels: [], placed: 0, waiting: 0, stopWords: null
};
const MAP_BUCKETS = 32, MAP_COLORS = Array.from({ length: MAP_BUCKETS }, (_, i) => scColor(i / (MAP_BUCKETS - 1)));
const PAD = 40;

// stable small random offset per sound, so equal sounds don't sit exactly on top of each other
function hash01(str, k) { let h = 2166136261 ^ k; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }

function mapBuild() {
  const pts = view.filter(r => r.meta && r.meta.fp && r.meta.fp.v === SC_V && !r.meta.fp.silent);
  const n = pts.length;
  MAP.pts = pts; MAP.placed = n; MAP.waiting = view.length - n;
  MAP.x = new Float32Array(n); MAP.y = new Float32Array(n); MAP.s = new Float32Array(n); MAP.b = new Uint8Array(n);
  // up and down: rank by texture, so the sounds spread evenly whatever the library holds
  const fk = new Float64Array(n);
  for (let i = 0; i < n; i++) fk[i] = pts[i].meta.fp.f + (pts[i]._mh || (pts[i]._mh = hash01(pts[i].path, 7))) * 1e-4;
  const order = new Uint32Array(n); for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => fk[a] - fk[b]);
  for (let k = 0; k < n; k++) MAP.y[order[k]] = n > 1 ? k / (n - 1) : 0.5;
  for (let i = 0; i < n; i++) {
    const fp = pts[i].meta.fp;
    const h = pts[i]._mh;
    MAP.x[i] = Math.min(1, Math.max(0, fp.t + ((h * 7.31) % 1 - 0.5) * 0.014));
    MAP.y[i] = Math.min(1, Math.max(0, MAP.y[i] + ((h * 13.7) % 1 - 0.5) * 0.01));
    const d = pts[i].dur || 1;
    MAP.s[i] = Math.max(1.6, Math.min(4.2, 1.6 + Math.log2(1 + d) * 0.7));
    MAP.b[i] = Math.round(fp.t * (MAP_BUCKETS - 1));
  }
  // words that appear everywhere (pack prefixes, "wav", "fx") say nothing about a region
  const df = new Map(), step = Math.max(1, Math.floor(n / 30000)); let seen = 0;
  for (let i = 0; i < n; i += step) { seen++; for (const w of new Set(mapWords(pts[i]))) df.set(w, (df.get(w) || 0) + 1); }
  MAP.stopWords = new Set([...df].filter(([, c]) => c > seen * 0.25).map(([w]) => w));
  MAP.index = new Map(); for (let i = 0; i < n; i++) MAP.index.set(pts[i], i);
  MAP.hover = -1; MAP.dirty = true; MAP.img = null;
  mapStatus(); mapDraw(); mapSide();
}
const MAP_SKIP = new Set(['wav', 'aif', 'aiff', 'mp3', 'flac', 'ogg', 'the', 'and', 'for', 'with', 'sfx', 'fx', 'sound', 'sounds', 'effect', 'effects', 'stereo', 'mono', 'loop', 'loops', 'one', 'shot', 'take', 'version', 'final', 'mix', 'edit', 'copy', 'new', 'var', 'alt']);
function mapWords(r) { return r._mw || (r._mw = mapWordsOf(r)); }
function mapWordsOf(r) { return (r.base || r.name).toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-zà-ÿ]+/).filter(w => w.length >= 3 && !MAP_SKIP.has(w)); }

/* ---------- view transform ---------- */
function mapSize() {
  const dpr = devicePixelRatio || 1, r = mcv.getBoundingClientRect();
  const W = Math.max(50, Math.round(r.width * dpr)), H = Math.max(50, Math.round(r.height * dpr));
  if (mcv.width !== W || mcv.height !== H) { mcv.width = W; mcv.height = H; mov.width = W; mov.height = H; MAP.dirty = true; }
  return { W, H, dpr };
}
function toScreen(wx, wy, W, H, dpr) {
  const p = PAD * dpr, z = MAP.zoom;
  return [p + ((wx - MAP.cx) * z + 0.5) * (W - 2 * p), p + ((1 - wy - (1 - MAP.cy)) * z + 0.5) * (H - 2 * p)];
}
function toWorld(sx, sy, W, H, dpr) {
  const p = PAD * dpr, z = MAP.zoom;
  return [MAP.cx + ((sx - p) / (W - 2 * p) - 0.5) / z, 1 - ((1 - MAP.cy) + ((sy - p) / (H - 2 * p) - 0.5) / z)];
}
function clampView() { const h = 0.5 / MAP.zoom; MAP.cx = Math.min(1 - h + 0.05, Math.max(h - 0.05, MAP.cx)); MAP.cy = Math.min(1 - h + 0.05, Math.max(h - 0.05, MAP.cy)); if (MAP.zoom <= 1) { MAP.cx = 0.5; MAP.cy = 0.5; } }

/* ---------- drawing ---------- */
let mapRaf = 0, mapSettle = 0;
function mapDraw(fast) {
  if (!mapMode) return;
  if (mapRaf) return;
  mapRaf = requestAnimationFrame(() => { mapRaf = 0; mapPaint(fast); });
}
function mapPaint(fast) {
  const { W, H, dpr } = mapSize();
  const viewKey = MAP.cx + '|' + MAP.cy + '|' + MAP.zoom + '|' + W + '|' + H;
  if (fast && MAP.img && MAP.imgView) {
    // while zooming or panning: move the last picture, draw it sharp once the mouse settles
    const v = MAP.imgView, k = MAP.zoom / v.zoom, p = PAD * dpr;
    const [ox, oy] = toScreen(v.x0, v.y0, W, H, dpr);
    mg.clearRect(0, 0, W, H);
    mg.drawImage(MAP.img, ox - p * k, oy - p * k, W * k, H * k);
    clearTimeout(mapSettle); mapSettle = setTimeout(() => { MAP.dirty = true; mapPaint(false); }, 160);
    mapOverlay(); return;
  }
  if (!MAP.dirty && MAP.imgView && MAP.imgView.key === viewKey) { mapOverlay(); return; }
  const n = MAP.pts.length;
  mg.clearRect(0, 0, W, H);
  // faint grid
  mg.strokeStyle = '#121822'; mg.lineWidth = dpr;
  for (let k = 0; k <= 4; k++) {
    const [gx] = toScreen(k / 4, 0, W, H, dpr), [, gy] = toScreen(0, k / 4, W, H, dpr);
    mg.beginPath(); mg.moveTo(gx, 0); mg.lineTo(gx, H); mg.moveTo(0, gy); mg.lineTo(W, gy); mg.stroke();
  }
  MAP.sx = new Float32Array(n); MAP.sy = new Float32Array(n);
  const cell = Math.round(14 * dpr), gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
  const grid = new Map();
  const zoomGrow = Math.min(2.2, Math.sqrt(MAP.zoom));
  // small sets glow (light adds up); big sets blend, so dense areas keep their color instead of turning white
  const big = n > 20000;
  const alpha = big ? Math.max(0.16, Math.min(0.6, 50000 / n)) : Math.max(0.28, Math.min(0.9, 6000 / Math.max(1, n)));
  mg.globalCompositeOperation = big ? 'source-over' : 'lighter';
  // by color, so the brush changes only 32 times
  const byB = Array.from({ length: MAP_BUCKETS }, () => []);
  const pp = PAD * dpr, z = MAP.zoom, kw = (W - 2 * pp) * z, kh = (H - 2 * pp) * z, ox = pp + (W - 2 * pp) / 2 - MAP.cx * kw, oy = pp + (H - 2 * pp) / 2 + MAP.cy * kh;
  for (let i = 0; i < n; i++) {
    const x = ox + MAP.x[i] * kw, y = oy - MAP.y[i] * kh;   // same as toScreen, without the per-dot cost
    MAP.sx[i] = x; MAP.sy[i] = y;
    if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
    byB[MAP.b[i]].push(i);
    const gk = Math.floor(y / cell) * gw + Math.floor(x / cell);
    const g = grid.get(gk); g ? g.push(i) : grid.set(gk, [i]);
  }
  const halo = n < 4000;
  for (let b = 0; b < MAP_BUCKETS; b++) {
    const list = byB[b]; if (!list.length) continue;
    mg.fillStyle = MAP_COLORS[b];
    if (halo) {
      mg.globalAlpha = 0.07;
      for (const i of list) { const r = MAP.s[i] * 3.2 * dpr * zoomGrow; mg.beginPath(); mg.arc(MAP.sx[i], MAP.sy[i], r, 0, 6.2832); mg.fill(); }
    }
    mg.globalAlpha = alpha;
    if (n < 20000) for (const i of list) { const r = MAP.s[i] * dpr * zoomGrow; mg.beginPath(); mg.arc(MAP.sx[i], MAP.sy[i], r, 0, 6.2832); mg.fill(); }
    else for (const i of list) { const r = Math.max(0.5 * dpr, MAP.s[i] * 0.4 * dpr * zoomGrow); mg.fillRect(MAP.sx[i] - r, MAP.sy[i] - r, r * 2, r * 2); }
  }
  mg.globalAlpha = 1; mg.globalCompositeOperation = 'source-over';
  MAP.grid = grid; MAP.cell = cell; MAP.gw = gw;
  mapLabels(W, H, dpr);
  // keep the picture for fast panning and zooming
  const img = MAP.img && MAP.img.width === W && MAP.img.height === H ? MAP.img : document.createElement('canvas');
  img.width = W; img.height = H; img.getContext('2d').drawImage(mcv, 0, 0);
  const [x0, y0] = toWorld(PAD * dpr, PAD * dpr, W, H, dpr);
  MAP.img = img; MAP.imgView = { key: viewKey, zoom: MAP.zoom, x0, y0 };
  MAP.dirty = false;
  mapOverlay();
}
// words from file names that mark a region ("Kick", "Rain", "Whoosh")
function mapLabels(W, H, dpr) {
  const cells = new Map(), CW = 230 * dpr, CH = 150 * dpr;
  const step = Math.max(1, Math.floor(MAP.pts.length / 40000)); // a sample is plenty to name a region
  for (let i = 0; i < MAP.pts.length; i += step) {
    const x = MAP.sx[i], y = MAP.sy[i]; if (x < 0 || y < 0 || x > W || y > H) continue;
    const k = Math.floor(y / CH) * 1000 + Math.floor(x / CW);
    let c = cells.get(k); if (!c) cells.set(k, c = { n: 0, words: new Map() });
    c.n++;
    for (const w of new Set(mapWords(MAP.pts[i]))) { if (MAP.stopWords.has(w)) continue; const e = c.words.get(w); if (e) { e.n++; e.x += x; e.y += y; } else c.words.set(w, { n: 1, x, y }); }
  }
  const labels = [];
  for (const c of cells.values()) {
    if (c.n < 6) continue;
    let best = null; for (const [w, e] of c.words) if (!best || e.n > best[1].n) best = [w, e];
    if (best && best[1].n >= Math.max(4, c.n * 0.22)) labels.push({ t: best[0][0].toUpperCase() + best[0].slice(1), x: best[1].x / best[1].n, y: best[1].y / best[1].n - 14 * dpr, n: best[1].n });
  }
  mg.font = `500 ${12 * dpr}px Inter, sans-serif`; mg.textAlign = 'center';
  for (const l of labels) {
    mg.fillStyle = 'rgba(10,12,17,0.65)'; const w = mg.measureText(l.t).width;
    mg.fillRect(l.x - w / 2 - 5 * dpr, l.y - 11 * dpr, w + 10 * dpr, 16 * dpr);
    mg.fillStyle = '#C9D0DC'; mg.fillText(l.t, l.x, l.y + 1 * dpr);
  }
  mg.textAlign = 'start';
  MAP.labels = labels;
}
// hover ring, the open sound, and the box being drawn
function mapOverlay() {
  const W = mov.width, H = mov.height, dpr = devicePixelRatio || 1;
  mo.clearRect(0, 0, W, H);
  const ring = (i, col, r) => { if (i < 0 || !MAP.sx) return; mo.beginPath(); mo.arc(MAP.sx[i], MAP.sy[i], r * dpr, 0, 6.2832); mo.strokeStyle = col; mo.lineWidth = 2 * dpr; mo.stroke(); };
  if (MAP.picked) { mo.fillStyle = 'rgba(125,245,201,0.9)'; for (const i of MAP.picked) if (MAP.sx[i] > -5) mo.fillRect(MAP.sx[i] - 1.5 * dpr, MAP.sy[i] - 1.5 * dpr, 3 * dpr, 3 * dpr); }
  const cur = current && MAP.index ? (MAP.index.get(current) ?? -1) : -1;
  if (cur >= 0) { ring(cur, '#FFFFFF', 9); mo.beginPath(); mo.arc(MAP.sx[cur], MAP.sy[cur], 15 * dpr, 0, 6.2832); mo.strokeStyle = 'rgba(125,245,201,0.35)'; mo.lineWidth = 5 * dpr; mo.stroke(); }
  if (MAP.hover >= 0 && MAP.hover !== cur) ring(MAP.hover, 'rgba(255,255,255,0.85)', 7);
  if (mapBox) {
    const x = Math.min(mapBox.x0, mapBox.x1), y = Math.min(mapBox.y0, mapBox.y1), w = Math.abs(mapBox.x1 - mapBox.x0), h = Math.abs(mapBox.y1 - mapBox.y0);
    mo.fillStyle = 'rgba(125,245,201,0.08)'; mo.fillRect(x, y, w, h);
    mo.setLineDash([5 * dpr, 3 * dpr]); mo.strokeStyle = '#7DF5C9'; mo.lineWidth = dpr; mo.strokeRect(x + 0.5, y + 0.5, w, h); mo.setLineDash([]);
  }
}
function mapStatus() {
  const st = $('#mapstat');
  if (!MAP.placed && !MAP.waiting) st.textContent = 'No sounds to show. Clear the search or pick another folder.';
  else if (!soundColors) st.textContent = 'Turn on sound colors in Settings to place your sounds on the map.';
  else st.textContent = `${MAP.placed.toLocaleString()} sounds placed` + (MAP.waiting ? ` · ${MAP.waiting.toLocaleString()} still being listened to, they appear as they are ready` : '') + ' · sweep to listen · click to open · Shift+drag to pick a set';
}

/* ---------- finding the dot under the mouse ---------- */
function mapHit(sx, sy) {
  if (!MAP.grid) return -1;
  const c = MAP.cell, gx = Math.floor(sx / c), gy = Math.floor(sy / c);
  let best = -1, bd = (12 * (devicePixelRatio || 1)) ** 2;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const list = MAP.grid.get((gy + dy) * MAP.gw + gx + dx); if (!list) continue;
    for (const i of list) { const d = (MAP.sx[i] - sx) ** 2 + (MAP.sy[i] - sy) ** 2; if (d < bd) { bd = d; best = i; } }
  }
  return best;
}
const mapXY = e => { const r = mcv.getBoundingClientRect(), k = mcv.width / r.width; return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; };

/* ---------- listening as you sweep ---------- */
const preview = new Audio(); preview.preload = 'auto';
let previewWired = false, previewTimer = 0, previewUrl = null, previewFor = null;
function previewPlay(r) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    if (!$('#mapListen').checked || previewFor === r) return;
    previewFor = r;
    const c = ac(); c.resume();
    if (!previewWired) { c.createMediaElementSource(preview).connect(bus); previewWired = true; }
    if (!player.paused) player.pause();
    if (eSrc) stopAll();
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    try {
      if (IS_AIFF(r.ext)) { const buf = aiffToWav(await getBuffer(r)); if (previewFor !== r) return; previewUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })); preview.src = previewUrl; }
      else preview.src = sb.fileUrl(r.path);
      preview.currentTime = 0; await preview.play();
      requestAnimationFrame(tick);
    } catch (e) {}
  }, 45);
}
function previewStop() { clearTimeout(previewTimer); previewFor = null; if (!preview.paused) preview.pause(); }

/* ---------- side panel ---------- */
function mapSide() {
  const el = $('#mapside');
  if (MAP.picked && MAP.picked.length) {
    const n = MAP.picked.length;
    el.innerHTML = `<div class="side-h">Picked on the map</div><div class="mbig">${n.toLocaleString()} sound${n === 1 ? '' : 's'}</div>
      <div class="mrow"><button id="mpShow" class="primary">Show them in the list</button><button id="mpClear">Clear</button></div>
      <label class="mlab" for="mpTag">Tag them all</label><div class="mrow"><input id="mpTag" type="text" placeholder="rain, outdoor" autocomplete="off"><button id="mpTagGo">Add tag</button></div>
      <div id="mpMsg" class="mhint"></div>
      <div class="side-h" style="margin-top:14px">In this set</div><ul class="mlist">${MAP.picked.slice(0, 12).map(i => mapItem(MAP.pts[i])).join('')}</ul>`;
    $('#mpShow').onclick = () => { pathFilter = new Set(MAP.picked.map(i => MAP.pts[i].path)); MAP.picked = null; setMapMode(false); applyFilter(); };
    $('#mpClear').onclick = () => { MAP.picked = null; mapOverlay(); mapSide(); };
    const go = () => { const t = splitTags($('#mpTag').value); if (!t.length) { $('#mpMsg').textContent = 'Type a tag first.'; return; } const paths = MAP.picked.map(i => MAP.pts[i].path); setTags(paths, t); $('#mpTag').value = ''; $('#mpMsg').textContent = `Tagged ${paths.length.toLocaleString()} sounds with ${t.join(', ')}.`; };
    $('#mpTagGo').onclick = go; $('#mpTag').onkeydown = e => { if (e.key === 'Enter') go(); e.stopPropagation(); };
    return;
  }
  const r = MAP.hover >= 0 ? MAP.pts[MAP.hover] : current && MAP.pts.includes(current) ? current : null;
  if (!r) { el.innerHTML = `<div class="side-h">Sound map</div><p class="mhint">Each dot is a sound. Left is dark and deep, right is bright and airy. Low is smooth, high is noisy. Sounds close together sound alike, whatever their names say.</p><p class="mhint">Move over the dots to hear them. Click one to open it. Hold Shift and drag to pick a set, then tag it or show it in the list.</p>`; return; }
  const fp = r.meta.fp;
  el.innerHTML = `<div class="side-h">${r === current ? 'Open sound' : 'Under the mouse'}</div>
    <div class="mname">${esc(r.name)}</div><div class="mhint">${esc(r.rootName + '/' + r.dir)} · ${fmtDur(r.dur)}${fp.n > 0.6 ? ' · noisy' : ''}</div>
    <div class="mwave">${miniWave(r)}</div>
    <div class="side-h" style="margin-top:14px">Sounds like this</div><ul class="mlist">${mapNear(MAP.pts.indexOf(r), 8).map(i => mapItem(MAP.pts[i])).join('')}</ul>`;
}
function mapItem(r) { return `<li data-p="${esc(r.path)}" title="${esc(r.path)}">${miniWave(r)}<span>${esc(r.name)}</span><b>${fmtDur(r.dur)}</b></li>`; }
function mapNear(i, k) {
  if (i < 0) return [];
  const x = MAP.x[i], y = MAP.y[i], ld = Math.log2(1 + (MAP.pts[i].dur || 1)), best = [];
  for (let j = 0; j < MAP.pts.length; j++) {
    if (j === i) continue;
    const d = (MAP.x[j] - x) ** 2 * 4 + (MAP.y[j] - y) ** 2 + ((Math.log2(1 + (MAP.pts[j].dur || 1)) - ld) * 0.04) ** 2;
    if (best.length < k || d < best[best.length - 1][0]) { best.push([d, j]); best.sort((a, b) => a[0] - b[0]); if (best.length > k) best.pop(); }
  }
  return best.map(b => b[1]);
}
$('#mapside').addEventListener('click', e => {
  const li = e.target.closest('li[data-p]'); if (!li) return;
  const r = files.find(f => f.path === li.dataset.p); if (r) openFromMap(r);
});
function openFromMap(r) {
  previewStop();
  let i = view.indexOf(r);
  if (i < 0) return;
  select(i, true);
  const k = MAP.pts.indexOf(r); if (k >= 0) { MAP.hover = -1; }
  mapOverlay(); mapSide();
}

/* ---------- mouse ---------- */
let mapDrag = null, mapBox = null;
mcv.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const [x, y] = mapXY(e);
  if (e.shiftKey) { mapBox = { x0: x, y0: y, x1: x, y1: y }; previewStop(); }
  else mapDrag = { x, y, cx: MAP.cx, cy: MAP.cy, moved: false };
  e.preventDefault();
});
addEventListener('mousemove', e => {
  if (!mapMode) return;
  if (mapBox) { const [x, y] = mapXY(e); mapBox.x1 = x; mapBox.y1 = y; mapOverlay(); return; }
  if (mapDrag) {
    const [x, y] = mapXY(e), W = mcv.width - 2 * PAD * (devicePixelRatio || 1), H = mcv.height - 2 * PAD * (devicePixelRatio || 1);
    if (Math.abs(x - mapDrag.x) + Math.abs(y - mapDrag.y) > 4) mapDrag.moved = true;
    if (mapDrag.moved && MAP.zoom > 1) { MAP.cx = mapDrag.cx - (x - mapDrag.x) / W / MAP.zoom; MAP.cy = mapDrag.cy + (y - mapDrag.y) / H / MAP.zoom; clampView(); mapPaint(true); }
    return;
  }
  if (e.target !== mcv) return;
  const [x, y] = mapXY(e), i = mapHit(x, y);
  mcv.style.cursor = i >= 0 ? 'pointer' : MAP.zoom > 1 ? 'grab' : 'default';
  if (i !== MAP.hover) { MAP.hover = i; mapOverlay(); mapSide(); if (i >= 0) previewPlay(MAP.pts[i]); }
});
addEventListener('mouseup', e => {
  if (!mapMode) return;
  if (mapBox) {
    const x0 = Math.min(mapBox.x0, mapBox.x1), x1 = Math.max(mapBox.x0, mapBox.x1), y0 = Math.min(mapBox.y0, mapBox.y1), y1 = Math.max(mapBox.y0, mapBox.y1);
    mapBox = null;
    const got = []; if (x1 - x0 > 4 && y1 - y0 > 4) for (let i = 0; i < MAP.pts.length; i++) if (MAP.sx[i] >= x0 && MAP.sx[i] <= x1 && MAP.sy[i] >= y0 && MAP.sy[i] <= y1) got.push(i);
    MAP.picked = got.length ? got : null; mapOverlay(); mapSide(); return;
  }
  if (mapDrag) {
    const d = mapDrag; mapDrag = null;
    if (!d.moved && e.target === mcv) { const [x, y] = mapXY(e), i = mapHit(x, y); if (i >= 0) openFromMap(MAP.pts[i]); }
  }
});
mcv.addEventListener('mouseleave', () => { if (MAP.hover >= 0) { MAP.hover = -1; mapOverlay(); mapSide(); } previewStop(); });
mcv.addEventListener('wheel', e => {
  e.preventDefault();
  const { W, H, dpr } = mapSize(), [x, y] = mapXY(e), [wx, wy] = toWorld(x, y, W, H, dpr);
  MAP.zoom = Math.min(40, Math.max(1, MAP.zoom * Math.exp(-e.deltaY * 0.0015)));
  const [nx, ny] = toWorld(x, y, W, H, dpr);
  MAP.cx += wx - nx; MAP.cy += wy - ny; clampView();
  MAP.hover = -1; mapPaint(true);
}, { passive: false });
mcv.addEventListener('dblclick', e => { const [x, y] = mapXY(e); if (mapHit(x, y) < 0) { MAP.zoom = 1; clampView(); MAP.dirty = true; mapDraw(); } });

/* ---------- switching between list and map ---------- */
function setMapMode(on, quiet) {
  mapMode = !!on;
  document.body.classList.toggle('mapmode', mapMode);
  document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'map') === mapMode));
  if (!mapMode) { previewStop(); MAP.picked = null; mapBox = null; }
  else { MAP.dirty = true; mapBuild(); }
  if (!quiet) saveSession();
}
$('#viewSeg').onclick = e => { const b = e.target.closest('button'); if (b) setMapMode(b.dataset.v === 'map'); };
$('#pfChip').onclick = () => { pathFilter = null; applyFilter(); };
// the list's filters changed: rebuild the map from what is shown
let mapRebuild = 0;
function mapViewChanged() { if (!mapMode) return; clearTimeout(mapRebuild); mapRebuild = setTimeout(mapBuild, 60); }
// new fingerprints came in: refresh now and then
let mapDataTimer = 0;
function mapDataChanged() { if (!mapMode || mapDataTimer || mapDrag || mapBox) return; mapDataTimer = setTimeout(() => { mapDataTimer = 0; mapBuild(); }, view.length > 50000 ? 20000 : 2500); }
addEventListener('resize', () => { if (mapMode) { MAP.dirty = true; mapDraw(); } });
addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.page.show') || document.querySelector('.modalwrap.show')) return;
  if (e.key === 'm' || e.key === 'M') setMapMode(!mapMode);
  else if (mapMode && e.key === 'Escape' && MAP.picked) { MAP.picked = null; mapOverlay(); mapSide(); }
});
