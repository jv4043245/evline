import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readAndriiAdvertising } from '../functions/_lib/accounting-andrii.js';
import { onRequestGet, onRequestPost, onRequestPut, onRequestDelete } from '../functions/api/admin/accounting/andrii.js';

const now = new Date('2026-10-10T12:00:00.000Z');
const accounts = { google: '4028488894', meta: '1354524650161143' };
const inactive = async () => ({ active: false, coverage: 'complete', total_minor: 0, daily: [] });
const day = (date, google = 10, meta = 5, googleCoverage = 'complete', metaCoverage = 'complete') => ({
  date, google_uah: google, meta_uah: meta, google_coverage: googleCoverage, meta_coverage: metaCoverage,
});
const options = (daily, patch = {}) => ({ from: '2026-09-30', to: '2026-10-01', now,
  accountingReader: async () => ({ daily }), allocationReader: inactive, ...patch });

test('arbitrary dates are inclusive, clipped to selection and grouped without full-month leakage', async () => {
  const report = await readAndriiAdvertising(null, options([
    day('2026-09-29', 900), day('2026-09-30', 10.01, 0.02), day('2026-10-01', 0.02, 1.03), day('2026-10-02', 900),
  ]));
  assert.equal(report.scope, 'andrii'); assert.equal(report.currency, 'UAH');
  assert.equal(report.google_minor, 1003); assert.equal(report.meta_minor, 105); assert.equal(report.total_minor, 1108);
  assert.equal(report.coverage, 'complete'); assert.equal(report.igor_google_excluded_minor, 0);
  assert.deepEqual(report.daily.map(row => row.date), ['2026-09-30', '2026-10-01']);
  assert.deepEqual(report.monthly.map(row => [row.month, row.from, row.to, row.total_minor]), [
    ['2026-09', '2026-09-30', '2026-09-30', 1003], ['2026-10', '2026-10-01', '2026-10-01', 105],
  ]);
});

test('unknown and legacy partial costs never become final or zero totals', async () => {
  const report = await readAndriiAdvertising(null, options([day('2026-09-30', 10, 0, 'partial'), day('2026-10-01', null, 5)]));
  assert.equal(report.google_minor, null); assert.equal(report.google_known_minor, 1000);
  assert.equal(report.meta_minor, 500); assert.equal(report.total_minor, null); assert.equal(report.known_total_minor, 1500);
  assert.equal(report.coverage, 'partial'); assert.equal(report.providers.google.days_present, 1);
  const missing = await readAndriiAdvertising(null, options([]));
  assert.equal(missing.coverage, 'missing'); assert.equal(missing.known_total_minor, null);
  const zero = await readAndriiAdvertising(null, options([day('2026-09-30', 0, 0), day('2026-10-01', 0, 0)]));
  assert.equal(zero.total_minor, 0); assert.equal(zero.coverage, 'complete');
});

test('current day is clipped using Kyiv calendar boundaries, and today-only does not issue a ledger read', async () => {
  const calls = [];
  const readers = { accountingReader: async (_db, range) => { calls.push(range); return { daily: [day('2026-10-09')] }; }, allocationReader: inactive };
  const report = await readAndriiAdvertising(null, { from: '2026-10-09', to: '2026-10-10', now: new Date('2026-10-09T21:01:00.000Z'), ...readers });
  assert.equal(report.requested_to, '2026-10-10'); assert.equal(report.effective_to, '2026-10-09');
  assert.equal(report.is_provisional, true); assert.equal(calls[0].to, '2026-10-09');
  const empty = await readAndriiAdvertising(null, { from: '2026-10-10', to: '2026-10-10', now, ...readers });
  assert.equal(empty.effective_from, null); assert.equal(empty.through, null); assert.equal(empty.total_minor, null);
  assert.equal(empty.providers.google.days_expected, 0); assert.equal(calls.length, 1);
});

test('date validation rejects reversed, invalid, future, absent and overly long dates', async () => {
  for (const patch of [{ from: null }, { to: null }, { from: '2026-02-30' }, { from: '2026-10-02' }, { to: '2026-10-11' }, { from: '2020-01-01' }]) {
    await assert.rejects(readAndriiAdvertising(null, options([], patch)), { status: 400 });
  }
});

