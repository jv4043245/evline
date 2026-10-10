import { ACCOUNTING_TIMEZONE, accountingDay } from './accounting.js';
import { IGOR_MAX_MINOR, readIgorAdvertising } from './accounting-igor.js';

export const IGOR_BASIS = 'advertising_reimbursement';
const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function validateIgorMonth(month, now = new Date()) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < '2020-01' || month > accountingDay(now).slice(0, 7)) throw fail('accounting_igor_invalid_month');
  return month;
}

export function validateIgorDraftInput(payload, now = new Date()) {
  if (!exactKeys(payload, ['month', 'expected_revision', 'inputs'])) throw fail('accounting_igor_invalid_payload');
  validateIgorMonth(payload.month, now);
  if (!Number.isSafeInteger(payload.expected_revision) || payload.expected_revision < 0 || payload.expected_revision >= Number.MAX_SAFE_INTEGER) throw fail('accounting_igor_invalid_revision');
  if (!exactKeys(payload.inputs, ['fees_minor', 'fees_note'])) throw fail('accounting_igor_invalid_inputs');
  const { fees_minor, fees_note } = payload.inputs;
  if (fees_minor !== null && (!Number.isSafeInteger(fees_minor) || fees_minor < 0 || fees_minor > IGOR_MAX_MINOR)) throw fail('accounting_igor_invalid_fees');
  if (typeof fees_note !== 'string' || fees_note.length > 500 || /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/.test(fees_note)) throw fail('accounting_igor_invalid_note');
  if (fees_minor > 0 && !fees_note.trim()) throw fail('accounting_igor_note_required');
  return { month: payload.month, expected_revision: payload.expected_revision, inputs: { fees_minor, fees_note: fees_note.trim() } };
}

export function calculateIgorReimbursement(inputs, advertising) {
  const missing = [];
  if (advertising.coverage !== 'complete' || ['google_minor', 'meta_minor', 'total_minor'].some(key => !Number.isSafeInteger(advertising[key]) || advertising[key] < 0)
      || BigInt(advertising.google_minor) + BigInt(advertising.meta_minor) !== BigInt(advertising.total_minor)) missing.push('advertising');
  if (!Number.isSafeInteger(inputs.fees_minor) || inputs.fees_minor < 0 || inputs.fees_minor > IGOR_MAX_MINOR) missing.push('fees_minor');
  if (inputs.fees_minor > 0 && (typeof inputs.fees_note !== 'string' || !inputs.fees_note.trim())) missing.push('fees_note');
  if (missing.length) return { status: advertising.coverage === 'not_configured' ? 'not_configured' : 'incomplete', reimbursement_minor: null, missing_keys: missing };
  const total = BigInt(advertising.total_minor) + BigInt(inputs.fees_minor);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw fail('accounting_igor_total_out_of_range', 503);
  return { status: 'draft', reimbursement_minor: Number(total), missing_keys: [] };
}

function monthWindow(month, now) {
  const today = accountingDay(now), from = `${month}-01`;
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const through = last < yesterday ? last : yesterday;
  return { from, through: through < from ? null : through, current: month === today.slice(0, 7) };
}

async function monthlyAdvertising(db, month, now, advertisingReader) {
  const { from, through } = monthWindow(month, now);
  if (through) return advertisingReader(db, { from, to: through, now });
  // The first day has no completed advertising day. Still expose the reviewed
  // campaign configuration; it cannot manufacture a zero or a payable amount.
  const rows = await db.prepare('SELECT provider,account_id,campaign_id,starts_on,ends_on FROM accounting_igor_campaigns ORDER BY provider,campaign_id').all();
  return { google_minor: null, meta_minor: null, total_minor: null, coverage: rows.results?.length ? 'missing' : 'not_configured', through: null, campaigns: rows.results || [] };
}

function response(month, row, report, now) {
  const inputs = { fees_minor: row?.fees_minor ?? null, fees_note: row?.fees_note || '' };
  const advertising = Object.fromEntries(['google_minor', 'meta_minor', 'total_minor', 'coverage', 'through'].map(key => [key, report[key]]));
  const current = monthWindow(month, now).current;
  return { month, revision: row?.revision || 0, basis: IGOR_BASIS, currency: 'UAH', timezone: ACCOUNTING_TIMEZONE,
    inputs, advertising, calculation: calculateIgorReimbursement(inputs, advertising), campaigns: report.campaigns || [],
    current_month: current, is_provisional: current, updated_at: row?.updated_at || null };
}

export async function readIgorDraft(db, month, { now = new Date(), advertisingReader = readIgorAdvertising } = {}) {
  validateIgorMonth(month, now);
  const [rows, advertising] = await Promise.all([
    db.prepare('SELECT fees_minor,fees_note,revision,updated_at FROM accounting_igor_drafts WHERE month=?').bind(month).all(),
    monthlyAdvertising(db, month, now, advertisingReader),
  ]);
  return response(month, rows.results?.[0], advertising, now);
}

/** Saves declared incremental fees, not an estimated percentage, bank debit,
 * payout, invoice approval or campaign assignment. Every draft records the
 * advertising snapshot shown at that moment. Later exports never rewrite it.
 */
export async function saveIgorDraft(db, payload, actorId, { now = new Date(), advertisingReader = readIgorAdvertising } = {}) {
  const { month, expected_revision, inputs } = validateIgorDraftInput(payload, now);
  if (typeof actorId !== 'string' || !actorId.trim() || actorId.length > 200) throw fail('accounting_igor_invalid_actor', 401);
  const report = await monthlyAdvertising(db, month, now, advertisingReader);
  const updated_at = new Date(now).toISOString(), saveId = crypto.randomUUID();
  const result = response(month, { ...inputs, revision: expected_revision + 1, updated_at }, report, now);
  const statement = db.prepare(`INSERT INTO accounting_igor_drafts(month,fees_minor,fees_note,revision,updated_at,updated_by,save_id)
    SELECT ?,?,?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM accounting_igor_drafts WHERE month=? AND revision=?)
    ON CONFLICT(month) DO UPDATE SET fees_minor=excluded.fees_minor,fees_note=excluded.fees_note,revision=excluded.revision,
      updated_at=excluded.updated_at,updated_by=excluded.updated_by,save_id=excluded.save_id
    WHERE accounting_igor_drafts.revision=?`).bind(month, inputs.fees_minor, inputs.fees_note, result.revision, updated_at, actorId, saveId,
      expected_revision, month, expected_revision, expected_revision);
  const audit = db.prepare(`INSERT INTO accounting_igor_revisions(month,revision,save_id,created_at,actor_id,snapshot_json)
    SELECT month,revision,save_id,updated_at,updated_by,? FROM accounting_igor_drafts WHERE month=? AND save_id=?`).bind(JSON.stringify(result), month, saveId);
  await db.batch([statement, audit]);
  const saved = await db.prepare('SELECT save_id FROM accounting_igor_revisions WHERE save_id=?').bind(saveId).all();
  if (!saved.results?.length) throw fail('accounting_igor_conflict', 409);
  return result;
}
