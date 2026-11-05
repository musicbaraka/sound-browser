'use strict';
// AIFF to WAV conversion. Chromium (and so Electron) cannot play AIFF directly.
function str4(dv, o) { return String.fromCharCode(dv.getUint8(o), dv.getUint8(o+1), dv.getUint8(o+2), dv.getUint8(o+3)); }
function ext80(dv, o) {
  const exp = dv.getUint16(o) & 0x7fff, hi = dv.getUint32(o+2), lo = dv.getUint32(o+6);
  if (!exp && !hi && !lo) return 0;
  return (hi * 4294967296 + lo) * Math.pow(2, exp - 16383 - 63);
}
function parseAiffHeader(dv) {
  if (dv.byteLength < 12 || str4(dv, 0) !== 'FORM') return null;
  const form = str4(dv, 8);
  if (form !== 'AIFF' && form !== 'AIFC') return null;
  const info = {comp: 'NONE'};
  let o = 12;
  while (o + 8 <= dv.byteLength) {
    const id = str4(dv, o), size = dv.getUint32(o+4), d = o + 8;
    if (id === 'COMM' && d + 18 <= dv.byteLength) {
      info.ch = dv.getUint16(d); info.frames = dv.getUint32(d+2); info.bits = dv.getUint16(d+6); info.rate = ext80(dv, d+8);
      if (form === 'AIFC' && size >= 22 && d + 22 <= dv.byteLength) info.comp = str4(dv, d+18);
    } else if (id === 'SSND' && d + 8 <= dv.byteLength) {
      const off = dv.getUint32(d);
      info.data = d + 8 + off; info.dataLen = size - 8 - off;
    }
    o = d + size + (size & 1);
  }
  return info;
}
function aiffToWav(buf) {
  const h = parseAiffHeader(new DataView(buf));
  if (!h || !h.ch || h.data == null) throw new Error('Could not read this AIFF file');
  const c = h.comp;
  const isFloat = c === 'fl32' || c === 'FL32';
  const little = c === 'sowt';
  if (!(c === 'NONE' || c === 'twos' || little || isFloat)) throw new Error('Unsupported AIFF-C compression: ' + c);
  const bps = isFloat ? 4 : Math.ceil(h.bits / 8);
  const frame = bps * h.ch;
  let len = Math.min(h.dataLen, buf.byteLength - h.data);
  len -= len % frame;
  const out = new ArrayBuffer(44 + len), o = new DataView(out);
  const src = new Uint8Array(buf, h.data, len), dst = new Uint8Array(out, 44, len);
  if (bps === 1) { for (let i = 0; i < len; i++) dst[i] = (src[i] + 128) & 255; }
  else if (little) dst.set(src);
  else { for (let i = 0; i < len; i += bps) for (let b = 0; b < bps; b++) dst[i+b] = src[i + bps - 1 - b]; }
  const rate = Math.round(h.rate);
  const w = (p, s) => { for (let i = 0; i < 4; i++) o.setUint8(p+i, s.charCodeAt(i)); };
  w(0, 'RIFF'); o.setUint32(4, 36 + len, true); w(8, 'WAVE'); w(12, 'fmt ');
  o.setUint32(16, 16, true); o.setUint16(20, isFloat ? 3 : 1, true); o.setUint16(22, h.ch, true);
  o.setUint32(24, rate, true); o.setUint32(28, rate * frame, true); o.setUint16(32, frame, true); o.setUint16(34, bps * 8, true);
  w(36, 'data'); o.setUint32(40, len, true);
  return out;
}
if (typeof module !== 'undefined') module.exports = { aiffToWav, parseAiffHeader };
