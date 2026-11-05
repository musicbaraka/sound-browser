// Run on Windows (in the release build): protect and unprotect a test key with Windows data protection.
const { dpapi } = require('../src/dpapi');
(async () => {
  const key = 'sk_test_' + Math.random().toString(36).slice(2) + '_abcdefghijklmnop';
  const prot = await dpapi('Protect', Buffer.from(key).toString('base64'));
  if (prot.includes(Buffer.from(key).toString('base64'))) throw new Error('not protected');
  const back = Buffer.from(await dpapi('Unprotect', prot), 'base64').toString('utf8');
  if (back !== key) throw new Error('round trip failed');
  console.log('Windows key protection works:', prot.length, 'chars protected, round trip OK');
})().catch(e => { console.error('Windows key protection FAILED:', e.message); process.exit(1); });
