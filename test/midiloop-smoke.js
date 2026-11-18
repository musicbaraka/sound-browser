const { app } = require('electron'); const fs=require('fs'), path=require('path');
const [lib,out]=process.argv.slice(-2); app.setPath('userData', path.join(out,'ud')); fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.writeFileSync(path.join(app.getPath('userData'),'library.json'), JSON.stringify({folders:[lib],favorites:[],session:{}}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(e,win)=>{ win.webContents.on('did-finish-load', async()=>{ const js=s=>win.webContents.executeJavaScript(s);
 try {
 for(let i=0;i<100 && !(await js('files.length>=2 && !scanState.size'));i++) await wait(200);
 await js(`$('#loop').checked=true; select(view.findIndex(r=>r.name==='Short Bass.mid'), true)`);
 for(let i=0;i<100 && !(await js('!!midiEng && !player.paused'));i++) await wait(100);
 const r={};
 r.loop = await js('player.loop');
 await js(`$('#mpAll').value='0:48'; $('#mpAll').dispatchEvent(new Event('change',{bubbles:true}))`); await wait(300);
 r.set = await js('midiEng.synth.midiChannels[0].patch.program');
 const samples=[]; for(let i=0;i<14;i++){ await wait(500); samples.push(await js('[+player.currentTime.toFixed(1), midiEng.synth.midiChannels[0].patch.program, player.paused]')); }
 r.samples=samples;
 console.log('RESULT', JSON.stringify(r)); } catch(e){ console.log('ERR', e.message); }
 app.quit(); }); });
require('../src/main.js');
