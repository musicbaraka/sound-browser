// Headless smoke test: node_modules/.bin/electron test/smoke.js <libraryFolder> <outDir>
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
if (!fs.existsSync(path.join(app.getPath('userData'), 'library.json'))) fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: { autoplay: true } }));
app.on('browser-window-created', (e, win) => {
  win.webContents.on('console-message', (ev) => console.log('[renderer]', ev.message || ev));
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    await new Promise(r => setTimeout(r, 2500));
    console.log('STATS', await js("document.querySelector('#stats').textContent"));
    console.log('ROWS', await js("[...document.querySelectorAll('.row')].map(r=>[...r.children].slice(1).map(c=>c.textContent).join(' | ')).join('\\n')"));
    const res = await js(`(async()=>{const out={};for(const n of ['Kick Punchy.aiff','Kick 808 Deep.wav','Forest Morning.flac','Bell Shimmer.mp3']){const i=view.findIndex(r=>r.name===n);select(i,true);await new Promise(r=>setTimeout(r,900));out[n]={paused:player.paused,t:+player.currentTime.toFixed(2),dur:player.duration,err:document.querySelector('#status').textContent,peaks:!!peaks};}
      player.currentTime=0.5; await new Promise(r=>setTimeout(r,300)); out.seek=player.currentTime; return out;})()`);
    console.log('PLAY', JSON.stringify(res, null, 1));
    await js("document.querySelector('#search').value='kick';document.querySelector('#search').oninput()");
    await new Promise(r => setTimeout(r, 400));
    console.log('SEARCH kick ->', await js('view.length'));
    await js("toggleFav(view[0])");
    await new Promise(r => setTimeout(r, 1500));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, 'shot.png'), img.toPNG());
    app.quit();
  });
});
require('../src/main.js');
