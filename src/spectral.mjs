// Spectral editing: repair a region of the spectrogram.
// A region is a list of shapes in (time in seconds, u) where u is the spectrogram's vertical
// position: 0 at the top (half the sample rate) and 1 at the bottom (fmin), on a log scale.
//   { kind: 'box', t0, t1, u0, u1 }
//   { kind: 'brush', pts: [[t, u], ...], rt, ru }   (an ellipse of radius rt seconds by ru around each point)
// Actions: 'remove' (silence it), 'reduce' (turn it down by db), 'heal' (rebuild it from what surrounds it).

let T = null;
function tables(N) {
  if (T && T.N === N) return T;
  const bits = Math.log2(N), rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2), win = new Float64Array(N);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / N); sin[i] = -Math.sin(2 * Math.PI * i / N); }
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  return (T = { N, rev, cos, sin, win });
}
function fft(re, im, inverse, N) {
  const { rev, cos, sin } = tables(N);
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
const princ = a => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// Build the mask (frames x bins, 0..1) for a region
function buildMask(shapes, sr, N, H, nFrames, fmin) {
  const B = N / 2 + 1, m = new Float32Array(nFrames * B);
  const fmax = sr / 2, L = Math.log(fmax / fmin);
  const uOfBin = new Float32Array(B);
  for (let b = 0; b < B; b++) { const f = Math.max(b, 0.5) * sr / N; uOfBin[b] = f <= fmin ? 1 : 1 - Math.log(f / fmin) / L; }
  // frames reach half a window around their centre, so widen in time a little to catch the edges of an event
  const pad = N / 4 / sr;
  const tOf = k => k * H / sr;
  const mark = (t0, t1, u0, u1) => {
    const k0 = Math.max(0, Math.ceil((t0 - pad) * sr / H)), k1 = Math.min(nFrames - 1, Math.floor((t1 + pad) * sr / H));
    for (let b = 0; b < B; b++) { const u = uOfBin[b]; if (u < u0 || u > u1) continue; for (let k = k0; k <= k1; k++) m[k * B + b] = 1; }
  };
  for (const s of shapes) {
    if (s.kind === 'box') mark(Math.min(s.t0, s.t1), Math.max(s.t0, s.t1), Math.min(s.u0, s.u1), Math.max(s.u0, s.u1));
    else if (s.kind === 'brush') {
      const rt = s.rt + pad, ru = s.ru;
      for (const [pt, pu] of s.pts) {
        const k0 = Math.max(0, Math.ceil((pt - rt) * sr / H)), k1 = Math.min(nFrames - 1, Math.floor((pt + rt) * sr / H));
        for (let b = 0; b < B; b++) {
          const du = (uOfBin[b] - pu) / ru; if (du < -1 || du > 1) continue;
          for (let k = k0; k <= k1; k++) { const dt = (tOf(k) - pt) / rt; if (dt * dt + du * du <= 1) m[k * B + b] = 1; }
        }
      }
    }
  }
  // soften the edge by one cell so the repair blends in
  const out = m.slice();
  for (let k = 0; k < nFrames; k++) for (let b = 0; b < B; b++) {
    const i = k * B + b; if (m[i]) continue;
    let n = 0;
    if (k > 0 && m[i - B]) n++; if (k < nFrames - 1 && m[i + B]) n++; if (b > 0 && m[i - 1]) n++; if (b < B - 1 && m[i + 1]) n++;
    if (n) out[i] = 0.35;
  }
  return { m: out, uOfBin };
}

export function spectralEdit(chs, sr, op, fmin = 20) {
  const N = sr > 64000 ? 4096 : 2048, H = N / 4, B = N / 2 + 1, len = chs[0].length;
  const nFrames = Math.ceil(len / H) + 1;
  const { m, uOfBin } = buildMask(op.shapes, sr, N, H, nFrames, fmin);
  // frames that contain something to change
  let kA = -1, kB = -1;
  for (let k = 0; k < nFrames; k++) { let any = false; for (let b = 0; b < B; b++) if (m[k * B + b]) { any = true; break; } if (any) { if (kA < 0) kA = k; kB = k; } }
  if (kA < 0) return { channels: chs, changed: 0 };
  const out = chs.map(c => c.slice());
  // long regions are done in pieces of about 40 seconds so memory stays small
  const SEG = 4000;
  for (let s = kA; s <= kB; s += SEG) processRange(chs, out, s, Math.min(kB, s + SEG - 1), { op, m, uOfBin, N, H, B, nFrames, len, sr });
  return { channels: out, changed: kB - kA + 1 };
}

function processRange(chs, out, kA, kB, { op, m, uOfBin, N, H, B, nFrames, len, sr }) {
  const ctx = op.action === 'heal' ? 12 : 0, edge = N / H + 1;
  const k0 = kA - edge - ctx, k1 = kB + edge + ctx, nf = k1 - k0 + 1;
  const { win } = tables(N);
  const g = op.action === 'reduce' ? Math.pow(10, -Math.abs(op.db || 12) / 20) : 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  // each piece reads the original and adds only its own change, so pieces join exactly
  const mk = (k, b) => (k < kA || k > kB || k < 0 || k >= nFrames) ? 0 : m[k * B + b];
  const mctx = (k, b) => (k < 0 || k >= nFrames) ? 0 : m[k * B + b];
  for (let ch = 0; ch < chs.length; ch++) {
    const x = chs[ch];
    // analysis
    const R = new Float32Array(nf * B), I = new Float32Array(nf * B);
    for (let f = 0; f < nf; f++) {
      const s = (k0 + f) * H - N / 2;
      for (let i = 0; i < N; i++) { const j = s + i; re[i] = j >= 0 && j < len ? x[j] * win[i] : 0; im[i] = 0; }
      fft(re, im, false, N);
      for (let b = 0; b < B; b++) { R[f * B + b] = re[b]; I[f * B + b] = im[b]; }
    }
    const R0 = R.slice(), I0 = I.slice();
    if (op.action === 'heal') heal(R, I, nf, B, k0, mctx, uOfBin, sr, H, N, kA, kB);
    else for (let f = 0; f < nf; f++) for (let b = 0; b < B; b++) {
      const w = mk(k0 + f, b); if (!w) continue;
      const gg = 1 - w * (1 - g); R[f * B + b] *= gg; I[f * B + b] *= gg;
    }
    // add the change back (Hann in, Hann out, 75% overlap: the windows add up to 1.5)
    for (let f = kA - k0; f <= kB - k0; f++) {
      let any = false;
      for (let b = 0; b < B; b++) { re[b] = R[f * B + b] - R0[f * B + b]; im[b] = I[f * B + b] - I0[f * B + b]; if (re[b] || im[b]) any = true; }
      if (!any) continue;
      for (let b = 1; b < N / 2; b++) { re[N - b] = re[b]; im[N - b] = -im[b]; }
      im[0] = 0; im[N / 2] = 0;
      fft(re, im, true, N);
      const s0 = (k0 + f) * H - N / 2;
      for (let i = 0; i < N; i++) { const j = s0 + i; if (j >= 0 && j < len) out[ch][j] += re[i] / N * win[i] / 1.5; }
    }
  }
}

// Rebuild masked cells from their surroundings.
// Short gaps are filled across time (from just before and just after). Long, narrow gaps such as a
// whistle are filled across frequency (from just below and just above). Steady tones crossing a gap
// keep their phase moving smoothly, so a held note does not turn to noise.
function heal(R, I, nf, B, k0, mk, uOfBin, sr, H, N, kA, kB) {
  const tm = new Float32Array(nf * B).fill(-1), fm = new Float32Array(nf * B).fill(-1);
  const tLen = new Float32Array(nf * B), fOct = new Float32Array(nf * B).fill(99);
  const ph = new Float32Array(nf * B).fill(NaN);
  const P = (f, b) => R[f * B + b] * R[f * B + b] + I[f * B + b] * I[f * B + b];
  const M = (f, b) => mk(k0 + f, b);
  // across time
  for (let b = 0; b < B; b++) {
    let f = 0;
    while (f < nf) {
      if (!M(f, b)) { f++; continue; }
      let e = f; while (e + 1 < nf && M(e + 1, b)) e++;
      // reference frames: skip one frame next to the gap (the event leaks into it)
      const side = (from, dir) => { let s = 0, n = 0; for (let q = 0, k = from; q < 4 && k >= 0 && k < nf; k += dir) { if (M(k, b)) continue; s += P(k, b); n++; q++; } return n ? Math.sqrt(s / n) : -1; };
      const L = side(f - 2, -1), Rr = side(e + 2, 1);
      // a steady tone in the frames before: carry its phase across
      let adv = NaN, p0 = NaN, pf = f - 2;
      if (L > 0 && pf - 1 >= 0 && !M(pf, b) && !M(pf - 1, b)) {
        let loc = 0, n = 0; for (let d = -6; d <= 6; d++) { const bb = b + d; if (bb < 0 || bb >= B || Math.abs(d) < 2) continue; loc += Math.sqrt(P(pf, bb)); n++; }
        const here = Math.sqrt(P(pf, b));
        if (n && here > 2.5 * loc / n) {
          const exp = 2 * Math.PI * b * H / N;
          const a1 = Math.atan2(I[pf * B + b], R[pf * B + b]), a0 = Math.atan2(I[(pf - 1) * B + b], R[(pf - 1) * B + b]);
          adv = exp + princ(a1 - a0 - exp); p0 = a1;
        }
      }
      for (let k = f; k <= e; k++) {
        let v;
        if (L > 0 && Rr > 0) { const w = (k - f + 1) / (e - f + 2); v = Math.exp(Math.log(L + 1e-12) * (1 - w) + Math.log(Rr + 1e-12) * w); }
        else v = L > 0 ? L : Rr;
        if (v >= 0) { tm[k * B + b] = v; tLen[k * B + b] = (e - f + 1) * H / sr; if (!isNaN(adv)) ph[k * B + b] = p0 + (k - pf) * adv; }
      }
      f = e + 1;
    }
  }
  // across frequency
  for (let f = 0; f < nf; f++) {
    let b = 0;
    while (b < B) {
      if (!M(f, b)) { b++; continue; }
      let e = b; while (e + 1 < B && M(f, e + 1)) e++;
      const side = (from, dir) => { let s = 0, n = 0; for (let q = 0, k = from; q < 3 && k >= 1 && k < B; k += dir) { if (M(f, k)) continue; s += P(f, k); n++; q++; } return n ? Math.sqrt(s / n) : -1; };
      const lo = side(b - 2, -1), hi = side(e + 2, 1);
      if (lo > 0 && hi > 0) {
        const oct = Math.log2(Math.max(e + 1, 1) / Math.max(b - 1, 1));
        for (let k = b; k <= e; k++) { const w = (k - b + 1) / (e - b + 2); fm[f * B + k] = Math.exp(Math.log(lo + 1e-12) * (1 - w) + Math.log(hi + 1e-12) * w); fOct[f * B + k] = oct; }
      }
      b = e + 1;
    }
  }
  for (let f = kA - k0; f <= kB - k0; f++) for (let b = 0; b < B; b++) {
    const w = M(f, b); if (!w) continue;
    const i = f * B + b;
    let target = -1, usePh = false;
    if (fm[i] >= 0 && (tm[i] < 0 || (tLen[i] > 0.35 && fOct[i] < 0.7))) target = fm[i];
    else if (tm[i] >= 0) { target = tm[i]; usePh = !isNaN(ph[i]); }
    if (target < 0) continue;
    const cur = Math.hypot(R[i], I[i]);
    let nr, ni;
    if (usePh) { nr = target * Math.cos(ph[i]); ni = target * Math.sin(ph[i]); }
    else if (cur > 1e-12) { nr = R[i] * target / cur; ni = I[i] * target / cur; }
    else { const a = Math.random() * 2 * Math.PI; nr = target * Math.cos(a); ni = target * Math.sin(a); }
    R[i] = R[i] * (1 - w) + nr * w; I[i] = I[i] * (1 - w) + ni * w;
  }
}
