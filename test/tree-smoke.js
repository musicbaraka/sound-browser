const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 900);
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return true; await wait(150); } return false; };
    try {
      await until('files.length > 5 && !scanState.size');
      const r = {};
      r.arrow = await js(`(()=>{ const t=[...document.querySelectorAll('#side .tw')].find(x=>x.dataset.tw && x.dataset.tw.endsWith('|Drums/')); const b=t.getBoundingClientRect(); return {w: Math.round(b.width), h: Math.round(b.height)}; })()`);
      await js(`[...document.querySelectorAll('#side .tw')].find(x=>x.dataset.tw && x.dataset.tw.endsWith('|Drums/')).click()`); await wait(200);
      r.opened = await js(`expanded.has(folders[0]+'|Drums/') && !!document.querySelector('#side .tw.open')`);
      await js(`[...document.querySelectorAll('#side .tw')].find(x=>x.dataset.tw && x.dataset.tw.endsWith('|Ambiences/')).click()`); await wait(300);
      fs.writeFileSync(path.join(out, 'tree.png'), (await win.webContents.capturePage({ x: 0, y: 90, width: 520, height: 260 })).toPNG());
      console.log('RESULT', JSON.stringify(r));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
