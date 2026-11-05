const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [phase, lib, out] = process.argv.slice(-3);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
if (phase === 'first') fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
if (phase === 'broken') fs.writeFileSync(path.join(app.getPath('userData'), 'secrets.json'), JSON.stringify({ enc: true, eleven: Buffer.from('not really encrypted').toString('base64') }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    try {
      await wait(1500);
      if (phase === 'first') await js(`sb.eleven.setKey('  "sk_live_abcdef987654"  ')`);
      const st = await js(`sb.eleven.status()`);
      await js(`showTab('settings')`); await wait(600);
      console.log('RESULT', phase, JSON.stringify(st), '|', await js(`$('#keyStatus').textContent`));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
