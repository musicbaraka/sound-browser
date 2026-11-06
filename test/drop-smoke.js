// Real drop events: files dropped on the window must reach the app
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {} }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.webContents.on('console-message', ev => { const m = String(ev.message || ev); if (/Uncaught|rror/.test(m) && !/dbus|NODE_OPTION/.test(m)) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    try {
      await wait(2000);
      const r = {};
      // what the drop handler does with the browser's FileList
      r.bridge = await js(`(()=>{ const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.wav')); dt.items.add(new File(['y'], 'b.wav'));
        try { const p = sb.pathsOf(Array.from(dt.files)); return 'ok: ' + JSON.stringify(p); } catch (err) { return 'FAILED: ' + err.message; } })()`);
      // a full drop event on the list, with a stand-in for the path lookup so we can follow it to the end
      r.dropReachesApp = await js(`(async()=>{ window.__opened = null; const real = window.quickOpen; window.quickOpen = (p, n) => { window.__opened = [p, n]; };
        const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.wav'));
        const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
        document.querySelector('#list').dispatchEvent(ev);
        await new Promise(r => setTimeout(r, 500)); window.quickOpen = real; return { defaultPrevented: ev.defaultPrevented, status: $('#status').textContent }; })()`);
      // real files from disk (as Windows hands them over on a drop), through the same drop handler
      await js(`(()=>{ const i=document.createElement('input'); i.type='file'; i.multiple=true; i.id='__f'; document.body.appendChild(i); })()`);
      win.webContents.debugger.attach('1.3');
      const doc = await win.webContents.debugger.sendCommand('DOM.getDocument');
      const q = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#__f' });
      const drop = async files => {
        await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: q.nodeId, files });
        return js(`(async()=>{ const dt = new DataTransfer(); for (const f of $('#__f').files) dt.items.add(f);
          document.querySelector('#list').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
          await new Promise(r => setTimeout(r, 1800)); return { current: current && current.name, quickEdit: !!(current && current.temp), folders: folders.length, status: $('#status').textContent }; })()`);
      };
      r.dropOneSound = await drop(['/tmp/an/melody_gmaj.wav']);
      r.dropThreeSounds = await drop(['/tmp/an/drums_92.wav', '/tmp/an/noise.wav', '/tmp/an/pad_cmin.wav']);
      r.dropAFolder = await drop(['/tmp/an']);
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err); }
    app.quit();
  });
});
require('../src/main.js');
