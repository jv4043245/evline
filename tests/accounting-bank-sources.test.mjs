import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync } from 'node:crypto';
import { bankSourceConfiguration, bankSourceSession, readBankSourceJson } from '../functions/_lib/accounting-bank-source-access.js';
import { prepareBankSourceImport, persistBankSourceImport, buildBankSourceImportSql, listBankSources, readBankSourceDownload, BANK_SOURCE_CHUNK_BYTES, MAX_BANK_SOURCE_BYTES } from '../functions/_lib/accounting-bank-sources.js';
import { onRequestGet as list, onRequestPost as noUpload } from '../functions/api/admin/accounting/bank-sources.js';
import { onRequestPost as unlock } from '../functions/api/admin/accounting/bank-sources/unlock.js';
import { onRequestPost as lock } from '../functions/api/admin/accounting/bank-sources/lock.js';
import { onRequestGet as download } from '../functions/api/admin/accounting/bank-sources/[id]/download.js';

const now = new Date('2026-10-15T12:00:00.000Z');
const utf8 = text => new TextEncoder().encode(text), password = 'Synthetic-test-password-for-originals-only';
const salt = Buffer.alloc(16, 7), hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
const passwordConfig = `pbkdf2-sha256$100000$${salt.toString('base64url')}$${hash.toString('base64url')}`;
const file = patch => ({ filename: 'Синтетична-виписка.csv', bytes: utf8('date,amount\n2026-04-10,123.45\n'), date_from: '2026-04-01', date_to: '2026-05-31', ...patch });
function database() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE existing_ad_ledger(spend_minor INTEGER); INSERT INTO existing_ad_ledger VALUES(123456);');
  sqlite.exec(readFileSync(new URL('../migrations/0037_accounting_bank_sources.sql', import.meta.url), 'utf8'));
  const prepared = (sql, args = []) => ({ sql, args, bind(...bound) { return prepared(sql, bound); }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } });
  const db = { prepare: prepared, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = statements.map(({ sql, args }) => ({ meta: sqlite.prepare(sql).run(...args) })); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const env = { DB: db, BANK_SOURCE_OWNER_ID: 'owner', BANK_SOURCE_PASSWORD_HASH: passwordConfig, ADMIN_TOKEN: 'andrii-token',
    ADMIN_USERS_JSON: JSON.stringify([{ id: 'owner', name: 'Власник', token: 'owner-token' }, { id: 'igor', name: 'Ігор', token: 'igor-token' }]) };
  return { db, sqlite, env };
}
function request(path = '', { method = 'GET', token = 'owner-token', session, body, headers = {} } = {}) {
  return new Request(`https://evline.test/api/admin/accounting/bank-sources${path}`, { method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(session ? { 'x-bank-source-session': session } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
async function unlocked(env, options = {}) {
  const response = await unlock({ request: request('/unlock', { method: 'POST', body: { password }, ...options }), env, now });
  assert.equal(response.status, 200); return response.json();
}

test('three originals import byte-identically; immutable source identities reject changed files', async () => {
  const { db, sqlite } = database();
  const files = [file(), file({ filename: 'other.csv', bytes: utf8('date;amount\n2026-05-10;8\n') }), file({ filename: 'third.csv', bytes: utf8('date\tamount\n2026-06-10\t9\n') })];
  const saved = await persistBankSourceImport(db, files, 'owner', { now });
  assert.equal(saved.files.length, 3); assert.equal(saved.files[0].id, saved.files[0].sha256);
  assert.deepEqual((await readBankSourceDownload(db, saved.files[0].id)).bytes, files[0].bytes);
  assert.deepEqual(await persistBankSourceImport(db, files, 'owner', { now: new Date('2026-10-16T00:00:00Z') }), saved);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_bank_sources').get().n, 3);
  assert.equal((await listBankSources(db))[0].created_at, now.toISOString());
  await assert.rejects(persistBankSourceImport(db, [file({ bytes: utf8('date,amount\n2026-04-10,999\n') })], 'owner', { now }), { status: 409 });
  await assert.rejects(persistBankSourceImport(db, [file({ filename: 'renamed.csv' })], 'owner', { now }), { status: 409 });
  await assert.rejects(persistBankSourceImport(db, [file({ date_from: '2026-04-02' })], 'owner', { now }), { status: 409 });
  for (const statement of ['UPDATE accounting_bank_sources SET bytes=1', 'DELETE FROM accounting_bank_sources', "UPDATE accounting_bank_source_chunks SET data_base64='AAAA'", 'DELETE FROM accounting_bank_source_chunks']) assert.throws(() => sqlite.exec(statement), /immutable/);
  assert.equal(sqlite.prepare('SELECT spend_minor FROM existing_ad_ledger').get().spend_minor, 123456);
});

test('import bounds, exact metadata, extension, digest and SQL chunks are checked', async () => {
  const { sqlite } = database(), large = new Uint8Array(BANK_SOURCE_CHUNK_BYTES + 17).fill(32); large.set(utf8('date,amount\n'));
  const prepared = await prepareBankSourceImport([file({ bytes: large })], 'owner', { now });
  assert.equal(prepared[0].chunks.length, 2); assert.equal(prepared[0].meta.chunk_count, 2);
  const exported = await buildBankSourceImportSql([file({ bytes: large, filename: "Bank's original.csv" })], 'owner', { now });
  for (const statement of exported.sql.split('\n')) assert(utf8(statement).length < 100000);
  assert.doesNotMatch(exported.sql, /BEGIN|COMMIT/); sqlite.exec(`BEGIN;${exported.sql}COMMIT;`); sqlite.exec(`BEGIN;${exported.sql}COMMIT;`);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_bank_source_chunks').get().n, 2);
  for (const patch of [{ filename: '../private.csv' }, { filename: 'bad.exe' }, { filename: 'bad\r\n.csv' }, { bytes: new Uint8Array() }, { bytes: new Uint8Array(MAX_BANK_SOURCE_BYTES + 1) },
    { bytes: utf8('<html>,private</html>') }, { bytes: utf8('not a csv') }, { filename: 'fake.xlsx', bytes: utf8('date,amount') }, { date_from: '2026-02-31' }, { date_to: '2026-03-01' }, { sha256: '0'.repeat(64) }, { password: 'never retained' }]) await assert.rejects(prepareBankSourceImport([file(patch)], 'owner', { now }));
  await assert.rejects(prepareBankSourceImport([file(), file()], 'owner', { now }), /duplicate/);
  await assert.rejects(prepareBankSourceImport([], 'owner', { now }));
  await assert.rejects(prepareBankSourceImport([file()], ' owner ', { now }));
});

test('capability list hides every filename, hash and byte from all other admins and locked owner', async () => {
  const { db, env } = database(); await persistBankSourceImport(db, [file()], 'owner', { now });
  for (const token of ['andrii-token', 'igor-token']) {
    const response = await list({ request: request('', { token }), env, now });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { allowed: false, locked: true, files: [], expires_at: null });
    const forbidden = await unlock({ request: request('/unlock', { token, method: 'POST', body: { password } }), env, now });
    assert.equal(forbidden.status, 403); assert.deepEqual(await forbidden.json(), { error: 'bank_sources_owner_only' });
  }
  const locked = await list({ request: request(), env, now });
  assert.deepEqual(await locked.json(), { allowed: true, locked: true, files: [], expires_at: null });
  assert.equal((await list({ request: request('', { token: '' }), env, now })).status, 401);
  assert.equal((await list({ request: request('?session=forbidden'), env, now })).status, 400);
});

test('correct owner plus separate password creates narrow in-memory token; lock revokes downloads', async () => {
  const { db, sqlite, env } = database(), saved = await persistBankSourceImport(db, [file()], 'owner', { now }), id = saved.files[0].id;
  const locked = await download({ request: request(`/${id}/download`), params: { id }, env, now }); assert.equal(locked.status, 423);
  const unlockedState = await unlocked(env), session = unlockedState.session_token;
  assert.equal(unlockedState.allowed, true); assert.equal(unlockedState.locked, false); assert.equal(unlockedState.files.length, 1);
  assert.equal(unlockedState.expires_at, '2026-10-15T12:15:00.000Z'); assert.equal(typeof session, 'string'); assert(!session.includes(password));
  const persisted = sqlite.prepare('SELECT * FROM accounting_bank_source_sessions').get();
  assert.equal(persisted.token_hash.length, 64); assert(!Object.values(persisted).includes(session)); assert(!Object.values(persisted).includes(password));
  const listed = await list({ request: request('', { session }), env, now }); assert.equal((await listed.json()).files[0].sha256, id);
  const response = await download({ request: request(`/${id}/download`, { session }), params: { id }, env, now });
  assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), file().bytes);
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert(response.headers.get('content-disposition').includes(encodeURIComponent(file().filename))); assert(response.headers.get('content-security-policy').includes('sandbox'));
  const relocked = await lock({ request: request('/lock', { session, method: 'POST', body: {} }), env, now });
  assert.equal(relocked.status, 200); assert.equal((await relocked.json()).locked, true);
  assert.equal((await download({ request: request(`/${id}/download`, { session }), params: { id }, env, now })).status, 423);
  assert.equal(sqlite.prepare('SELECT revoked_at FROM accounting_bank_source_sessions').get().revoked_at, now.getTime() / 1000);
});

test('owner identity, admin credential, scope/signature, expiry and config rotation all bound sessions', async () => {
  const { db, env } = database(), saved = await persistBankSourceImport(db, [file()], 'owner', { now }), id = saved.files[0].id;
  const { session_token: session } = await unlocked(env);
  for (const token of ['andrii-token', 'igor-token', '']) assert.equal((await download({ request: request(`/${id}/download`, { token, session }), params: { id }, env, now })).status, token ? 403 : 401);
  const expired = new Date('2026-10-15T12:15:00.000Z');
  assert.equal((await download({ request: request(`/${id}/download`, { session }), params: { id }, env, now: expired })).status, 423);
  const rotatedAdmin = { ...env, ADMIN_USERS_JSON: JSON.stringify([{ id: 'owner', name: 'Власник', token: 'owner-rotated-token' }]) };
  assert.equal((await download({ request: request(`/${id}/download`, { token: 'owner-rotated-token', session }), params: { id }, env: rotatedAdmin, now })).status, 423);
  const differentSalt = Buffer.alloc(16, 8), changedHash = pbkdf2Sync(password, differentSalt, 100000, 32, 'sha256');
  const rotatedPassword = { ...env, BANK_SOURCE_PASSWORD_HASH: `pbkdf2-sha256$100000$${differentSalt.toString('base64url')}$${changedHash.toString('base64url')}` };
  assert.equal((await download({ request: request(`/${id}/download`, { session }), params: { id }, env: rotatedPassword, now })).status, 423);
  const [payload, signature] = session.split('.'), claims = JSON.parse(Buffer.from(payload, 'base64url').toString()); claims.scope = 'admin';
  for (const tampered of [`${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`, `${payload}.${signature.slice(1)}x`, 'abc', 'x'.repeat(1201)]) {
    assert.equal(await bankSourceSession(db, request('', { session: tampered }), bankSourceConfiguration(env), { now }), null);
  }
});

test('persistent atomic unlock limit throttles correct passwords too after five consumed attempts', async () => {
  const { sqlite, env } = database();
  for (let index = 0; index < 5; index++) {
    const wrong = await unlock({ request: request('/unlock', { method: 'POST', body: { password: `wrong-${index}` } }), env, now });
    assert.equal(wrong.status, 403); assert.deepEqual(await wrong.json(), { error: 'bank_sources_invalid_password' });
  }
  const rateLimited = await unlock({ request: request('/unlock', { method: 'POST', body: { password } }), env, now });
  assert.equal(rateLimited.status, 429); assert.equal(rateLimited.headers.get('retry-after'), '900');
  assert.equal(sqlite.prepare('SELECT attempts FROM accounting_bank_source_unlock_limits').get().attempts, 5);
  const reset = await unlock({ request: request('/unlock', { method: 'POST', body: { password } }), env, now: new Date('2026-10-15T12:15:00.000Z') });
  assert.equal(reset.status, 200); assert.equal(sqlite.prepare('SELECT attempts FROM accounting_bank_source_unlock_limits').get().attempts, 1);
});

test('JSON body bounds, exact keys, same-origin policy and query-token rejection protect mutations', async () => {
  const { env } = database();
  for (const body of ['{', [], { password, owner_id: 'owner' }, { password: '' }, { password: 'x'.repeat(257) }, { password: null }]) {
    assert.equal((await unlock({ request: request('/unlock', { method: 'POST', body }), env, now })).status, 400);
  }
  for (const headers of [{ origin: 'https://evil.test' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
    assert.equal((await unlock({ request: request('/unlock', { method: 'POST', body: { password }, headers }), env, now })).status, 403);
  }
  assert.equal((await unlock({ request: request('/unlock', { method: 'POST', body: { password }, headers: { 'content-type': 'text/plain' } }), env, now })).status, 400);
  assert.equal((await unlock({ request: request('/unlock?password=forbidden', { method: 'POST', body: { password } }), env, now })).status, 400);
  assert.equal((await unlock({ request: request('/unlock', { method: 'POST', body: ' '.repeat(1025) }), env, now })).status, 413);
  const streamed = new Request('https://evline.test', { method: 'POST', headers: { 'content-length': '1' }, duplex: 'half', body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1025)); controller.close(); } }) });
  await assert.rejects(readBankSourceJson(streamed, ['password']), { status: 413 });
  assert.equal(noUpload().status, 405);
});

