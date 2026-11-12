// Audio file writers for the converter: WAV, AIFF, FLAC (lossless, written here) and MP3 (LAME).
// Input is always an array of Float32Array channels at one sample rate.

import { Mp3Encoder } from './vendor/lame.mjs';

// If the sound came from a 16 or 24-bit file, find its original integers exactly. Decoders scale
// either by 2^(n-1) everywhere, or by 2^(n-1)-1 for positive values; both are recognized.
function sourceInts(ch, sb) {
  if (sb !== 16 && sb !== 24) return null;
  const M = Math.pow(2, sb - 1), step = Math.max(1, Math.floor(ch.length / 50000));
  const ok = x => Math.abs(x - Math.round(x)) < 1e-3;
  for (const pos of [M, M - 1]) {
    let fits = true;
    for (let i = 0; i < ch.length; i += step) { const v = ch[i]; if (!ok(v >= 0 ? v * pos : v * M)) { fits = false; break; } }
    if (!fits) continue;
    const out = new Int32Array(ch.length);
    for (let i = 0; i < ch.length; i++) { const v = ch[i], x = Math.round(v >= 0 ? v * pos : v * M); if (!ok(v >= 0 ? v * pos : v * M)) return null; out[i] = x; }
    return out;
  }
  return null;
}
// float to integer. A 16 or 24-bit source going to the same or more bits is copied exactly;
// anything else is rounded, with triangular dither when going down to 16 bits.
function toInts(ch, bits, srcBits) {
  if (srcBits && srcBits <= bits) { const si = sourceInts(ch, srcBits); if (si) { if (bits > srcBits) { const k = 2 ** (bits - srcBits); for (let i = 0; i < si.length; i++) si[i] *= k; } return si; } }
  const max = Math.pow(2, bits - 1), out = new Int32Array(ch.length), lo = -max, hi = max - 1;
  const dither = bits <= 16;
  for (let i = 0; i < ch.length; i++) {
    let v = ch[i] * max;
    if (dither) v += Math.random() - Math.random();
    v = Math.round(v);
    out[i] = v < lo ? lo : v > hi ? hi : v;
  }
  return out;
}

export function encodeWav(chs, sr, bits, srcBits) {
  const n = chs[0].length, nc = chs.length, float = bits === 32, bps = bits / 8;
  const dataLen = n * nc * bps, extra = float ? 12 : 0;
  const buf = new ArrayBuffer(44 + extra + dataLen + (dataLen & 1)), v = new DataView(buf), u8 = new Uint8Array(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) u8[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, buf.byteLength - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, float ? 3 : 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nc * bps, true); v.setUint16(32, nc * bps, true); v.setUint16(34, bits, true);
  let o = 36;
  if (float) { str(o, 'fact'); v.setUint32(o + 4, 4, true); v.setUint32(o + 8, n, true); o += 12; }
  str(o, 'data'); v.setUint32(o + 4, dataLen, true); o += 8;
  if (float) { for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++, o += 4) v.setFloat32(o, chs[c][i], true); }
  else {
    const ints = chs.map(c => toInts(c, bits, srcBits));
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
      const s = ints[c][i];
      if (bits === 16) { v.setInt16(o, s, true); o += 2; }
      else { u8[o] = s & 255; u8[o + 1] = (s >> 8) & 255; u8[o + 2] = (s >> 16) & 255; o += 3; }
    }
  }
  return u8;
}

// 80-bit IEEE extended float, which AIFF uses for the sample rate
function ext80(v, o, x) {
  let e = 16383 + 63, m = Math.floor(x);
  while (m < 2 ** 63 && m > 0) { m *= 2; e--; }
  // x is a whole sample rate, so the shifted value fits exactly
  const hi = Math.floor(m / 2 ** 32), lo = m - hi * 2 ** 32;
  v.setUint16(o, e); v.setUint32(o + 2, hi); v.setUint32(o + 6, lo);
}
export function encodeAiff(chs, sr, bits, srcBits) {
  const n = chs[0].length, nc = chs.length, bps = bits / 8, dataLen = n * nc * bps, pad = dataLen & 1;
  const buf = new ArrayBuffer(54 + dataLen + pad), v = new DataView(buf), u8 = new Uint8Array(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) u8[o + i] = s.charCodeAt(i); };
  str(0, 'FORM'); v.setUint32(4, buf.byteLength - 8); str(8, 'AIFF');
  str(12, 'COMM'); v.setUint32(16, 18); v.setUint16(20, nc); v.setUint32(22, n); v.setUint16(26, bits); ext80(v, 28, sr);
  str(38, 'SSND'); v.setUint32(42, 8 + dataLen); v.setUint32(46, 0); v.setUint32(50, 0);
  const ints = chs.map(c => toInts(c, bits, srcBits));
  let o = 54;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
    const s = ints[c][i];
    if (bits === 16) { v.setInt16(o, s); o += 2; }
    else { u8[o] = (s >> 16) & 255; u8[o + 1] = (s >> 8) & 255; u8[o + 2] = s & 255; o += 3; }
  }
  return u8;
}

