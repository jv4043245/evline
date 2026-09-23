import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fromOrder, normalizeDocument, validateReady, totals, cents, validIban, syncStandardTerms } from '../admin/documents/model.js';
import { AGREEMENT_TERMS } from '../admin/documents/agreement-template.js';
import { documentBlocks, previewHtml, pdfDefinition } from '../admin/documents/render.js';
import { getDocumentContext, saveDocument, saveSeller, ensureDocuments, documentRecipient, documentPayload } from '../functions/_lib/order-documents.js';
import { onRequestPost as sendDocument } from '../functions/api/admin/orders/[id]/document-send.js';
import { onRequest as authorize } from '../functions/api/admin/_middleware.js';
import { onRequestDelete as deleteOrder } from '../functions/api/admin/orders/[id].js';

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
    async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
  }; } } };
  db.prepare('INSERT INTO customers(id,created_at,updated_at,name,phone) VALUES(?,?,?,?,?)').run('test-customer', '2026-09-24', '2026-09-24', 'Тест', '+380000000001');
  db.prepare(`INSERT INTO orders(id,created_at,updated_at,customer_id,order_number,customer_name,customer_phone,type,status,revenue_uah,purchase_cost_uah,payment_status,item_name,telegram_chat_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(orderId, '2026-09-24', '2026-09-24', 'test-customer', 'O-TEST', 'Тест', '+380000000001', 'parts', 'paid', 10000, 7777, 'paid', 'Бампер', '123456789');
  return { db, env };
}
const payload = (data = completeDocument(), expected_revision = 0, status = 'ready') => ({ request_id: crypto.randomUUID(), expected_revision, status, data });
function sendRequest(id, recipient = '123456789') {
  const form = new FormData(); form.set('document_id', id); form.set('recipient', recipient);
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
  assert.equal(documentBlocks(d).filter(b => b.type === 'title').length, 2);
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