test('missing or malformed configuration fails closed without password parameters or SQL errors', async () => {
  const { env } = database();
  for (const patch of [{ BANK_SOURCE_OWNER_ID: '' }, { BANK_SOURCE_PASSWORD_HASH: '' }, { BANK_SOURCE_PASSWORD_HASH: 'cleartext-password' }, { BANK_SOURCE_PASSWORD_HASH: passwordConfig.replace('$100000$', '$100001$') }]) {
    const response = await list({ request: request(), env: { ...env, ...patch }, now });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'bank_sources_unavailable' });
  }
  const response = await unlock({ request: request('/unlock', { method: 'POST', body: { password } }), env: { ...env, DB: { prepare() { throw new Error('private database credentials'); } } }, now });
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'bank_sources_unavailable' });
});

test('missing, reordered, invalid or altered chunks never download even for unlocked owner', async () => {
  const { db, sqlite, env } = database(), saved = await persistBankSourceImport(db, [file()], 'owner', { now }), id = saved.files[0].id;
  const { session_token: session } = await unlocked(env);
  sqlite.exec('DROP TRIGGER accounting_bank_source_chunks_no_update');
  const original = sqlite.prepare('SELECT data_base64 FROM accounting_bank_source_chunks').get().data_base64;
  for (const data of ['!not-base64!', Buffer.from('date,amount\n2026-04-10,999.45\n').toString('base64'), 'AAAA']) {
    sqlite.prepare('UPDATE accounting_bank_source_chunks SET data_base64=?').run(data);
    const response = await download({ request: request(`/${id}/download`, { session }), params: { id }, env, now });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'bank_sources_unavailable' });
  }
  sqlite.prepare('UPDATE accounting_bank_source_chunks SET data_base64=?').run(original);
  assert.deepEqual((await readBankSourceDownload(db, id)).bytes, file().bytes);
  sqlite.exec('DROP TRIGGER accounting_bank_source_chunks_no_delete; DELETE FROM accounting_bank_source_chunks;');
  await assert.rejects(readBankSourceDownload(db, id), { status: 503 });
  assert.equal((await download({ request: request('/bad/download', { session }), params: { id: 'bad' }, env, now })).status, 400);
  assert.equal((await download({ request: request(`/${'f'.repeat(64)}/download`, { session }), params: { id: 'f'.repeat(64) }, env, now })).status, 404);
});
