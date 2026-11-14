// Auto Fix on a set of problem sounds: what it finds, what it changes, and the result measured
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
let JS = null;
const until = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await JS(expr)) return true; await wait(100); } return false; };
app.on('browser-window-created', (e, win) => {
  win.setSize(1440, 900);
  win.webContents.on('console-message', (ev) => { const m = ev.message || ev; if (/rror/.test(String(m))) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    const key = async (k) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); win.webContents.sendInputEvent({ type: 'char', keyCode: k }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(150); };
    // level of a pure frequency in a set of channels (dB)
    const tone = (src, f) => `(()=>{const d=${src}[0], sr=ed.buf.sampleRate; let re=0,im=0; const n=Math.min(d.length, 4*sr); for(let i=0;i<n;i++){const ph=2*Math.PI*${f}*i/sr; re+=d[i]*Math.cos(ph); im+=d[i]*Math.sin(ph);} return +(20*Math.log10(Math.hypot(re,im)/(n/2)+1e-12)).toFixed(1);})()`;
    const orig = `[...Array(ed.orig ? ed.orig.numberOfChannels : ed.buf.numberOfChannels).keys()].map(c => (ed.orig || ed.buf).getChannelData(c))`;
    try {
      await until('files.length >= 7 && !scanState.size');
      await js(`$('#autoplay').checked=false`);
      const r = {};
      for (const name of ['Voice Noisy.wav', 'Clicky Pad.wav', 'Harsh Room.wav', 'Quiet Ambience.wav', 'Short Hit.wav', 'House Drums.wav', 'Note With Cough.wav']) {
        await js(`select(view.findIndex(r=>r.name===${JSON.stringify(name)}), false)`);
        await until(`current.name===${JSON.stringify(name)} && !!ed.buf`); await wait(200);
        const t0 = Date.now();
        await key('A'); await wait(300);
        await until('!ed.afBusy', 60000); await wait(300);
        const o = await js(`({status: $('#status').textContent, ms: ${Date.now() - t0}, name: ed.out ? ed.name : null,
          lufsIn: +integratedLoudness(${orig}, ed.buf.sampleRate).toFixed(1), lufsOut: ed.out ? +integratedLoudness(ed.out, ed.buf.sampleRate).toFixed(1) : null,
          peakOut: ed.out ? +(20*Math.log10(ed.outPeak)).toFixed(2) : null, clean: ed.clean, nr: ed.nr, eq: ed.eqOn && ed.eqMode, maxDb: ed.maxDb, gain: ed.gain, sel: hasSel() ? [+ed.selA.toFixed(3), +ed.selB.toFixed(3)] : null })`);
        o.ms = Date.now() - t0;
        if (name === 'Voice Noisy.wav') { o.hum60 = [await js(tone(orig, 60)), await js(tone('ed.out', 60))]; }
        if (name === 'Clicky Pad.wav') o.clickPeak = await js(`(()=>{const sr=ed.buf.sampleRate, a=${orig}[0], b=ed.out[0], g=Math.pow(10,(ed.maxDb||ed.gain)/20); const at=Math.round(0.6*sr); let pa=0,pb=0; for(let i=at-50;i<at+50;i++){pa=Math.max(pa,Math.abs(a[i]-2*a[i-1]+a[i-2])); pb=Math.max(pb,Math.abs(b[i]-2*b[i-1]+b[i-2])/g);} return [+pa.toFixed(4), +pb.toFixed(4)];})()`);
        r[name] = o;
        if (name === 'Voice Noisy.wav') fs.writeFileSync(path.join(out, 'voice.png'), (await win.webContents.capturePage()).toPNG());
      }
      // compare: O switches to the original and back to the edit
      await js(`select(view.findIndex(r=>r.name==='Voice Noisy.wav'), false)`); await until(`current.name==='Voice Noisy.wav' && !!ed.buf`); await wait(200);
      await key('A'); await wait(300); await until('!ed.afBusy', 60000); await wait(1200);
      const ab = [await js(`({edit: !!eSrc, orig: !player.paused})`)];
      await key('O'); await wait(400); ab.push(await js(`({edit: !!eSrc, orig: !player.paused, t: +player.currentTime.toFixed(2), status: $('#status').textContent})`));
      await key('O'); await wait(400); ab.push(await js(`({edit: !!eSrc, orig: !player.paused, status: $('#status').textContent})`));
      r.ab = ab;
      await key('A'); await wait(300); await until('!ed.afBusy', 60000);
      r.again = await js(`({specOps: ed.specOps.length, clean: ed.clean})`);
      await js(`$('#resetEdit').click()`); await wait(400);
      r.reset = await js(`({af: ed.af, clean: ed.clean, edited: isEdited()})`);
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err && err.stack); }
    app.quit();
  });
});
require('../src/main.js');
