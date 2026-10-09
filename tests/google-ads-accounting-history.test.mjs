import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../docs/google-ads-accounting-history.js', import.meta.url), 'utf8');
function harness({ firstMonth = '2025-04-01', dailyRows = [], preview = false, customer = '402-848-8894', currency = 'UAH', timezone = 'Europe/Kyiv', failQuery = 0, responseCode = 200 } = {}) {
  const queries = [], requests = [], logs = [];
  const context = { Date, Number, Object, JSON, Math, Error, SYNC_TOKEN: 'synthetic-only',
    Utilities: { formatDate: () => '2026-10-09' }, Logger: { log: value => logs.push(value) },
    AdsApp: { currentAccount: () => ({ getCustomerId: () => customer, getCurrencyCode: () => currency, getTimeZone: () => timezone }),
      getExecutionInfo: () => ({ isPreview: () => preview }), search: query => {
        queries.push(query); if (failQuery === queries.length) throw new Error('synthetic query failure');
        let rows;
        if (query.includes('segments.month')) rows = firstMonth ? [{ segments: { month: firstMonth }, metrics: { costMicros: 1000000 } }] : [];
        else {
          const [, from, to] = /BETWEEN '([^']+)' AND '([^']+)'/.exec(query);
          rows = dailyRows.filter(row => row.segments.date >= from && row.segments.date <= to);
        }
        let index = 0; return { hasNext: () => index < rows.length, next: () => rows[index++] };
      } },
    UrlFetchApp: { fetch(url, options) {
      requests.push({ url, ...options }); const payload = JSON.parse(options.payload);
      return { getResponseCode: () => responseCode,
        getContentText: () => JSON.stringify({ ok: true, run_id: 'a'.repeat(64), days_received: payload.days.length, days_imported: payload.days.length }) };
    } },
  };
  vm.runInNewContext(source, context);
  return { run: options => context.evlineAccountingHistory(options), queries, requests, logs, context };
}
const apply = { mode: 'apply', confirm_from: '2025-01-01', confirm_to: '2026-10-08' };

test('default discovery uses monthly-retention query, earliest available month and no POST', () => {
  const h = harness(); const result = h.run();
  assert.equal(h.queries.length, 1);
  assert.match(h.queries[0], /segments.month.*FROM customer/);
  assert.match(h.queries[0], /'2016-01-01'.*ORDER BY segments.month ASC LIMIT 1/);
  assert.equal(result.from, '2025-01-01');
  assert.equal(result.to, '2026-10-08');
  assert.equal(h.requests.length, 0);
});

test('preview and Google Preview execution never import, even apply with exact dates', () => {
  for (const [options, preview] of [[{ mode: 'preview' }, false], [apply, true]]) {
    const h = harness({ preview }); const result = h.run(options);
    assert.equal(result.chunks, 2); assert.equal(result.days, 646);
    assert.equal(h.requests.length, 0);
  }
});

test('historical backfill covers every day with bounded independent snapshots and integer micros rounding', () => {
  const h = harness({ dailyRows: [{ segments: { date: '2025-01-02' }, metrics: { costMicros: '1234567' } }, { segments: { date: '2026-10-08' }, metrics: { costMicros: 2000000 } }] });
  const result = h.run(apply);
  assert.equal(h.requests.length, 2);
  assert.equal(result.spend_minor, 323);
  const payloads = h.requests.map(request => JSON.parse(request.payload));
  assert.equal(payloads[0].days.length, 366);
  assert.equal(payloads[0].days[0].spend_minor, 0);
  assert.equal(payloads[0].days[1].spend_minor, 123);
  assert.equal(payloads[1].days.at(-1).date, '2026-10-08');
  assert.ok(payloads.every(payload => payload.days.length <= 366 && payload.source === 'google_ads_script' && payload.coverage === 'complete' && payload.scope === 'account'));
  assert.ok(h.requests.every(request => request.followRedirects === false && request.url === 'https://evline.com.ua/api/google-ads/accounting'));
  assert.ok(h.logs.every(log => !log.includes('synthetic-only')));
});

test('older retained daily history starts before2025; monthly-only history never becomes zero-filled daily data', () => {
  const recent = harness({ firstMonth: '2024-02-01' });
  assert.equal(recent.run().from, '2024-02-01');
  const older = harness({ firstMonth: '2020-01-01' });
  assert.equal(older.run().needs_monthly_history, true);
  assert.throws(() => older.run({ mode: 'preview' }), /monthly_storage/);
  assert.equal(older.requests.length, 0);
});

test('account, currency, timezone, exact-range confirmation and query failure fail closed before any writes', () => {
  for (const settings of [{ customer: '123' }, { currency: 'USD' }, { timezone: 'UTC' }]) {
    const h = harness(settings); assert.throws(() => h.run(apply)); assert.equal(h.requests.length, 0);
  }
  const unconfirmed = harness(); assert.throws(() => unconfirmed.run({ mode: 'apply' }), /confirmation/); assert.equal(unconfirmed.requests.length, 0);
  for (const failQuery of [1, 2, 3]) {
    const h = harness({ failQuery }); assert.throws(() => h.run(apply)); assert.equal(h.requests.length, 0);
  }
});

test('invalid/duplicate daily costs and HTTP failure abort without leaking upstream body', () => {
  const good = { segments: { date: '2025-01-02' }, metrics: { costMicros: 123 } };
  for (const dailyRows of [[good, good], [{ ...good, metrics: { costMicros: null } }], [{ ...good, metrics: { costMicros: -1 } }]]) {
    const h = harness({ dailyRows }); assert.throws(() => h.run(apply)); assert.equal(h.requests.length, 0);
  }
  const badHttp = harness({ responseCode: 503 }); assert.throws(() => badHttp.run(apply), /history_import_http_503/);
  assert.equal(badHttp.requests.length, 1);
});
