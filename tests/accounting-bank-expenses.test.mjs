import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { BANK_EXPENSE_TRIP, bankExpenseFilters, validateBankExpenseImport, persistBankExpenseImport, readBankExpenses, buildBankExpenseImportSql } from '../functions/_lib/accounting-bank-expenses.js';
import { onRequestGet, onRequestPost, onRequestPut, onRequestPatch, onRequestDelete } from '../functions/api/admin/accounting/bank-expenses.js';

const now = new Date('2026-10-15T12:00:00.000Z');
const baseRow = patch => ({ category: 'igor_china', transaction_at: '2026-04-10T00:00:00', description: 'Alipay*Food',
  amount_minor: 12345, original_amount_minor: 2000, original_currency: 'CNY', bank_rate: 6.1725, mcc: '5812',
  source_id: 'synthetic-statement', source_filename: 'synthetic.xlsx', source_sheet: 'Statement', source_row: 10,
  classification_note: 'Synthetic test receipt; reviewed trip expense', ...patch });
const receipt = (rows = [baseRow()], batch_id = 'synthetic-bank-expenses-v1') => ({ batch_id, rows });

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE unrelated_accounting_balance(amount_minor INTEGER); INSERT INTO unrelated_accounting_balance VALUES(76543);');
  sqlite.exec(readFileSync(new URL('../migrations/0036_accounting_bank_expenses.sql', import.meta.url), 'utf8'));
  const prepared = (sql, args = []) => ({ sql, args, bind(...bound) { return prepared(sql, bound); }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } });
  const db = { prepare: prepared, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = statements.map(({ sql, args }) => ({ meta: sqlite.prepare(sql).run(...args) })); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return { db, sqlite };
}

test('additive migration starts empty and read model does not invent transactions', async () => {
  const { db, sqlite } = database(), report = await readBankExpenses(db);
  assert.equal(report.summary.count, 0); assert.equal(report.summary.net_minor, 0);
  assert.equal(report.categories.length, 4); assert.deepEqual(report.rows, []);
  assert.deepEqual(report.coverage, { from: null, to: null }); assert.deepEqual(report.trip, BANK_EXPENSE_TRIP);
  assert.equal(sqlite.prepare('SELECT amount_minor FROM unrelated_accounting_balance').get().amount_minor, 76543);
});

test('private row import validates exact fields, integer money, refunds, originals and sources', async () => {
  const valid = await validateBankExpenseImport(receipt(), { now });
  assert.match(valid.rows[0].id, /^be_[0-9a-f]{64}$/); assert.equal(valid.rows[0].payer, 'zhenia');
  assert.equal(valid.rows[0].beneficiary, 'igor'); assert.equal(valid.rows[0].trip_from, '2026-04-10');
  for (const patch of [
    { category: 'personal' }, { payer: 'igor' }, { beneficiary: 'evline' }, { amount_minor: 0 }, { amount_minor: -1 },
    { amount_minor: 0.1 }, { amount_minor: '123' }, { amount_minor: Number.MAX_SAFE_INTEGER }, { amount_minor: NaN },
    { original_amount_minor: -2000 }, { original_amount_minor: 0 }, { original_currency: 'CNYX' }, { original_amount_minor: null },
    { bank_rate: 0 }, { bank_rate: Infinity }, { mcc: 5812 }, { mcc: '12345' },
    { transaction_at: '2026-02-31T10:00:00' }, { transaction_at: '2026-04-10T99:00:00' }, { transaction_at: '2026-04-10T24:00:00' },
    { source_row: 0 }, { source_row: 1.5 }, { source_filename: '../private.xlsx' }, { source_sheet: '\u202Eprivate' },
    { source_id: 'source?id=anything' }, { description: 'AliExpress' }, { description: '' }, { description: 'x\nsecret' },
    { classification_note: '' }, { card: 'private-card-should-never-be-retained' }, { id: 'arbitrary' }, { possible_duplicate: 1 },
  ]) await assert.rejects(validateBankExpenseImport(receipt([baseRow(patch)]), { now }), undefined, JSON.stringify(patch));
  const refund = await validateBankExpenseImport(receipt([baseRow({ amount_minor: -12345, original_amount_minor: -2000 })]), { now });
  assert.equal(refund.rows[0].amount_minor, -12345);
  const missingOriginal = await validateBankExpenseImport(receipt([baseRow({ original_amount_minor: null, original_currency: null, bank_rate: null })]), { now });
  assert.equal(missingOriginal.rows[0].original_currency, null);
  for (const input of [{ rows: [] }, receipt([], 'batch'), { ...receipt(), card_id: 'private' }]) await assert.rejects(validateBankExpenseImport(input, { now }));
});

