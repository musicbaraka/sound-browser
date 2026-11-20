// Video: open, Auto Fix the sound, save a fixed copy with the picture untouched (checked outside with ffmpeg)
const { app } = require('electron'); const fs=require('fs'), path=require('path');
const [lib,out]=process.argv.slice(-2); app.setPath('userData', path.join(out,'ud')); fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.writeFileSync(path.join(app.getPath('userData'),'library.json'), JSON.stringify({folders:[lib],favorites:[],session:{}}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(e,win)=>{ win.setSize(1440,900); win.webContents.on('console-message',(ev)=>{const m=String(ev.message||ev); if(/rror/i.test(m)) console.log('[r]',m.slice(0,300));});
 win.webContents.on('did-finish-load', async()=>{ const js=s=>win.webContents.executeJavaScript(s);
 const until = async (expr, ms=60000) => { const t=Date.now(); while(Date.now()-t<ms){ if(await js(expr)) return true; await wait(150);} return false; };
 try { await until('files.length>=3 && !scanState.size');
 const res = {};
 for (const name of ['Interview Take 3.mp4','Scene 12.mov','Vlog Clip.webm']) {
  await js(`$('#autoplay').checked=false; select(view.findIndex(r=>r.name===${JSON.stringify(name)}), false)`);
  await until(`!!videoDoc && current.name===${JSON.stringify(name)} && !!ed.buf`, 30000);
  const o = { load: await js(`({mode: document.body.classList.contains('videomode'), dur: +ed.buf.duration.toFixed(2), sr: ed.buf.sampleRate, prev: !!$('#vprev').src, save: $('#saveEdit').textContent, status: $('#status').textContent.slice(0,90)})`) };
  await js('autoFix()'); await wait(300); await until('!ed.afBusy && !!ed.out', 60000);
  o.fix = await js(`({status: $('#status').textContent.slice(0,160), sel: hasSel(), outLen: +(ed.out[0].length/ed.buf.sampleRate).toFixed(2)})`);
  if (name.endsWith('mp4')) { await js(`player.play()`); await wait(1200); o.preview = await js(`({vt: +$('#vprev').currentTime.toFixed(1), pt: +player.currentTime.toFixed(1), playing: !$('#vprev').paused})`); await js('stopAll()'); await wait(300); fs.writeFileSync(path.join(out,'video.png'), (await win.webContents.capturePage()).toPNG()); }
  await js(`$('#saveEdit').disabled=false; $('#saveEdit').click()`);
  await until(`/Saved|could not/.test($('#status').textContent)`, 120000);
  o.save = await js(`$('#status').textContent`);
  res[name] = o;
 }
 console.log('RESULT', JSON.stringify(res, null, 1)); } catch(e){ console.log('ERR', e.stack); }
 app.quit(); }); });
require('../src/main.js');
