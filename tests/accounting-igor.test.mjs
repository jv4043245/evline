import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { persistIgorCampaignSnapshot, validateIgorCampaignSnapshot, readIgorAdvertising, readIgorGoogleAllocation } from '../functions/_lib/accounting-igor.js';
import { validateIgorDraftInput, calculateIgorReimbursement, readIgorDraft, saveIgorDraft } from '../functions/_lib/accounting-igor-drafts.js';
import { readProfitDraft, saveProfitDraft } from '../functions/_lib/accounting-profit-drafts.js';
import { onRequestGet, onRequestPut, onRequestDelete } from '../functions/api/admin/accounting/igor.js';

const now = new Date('2026-10-10T12:00:00.000Z');
const accounts = { google: '4028488894', meta: '1354524650161143' };
const range = { from: '2026-10-08', to: '2026-10-09', now };
const completeAd = { google_minor: 10000, meta_minor: 5000, total_minor: 15000, coverage: 'complete', through: '2026-09-30', campaigns: [] };
const draft = patch => ({ month: '2026-09', expected_revision: 0, inputs: { fees_minor: 1000, fees_note: 'Комісія банку, без повторного списання реклами' }, ...patch });
const draftOptions = { now, advertisingReader: async () => structuredClone(completeAd) };

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE orders(id TEXT PRIMARY KEY,created_at TEXT,source TEXT); CREATE TABLE ad_costs(cost_date TEXT,platform TEXT,source TEXT,medium TEXT,spend_uah REAL,notes TEXT,created_at TEXT,updated_at TEXT);');
  for (const file of ['0031_accounting.sql', '0032_accounting_business_scope.sql', '0033_accounting_profit_drafts.sql', '0035_accounting_igor.sql']) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const db = { prepare(sql) { return {
    bind(...args) { return { sql, args, async all() { return { results: sqlite.prepare(sql).all(...args) }; } }; },
    async all() { return { results: sqlite.prepare(sql).all() }; },
  }; }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = statements.map(({ sql, args }) => ({ meta: sqlite.prepare(sql).run(...args) })); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const map = (provider = 'google', campaignId = '123456', starts = '2026-10-08', ends = null) => sqlite.prepare('INSERT INTO accounting_igor_campaigns(provider,account_id,campaign_id,starts_on,ends_on,created_at,created_by) VALUES(?,?,?,?,?,?,?)')
    .run(provider, accounts[provider], campaignId, starts, ends, now.toISOString(), 'test-admin');
  const zero = (provider, from = '2026-10-01', to = '2026-10-09') => sqlite.prepare('INSERT INTO accounting_igor_no_spend_periods(provider,date_from,date_to,confirmed_at,confirmed_by) VALUES(?,?,?,?,?)')
    .run(provider, from, to, now.toISOString(), 'test-admin');
  return { db, sqlite, map, zero };
}

function snapshot(patch = {}) {
  return { provider: 'google', account_id: accounts.google, campaign_id: '123456', currency: 'UAH', timezone: 'Europe/Kyiv',
    from: range.from, to: range.to, fetched_at: now.toISOString(), coverage: 'complete', source: 'google_ads_script',
    days: [{ date: range.from, spend_minor: 1000, is_final: true }, { date: range.to, spend_minor: 0, is_final: true }], ...patch };
}

test('additive migration enrolls no campaigns and no artificial zero costs', async () => {
  const { db, sqlite } = database();
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_igor_campaigns').get().n, 0);
  const report = await readIgorAdvertising(db, range);
  assert.equal(report.coverage, 'not_configured');
  assert.equal(report.google_minor, null); assert.equal(report.meta_minor, null); assert.equal(report.total_minor, null);
  assert.deepEqual(report.campaigns, []);
  assert.deepEqual(await readIgorGoogleAllocation(db, range), { active: false, coverage: 'complete', total_minor: 0, daily: [] });
  const monthly = await readIgorDraft(db, '2026-10', { now });
  assert.equal(monthly.calculation.status, 'not_configured'); assert.equal(monthly.calculation.reimbursement_minor, null);
  assert.equal(monthly.advertising.through, '2026-10-09'); assert.equal(monthly.current_month, true);
  assert.equal(monthly.inputs.fees_minor, null); assert.equal(monthly.revision, 0);
});

