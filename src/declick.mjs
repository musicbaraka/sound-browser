// Click and pop removal.
// Finds short bursts the surrounding sound cannot predict (a linear-prediction model learned on the
// sound itself), then rebuilds only those few milliseconds by continuing the waveform from both sides.
// Everything outside the repaired spots is left exactly as it was.

function mono(chs) {
  if (chs.length === 1) return chs[0];
  const n = chs[0].length, m = new Float32Array(n);
  for (const c of chs) for (let i = 0; i < n; i++) m[i] += c[i] / chs.length;
  return m;
}
// autocorrelation + Levinson-Durbin: prediction coefficients a[1..p] (x[n] ~ sum a[k] x[n-k])
function lpc(x, a0, a1, p) {
  const n = a1 - a0; if (n <= p + 2) return null;
  const r = new Float64Array(p + 1);
  for (let k = 0; k <= p; k++) { let s = 0; for (let i = a0 + k; i < a1; i++) s += x[i] * x[i - k]; r[k] = s; }
  if (r[0] <= 1e-12) return null;
  r[0] *= 1.0001;                                            // a touch of regularisation
  const a = new Float64Array(p + 1), tmp = new Float64Array(p + 1);
  let err = r[0];
  for (let i = 1; i <= p; i++) {
    let acc = r[i]; for (let j = 1; j < i; j++) acc -= a[j] * r[i - j];
    const k = acc / err;
    tmp.set(a); a[i] = k; for (let j = 1; j < i; j++) a[j] = tmp[j] - k * tmp[i - j];
    err *= (1 - k * k); if (err <= 1e-15) break;
  }
  return a;
}
// continue a signal: predict `g` samples after position `at` (forward) from the samples before it
function extend(x, at, g, a, p) {
  const buf = new Float64Array(p + g);
  for (let k = 0; k < p; k++) buf[k] = x[at - p + k] || 0;
  for (let i = 0; i < g; i++) { let s = 0; for (let k = 1; k <= p; k++) s += a[k] * buf[p + i - k]; buf[p + i] = s; }
  return buf.subarray(p);
}

const SENS = { light: 11, normal: 7.5, strong: 5 };

