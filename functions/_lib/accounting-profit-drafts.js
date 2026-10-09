import { ACCOUNTING_TIMEZONE, accountingDay, readAccounting } from './accounting.js';
import { calculateMonthlyManagerPreview } from './accounting-profit.js';

export const PROFIT_BASIS = 'paid_and_delivered';
export const PROFIT_MAX_INPUT_MINOR = 100000000000;
const INPUT_KEYS = ['revenue_minor', 'purchase_minor', 'shipping_minor', 'other_minor', 'other_note'];
const MONEY_KEYS = INPUT_KEYS.slice(0, 4);
const EMPTY_INPUTS = Object.freeze({ revenue_minor: null, purchase_minor: null, shipping_minor: null, other_minor: null, other_note: '' });

function fail(code, status = 400) { const error = new Error(code); error.status = status; return error; }
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, keys) {
  return plainObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function validateProfitMonth(month, now = new Date()) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < '2020-01' || month > accountingDay(now).slice(0, 7)) {
    throw fail('invalid_profit_month');
  }
  return month;
}

export function validateProfitDraftInput(payload, now = new Date()) {
  if (!exactKeys(payload, ['month', 'expected_revision', 'inputs'])) throw fail('invalid_profit_payload');
  const month = validateProfitMonth(payload.month, now);
  if (!Number.isSafeInteger(payload.expected_revision) || payload.expected_revision < 0 || payload.expected_revision >= Number.MAX_SAFE_INTEGER) throw fail('invalid_profit_revision');
  if (!exactKeys(payload.inputs, INPUT_KEYS)) throw fail('invalid_profit_inputs');
  for (const key of MONEY_KEYS) {
    const value = payload.inputs[key];
    if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > PROFIT_MAX_INPUT_MINOR)) throw fail(`invalid_${key}`);
  }
  const note = payload.inputs.other_note;
  // Plain text, not HTML; no invisible controls or bidi overrides. The UI must
  // still render textContent. Notes describe costs, not customer identities.
  if (typeof note !== 'string' || note.length > 500 || /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/.test(note)) throw fail('invalid_other_note');
  if (payload.inputs.other_minor > 0 && !note.trim()) throw fail('other_note_required');
  return { month, expected_revision: payload.expected_revision, inputs: { ...payload.inputs, other_note: note.trim() } };
}

function monthWindow(month, now) {
  const today = accountingDay(now);
  const from = `${month}-01`;
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const through = (last < yesterday ? last : yesterday);
  return { from, through: through < from ? null : through, current: month === today.slice(0, 7) };
}

async function advertisingForMonth(db, month, now, accountingReader) {
  const { from, through } = monthWindow(month, now);
  if (!through) return { google_minor: null, meta_minor: null, total_minor: null, coverage: 'missing', through: null };
  const report = await accountingReader(db, { from, to: through, now });
  const amounts = {};
  for (const provider of ['google', 'meta']) {
    const rows = report.daily;
    // Avoid adding floating UAH totals. Each canonical per-day value originates
    // as integer kopecks; only fully covered providers can affect the preview.
    if (report.sources[provider].status !== 'complete') { amounts[provider] = null; continue; }
    let total = 0n;
    for (const row of rows) {
      const amount = row[`${provider}_uah`];
      const minor = Math.round(amount * 100);
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(minor) || row[`${provider}_coverage`] !== 'complete') throw fail('invalid_advertising_amount', 503);
      total += BigInt(minor);
    }
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw fail('advertising_total_out_of_range', 503);
    amounts[provider] = Number(total);
  }
  const complete = amounts.google !== null && amounts.meta !== null;
  const total = complete ? amounts.google + amounts.meta : null;
  if (complete && !Number.isSafeInteger(total)) throw fail('advertising_total_out_of_range', 503);
  return { google_minor: amounts.google, meta_minor: amounts.meta, total_minor: total,
    coverage: complete ? 'complete' : (report.sources.google.status === 'missing' && report.sources.meta.status === 'missing' ? 'missing' : 'partial'), through };
}

function draftResponse(month, row, advertising, now) {
  const inputs = row ? Object.fromEntries(INPUT_KEYS.map(key => [key, row[key]])) : { ...EMPTY_INPUTS };
  const current = monthWindow(month, now).current;
  return { month, revision: row?.revision || 0, basis: PROFIT_BASIS, currency: 'UAH', timezone: ACCOUNTING_TIMEZONE,
    inputs, advertising, calculation: calculateMonthlyManagerPreview({ ...inputs, advertising_minor: advertising.total_minor }),
    is_provisional: current, current_month: current, updated_at: row?.updated_at || null };
}

export async function readProfitDraft(db, month, { now = new Date(), accountingReader = readAccounting } = {}) {
  validateProfitMonth(month, now);
  const rows = await db.prepare('SELECT * FROM accounting_profit_drafts WHERE month = ?').bind(month).all();
  const advertising = await advertisingForMonth(db, month, now, accountingReader);
  return draftResponse(month, rows.results?.[0], advertising, now);
}

/** Atomically compare-and-swap the explicit manual draft and insert its audit.
 * A unique per-save ID binds the audit to this request even under concurrent
 * writes; a missing month cannot be created with expected_revision > 0.
 */
export async function saveProfitDraft(db, payload, actorId, { now = new Date(), accountingReader = readAccounting } = {}) {
  const { month, expected_revision, inputs } = validateProfitDraftInput(payload, now);
  if (typeof actorId !== 'string' || !actorId.trim() || actorId.length > 200) throw fail('invalid_profit_actor', 401);
  const advertising = await advertisingForMonth(db, month, now, accountingReader);
  const updated_at = new Date(now).toISOString();
  const saveId = crypto.randomUUID();
  const row = { ...inputs, revision: expected_revision + 1, updated_at };
  const response = draftResponse(month, row, advertising, now);
  const snapshotJson = JSON.stringify(response);
  const statement = db.prepare(`INSERT INTO accounting_profit_drafts
    (month,basis,revenue_minor,purchase_minor,shipping_minor,other_minor,other_note,revision,updated_at,updated_by,save_id)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ? = 0 OR EXISTS (SELECT 1 FROM accounting_profit_drafts WHERE month = ? AND revision = ?)
    ON CONFLICT(month) DO UPDATE SET basis=excluded.basis,revenue_minor=excluded.revenue_minor,
    purchase_minor=excluded.purchase_minor,shipping_minor=excluded.shipping_minor,other_minor=excluded.other_minor,
    other_note=excluded.other_note,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by,save_id=excluded.save_id
    WHERE accounting_profit_drafts.revision = ?`).bind(month, PROFIT_BASIS, inputs.revenue_minor, inputs.purchase_minor, inputs.shipping_minor,
      inputs.other_minor, inputs.other_note, row.revision, updated_at, actorId, saveId, expected_revision, month, expected_revision, expected_revision);
  const audit = db.prepare(`INSERT INTO accounting_profit_revisions(month,revision,save_id,created_at,actor_id,snapshot_json)
    SELECT month,revision,save_id,updated_at,updated_by,? FROM accounting_profit_drafts WHERE month = ? AND save_id = ?`).bind(snapshotJson, month, saveId);
  await db.batch([statement, audit]);
  const saved = await db.prepare('SELECT save_id FROM accounting_profit_revisions WHERE save_id = ?').bind(saveId).all();
  if (!saved.results?.length) throw fail('accounting_profit_conflict', 409);
  return response;
}
