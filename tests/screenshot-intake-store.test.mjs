import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import * as store from '../functions/_lib/screenshot-intake-store.js';

const directory = new URL('../migrations/', import.meta.url);
const schemas = await Promise.all((await readdir(directory)).filter(file => file.endsWith('.sql')).sort().map(async file => [file, await readFile(new URL(file, directory), 'utf8')]));
const manager = '70001', otherManager = '70002';
const fields = { customer_name: 'Synthetic Customer', customer_phone: '+380 (50) 123-45-67', car: 'BYD Yuan Plus', vin: 'LGXCE4CB1N0123456', item_name: 'Права фара, 1 шт.', request_text: 'Оригінал. Потрібне фото роз’єму.' };
const code = expected => error => error.code === expected;

async function setup(t, bootstrapOnly = false) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = ON');
  for (const [name, schema] of schemas) if (!bootstrapOnly || name !== '0029_screenshot_intake.sql') db.exec(schema);
  const hooks = { beforeConfirm: null, failConfirmAt: null, prepared: 0 };
  const env = { DB: { prepare(sql) {
    hooks.prepared += 1;
    const statement = db.prepare(sql); let values = [];
    const run = () => { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; };
    return { sql, bind(...args) { values = args; return this; }, async run() { return run(); }, _run: run,
      async first() { return statement.get(...values) || null; }, async all() { return { results: statement.all(...values) }; } };
  }, async batch(statements) {
    const confirmation = statements[0].sql.includes('SET commit_nonce=');
    if (confirmation && hooks.beforeConfirm) { const hook = hooks.beforeConfirm; hooks.beforeConfirm = null; hook(); }
    db.exec('BEGIN');
    try {
      const results = statements.map((statement, index) => {
        if (confirmation && index === hooks.failConfirmAt) throw new Error('Injected transactional failure');
        return statement._run();
      });
      db.exec('COMMIT'); return results;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } } };
  await store.ensureScreenshotIntake(env);
  const approve = async (id = manager) => {
    await store.requestScreenshotAccess(env, { id, username: 'synthetic_manager', first_name: 'Synthetic', last_name: 'Manager' });
    return store.setScreenshotManager(env, { telegram_id: id, status: 'approved' }, 'Synthetic admin');
  };
  const draft = async (id = manager, channel = 'viber') => store.createScreenshotDraft(env, { manager_id: id, chat_id: id, channel });
  const ready = async (id = manager, overrides = {}) => {
    const row = await draft(id);
    const sourced = await store.addScreenshotSource(env, row.id, id, { message_id: 1, kind: 'text', text: 'Synthetic source: customer-provided details' });
    return store.saveScreenshotAnalysis(env, row.id, id, sourced.revision, { fields: { ...fields, ...overrides }, warnings: [], evidence: { item_name: [{ source_id: sourced.sources[0].id }] } });
  };
  const count = table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  return { db, env, hooks, approve, draft, ready, count };
}

test('migration and additive bootstrap produce matching screenshot schemas', async t => {
  const migrated = await setup(t), bootstrapped = await setup(t, true);
  for (const table of ['screenshot_intake_managers', 'screenshot_intake_drafts', 'screenshot_intake_sources', 'screenshot_intake_events']) {
    assert.deepEqual(bootstrapped.db.prepare(`PRAGMA table_info(${table})`).all(), migrated.db.prepare(`PRAGMA table_info(${table})`).all());
  }
});

test('access requests never approve managers or collect screenshot contents', async t => {
  const { env, count, draft } = await setup(t);
  const requested = await store.requestScreenshotAccess(env, { id: manager, username: 'synthetic_manager', first_name: 'Synthetic', text: 'must not store', photo: 'bytes' });
  assert.equal(requested.status, 'pending');
  await assert.rejects(draft(), code('manager_not_approved'));
  assert.equal(count('screenshot_intake_drafts'), 0);
  assert.equal(count('screenshot_intake_sources'), 0);
  assert.ok(!JSON.stringify(requested).includes('must not store'));
  await store.setScreenshotManager(env, { telegram_id: manager, status: 'paused' }, 'Admin');
  assert.equal((await store.requestScreenshotAccess(env, { id: manager })).status, 'paused');
  await assert.rejects(store.setScreenshotManager(env, { telegram_id: manager, status: 'pending' }, 'Admin'), code('invalid_status'));
  await assert.rejects(store.requestScreenshotAccess(env, { id: manager, is_bot: true }), code('invalid_manager'));
});

