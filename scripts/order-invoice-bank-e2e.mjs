// Synthetic end-to-end rehearsal: real routes/UI/adapter, in-memory DB, no production access.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { onRequest as middleware } from '../functions/api/admin/_middleware.js';
import { onRequestPost as createOrder } from '../functions/api/admin/orders.js';
import { onRequestGet as documentGet, onRequestPost as documentPost } from '../functions/api/admin/orders/[id]/documents.js';
import { onRequest as bankRoute } from '../functions/api/admin/bank-incoming.js';
import { connectBank, syncBank, invoiceIndex, kyivDay, readIncoming } from '../functions/_lib/bank-incoming.js';

const root = path.resolve(import.meta.dirname, '..');
const output = process.env.SMOKE_OUTPUT || '/tmp/evline-order-invoice-bank-e2e';
await mkdir(output, { recursive: true });
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
for (const file of (await readdir(path.join(root, 'migrations'))).filter(f => f.endsWith('.sql')).sort()) {
  db.exec(await readFile(path.join(root, 'migrations', file), 'utf8'));
}
const env = {
  ADMIN_TOKEN: 'synthetic-manager', ADMIN_OWNER_TOKEN: 'synthetic-owner',
  PUMB_CLIENT_ID: 'synthetic-client', PUMB_CLIENT_SECRET: 'synthetic-secret',
  PUMB_ENCRYPTION_KEY: btoa('a'.repeat(32)),
  DB: {
    prepare(sql) {
      const statement = db.prepare(sql); let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return statement.get(...args) || null; },
        async all() { return { results: statement.all(...args) }; },
        async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
      };
    },
    async batch(statements) {
      db.exec('BEGIN');
      try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  },
};
const ibanBody = '3000010000000000000000000';
const iban = 'UA' + String(98 - Number(BigInt(ibanBody + '301000') % 97n)).padStart(2, '0') + ibanBody;
// Only environment configuration is seeded; orders, documents and bank facts use production code paths.
db.prepare('INSERT INTO document_seller_settings(id,revision,updated_at,actor,data_json) VALUES(1,1,?,?,?)').run(
  new Date().toISOString(), 'Synthetic setup', JSON.stringify({ name: 'ФОП Тестовий Продавець', tax_id: '0000000000',
    address: 'Тестова адреса', phone: '+380000000000', email: 'test@example.invalid', iban, bank: 'Тестовий банк', tax_status: 'Без ПДВ' }));
const nativeFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Outbound network forbidden in synthetic rehearsal'); };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/bank-test') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="uk"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/admin/bank-incoming.css"><style>body{font:14px Arial;margin:24px}main{max-width:1200px;margin:auto}</style><h1>ІЗОЛЬОВАНИЙ ТЕСТ — не реальні кошти</h1><main class="bank-incoming"></main><script type="module">import{createBankIncomingView}from'/admin/bank-incoming.js';const api=async(p,o={})=>{const r=await fetch(p,{...o,headers:{authorization:'Bearer synthetic-owner','content-type':'application/json'}});const j=await r.json();if(!r.ok)throw Error(j.error);return j};window.view=createBankIncomingView(document.querySelector('main'),api);await window.view.load();</script></html>`);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const match = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)\/documents$/);
      const next = () => match ? (req.method === 'GET' ? documentGet : documentPost)({ env, request, params: { id: match[1] } })
        : url.pathname === '/api/admin/orders' && req.method === 'POST' ? createOrder({ env, request })
        : url.pathname === '/api/admin/bank-incoming' ? bankRoute({ env, request }) : Response.json({ error: 'Unexpected test API' }, { status: 404 });
      const response = await middleware({ env, request, next });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const file = path.resolve(root, '.' + url.pathname, url.pathname.endsWith('/') ? 'index.html' : '');
    if (!file.startsWith(root + path.sep)) throw new Error('Outside root');
    res.setHeader('content-type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function api(route, body) {
  const response = await nativeFetch(origin + route, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer synthetic-manager', 'content-type': 'application/json', origin }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
}
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const report = { synthetic: true, production_writes: 0, started_at: new Date().toISOString(), checks: [] };
function passed(name, details = {}) { report.checks.push({ name, ...details }); console.log('PASS', name, JSON.stringify(details)); }
try {
  const { order } = await api('/api/admin/orders', { type: 'parts', status: 'awaiting_payment', customer_name: 'Тестовий Покупець',
    customer_phone: '+380000000001', item_name: 'ТЕСТ — бампер', revenue_uah: 10000, payment_status: 'unpaid', source: 'synthetic-e2e' });
  report.order = { id: order.id, number: order.order_number };
  passed('Order created through authenticated CRM API', report.order);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('evline_admin_token', 'synthetic-manager'));
  const blocked = [], errors = [];
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); blocked.push(route.request().url()); return route.abort(); });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${origin}/admin/documents/?order=${order.id}`);
  await page.locator('[data-workspace]').waitFor({ state: 'visible' });
  await page.locator('[data-output-mode]').selectOption('invoice');
  await page.locator('[data-path="invoice.number"]').fill('1');
  await page.locator('[data-path="tax"]').fill('Без ПДВ');
  await page.locator('[data-action="save"]').click();
  await page.getByText('Збережено версію 1', { exact: true }).waitFor();
  assert.equal((await invoiceIndex(env)).length, 0);
  passed('Draft invoice excluded from bank matching');
  await page.locator('[data-reviewed]').check();
  await page.locator('[data-action="issue-invoice"]').click();
  await page.getByText('Рахунок готовий і доступний', { exact: false }).waitFor();
  const [invoice] = await invoiceIndex(env); assert.ok(invoice); assert.equal(invoice.number, '1'); assert.equal(invoice.amount_minor, 1000000);
  assert.equal(invoice.order_id, order.id);
  report.invoice = { key: invoice.key, document_id: invoice.document_id, number: invoice.number, amount_minor: invoice.amount_minor };
  await page.screenshot({ path: path.join(output, 'issued-invoice.png'), fullPage: true });
  passed('Manager issued short-number invoice using real editor', report.invoice);
  const today = kyivDay(), [year, month, day] = today.split('-');
  const account = { accountId: 123, iban, currency: 'UAH', isCardAccount: false };
  const bankCalls = [];
  function fakeBank(transactions = []) { return async url => {
    const route = new URL(url).pathname; bankCalls.push(route);
    if (route.endsWith('/token')) return Response.json({ access_token: 'synthetic-access', expires_in: 300 });
    if (route.endsWith('/account')) return Response.json([account]);
    assert.ok(route.endsWith('/multi-account-transactions'), 'Unexpected bank endpoint'); return Response.json(transactions);
  }; }
  function transaction(id, amount, description = 'Оплата за рахунком № 1') { return { id, hostId: 1, accountId: 123, state: 'PROCESSED', direction: 'INBOUND',
    currencyCode: 'UAH', amount, operationDate: `${day}.${month}.${year} 13:00:00`, senderName: 'Тестовий Покупець', description }; }
  await connectBank(env, { username: 'synthetic-user', password: 'synthetic-password', consent: true, start_date: today }, 'Synthetic owner', fakeBank());
  async function sync(transactions) { db.exec('UPDATE bank_connections SET last_attempt_at=NULL'); return syncBank(env, { fetcher: fakeBank(transactions) }); }
  async function verifyStatus(expected, received, invoiceStatus = expected) {
    assert.equal(db.prepare('SELECT payment_status FROM orders WHERE id=?').get(order.id).payment_status, expected);
    const state = await readIncoming(env); const issued = state.invoices.find(i => i.key === invoice.key);
    assert.equal(issued.status, invoiceStatus); assert.equal(issued.received_minor, received);
    return state;
  }
  const first = transaction('900000000000000001', '4000.00'), second = transaction('900000000000000002', '6000.00');
  let result = await sync([first]); assert.equal(result.imported, 1); assert.equal(result.matched, 1); await verifyStatus('partial', 400000);
  passed('PUMB adapter → automatic match → partial invoice and order', result);
  await page.goto(origin + '/bank-test'); await page.getByText('Частково оплачено', { exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(output, 'partial-payment.png'), fullPage: true });
  result = await sync([first, second]); assert.equal(result.imported, 1); assert.equal(result.matched, 1); await verifyStatus('paid', 1000000);
  passed('Second payment completes invoice and order without manual linking', result);
  const auditCount = db.prepare('SELECT COUNT(*) n FROM admin_audit_log').get().n;
  result = await sync([first, second]); assert.equal(result.imported, 0); assert.equal(result.matched, 0); await verifyStatus('paid', 1000000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_incoming').get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM admin_audit_log').get().n, auditCount);
  passed('Repeated statement does not duplicate money, matches or audit', result);
  const unrelated = transaction('900000000000000003', '10000.00', 'Оплата товару');
  result = await sync([first, second, unrelated]); assert.equal(result.imported, 1); assert.equal(result.matched, 0);
  const unlinked = db.prepare('SELECT order_id, review_reason FROM bank_incoming WHERE amount_minor=1000000').get();
  assert.equal(unlinked.order_id, null); assert.equal(unlinked.review_reason, 'no_invoice'); await verifyStatus('paid', 1000000);
  passed('Same customer and amount without invoice reference remain unlinked', unlinked);
  await page.reload(); await page.getByText('Оплачено за випискою', { exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(output, 'completed-payments.png'), fullPage: true });
  const wrongNumber = transaction('900000000000000004', '1.00', 'Оплата за рахунком № 11');
  const excess = transaction('900000000000000005', '0.01');
  result = await sync([first, second, unrelated, wrongNumber, excess]);
  assert.equal(result.imported, 2); assert.equal(result.matched, 0);
  assert.equal(db.prepare('SELECT review_reason FROM bank_incoming WHERE amount_minor=100').get().review_reason, 'no_invoice');
  assert.equal(db.prepare('SELECT review_reason FROM bank_incoming WHERE amount_minor=1').get().review_reason, 'overpayment');
  await verifyStatus('paid', 1000000, 'review');
  passed('Invoice 11 does not match invoice 1; excess payment requires review');
  const facts = db.prepare('SELECT id,transaction_id,order_id,document_id,invoice_number,invoice_key,match_method,fingerprint,amount_minor,booked_at,matched_at FROM bank_incoming WHERE order_id=? ORDER BY amount_minor').all(order.id);
  assert.equal(facts.length, 2);
  for (const fact of facts) { assert.equal(fact.document_id, invoice.document_id); assert.equal(fact.invoice_key, invoice.key); assert.equal(fact.match_method, 'automatic'); assert.ok(fact.fingerprint && fact.matched_at); }
  const audit = db.prepare('SELECT action,entity_id,order_id,details_json FROM admin_audit_log ORDER BY rowid').all();
  for (const action of ['order.create', 'document.save', 'bank.payments_match', 'bank.order_payment_status']) assert.ok(audit.some(a => a.action === action), action);
  for (const fact of facts) assert.ok(audit.some(a => a.action === 'bank.payments_match' && JSON.parse(a.details_json).payment_ids.includes(fact.id)));
  report.payments = facts; report.audit = audit; report.bank_endpoints = [...new Set(bankCalls)];
  passed('Trace joins bank transaction → fingerprint → invoice version → order → audit');
  await page.reload(); await page.getByText('Потрібна перевірка', { exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(output, 'review-payments.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  assert.equal(db.prepare('SELECT revenue_uah FROM orders WHERE id=?').get(order.id).revenue_uah, 10000);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status, order.status);
  passed('Actual bank UI reflects results; no browser errors or external requests; price/workflow unchanged');
  await context.close(); report.completed_at = new Date().toISOString();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log('REPORT', path.join(output, 'report.json'));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); db.close(); globalThis.fetch = nativeFetch; }
