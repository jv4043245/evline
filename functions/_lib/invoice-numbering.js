import { fail, invoiceAmount } from '../../admin/documents/model.js';
import { auditActor, recordAuditEvent } from './audit-log.js';

export const INVOICE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS standalone_documents (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, revision INTEGER NOT NULL,
    created_at TEXT NOT NULL, actor TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','ready')),
    data_json TEXT NOT NULL, output_mode TEXT NOT NULL DEFAULT 'invoice', UNIQUE(workspace_id,revision))`,
  `CREATE TABLE IF NOT EXISTS invoice_sequence (id INTEGER PRIMARY KEY CHECK(id=1), next_number INTEGER NOT NULL CHECK(next_number>=9))`,
  `INSERT OR IGNORE INTO invoice_sequence(id,next_number) VALUES(1,10)`,
  `UPDATE invoice_sequence SET next_number=10 WHERE id=1 AND next_number<10`,
  `CREATE TABLE IF NOT EXISTS invoice_numbers (number TEXT NOT NULL, iban TEXT NOT NULL, scope TEXT NOT NULL,
    amount_minor INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(number,iban))`,
  `CREATE TABLE IF NOT EXISTS document_save_requests (id TEXT PRIMARY KEY, scope TEXT NOT NULL, fingerprint TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS invoice_numbering_changes (id TEXT PRIMARY KEY,
    previous_number INTEGER NOT NULL, next_number INTEGER NOT NULL CHECK(next_number>previous_number),
    created_at TEXT NOT NULL, actor TEXT NOT NULL)`,
];
export const documentStore = standalone => standalone
  ? { table: 'standalone_documents', key: 'workspace_id', prefix: 'invoice:' }
  : { table: 'order_documents', key: 'order_id', prefix: 'order:' };
const normalized = s => String(s || '').normalize('NFKC').toUpperCase().replace(/[‐‑–—]/g, '-').trim();
const iban = s => String(s || '').replace(/\s/g, '').toUpperCase();
export const allDocumentRows = `SELECT 'order:'||order_id scope,id,revision,created_at,actor,status,data_json,output_mode FROM order_documents
  UNION ALL SELECT 'invoice:'||workspace_id scope,id,revision,created_at,actor,status,data_json,output_mode FROM standalone_documents`;
const MAX_NUMBER = 999999999;
const nextNumberSql = `MAX((SELECT next_number FROM invoice_sequence WHERE id=1),10,
  COALESCE((SELECT MAX(CAST(number AS INTEGER))+1 FROM invoice_numbers WHERE length(number) BETWEEN 1 AND 9 AND number NOT GLOB '*[^0-9]*'),10),
  COALESCE((SELECT MAX(CAST(json_extract(data_json,'$.invoice.number') AS INTEGER))+1 FROM (${allDocumentRows})
    WHERE status='ready' AND output_mode IN ('invoice','all') AND length(json_extract(data_json,'$.invoice.number')) BETWEEN 1 AND 9
      AND json_extract(data_json,'$.invoice.number') NOT GLOB '*[^0-9]*'),10))`;
const conflict = () => fail('Цей номер рахунку вже використано або пропущено в нумерації. Оберіть новий унікальний номер кнопкою «+» біля номера; попередній рахунок збережено.', 409);

export async function invoiceNumberingState(env) {
  const row = await env.DB.prepare(`SELECT ${nextNumberSql} AS next_number`).first();
  const last = await env.DB.prepare('SELECT previous_number,next_number,created_at,actor FROM invoice_numbering_changes ORDER BY next_number DESC LIMIT 1').first();
  return { next_number: row.next_number, max_number: MAX_NUMBER, last_change: last };
}

export async function advanceInvoiceNumbering(env, request, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('Некоректні дані нумерації.');
  const { next_number: next, expected_next_number: expected, request_id: id } = payload;
  if (!/^[a-f0-9-]{36}$/.test(id || '')) throw fail('Некоректний ідентифікатор зміни.');
  if (!Number.isInteger(next) || next < 10 || next > MAX_NUMBER || !Number.isInteger(expected) || expected < 10 || expected > MAX_NUMBER)
    throw fail('Вкажіть цілий номер від 10 до 999999999.');
  if (next <= expected) throw fail('Нумерацію можна змінити тільки вперед.');
  const retry = async () => {
    const old = await env.DB.prepare('SELECT * FROM invoice_numbering_changes WHERE id=?').bind(id).first();
    if (old && (old.previous_number !== expected || old.next_number !== next)) throw fail('Ідентифікатор зміни вже використано.', 409);
    return old;
  };
  if (await retry()) return invoiceNumberingState(env);
  const actor = auditActor(request, env), now = new Date().toISOString();
  let results;
  try {
    // Same transaction as allocation: an intervening invoice or settings change invalidates the form.
    results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO invoice_numbering_changes(id,previous_number,next_number,created_at,actor)
        SELECT ?,?,?,?,? WHERE ?=(${nextNumberSql})`).bind(id,expected,next,now,actor,expected),
      env.DB.prepare(`UPDATE invoice_sequence SET next_number=MAX(next_number,?)
        WHERE id=1 AND EXISTS(SELECT 1 FROM invoice_numbering_changes WHERE id=? AND previous_number=? AND next_number=?)`).bind(next,id,expected,next),
    ]);
  } catch (error) { if (await retry()) return invoiceNumberingState(env); throw error; }
  if (!results[0].meta.changes) {
    if (await retry()) return invoiceNumberingState(env);
    throw fail('Нумерація вже змінилася. Оновіть дані й перевірте наступний номер.', 409);
  }
  await recordAuditEvent(env, { actor, action: 'invoice.numbering.advanced', entity_type: 'invoice_numbering', entity_id: id,
    entity_label: `Наступний рахунок № ${next}`, details: { previous_number: expected, next_number: next } });
  return invoiceNumberingState(env);
}
const fingerprint = async (payload, data, mode) => {
  const bytes = new TextEncoder().encode(JSON.stringify([payload.expected_revision, payload.status, mode, data]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2,'0')).join('');
};