test('only one active private-chat draft is allowed per approved manager', async t => {
  const { env, approve, draft, count } = await setup(t);
  await approve();
  const [first, repeated] = await Promise.all([draft(), draft()]);
  assert.equal(first.id, repeated.id);
  assert.equal(count('screenshot_intake_drafts'), 1);
  await assert.rejects(draft(manager, 'whatsapp'), code('active_draft_exists'));
  await assert.rejects(store.createScreenshotDraft(env, { manager_id: manager, chat_id: '-123', channel: 'viber' }), code('private_chat_required'));
  await store.cancelScreenshotDraft(env, first.id, manager);
  assert.notEqual((await draft(manager, 'whatsapp')).id, first.id);
});

test('all manager operations reject crossed ownership and paused managers', async t => {
  const { env, approve, ready } = await setup(t);
  await approve(); await approve(otherManager);
  const row = await ready();
  const operations = id => [
    () => store.getScreenshotDraft(env, row.id, id),
    () => store.addScreenshotSource(env, row.id, id, { message_id: 2, kind: 'text', text: 'other' }),
    () => store.saveScreenshotAnalysis(env, row.id, id, row.revision, { fields }),
    () => store.updateScreenshotFields(env, row.id, id, row.revision, { item_name: 'Other part' }),
    () => store.cancelScreenshotDraft(env, row.id, id),
    () => store.claimScreenshotAnalysis(env, row.id, id, row.revision),
    () => store.confirmScreenshotDraft(env, row.id, id, row.revision, { mode: 'create' }, 'Manager'),
  ];
  for (const operation of operations(otherManager)) await assert.rejects(operation(), code('draft_not_found'));
  await store.setScreenshotManager(env, { telegram_id: manager, status: 'paused' }, 'Admin');
  for (const operation of operations(manager)) await assert.rejects(operation(), code('manager_not_approved'));
  await assert.rejects(store.activeScreenshotDraft(env, manager), code('manager_not_approved'));
  assert.equal((await store.getScreenshotDraft(env, row.id)).id, row.id, 'Authenticated admin may inspect a paused draft');
});

test('sources deduplicate message and Telegram file identity and invalidate old previews', async t => {
  const { env, approve, draft } = await setup(t); await approve();
  const row = await draft();
  const first = await store.addScreenshotSource(env, row.id, manager, { message_id: 1, kind: 'image', file_id: 'photo_1', file_unique_id: 'same_image' });
  assert.equal(first.revision, 1);
  const ready = await store.saveScreenshotAnalysis(env, row.id, manager, 1, { fields });
  assert.equal(ready.status, 'ready');
  for (const source of [
    { message_id: 1, kind: 'image', file_id: 'photo_1', file_unique_id: 'same_image' },
    { message_id: 2, kind: 'image', file_id: 'photo_new_transport_id', file_unique_id: 'same_image' },
  ]) {
    const duplicate = await store.addScreenshotSource(env, row.id, manager, source);
    assert.equal(duplicate.revision, ready.revision); assert.equal(duplicate.status, 'ready'); assert.equal(duplicate.sources.length, 1);
  }
  const newer = await store.addScreenshotSource(env, row.id, manager, { message_id: 3, kind: 'text', text: 'Actually left side' });
  assert.equal(newer.revision, ready.revision + 1); assert.equal(newer.status, 'collecting'); assert.deepEqual(newer.fields, {});
  await assert.rejects(store.saveScreenshotAnalysis(env, row.id, manager, 1, { fields }), code('stale_revision'));
  await assert.rejects(store.confirmScreenshotDraft(env, row.id, manager, 1, { mode: 'create' }, 'Manager'), code('stale_revision'));
});

test('limits reject seventh sources, excessive text and raw image URLs without storing them', async t => {
  const { env, approve, draft, db } = await setup(t); await approve(); const row = await draft();
  for (let index = 1; index <= 6; index += 1) await store.addScreenshotSource(env, row.id, manager, { message_id: index, kind: 'text', text: 'x'.repeat(index === 1 ? 19995 : 1) });
  await assert.rejects(store.addScreenshotSource(env, row.id, manager, { message_id: 7, kind: 'text', text: 'x' }), code('source_limit'));
  assert.equal(db.prepare('SELECT sum(length(text)) AS n FROM screenshot_intake_sources').get().n, 20000);
  assert.equal((await store.getScreenshotDraft(env, row.id, manager)).revision, 6);
  await store.cancelScreenshotDraft(env, row.id, manager); const next = await draft();
  await store.addScreenshotSource(env, next.id, manager, { message_id: 10, kind: 'text', text: 'x'.repeat(20000) });
  await assert.rejects(store.addScreenshotSource(env, next.id, manager, { message_id: 11, kind: 'text', text: 'y' }), code('source_limit'));
  await assert.rejects(store.addScreenshotSource(env, next.id, manager, { message_id: 12, kind: 'image', file_id: 'data:image/png;base64,RAW_BYTES', file_unique_id: 'file' }), code('invalid_source'));
});

