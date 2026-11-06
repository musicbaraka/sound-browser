const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: { autoplay: false } }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 860);
  win.webContents.on('console-message', ev => { const m = String(ev.message || ev); if (/Uncaught|Error/.test(m)) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    const until = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return true; await wait(100); } return false; };
    try {
      await until('files.length > 5 && !scanState.size');
      await js(`select(view.findIndex(r=>r.name==='Snare Crack.wav'), false)`); await until('!!ed.buf');
      await js(`ed.selA=0; ed.selB=0.3; changed(false)`); await until('!!(ed.outBuf && ed.path)');
      const stats = `(()=>{ const b=ed.outBuf, d=b.getChannelData(0), n=d.length; let pk=0, nan=0; for (const v of d) { if (v!==v) nan++; pk=Math.max(pk,Math.abs(v)); }
        const N=4096, pw=new Float32Array(N/2), fr=new Float32Array(N); let acc=new Float64Array(N/2), F=0;
        for (let s=0; s+N<=n; s+=N) { for (let i=0;i<N;i++) fr[i]=d[s+i]; powerSpectrum(fr,N,pw); for (let i=0;i<N/2;i++) acc[i]+=pw[i]; F++; }
        let num=0, den=0; for (let i=1;i<N/2;i++){ const f=i*b.sampleRate/N; num+=f*acc[i]; den+=acc[i]; }
        let last=0; const thr=pk*0.001; for (let i=n-1;i>=0;i--) if (Math.abs(d[i])>thr) { last=i; break; }
        return { len: +b.duration.toFixed(2), ch: b.numberOfChannels, peakDb: +(20*Math.log10(pk)).toFixed(1), brightnessHz: Math.round(num/den), audibleUntil: +(last/b.sampleRate).toFixed(2), nan, name: ed.name }; })()`;
      const res = { original: await js(stats) };
      const keys = await js('Object.keys(PLACES)');
      for (const k of keys) {
        await js(`window.__want = PLACES[${JSON.stringify(k)}].label.replace(/\\s*\\(.*\\)/, '').toLowerCase(); ed.place = ${JSON.stringify(k)}; changed(false)`);
        await until(`!!(ed.outBuf && ed.path && ed.name.includes(window.__want))`);
        res[k] = await js(stats);
      }
      await js(`ed.place='church'; ed.placeAmt=0.4; changed(false)`); await until(`!!(ed.outBuf && ed.path && ed.name.includes('40%'))`);
      res['church 40%'] = await js(stats);
      fs.writeFileSync(path.join(out, 'place.png'), (await win.webContents.capturePage()).toPNG());
      for (const [k, v] of Object.entries(res)) console.log(k.padEnd(14), JSON.stringify(v));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
