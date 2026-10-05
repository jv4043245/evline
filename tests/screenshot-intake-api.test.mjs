import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet, onRequestPost } from '../functions/api/admin/screenshot-intake.js';
import { onRequest as adminMiddleware } from '../functions/api/admin/_middleware.js';
import { requestScreenshotAccess, createScreenshotDraft, addScreenshotSource, getScreenshotDraft } from '../functions/_lib/screenshot-intake-store.js';

const directory = new URL('../migrations/', import.meta.url);
const schemas = await Promise.all((await readdir(directory)).filter(file => file.endsWith('.sql')).sort().map(file => readFile(new URL(file, directory), 'utf8')));
const manager = '80001';
const transcript = 'Клієнт: BYD Yuan Plus 2023. Потрібна права передня дверка, 1 штука. Мій телефон +380000000001. Менеджер: Добре, перевіримо.';
const field = value => ({ value, evidence: [{ source_id: '1', quote: value }] });
const proposal = () => ({ response: { intent: 'parts', multiple_customers: false, multiple_vehicles: false, ambiguous: false, warnings: [],
  fields: { car: field('BYD Yuan Plus 2023'), customer_phone: field('+380000000001'), item_name: field('права передня дверка, 1 штука') } } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close()); db.exec('PRAGMA foreign_keys=ON');
  for (const schema of schemas) db.exec(schema);
  const env = { ADMIN_TOKEN: 'synthetic-admin-token', TELEGRAM_BOT_TOKEN: 'synthetic-bot-token', TELEGRAM_WEBHOOK_SECRET: 'synthetic-hook-secret',
    AI: { run: async () => proposal() }, DB: {
      prepare(sql) {
        const statement = db.prepare(sql); let values = [];
        const run = () => { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; };
        return { bind(...args) { values = args; return this; }, async run() { return run(); }, _run: run,
          async first() { return statement.get(...values) || null; }, async all() { return { results: statement.all(...values) }; } };
      },
      async batch(statements) {
        db.exec('BEGIN');
        try { const results = statements.map(statement => statement._run()); db.exec('COMMIT'); return results; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    },
  };
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected network call; every request in this suite must be mocked'));
  const call = async (method, payload, query = '', extraHeaders = {}) => {
    const request = new Request(`https://fixture.test/api/admin/screenshot-intake${query ? `?${query}` : ''}`, {
      method, headers: { authorization: `Bearer ${env.ADMIN_TOKEN}`, 'content-type': 'application/json', ...extraHeaders },
      ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
    });
    const response = await adminMiddleware({ request, env, next: () => (method === 'POST' ? onRequestPost : onRequestGet)({ request, env }) });
    return { response, body: await response.json() };
  };
  const get = (query = '', headers) => call('GET', null, query, headers);
  const post = (payload, headers) => call('POST', payload, '', headers);
  const approve = async (id = manager, username = 'evline_support') => {
    await requestScreenshotAccess(env, { id, username, first_name: 'Synthetic manager' });
    return post({ action: 'manager_status', telegram_id: id, status: 'approved' });
  };
  const sourced = async () => {
    assert.equal((await approve()).response.status, 200);
    const draft = await createScreenshotDraft(env, { manager_id: manager, chat_id: manager, channel: 'whatsapp' });
    return addScreenshotSource(env, draft.id, manager, { message_id: 1, kind: 'text', text: transcript });
  };
  const count = table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  const noCrm = () => { for (const table of ['orders', 'leads', 'customers', 'notification_queue', 'google_ads_conversion_events']) assert.equal(count(table), 0, table); };
  return { db, env, get, post, approve, sourced, count, noCrm };
}

test('both admin handlers enforce authentication before DB, body parsing, AI or network access', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network before admin authorization'));
  const env = { ADMIN_TOKEN: 'valid-token', AI: { run: () => assert.fail('No AI before admin authorization') } };
  Object.defineProperty(env, 'DB', { get() { assert.fail('No DB access before admin authorization'); } });
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: 'Bearer valid-token', 'x-admin-token': 'conflicting-token' }]) {
    for (const method of ['GET', 'POST']) {
      const request = new Request('https://fixture.test/api/admin/screenshot-intake?setup=1', { method, headers, ...(method === 'POST' ? { body: 'not valid JSON' } : {}) });
      const response = await (method === 'POST' ? onRequestPost : onRequestGet)({ request, env });
      assert.equal(response.status, 401);
    }
  }
});

