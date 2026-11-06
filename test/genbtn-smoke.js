const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 860);
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    try {
      await wait(2500);
      const r = await js(`(()=>{ const b=$('#genBtn').getBoundingClientRect(), f=$('#filters').getBoundingClientRect(); return {inFilters: $('#genBtn').parentElement.id, rightGap: Math.round(f.right-b.right), sameRow: b.top>=f.top && b.bottom<=f.bottom, label: $('#genBtn').textContent}; })()`);
      await js(`$('#genBtn').click()`); await wait(400); r.opens = await js(`$('#gen').classList.contains('show')`); await js(`$('#gen-close').click()`);
      $search = await js(`$('#search').value='snair'; applyFilter(); 0`);
      await wait(200);
      r.withBanner = await js(`(()=>{ const b=$('#genBtn').getBoundingClientRect(), f=$('#filters').getBoundingClientRect(); return Math.round(f.right-b.right); })()`);
      await js(`$('#search').value=''; applyFilter();`); await wait(200);
      fs.writeFileSync(path.join(out, 'b.png'), (await win.webContents.capturePage({ x: 0, y: 0, width: 1400, height: 140 })).toPNG());
      console.log('RESULT', JSON.stringify(r));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
