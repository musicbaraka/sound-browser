// Settings tab
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
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
      await js(`document.querySelector('#tabs button[data-tab="settings"]').click()`); await wait(300);
      r.page = await js(`({shown: $('#settingsPage').classList.contains('show'), aboutHidden: !$('#aboutPage').classList.contains('show'), folders: [...document.querySelectorAll('.frow')].map(f=>f.innerText.replace(/\\s+/g,' ')), dataPath: $('#dataPath').textContent, kt: $('#ktToggle').checked})`);
      fs.writeFileSync(path.join(out, 'settings.png'), (await win.webContents.capturePage()).toPNG());
      await js(`$('#ktToggle').click()`); await wait(1500);
      r.ktOn = await js(`({kt: keyTempo, keyCol: document.querySelector('#cols span[data-k="key"]').offsetWidth > 0, analyzing: anBusy})`);
      await js(`colW.name = 900; sideW = 500; applyCols(); applySizes(); $('#resetLayout').click()`);
      r.reset = await js(`({name: colW.name, side: sideW})`);
      await js(`document.querySelector('#tabs button[data-tab="lib"]').click()`);
      r.backToLibrary = await js(`!document.querySelector('.page.show')`);
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
