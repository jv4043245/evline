import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { accountingDay, accountingRange, buildAccountingReport, legacyGoogleDays, persistAdSpendSnapshot, readAccounting, recordAdSpendImportFailure, validateAdSpendSnapshot } from '../functions/_lib/accounting.js';
import { onRequestGet } from '../functions/api/admin/accounting.js';

const now = new Date('2026-10-09T10:00:00.000Z');
function snapshot(patch = {}) {
  return { provider: 'google', account_id: '4028488894', currency: 'UAH', timezone: 'Europe/Kyiv',
    from: '2026-10-07', to: '2026-10-08', fetched_at: '2026-10-09T05:00:00.000Z',
    scope: 'account', coverage: 'complete', source: 'google_ads_script',
    days: [{ date: '2026-10-07', spend_minor: 12345, is_final: true }, { date: '2026-10-08', spend_minor: 0, is_final: true }], ...patch };
}
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE orders(id TEXT PRIMARY KEY, created_at TEXT, source TEXT, status TEXT); CREATE TABLE ad_costs(cost_date TEXT, platform TEXT, source TEXT, medium TEXT, spend_uah REAL, notes TEXT, created_at TEXT, updated_at TEXT);');
  sqlite.exec(readFileSync(new URL('../migrations/0031_accounting.sql', import.meta.url), 'utf8'));
  const db = { prepare(sql) {
    return { bind(...args) {
      return { sql, args, async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { return { meta: sqlite.prepare(sql).run(...args) }; } };
    }, async all() { return { results: sqlite.prepare(sql).all() }; } };
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = statements.map(({ sql, args }) => ({ meta: sqlite.prepare(sql).run(...args) })); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return { db, sqlite };
}
function historic(date = '2026-10-08', campaign = '123', amount = 10, patch = {}) {
  return { cost_date: date, platform: 'google', source: 'google', medium: 'cpc', spend_uah: amount,
    notes: `Google Ads sync: customerId=4028488894; campaignId=${campaign}; campaignName=Example; adGroupId=-; adGroupName=-; criterionId=-; keyword=-; searchTerm=-; currency=UAH; conversions=0; conversionValue=0; batch=synthetic`,
    updated_at: '2026-10-09T05:00:00.000Z', ...patch };
}

test('default is 30 completed Kyiv days, with DST-safe date grouping', () => {
  assert.deepEqual(accountingRange(null, null, now).dates.length, 30);
  assert.equal(accountingRange(null, null, now).to, '2026-10-08');
  assert.equal(accountingDay('2026-10-08T21:30:00.000Z'), '2026-10-09');
  assert.equal(accountingDay('2026-01-08T21:30:00.000Z'), '2026-01-08');
  assert.equal(accountingDay('2026-01-08T22:30:00.000Z'), '2026-01-09');
  assert.equal(accountingDay('2026-03-29T21:30:00.000Z'), '2026-03-30');
  for (const args of [['2026-02-30', '2026-03-01'], ['2026-10-10', '2026-10-10'], ['2026-10-01', null], ['2024-01-01', '2026-01-01']]) assert.throws(() => accountingRange(...args, now));
});

test('snapshot rejects account/currency/timezone, invalid date/money and duplicate/partial complete rows', () => {
  assert.equal(validateAdSpendSnapshot(snapshot(), { now }).days[1].spend_minor, 0);
  assert.equal(validateAdSpendSnapshot(snapshot({ timezone: 'Europe/Kiev' }), { now }).timezone, 'Europe/Kyiv');
  for (const patch of [{ account_id: '123' }, { currency: 'USD' }, { timezone: 'UTC' }, { scope: 'campaign' }, { source: 'https://secret/token' }, { from: undefined }, { fetched_at: '2026-10-10T05:00:00.000Z' }, { fetched_at: '2026-10-01T05:00:00.000Z' }, { fetched_at: '2026-10-08T05:00:00.000Z' }]) assert.throws(() => validateAdSpendSnapshot(snapshot(patch), { now }));
  for (const money of [-1, 1.1, '10', null, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => validateAdSpendSnapshot(snapshot({ days: [{ date: '2026-10-07', spend_minor: money, is_final: true }] }), { now }));
  assert.throws(() => validateAdSpendSnapshot(snapshot({ days: [snapshot().days[0]] }), { now }));
  assert.throws(() => validateAdSpendSnapshot(snapshot({ days: [snapshot().days[0], snapshot().days[0]] }), { now }));
  assert.throws(() => validateAdSpendSnapshot(snapshot({ to: '2026-10-09', days: [{ date: '2026-10-09', spend_minor: 0, is_final: true }] }), { now }));
});

test('atomic imports are idempotent, accept correction, resist stale/equal updates and partial downgrade', async () => {
  const { db, sqlite } = database();
  assert.equal((await persistAdSpendSnapshot(db, snapshot(), { now })).days_imported, 2);
  assert.equal((await persistAdSpendSnapshot(db, snapshot(), { now })).days_imported, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_import_runs').get().n, 1);
  for (const fetched_at of ['2026-10-09T04:00:00.000Z', '2026-10-09T05:00:00.000Z']) {
    assert.equal((await persistAdSpendSnapshot(db, snapshot({ fetched_at, days: snapshot().days.map(d => ({ ...d, spend_minor: 99 })) }), { now })).days_imported, 0);
  }
  assert.equal((await persistAdSpendSnapshot(db, snapshot({ coverage: 'partial', fetched_at: '2026-10-09T06:00:00.000Z' }), { now })).days_imported, 0);
  assert.equal((await persistAdSpendSnapshot(db, snapshot({ fetched_at: '2026-10-09T06:00:00.000Z', days: snapshot().days.map(d => ({ ...d, spend_minor: 200 })) }), { now })).days_imported, 2);
  assert.equal(sqlite.prepare('SELECT SUM(spend_minor) AS total FROM accounting_ad_daily').get().total, 400);
  const broken = { ...db, async batch(statements) { return db.batch([...statements, { sql: 'INSERT INTO no_such_table VALUES (1)', args: [] }]); } };
  await assert.rejects(persistAdSpendSnapshot(broken, snapshot({ fetched_at: '2026-10-09T07:00:00.000Z' }), { now }));
  assert.equal(sqlite.prepare('SELECT SUM(spend_minor) AS total FROM accounting_ad_daily').get().total, 400);
});

test('legacy fallback dedupes campaign-day, excludes manual/currency/account/keyword rows and preserves unknown', () => {
  const good = historic();
  const rows = [good, historic(undefined, '123', 20, { updated_at: '2026-10-09T06:00:00.000Z' }), historic(undefined, '456', 2),
    { ...good, notes: 'Manual entered' }, { ...good, notes: good.notes.replace('currency=UAH', 'currency=USD') },
    { ...good, notes: good.notes.replace('4028488894', '1234567890') }, { ...good, notes: good.notes.replace('keyword=-', 'keyword=bumper') }];
  assert.equal(legacyGoogleDays(rows).get('2026-10-08').spend_minor, 2200);
  assert.equal(legacyGoogleDays([good, historic(undefined, '123', 12)]).get('2026-10-08').ambiguous, true);
  const impersonation = good.notes.replace('customerId=4028488894', 'customerId=1234567890').replace('campaignName=Example', 'campaignName=Example; customerId=4028488894');
  assert.equal(legacyGoogleDays([{ ...good, notes: impersonation }]).size, 0);
});

test('storage schema rejects invalid dates and noninteger money independently of the helper', () => {
  const { sqlite } = database();
  const insert = sqlite.prepare("INSERT INTO accounting_entries(id,entry_date,category,basis,direction,amount_minor,currency,created_at,updated_at) VALUES(? ,?,'shipping','cash','expense',?,'UAH','now','now')");
  for (const date of ['garbage', '2026-02-30', '2026-13-01']) assert.throws(() => insert.run(date, date, 1));
  assert.throws(() => insert.run('fraction', '2026-10-08', 1.5));
  assert.doesNotThrow(() => insert.run('valid', '2026-10-08', 100));
});

test('report distinguishes known zero, missing and legacy partial, and canonical wins over legacy', async () => {
  const { db, sqlite } = database();
  await persistAdSpendSnapshot(db, snapshot(), { now });
  const rows = sqlite.prepare('SELECT * FROM accounting_ad_daily').all();
  const report = buildAccountingReport({ from: '2026-10-07', to: '2026-10-08', canonical: rows, legacy: [historic()], now });
  assert.equal(report.totals.google_uah, 123.45);
  assert.equal(report.daily[1].google_uah, 0);
  assert.equal(report.daily[1].meta_uah, null);
  assert.equal(report.totals.meta_uah, null);
  assert.equal(report.sources.google.status, 'complete');
  const partial = buildAccountingReport({ from: '2026-10-07', to: '2026-10-08', legacy: [historic()], now });
  assert.equal(partial.sources.google.status, 'partial');
  assert.equal(partial.sources.google.days_present, 1);
  assert.equal(partial.daily[0].google_uah, null);
});

test('read aggregates beyond 200 campaign rows and includes canceled intake but not synthetic tests', async () => {
  const { db, sqlite } = database();
  const put = sqlite.prepare('INSERT INTO ad_costs(cost_date,platform,source,medium,spend_uah,notes,updated_at) VALUES(?,?,?,?,?,?,?)');
  for (let i = 1; i <= 250; i++) { const row = historic('2026-10-08', String(i), 1); put.run(row.cost_date, row.platform, row.source, row.medium, row.spend_uah, row.notes, row.updated_at); }
  const order = sqlite.prepare('INSERT INTO orders VALUES(?,?,?,?)');
  order.run('a', '2026-10-07T21:05:00.000Z', 'google', 'canceled');
  order.run('b', '2026-10-08T20:59:00.000Z', 'google', 'new');
  order.run('c', '2026-10-08T21:00:00.000Z', 'google', 'new');
  order.run('d', '2026-10-08T12:00:00.000Z', 'codex_qa', 'new');
  const report = await readAccounting(db, { from: '2026-10-08', to: '2026-10-08', now });
  assert.equal(report.totals.google_uah, 250);
  assert.equal(report.totals.orders, 2);
  assert.equal(report.sources.google.status, 'partial');
  assert.ok(!JSON.stringify(report).includes('canceled'));
});

test('failed import receipt preserves costs and exposes only a sanitized latest failure', async () => {
  const { db } = database();
  await persistAdSpendSnapshot(db, snapshot(), { now });
  await recordAdSpendImportFailure(db, { provider: 'google', from: '2026-10-07', to: '2026-10-08', source: 'google_ads_script', error_code: 'upstream_unavailable' }, { now });
  const report = await readAccounting(db, { from: '2026-10-07', to: '2026-10-08', now });
  assert.equal(report.totals.google_uah, 123.45);
  // Same recorded timestamp is possible in fixtures; production clocks are unique
  // to attempts. Use a subsequent attempt for unambiguous latest-error evidence.
  await recordAdSpendImportFailure(db, { provider: 'google', from: '2026-10-07', to: '2026-10-08', source: 'google_ads_script', error_code: 'upstream_unavailable' }, { now: new Date(now.getTime() + 1000) });
  assert.equal((await readAccounting(db, { from: '2026-10-07', to: '2026-10-08', now })).sources.google.last_error, 'upstream_unavailable');
  await assert.rejects(recordAdSpendImportFailure(db, { provider: 'meta', from: '2026-10-07', to: '2026-10-08', source: 'meta_insights', error_code: 'secret=https://token' }, { now }));
});

test('API rejects duplicate/unknown params and returns sanitized unavailable instead of database details', async () => {
  const { db } = database();
  for (const query of ['from=2026-10-08', 'from=2026-10-08&to=2026-10-08&from=2026-10-08', 'range=unknown', 'range=all&to=garbage']) {
    assert.equal((await onRequestGet({ request: new Request(`https://evline.com.ua/api/admin/accounting?${query}`), env: { DB: db }, now })).status, 400);
  }
  const response = await onRequestGet({ request: new Request('https://evline.com.ua/api/admin/accounting'), env: { DB: { prepare() { throw new Error('SECRET_SQL'); } } }, now });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'accounting_unavailable');
});

test('all-time resolves earliest data, supports API selection, and declares bounded older history', async () => {
  const { db, sqlite } = database();
  sqlite.prepare('INSERT INTO orders VALUES(?,?,?,?)').run('first', '2026-04-03T12:00:00.000Z', 'google', 'new');
  const report = await readAccounting(db, { range: 'all', to: '2026-10-08', now });
  assert.equal(report.from, '2026-04-03');
  assert.equal(report.to, '2026-10-08');
  assert.equal(report.range_limited, false);
  const response = await onRequestGet({ request: new Request('https://evline.com.ua/api/admin/accounting?range=all&to=2026-10-08'), env: { DB: db }, now });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).from, '2026-04-03');
  sqlite.prepare('INSERT INTO orders VALUES(?,?,?,?)').run('old', '2010-04-03T12:00:00.000Z', 'google', 'new');
  const bounded = await readAccounting(db, { range: 'all', to: '2026-10-08', now });
  assert.equal(bounded.daily.length, 1827);
  assert.equal(bounded.range_limited, true);
});
