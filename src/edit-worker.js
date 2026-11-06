// Speed, pitch and reverse processing, run off the main thread.
import { SoundTouch, SimpleFilter } from './vendor/soundtouch.js';
import { cleanup, learnNoise } from './cleanup.mjs';

// Tape mode: plain resampling, so speed and pitch move together (Catmull-Rom interpolation).
function resample(x, speed) {
  const n = Math.max(1, Math.round(x.length / speed));
  const y = new Float32Array(n), last = x.length - 1;
  for (let i = 0; i < n; i++) {
    const p = i * speed, k = Math.floor(p), t = p - k;
    const a = x[Math.max(0, k - 1)], b = x[Math.min(last, k)], c = x[Math.min(last, k + 1)], d = x[Math.min(last, k + 2)];
    y[i] = b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
  }
  return y;
}

// Independent speed and pitch with SoundTouch (works on stereo pairs).
function stretchPair(L, R, speed, semis, sampleRate) {
  const st = new SoundTouch();
  st.tempo = speed;
  st.pitchSemitones = semis;
  const n = L.length, pad = Math.ceil(sampleRate * 0.6), total = n + pad;
  const source = {
    extract(target, num, pos) {
      const m = Math.max(0, Math.min(num, total - pos));
      for (let i = 0; i < m; i++) { const j = pos + i; target[2 * i] = j < n ? L[j] : 0; target[2 * i + 1] = j < n ? R[j] : 0; }
      return m;
    }
  };
  const filter = new SimpleFilter(source, st);
  const want = Math.max(1, Math.round(n / speed));
  const oL = new Float32Array(want), oR = new Float32Array(want);
  const B = 8192, buf = new Float32Array(B * 2);
  let got = 0;
  while (got < want) {
    const k = filter.extract(buf, B);
    if (!k) break;
    const m = Math.min(k, want - got);
    for (let i = 0; i < m; i++) { oL[got + i] = buf[2 * i]; oR[got + i] = buf[2 * i + 1]; }
    got += m;
  }
  return [oL, oR];
}


/* ---------- Noise reduction (spectral gating with a learned or estimated noise profile) ---------- */
const NR_N = 2048, NR_H = 512, NR_B = NR_N / 2 + 1;
let nrT = null;
function nrTables() {
  if (nrT) return nrT;
  const N = NR_N, bits = Math.log2(N), rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2), win = new Float64Array(N);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / N); sin[i] = -Math.sin(2 * Math.PI * i / N); }
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  return (nrT = { rev, cos, sin, win });
}
function fft(re, im, inverse) {
  const { rev, cos, sin } = nrTables(), N = NR_N;
  for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  const sg = inverse ? -1 : 1;
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
      const a = i + j, b = a + half, c = cos[k], s = sin[k] * sg;
      const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}
