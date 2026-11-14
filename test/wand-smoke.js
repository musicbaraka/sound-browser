// Wand: real clicks on the spectrogram (a whistle, a cough), heal, and frequency zoom with Ctrl+wheel
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
  win.webContents.on('console-message', (ev) => { const m = ev.message || ev; if (/rror/.test(String(m))) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    const key = async (k, mods = []) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods }); win.webContents.sendInputEvent({ type: 'char', keyCode: k, modifiers: mods }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods }); await wait(150); };
    const click = (x, y) => { win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }); };
    const P = (t, f) => js(`(()=>{const r=canvas.getBoundingClientRect(), s=r.width/canvas.width, H=canvas.height, top=specTop(H), h=H-top, fmax=ed.buf.sampleRate/2; const u=1-Math.log(${f}/F_MIN)/Math.log(fmax/F_MIN); return {x:r.left+tToX(${t})*s, y:r.top+(top+(u-fz.a)/(fz.b-fz.a)*h)*s};})()`);
    const toneLvl = f => `(()=>{const d=ed.buf.getChannelData(0), sr=ed.buf.sampleRate; let re=0, im=0; for (let i=1.0*sr;i<2.4*sr;i++){const t=i/sr, ph=2*Math.PI*${f}*t*(1+0.002*Math.sin(t*6)); re+=d[i]*Math.cos(ph); im+=d[i]*Math.sin(ph);} return +(20*Math.log10(Math.hypot(re,im)/(0.7*sr)+1e-12)).toFixed(1);})()`;
    try {
      await until('files.length >= 3 && !scanState.size');
      const r = {};
      await js(`$('#autoplay').checked=false; select(view.findIndex(r=>r.name==='Whistle Over Noise.wav'), false)`); await until('!!ed.buf');
      await js(`setViewMode('spec')`); await wait(300);
      r.before = [await js(toneLvl(1200)), await js(toneLvl(2400))];
      await key('W');
      r.tool = await js(`({tool: ed.tool, opts: $('#wandOpts').style.display})`);
      let p = await P(1.5, 1200); click(p.x, p.y);
      await until('ed.specSel.length > 0', 8000);
      r.wand = await js(`({shapes: ed.specSel.length, cells: ed.specSel[0].r.length, status: $('#status').textContent})`);
      fs.writeFileSync(path.join(out, 'wand.png'), (await win.webContents.capturePage()).toPNG());
      await key('H'); await until('ed.specOps.length === 1', 20000); await wait(300);
      r.after = [await js(toneLvl(1200)), await js(toneLvl(2400))];
      // the cough
      await js(`select(view.findIndex(r=>r.name==='Note With Cough.wav'), false)`); await until(`current.name==='Note With Cough.wav' && !!ed.buf`); await wait(300);
      const cough = `(()=>{const d=ed.buf.getChannelData(0), sr=ed.buf.sampleRate; let e=0,q=0; for(let i=2.0*sr;i<2.15*sr;i++)e+=d[i]*d[i]; for(let i=1.0*sr;i<1.15*sr;i++)q+=d[i]*d[i]; return +(10*Math.log10(e/q)).toFixed(1);})()`;
      r.coughBefore = await js(cough);
      p = await P(2.07, 3000); click(p.x, p.y); await until('ed.specSel.length > 0', 8000);
      r.coughStatus = await js(`$('#status').textContent`);
      await key('H'); await until('ed.specOps.length === 1', 20000); await wait(300);
      r.coughAfter = await js(cough);
      // frequency zoom with Ctrl+wheel over the spectrogram
      p = await P(2, 1000);
      await js(`canvas.dispatchEvent(new WheelEvent('wheel', {clientX: ${p.x}, clientY: ${p.y}, deltaY: -600, ctrlKey: true, bubbles: true, cancelable: true}))`); await wait(500);
      r.fzoom = await js(`({a: +fz.a.toFixed(3), b: +fz.b.toFixed(3), atMouse: Math.round(yToFreq((${p.y} - canvas.getBoundingClientRect().top) * canvas.height / canvas.getBoundingClientRect().height - specTop(canvas.height), canvas.height - specTop(canvas.height), ed.buf.sampleRate))})`);
      fs.writeFileSync(path.join(out, 'zoom.png'), (await win.webContents.capturePage()).toPNG());
      // the box tool follows the zoom: a box drawn now covers the frequencies on screen
      await key('B'); const a = await P(1.0, 800), b = await P(1.3, 1250);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(a.x), y: Math.round(a.y), button: 'left', clickCount: 1 });
      for (let k = 1; k <= 5; k++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(a.x + (b.x - a.x) * k / 5), y: Math.round(a.y + (b.y - a.y) * k / 5) }); await wait(20); }
      win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(b.x), y: Math.round(b.y), button: 'left', clickCount: 1 }); await wait(200);
      r.boxInZoom = await js(`(()=>{const b=specBounds(); return {f0: Math.round(b.f0), f1: Math.round(b.f1)};})()`);
      await js(`canvas.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))`); await wait(200);
      r.reset = await js(`[fz.a, fz.b]`);
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err && err.message); }
    app.quit();
  });
});
require('../src/main.js');
