import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { prepareBankReceiptImport, persistBankReceiptImport, buildBankReceiptImportSql } from '../functions/_lib/accounting-bank-receipts.js';
import { persistBankExpenseImport, readBankExpenses } from '../functions/_lib/accounting-bank-expenses.js';
import { onRequestGet } from '../functions/api/admin/accounting/bank-expenses.js';

// Entirely synthetic receipts and hashes. Actual screenshots and statements
// stay outside the repository and are checked through private operator tooling.
const now = new Date('2026-10-15T12:00:00Z');
const receipt = patch => ({ transaction_date: '2026-06-10', date_basis: 'user_confirmation', description: 'Synthetic delivery',
  original_amount_minor: 10300, original_currency: 'CNY', service_original_minor: 10000, fee_original_minor: 300,
  source_id: 'a'.repeat(64), source_filename: 'synthetic-receipt.png', classification_note: 'Synthetic fixture date confirmed by owner; payment time unavailable.', ...patch });
const confirmation = patch => ({ amount_minor: 68000, source_kind: 'bank_screenshot', source_id: 'b'.repeat(64), source_filename: 'synthetic-bank.png', note: 'Synthetic actual debit confirmation.', ...patch });
const manifest = (receipts = [receipt()], confirmations = []) => ({ batch_id: 'synthetic-receipt-import', actor_id: 'owner', receipts, confirmations });
const bank = patch => ({ category: 'zhenia_delivery', transaction_at: '2026-06-10T11:22:13', description: 'Synthetic bank delivery', amount_minor: 10000,
  original_amount_minor: 1500, original_currency: 'CNY', source_id: 'synthetic-bank', source_filename: 'synthetic-bank.csv', source_sheet: '', source_row: 1,
  classification_note: 'Synthetic bank fixture.', ...patch });
function database() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of ['0036_accounting_bank_expenses.sql','0038_accounting_bank_receipts.sql']) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  const prepared = (sql, args = []) => ({ sql, args, bind(...bound) { return prepared(sql, bound); }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } });
  const db = { prepare: prepared, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = statements.map(({ sql, args }) => ({ meta: sqlite.prepare(sql).run(...args) })); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return { db, sqlite };
}

test('pending receipt counts as one original-currency payment and never invents UAH, time or a bank row', async () => {
  const { db } = database(); await persistBankReceiptImport(db, manifest(), { now });
  const report = await readBankExpenses(db), row = report.rows[0];
  assert.equal(report.summary.count, 1); assert.equal(report.summary.debit_count, 1); assert.equal(report.summary.refund_count, 0);
  assert.equal(report.summary.net_minor, 0); assert.equal(report.summary.debit_minor, 0); assert.equal(report.summary.pending_uah_count, 1);
  assert.deepEqual(report.summary.pending_original_totals, [{ currency: 'CNY', amount_minor: 10300, count: 1 }]);
  assert.equal(row.amount_minor, null); assert.equal(row.derived_rate, null); assert.equal(row.transaction_at, null);
  assert.equal(row.date, '2026-06-10'); assert.equal(row.source_row, null); assert.equal(row.source_sheet, null);
  assert.equal(row.bank_rate, null); assert.equal(row.source_kind, 'receipt_image'); assert.equal(row.time_precision, 'date');
  assert.equal(row.uah_status, 'pending'); assert.equal(row.date_basis, 'user_confirmation');
  assert.equal(row.original_amount_minor, row.service_original_minor + row.fee_original_minor); assert.equal(row.fee_included, true);
});