test('snapshots require exact authorized identity, source, complete days and fresh timestamp', () => {
  assert.equal(validateIgorCampaignSnapshot(snapshot(), { now }).days[1].spend_minor, 0);
  for (const patch of [{ account_id: '999' }, { campaign_id: 'by-name' }, { currency: 'EUR' }, { timezone: 'Europe/Bucharest' },
    { source: 'arbitrary' }, { token: 'secret' }, { coverage: 'account' }, { fetched_at: '2026-10-01T00:00:00.000Z' },
    { fetched_at: '2026-10-11T00:00:00.000Z' }, { from: '2026-02-31' }, { days: snapshot().days.slice(0, 1) },
    { days: [snapshot().days[0], snapshot().days[0]] }, { days: [{ ...snapshot().days[0], spend_minor: -1 }, snapshot().days[1]] },
    { days: [{ ...snapshot().days[0], spend_minor: 0.1 }, snapshot().days[1]] }, { days: [{ ...snapshot().days[0], customer: 'private' }, snapshot().days[1]] },
    { from: '2026-10-10', to: '2026-10-10', days: [{ date: '2026-10-10', spend_minor: 10, is_final: true }] }]) {
    assert.throws(() => validateIgorCampaignSnapshot(snapshot(patch), { now }));
  }
});

test('campaign enrollment, allowed period and Meta foreign scopes are enforced independently', async () => {
  const { db, map, sqlite } = database();
  await assert.rejects(persistIgorCampaignSnapshot(db, snapshot(), { now }), { message: 'accounting_igor_campaign_not_configured' });
  map('google', '123456', '2026-10-09');
  await assert.rejects(persistIgorCampaignSnapshot(db, snapshot(), { now }), { message: 'accounting_igor_outside_campaign_period' });
  for (const id of ['120251518463770454', '120252865188010454']) assert.throws(() => map('meta', id));
  assert.throws(() => map('google', 'wrong'));
  assert.throws(() => map('google', '777', '2026-02-31'));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_ad_daily').get().n, 0);
});

test('campaign imports are retry safe, immutable, atomic and do not touch canonical ledger', async () => {
  const { db, map, sqlite } = database(); map();
  const first = await persistIgorCampaignSnapshot(db, snapshot(), { now });
  assert.equal(first.days_imported, 2);
  const retry = await persistIgorCampaignSnapshot(db, snapshot(), { now });
  assert.equal(retry.days_imported, 0); assert.equal(retry.run_id, first.run_id);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_igor_import_runs').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_ad_daily').get().n, 0);
  assert.throws(() => sqlite.exec("UPDATE accounting_igor_import_runs SET source='x'"), /immutable/);
  assert.throws(() => sqlite.exec('DELETE FROM accounting_igor_import_runs'), /immutable/);
  const broken = { ...db, batch: statements => db.batch([...statements, { sql: 'INSERT INTO nonexistent VALUES(1)', args: [] }]) };
  await assert.rejects(persistIgorCampaignSnapshot(broken, snapshot({ fetched_at: '2026-10-10T12:01:00.000Z', days: snapshot().days.map(day => ({ ...day, spend_minor: 3000 })) }), { now }));
  assert.equal(sqlite.prepare('SELECT spend_minor FROM accounting_igor_campaign_daily ORDER BY stat_date LIMIT 1').get().spend_minor, 1000);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_igor_import_runs').get().n, 1);
});

test('older and partial snapshots cannot replace complete final facts', async () => {
  const { db, map } = database(); map();
  await persistIgorCampaignSnapshot(db, snapshot(), { now });
  const older = await persistIgorCampaignSnapshot(db, snapshot({ fetched_at: '2026-10-10T11:00:00.000Z', days: snapshot().days.map(day => ({ ...day, spend_minor: 9000 })) }), { now });
  assert.equal(older.days_imported, 0);
  const partial = await persistIgorCampaignSnapshot(db, snapshot({ coverage: 'partial', fetched_at: '2026-10-10T12:01:00.000Z', days: [snapshot().days[0]] }), { now });
  assert.equal(partial.days_imported, 0);
  const nonfinal = await persistIgorCampaignSnapshot(db, snapshot({ fetched_at: '2026-10-10T12:02:00.000Z', days: snapshot().days.map(day => ({ ...day, is_final: false, spend_minor: 8000 })) }), { now });
  assert.equal(nonfinal.days_imported, 0);
});