test('approval uses stored exact numeric identity and owner-approved username, never a spoofed payload name', async t => {
  const { env, db, post, noCrm } = await fixture(t);
  await requestScreenshotAccess(env, { id: manager, username: 'evline_support', first_name: 'Synthetic support' });
  for (const [index, username] of ['evline_support_evil', 'xevline_support', 'unrelated'].entries()) {
    const id = String(81000 + index);
    await requestScreenshotAccess(env, { id, username });
    const denied = await post({ action: 'manager_status', telegram_id: id, username: 'evline_support', status: 'approved' });
    assert.equal(denied.response.status, 403);
    assert.equal(db.prepare('SELECT status FROM screenshot_intake_managers WHERE telegram_id=?').get(id).status, 'pending');
  }
  for (const id of ['@evline_support', `${manager} `, `0${manager}`]) {
    assert.equal((await post({ action: 'manager_status', telegram_id: id, status: 'approved' })).response.status, 400);
  }
  assert.equal((await post({ action: 'manager_status', telegram_id: '999999', status: 'approved' })).response.status, 404);
  const approved = await post({ action: 'manager_status', telegram_id: Number(manager), status: 'approved' });
  assert.equal(approved.response.status, 200);
  const row = db.prepare('SELECT * FROM screenshot_intake_managers WHERE telegram_id=?').get(manager);
  assert.equal(row.status, 'approved'); assert.equal(row.approved_by, 'Андрій');
  assert.equal((await post({ action: 'manager_status', telegram_id: manager, status: 'pending' })).response.status, 400);
  assert.equal((await post({ action: 'manager_status', telegram_id: manager, status: 'paused' })).response.status, 200);
  noCrm();
});

test('approval normalizes username case/@ and only explicit configuration extends the rollout allowlist', async t => {
  const { env, approve, post } = await fixture(t);
  assert.equal((await approve(manager, '@EVLINE_SUPPORT')).response.status, 200);
  await requestScreenshotAccess(env, { id: '80002', username: 'additional_manager' });
  assert.equal((await post({ action: 'manager_status', telegram_id: '80002', status: 'approved' })).response.status, 403);
  env.SCREENSHOT_INTAKE_ALLOWED_USERNAMES = 'evline_support, @additional_manager';
  assert.equal((await post({ action: 'manager_status', telegram_id: '80002', status: 'approved' })).response.status, 200);
});

test('setup GET only inspects Telegram configuration and returns the correct private-bot deep link', async t => {
  const { get, count, noCrm } = await fixture(t);
  const methods = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const method = url.split('/').at(-1); methods.push(method);
    assert.equal(options.redirect, 'manual');
    assert.deepEqual(JSON.parse(options.body), {});
    if (method === 'getMe') return Response.json({ ok: true, result: { username: 'SyntheticEVLineBot' } });
    if (method === 'getWebhookInfo') return Response.json({ ok: true, result: { url: 'https://evline.com.ua/api/telegram/webhook', allowed_updates: ['message', 'edited_message', 'callback_query', 'business_message'] } });
    assert.fail(`Setup must not change Telegram configuration: ${method}`);
  });
  const { response, body } = await get('setup=1');
  assert.equal(response.status, 200); assert.equal(body.webhook_matches, true);
  assert.equal(body.start_url, 'https://t.me/SyntheticEVLineBot?start=intake');
  assert.equal(body.manager_username_hint, 'evline_support'); assert.equal(body.ai_available, true);
  assert.deepEqual(methods.sort(), ['getMe', 'getWebhookInfo']);
  assert.equal(count('admin_audit_log'), 0); assert.equal(count('screenshot_intake_managers'), 0); noCrm();
  assert.ok(!JSON.stringify(body).includes('synthetic-bot-token'));
});

test('setup detects missing edited-message updates without mutating webhook or claiming readiness', async t => {
  const { get } = await fixture(t);
  t.mock.method(globalThis, 'fetch', async url => Response.json({ ok: true, result: url.endsWith('/getMe') ? { username: 'SyntheticEVLineBot' }
    : { url: 'https://evline.com.ua/api/telegram/webhook', allowed_updates: ['message', 'callback_query'] } }));
  assert.equal((await get('setup=1')).body.webhook_matches, false);
});

