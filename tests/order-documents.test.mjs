import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fromOrder, normalizeDocument, validateReady, totals, cents, validIban, syncStandardTerms, invoiceAmount, orderRefreshChanges } from '../admin/documents/model.js';
import { AGREEMENT_TERMS } from '../admin/documents/agreement-template.js';
import { documentBlocks, previewHtml, pdfDefinition, documentText } from '../admin/documents/render.js';
import { getDocumentContext, saveDocument, saveSeller, ensureDocuments, documentRecipient, documentPayload } from '../functions/_lib/order-documents.js';
import { onRequestPost as sendDocument } from '../functions/api/admin/orders/[id]/document-send.js';
import { onRequestPost as sendInvoice } from '../functions/api/admin/invoices/[id]/send.js';
import { onRequest as authorize } from '../functions/api/admin/_middleware.js';
import { onRequestDelete as deleteOrder } from '../functions/api/admin/orders/[id].js';
import { onRequestGet as listInvoices } from '../functions/api/admin/invoices.js';
import { amountWords } from '../admin/documents/amount-words.js';
import { invoiceIndex, ingestTransactions, reconcile, readIncoming } from '../functions/_lib/bank-incoming.js';
import { onRequestPost as createOrder } from '../functions/api/admin/orders.js';
import { repeatOrderDraft, repeatOrderPayload } from '../admin/repeat-order.js';
import { advanceInvoiceNumbering, invoiceNumberingState } from '../functions/_lib/invoice-numbering.js';
import { onRequestGet as getNumbering, onRequestPost as setNumbering } from '../functions/api/admin/invoice-numbering.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const schemas = await Promise.all((await readdir(migrationDir)).filter(f => f.endsWith('.sql')).sort().map(f => readFile(new URL(f, migrationDir), 'utf8')));
const orderId = 'document-test-order';
const req = () => new Request('https://evline.test/api/admin/documents', { headers: { authorization: 'Bearer test-admin' } });
export function completeDocument() {
  const d = fromOrder({ id: orderId, order_number: 'O-TEST', customer_name: 'Тестовий Покупець', customer_phone: '+380000000001', car: 'BYD Yuan Plus 2023', vin: 'TESTVIN0000000001', item_name: 'Бампер', revenue_uah: 10000 });
  const iban = 'UA' + String(98 - Number(BigInt('3000010000000000000000000' + '301000') % 97n)).padStart(2, '0') + '3000010000000000000000000';
  Object.assign(d.seller, { name: 'ФОП Тестовий Продавець', tax_id: '0000000000', address: 'Тестова адреса продавця', iban, bank: 'Тестовий банк' });
  Object.assign(d.buyer, { address: 'Тестова адреса покупця', purpose: 'Особисті потреби' });
  Object.assign(d, { condition: 'Новий, бампер без кріплень', warranty: 'Погоджені гарантійні умови', tax: 'Без ПДВ', included: 'Товар, пакування, міжнародна доставка, митні платежі', prepayment: '5000', prepayment_due: 'Після підписання', balance_due: 'До передачі', route: 'Море', forecast: '70-90 днів', deadline_days: '90', handover: 'Київ, за погодженням', recipient: 'Тестовий Покупець, +380000000001', partial: 'Лише після окремого погодження', reviewed: true });
  d.items[0].kind = 'original';
  return normalizeDocument(d);
}
async function setup(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); db.exec('PRAGMA foreign_keys=ON');
  for (const schema of schemas) db.exec(schema);
  const env = { ADMIN_TOKEN: 'test-admin', TELEGRAM_BOT_TOKEN: 'test-bot', DB: { prepare(sql) { const statement = db.prepare(sql); let args = []; return {
    bind(...values) { args = values; return this; }, async first() { return statement.get(...args) || null; }, async all() { return { results: statement.all(...args) }; },
    _run() { return { meta: { changes: Number(statement.run(...args).changes) } }; }, async run() { return this._run(); },
  }; }, async batch(statements) { db.exec('BEGIN'); try { const results = statements.map(s => s._run()); db.exec('COMMIT'); return results; } catch(e) { db.exec('ROLLBACK'); throw e; } } } };
  db.prepare('INSERT INTO customers(id,created_at,updated_at,name,phone) VALUES(?,?,?,?,?)').run('test-customer', '2026-09-24', '2026-09-24', 'Тест', '+380000000001');
  db.prepare(`INSERT INTO orders(id,created_at,updated_at,customer_id,order_number,customer_name,customer_phone,type,status,revenue_uah,purchase_cost_uah,payment_status,item_name,telegram_chat_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(orderId, '2026-09-24', '2026-09-24', 'test-customer', 'O-TEST', 'Тест', '+380000000001', 'parts', 'paid', 10000, 7777, 'paid', 'Бампер', '123456789');
  return { db, env };
}
const payload = (data = completeDocument(), expected_revision = 0, status = 'ready') => ({ request_id: crypto.randomUUID(), expected_revision, status, data });
function sendRequest(id, recipient = '123456789', mode) {
  const form = new FormData(); form.set('document_id', id); form.set('recipient', recipient);
  if (mode) form.set('mode', mode);
  form.set('file', new File(['%PDF-1.7\n' + 'synthetic'.repeat(20)], 'test.pdf', { type: 'application/pdf' }));
  return new Request('https://evline.test/api/admin/orders/test/document-send', { method: 'POST', headers: { authorization: 'Bearer test-admin' }, body: form });
}

test('only customer-facing order fields seed a draft; paid supplier is never customer receipt', async t => {
  const { env } = await setup(t), result = await getDocumentContext(env, orderId);
  assert.equal(result.document, null); assert.equal(result.defaults.items[0].price, '10000.00');
  assert.equal(result.defaults.receipt.enabled, false); assert.equal(result.defaults.receipt.amount, ''); assert.equal(result.defaults.prepayment, '');
  assert.equal(result.defaults.items[0].kind, ''); assert.equal(result.defaults.forecast, '');
  assert.doesNotMatch(JSON.stringify(result), /7777|purchase_cost|supplier_payments|manager_notes/);
});
test('issued invoice number cannot be reused for another order or amount; drafts and identical revisions remain possible',async t=>{
  const {env,db}=await setup(t),data=completeDocument();
  await saveDocument(env,req(),orderId,{...payload(data),mode:'invoice'});
  await saveDocument(env,req(),orderId,{...payload(data,1),mode:'invoice'});
  const changed=structuredClone(data);changed.invoice.mode='custom';changed.invoice.amount='20.00';
  await assert.rejects(saveDocument(env,req(),orderId,{...payload(changed,2),mode:'invoice'}),/унікальний номер/);
  db.prepare("INSERT INTO orders(id,created_at,updated_at,type,status) VALUES('another','2026-10-21','2026-10-21','parts','new')").run();
  await assert.rejects(saveDocument(env,req(),'another',{...payload(data),mode:'invoice'}),/унікальний номер/);
  await saveDocument(env,req(),'another',{...payload(data,0,'draft'),mode:'invoice'});
  changed.invoice.number='EV-NEW-2';await saveDocument(env,req(),orderId,{...payload(changed,2),mode:'invoice'});
});
test('arithmetic is cent-based, totals include only explicitly agreed extras', () => {
  const d = completeDocument(); d.items = [{ ...d.items[0], quantity: 3, price: '0.10' }]; d.extras = [{ title: 'Доставка', price: '1 234,56' }]; d.prepayment = '0';
  assert.deepEqual(totals(normalizeDocument(d)), { items: 30, extras: 123456, total: 123486, balance: 123486, received: 0 });
  for (const invalid of ['-1', '1.005', 'NaN', 'Infinity', '1e4', '12xyz']) assert.throws(() => cents(invalid));
});
test('ready document requires real requisites, fields, type and manager review; drafts do not', () => {
  const d = completeDocument(); assert.equal(validIban(d.seller.iban), true); assert.deepEqual(validateReady(d), []);
  d.items[0].kind = ''; d.reviewed = false; d.seller.iban = 'UA000000000000000000000000000'; d.date = '2026-02-30'; d.prepayment = '20000';
  assert.ok(validateReady(d).length >= 5);
  const blank = fromOrder({ id: 'x' }); assert.ok(validateReady(normalizeDocument(blank)).length > 10);
});
test('template retains delay protection and statutory rights; OEM wording never guarantees originality', () => {
  const original = completeDocument(); assert.deepEqual(original.terms, AGREEMENT_TERMS);
  const mixed = clone(original); mixed.items[0].kind = 'oem'; syncStandardTerms(mixed);
  assert.match(mixed.terms[0].text, /прямо позначених/); assert.match(mixed.terms[3].text, /погодженого у Специфікації типу/);
  assert.match(mixed.terms[2].text, /не встановлює додаткових договірних штрафів/);
  assert.match(mixed.terms[5].text, /не обмежує обов’язкову за законом відповідальність/);
  mixed.terms[0].text = 'Погоджений менеджером текст'; syncStandardTerms(mixed); assert.equal(mixed.terms[0].text, 'Погоджений менеджером текст');
});
const clone = o => structuredClone(o);
test('preview escapes active HTML, PDF and preview share sections, no implied signatures or payment', () => {
  const d = completeDocument(); d.buyer.name = '<img src=x onerror=alert(1)>';
  assert.match(previewHtml(d, 'all', true), /&lt;img/); assert.doesNotMatch(previewHtml(d, 'all', true), /<img src=x/);
  assert.equal(documentBlocks(d).filter(b => b.type === 'title').length, 3);
  assert.ok(pdfDefinition(d).content.length > 30);
  d.receipt.enabled = true; assert.ok(validateReady(d).some(v => /надходження|сума/.test(v)));
  Object.assign(d.receipt, { amount: '5000', date: '2026-09-24', method: 'IBAN', reference: 'Тестовий платіж № TEST-001', confirmed: true });
  assert.deepEqual(validateReady(d), []); assert.match(documentBlocks(d, 'receipt').map(b => b.text).join(' '), /не є фіскальним чеком/);
});
test('atomic immutable versions, idempotent retry and stale concurrent saves; order remains untouched', async t => {
  const { env, db } = await setup(t), p = payload(), before = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  const first = await saveDocument(env, req(), orderId, p); assert.equal(first.document.revision, 1);
  assert.equal((await saveDocument(env, req(), orderId, p)).document.revision, 1);
  const changed = clone(p.data); changed.buyer.name = 'Інший тестовий покупець';
  await assert.rejects(saveDocument(env, req(), orderId, { ...p, data: changed }), /використано/);
  const results = await Promise.allSettled([saveDocument(env, req(), orderId, payload(changed, 1)), saveDocument(env, req(), orderId, payload(p.data, 1))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected')[0].reason.status, 409);
  assert.equal((await getDocumentContext(env, orderId, first.document.id)).document.data.buyer.name, p.data.buyer.name);
  assert.deepEqual(db.prepare('SELECT * FROM orders WHERE id=?').get(orderId), before);
  assert.equal(db.prepare('SELECT count(*) n FROM order_documents').get().n, 2);
});
test('draft allowed, ready rejects missing information, unknown fields are excluded', async t => {
  const { env } = await setup(t), draft = fromOrder({ id: orderId }); draft.secret = 'never-store';
  const saved = await saveDocument(env, req(), orderId, payload(draft, 0, 'draft'));
  assert.doesNotMatch(JSON.stringify(saved.document), /never-store/);
  await assert.rejects(saveDocument(env, req(), orderId, payload(draft, 1)), e => e.status === 422);
  await assert.rejects(getDocumentContext(env, 'missing'), e => e.status === 404);
  await assert.rejects(getDocumentContext(env, orderId, 'other-version'), e => e.status === 404);
});
test('seller defaults have optimistic locking and never rewrite previous snapshots', async t => {
  const { env } = await setup(t), p = payload(); const saved = await saveDocument(env, req(), orderId, p);
  assert.equal((await saveSeller(env, req(), { expected_revision: 0, seller: p.data.seller })).revision, 1);
  await assert.rejects(saveSeller(env, req(), { expected_revision: 0, seller: p.data.seller }), e => e.status === 409);
  const newSeller = { ...p.data.seller, name: 'Інший тестовий продавець' };
  assert.equal((await saveSeller(env, req(), { expected_revision: 1, seller: newSeller })).revision, 2);
  const current = await getDocumentContext(env, orderId); assert.equal(current.defaults.seller.name, newSeller.name); assert.equal(current.document.data.seller.name, saved.document.data.seller.name);
});
test('two private seller profiles stay independent, preserve legacy settings and old snapshots', async t => {
  const { env, db } = await setup(t), original = completeDocument();
  db.prepare('INSERT INTO document_seller_settings(id,revision,updated_at,actor,data_json) VALUES(1,1,?,?,?)').run('2026-09-24', 'test', JSON.stringify(original.seller));
  let context = await getDocumentContext(env, orderId);
  assert.equal(context.seller_profiles[0].id, 'primary');
  assert.equal(context.defaults.seller_profile_id, 'primary');
  original.seller_profile_id = 'primary';
  const old = await saveDocument(env, req(), orderId, payload(original));
  const second = { ...original.seller, name: 'ФОП Другий Тестовий', tax_id: '0000000001', tax_status: 'Статус за реквізитами' };
  const created = await saveSeller(env, req(), { profile_id: 'second', create: true, seller: second, expected_revision: 1 });
  assert.equal(created.profiles.length, 2);
  await assert.rejects(saveSeller(env, req(), { seller: second, expected_revision: 2 }), /Оберіть ФОПа/);
  await assert.rejects(saveSeller(env, req(), { profile_id: 'primary', seller: second, expected_revision: 1 }), e => e.status === 409);
  await saveSeller(env, req(), { profile_id: 'second', seller: { ...second, phone: '000000002' }, expected_revision: 2 });
  context = await getDocumentContext(env, orderId);
  assert.equal(context.seller_profiles[0].seller.name, original.seller.name);
  assert.equal(context.seller_profiles[1].seller.phone, '000000002');
  assert.equal(context.document.data.seller.name, original.seller.name);
  const switched = { ...original, seller: second, seller_profile_id: 'second' };
  await saveDocument(env, req(), orderId, payload(switched, 1));
  assert.equal((await getDocumentContext(env, orderId, old.document.id)).document.data.seller.tax_id, original.seller.tax_id);
  await assert.rejects(saveDocument(env, req(), orderId, payload({ ...switched, seller_profile_id: 'missing' }, 2)), /ФОПа не знайдено/);
});
test('invoices use the selected seller in the whole pack, with no received-payment claim or VAT inference', () => {
  const d = completeDocument(); d.seller.tax_status = 'Загальна система';
  assert.equal(invoiceAmount(d), 1000000);
  d.invoice.mode = 'prepayment'; assert.equal(invoiceAmount(d), 500000);
  d.invoice.mode = 'custom'; d.invoice.amount = '1250,25'; assert.equal(invoiceAmount(d), 125025);
  d.invoice.amount = '10000.01'; assert.ok(validateReady(d).includes('Сума рахунку від 0,01 до вартості замовлення'));
  d.invoice.mode = 'balance'; assert.equal(invoiceAmount(d), null);
  Object.assign(d.receipt, { enabled: true, amount: '7500', confirmed: true, date: d.date, method: 'IBAN', reference: 'TEST' });
  assert.equal(invoiceAmount(d), 250000); assert.deepEqual(validateReady(d), []);
  const invoice = documentBlocks(d, 'invoice');
  assert.equal(invoice[0].text, 'Рахунок на оплату');
  assert.ok(invoice.some(b => b.label === 'IBAN' && b.text === d.seller.iban));
  assert.ok(invoice.some(b => b.label === 'Податковий статус постачальника' && b.text === 'Загальна система'));
  assert.ok(invoice.some(b => b.label === 'Податковий статус ціни' && b.text === 'Без ПДВ'));
  assert.match(invoice.map(b => b.text).join(' '), /Рахунок не підтверджує отримання коштів/);
  assert.equal(documentBlocks(d)[0].text, 'Рахунок на оплату');
  d.invoice.number = ''; d.invoice.date = '2026-02-30'; assert.ok(validateReady(d).includes('Номер рахунку')); assert.ok(validateReady(d).includes('Дата рахунку'));
});
test('old saved agreements do not acquire an invoice or a different seller automatically', () => {
  const d = completeDocument(); delete d.invoice; delete d.seller_profile_id; delete d.seller.tax_status;
  const old = normalizeDocument(d);
  assert.equal(old.invoice.enabled, false); assert.equal(old.seller_profile_id, '');
  assert.equal(documentBlocks(old)[0].text, 'Договір замовлення автозапчастин');
  assert.equal(documentBlocks(old).filter(b => b.type === 'title').length, 2);
  assert.deepEqual(validateReady(old), []);
});
test('invoice can be prepared before agreement details; ready status never bypasses per-document checks', async t => {
  const { env } = await setup(t), d = completeDocument();
  Object.assign(d, { car: '', date: '', number: '', city: '', prepayment: '', deadline_days: '', handover: '' });
  Object.assign(d.buyer, { address: '', phone: '', purpose: '' }); d.items[0].kind = '';
  d.terms[0].text = ''; d.receipt.enabled = true;
  assert.deepEqual(validateReady(d, 'invoice'), []);
  assert.ok(validateReady(d, 'agreement').length > 5);
  const p = { ...payload(d), mode: 'invoice' };
  const saved = await saveDocument(env, req(), orderId, p);
  assert.equal(saved.document.status, 'ready');
  await assert.rejects(sendDocument({ env, params: { id: orderId }, request: sendRequest(p.request_id, '123456789', 'agreement') }), /перевірте/);
  await assert.rejects(saveDocument(env, req(), orderId, { ...payload(d, 1), mode: 'agreement' }), e => e.status === 422);
  await assert.rejects(saveDocument(env, req(), orderId, { ...payload(d, 1), mode: 'unknown' }), /Невідомий/);
  d.invoice.mode = 'balance'; assert.ok(validateReady(d, 'invoice').includes('Підтвердження перевірки надходження від клієнта'));
  const agreement = completeDocument(); agreement.invoice.number = ''; agreement.invoice.date = ''; agreement.receipt.enabled = true;
  assert.deepEqual(validateReady(agreement, 'agreement'), []);
  assert.ok(validateReady(agreement, 'all').length > 0);
  agreement.invoice.enabled = false; assert.ok(validateReady(agreement, 'invoice').includes('Рахунок не ввімкнено'));
});
test('separate outputs share edits without attaching other documents or claiming an existing agreement', () => {
  const d = completeDocument(); d.buyer.name = 'Виправлене Прізвище'; d.items[0].price = '12000';
  const invoice = documentText(d, 'invoice'), agreement = documentText(d, 'agreement');
  for (const text of [invoice, agreement]) { assert.match(text, /Виправлене Прізвище/); assert.match(text, /12.000,00/); }
  assert.doesNotMatch(invoice, /Договір|Специфікація|додаються/);
  assert.doesNotMatch(agreement, /Рахунок на оплату/);
  assert.deepEqual(documentBlocks(d, 'agreement').filter(b => b.type === 'title').map(b => [b.text, !!b.pageBreak]), [['Договір замовлення автозапчастин', false], ['Специфікація замовлення', true]]);
  assert.equal(documentBlocks(d, 'invoice').filter(b => b.type === 'title').length, 1);
});
test('refresh candidates are explicit, never import supplier costs, preserve matched manual item details and empty-source fields', () => {
  const current = completeDocument(), original = clone(current);
  const source = fromOrder({ id: orderId, customer_name: 'Нове Прізвище', customer_phone: '+380000000002', item_name: 'Бампер', purchase_cost_uah: 999 });
  let changes = orderRefreshChanges(current, source);
  assert.ok(changes.some(c => c.path === 'buyer.name' && c.after === 'Нове Прізвище'));
  assert.ok(!changes.some(c => ['car', 'vin', 'items'].includes(c.path)));
  source.items[0].price = '12500.00'; changes = orderRefreshChanges(current, source);
  assert.equal(changes.find(c => c.path === 'items').after[0].kind, 'original');
  assert.equal(changes.find(c => c.path === 'items').after[0].price, '12500.00');
  assert.deepEqual(current, original);
});
test('invoice and agreement Telegram sends are independent, mode-specific and deduplicated per revision', async t => {
  const { env, db } = await setup(t), p = payload(); await saveDocument(env, req(), orderId, p);
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; }); const messages = [];
  globalThis.fetch = async (_, options) => { messages.push({ caption: options.body.get('caption'), name: options.body.get('document').name }); return Response.json({ ok: true, result: { message_id: messages.length } }); };
  for (const mode of ['invoice', 'agreement']) {
    await sendDocument({ env, params: { id: orderId }, request: sendRequest(p.request_id, '123456789', mode) });
    assert.equal((await (await sendDocument({ env, params: { id: orderId }, request: sendRequest(p.request_id, '123456789', mode) })).json()).already_sent, true);
  }
  assert.equal(messages.length, 2); assert.match(messages[0].caption, /Рахунок/); assert.doesNotMatch(messages[0].caption, /Договір/);
  assert.match(messages[0].name, /-invoice-v1.pdf$/); assert.match(messages[1].name, /-agreement-v1.pdf$/);
  assert.equal(db.prepare('SELECT count(*) n FROM document_deliveries WHERE document_id=?').get(p.request_id).n, 2);
  await assert.rejects(sendDocument({ env, params: { id: orderId }, request: sendRequest(p.request_id, '123456789', 'bad') }), /Невідомий/);
});
test('runtime schema works without migration; deleting order cascades documents and delivery records', async t => {
  const { env, db } = await setup(t);
  db.exec('DROP TABLE document_deliveries; DROP TABLE order_documents; DROP TABLE document_seller_settings;');
  await ensureDocuments(env); const saved = await saveDocument(env, req(), orderId, payload());
  db.prepare("INSERT INTO document_deliveries(id,document_id,created_at,actor,recipient,status) VALUES(?,?,?,?,?,?)").run(saved.document.id, saved.document.id, '2026-09-24', 'test', '123456789', 'sent');
  await deleteOrder({ env, request: req(), params: { id: orderId } });
  assert.equal(db.prepare('SELECT count(*) n FROM order_documents').get().n, 0); assert.equal(db.prepare('SELECT count(*) n FROM document_deliveries').get().n, 0);
});
test('all document API actions require the existing admin authentication', async () => {
  let entered = false;
  const response = await authorize({ request: new Request('https://evline.test/api/admin/document-settings'), env: { ADMIN_TOKEN: 'private' }, next: () => { entered = true; } });
  assert.equal(response.status, 401); assert.equal(entered, false);
});
test('cross-origin writes and programming orders cannot create a parts agreement', async t => {
  const { env, db } = await setup(t);
  await assert.rejects(documentPayload(new Request('https://evline.test/api/admin/documents', { method: 'POST', headers: { origin: 'https://other.test', 'content-type': 'application/json' }, body: '{}' })), e => e.status === 403);
  db.prepare("UPDATE orders SET type='byd' WHERE id=?").run(orderId);
  await assert.rejects(saveDocument(env, req(), orderId, payload()), /Для послуг/);
});
test('Telegram requires ready snapshot and exact connected private customer, never group or arbitrary recipient', async t => {
  const { env } = await setup(t); const p = payload(); const result = await saveDocument(env, req(), orderId, p);
  assert.equal(documentRecipient({ telegram_chat_id: '-100123456' }), '');
  await assert.rejects(sendDocument({ env, params: { id: orderId }, request: sendRequest(p.request_id, '99999999') }), /Одержувач/);
  const draft = await saveDocument(env, req(), orderId, payload(p.data, 1, 'draft'));
  await assert.rejects(sendDocument({ env, params: { id: orderId }, request: sendRequest(draft.document.id) }), /перевірте/);
  assert.equal(result.document.status, 'ready');
});
test('Telegram sends once, retains audit/version and refuses uncertain delivery retries', async t => {
  const { env, db } = await setup(t); const p = payload(); await saveDocument(env, req(), orderId, p);
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; }); let calls = 0;
  globalThis.fetch = async (url, options) => { calls++; assert.match(url, /sendDocument$/); assert.equal(options.body.get('chat_id'), '123456789'); assert.equal(options.body.get('document').type, 'application/pdf'); return Response.json({ ok: true, result: { message_id: 111 } }); };
  await sendDocument({ env, params: { id: orderId }, request: sendRequest(p.request_id) });
  assert.equal((await (await sendDocument({ env, params: { id: orderId }, request: sendRequest(p.request_id) })).json()).already_sent, true); assert.equal(calls, 1);
  const next = payload(p.data, 1); await saveDocument(env, req(), orderId, next);
  globalThis.fetch = async () => { calls++; throw new Error('timeout'); };
  await assert.rejects(sendDocument({ env, params: { id: orderId }, request: sendRequest(next.request_id) }), /міг надійти/);
  await assert.rejects(sendDocument({ env, params: { id: orderId }, request: sendRequest(next.request_id) }), /дублікат/); assert.equal(calls, 2);
  assert.equal(db.prepare('SELECT status FROM document_deliveries WHERE id=?').get(next.request_id).status, 'unknown');
});
test('standalone invoice sends only to explicitly selected CRM customer and deduplicates', async t => {
  const {env,db}=await setup(t), id=crypto.randomUUID(), data=completeDocument();
  data.crm_customer_id='test-customer';
  db.prepare("UPDATE customers SET telegram_chat_id='123456789' WHERE id='test-customer'").run();
  const saved=await saveDocument(env,req(),id,{...payload(data),mode:'invoice'},true);
  assert.equal(saved.recipient,'123456789'); assert.match(saved.recipient_label,/Тест/);
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});let calls=0;
  globalThis.fetch=async (url,options)=>{calls++;assert.equal(options.body.get('chat_id'),'123456789');assert.match(options.body.get('document').name,/invoice-v1.pdf$/);return Response.json({ok:true,result:{message_id:55}});};
  const send=()=>sendInvoice({env,params:{id},request:sendRequest(saved.document.id,'123456789','invoice')});
  await send();assert.equal((await(await send()).json()).already_sent,true);assert.equal(calls,1);
  const after=await getDocumentContext(env,id,'',true);assert.equal(after.deliveries[0].status,'sent');
  assert.equal(db.prepare('SELECT count(*) n FROM document_deliveries').get().n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM admin_audit_log WHERE action='document.send'").get().n,1);
  await assert.rejects(sendInvoice({env,params:{id:crypto.randomUUID()},request:sendRequest(saved.document.id,'123456789','invoice')}),/перевірте/);
  await assert.rejects(sendInvoice({env,params:{id},request:sendRequest(saved.document.id,'123456789','agreement')}),/Оберіть рахунок/);
});
test('standalone invoice never guesses recipient by phone; changed phones, groups and recipient changes are blocked',async t=>{
  const {env,db}=await setup(t),id=crypto.randomUUID(),data=completeDocument();
  db.prepare("UPDATE customers SET telegram_chat_id='123456789' WHERE id='test-customer'").run();
  let saved=await saveDocument(env,req(),id,{...payload(data),mode:'invoice'},true);
  assert.equal(saved.recipient,'');
  await assert.rejects(sendInvoice({env,params:{id},request:sendRequest(saved.document.id,'123456789','invoice')}),/не підключено/);
  data.crm_customer_id='test-customer';data.buyer.phone='+380000000099';
  saved=await saveDocument(env,req(),id,{...payload(data,1),mode:'invoice'},true);assert.equal(saved.recipient,'');
  data.buyer.phone='+380000000001';db.prepare("UPDATE customers SET telegram_chat_id='-100123456' WHERE id='test-customer'").run();
  saved=await saveDocument(env,req(),id,{...payload(data,2),mode:'invoice'},true);assert.equal(saved.recipient,'');
  await assert.rejects(sendInvoice({env,params:{id},request:sendRequest(saved.document.id,'-100123456','invoice')}),/не підключено/);
  db.prepare("UPDATE customers SET telegram_chat_id='987654321' WHERE id='test-customer'").run();
  await assert.rejects(sendInvoice({env,params:{id},request:sendRequest(saved.document.id,'123456789','invoice')}),/Одержувач змінився/);
});
test('changed invoice buyer cannot receive documents through original order Telegram',async t=>{
  const {env}=await setup(t),data=completeDocument();data.buyer.phone='+380000000099';
  const saved=await saveDocument(env,req(),orderId,payload(data));assert.equal(saved.recipient,'');
  await assert.rejects(sendDocument({env,params:{id:orderId},request:sendRequest(saved.document.id)}),/не підключено/);
});
test('standalone delivery requires admin auth, same origin and valid PDF; ambiguous sends are not retried',async t=>{
  const {env,db}=await setup(t),id=crypto.randomUUID(),data=completeDocument();data.crm_customer_id='test-customer';
  db.prepare("UPDATE customers SET telegram_chat_id='123456789' WHERE id='test-customer'").run();
  const saved=await saveDocument(env,req(),id,{...payload(data),mode:'invoice'},true);
  const request=sendRequest(saved.document.id,'123456789','invoice');request.headers.set('origin','https://other.test');
  await assert.rejects(sendInvoice({env,params:{id},request}),e=>e.status===403);
  const unauthorized=await authorize({env,request:new Request(`https://evline.test/api/admin/invoices/${id}/send`,{method:'POST'}),next:()=>{throw new Error('must not send');}});assert.equal(unauthorized.status,401);
  const bad=sendRequest(saved.document.id,'123456789','invoice'),form=await bad.formData();form.set('file',new File(['invalid'.repeat(30)],'bad.pdf',{type:'application/pdf'}));
  await assert.rejects(sendInvoice({env,params:{id},request:new Request(bad.url,{method:'POST',body:form})}),/Некоректний файл/);
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});let calls=0;
  globalThis.fetch=async ()=>{calls++;throw new Error('timeout');};
  const send=()=>sendInvoice({env,params:{id},request:sendRequest(saved.document.id,'123456789','invoice')});
  await assert.rejects(send(),/міг надійти/);await assert.rejects(send(),/дублікат/);assert.equal(calls,1);
});