/* ---------------- FLAC ---------------- */
class Bits {
  constructor(size) { this.b = new Uint8Array(size); this.p = 0; this.acc = 0; this.n = 0; }
  grow(k) { if (this.p + k > this.b.length) { const nb = new Uint8Array(Math.max(this.b.length * 2, this.p + k + 1024)); nb.set(this.b); this.b = nb; } }
  put(v, n) { // n <= 32
    if (n > 24) { this.put(Math.floor(v / 2 ** 16) >>> 0, n - 16); this.put(v & 0xffff, 16); return; }
    this.grow(8);
    this.acc = (this.acc * (1 << n)) + (v & ((1 << n) - 1)); this.n += n;
    while (this.n >= 8) { this.n -= 8; this.b[this.p++] = Math.floor(this.acc / (1 << this.n)) & 255; this.acc &= (1 << this.n) - 1; }
  }
  unary(q) { // q zeros then a one
    while (q >= 24) { this.put(0, 24); q -= 24; }
    this.put(1, q + 1);
  }
  align() { if (this.n) this.put(0, 8 - this.n); }
}
const CRC8 = new Uint8Array(256), CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let c = i; for (let k = 0; k < 8; k++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255; CRC8[i] = c;
  let d = i << 8; for (let k = 0; k < 8; k++) d = (d & 0x8000) ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff; CRC16[i] = d;
}
const crc8 = (b, a, z) => { let c = 0; for (let i = a; i < z; i++) c = CRC8[c ^ b[i]]; return c; };
const crc16 = (b, a, z) => { let c = 0; for (let i = a; i < z; i++) c = ((c << 8) ^ CRC16[(c >> 8) ^ b[i]]) & 0xffff; return c; };

