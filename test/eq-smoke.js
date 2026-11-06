// Headless test of the graphic EQ drawn over the spectrum
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
  win.webContents.on('console-message', (ev) => { const m = ev.message || ev; if (/error|Error/.test(String(m))) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    try {
      await until('files.length > 5 && !scanState.size');
      const r = {};
      await js(`$('#autoplay').checked=false; select(view.findIndex(r=>r.name==='Noisy Tone.wav'), false)`); await until('!!ed.buf && !!avg.db');
      const toneDb = `(()=>{const k=Math.round(441/avg.sr*avg.n);let m=-1e9;for(let i=k-3;i<=k+3;i++)m=Math.max(m,avg.db[i]);return +m.toFixed(1);})()`;
      r.before = await js(toneDb);
      await js(`$('#eqBtn').click()`);
      r.on = await js(`({btn: $('#eqBtn').classList.contains('on'), flat: $('#eqFlat').style.display, edited: isEdited()})`);
      // drag the 500 Hz fader to the bottom with the real mouse
      const g = await js(`(()=>{const b=scv.getBoundingClientRect(), s=b.width/scv.width; return {x: b.left + specMap.fToX(500)*s, top: b.top + eqY(0)*s, bot: b.top + eqY(-12)*s + 2};})()`);
      mouse('mouseMove', g.x, g.top); mouse('mouseDown', g.x, g.top);
      for (let k = 1; k <= 6; k++) { mouse('mouseMove', g.x, g.top + (g.bot - g.top) * k / 6); await wait(30); }
      mouse('mouseUp', g.x, g.bot);
      await until('!!ed.outBuf && !!ed.path');
      await wait(300);
      r.afterDrag = await js(`({eq: ed.eq.join(','), name: ed.name, resp441: +eqResponseDb(eqCoefs(ed.eq, ed.buf.sampleRate), 441, ed.buf.sampleRate).toFixed(1)})`);
      r.after = await js(toneDb);
      r.measuredDrop = +(r.after - r.before).toFixed(1);
      fs.writeFileSync(path.join(out, 'eq.png'), (await win.webContents.capturePage()).toPNG());
      // live: play, then move a band, playback carries on from the same spot
      await js(`playEdit()`); await wait(900);
      const p0 = await js(`editPos()`);
      await js(`ed.eq[6]=6; eqChanged()`); await wait(500);
      r.live = await js(`({playing: !!eSrc, pos: +editPos().toFixed(2), name: ed.name})`); r.live.posBefore = +p0.toFixed(2);
      await js(`stopAll()`);
      // bypass keeps the settings
      await js(`$('#eqBtn').click()`); await wait(400);
      r.bypass = await js(`({eq: ed.eq.join(','), edited: isEdited(), out: !!ed.outBuf})`);
      await js(`$('#eqBtn').click()`); await until('!!ed.outBuf'); await wait(300);
      await js(`$('#eqFlat').click()`); await wait(400);
      r.flat = await js(`({eq: ed.eq.join(','), edited: isEdited()})`);
      // double-click resets one band
      await js(`ed.eq[3]=-6; eqChanged()`); await wait(300);
      const g3 = await js(`(()=>{const b=scv.getBoundingClientRect(), s=b.width/scv.width; return {x: b.left + specMap.fToX(250)*s, y: b.top + eqY(-6)*s};})()`);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(g3.x), y: Math.round(g3.y), button: 'left', clickCount: 2 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(g3.x), y: Math.round(g3.y), button: 'left', clickCount: 2 });
      await wait(300);
      r.dbl = await js(`ed.eq[3]`);
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
