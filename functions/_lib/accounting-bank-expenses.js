import { validAccountingDate } from './accounting.js';

export const BANK_EXPENSE_CATEGORIES = Object.freeze({
  igor_china: 'Ігор · поїздка до Китаю',
  zhenia_alipay: 'Женя · Alipay',
  zhenia_delivery: 'Женя · доставка Meest',
  order_other: 'Інші витрати за замовленнями',
});
export const BANK_EXPENSE_TRIP = Object.freeze({ from: '2026-04-10', to: '2026-05-07' });
const MAX_MINOR = 100000000000;
const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const safeText = (value, max, empty = false) => typeof value === 'string' && value.length <= max
  && (empty || value.trim().length > 0) && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value);
const money = value => Number.isSafeInteger(value) && value !== 0 && Math.abs(value) <= MAX_MINOR;
const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)
  && validAccountingDate(value.slice(0, 10)) && Number.isFinite(new Date(`${value}Z`).getTime())
  && new Date(`${value}Z`).toISOString().slice(0, 19) === value;
const ROW_FIELDS = ['id', 'category', 'payer', 'beneficiary', 'trip_from', 'trip_to', 'transaction_at', 'description', 'amount_minor',
  'original_amount_minor', 'original_currency', 'bank_rate', 'mcc', 'source_id', 'source_filename', 'source_sheet', 'source_row', 'classification_note', 'possible_duplicate'];
const COLUMNS = ['id', 'content_hash', 'category', 'payer', 'beneficiary', 'trip_from', 'trip_to', 'transaction_at', 'transaction_date',
  'description', 'amount_minor', 'original_amount_minor', 'original_currency', 'bank_rate', 'mcc', 'source_id', 'source_filename',
  'source_sheet', 'source_row', 'classification_note', 'possible_duplicate', 'imported_at', 'batch_id'];
const PUBLIC_COLUMNS = COLUMNS.filter(key => key !== 'content_hash').join(',');
const INSERT_ROW = `INSERT INTO accounting_bank_expenses (${COLUMNS.join(',')}) VALUES (${COLUMNS.map(() => '?').join(',')}) ON CONFLICT DO NOTHING`;

async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Reviewed rows only: no card identifiers, balances, raw payment IDs, or
 * personal AliExpress purchases. Amounts are integer minor units, expenses
 * positive and refunds negative, in both the account and original currency.
 */
