const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.webContents.on('console-message', ev => { const m = String(ev.message || ev); if (/Uncaught|Error/.test(m)) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return true; await wait(100); } return false; };
    try {
      await until('files.length > 5 && !scanState.size');
      const r = {};
      const d = path.join(lib, 'Drums', 'Kicks');
      fs.copyFileSync(path.join(d, 'Kick 808 Deep.wav'), path.join(d, 'Kick New One.wav'));
      fs.copyFileSync(path.join(d, 'Kick 808 Deep.wav'), path.join(d, 'Kick New Two.wav'));
      // right-click the Kicks folder and choose Refresh, right away (before the folder watcher reacts)
      await js(`expanded.add(folders[0]+'|'); expanded.add(folders[0]+'|Drums/'); buildSide(false)`);
      r.menuItem = await js(`(()=>{ const el=[...document.querySelectorAll('#side .dir')].find(x=>x.dataset.d.endsWith('|Drums/Kicks/')); el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:200})); const item=document.querySelector('#fmenu [data-a="refresh"]'); const t=item.textContent; item.click(); return t; })()`);
      await until(`$('#status').textContent.includes('refreshed')`);
      r.status = await js(`$('#status').textContent`);
      r.listed = await js(`files.filter(r=>r.name.startsWith('Kick New')).length`);
      fs.rmSync(path.join(d, 'Kick New Two.wav'));
      await js(`dirFilter = folders[0]+'|Drums/Kicks/'; document.dispatchEvent(new KeyboardEvent('keydown',{key:'F5',bubbles:true}))`);
      await until(`$('#status').textContent.includes('refreshed') && $('#status').textContent.includes('removed')`, 5000);
      r.f5 = await js(`$('#status').textContent`);
      await wait(2000);
      r.after = await js(`files.filter(r=>r.name.startsWith('Kick New')).map(r=>r.name)`);
      fs.rmSync(path.join(d, 'Kick New One.wav'));
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
