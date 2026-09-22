import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { ensureTelegramIntake, receiveBusinessUpdate, processTelegramChat, telegramIntakeAction, lockTelegramOrder, validateTelegramProposal } from '../functions/_lib/telegram-intake.js';
import { onRequestPost as webhook } from '../functions/api/telegram/webhook.js';
import { onRequestPost as action, onRequestGet as overview } from '../functions/api/admin/telegram-intake.js';
import { onRequest as authorize } from '../functions/api/admin/_middleware.js';
import { onRequestDelete as deleteOrder } from '../functions/api/admin/orders/[id].js';

const directory = new URL('../migrations/', import.meta.url);
const schemas = await Promise.all((await readdir(directory)).filter(f => f.endsWith('.sql')).sort().map(f => readFile(new URL(f, directory), 'utf8')));
const owner = 10001, client = 20001, key = 'connection-test:20001';
const requestText = 'BYD Yuan Plus 2023. Нужна правая дверь. Телефон +380000000001';
const output = (fields = {}, more = {}) => ({ response: { intent: 'parts', ambiguous: false, new_request: false, fields, ...more } });
const field = (value, messageId = 1, quote = value) => ({ value, evidence: [{ message_id: messageId, quote }] });
const initial = () => output({ car: field('BYD Yuan Plus 2023'), item_name: field('правая дверь'), customer_phone: field('+380000000001') });
const message = (id = 1, body = requestText, extra = {}) => ({ update_id: 100 + id, business_message: {
  business_connection_id: 'connection-test', message_id: id, date: 1800000000 + id,
  from: { id: client, first_name: 'Synthetic' }, chat: { id: client, type: 'private', first_name: 'Synthetic', username: 'synthetic_customer' }, text: body, ...extra,
} });
async function setup(t, connected = true) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close()); db.exec('PRAGMA foreign_keys = ON');
  for (const schema of schemas) db.exec(schema);
  const env = { DB: { prepare(sql) { const statement = db.prepare(sql); let args = []; return {
    bind(...values) { args = values; return this; },
    async run() { const r = statement.run(...args); return { meta: { changes: Number(r.changes) } }; },
    async first() { return statement.get(...args) || null; },
    async all() { return { results: statement.all(...args) }; },
  }; }, async batch(statements) {
    db.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } }, AI: { run: async () => initial() }, TELEGRAM_BOT_TOKEN: 'synthetic-bot', TELEGRAM_WEBHOOK_SECRET: 'synthetic-secret', ADMIN_TOKEN: 'synthetic-admin' };
  await ensureTelegramIntake(env);
  await receiveBusinessUpdate(env, { update_id: 1, business_connection: { id: 'connection-test', user: { id: owner, username: 'synthetic_manager' }, is_enabled: true, date: 1800000000 } });
  if (connected) await telegramIntakeAction(env, { action: 'approve_connection', id: 'connection-test', owner_id: owner }, 'Synthetic admin');
  const order = () => db.prepare('SELECT * FROM orders LIMIT 1').get();
  const chat = () => db.prepare('SELECT * FROM telegram_intake_chats WHERE id=?').get(key);
  return { env, db, order, chat };
}

test('unapproved business account cannot collect messages or invoke AI', async t => {
  const { env, db } = await setup(t, false);
  env.AI.run = () => assert.fail('No AI before activation');
  assert.equal((await receiveBusinessUpdate(env, message())).skipped, 'connection_not_approved');
  assert.equal(db.prepare('SELECT count(*) n FROM telegram_intake_messages').get().n, 0);
  await assert.rejects(telegramIntakeAction(env, { action: 'approve_connection', id: 'connection-test', owner_id: 42 }, 'Test'), /ID/);
});

