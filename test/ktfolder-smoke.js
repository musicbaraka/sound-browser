// Key and tempo for chosen folders only
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
    const until = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return true; await wait(200); } return false; };
    try {
      await until('files.length > 5 && !scanState.size');
      const r = {};
      r.before = await js(`({cols: document.querySelector('#cols span[data-k="key"]').offsetWidth > 0, analyzing: anBusy})`);
      // right-click the Music folder in the sidebar and choose the menu item
      await js(`expanded.add(folders[0]+'|'); buildSide(false)`);
      r.menu = await js(`(()=>{ const el=[...document.querySelectorAll('#side .dir')].find(d=>d.dataset.d.endsWith('|Music/')); const b=el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.x+20,clientY:b.y+5}));
        const label=$('#fm-kt').textContent; $('#fm-kt').click(); return label; })()`);
      await until('!anBusy && files.filter(r=>r.meta&&r.meta.an).length >= 5');
      await wait(1000);
      r.after = await js(`({chosen: ktFolders, cols: document.querySelector('#cols span[data-k="key"]').offsetWidth > 0, badge: !!document.querySelector('#side .dir .kt'),
        analyzed: files.filter(r=>r.meta&&r.meta.an).map(r=>r.dir+r.name+' -> '+(r.key||'-')+' / '+(r.bpm||'-'))})`);
      r.menuNow = await js(`(()=>{ const el=[...document.querySelectorAll('#side .dir')].find(d=>d.dataset.d.endsWith('|Music/')); el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:30,clientY:200})); const t=$('#fm-kt').textContent; document.body.click(); return t; })()`);
      await js(`showTab('settings')`); await wait(300);
      r.settingsList = await js(`[...document.querySelectorAll('#ktList .frow')].map(f=>f.innerText.replace(/\\s+/g,' '))`);
      fs.writeFileSync(path.join(out, 'kt-settings.png'), (await win.webContents.capturePage()).toPNG());
      await js(`showTab('lib')`); await wait(200);
      fs.writeFileSync(path.join(out, 'kt-lib.png'), (await win.webContents.capturePage()).toPNG());
      await js(`saveSession()`); await wait(1200);
      r.saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'library.json'))).session.ktFolders;
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
