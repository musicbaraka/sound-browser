/* Loudness as people hear it (ITU-R BS.1770 / EBU R128): K-weighting, 400 ms blocks, gated.
   Returns integrated loudness in LUFS, or -Infinity for silence. */
function kWeightCoefs(sr) {
  // the same filters as the reference implementation (libebur128), exact at every sample rate
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / sr); a0 = 1 + K / Q + K * K;
  const hp = [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  return [shelf, hp];
}
function integratedLoudness(chs, sr) {
  const n = chs[0].length; if (!n) return -Infinity;
  const coefs = kWeightCoefs(sr);
  const sq = chs.slice(0, 2).map(x => {           // front left and right count fully; more channels: first two
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = x[i];
    for (const [b0, b1, b2, a1, a2] of coefs) {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) { const v = y[i], o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o; }
    }
    // running sum of squares for fast block means
    const cs = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + y[i] * y[i];
    return cs;
  });
  const T = Math.round(0.4 * sr), step = Math.round(0.1 * sr);
  const blocks = [];
  if (n <= T) blocks.push(sq.reduce((s, cs) => s + cs[n] / n, 0));
  else for (let a = 0; a + T <= n; a += step) blocks.push(sq.reduce((s, cs) => s + (cs[a + T] - cs[a]) / T, 0));
  const L = z => -0.691 + 10 * Math.log10(z + 1e-30);
  const abs = blocks.filter(z => L(z) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(abs.reduce((s, z) => s + z, 0) / abs.length) - 10;
  const gated = abs.filter(z => L(z) > rel);
  return L(gated.reduce((s, z) => s + z, 0) / gated.length);
}
if (typeof module !== 'undefined') module.exports = { integratedLoudness };
