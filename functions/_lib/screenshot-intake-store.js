import { nextPublicNumber } from './crm.js';
import { recordAuditEvent } from './audit-log.js';

// Additive bootstrap mirrors migration 0029; each statement is a separate D1 call.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS screenshot_intake_managers (
    telegram_id TEXT PRIMARY KEY, username TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'paused')),
    requested_at TEXT NOT NULL, updated_at TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS screenshot_intake_drafts (
    id TEXT PRIMARY KEY, manager_id TEXT NOT NULL REFERENCES screenshot_intake_managers(telegram_id),
    chat_id TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('viber', 'whatsapp', 'other')),
    status TEXT NOT NULL DEFAULT 'collecting' CHECK(status IN ('collecting', 'ready', 'applied', 'canceled', 'expired')),
    active_manager_id TEXT UNIQUE, revision INTEGER NOT NULL DEFAULT 0,
    fields_json TEXT NOT NULL DEFAULT '{}', warnings_json TEXT NOT NULL DEFAULT '[]', evidence_json TEXT NOT NULL DEFAULT '{}',
    blocking INTEGER NOT NULL DEFAULT 0, analysis_until INTEGER NOT NULL DEFAULT 0, analysis_token TEXT NOT NULL DEFAULT '', commit_nonce TEXT NOT NULL DEFAULT '', order_id TEXT,
    order_number TEXT NOT NULL DEFAULT '', applied_mode TEXT NOT NULL DEFAULT '', applied_revision INTEGER,
    summary_hash TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, purged_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS screenshot_intake_sources (
    id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES screenshot_intake_drafts(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('text', 'image')), text TEXT NOT NULL DEFAULT '',
    file_id TEXT NOT NULL DEFAULT '', file_unique_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
    UNIQUE(draft_id, message_id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_screenshot_source_file ON screenshot_intake_sources(draft_id, file_unique_id) WHERE file_unique_id != ''`,
  'CREATE INDEX IF NOT EXISTS idx_screenshot_draft_updated ON screenshot_intake_drafts(updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_screenshot_draft_expiry ON screenshot_intake_drafts(expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_screenshot_source_draft ON screenshot_intake_sources(draft_id, message_id)',
  `CREATE TABLE IF NOT EXISTS screenshot_intake_events (
    id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES screenshot_intake_drafts(id), revision INTEGER NOT NULL,
    action TEXT NOT NULL, actor TEXT NOT NULL, order_id TEXT, summary_hash TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
];
const bootstrapped = new WeakSet();
const DAY = 86400000;
export const SCREENSHOT_FIELDS = Object.freeze({ customer_name: 160, customer_phone: 48, car: 240, vin: 17, item_name: 2000, request_text: 4000 });
const FIELDS = SCREENSHOT_FIELDS;
const ACTIVE = new Set(['collecting', 'ready']);
const stmt = (env, sql, ...values) => env.DB.prepare(sql).bind(...values);
const now = () => new Date().toISOString();
const clean = (value, limit = 200) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const parse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const fail = (code, message, status = 409, extra = {}) => Object.assign(new Error(message), { code, status, ...extra });
const approvedSql = 'EXISTS (SELECT 1 FROM screenshot_intake_managers m WHERE m.telegram_id=manager_id AND m.status=\'approved\')';

export async function ensureScreenshotIntake(env) {
  if (!bootstrapped.has(env.DB)) {
    for (const sql of SCHEMA) await env.DB.prepare(sql).run();
    bootstrapped.add(env.DB);
  }
  const date = now(), cutoff = new Date(Date.now() - 7 * DAY).toISOString();
  // Retention is based on creation, not access/update time: repeated reads cannot extend it.
  await env.DB.batch([
    stmt(env, `UPDATE screenshot_intake_drafts SET status='expired', active_manager_id=NULL, analysis_until=0, analysis_token='', updated_at=?
      WHERE status IN ('collecting','ready') AND expires_at<=?`, date, date),
    stmt(env, `DELETE FROM screenshot_intake_sources WHERE draft_id IN (SELECT id FROM screenshot_intake_drafts WHERE created_at<=?)`, cutoff),
    stmt(env, `UPDATE screenshot_intake_drafts SET fields_json='{}', warnings_json='[]', evidence_json='{}', chat_id='', purged_at=?
      WHERE created_at<=? AND purged_at IS NULL`, date, cutoff),
  ]);
}

function telegramId(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d{0,19}$/.test(id)) throw fail('invalid_manager', 'Перевірте Telegram ID менеджера.', 400);
  return id;
}
async function requireManager(env, id) {
  const manager = await stmt(env, 'SELECT * FROM screenshot_intake_managers WHERE telegram_id=?', telegramId(id)).first();
  if (manager?.status !== 'approved') throw fail('manager_not_approved', 'Доступ менеджера ще не схвалено або призупинено.', 403);
  return manager;
}
async function rawDraft(env, id, managerId) {
  if (managerId !== undefined && managerId !== null) await requireManager(env, managerId);
  const row = await stmt(env, 'SELECT * FROM screenshot_intake_drafts WHERE id=?', clean(id, 80)).first();
  if (!row || (managerId != null && row.manager_id !== String(managerId))) throw fail('draft_not_found', 'Чернетку не знайдено.', 404);
  return row;
}
async function hydrate(env, row, sources) {
  const { fields_json, warnings_json, evidence_json, commit_nonce, active_manager_id, analysis_token, ...draft } = row;
  return { ...draft, fields: parse(fields_json, {}), warnings: parse(warnings_json, []), evidence: parse(evidence_json, {}), blocking: Boolean(row.blocking),
    sources: sources ?? ((await stmt(env, 'SELECT id, message_id, kind, text, file_id, file_unique_id, created_at FROM screenshot_intake_sources WHERE draft_id=? ORDER BY message_id, id', row.id).all()).results || []) };
}
function requireActive(draft, revision) {
  if (!ACTIVE.has(draft.status) || draft.expires_at <= now()) throw fail('draft_inactive', 'Чернетку закрито або термін її дії минув. Створіть нову.');
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision !== draft.revision)) throw fail('stale_revision', 'Чернетка змінилася. Перегляньте її ще раз.');
}
function sanitizeFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('invalid_fields', 'Перевірте поля заявки.', 400);
  const fields = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(FIELDS, key) || typeof value !== 'string' || value.length > FIELDS[key]) throw fail('invalid_fields', 'Перевірте перелік полів і допустиму довжину.', 400);
    fields[key] = value.trim();
  }
  if (fields.customer_phone && (!/^\+?[\d ().-]{7,48}$/.test(fields.customer_phone) || !/^\d{7,15}$/.test(normalizedPhone(fields.customer_phone)))) throw fail('invalid_phone', 'Перевірте номер телефону клієнта.', 400);
  if (fields.vin && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(fields.vin)) throw fail('invalid_vin', 'VIN має містити 17 допустимих символів.', 400);
  if (fields.vin) fields.vin = fields.vin.toUpperCase();
  return fields;
}
function normalizedPhone(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('00')) phone = phone.slice(2);
  if (phone.length === 10 && phone.startsWith('0')) phone = `38${phone}`;
  return phone;
}