test('explicit webhook preparation preserves subscriptions and pending updates; unsafe existing hooks stay unchanged', async t => {
  const { env, post } = await fixture(t);
  const calls = [];
  let hook = { url: 'https://evline.com.ua/api/telegram/webhook', allowed_updates: ['business_message', 'deleted_business_messages'], max_connections: 17 };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const method = url.split('/').at(-1), body = JSON.parse(options.body); calls.push({ method, body });
    return Response.json({ ok: true, result: method === 'getWebhookInfo' ? hook : true });
  });
  assert.equal((await post({ action: 'prepare_webhook' })).response.status, 200);
  const prepared = calls.find(call => call.method === 'setWebhook').body;
  assert.deepEqual(prepared.allowed_updates, ['business_message', 'deleted_business_messages', 'message', 'edited_message', 'callback_query']);
  assert.equal(prepared.drop_pending_updates, false); assert.equal(prepared.max_connections, 17); assert.equal(prepared.secret_token, env.TELEGRAM_WEBHOOK_SECRET);
  for (const patch of [{ url: 'https://another.example/webhook' }, { has_custom_certificate: true }]) {
    hook = { url: 'https://evline.com.ua/api/telegram/webhook', ...patch }; calls.length = 0;
    assert.equal((await post({ action: 'prepare_webhook' })).response.status, 409);
    assert.deepEqual(calls.map(call => call.method), ['getWebhookInfo']);
  }
});

test('analyze holds a token lease, returns a new preview revision, and creates nothing until explicit confirmation', async t => {
  const { env, db, post, sourced, count, noCrm } = await fixture(t);
  const draft = await sourced();
  let calls = 0;
  env.AI.run = async (_model, input) => {
    calls += 1;
    const row = db.prepare('SELECT * FROM screenshot_intake_drafts WHERE id=?').get(draft.id);
    assert.ok(row.analysis_until > Date.now()); assert.ok(row.analysis_token);
    const inputData = JSON.parse(input.messages[1].content);
    assert.equal(inputData.sources[0].text, transcript); assert.equal(inputData.manager_id, undefined);
    noCrm(); return proposal();
  };
  const analyzed = await post({ action: 'analyze', id: draft.id, revision: draft.revision });
  assert.equal(analyzed.response.status, 200); assert.equal(calls, 1);
  assert.equal(analyzed.body.draft.status, 'ready'); assert.equal(analyzed.body.draft.revision, draft.revision + 1);
  assert.equal(analyzed.body.draft.analysis_until, 0); assert.equal(analyzed.body.draft.analysis_token, undefined);
  assert.equal(analyzed.body.draft.fields.customer_phone, '+380000000001'); assert.equal(analyzed.body.draft.blocking, false); noCrm();
  assert.equal((await post({ action: 'confirm', id: draft.id, revision: draft.revision, mode: 'create' })).response.status, 409); noCrm();
  const payload = { action: 'confirm', id: draft.id, revision: analyzed.body.draft.revision, mode: 'create' };
  const created = await post(payload);
  assert.equal(created.response.status, 200); assert.equal(created.body.applied, true); assert.equal(created.body.draft.status, 'applied');
  assert.equal(count('orders'), 1); assert.equal(count('leads'), 1); assert.equal(count('customers'), 1);
  assert.equal(count('notification_queue'), 0); assert.equal(count('google_ads_conversion_events'), 0);
  const again = await post(payload);
  assert.equal(again.response.status, 200); assert.equal(again.body.already_applied, true); assert.equal(again.body.order_id, created.body.order_id); assert.equal(count('orders'), 1);
});

test('concurrent analyze API requests run AI once and an intervening new source invalidates the old result', async t => {
  const { env, post, sourced, noCrm } = await fixture(t);
  const draft = await sourced(), begun = deferred(), finished = deferred();
  let calls = 0;
  env.AI.run = async () => { calls += 1; begun.resolve(); return finished.promise; };
  const first = post({ action: 'analyze', id: draft.id, revision: draft.revision });
  await begun.promise;
  assert.equal((await post({ action: 'analyze', id: draft.id, revision: draft.revision })).response.status, 409);
  assert.equal(calls, 1);
  const newer = await addScreenshotSource(env, draft.id, manager, { message_id: 2, kind: 'text', text: 'Уточнення: ліва дверка.' });
  finished.resolve(proposal());
  assert.equal((await first).response.status, 409);
  const current = await getScreenshotDraft(env, draft.id, manager);
  assert.equal(current.revision, newer.revision); assert.equal(current.status, 'collecting'); assert.deepEqual(current.fields, {}); assert.equal(current.analysis_until, 0); noCrm();
});

test('provider failure releases the lease, stays uncommitted and returns no token or provider-secret details', async t => {
  const { env, db, post, sourced, noCrm } = await fixture(t);
  const draft = await sourced();
  env.AI.run = async () => { throw new Error('Provider URL https://api.telegram.org/bot-real-secret/license=ACCEPT'); };
  const failure = await post({ action: 'analyze', id: draft.id, revision: draft.revision });
  assert.equal(failure.response.status, 503); assert.doesNotMatch(JSON.stringify(failure.body), /real-secret|license|https/);
  const row = db.prepare('SELECT * FROM screenshot_intake_drafts WHERE id=?').get(draft.id);
  assert.equal(row.analysis_until, 0); assert.equal(row.analysis_token, ''); assert.equal(row.status, 'collecting'); noCrm();
});

