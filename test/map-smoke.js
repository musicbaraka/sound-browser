// Sound map: placement, labels, hover, click to open, box pick, tag, show in list, follows filters
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
let JS = null;
const until = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await JS(expr)) return true; await wait(150); } return false; };
app.on('browser-window-created', (e, win) => {
  win.setSize(1440, 900);
  win.webContents.on('console-message', (ev) => { const m = ev.message || ev; if (/rror/.test(String(m))) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    const M = (type, x, y, mods = []) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers: mods });
    const scr = i => js(`(()=>{ const r=mcv.getBoundingClientRect(), k=r.width/mcv.width; return {x: r.left + MAP.sx[${i}]*k, y: r.top + MAP.sy[${i}]*k}; })()`);
    try {
      await until('files.length >= 14 && !scanState.size');
      await until('files.every(f => f.meta && f.meta.fp && f.meta.fp.v === SC_V)', 60000);
      const r = {};
      await js(`$('#autoplay').checked=false`);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'M' }); win.webContents.sendInputEvent({ type: 'char', keyCode: 'm' }); await wait(600);
      r.open = await js(`({mapMode, shown: getComputedStyle($('#mapwrap')).display, placed: MAP.placed, status: $('#mapstat').textContent.slice(0, 60)})`);
      r.positions = await js(`MAP.pts.map((p,i)=>[p.name.replace('.wav',''), +MAP.x[i].toFixed(2), +MAP.y[i].toFixed(2)]).sort((a,b)=>a[1]-b[1]).map(a=>a.join(' '))`);
      // hover a dot: the side panel follows
      const kick = await js(`MAP.pts.findIndex(p=>p.name==='Kick Deep 01.wav')`), p = await scr(kick);
      M('mouseMove', p.x, p.y); await wait(300);
      r.hover = await js(`({hover: MAP.hover === ${kick}, side: $('#mapside .mname') && $('#mapside .mname').textContent, near: [...document.querySelectorAll('#mapside .mlist li span')].map(s=>s.textContent).slice(0,3)})`);
      fs.writeFileSync(path.join(out, 'map.png'), (await win.webContents.capturePage()).toPNG());
      // click: opens it in the editor
      M('mouseDown', p.x, p.y); M('mouseUp', p.x, p.y); await until(`current && current.name==='Kick Deep 01.wav' && !!ed.buf`); 
      r.click = await js(`current.name`);
      // Shift+drag a box over the bright right side
      const box = await js(`(()=>{ const r=mcv.getBoundingClientRect(); return {x0: r.left + r.width*0.62, y0: r.top + 10, x1: r.right - 10, y1: r.bottom - 10}; })()`);
      M('mouseDown', box.x0, box.y0, ['shift']); for (let k = 1; k <= 5; k++) { M('mouseMove', box.x0 + (box.x1 - box.x0) * k / 5, box.y0 + (box.y1 - box.y0) * k / 5, ['shift']); await wait(30); } M('mouseUp', box.x1, box.y1, ['shift']); await wait(300);
      r.picked = await js(`MAP.picked ? MAP.picked.map(i => MAP.pts[i].name.replace('.wav','')) : null`);
      fs.writeFileSync(path.join(out, 'map-picked.png'), (await win.webContents.capturePage()).toPNG());
      await js(`$('#mpTag').value='bright'; $('#mpTagGo').click()`); await wait(300);
      r.tagged = await js(`files.filter(f => f.tags.includes('bright')).length`);
      await js(`$('#mpShow').click()`); await wait(400);
      r.showList = await js(`({mapMode, view: view.length, chip: $('#pfChip').textContent})`);
      await js(`$('#pfChip').click()`); await wait(300); r.cleared = await js(`view.length`);
      // map follows the folder filter
      await js(`setMapMode(true); dirFilter = folders[0] + '|Drums/'; buildSide(false); applyFilter();`); await wait(500);
      r.drumsOnly = await js(`MAP.placed`);
      // zoom with the wheel
      await js(`dirFilter=''; applyFilter()`); await wait(400);
      const c = await js(`(()=>{ const r=mcv.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`);
      await js(`mcv.dispatchEvent(new WheelEvent('wheel', { clientX: ${c.x}, clientY: ${c.y}, deltaY: -400, bubbles: true, cancelable: true }))`); await wait(500);
      r.zoomRepaint = await js(`!!MAP.imgView && MAP.imgView.zoom === MAP.zoom`);
      r.zoom = await js(`+MAP.zoom.toFixed(2)`);
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err && err.message); }
    app.quit();
  });
});
require('../src/main.js');
