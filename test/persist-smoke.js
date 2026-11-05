// Do analysis results survive a restart? electron test/persist-smoke.js <phase> <lib> <out>
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [phase, lib, out] = process.argv.slice(-3);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
if (phase === 'first') fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    const until = async (expr, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return true; await wait(200); } return false; };
    await until('files.length > 1000 && !scanState.size');
    const at = await js(`({files: files.length, analyzed: files.filter(r=>r.meta&&r.meta.an).length, left: anLeft, stat: $('#anstat').textContent})`);
    console.log(phase, 'AT START', JSON.stringify(at));
    if (phase === 'first') { await wait(15000); console.log(phase, 'BEFORE QUIT', JSON.stringify(await js(`({analyzed: files.filter(r=>r.meta&&r.meta.an).length, stat: $('#anstat').textContent})`))); }
    app.quit();
  });
});
require('../src/main.js');
