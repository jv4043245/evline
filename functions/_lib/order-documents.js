import { fromOrder, normalizeDocument, validateReady, cleanSeller, DEFAULT_SELLER, fail, documentMode } from '../../admin/documents/model.js';
import { auditActor, recordAuditEvent } from './audit-log.js';

export const DOCUMENT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS order_documents (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL, created_at TEXT NOT NULL, actor TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft','ready')), data_json TEXT NOT NULL,
    UNIQUE(order_id, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS document_seller_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL, actor TEXT NOT NULL, data_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS document_deliveries (
    id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES order_documents(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, actor TEXT NOT NULL, recipient TEXT NOT NULL,
    status TEXT NOT NULL, message_id TEXT, error TEXT
  )`,
];
export async function ensureDocuments(env) { for (const sql of DOCUMENT_SCHEMA) await env.DB.prepare(sql).run(); }
export async function documentOrder(env, id) {
  const order = await env.DB.prepare(`SELECT o.*, c.telegram_chat_id AS customer_telegram_chat_id
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=?`).bind(id).first();
  if (!order) throw fail('Замовлення не знайдено.', 404);
  if (order.type !== 'parts') throw fail('Цей шаблон призначено для замовлень автозапчастин. Для послуг потрібен окремий договір.');
  return order;
}
export function documentRecipient(order) {
  const id = String(order.telegram_chat_id || order.customer_telegram_chat_id || '');
  return /^[1-9]\d{3,15}$/.test(id) ? id : '';
}
export async function sellerSettings(env) {
  const row = await env.DB.prepare('SELECT * FROM document_seller_settings WHERE id=1').first();
  const value = row ? JSON.parse(row.data_json) : DEFAULT_SELLER;
  // Read the original single-seller settings without changing saved documents.
  const settings = value.profiles ? value : { profiles: [{ id: 'primary', seller: cleanSeller(value) }], default_id: 'primary' };
  return { ...settings, revision: row?.revision || 0 };
}
export async function getDocumentContext(env, orderId, versionId = '') {
  const order = await documentOrder(env, orderId);
  await ensureDocuments(env);
  const versions = (await env.DB.prepare('SELECT id, revision, created_at, actor, status FROM order_documents WHERE order_id=? ORDER BY revision DESC LIMIT 100').bind(orderId).all()).results;
  const saved = versionId
    ? await env.DB.prepare('SELECT * FROM order_documents WHERE order_id=? AND id=?').bind(orderId, versionId).first()
    : await env.DB.prepare('SELECT * FROM order_documents WHERE order_id=? ORDER BY revision DESC LIMIT 1').bind(orderId).first();
  if (versionId && !saved) throw fail('Версію документа не знайдено.', 404);
  const settings = await sellerSettings(env);
  const profile = settings.profiles.find(p => p.id === settings.default_id) || settings.profiles[0];
  const items = (await env.DB.prepare('SELECT title, sku, quantity, unit_price_uah FROM order_items WHERE order_id=? ORDER BY created_at, id').bind(orderId).all()).results;
  const deliveries = saved ? (await env.DB.prepare('SELECT id, created_at, actor, recipient, status, error FROM document_deliveries WHERE document_id=? ORDER BY created_at DESC LIMIT 10').bind(saved.id).all()).results : [];
  return { order: { id: order.id, number: order.order_number || order.id, customer_name: order.customer_name || '', customer_phone: order.customer_phone || '', type: order.type, updated_at: order.updated_at },
    recipient: documentRecipient(order), versions, latest_revision: versions[0]?.revision || 0,
    document: saved ? { id: saved.id, revision: saved.revision, status: saved.status, actor: saved.actor, created_at: saved.created_at, data: JSON.parse(saved.data_json) } : null,
    defaults: { ...fromOrder(order, items, profile.seller), seller_profile_id: profile.id }, seller_profiles: settings.profiles, seller_revision: settings.revision, deliveries };
}
export function checkDocumentOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw fail('Запит має надходити з адмінки EVLine.', 403);
}
export async function documentPayload(request) {
  checkDocumentOrigin(request);
  if (Number(request.headers.get('content-length')) > 500000) throw fail('Документ завеликий.', 413);
  if (!request.headers.get('content-type')?.includes('application/json')) throw fail('Потрібен JSON.');
  const raw = await request.text();
  if (raw.length > 110000) throw fail('Документ завеликий.', 413);
  try { return JSON.parse(raw); } catch { throw fail('Некоректний JSON.'); }
}
export async function saveDocument(env, request, orderId, payload) {
  const order = await documentOrder(env, orderId);
  await ensureDocuments(env);
  if (!/^[a-f0-9-]{36}$/.test(payload.request_id || '')) throw fail('Некоректний ідентифікатор збереження.');
  if (!Number.isInteger(payload.expected_revision) || payload.expected_revision < 0) throw fail('Некоректна версія.');
  if (!['draft', 'ready'].includes(payload.status)) throw fail('Некоректний стан документа.');
  const data = normalizeDocument(payload.data);
  const mode = documentMode(payload.mode);
  if (data.seller_profile_id && !(await sellerSettings(env)).profiles.some(p => p.id === data.seller_profile_id)) throw fail('ФОПа не знайдено. Оновіть список реквізитів.');
  if (payload.status === 'ready') {
    const errors = validateReady(data, mode);
    if (errors.length) throw fail(`Заповніть або перевірте: ${errors.join('; ')}.`, 422);
  }
  const serialized = JSON.stringify(data);
  const existing = await env.DB.prepare('SELECT * FROM order_documents WHERE id=?').bind(payload.request_id).first();
  if (existing) {
    if (existing.order_id !== orderId || existing.data_json !== serialized || existing.status !== payload.status) throw fail('Цей ідентифікатор збереження вже використано.', 409);
    return getDocumentContext(env, orderId, existing.id);
  }
  const now = new Date().toISOString(), actor = auditActor(request, env);
  const result = await env.DB.prepare(`INSERT INTO order_documents (id,order_id,revision,created_at,actor,status,data_json)
    SELECT ?,?,?,?,?,?,? WHERE ?=(SELECT COALESCE(MAX(revision),0) FROM order_documents WHERE order_id=?)`)
    .bind(payload.request_id, orderId, payload.expected_revision + 1, now, actor, payload.status, serialized, payload.expected_revision, orderId).run();
  if (!result.meta.changes) throw fail('Інший менеджер уже зберіг нову версію. Оновіть сторінку перед збереженням; ваші правки поки залишаються на екрані.', 409);
  await recordAuditEvent(env, { actor, action: 'document.save', entity_type: 'order_document', entity_id: payload.request_id,
    entity_label: `${data.number} · v${payload.expected_revision + 1}`, order_id: orderId,
    details: { order_number: order.order_number, revision: payload.expected_revision + 1, status: payload.status, mode } });
  return getDocumentContext(env, orderId, payload.request_id);
}
export async function saveSeller(env, request, payload) {
  await ensureDocuments(env);
  if (!Number.isInteger(payload.expected_revision) || payload.expected_revision < 0) throw fail('Некоректна версія реквізитів.');
  const settings = await sellerSettings(env);
  if (settings.revision !== payload.expected_revision) throw fail('Реквізити вже змінив інший менеджер. Оновіть сторінку.', 409);
  const seller = cleanSeller(payload.seller), actor = auditActor(request, env), now = new Date().toISOString();
  if (!seller.name) throw fail('Вкажіть найменування ФОПа.');
  if (!payload.profile_id && settings.profiles.length > 1) throw fail('Оберіть ФОПа. Оновіть сторінку адмінки.', 409);
  const profileId = payload.profile_id || settings.default_id;
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(profileId)) throw fail('Некоректний ідентифікатор ФОПа.');
  const index = settings.profiles.findIndex(p => p.id === profileId);
  if (payload.create === true) {
    if (index !== -1) throw fail('Такий профіль ФОПа вже існує.', 409);
    if (settings.profiles.length >= 10) throw fail('Не більше 10 ФОПів.');
    settings.profiles.push({ id: profileId, seller });
  } else {
    if (index === -1) throw fail('ФОПа не знайдено.', 404);
    settings.profiles[index] = { id: profileId, seller };
  }
  const serialized = JSON.stringify({ profiles: settings.profiles, default_id: settings.default_id });
  const row = await env.DB.prepare(`INSERT INTO document_seller_settings(id,revision,updated_at,actor,data_json)
    SELECT 1,1,?,?,? WHERE ?=0
    ON CONFLICT(id) DO UPDATE SET revision=revision+1, updated_at=?, actor=?, data_json=? WHERE revision=? RETURNING revision`)
    .bind(now, actor, serialized, payload.expected_revision, now, actor, serialized, payload.expected_revision).first();
  // Existing settings need an UPDATE; the INSERT's zero-version guard intentionally cannot create them at a stale version.
  const updated = row || (payload.expected_revision > 0 ? await env.DB.prepare(`UPDATE document_seller_settings SET revision=revision+1,updated_at=?,actor=?,data_json=? WHERE id=1 AND revision=? RETURNING revision`)
    .bind(now, actor, serialized, payload.expected_revision).first() : null);
  if (!updated) throw fail('Реквізити вже змінив інший менеджер. Оновіть сторінку.', 409);
  await recordAuditEvent(env, { actor, action: 'document.seller_update', entity_type: 'document_settings', entity_id: profileId, details: { revision: updated.revision, created: payload.create === true } });
  return { ok: true, revision: updated.revision, profiles: settings.profiles, profile_id: profileId };
}
