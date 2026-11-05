// Headless test: analysis, spelling-tolerant search, tags, filters, About page
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
if (!fs.existsSync(path.join(app.getPath('userData'), 'library.json'))) fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: { keyTempo: true } }));
const wait = ms => new Promise(r => setTimeout(r, ms));
let JS = null;
const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await JS(expr)) return true; await wait(150); } return false; };
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 900);
  win.webContents.on('console-message', (ev) => { const m = ev.message || ev; if (!/Autofill|Electron Security/.test(String(m))) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    const search = async q => { await js(`$('#search').value=${JSON.stringify(q)}; exactSearch=false; applyFilter();`); return js(`({n:view.length, names:view.map(r=>r.name).slice(0,4), banner:$('#didyou').classList.contains('show')?$('#didyou').textContent:''})`); };
    try {
      await until('files.length > 5 && !scanState.size');
      await wait(1500);
      for (let i = 0; i < 60 && await js('anBusy'); i++) await wait(500);
      const r = {};
      r.rows = await js(`files.slice().sort((a,b)=>a.name.localeCompare(b.name)).filter(r=>r.key||r.bpm).map(r=>r.name+' | key '+(r.key||'-')+(r.keyGuess?' (detected)':'')+' | bpm '+(r.bpm||'-')+(r.bpmGuess?' (detected)':''))`);
      for (const q of ['snair', 'forrest morning', 'wosh', 'C minor', '128bpm', 'kick']) r['search: ' + q] = await search(q);
      await search('');
      await js(`setTags([view.find(r=>r.name==='Dark Pad.wav').path], ['Healing Quest','dark'])`);
      await js(`setTags(view.filter(r=>r.dir.startsWith('Drums')).map(r=>r.path), ['percussion'])`);
      r['search: healng'] = await search('healng');
      await search('');
      r.tagFilter = await js(`(()=>{ tagFilter='percussion'; applyFilter(); return view.map(r=>r.name); })()`);
      await js(`tagFilter=''; keyFilter='G maj'; applyFilter();`);
      r.keyFilter = await js(`view.map(r=>r.name)`);
      await js(`keyFilter=''; $('#bpmMin').value=100; $('#bpmMax').value=130; applyFilter();`);
      r.bpmFilter = await js(`view.map(r=>r.name+' '+r.bpm)`);
      await js(`$('#bpmMin').value=''; $('#bpmMax').value=''; sortKey='key'; applyFilter(); select(view.findIndex(r=>r.name==='Dark Pad.wav'), false); $('#search').value='forrest'; applyFilter(); $('#search').value=''; applyFilter(); $('#search').value='ambiance'; applyFilter();`);
      await wait(800);
      fs.writeFileSync(path.join(out, 'library.png'), (await win.webContents.capturePage()).toPNG());
      await js(`$('#search').value=''; applyFilter(); showTab('about')`); await wait(400);
      fs.writeFileSync(path.join(out, 'about.png'), (await win.webContents.capturePage()).toPNG());
      console.log('RESULT', JSON.stringify(r, null, 1));
      const lj = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'library.json')));
      await wait(2500);
      const log = fs.readFileSync(path.join(app.getPath('userData'), 'index-log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
      console.log('SAVED tags:', Object.keys(lj.tags).length, 'files tagged; analysis saved for', new Set(log.filter(([, e]) => e.an).map(([p]) => p)).size, 'files');
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
