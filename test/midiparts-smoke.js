// MIDI instruments panel: parts listed, All parts and per-part instrument, mute, your own sound bank
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-3, -1).length === 2 && process.argv.length > 4 ? process.argv.slice(-2) : process.argv.slice(-2);
const bank = process.env.SB_TEST_BANK || '';
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], midiBank: bank || undefined, session: bank ? { midiBank: bank } : {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
let JS = null;
const until = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await JS(expr)) return true; await wait(100); } return false; };
app.on('browser-window-created', (e, win) => {
  win.setSize(1440, 900);
  win.webContents.on('console-message', (ev) => { const m = ev.message || ev; if (/rror/i.test(String(m))) console.log('[renderer]', String(m).slice(0, 300)); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s); JS = js;
    try {
      await until('files.length >= 4 && !scanState.size');
      const r = {};
      await js(`$('#autoplay').checked=true; select(view.findIndex(r=>r.name==='Dance.mid'), true)`);
      await until('!!midiDoc && !player.paused', 30000); await wait(1500);
      r.panel = await js(`({visible: getComputedStyle($('#midiPanel')).display, editHidden: getComputedStyle($('#edit')).display, parts: document.querySelectorAll('.mp-part').length, channels: midiDoc.channels.length, options: $('#mpAll').options.length, bank: $('#mpBank').textContent, names: [...document.querySelectorAll('.mp-part .nm')].slice(0,4).map(e=>e.textContent)})`);
      const mel = await js(`midiDoc.channels.find(c=>!c.drums).ch`);
      r.before = await js(`midiEng.synth.midiChannels[${mel}].patch.program`);
      await js(`$('#mpAll').value='0:0'; $('#mpAll').dispatchEvent(new Event('change',{bubbles:true}))`); await wait(800);
      r.allPiano = await js(`midiDoc.channels.filter(c=>!c.drums).map(c=>midiEng.synth.midiChannels[c.ch].patch.program)`);
      // one part to strings (program 48)
      await js(`{const s=document.querySelector('#mpParts select[data-ch="${mel}"]'); s.value='0:48'; s.dispatchEvent(new Event('change',{bubbles:true}))}`); await wait(800);
      r.oneStrings = await js(`midiEng.synth.midiChannels[${mel}].patch.program`);
      await js(`document.querySelector('[data-mute="${mel}"]').click()`); await wait(400);
      r.muted = await js(`({muted: midiEng.synth.midiChannels[${mel}].systemParameters.isMuted, row: document.querySelector('.mp-part[data-ch="${mel}"]').classList.contains('muted')})`);
      // back to as written
      await js(`{$('#mpAll').value=''; $('#mpAll').dispatchEvent(new Event('change',{bubbles:true})); const s=document.querySelector('#mpParts select[data-ch="${mel}"]'); s.value=''; s.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('[data-mute="${mel}"]').click()}`); await wait(800);
      r.restored = await js(`({prog: midiEng.synth.midiChannels[${mel}].patch.program, written: midiDoc.channels.find(c=>c.ch===${mel}).program, muted: midiEng.synth.midiChannels[${mel}].systemParameters.isMuted})`);
      r.stillPlaying = await js('!player.paused && player.currentTime > 2');
      fs.writeFileSync(path.join(out, 'panel.png'), (await win.webContents.capturePage()).toPNG());
      await js('stopAll()');
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err && err.stack); }
    app.quit();
  });
});
require('../src/main.js');
