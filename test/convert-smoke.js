// Converter: real files, every format, sizes, naming, chosen folder, drop onto the converter
const { app, dialog } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
// the folder picker answers with our test folder
const picked = path.join(out, 'picked'); fs.mkdirSync(picked, { recursive: true });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
const wait = ms => new Promise(r => setTimeout(r, ms));
let JS = null;
const until = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await JS(expr)) return true; await wait(150); } return false; };
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 900);
  win.webContents.on('console-message', (ev) => { const m = ev.message || ev; if (/rror/.test(String(m))) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    const key = async k => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); win.webContents.sendInputEvent({ type: 'char', keyCode: k }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(200); };
    const opts = () => js(`[...document.querySelectorAll('#conv-q label')].map(l => l.querySelector('.qn').firstChild.textContent.trim() + ' = ' + l.querySelector('.qs').textContent)`);
    const pick = (fmt, q, sr) => js(`{ const f=$('#conv-fmt'); f.value='${fmt}'; f.dispatchEvent(new Event('change')); ${q ? `const r=document.querySelector('input[name=convq][value="${q}"]'); r.checked=true; r.dispatchEvent(new Event('change',{bubbles:true}));` : ''} ${sr != null ? `const s=$('#conv-sr'); s.value='${sr}'; s.dispatchEvent(new Event('change'));` : ''} }`);
    const go = async () => { await js(`conv.saved=null; $('#conv-go').click()`); await until('!conv.busy && (!!conv.saved || $("#conv-status").className==="err")', 60000); return js(`({saved: conv.saved, status: $('#conv-status').textContent, name: $('#conv-name').textContent})`); };
    try {
      await until('files.length >= 4 && !scanState.size');
      const r = {};
      await js(`$('#autoplay').checked=false; select(view.findIndex(r=>r.name==='Tone 24.wav'), false)`); await until('!!ed.buf');
      await key('C');
      await until('!!conv.ab');
      r.open = await js(`({shown: $('#conv').classList.contains('show'), fmt: conv.fmt, src: $('#conv-sinfo').textContent, sr: $('#conv-sr').selectedOptions[0].textContent})`);
      r.mp3Sizes = await opts();
      fs.writeFileSync(path.join(out, 'conv.png'), (await win.webContents.capturePage()).toPNG());
      await pick('mp3', 192); r.mp3 = await go();
      await pick('flac', 16); await until(`!/estimating/.test($('#conv-q').textContent)`); r.flacSizes = await opts(); r.flac = await go();
      await pick('flac', 24); r.flac24 = await go();
      await pick('wav', 16); r.wav16 = await go();
      await pick('aiff', 24, 44100); r.aiff441 = await go();
      await pick('wav', 32); r.wav32 = await go();
      // a folder of my choosing
      await js(`{ const p=document.querySelector('input[name=cdest][value=pick]'); p.checked=true; p.dispatchEvent(new Event('change',{bubbles:true})); }`); await until('!!conv.dir');
      await pick('mp3', 128); r.picked = await go();
      await js(`{ const p=document.querySelector('input[name=cdest][value=next]'); p.checked=true; p.dispatchEvent(new Event('change',{bubbles:true})); }`);
      // 96 kHz source to MP3: must come down to 48 kHz
      await js(`closeConv(); select(view.findIndex(r=>r.name==='HiRes 96k.wav'), false)`); await until(`current && current.name==='HiRes 96k.wav' && !!ed.buf`);
      await js(`$('#convBtn').click()`); await until(`conv.r && conv.r.name==='HiRes 96k.wav' && !!conv.ab`);
      r.hires = { srChoices: await js(`[...$('#conv-sr').options].map(o=>o.textContent)`), chosen: await js(`$('#conv-sr').selectedOptions[0].textContent`) };
      await pick('mp3', 320); r.hiresMp3 = await go();
      // an MP3 source starts on WAV
      await js(`closeConv(); menuRec = files.find(r=>r.name==='Song.mp3'); menu.querySelector('[data-a=convert]').click()`); await until(`conv.r && conv.r.name==='Song.mp3' && !!conv.ab`);
      r.mp3src = await js(`({fmt: conv.fmt, q: conv.q.wav, name: $('#conv-name').textContent})`);
      r.mp3srcWav = await go();
      // drop a file from outside the library onto the open converter
      await js(`(()=>{ const i=document.createElement('input'); i.type='file'; i.id='__f'; document.body.appendChild(i); })()`);
      win.webContents.debugger.attach('1.3');
      const doc = await win.webContents.debugger.sendCommand('DOM.getDocument');
      const q = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#__f' });
      await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: q.nodeId, files: ['/tmp/dropsrc/Outside Pad.aif'] });
      await js(`{ const dt = new DataTransfer(); for (const f of $('#__f').files) dt.items.add(f); $('#conv-drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }`);
      await until(`conv.r && conv.r.name==='Outside Pad.aif' && !!conv.ab`);
      r.dropped = await js(`({current: current && current.name, src: $('#conv-sinfo').textContent})`);
      await pick('flac', 16); r.droppedFlac = await go();
      await pick('wav', 24); r.droppedWav24 = await go();
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err && err.message, err); }
    app.quit();
  });
});
require('../src/main.js');