export async function validateBankExpenseImport(input, { now = new Date() } = {}) {
  if (!plain(input) || Object.keys(input).some(key => !['batch_id', 'rows'].includes(key)) || !identifier(input.batch_id)
      || !Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 5000) throw fail('accounting_bank_expenses_invalid_import');
  const importedAt = new Date(now).toISOString(), seen = new Set(), rows = [];
  for (const inputRow of input.rows) {
    if (!plain(inputRow) || Object.keys(inputRow).some(key => !ROW_FIELDS.includes(key))) throw fail('accounting_bank_expenses_invalid_row');
    const category = inputRow.category, trip = category === 'igor_china';
    const row = {
      category, payer: inputRow.payer ?? 'zhenia', beneficiary: inputRow.beneficiary ?? (trip ? 'igor' : 'evline'),
      trip_from: inputRow.trip_from ?? (trip ? BANK_EXPENSE_TRIP.from : null), trip_to: inputRow.trip_to ?? (trip ? BANK_EXPENSE_TRIP.to : null),
      transaction_at: inputRow.transaction_at, description: inputRow.description, amount_minor: inputRow.amount_minor,
      original_amount_minor: inputRow.original_amount_minor ?? null, original_currency: inputRow.original_currency ?? null,
      bank_rate: inputRow.bank_rate ?? null, mcc: inputRow.mcc ?? null,
      source_id: inputRow.source_id, source_filename: inputRow.source_filename, source_sheet: inputRow.source_sheet,
      source_row: inputRow.source_row, classification_note: inputRow.classification_note, possible_duplicate: inputRow.possible_duplicate ?? false,
    };
    if (!Object.hasOwn(BANK_EXPENSE_CATEGORIES, category) || row.payer !== 'zhenia' || row.beneficiary !== (trip ? 'igor' : 'evline')
        || !validTime(row.transaction_at) || row.transaction_at.slice(0, 4) < '2020' || !money(row.amount_minor)
        || !safeText(row.description, 300) || /aliexpress/i.test(row.description)
        || !identifier(row.source_id) || !safeText(row.source_filename, 200) || /[/\\]/.test(row.source_filename)
        || !safeText(row.source_sheet, 100, true) || !Number.isSafeInteger(row.source_row) || row.source_row < 1 || row.source_row > 10000000
        || !safeText(row.classification_note, 1000) || typeof row.possible_duplicate !== 'boolean'
        || row.mcc !== null && (typeof row.mcc !== 'string' || !/^\d{4}$/.test(row.mcc))
        || row.bank_rate !== null && (typeof row.bank_rate !== 'number' || !Number.isFinite(row.bank_rate) || row.bank_rate <= 0 || row.bank_rate > 1000000)) throw fail('accounting_bank_expenses_invalid_row');
    if (trip ? row.trip_from !== BANK_EXPENSE_TRIP.from || row.trip_to !== BANK_EXPENSE_TRIP.to
      || row.transaction_at.slice(0, 10) < row.trip_from || row.transaction_at.slice(0, 10) > row.trip_to
      : row.trip_from !== null || row.trip_to !== null) throw fail('accounting_bank_expenses_outside_trip');
    if ((row.original_amount_minor === null) !== (row.original_currency === null)
        || row.original_amount_minor !== null && (!money(row.original_amount_minor) || typeof row.original_currency !== 'string' || !/^[A-Z]{3}$/.test(row.original_currency)
          || (row.original_amount_minor > 0) !== (row.amount_minor > 0))) throw fail('accounting_bank_expenses_invalid_original_amount');
    const id = `be_${await hash([row.source_id, row.source_sheet, row.source_row])}`;
    if (inputRow.id !== undefined && inputRow.id !== id) throw fail('accounting_bank_expenses_invalid_id');
    if (seen.has(id)) throw fail('accounting_bank_expenses_duplicate_source_row');
    seen.add(id);
    rows.push({ id, content_hash: await hash(row), ...row, transaction_date: row.transaction_at.slice(0, 10),
      possible_duplicate: row.possible_duplicate ? 1 : 0, imported_at: importedAt, batch_id: input.batch_id });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return { batch_id: input.batch_id, content_hash: await hash(rows.map(row => [row.id, row.content_hash])), imported_at: importedAt, rows };
}

export async function persistBankExpenseImport(db, input, options) {
  const receipt = await validateBankExpenseImport(input, options);
  try {
    const results = await db.batch([
      db.prepare('INSERT INTO accounting_bank_expense_batches(batch_id,content_hash,row_count,imported_at) VALUES(?,?,?,?) ON CONFLICT(batch_id) DO NOTHING')
        .bind(receipt.batch_id, receipt.content_hash, receipt.rows.length, receipt.imported_at),
      ...receipt.rows.map(row => db.prepare(INSERT_ROW).bind(...COLUMNS.map(key => row[key]))),
    ]);
    return { ok: true, batch_id: receipt.batch_id, rows_received: receipt.rows.length, rows_imported: results.slice(1).reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0) };
  } catch (error) {
    if (/bank_expense_(row|batch)_conflict/.test(error.message)) throw fail('accounting_bank_expenses_import_conflict', 409);
    throw error;
  }
}

const sqlLiteral = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;

/** Local administration helper only. Write returned SQL to a private path,
 * then execute as a D1 file import against the protected database. D1 supplies
 * its own transaction; explicit BEGIN/COMMIT are incompatible with D1 imports.
 * No financial values are logged or included in public build output.
 */
export async function buildBankExpenseImportSql(input, options) {
  const receipt = await validateBankExpenseImport(input, options);
  const sql = [
    `INSERT INTO accounting_bank_expense_batches(batch_id,content_hash,row_count,imported_at) VALUES(${[receipt.batch_id, receipt.content_hash, receipt.rows.length, receipt.imported_at].map(sqlLiteral).join(',')}) ON CONFLICT(batch_id) DO NOTHING;`,
    ...receipt.rows.map(row => `INSERT INTO accounting_bank_expenses(${COLUMNS.join(',')}) VALUES(${COLUMNS.map(key => sqlLiteral(row[key])).join(',')}) ON CONFLICT DO NOTHING;`),
    ''].join('\n');
  return { sql, batch_id: receipt.batch_id, row_count: receipt.rows.length, content_hash: receipt.content_hash };
}

