import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { handleScreenshotIntakeUpdate, screenshotCallback, screenshotPreview } from '../functions/_lib/screenshot-intake-bot.js';
import { onRequestPost as webhook } from '../functions/api/telegram/webhook.js';
import { setScreenshotManager, activeScreenshotDraft, getScreenshotDraft } from '../functions/_lib/screenshot-intake-store.js';

const MANAGER = 11001;
const ID = '10000000-0000-4000-8000-000000000001';
const OTHER_ID = '20000000-0000-4000-8000-000000000002';
const fields = { customer_name: 'Тестовий клієнт', customer_phone: '+380000000001', car: 'BYD Yuan Plus', item_name: 'права передня фара' };
const clone = value => structuredClone(value);
const message = (text = '', extra = {}) => ({ update_id: 1, message: {
  message_id: 10, from: { id: MANAGER, username: 'synthetic_manager' }, chat: { id: MANAGER, type: 'private' }, text, ...extra,
} });
const click = (action, draft, extra = {}) => ({ callback_query: {
  id: 'synthetic-callback', from: { id: MANAGER }, data: screenshotCallback(action, draft),
  message: { message_id: 700, from: { id: 99000, is_bot: true }, chat: { id: MANAGER, type: 'private' } }, ...extra,
} });
const fixture = more => ({
  id: ID, manager_id: String(MANAGER), chat_id: String(MANAGER), channel: 'viber', status: 'collecting', revision: 0,
  fields: {}, warnings: [], evidence: {}, sources: [], blocking: false, ...more,
});

function setup(t, options = {}) {
  const state = { manager: options.approved === false ? null : { status: 'approved', telegram_id: String(MANAGER) }, draft: options.draft || null,
    sent: [], sources: [], created: [], requested: [], canceled: [], confirmed: [], analyses: 0, claims: 0, releases: [], lease: '', duplicates: [], ...options.state };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(url.startsWith('https://api.telegram.org/botsynthetic-bot/'));
    const body = JSON.parse(options.body);
    state.sent.push({ method: url.split('/').at(-1), ...body });
    assert.equal(options.signal instanceof AbortSignal, true);
    return Response.json({ ok: true, result: { message_id: state.sent.length } });
  });
  const approved = () => { if (state.manager?.status !== 'approved') throw Object.assign(new Error('denied'), { code: 'manager_not_approved' }); };
  const own = (id, managerId) => {
    approved();
    if (!state.draft || id !== state.draft.id || String(managerId) !== state.draft.manager_id) throw new Error('private_other_customer_data');
    return state.draft;
  };
  const deps = {
    async screenshotManager() { return clone(state.manager); },
    async requestScreenshotAccess(env, from) { state.requested.push(clone(from)); return { status: 'pending' }; },
    async activeScreenshotDraft() { approved(); return state.draft && ['collecting', 'ready'].includes(state.draft.status) ? clone(state.draft) : null; },
    async createScreenshotDraft(env, input) { approved(); state.created.push(clone(input)); state.draft = fixture(input); return clone(state.draft); },
    async getScreenshotDraft(env, id, managerId) { return clone(own(id, managerId)); },
    async cancelScreenshotDraft(env, id, managerId) { const draft = own(id, managerId); state.canceled.push(id); draft.status = 'canceled'; draft.revision++; return clone(draft); },
    async addScreenshotSource(env, id, managerId, source) {
      const draft = own(id, managerId);
      if (!draft.sources.some(row => row.message_id === source.message_id || (source.file_unique_id && row.file_unique_id === source.file_unique_id))) {
        draft.sources.push(clone(source)); state.sources.push(clone(source)); draft.revision++; draft.status = 'collecting'; draft.fields = {};
      }
      return clone(draft);
    },
    async claimScreenshotAnalysis(env, id, managerId, revision) {
      own(id, managerId); state.claims++;
      if (state.lease) throw Object.assign(new Error('Busy private details'), { code: 'analysis_busy' });
      state.lease = `lease-${revision}`;
      return { ...clone(state.draft), analysis_token: state.lease };
    },
    async releaseScreenshotAnalysis(env, id, managerId, revision, token) { state.releases.push(token); if (token === state.lease) state.lease = ''; },
    async analyzeScreenshotDraft() { state.analyses++; return { fields: clone(fields), warnings: [], evidence: {}, blocking: false }; },
    async saveScreenshotAnalysis(env, id, managerId, revision, analysis) {
      const draft = own(id, managerId);
      if (draft.revision !== revision) throw new Error('stale_revision');
      assert.equal(analysis.analysis_token, state.lease);
      Object.assign(draft, clone(analysis), { status: 'ready' }); delete draft.analysis_token;
      return clone(draft);
    },
    async findScreenshotDuplicates() { approved(); return clone(state.duplicates); },
    async confirmScreenshotDraft(env, id, managerId, revision, input, actor) {
      const draft = own(id, managerId);
      assert.equal(draft.revision, revision);
      assert.equal(draft.blocking, false);
      state.confirmed.push({ input, actor, id, revision });
      Object.assign(draft, { status: 'applied', order_id: OTHER_ID, order_number: 'O-DEMO-1' });
      return { applied: true, already_applied: false, draft_id: id, order_id: OTHER_ID, order_number: 'O-DEMO-1', mode: 'create' };
    },
  };
  const env = { TELEGRAM_BOT_TOKEN: 'synthetic-bot' };
  return { state, deps, env, run: update => handleScreenshotIntakeUpdate(env, update, deps), texts: () => state.sent.filter(row => row.method === 'sendMessage').map(row => row.text).join('\n'), buttons: () => state.sent.flatMap(row => row.reply_markup?.inline_keyboard?.flat() || []) };
}