test('paused draft GET remains inspectable by an authenticated admin while all draft mutations are denied', async t => {
  const { env, get, post, sourced, noCrm } = await fixture(t);
  const draft = await sourced();
  assert.equal((await post({ action: 'manager_status', telegram_id: manager, status: 'paused' })).response.status, 200);
  const inspected = await get(`id=${draft.id}`);
  assert.equal(inspected.response.status, 200); assert.equal(inspected.body.draft.id, draft.id); assert.deepEqual(inspected.body.duplicates, []);
  assert.equal(inspected.body.draft.sources[0].text, transcript);
  env.AI.run = () => assert.fail('Paused draft cannot trigger AI');
  for (const action of ['analyze', 'save', 'confirm', 'cancel']) {
    const denied = await post({ action, id: draft.id, revision: draft.revision, mode: 'create', fields: { item_name: 'Other' } });
    assert.equal(denied.response.status, 403, action);
  }
  noCrm();
});

test('synthetic text test analyzes fixture-only data and never writes managers, drafts or CRM records', async t => {
  const { env, post, count, noCrm } = await fixture(t);
  let calls = 0;
  env.AI.run = async (_model, input) => { calls += 1; assert.equal(JSON.parse(input.messages[1].content).sources[0].text, transcript); return proposal(); };
  const result = await post({ action: 'test_analysis' });
  assert.equal(result.response.status, 200); assert.equal(result.body.ok, true);
  assert.deepEqual(result.body.checks, { phone: true, parts: true, car: true }); assert.equal(calls, 1);
  assert.equal(count('screenshot_intake_drafts'), 0); assert.equal(count('screenshot_intake_managers'), 0); assert.equal(count('admin_audit_log'), 0); noCrm();
});

test('synthetic vision test fetches only its fixed public fixture, mocks OCR, and never uses a real Telegram file', async t => {
  const { env, post, count, noCrm } = await fixture(t);
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]);
  const fetched = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    fetched.push(url); assert.equal(url, 'https://evline.com.ua/assets/images/admin/screenshot-intake-demo.png'); assert.equal(options.redirect, 'manual');
    return new Response(bytes, { headers: { 'content-length': String(bytes.length), 'content-type': 'image/png' } });
  });
  let calls = 0;
  env.AI.run = async (_model, input) => {
    calls += 1;
    if (input.image) { assert.deepEqual(input.image, [...bytes]); return { response: transcript }; }
    return proposal();
  };
  const result = await post({ action: 'test_analysis', vision: true });
  assert.equal(result.response.status, 200); assert.deepEqual(result.body.checks, { phone: true, parts: true, car: true });
  assert.equal(fetched.length, 1); assert.equal(calls, 2); assert.equal(count('screenshot_intake_drafts'), 0); noCrm();
});

test('exact order-number lookup returns only append-safe metadata; malformed ids and stale actions fail safely', async t => {
  const { db, get, post, sourced, noCrm } = await fixture(t);
  const draft = await sourced();
  for (const query of ['id=bad', 'order=O-000001%27%20OR%201%3D1', 'order=123']) assert.equal((await get(query)).response.status, 400);
  assert.equal((await get('order=O-000001')).response.status, 404);
  for (const payload of [{ action: 'save', id: draft.id, revision: '1', fields: {} }, { action: 'save', id: draft.id, revision: -1, fields: {} }, { action: 'unknown', id: draft.id, revision: draft.revision }]) assert.equal((await post(payload)).response.status, 400);
  assert.equal((await post({ action: 'cancel', id: draft.id, revision: draft.revision - 1 })).response.status, 409); noCrm();
  db.prepare(`INSERT INTO orders (id,order_number,created_at,updated_at,car,item_name,customer_phone,revenue_uah) VALUES (?,?,?,?,?,?,?,?)`)
    .run('existing-order', 'O-000123', '2026-01-01', '2026-01-02', 'Synthetic car', 'Synthetic part', '+380SECRET', 12345);
  const result = await get('order=o-000123');
  assert.equal(result.response.status, 200);
  assert.deepEqual(Object.keys(result.body.order).sort(), ['id', 'order_number', 'car', 'item_name', 'updated_at', 'status'].sort());
  assert.equal(result.body.order.id, 'existing-order'); assert.ok(!JSON.stringify(result.body).includes('SECRET')); assert.ok(!JSON.stringify(result.body).includes('12345'));
});
