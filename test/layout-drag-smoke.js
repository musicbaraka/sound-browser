// Resizable layout and drag-out-of-waveform test
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 900);
  const drags = [];
  win.webContents.startDrag = item => drags.push(item.file);   // record what would be handed to Windows
  win.webContents.on('console-message', ev => { const m = String(ev.message || ev); if (!/Autofill|Security/.test(m)) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return true; await wait(150); } return false; };
    try {
      await until('files.length > 5 && !scanState.size');
      const r = {};
      // drag the edge of the Name column 120px to the right, then the sidebar, the waveform and the spectrum
      r.before = await js(`({name: colW.name, side: sideW, wave: waveH, spec: specW})`);
      await js(`(()=>{ const h=document.querySelector('#cols span[data-k="name"] .cr').getBoundingClientRect();
        const fire=(t,el,x,y)=>el.dispatchEvent(new MouseEvent(t,{bubbles:true,clientX:x,clientY:y,button:0}));
        fire('mousedown', document.querySelector('#cols span[data-k="name"] .cr'), h.x+4, h.y+5); fire('mousemove', window, h.x+124, h.y+5); fire('mouseup', window, h.x+124, h.y+5);
        const g=$('#sideGrip'); fire('mousedown', g, 250, 300); fire('mousemove', window, 420, 300); fire('mouseup', window, 420, 300);
        const f=$('#footGrip').getBoundingClientRect(); fire('mousedown', $('#footGrip'), 600, f.y+4); fire('mousemove', window, 600, f.y-100); fire('mouseup', window, 600, f.y-100);
        const sg=$('#specGrip').getBoundingClientRect(); fire('mousedown', $('#specGrip'), sg.x+4, sg.y+20); fire('mousemove', window, sg.x-150, sg.y+20); fire('mouseup', window, sg.x-150, sg.y+20);
      })()`);
      await wait(300);
      r.after = await js(`({name: colW.name, side: sideW, wave: waveH, spec: specW, waveCanvasH: $('#wave').clientHeight, sideCss: getComputedStyle(document.documentElement).getPropertyValue('--side-w')})`);
      await js(`autoFit('dir')`); r.folderFitted = await js('colW.dir');
      // select part of a sound, slow it down, and drag the highlighted part out of the waveform
      await js(`select(view.findIndex(r=>r.name==='Forest Morning.flac'), false)`); await until('!!ed.buf');
      await js(`ed.selA=2; ed.selB=4; setSpeed(0.5);`); await until('!!(ed.outBuf && ed.path)');
      r.grab = await js(`(()=>{ const x = tToX(3); const rect=canvas.getBoundingClientRect(); const cx = rect.left + x/(canvas.width/rect.width);
        canvas.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:cx,clientY:rect.top+20}));
        const draggable = canvas.draggable, cursor = canvas.style.cursor;
        canvas.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:cx,clientY:rect.top+20,button:0}));
        canvas.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true}));
        return {draggable, cursor, hint: $('#wavehint').textContent, edit: ed.path}; })()`);
      await wait(300);
      r.handedToWindows = drags;
      await js(`saveSession()`); await wait(1500);
      fs.writeFileSync(path.join(out, 'layout.png'), (await win.webContents.capturePage()).toPNG());
      console.log('RESULT', JSON.stringify(r, null, 1));
      console.log('SAVED', JSON.stringify((({ sideW, waveH, specW, colW }) => ({ sideW, waveH, specW, colW }))(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'library.json'))).session)));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
