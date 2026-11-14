// Cleanup tools: noise reduction (Wiener filter with decision-directed SNR), hiss-only mode,
// hum and buzz removal (automatic 50/60 Hz detection, narrow notches on every overtone), rumble removal.

const N = 2048, H = 512, B = N / 2 + 1;
let T = null;
function tables() {
  if (T) return T;
  const bits = Math.log2(N), rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2), win = new Float64Array(N);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / N); sin[i] = -Math.sin(2 * Math.PI * i / N); }
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  return (T = { rev, cos, sin, win });
}
function fft(re, im, inverse) {
  const { rev, cos, sin } = tables();
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
function mono(chs) {
  if (chs.length === 1) return chs[0];
  const n = chs[0].length, m = new Float32Array(n);
  for (const c of chs) for (let i = 0; i < n; i++) m[i] += c[i] / chs.length;
  return m;
}
function framePower(x, start, re, im, out) {
  const { win } = tables();
  for (let i = 0; i < N; i++) { const j = start + i; re[i] = (j >= 0 && j < x.length ? x[j] : 0) * win[i]; im[i] = 0; }
  fft(re, im, false);
  for (let k = 0; k < B; k++) out[k] = re[k] * re[k] + im[k] * im[k];
}

/* ---------- Noise profile: average power per frequency ---------- */
export function learnNoise(chs) {
  const x = mono(chs), re = new Float64Array(N), im = new Float64Array(N), p = new Float64Array(B), prof = new Float32Array(B);
  let f = 0;
  for (let s = 0; s + N <= Math.max(x.length, N); s += H) { framePower(x, s, re, im, p); for (let k = 0; k < B; k++) prof[k] += p[k]; f++; }
  for (let k = 0; k < B; k++) prof[k] /= Math.max(1, f);
  return prof;
}
// Without a learned profile: the quiet floor of each frequency over time (low percentile, corrected to a mean)
export function estimateNoise(chs) {
  const x = mono(chs), re = new Float64Array(N), im = new Float64Array(N), p = new Float64Array(B);
  const total = Math.max(1, Math.floor((x.length - N) / H) + 1), F = Math.min(400, total);
  const cols = Array.from({ length: B }, () => new Float32Array(F));
  for (let f = 0; f < F; f++) { framePower(x, Math.round(f * (total - 1) / Math.max(1, F - 1)) * H, re, im, p); for (let k = 0; k < B; k++) cols[k][f] = p[k]; }
  const prof = new Float32Array(B), q = Math.floor(F * 0.1);
  for (let k = 0; k < B; k++) { cols[k].sort(); prof[k] = cols[k][q] * 4.7; } // 10th percentile of noise power is about 1/4.7 of its mean
  return prof;
}

// The noise under steady tones: a low percentile across nearby frequencies, so a held note
// or a pad is never mistaken for noise (only the floor between its partials counts)
export function floorEnvelope(prof) {
  const B = prof.length, out = new Float32Array(B), buf = [];
  for (let b = 0; b < B; b++) {
    const w = 10 + Math.round(b * 0.2), a = Math.max(0, b - w), e = Math.min(B - 1, b + w);
    buf.length = 0; for (let k = a; k <= e; k++) buf.push(prof[k]);
    buf.sort((p, q) => p - q);
    out[b] = Math.min(prof[b], buf[Math.floor(buf.length * 0.1)]);
  }
  return out;
}

/* ---------- Noise reduction ----------
   strength 0..1. maxReductionDb caps how far noise is pushed down, which keeps the result natural.
   hissOnly: leave everything under ~2.5 kHz untouched. */
export function reduceNoise(x, prof, sr, strength, { maxReductionDb = 18, hissOnly = false } = {}) {
  const { win } = tables();
  const over = 1 + strength * 1.5;                      // how much of the profile counts as noise
  const floor = Math.pow(10, -(maxReductionDb * Math.min(1, strength * 1.25)) / 20);
  const alpha = 0.97;                                   // decision-directed smoothing: removes "musical noise"
  const n = x.length, out = new Float64Array(n + 2 * N), norm = new Float64Array(n + 2 * N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const prevG2P = new Float64Array(B), G = new Float64Array(B), Gs = new Float64Array(B);
  const keep = new Float64Array(B);                     // 1 = leave this frequency alone
  if (hissOnly) for (let k = 0; k < B; k++) { const f = k * sr / N; keep[k] = f <= 2000 ? 1 : f >= 4000 ? 0 : 1 - (f - 2000) / 2000; }
  let first = true;
  for (let s = -N + H; s < n; s += H) {
    for (let i = 0; i < N; i++) { const j = s + i; re[i] = (j >= 0 && j < n ? x[j] : 0) * win[i]; im[i] = 0; }
    fft(re, im, false);
    for (let k = 0; k < B; k++) {
      const P = re[k] * re[k] + im[k] * im[k], Nn = prof[k] * over + 1e-20;
      const post = P / Nn;
      const prio = first ? Math.max(post - 1, 0) : alpha * prevG2P[k] / Nn + (1 - alpha) * Math.max(post - 1, 0);
      let g = prio / (1 + prio);
      if (g < floor) g = floor;
      G[k] = g;
      prevG2P[k] = g * g * P;
    }
    first = false;
    for (let k = 0; k < B; k++) { // smooth across neighbouring frequencies
      let g = (G[Math.max(0, k - 1)] + 2 * G[k] + G[Math.min(B - 1, k + 1)]) / 4;
      g = keep[k] + (1 - keep[k]) * g;
      Gs[k] = g;
    }
    for (let k = 0; k < B; k++) { re[k] *= Gs[k]; im[k] *= Gs[k]; if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; } }
    fft(re, im, true);
    for (let i = 0; i < N; i++) { const j = s + i + N, w = win[i]; out[j] += re[i] / N * w; norm[j] += w * w; }
  }
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const w = norm[i + N]; y[i] = w > 1e-6 ? out[i + N] / w : 0; }
  return y;
}

