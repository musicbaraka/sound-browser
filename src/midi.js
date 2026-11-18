/* MIDI files: notes, tempo, meter, tracks, and the key worked out from the notes.
   Used by the main process (library info) and the window (piano roll). */
(function (root) {
  function parseMidi(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let p = 0;
    const str = n => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u[p + i]); return s; };
    const u32 = () => (u[p++] << 24 | u[p++] << 16 | u[p++] << 8 | u[p++]) >>> 0;
    const u16 = () => (u[p++] << 8) | u[p++];
    const vlq = () => { let v = 0, b; do { b = u[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && p < u.length); return v; };
    // the header can sit after a wrapper (RIFF .rmi files): look for it near the start
    while (p < Math.min(u.length - 14, 4096) && str(4) !== 'MThd') p++;
    if (str(4) !== 'MThd') throw new Error('Not a MIDI file');
    p += 4; const hlen = Math.max(6, u32());
    const fmt = u16(), ntr = u16(), div = u16();
    p += hlen - 6;
    if (div & 0x8000) throw new Error('SMPTE timing is not supported');
    const ppq = div || 480;
    const tempos = [], tsigs = [], ksigs = [], tracks = [];
    let maxTick = 0;
    for (let t = 0; t < ntr && p < u.length - 8; t++) {
      while (p < u.length - 8 && str(4) !== 'MTrk') { p += 4; const l = u32(); p += l; }
      if (p >= u.length - 8) break;
      p += 4; const len = u32(), end = Math.min(u.length, p + len);
      const tr = { name: '', notes: [], programs: {}, channels: new Set() };
      const open = new Map();
      let tick = 0, status = 0;
      while (p < end) {
        tick += vlq();
        let b = u[p];
        if (b & 0x80) { status = b; p++; } else if (!status) { p++; continue; }
        const hi = status & 0xf0, ch = status & 0x0f;
        if (status === 0xff) {
          const type = u[p++], l = vlq(), d = p; p += l;
          if (type === 0x51 && l >= 3) tempos.push([tick, (u[d] << 16) | (u[d + 1] << 8) | u[d + 2]]);
          else if (type === 0x58 && l >= 2) tsigs.push([tick, u[d], 1 << u[d + 1]]);
          else if (type === 0x59 && l >= 2) ksigs.push([tick, (u[d] << 24) >> 24, u[d + 1]]);
          else if (type === 0x03 && !tr.name) { let s = ''; for (let i = 0; i < l; i++) s += String.fromCharCode(u[d + i]); tr.name = s.replace(/\0/g, '').trim(); }
          status = 0;
        } else if (status === 0xf0 || status === 0xf7) { const l = vlq(); p += l; status = 0; }
        else if (hi === 0x90 || hi === 0x80) {
          const n = u[p++], v = u[p++];
          const k = ch * 128 + n;
          if (hi === 0x90 && v > 0) { if (!open.has(k)) open.set(k, []); open.get(k).push([tick, v]); }
          else { const st = open.get(k); if (st && st.length) { const [t0, vel] = st.shift(); tr.notes.push([t0, tick, n, vel, ch]); } }
          tr.channels.add(ch);
        }
        else if (hi === 0xc0) { tr.programs[ch] = tr.programs[ch] ?? u[p]; p += 1; }
        else if (hi === 0xd0) p += 1;
        else p += 2;
      }
      for (const [k, st] of open) for (const [t0, vel] of st) tr.notes.push([t0, tick, k & 127, vel, k >> 7]);
      maxTick = Math.max(maxTick, tick);
      p = end;
      tracks.push(tr);
    }
    // ticks to seconds through the tempo map
    tempos.sort((a, b) => a[0] - b[0]);
    const map = [[0, 0, 500000]];                       // [tick, seconds at that tick, microseconds per quarter]
    for (const [tk, us] of tempos) {
      const last = map[map.length - 1];
      const sec = last[1] + (tk - last[0]) * last[2] / 1e6 / ppq;
      if (tk === last[0]) last[2] = us; else map.push([tk, sec, us]);
    }
    const toSec = tk => { let i = map.length - 1; while (i > 0 && map[i][0] > tk) i--; const m = map[i]; return m[1] + (tk - m[0]) * m[2] / 1e6 / ppq; };
    const notes = [];
    tracks.forEach((tr, ti) => { for (const [a, b, n, v, ch] of tr.notes) notes.push({ t: toSec(a), d: Math.max(0.01, toSec(b) - toSec(a)), n, v, ch, tr: ti }); });
    notes.sort((a, b) => a.t - b.t);
    const dur = Math.max(toSec(maxTick), notes.reduce((m, x) => Math.max(m, x.t + x.d), 0));
    // the tempo that covers most of the song
    let bpm = null;
    { const spans = new Map(); for (let i = 0; i < map.length; i++) { const a = map[i][1], b = i + 1 < map.length ? map[i + 1][1] : dur; const q = Math.round(60e6 / map[i][2] * 10) / 10; spans.set(q, (spans.get(q) || 0) + Math.max(0, b - a)); } let best = 0; for (const [q, s] of spans) if (s > best) { best = s; bpm = q; } }
    const ts = tsigs.length ? tsigs.sort((a, b) => a[0] - b[0])[0] : null;
    const used = tracks.map((tr, i) => ({ i, name: tr.name, notes: tr.notes.length, drums: tr.channels.size === 1 && tr.channels.has(9), program: Object.values(tr.programs)[0] })).filter(x => x.notes);
    return { fmt, ppq, dur, bpm, timeSig: ts ? ts[1] + '/' + ts[2] : null, keySig: ksigs[0] || null, tracks: used, notes, tempoMap: map };
  }

  // Key from the notes (Krumhansl-Kessler profiles), drums left out, each note weighted by its length
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function corr(x, y) {
    const n = 12, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
    let s = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; s += a * b; sx += a * a; sy += b * b; }
    return s / Math.sqrt(sx * sy + 1e-12);
  }
  function midiKey(doc) {
    const h = new Array(12).fill(0);
    let pitched = 0;
    for (const x of doc.notes) if (x.ch !== 9) { h[x.n % 12] += Math.min(x.d, 4) * (0.5 + x.v / 254); pitched++; }
    if (pitched < 8) return null;
    let best = null;
    for (let k = 0; k < 12; k++) for (const [prof, mode] of [[MAJ, 'maj'], [MIN, 'min']]) {
      const rot = h.map((_, i) => h[(i + k) % 12]);
      const c = corr(rot, prof);
      if (!best || c > best.c) best = { c, key: NAMES[k] + ' ' + mode };
    }
    return best && best.c > 0.5 ? best.key : null;
  }
  function midiSummary(bytes) {
    const doc = parseMidi(bytes);
    return {
      dur: +doc.dur.toFixed(3), bpm: doc.bpm, key: midiKey(doc), timeSig: doc.timeSig,
      tracks: doc.tracks.length, notes: doc.notes.length, drums: doc.tracks.some(t => t.drums) || doc.notes.some(n => n.ch === 9)
    };
  }
  const api = { parseMidi, midiKey, midiSummary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