test('unknown /intake registers only manager identity and never collects customer content', async t => {
  const { run, state, texts } = setup(t, { approved: false });
  const result = await run(message('/intake', { caption: 'PRIVATE CUSTOMER', photo: [{ file_id: 'secret_file' }] }));
  assert.equal(result.skipped, 'manager_not_approved');
  assert.equal(state.requested.length, 1);
  assert.deepEqual(Object.keys(state.requested[0]), ['id', 'username', 'first_name', 'last_name']);
  assert.equal(state.sources.length, 0); assert.equal(state.analyses, 0); assert.equal(state.created.length, 0);
  assert.match(texts(), /11001/); assert.doesNotMatch(texts(), /PRIVATE CUSTOMER|secret_file/);
});

test('ordinary unknown media, Business updates and unrelated callbacks fall through untouched', async t => {
  const { run, state } = setup(t, { approved: false });
  for (const update of [message('', { photo: [{ file_id: 'photo' }] }), { business_message: {} }, { callback_query: { data: 'other:action' } }]) {
    assert.deepEqual(await run(update), { handled: false });
  }
  assert.equal(state.requested.length, 0); assert.equal(state.sent.length, 0); assert.equal(state.sources.length, 0);
});

test('exact intake deep link starts onboarding but ordinary /start order remains outside inactive intake', async t => {
  const { run, state } = setup(t, { approved: false });
  assert.equal((await run(message('/start intake'))).handled, true);
  assert.equal(state.requested.length, 1);
  assert.deepEqual(await run(message(`/start order_${OTHER_ID}`)), { handled: false });
  assert.deepEqual(await run(message('/start intake-other')), { handled: false });
});

test('commands in groups or with mismatched sender/chat cannot request access or disclose data', async t => {
  const { run, state } = setup(t);
  for (const extra of [{ chat: { id: -2000, type: 'group' } }, { chat: { id: 12000, type: 'private' } }, { from: { id: MANAGER, is_bot: true } }]) {
    const result = await run(message('/intake', extra)); assert.equal(result.handled, true);
  }
  assert.equal(state.requested.length, 0); assert.equal(state.sent.length, 0); assert.equal(state.created.length, 0);
});

test('explicit channel choice creates a single draft; uploads do not run AI or create CRM records', async t => {
  const { run, state, texts } = setup(t);
  await run(message('/intake'));
  assert.equal(state.created.length, 0); assert.match(texts(), /канал/);
  await run(message('/intake whatsapp'));
  assert.deepEqual(state.created, [{ manager_id: String(MANAGER), chat_id: String(MANAGER), channel: 'whatsapp' }]);
  await run(message('BYD права фара +380000000001', { message_id: 11 }));
  await run(message('', { message_id: 12, caption: 'Деталі клієнта', photo: [{ file_id: 'small', file_unique_id: 'small-u' }, { file_id: 'large', file_unique_id: 'large-u', file_size: 1024 }] }));
  assert.equal(state.sources.length, 2); assert.equal(state.sources[1].file_id, 'large');
  assert.equal(state.sources[1].text, 'Деталі клієнта');
  assert.equal(state.analyses, 0); assert.equal(state.confirmed.length, 0);
  await run(message('/intake viber'));
  assert.equal(state.created.length, 1); assert.equal(state.draft.channel, 'whatsapp');
});

