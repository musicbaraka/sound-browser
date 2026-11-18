// MIDI: listed with tempo/key/tracks, piano roll, plays through the built-in synth, seek, pause, switch to audio and back
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
let JS = null;
const until = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await JS(expr)) return true; await wait(100); } return false; };
app.on('browser-window-created', (e, win) => {
  win.setSize(1440, 900);
  win.webContents.on('console-message', (ev) => { const m = ev.message || ev; if (/rror|fail/i.test(String(m))) console.log('[renderer]', String(m).slice(0, 300)); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    const level = () => js(`(()=>{ if(!analyser) return -200; const d=new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(d); return Math.round(Math.max(...d)); })()`);
    try {
      await until('files.length >= 4 && !scanState.size');
      await until(`files.filter(r=>isMidiRec(r)).every(r=>r.meta && r.meta.parsed)`, 20000);
      const r = {};
      r.list = await js(`files.filter(r=>isMidiRec(r)).map(r=>({name:r.name.slice(0,20), fmt: fmtFormat(r.meta), dur: r.dur, bpm: r.bpm, key: r.key}))`);
      r.chips = await js(`$('#chips').textContent.replace(/\\s+/g,' ').trim()`);
      await js(`$('#autoplay').checked=true; select(view.findIndex(r=>r.name==='Dance.mid'), true)`);
      await until('!!midiDoc'); 
      const t0 = Date.now(); await until('!player.paused', 30000); r.startMs = Date.now() - t0;
      await wait(2500);
      r.playing = await js(`({isMidi: !!player.isMidi, paused: player.paused, t: +player.currentTime.toFixed(2), dur: +player.duration.toFixed(1), status: $('#status').textContent.slice(0,140), label: $('#speclabel').textContent, btn: $('#play').textContent, time: $('#np-time').textContent})`);
      r.level = await level();
      fs.writeFileSync(path.join(out, 'roll.png'), (await win.webContents.capturePage()).toPNG());
      // seek by clicking the roll at 60%
      const p = await js(`(()=>{const b=canvas.getBoundingClientRect(); return {x:b.left+b.width*0.6, y:b.top+b.height*0.5};})()`);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 });
      await wait(1200);
      r.afterSeek = await js(`({t: +player.currentTime.toFixed(1), paused: player.paused})`);
      // space stops
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' }); await wait(600);
      r.stopped = await js(`({paused: player.paused, voices: midiEng.synth.voiceCount})`);
      await wait(800); r.levelAfterStop = await level();
      // switch to an audio file and back
      await js(`select(view.findIndex(r=>r.name==='Bass Drone C.wav'), true)`); await until('!!ed.buf && !audioEl.paused', 15000); await wait(500);
      r.audio = await js(`({isMidi: !!player.isMidi, midimode: document.body.classList.contains('midimode'), playing: !audioEl.paused, midiPaused: midiPlayer.paused})`);
      await js(`select(view.findIndex(r=>r.name==='J-cycle.mid'), true)`); await until('!!midiDoc && !player.paused', 15000); await wait(1000);
      r.second = await js(`({name: current.name, t: +player.currentTime.toFixed(1), audioPaused: audioEl.paused, roll: midiDoc.notes.length})`);
      fs.writeFileSync(path.join(out, 'roll2.png'), (await win.webContents.capturePage()).toPNG());
      await js(`stopAll()`);
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err && err.stack); }
    app.quit();
  });
});
require('../src/main.js');
