// Import past ElevenLabs sound effects (stand-in API)
const http = require('http');
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
const mp3 = fs.readFileSync('/tmp/an/bell.mp3');
const server = http.createServer((req, res) => {
  const k = req.headers['xi-api-key'], u = new URL(req.url, 'http://x');
  const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (k === 'sk_nolist') return json(404, { detail: 'Not Found' });
  if (k !== 'sk_ok') return json(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
  if (u.pathname === '/v1/sound-generation/history') {
    if (!u.searchParams.get('start_after_history_item_id')) return json(200, { history: [{ history_item_id: 'a1', text: 'Thunder rumble distant', date_unix: 1700000000 }, { history_item_id: 'a2', text: 'Glass shatter on concrete' }], has_more: true, last_history_item_id: 'a2' });
    return json(200, { history: [{ history_item_id: 'a3', text: 'Laser zap' }], has_more: false, last_history_item_id: 'a3' });
  }
  if (u.pathname === '/v1/sound-generation/history/a1/audio' || u.pathname === '/v1/history/a2/audio') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(mp3); return; }
  json(404, { detail: 'Not Found' });
});
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {}, genFolder: path.join(out, 'Generated') }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.webContents.on('console-message', ev => { const m = String(ev.message || ev); if (/Uncaught|Error/.test(m)) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return true; await wait(200); } return false; };
    try {
      await until('files.length > 5 && !scanState.size');
      const r = {};
      await js(`showTab('settings')`);
      await js(`sb.eleven.setKey('sk_nolist')`); await js(`$('#importPast').click()`); await until(`!$('#importPast').disabled && $('#importStatus').textContent.length > 40`);
      r.noList = await js(`$('#importStatus').textContent`);
      await js(`sb.eleven.setKey('sk_ok')`); await js(`$('#importPast').click()`); await until(`!$('#importPast').disabled && /Imported|No new/.test($('#importStatus').textContent)`);
      r.first = await js(`$('#importStatus').textContent`);
      await wait(2500);
      r.library = await js(`files.filter(r=>r.root.endsWith('Generated')).map(r=>r.name+' tags='+r.tags.join('|'))`);
      await js(`$('#importPast').click()`); await until(`!$('#importPast').disabled && /Imported|No new/.test($('#importStatus').textContent)`);
      r.second = await js(`$('#importStatus').textContent`);
      r.filesOnDisk = fs.readdirSync(path.join(out, 'Generated'));
      r.dateKept = new Date(fs.statSync(path.join(out, 'Generated', 'Thunder rumble distant.mp3')).mtimeMs).toISOString().slice(0, 10);
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err); }
    server.close(); app.quit();
  });
});
server.listen(0, '127.0.0.1', () => { process.env.SB_ELEVEN_BASE = 'http://127.0.0.1:' + server.address().port; require('../src/main.js'); });
