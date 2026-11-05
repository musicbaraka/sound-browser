// Musical key and tempo detection. Input: mono Float32Array at a low sample rate (11025 Hz).
// Shared by the analysis worker; kept free of browser APIs so it can be tested in Node.
const AN_N = 4096;
const anTables = {};
function anFFT(N) {
  if (anTables[N]) return anTables[N];
  const bits = Math.log2(N), rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2), win = new Float64Array(N);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / N); sin[i] = -Math.sin(2 * Math.PI * i / N); }
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  return (anTables[N] = { rev, cos, sin, win, re: new Float64Array(N), im: new Float64Array(N) });
}
function anMag(x, start, N, mag) {
  const { rev, cos, sin, win, re, im } = anFFT(N);
  for (let i = 0; i < N; i++) { const j = start + i; re[rev[i]] = (j >= 0 && j < x.length ? x[j] : 0) * win[i]; im[rev[i]] = 0; }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
      const a = i + j, b = a + half, tr = re[b] * cos[k] - im[b] * sin[k], ti = re[b] * sin[k] + im[b] * cos[k];
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
  for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
}

const PITCHES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Krumhansl-Kessler key profiles
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function corr(a, b) {
  const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let s = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; sa += x * x; sb += y * y; }
  return sa && sb ? s / Math.sqrt(sa * sb) : 0;
}

function detectKey(x, sr) {
  const N = AN_N, hop = N / 2, mag = new Float64Array(N / 2);
  const chroma = new Float64Array(12);
  // map FFT bins (65 Hz to 2 kHz) to pitch classes
  const pc = new Int8Array(N / 2).fill(-1);
  for (let k = 1; k < N / 2; k++) { const f = k * sr / N; if (f >= 65 && f <= 2000) pc[k] = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12; }
  let flatSum = 0, frames = 0, energy = 0;
  for (let s = 0; s + N <= x.length || (s === 0 && x.length > 0); s += hop) {
    anMag(x, s, N, mag);
    let lsum = 0, sum = 0, cnt = 0;
    for (let k = 1; k < N / 2; k++) {
      if (pc[k] < 0) continue;
      const m = mag[k];
      // only count bins that stand out as spectral peaks (tonal content)
      if (m > mag[k - 1] && m >= mag[k + 1]) chroma[pc[k]] += m;
      sum += m; lsum += Math.log(m + 1e-9); cnt++;
    }
    if (sum > 1e-4) { flatSum += Math.exp(lsum / cnt) / (sum / cnt); frames++; energy += sum; }
    if (s + N >= x.length) break;
  }
  if (!frames) return null;
  const flatness = flatSum / frames;          // near 1 for noise, near 0 for clear tones
  let best = { r: -2 }, second = -2;
  for (let t = 0; t < 12; t++) {
    const rot = i => chroma[(i + t) % 12];
    const c = Array.from({ length: 12 }, (_, i) => rot(i));
    for (const [prof, mode] of [[MAJOR, 'maj'], [MINOR, 'min']]) {
      const r = corr(c, prof);
      if (r > best.r) { second = best.r; best = { r, key: PITCHES[t] + ' ' + mode }; }
      else if (r > second) second = r;
    }
  }
  const conf = Math.max(0, Math.min(1, (best.r - 0.45) * 2)) * Math.max(0, 1 - flatness * 2);
  return { key: best.key, conf: +conf.toFixed(2), r: +best.r.toFixed(3), flatness: +flatness.toFixed(3) };
}

function detectBpm(x, sr) {
  const dur = x.length / sr;
  if (dur < 3.5) return null;
  const N = 1024, hop = 128, fps = sr / hop, mag = new Float64Array(N / 2), prev = new Float64Array(N / 2);
  const nF = Math.floor((x.length - N) / hop) + 1;
  const flux = new Float64Array(nF);
  for (let f = 0; f < nF; f++) {
    anMag(x, f * hop, N, mag);
    let s = 0;
    for (let k = 1; k < N / 2; k++) { const v = Math.log1p(mag[k] * 10); const d = v - prev[k]; if (d > 0) s += d; prev[k] = v; }
    flux[f] = s;
  }
  // remove the slow trend, keep the onsets
  const w = Math.round(fps * 0.4), on = new Float64Array(nF);
  let acc = 0; const q = [];
  for (let f = 0; f < nF; f++) { q.push(flux[f]); acc += flux[f]; if (q.length > w) acc -= q.shift(); on[f] = Math.max(0, flux[f] - acc / q.length); }
  const lo = Math.floor(fps * 60 / 200), hi = Math.ceil(fps * 60 / 55);
  if (hi >= nF / 2) return null;
  const ac = new Float64Array(hi + 2);
  let e0 = 0; for (let f = 0; f < nF; f++) e0 += on[f] * on[f];
  if (e0 <= 0) return null;
  for (let L = lo - 1; L <= hi + 1; L++) { let s = 0; for (let f = L; f < nF; f++) s += on[f] * on[f - L]; ac[L] = s / (nF - L) * nF / e0; }
  // score each candidate tempo by its period plus multiples, gently preferring 80 to 160 BPM
  let best = -1, bestL = 0;
  for (let L = lo; L <= hi; L++) {
    const bpm = 60 * fps / L;
    const sc = (ac[L] + 0.5 * (2 * L <= hi + 1 ? ac[2 * L] : ac[L]) + 0.25 * (L % 2 === 0 ? ac[L / 2] : 0)) * Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115) / 0.9, 2));
    if (sc > best) { best = sc; bestL = L; }
  }
  const a = ac[bestL - 1], b = ac[bestL], c = ac[bestL + 1];
  const off = (a - 2 * b + c) ? 0.5 * (a - c) / (a - 2 * b + c) : 0;
  let bpm = 60 * fps / (bestL + Math.max(-0.5, Math.min(0.5, off)));
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  // periodicity strength: how much the beat lag stands out against the average
  let mean = 0; for (let L = lo; L <= hi; L++) mean += ac[L]; mean /= (hi - lo + 1);
  const conf = Math.max(0, Math.min(1, (b - mean) / (mean + 1e-9) / 1.5));
  return { bpm: Math.round(bpm * 10) / 10, conf: +conf.toFixed(2) };
}

function analyzeMono(x, sr) {
  const k = detectKey(x, sr), t = detectBpm(x, sr);
  return {
    key: k && k.conf >= 0.25 ? k.key : null, keyConf: k ? k.conf : 0,
    bpm: t && t.conf >= 0.35 ? Math.round(t.bpm) : null, bpmConf: t ? t.conf : 0
  };
}
if (typeof module !== 'undefined') module.exports = { detectKey, detectBpm, analyzeMono };