export async function savedRetry(env, store, id, payload, data, mode) {
  const existing = await env.DB.prepare(`SELECT * FROM ${store.table} WHERE id=?`).bind(payload.request_id).first();
  const request = await env.DB.prepare('SELECT * FROM document_save_requests WHERE id=?').bind(payload.request_id).first();
  if (!existing) { if (request) throw fail('Цей ідентифікатор збереження вже використано.', 409); return null; }
  const same = request ? request.scope === store.prefix + id && request.fingerprint === await fingerprint(payload, data, mode)
    : existing[store.key] === id && existing.data_json === JSON.stringify(data) && existing.status === payload.status && (!existing.output_mode || existing.output_mode === mode);
  if (!same) throw fail('Цей ідентифікатор збереження вже використано.', 409);
  return existing.id;
}

export async function writeDocumentVersion(env, { standalone, id, payload, data, mode, actor, now }) {
  const store = documentStore(standalone), scope = store.prefix + id;
  const issuing = payload.status === 'ready' && ['invoice', 'all'].includes(mode) && data.invoice.enabled;
  const allocate = issuing && data.invoice.automatic && !data.invoice.number;
  const account = iban(data.seller.iban), number = normalized(data.invoice.number), payable = issuing ? invoiceAmount(data) : 0;
  let ownedNumber = false;
  if (issuing && data.invoice.automatic && !allocate) {
    const own = await env.DB.prepare('SELECT * FROM invoice_numbers WHERE number=? AND scope=?').bind(number, scope).first();
    if (!own || own.iban !== account || own.amount_minor !== payable) throw conflict();
  }
  if (issuing && !allocate) {
    // Include pre-numbering snapshots. They retain their original identifiers and payment links.
    const rows = (await env.DB.prepare(`SELECT scope,data_json FROM (${allDocumentRows})
      WHERE status='ready' AND output_mode IN ('invoice','all')`).all()).results || [];
    for (const row of rows) {
      let old; try { old = JSON.parse(row.data_json); } catch { continue; }
      if (!old.invoice?.enabled || normalized(old.invoice.number) !== number || iban(old.seller?.iban) !== account) continue;
      if (row.scope !== scope || invoiceAmount(old) !== payable) throw conflict();
      ownedNumber = true;
    }
    const reservation = await env.DB.prepare('SELECT * FROM invoice_numbers WHERE number=? AND iban=?').bind(number, account).first();
    if (reservation && (reservation.scope !== scope || reservation.amount_minor !== payable)) throw conflict();
    if (reservation) ownedNumber = true;
  }
  const newManualNumber = issuing && !allocate && !ownedNumber && /^\d+$/.test(number);
  if (newManualNumber && number.length > 9) throw fail('Числовий номер рахунку має містити не більше 9 цифр.');
  const numberGuard = allocate ? ` AND (${nextNumberSql})<=${MAX_NUMBER}`
    : newManualNumber ? ` AND ${Number(number)}>=(${nextNumberSql})` : '';
  const statements = [env.DB.prepare(`INSERT INTO ${store.table}(id,${store.key},revision,created_at,actor,status,data_json,output_mode)
    SELECT ?,?,?,?,?,?,?,? WHERE ?=(SELECT COALESCE(MAX(revision),0) FROM ${store.table} WHERE ${store.key}=?)${numberGuard}`)
    .bind(payload.request_id, id, payload.expected_revision + 1, now, actor, payload.status, JSON.stringify(data), mode, payload.expected_revision, id)];
  const inserted = `EXISTS(SELECT 1 FROM ${store.table} WHERE id=?)`;
  if (allocate) {
    // D1 batch is transactional: sequence, reservation and snapshot commit together or not at all.
    // External #1-9 and any legacy numeric invoices are never reused, even after deleting an order.
    statements.push(env.DB.prepare(`UPDATE invoice_sequence SET next_number=(${nextNumberSql})+1
      WHERE id=1 AND ${inserted}`).bind(payload.request_id));
    statements.push(env.DB.prepare(`INSERT INTO invoice_numbers(number,iban,scope,amount_minor,created_at)
      SELECT CAST(next_number-1 AS TEXT),?,?,?,? FROM invoice_sequence WHERE id=1 AND ${inserted}`)
      .bind(account, scope, payable, now, payload.request_id));
    statements.push(env.DB.prepare(`UPDATE ${store.table} SET data_json=json_set(data_json,'$.invoice.number',
      (SELECT CAST(next_number-1 AS TEXT) FROM invoice_sequence WHERE id=1)) WHERE id=?`).bind(payload.request_id));
  } else if (issuing) {
    // Matching reservations are no-ops; conflicting concurrent writes violate the NOT NULL constraint.
    statements.push(env.DB.prepare(`INSERT INTO invoice_numbers(number,iban,scope,amount_minor,created_at)
      SELECT ?,?,?,?,? WHERE ${inserted}
      ON CONFLICT(number,iban) DO UPDATE SET scope=CASE
        WHEN scope=excluded.scope AND amount_minor=excluded.amount_minor THEN scope ELSE NULL END`)
      .bind(number, account, scope, payable, now, payload.request_id));
  }
  statements.push(env.DB.prepare(`INSERT INTO document_save_requests(id,scope,fingerprint) SELECT ?,?,? WHERE ${inserted}`)
    .bind(payload.request_id, scope, await fingerprint(payload, data, mode), payload.request_id));
  let results;
  try { results = await env.DB.batch(statements); }
  catch (error) {
    if (await savedRetry(env, store, id, payload, data, mode)) return false;
    if (/invoice_numbers/.test(error.message)) throw conflict();
    if (/UNIQUE constraint.*(?:revision|\.id)/i.test(error.message)) throw fail('Інший менеджер уже зберіг нову версію. Оновіть сторінку.', 409);
    throw error;
  }
  if (!results[0].meta.changes) {
    if (newManualNumber) throw conflict();
    if (allocate && (await invoiceNumberingState(env)).next_number > MAX_NUMBER) throw fail('Діапазон номерів рахунків вичерпано.', 409);
    throw fail('Інший менеджер уже зберіг нову версію. Оновіть сторінку перед збереженням; ваші правки поки залишаються на екрані.', 409);
  }
  return true;
}
