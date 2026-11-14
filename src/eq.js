'use strict';
/* Graphic EQ: 10 octave bands. The two ends are shelves, the rest are peaking filters (RBJ cookbook).
   Applied offline to whole channels; the same coefficients draw the curve on the spectrum. */
const EQ_BANDS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_RANGE = 12;

function peak(f, g, sr) {
  const A = Math.pow(10, g / 40), w = 2 * Math.PI * f / sr, cw = Math.cos(w), sw = Math.sin(w);
  const al = sw * Math.sinh(Math.LN2 / 2 * w / sw); // one octave wide
  const a0 = 1 + al / A;
  return [(1 + al * A) / a0, -2 * cw / a0, (1 - al * A) / a0, -2 * cw / a0, (1 - al / A) / a0];
}
// Neighbouring bands overlap and add up. Nudge the internal gains so the response
// at each band centre lands close to the fader value.
function eqCoefs(gains, sr) {
  const idx = EQ_BANDS.map((f, i) => i).filter(i => EQ_BANDS[i] < sr * 0.45);
  if (!idx.some(i => gains[i])) return [];
  let g = idx.map(i => gains[i]);
  const build = () => idx.map((i, k) => peak(EQ_BANDS[i], g[k], sr));
  // half-steps: a single band stays a smooth bell, all bands together stay within 1 dB
  for (let it = 0; it < 3; it++) {
    const c = build();
    g = g.map((v, k) => Math.max(-EQ_RANGE * 1.6, Math.min(EQ_RANGE * 1.6, v + 0.5 * (gains[idx[k]] - eqResponseDb(c, EQ_BANDS[idx[k]], sr)))));
  }
  return build().filter((c, k) => Math.abs(g[k]) > 1e-3);
}

// Response in dB of the whole EQ at frequency f
function eqResponseDb(coefs, f, sr) {
  const w = 2 * Math.PI * f / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  let db = 0;
  for (const [b0, b1, b2, a1, a2] of coefs) {
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
    const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return db;
}

/* ---------- Parametric EQ: cuts, shelves and bells you place anywhere ---------- */
const PEQ_RANGE = 18;
const PEQ_DEFAULT = () => [
  { type: 'lowcut', f: 30, g: 0, q: 0.71, on: false },
  { type: 'lowshelf', f: 100, g: 0, q: 0.71, on: true },
  { type: 'bell', f: 300, g: 0, q: 1, on: true },
  { type: 'bell', f: 1000, g: 0, q: 1, on: true },
  { type: 'bell', f: 3500, g: 0, q: 1, on: true },
  { type: 'highshelf', f: 9000, g: 0, q: 0.71, on: true },
  { type: 'highcut', f: 18000, g: 0, q: 0.71, on: false }
];
// one RBJ cookbook biquad, normalised: [b0, b1, b2, a1, a2]
function biquad(type, f, g, q, sr) {
  const A = Math.pow(10, g / 40), w = 2 * Math.PI * f / sr, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'bell') { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
  else {
    const sA = 2 * Math.sqrt(A) * (sw / 2 * Math.SQRT2); // shelf slope 1
    if (type === 'lowshelf') { b0 = A * ((A + 1) - (A - 1) * cw + sA); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - sA); a0 = (A + 1) + (A - 1) * cw + sA; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - sA; }
    else { b0 = A * ((A + 1) + (A - 1) * cw + sA); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - sA); a0 = (A + 1) - (A - 1) * cw + sA; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - sA; }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
const peqActive = bands => bands.some(b => b.on && (b.type === 'lowcut' || b.type === 'highcut' || Math.abs(b.g) > 0.05));
function peqCoefs(bands, sr) {
  const out = [];
  for (const b of bands) {
    if (!b.on || b.f >= sr * 0.49) continue;
    if (b.type === 'lowcut' || b.type === 'highcut') {
      // 24 dB per octave: two Butterworth stages; q above 0.71 adds a resonant bump
      const t = b.type === 'lowcut' ? 'hp' : 'lp', k = b.q / 0.7071;
      out.push(biquad(t, b.f, 0, 0.5412, sr), biquad(t, b.f, 0, 1.3066 * k, sr));
    } else if (Math.abs(b.g) > 0.05) out.push(biquad(b.type, b.f, b.g, b.q, sr));
  }
  return out;
}
function applyCoefs(chs, coefs) {
  if (!coefs.length) return chs;
  for (const x of chs) for (const [b0, b1, b2, a1, a2] of coefs) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y;
    }
  }
  return chs;
}

function applyEq(chs, sr, gains) {
  const coefs = eqCoefs(gains, sr);
  if (!coefs.length) return chs;
  for (const x of chs) for (const [b0, b1, b2, a1, a2] of coefs) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y;
    }
  }
  return chs;
}
if (typeof module !== 'undefined') module.exports = { EQ_BANDS, EQ_RANGE, eqCoefs, eqResponseDb, applyEq, PEQ_RANGE, PEQ_DEFAULT, peqCoefs, peqActive, applyCoefs, biquad };