test('Igor trip boundaries are inclusive and business payments cannot acquire travel attribution', async () => {
  for (const transaction_at of ['2026-04-10T00:00:00', '2026-05-07T23:59:59']) await validateBankExpenseImport(receipt([baseRow({ transaction_at })]), { now });
  for (const patch of [{ transaction_at: '2026-04-09T23:59:59' }, { transaction_at: '2026-05-08T00:00:00' }, { trip_from: '2026-04-11' }, { trip_to: '2026-05-03' }]) {
    await assert.rejects(validateBankExpenseImport(receipt([baseRow(patch)]), { now }), { message: 'accounting_bank_expenses_outside_trip' });
  }
  const business = await validateBankExpenseImport(receipt([baseRow({ category: 'zhenia_alipay', transaction_at: '2025-11-25T16:00:00' })]), { now });
  assert.equal(business.rows[0].beneficiary, 'evline'); assert.equal(business.rows[0].trip_from, null);
  await assert.rejects(validateBankExpenseImport(receipt([baseRow({ category: 'zhenia_alipay', trip_from: BANK_EXPENSE_TRIP.from })]), { now }));
});

test('imports preserve deterministic identity, are retry-safe, immutable and conflict-aware', async () => {
  const { db, sqlite } = database();
  const first = await persistBankExpenseImport(db, receipt(), { now });
  assert.equal(first.rows_imported, 1);
  assert.equal((await persistBankExpenseImport(db, receipt(), { now: new Date('2026-10-16T12:00:00Z') })).rows_imported, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_bank_expenses').get().n, 1);
  const a = await validateBankExpenseImport(receipt(), { now }), b = await validateBankExpenseImport(receipt(), { now: new Date('2026-10-16T12:00:00Z') });
  assert.equal(a.content_hash, b.content_hash); assert.equal(a.rows[0].id, b.rows[0].id);
  await assert.rejects(persistBankExpenseImport(db, receipt([baseRow({ description: 'Changed purpose' })]), { now }), { status: 409 });
  await assert.rejects(persistBankExpenseImport(db, receipt([baseRow({ amount_minor: 54321 }), baseRow({ source_row: 11 })], 'synthetic-new-batch'), { now }), { status: 409 });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_bank_expense_batches').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_bank_expenses').get().n, 1);
  await assert.rejects(validateBankExpenseImport(receipt([baseRow(), baseRow()]), { now }), { message: 'accounting_bank_expenses_duplicate_source_row' });
  assert.throws(() => sqlite.exec('UPDATE accounting_bank_expenses SET amount_minor=10'), /immutable/);
  assert.throws(() => sqlite.exec('DELETE FROM accounting_bank_expenses'), /immutable/);
  assert.throws(() => sqlite.exec("UPDATE accounting_bank_expense_batches SET row_count=10"), /immutable/);
  assert.equal(sqlite.prepare('SELECT amount_minor FROM unrelated_accounting_balance').get().amount_minor, 76543);
});

test('summary aggregates all filtered payments before pagination, with refund magnitudes', async () => {
  const { db } = database();
  await persistBankExpenseImport(db, receipt([
    baseRow({ amount_minor: 30000, source_row: 1, possible_duplicate: true }),
    baseRow({ amount_minor: -1930, original_amount_minor: -125, source_row: 2, transaction_at: '2026-04-28T01:47:00' }),
    baseRow({ category: 'zhenia_delivery', description: 'Meest China', amount_minor: 50000, source_row: 3, transaction_at: '2026-05-10T10:00:00' }),
    baseRow({ category: 'order_other', description: 'WEIXIN*cargo Lala', amount_minor: 2500, source_row: 4, transaction_at: '2026-05-20T10:00:00' }),
  ]), { now });
  const report = await readBankExpenses(db, new URLSearchParams({ page_size: '1', page: '2' }));
  assert.equal(report.rows.length, 1); assert.equal(report.rows[0].description, 'Meest China');
  assert.deepEqual(report.summary, { count: 4, debit_count: 3, refund_count: 1, debit_minor: 82500, refund_minor: 1930, net_minor: 80570, possible_duplicate_count: 1 });
  assert.deepEqual(report.pagination, { page: 2, page_size: 1, total_count: 4, total_pages: 4 });
  assert.deepEqual(report.coverage, { from: '2026-04-10', to: '2026-05-20' });
  const igor = await readBankExpenses(db, new URLSearchParams({ category: 'igor_china', from: '2026-04-10', to: '2026-04-28' }));
  assert.equal(igor.summary.net_minor, 28070); assert.equal(igor.rows[0].amount_minor, -1930);
  assert.equal(igor.categories.find(row => row.category === 'igor_china').net_minor, 28070);
  assert.equal(igor.categories.find(row => row.category === 'zhenia_delivery').count, 0);
  assert.equal(igor.rows[0].derived_rate, 1930 / 125); assert.equal(igor.rows[1].possible_duplicate, true);
  assert.equal('content_hash' in igor.rows[0], false);
  assert.equal((await readBankExpenses(db, new URLSearchParams({ page: '10' }))).rows.length, 0);
});

