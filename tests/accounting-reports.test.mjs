import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { zipSync, strToU8 } from 'fflate';
import { ACCOUNTING_ACCOUNTS, ACCOUNTING_META_SCOPE } from '../functions/_lib/accounting.js';
import { archiveAccountingReport, buildAccountingReportStatements, listAccountingReports, readAccountingReportDownload, readBoundedReportBody, MAX_ACCOUNTING_REPORT_BYTES, ACCOUNTING_REPORT_CHUNK_BYTES } from '../functions/_lib/accounting-reports.js';
import { onRequestGet, onRequestPost } from '../functions/api/admin/accounting/reports.js';
import { onRequestGet as download } from '../functions/api/admin/accounting/reports/[id]/download.js';

const now = new Date('2026-10-09T12:00:00.000Z');
const utf8 = value => new TextEncoder().encode(value);
function utf16(value, bigEndian = false) {
  const bytes = new Uint8Array(2 + value.length * 2);
  bytes.set(bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index++) view.setUint16(2 + index * 2, value.charCodeAt(index), !bigEndian);
  return bytes;
}
const metadata = (patch = {}) => ({ provider: 'google', date_from: '2026-09-01', date_to: '2026-09-30', source_kind: 'native_export', scope_confirmed: true, ...patch });
const file = (patch = {}) => ({ metadata: metadata(), fileBytes: utf8('date,cost\n2026-09-01,1.20\n'), filename: 'Звіт.csv', mime: 'text/csv', ...patch });
const snapshot = (patch = {}) => ({ provider: 'google', account_id: '4028488894', currency: 'UAH', timezone: 'Europe/Kyiv', from: '2026-09-01', to: '2026-09-02', fetched_at: now.toISOString(), scope: 'account', source_ref: '', coverage: 'complete', source: 'google_ads_script', days: [{ date: '2026-09-01', spend_minor: 120, is_final: true }, { date: '2026-09-02', spend_minor: 0, is_final: true }], ...patch });
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../migrations/0034_accounting_reports.sql', import.meta.url), 'utf8'));
  const db = { prepare(sql) { return { bind(...args) { return { sql, args, async all() { return { results: sqlite.prepare(sql).all(...args) }; } }; } }; },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(({ sql, args }) => ({ meta: sqlite.prepare(sql).run(...args) })); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } };
  return { db, sqlite };
}

test('manual original remains byte-identical, private metadata server-owned, duplicates immutable', async () => {
  const { db, sqlite } = database();
  const saved = await archiveAccountingReport(db, file(), 'test-admin', { now });
  assert.equal(saved.account_id, ACCOUNTING_ACCOUNTS.google); assert.equal(saved.scope, 'account');
  assert.equal(saved.source_ref, ''); assert.equal(saved.run_id, null); assert.equal(saved.source_fetched_at, null);
  assert.equal(saved.sha256.length, 64); assert.equal(saved.bytes, file().fileBytes.length);
  assert.equal('created_by' in saved, false); assert.equal('url' in saved, false);
  const original = await readAccountingReportDownload(db, saved.id);
  assert.deepEqual(original.bytes, file().fileBytes);
  const duplicate = await archiveAccountingReport(db, file({ filename: 'renamed.csv' }), 'other-admin', { now: new Date('2026-10-10T12:00:00Z') });
  assert.deepEqual(duplicate, saved);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_reports').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_report_chunks').get().n, 1);
  assert.throws(() => sqlite.exec("UPDATE accounting_reports SET filename='changed.csv'"), /immutable/);
  assert.throws(() => sqlite.exec('DELETE FROM accounting_reports'), /immutable/);
  assert.throws(() => sqlite.exec("UPDATE accounting_report_chunks SET data_base64='AAAA'"), /immutable/);
  assert.throws(() => sqlite.exec('DELETE FROM accounting_report_chunks'), /immutable/);
});

