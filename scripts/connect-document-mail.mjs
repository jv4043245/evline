import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

// Dedicated send-only grant; never reuse or expand the supplier Drive grant.
const input = process.argv[2], sender = String(process.argv[3] || '').trim().toLowerCase();
const output = resolve('.local-data/document-mail-secrets.json');
if (!input || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) throw new Error('Usage: node scripts/connect-document-mail.mjs desktop-client.json sender-email');
try { await access(output); throw new Error('An existing mail grant must not be overwritten.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const client = JSON.parse(await readFile(resolve(input), 'utf8')).installed;
if (!client?.client_id || !client?.client_secret) throw new Error('A dedicated Desktop OAuth client JSON is required.');
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
const scopes = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.send'];
const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
let redirect, timer, inFlight = false;
async function google(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google request failed (HTTP ${response.status}); provider details are not logged.`);
  return data;
}
const server = createServer(async (request, response) => {
  const headers = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" };
  const url = new URL(request.url, redirect), supplied = Buffer.from(url.searchParams.get('state') || ''), expected = Buffer.from(state);
  if (request.method !== 'GET' || request.headers.host !== new URL(redirect).host || url.pathname !== '/oauth/callback' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || inFlight) {
    response.writeHead(400, headers).end('Invalid authorization callback.'); return;
  }
  inFlight = true; clearTimeout(timer);
  try {
    if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new Error('Authorization was not granted.');
    const tokens = await google('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, grant_type: 'authorization_code', code: url.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirect }) });
    const granted = String(tokens.scope || '').split(' ');
    if (!tokens.refresh_token || !tokens.access_token || !scopes.every(s => granted.includes(s)) || granted.some(s => !scopes.includes(s))) throw new Error('The exact send-only, offline authorization was not granted.');
    const identity = await google('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } });
    if (identity.email_verified !== true || identity.email?.toLowerCase() !== sender) throw new Error('Wrong sender account. No connection saved.');
    await writeFile(output, JSON.stringify({ GMAIL_CLIENT_ID: client.client_id, GMAIL_CLIENT_SECRET: client.client_secret, GMAIL_REFRESH_TOKEN: tokens.refresh_token, GMAIL_SENDER: sender }), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ connected: true, sender, secrets_file: output }));
    response.writeHead(200, headers).end('EVLine email connected. You can close this tab.');
  } catch (e) {
    console.error(e.message); process.exitCode = 1;
    response.writeHead(400, headers).end('Connection incomplete. Return to Codex; credentials are not shown here.');
  } finally { server.close(); }
});
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
redirect = `http://127.0.0.1:${server.address().port}/oauth/callback`;
const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
auth.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'consent select_account', login_hint: sender, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
console.log(auth.href);
timer = setTimeout(() => { console.error('Authorization timed out. No connection saved.'); server.close(); process.exitCode = 1; }, 10 * 60 * 1000);