test('one append-only confirmation enriches the same payment; retry cannot duplicate or overwrite it', async () => {
  const { db, sqlite } = database(), first = await persistBankReceiptImport(db, manifest(), { now }), id = first.receipt_ids[0];
  const factsBefore = sqlite.prepare('SELECT * FROM accounting_bank_receipts').get();
  const input = manifest([], [{ receipt_id: id, ...confirmation() }]);
  assert.equal((await persistBankReceiptImport(db, input, { now })).confirmations_imported, 1);
  assert.equal((await persistBankReceiptImport(db, input, { now: new Date('2026-10-16T00:00:00Z') })).confirmations_imported, 0);
  const report = await readBankExpenses(db);
  assert.equal(report.summary.count, 1); assert.equal(report.rows[0].id, id); assert.equal(report.summary.net_minor, 68000);
  assert.equal(report.summary.pending_uah_count, 0); assert.deepEqual(report.summary.pending_original_totals, []);
  assert.equal(report.rows[0].uah_status, 'confirmed'); assert.equal(report.rows[0].derived_rate, 68000 / 10300);
  assert.equal(report.rows[0].confirmation_source_kind, 'bank_screenshot'); assert.equal(report.rows[0].confirmation_source_id, 'b'.repeat(64));
  assert.equal(report.rows[0].transaction_at, null); assert.deepEqual(sqlite.prepare('SELECT * FROM accounting_bank_receipts').get(), factsBefore);
  await assert.rejects(persistBankReceiptImport(db, manifest([], [{ receipt_id: id, ...confirmation({ amount_minor: 69000 }) }]), { now }), { status: 409 });
  for (const sql of ['UPDATE accounting_bank_receipts SET description=description', 'DELETE FROM accounting_bank_receipts', 'UPDATE accounting_bank_receipt_uah_confirmations SET amount_minor=1', 'DELETE FROM accounting_bank_receipt_uah_confirmations']) assert.throws(() => sqlite.exec(sql), /immutable/);
});

test('confirmed receipt fees counted exactly once, and all original statement rows remain byte-identical', async () => {
  const { db, sqlite } = database();
  await persistBankExpenseImport(db, { batch_id: 'synthetic-bank', rows: [bank(), bank({ category: 'zhenia_alipay', description: 'Alipay*QRCode', amount_minor: 6400, source_row: 2 })] }, { now });
  const bankRowsBefore = sqlite.prepare('SELECT * FROM accounting_bank_expenses ORDER BY id').all();
  await persistBankReceiptImport(db, manifest([receipt({ confirmation: confirmation() })]), { now });
  const delivery = await readBankExpenses(db, new URLSearchParams({ category: 'zhenia_delivery' }));
  assert.equal(delivery.summary.count, 2); assert.equal(delivery.summary.net_minor, 78000); assert.equal(delivery.summary.receipt_count, 1);
  assert.equal(delivery.rows.find(row => row.source_kind === 'receipt_image').fee_original_minor, 300);
  const parts = await readBankExpenses(db, new URLSearchParams({ category: 'zhenia_alipay' }));
  assert.equal(parts.summary.count, 1); assert.equal(parts.summary.net_minor, 6400);
  assert.deepEqual(sqlite.prepare('SELECT * FROM accounting_bank_expenses ORDER BY id').all(), bankRowsBefore);
  assert.equal((await readBankExpenses(db)).summary.net_minor, 84400);
});

test('date filters, original/confirmation search and date-only pagination use all filtered payments', async () => {
  const { db } = database();
  await persistBankExpenseImport(db, { batch_id: 'synthetic-bank', rows: [bank(), bank({ transaction_at: '2026-06-09T23:00:00', source_row: 2 })] }, { now });
  await persistBankReceiptImport(db, manifest([receipt({ confirmation: confirmation() })]), { now });
  const page1 = await readBankExpenses(db, new URLSearchParams({ page_size: '1' }));
  assert.equal(page1.rows[0].transaction_at, '2026-06-10T11:22:13'); assert.equal(page1.summary.receipt_count, 1);
  const page2 = await readBankExpenses(db, new URLSearchParams({ page_size: '1', page: '2' }));
  assert.equal(page2.rows[0].source_kind, 'receipt_image'); assert.equal(page2.summary.net_minor, 88000);
  const page3 = await readBankExpenses(db, new URLSearchParams({ page_size: '1', page: '3' }));
  assert.equal(page3.rows[0].date, '2026-06-09');
  const day = await readBankExpenses(db, new URLSearchParams({ from: '2026-06-10', to: '2026-06-10' }));
  assert.equal(day.summary.count, 2); assert.deepEqual(day.coverage, { from: '2026-06-10', to: '2026-06-10' });
  for (const q of ['synthetic-receipt.png', 'Synthetic actual debit', 'synthetic-bank.png']) assert.equal((await readBankExpenses(db, new URLSearchParams({ q }))).summary.receipt_count, 1);
  assert.equal((await readBankExpenses(db, new URLSearchParams({ to: '2026-06-09' }))).summary.receipt_count, 0);
});