test('analyze requires a button and lease, produces review only, and repeated callback reuses ready result', async t => {
  const { run, state, buttons } = setup(t, { draft: fixture({ revision: 1, sources: [{ message_id: 1, kind: 'text', text: 'фара' }] }) });
  const action = click('analyze', state.draft);
  await run(action);
  assert.equal(state.analyses, 1); assert.equal(state.claims, 1); assert.deepEqual(state.releases, ['lease-1']);
  assert.equal(state.draft.status, 'ready'); assert.equal(state.confirmed.length, 0);
  assert.ok(buttons().some(row => row.text === 'Створити заявку'));
  await run(action);
  assert.equal(state.analyses, 1);
});

test('complete current preview creates exactly once and never chooses an existing order automatically', async t => {
  const { run, state } = setup(t, { draft: fixture({ status: 'ready', fields, revision: 2 }) });
  const action = click('create', state.draft);
  await run(action); await run(action);
  assert.equal(state.confirmed.length, 1); assert.deepEqual(state.confirmed[0].input, { mode: 'create' });
  assert.equal(state.confirmed[0].actor, 'Telegram manager 11001');
  assert.equal(state.draft.status, 'applied');
});

test('missing client phone or blocking ambiguity hides and rejects create even if callback forged', async t => {
  for (const partial of [{ fields: { item_name: 'фара' } }, { fields, blocking: true }]) {
    const { run, state } = setup(t, { draft: fixture({ status: 'ready', revision: 1, ...partial }) });
    const preview = screenshotPreview(state.draft);
    assert.ok(!preview.reply_markup.inline_keyboard.flat().some(row => row.callback_data?.includes(':create:')));
    await run(click('create', state.draft));
    assert.equal(state.confirmed.length, 0);
  }
});

test('duplicates require a separate explicit confirmation and existing-order button is only an admin URL', async t => {
  const { run, state, buttons } = setup(t, { draft: fixture({ status: 'ready', fields, revision: 3 }), state: { duplicates: [{ id: OTHER_ID, order_number: 'O-OTHER' }] } });
  await run(click('create', state.draft));
  assert.equal(state.confirmed.length, 0);
  assert.ok(buttons().some(row => row.text === 'Створити окрему заявку'));
  const existing = buttons().find(row => row.text === 'Вибрати наявну заявку');
  assert.equal(existing.url, `https://evline.com.ua/admin/screenshot-intake/?draft=${ID}`);
  assert.equal(existing.callback_data, undefined);
  await run(click('separate', state.draft));
  assert.deepEqual(state.confirmed[0].input, { mode: 'create', allow_duplicate: true });
});

test('foreign drafts, paused managers and stale revisions cannot analyze, confirm or reveal their fields', async t => {
  const { run, state, texts } = setup(t, { draft: fixture({ status: 'ready', fields, revision: 4 }) });
  await run(click('create', { ...state.draft, id: OTHER_ID }));
  assert.doesNotMatch(texts(), /private_other_customer_data|Тестовий клієнт/);
  await run(click('create', { ...state.draft, revision: 3 }));
  assert.equal(state.confirmed.length, 0); assert.equal(state.analyses, 0);
  state.sent = []; state.manager.status = 'paused';
  await run(click('create', state.draft));
  assert.doesNotMatch(texts(), /Тестовий клієнт|BYD Yuan/);
  assert.equal(state.confirmed.length, 0);
});

test('an edited source cancels only the unconfirmed draft and requires fresh upload', async t => {
  const { run, state, texts } = setup(t, { draft: fixture({ status: 'ready', fields, revision: 1, sources: [{ message_id: 10, kind: 'text', text: 'старий текст' }] }) });
  const incoming = message('виправлено');
  await run({ edited_message: incoming.message });
  assert.equal(state.draft.status, 'canceled'); assert.equal(state.confirmed.length, 0); assert.equal(state.sources.length, 0);
  assert.match(texts(), /Замовлення CRM не змінювалися/);
});