test('one customer request creates one draft, with traceable evidence and no finance or customer notification', async t => {
  const { env, db, order, chat } = await setup(t);
  await receiveBusinessUpdate(env, message());
  const row = order();
  assert.equal(row.item_name, 'правая дверь'); assert.equal(row.customer_phone, '+380000000001');
  assert.equal(row.status, 'new'); assert.equal(row.revenue_uah, 0); assert.equal(row.payment_status, 'unknown');
  assert.equal(row.source, 'telegram'); assert.equal(row.medium, 'business_chat');
  assert.equal(row.telegram_chat_id, null, 'Business identity must not subscribe the customer to the regular bot');
  assert.equal(chat().order_id, row.id); assert.equal(chat().state, 'applied');
  assert.equal(db.prepare('SELECT count(*) n FROM leads').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM customers').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM notification_queue').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM google_ads_conversion_events').get().n, 0);
  assert.match(db.prepare('SELECT evidence_json FROM telegram_intake_changes').get().evidence_json, /message_id/);
  env.AI.run = () => assert.fail('Duplicate is already processed');
  await receiveBusinessUpdate(env, message());
  assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n, 1);
});

test('greetings do not create empty orders; manager suggestions are not customer evidence', async t => {
  const { env, db } = await setup(t);
  env.AI.run = async () => output({}, { intent: 'none' });
  await receiveBusinessUpdate(env, message(1, 'Добрий день'));
  env.AI.run = async ({}, input) => {
    assert.equal(JSON.parse(input.messages[1].content).messages.at(-1).role, 'manager');
    return output({ item_name: field('правая дверь', 2) });
  };
  await receiveBusinessUpdate(env, message(2, 'Вам нужна правая дверь?', { from: { id: owner } }));
  assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n, 0);
});

test('explicit customer correction updates same draft and can be undone', async t => {
  const { env, db, order, chat } = await setup(t);
  await receiveBusinessUpdate(env, message());
  const id = order().id;
  env.AI.run = async () => output({ item_name: { value: 'левая дверь', evidence: [{ message_id: 1, quote: 'дверь' }, { message_id: 2, quote: 'Ошибся, левая' }] } });
  await receiveBusinessUpdate(env, message(2, 'Ошибся, левая'));
  assert.equal(order().id, id); assert.equal(order().item_name, 'левая дверь');
  assert.equal(db.prepare('SELECT count(*) n FROM telegram_intake_changes').get().n, 2);
  await telegramIntakeAction(env, { action: 'undo', id: key }, 'Synthetic admin');
  assert.equal(order().item_name, 'правая дверь'); assert.equal(chat().mode, 'review');
});

test('ambiguous replacement, new enquiry, and unproven fields require review', async t => {
  const { env, order, chat } = await setup(t);
  await receiveBusinessUpdate(env, message());
  env.AI.run = async () => output({ item_name: field('ручка двери', 2) });
  await receiveBusinessUpdate(env, message(2, 'А ручка двери есть?'));
  assert.equal(order().item_name, 'правая дверь'); assert.equal(chat().state, 'review');
  env.AI.run = async () => output({ item_name: field('фара', 3) }, { new_request: true });
  await receiveBusinessUpdate(env, message(3, 'Еще другое авто, фара'));
  assert.equal(order().item_name, 'правая дверь'); assert.equal(chat().state, 'review');
  const bad = validateTelegramProposal(output({ vin: field('LTEST1234567890123', 1, requestText), item_name: field('капот', 1, requestText) }).response,
    [{ message_id: 1, role: 'customer', body: requestText }]);
  assert.deepEqual(bad.fields, {}); assert.equal(bad.review, true);
});

test('manual editing locks future changes even if the order is still new', async t => {
  const { env, db, order, chat } = await setup(t);
  await receiveBusinessUpdate(env, message());
  await lockTelegramOrder(env, order().id);
  db.prepare("UPDATE orders SET item_name='Manager-approved part' WHERE id=?").run(order().id);
  env.AI.run = async () => output({ item_name: field('левая дверь', 2) });
  await receiveBusinessUpdate(env, message(2, 'Ошибся, левая дверь'));
  assert.equal(order().item_name, 'Manager-approved part'); assert.equal(chat().state, 'review');
});

test('paid orders and supplier commitments cannot be edited by AI or intake approval', async t => {
  const { env, db, order } = await setup(t);
  await receiveBusinessUpdate(env, message());
  db.prepare("UPDATE orders SET status='paid', payment_status='paid' WHERE id=?").run(order().id);
  env.AI.run = async () => output({ item_name: field('левая дверь', 2) });
  await receiveBusinessUpdate(env, message(2, 'Ошибся, левая дверь'));
  assert.equal(order().item_name, 'правая дверь');
  await assert.rejects(telegramIntakeAction(env, { action: 'undo', id: key }, 'Manager'), /оплата/);
  await assert.rejects(telegramIntakeAction(env, { action: 'apply', id: key, generation: 2, fields: { item_name: 'левая дверь' } }, 'Manager'), /опрацьовується/);
});