test('explicit not-launched provider zero combines with campaign facts, never missing rows', async () => {
  const { db, map, zero } = database(); map();
  await persistIgorCampaignSnapshot(db, snapshot(), { now });
  let report = await readIgorAdvertising(db, range);
  assert.equal(report.google_minor, 1000); assert.equal(report.meta_minor, null); assert.equal(report.total_minor, null);
  zero('meta');
  report = await readIgorAdvertising(db, range);
  assert.equal(report.meta_minor, 0); assert.equal(report.total_minor, 1000); assert.equal(report.coverage, 'complete');
  map('meta', '55555');
  report = await readIgorAdvertising(db, range);
  assert.equal(report.meta_minor, null); assert.equal(report.total_minor, null); // active overrides no-spend
  await persistIgorCampaignSnapshot(db, snapshot({ provider: 'meta', account_id: accounts.meta, campaign_id: '55555', source: 'meta_insights' }), { now });
  report = await readIgorAdvertising(db, range);
  assert.equal(report.total_minor, 2000);
});

test('all active campaigns need final receipts and allocation respects effective dates', async () => {
  const { db, map } = database(); map(); map('google', '8888');
  await persistIgorCampaignSnapshot(db, snapshot(), { now });
  let allocation = await readIgorGoogleAllocation(db, { from: '2026-10-01', to: range.to, now });
  assert.equal(allocation.active, true); assert.equal(allocation.coverage, 'partial'); assert.equal(allocation.total_minor, null);
  assert.equal(allocation.daily.length, 2); // Oct1–7 outside both mappings not charged to Igor
  await persistIgorCampaignSnapshot(db, snapshot({ campaign_id: '8888', coverage: 'partial', days: [snapshot().days[0]] }), { now });
  allocation = await readIgorGoogleAllocation(db, range);
  assert.equal(allocation.total_minor, null);
  await persistIgorCampaignSnapshot(db, snapshot({ campaign_id: '8888', fetched_at: '2026-10-10T12:01:00.000Z' }), { now });
  allocation = await readIgorGoogleAllocation(db, range);
  assert.equal(allocation.total_minor, 2000); assert.equal(allocation.coverage, 'complete');
  assert.equal((await readIgorGoogleAllocation(db, { from: '2026-09-01', to: '2026-09-30', now })).active, false);
});

test('Igor input rejects unknown keys, spoofed actor, invalid amounts and undisclosed positive fees', () => {
  assert.equal(validateIgorDraftInput(draft(), now).inputs.fees_minor, 1000);
  for (const fees_minor of [-1, 0.1, '1', undefined, NaN, Infinity, 100000000001]) assert.throws(() => validateIgorDraftInput(draft({ inputs: { fees_minor, fees_note: 'x' } }), now));
  for (const fees_note of ['', ' ', '<script>', '\u202Ebad', 'x'.repeat(501)]) assert.throws(() => validateIgorDraftInput(draft({ inputs: { fees_minor: 1, fees_note } }), now));
  for (const patch of [{ month: '2026-11' }, { month: '2026-00' }, { expected_revision: -1 }, { expected_revision: '0' }, { actor_id: 'spoof' }]) assert.throws(() => validateIgorDraftInput({ ...draft(), ...patch }, now));
  assert.equal(validateIgorDraftInput(draft({ inputs: { fees_minor: null, fees_note: '' } }), now).inputs.fees_minor, null);
  assert.equal(validateIgorDraftInput(draft({ inputs: { fees_minor: 0, fees_note: '' } }), now).inputs.fees_minor, 0);
});

test('reimbursement is exactly advertising plus explicit incremental actual fees, not 15 percent', () => {
  assert.equal(calculateIgorReimbursement({ fees_minor: 1234, fees_note: 'Банківська комісія' }, completeAd).reimbursement_minor, 16234);
  assert.equal(calculateIgorReimbursement({ fees_minor: 0, fees_note: '' }, completeAd).reimbursement_minor, 15000);
  assert.equal(calculateIgorReimbursement({ fees_minor: null, fees_note: '' }, completeAd).reimbursement_minor, null);
  assert.equal(calculateIgorReimbursement({ fees_minor: 0, fees_note: '' }, { ...completeAd, coverage: 'partial' }).reimbursement_minor, null);
  assert.equal(calculateIgorReimbursement({ fees_minor: 0, fees_note: '' }, { ...completeAd, total_minor: 1 }).reimbursement_minor, null);
  assert.equal(calculateIgorReimbursement({ fees_minor: 0, fees_note: '' }, { ...completeAd, coverage: 'not_configured' }).status, 'not_configured');
});