test('field edits are allowlisted, validate phone/VIN, require revision and do not create CRM rows', async t => {
  const { env, approve, ready, count } = await setup(t); await approve(); const row = await ready();
  for (const input of [{ revenue_uah: '500' }, { status: 'paid' }, { constructor: 'bad' }, { customer_phone: 'call me' }, { vin: 'INVALID' }, { item_name: 'x'.repeat(2001) }]) {
    await assert.rejects(store.updateScreenshotFields(env, row.id, manager, row.revision, input), error => error.status === 400);
  }
  const edited = await store.updateScreenshotFields(env, row.id, manager, row.revision, { customer_name: 'Reviewed name', vin: fields.vin.toLowerCase() });
  assert.equal(edited.revision, row.revision + 1); assert.equal(edited.fields.vin, fields.vin);
  await assert.rejects(store.updateScreenshotFields(env, row.id, manager, row.revision, { car: 'Old edit' }), code('stale_revision'));
  assert.equal(count('orders'), 0); assert.equal(count('customers'), 0); assert.equal(count('leads'), 0);
});

test('analysis lease excludes duplicate work and stale token cannot release or replace a renewed lease', async t => {
  const { env, db, approve, ready } = await setup(t); await approve(); const row = await ready();
  const claim = await store.claimScreenshotAnalysis(env, row.id, manager, row.revision);
  assert.ok(claim.analysis_token); assert.ok(claim.analysis_until > Date.now() + 7 * 60000);
  assert.ok(!('analysis_token' in await store.getScreenshotDraft(env, row.id, manager)));
  await assert.rejects(store.confirmScreenshotDraft(env, row.id, manager, row.revision, { mode: 'create' }, 'Manager'), code('analysis_busy'));
  await assert.rejects(store.claimScreenshotAnalysis(env, row.id, manager, row.revision), code('analysis_busy'));
  await assert.rejects(store.saveScreenshotAnalysis(env, row.id, manager, row.revision, { fields }), code('stale_revision'));
  db.prepare('UPDATE screenshot_intake_drafts SET analysis_until=0 WHERE id=?').run(row.id);
  const renewed = await store.claimScreenshotAnalysis(env, row.id, manager, row.revision);
  await store.releaseScreenshotAnalysis(env, row.id, manager, row.revision, claim.analysis_token);
  await assert.rejects(store.claimScreenshotAnalysis(env, row.id, manager, row.revision), code('analysis_busy'));
  await assert.rejects(store.saveScreenshotAnalysis(env, row.id, manager, row.revision, { fields, analysis_token: claim.analysis_token }), code('stale_revision'));
  const saved = await store.saveScreenshotAnalysis(env, row.id, manager, row.revision, { fields, analysis_token: renewed.analysis_token });
  assert.equal(saved.analysis_until, 0); assert.equal(saved.status, 'ready');
  assert.equal(saved.revision, row.revision + 1);
  await assert.rejects(store.confirmScreenshotDraft(env, row.id, manager, row.revision, { mode: 'create' }, 'Manager'), code('stale_revision'));
  const pending = await store.claimScreenshotAnalysis(env, row.id, manager, saved.revision);
  const newer = await store.addScreenshotSource(env, row.id, manager, { message_id: 2, kind: 'text', text: 'New input' });
  assert.equal(newer.analysis_until, 0);
  await assert.rejects(store.saveScreenshotAnalysis(env, row.id, manager, saved.revision, { fields, analysis_token: pending.analysis_token }), code('stale_revision'));
});

