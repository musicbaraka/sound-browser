// Headless test of the Clean presets (hum, hiss, rumble, voice)
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
let JS = null;
const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await JS(expr)) return true; await wait(150); } return false; };
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 900);
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    try {
      await until('files.length >= 2 && !scanState.size');
      const r = {};
      await js(`$('#autoplay').checked=false; select(view.findIndex(r=>r.name==='Hummy Guitar.wav'), false)`); await until('!!ed.buf');
      const pick = async m => { await js(`{ ed.outBuf=null; const s=$('#cleanSel'); s.value='${m}'; s.dispatchEvent(new Event('change')) }`); await until('!!ed.outBuf && !!ed.path'); await wait(200);
        return js(`({mode: ed.clean, nr: ed.nr, name: ed.name, note: ed.cleanNote, sliderOff: $('#nrCtl').classList.contains('off'), sub: $('#clip-sub').textContent})`); };
      for (const m of ['hum', 'hiss', 'rumble', 'voice', 'noise']) r[m] = await pick(m);
      await js(`{ const s=$('#cleanSel'); s.value=''; s.dispatchEvent(new Event('change')) }`); await wait(400);
      r.off = await js(`({mode: ed.clean, changed: paramsChanged()})`);
      await js(`{ const s=$('#cleanSel'); s.value='hum'; s.dispatchEvent(new Event('change')) }`); await until('!!ed.cleanNote'); await wait(300);
      fs.writeFileSync(path.join(out, 'clean.png'), (await win.webContents.capturePage()).toPNG());
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
