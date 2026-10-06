import test from 'node:test';
import assert from 'node:assert/strict';
import { documentStorageStatus, storeDocumentOriginal, loadDocumentOriginal, removeDocumentOriginal } from '../functions/_lib/supplier-document-storage.js';

const folderId = 'private_folder_12345', fileId = 'private_original_12345';
const bytes = new TextEncoder().encode('%PDF-1.7\nSynthetic invoice');
const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
const row = { object_key: `gdrive:${fileId}`, bytes: bytes.length, sha256 };
const key = 'supplier-documents/doc/version.pdf';
const metadata = { mime: 'application/pdf', name: 'O-TEST - BYD - v1 - invoice.pdf' };
const config = () => ({ GOOGLE_DRIVE_CLIENT_ID: 'fixture-client', GOOGLE_DRIVE_CLIENT_SECRET: 'fixture-secret', GOOGLE_DRIVE_REFRESH_TOKEN: 'fixture-refresh', GOOGLE_DRIVE_FOLDER_ID: folderId });

function fixture(t, override = () => undefined) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    url = String(url); calls.push({ url, ...options });
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal);
    const custom = override(url, options);
    if (custom !== undefined) return custom;
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.body.get('grant_type'), 'refresh_token');
      return Response.json({ access_token: 'fixture-access', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' });
    }
    assert.equal(options.headers.authorization, 'Bearer fixture-access');
    assert.equal(new URL(url).origin, 'https://www.googleapis.com');
    if (url.includes(`/files/${folderId}?`)) return Response.json({ id: folderId, mimeType: 'application/vnd.google-apps.folder', permissions: [{ type: 'user' }] });
    if (url.includes('/generateIds?')) return Response.json({ ids: [fileId] });
    if (url.includes('uploadType=resumable')) return new Response(null, { headers: { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture-session' } });
    if (url.includes('upload_id=')) return Response.json({ id: fileId });
    if (url.includes(`/files/${fileId}?`)) {
      if (options.method === 'PATCH') return Response.json({ id: fileId });
      if (url.endsWith('alt=media')) return new Response(bytes);
      return Response.json({ id: fileId, parents: [folderId], size: String(bytes.length), appProperties: { application: 'evline-supplier-documents' }, permissions: [{ type: 'user' }] });
    }
    assert.fail(`Unexpected request: ${url}`);
  });
  return { env: config(), calls };
}

test('configuration contains no secrets and never silently falls back on partial Drive configuration', () => {
  assert.deepEqual(documentStorageStatus({}), { ready: false, provider: null });
  assert.deepEqual(documentStorageStatus({ SUPPLIER_DOCUMENTS: {} }), { ready: true, provider: 'r2' });
  assert.deepEqual(documentStorageStatus(config()), { ready: true, provider: 'google_drive' });
  assert.deepEqual(documentStorageStatus({ SUPPLIER_DOCUMENTS: {}, GOOGLE_DRIVE_CLIENT_ID: 'client' }), { ready: false, provider: 'google_drive' });
  assert.equal(documentStorageStatus({ ...config(), GOOGLE_DRIVE_FOLDER_ID: '../other' }).ready, false);
});

test('Drive upload preserves bytes, uses private folder and narrow OAuth, and caches only the token', async t => {
  const { env, calls } = fixture(t);
  assert.equal(await storeDocumentOriginal(env, key, bytes, metadata), row.object_key);
  const create = calls.find(call => call.url.includes('uploadType=resumable'));
  const file = JSON.parse(create.body);
  assert.deepEqual(file.parents, [folderId]);
  assert.equal(file.id, fileId);
  assert.equal(file.name, metadata.name);
  assert.equal(file.appProperties.version_key, key);
  assert.equal(file.permissions, undefined);
  assert.deepEqual(calls.find(call => call.method === 'PUT').body, bytes);
  const original = await loadDocumentOriginal(env, row);
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), bytes);
  assert.equal(calls.filter(call => call.url.includes('oauth2.googleapis.com')).length, 1);
  assert.ok(calls.every(call => !/permissions|webContentLink/.test(new URL(call.url).pathname)));
});

test('refuses public folders, wrong folder type and oversized uploads before creating files', async t => {
  for (const data of [{ mimeType: 'application/vnd.google-apps.folder', permissions: [{ type: 'anyone' }] }, { mimeType: 'application/pdf', permissions: [{ type: 'user' }] }, { mimeType: 'application/vnd.google-apps.folder', trashed: true, permissions: [{ type: 'user' }] }]) {
    const { env, calls } = fixture(t, url => url.includes(`/files/${folderId}?`) ? Response.json(data) : undefined);
    await assert.rejects(() => storeDocumentOriginal(env, key, bytes, metadata));
    assert.equal(calls.filter(call => call.method === 'POST' && !call.url.includes('oauth2')).length, 0);
    t.mock.restoreAll();
  }
  const { env, calls } = fixture(t);
  await assert.rejects(() => storeDocumentOriginal(env, key, new Uint8Array(10 * 1024 * 1024 + 1), metadata), /10 МБ/);
  assert.equal(calls.length, 0);
});

