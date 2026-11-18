const { app } = require('electron'); const fs=require('fs'), path=require('path');
const [lib,out]=process.argv.slice(-2); app.setPath('userData', path.join(out,'ud')); fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.writeFileSync(path.join(app.getPath('userData'),'library.json'), JSON.stringify({folders:[lib],favorites:[],session:{}}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(e,win)=>{ win.setSize(1440,900); win.webContents.on('console-message',(ev)=>{const m=String(ev.message||ev); if(/rror/.test(m)) console.log('[r]',m.slice(0,200));});
 win.webContents.on('did-finish-load', async()=>{ const js=s=>win.webContents.executeJavaScript(s);
 try { for(let i=0;i<100 && !(await js('files.length>=4 && !scanState.size'));i++) await wait(200);
 await js(`select(view.findIndex(r=>r.name==='J-cycle.mid'), true)`);
 for(let i=0;i<100 && !(await js('!!midiEng && !player.paused'));i++) await wait(100); await wait(800);
 const r={msgs: await js(`$('#mpMsgs').textContent`)};
 await js(`$('#mpNoMod').click()`); await wait(1500);
 r.on = await js(`({checked: $('#mpNoMod').checked, playing: !player.paused, t: +player.currentTime.toFixed(1)})`);
 await js(`select(view.findIndex(r=>r.name==='Dance.mid'), false)`); await wait(800);
 r.dance = await js(`({msgs: $('#mpMsgs').textContent, checked: $('#mpNoMod').checked})`);
 console.log('RESULT', JSON.stringify(r)); } catch(e){ console.log('ERR', e.message); }
 app.quit(); }); });
require('../src/main.js');
