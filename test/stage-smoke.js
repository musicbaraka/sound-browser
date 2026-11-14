// Stage look: sound colors fill in, sort by color, colored big waveform, spectrum line, settings switch
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
    try {
      await until('files.length >= 14 && !scanState.size');
      const r = {};
      const t0 = Date.now();
      await until('files.every(f => f.meta && f.meta.fp)', 60000);
      r.fingerprintMs = Date.now() - t0;
      r.colors = await js(`files.map(f => [f.name, f.meta.fp.t, f.meta.fp.n]).sort((a,b)=>a[1]-b[1]).map(x => x[0].replace('.wav','') + ' ' + x[1].toFixed(2) + (x[2] > 0.6 ? ' noisy' : ''))`);
      await js(`$('#cols span[data-k=wave]').click()`); await wait(300);
      r.sortedByColor = await js(`view.slice(0,4).map(v=>v.name).concat(['…'], view.slice(-3).map(v=>v.name))`);
      r.rowsWithWave = await js(`document.querySelectorAll('#spacer .row .wv svg path').length`);
      r.fonts = await js(`(async()=>{ await document.fonts.ready; return ['Inter','JetBrains Mono','Unbounded'].map(f => f + ': ' + document.fonts.check('12px "' + f + '"')); })()`);
      await js(`$('#autoplay').checked=false; select(view.findIndex(r=>r.name==='Pad Glass G min.wav'), false)`); await until('!!ed.buf');
      await wait(400);
      r.track = await js(`(()=>{ const t=colorTrack(ed.buf); return {cols:t.cols, first:t.c[0], mid:t.c[300]}; })()`);
      await js(`playFrom(1.5)`); await wait(1200);
      r.horizonLive = await js(`hzLevel`);
      fs.writeFileSync(path.join(out, 'stage.png'), (await win.webContents.capturePage()).toPNG());
      await js(`stopAll()`); await wait(800);
      r.horizonAfterStop = await js(`hzLevel`);
      await js(`setViewMode('both')`); await wait(500);
      fs.writeFileSync(path.join(out, 'stage-both.png'), (await win.webContents.capturePage()).toPNG());
      await js(`setViewMode('wave')`);
      // switching colors off
      await js(`$('#scToggle').click()`); await wait(300);
      r.off = await js(`({bodyClass: document.body.classList.contains('nosc'), wave: waveColor(1)})`);
      await js(`$('#scToggle').click()`); await wait(300);
      await js(`$('#hzBtn').click()`); await wait(300);
      r.lineOff = await js(`({hidden: getComputedStyle($('#horizon')).display === 'none', btn: $('#hzBtn').classList.contains('on'), setting: $('#hzToggle').checked})`);
      await js(`$('#hzBtn').click()`); await wait(300);
      r.lineBack = await js(`({shown: getComputedStyle($('#horizon')).display !== 'none', atBottom: Math.round($('#horizon').getBoundingClientRect().bottom) === innerHeight})`);
      r.pageTop = await js(`getComputedStyle(document.documentElement).getPropertyValue('--page-top')`);
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err && err.message); }
    app.quit();
  });
});
require('../src/main.js');