export function bankExpenseFilters(params) {
  if (!(params instanceof URLSearchParams)) throw fail('accounting_bank_expenses_invalid_parameters');
  const allowed = ['category', 'from', 'to', 'q', 'page', 'page_size'];
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw fail('accounting_bank_expenses_invalid_parameters');
  const category = params.get('category') ?? null, from = params.get('from') ?? null, to = params.get('to') ?? null, q = params.get('q') ?? '';
  if (category !== null && !Object.hasOwn(BANK_EXPENSE_CATEGORIES, category)
      || from !== null && (!validAccountingDate(from) || from < '2020-01-01')
      || to !== null && (!validAccountingDate(to) || to < '2020-01-01')
      || from !== null && to !== null && from > to || !safeText(q, 100, true)) throw fail('accounting_bank_expenses_invalid_parameters');
  const positive = (value, fallback, max) => {
    if (value === null) return fallback;
    if (!/^[1-9]\d{0,8}$/.test(value) || Number(value) > max) throw fail('accounting_bank_expenses_invalid_parameters');
    return Number(value);
  };
  return { category, from, to, q, page: positive(params.get('page'), 1, 1000000), page_size: positive(params.get('page_size'), 50, 100) };
}

const emptyTotals = () => ({ count: 0, debit_count: 0, refund_count: 0, debit_minor: 0, refund_minor: 0, net_minor: 0, possible_duplicate_count: 0 });
const totalKeys = Object.keys(emptyTotals());
function totals(row) {
  const result = Object.fromEntries(totalKeys.map(key => [key, Number(row?.[key] || 0)]));
  if (Object.values(result).some(value => !Number.isSafeInteger(value)) || result.debit_minor - result.refund_minor !== result.net_minor) throw fail('accounting_bank_expenses_invalid_totals', 503);
  return result;
}

export async function readBankExpenses(db, params = new URLSearchParams()) {
  const filters = bankExpenseFilters(params), predicates = [], args = [];
  if (filters.category) { predicates.push('category=?'); args.push(filters.category); }
  if (filters.from) { predicates.push('transaction_date>=?'); args.push(filters.from); }
  if (filters.to) { predicates.push('transaction_date<=?'); args.push(filters.to); }
  if (filters.q) {
    const term = `%${filters.q.replace(/[\\%_]/g, '\\$&')}%`;
    predicates.push("(description LIKE ? ESCAPE '\\' OR classification_note LIKE ? ESCAPE '\\' OR source_filename LIKE ? ESCAPE '\\')");
    args.push(term, term, term);
  }
  const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
  const [summaryResult, rowsResult] = await Promise.all([
    db.prepare(`SELECT category,COUNT(*) AS count,SUM(amount_minor>0) AS debit_count,SUM(amount_minor<0) AS refund_count,
      SUM(CASE WHEN amount_minor>0 THEN amount_minor ELSE 0 END) AS debit_minor,
      SUM(CASE WHEN amount_minor<0 THEN -amount_minor ELSE 0 END) AS refund_minor,SUM(amount_minor) AS net_minor,
      SUM(possible_duplicate) AS possible_duplicate_count,MIN(transaction_date) AS date_from,MAX(transaction_date) AS date_to
      FROM accounting_bank_expenses ${where} GROUP BY category`).bind(...args).all(),
    db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM accounting_bank_expenses ${where} ORDER BY transaction_at DESC,id DESC LIMIT ? OFFSET ?`)
      .bind(...args, filters.page_size, (filters.page - 1) * filters.page_size).all(),
  ]);
  const grouped = summaryResult.results || [], summary = emptyTotals();
  for (const row of grouped) for (const [key, value] of Object.entries(totals(row))) summary[key] += value;
  totals(summary);
  const categories = Object.entries(BANK_EXPENSE_CATEGORIES).map(([category, label]) => ({ category, label, ...totals(grouped.find(row => row.category === category)) }));
  const rows = (rowsResult.results || []).map(row => ({ ...row, date: row.transaction_date,
    possible_duplicate: Number(row.possible_duplicate) === 1,
    derived_rate: row.original_amount_minor ? Math.abs(row.amount_minor / row.original_amount_minor) : null }));
  return { currency: 'UAH', timezone: 'Europe/Kyiv', filters, summary, categories,
    coverage: { from: grouped.map(row => row.date_from).sort()[0] ?? null, to: grouped.map(row => row.date_to).sort().at(-1) ?? null },
    pagination: { page: filters.page, page_size: filters.page_size, total_count: summary.count, total_pages: Math.ceil(summary.count / filters.page_size) },
    trip: BANK_EXPENSE_TRIP, rows };
}
