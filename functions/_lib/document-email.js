import { createMimeMessage } from 'mimetext/browser';
import { json } from './http.js';
import { ensureDocuments, documentOrder, checkDocumentOrigin } from './order-documents.js';
import { documentStore } from './invoice-numbering.js';
import { auditActor, recordAuditEvent } from './audit-log.js';
import { emailConfiguration } from './document-email-config.js';
import { fail, normalizeDocument, validateReady, documentMode } from '../../admin/documents/model.js';
import { emailAddress, deliveryDetails } from '../../admin/documents/delivery.js';

export async function gmailAccessToken(env) {
  const config = emailConfiguration(env);
  if (!config.enabled) throw fail('Пошту для відправлення ще не підключено.', 503);
  let tokens, identity;
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token',
    }) });
    tokens = await response.json();
    if (!response.ok || !tokens.access_token) throw new Error('Token unavailable');
    const profile = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { authorization: `Bearer ${tokens.access_token}` } });
    identity = await profile.json();
    if (!profile.ok || identity.email_verified !== true || identity.email?.toLowerCase() !== config.sender) throw new Error('Wrong sender');
  } catch {
    // Never expose Google's response, which can contain credential details.
    throw fail('Не вдалося підключитися до пошти EVLine. Лист не відправлено; перевірте підключення Gmail.', 503);
  }
  return tokens.access_token;
}

export async function emailMessage({ data, mode, revision, file, sender, recipient, deliveryId }) {
  const details = deliveryDetails(data, mode), message = createMimeMessage();
  message.setSender({ name: 'EVLine', addr: sender });
  message.setRecipient(recipient);
  message.setSubject(details.subject.replace(/[\r\n]/g, ' '));
  message.setHeader('Message-ID', `<evline-${deliveryId}@evline.com.ua>`);
  const folded = value => value.match(/.{1,76}/g).join('\r\n');
  message.addMessage({ contentType: 'text/plain', encoding: 'base64', data: folded(message.toBase64(details.text)) });
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const number = String(mode === 'invoice' ? data.invoice.number : data.number || 'order').replace(/[^a-zA-Z0-9_-]/g, '-');
  message.addAttachment({ filename: `EVLine-${number}-${mode}-v${revision}.pdf`, contentType: 'application/pdf', data: folded(btoa(binary)) });
  return message.asEncoded();
}

export async function emailCustomerDocument({ env, request, params }, standalone = false) {
  checkDocumentOrigin(request);
  if (standalone && !/^[a-f0-9-]{36}$/.test(params.id)) throw fail('Некоректний ідентифікатор рахунку.');
  const config = emailConfiguration(env);
  if (!config.enabled) throw fail('Пошту для відправлення ще не підключено.', 503);
  if (Number(request.headers.get('content-length')) > 3_000_000) throw fail('PDF завеликий.', 413);
  const order = standalone ? null : await documentOrder(env, params.id);
  const form = await request.formData(), mode = documentMode(form.get('mode') || 'invoice');
  if (standalone && mode !== 'invoice') throw fail('Оберіть рахунок для відправлення.');
  let recipient;
  try { recipient = emailAddress(form.get('recipient')).toLowerCase(); } catch { throw fail('Вкажіть коректну адресу email.'); }
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function' || file.type !== 'application/pdf' || file.size < 100 || file.size > 2_500_000) throw fail('Потрібен PDF до 2,5 МБ.');
  if (await file.slice(0, 5).text() !== '%PDF-') throw fail('Некоректний файл PDF.');
  await ensureDocuments(env);
  const store = documentStore(standalone), column = standalone ? 'invoice_document_id' : 'order_document_id';
  const doc = await env.DB.prepare(`SELECT * FROM ${store.table} WHERE id=? AND ${store.key}=?`).bind(String(form.get('document_id') || ''), params.id).first();
  if (!doc || doc.status !== 'ready') throw fail('Спочатку підготуйте й перевірте документ.');
  const data = normalizeDocument(JSON.parse(doc.data_json));
  if (validateReady(data, mode).length) throw fail('Спочатку підготуйте й перевірте документ.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${standalone}:${doc.id}:${mode}:${recipient}`));
  const id = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  const prior = await env.DB.prepare('SELECT status FROM document_email_deliveries WHERE id=?').bind(id).first();
  if (prior?.status === 'sent') return json({ ok: true, already_sent: true, recipient });
  if (prior && prior.status !== 'failed') throw fail('Цю версію вже відправляли. Перевірте папку «Надіслані» Gmail перед повторенням: лист міг надійти.', 409);
  // Authentication and MIME preparation happen before the durable send claim.
  const token = await gmailAccessToken(env);
  const raw = await emailMessage({ data, mode, revision: doc.revision, file, sender: config.sender, recipient, deliveryId: id });
  const actor = auditActor(request, env), now = new Date().toISOString();
  const acquired = prior
    ? await env.DB.prepare("UPDATE document_email_deliveries SET status='sending',created_at=?,actor=?,error=NULL WHERE id=? AND status='failed'").bind(now, actor, id).run()
    : await env.DB.prepare(`INSERT OR IGNORE INTO document_email_deliveries(id,${column},mode,created_at,actor,recipient,sender,status) VALUES(?,?,?,?,?,?,?,'sending')`).bind(id, doc.id, mode, now, actor, recipient, config.sender).run();
  if (!acquired.meta.changes) throw fail('Відправлення цієї версії вже виконується.', 409);
  let response, result;
  try {
    response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw }) });
    result = await response.json();
  } catch { /* Unknown results must never trigger an automatic retry. */ }
  if (!response?.ok || !result?.id) {
    const rejected = response?.status >= 400 && response.status < 500 && result?.error;
    const message = rejected ? 'Gmail не прийняв лист. Перевірте адресу, підключення та ліміт відправлення.' : 'Gmail не підтвердив результат. Перевірте папку «Надіслані»: лист міг надійти.';
    await env.DB.prepare('UPDATE document_email_deliveries SET status=?,error=? WHERE id=?').bind(rejected ? 'failed' : 'unknown', message, id).run();
    throw fail(message, 502);
  }
  await env.DB.prepare("UPDATE document_email_deliveries SET status='sent',message_id=?,error=NULL WHERE id=?").bind(String(result.id), id).run();
  await recordAuditEvent(env, { actor, action: 'document.send', entity_type: standalone ? 'invoice_document' : 'order_document', entity_id: doc.id, entity_label: deliveryDetails(data, mode).title, order_id: order?.id || null, details: { revision: doc.revision, channel: 'email', mode, recipient } });
  return json({ ok: true, recipient });
}