function frameMag(x, start, re, im, mag) {
  const { win } = nrTables();
  for (let i = 0; i < NR_N; i++) { const j = start + i; re[i] = (j >= 0 && j < x.length ? x[j] : 0) * win[i]; im[i] = 0; }
  fft(re, im, false);
  for (let k = 0; k < NR_B; k++) mag[k] = Math.hypot(re[k], im[k]);
}
function mixMono(chs) {
  if (chs.length === 1) return chs[0];
  const n = chs[0].length, m = new Float32Array(n);
  for (const c of chs) for (let i = 0; i < n; i++) m[i] += c[i] / chs.length;
  return m;
}
// Average magnitude per frequency bin over the given audio: the "noise fingerprint"
function learnProfile(chs) {
  const x = mixMono(chs), re = new Float64Array(NR_N), im = new Float64Array(NR_N), mag = new Float64Array(NR_B);
  const prof = new Float32Array(NR_B);
  let frames = 0;
  for (let s = 0; s + NR_N <= Math.max(x.length, NR_N); s += NR_H) { frameMag(x, s, re, im, mag); for (let k = 0; k < NR_B; k++) prof[k] += mag[k]; frames++; }
  for (let k = 0; k < NR_B; k++) prof[k] /= Math.max(1, frames);
  return prof;
}
// No learned profile: estimate the noise floor as a low percentile of each bin over time
function estimateProfile(chs) {
  const x = mixMono(chs), re = new Float64Array(NR_N), im = new Float64Array(NR_N), mag = new Float64Array(NR_B);
  const total = Math.max(1, Math.floor((x.length - NR_N) / NR_H) + 1), F = Math.min(400, total);
  const cols = Array.from({ length: NR_B }, () => new Float32Array(F));
  for (let f = 0; f < F; f++) {
    const s = Math.round(f * (total - 1) / Math.max(1, F - 1)) * NR_H;
    frameMag(x, s, re, im, mag);
    for (let k = 0; k < NR_B; k++) cols[k][f] = mag[k];
  }
  const prof = new Float32Array(NR_B), q = Math.floor(F * 0.1);
  for (let k = 0; k < NR_B; k++) { cols[k].sort(); prof[k] = cols[k][q] * 2.7; } // 10th percentile of noise magnitudes is about 1/2.7 of their mean
  return prof;
}
function denoise(x, prof, amountDb) {
  const { win } = nrTables();
  const floor = Math.pow(10, -amountDb / 20), thresh = 2.0; // treat anything under ~6 dB above the noise as noise
  const n = x.length, out = new Float64Array(n + 2 * NR_N), norm = new Float64Array(n + 2 * NR_N);
  const re = new Float64Array(NR_N), im = new Float64Array(NR_N);
  const gain = new Float64Array(NR_B), prev = new Float64Array(NR_B).fill(1), sm = new Float64Array(NR_B);
  for (let s = -NR_N + NR_H; s < n; s += NR_H) {
    for (let i = 0; i < NR_N; i++) { const j = s + i; re[i] = (j >= 0 && j < n ? x[j] : 0) * win[i]; im[i] = 0; }
    fft(re, im, false);
    for (let k = 0; k < NR_B; k++) {
      const m = Math.hypot(re[k], im[k]), nz = prof[k] * thresh;
      let g = m > 1e-12 ? 1 - (nz * nz) / (m * m) : 0;
      g = Math.max(floor, Math.min(1, g));
      g = Math.max(g, prev[k] * 0.65); // release smoothing keeps tails natural and avoids "musical noise"
      gain[k] = g;
    }
    for (let k = 0; k < NR_B; k++) sm[k] = (gain[Math.max(0, k - 1)] + 2 * gain[k] + gain[Math.min(NR_B - 1, k + 1)]) / 4;
    for (let k = 0; k < NR_B; k++) { prev[k] = gain[k]; re[k] *= sm[k]; im[k] *= sm[k]; if (k > 0 && k < NR_N / 2) { re[NR_N - k] = re[k]; im[NR_N - k] = -im[k]; } }
    fft(re, im, true);
    for (let i = 0; i < NR_N; i++) { const j = s + i + NR_N; const w = win[i]; out[j] += re[i] / NR_N * w; norm[j] += w * w; }
  }
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const w = norm[i + NR_N]; y[i] = w > 1e-6 ? out[i + NR_N] / w : 0; }
  return y;
}

self.onmessage = (e) => {
  const { id, cmd } = e.data;
  if (cmd === 'profile') {
    try { const p = learnNoise(e.data.channels); self.postMessage({ id, profile: p }, [p.buffer]); }
    catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
    return;
  }
  let { channels } = e.data;
  const { sampleRate, speed, semis, tape, reverse, clean, profile } = e.data;
  let out, info = {};
  try {
    if (clean && clean.mode) {
      const r = cleanup(channels, sampleRate, { mode: clean.mode, strength: clean.strength, profile });
      channels = r.channels; info = r.info;
    }
    if (tape) {
      out = speed === 1 ? channels : channels.map(c => resample(c, speed));
    } else if (speed === 1 && semis === 0) {
      out = channels;
    } else {
      out = [];
      for (let c = 0; c < channels.length; c += 2) {
        const L = channels[c], R = channels[c + 1] || channels[c];
        const [a, b] = stretchPair(L, R, speed, semis, sampleRate);
        out.push(a);
        if (channels[c + 1]) out.push(b);
      }
    }
    if (reverse) out.forEach(c => c.reverse());
    self.postMessage({ id, channels: out, info }, out.map(c => c.buffer));
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