test('unrelated edited messages are not silently appended as new evidence', async t => {
  const { run, state } = setup(t, { draft: fixture({ sources: [{ message_id: 1, kind: 'text', text: 'фара' }] }) });
  await run({ edited_message: message('інше', { message_id: 50 }).message });
  assert.equal(state.canceled.length, 0); assert.equal(state.sources.length, 0);
});

test('six-source cap, unsupported media, image size and text limits reject without persistence', async t => {
  const { run, state } = setup(t, { draft: fixture() });
  for (const extra of [
    { document: { mime_type: 'application/pdf', file_id: 'doc', file_unique_id: 'doc-u' } },
    { document: { mime_type: 'image/webp', file_id: 'doc', file_unique_id: 'doc-u' } },
    { photo: [{ file_id: 'photo', file_unique_id: 'photo-u', file_size: 8 * 1024 * 1024 + 1 }] },
    { voice: { file_id: 'voice' } },
  ]) await run(message('', extra));
  await run(message('x'.repeat(4001)));
  assert.equal(state.sources.length, 0);
  state.draft.sources = Array.from({ length: 6 }, (_, i) => ({ message_id: i + 1, kind: 'text', text: 'фара' }));
  await run(message('ще один', { message_id: 20 }));
  assert.equal(state.sources.length, 0);
});

test('late analysis after additional album input cannot save stale result and releases only its lease', async t => {
  const { run, state, deps } = setup(t, { draft: fixture({ revision: 1, sources: [{ message_id: 1, kind: 'text', text: 'фара' }] }) });
  deps.analyzeScreenshotDraft = async () => { state.analyses++; state.draft.revision++; return { fields, warnings: [], evidence: {} }; };
  await run(click('analyze', state.draft));
  assert.equal(state.draft.status, 'collecting'); assert.equal(state.confirmed.length, 0);
  assert.deepEqual(state.releases, ['lease-1']); assert.equal(state.lease, '');
});

test('held analysis lease prevents duplicate model invocation and is not released by failing claimant', async t => {
  const { run, state } = setup(t, { draft: fixture({ revision: 1, sources: [{ message_id: 1, kind: 'text', text: 'фара' }] }), state: { lease: 'different-claim' } });
  await run(click('analyze', state.draft));
  assert.equal(state.analyses, 0); assert.equal(state.lease, 'different-claim'); assert.deepEqual(state.releases, []);
});

test('model errors and credential URLs are never sent to Telegram or returned from handler', async t => {
  const { run, state, deps, texts } = setup(t, { draft: fixture({ revision: 1, sources: [{ message_id: 1, kind: 'text', text: 'фара' }] }) });
  deps.analyzeScreenshotDraft = async () => { throw new Error('https://api.telegram.org/botPRIVATE_SECRET/getFile?token=PRIVATE_SECRET'); };
  const result = await run(click('analyze', state.draft));
  assert.doesNotMatch(JSON.stringify(result) + texts(), /PRIVATE_SECRET|api\.telegram/);
  assert.equal(state.confirmed.length, 0); assert.deepEqual(state.releases, ['lease-1']);
});

test('preview uses plain text without markup parsing and preserves long fields across bounded messages', async t => {
  const largeFields = { ...fields, customer_name: '<a href="https://evil.invalid">Name</a>', item_name: 'A'.repeat(1900), request_text: 'B'.repeat(3900) + 'END-OF-DETAILS' };
  const { run, state, texts } = setup(t, { draft: fixture({ status: 'ready', fields: largeFields, revision: 1 }) });
  await run(click('status', state.draft));
  const sent = state.sent.filter(row => row.method === 'sendMessage');
  assert.ok(sent.length >= 2); assert.ok(sent.every(row => !row.parse_mode && [...row.text].length <= 3900));
  assert.match(texts(), /END-OF-DETAILS/);
  assert.equal(sent[0].reply_markup, undefined); assert.ok(sent.at(-1).reply_markup);
  assert.ok(sent.every(row => row.chat_id === String(MANAGER) && row.disable_web_page_preview));
});