test('pending summaries remain filtered and separate currencies without inflating UAH refunds', async () => {
  const { db } = database();
  await persistBankExpenseImport(db, { batch_id: 'synthetic-bank', rows: [bank({ amount_minor: -1000, original_amount_minor: -150 })] }, { now });
  await persistBankReceiptImport(db, manifest([receipt(), receipt({ source_id: 'c'.repeat(64), source_filename: 'usd.png', original_currency: 'USD', transaction_date: '2026-06-11' })]), { now });
  const report = await readBankExpenses(db, new URLSearchParams({ page_size: '1' }));
  assert.equal(report.summary.count, 3); assert.equal(report.summary.debit_count, 2); assert.equal(report.summary.refund_count, 1);
  assert.equal(report.summary.net_minor, -1000); assert.equal(report.summary.refund_minor, 1000); assert.equal(report.summary.pending_uah_count, 2);
  assert.deepEqual(report.summary.pending_original_totals, [{ currency: 'CNY', amount_minor: 10300, count: 1 }, { currency: 'USD', amount_minor: 10300, count: 1 }]);
  const filtered = await readBankExpenses(db, new URLSearchParams({ from: '2026-06-11', to: '2026-06-11' }));
  assert.deepEqual(filtered.summary.pending_original_totals, [{ currency: 'USD', amount_minor: 10300, count: 1 }]);
});

test('operator import rejects fabricated precision, wrong breakdowns, invalid money and unsupported evidence', async () => {
  for (const patch of [{ transaction_at: '2026-06-10T15:57:00' }, { source_row: 1 }, { amount_minor: 0 }, { original_amount_minor: 10600 },
    { original_amount_minor: 0 }, { fee_original_minor: -1 }, { fee_original_minor: 3.1 }, { source_id: 'fake' }, { source_filename: '../synthetic.png' },
    { date_basis: 'status_bar_clock' }, { transaction_date: '2026-02-31' }, { original_currency: 'cnY' }, { source_filename: 'fake.csv' }]) await assert.rejects(prepareBankReceiptImport(manifest([receipt(patch)]), { now }));
  for (const patch of [{ amount_minor: null }, { amount_minor: 0 }, { amount_minor: -1 }, { amount_minor: 1.5 }, { source_kind: 'bank_statement' },
    { source_id: null, source_filename: null }, { source_filename: 'bank.xlsx' }, { transaction_at: '2026-06-10T00:00:00' }]) await assert.rejects(prepareBankReceiptImport(manifest([receipt({ confirmation: confirmation(patch) })]), { now }));
  await assert.rejects(prepareBankReceiptImport(manifest([receipt(), receipt()]), { now }), /duplicate/);
  const valid = await prepareBankReceiptImport(manifest([receipt({ confirmation: { amount_minor: 68000, source_kind: 'owner_confirmation', note: 'Explicit owner actual amount.' } })]), { now });
  assert.equal(valid.confirmations[0].source_id, null);
});

test('SQL export is retry-safe and conflicting receipt or confirmation aborts atomically', async () => {
  const { sqlite, db } = database(), exported = await buildBankReceiptImportSql(manifest([receipt({ confirmation: confirmation() })]), { now });
  assert.doesNotMatch(exported.sql, /BEGIN|COMMIT/); sqlite.exec(`BEGIN;${exported.sql}COMMIT;`); sqlite.exec(`BEGIN;${exported.sql}COMMIT;`);
  assert.equal((await readBankExpenses(db)).summary.count, 1);
  const changed = await buildBankReceiptImportSql(manifest([receipt({ confirmation: confirmation({ amount_minor: 69000 }) })]), { now });
  assert.throws(() => sqlite.exec(`BEGIN;${changed.sql}COMMIT;`), /confirmation_conflict/); sqlite.exec('ROLLBACK');
  assert.equal((await readBankExpenses(db)).summary.net_minor, 68000);
  await assert.rejects(persistBankReceiptImport(db, manifest([receipt({ description: 'Reclassified source' })]), { now }), { status: 409 });
});

test('read API remains admin-only and no-store for confirmed or pending receipts', async () => {
  const { db } = database(); await persistBankReceiptImport(db, manifest(), { now });
  const env = { DB: db, ADMIN_TOKEN: 'synthetic-admin' };
  const url = 'https://evline.test/api/admin/accounting/bank-expenses?category=zhenia_delivery';
  assert.equal((await onRequestGet({ request: new Request(url), env })).status, 401);
  const response = await onRequestGet({ request: new Request(url, { headers: { authorization: 'Bearer synthetic-admin' } }), env });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).rows[0].amount_minor, null);
});
