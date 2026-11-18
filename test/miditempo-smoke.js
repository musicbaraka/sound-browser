// MIDI: tempo slider (slower/faster), zoom on the piano roll, reverb/chorus amounts
const { app } = require('electron'); const fs=require('fs'), path=require('path');
const [lib,out]=process.argv.slice(-2); app.setPath('userData', path.join(out,'ud')); fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.writeFileSync(path.join(app.getPath('userData'),'library.json'), JSON.stringify({folders:[lib],favorites:[],session:{}}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(e,win)=>{ win.setSize(1440,900); win.webContents.on('console-message',(ev)=>{const m=String(ev.message||ev); if(/rror/.test(m)) console.log('[r]',m.slice(0,200));});
 win.webContents.on('did-finish-load', async()=>{ const js=s=>win.webContents.executeJavaScript(s);
 try { for(let i=0;i<100 && !(await js('files.length>=4 && !scanState.size'));i++) await wait(200);
 await js(`select(view.findIndex(r=>r.name==='Dance.mid'), true)`);
 for(let i=0;i<100 && !(await js('!!midiEng && !player.paused'));i++) await wait(100);
 const r = {};
 r.start = await js(`({bpm: $('#mpBpm').value, slider: $('#mpTempo').value})`);
 let t0 = await js('player.currentTime'); await wait(2000); r.normal = +(await js('player.currentTime') - t0).toFixed(2);
 await js(`$('#mpBpm').value=240; $('#mpBpm').dispatchEvent(new Event('change'))`);
 t0 = await js('player.currentTime'); await wait(2000); r.double = { advanced: +(await js('player.currentTime') - t0).toFixed(2), slider: await js(`$('#mpTempo').value`), status: await js(`$('#status').textContent.slice(0,80)`) };
 await js(`$('#mpTempo').value=50; $('#mpTempo').dispatchEvent(new Event('input'))`);
 t0 = await js('player.currentTime'); await wait(2000); r.half = { advanced: +(await js('player.currentTime') - t0).toFixed(2), bpm: await js(`$('#mpBpm').value`) };
 await js(`$('#mpTempo').dispatchEvent(new Event('dblclick'))`); r.reset = await js(`$('#mpBpm').value`);
 // wheel zoom over the roll
 const p = await js(`(()=>{const b=canvas.getBoundingClientRect(); return {x:b.left+b.width/2, y:b.top+b.height/2};})()`);
 for (let i=0;i<5;i++){ win.webContents.sendInputEvent({type:'mouseWheel', x:Math.round(p.x), y:Math.round(p.y), deltaX:0, deltaY:240}); await wait(60); }
 r.zoom = await js(`[+zoom.t0.toFixed(1), +zoom.t1.toFixed(1), +player.duration.toFixed(1)]`);
 await js(`$('#mpRev').value=0; $('#mpRev').dispatchEvent(new Event('input'))`);
 r.fx = await js(`({rev: midiRev, n: $('#mpRevN').value, synth: midiEng.synth.systemParameters.reverbGain, cho: midiEng.synth.systemParameters.chorusGain})`);
 fs.writeFileSync(path.join(out,'tempo.png'), (await win.webContents.capturePage()).toPNG());
 await js('stopAll()');
 console.log('RESULT', JSON.stringify(r)); } catch(e){ console.log('ERR', e.message); }
 app.quit(); }); });
require('../src/main.js');
