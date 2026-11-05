'use strict';
// Windows data protection for the current user (the same protection Windows uses for saved passwords).
// It does not depend on any file of the app, so updates cannot make protected data unreadable.
const { execFile } = require('child_process');
function dpapi(op, b64) {
  if (op !== 'Protect' && op !== 'Unprotect') return Promise.reject(new Error('bad op'));
  if (!/^[A-Za-z0-9+/=]*$/.test(b64)) return Promise.reject(new Error('bad input'));
  return new Promise((resolve, reject) => {
    const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String('${b64}'); ` +
      `$o=[System.Security.Cryptography.ProtectedData]::${op}($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($o)`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 20000 },
      (err, out) => { const r = String(out || '').trim(); err || !r ? reject(err || new Error('empty')) : resolve(r); });
  });
}
module.exports = { dpapi };
