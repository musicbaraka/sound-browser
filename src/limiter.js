'use strict';
/* Maximizer: raise the level, then a look-ahead brickwall limiter keeps every peak under the ceiling.
   Works offline on whole channels, so the look-ahead needs no delay. Channels are linked (same gain). */
function maximize(chs, sr, gainDb, ceilingDb, releaseMs = 80) {
  const n = chs[0].length, g0 = Math.pow(10, gainDb / 20), c = Math.pow(10, ceilingDb / 20);
  const L = Math.max(1, Math.round(sr * 0.005));                // 5 ms look-ahead
  // true peak: also check the level between samples (4x oversampling with a windowed-sinc interpolator)
  const T = 16, phases = [0.25, 0.5, 0.75].map(f => {
    const k = new Float32Array(2 * T); let sum = 0;
    for (let j = 0; j < 2 * T; j++) { const x = j - T + 1 - f; const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x); const w = 0.5 + 0.5 * Math.cos(Math.PI * x / T); k[j] = sinc * w; sum += k[j]; }
    for (let j = 0; j < 2 * T; j++) k[j] /= sum;
    return k;
  });
  const need = new Float32Array(n);                              // gain each sample needs to stay under the ceiling
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const ch of chs) {
      let v = Math.abs(ch[i]); if (v > p) p = v;
      for (const k of phases) {
        let y = 0;
        for (let j = 0; j < 2 * T; j++) { const q = i - T + 1 + j; if (q >= 0 && q < n) y += ch[q] * k[j]; }
        y = Math.abs(y); if (y > p) p = y;
      }
    }
    p *= g0;
    need[i] = p > c ? c / p : 1;
  }
  // smallest needed gain over the next L samples (sliding window minimum)
  const ahead = new Float32Array(n), dq = new Int32Array(n + L); let h = 0, t = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (t > h && need[dq[t - 1]] >= need[i]) t--;
    dq[t++] = i;
    while (dq[h] > i + L - 1) h++;
    ahead[i] = need[dq[h]];
  }
  // average over the previous L samples: a smooth gain curve that is never above what any peak needs
  const gain = new Float32Array(n); let sum = 0;
  for (let i = 0; i < n; i++) { sum += ahead[i]; if (i >= L) sum -= ahead[i - L]; gain[i] = sum / Math.min(i + 1, L); }
  for (let i = 0; i < Math.min(n, L); i++) gain[i] = Math.min(gain[i], ahead[i]);
  // gentle release so the level comes back up smoothly
  const rel = 1 - Math.exp(-1 / (sr * releaseMs / 1000));
  let g = 1, most = 1;
  for (let i = 0; i < n; i++) {
    g = gain[i] < g ? gain[i] : g + (gain[i] - g) * rel;
    if (g > gain[i]) g = gain[i];
    gain[i] = g; if (g < most) most = g;
  }
  for (const ch of chs) for (let i = 0; i < n; i++) { let v = ch[i] * g0 * gain[i]; if (v > c) v = c; else if (v < -c) v = -c; ch[i] = v; }
  return { reductionDb: most < 1 ? -20 * Math.log10(most) : 0 };
}
if (typeof module !== 'undefined') module.exports = { maximize };
