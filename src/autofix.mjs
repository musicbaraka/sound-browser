// Auto Fix: listens to a sound and decides what it needs.
// Finds silence to trim, rumble and an off-center wave, clicks and pops, mains hum,
// steady background noise or hiss, and harsh resonances. Loudness is set afterwards,
// on the fixed sound (see loudness.js).
import { detectHum, floorEnvelope } from './cleanup.mjs';

function mono(chs) {
  if (chs.length === 1) return chs[0];
  const n = chs[0].length, m = new Float32Array(n);
  for (const c of chs) for (let i = 0; i < n; i++) m[i] += c[i] / chs.length;
  return m;
}
function fft(re, im) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, a = -2 * Math.PI / size, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < N; i += size) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const p = i + j, q = p + half, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
const dB = p => 10 * Math.log10(p + 1e-30);

/* ---------- Spectrum over time: mean, median and quiet floor per frequency ---------- */
function spectrumStats(x, sr) {
  const N = 4096, B = N / 2 + 1, H = N / 2;
  const win = new Float64Array(N); let w2 = 0;
  for (let i = 0; i < N; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); w2 += win[i] * win[i]; }
  const total = Math.max(1, Math.floor((x.length - N) / H) + 1), F = Math.min(500, total);
  const cols = Array.from({ length: B }, () => new Float32Array(F));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < F; f++) {
    const s = Math.round(f * (total - 1) / Math.max(1, F - 1)) * H;
    for (let i = 0; i < N; i++) { const j = s + i; re[i] = (j < x.length ? x[j] : 0) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < B; b++) cols[b][f] = re[b] * re[b] + im[b] * im[b];
  }
  const mean = new Float64Array(B), med = new Float64Array(B), floor = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    const c = cols[b]; let s = 0; for (let f = 0; f < F; f++) s += c[f]; mean[b] = s / F;
    c.sort(); med[b] = c[Math.floor(F / 2)]; floor[b] = c[Math.floor(F * 0.1)] * 4.7; // 10th percentile of noise power is about 1/4.7 of its mean
  }
  // power summed over bins to a mean square level of the signal
  const toMs = 2 / (N * w2);
  return { N, B, hz: sr / N, mean, med, floor, frames: F, toMs };
}

// share of the energy under 20 Hz (4th-order Butterworth low-pass), offset removed
function subsonicShare(x, sr, dc) {
  const stage = q => { const K = Math.tan(Math.PI * 20 / sr), a0 = 1 + K / q + K * K; return [K * K / a0, 2 * K * K / a0, K * K / a0, 2 * (K * K - 1) / a0, (1 - K / q + K * K) / a0]; };
  const cs = [stage(0.5412), stage(1.3066)];
  const st = cs.map(() => [0, 0, 0, 0]);
  let lo = 0, all = 0;
  for (let i = 0; i < x.length; i++) {
    let v = x[i] - dc; all += v * v;
    for (let s = 0; s < 2; s++) { const [b0, b1, b2, a1, a2] = cs[s], z = st[s]; const y = b0 * v + b1 * z[0] + b2 * z[1] - a1 * z[2] - a2 * z[3]; z[1] = z[0]; z[0] = v; z[3] = z[2]; z[2] = y; v = y; }
    lo += v * v;
  }
  return lo / (all + 1e-30);
}
function flatness(S) {
  let ga = 0, ar = 0, cnt = 0;
  for (let b = Math.ceil(200 / S.hz); b < Math.min(S.B, 10000 / S.hz); b++) { ga += Math.log(S.mean[b] + 1e-30); ar += S.mean[b]; cnt++; }
  return cnt ? Math.exp(ga / cnt) / (ar / cnt + 1e-30) : 0;
}

