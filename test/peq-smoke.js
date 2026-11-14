// Parametric EQ: real mouse drag of a bell onto a tone, wheel for width, right-click, cut, accuracy
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
  win.setSize(1440, 900);
  win.webContents.on('console-message', (ev) => { const m = ev.message || ev; if (/rror/.test(String(m))) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    const M = (type, x, y, extra = {}) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra });
    try {
      await until('files.length > 5 && !scanState.size');
      const r = {};
      await js(`$('#autoplay').checked=false; select(view.findIndex(r=>r.name==='Noisy Tone.wav'), false)`); await until('!!ed.buf && !!avg.db');
      const toneDb = `(()=>{const k=Math.round(441/avg.sr*avg.n);let m=-1e9;for(let i=k-3;i<=k+3;i++)m=Math.max(m,avg.db[i]);return +m.toFixed(1);})()`;
      r.before = await js(toneDb);
      await js(`$('#eqBtn').click()`); await wait(100);
      await js(`$('#eqMode button[data-q=param]').click()`); await wait(200);
      r.mode = await js(`({mode: ed.eqMode, shown: $('#eqMode').style.display, paramOn: $('#eqMode button[data-q=param]').classList.contains('on')})`);
      // drag point 3 (bell at 300 Hz) to 441 Hz and +12 dB with the real mouse
      const pt = await js(`(()=>{const b=scv.getBoundingClientRect(), s=b.width/scv.width, p=peqPos(ed.peq[2], specMap.fToX); return {x:b.left+p.x*s, y:b.top+p.y*s, tx:b.left+specMap.fToX(441)*s, ty:b.top+eqY(12)*s};})()`);
      M('mouseMove', pt.x, pt.y); M('mouseDown', pt.x, pt.y);
      for (let k = 1; k <= 6; k++) { M('mouseMove', pt.x + (pt.tx - pt.x) * k / 6, pt.y + (pt.ty - pt.y) * k / 6); await wait(30); }
      M('mouseUp', pt.tx, pt.ty);
      await until('!!ed.outBuf && !!ed.path'); await wait(400);
      r.bell = await js(`({band: ed.peq[2], expected: +eqResponseDb(peqCoefs(ed.peq, ed.buf.sampleRate), 441, ed.buf.sampleRate).toFixed(1), name: ed.name})`);
      r.measured = +((await js(toneDb)) - r.before).toFixed(1);
      // wheel over the point narrows it
      const q0 = await js(`ed.peq[2].q`);
      await js(`(()=>{const b=scv.getBoundingClientRect(), s=b.width/scv.width, p=peqPos(ed.peq[2], specMap.fToX); scv.dispatchEvent(new WheelEvent('wheel',{clientX:b.left+p.x*s, clientY:b.top+p.y*s, deltaY:-300, bubbles:true, cancelable:true}));})()`); await wait(200);
      r.wheelQ = [q0, await js(`ed.peq[2].q`)];
      // right-click turns it off
      await js(`(()=>{const b=scv.getBoundingClientRect(), s=b.width/scv.width, p=peqPos(ed.peq[2], specMap.fToX); scv.dispatchEvent(new MouseEvent('contextmenu',{clientX:b.left+p.x*s, clientY:b.top+p.y*s, bubbles:true, cancelable:true}));})()`); await wait(200);
      r.rightClickOff = await js(`ed.peq[2].on`);
      fs.writeFileSync(path.join(out, 'peq.png'), (await win.webContents.capturePage()).toPNG());
      // switching back to graphic keeps both settings
      await js(`$('#eqMode button[data-q=graphic]').click()`); await wait(200);
      r.back = await js(`({mode: ed.eqMode, peqKept: ed.peq[2].f})`);
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err && err.message); }
    app.quit();
  });
});
require('../src/main.js');