export function declick(chs, sr, opts = {}) {
  const n = chs[0].length, x = mono(chs);
  const a = Math.max(0, Math.floor((opts.t0 || 0) * sr)), b = Math.min(n, Math.ceil((opts.t1 == null ? n / sr : opts.t1) * sr));
  const k = SENS[opts.strength] || SENS.normal;
  const p = 24, B = 2048;
  // 1. prediction error, block by block, and its typical size
  const e = new Float32Array(n);
  for (let s = Math.max(p, a - B); s < b; s += B) {
    const end = Math.min(n, s + B), c = lpc(x, Math.max(p, s - B), Math.min(n, end + B / 2), p);
    if (!c) continue;
    for (let i = s; i < end; i++) { let pr = 0; for (let j = 1; j <= p; j++) pr += c[j] * x[i - j]; e[i] = x[i] - pr; }
  }
  const W = Math.round(sr * 0.02), nb = Math.ceil(n / W), sig = new Float32Array(nb), tmp = [];
  for (let q = 0; q < nb; q++) {
    tmp.length = 0; for (let i = q * W, end = Math.min(n, i + W); i < end; i++) tmp.push(Math.abs(e[i]));
    tmp.sort((u, v) => u - v); sig[q] = (tmp[tmp.length >> 1] || 0) * 1.4826;
  }
  const local = i => { const q = Math.floor(i / W); let m = Infinity; for (let j = Math.max(0, q - 2); j <= Math.min(nb - 1, q + 2); j++) m = Math.min(m, Math.max(sig[j], 1e-7)); return m === Infinity ? 1e-7 : m; };
  // 2. bursts: neighbouring spikes merged, a little margin on each side
  const maxG = Math.round(sr * 0.014), pad = Math.max(2, Math.round(sr * 0.0004)), join = Math.round(sr * 0.0012);
  let peak = 0; for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(x[i]));
  const spots = [];
  for (let i = Math.max(a, p); i < b; i++) {
    if (Math.abs(e[i]) > k * local(i) && Math.abs(e[i]) > peak * 0.004) {
      let j = i, last = i;
      while (j + 1 < b && j - last < join) { j++; if (Math.abs(e[j]) > k * 0.5 * local(j)) last = j; }
      spots.push([i - pad, last + pad]); i = last + join;
    }
  }
  // 2b. a pop is longer than its sharp edge: follow it while the sound keeps straying from what the
  // music before it predicts, up to 12 ms
  const popMax = Math.round(sr * 0.012), quiet = Math.round(sr * 0.0012);
  for (const sp of spots) {
    const [s] = sp, ord = Math.min(p, 16);
    if (s < ord + 64) continue;
    const c = lpc(x, Math.max(ord, s - Math.round(sr * 0.02)), s, ord); if (!c) continue;
    const len = Math.min(popMax, n - s), fw = extend(x, s, len, c, ord);
    // how far the same prediction drifts on clean sound just before: only straying well beyond that is a pop
    const s0 = s - len - Math.round(sr * 0.002);
    const base = new Float32Array(len);
    if (s0 > ord + 64) {
      const c0 = lpc(x, Math.max(ord, s0 - Math.round(sr * 0.02)), s0, ord);
      if (c0) { const f0 = extend(x, s0, len, c0, ord); let m = 0, q = 0; for (let i = 0; i < len; i++) { q = 0.85 * q + 0.15 * Math.abs(x[s0 + i] - f0[i]); m = Math.max(m, q); base[i] = m; } }
    }
    const thr0 = k * 0.7 * local(s);
    let last = 0, calm = 0, sm = 0;
    for (let i = 0; i < len; i++) {
      sm = 0.85 * sm + 0.15 * Math.abs(x[s + i] - fw[i]);
      if (sm > Math.max(thr0, 4 * base[i])) { last = i; calm = 0; } else if (++calm > quiet) break;
    }
    sp[1] = Math.max(sp[1], s + last + pad);
  }
  // 3. keep real clicks: short, and not the start of a new sound
  const rms = (u, v) => { u = Math.max(0, u); v = Math.min(n, v); let s = 0; for (let i = u; i < v; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, v - u)); };
  const fix = [];
  let skipped = 0;
  for (const [s, t] of spots) {
    if (t - s > maxG) { skipped++; continue; }
    const before = rms(s - Math.round(sr * 0.02), s - Math.round(sr * 0.001)), after = rms(t + Math.round(sr * 0.005), t + Math.round(sr * 0.025));
    if (after > before * 2.5 + 1e-6) continue;                     // a drum hit or a pluck starting: leave it
    fix.push([Math.max(1, s), Math.min(n - 1, t)]);
  }
  // 4. rebuild each spot from both sides, every channel
  const out = chs.map(c => c.slice());
  const L = Math.min(1024, Math.round(sr * 0.025));
  for (const ch of out) {
    for (const [s, t] of fix) {
      const g = t - s + 1;
      const ord = Math.min(p, Math.max(4, Math.floor((s - Math.max(0, s - L)) / 4)));
      const fa = s > ord + 8 ? lpc(ch, Math.max(ord, s - L), s, ord) : null;
      // backward: the same on the reversed right side
      const R = Math.min(L, n - t - 1), rev = new Float32Array(R + p);
      for (let i = 0; i < R; i++) rev[i] = ch[t + R - i];
      const ba = R > p + 4 ? lpc(rev, p, R, p) : null;
      const fw = fa ? extend(ch, s, g, fa, ord) : null;
      const bw = ba ? extend(rev, R, g, ba, p) : null;          // predicted from the right, in reverse order
      for (let i = 0; i < g; i++) {
        const w = 0.5 - 0.5 * Math.cos(Math.PI * (i + 1) / (g + 1));
        const f = fw ? fw[i] : ch[s - 1], bk = bw ? bw[g - 1 - i] : ch[t + 1];
        ch[s + i] = (1 - w) * f + w * bk;
      }
    }
  }
  return { channels: out, count: fix.length, skipped, spots: fix.map(([s, t]) => [s / sr, t / sr]) };
}
