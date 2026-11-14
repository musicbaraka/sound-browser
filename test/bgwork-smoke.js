// Huge library while sound colors are being worked out: scrolling stays smooth, Waves toggle, pause
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
if (!fs.existsSync(path.join(app.getPath('userData'), 'library.json')))
  fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
let JS = null;
const until = async (expr, ms = 300000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await JS(expr)) return true; await wait(250); } return false; };
app.on('browser-window-created', (e, win) => {
  win.setSize(1440, 900);
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    // frame gaps while scrolling the list with the wheel for 4 s
    const scrollTest = async () => {
      await js(`window.__gaps=[]; window.__last=performance.now(); (function f(){const n=performance.now(); __gaps.push(n-__last); __last=n; if(__gaps.length<100000) window.__raf=requestAnimationFrame(f);})()`);
      const b = await js(`(()=>{const r=listEl.getBoundingClientRect(); return {x:r.left+300,y:r.top+200};})()`);
      const done0 = await js('fpAll - fpLeft');
      const t0 = Date.now();
      while (Date.now() - t0 < 4000) { win.webContents.sendInputEvent({ type: 'mouseWheel', x: b.x, y: b.y, deltaX: 0, deltaY: -240 }); await wait(30); }
      const done1 = await js('fpAll - fpLeft');
      return js(`(()=>{cancelAnimationFrame(__raf); const g=__gaps.slice(5).sort((a,b)=>a-b); const q=p=>+g[Math.floor(g.length*p)].toFixed(1); return {frames:g.length, p50:q(.5), p95:q(.95), p99:q(.99), max:+g[g.length-1].toFixed(1), colored:${done1}-${done0}};})()`);
    };
    try {
      await until('files.length > 250000 && !scanState.size');
      await until('fpBusy && fpLeft > 0', 60000);
      const r = { files: await js('files.length'), fpLeft: await js('fpLeft') };
      await wait(1500);
      // list refreshes per second while colors come in and nobody touches anything
      await js(`window.__n=0; const o=doRender; doRender=function(){__n++; return o.apply(this,arguments);}; 0`);
      const c0 = await js('fpAll - fpLeft'); await wait(5000);
      r.idle = await js(`({rendersPerSec: +(__n/5).toFixed(1), coloredPerSec: ((fpAll - fpLeft) - ${c0})/5})`);
      r.wavesOn = await scrollTest();
      await js(`$('#wavesTog').click()`); await wait(300);
      r.toggle = await js(`({showWaves, colHidden: getComputedStyle(document.querySelector('.cols span[data-k="wave"]')).display, rowWv: document.querySelectorAll('.row .wv').length && getComputedStyle(document.querySelector('.row .wv')).display, cols: getComputedStyle(document.documentElement).getPropertyValue('--cols').trim()})`);
      r.wavesOff = await scrollTest();
      // pause and resume
      await js(`$('#fpstat').click()`); await wait(1500);
      const a = await js('fpLeft'); await wait(2000); const b2 = await js('fpLeft');
      r.paused = { stat: await js(`$('#fpstat').textContent`), progressWhilePaused: a - b2 };
      await js(`$('#fpstat').click()`); await wait(2000);
      r.resumed = { progress: b2 - await js('fpLeft'), stat: await js(`$('#fpstat').textContent`) };
      await js(`$('#wavesTog').click()`); await wait(300);
      r.backOn = await js(`({showWaves, svgs: document.querySelectorAll('.row .wv svg').length})`);
      fs.writeFileSync(path.join(out, 'shot.png'), (await win.webContents.capturePage()).toPNG());
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err && err.stack); }
    app.quit();
  });
});
require('../src/main.js');