/* ---------- Biquad filters, run forward then backward (no phase smear) ---------- */
function biquad(type, f, q, sr) {
  const w = 2 * Math.PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  if (type === 'notch') { b0 = 1; b1 = -2 * c; b2 = 1; }
  else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; } // highpass
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function runBiquad(x, [b0, b1, b2, a1, a2]) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
}
function zeroPhase(x, coefs) {
  const y = Float32Array.from(x);
  for (const c of coefs) runBiquad(y, c);
  y.reverse(); for (const c of coefs) runBiquad(y, c); y.reverse();
  return y;
}

/* ---------- Hum and buzz ---------- */
// Level at one exact frequency, with a Hann window so nearby loud tones do not leak in (rotating phasor: fast)
let hannCache = null;
function tonePower(x, f, sr, start, len) {
  if (!hannCache || hannCache.length !== len) { hannCache = new Float32Array(len); for (let i = 0; i < len; i++) hannCache[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (len - 1)); }
  const w = 2 * Math.PI * f / sr, cw = Math.cos(w), sw = Math.sin(w);
  let c = 1, s = 0, a = 0, b = 0;
  for (let i = 0; i < len; i++) {
    const v = x[start + i] * hannCache[i];
    a += v * c; b -= v * s;
    const nc = c * cw - s * sw; s = s * cw + c * sw; c = nc;
    if ((i & 1023) === 1023) { const m = 1 / Math.hypot(c, s); c *= m; s *= m; } // keep the phasor exact
  }
  return (a * a + b * b) / (len * len);
}
// Electrical hum is a razor-thin line: compare it with the frequencies 1.5 to 3 Hz away, where a musical note would still be loud
function prominence(x, f, sr, start, len, floor) {
  const on = tonePower(x, f, sr, start, len);
  if (on < floor) return 0;
  let off = 0; for (const d of [-3, -1.5, 1.5, 3]) off += tonePower(x, f + d, sr, start, len);
  return on / (off / 4 + 1e-24);
}
// Finds mains hum: steady, sharp peaks at 50 or 60 Hz and their overtones.
// Returns which overtones are really there, so only those get removed.
export function detectHum(chs, sr) {
  let x = mono(chs);
  // hum overtones stay under 6 kHz, so a lighter copy of the sound is enough (4 times fewer samples)
  if (sr >= 32000) { const d = new Float32Array(Math.floor(x.length / 4)); for (let i = 0; i < d.length; i++) d[i] = (x[4 * i] + x[4 * i + 1] + x[4 * i + 2] + x[4 * i + 3]) / 4; x = d; sr = sr / 4; }
  const len = Math.min(x.length, Math.round(sr * 4)), start = Math.max(0, Math.floor((x.length - len) / 2));
  if (len < sr * 0.5) return null;
  let total = 0; for (let i = start; i < start + len; i++) total += x[i] * x[i];
  const floor = total / len * 1e-9;                      // ignore lines far below the sound itself (about -90 dB)
  let best = null;
  for (const f0 of [50, 60]) {
    const present = [];
    let low = 0, score = 0, r1 = 0;
    for (let h = 1; h * f0 <= Math.min(5000, sr / 2 - 300); h++) {
      const r = prominence(x, f0 * h, sr, start, len, floor);
      if (h === 1) r1 = r;
      if (r > 20) { present.push(h); score += Math.log10(r); if (h <= 4) low++; }
      if (h === 4 && low < 2) break; // no hum among the first overtones: stop early
    }
    // real hum shows up among the first overtones, on several of them,
    // or as a very sharp line at 50 or 60 Hz with a few overtones (a voice or instrument can hide the others)
    const ok = (low >= 2 && present.length >= 3) || (r1 > 300 && present.length >= 2);
    if (ok && (!best || score > best.score)) best = { f0, score, harmonics: present };
  }
  return best;
}
export function removeHum(x, sr, f0, harmonics) {
  const list = harmonics || Array.from({ length: 40 }, (_, i) => i + 1);
  const coefs = [];
  for (const h of list) { const f = f0 * h; if (f > sr / 2 - 200) break; coefs.push(biquad('notch', f, f / 3.5, sr)); } // about 3.5 Hz wide
  return { y: zeroPhase(x, coefs), count: coefs.length };
}

