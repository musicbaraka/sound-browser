// Video preview: sizes when docked, undock and drag, double-click to dock, pop out (picture-in-picture)
const { app } = require('electron'); const fs=require('fs'), path=require('path');
const [lib,out]=process.argv.slice(-2); app.setPath('userData', path.join(out,'ud')); fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.writeFileSync(path.join(app.getPath('userData'),'library.json'), JSON.stringify({folders:[lib],favorites:[],session:{}}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(e,win)=>{ win.setSize(1440,900); win.webContents.on('console-message',(ev)=>{const m=String(ev.message||ev); if(/rror/i.test(m)) console.log('[r]',m.slice(0,300));});
 win.webContents.on('did-finish-load', async()=>{ const js=s=>win.webContents.executeJavaScript(s);
 const until = async (expr, ms=30000) => { const t=Date.now(); while(Date.now()-t<ms){ if(await js(expr)) return true; await wait(100);} return false; };
 const rect = sel => js(`(()=>{const b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x:b.left,y:b.top,w:b.width,h:b.height};})()`);
 const click = async (x, y, n=1) => { for (let i=1;i<=n;i++){ win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(x),y:Math.round(y),button:'left',clickCount:i}); win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(x),y:Math.round(y),button:'left',clickCount:i}); } await wait(300); };
 const center = async sel => { const b = await rect(sel); return [b.x + b.w/2, b.y + b.h/2]; };
 try { await until('files.length>=3 && !scanState.size');
 await js(`$('#autoplay').checked=false; select(view.findIndex(r=>r.name==='Interview Take 3.mp4'), false)`); await until('!!videoDoc && !!ed.buf');
 const r = {}; r.docked = await rect('#vbox');
 await click(...await center('#vSize')); r.bigger = (await rect('#vbox')).w;
 await click(...await center('#vFloat')); r.float = { cls: await js(`vbox.classList.contains('float')`), box: await rect('#vbox') };
 // drag it by its middle
 const b = await rect('#vbox'), sx = b.x + b.w/2, sy = b.y + b.h/2;
 win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(sx),y:Math.round(sy),button:'left',clickCount:1});
 for (let i=1;i<=8;i++){ win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(sx - i*50),y:Math.round(sy + i*30)}); await wait(30); }
 win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(sx-400),y:Math.round(sy+240),button:'left',clickCount:1}); await wait(300);
 r.dragged = await rect('#vbox');
 await js('play()'); await wait(1000); r.followsWhileFloating = await js(`({v: +$('#vprev').currentTime.toFixed(1), p: +player.currentTime.toFixed(1)})`);
 fs.writeFileSync(path.join(out,'float.png'), (await win.webContents.capturePage()).toPNG());
 await click(...await center('#vbox'), 2); r.docked2 = { cls: await js(`vbox.classList.contains('float')`), box: await rect('#vbox') };
 await click(...await center('#vPip')); await wait(800);
 r.pip = await js(`({pip: document.pictureInPictureElement === $('#vprev'), away: vbox.classList.contains('away'), status: $('#status').textContent.slice(0,80)})`);
 if (r.pip.pip) { await click(...await center('#vBack')); await wait(600); r.back = await js(`({pip: !!document.pictureInPictureElement, away: vbox.classList.contains('away')})`); }
 await js('stopAll()');
 console.log('RESULT', JSON.stringify(r, null, 1)); } catch(e){ console.log('ERR', e.stack); }
 app.quit(); }); });
require('../src/main.js');
