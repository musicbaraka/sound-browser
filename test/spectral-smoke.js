// Spectral repair: real mouse box and brush on the spectrogram, heal, remove, undo
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
  win.webContents.on('console-message', (ev) => { const m = ev.message || ev; if (/rror/.test(String(m))) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    let step = ''; const js = s => { step = s.slice(0, 90); return win.webContents.executeJavaScript(s); }; JS = js;
    const key = async (k, mods = []) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods }); win.webContents.sendInputEvent({ type: 'char', keyCode: k, modifiers: mods }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods }); await wait(150); };
    const M = (type, x, y, mods = []) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers: mods });
    // screen point for a time and a frequency on the spectrogram
    const P = (t, f) => js(`(()=>{const r=canvas.getBoundingClientRect(), s=r.width/canvas.width, H=canvas.height, top=specTop(H), h=H-top, fmax=ed.buf.sampleRate/2; const u=1-Math.log(${f}/F_MIN)/Math.log(fmax/F_MIN); return {x:r.left+tToX(${t})*s, y:r.top+(top+u*h)*s};})()`);
    // energy of the cough region relative to the same spot in the clean part
    const coughDb = `(()=>{const d=ed.buf.getChannelData(0), sr=ed.buf.sampleRate; let e=0,q=0; for(let i=2.0*sr;i<2.15*sr;i++)e+=d[i]*d[i]; for(let i=1.0*sr;i<1.15*sr;i++)q+=d[i]*d[i]; return +(10*Math.log10(e/q)).toFixed(1);})()`;
    try {
      await until('files.length >= 2 && !scanState.size');
      const r = {};
      await js(`$('#autoplay').checked=false; select(view.findIndex(r=>r.name==='Note With Cough.wav'), false)`); await until('!!ed.buf');
      await js(`setViewMode('spec')`); await wait(300);
      r.toolbar = await js(`$('#spectools').style.display !== 'none'`);
      r.before = await js(coughDb);
      await key('B');
      r.tool = await js(`ed.tool`);
      const a = await P(1.98, 60), b = await P(2.17, 20000);
      M('mouseMove', a.x, a.y); M('mouseDown', a.x, a.y);
      for (let k = 1; k <= 8; k++) { M('mouseMove', a.x + (b.x - a.x) * k / 8, a.y + (b.y - a.y) * k / 8); await wait(20); }
      M('mouseUp', b.x, b.y); await wait(200);
      r.sel = await js(`(()=>{const b=specBounds(); return b && {t0:+b.t0.toFixed(2), t1:+b.t1.toFixed(2), f0:Math.round(b.f0), f1:Math.round(b.f1), hint:$('#wavehint').textContent}})()`);
      fs.writeFileSync(path.join(out, 'sel.png'), (await win.webContents.capturePage()).toPNG());
      await key('H');
      await until('ed.specOps.length === 1 && !!ed.outBuf && !!ed.path', 20000); await wait(400);
      r.healed = await js(`({db: ${coughDb}, name: ed.name, status: $('#status').textContent, playing: !!eSrc, undoOn: !$('#specUndo').disabled, origKept: ed.orig !== ed.buf})`);
      await js(`stopAll()`);
      fs.writeFileSync(path.join(out, 'healed.png'), (await win.webContents.capturePage()).toPNG());
      // the written file holds the repair
      r.file = await js(`(()=>{const d=ed.out[0], sr=ed.outBuf.sampleRate; let e=0,q=0; for(let i=2.0*sr;i<2.15*sr;i++)e+=d[i]*d[i]; for(let i=1.0*sr;i<1.15*sr;i++)q+=d[i]*d[i]; return {db:+(10*Math.log10(e/q)).toFixed(1)};})()`).catch(()=>null); r.fileOnDisk = fs.existsSync(await js('ed.path'));
      await key('Z', ['control']); await wait(600);
      r.undo = await js(`({db: ${coughDb}, ops: ed.specOps.length, isOrig: ed.buf === ed.orig, edited: isEdited()})`);
      // brush: paint over the cough's high part, then Delete removes it
      await key('P');
      const c = await P(2.03, 6000), d = await P(2.12, 6000);
      M('mouseMove', c.x, c.y); M('mouseDown', c.x, c.y);
      for (let k = 1; k <= 6; k++) { M('mouseMove', c.x + (d.x - c.x) * k / 6, c.y); await wait(20); }
      M('mouseUp', d.x, d.y); await wait(200);
      r.brush = await js(`({tool: ed.tool, shapes: ed.specSel.length, pts: ed.specSel[0] && ed.specSel[0].pts.length})`);
      await key('Delete');
      await until('ed.specOps.length === 1', 20000); await wait(300);
      r.brushRemoved = await js(`(()=>{const a=ed.orig.getChannelData(0), b=ed.buf.getChannelData(0), sr=48000; let ea=0, eb=0; for(let i=2.0*sr;i<2.15*sr;i++){ea+=a[i]*a[i]; eb+=b[i]*b[i];} let diffOut=0; for(let i=0;i<1.8*sr;i++) diffOut=Math.max(diffOut, Math.abs(a[i]-b[i])); return {dropDb:+(10*Math.log10(eb/ea)).toFixed(1), changedOutside: diffOut}; })()`);
      // Reset brings back the original
      await js(`$('#resetEdit').click()`); await wait(500);
      r.reset = await js(`({isOrig: ed.buf === ed.orig, ops: ed.specOps.length})`);
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR at', step, err && err.message); }
    app.quit();
  });
});
require('../src/main.js');