test('search treats SQL metacharacters as literal and validates every query parameter', async () => {
  const { db } = database();
  await persistBankExpenseImport(db, receipt([baseRow({ description: "Alipay*100%_'receipt" }), baseRow({ description: 'Alipay normal', source_row: 11 })]), { now });
  for (const q of ['%', '_', "'receipt"]) assert.equal((await readBankExpenses(db, new URLSearchParams({ q }))).summary.count, 1);
  assert.equal((await readBankExpenses(db, new URLSearchParams({ q: "' OR 1=1 --" }))).summary.count, 0);
  assert.equal((await readBankExpenses(db, new URLSearchParams({ q: 'synthetic.xlsx' }))).summary.count, 2);
  for (const query of ['category=all', 'category=igor_china&category=igor_china', 'page=0', 'page=-1', 'page=1.5', 'page=1e2', 'page_size=101', 'from=2026-02-31', 'from=2026-05-01&to=2026-04-01', 'limit=100', 'q=%00', `q=${'x'.repeat(101)}`, 'page=']) {
    assert.throws(() => bankExpenseFilters(new URLSearchParams(query)), { status: 400 });
  }
  assert.equal(bankExpenseFilters(new URLSearchParams({ from: '2026-04-10' })).from, '2026-04-10');
});

test('SQL export escapes private text and imports transactionally without weakening conflict guards', async () => {
  const { sqlite } = database();
  const data = receipt([baseRow({ description: "Alipay*Vendor's 100% goods" })]);
  const exported = await buildBankExpenseImportSql(data, { now });
  assert.doesNotMatch(exported.sql, /BEGIN|COMMIT/);
  sqlite.exec(`BEGIN;${exported.sql}COMMIT;`); sqlite.exec(`BEGIN;${exported.sql}COMMIT;`);
  assert.equal(sqlite.prepare('SELECT description FROM accounting_bank_expenses').get().description, "Alipay*Vendor's 100% goods");
  const conflict = await buildBankExpenseImportSql(receipt([baseRow({ amount_minor: 20 })]), { now });
  assert.throws(() => sqlite.exec(`BEGIN;${conflict.sql}COMMIT;`), /conflict/); sqlite.exec('ROLLBACK');
  assert.equal(sqlite.prepare('SELECT amount_minor FROM accounting_bank_expenses').get().amount_minor, 12345);
});

function request(method = 'GET', query = '', token = 'test-token') {
  return new Request(`https://evline.test/api/admin/accounting/bank-expenses${query}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
}

test('read API is admin-only, no-store, strict, read-only and masks internal database errors', async () => {
  const { db } = database(), env = { DB: db, ADMIN_TOKEN: 'test-token' };
  assert.equal((await onRequestGet({ request: request('GET', '', ''), env })).status, 401);
  assert.equal((await onRequestGet({ request: request('GET', '?page_size=101'), env })).status, 400);
  await persistBankExpenseImport(db, receipt(), { now });
  const result = await onRequestGet({ request: request(), env });
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).rows.length, 1);
  for (const handler of [onRequestPost, onRequestPut, onRequestPatch, onRequestDelete]) {
    assert.equal(handler({ request: request('POST'), env }).status, 405);
    assert.equal(handler({ request: request('POST', '', ''), env }).status, 401);
  }
  const broken = await onRequestGet({ request: request(), env: { ...env, DB: { prepare() { throw new Error('private database schema and financial information'); } } } });
  assert.equal(broken.status, 503); assert.deepEqual(await broken.json(), { error: 'accounting_bank_expenses_unavailable' });
});

test('database constraints independently reject personal imports, noninteger amounts and outside-trip dates', async () => {
  const { sqlite } = database(), exported = await buildBankExpenseImportSql(receipt(), { now });
  sqlite.exec(exported.sql);
  const existing = sqlite.prepare('SELECT * FROM accounting_bank_expenses').get(), fields = Object.keys(existing);
  const insert = sqlite.prepare(`INSERT INTO accounting_bank_expenses(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`);
  const invalid = patch => {
    const row = { ...existing, id: `be_${'f'.repeat(64)}`, source_row: 99, ...patch };
    assert.throws(() => insert.run(...fields.map(key => row[key])));
  };
  invalid({ description: 'AliExpress' }); invalid({ amount_minor: 0.1 });
  invalid({ transaction_at: '2026-05-08T00:00:00', transaction_date: '2026-05-08' });
  invalid({ transaction_at: '2026-04-10T24:00:00' });
  invalid({ original_amount_minor: -100 }); invalid({ trip_to: '2026-05-03' }); invalid({ trip_from: null }); invalid({ trip_to: null });
});
