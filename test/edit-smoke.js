// Headless test of the editor: electron test/edit-smoke.js <libraryFolder> <outDir>
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 900);
  win.webContents.on('console-message', (ev) => console.log('[renderer]', ev.message || ev));
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    try {
      await wait(2500);
      const r = {};
      // 1) Forest (8s stereo flac): select 2s-4s, speed 0.5, pitch -5 (independent)
      await js(`select(view.findIndex(r=>r.name==='Forest Morning.flac'), false)`); await wait(1500);
      await js(`ed.selA=2; ed.selB=4; setSpeed(0.5); setPitch(-5);`); await wait(2500);
      r.stretch = await js(`({dur: ed.outBuf && +ed.outBuf.duration.toFixed(3), ch: ed.outBuf && ed.outBuf.numberOfChannels, sr: ed.outBuf && ed.outBuf.sampleRate, name: ed.name, path: ed.path, playing: !!eSrc})`);
      await js(`zoom.t0=1.5; zoom.t1=4.5; drawWave();`); await wait(400);
      fs.writeFileSync(path.join(out, 'edit.png'), (await win.webContents.capturePage()).toPNG());
      // 2) tape mode on kick: speed 2 => +12 st, reverse
      await js(`stopAll(); select(view.findIndex(r=>r.name==='Kick 808 Deep.wav'), false)`); await wait(1200);
      await js(`$('#tape').checked=true; $('#tape').onchange({target:$('#tape')}); setSpeed(2); ed.reverse=true; changed(false);`); await wait(1500);
      r.tape = await js(`({dur: +ed.outBuf.duration.toFixed(3), semis: +ed.semis.toFixed(2), name: ed.name, path: ed.path})`);
      // 3) AIFF, selection only, normalize + fades
      await js(`select(view.findIndex(r=>r.name==='Kick Punchy.aiff'), false)`); await wait(1200);
      await js(`$('#tape').checked=false; $('#tape').onchange({target:$('#tape')}); ed.selA=0.1; ed.selB=0.3; ed.normalize=true; ed.fadeOut=50; changed(false)`); await wait(1500);
      r.aiff = await js(`({dur: +ed.outBuf.duration.toFixed(3), peak: +ed.outPeak.toFixed(3), name: ed.name, path: ed.path})`);
      r.saved = await js(`(async()=>{ const d = await sb.saveEdit(ed.path, current.path); return d; })()`);
      r.mp3 = await js(`(async()=>{ select(view.findIndex(r=>r.name==='Bell Shimmer.mp3'), false); await new Promise(r=>setTimeout(r,1200)); setPitch(7); await new Promise(r=>setTimeout(r,1500)); return {dur:+ed.outBuf.duration.toFixed(3), name: ed.name, path: ed.path}; })()`);
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
