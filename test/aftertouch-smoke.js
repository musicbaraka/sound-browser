const { app } = require('electron'); const fs=require('fs'), path=require('path');
const [lib,out]=process.argv.slice(-2); app.setPath('userData', path.join(out,'ud')); fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.writeFileSync(path.join(app.getPath('userData'),'library.json'), JSON.stringify({folders:[lib],favorites:[],session:{}}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(e,win)=>{ win.webContents.on('did-finish-load', async()=>{ const js=s=>win.webContents.executeJavaScript(s);
 try { for(let i=0;i<100 && !(await js('files.length>=1 && !scanState.size'));i++) await wait(200);
 await js(`select(0, false)`); await wait(500); await js(`midiEngine().then(()=>window.__ready=1); 0`);
 for(let i=0;i<100 && !(await js('!!window.__ready'));i++) await wait(100);
 await js(`window.__rec=[]; window.__sp=actx.createScriptProcessor(4096,1,1); __sp.onaudioprocess=e=>{ if(window.__on) __rec.push(Array.from(e.inputBuffer.getChannelData(0))); }; bus.connect(__sp); __sp.connect(actx.destination); actx.resume(); 0`);
 const take = async (held, prog, press) => {
   await js(`(()=>{const s=midiEng.synth; s.programChange(0, ${prog}); s.controllerChange(0,121,0); modHeld=${held}; applyMidiWheels(); if(${press}) s.channelPressure(0,127); window.__rec=[]; window.__on=true; s.noteOn(0,69,100); })(); 0`);
   await wait(2500); await js(`midiEng.synth.noteOff(0,69); window.__on=false; 0`); await wait(500);
   return await js(`({sr: actx.sampleRate, d: [].concat(...__rec)})`);
 };
 const o={}; for (const prog of [0,81]) { o['f'+prog]=await take('null',prog,1); o['n'+prog]=await take('0',prog,1); o['x'+prog]=await take('null',prog,0); }
 fs.writeFileSync(path.join(out,'rec3.json'), JSON.stringify(o)); console.log('RESULT ok');
 } catch(e){ console.log('ERR', e.message); }
 app.quit(); }); });
require('../src/main.js');