test('blocking proposals and missing client phones cannot be confirmed; verified edits clear blocking', async t => {
  const { env, approve, ready, count } = await setup(t); await approve(); const row = await ready();
  const blocked = await store.saveScreenshotAnalysis(env, row.id, manager, row.revision, { fields, blocking: true, warnings: ['Multiple customers'] });
  await assert.rejects(store.confirmScreenshotDraft(env, row.id, manager, blocked.revision, { mode: 'create' }, 'Manager'), code('review_required'));
  let edited = await store.updateScreenshotFields(env, row.id, manager, blocked.revision, { customer_phone: '' });
  assert.equal(edited.blocking, false);
  await assert.rejects(store.confirmScreenshotDraft(env, row.id, manager, edited.revision, { mode: 'create' }, 'Manager'), code('missing_fields'));
  edited = await store.updateScreenshotFields(env, row.id, manager, edited.revision, { customer_phone: fields.customer_phone });
  await store.confirmScreenshotDraft(env, row.id, manager, edited.revision, { mode: 'create' }, 'Manager');
  assert.equal(count('orders'), 1);
});

test('confirmed creation is atomic, manual attribution, client-only identity, zero finance and no outbound effects', async t => {
  const { env, db, approve, ready, count } = await setup(t); await approve(); const row = await ready();
  const result = await store.confirmScreenshotDraft(env, row.id, manager, row.revision, { mode: 'create' }, 'Synthetic manager');
  assert.equal(result.applied, true); assert.equal(result.already_applied, false); assert.match(result.order_number, /^O-\d{6}$/);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(result.order_id);
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(order.customer_id);
  const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(order.lead_id);
  assert.equal(order.item_name, fields.item_name); assert.equal(order.customer_phone, fields.customer_phone);
  assert.equal(order.status, 'new'); assert.equal(order.type, 'parts'); assert.equal(order.payment_status, 'unknown');
  for (const key of ['revenue_uah', 'purchase_cost_uah', 'delivery_cost_uah', 'customs_cost_uah', 'processing_cost_uah', 'ad_cost_uah', 'other_cost_uah']) assert.equal(order[key], 0, key);
  for (const item of [order, lead]) { assert.equal(item.source, 'manual'); assert.equal(item.medium, 'viber'); assert.equal(item.attribution_type, 'manual'); }
  assert.equal(order.telegram_chat_id, null); assert.equal(order.customer_telegram, null); assert.equal(customer.telegram_chat_id, null); assert.equal(customer.telegram_username, null); assert.equal(lead.telegram, null);
  for (const table of ['notification_queue', 'google_ads_conversion_events', 'supplier_payments']) assert.equal(count(table), 0, table);
  assert.equal(count('screenshot_intake_events'), 1);
  const event = db.prepare('SELECT * FROM screenshot_intake_events').get();
  assert.match(event.summary_hash, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(event).includes(fields.customer_phone));
  assert.equal(await store.activeScreenshotDraft(env, manager), null);
  const repeat = await store.confirmScreenshotDraft(env, row.id, manager, row.revision, { mode: 'create' }, 'Synthetic manager');
  assert.equal(repeat.order_id, result.order_id); assert.equal(repeat.already_applied, true);
  assert.equal(count('orders'), 1); assert.equal(count('customers'), 1); assert.equal(count('leads'), 1); assert.equal(count('screenshot_intake_events'), 1);
});

test('same draft concurrent confirmations create exactly one CRM graph and rollback leaves no partial graph', async t => {
  const { env, hooks, approve, ready, count } = await setup(t); await approve(); let row = await ready();
  hooks.failConfirmAt = 3;
  await assert.rejects(store.confirmScreenshotDraft(env, row.id, manager, row.revision, { mode: 'create' }, 'Manager'), /transactional failure/);
  assert.equal(count('orders'), 0); assert.equal(count('customers'), 0); assert.equal(count('leads'), 0); assert.equal(count('screenshot_intake_events'), 0);
  assert.equal((await store.getScreenshotDraft(env, row.id, manager)).status, 'ready');
  hooks.failConfirmAt = null;
  const results = await Promise.all([1, 2].map(() => store.confirmScreenshotDraft(env, row.id, manager, row.revision, { mode: 'create' }, 'Manager')));
  assert.equal(results[0].order_id, results[1].order_id); assert.equal(count('orders'), 1); assert.equal(count('screenshot_intake_events'), 1);
});

