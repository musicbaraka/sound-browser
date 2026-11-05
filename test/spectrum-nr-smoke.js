// Headless test of spectrum analyzer, spectrogram and noise reduction
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 900);
  win.webContents.on('console-message', (ev) => { const m = ev.message || ev; if (!String(m).includes('Autofill')) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    try {
      await wait(2500);
      const r = {};
      await js(`$('#autoplay').checked=false; select(view.findIndex(r=>r.name==='Noisy Tone.wav'), false)`); await wait(1500);
      r.avgPeakHz = await js(`(()=>{let m=-1e9,k=0;for(let i=5;i<avg.db.length;i++) if(avg.db[i]>m){m=avg.db[i];k=i;} return {hz:+(k*avg.sr/avg.n).toFixed(1), db:+m.toFixed(1), what: avg.what};})()`);
      r.specMs = await js(`(()=>{const t=performance.now(); setViewMode('spec'); return +(performance.now()-t).toFixed(0);})()`);
      // live analyser while playing
      await js(`playFrom(1.5)`); await wait(700);
      r.live = await js(`(()=>{const d=new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(d);let m=-1e9,k=0;for(let i=5;i<d.length;i++) if(d[i]>m){m=d[i];k=i;} return {playing:isPlaying(), hz:+(k*actx.sampleRate/analyser.fftSize).toFixed(1), dbCal:+(m+ANALYSER_OFFSET).toFixed(1)};})()`);
      await js(`specHover={x: scv.width*0.6}; drawSpectrum();`);
      fs.writeFileSync(path.join(out, 'live.png'), (await win.webContents.capturePage()).toPNG());
      await js(`stopAll(); specHover=null;`);
      // learn noise from the first 0.8s, then clean
      await js(`ed.selA=0.1; ed.selB=0.9; updateTime(); $('#learnNoise').click();`); await wait(2500);
      r.nr = await js(`({nr: ed.nr, prof: !!ed.noise, name: ed.name, path: ed.path, status: $('#status').textContent})`);
      await js(`updateAvg(); waveCache=null; drawWave();`); await wait(300);
      fs.writeFileSync(path.join(out, 'clean.png'), (await win.webContents.capturePage()).toPNG());
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
