// Folder tree: clicking the arrow (its drawing) opens and closes; clicking the selected folder's name toggles it
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
    const click = async (sel, part) => { const p = await js(`(()=>{const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2};})()`);
      if (!p) return 'missing'; win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 }); await wait(250); return 'ok'; };
    try {
      await until('files.length >= 5 && !scanState.size');
      const root = await js(`[...document.querySelectorAll('#side .dir[data-d]')].find(d=>d.querySelector('.tw[data-tw]:not([data-tw=""])')).dataset.d`);
      const sel = k => `#side .dir[data-d="${k}"]`;
      const isOpen = k => js(`expanded.has(${JSON.stringify(k)})`);
      const r = { root, start: await isOpen(root) };
      await click(sel(root) + ' .tw svg'); r.afterArrow1 = await isOpen(root);
      await click(sel(root) + ' .tw svg'); r.afterArrow2 = await isOpen(root);
      await click(sel(root) + ' .n'); r.selected = await js('dirFilter'); r.afterName1 = await isOpen(root);
      r.dbg = await js(`(()=>{const el=document.querySelector('#side .dir[data-d="/tmp/lib|"]'); return {d: el.dataset.d, df: dirFilter, kids: !!el.querySelector('.tw[data-tw]:not([data-tw=""])')};})()`);
      await click(sel(root) + ' .n'); r.afterName2 = await isOpen(root);
      await click(sel(root) + ' .n'); r.afterName3 = await isOpen(root);
      // inside a deep folder, its parents can be closed and stay closed
      const deep = await js(`[...document.querySelectorAll('#side .dir[data-d]')].map(d=>d.dataset.d).filter(k=>(k.split('|')[1]||'').length>0)[0] || null`);
      r.deep = deep;
      if (deep) {
        await click(sel(root) + ' .tw svg'); if (!(await isOpen(root))) await click(sel(root) + ' .tw svg');
        await click(`#side .dir[data-d="${deep}"] .n`); r.inDeep = await js('dirFilter');
        await click(sel(root) + ' .tw svg'); r.parentClosed = !(await isOpen(root));
        await wait(1500); r.stillClosed = !(await isOpen(root));
        await click(sel(root) + ' .tw svg'); r.reopened = await isOpen(root);
      }
      console.log('RESULT', JSON.stringify(r));
    } catch (err) { console.log('TEST ERROR', err && err.stack); }
    app.quit();
  });
});
require('../src/main.js');
