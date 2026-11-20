const { app } = require('electron'); const fs=require('fs'), path=require('path');
const [lib,out]=process.argv.slice(-2); app.setPath('userData', path.join(out,'ud')); fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.writeFileSync(path.join(app.getPath('userData'),'library.json'), JSON.stringify({folders:[lib],favorites:[],session:{}}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(e,win)=>{ win.setSize(1440,900); win.webContents.on('console-message',(ev)=>{const m=String(ev.message||ev); if(/rror|warn/i.test(m)) console.log('[r]',m.slice(0,240));});
 win.webContents.on('did-finish-load', async()=>{ const js=s=>win.webContents.executeJavaScript(s);
 try { for(let i=0;i<100 && !(await js('files.length>=1 && !scanState.size'));i++) await wait(200);
 await js(`select(view.findIndex(r=>/\\.mid$/i.test(r.name)), false)`); await wait(800);
 const r = {};
 const stats = `(()=>{const ab=conv.ab; const L=ab.getChannelData(0); let pk=0,e=0; for(let i=0;i<L.length;i++){const v=Math.abs(L[i]); if(v>pk)pk=v; e+=v*v;}
   // energy in the second just after the last note, where only echoes can be
   const t=Math.floor((midiDoc.dur/midiRate+0.15)*ab.sampleRate), w=Math.floor(0.6*ab.sampleRate); let tail=0; for(let i=t;i<Math.min(L.length,t+w);i++) tail+=L[i]*L[i];
   return {dur:+ab.duration.toFixed(2), song:+(midiDoc.dur/midiRate).toFixed(2), sr:ab.sampleRate, peak:+pk.toFixed(3), rms:+Math.sqrt(e/L.length).toFixed(4), tail:+Math.sqrt(tail/w).toFixed(5), name: convName()}})()`;
 const go = async () => { await js(`conv.r=null; openConvert(current); 0`); const t0=Date.now(); for(let i=0;i<300 && !(await js('!!conv.ab'));i++) await wait(100); const s=await js(stats); s.ms=Date.now()-t0; await js(`closeConv(); 0`); return s; };
 r.dry = await go();
 await js(`setDelay({mix: 60, fb: 50, sync: '1/8d'}); 0`);
 r.delay = await go();
 r.ui = await js(`({ms: $('#mpDlyMs').value, sync: $('#mpDlySync').value, mix: $('#mpDlyN').value})`);
 await js(`setTranspose(5); setMidiRate(0.5); 0`);
 r.slow = await go();
 // save one as MP3 through the normal Convert flow
 await js(`conv.r=null; openConvert(current); 0`); for(let i=0;i<300 && !(await js('!!conv.ab'));i++) await wait(100);
 await js(`conv.fmt='mp3'; convRender(); $('#conv-go').click(); 0`);
 for(let i=0;i<200 && !(await js('!!conv.saved'));i++) await wait(100);
 r.saved = await js(`conv.saved`);
 await win.webContents.capturePage().then(img=>fs.writeFileSync(path.join(out,'render.png'), img.toPNG()));
 console.log('RESULT', JSON.stringify(r)); } catch(e){ console.log('ERR', e.message); }
 app.quit(); }); });
require('../src/main.js');