test('Igor drafts CAS save with immutable audit, no approval and no revisions of old snapshots', async () => {
  const { db, sqlite } = database();
  const result = await saveIgorDraft(db, draft(), 'owner', draftOptions);
  assert.equal(result.revision, 1); assert.equal(result.calculation.reimbursement_minor, 16000); assert.equal(result.calculation.status, 'draft');
  assert.equal(result.basis, 'advertising_reimbursement'); assert.equal('updated_by' in result, false);
  assert.deepEqual(await readIgorDraft(db, '2026-09', draftOptions), result);
  const audit = sqlite.prepare('SELECT * FROM accounting_igor_revisions').get();
  assert.equal(audit.actor_id, 'owner'); assert.deepEqual(JSON.parse(audit.snapshot_json), result);
  assert.throws(() => sqlite.exec("UPDATE accounting_igor_revisions SET actor_id='other'"), /immutable/);
  assert.throws(() => sqlite.exec('DELETE FROM accounting_igor_revisions'), /immutable/);
  await assert.rejects(saveIgorDraft(db, draft(), 'other', draftOptions), { status: 409 });
  await assert.rejects(saveIgorDraft(db, draft({ month: '2026-08', expected_revision: 3 }), 'owner', draftOptions), { status: 409 });
  const fresh = await readIgorDraft(db, '2026-09', { now, advertisingReader: async () => ({ ...completeAd, google_minor: 15000, total_minor: 20000 }) });
  assert.equal(fresh.calculation.reimbursement_minor, 21000);
  assert.equal(JSON.parse(sqlite.prepare('SELECT snapshot_json FROM accounting_igor_revisions').get().snapshot_json).calculation.reimbursement_minor, 16000);
  const second = await saveIgorDraft(db, draft({ expected_revision: 1, inputs: { fees_minor: 0, fees_note: '' } }), 'owner', draftOptions);
  assert.equal(second.revision, 2); assert.equal(second.calculation.reimbursement_minor, 15000);
});

test('concurrent first save and audit errors never overwrite or partially save a draft', async () => {
  const { db, sqlite } = database();
  const results = await Promise.allSettled([saveIgorDraft(db, draft(), 'one', draftOptions), saveIgorDraft(db, draft(), 'two', draftOptions)]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.status, 409);
  const broken = { ...db, batch: statements => db.batch([...statements, { sql: 'INSERT INTO absent VALUES(1)', args: [] }]) };
  await assert.rejects(saveIgorDraft(broken, draft({ month: '2026-08' }), 'one', draftOptions));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM accounting_igor_drafts WHERE month='2026-08'").get().n, 0);
});

test('first of month has no completed-day bill; schema independently rejects bad inputs', async () => {
  const { db, sqlite } = database();
  const result = await readIgorDraft(db, '2026-10', { now: new Date('2026-09-30T21:01:00.000Z') });
  assert.equal(result.advertising.through, null); assert.equal(result.calculation.reimbursement_minor, null);
  const insert = sqlite.prepare('INSERT INTO accounting_igor_drafts(month,fees_minor,fees_note,revision,updated_at,updated_by,save_id) VALUES(?,?,?,1,?,?,?)');
  for (const month of ['2026-00', '2026-13', '2026-2', '2019-12']) assert.throws(() => insert.run(month, 0, '', 'now', 'a', month));
  assert.throws(() => insert.run('2026-09', 1, '', 'now', 'a', 'positive-without-note'));
  assert.throws(() => insert.run('2026-09', -1, 'x', 'now', 'a', 'negative'));
  assert.throws(() => insert.run('2026-09', 0.1, 'x', 'now', 'a', 'fraction'));
});

