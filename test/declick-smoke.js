// Declick (K) and Undo; stop keeps the place, play continues from there (original and edit); Home goes back to the start
const { app } = require('electron'); const fs=require('fs'), path=require('path');
const [lib,out]=process.argv.slice(-2); app.setPath('userData', path.join(out,'ud')); fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.writeFileSync(path.join(app.getPath('userData'),'library.json'), JSON.stringify({folders:[lib],favorites:[],session:{}}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(e,win)=>{ win.setSize(1440,900); win.webContents.on('console-message',(ev)=>{const m=String(ev.message||ev); if(/rror/i.test(m)) console.log('[r]',m.slice(0,300));});
 win.webContents.on('did-finish-load', async()=>{ const js=s=>win.webContents.executeJavaScript(s);
 const key = async (k, mods=[]) => { win.webContents.sendInputEvent({type:'keyDown',keyCode:k,modifiers:mods}); win.webContents.sendInputEvent({type:'char',keyCode:k,modifiers:mods}); win.webContents.sendInputEvent({type:'keyUp',keyCode:k,modifiers:mods}); await wait(200); };
 const until = async (expr, ms=30000) => { const t=Date.now(); while(Date.now()-t<ms){ if(await js(expr)) return true; await wait(100);} return false; };
 try { await until('files.length>=2 && !scanState.size');
 const r = {};
 await js(`$('#autoplay').checked=false; select(view.findIndex(r=>r.name==='Clicky Chord.wav'), false)`); await until('!!ed.buf');
 // original: play, stop at ~1.5 s, play again
 await js('play()'); await wait(1500); await key('Space'); await wait(200);
 r.stoppedAt = await js('+player.currentTime.toFixed(2)');
 await key('Space'); await wait(400); r.resumed = await js('({playing: isPlaying(), t: +player.currentTime.toFixed(2)})'); await key('Space'); await wait(200);
 // Declick
 await key('K'); await until(`/Removed|No clicks/.test($('#status').textContent)`);
 r.declick = await js(`({status: $('#status').textContent, ops: ed.specOps.length, marks: (ed.declicked||[]).length})`);
 await until('!!ed.outBuf', 10000); await wait(1200); await js('stopAll()'); await wait(200);
 // edit: stop place is kept and play continues there
 await js('player.currentTime = 2.0; drawWave()'); await key('Space'); await wait(800);
 r.editPlay = await js('({edit: !!eSrc, pos: +outToSrc(editPos()).toFixed(2)})');
 await key('Space'); await wait(200); r.editStop = await js('+player.currentTime.toFixed(2)');
 await key('Space'); await wait(500); r.editResume = await js('({edit: !!eSrc, pos: +outToSrc(editPos()).toFixed(2)})'); await key('Space'); await wait(200);
 await key('Home'); r.home = await js('+player.currentTime.toFixed(2)');
 fs.writeFileSync(path.join(out,'declick.png'), (await win.webContents.capturePage()).toPNG());
 await key('Z', ['control']); await wait(300); r.undo = await js(`({ops: ed.specOps.length, status: $('#status').textContent})`);
 console.log('RESULT', JSON.stringify(r, null, 1)); } catch(e){ console.log('ERR', e.stack); }
 app.quit(); }); });
require('../src/main.js');
