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
    const ctl = { mod: 0, modMax: 0, modCh: new Set(), bend: 0, bendCh: new Set(), expr: 0, vol: 0, pressure: 0, pressCh: new Set() };
    const modEv = [], bendEv = [], pressEv = [];   // [tick, channel, value] for the controller lanes
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
        else if (hi === 0xd0) { ctl.pressure++; ctl.pressCh.add(ch); pressEv.push([tick, ch, u[p]]); p += 1; }
        else if (hi === 0xb0) { const c = u[p], v = u[p + 1]; if (c === 1) { ctl.mod++; if (v > ctl.modMax) ctl.modMax = v; ctl.modCh.add(ch); modEv.push([tick, ch, v]); } else if (c === 11) ctl.expr++; else if (c === 7) ctl.vol++; p += 2; }
        else if (hi === 0xe0) { const v = ((u[p + 1] << 7) | u[p]) - 8192; if (v) { ctl.bend++; ctl.bendCh.add(ch); } bendEv.push([tick, ch, v]); p += 2; }
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
    const lane = ev => ev.map(([tk, ch, v]) => ({ t: toSec(tk), ch, v })).sort((a, b) => a.t - b.t);
    const dur = Math.max(toSec(maxTick), notes.reduce((m, x) => Math.max(m, x.t + x.d), 0));
    // the tempo that covers most of the song
    let bpm = null;
    { const spans = new Map(); for (let i = 0; i < map.length; i++) { const a = map[i][1], b = i + 1 < map.length ? map[i + 1][1] : dur; const q = Math.round(60e6 / map[i][2] * 10) / 10; spans.set(q, (spans.get(q) || 0) + Math.max(0, b - a)); } let best = 0; for (const [q, s] of spans) if (s > best) { best = s; bpm = q; } }
    const ts = tsigs.length ? tsigs.sort((a, b) => a[0] - b[0])[0] : null;
    const used = tracks.map((tr, i) => ({ i, name: tr.name, notes: tr.notes.length, drums: tr.channels.size === 1 && tr.channels.has(9), program: Object.values(tr.programs)[0] })).filter(x => x.notes);
    // the parts as the synth sees them: one per MIDI channel that plays notes
    const chans = [];
    for (let ch = 0; ch < 16; ch++) {
      let n = 0, name = '', program = null, track = -1;
      tracks.forEach((tr, ti) => {
        const k = tr.notes.reduce((a, x) => a + (x[4] === ch ? 1 : 0), 0);
        if (k) { n += k; if (!name && tr.name) name = tr.name; if (track < 0) track = ti; }
        if (program == null && tr.programs[ch] != null) program = tr.programs[ch];
      });
      if (n) chans.push({ ch, notes: n, name, program: program ?? 0, drums: ch === 9, track });
    }
    return { fmt, ppq, dur, bpm, timeSig: ts ? ts[1] + '/' + ts[2] : null, keySig: ksigs[0] || null, tracks: used, channels: chans, notes, tempoMap: map, modLane: lane(modEv), bendLane: lane(bendEv), pressLane: lane(pressEv),
      controls: { mod: ctl.mod, modMax: ctl.modMax, modCh: [...ctl.modCh].map(c => c + 1), bend: ctl.bend, bendCh: [...ctl.bendCh].map(c => c + 1), expr: ctl.expr, vol: ctl.vol, pressure: ctl.pressure, pressCh: [...ctl.pressCh].map(c => c + 1) } };
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
  const GM = ['Acoustic Grand Piano','Bright Acoustic Piano','Electric Grand Piano','Honky-tonk Piano','Electric Piano 1','Electric Piano 2','Harpsichord','Clavinet','Celesta','Glockenspiel','Music Box','Vibraphone','Marimba','Xylophone','Tubular Bells','Dulcimer','Drawbar Organ','Percussive Organ','Rock Organ','Church Organ','Reed Organ','Accordion','Harmonica','Tango Accordion','Nylon Guitar','Steel Guitar','Jazz Guitar','Clean Guitar','Muted Guitar','Overdriven Guitar','Distortion Guitar','Guitar Harmonics','Acoustic Bass','Finger Bass','Pick Bass','Fretless Bass','Slap Bass 1','Slap Bass 2','Synth Bass 1','Synth Bass 2','Violin','Viola','Cello','Contrabass','Tremolo Strings','Pizzicato Strings','Orchestral Harp','Timpani','String Ensemble 1','String Ensemble 2','Synth Strings 1','Synth Strings 2','Choir Aahs','Voice Oohs','Synth Voice','Orchestra Hit','Trumpet','Trombone','Tuba','Muted Trumpet','French Horn','Brass Section','Synth Brass 1','Synth Brass 2','Soprano Sax','Alto Sax','Tenor Sax','Baritone Sax','Oboe','English Horn','Bassoon','Clarinet','Piccolo','Flute','Recorder','Pan Flute','Blown Bottle','Shakuhachi','Whistle','Ocarina','Square Lead','Saw Lead','Calliope Lead','Chiff Lead','Charang Lead','Voice Lead','Fifths Lead','Bass + Lead','New Age Pad','Warm Pad','Polysynth Pad','Choir Pad','Bowed Pad','Metallic Pad','Halo Pad','Sweep Pad','Rain','Soundtrack','Crystal','Atmosphere','Brightness','Goblins','Echoes','Sci-fi','Sitar','Banjo','Shamisen','Koto','Kalimba','Bagpipe','Fiddle','Shanai','Tinkle Bell','Agogo','Steel Drums','Woodblock','Taiko Drum','Melodic Tom','Synth Drum','Reverse Cymbal','Guitar Fret Noise','Breath Noise','Seashore','Bird Tweet','Telephone Ring','Helicopter','Applause','Gunshot'];
  const api = { parseMidi, midiKey, midiSummary, GM_NAMES: GM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
