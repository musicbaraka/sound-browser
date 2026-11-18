const { app } = require('electron'); const fs=require('fs'), path=require('path');
const [lib,out]=process.argv.slice(-2); app.setPath('userData', path.join(out,'ud')); fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.writeFileSync(path.join(app.getPath('userData'),'library.json'), JSON.stringify({folders:[lib],favorites:[],session:{}}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(e,win)=>{ win.webContents.on('did-finish-load', async()=>{ const js=s=>win.webContents.executeJavaScript(s);
 try { for(let i=0;i<100 && !(await js('files.length>=4 && !scanState.size'));i++) await wait(200);
 const res={};
 for (const rev of [100, 0, 50]) {
  await js(`select(view.findIndex(r=>r.name==='Stab.mid'), false)`); await wait(300);
  await js(`midiRev=${rev}; applyMidiFx(); 0`);
  await js(`window.__rec=[]; window.__sp=actx.createScriptProcessor(4096,2,2); __sp.onaudioprocess=e=>{ if(__rec.length<40) __rec.push(new Float32Array(e.inputBuffer.getChannelData(0))); }; bus.connect(__sp); __sp.connect(actx.destination); midiPlayer.play(); 0`);
  for(let i=0;i<50 && (await js('player.paused'));i++) await wait(100);
  await js(`window.__rec=[]; 0`);
  await wait(3000);
  res['rev'+rev+'_'+Object.keys(res).length] = await js(`(()=>{ bus.disconnect(__sp); __sp.disconnect(); const sr=actx.sampleRate; const x=new Float32Array(__rec.length*4096); __rec.forEach((b,i)=>x.set(b,i*4096));
     const seg=(a,b)=>{let e=0;for(let i=Math.round(a*sr);i<Math.min(x.length,Math.round(b*sr));i++)e+=x[i]*x[i]; return +(10*Math.log10(e/Math.max(1,(b-a)*sr)+1e-20)).toFixed(1);};
     return {early: seg(0,0.3), tail1: seg(0.6,1.0), tail2: seg(1.0,1.6), synthRev: midiEng.synth.systemParameters.reverbGain}; })()`);
  await js('stopAll()'); await wait(500);
 }
 console.log('RESULT', JSON.stringify(res)); } catch(e){ console.log('ERR', e.message); }
 app.quit(); }); });
require('../src/main.js');
