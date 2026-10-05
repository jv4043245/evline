import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const directory = await mkdtemp(join(tmpdir(), 'evline-drive-connect-test-'));
const clientPath = join(directory, 'client.json');
const script = new URL('./connect-supplier-drive.mjs', import.meta.url).href;
const tokens = ['SYNTHETIC_CLIENT_SECRET', 'SYNTHETIC_ACCESS_TOKEN', 'SYNTHETIC_REFRESH_TOKEN', 'SYNTHETIC_AUTH_CODE'];
let child, timeout;
try {
  await writeFile(clientPath, JSON.stringify({ installed: { client_id: 'fixture-client.apps.googleusercontent.com', client_secret: tokens[0] } }), { mode: 0o600 });
  const mock = `
    import assert from 'node:assert/strict';
    process.argv = ['node', ${JSON.stringify(script)}, ${JSON.stringify(clientPath)}];
    globalThis.fetch = async (url, options = {}) => {
      url = String(url);
      assert.equal(options.redirect, 'error');
      if (url === 'https://oauth2.googleapis.com/token') {
        assert.equal(options.body.get('code'), 'SYNTHETIC_AUTH_CODE');
        assert.ok(options.body.get('code_verifier').length >= 43);
        assert.equal(options.body.get('client_secret'), 'SYNTHETIC_CLIENT_SECRET');
        return Response.json({ access_token: 'SYNTHETIC_ACCESS_TOKEN', refresh_token: 'SYNTHETIC_REFRESH_TOKEN', scope: 'https://www.googleapis.com/auth/drive.file' });
      }
      assert.equal(options.headers.authorization, 'Bearer SYNTHETIC_ACCESS_TOKEN');
      if (url.includes('/about?')) return Response.json({ storageQuota: { limit: '15000000000', usage: '10000000' } });
      if (url.includes('/files?q=')) return Response.json({ files: [] });
      if (url.includes('/files?fields=')) {
        const data = JSON.parse(options.body);
        assert.equal(data.mimeType, 'application/vnd.google-apps.folder');
        assert.equal(data.permissions, undefined);
        return Response.json({ id: 'synthetic_folder_12345', webViewLink: 'https://drive.google.com/drive/folders/synthetic_folder_12345' });
      }
      assert.fail('Unexpected external request');
    };
    await import(${JSON.stringify(script)});
  `;
  child = spawn(process.execPath, ['--input-type=module', '-e', mock], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let output = '', errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const authorization = await new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Connection helper did not start')), 15000);
    child.once('error', reject);
    child.stdout.on('data', chunk => {
      output += chunk;
      const line = output.split('\n').find(line => line.startsWith('https://accounts.google.com/'));
      if (line) resolve(new URL(line));
    });
  });
  clearTimeout(timeout);
  assert.equal(authorization.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  const callback = new URL(authorization.searchParams.get('redirect_uri'));
  assert.equal(callback.hostname, '127.0.0.1');
  callback.search = new URLSearchParams({ state: 'incorrect-state', code: tokens[3] });
  assert.equal((await fetch(callback)).status, 400);
  callback.searchParams.set('state', authorization.searchParams.get('state'));
  const response = await fetch(callback);
  assert.equal(response.status, 200);
  const exposed = JSON.stringify([...response.headers]) + await response.text();
  const [code] = await exited;
  assert.equal(code, 0, errors);
  for (const token of tokens) assert.ok(![exposed, output, errors].some(text => text.includes(token)), 'Credential appeared in logs or HTTP response');
  for (const file of ['supplier-drive-secrets.json', 'supplier-drive-grant.json']) {
    const path = join(directory, '.local-data', file);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).GOOGLE_DRIVE_REFRESH_TOKEN, tokens[2]);
  }
  console.log('PASS: loopback + PKCE + state, private credential files, no token leakage; Google APIs simulated.');
} finally {
  clearTimeout(timeout);
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  await rm(directory, { recursive: true, force: true });
}