test('unexpected upload URLs never receive tokens or invoice bytes; cleanup is reversible', async t => {
  const { env, calls } = fixture(t, url => url.includes('uploadType=resumable') ? new Response(null, { headers: { location: 'https://other.test/steal' } }) : undefined);
  await assert.rejects(() => storeDocumentOriginal(env, key, bytes, metadata), /адреса/);
  assert.equal(calls.some(call => call.url.includes('other.test')), false);
  assert.deepEqual(JSON.parse(calls.find(call => call.method === 'PATCH').body), { trashed: true });
  assert.equal(calls.some(call => call.method === 'DELETE'), false);
});

test('OAuth and Drive redirects are rejected without forwarding credentials', async t => {
  for (const stage of ['oauth2.googleapis.com', `/files/${folderId}?`]) {
    const { env, calls } = fixture(t, url => url.includes(stage) ? new Response(null, { status: 302, headers: { location: 'https://other.test/steal' } }) : undefined);
    await assert.rejects(() => storeDocumentOriginal(env, key, bytes, metadata), /тимчасово недоступний/);
    assert.equal(calls.some(call => call.url.includes('other.test')), false);
    assert.ok(calls.every(call => call.redirect === 'manual'));
    t.mock.restoreAll();
  }
});

test('download rejects files moved outside the archive, shared publicly, or changed on Drive', async t => {
  for (const changes of [{ parents: ['elsewhere'] }, { permissions: [{ type: 'domain' }] }, { appProperties: {} }, { size: '999999' }, { trashed: true }]) {
    const { env, calls } = fixture(t, url => url.includes(`/files/${fileId}?fields=`) ? Response.json({ parents: [folderId], permissions: [{ type: 'user' }], size: String(bytes.length), appProperties: { application: 'evline-supplier-documents' }, ...changes }) : undefined);
    await assert.rejects(() => loadDocumentOriginal(env, row));
    assert.equal(calls.some(call => call.url.endsWith('alt=media')), false);
    t.mock.restoreAll();
  }
  const { env } = fixture(t, url => url.endsWith('alt=media') ? new Response(new Uint8Array(bytes.length)) : undefined);
  await assert.rejects(() => loadDocumentOriginal(env, row), /змінено/);
});

test('stream limit holds even if Google reports a smaller file size', async t => {
  const { env } = fixture(t, url => url.endsWith('alt=media') ? new Response(new Uint8Array(bytes.length + 1)) : undefined);
  await assert.rejects(() => loadDocumentOriginal(env, row), /завеликого/);
});

test('quota, expired consent and provider HTML errors are safe and actionable, never raw secrets', async t => {
  for (const [response, message] of [
    [Response.json({ error: { errors: [{ reason: 'storageQuotaExceeded' }], message: 'fixture-secret' } }, { status: 403 }), /закінчилося місце/],
    [Response.json({ error: { message: 'fixture-refresh' } }, { status: 429 }), /кількість запитів/],
    [new Response('<html>fixture-secret</html>', { status: 500 }), /відповідь/],
  ]) {
    const { env } = fixture(t, url => url.includes(`/files/${folderId}?`) ? response : undefined);
    await assert.rejects(() => storeDocumentOriginal(env, key, bytes, metadata), error => message.test(error.publicMessage) && !/fixture-|html/.test(error.publicMessage));
    t.mock.restoreAll();
  }
  const { env } = fixture(t, url => url.includes('oauth2.googleapis.com') ? Response.json({ error: 'invalid_grant', private: 'fixture-secret' }, { status: 400 }) : undefined);
  await assert.rejects(() => loadDocumentOriginal(env, row), /повторно підключити/);
});

test('credential rotation refreshes access; archive cleanup only trashes the exact allocated ID', async t => {
  const { env, calls } = fixture(t);
  await loadDocumentOriginal(env, row);
  env.GOOGLE_DRIVE_REFRESH_TOKEN = 'rotated';
  await removeDocumentOriginal(env, row.object_key);
  assert.equal(calls.filter(call => call.url.includes('oauth2.googleapis.com')).length, 2);
  assert.match(calls.at(-1).url, new RegExp(`/files/${fileId}\\?`));
  assert.deepEqual(JSON.parse(calls.at(-1).body), { trashed: true });
});

test('existing R2 originals remain readable and new R2 writes still work without Drive config', async () => {
  const objects = new Map();
  const env = { SUPPLIER_DOCUMENTS: { async put(id, data) { objects.set(id, data); }, async get(id) { return new Response(objects.get(id)); }, async delete(id) { objects.delete(id); } } };
  assert.equal(await storeDocumentOriginal(env, key, bytes, metadata), key);
  assert.deepEqual(new Uint8Array(await (await loadDocumentOriginal({ ...env, ...config() }, { object_key: key })).arrayBuffer()), bytes);
  await removeDocumentOriginal(env, key);
  assert.equal(objects.size, 0);
});