function residual(x, order, out) {
  const n = x.length;
  for (let i = order; i < n; i++) {
    out[i] = order === 0 ? x[i] : order === 1 ? x[i] - x[i - 1] : order === 2 ? x[i] - 2 * x[i - 1] + x[i - 2]
      : order === 3 ? x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3] : x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
  }
}
// best Rice partitioning for a residual; returns its size in bits and the plan
function ricePlan(res, order, n) {
  let best = null;
  const maxP = Math.min(8, Math.floor(Math.log2(n)));
  for (let p = 0; p <= maxP; p++) {
    if (n % (1 << p)) break;
    const len = n >> p; if (len <= order) break;
    let bits = 6, ks = [], big = false;
    for (let q = 0; q < (1 << p); q++) {
      const a = q === 0 ? order : q * len, z = (q + 1) * len;
      let sum = 0; for (let i = a; i < z; i++) { const r = res[i]; sum += r >= 0 ? 2 * r : -2 * r - 1; }
      const cnt = z - a;
      let k0 = cnt && sum > cnt ? Math.floor(Math.log2(sum / cnt)) : 0, bk = 0, bc = Infinity;
      for (let k = Math.max(0, k0 - 1); k <= Math.min(30, k0 + 1); k++) {
        let c = 0; for (let i = a; i < z; i++) { const r = res[i]; const u = r >= 0 ? 2 * r : -2 * r - 1; c += Math.floor(u / 2 ** k) + 1 + k; }
        if (c < bc) { bc = c; bk = k; }
      }
      ks.push(bk); if (bk > 14) big = true; bits += bc;
    }
    bits += ks.length * (big ? 5 : 4);
    if (!best || bits < best.bits) best = { bits, p, ks, big };
  }
  return best;
}
// one channel of one frame: pick constant, fixed predictor or verbatim, whichever is smallest
function planSub(x, bps) {
  const n = x.length;
  let same = true; for (let i = 1; i < n; i++) if (x[i] !== x[0]) { same = false; break; }
  if (same) return { type: 'const', bits: 8 + bps, x, bps };
  let best = { type: 'verbatim', bits: 8 + n * bps, x, bps };
  const res = new Int32Array(n); let bo = 0, bs = Infinity;
  for (let o = 0; o <= Math.min(4, n - 1); o++) { residual(x, o, res); let s = 0; for (let i = o; i < n; i++) s += Math.abs(res[i]); if (s < bs) { bs = s; bo = o; } }
  residual(x, bo, res);
  const rp = ricePlan(res, bo, n);
  if (rp) { const bits = 8 + bo * bps + 2 + rp.bits; if (bits < best.bits) best = { type: 'fixed', bits, x, bps, order: bo, res: res.slice(), rp }; }
  return best;
}
function writeSub(w, s) {
  w.put(0, 1);
  if (s.type === 'const') { w.put(0, 6); w.put(0, 1); w.put(s.x[0] & ((2 ** s.bps) - 1), s.bps); return; }
  if (s.type === 'verbatim') { w.put(1, 6); w.put(0, 1); for (let i = 0; i < s.x.length; i++) w.put(s.x[i] & ((2 ** s.bps) - 1), s.bps); return; }
  w.put(8 | s.order, 6); w.put(0, 1);
  for (let i = 0; i < s.order; i++) w.put(s.x[i] & ((2 ** s.bps) - 1), s.bps);
  const { p, ks, big } = s.rp, n = s.x.length, len = n >> p;
  w.put(big ? 1 : 0, 2); w.put(p, 4);
  for (let q = 0; q < (1 << p); q++) {
    const k = ks[q], a = q === 0 ? s.order : q * len, z = (q + 1) * len;
    w.put(k, big ? 5 : 4);
    for (let i = a; i < z; i++) {
      const r = s.res[i], u = r >= 0 ? 2 * r : -2 * r - 1, q2 = Math.floor(u / 2 ** k);
      w.unary(q2); if (k) w.put(u - q2 * 2 ** k, k);
    }
  }
}
export function encodeFlac(chs, sr, bits, onProgress, srcBits) {
  const n = chs[0].length, nc = chs.length, BS = 4096;
  const ints = chs.map(c => toInts(c, bits, srcBits));
  const w = new Bits(Math.max(1 << 16, n * nc * bits / 8 * 0.7));
  // header and STREAMINFO
  for (const ch of 'fLaC') w.put(ch.charCodeAt(0), 8);
  w.put(0x80, 8); w.put(34, 24);
  w.put(BS, 16); w.put(BS, 16); w.put(0, 24); w.put(0, 24);
  w.put(sr, 20); w.put(nc - 1, 3); w.put(bits - 1, 5);
  w.put(Math.floor(n / 2 ** 32), 4); w.put(n >>> 0, 32);
  for (let i = 0; i < 16; i++) w.put(0, 8); // MD5 left blank (allowed)
  const ssCode = bits === 16 ? 4 : bits === 24 ? 6 : 0;
  for (let f = 0, start = 0; start < n; f++, start += BS) {
    const len = Math.min(BS, n - start), fs = w.p;
    const blk = ints.map(c => c.subarray(start, start + len));
    // stereo: try left/right, left/side, side/right and mid/side
    let subs, assign;
    if (nc === 2) {
      const L = blk[0], R = blk[1], S = new Int32Array(len), M = new Int32Array(len);
      for (let i = 0; i < len; i++) { S[i] = L[i] - R[i]; M[i] = (L[i] + R[i]) >> 1; }
      const pl = planSub(L, bits), pr = planSub(R, bits), ps = planSub(S, bits + 1), pm = planSub(M, bits);
      const opts = [[1, [pl, pr]], [8, [pl, ps]], [9, [ps, pr]], [10, [pm, ps]]];
      [assign, subs] = opts.reduce((a, b) => (b[1][0].bits + b[1][1].bits < a[1][0].bits + a[1][1].bits ? b : a));
    } else { subs = blk.map(x => planSub(x, bits)); assign = nc - 1; }
    // frame header
    w.put(0xfff8, 16);
    const bsCode = len === BS ? 12 : 7;
    w.put(bsCode, 4); w.put(0, 4); w.put(assign, 4); w.put(ssCode, 3); w.put(0, 1);
    // frame number, UTF-8 style
    if (f < 0x80) w.put(f, 8);
    else if (f < 0x800) { w.put(0xc0 | (f >> 6), 8); w.put(0x80 | (f & 63), 8); }
    else if (f < 0x10000) { w.put(0xe0 | (f >> 12), 8); w.put(0x80 | ((f >> 6) & 63), 8); w.put(0x80 | (f & 63), 8); }
    else if (f < 0x200000) { w.put(0xf0 | (f >> 18), 8); w.put(0x80 | ((f >> 12) & 63), 8); w.put(0x80 | ((f >> 6) & 63), 8); w.put(0x80 | (f & 63), 8); }
    else { w.put(0xf8 | (f >> 24), 8); w.put(0x80 | ((f >> 18) & 63), 8); w.put(0x80 | ((f >> 12) & 63), 8); w.put(0x80 | ((f >> 6) & 63), 8); w.put(0x80 | (f & 63), 8); }
    if (bsCode === 7) w.put(len - 1, 16);
    w.put(crc8(w.b, fs, w.p), 8);
    for (const s of subs) writeSub(w, s);
    w.align();
    const c = crc16(w.b, fs, w.p); w.put(c >> 8, 8); w.put(c & 255, 8);
    if (onProgress && f % 64 === 0) onProgress(start / n);
  }
  return w.b.slice(0, w.p);
}