test('Meta uses only fixed EVLine scope and rejects shared-account / BB evidence', async () => {
  const { db } = database();
  const saved = await archiveAccountingReport(db, file({ metadata: metadata({ provider: 'meta' }) }), 'test', { now });
  assert.equal(saved.account_id, ACCOUNTING_META_SCOPE.account_id);
  assert.equal(saved.scope, ACCOUNTING_META_SCOPE.scope);
  assert.equal(saved.source_ref, ACCOUNTING_META_SCOPE.source_ref);
  for (const text of ['campaign,cost\nBB | UA | test,100', 'campaign,cost\n120252865188010454,100', 'campaign,cost\nBolotov,100']) {
    await assert.rejects(archiveAccountingReport(db, file({ metadata: metadata({ provider: 'meta' }), fileBytes: utf8(text) }), 'test', { now }), /invalid_report_meta_scope/);
  }
  for (const patch of [{ scope: 'account' }, { account_id: '1354524650161143' }, { source_ref: 'BB' }, { actor_id: 'root' }, { source_kind: 'sync_payload' }, { scope_confirmed: false }, { scope_confirmed: undefined }]) {
    await assert.rejects(archiveAccountingReport(db, file({ metadata: metadata({ provider: 'meta', ...patch }) }), 'test', { now }), /invalid_report_metadata/);
  }
});

test('8MiB32chunk boundary, oversize, empty and streamed dishonest length are enforced', async () => {
  const { db, sqlite } = database();
  const bytes = new Uint8Array(MAX_ACCOUNTING_REPORT_BYTES).fill(32); bytes.set(utf8('date,cost\n'));
  const saved = await archiveAccountingReport(db, file({ fileBytes: bytes }), 'test', { now });
  assert.equal(sqlite.prepare('SELECT chunk_count FROM accounting_reports').get().chunk_count, 32);
  assert.equal((await readAccountingReportDownload(db, saved.id)).bytes.length, MAX_ACCOUNTING_REPORT_BYTES);
  assert.equal(ACCOUNTING_REPORT_CHUNK_BYTES, 262144);
  await assert.rejects(archiveAccountingReport(db, file({ fileBytes: new Uint8Array(MAX_ACCOUNTING_REPORT_BYTES + 1) }), 'test', { now }), { status: 413 });
  await assert.rejects(archiveAccountingReport(db, file({ fileBytes: new Uint8Array() }), 'test', { now }), /invalid_report_file/);
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(6)); controller.close(); } }), { headers: { 'content-length': '1' } });
  await assert.rejects(readBoundedReportBody(response, 10), { status: 413 });
  await assert.rejects(readBoundedReportBody(new Response('x', { headers: { 'content-length': '999' } }), 10), { status: 413 });
});

test('native CSV UTF16LE/BE BOM validates decoded content but preserves exact original bytes', async () => {
  const { db } = database();
  for (const bigEndian of [false, true]) {
    const bytes = utf16('Дата,Витрати\n2026-09-01,120.00\n', bigEndian);
    const saved = await archiveAccountingReport(db, file({ fileBytes: bytes }), 'test', { now });
    assert.deepEqual((await readAccountingReportDownload(db, saved.id)).bytes, bytes);
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2,'0')).join('');
    assert.equal(saved.sha256, sha);
    for (const text of ['campaign,cost\nBB | UA | other,100', 'campaign,cost\n120252865188010454,100']) {
      await assert.rejects(archiveAccountingReport(db, file({ metadata: metadata({ provider: 'meta' }), fileBytes: utf16(text, bigEndian) }), 'test', { now }), /invalid_report_meta_scope/);
    }
    await assert.rejects(archiveAccountingReport(db, file({ fileBytes: utf16('<html>invalid,file</html>', bigEndian) }), 'test', { now }), /invalid_report_file/);
    await assert.rejects(archiveAccountingReport(db, file({ fileBytes: bytes.subarray(0, bytes.length - 1) }), 'test', { now }), /invalid_report_file/);
    await assert.rejects(archiveAccountingReport(db, file({ filename: 'x.json', mime: 'application/json', fileBytes: utf16('{"value":1}', bigEndian) }), 'test', { now }), /invalid_report_file/);
  }
});

