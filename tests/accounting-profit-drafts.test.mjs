import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readProfitDraft, saveProfitDraft, validateProfitDraftInput, validateProfitMonth } from '../functions/_lib/accounting-profit-drafts.js';
import { onRequestGet, onRequestPut } from '../functions/api/admin/accounting/profit.js';

const now = new Date('2026-10-09T12:00:00.000Z');
const inputs = (patch = {}) => ({ revenue_minor: 100000, purchase_minor: 30000, shipping_minor: 10000, other_minor: 5000, other_note: 'Оренда', ...patch });
const payload = (patch = {}) => ({ month: '2026-09', expected_revision: 0, inputs: inputs(), ...patch });
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE orders(id TEXT PRIMARY KEY, created_at TEXT, source TEXT, status TEXT); CREATE TABLE ad_costs(cost_date TEXT, platform TEXT, source TEXT, medium TEXT, spend_uah REAL, notes TEXT, created_at TEXT, updated_at TEXT);');
  for (const file of ['0031_accounting.sql', '0032_accounting_business_scope.sql', '0033_accounting_profit_drafts.sql', '0035_accounting_igor.sql']) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const db = { prepare(sql) {
    return { bind(...args) { return { sql, args, async all() { return { results: sqlite.prepare(sql).all(...args) }; } }; },
      async all() { return { results: sqlite.prepare(sql).all() }; } };
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = statements.map(({ sql, args }) => ({ meta: sqlite.prepare(sql).run(...args) })); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return { db, sqlite };
}
const completeReport = { daily: [{ google_uah: 100, meta_uah: 50, google_coverage: 'complete', meta_coverage: 'complete' }],
  sources: { google: { status: 'complete' }, meta: { status: 'complete' } } };
const options = { now, accountingReader: async () => structuredClone(completeReport) };

test('monthly draft validation is strict and never coerces missing values to zero', () => {
  assert.equal(validateProfitDraftInput(payload(), now).inputs.other_note, 'Оренда');
  for (const month of ['2019-12', '2026-11', '2026-00', '2026-13', '2026-9', null]) assert.throws(() => validateProfitMonth(month, now));
  for (const value of [-1, 1.1, '1', undefined, NaN, Infinity, 100000000001]) assert.throws(() => validateProfitDraftInput(payload({ inputs: inputs({ revenue_minor: value }) }), now));
  assert.equal(validateProfitDraftInput(payload({ inputs: inputs({ revenue_minor: null }) }), now).inputs.revenue_minor, null);
  for (const patch of [{ actor_id: 'spoof' }, { basis: 'cash' }, { advertising_minor: 0 }, { expected_revision: -1 }, { expected_revision: '0' }]) assert.throws(() => validateProfitDraftInput({ ...payload(), ...patch }, now));
  assert.throws(() => validateProfitDraftInput(payload({ inputs: { ...inputs(), hidden: 0 } }), now));
  for (const other_note of ['', ' ', '<script>x</script>', 'x'.repeat(501), '\u202Eoops', '\u0000']) assert.throws(() => validateProfitDraftInput(payload({ inputs: inputs({ other_note }) }), now));
  assert.equal(validateProfitDraftInput(payload({ inputs: inputs({ other_minor: 0, other_note: '' }) }), now).inputs.other_note, '');
  assert.equal(validateProfitDraftInput(payload({ inputs: inputs({ other_minor: null, other_note: '' }) }), now).inputs.other_minor, null);
});

test('new month has revision zero, all manual inputs unknown and no PII', async () => {
  const { db } = database();
  const result = await readProfitDraft(db, '2026-09', options);
  assert.equal(result.revision, 0);
  assert.equal(result.basis, 'paid_and_delivered');
  assert.equal(result.inputs.revenue_minor, null);
  assert.equal(result.calculation.status, 'incomplete');
  assert.equal(result.advertising.total_minor, 15000);
  assert.equal(result.updated_at, null);
  assert.equal(result.is_provisional, false);
  assert.equal('updated_by' in result, false);
});

test('explicit draft and immutable audit save atomically, with exact profit and server actor', async () => {
  const { db, sqlite } = database();
  const result = await saveProfitDraft(db, payload(), 'manager-test-id', options);
  assert.equal(result.revision, 1);
  assert.equal(result.calculation.status, 'draft');
  assert.equal(result.calculation.manager_minor, 6000);
  assert.equal(result.calculation.profit_before_manager_minor, 40000);
  const audit = sqlite.prepare('SELECT * FROM accounting_profit_revisions').get();
  assert.equal(audit.actor_id, 'manager-test-id');
  assert.deepEqual(JSON.parse(audit.snapshot_json), result);
  assert.throws(() => sqlite.exec("UPDATE accounting_profit_revisions SET actor_id='other'"), /immutable/);
  assert.throws(() => sqlite.exec('DELETE FROM accounting_profit_revisions'), /immutable/);
  const saved = await readProfitDraft(db, '2026-09', options);
  assert.deepEqual(saved, result);
});

test('stale CAS, parallel first saves, missing month with nonzero revision do not overwrite or audit', async () => {
  const { db, sqlite } = database();
  const calls = await Promise.allSettled([saveProfitDraft(db, payload(), 'one', options), saveProfitDraft(db, payload(), 'two', options)]);
  assert.equal(calls.filter(call => call.status === 'fulfilled').length, 1);
  assert.equal(calls.find(call => call.status === 'rejected').reason.status, 409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_profit_revisions').get().n, 1);
  await assert.rejects(saveProfitDraft(db, payload({ month: '2026-08', expected_revision: 4 }), 'one', options), { status: 409 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM accounting_profit_drafts WHERE month='2026-08'").get().n, 0);
  const second = await saveProfitDraft(db, payload({ expected_revision: 1, inputs: inputs({ revenue_minor: 200000 }) }), 'one', options);
  assert.equal(second.revision, 2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_profit_revisions').get().n, 2);
  await assert.rejects(saveProfitDraft(db, payload({ expected_revision: 1 }), 'two', options), { status: 409 });
  assert.equal((await readProfitDraft(db, '2026-09', options)).inputs.revenue_minor, 200000);
});

test('audit failure rolls back the draft, not just history', async () => {
  const { db, sqlite } = database();
  const broken = { ...db, batch: statements => db.batch([...statements, { sql: 'INSERT INTO table_does_not_exist VALUES(1)', args: [] }]) };
  await assert.rejects(saveProfitDraft(broken, payload(), 'one', options));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_profit_drafts').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_profit_revisions').get().n, 0);
});

test('partial advertising blocks calculation; later corrections do not rewrite saved audit', async () => {
  const { db, sqlite } = database();
  await saveProfitDraft(db, payload(), 'one', options);
  const partial = await readProfitDraft(db, '2026-09', { now, accountingReader: async () => ({ ...completeReport,
    sources: { google: { status: 'complete' }, meta: { status: 'partial' } } }) });
  assert.equal(partial.advertising.coverage, 'partial');
  assert.equal(partial.advertising.google_minor, 10000);
  assert.equal(partial.advertising.meta_minor, null);
  assert.equal(partial.advertising.total_minor, null);
  assert.equal(partial.calculation.manager_minor, null);
  assert.deepEqual(partial.calculation.missing_keys, ['advertising_minor']);
  assert.equal(JSON.parse(sqlite.prepare('SELECT snapshot_json FROM accounting_profit_revisions').get().snapshot_json).calculation.manager_minor, 6000);
});

test('current month uses yesterday Kyiv, leap month full range, and first day remains unknown', async () => {
  const { db } = database(); const ranges = [];
  const accountingReader = async (database, range) => { ranges.push(range); return completeReport; };
  const current = await readProfitDraft(db, '2026-10', { now, accountingReader });
  assert.equal(current.advertising.through, '2026-10-08');
  assert.equal(current.is_provisional, true);
  assert.equal(current.current_month, true);
  assert.equal(ranges[0].from, '2026-10-01');
  await readProfitDraft(db, '2024-02', { now, accountingReader });
  assert.equal(ranges[1].to, '2024-02-29');
  const first = await readProfitDraft(db, '2026-10', { now: new Date('2026-09-30T21:01:00Z'), accountingReader });
  assert.equal(first.advertising.through, null);
  assert.equal(first.advertising.coverage, 'missing');
  assert.equal(first.calculation.manager_minor, null);
  assert.equal(ranges.length, 2);
});

test('migration independently rejects malformed month, fractional/negative money and missing other note', () => {
  const { sqlite } = database();
  const insert = sqlite.prepare("INSERT INTO accounting_profit_drafts(month,basis,revenue_minor,other_minor,other_note,revision,updated_at,updated_by,save_id) VALUES(?,'paid_and_delivered',?,?,'',1,'now','test',?)");
  for (const month of ['2026-13', '2026-00', '2026-2', '2019-12', '2026-02-02']) assert.throws(() => insert.run(month, 0, 0, month));
  for (const amount of [-1, 0.1, 100000000001]) assert.throws(() => insert.run('2026-09', amount, 0, String(amount)));
  assert.throws(() => insert.run('2026-09', 0, 1, 'note'));
  assert.doesNotThrow(() => insert.run('2026-09', null, null, 'valid'));
});

function request(method, body, { token = 'test-token', query = '', contentType = 'application/json' } = {}) {
  return new Request(`https://evline.test/api/admin/accounting/profit${query}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': contentType }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}

test('API authenticates itself, rejects spoofed actor, malformed payload and duplicate parameters', async () => {
  const { db, sqlite } = database(); const env = { DB: db, ADMIN_TOKEN: 'test-token' };
  assert.equal((await onRequestGet({ request: request('GET', undefined, { token: '', query: '?month=2026-09' }), env, now })).status, 401);
  assert.equal((await onRequestPut({ request: request('PUT', payload(), { token: '' }), env, now })).status, 401);
  for (const query of ['', '?month=2026-09&month=2026-09', '?month=2026-09&who=test', '?month=2027-01']) assert.equal((await onRequestGet({ request: request('GET', undefined, { query }), env, now })).status, 400);
  for (const body of ['{', { ...payload(), actor_id: 'spoof' }, { ...payload(), final: true }]) assert.equal((await onRequestPut({ request: request('PUT', body), env, now })).status, 400);
  assert.equal((await onRequestPut({ request: request('PUT', payload(), { query: '?month=2026-08' }), env, now })).status, 400);
  assert.equal((await onRequestPut({ request: request('PUT', payload(), { contentType: 'text/plain' }), env, now })).status, 400);
  const tooLarge = await onRequestPut({ request: request('PUT', ' '.repeat(8193)), env, now });
  assert.equal(tooLarge.status, 400);
  assert.deepEqual(await tooLarge.json(), { error: 'profit_payload_too_large' });
  const saved = await onRequestPut({ request: request('PUT', payload()), env, now });
  assert.equal(saved.status, 200);
  const data = await saved.json();
  assert.equal(data.calculation.status, 'incomplete');
  assert.equal(data.advertising.total_minor, null);
  assert.equal(sqlite.prepare('SELECT updated_by FROM accounting_profit_drafts').get().updated_by, 'andrii');
  assert.equal(saved.headers.get('cache-control'), 'no-store');
  const conflict = await onRequestPut({ request: request('PUT', payload()), env, now });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: 'accounting_profit_conflict' });
  const get = await onRequestGet({ request: request('GET', undefined, { query: '?month=2026-09' }), env, now });
  assert.equal(get.status, 200); assert.equal((await get.json()).revision, 1);
});

test('real report integration uses only complete business-scoped daily ad facts', async () => {
  const { db, sqlite } = database();
  const insert = sqlite.prepare(`INSERT INTO accounting_ad_daily(provider,account_id,stat_date,spend_minor,currency,timezone,scope,coverage,is_final,fetched_at,source,source_ref,run_id)
    VALUES(?,?,?,?,'UAH','Europe/Kyiv',?,'complete',1,'2026-10-09T05:00:00.000Z',?,?,?)`);
  for (let day = 1; day <= 30; day++) {
    const date = `2026-09-${String(day).padStart(2, '0')}`;
    insert.run('google', '4028488894', date, 1000, 'account', 'google_ads_script', '', `google${day}`);
    insert.run('meta', '1354524650161143', date, 500, 'campaign', 'meta_ads_manager_csv', 'evline_campaign_120251518463770454', `meta${day}`);
  }
  const saved = await saveProfitDraft(db, payload(), 'test', { now });
  assert.deepEqual(saved.advertising, { google_minor: 30000, meta_minor: 15000, total_minor: 45000, coverage: 'complete', through: '2026-09-30' });
  assert.equal(saved.calculation.profit_before_manager_minor, 10000);
  assert.equal(saved.calculation.manager_minor, 1500);
  sqlite.exec("UPDATE accounting_ad_daily SET coverage='partial' WHERE provider='meta' AND stat_date='2026-09-30'");
  const incomplete = await readProfitDraft(db, '2026-09', { now });
  assert.equal(incomplete.advertising.total_minor, null);
  assert.equal(incomplete.calculation.manager_minor, null);
});