/* ---------------- MP3 ---------------- */
export function encodeMp3(chs, sr, kbps, onProgress) {
  const nc = Math.min(2, chs.length), n = chs[0].length;
  const enc = new Mp3Encoder(nc, sr, kbps), parts = []; let total = 0;
  const conv = c => { const o = new Int16Array(c.length); for (let i = 0; i < c.length; i++) { const v = Math.round(c[i] * 32767); o[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v; } return o; };
  const L = conv(chs[0]), R = nc > 1 ? conv(chs[1]) : null;
  const STEP = 1152 * 32;
  for (let i = 0; i < n; i += STEP) {
    const b = R ? enc.encodeBuffer(L.subarray(i, i + STEP), R.subarray(i, i + STEP)) : enc.encodeBuffer(L.subarray(i, i + STEP));
    if (b.length) { parts.push(b.slice()); total += b.length; }
    if (onProgress) onProgress(i / n);
  }
  const f = enc.flush(); if (f.length) { parts.push(f.slice()); total += f.length; }
  const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return withLameTag(out, n, kbps);
}

// The encoder adds a short delay at the start and padding at the end. Real LAME writes an "Info"
// frame saying how much, so players trim it and the MP3 starts exactly on time. Write the same frame.
const CRC16A = new Uint16Array(256);
for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xA001 : c >>> 1; CRC16A[i] = c; }
function withLameTag(mp3, nSamples, kbps) {
  if (mp3.length < 4 || mp3[0] !== 0xff || (mp3[1] & 0xe0) !== 0xe0) return mp3;
  const RATES = [44100, 48000, 32000], BR = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const sr = RATES[(mp3[2] >> 2) & 3], mono = (mp3[3] >> 6) === 3;
  if ((mp3[1] & 0x18) !== 0x18 || !sr) return mp3; // MPEG-1 only (32, 44.1 and 48 kHz)
  // count the audio frames
  let frames = 0;
  for (let p = 0; p + 4 <= mp3.length;) {
    if (mp3[p] !== 0xff || (mp3[p + 1] & 0xe0) !== 0xe0) break;
    const br = BR[mp3[p + 2] >> 4], pad = (mp3[p + 2] >> 1) & 1;
    if (!br) break;
    p += Math.floor(144000 * br / sr) + pad; frames++;
  }
  const size = Math.floor(144000 * kbps / sr), tag = new Uint8Array(size), v = new DataView(tag.buffer);
  tag[0] = 0xff; tag[1] = mp3[1] | 1; tag[2] = mp3[2] & ~2; tag[3] = mp3[3];
  const x = 4 + (mono ? 17 : 32);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) tag[o + i] = t.charCodeAt(i); };
  str(x, 'Info'); v.setUint32(x + 4, 0x0f);
  v.setUint32(x + 8, frames); v.setUint32(x + 12, mp3.length + size);
  for (let i = 0; i < 100; i++) tag[x + 16 + i] = Math.floor(i * 256 / 100);
  v.setUint32(x + 116, 0);
  const L = x + 120, delay = 576, padding = Math.max(0, frames * 1152 - delay - nSamples);
  str(L, 'LAME3.100'); tag[L + 9] = 0x01; tag[L + 20] = Math.min(255, kbps);
  tag[L + 21] = delay >> 4; tag[L + 22] = ((delay & 15) << 4) | (padding >> 8); tag[L + 23] = padding & 255;
  v.setUint32(L + 28, mp3.length + size);
  let crc = 0; for (let i = 0; i < L + 34; i++) crc = (crc >>> 8) ^ CRC16A[(crc ^ tag[i]) & 255];
  v.setUint16(L + 34, crc);
  const out = new Uint8Array(size + mp3.length); out.set(tag); out.set(mp3, size);
  return out;
}

// FLAC size: encode a handful of short pieces spread through the sound and scale up
export function estimateFlac(chs, sr, bits) {
  const n = chs[0].length, piece = 4096 * 4, count = Math.min(12, Math.max(1, Math.floor(n / piece)));
  if (n <= piece * 12) return encodeFlac(chs, sr, bits).length;
  let got = 0;
  for (let k = 0; k < count; k++) {
    const a = Math.floor((n - piece) * k / Math.max(1, count - 1));
    got += encodeFlac(chs.map(c => c.subarray(a, a + piece)), sr, bits).length - 42;
  }
  return Math.round(42 + got / (count * piece) * n);
}
