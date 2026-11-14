// Sound colors: where a sound's energy sits gives it a color, from warm (deep) to cool (bright).
// Shared by the window (big waveform) and the analysis worker (list fingerprints). No browser APIs.
const SC_V = 2;  // 2: keeps the raw texture value (f) for the sound map
const SC_LO = 90, SC_HI = 8000;              // centroid range mapped from 0 to 1, on a log scale
const SC_STOPS = [[255, 138, 76], [192, 140, 255], [91, 227, 255]]; // warm, violet, cyan

function scBright(centroid) {
  if (!(centroid > 0)) return 0.5;
  return Math.max(0, Math.min(1, Math.log(centroid / SC_LO) / Math.log(SC_HI / SC_LO)));
}
function scColor(t) {
  t = Math.max(0, Math.min(1, t));
  const k = t < 0.5 ? 0 : 1, f = t < 0.5 ? t * 2 : (t - 0.5) * 2, a = SC_STOPS[k], b = SC_STOPS[k + 1];
  return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
}

const scTables = {};
function scFFT(N) {
  if (scTables[N]) return scTables[N];
  const bits = Math.log2(N), rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2), win = new Float64Array(N);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / N); sin[i] = -Math.sin(2 * Math.PI * i / N); }
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  return (scTables[N] = { rev, cos, sin, win, re: new Float64Array(N), im: new Float64Array(N), p: new Float64Array(N / 2) });
}
// power spectrum of one frame; returns { e, c, f }: energy, centroid in Hz, flatness 0..1
function scFrame(x, start, N, sr) {
  const T = scFFT(N), { rev, cos, sin, win, re, im, p } = T;
  for (let i = 0; i < N; i++) { const j = start + i; re[rev[i]] = (j >= 0 && j < x.length ? x[j] : 0) * win[i]; im[rev[i]] = 0; }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
      const a = i + j, b = a + half, tr = re[b] * cos[k] - im[b] * sin[k], ti = re[b] * sin[k] + im[b] * cos[k];
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
  const hz = sr / N, k0 = Math.max(1, Math.ceil(30 / hz)), k1 = Math.min(N / 2 - 1, Math.floor(Math.min(16000, sr / 2) / hz));
  let e = 0, ce = 0;
  for (let k = k0; k <= k1; k++) { const v = re[k] * re[k] + im[k] * im[k]; p[k] = v; e += v; ce += v * k * hz; }
  // noisiness: compare each bin with its neighbourhood. Noise looks even after that, tones stick out.
  // Only bins within 50 dB of the loudest count, so a pure tone's empty floor is not read as noise.
  const f0 = Math.max(k0, Math.ceil(60 / hz)), f1 = Math.min(k1, Math.floor(Math.min(10000, sr / 2 - hz) / hz));
  let pmax = 0; for (let k = f0; k <= f1; k++) if (p[k] > pmax) pmax = p[k];
  let lgr = 0, sr2 = 0, n = 0; const W = 6;
  for (let k = f0 + W; k <= f1 - W; k++) {
    if (p[k] < pmax * 1e-5) continue;
    let loc = 0; for (let d = -W; d <= W; d++) loc += p[k + d]; loc /= 2 * W + 1;
    const r = p[k] / (loc + 1e-30); lgr += Math.log(r + 1e-12); sr2 += r; n++;
  }
  const flat = n > 8 ? Math.exp(lgr / n) / (sr2 / n) : 0;
  return { e, c: e > 0 ? ce / e : 0, f: flat };
}

// Fingerprint of a whole sound: mini waveform (48 steps), brightness and noisiness
function scFingerprint(x, sr) {
  const len = x.length, B = 48;
  let peak = 0; const env = new Float32Array(B);
  for (let b = 0; b < B; b++) {
    const a = Math.floor(b * len / B), z = Math.max(a + 1, Math.floor((b + 1) * len / B));
    let m = 0; for (let i = a; i < z && i < len; i++) { const v = x[i] < 0 ? -x[i] : x[i]; if (v > m) m = v; }
    env[b] = m; if (m > peak) peak = m;
  }
  let w = '';
  for (let b = 0; b < B; b++) w += Math.round(peak > 0 ? Math.pow(env[b] / peak, 0.7) * 35 : 0).toString(36);
  const N = 2048, frames = Math.min(160, Math.max(1, Math.floor(len / (N / 2))));
  let we = 0, wl = 0, wf = 0;
  for (let i = 0; i < frames; i++) {
    const start = frames === 1 ? 0 : Math.floor(i * (len - N) / (frames - 1));
    const r = scFrame(x, start, N, sr);
    if (r.e <= 1e-9 || !(r.c > 0)) continue;
    const wt = Math.sqrt(r.e);
    we += wt; wl += wt * Math.log(r.c); wf += wt * r.f;
  }
  const t = we > 0 ? scBright(Math.exp(wl / we)) : 0.5;
  const n = we > 0 ? Math.max(0, Math.min(1, (wf / we - 0.12) / 0.4)) : 0;
  const out = { v: SC_V, t: Math.round(t * 1000) / 1000, n: Math.round(n * 1000) / 1000, f: we > 0 ? Math.round(wf / we * 1000) / 1000 : 0, w };
  if (peak < 1e-4) out.silent = 1;
  return out;
}

// Brightness along the sound, one value per column, for coloring the big waveform
function scTrack(x, sr, cols) {
  const N = 1024, len = x.length, out = new Float32Array(cols), en = new Float32Array(cols);
  let emax = 0;
  for (let c = 0; c < cols; c++) {
    const mid = Math.floor((c + 0.5) * len / cols), r = scFrame(x, mid - N / 2, N, sr);
    out[c] = r.c > 0 ? scBright(r.c) : NaN; en[c] = r.e; if (r.e > emax) emax = r.e;
  }
  // near-silent columns borrow the color of their neighbours
  for (let c = 0; c < cols; c++) if (!(en[c] > emax * 1e-6)) out[c] = NaN;
  let last = NaN; for (let c = 0; c < cols; c++) { if (isNaN(out[c])) out[c] = last; else last = out[c]; }
  last = NaN; for (let c = cols - 1; c >= 0; c--) { if (isNaN(out[c])) out[c] = last; else last = out[c]; }
  const sm = new Float32Array(cols);
  for (let c = 0; c < cols; c++) { let s = 0, k = 0; for (let d = -2; d <= 2; d++) { const v = out[c + d]; if (v === v && c + d >= 0 && c + d < cols) { s += v; k++; } } sm[c] = k ? s / k : 0.5; }
  return sm;
}
if (typeof module !== 'undefined') module.exports = { SC_V, scBright, scColor, scFingerprint, scTrack };