test('decoded JSON string values and keys cannot hide Meta foreign scope or credentials with Unicode escapes', async () => {
  const { db } = database();
  const jsonFile = text => file({ metadata: metadata({ provider: 'meta', source_kind: 'derived' }), filename: 'meta.json', mime: 'application/json', fileBytes: utf8(text) });
  for (const text of [String.raw`{"campaign_name":"\u0042\u0042 | UA | other"}`, String.raw`{"campaign_id":"\u0031\u0032\u0030\u0032\u0035\u0032\u0038\u0036\u0035\u0031\u0038\u0038\u0030\u0031\u0030\u0034\u0035\u0034"}`,
    String.raw`{"nested":[{"\u0042\u0042 | UA":"other"}]}`]) {
    await assert.rejects(archiveAccountingReport(db, jsonFile(text), 'test', { now }), /invalid_report_meta_scope/);
  }
  for (const text of [String.raw`{"note":"\u0061ccess_token=secret"}`, String.raw`{"note":"\u0042earer fixture-secret-long-enough"}`, String.raw`{"\u0061ccess_token":"secret"}`]) {
    await assert.rejects(archiveAccountingReport(db, jsonFile(text), 'test', { now }), /invalid_report_sensitive_content/);
  }
  const valid = await archiveAccountingReport(db, jsonFile(String.raw`{"campaign_name":"\u0045VL","campaign_id":"120251518463770454","spend":120}`), 'test', { now });
  assert.equal(valid.source_kind, 'derived');
});

test('bad filenames, mismatched MIME, HTML/binary fake CSV, invalid JSON and credentials reject', async () => {
  const { db } = database();
  for (const filename of ['../x.csv', '.hidden.csv', 'a\\b.csv', 'a\nb.csv', 'x.html', 'x.csv ', 'x'.repeat(181), 'x\u202E.csv']) await assert.rejects(archiveAccountingReport(db, file({ filename }), 'test', { now }));
  for (const patch of [{ mime: 'text/html' }, { fileBytes: utf8('<html>evil,html</html>') }, { fileBytes: new Uint8Array([255,0,1]) },
    { filename: 'x.json', mime: 'application/json', fileBytes: utf8('{') }, { filename: 'x.pdf', mime: 'application/pdf', fileBytes: utf8('not a pdf') },
    { filename: 'x.json', mime: 'application/json', fileBytes: utf8('{"access_token":"secret"}') },
    { filename: 'x.json', mime: 'application/json', fileBytes: utf8('{"access\\u005ftoken":"secret"}') },
    { fileBytes: utf8('authorization: Bearer something-secret-and-long,value') }]) await assert.rejects(archiveAccountingReport(db, file(patch), 'test', { now }));
  const valid = await archiveAccountingReport(db, file({ filename: 'x.pdf', mime: 'application/pdf', fileBytes: utf8('%PDF-1.7\n%%EOF') }), 'test', { now });
  assert.equal(valid.mime, 'application/pdf');
});

