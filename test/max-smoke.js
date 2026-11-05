const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: { autoplay: false } }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 900);
  win.webContents.on('console-message', ev => { const m = String(ev.message || ev); if (/Uncaught|Error/.test(m)) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return true; await wait(150); } return false; };
    try {
      await until('files.length > 5 && !scanState.size');
      await js(`select(view.findIndex(r=>r.name==='Forest Morning.flac'), false)`); await until('!!ed.buf');
      await js(`$('#maxR').value=24; $('#maxR').oninput(); $('#ceilN').value=-1; $('#ceilN').onchange();`);
      await until(`!!(ed.outBuf && ed.path && ed.name.includes('max'))`);
      const r = await js(`({name: ed.name, info: $('#clip-sub').textContent, path: ed.path})`);
      fs.writeFileSync(path.join(out, 'max.png'), (await win.webContents.capturePage()).toPNG());
      console.log('RESULT', JSON.stringify(r));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