test('duplicates use exact normalized phone or VIN, reveal no unrelated contact/financial data, and require explicit separate-create', async t => {
  const { env, db, approve, ready, count } = await setup(t); await approve(); await approve(otherManager);
  const first = await ready(); const created = await store.confirmScreenshotDraft(env, first.id, manager, first.revision, { mode: 'create' }, 'Manager');
  const second = await ready(otherManager, { customer_phone: '0501234567', vin: '' });
  const matches = await store.findScreenshotDuplicates(env, second);
  assert.equal(matches.length, 1); assert.equal(matches[0].id, created.order_id);
  assert.deepEqual(Object.keys(matches[0]).sort(), ['id', 'order_number', 'car', 'item_name', 'updated_at', 'status'].sort());
  await assert.rejects(store.confirmScreenshotDraft(env, second.id, otherManager, second.revision, { mode: 'create' }, 'Manager'), code('duplicate_detected'));
  await store.confirmScreenshotDraft(env, second.id, otherManager, second.revision, { mode: 'create', allow_duplicate: true }, 'Manager');
  assert.equal(count('orders'), 2);
  const third = await ready(manager, { customer_phone: '+380991111111', vin: fields.vin });
  assert.equal((await store.findScreenshotDuplicates(env, third)).length, 1);
  db.prepare('UPDATE orders SET vin=NULL, customer_phone=?').run('+3805012345678');
  assert.equal((await store.findScreenshotDuplicates(env, third)).length, 0, 'No suffix/substring phone match');
});

