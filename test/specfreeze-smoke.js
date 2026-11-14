// After playback stops, the spectrum holds the last moment heard; another sound shows its average until played
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
let JS = null;
const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await JS(expr)) return true; await wait(100); } return false; };
app.on('browser-window-created', (e, win) => {
  win.setSize(1440, 900);
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    const key = async k => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); win.webContents.sendInputEvent({ type: 'char', keyCode: k }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(150); };
    try {
      await until('files.length >= 5 && !scanState.size');
      const r = {};
      await js(`$('#autoplay').checked=true; select(view.findIndex(r=>r.name==='Wind Low.wav'), true)`);
      await until('isPlaying()'); await wait(1200);
      r.playing = await js(`$('#speclabel').textContent`);
      await key('Space'); await wait(600);
      r.stopped = await js(`({label: $('#speclabel').textContent, playing: isPlaying(), level: Math.max(...liveData).toFixed(0)})`);
      fs.writeFileSync(path.join(out, 'held.png'), (await win.webContents.capturePage()).toPNG());
      await js(`$('#autoplay').checked=false; select(view.findIndex(r=>r.name==='Bass Drone C.wav'), false)`); await until(`current.name==='Bass Drone C.wav' && !!ed.buf`); await wait(500);
      r.otherSound = await js(`$('#speclabel').textContent`);
      console.log('RESULT', JSON.stringify(r));
    } catch (err) { console.log('TEST ERROR', err && err.stack); }
    app.quit();
  });
});
require('../src/main.js');
