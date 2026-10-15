import { validAccountingDate } from './accounting.js';

const MAX_MINOR = 100000000000;
const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value
  && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value);
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const imageName = value => text(value, 200) && !/[/\\]/.test(value) && /\.(?:png|jpe?g|webp)$/i.test(value);
const money = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_MINOR;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value);
const actor = value => text(value, 200) && !/\s/u.test(value);
const exact = (value, keys, optional = []) => plain(value) && keys.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...keys, ...optional].includes(key));
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const RECEIPT_COLUMNS = ['id','content_hash','category','payer','beneficiary','transaction_date','date_basis','description','original_amount_minor',
  'original_currency','service_original_minor','fee_original_minor','source_id','source_filename','classification_note','imported_at','imported_by','batch_id'];
const CONFIRM_COLUMNS = ['receipt_id','content_hash','amount_minor','source_kind','source_id','source_filename','note','confirmed_at','confirmed_by'];

async function confirmation(input, receiptId, actorId, now) {
  if (!exact(input, ['amount_minor','source_kind','note'], ['source_id','source_filename']) || !money(input.amount_minor)
      || !['owner_confirmation','bank_screenshot'].includes(input.source_kind) || !text(input.note, 1000)) throw fail('accounting_bank_receipt_invalid_confirmation');
  const row = { receipt_id: receiptId, amount_minor: input.amount_minor, source_kind: input.source_kind,
    source_id: input.source_id ?? null, source_filename: input.source_filename ?? null, note: input.note, confirmed_by: actorId };
  if ((row.source_id === null) !== (row.source_filename === null) || row.source_id !== null && (!hex(row.source_id) || !imageName(row.source_filename))
      || row.source_kind === 'bank_screenshot' && row.source_id === null) throw fail('accounting_bank_receipt_invalid_confirmation');
  return { ...row, content_hash: await hash(row), confirmed_at: new Date(now).toISOString() };
}

/** Operator-reviewed image metadata only. Neither the image bytes, bank
 * balance, phone clock, invented bank row, nor estimated FX enters this model.
 */
export async function prepareBankReceiptImport(input, { now = new Date() } = {}) {
  if (!exact(input, ['batch_id','actor_id'], ['receipts','confirmations']) || !identifier(input.batch_id) || !actor(input.actor_id)
      || input.receipts !== undefined && !Array.isArray(input.receipts) || input.confirmations !== undefined && !Array.isArray(input.confirmations)
      || (input.receipts?.length || 0) + (input.confirmations?.length || 0) < 1 || (input.receipts?.length || 0) + (input.confirmations?.length || 0) > 100) throw fail('accounting_bank_receipt_invalid_import');
  const receipts = [], confirmations = [], receiptIds = new Set(), confirmIds = new Set();
  for (const item of input.receipts || []) {
    if (!exact(item, ['transaction_date','description','original_amount_minor','original_currency','service_original_minor','fee_original_minor','source_id','source_filename','classification_note'], ['date_basis','confirmation'])
        || !validAccountingDate(item.transaction_date) || item.transaction_date < '2020-01-01' || !text(item.description, 300)
        || !money(item.original_amount_minor) || typeof item.original_currency !== 'string' || !/^[A-Z]{3}$/.test(item.original_currency)
        || !money(item.service_original_minor) || !Number.isSafeInteger(item.fee_original_minor) || item.fee_original_minor < 0 || item.fee_original_minor > MAX_MINOR
        || item.service_original_minor + item.fee_original_minor !== item.original_amount_minor
        || !hex(item.source_id) || !imageName(item.source_filename) || !text(item.classification_note, 1000)
        || !['user_confirmation','receipt_image'].includes(item.date_basis ?? 'user_confirmation')) throw fail('accounting_bank_receipt_invalid_receipt');
    const row = { category: 'zhenia_delivery', payer: 'zhenia', beneficiary: 'evline', transaction_date: item.transaction_date,
      date_basis: item.date_basis ?? 'user_confirmation', description: item.description, original_amount_minor: item.original_amount_minor,
      original_currency: item.original_currency, service_original_minor: item.service_original_minor, fee_original_minor: item.fee_original_minor,
      source_id: item.source_id, source_filename: item.source_filename, classification_note: item.classification_note, imported_by: input.actor_id };
    const id = `br_${await hash(['bank_receipt_v1', row.category, row.transaction_date, row.source_id])}`;
    if (receiptIds.has(id) || receipts.some(receipt => receipt.source_id === row.source_id)) throw fail('accounting_bank_receipt_duplicate_receipt');
    receiptIds.add(id);
    receipts.push({ ...row, id, content_hash: await hash(row), imported_at: new Date(now).toISOString(), batch_id: input.batch_id });
    if (item.confirmation !== undefined) {
      confirmations.push(await confirmation(item.confirmation, id, input.actor_id, now)); confirmIds.add(id);
    }
  }
  for (const item of input.confirmations || []) {
    if (!exact(item, ['receipt_id','amount_minor','source_kind','note'], ['source_id','source_filename']) || !/^br_[0-9a-f]{64}$/.test(item.receipt_id)
        || confirmIds.has(item.receipt_id)) throw fail('accounting_bank_receipt_invalid_confirmation');
    const { receipt_id, ...value } = item;
    confirmations.push(await confirmation(value, receipt_id, input.actor_id, now)); confirmIds.add(receipt_id);
  }
  return { receipts, confirmations };
}

function statementsFor(db, prepared) {
  return [
    ...prepared.receipts.map(row => db.prepare(`INSERT INTO accounting_bank_receipts(${RECEIPT_COLUMNS.join(',')}) VALUES(${RECEIPT_COLUMNS.map(() => '?').join(',')}) ON CONFLICT DO NOTHING`)
      .bind(...RECEIPT_COLUMNS.map(key => row[key]))),
    ...prepared.confirmations.map(row => db.prepare(`INSERT INTO accounting_bank_receipt_uah_confirmations(${CONFIRM_COLUMNS.join(',')}) VALUES(${CONFIRM_COLUMNS.map(() => '?').join(',')}) ON CONFLICT DO NOTHING`)
      .bind(...CONFIRM_COLUMNS.map(key => row[key]))),
  ];
}
export async function persistBankReceiptImport(db, input, options) {
  const prepared = await prepareBankReceiptImport(input, options);
  try {
    const results = await db.batch(statementsFor(db, prepared));
    return { ok: true, receipt_ids: prepared.receipts.map(row => row.id), receipts_imported: results.slice(0, prepared.receipts.length).reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0),
      confirmations_imported: results.slice(prepared.receipts.length).reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0) };
  } catch (error) {
    if (/bank_receipt_(?:import|confirmation)_conflict/.test(error.message)) throw fail('accounting_bank_receipt_import_conflict', 409);
    throw error;
  }
}
const literal = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
export async function buildBankReceiptImportSql(input, options) {
  const prepared = await prepareBankReceiptImport(input, options), statements = [];
  for (const [table, columns, rows] of [['accounting_bank_receipts', RECEIPT_COLUMNS, prepared.receipts], ['accounting_bank_receipt_uah_confirmations', CONFIRM_COLUMNS, prepared.confirmations]]) {
    for (const row of rows) statements.push(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(key => literal(row[key])).join(',')}) ON CONFLICT DO NOTHING;`);
  }
  return { sql: `${statements.join('\n')}\n`, receipt_ids: prepared.receipts.map(row => row.id), receipt_count: prepared.receipts.length, confirmation_count: prepared.confirmations.length };
}