export async function requestScreenshotAccess(env, from) {
  await ensureScreenshotIntake(env);
  if (from?.is_bot) throw fail('invalid_manager', 'Потрібен особистий обліковий запис.', 400);
  const id = telegramId(from?.id), date = now();
  await stmt(env, `INSERT INTO screenshot_intake_managers (telegram_id, username, display_name, requested_at, updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, display_name=excluded.display_name, updated_at=excluded.updated_at`,
  id, clean(from?.username, 100), clean([from?.first_name, from?.last_name].filter(value => typeof value === 'string').join(' '), 200), date, date).run();
  return stmt(env, 'SELECT * FROM screenshot_intake_managers WHERE telegram_id=?', id).first();
}
export async function setScreenshotManager(env, { telegram_id, status }, actor) {
  await ensureScreenshotIntake(env);
  const id = telegramId(telegram_id);
  if (!['approved', 'paused'].includes(status)) throw fail('invalid_status', 'Недопустимий статус доступу.', 400);
  const result = await stmt(env, 'UPDATE screenshot_intake_managers SET status=?, approved_by=?, updated_at=? WHERE telegram_id=?', status, clean(actor, 100), now(), id).run();
  if (!result.meta?.changes) throw fail('manager_not_found', 'Спочатку менеджер має надіслати запит доступу боту.', 404);
  await recordAuditEvent(env, { actor, action: `screenshot.manager.${status}`, entity_type: 'screenshot_manager', entity_id: id });
  return stmt(env, 'SELECT * FROM screenshot_intake_managers WHERE telegram_id=?', id).first();
}
export async function screenshotManager(env, id) {
  await ensureScreenshotIntake(env);
  return stmt(env, 'SELECT * FROM screenshot_intake_managers WHERE telegram_id=?', telegramId(id)).first();
}
export async function screenshotOverview(env) {
  await ensureScreenshotIntake(env);
  const managers = (await env.DB.prepare('SELECT * FROM screenshot_intake_managers ORDER BY updated_at DESC LIMIT 100').all()).results || [];
  const rows = (await env.DB.prepare('SELECT * FROM screenshot_intake_drafts ORDER BY updated_at DESC, id DESC LIMIT 100').all()).results || [];
  // One bounded source query avoids an N+1 read for up to 100 drafts (600 sources).
  const sources = (await env.DB.prepare(`SELECT id,draft_id,message_id,kind,text,file_id,file_unique_id,created_at FROM screenshot_intake_sources
    WHERE draft_id IN (SELECT id FROM screenshot_intake_drafts ORDER BY updated_at DESC,id DESC LIMIT 100) ORDER BY message_id,id`).all()).results || [];
  const byDraft = new Map();
  for (const { draft_id, ...source } of sources) {
    if (!byDraft.has(draft_id)) byDraft.set(draft_id, []);
    byDraft.get(draft_id).push(source);
  }
  return { managers, drafts: await Promise.all(rows.map(row => hydrate(env, row, byDraft.get(row.id) || []))) };
}
export async function getScreenshotDraft(env, id, managerId) {
  await ensureScreenshotIntake(env);
  return hydrate(env, await rawDraft(env, id, managerId));
}
export async function activeScreenshotDraft(env, managerId) {
  await ensureScreenshotIntake(env);
  const manager = await requireManager(env, managerId);
  const row = await stmt(env, 'SELECT * FROM screenshot_intake_drafts WHERE active_manager_id=?', manager.telegram_id).first();
  return row ? hydrate(env, row) : null;
}
export async function createScreenshotDraft(env, { manager_id, chat_id, channel }) {
  await ensureScreenshotIntake(env);
  const manager = await requireManager(env, manager_id);
  if (String(chat_id) !== manager.telegram_id) throw fail('private_chat_required', 'Надішліть скріншоти в особистий чат бота.', 400);
  if (!['viber', 'whatsapp', 'other'].includes(channel)) throw fail('invalid_channel', 'Оберіть джерело діалогу.', 400);
  const date = now(), id = crypto.randomUUID();
  await stmt(env, `INSERT OR IGNORE INTO screenshot_intake_drafts (id,manager_id,chat_id,channel,active_manager_id,created_at,updated_at,expires_at)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM screenshot_intake_managers WHERE telegram_id=? AND status='approved')`,
  id, manager.telegram_id, String(chat_id), channel, manager.telegram_id, date, date, new Date(Date.now() + DAY).toISOString(), manager.telegram_id).run();
  const row = await stmt(env, 'SELECT * FROM screenshot_intake_drafts WHERE active_manager_id=?', manager.telegram_id).first();
  if (!row) throw fail('manager_not_approved', 'Доступ менеджера призупинено.', 403);
  if (row.channel !== channel) throw fail('active_draft_exists', 'Спочатку завершіть або скасуйте поточну чернетку.');
  return hydrate(env, row);
}
export async function cancelScreenshotDraft(env, id, managerId) {
  await ensureScreenshotIntake(env);
  const draft = await rawDraft(env, id, telegramId(managerId));
  if (draft.status === 'canceled') return hydrate(env, draft);
  requireActive(draft);
  await stmt(env, `UPDATE screenshot_intake_drafts SET status='canceled', active_manager_id=NULL, revision=revision+1, analysis_until=0, analysis_token='', updated_at=?
    WHERE id=? AND status IN ('collecting','ready') AND ${approvedSql}`, now(), id).run();
  return getScreenshotDraft(env, id, managerId);
}
export async function addScreenshotSource(env, id, managerId, source) {
  await ensureScreenshotIntake(env);
  const draft = await rawDraft(env, id, telegramId(managerId));
  requireActive(draft);
  const messageId = Number(source?.message_id), kind = source?.kind;
  const body = typeof source?.text === 'string' ? source.text.trim() : '';
  const fileId = clean(source?.file_id, 1024), uniqueId = clean(source?.file_unique_id, 256);
  if (!Number.isSafeInteger(messageId) || messageId < 1 || !['text', 'image'].includes(kind)
    || (kind === 'text' && (!body || fileId || uniqueId)) || (kind === 'image' && (!/^[A-Za-z0-9_-]+$/.test(fileId) || !/^[A-Za-z0-9_-]+$/.test(uniqueId))) || body.length > 20000) throw fail('invalid_source', 'Надішліть текст або зображення в межах ліміту.', 400);
  const date = now();
  await env.DB.batch([
    stmt(env, `INSERT OR IGNORE INTO screenshot_intake_sources (id,draft_id,message_id,kind,text,file_id,file_unique_id,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM screenshot_intake_drafts
        WHERE id=? AND status IN ('collecting','ready') AND expires_at>? AND ${approvedSql})
      AND (SELECT COUNT(*) FROM screenshot_intake_sources WHERE draft_id=?)<6
      AND COALESCE((SELECT SUM(length(text)) FROM screenshot_intake_sources WHERE draft_id=?),0)+?<=20000`,
    crypto.randomUUID(), id, messageId, kind, body, fileId, uniqueId, date, id, date, id, id, body.length),
    stmt(env, `UPDATE screenshot_intake_drafts SET revision=revision+1, status='collecting', fields_json='{}', warnings_json='[]', evidence_json='{}', blocking=0, analysis_until=0, analysis_token='', updated_at=?
      WHERE id=? AND changes()>0`, date, id),
  ]);
  const updated = await getScreenshotDraft(env, id, managerId);
  if (!updated.sources.some(row => row.message_id === messageId || (uniqueId && row.file_unique_id === uniqueId))) {
    requireActive(updated);
    throw fail('source_limit', 'Ліміт: 6 повідомлень/зображень і 20 000 символів на чернетку.', 400);
  }
  return updated;
}
export async function saveScreenshotAnalysis(env, id, managerId, revision, analysis) {
  await ensureScreenshotIntake(env);
  const draft = await rawDraft(env, id, telegramId(managerId));
  requireActive(draft, revision);
  const fields = sanitizeFields(analysis?.fields || {});
  const warnings = Array.isArray(analysis?.warnings) ? analysis.warnings.filter(value => typeof value === 'string').slice(0, 30).map(value => clean(value, 500)) : [];
  const evidence = analysis?.evidence && typeof analysis.evidence === 'object' && !Array.isArray(analysis.evidence) ? analysis.evidence : {};
  if (JSON.stringify(evidence).length > 20000) throw fail('invalid_evidence', 'Забагато даних обґрунтування.', 400);
  const result = await stmt(env, `UPDATE screenshot_intake_drafts SET fields_json=?,warnings_json=?,evidence_json=?,blocking=?,status='ready',revision=revision+1,analysis_until=0,analysis_token='',updated_at=?
    WHERE id=? AND revision=? AND status IN ('collecting','ready') AND expires_at>? AND ${approvedSql}
    AND ((analysis_until=0 AND ?='') OR (analysis_token=? AND ?!=''))
    AND EXISTS (SELECT 1 FROM screenshot_intake_sources WHERE draft_id=?)`,
  JSON.stringify(fields), JSON.stringify(warnings), JSON.stringify(evidence), analysis?.blocking ? 1 : 0, now(), id, revision, now(), clean(analysis?.analysis_token, 80), clean(analysis?.analysis_token, 80), clean(analysis?.analysis_token, 80), id).run();
  if (!result.meta?.changes) throw fail('stale_revision', 'Джерела або доступ змінилися. Перевірте чернетку.');
  return getScreenshotDraft(env, id, managerId);
}
export async function updateScreenshotFields(env, id, managerId, revision, input) {
  await ensureScreenshotIntake(env);
  const draft = await rawDraft(env, id, telegramId(managerId));
  requireActive(draft, revision);
  const fields = { ...sanitizeFields(parse(draft.fields_json, {})), ...sanitizeFields(input) };
  const result = await stmt(env, `UPDATE screenshot_intake_drafts SET fields_json=?,warnings_json=?,evidence_json='{}',blocking=0,status='ready',revision=revision+1,analysis_until=0,analysis_token='',updated_at=?
    WHERE id=? AND revision=? AND status IN ('collecting','ready') AND expires_at>? AND ${approvedSql}
    AND EXISTS (SELECT 1 FROM screenshot_intake_sources WHERE draft_id=?)`,
  JSON.stringify(fields), JSON.stringify(['Поля перевірено та відредаговано вручну.']), now(), id, revision, now(), id).run();
  if (!result.meta?.changes) throw fail('stale_revision', 'Джерела або доступ змінилися. Перевірте чернетку.');
  return getScreenshotDraft(env, id, managerId);
}