test('AI failure is durable and the same webhook retries without duplicate orders', async t => {
  const { env, db, chat } = await setup(t);
  env.AI.run = async () => { throw new Error('Synthetic failure'); };
  await assert.rejects(receiveBusinessUpdate(env, message()), /Повідомлення збережено/);
  assert.equal(chat().state, 'error');
  assert.equal(db.prepare('SELECT count(*) n FROM telegram_intake_messages').get().n, 1);
  env.AI.run = async () => initial();
  await receiveBusinessUpdate(env, message());
  assert.equal(chat().state, 'applied');
  assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n, 1);
});

test('older asynchronous analysis cannot overwrite a newer message', async t => {
  const { env, db, order } = await setup(t);
  let resolveFirst, started;
  const signal = new Promise(r => { started = r; });
  env.AI.run = async () => { started(); return new Promise(r => { resolveFirst = r; }); };
  const first = receiveBusinessUpdate(env, message()); await signal;
  env.AI.run = async () => output({ item_name: field('левая дверь', 2) });
  await receiveBusinessUpdate(env, message(2, 'Ошибся, левая дверь'));
  resolveFirst(initial()); await first;
  assert.equal(order().item_name, 'левая дверь');
  assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n, 1);
});

test('message edits are ordered and deletions pause automatic changes', async t => {
  const { env, db, order, chat } = await setup(t);
  await receiveBusinessUpdate(env, message());
  const edited = message(); edited.update_id = 110; edited.edited_business_message = { ...edited.business_message, edit_date: 1800000200, text: 'Ошибся, левая дверь' }; delete edited.business_message;
  env.AI.run = async () => output({ item_name: field('левая дверь') });
  await receiveBusinessUpdate(env, edited);
  assert.equal(order().item_name, 'левая дверь');
  env.AI.run = () => assert.fail('Older update must not rerun');
  await receiveBusinessUpdate(env, message());
  assert.equal(order().item_name, 'левая дверь');
  await receiveBusinessUpdate(env, { update_id: 120, deleted_business_messages: { business_connection_id: 'connection-test', chat: { id: client, type: 'private' }, message_ids: [1] } });
  assert.equal(chat().mode, 'review');
  assert.equal(db.prepare('SELECT body FROM telegram_intake_messages').get().body, '');
});

test('pausing connection or chat prevents any further message storage', async t => {
  const { env, db } = await setup(t);
  await receiveBusinessUpdate(env, message());
  await telegramIntakeAction(env, { action: 'pause', id: key }, 'Manager');
  await receiveBusinessUpdate(env, message(2, 'This must not be stored'));
  assert.equal(db.prepare('SELECT count(*) n FROM telegram_intake_messages').get().n, 1);
  await telegramIntakeAction(env, { action: 'pause_connection', id: 'connection-test' }, 'Manager');
  assert.equal((await receiveBusinessUpdate(env, message(3))).skipped, 'connection_not_approved');
});

