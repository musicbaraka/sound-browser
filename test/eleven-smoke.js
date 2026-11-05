// ElevenLabs generator against a local stand-in for the API
const http = require('http');
const { app } = require('electron');
const fs = require('fs'), path = require('path');
const [lib, out] = process.argv.slice(-2);
const seen = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    seen.push({ method: req.method, url: req.url, key: req.headers['xi-api-key'], body: body ? JSON.parse(body) : null });
    const k = req.headers['xi-api-key'];
    const deny = (status, message) => { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ detail: { status, message } })); };
    if (k === 'sk_limited' && req.url.startsWith('/v1/user')) return deny('missing_permissions', 'The API key you used is missing the permission user_read to execute this operation.');
    if (k === 'sk_limited' && req.url.startsWith('/v1/sound-generation')) { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(fs.readFileSync('/tmp/an/bell.mp3')); return; }
    if (k === 'sk_nosfx' && req.url.startsWith('/v1/sound-generation')) return deny('missing_permissions', 'The API key you used is missing the permission sound_generation to execute this operation.');
    if (k === 'sk_nosfx' && req.url.startsWith('/v1/user')) return deny('missing_permissions', 'missing user_read');
    if (k !== 'sk_test_123456') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } })); return; }
    if (req.url.startsWith('/v1/user')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ subscription: { tier: 'creator', character_count: 1000, character_limit: 100000 } })); return; }
    if (req.url.startsWith('/v1/sound-generation')) { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(fs.readFileSync('/tmp/an/bell.mp3')); return; }
    res.writeHead(404); res.end();
  });
});
app.setPath('userData', path.join(out, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'library.json'), JSON.stringify({ folders: [lib], favorites: [], session: {}, genFolder: path.join(out, 'Generated') }));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (e, win) => {
  win.setSize(1400, 900);
  win.webContents.on('console-message', ev => { const m = String(ev.message || ev); if (/Uncaught|Error/.test(m)) console.log('[renderer]', m); });
  win.webContents.on('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return true; await wait(200); } return false; };
    try {
      await until('files.length > 5 && !scanState.size');
      const r = {};
      // no key yet: the generator points to Settings
      await js(`$('#genBtn').click()`); await wait(400);
      r.noKey = await js(`({status: $('#gen-status').textContent, button: $('#gen-go').textContent})`);
      await js(`$('#gen-close').click(); showTab('settings')`); await wait(300);
      // wrong key, then the right one
      await js(`$('#keyIn').value='sk_wrong'; $('#keySave').click()`); await until(`$('#keyStatus').classList.contains('err')`);
      r.wrongKey = await js(`$('#keyStatus').textContent`);
      await js(`$('#keyIn').value='sk_test_123456'; $('#keySave').click()`); await until(`$('#keyStatus').classList.contains('ok')`);
      r.goodKey = await js(`$('#keyStatus').textContent`);
      await js(`$('#keyIn').value='  "sk_limited"\\n'; $('#keySave').click()`); await until(`$('#keyStatus').textContent.startsWith('Key accepted')`);
      r.limitedKeyTest = await js(`$('#keyStatus').textContent`);
      r.limitedKeyGenerate = await js(`sb.eleven.generate({text:'small bell ding'}).then(x=>x.path ? 'saved '+x.path.split('/').pop() : x.error)`);
      await js(`$('#keyIn').value='sk_nosfx'; $('#keySave').click()`); await until(`$('#keyStatus').textContent.startsWith('Key accepted')`);
      r.noSfxGenerate = await js(`sb.eleven.generate({text:'small bell ding'}).then(x=>x.path ? 'saved' : x.error)`);
      await js(`$('#keyIn').value='sk_test_123456'; $('#keySave').click()`); await until(`$('#keyStatus').classList.contains('ok') && $('#keyStatus').textContent.startsWith('Connected')`);
      r.keyFileHasPlainKey = fs.readFileSync(path.join(app.getPath('userData'), 'secrets.json'), 'utf8').includes('sk_test_123456');
      fs.writeFileSync(path.join(out, 'settings-eleven.png'), (await win.webContents.capturePage()).toPNG());
      await js(`showTab('lib'); $('#genBtn').click()`); await wait(400);
      await js(`$('#gen-text').value='Heavy wooden door creaking open slowly in a stone castle'; $('#gen-text').dispatchEvent(new Event('input')); $('#gen-n').value='2'; $('#gen-loop').checked=true; $('#gen-auto').checked=false; $('#gen-auto').onchange({target:$('#gen-auto')}); $('#gen-dur').value='4'; $('#gen-inf').value='0.5'`);
      r.autoTags = await js(`$('#gen-tags').value`);
      fs.writeFileSync(path.join(out, 'gen-dialog.png'), (await win.webContents.capturePage()).toPNG());
      await js(`$('#gen-go').click()`);
      await until(`$('#gen-results').children.length === 2 && current && current.name.startsWith('Heavy wooden')`);
      await wait(800);
      r.results = await js(`[...$('#gen-results').children].map(x=>x.innerText)`);
      r.status = await js(`$('#gen-status').textContent`);
      r.library = await js(`({folders: folders.map(f=>f.split('/').pop()), generated: files.filter(r=>r.root.endsWith('Generated')).map(r=>r.name+' tags='+r.tags.join('|')), current: current && current.name, npDir: $('#np-dir').textContent})`);
      r.requests = seen.filter(x => x.url.startsWith('/v1/sound-generation')).map(x => ({ url: x.url, body: x.body }));
      await js(`$('#gen-close').click()`); await wait(300);
      fs.writeFileSync(path.join(out, 'gen-done.png'), (await win.webContents.capturePage()).toPNG());
      console.log('RESULT', JSON.stringify(r, null, 1));
    } catch (err) { console.log('TEST ERROR', err); }
    server.close(); app.quit();
  });
});
server.listen(0, '127.0.0.1', () => {
  process.env.SB_ELEVEN_BASE = 'http://127.0.0.1:' + server.address().port;
  require('../src/main.js');
});