/* ---------- Silence at the start and the end ---------- */
function findTrim(x, sr, peak) {
  const blk = Math.max(1, Math.round(sr * 0.005)), nb = Math.ceil(x.length / blk);
  const thr = Math.max(peak * Math.pow(10, -60 / 20), Math.pow(10, -75 / 20));
  let first = -1, last = -1;
  for (let k = 0; k < nb; k++) {
    let m = 0; for (let i = k * blk, e = Math.min(x.length, i + blk); i < e; i++) { const v = Math.abs(x[i]); if (v > m) m = v; }
    if (m > thr) { if (first < 0) first = k; last = k; }
  }
  if (first < 0) return null;
  const dur = x.length / sr;
  const a = Math.max(0, first * blk / sr - 0.005), b = Math.min(dur, (last + 1) * blk / sr + 0.05);
  // small gaps stay: loops and hits often keep a breath of silence on purpose
  const cutA = a >= 0.05, cutB = dur - b >= 0.3;
  if (!cutA && !cutB) return null;
  if (b - a < 0.05) return null;
  return { a: cutA ? a : 0, b: cutB ? b : dur, lead: cutA ? a : 0, tail: cutB ? dur - b : 0 };
}

/* ---------- Clicks and pops: tiny bursts that stand far above the sound around them ---------- */
function findClicks(x, sr, peak) {
  const n = x.length; if (n < sr * 0.05) return { clicks: [], dense: false };
  const d = new Float32Array(n);
  for (let i = 2; i < n; i++) d[i] = Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]);
  // typical roughness of every 10 ms block
  const blk = Math.round(sr * 0.01), nb = Math.ceil(n / blk), med = new Float32Array(nb), tmp = new Float32Array(blk);
  for (let k = 0; k < nb; k++) {
    const s = k * blk, e = Math.min(n, s + blk), m = e - s;
    for (let i = 0; i < m; i++) tmp[i] = d[s + i];
    const v = tmp.subarray(0, m).sort(); med[k] = v[Math.floor(m / 2)];
  }
  const local = k => { let m = 0; for (let j = Math.max(0, k - 3); j <= Math.min(nb - 1, k + 3); j++) m = Math.max(m, med[j]); return m; };
  const minAbs = peak * 0.02, events = [];
  let i = 2;
  while (i < n) {
    const k = Math.floor(i / blk), thr = Math.max(minAbs, local(k) * 18);
    if (d[i] > thr) {
      let e = i; while (e + 1 < n && e - i < sr * 0.004 && (d[e + 1] > thr * 0.25 || d[e + 2] > thr * 0.25)) e++;
      events.push([i, e]); i = e + Math.round(sr * 0.002); continue;
    }
    i++;
  }
  const rms = (a, b) => { a = Math.max(0, a); b = Math.min(n, b); let s = 0; for (let j = a; j < b; j++) s += x[j] * x[j]; return Math.sqrt(s / Math.max(1, b - a)); };
  const clicks = [];
  for (const [a, b] of events) {
    if (b - a > sr * 0.003) continue;                                          // too long for a click
    const before = rms(a - Math.round(sr * 0.02), a - Math.round(sr * 0.001));
    const after = rms(b + Math.round(sr * 0.004), b + Math.round(sr * 0.024));
    if (after > before * 2.2 + 1e-6) continue;                                 // the start of a new sound, not a click
    clicks.push([Math.max(0, a / sr - 0.001), Math.min(n / sr, b / sr + 0.001)]);
  }
  const dense = clicks.length > Math.max(6, 8 * n / sr);                       // crackle that is part of the sound (fire, rain on tin)
  return { clicks: dense ? [] : clicks.slice(0, 400), dense };
}