export async function claimScreenshotAnalysis(env, id, managerId, revision) {
  await ensureScreenshotIntake(env);
  const draft = await rawDraft(env, id, telegramId(managerId));
  requireActive(draft, revision);
  const timestamp = Date.now(), token = crypto.randomUUID();
  const result = await stmt(env, `UPDATE screenshot_intake_drafts SET analysis_until=?,analysis_token=? WHERE id=? AND revision=?
    AND status IN ('collecting','ready') AND expires_at>? AND analysis_until<=? AND ${approvedSql}
    AND EXISTS (SELECT 1 FROM screenshot_intake_sources WHERE draft_id=?)`, timestamp + 8 * 60000, token, id, revision, now(), timestamp, id).run();
  if (!result.meta?.changes) throw fail('analysis_busy', 'Розбір уже триває або чернетка змінилася. Зачекайте та перевірте статус.');
  return { ...await getScreenshotDraft(env, id, managerId), analysis_token: token };
}
export async function releaseScreenshotAnalysis(env, id, managerId, revision, token) {
  await ensureScreenshotIntake(env);
  await rawDraft(env, id, telegramId(managerId));
  await stmt(env, `UPDATE screenshot_intake_drafts SET analysis_until=0,analysis_token='' WHERE id=? AND revision=? AND analysis_token=?`, id, revision, clean(token, 80)).run();
}