test('business events verify the webhook secret and never reply through ordinary bot routes', async t => {
  const { env } = await setup(t);
  t.mock.method(globalThis, 'fetch', () => assert.fail('Passive assistant must not send Telegram messages'));
  const make = secret => new Request('https://example.test/api/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(message()) });
  assert.equal((await webhook({ request: make('wrong'), env })).status, 401);
  assert.equal((await webhook({ request: make(env.TELEGRAM_WEBHOOK_SECRET), env })).status, 200);
});

test('admin endpoint is authenticated and webhook preparation preserves existing subscriptions', async t => {
  const { env } = await setup(t);
  const unauthorized = new Request('https://example.test/api/admin/telegram-intake');
  assert.equal((await authorize({ request: unauthorized, env, next: () => overview({ request: unauthorized, env }) })).status, 401);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json({ ok: true, result: url.endsWith('getWebhookInfo') ? {
      url: 'https://evline.com.ua/api/telegram/webhook', allowed_updates: ['message', 'callback_query'], max_connections: 25,
    } : true });
  });
  const request = new Request('https://example.test/api/admin/telegram-intake', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.ADMIN_TOKEN}` }, body: JSON.stringify({ action: 'prepare_webhook' }) });
  assert.equal((await authorize({ request, env, next: () => action({ request, env }) })).status, 200);
  const body = calls.at(-1).body;
  assert.equal(body.max_connections, 25); assert.equal(body.drop_pending_updates, false);
  for (const kind of ['message', 'callback_query', 'business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages']) assert.ok(body.allowed_updates.includes(kind));
});

test('deleting a synthetic order works with foreign keys and does not resurrect it', async t => {
  const { env, db, order, chat } = await setup(t);
  await receiveBusinessUpdate(env, message());
  const id = order().id;
  const request = new Request(`https://example.test/api/admin/orders/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${env.ADMIN_TOKEN}` } });
  const response = await deleteOrder({ request, env, params: { id } });
  assert.equal(response.status, 200);
  assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n, 0);
  await receiveBusinessUpdate(env, message(2, 'Еще уточнение'));
  assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n, 0);
  assert.equal(chat().state, 'review'); assert.equal(chat().order_id, id);
});

test('supplier request protects draft even if its status was not advanced', async t => {
  const { env, db, order, chat } = await setup(t);
  await receiveBusinessUpdate(env, message());
  db.prepare(`INSERT INTO supplier_requests (id, order_id, supplier_id, supplier_name, access_token, created_at, updated_at)
    VALUES ('supplier-test', ?, 'test-supplier', 'Synthetic', 'test-access-token', '2026-09-22', '2026-09-22')`).run(order().id);
  env.AI.run = async () => output({ item_name: field('левая дверь', 2) });
  await receiveBusinessUpdate(env, message(2, 'Ошибся, левая дверь'));
  assert.equal(order().item_name, 'правая дверь'); assert.equal(chat().state, 'review');
});

test('manual changes arriving during AI analysis win over the delayed proposal', async t => {
  const { env, db, order, chat } = await setup(t);
  await receiveBusinessUpdate(env, message());
  let finish, started;
  const signal = new Promise(r => { started = r; });
  env.AI.run = async () => { started(); return new Promise(r => { finish = r; }); };
  const pending = receiveBusinessUpdate(env, message(2, 'Ошибся, левая дверь')); await signal;
  await lockTelegramOrder(env, order().id);
  db.prepare("UPDATE orders SET item_name='Manual confirmed item' WHERE id=?").run(order().id);
  finish(output({ item_name: field('левая дверь', 2) })); await pending;
  assert.equal(order().item_name, 'Manual confirmed item'); assert.equal(chat().mode, 'review');
});

test('new request starts after the explicit boundary and retains the previous order', async t => {
  const { env, db } = await setup(t);
  await receiveBusinessUpdate(env, message());
  await telegramIntakeAction(env, { action: 'new_request', id: key }, 'Manager');
  env.AI.run = async (_, input) => {
    const messages = JSON.parse(input.messages[1].content).messages;
    assert.deepEqual(messages.map(m => m.message_id), [2]);
    return output({ item_name: field('передняя фара', 2) });
  };
  await receiveBusinessUpdate(env, message(2, 'Нужна передняя фара'));
  assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n, 2);
});

test('forwarded content and media-only requests cannot silently create an order', async t => {
  const { env, db, chat } = await setup(t);
  await receiveBusinessUpdate(env, message(1, requestText, { forward_origin: { type: 'hidden_user' } }));
  assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n, 0);
  assert.equal(chat().state, 'review');
  env.AI.run = async () => output({});
  await receiveBusinessUpdate(env, message(2, '', { photo: [{ file_id: 'synthetic-photo' }] }));
  assert.equal(chat().state, 'review');
});

test('connection revocation during inference prevents the queued write', async t => {
  const { env, db } = await setup(t);
  env.AI.run = async () => {
    await telegramIntakeAction(env, { action: 'pause_connection', id: 'connection-test' }, 'Manager');
    return initial();
  };
  await receiveBusinessUpdate(env, message());
  assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n, 0);
});
