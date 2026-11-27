const { app } = require('electron'); const fs=require('fs'), path=require('path');
const [lib,out]=process.argv.slice(-2); app.setPath('userData', path.join(out,'ud')); fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.writeFileSync(path.join(app.getPath('userData'),'library.json'), JSON.stringify({folders:[lib],favorites:[],session:{}}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(e,win)=>{ win.setSize(1440,900); win.webContents.on('console-message',(ev)=>{const m=String(ev.message||ev); if(/rror|Uncaught|warn/i.test(m)) console.log('[r]',m.slice(0,300));});
 win.webContents.on('did-finish-load', async()=>{ const js=s=>win.webContents.executeJavaScript(s);
 try { for(let i=0;i<100 && !(await js('files.length>=3 && !scanState.size'));i++) await wait(200);
 const st = () => js(`({name: $('#np-name').textContent, dir: $('#np-dir').textContent.slice(-40), midimode: document.body.classList.contains('midimode'), isMidiPlayer: player===midiPlayer, paused: player.paused, t: +(player.currentTime||0).toFixed(2), buf: !!ed.buf, midiDoc: !!midiDoc, status: ($('#status')||{}).textContent})`);
 const r = {};
 await js(`$('#chips .chip[data-x="mid"]') && $('#chips .chip[data-x="mid"]').click(); 0`); await wait(300);
 await js(`select(0, true)`); await wait(2500); r.midi = await st();
 await js(`quickOpen('/tmp/outside/Walk.wav')`); await wait(1500); r.dropped = await st();
 await js(`quickOpen(''+require('path').join(lib,'Bass Drone C.wav')+'')`); await wait(1500); r.droppedInLib = await st();
 await js(`select(1, true)`); await wait(2500); r.next = await st();
 await js(`select(2, true)`); await wait(2500); r.next2 = await st();
 // and with keyboard down arrow from the dropped file
 await js(`quickOpen('/tmp/outside/Walk.wav')`); await wait(1500);
 win.webContents.sendInputEvent({type:'keyDown', keyCode:'Down'}); win.webContents.sendInputEvent({type:'keyUp', keyCode:'Down'}); await wait(2500); r.arrow = await st();
 console.log('RESULT', JSON.stringify(r, null, 1)); } catch(e){ console.log('ERR', e.message); }
 app.quit(); }); });
require('../src/main.js');
