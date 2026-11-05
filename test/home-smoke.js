const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    try {
      await wait(1500);
      const r = {};
      await js(`showTab('settings')`); await js(`$('#home').click()`); r.fromSettings = await js(`!document.querySelector('.page.show') && document.querySelector('#tabs button.on').dataset.tab`);
      await js(`showTab('about')`); await js(`$('#home').click()`); r.fromAbout = await js(`!document.querySelector('.page.show') && document.querySelector('#tabs button.on').dataset.tab`);
      await js(`showTab('settings'); openGen()`); await wait(300); await js(`$('#home').click()`); r.closesGenerate = await js(`!$('#gen').classList.contains('show') && !document.querySelector('.page.show')`);
      console.log('RESULT', JSON.stringify(r));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