test('Romania share is subtracted exactly once by day and not from disjoint Meta scope', async () => {
  const report = await readAndriiAdvertising(null, options([day('2026-09-30'), day('2026-10-01')], {
    allocationReader: async () => ({ active: true, coverage: 'complete', total_minor: 301,
      daily: [{ date: '2026-10-01', spend_minor: 301, coverage: 'complete' }] }),
  }));
  assert.equal(report.google_minor, 1699); assert.equal(report.meta_minor, 1000); assert.equal(report.total_minor, 2699);
  assert.equal(report.igor_google_excluded_minor, 301); assert.equal(report.monthly[0].google_minor, 1000);
  assert.equal(report.monthly[1].google_minor, 699); assert.equal(report.igor_allocation, 'complete');
});

test('missing Romanian share blocks only unsafe Google days and prevents a misleading final total', async () => {
  const report = await readAndriiAdvertising(null, options([day('2026-09-30'), day('2026-10-01')], {
    allocationReader: async () => ({ active: true, coverage: 'partial', total_minor: null,
      daily: [{ date: '2026-10-01', spend_minor: null, coverage: 'missing' }] }),
  }));
  assert.equal(report.igor_allocation, 'incomplete'); assert.equal(report.google_minor, null);
  assert.equal(report.google_known_minor, 1000); assert.equal(report.known_total_minor, 2000);
  assert.equal(report.total_minor, null); assert.equal(report.daily[1].google_minor, null);
  assert.equal(report.monthly[0].total_minor, 1500); assert.equal(report.monthly[1].total_minor, null);
});

test('Romania share above account total or inconsistent total never becomes a negative or final spend', async () => {
  for (const [share, total] of [[1001, 1001], [300, 301]]) {
    const report = await readAndriiAdvertising(null, options([day('2026-09-30'), day('2026-10-01')], {
      allocationReader: async () => ({ active: true, coverage: 'complete', total_minor: total,
        daily: [{ date: '2026-10-01', spend_minor: share, coverage: 'complete' }] }),
    }));
    assert.equal(report.google_minor, null); assert.equal(report.igor_allocation, 'incomplete');
    assert.equal(report.igor_google_excluded_minor, null); assert.equal(report.daily[1].google_minor, null);
  }
});

test('active allocation with absent or empty daily rows fails closed for every Google day', async () => {
  for (const daily of [undefined, []]) {
    const report = await readAndriiAdvertising(null, options([day('2026-09-30'), day('2026-10-01')], {
      allocationReader: async () => ({ active: true, coverage: 'partial', total_minor: null, daily }),
    }));
    assert.equal(report.igor_allocation, 'incomplete'); assert.equal(report.google_minor, null);
    assert.equal(report.google_known_minor, null); assert.equal(report.total_minor, null);
    assert.equal(report.meta_minor, 1000); assert.ok(report.daily.every(row => row.google_minor === null));
  }
});

test('contradictory complete allocation invalidates mapped known rows even when another main day is missing', async () => {
  const report = await readAndriiAdvertising(null, options([day('2026-09-30', null), day('2026-10-01')], {
    allocationReader: async () => ({ active: true, coverage: 'complete', total_minor: 301,
      daily: [{ date: '2026-10-01', spend_minor: 300, coverage: 'complete' }] }),
  }));
  assert.equal(report.igor_allocation, 'incomplete'); assert.equal(report.google_known_minor, null);
  assert.equal(report.daily[1].google_minor, null); assert.equal(report.total_minor, null);
});

