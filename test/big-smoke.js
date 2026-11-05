// Large-library test: electron test/big-smoke.js <phase: first|second> <libraryFolder> <outDir>
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [phase, lib, out] = process.argv.slice(-3);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
if (phase === 'first') fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now(), T = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 900);
  win.webContents.on('console-message', (ev) => { const m = String(ev.message || ev); if (!/Autofill|Security/.test(m)) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    try {
      if (phase === 'first') {
        await wait(500);
        let firstRows = null;
        for (let i = 0; i < 600; i++) {
          const st = await js(`({n: files.length, rows: document.querySelectorAll('.row').length, scanning: scanState.size, side: document.querySelectorAll('#side .dir').length, stat: $('#scanstat').textContent})`);
          if (st.rows && !firstRows) { firstRows = T(); console.log('first rows visible at', firstRows, JSON.stringify(st)); }
          if (i % 10 === 0) console.log(T(), JSON.stringify(st));
          if (firstRows && !st.scanning) { console.log('scan complete at', T(), JSON.stringify(st)); break; }
          await wait(500);
        }
        fs.writeFileSync(path.join(out, 'big1.png'), (await win.webContents.capturePage()).toPNG());
        // incremental changes
        const d = path.join(lib, 'SFX Library', 'Impacts', 'Impacts Pack 01');
        fs.copyFileSync(path.join(d, fs.readdirSync(d)[0]), path.join(d, 'Brand New Hit.wav'));
        fs.rmSync(path.join(d, fs.readdirSync(d).find(n => n !== 'Brand New Hit.wav')));
        fs.mkdirSync(path.join(lib, 'SFX Library', 'New Pack'));
        for (let i = 0; i < 25; i++) fs.copyFileSync(path.join(d, 'Brand New Hit.wav'), path.join(lib, 'SFX Library', 'New Pack', `Fresh ${i}.wav`));
        await wait(4000);
        console.log('after changes', T(), JSON.stringify(await js(`({n: files.length, newHit: files.some(r=>r.name==='Brand New Hit.wav'), fresh: files.filter(r=>r.name.startsWith('Fresh ')).length, scanning: scanState.size})`)));
        const perf = await js(`(()=>{ const t=performance.now(); $('#search').value='impacts heavy'; applyFilter(); const a=performance.now()-t; const t2=performance.now(); $('#search').value='impakts hevy'; applyFilter(); const b=performance.now()-t2; const banner=$('#didyou').textContent; const n=view.length; const t3=performance.now(); $('#search').value=''; sortKey='size'; applyFilter(); const c=performance.now()-t3; sortKey='name'; applyFilter(); return {searchMs:a|0, typoMs:b|0, typoResults:n, banner, sortBySizeMs:c|0}; })()`);
        console.log('perf', JSON.stringify(perf));
        await js(`dirFilter=folders[0]+'|SFX Library/Impacts/'; buildSide(false); applyFilter();`);
        await wait(500);
        fs.writeFileSync(path.join(out, 'big2.png'), (await win.webContents.capturePage()).toPNG());
        console.log('analysis', JSON.stringify(await js(`({busy: anBusy, done: anDone, left: anLeft, stat: $('#anstat').textContent})`)));
      } else {
        for (let i = 0; i < 200; i++) {
          const st = await js(`({n: files.length, rows: document.querySelectorAll('.row').length, scanning: scanState.size, stat: $('#scanstat').textContent})`);
          if (st.rows) { console.log('relaunch: rows visible at', T(), JSON.stringify(st)); break; }
          await wait(100);
        }
        for (let i = 0; i < 400; i++) { if (!(await js('scanState.size'))) break; await wait(200); }
        await wait(800);
        console.log('relaunch: background check done at', T(), JSON.stringify(await js(`({n: files.length, scanning: scanState.size, addedWhileClosed: files.filter(r=>r.name.startsWith('Added While Closed')).length, deletedStillListed: files.some(r=>r.name==='Impacts Heavy 005.wav' && r.dir.includes('Pack 02/'))})`)));
      }
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
