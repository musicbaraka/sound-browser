'use strict';
/* "Place it": put a sound in a space. Synthesized room responses (convolution) plus filters for walls,
   devices and distance, rendered offline with Web Audio. */
const PLACES = {
  'small-room':   { label: 'Small room',               ir: { decay: 0.45, pre: 0.004, bright: 9000, dark: 2500, early: 6 }, wet: 0.45 },
  'bathroom':     { label: 'Bathroom (tiled)',         ir: { decay: 1.2, pre: 0.002, bright: 12000, dark: 6000, early: 10 }, wet: 0.55 },
  'living-room':  { label: 'Living room',              ir: { decay: 0.6, pre: 0.006, bright: 7000, dark: 1800, early: 5 }, wet: 0.35 },
  'hall':         { label: 'Concert hall',             ir: { decay: 2.3, pre: 0.025, bright: 8000, dark: 2500, early: 8 }, wet: 0.45 },
  'church':       { label: 'Church',                   ir: { decay: 4.5, pre: 0.04, bright: 7000, dark: 2000, early: 6 }, wet: 0.6 },
  'cathedral':    { label: 'Cathedral',                ir: { decay: 7.5, pre: 0.06, bright: 6000, dark: 1600, early: 6 }, wet: 0.7 },
  'airport':      { label: 'Airport terminal',         ir: { decay: 3.4, pre: 0.05, bright: 10000, dark: 3500, early: 8 }, wet: 0.6, pre: [['highpass', 120]] },
  'garage':       { label: 'Parking garage',           ir: { decay: 2.6, pre: 0.012, bright: 9000, dark: 3500, flutter: 0.017 }, wet: 0.6 },
  'tunnel':       { label: 'Tunnel',                   ir: { decay: 3.2, pre: 0.02, bright: 6000, dark: 1800, flutter: 0.031 }, wet: 0.65 },
  'stadium':      { label: 'Stadium',                  ir: { decay: 3.8, pre: 0.14, bright: 7000, dark: 2200, echo: 0.33 }, wet: 0.6 },
  'next-room':    { label: 'Next room (door open)',    ir: { decay: 0.8, pre: 0.01, bright: 4000, dark: 1500, early: 6 }, wet: 0.6, dry: 0.5, pre: [['lowpass', 1800, 0.7]], gain: 0.8 },
  'neighbor':     { label: "Neighbor's apartment (through the wall)", ir: { decay: 0.5, pre: 0.005, bright: 1200, dark: 500, early: 4 }, wet: 0.4, dry: 0.8,
                    pre: [['lowpass', 380, 0.8], ['lowpass', 600, 0.6], ['peaking', 110, 1, 5]], gain: 0.55 },
  'telephone':    { label: 'Telephone',                wet: 0, pre: [['highpass', 320, 0.8], ['lowpass', 3300, 0.9], ['peaking', 1600, 1.2, 6]], drive: 2.5, gain: 0.8 },
  'radio':        { label: 'Old radio',                wet: 0, pre: [['highpass', 450, 0.7], ['lowpass', 4200, 1.1], ['peaking', 2200, 1, 4]], drive: 4, gain: 0.75 },
  'megaphone':    { label: 'Megaphone',                ir: { decay: 0.9, pre: 0.02, bright: 5000, dark: 2000, early: 4 }, wet: 0.25, pre: [['highpass', 600, 0.9], ['lowpass', 3800, 1.4], ['peaking', 1800, 1.5, 9]], drive: 8, gain: 0.6 },
  'far-outside':  { label: 'Outside, far away',        ir: { decay: 1.4, pre: 0.22, bright: 3500, dark: 1200, echo: 0.42 }, wet: 0.35, dry: 0.55, pre: [['highpass', 160, 0.7], ['lowpass', 2600, 0.7]], gain: 0.6 },
  'underwater':   { label: 'Underwater',               ir: { decay: 1.6, pre: 0.01, bright: 900, dark: 400, early: 3 }, wet: 0.5, dry: 0.6, pre: [['lowpass', 520, 1.4], ['lowpass', 900, 0.7]], gain: 0.9 }
};