test('active intake intercepts unsafe ordinary commands and /stop only cancels its draft', async t => {
  const { run, state, texts } = setup(t, { draft: fixture() });
  assert.equal((await run(message(`/start order_${OTHER_ID}`))).handled, true);
  assert.equal(state.sources.length, 0); assert.equal(state.confirmed.length, 0);
  await run(message('/stop'));
  assert.deepEqual(state.canceled, [ID]); assert.match(texts(), /Замовлення CRM не змінювалися/);
});

test('all generated callbacks are <=64 bytes and reject malformed identifiers or unsafe revisions', () => {
  for (const action of ['analyze', 'create', 'separate', 'cancel', 'status']) {
    assert.ok(Buffer.byteLength(screenshotCallback(action, fixture({ revision: 999999999 }))) <= 64);
  }
  for (const draft of [fixture({ id: 'not-uuid' }), fixture({ revision: -1 }), fixture({ revision: 1e12 })]) {
    assert.throws(() => screenshotCallback('create', draft));
  }
});

test('real webhook/store integration stays review-only until explicit confirm and leaves finances/notifications untouched', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) db.exec(await readFile(new URL(name, migrations), 'utf8'));
  let aiCalls = 0;
  const sent = [];
  const env = {
    TELEGRAM_BOT_TOKEN: 'synthetic-bot', TELEGRAM_WEBHOOK_SECRET: 'synthetic-secret',
    DB: {
      prepare(sql) {
        const statement = db.prepare(sql); let values = [];
        return {
          bind(...args) { values = args; return this; },
          async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
          async first() { return statement.get(...values) || null; },
          async all() { return { results: statement.all(...values) }; },
        };
      },
      async batch(statements) {
        db.exec('BEGIN');
        try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('COMMIT'); return results; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    },
    AI: { async run(model, input) {
      aiCalls++;
      const source = JSON.parse(input.messages[1].content).sources[0];
      return { response: { intent: 'parts', ambiguous: false, multiple_customers: false, multiple_vehicles: false,
        fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value, evidence: [{ source_id: source.id, quote: value }] }])) } };
    } },
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(url.startsWith('https://api.telegram.org/botsynthetic-bot/'));
    assert.ok(['/sendMessage', '/answerCallbackQuery'].some(method => url.endsWith(method)));
    const body = JSON.parse(options.body); sent.push(body);
    if (body.chat_id) assert.equal(body.chat_id, String(MANAGER));
    return Response.json({ ok: true, result: { message_id: sent.length } });
  });
  const dispatch = async update => {
    const response = await webhook({ env, request: new Request('https://example.test/api/telegram/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'synthetic-secret' }, body: JSON.stringify(update),
    }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  await dispatch(message('/start intake'));
  assert.equal(db.prepare('SELECT status FROM screenshot_intake_managers').get().status, 'pending');
  assert.equal(db.prepare('SELECT count(*) n FROM screenshot_intake_sources').get().n, 0);
  await setScreenshotManager(env, { telegram_id: String(MANAGER), status: 'approved' }, 'Synthetic admin');
  await dispatch(message('/intake viber'));
  await dispatch(message(Object.values(fields).join('. '), { message_id: 11 }));
  assert.equal(aiCalls, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n, 0);
  let draft = await activeScreenshotDraft(env, String(MANAGER));
  const analyzed = await dispatch(click('analyze', draft));
  assert.equal(analyzed.handled, 'screenshot_intake');
  draft = await getScreenshotDraft(env, draft.id, String(MANAGER));
  assert.equal(draft.status, 'ready'); assert.equal(draft.blocking, false); assert.equal(aiCalls, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n, 0);
  const confirmation = click('create', draft);
  await dispatch(confirmation); await dispatch(confirmation);
  assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n, 1);
  const order = db.prepare('SELECT * FROM orders').get();
  assert.equal(order.status, 'new'); assert.equal(order.payment_status, 'unknown');
  assert.equal(order.customer_phone, fields.customer_phone); assert.equal(order.manager_contact, '@evline_support');
  assert.equal(order.customer_telegram, null); assert.equal(order.telegram_chat_id, null);
  assert.equal(order.source, 'manual'); assert.equal(order.medium, 'viber');
  for (const table of ['supplier_payments', 'notification_queue', 'google_ads_conversion_events']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
});
