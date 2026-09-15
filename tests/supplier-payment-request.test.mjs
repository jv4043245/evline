import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { onRequestPost } from '../functions/api/admin/orders/[id]/supplier-payments.js';
import { onRequest as authorize } from '../functions/api/admin/_middleware.js';

const migrations = new URL('../migrations/', import.meta.url);
const schemas = await Promise.all((await readdir(migrations)).filter(name => name.endsWith('.sql')).sort().map(name => readFile(new URL(name, migrations), 'utf8')));
const accounts = [
  { id: 'andrii', name: 'Андрій', token: 'test-existing-token' },
  { id: 'igor', name: 'Ігор', token: 'test-igor-token' },
  { id: 'owner', name: 'Власник', token: 'test-owner-token' },
];

function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = ON');
  for (const schema of schemas) db.exec(schema);
  db.prepare("INSERT INTO orders (id, order_number, created_at, updated_at, car, status) VALUES ('test', 'O-900001', '2026-09-15', '2026-09-15', 'Test car', 'proposal_sent')").run();
  const DB = { prepare(sql) {
    const stmt = db.prepare(sql); let values = [];
    return {
      bind(...args) { values = args; return this; },
      async run() { return stmt.run(...values); },
      async first() { return stmt.get(...values) || null; },
      async all() { return { results: stmt.all(...values) }; },
    };
  }, async batch(statements) { const results = []; for (const stmt of statements) results.push(await stmt.run()); return results; } };
  const env = { DB, ADMIN_TOKEN: accounts[0].token, ADMIN_USERS_JSON: JSON.stringify(accounts.slice(1)), TELEGRAM_BOT_TOKEN: 'synthetic-bot', TELEGRAM_PAYMENTS_CHAT_ID: '-100000000001' };
  async function send(payload, account = accounts[0], envOverride = {}) {
    const request = new Request('https://evline.example/api/admin/orders/test/supplier-payments', {
      method: 'POST', headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    const context = { request, params: { id: 'test' }, env: { ...env, ...envOverride } };
    return authorize({ ...context, next: () => onRequestPost(context) });
  }
  return { db, env, send };
}

for (const [index, supplier] of ['BYD', 'Zeekr', 'Toyota'].entries()) {
  test(`${accounts[index].name} can send ${supplier} payment with its QR and linked message`, async t => {
    const { db, send, env } = setup(t);
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.ok(url.startsWith('https://api.telegram.org/botsynthetic-bot/'));
      const body = JSON.parse(options.body); calls.push({ url, body });
      return Response.json({ ok: true, result: { message_id: calls.length === 1 ? 101 : 102, chat: { id: env.TELEGRAM_PAYMENTS_CHAT_ID } } });
    });
    const response = await send({ supplier_name: supplier, requested_amount: '1234.56', requested_currency: 'CNY', notes: '' }, accounts[index]);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(calls.length, 2);
    assert.ok(calls[0].url.endsWith('/sendMessage'));
    assert.equal(calls[0].body.chat_id, env.TELEGRAM_PAYMENTS_CHAT_ID);
    assert.match(calls[0].body.text, /O-900001/);
    assert.ok(calls[0].body.text.includes(`Постачальник: ${supplier}`));
    assert.match(calls[0].body.text.replace(/\s/g, ''), /1234,56CNY/);
    assert.ok(calls[1].url.endsWith('/sendPhoto'));
    assert.equal(calls[1].body.photo, `https://evline.com.ua/assets/images/suppliers/${supplier.toLowerCase()}-payment-qr.jpg`);
    assert.equal(calls[1].body.reply_parameters.message_id, 101);
    assert.equal(calls[1].body.chat_id, env.TELEGRAM_PAYMENTS_CHAT_ID);
    assert.equal(result.supplier_payment.qr_photo_sent, true);
    assert.equal(result.supplier_payment.request_message_id, '101');
    assert.equal(result.supplier_payment.status, 'requested');
    assert.equal(result.supplier_payment.requested_amount, 1234.56);
    assert.equal(result.order.status, 'awaiting_payment');
    assert.equal(result.order.payment_status, 'unknown', 'Supplier invoice must not mark the client as paid');
    assert.equal(result.supplier_payments.length, 1);
    const stored = db.prepare('SELECT * FROM supplier_payments').get();
    assert.equal(stored.order_id, 'test'); assert.equal(stored.request_message_id, '101');
    const event = db.prepare("SELECT * FROM order_status_events WHERE order_id = 'test'").get();
    assert.equal(event.actor, accounts[index].name);
    assert.equal(event.status, 'awaiting_payment');
    assert.equal(db.prepare('SELECT count(*) AS n FROM notification_queue').get().n, 0, 'No client notification for an internal payment request');
  });
}

test('a Telegram failure retains the unpaid state and allows one successful retry', async t => {
  const { db, send } = setup(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: false, description: 'Synthetic Telegram outage' }, { status: 503 }));
  const payload = { supplier_name: 'BYD', requested_amount: 440, requested_currency: 'CNY' };
  const failed = await send(payload);
  assert.equal(failed.status, 500);
  assert.equal(db.prepare('SELECT count(*) AS n FROM supplier_payments').get().n, 0);
  assert.equal(db.prepare("SELECT status FROM orders WHERE id='test'").get().status, 'proposal_sent');
  assert.equal(fetch.mock.callCount(), 1);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, result: { message_id: 103 } }));
  const retried = await send(payload);
  assert.equal(retried.status, 200);
  assert.equal(db.prepare('SELECT count(*) AS n FROM supplier_payments').get().n, 1);
});

test('invalid amounts and unrecognized tokens cannot send a payment request', async t => {
  const { db, send } = setup(t);
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('Must not call Telegram'));
  for (const requested_amount of ['', 0, -1, 'invalid']) {
    const response = await send({ supplier_name: 'BYD', requested_amount });
    assert.equal(response.status, 400);
  }
  assert.equal((await send({ supplier_name: 'BYD', requested_amount: 440 }, { token: 'unknown' })).status, 401);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM supplier_payments').get().n, 0);
});

test('custom suppliers can send a payment request without another supplier QR', async t => {
  const { send } = setup(t);
  const fetch = t.mock.method(globalThis, 'fetch', async url => {
    assert.ok(url.endsWith('/sendMessage'));
    return Response.json({ ok: true, result: { message_id: 104 } });
  });
  const response = await send({ supplier_name: 'Synthetic New Supplier', requested_amount: 50, requested_currency: 'USD', notes: '' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.supplier_payment.supplier_name, 'Synthetic New Supplier');
  assert.equal(result.supplier_payment.qr_photo_sent, false);
  assert.equal(fetch.mock.callCount(), 1);
});
