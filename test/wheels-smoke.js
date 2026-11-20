const { app } = require('electron'); const fs=require('fs'), path=require('path');
const [lib,out]=process.argv.slice(-2); app.setPath('userData', path.join(out,'ud')); fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.writeFileSync(path.join(app.getPath('userData'),'library.json'), JSON.stringify({folders:[lib],favorites:[],session:{}}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(e,win)=>{ win.setSize(1440,900); win.webContents.on('console-message',(ev)=>{const m=String(ev.message||ev); if(/rror/.test(m)) console.log('[r]',m.slice(0,200));});
 win.webContents.on('did-finish-load', async()=>{ const js=s=>win.webContents.executeJavaScript(s);
 try { for(let i=0;i<100 && !(await js('files.length>=4 && !scanState.size'));i++) await wait(200);
 await js(`select(view.findIndex(r=>r.name==='J-cycle.mid'), true)`);
 for(let i=0;i<100 && !(await js('!!midiEng && !player.paused'));i++) await wait(100); await wait(1500);
 const r={};
 r.follow = await js(`({mod: $('#whModV').textContent, bend: $('#whBendV').textContent, file: fileMod(player.currentTime), knob: $('#whMod .wknob').style.top, follow: $('#whFollow').classList.contains('on')})`);
 // drag the mod wheel to the bottom with the mouse
 const box = await js(`(()=>{const r=$('#whMod .wtr').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y,h:r.height}})()`);
 win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(box.x),y:Math.round(box.y+box.h/2),button:'left',clickCount:1}); await wait(100);
 win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(box.x),y:Math.round(box.y+box.h+30),button:'left',modifiers:['leftButtonDown']}); await wait(100);
 win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(box.x),y:Math.round(box.y+box.h+30),button:'left',clickCount:1}); await wait(800);
 r.held = await js(`({modHeld, noMod: midiNoMod, shown: $('#whModV').textContent, mod0: $('#whMod0').classList.contains('on'), held: $('#whMod').classList.contains('held')})`);
 await js(`setBendHeld(4096)`); await wait(200); r.bend = await js(`$('#whBendV').textContent`);
 await js(`setBendHeld(null)`); await wait(200); r.bendBack = await js(`({b: bendHeld, v: $('#whBendV').textContent})`);
 await js(`$('#whTup').click(); $('#whTup').click()`); await wait(300);
 r.trans = await js(`({t: midiTrans, input: $('#mpTrans').value})`);
 await wait(500); await win.webContents.capturePage().then(img=>fs.writeFileSync(path.join(out,'wheels.png'), img.toPNG()));
 await js(`$('#whFollow').click()`); await wait(300);
 r.back = await js(`({modHeld, follow: $('#whFollow').classList.contains('on'), playing: !player.paused})`);
 console.log('RESULT', JSON.stringify(r)); } catch(e){ console.log('ERR', e.message); }
 app.quit(); }); });
require('../src/main.js');