test('XLSX is a bounded real ZIP workbook, not arbitrary ZIP, macro or inflation bomb', async () => {
  const { db } = database();
  const contents = { '[Content_Types].xml': strToU8('<Types/>'), 'xl/workbook.xml': strToU8('<workbook/>') };
  const save = bytes => archiveAccountingReport(db, file({ filename: 'x.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileBytes: bytes }), 'test', { now });
  assert.equal((await save(zipSync(contents))).mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  for (const data of [{ nope: strToU8('x') }, { ...contents, 'xl/vbaProject.bin': strToU8('x') }, { ...contents, '../outside': strToU8('x') }]) await assert.rejects(save(zipSync(data)), /invalid_report_file/);
  const bomb = zipSync(contents); const view = new DataView(bomb.buffer); const central = view.getUint32(bomb.length - 22 + 16, true); view.setUint32(central + 24, 40 * 1024 * 1024, true);
  await assert.rejects(save(bomb), /invalid_report_file/);
});

test('sync helper archives only allowlisted normalized fields and composes atomic statements', async () => {
  const { db, sqlite } = database();
  const supplied = snapshot({ access_token: 'do-not-save', headers: { Authorization: 'secret' }, paging: { next: 'https://example.test?access_token=secret' } });
  supplied.days[0].customer = 'do-not-save';
  const run = 'a'.repeat(64);
  const prepared = await buildAccountingReportStatements(db, supplied, run, { now });
  assert.equal(prepared.meta.source_kind, 'sync_payload'); assert.equal(prepared.meta.run_id, run);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_reports').get().n, 0);
  await db.batch(prepared.statements);
  const archived = JSON.parse(new TextDecoder().decode((await readAccountingReportDownload(db, prepared.meta.id)).bytes));
  assert.deepEqual(archived, snapshot());
  assert.equal(JSON.stringify(archived).includes('secret'), false);
  await db.batch(prepared.statements);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_reports').get().n, 1);
  const partial = await buildAccountingReportStatements(db, snapshot({ coverage: 'partial', days: [snapshot().days[0]] }), 'b'.repeat(64), { now });
  await db.batch(partial.statements);
  assert.equal(JSON.parse(new TextDecoder().decode((await readAccountingReportDownload(db, partial.meta.id)).bytes)).days.length, 1);
  for (const patch of [{ account_id: 'bad' }, { scope: 'campaign' }, { source: 'bad' }, { currency: 'USD' }, { days: [snapshot().days[0]] }, { days: [snapshot().days[0], snapshot().days[0]] }]) await assert.rejects(buildAccountingReportStatements(db, snapshot(patch), 'c'.repeat(64), { now }));
  await assert.rejects(buildAccountingReportStatements(db, snapshot({ provider: 'meta', account_id: ACCOUNTING_META_SCOPE.account_id, source: 'meta_insights' }), 'c'.repeat(64), { now }));
  const meta = await buildAccountingReportStatements(db, snapshot({ provider: 'meta', ...ACCOUNTING_META_SCOPE, source: 'meta_insights' }), 'd'.repeat(64), { now });
  assert.equal(meta.meta.source_ref, ACCOUNTING_META_SCOPE.source_ref);
  const history = await buildAccountingReportStatements(db, snapshot({ source_ref: 'history_2026-09-01_2026-09-02' }), 'f'.repeat(64), { now });
  await db.batch(history.statements);
  assert.equal(history.meta.source_ref, '');
  assert.equal(JSON.parse(new TextDecoder().decode((await readAccountingReportDownload(db, history.meta.id)).bytes)).source_ref, 'history_2026-09-01_2026-09-02');
});

test('failed composite transaction leaves no metadata, chunks or accounting side effect', async () => {
  const { db, sqlite } = database(); sqlite.exec('CREATE TABLE fake_costs(amount INTEGER)');
  const prepared = await buildAccountingReportStatements(db, snapshot(), 'e'.repeat(64), { now });
  await assert.rejects(db.batch([{ sql: 'INSERT INTO fake_costs VALUES(120)', args: [] }, ...prepared.statements, { sql: 'INSERT INTO absent VALUES(1)', args: [] }]));
  for (const table of ['fake_costs', 'accounting_reports', 'accounting_report_chunks']) assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
});

test('corrupt, missing or extra chunks and SHA mismatch fail closed', async () => {
  for (const corruption of ["UPDATE accounting_report_chunks SET data_base64='AAAA'", 'DELETE FROM accounting_report_chunks',
    "UPDATE accounting_reports SET sha256=replace(sha256,substr(sha256,1,1),'a')", "INSERT INTO accounting_report_chunks SELECT report_id,1,'AAAA' FROM accounting_report_chunks"]) {
    const { db, sqlite } = database(); const saved = await archiveAccountingReport(db, file(), 'test', { now });
    sqlite.exec('DROP TRIGGER accounting_report_chunks_no_update; DROP TRIGGER accounting_report_chunks_no_delete; DROP TRIGGER accounting_reports_no_update;');
    sqlite.exec(corruption);
    await assert.rejects(readAccountingReportDownload(db, saved.id), { status: 503 });
  }
});

test('overlap filters and stable50row cursor do not duplicate or accept other filters', async () => {
  const { db } = database(); const all = [];
  for (let index = 0; index < 53; index++) all.push(await archiveAccountingReport(db, file({ fileBytes: utf8(`date,cost\n2026-09-01,${index}\n`) }), 'test', { now }));
  await archiveAccountingReport(db, file({ metadata: metadata({ date_from: '2026-08-01', date_to: '2026-08-31' }) }), 'test', { now });
  const filter = { provider: 'google', from: '2026-09-30', to: '2026-10-01' };
  const first = await listAccountingReports(db, filter); const second = await listAccountingReports(db, { ...filter, cursor: first.next_cursor });
  assert.equal(first.files.length, 50); assert.equal(second.files.length, 3); assert.equal(second.next_cursor, null);
  assert.equal(new Set([...first.files, ...second.files].map(row => row.id)).size, 53);
  assert.deepEqual([...first.files, ...second.files].map(row => row.id), all.map(row => row.id).sort().reverse());
  await assert.rejects(listAccountingReports(db, { ...filter, provider: 'meta', cursor: first.next_cursor }), /invalid_report_cursor/);
  await assert.rejects(listAccountingReports(db, { ...filter, cursor: 'garbage' }), /invalid_report_cursor/);
});

function request(method, { form, token = 'test-token', query = '', origin } = {}) {
  return new Request(`https://evline.test/api/admin/accounting/reports${query}`, { method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) }, ...(form ? { body: form } : {}) });
}
function form(patch = {}) { const data = new FormData(); data.append('metadata', JSON.stringify(metadata(patch))); data.append('file', new Blob([file().fileBytes], { type: 'text/csv' }), 'source.csv'); return data; }
test('API auth, body guards, private download headers and exact file bytes', async () => {
  const { db } = database(); const env = { DB: db, ADMIN_TOKEN: 'test-token' };
  assert.equal((await onRequestGet({ request: request('GET', { token: '' }), env })).status, 401);
  assert.equal((await onRequestPost({ request: request('POST', { token: '', form: form() }), env, now })).status, 401);
  assert.equal((await download({ request: request('GET', { token: '' }), env, params: { id: 'a'.repeat(64) } })).status, 401);
  assert.equal((await onRequestPost({ request: request('POST', { form: form(), origin: 'https://other.test' }), env, now })).status, 403);
  const duplicate = form(); duplicate.append('file', new Blob(['bad']), 'extra.csv');
  assert.equal((await onRequestPost({ request: request('POST', { form: duplicate }), env, now })).status, 400);
  assert.equal((await onRequestPost({ request: request('POST', { form: form({ actor_id: 'spoof' }) }), env, now })).status, 400);
  for (const query of ['?provider=google&provider=meta', '?provider=google&from=2026-09-01&to=2026-09-30&unknown=1', '?provider=other&from=2026-09-01&to=2026-09-30']) assert.equal((await onRequestGet({ request: request('GET', { query }), env })).status, 400);
  const uploaded = await onRequestPost({ request: request('POST', { form: form() }), env, now });
  assert.equal(uploaded.status, 200); const saved = (await uploaded.json()).file;
  const response = await download({ request: request('GET'), env, params: { id: saved.id } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.match(response.headers.get('content-disposition'), /^attachment;/);
  assert.match(response.headers.get('content-security-policy'), /sandbox/); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), file().fileBytes);
  assert.equal((await download({ request: request('GET'), env, params: { id: 'f'.repeat(64) } })).status, 404);
});
