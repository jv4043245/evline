import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

// One-time owner authorization. No credentials, authorization codes or tokens are printed.
const input = process.argv[2];
const output = resolve('.local-data/supplier-drive-secrets.json');
const grantOutput = resolve('.local-data/supplier-drive-grant.json');
const scope = 'https://www.googleapis.com/auth/drive.file';
const ownerEmail = String(process.argv[3] || '').trim().toLowerCase();
const folderName = 'Supplier invoices';
if (!input || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error('Usage: node scripts/connect-supplier-drive.mjs /absolute/path/to/desktop-oauth-client.json expected-owner-email');
for (const path of [output, grantOutput]) {
  try { await access(path); throw new Error('Existing connection files found in .local-data; do not overwrite a working connection.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const client = JSON.parse(await readFile(resolve(input), 'utf8')).installed;
if (!client?.client_id || !client?.client_secret) throw new Error('A Google OAuth Desktop app client JSON is required.');
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
const state = randomBytes(32).toString('base64url');
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
let inFlight = false, timer, redirect;

async function google(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google request failed (HTTP ${response.status}); no provider response logged.`);
  return data;
}

const server = createServer(async (request, response) => {
  const headers = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" };
  const url = new URL(request.url, redirect);
  const supplied = Buffer.from(url.searchParams.get('state') || '');
  const expected = Buffer.from(state);
  if (request.method !== 'GET' || request.headers.host !== new URL(redirect).host || url.pathname !== '/oauth/callback' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || inFlight) {
    response.writeHead(400, headers).end('Invalid authorization callback.'); return;
  }
  inFlight = true;
  clearTimeout(timer);
  try {
    if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new Error('Google authorization was not granted.');
    const tokens = await google('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
      client_id: client.client_id, client_secret: client.client_secret, grant_type: 'authorization_code',
      code: url.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirect,
    }) });
    const scopes = String(tokens.scope || '').split(' ').filter(Boolean);
    if (!tokens.refresh_token || !tokens.access_token || scopes.length !== 1 || scopes[0] !== scope) throw new Error('Offline, per-file Drive authorization was not granted.');
    const googleHeaders = { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' };
    const about = await google('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota', { headers: googleHeaders });
    if (about.user?.emailAddress?.toLowerCase() !== ownerEmail) throw new Error('Wrong Drive owner. No connection saved and no archive created. Choose the expected owner account.');
    const secrets = { GOOGLE_DRIVE_CLIENT_ID: client.client_id, GOOGLE_DRIVE_CLIENT_SECRET: client.client_secret, GOOGLE_DRIVE_REFRESH_TOKEN: tokens.refresh_token };
    // Preserve the grant before any folder write, so a network failure does not lose it.
    await writeFile(grantOutput, JSON.stringify(secrets), { mode: 0o600, flag: 'wx' });
    const free = about.storageQuota?.limit ? Number(about.storageQuota.limit) - Number(about.storageQuota.usage || 0) : null;
    if (free !== null && free < 10 * 1024 * 1024) throw new Error('The Drive account has less than 10 MiB free. Authorization is saved; free space before continuing.');
    const query = "trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='evline_role' and value='supplier_document_originals' }";
    const existing = await google(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q: query, fields: 'files(id,name,webViewLink)', pageSize: '2' })}`, { headers: googleHeaders });
    if (existing.files?.length > 1) throw new Error('Multiple application archives found; choose the existing archive explicitly.');
    const folder = existing.files?.[0] || await google('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
      method: 'POST', headers: googleHeaders, body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', appProperties: { evline_role: 'supplier_document_originals' } }),
    });
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(folder.id)) throw new Error('Google did not return a valid archive folder.');
    await writeFile(output, JSON.stringify({ ...secrets, GOOGLE_DRIVE_FOLDER_ID: folder.id }), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ connected: true, folder_id: folder.id, folder_url: folder.webViewLink, free_bytes: free, secrets_file: output }));
    response.writeHead(200, headers).end('Google Drive connected. You can close this tab.');
  } catch (error) {
    console.error(error.message);
    response.writeHead(400, headers).end('Connection incomplete. Return to Codex; no credentials are shown here.');
    process.exitCode = 1;
  } finally { server.close(); }
});
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
redirect = `http://127.0.0.1:${server.address().port}/oauth/callback`;
const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
auth.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: 'code', scope,
  access_type: 'offline', prompt: 'consent select_account', login_hint: ownerEmail, state, code_challenge: challenge, code_challenge_method: 'S256' });
console.log('Open this owner authorization URL in the browser:');
console.log(auth.href);
timer = setTimeout(() => { console.error('Authorization timed out. No credentials were changed.'); server.close(); process.exitCode = 1; }, 10 * 60 * 1000);
