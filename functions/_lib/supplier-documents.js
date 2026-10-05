import { recordAuditEvent } from './audit-log.js';
import { adminIdentities } from './auth.js';

export const DOCUMENT_KINDS = { invoice: 'Рахунок постачальника', china_shipping: 'Доставка Китаєм', packing: 'Пакування', other: 'Інше' };
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const nowISO = () => new Date().toISOString();
export const clean = (value, size = 200) => String(value ?? '').trim().slice(0, size);
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status, publicMessage: message }); }
export const all = async (env, sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).all()).results || [];
export const first = (env, sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
export const run = (env, sql, ...binds) => env.DB.prepare(sql).bind(...binds).run();
export async function digest(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function documentAudit(env, user, action, documentId, orderId, details = {}) {
  await recordAuditEvent(env, { actor: user.name, action: `supplier_document.${action}`, entity_type: 'supplier_document', entity_id: documentId, order_id: orderId, details: { admin_id: user.id, ...details } });
}
export function requireStorage(env) {
  if (!env.SUPPLIER_DOCUMENTS) fail('Приватне сховище ще не підключене. Зверніться до адміністратора.', 503);
}
export function fileType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ['image/jpeg', 'jpg'];
  if ([137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)) return ['image/png', 'png'];
  const ascii = new TextDecoder().decode(bytes.slice(0, 12));
  if (ascii.startsWith('RIFF') && ascii.slice(8) === 'WEBP') return ['image/webp', 'webp'];
  if (ascii.startsWith('%PDF-')) return ['application/pdf', 'pdf'];
  fail('Дозволені лише JPG, PNG, WebP та PDF.');
}
export function safeFilename(value, extension) {
  const stem = clean(value, 150).replace(/[\x00-\x1f\x7f/\\:"<>|?*]/g, '_').replace(/\.[^.]+$/, '').replace(/^\.+/, '') || 'document';
  return `${stem}.${extension}`;
}
export async function orderAndPayment(env, orderId, paymentId = '') {
  const order = await first(env, 'SELECT id, order_number, status FROM orders WHERE id = ?', orderId);
  if (!order) fail('Замовлення не знайдене.', 404);
  const payment = paymentId ? await first(env, 'SELECT * FROM supplier_payments WHERE id = ? AND order_id = ?', paymentId, orderId) : null;
  if (paymentId && !payment) fail('Оплата не належить цьому замовленню.');
  return { order, payment };
}
export async function watchPayment(env, paymentId, userId) {
  if (!paymentId) return;
  await run(env, `INSERT OR IGNORE INTO supplier_document_followups(payment_id, admin_id, updated_at) VALUES(?,?,?)`, paymentId, userId, nowISO());
}

export async function uploadDocument(env, user, data, file, sourceKey = null) {
  requireStorage(env);
  const { order, payment } = await orderAndPayment(env, clean(data.order_id), clean(data.payment_id));
  if (!DOCUMENT_KINDS[data.kind]) fail('Оберіть тип документа.');
  const supplier = clean(payment?.supplier_name || data.supplier_name);
  if (!supplier) fail('Оберіть постачальника.');
  if (!file?.arrayBuffer || !file.size || file.size > MAX_DOCUMENT_BYTES) fail('Максимум 10 МБ на файл.', 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length > MAX_DOCUMENT_BYTES) fail('Некоректний розмір файла.', 413);
  const [mime, extension] = fileType(bytes);
  const hash = await digest(bytes);
  if (sourceKey) {
    const duplicate = await first(env, 'SELECT document_id FROM supplier_document_versions WHERE source_key = ?', sourceKey);
    if (duplicate) return { id: duplicate.document_id, duplicate: true };
  }
  let documentId = clean(data.document_id) || crypto.randomUUID();
  let version = 1;
  if (data.document_id) {
    const existing = await first(env, `SELECT d.* FROM supplier_documents d JOIN supplier_document_links l ON l.document_id=d.id WHERE d.id=? AND l.order_id=? AND l.archived_at IS NULL`, documentId, order.id);
    if (!existing) fail('Документ не знайдений у цьому замовленні.', 404);
    if (existing.current_version !== Number(data.version)) fail('Файл уже оновив інший менеджер. Оновіть список.', 409);
    if (existing.supplier_name !== supplier || existing.kind !== data.kind) fail('Для заміни збережіть постачальника і тип документа.');
    version = existing.current_version + 1;
  } else {
    const duplicate = await first(env, `SELECT d.id FROM supplier_documents d JOIN supplier_document_versions v ON v.document_id=d.id AND v.version=d.current_version JOIN supplier_document_links l ON l.document_id=d.id WHERE l.order_id=? AND l.archived_at IS NULL AND v.sha256=? AND d.kind=? AND d.supplier_name=?`, order.id, hash, data.kind, supplier);
    if (duplicate) return { id: duplicate.id, duplicate: true };
  }
  const id = crypto.randomUUID(), time = nowISO(), key = `supplier-documents/${documentId}/${id}.${extension}`;
  await env.SUPPLIER_DOCUMENTS.put(key, bytes, { httpMetadata: { contentType: mime } });
  const statements = [];
  if (version === 1) statements.push(env.DB.prepare('INSERT INTO supplier_documents(id,supplier_name,kind,reference,created_at,created_by) VALUES(?,?,?,?,?,?)').bind(documentId, supplier, data.kind, clean(data.reference), time, user.id));
  statements.push(env.DB.prepare('INSERT INTO supplier_document_versions(id,document_id,version,object_key,filename,mime,bytes,sha256,created_at,created_by,source_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,documentId,version,key,safeFilename(file.name,extension),mime,bytes.length,hash,time,user.id,sourceKey));
  if (version > 1) statements.push(env.DB.prepare('UPDATE supplier_documents SET current_version=? WHERE id=?').bind(version,documentId));
  else statements.push(env.DB.prepare('INSERT INTO supplier_document_links(document_id,order_id,payment_id,created_at,created_by) VALUES(?,?,?,?,?)').bind(documentId,order.id,payment?.id || null,time,user.id));
  try { await env.DB.batch(statements); }
  catch (error) {
    await env.SUPPLIER_DOCUMENTS.delete(key).catch(() => {});
    const duplicate=sourceKey ? await first(env, 'SELECT document_id FROM supplier_document_versions WHERE source_key=?',sourceKey) : null;
    if (duplicate) return { id: duplicate.document_id, duplicate: true };
    if (version > 1) fail('Файл уже оновив інший менеджер. Оновіть список.',409);
    throw error;
  }
  await watchPayment(env, payment?.id, user.id);
  await documentAudit(env,user,version > 1 ? 'replace' : 'upload',documentId,order.id,{ version,kind:data.kind,bytes:bytes.length });
  return { id: documentId, version };
}

export async function listDocuments(env, orderId) {
  await orderAndPayment(env, orderId);
  return all(env, `SELECT d.*,l.payment_id,l.archived_at,v.filename,v.mime,v.bytes,v.created_at AS version_created_at,v.created_by AS version_created_by,
    (SELECT COUNT(*) FROM supplier_document_links x WHERE x.document_id=d.id AND x.archived_at IS NULL) AS linked_orders
    FROM supplier_documents d JOIN supplier_document_links l ON l.document_id=d.id
    JOIN supplier_document_versions v ON v.document_id=d.id AND v.version=d.current_version WHERE l.order_id=? ORDER BY d.created_at DESC`,orderId);
}
export async function documentVersion(env, orderId, documentId, version) {
  const row = await first(env, `SELECT v.*,d.kind,d.supplier_name,d.reference FROM supplier_document_versions v JOIN supplier_documents d ON d.id=v.document_id JOIN supplier_document_links l ON l.document_id=d.id WHERE l.order_id=? AND d.id=? AND v.version=COALESCE(?,d.current_version)`,orderId,documentId,version ? Number(version) : null);
  if (!row) fail('Файл не знайдений.',404);
  return row;
}
export async function selectedDocuments(env, orderId, ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || new Set(ids).size !== ids.length) fail('Оберіть від 1 до 10 файлів.');
  const rows = [];
  let size = 0;
  for (const id of ids) {
    const link = await first(env,'SELECT document_id FROM supplier_document_links WHERE order_id=? AND document_id=? AND archived_at IS NULL', orderId,id);
    if (!link) fail('Документ не належить цьому замовленню.',404);
    const row = await documentVersion(env,orderId,id);
    size += row.bytes;
    if (size > 30 * 1024 * 1024) fail('Для одного пакета оберіть файли загальним розміром до 30 МБ.',413);
    rows.push(row);
  }
  return rows;
}
export async function readOriginal(env, row) {
  requireStorage(env);
  const object = await env.SUPPLIER_DOCUMENTS.get(row.object_key);
  if (!object) fail('Оригінал тимчасово недоступний.',503);
  return object;
}
export async function listFollowups(env, orderId) {
  return all(env, `SELECT f.*,p.payment_number,p.supplier_name,p.status AS payment_status,p.paid_at,
    COALESCE(f.due_at,CASE WHEN p.status='paid' AND p.paid_at IS NOT NULL THEN strftime('%Y-%m-%dT%H:%M:%fZ',p.paid_at,'+5 days') END) AS effective_due_at
    FROM supplier_document_followups f JOIN supplier_payments p ON p.id=f.payment_id WHERE p.order_id=?`,orderId);
}
export async function saveFollowup(env, user, data) {
  const { payment } = await orderAndPayment(env,clean(data.order_id),clean(data.payment_id));
  if (!payment) fail('Оберіть оплату постачальнику.');
  const adminId = clean(data.admin_id) || user.id;
  if (!adminIdentities(env).some(u => u.id === adminId)) fail('Менеджер не знайдений.');
  if (!['waiting','paused','shipped'].includes(data.state)) fail('Невідомий стан нагадування.');
  let due = null;
  if (data.due_at) {
    const parsed = new Date(data.due_at);
    if (!Number.isFinite(parsed.getTime())) fail('Некоректна дата.');
    due = parsed.toISOString();
  }
  const time = nowISO();
  await run(env,`INSERT INTO supplier_document_followups(payment_id,admin_id,due_at,state,tracking_number,last_asked_at,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(payment_id) DO UPDATE SET admin_id=excluded.admin_id,due_at=excluded.due_at,state=excluded.state,tracking_number=excluded.tracking_number,last_asked_at=COALESCE(excluded.last_asked_at,last_asked_at),updated_at=excluded.updated_at`,payment.id,adminId,due,data.state,clean(data.tracking_number),data.asked ? time : null,time);
  await documentAudit(env,user,'followup',payment.id,data.order_id,{ state:data.state,due_at:due,admin_id:adminId });
}

export function supplierFollowupText(row) {
  const reference = clean(row.reference || row.payment_number);
  return `您好，请帮忙确认订单 ${reference} 的发货进度。请问什么时候可以发货？如已发货，请提供中国境内快递单号。谢谢！`;
}