function request(method, body, query = '?month=2026-09', token = 'test-token') {
  return new Request(`https://evline.test/api/admin/accounting/igor${query}`, { method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}

test('API is admin-only, strict, no-store and cannot configure campaigns or make payments', async () => {
  const { db, sqlite } = database(), env = { DB: db, ADMIN_TOKEN: 'test-token' };
  assert.equal((await onRequestGet({ request: request('GET', undefined, '?month=2026-09', ''), env, now })).status, 401);
  assert.equal((await onRequestPut({ request: request('PUT', draft(), '', ''), env, now })).status, 401);
  for (const query of ['', '?month=2026-09&month=2026-09', '?month=2026-09&provider=google']) assert.equal((await onRequestGet({ request: request('GET', undefined, query), env, now })).status, 400);
  for (const body of ['{', { ...draft(), campaigns: [] }, { ...draft(), actor_id: 'spoof' }, { ...draft(), approved: true }]) assert.equal((await onRequestPut({ request: request('PUT', body), env, now })).status, 400);
  const saved = await onRequestPut({ request: request('PUT', draft()), env, now });
  assert.equal(saved.status, 200); assert.equal(saved.headers.get('cache-control'), 'no-store');
  assert.equal((await saved.json()).calculation.status, 'not_configured');
  assert.equal(sqlite.prepare('SELECT updated_by FROM accounting_igor_drafts').get().updated_by, 'andrii');
  assert.equal((await onRequestPut({ request: request('PUT', draft()), env, now })).status, 409);
  assert.equal((await onRequestPut({ request: request('PUT', draft(), '?month=2026-08'), env, now })).status, 400);
  assert.equal(onRequestDelete().status, 405);
});

test('André keeps previous totals until a campaign is mapped, then excludes only covered Google share', async () => {
  const { db, map, zero } = database();
  const report = { daily: Array.from({ length: 9 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, '0')}`, google_uah: 20, meta_uah: 5, google_coverage: 'complete', meta_coverage: 'complete' })), sources: { google: { status: 'complete' }, meta: { status: 'complete' } } };
  const options = { now, accountingReader: async () => structuredClone(report) };
  let andrii = await readProfitDraft(db, '2026-10', options);
  assert.equal(andrii.advertising.google_minor, 18000); assert.equal(andrii.advertising.meta_minor, 4500);
  assert.equal(andrii.advertising.total_minor, 22500); assert.equal('igor_allocation' in andrii.advertising, false);
  map();
  andrii = await readProfitDraft(db, '2026-10', options);
  assert.equal(andrii.advertising.google_minor, null); assert.equal(andrii.advertising.meta_minor, 4500);
  assert.equal(andrii.advertising.total_minor, null); assert.equal(andrii.advertising.coverage, 'partial');
  await persistIgorCampaignSnapshot(db, snapshot(), { now });
  andrii = await readProfitDraft(db, '2026-10', options);
  assert.equal(andrii.advertising.google_minor, 17000); assert.equal(andrii.advertising.meta_minor, 4500);
  assert.equal(andrii.advertising.total_minor, 21500); assert.equal(andrii.advertising.igor_google_excluded_minor, 1000);
  map('meta', '55555'); zero('meta');
  await persistIgorCampaignSnapshot(db, snapshot({ provider: 'meta', account_id: accounts.meta, campaign_id: '55555', source: 'meta_insights' }), { now });
  andrii = await readProfitDraft(db, '2026-10', options);
  assert.equal(andrii.advertising.meta_minor, 4500); // no subtraction from a disjoint campaign
});

test('Igor daily cost above inclusive Google total blocks André instead of making negative cost', async () => {
  const { db, map } = database(); map();
  await persistIgorCampaignSnapshot(db, snapshot({ days: [{ date: range.from, spend_minor: 1001, is_final: true }, { date: range.to, spend_minor: 0, is_final: true }] }), { now });
  const options = { now, accountingReader: async () => ({ daily: [{ date: range.from, google_uah: 10, meta_uah: 5, google_coverage: 'complete', meta_coverage: 'complete' }, { date: range.to, google_uah: 100, meta_uah: 5, google_coverage: 'complete', meta_coverage: 'complete' }], sources: { google: { status: 'complete' }, meta: { status: 'complete' } } }) };
  const result = await readProfitDraft(db, '2026-10', options);
  assert.equal(result.advertising.google_minor, null); assert.equal(result.advertising.total_minor, null);
  assert.equal(result.advertising.igor_allocation, 'incomplete');
});

test('saved André snapshots remain immutable after new Igor allocation is introduced', async () => {
  const { db, map, sqlite } = database();
  const options = { now, accountingReader: async () => ({ daily: [{ date: range.from, google_uah: 100, meta_uah: 50, google_coverage: 'complete', meta_coverage: 'complete' }, { date: range.to, google_uah: 100, meta_uah: 50, google_coverage: 'complete', meta_coverage: 'complete' }], sources: { google: { status: 'complete' }, meta: { status: 'complete' } } }) };
  const result = await saveProfitDraft(db, { month: '2026-10', expected_revision: 0, inputs: { revenue_minor: 100000, purchase_minor: 0, shipping_minor: 0, other_minor: 0, other_note: '' } }, 'owner', options);
  assert.equal(result.advertising.total_minor, 30000);
  map(); await persistIgorCampaignSnapshot(db, snapshot(), { now });
  assert.equal((await readProfitDraft(db, '2026-10', options)).advertising.total_minor, 29000);
  assert.equal(JSON.parse(sqlite.prepare('SELECT snapshot_json FROM accounting_profit_revisions').get().snapshot_json).advertising.total_minor, 30000);
});