test('normal partial allocation preserves individually reconciled mapped days as known, not final, cost', async () => {
  const report = await readAndriiAdvertising(null, options([day('2026-09-30'), day('2026-10-01')], {
    allocationReader: async () => ({ active: true, coverage: 'partial', total_minor: null,
      daily: [{ date: '2026-09-30', spend_minor: 300, coverage: 'complete' }, { date: '2026-10-01', spend_minor: null, coverage: 'missing' }] }),
  }));
  assert.equal(report.igor_allocation, 'incomplete'); assert.equal(report.google_minor, null);
  assert.equal(report.google_known_minor, 700); assert.equal(report.daily[0].google_minor, 700);
  assert.equal(report.total_minor, null);
});

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,created_at TEXT,source TEXT); CREATE TABLE ad_costs(cost_date TEXT,platform TEXT,source TEXT,medium TEXT,spend_uah REAL,notes TEXT,created_at TEXT,updated_at TEXT);');
  for (const file of ['0031_accounting.sql', '0032_accounting_business_scope.sql', '0035_accounting_igor.sql']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const db = { prepare(sql) { return {
    bind(...args) { return { async all() { return { results: sqlite.prepare(sql).all(...args) }; } }; },
    async all() { return { results: sqlite.prepare(sql).all() }; },
  }; } };
  const insert = sqlite.prepare(`INSERT INTO accounting_ad_daily(provider,account_id,stat_date,spend_minor,currency,timezone,scope,coverage,is_final,fetched_at,source,source_ref,run_id)
    VALUES(?,?,?,?,'UAH','Europe/Kyiv',?,'complete',1,'2026-10-10T05:00:00.000Z',?,?,?)`);
  const put = (date, google = 1000, meta = 500) => {
    insert.run('google', accounts.google, date, google, 'account', 'google_ads_script', '', `g-${date}`);
    insert.run('meta', accounts.meta, date, meta, 'campaign', 'meta_ads_manager_csv', 'evline_campaign_120251518463770454', `m-${date}`);
  };
  return { db, sqlite, put };
}

test('real ledger allows a 1/2/3-month comparison and maps only exact Romanian campaign IDs', async () => {
  const { db, sqlite, put } = database();
  for (let date = new Date('2026-07-01T00:00:00.000Z'); date <= new Date('2026-09-30T00:00:00.000Z'); date.setUTCDate(date.getUTCDate() + 1)) put(date.toISOString().slice(0, 10));
  sqlite.exec(`INSERT INTO accounting_igor_campaigns VALUES('google','4028488894','123456','2026-09-30','2026-09-30','now','test');
    INSERT INTO accounting_igor_import_runs VALUES('igor','google','4028488894','123456','2026-09-30','2026-09-30','now','now','complete','google_ads_script','{}');
    INSERT INTO accounting_igor_campaign_daily VALUES('google','4028488894','123456','2026-09-30',100,'complete',1,'now','igor');`);
  for (const [from, days] of [['2026-09-01', 30], ['2026-08-01', 61], ['2026-07-01', 92]]) {
    const report = await readAndriiAdvertising(db, { from, to: '2026-09-30', now });
    assert.equal(report.total_minor, days * 1500 - 100); assert.equal(report.providers.google.days_expected, days);
    assert.equal(report.igor_allocation, 'complete'); assert.equal(report.igor_google_excluded_minor, 100);
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounting_ad_daily').get().n, 184);
});

test('read-only report supports over one year even with an active Romanian mapping', async () => {
  const { db, sqlite } = database();
  sqlite.exec(`INSERT INTO accounting_igor_campaigns VALUES('google','4028488894','123456','2025-01-01',NULL,'now','test');`);
  const result = await readAndriiAdvertising(db, { from: '2025-01-01', to: '2026-10-09', now });
  assert.equal(result.daily.length, 647); assert.equal(result.total_minor, null); assert.equal(result.igor_allocation, 'incomplete');
});

test('endpoint is strict, authenticated, no-store and read-only', async () => {
  const { db } = database(), env = { DB: db, ADMIN_TOKEN: 'test-token' };
  const request = (query, authorized = true) => new Request(`https://evline.test/api/admin/accounting/andrii${query}`, {
    headers: authorized ? { authorization: 'Bearer test-token' } : {},
  });
  const query = '?from=2026-09-01&to=2026-09-30';
  assert.equal((await onRequestGet({ request: request(query, false), env, now })).status, 401);
  for (const suffix of ['', '?from=2026-09-01', `${query}&from=2026-09-01`, `${query}&scope=all`]) {
    assert.equal((await onRequestGet({ request: request(suffix), env, now })).status, 400);
  }
  const response = await onRequestGet({ request: request(query), env, now });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).scope, 'andrii');
  for (const handler of [onRequestPost, onRequestPut, onRequestDelete]) assert.equal(handler().status, 405);
});
