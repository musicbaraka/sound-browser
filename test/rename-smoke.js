// First launch as Sonalogue picks up the data left by Sound Browser
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out, mode] = process.argv.slice(-3);
const appData = path.join(out, 'appdata');
const old = path.join(appData, 'Sound Browser'), neu = path.join(appData, 'Sonalogue');
fs.mkdirSync(path.join(old, 'cache'), { recursive: true });
fs.writeFileSync(path.join(old, 'library.json'), JSON.stringify({ folders: [lib], favorites: [], tags: { [path.join(lib, 'Tone 24.wav')]: ['moved-ok'] }, session: {} }));
fs.writeFileSync(path.join(old, 'cache', 'marker.txt'), 'cache came along');
fs.writeFileSync(path.join(old, 'secrets.json'), '{}');
if (mode === 'existing') { fs.mkdirSync(path.join(neu, 'Local Storage'), { recursive: true }); fs.writeFileSync(path.join(neu, 'Preferences'), '{}'); }
app.setPath('appData', appData); app.setPath('userData', neu);
app.on('browser-window-created', (e, win) => { win.webContents.on('did-finish-load', async () => {
  const js = s => win.webContents.executeJavaScript(s);
  await new Promise(r => setTimeout(r, 3000));
  const r = {
    mode, newHasLibrary: fs.existsSync(path.join(neu, 'library.json')), cacheMoved: fs.existsSync(path.join(neu, 'cache', 'marker.txt')), secretsMoved: fs.existsSync(path.join(neu, 'secrets.json')),
    oldLibraryLeft: fs.existsSync(path.join(old, 'library.json')), keptExisting: mode === 'existing' ? fs.existsSync(path.join(neu, 'Preferences')) : null,
    app: await js(`({folders: folders.length, files: files.length, tagged: files.filter(f => (f.tags||[]).includes('moved-ok')).length, title: document.title})`).catch(e => 'js error ' + e.message)
  };
  console.log('RESULT', JSON.stringify(r)); app.quit(); }); });
require('../src/main.js');
