// Speed, pitch and reverse processing, run off the main thread.
import { SoundTouch, SimpleFilter } from './vendor/soundtouch.js';

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

self.onmessage = (e) => {
  const { id, channels, sampleRate, speed, semis, tape, reverse } = e.data;
  let out;
  try {
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
    self.postMessage({ id, channels: out }, out.map(c => c.buffer));
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