test('Ukrainian amount in words handles feminine forms, teens, thousands, millions and kopecks', () => {
  for (const [minor, text] of [[0, 'Нуль гривень 00 копійок'], [101, 'Одна гривня 01 копійка'], [202, 'Дві гривні 02 копійки'], [511, 'П’ять гривень 11 копійок'], [1121, 'Одинадцять гривень 21 копійка'], [2124, 'Двадцять одна гривня 24 копійки'], [100000, 'Одна тисяча гривень 00 копійок'], [200000, 'Дві тисячі гривень 00 копійок'], [2742000, 'Двадцять сім тисяч чотириста двадцять гривень 00 копійок'], [100200102, 'Один мільйон дві тисячі одна гривня 02 копійки']]) assert.equal(amountWords(minor), text);
  assert.throws(() => amountWords(-1)); assert.throws(() => amountWords(1.5));
});
const autoPayload = (data = completeDocument(), revision = 0, status = 'ready') => ({ ...payload({ ...data, invoice: { ...data.invoice, number: '', automatic: true } }, revision, status), mode: 'invoice' });
test('external invoice 9 advances an existing counter without renumbering or rewinding invoices', async t => {
  const { env, db } = await setup(t), old = completeDocument(); old.invoice.number = '9';
  db.prepare("INSERT INTO order_documents(id,order_id,revision,created_at,actor,status,data_json,output_mode) VALUES(?,?,1,'2026-10-26','legacy','ready',?,'invoice')")
    .run(crypto.randomUUID(),orderId,JSON.stringify(old));
  const before = db.prepare('SELECT * FROM order_documents').all();
  const migration = await readFile(new URL('../migrations/0044_invoice_start_10.sql', import.meta.url), 'utf8');
  for (const [previous, expected] of [[9,10], [10,10], [27,27]]) {
    db.prepare('UPDATE invoice_sequence SET next_number=? WHERE id=1').run(previous);
    await ensureDocuments(env); await ensureDocuments(env);
    assert.equal(db.prepare('SELECT next_number FROM invoice_sequence').get().next_number, expected);
    db.prepare('UPDATE invoice_sequence SET next_number=? WHERE id=1').run(previous);
    db.exec(migration); db.exec(migration);
    assert.equal(db.prepare('SELECT next_number FROM invoice_sequence').get().next_number, expected);
  }
  assert.deepEqual(db.prepare('SELECT * FROM order_documents').all(), before);
  const issued = await saveDocument(env, req(), crypto.randomUUID(), autoPayload(), true);
  assert.equal(issued.document.data.invoice.number, '27');
});
test('new order and standalone drafts use automatic numbering, but do not consume a number or create an order', async t => {
  const { env, db } = await setup(t), id = crypto.randomUUID();
  const blank = await getDocumentContext(env, id, '', true);
  assert.equal(blank.defaults.invoice.automatic, true); assert.equal(blank.defaults.invoice.number, '');
  assert.equal(blank.recipient, ''); assert.equal(blank.standalone, true);
  await saveDocument(env, req(), id, autoPayload(completeDocument(), 0, 'draft'), true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 1);
  assert.equal(db.prepare('SELECT next_number FROM invoice_sequence').get().next_number, 10);
  assert.equal((await getDocumentContext(env, orderId)).defaults.invoice.automatic, true);
});
test('number 10 onward is shared across standalone and ordered invoices, with atomic concurrent issue and retry', async t => {
  const { env, db } = await setup(t), ids = [crypto.randomUUID(), crypto.randomUUID()];
  const inputs = [autoPayload(), autoPayload(), autoPayload()];
  const results = await Promise.all([saveDocument(env, req(), orderId, inputs[0]), ...ids.map((id, i) => saveDocument(env, req(), id, inputs[i + 1], true))]);
  assert.deepEqual(results.map(r => Number(r.document.data.invoice.number)).sort((a,b) => a-b), [10,11,12]);
  assert.equal((await saveDocument(env, req(), ids[0], inputs[1], true)).document.data.invoice.number, results[1].document.data.invoice.number);
  assert.equal(db.prepare('SELECT next_number FROM invoice_sequence').get().next_number, 13);
  const saved = results[1].document.data; saved.buyer.name = 'Виправлене ім’я';
  const corrected = await saveDocument(env, req(), ids[0], { ...payload(saved, 1), mode: 'invoice' }, true);
  assert.equal(corrected.document.data.invoice.number, saved.invoice.number);
  saved.items[0].price = '20000';
  await assert.rejects(saveDocument(env, req(), ids[0], { ...payload(saved, 2), mode: 'invoice' }, true), e => e.status === 409);
  assert.equal(db.prepare('SELECT next_number FROM invoice_sequence').get().next_number, 13);
  const next = await saveDocument(env, req(), ids[0], autoPayload(saved, 2), true);
  assert.equal(next.document.data.invoice.number, '13');
});
test('stale save and simultaneous duplicate requests never spend extra invoice numbers', async t => {
  const { env, db } = await setup(t), id = crypto.randomUUID(), p = autoPayload();
  const same = await Promise.all([saveDocument(env, req(), id, p, true), saveDocument(env, req(), id, p, true)]);
  assert.equal(same[0].document.id, same[1].document.id);
  const competing = await Promise.allSettled([saveDocument(env, req(), id, autoPayload(completeDocument(), 1), true), saveDocument(env, req(), id, autoPayload(completeDocument(), 1), true)]);
  assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(db.prepare('SELECT next_number FROM invoice_sequence').get().next_number, 12);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_documents').get().n, 2);
});
test('legacy numeric invoices advance sequence, and historical number, amount and PDF remain unchanged', async t => {
  const { env, db } = await setup(t), old = completeDocument(); old.invoice.number = '18';
  await saveDocument(env, req(), orderId, { ...payload(old), mode: 'invoice' });
  const before = db.prepare('SELECT data_json FROM order_documents').get().data_json;
  const next = await saveDocument(env, req(), crypto.randomUUID(), autoPayload(), true);
  assert.equal(next.document.data.invoice.number, '19');
  assert.equal(db.prepare('SELECT data_json FROM order_documents').get().data_json, before);
});
test('invoice register, search and customer lookup include standalone invoices without leaking internal fields', async t => {
  const { env } = await setup(t);
  await saveDocument(env, req(), orderId, autoPayload());
  const id = crypto.randomUUID(), first = await saveDocument(env, req(), id, autoPayload(), true);
  await saveDocument(env, req(), id, autoPayload(completeDocument(), 1), true);
  const list = async query => (await listInvoices({ env, request: new Request(`https://evline.test/api/admin/invoices?${query}`) })).json();
  const all = await list(''); assert.equal(all.rows.length, 3); assert.equal(all.rows.filter(r => r.workspace).length, 2);
  const one = await list(`q=${first.document.data.invoice.number}`); assert.equal(one.rows.length, 1);
  assert.equal((await list('customers=Тест')).customers.length, 1);
  assert.doesNotMatch(JSON.stringify(all), /iban|tax_id|manager_notes|purchase_cost/);
  assert.equal((await list('q=%25')).rows.length, 0);
});
test('invoice output mirrors the sample: code, quantity, unit, VIN, editable note and sum in words, no agreement', () => {
  const d = completeDocument(); d.items[0].price = '27420'; d.invoice.note = 'Погоджене отримання зі складу'; d.items[0].sku = 'TEST-OEM';
  const blocks = documentBlocks(d, 'invoice'), text = documentText(d, 'invoice');
  assert.equal(blocks.find(b => b.type === 'table').headers.length, 7);
  for (const value of [d.vin, 'TEST-OEM', 'Двадцять сім тисяч чотириста двадцять гривень 00 копійок', d.invoice.note]) assert.ok(text.includes(value));
  assert.doesNotMatch(text, /Договір|Специфікація/);
});
test('standalone invoice remains matchable by the bank, but does not update or create any order', async t => {
  const { env, db } = await setup(t), id = crypto.randomUUID(), before = db.prepare('SELECT * FROM orders').all();
  const result = await saveDocument(env, req(), id, autoPayload(), true), d = result.document.data;
  const invoices = await invoiceIndex(env);
  assert.equal(invoices.length, 1); assert.equal(invoices[0].workspace_id, id); assert.equal(invoices[0].order_id, null);
  const tx = { transaction_id: 'standalone-test', account_id: 'test', account_iban: d.seller.iban, currency: 'UAH', amount_minor: 1000000, direction: 'INBOUND', booked_at: `${d.invoice.date}T12:00:00Z`, payer_name: 'Тестовий Покупець', purpose: `Оплата за рахунком № ${d.invoice.number}` };
  await ingestTransactions(env, [tx], invoices);
  assert.equal(await reconcile(env, invoices), 1); assert.equal(await reconcile(env, invoices), 0);
  const incoming = await readIncoming(env);
  assert.equal(incoming.invoices[0].status, 'paid'); assert.equal(incoming.rows[0].workspace_id, id);
  assert.equal(incoming.summary.review_count, 0); assert.equal((await readIncoming(env, { unmatched: true })).rows.length, 0);
  assert.deepEqual(db.prepare('SELECT * FROM orders').all(), before);
});
test('atomic rollback keeps number 10 available after an intermediate database failure', async t => {
  const { env, db } = await setup(t), id = crypto.randomUUID(), p = autoPayload();
  db.exec("CREATE TRIGGER fail_number BEFORE INSERT ON invoice_numbers BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  await assert.rejects(saveDocument(env, req(), id, p, true), /synthetic failure/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_documents').get().n, 0);
  assert.equal(db.prepare('SELECT next_number FROM invoice_sequence').get().next_number, 10);
  db.exec('DROP TRIGGER fail_number');
  assert.equal((await saveDocument(env, req(), id, p, true)).document.data.invoice.number, '10');
});
test('manual-number races have one winner; automatic numbers cannot be impersonated', async t => {
  const { env, db } = await setup(t), d = completeDocument(); d.invoice.number = 'MANUAL-TEST';
  const results = await Promise.allSettled([crypto.randomUUID(),crypto.randomUUID()].map(id => saveDocument(env, req(), id, { ...payload(d), mode:'invoice' }, true)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_documents').get().n, 1);
  d.invoice.number = '10'; d.invoice.automatic = true;
  await assert.rejects(saveDocument(env, req(), crypto.randomUUID(), { ...payload(d), mode:'invoice' }, true), e => e.status === 409);
});
test('issuing replaces the pending draft in the register, and seller tax terms seed the next draft only', async t => {
  const { env } = await setup(t), id = crypto.randomUUID(), p = autoPayload();
  await saveSeller(env, req(), { expected_revision:0, seller:p.data.seller });
  await saveDocument(env, req(), id, { ...p, status:'draft' }, true);
  const ready = await saveDocument(env, req(), id, { ...autoPayload(p.data,1), mode:'invoice' }, true);
  const result = await (await listInvoices({ env, request:new Request('https://evline.test/api/admin/invoices') })).json();
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].status, 'ready');
  const fresh = await getDocumentContext(env, crypto.randomUUID(), '', true);
  assert.equal(fresh.defaults.tax, 'Без ПДВ'); assert.equal(fresh.defaults.buyer.name, ''); assert.equal(fresh.defaults.invoice.note, undefined);
  assert.equal((await getDocumentContext(env, id, ready.document.id, true)).document.data.invoice.number, '10');
});

test('seller invoice defaults are reusable before first issue and survive legacy profile edits', async t => {
  const { env, db } = await setup(t), d = completeDocument();
  await saveSeller(env, req(), { expected_revision:0, seller:d.seller, invoice_defaults:{tax:'Без податку (ПДВ)'} });
  let fresh = await getDocumentContext(env, crypto.randomUUID(), '', true);
  assert.equal(fresh.defaults.tax, 'Без податку (ПДВ)');
  await saveSeller(env, req(), { expected_revision:1, seller:{...d.seller, phone:'000000003'} });
  fresh = await getDocumentContext(env, crypto.randomUUID(), '', true);
  assert.equal(fresh.defaults.tax, 'Без податку (ПДВ)');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_documents').get().n, 0);
  assert.equal(db.prepare('SELECT next_number FROM invoice_sequence').get().next_number, 10);
});

test('invoice does not require contract address and does not print an empty address', () => {
  const d = completeDocument(); d.seller.address = '';
  assert.deepEqual(validateReady(d, 'invoice'), []);
  assert.ok(validateReady(d, 'agreement').includes('Адреса продавця'));
  assert.doesNotMatch(documentText(d, 'invoice'), /Адреса постачальника/);
});

test('invoice copy keeps buyer and positions but resets number, dates, payment and review', async t => {
  const { env, db } = await setup(t), old = completeDocument();
  old.invoice.date = '2026-09-24'; old.invoice.note = 'Узгоджена примітка';
  old.receipt = { enabled:true, amount:'5000', date:'2026-09-24', method:'IBAN', reference:'old-payment', confirmed:true };
  const saved = await saveDocument(env, req(), orderId, {...payload(old),mode:'invoice'});
  const id = crypto.randomUUID(), copy = await getDocumentContext(env,id,'',true,saved.document.id);
  assert.deepEqual(copy.defaults.buyer,old.buyer); assert.deepEqual(copy.defaults.items,old.items);
  assert.equal(copy.defaults.invoice.number,''); assert.equal(copy.defaults.invoice.automatic,true);
  assert.notEqual(copy.defaults.invoice.date,old.invoice.date); assert.equal(copy.defaults.invoice.note,old.invoice.note);
  assert.equal(copy.defaults.receipt.enabled,false); assert.equal(copy.defaults.receipt.amount,'');
  assert.equal(copy.defaults.prepayment,''); assert.equal(copy.defaults.reviewed,false); assert.equal(copy.defaults.number,'');
  assert.equal(copy.recipient,''); assert.equal(copy.document,null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_documents').get().n,0);
  copy.defaults.items[0].price='12000'; copy.defaults.reviewed=true;
  const issued=await saveDocument(env,req(),id,{...payload(copy.defaults),mode:'invoice'},true);
  assert.equal(issued.document.data.invoice.number,'10');
  assert.equal((await getDocumentContext(env,orderId,saved.document.id)).document.data.items[0].price,old.items[0].price);
  await assert.rejects(getDocumentContext(env,id,'',true,saved.document.id),e=>e.status===409);
  await assert.rejects(getDocumentContext(env,crypto.randomUUID(),'',true,'missing'),e=>e.status===404);
});

test('repeat order whitelist excludes paid states, supplier costs, documents and advertising identifiers', () => {
  const source={id:'old',type:'parts',customer_name:'Клієнт',customer_phone:'+380000000001',car:'BYD',vin:'VIN',item_name:'Бампер',revenue_uah:12000,
    status:'paid',payment_status:'paid',tracking_number:'old-track',purchase_cost_uah:6000,gclid:'old-click',campaign:'old-ad',telegram_chat_id:'old-chat'};
  const draft=repeatOrderDraft(source); assert.equal(draft.customer_phone,source.customer_phone); assert.equal(draft.revenue_uah,'12000');
  const copied=repeatOrderPayload(source,{...source,item_name:'Крило',revenue_uah:'2000',customer_phone:'+380000000002'});
  assert.equal(copied.status,'new'); assert.equal(copied.payment_status,'unknown'); assert.equal(copied.item_name,'Крило');
  assert.equal(copied.customer_phone,'+380000000002'); assert.equal(copied.medium,'repeat');
  assert.doesNotMatch(JSON.stringify(copied),/old-track|6000|old-click|old-ad|old-chat/);
  const service=repeatOrderPayload({...source,type:'byd',item_name:'',service_name:'SIM'},{service_name:'Програмування'});
  assert.equal(service.service_name,'Програмування'); assert.equal(service.item_name,'');
});

test('repeat creates a new unpaid order for the same customer and leaves source records unchanged', async t => {
  const {env,db}=await setup(t);
  const before=db.prepare('SELECT * FROM orders WHERE id=?').get(orderId), customer=db.prepare('SELECT * FROM customers WHERE id=?').get(before.customer_id);
  const request=new Request('https://evline.test/api/admin/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({repeat_order_id:orderId,customer_phone:'+380000000002',item_name:'Нова деталь',revenue_uah:2000,status:'paid',payment_status:'paid',purchase_cost_uah:900,tracking_number:'old',gclid:'old',telegram_chat_id:'old'})});
  const result=await (await createOrder({env,request})).json();
  assert.notEqual(result.order.id,orderId); assert.notEqual(result.order.order_number,before.order_number);
  assert.equal(result.order.customer_id,before.customer_id); assert.equal(result.order.customer_phone,'+380000000002');
  assert.equal(result.order.item_name,'Нова деталь'); assert.equal(result.order.revenue_uah,2000);
  assert.equal(result.order.status,'new'); assert.equal(result.order.payment_status,'unknown');
  for(const key of ['purchase_cost_uah','delivery_cost_uah','ad_cost_uah'])assert.equal(result.order[key],0);
  for(const key of ['gclid','tracking_number','telegram_chat_id'])assert.ok(!result.order[key]);
  assert.deepEqual(db.prepare('SELECT * FROM orders WHERE id=?').get(orderId),before);
  assert.deepEqual(db.prepare('SELECT * FROM customers WHERE id=?').get(before.customer_id),customer);
  assert.match(db.prepare('SELECT comment FROM order_status_events WHERE order_id=?').get(result.order.id).comment,/O-TEST/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM order_documents WHERE order_id=?').get(result.order.id).n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM supplier_payments WHERE order_id=?').get(result.order.id).n,0);
});

test('repeat cannot create an orphan when source is missing', async t => {
  const {env,db}=await setup(t), count=db.prepare('SELECT COUNT(*) n FROM orders').get().n;
  const request=new Request('https://evline.test/api/admin/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({repeat_order_id:'missing'})});
  assert.equal((await createOrder({env,request})).status,404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n,count);
});

const numberingChange = (expected = 10, next = 20) => ({ request_id: crypto.randomUUID(), expected_next_number: expected, next_number: next });
test('manager advances numbering with durable actor history, audit and idempotent retries', async t => {
  const {env,db}=await setup(t), p=numberingChange();
  assert.equal((await (await getNumbering({env})).json()).next_number,10);
  const result=await advanceInvoiceNumbering(env,req(),p);
  assert.equal(result.next_number,20); assert.equal(result.last_change.previous_number,10); assert.ok(result.last_change.actor);
  assert.equal((await advanceInvoiceNumbering(env,req(),p)).next_number,20);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoice_numbering_changes').get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE action='invoice.numbering.advanced'").get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoice_numbers').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_documents').get().n,0);
  await advanceInvoiceNumbering(env,req(),numberingChange(20,30));
  assert.equal((await advanceInvoiceNumbering(env,req(),p)).next_number,30);
  await assert.rejects(advanceInvoiceNumbering(env,req(),{...p,next_number:40}),e=>e.status===409);
});
test('numbering rejects invalid, backward and stale edits', async t => {
  const {env}=await setup(t); await ensureDocuments(env);
  for (const invalid of [null,[],20]) await assert.rejects(advanceInvoiceNumbering(env,req(),invalid),e=>e.status===400);
  for(const next of [0,9,10,10.5,'20',null,NaN,Infinity,1000000000])
    await assert.rejects(advanceInvoiceNumbering(env,req(),numberingChange(10,next)),e=>e.status===400);
  await assert.rejects(advanceInvoiceNumbering(env,req(),{...numberingChange(),request_id:'bad'}),e=>e.status===400);
  await saveDocument(env,req(),crypto.randomUUID(),autoPayload(),true);
  await assert.rejects(advanceInvoiceNumbering(env,req(),numberingChange()),e=>e.status===409);
  assert.equal((await invoiceNumberingState(env)).next_number,11);
});
test('simultaneous identical numbering retries make one durable change', async t => {
  const {env,db}=await setup(t); await ensureDocuments(env); const p=numberingChange();
  const results=await Promise.all([advanceInvoiceNumbering(env,req(),p),advanceInvoiceNumbering(env,req(),p)]);
  assert.deepEqual(results.map(r=>r.next_number),[20,20]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoice_numbering_changes').get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE action='invoice.numbering.advanced'").get().n,1);
});
test('concurrent reuse of a numbering request ID with different values cannot move the counter', async t => {
  const {env,db}=await setup(t); await ensureDocuments(env); const p=numberingChange();
  const results=await Promise.allSettled([advanceInvoiceNumbering(env,req(),p),advanceInvoiceNumbering(env,req(),{...p,next_number:30})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  const change=db.prepare('SELECT next_number FROM invoice_numbering_changes').get();
  assert.equal((await invoiceNumberingState(env)).next_number,change.next_number);
});
test('last supported invoice number is issued once and exhaustion never creates an invalid snapshot', async t => {
  const {env,db}=await setup(t); await ensureDocuments(env);
  await advanceInvoiceNumbering(env,req(),numberingChange(10,999999999));
  const last=await saveDocument(env,req(),crypto.randomUUID(),autoPayload(),true);
  assert.equal(last.document.data.invoice.number,'999999999');
  await assert.rejects(saveDocument(env,req(),crypto.randomUUID(),autoPayload(),true),/вичерпано/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_documents').get().n,1);
});
test('two managers advancing the same counter cannot overwrite one another', async t => {
  const {env,db}=await setup(t); await ensureDocuments(env);
  const results=await Promise.allSettled([20,30].map(n=>advanceInvoiceNumbering(env,req(),numberingChange(10,n))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoice_numbering_changes').get().n,1);
  assert.equal((await invoiceNumberingState(env)).next_number,results.find(r=>r.status==='fulfilled').value.next_number);
});
test('simultaneous numbering change and invoice issue serialize without duplicate or rewound numbers', async t => {
  const {env,db}=await setup(t); await ensureDocuments(env);
  const [change,issue]=await Promise.allSettled([advanceInvoiceNumbering(env,req(),numberingChange()),saveDocument(env,req(),crypto.randomUUID(),autoPayload(),true)]);
  assert.equal(issue.status,'fulfilled');
  const number=Number(issue.value.document.data.invoice.number);
  if(change.status==='fulfilled') assert.equal(number,20);
  else { assert.equal(change.reason.status,409); assert.equal(number,10); }
  assert.equal((await invoiceNumberingState(env)).next_number,number+1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoice_numbers').get().n,1);
});
test('drafts created before a numbering change issue from the new counter and skipped manual numbers fail', async t => {
  const {env,db}=await setup(t), id=crypto.randomUUID();
  await saveDocument(env,req(),id,autoPayload(completeDocument(),0,'draft'),true);
  await advanceInvoiceNumbering(env,req(),numberingChange());
  for(const number of ['9','10','19','019']) {
    const d=completeDocument(); d.invoice.number=number; d.invoice.automatic=false;
    await assert.rejects(saveDocument(env,req(),crypto.randomUUID(),{...payload(d),mode:'invoice'},true),e=>e.status===409);
  }
  const tooLong=completeDocument(); tooLong.invoice.number='0000000019'; tooLong.invoice.automatic=false;
  await assert.rejects(saveDocument(env,req(),crypto.randomUUID(),{...payload(tooLong),mode:'invoice'},true),e=>e.status===400);
  const ready=await saveDocument(env,req(),id,autoPayload(completeDocument(),1),true);
  assert.equal(ready.document.data.invoice.number,'20');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_documents').get().n,2);
});
test('existing invoice revisions survive advancing past their number; reuse for another buyer account does not', async t => {
  const {env}=await setup(t), id=crypto.randomUUID(), d=completeDocument(); d.invoice.number='18';
  const saved=await saveDocument(env,req(),id,{...payload(d),mode:'invoice'},true);
  assert.equal((await invoiceNumberingState(env)).next_number,19);
  await advanceInvoiceNumbering(env,req(),numberingChange(19,50));
  d.buyer.phone='+380000000099';
  assert.equal((await saveDocument(env,req(),id,{...payload(d,1),mode:'invoice'},true)).document.data.invoice.number,'18');
  const body='3000020000000000000000000';
  d.seller.iban='UA'+String(98-Number(BigInt(body+'301000')%97n)).padStart(2,'0')+body;
  await assert.rejects(saveDocument(env,req(),crypto.randomUUID(),{...payload(d),mode:'invoice'},true),e=>e.status===409);
  assert.equal((await getDocumentContext(env,id,saved.document.id,true)).document.data.buyer.phone,'+380000000001');
});
test('numbering update and history roll back together on database failure', async t => {
  const {env,db}=await setup(t); await ensureDocuments(env);
  db.exec("CREATE TRIGGER fail_numbering BEFORE UPDATE ON invoice_sequence WHEN NEW.next_number=20 BEGIN SELECT RAISE(ABORT,'synthetic numbering failure'); END");
  await assert.rejects(advanceInvoiceNumbering(env,req(),numberingChange()),/synthetic numbering failure/);
  assert.equal((await invoiceNumberingState(env)).next_number,10);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoice_numbering_changes').get().n,0);
});
test('numbering endpoint requires admin auth and same-origin JSON updates', async t => {
  const {env}=await setup(t);
  const unauth=new Request('https://evline.test/api/admin/invoice-numbering');
  const response=await authorize({env,request:unauth,next:()=>getNumbering({env})}); assert.equal(response.status,401);
  const request=new Request('https://evline.test/api/admin/invoice-numbering',{method:'POST',headers:{origin:'https://other.test','content-type':'application/json'},body:JSON.stringify(numberingChange())});
  await assert.rejects(setNumbering({env,request}),e=>e.status===403);
  const ok=new Request('https://evline.test/api/admin/invoice-numbering',{method:'POST',headers:{authorization:'Bearer test-admin',origin:'https://evline.test','content-type':'application/json'},body:JSON.stringify(numberingChange())});
  assert.equal((await (await authorize({env,request:ok,next:()=>setNumbering({env,request:ok})})).json()).next_number,20);
});