test('parallel drafts cannot bypass duplicate checks between preflight and transaction', async t => {
  const { env, approve, ready, count } = await setup(t); await approve(); await approve(otherManager);
  const a = await ready(), b = await ready(otherManager);
  const results = await Promise.allSettled([
    store.confirmScreenshotDraft(env, a.id, manager, a.revision, { mode: 'create' }, 'A'),
    store.confirmScreenshotDraft(env, b.id, otherManager, b.revision, { mode: 'create' }, 'B'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'duplicate_detected');
  assert.equal(count('orders'), 1); assert.equal(count('customers'), 1); assert.equal(count('leads'), 1);
});

test('duplicate candidates are bounded to five even when many historical matches exist', async t => {
  const { env, db, approve, ready } = await setup(t); await approve(); const row = await ready();
  const insert = db.prepare('INSERT INTO orders (id,created_at,updated_at,customer_phone,vin) VALUES (?,?,?,?,?)');
  for (let index = 0; index < 9; index += 1) insert.run(`prior-${index}`, '2026-01-01', '2026-01-01', '00380 50 123 45 67', fields.vin.toLowerCase());
  assert.equal((await store.findScreenshotDuplicates(env, row)).length, 5);
});

test('overview has a fixed query budget and never leaks lease/transaction tokens', async t => {
  const { env, db, hooks, approve } = await setup(t); await approve();
  const date = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO screenshot_intake_drafts (id,manager_id,chat_id,channel,status,created_at,updated_at,expires_at,analysis_token,commit_nonce)
    VALUES (?,?,?,'viber','canceled',?,?,?,'private-lease','private-commit')`);
  for (let index = 0; index < 105; index += 1) insert.run(`draft-${index}`, manager, manager, date, date, date);
  const before = hooks.prepared;
  const overview = await store.screenshotOverview(env);
  assert.equal(hooks.prepared - before, 6);
  assert.equal(overview.drafts.length, 100);
  assert.equal(overview.managers.length, 1);
  assert.ok(!JSON.stringify(overview).includes('private-lease'));
  assert.ok(!JSON.stringify(overview).includes('private-commit'));
});

test('approval pause or newer input immediately before commit defeats the transaction gate', async t => {
  const { env, db, hooks, approve, ready, count } = await setup(t); await approve(); const row = await ready();
  hooks.beforeConfirm = () => db.prepare("UPDATE screenshot_intake_managers SET status='paused' WHERE telegram_id=?").run(manager);
  await assert.rejects(store.confirmScreenshotDraft(env, row.id, manager, row.revision, { mode: 'create' }, 'Manager'), code('manager_not_approved'));
  assert.equal(count('orders'), 0); assert.equal(count('customers'), 0);
  await store.setScreenshotManager(env, { telegram_id: manager, status: 'approved' }, 'Admin');
  hooks.beforeConfirm = () => db.prepare('UPDATE screenshot_intake_drafts SET revision=revision+1 WHERE id=?').run(row.id);
  await assert.rejects(store.confirmScreenshotDraft(env, row.id, manager, row.revision, { mode: 'create' }, 'Manager'), code('stale_revision'));
  assert.equal(count('orders'), 0); assert.equal(count('leads'), 0);
});

test('append changes only notes and updated_at, uses optimistic lock, rejects canceled targets, and retries once', async t => {
  const { env, db, hooks, approve, ready, count } = await setup(t); await approve();
  const first = await ready(); const created = await store.confirmScreenshotDraft(env, first.id, manager, first.revision, { mode: 'create' }, 'Manager');
  db.prepare("UPDATE orders SET status='left_china',payment_status='paid',revenue_uah=98765,purchase_cost_uah=12345,delivery_cost_uah=100,customs_cost_uah=40,processing_cost_uah=20,ad_cost_uah=10,other_cost_uah=5,paid_at='2026-01-01',tracking_number='TRACK123',manager_notes='Existing notes' WHERE id=?").run(created.order_id);
  const before = db.prepare('SELECT * FROM orders WHERE id=?').get(created.order_id);
  const row = await ready(manager, { item_name: 'Додатково кріплення' });
  const options = { mode: 'append', order_id: created.order_id, order_updated_at: before.updated_at };
  const applied = await store.confirmScreenshotDraft(env, row.id, manager, row.revision, options, 'Manager');
  assert.equal(applied.order_id, created.order_id);
  const after = db.prepare('SELECT * FROM orders WHERE id=?').get(created.order_id);
  for (const key of Object.keys(before)) if (!['updated_at', 'manager_notes'].includes(key)) assert.equal(after[key], before[key], key);
  assert.ok(after.updated_at > before.updated_at); assert.match(after.manager_notes, /^Existing notes\n\n/); assert.match(after.manager_notes, /Додатково кріплення/);
  await store.confirmScreenshotDraft(env, row.id, manager, row.revision, options, 'Manager');
  assert.equal(db.prepare('SELECT manager_notes FROM orders WHERE id=?').get(created.order_id).manager_notes, after.manager_notes);
  assert.equal(count('orders'), 1); assert.equal(count('leads'), 1); assert.equal(count('customers'), 1);
  const next = await ready();
  await assert.rejects(store.confirmScreenshotDraft(env, next.id, manager, next.revision, options, 'Manager'), code('order_changed'));
  hooks.beforeConfirm = () => db.prepare("UPDATE orders SET updated_at='2099-01-01' WHERE id=?").run(created.order_id);
  await assert.rejects(store.confirmScreenshotDraft(env, next.id, manager, next.revision, { ...options, order_updated_at: after.updated_at }, 'Manager'), code('stale_revision'));
  db.prepare("UPDATE orders SET status='canceled' WHERE id=?").run(created.order_id);
  await assert.rejects(store.confirmScreenshotDraft(env, next.id, manager, next.revision, { ...options, order_updated_at: '2099-01-01' }, 'Manager'), code('order_changed'));
});

test('24-hour expiry rejects actions; seven-day retention scrubs sources and extracted data but preserves retry tombstone', async t => {
  const { env, db, approve, ready, draft, count } = await setup(t); await approve();
  const first = await ready(); const applied = await store.confirmScreenshotDraft(env, first.id, manager, first.revision, { mode: 'create' }, 'Manager');
  const pending = await ready();
  db.prepare("UPDATE screenshot_intake_drafts SET expires_at='2000-01-01' WHERE id=?").run(pending.id);
  assert.equal(await store.activeScreenshotDraft(env, manager), null);
  await assert.rejects(store.confirmScreenshotDraft(env, pending.id, manager, pending.revision, { mode: 'create' }, 'Manager'), code('draft_inactive'));
  assert.equal((await store.getScreenshotDraft(env, pending.id, manager)).status, 'expired');
  db.prepare("UPDATE screenshot_intake_drafts SET created_at='2000-01-01',updated_at=?").run(new Date().toISOString());
  await store.screenshotManager(env, manager);
  assert.equal(count('screenshot_intake_sources'), 0);
  for (const id of [first.id, pending.id]) {
    const row = await store.getScreenshotDraft(env, id, manager);
    assert.deepEqual(row.fields, {}); assert.deepEqual(row.warnings, []); assert.deepEqual(row.evidence, {}); assert.deepEqual(row.sources, []); assert.equal(row.chat_id, ''); assert.ok(row.purged_at);
  }
  const retry = await store.confirmScreenshotDraft(env, first.id, manager, first.revision, { mode: 'create' }, 'Manager');
  assert.equal(retry.order_id, applied.order_id); assert.equal(retry.already_applied, true); assert.equal(count('orders'), 1);
  assert.ok((await draft()).id);
});