/* ---------- Harsh resonances: a narrow peak that stays put while the sound plays ---------- */
function findHarsh(S, sr) {
  const { med, hz, B } = S;
  const lo = 600, hi = Math.min(12000, sr * 0.45);
  // flatness: only broadband sounds (voices, foley, ambiences); a pitched note is all peaks by nature
  let ga = 0, ar = 0, cnt = 0;
  for (let b = Math.ceil(200 / hz); b < Math.min(B, 10000 / hz); b++) { ga += Math.log(med[b] + 1e-30); ar += med[b]; cnt++; }
  const flat = cnt ? Math.exp(ga / cnt) / (ar / cnt + 1e-30) : 0;
  if (flat < 0.06) return [];
  const pts = [];
  for (let f = lo; f <= hi; f *= Math.pow(2, 1 / 24)) pts.push(f);
  const lvl = (f, oct) => { const a = Math.max(1, Math.floor(f * Math.pow(2, -oct / 2) / hz)), b = Math.min(B - 1, Math.ceil(f * Math.pow(2, oct / 2) / hz)); let s = 0; for (let k = a; k <= b; k++) s += med[k]; return dB(s / (b - a + 1)); };
  const ex = pts.map(f => lvl(f, 1 / 6) - lvl(f, 1.5));
  const found = [];
  for (let i = 1; i < pts.length - 1; i++) {
    if (ex[i] < 7 || ex[i] < ex[i - 1] || ex[i] < ex[i + 1]) continue;
    if (found.some(p => Math.abs(Math.log2(p.f / pts[i])) < 0.5)) continue;
    found.push({ f: Math.round(pts[i]), excess: ex[i] });
  }
  found.sort((a, b) => b.excess - a.excess);
  return found.slice(0, 2).map(p => ({ f: p.f, g: -Math.round(Math.min(6, p.excess - 3) * 2) / 2, q: 4 }));
}

export function analyzeSound(chs, sr) {
  const x = mono(chs), n = x.length, dur = n / sr;
  let peak = 0, sum = 0;
  for (let i = 0; i < n; i++) { const v = x[i]; sum += v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  const plan = { dur, peakDb: +dB(peak * peak).toFixed(1), found: [], skipped: [] };
  if (peak < 1e-5) { plan.silent = true; return plan; }

  plan.trim = findTrim(x, sr, peak);
  const S = spectrumStats(x, sr);

  // rumble (energy under 20 Hz, which nobody hears but which eats headroom) and an off-center wave
  const dc = sum / n;
  if (dur > 0.3) {
    const sub = subsonicShare(x, sr, dc);
    if (sub > 0.05) { plan.lowcut = 25; plan.rumbleDb = +dB(sub).toFixed(1); }
  }
  if (!plan.lowcut && Math.abs(dc) > Math.max(0.002, peak * 0.01)) { plan.lowcut = 20; plan.dc = true; }

  // clicks
  const c = findClicks(x, sr, peak);
  plan.clicks = c.clicks;
  if (c.dense) plan.skipped.push('crackle that is part of the sound');

  // hum
  if (dur >= 0.5) { const h = detectHum(chs, sr); if (h) plan.hum = { f0: h.f0, overtones: h.harmonics.length }; }

  // steady background noise, measured between the partials of any held note
  if (dur >= 1.5) {
    const fl = floorEnvelope(Float32Array.from(S.floor));
    let ps = 0, pn = 0, hiN = 0, midN = 0;
    for (let b = 1; b < S.B; b++) { const f = b * S.hz; if (f < 40) continue; const nb = Math.min(fl[b], S.mean[b]); ps += S.mean[b]; pn += nb; if (f > 3000) hiN += nb; if (f > 1000) midN += nb; }
    const snr = dB(ps / (pn + 1e-30)), noiseDb = dB(pn * S.toMs);
    plan.snrDb = +snr.toFixed(1); plan.noiseDb = +noiseDb.toFixed(1);
    // recording noise (hiss, preamp, room) reaches the highs; a dark steady floor is usually wind,
    // rumble or distance, which belongs to the sound
    const noisy = flatness(S) > 0.1, hissLike = midN / (pn + 1e-30) > 0.3;
    if (snr < (noisy ? 15 : 12) || (!hissLike && snr < 35)) { if (snr < 35 && (noisy || snr < 12 || !hissLike)) plan.skipped.push('a steady texture that is the sound itself'); }
    else if (snr < 35 && noiseDb > -82) {
      const strength = Math.max(0.3, Math.min(0.75, 0.9 - 0.015 * snr));
      plan.noise = { strength: Math.round(strength * 100) / 100, hiss: hiN / (pn + 1e-30) > 0.95, snrDb: plan.snrDb };
    }
  }

  // harsh resonances
  if (dur >= 0.5) plan.harsh = findHarsh(S, sr);
  return plan;
}
