'use strict';
/* Spelling-tolerant search and reading key / tempo out of file names. */

// Split text into searchable words (handles CamelCase, underscores, dashes)
function wordsOf(s) {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9#]+/).filter(w => w.length >= 2);
}

// Optimal string alignment distance (typos, missing or extra letters, swapped neighbours), stops early past max
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length, m = b.length;
  let p2 = null, p1 = Array.from({ length: m + 1 }, (_, j) => j), cur;
  for (let i = 1; i <= n; i++) {
    cur = new Array(m + 1); cur[0] = i; let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + cost);
      if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    p2 = p1; p1 = cur;
  }
  return p1[m];
}

// Sound-alike key so "fone" meets "phone" and "nite" meets "night"
function soundKey(w) {
  return w.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/q/g, 'k')
    .replace(/x/g, 'ks').replace(/z/g, 's').replace(/gh/g, '').replace(/wh/g, 'w').replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1').replace(/(?!^)[aeiou]/g, '');
}

class Vocabulary {
  constructor() { this.words = new Map(); this.byKey = new Map(); }
  build(texts) {
    this.words.clear(); this.byKey.clear();
    for (const t of texts) for (const w of wordsOf(t)) this.words.set(w, (this.words.get(w) || 0) + 1);
    for (const w of this.words.keys()) { const k = soundKey(w); if (!this.byKey.has(k)) this.byKey.set(k, []); this.byKey.get(k).push(w); }
  }
  // A clearly more common spelling for a word that matches only a few sounds ("snair" when "snare" is everywhere)
  suggest(term, matches) {
    if (term.length < 4) return null;
    const max = term.length <= 4 ? 1 : 2;
    const own = this.words.get(term) || 0;
    const alike = new Set(this.byKey.get(soundKey(term)) || []);
    let best = null, bestScore = Infinity;
    for (const [w, c] of this.words) {
      if (w === term || w.startsWith(term) || w.includes(term) || c < 3 || c < Math.max(own, matches) * 5) continue;
      let d = editDistance(term, w, max);
      if (alike.has(w)) d = Math.min(d, 0.5);
      if (d > max) continue;
      const score = d - Math.log10(c) * 0.2;
      if (score < bestScore) { bestScore = score; best = w; }
    }
    return best;
  }
  // Best guesses for a word that matches nothing
  correct(term) {
    if (/^\d+$/.test(term) || term.length < 3) return [];
    const max = term.length <= 4 ? 1 : term.length <= 7 ? 2 : 3;
    const found = new Map();
    const add = (w, d) => { const s = d - Math.log10(this.words.get(w) + 1) * 0.1; if (!found.has(w) || found.get(w) > s) found.set(w, s); };
    for (const w of this.byKey.get(soundKey(term)) || []) add(w, 0.5);
    for (const w of this.words.keys()) {
      let d = editDistance(term, w, max);
      if (w.length > term.length) d = Math.min(d, editDistance(term, w.slice(0, term.length), max) + 0.3); // still typing
      if (d <= max) add(w, d);
    }
    return [...found.entries()].sort((a, b) => a[1] - b[1]).slice(0, 4).map(e => e[0]);
  }
}

/* ---------- Key and BPM from file names and tags ---------- */
const SHARP_OF = { CB: 'B', DB: 'C#', EB: 'D#', FB: 'E', GB: 'F#', AB: 'G#', BB: 'A#', 'E#': 'F', 'B#': 'C' };
function normKey(letter, acc, mode) {
  let p = letter.toUpperCase();
  if (acc) { const a = /^(#|♯|s|sharp)$/i.test(acc) ? '#' : 'B'; p = a === '#' ? p + '#' : p + 'B'; }
  p = SHARP_OF[p] || p;
  if (p.length === 2 && p[1] === 'B') return null;
  const minor = /^(m|min|minor|mi|moll)$/.test(mode || '') || mode === 'm';
  return p + (minor ? ' min' : ' maj');
}
function parseKeyText(s) {
  if (!s) return null;
  s = String(s).trim();
  // Camelot wheel codes (8A = A minor, 8B = C major)
  const cam = s.match(/^(1[0-2]|[1-9])\s*([AB])$/i);
  if (cam) {
    const n = +cam[1], minorList = ['G# min', 'D# min', 'A# min', 'F min', 'C min', 'G min', 'D min', 'A min', 'E min', 'B min', 'F# min', 'C# min'], majorList = ['B maj', 'F# maj', 'C# maj', 'G# maj', 'D# maj', 'A# maj', 'F maj', 'C maj', 'G maj', 'D maj', 'A maj', 'E maj'];
    return (cam[2].toUpperCase() === 'A' ? minorList : majorList)[n - 1];
  }
  const m = s.match(/^([A-G])\s*(#|♯|b|♭|sharp|flat)?\s*(maj|major|min|minor|mi|m|M)?$/i);
  if (!m) return null;
  if (m[3] === 'M') return normKey(m[1], m[2], 'maj');
  return normKey(m[1], m[2], m[3] ? m[3].toLowerCase() : '');
}
function parseFileName(name) {
  const s = name.replace(/\.[^.]+$/, '');
  let bpm = null, key = null;
  const b = s.match(/(\d{2,3}(?:\.\d+)?)\s*[-_ ]?\s*bpm/i) || s.match(/bpm\s*[-_ ]?\s*(\d{2,3})(?!\d)/i);
  if (b) { const v = +b[1]; if (v >= 50 && v <= 250) bpm = Math.round(v); }
  const toks = s.split(/[\s_\-.()[\],+&]+/).filter(Boolean);
  for (let i = 0; i < toks.length && !key; i++) {
    const t = toks[i], next = (toks[i + 1] || '').toLowerCase(), prev = (toks[i - 1] || '').toLowerCase();
    let m = t.match(/^([A-G])(#|♯|b|♭|s)?(maj|major|min|minor|m)$/);       // Cmin, F#m, Ebmaj, Am
    if (m) { key = normKey(m[1], m[2], m[3] === 'major' ? 'maj' : m[3]); break; }
    m = t.match(/^([A-G])(#|♯|b|♭)?$/);                                       // C minor, key of F#, Bb
    if (m && (/^(maj|major|min|minor)$/.test(next) || prev === 'key' || (prev === 'of' && (toks[i - 2] || '').toLowerCase() === 'key') || (m[2] && m[2] !== 's'))) {
      key = normKey(m[1], m[2], /^(min|minor)$/.test(next) ? 'min' : 'maj');
    }
  }
  return { bpm, key };
}
const ALL_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].flatMap(p => [p + ' maj', p + ' min']);
if (typeof module !== 'undefined') module.exports = { Vocabulary, editDistance, parseFileName, parseKeyText, wordsOf, soundKey };
