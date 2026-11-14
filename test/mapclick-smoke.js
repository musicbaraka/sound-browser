// Map: a clicked sound plays through while the mouse wobbles or crosses other dots; hover previews still work
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
let JS = null;
const until = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await JS(expr)) return true; await wait(100); } return false; };
app.on('browser-window-created', (e, win) => {
  win.setSize(1440, 900);
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    const mv = (x, y) => win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
    const down = (x, y) => win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    const up = (x, y) => win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    const dot = name => js(`(()=>{const i=MAP.pts.findIndex(r=>r.name===${JSON.stringify(name)}), b=mcv.getBoundingClientRect(), d=devicePixelRatio||1; return {x:b.left+MAP.sx[i]/d, y:b.top+MAP.sy[i]/d};})()`);
    const state = () => js(`({cur: current && current.name, playing: !player.paused, preview: !preview.paused, previewFor: previewFor && previewFor.name, t: +player.currentTime.toFixed(2)})`);
    try {
      await until('files.length >= 14 && !scanState.size'); await until('MAP.placed >= 14 || (setMapMode(true), false)', 30000);
      await js(`setMapMode(true)`); await wait(800); await until('MAP.placed >= 14');
      const r = {};
      const a = await dot('Rain on Tin Roof.wav'), b = await dot('Wind Low.wav'), c = await dot('Bass Drone C.wav');
      // hover a dot: preview plays
      mv(a.x, a.y); await wait(500); r.hover = await state();
      // click it, wobbling a little during and after the click
      down(a.x, a.y); mv(a.x + 2, a.y + 1); up(a.x + 2, a.y + 1); await wait(500);
      r.clicked = await state();
      for (const [dx, dy] of [[3, 0], [-2, 2], [5, -3], [0, 0]]) { mv(a.x + dx, a.y + dy); await wait(80); }
      await wait(300); r.afterWobble = await state();
      // cross other dots: the clicked sound keeps playing
      mv(b.x, b.y); await wait(400); mv(c.x, c.y); await wait(400);
      r.afterCrossing = await state();
      // click empty space: stops
      const e = await js(`(()=>{const b=mcv.getBoundingClientRect(); return {x:b.left+8, y:b.bottom-40};})()`);
      mv(e.x, e.y); await wait(100); down(e.x, e.y); up(e.x, e.y); await wait(300);
      r.emptyClick = await state();
      // hovering works again
      mv(b.x, b.y); await wait(500); r.hoverAgain = await state();
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err && err.stack); }
    app.quit();
  });
});
require('../src/main.js');
