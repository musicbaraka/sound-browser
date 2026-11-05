// Wave / Spectrogram / Both view switches
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: { waveH: 220, autoplay: false } }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 900);
  win.webContents.on('console-message', ev => { const m = String(ev.message || ev); if (/Uncaught|Error/.test(m)) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return true; await wait(150); } return false; };
    try {
      await until('files.length > 5 && !scanState.size');
      const r = {};
      const click = m => js(`document.querySelector('#vmode button[data-m="${m}"]').click(); ({mode: viewMode, on: [...document.querySelectorAll('#vmode button.on')].map(b=>b.dataset.m)})`);
      r.start = await js(`viewMode`);
      r.addSpec = await click('spec');        // wave + spec = both
      r.removeWave = await click('wave');     // spec only
      r.removeSpecToo = await click('spec');  // cannot turn both off: falls back to wave
      r.backToBoth = await click('spec');
      await js(`select(view.findIndex(r=>r.name==='Noisy Tone.wav'), false)`); await until('!!ed.buf');
      await js(`ed.selA=1.5; ed.selB=3.2; changed(false);`); await until('!!(ed.outBuf && ed.path)');
      await js(`waveHover = {x: canvas.width*0.7, y: canvas.height*0.8}; drawWave();`); await wait(300);
      r.grabWorksInBoth = await js(`inGrabZone(tToX(2.3))`);
      fs.writeFileSync(path.join(out, 'both.png'), (await win.webContents.capturePage()).toPNG());
      await js(`saveSession()`); await wait(1200);
      r.saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'library.json'))).session.viewMode;
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
