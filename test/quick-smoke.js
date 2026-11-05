// Quick edit of a sound from outside the library
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
      r.inspect = await js(`sb.inspectPaths(['/tmp/an/melody_gmaj.wav', '/tmp/an', '/etc/hostname'])`);
      await js(`quickOpen('/tmp/an/melody_gmaj.wav')`);
      await until('!!ed.buf && current && current.temp');
      r.opened = await js(`({name: current.name, label: $('#np-dir').textContent, inLibrary: files.length, folders: folders.length, tagBox: $('#tagIn').style.display})`);
      await js(`ed.selA=1; ed.selB=3; setSpeed(0.5); setPitch(-12);`);
      await until('!!(ed.outBuf && ed.path)');
      r.saved = await js(`sb.saveEdit(ed.path, current.path)`);
      r.savedExists = fs.existsSync(r.saved || '');
      await wait(2500);
      r.after = await js(`({libraryFiles: files.length, folders: folders.length, stillCurrent: current && current.name, analyzedQuick: !!(current.meta && current.meta.an)})`);
      fs.writeFileSync(path.join(out, 'quick.png'), (await win.webContents.capturePage()).toPNG());
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