const phoneDigitsSql = ["' '", "'+'", "'-'", "'('", "')'", "'.'", 'char(9)', 'char(10)', 'char(13)', 'char(160)']
  .reduce((sql, char) => `replace(${sql},${char},'')`, "COALESCE(o.customer_phone,'')");
const phoneSql = `CASE WHEN substr(${phoneDigitsSql},1,2)='00' THEN substr(${phoneDigitsSql},3)
  WHEN length(${phoneDigitsSql})=10 AND substr(${phoneDigitsSql},1,1)='0' THEN '38'||${phoneDigitsSql} ELSE ${phoneDigitsSql} END`;
const duplicatesWhere = `((?!='' AND ${phoneSql}=?) OR (?!='' AND upper(trim(COALESCE(o.vin,'')))=?))`;
const duplicateBinds = fields => { const phone = normalizedPhone(fields.customer_phone), vin = clean(fields.vin, 17).toUpperCase(); return [phone, phone, vin, vin]; };
async function duplicates(env, fields) {
  return (await stmt(env, `SELECT o.id,o.order_number,o.car,o.item_name,o.updated_at,o.status FROM orders o
    WHERE ${duplicatesWhere} ORDER BY o.updated_at DESC,o.id DESC LIMIT 5`, ...duplicateBinds(fields)).all()).results || [];
}
export async function findScreenshotDuplicates(env, draft) {
  await ensureScreenshotIntake(env);
  const current = await rawDraft(env, draft?.id, telegramId(draft?.manager_id));
  return duplicates(env, parse(current.fields_json, {}));
}
function appliedResult(draft, alreadyApplied) {
  return { draft_id: draft.id, order_id: draft.order_id, order_number: draft.order_number, mode: draft.applied_mode, applied: true, already_applied: alreadyApplied };
}
function checkApplied(draft, revision, options) {
  if (draft.status !== 'applied') return null;
  if (draft.applied_revision !== revision || draft.applied_mode !== options.mode || (options.mode === 'append' && draft.order_id !== options.order_id)) throw fail('already_applied', 'Чернетку вже застосовано з іншими параметрами.');
  return appliedResult(draft, true);
}
const summaryText = (fields, channel) => [
  `Заявка зі скріншотів (${channel}), перевірено менеджером.`,
  ...Object.entries({ customer_name: 'Клієнт', customer_phone: 'Телефон', car: 'Авто', vin: 'VIN', item_name: 'Запчастини', request_text: 'Запит' })
    .filter(([key]) => fields[key]).map(([key, label]) => `${label}: ${fields[key]}`),
].join('\n');

