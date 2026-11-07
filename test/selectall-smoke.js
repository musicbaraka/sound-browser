// Ctrl+A selects the whole sound; inside a text field it still selects the text
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
let JS = null;
const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await JS(expr)) return true; await wait(100); } return false; };
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 900);
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    const ctrlA = async () => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] }); win.webContents.sendInputEvent({ type: 'char', keyCode: 'a', modifiers: ['control'] }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] }); await wait(300); };
    try {
      await until('files.length > 5 && !scanState.size');
      const r = {};
      await js(`$('#autoplay').checked=false; select(view.findIndex(r=>r.name==='Noisy Tone.wav'), false)`); await until('!!ed.buf');
      // click on the waveform first, like a user would
      const b = await js(`(()=>{const r=canvas.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(b.x), y: Math.round(b.y), button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(b.x), y: Math.round(b.y), button: 'left', clickCount: 1 });
      await wait(200); await js(`stopAll()`);
      await ctrlA();
      r.wave = await js(`({selA: ed.selA, selB: +ed.selB.toFixed(3), dur: +srcDur().toFixed(3), pageText: String(getSelection()).length})`);
      await until('!!ed.outBuf'); r.edit = await js(`({out: !!ed.outBuf, name: ed.name})`);
      await js(`stopAll(); $('#search').value='hello world'; $('#search').focus()`);
      await ctrlA();
      r.search = await js(`({start: $('#search').selectionStart, end: $('#search').selectionEnd, selB: +ed.selB.toFixed(3)})`);
      console.log('RESULT', JSON.stringify(r));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