// Stereo room response: decaying noise that gets darker over time, early reflections, flutter or a distant echo
function makeIR(ctx, sr, p) {
  const len = Math.ceil(sr * Math.min(9, p.pre + p.decay * 1.15 + (p.echo || 0) + 0.05));
  const buf = ctx.createBuffer(2, len, sr);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch), p0 = Math.round(p.pre * sr);
    let lp = 0;
    for (let i = p0; i < len; i++) {
      const t = (i - p0) / sr;
      const env = Math.pow(10, -3 * t / p.decay);                                  // -60 dB after "decay" seconds
      const fc = p.bright * Math.pow(p.dark / p.bright, Math.min(1, t / p.decay));  // brightness fades with time
      const a = Math.exp(-2 * Math.PI * fc / sr);
      lp = (1 - a) * rnd() + a * lp;
      d[i] = lp * env * 3;
    }
    if (p.early) for (let k = 1; k <= p.early; k++) {                               // first reflections from walls
      const at = Math.round((p.pre + 0.003 * k * (1 + 0.37 * ((k * 7 + ch * 3) % 5))) * sr);
      if (at < len) d[at] += (ch ? -1 : 1) * 0.6 / k;
    }
    if (p.flutter) for (let k = 1; k * p.flutter < p.decay * 0.6; k++) {             // parallel walls: repeating slaps
      const at = Math.round((p.pre + k * p.flutter * (1 + ch * 0.03)) * sr);
      if (at < len) d[at] += 0.5 * Math.pow(10, -3 * k * p.flutter / p.decay);
    }
    if (p.echo) { const at = Math.round((p.pre + p.echo + ch * 0.011) * sr); if (at < len) d[at] += 0.7; }
  }
  return buf;
}
function filterChain(ctx, list) {
  return list.map(([type, freq, q = 0.7, gain = 0]) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; f.gain.value = gain; return f; });
}
function driveCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}
// Returns new channel arrays (stereo, longer when the place has a tail). amount 0..1 blends with the original.
async function placeIt(chs, sr, key, amount) {
  const P = PLACES[key];
  if (!P || amount <= 0) return chs;
  const tail = P.ir ? Math.min(9, P.ir.pre + P.ir.decay * 1.15 + (P.ir.echo || 0)) : 0.05;
  const n = chs[0].length, total = n + Math.ceil(tail * sr);
  const ctx = new OfflineAudioContext(2, total, sr);
  const src = ctx.createBuffer(chs.length, n, sr);
  chs.forEach((c, i) => src.copyToChannel(c, i));
  const node = ctx.createBufferSource(); node.buffer = src;
  let head = node;
  for (const f of filterChain(ctx, P.pre || [])) { head.connect(f); head = f; }
  if (P.drive) { const ws = ctx.createWaveShaper(); ws.curve = driveCurve(P.drive); ws.oversample = '4x'; head.connect(ws); head = ws; }
  const out = ctx.createGain(); out.gain.value = P.gain || 1; out.connect(ctx.destination);
  const dry = ctx.createGain(); dry.gain.value = P.dry ?? 1; head.connect(dry); dry.connect(out);
  if (P.ir && P.wet > 0) {
    const conv = ctx.createConvolver(); conv.normalize = true; conv.buffer = makeIR(ctx, sr, P.ir);
    const wet = ctx.createGain(); wet.gain.value = P.wet * 1.6;
    head.connect(conv); conv.connect(wet); wet.connect(out);
  }
  node.start();
  const r = await ctx.startRendering();
  const res = [r.getChannelData(0).slice(), r.getChannelData(1).slice()];
  // keep about the original loudness (quieter on purpose for walls and distance) and never clip
  let inE = 0, outE = 0, pk = 0;                                       // total energy per channel, before and after
  for (const c of chs) for (let i = 0; i < n; i++) inE += c[i] * c[i];
  inE /= chs.length;
  for (const c of res) for (let i = 0; i < total; i++) { const v = c[i]; outE += v * v; if (Math.abs(v) > pk) pk = Math.abs(v); }
  outE /= 2;
  let scale = outE > 0 ? Math.sqrt(inE / outE) * (P.gain || 1) : 1;
  if (pk * scale > 0.94) scale = 0.94 / pk;
  for (const c of res) for (let i = 0; i < total; i++) c[i] *= scale;
  if (amount < 1) for (let c = 0; c < 2; c++) {                        // blend: part original, part placed
    const o = chs[Math.min(c, chs.length - 1)], d = res[c];
    for (let i = 0; i < total; i++) d[i] = (1 - amount) * (i < n ? o[i] : 0) + amount * d[i];
  }
  return res;
}