export async function confirmScreenshotDraft(env, id, managerId, revision, options, actor) {
  await ensureScreenshotIntake(env);
  const draft = await rawDraft(env, id, telegramId(managerId));
  if (!['create', 'append'].includes(options?.mode)) throw fail('invalid_mode', 'Оберіть створення або доповнення заявки.', 400);
  const already = checkApplied(draft, revision, options);
  if (already) return already;
  requireActive(draft, revision);
  if (draft.analysis_until > Date.now()) throw fail('analysis_busy', 'Розбір ще триває. Дочекайтеся нової чернетки.');
  if (draft.status !== 'ready' || draft.blocking) throw fail('review_required', 'Перевірте неоднозначні дані та підтвердьте виправлення перед створенням.');
  const fields = sanitizeFields(parse(draft.fields_json, {}));
  if (!fields.item_name || (options.mode === 'create' && !fields.customer_phone)) throw fail('missing_fields', 'Для нової заявки потрібні запчастина та телефон клієнта.', 400);
  const isCreate = options.mode === 'create';
  const order = isCreate ? null : await stmt(env, 'SELECT id,order_number,updated_at,status FROM orders WHERE id=?', clean(options.order_id, 80)).first();
  if (!isCreate && (!order || order.status === 'canceled' || !options.order_updated_at || options.order_updated_at !== order.updated_at)) throw fail('order_changed', 'Замовлення змінено, скасовано або не знайдено. Оновіть його перед доповненням.');
  if (isCreate && options.allow_duplicate !== true) {
    const matches = await duplicates(env, fields);
    if (matches.length) throw fail('duplicate_detected', 'Знайдено можливі дублікати. Перевірте їх або явно створіть окрему заявку.', 409, { duplicates: matches });
  }
  const orderId = order?.id || crypto.randomUUID(), customerId = crypto.randomUUID(), leadId = crypto.randomUUID();
  const nonce = crypto.randomUUID(), eventId = crypto.randomUUID();
  const date = new Date(Math.max(Date.now(), (Date.parse(order?.updated_at) || 0) + 1)).toISOString();
  const summary = summaryText(fields, draft.channel);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(summary))), byte => byte.toString(16).padStart(2, '0')).join('');
  const numbers = isCreate ? [await nextPublicNumber(env, 'customer', 'C'), await nextPublicNumber(env, 'lead', 'L'), await nextPublicNumber(env, 'order', 'O')] : [];
  const gate = 'EXISTS (SELECT 1 FROM screenshot_intake_drafts WHERE id=? AND commit_nonce=?)';
  const extraGuard = !isCreate ? "AND EXISTS (SELECT 1 FROM orders WHERE id=? AND updated_at=? AND status!='canceled')"
    : options.allow_duplicate === true ? '' : `AND NOT EXISTS (SELECT 1 FROM orders o WHERE ${duplicatesWhere})`;
  const extraBinds = !isCreate ? [orderId, options.order_updated_at] : options.allow_duplicate === true ? [] : duplicateBinds(fields);
  const batch = [stmt(env, `UPDATE screenshot_intake_drafts SET commit_nonce=? WHERE id=? AND manager_id=? AND revision=?
    AND status='ready' AND blocking=0 AND expires_at>? AND analysis_until<=? AND ${approvedSql} ${extraGuard}`, nonce, id, draft.manager_id, revision, date, Date.now(), ...extraBinds)];
  if (isCreate) {
    batch.push(stmt(env, `INSERT INTO customers (id,customer_number,created_at,updated_at,name,phone,preferred_channel)
      SELECT ?,?,?,?,?,?,? WHERE ${gate}`, customerId, numbers[0], date, date, fields.customer_name || '', fields.customer_phone, draft.channel === 'other' ? 'phone' : draft.channel, id, nonce));
    batch.push(stmt(env, `INSERT INTO leads (id,lead_number,created_at,updated_at,type,status,name,phone,car,vin,message,source,medium,attribution_type)
      SELECT ?,?,?,?,'parts','new',?,?,?,?,?,'manual',?,'manual' WHERE ${gate}`,
    leadId, numbers[1], date, date, fields.customer_name || '', fields.customer_phone, fields.car || '', fields.vin || '', fields.request_text || fields.item_name, draft.channel, id, nonce));
    batch.push(stmt(env, `INSERT INTO orders (id,order_number,customer_id,lead_id,created_at,updated_at,type,status,payment_status,manager_contact,
      customer_name,customer_phone,car,vin,item_name,request_text,manager_notes,source,medium,attribution_type)
      SELECT ?,?,?,?,?,?,'parts','new','unknown','@evline_support',?,?,?,?,?,?,?,'manual',?,'manual' WHERE ${gate}`,
    orderId, numbers[2], customerId, leadId, date, date, fields.customer_name || '', fields.customer_phone, fields.car || '', fields.vin || '', fields.item_name,
    fields.request_text || fields.item_name, summary, draft.channel, id, nonce));
    batch.push(stmt(env, `INSERT INTO order_status_events (id,created_at,order_id,status,actor,comment)
      SELECT ?,?,?,'new',?,'Заявку зі скріншотів підтверджено менеджером' WHERE ${gate}`, crypto.randomUUID(), date, orderId, clean(actor, 100), id, nonce));
  } else {
    batch.push(stmt(env, `UPDATE orders SET manager_notes=CASE WHEN COALESCE(manager_notes,'')='' THEN ? ELSE manager_notes||char(10)||char(10)||? END,
      updated_at=? WHERE id=? AND ${gate}`, summary, summary, date, orderId, id, nonce));
  }
  batch.push(stmt(env, `INSERT INTO screenshot_intake_events (id,draft_id,revision,action,actor,order_id,summary_hash,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`, eventId, id, revision, options.mode, clean(actor, 100), orderId, hash, date, id, nonce));
  batch.push(stmt(env, `UPDATE screenshot_intake_drafts SET status='applied',active_manager_id=NULL,order_id=?,order_number=?,applied_mode=?,applied_revision=?,summary_hash=?,updated_at=?
    WHERE id=? AND commit_nonce=?`, orderId, order?.order_number || numbers[2], options.mode, revision, hash, date, id, nonce));
  await env.DB.batch(batch);
  const current = await rawDraft(env, id, managerId);
  const committed = await stmt(env, 'SELECT id FROM screenshot_intake_events WHERE id=?', eventId).first();
  if (!committed) {
    const retried = checkApplied(current, revision, options);
    if (retried) return retried;
    if (isCreate && options.allow_duplicate !== true) {
      const matches = await duplicates(env, fields);
      if (matches.length) throw fail('duplicate_detected', 'Знайдено можливі дублікати. Перевірте їх перед підтвердженням.', 409, { duplicates: matches });
    }
    throw fail('stale_revision', 'Чернетка, доступ або замовлення змінилися. Перевірте дані ще раз.');
  }
  await recordAuditEvent(env, { actor, action: `screenshot.intake.${options.mode}`, entity_type: 'order', entity_id: orderId, order_id: orderId,
    details: { draft_id: id, revision, channel: draft.channel, summary_hash: hash } });
  return appliedResult(current, false);
}
