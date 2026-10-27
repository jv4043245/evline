import { json } from './http.js';
import { ensureDocuments, documentOrder, documentRecipient, orderDocumentRecipient, invoiceCustomer, checkDocumentOrigin } from './order-documents.js';
import { documentStore } from './invoice-numbering.js';
import { auditActor, recordAuditEvent } from './audit-log.js';
import { fail, normalizeDocument, validateReady, documentMode, documentModes } from '../../admin/documents/model.js';

export async function sendCustomerDocument({ env, request, params }, standalone = false) {
  checkDocumentOrigin(request);
  if (standalone && !/^[a-f0-9-]{36}$/.test(params.id)) throw fail('Некоректний ідентифікатор рахунку.');
  if (!env.TELEGRAM_BOT_TOKEN) throw fail('Бот Telegram не налаштований.', 503);
  if (Number(request.headers.get('content-length')) > 3_000_000) throw fail('PDF завеликий.', 413);
  const order = standalone ? null : await documentOrder(env, params.id);
  const form = await request.formData();
  const mode = documentMode(form.get('mode') || 'all');
  if (standalone && mode !== 'invoice') throw fail('Оберіть рахунок для відправлення.');
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function' || file.type !== 'application/pdf' || file.size < 100 || file.size > 2_500_000) throw fail('Потрібен PDF до 2,5 МБ.');
  if (await file.slice(0, 5).text() !== '%PDF-') throw fail('Некоректний файл PDF.');
  await ensureDocuments(env);
  const store = documentStore(standalone), deliveryTable = standalone ? 'invoice_deliveries' : 'document_deliveries';
  const doc = await env.DB.prepare(`SELECT * FROM ${store.table} WHERE id=? AND ${store.key}=?`).bind(String(form.get('document_id') || ''), params.id).first();
  if (!doc || doc.status !== 'ready' || validateReady(normalizeDocument(JSON.parse(doc.data_json)), mode).length) throw fail('Спочатку підготуйте й перевірте документ.');
  const data = JSON.parse(doc.data_json);
  const recipient = standalone ? documentRecipient(await invoiceCustomer(env, data) || {}) : orderDocumentRecipient(order, data);
  if (!recipient) throw fail('Telegram клієнта не підключено. Завантажте PDF і надішліть вручну.');
  if (String(form.get('recipient')) !== recipient) throw fail('Одержувач змінився. Перевірте його ще раз.', 409);
  const label = mode === 'invoice' ? `Рахунок № ${data.invoice.number}` : order.order_number || 'Замовлення';
  const actor = auditActor(request, env), now = new Date().toISOString();
  // Keep legacy whole-pack keys; separate documents have independent retry protection.
  const deliveryId = mode === 'all' ? doc.id : `${doc.id}:${mode}`;
  const prior = await env.DB.prepare(`SELECT * FROM ${deliveryTable} WHERE id=?`).bind(deliveryId).first();
  if (prior?.status === 'sent') return json({ ok: true, already_sent: true });
  if (prior && prior.status !== 'failed') throw fail('Цю версію вже передавали боту, але результат не підтверджено. Перевірте чат, щоб не надіслати дублікат.', 409);
  const acquired = prior
    ? await env.DB.prepare(`UPDATE ${deliveryTable} SET status='sending',created_at=?,actor=?,recipient=?,error=NULL WHERE id=? AND status='failed'`).bind(now, actor, recipient, deliveryId).run()
    : await env.DB.prepare(`INSERT OR IGNORE INTO ${deliveryTable}(id,document_id,created_at,actor,recipient,status) VALUES(?,?,?,?,?,'sending')`).bind(deliveryId, doc.id, now, actor, recipient).run();
  if (!acquired.meta.changes) throw fail('Відправлення цієї версії вже виконується.', 409);
  const payload = new FormData();
  const fileLabel = String(mode === 'invoice' ? data.invoice.number : order.order_number || 'order').replace(/[^a-zA-Z0-9_-]/g, '-');
  payload.set('chat_id', recipient); payload.set('document', file, `EVLine-${fileLabel}-${mode}-v${doc.revision}.pdf`);
  payload.set('caption', `EVLine · ${label}\n${documentModes[mode]}. Версія ${doc.revision}.${mode === 'agreement' ? ' Для перевірки та підписання.' : ''}`);
  let response, result;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: payload, signal: AbortSignal.timeout(25000) });
    result = await response.json();
  } catch {
    await env.DB.prepare(`UPDATE ${deliveryTable} SET status='unknown',error=? WHERE id=?`).bind('Результат відправлення не підтверджено. Перевірте чат перед повторенням.', deliveryId).run();
    throw fail('Не вдалося підтвердити результат відправлення. Перевірте чат клієнта: файл міг надійти.', 502);
  }
  if (result?.ok !== true) {
    const definitive = result?.ok === false && response.status < 500;
    await env.DB.prepare(`UPDATE ${deliveryTable} SET status=?,error=? WHERE id=?`).bind(definitive ? 'failed' : 'unknown', definitive ? 'Telegram не прийняв документ.' : 'Telegram не підтвердив результат.', deliveryId).run();
    throw fail(definitive ? 'Telegram не прийняв документ. Перевірте, чи клієнт не заблокував бота, або надішліть PDF вручну.' : 'Перевірте чат клієнта: Telegram не підтвердив результат відправлення.', 502);
  }
  await env.DB.prepare(`UPDATE ${deliveryTable} SET status='sent',message_id=?,error=NULL WHERE id=?`).bind(String(result.result?.message_id || ''), deliveryId).run();
  await recordAuditEvent(env, { actor, action: 'document.send', entity_type: standalone ? 'invoice_document' : 'order_document', entity_id: doc.id, entity_label: label, order_id: order?.id || null, details: { revision: doc.revision, channel: 'telegram', mode } });
  return json({ ok: true });
}