/* ---------- Rumble ---------- */
export function removeRumble(x, sr, cutoff = 75) {
  return zeroPhase(x, [biquad('highpass', cutoff, 0.7071, sr)]); // forward and back: a steep 24 dB per octave low cut
}

/* ---------- The whole cleanup step ---------- */
// o: { mode: 'hiss' | 'noise' | 'hum' | 'rumble' | 'voice' | 'custom' | 'auto', strength 0..1, profile, hum?, hiss? (auto) }
export function cleanup(chs, sr, o) {
  const info = {};
  let out = chs;
  const doRumble = o.mode === 'rumble' || o.mode === 'voice';
  const auto = o.mode === 'auto';                       // Auto Fix: only what the analysis found
  const doHum = o.mode === 'hum' || o.mode === 'voice' || (auto && !!o.hum);
  const doNoise = o.mode === 'noise' || o.mode === 'hiss' || o.mode === 'voice' || o.mode === 'custom' || auto;
  const hissOnly = o.mode === 'hiss' || (auto && !!o.hiss);
  if (doRumble) { out = out.map(c => removeRumble(c, sr)); info.rumble = true; }
  if (doHum) {
    const h = detectHum(out, sr);
    if (h) { let count = 0; out = out.map(c => { const r = removeHum(c, sr, h.f0, h.harmonics); count = r.count; return r.y; }); info.humHz = h.f0; info.notches = count; }
    else info.humHz = 0;
  }
  if (doNoise && o.strength > 0) {
    const prof = o.profile || (auto ? floorEnvelope(estimateNoise(out)) : estimateNoise(out));
    const strength = o.mode === 'voice' ? Math.min(o.strength, 0.6) : o.strength;
    out = out.map(c => reduceNoise(c, prof, sr, strength, { hissOnly, maxReductionDb: hissOnly ? 20 : 18 }));
    info.noise = true;
  }
  return { channels: out, info };
}
