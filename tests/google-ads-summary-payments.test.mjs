import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet } from '../functions/api/admin/summary.js';

async function summaryFor(rows) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE leads (created_at TEXT, source TEXT, campaign TEXT, status TEXT, quality TEXT);
    CREATE TABLE orders (created_at TEXT, source TEXT, campaign TEXT, status TEXT, payment_status TEXT,
      revenue_uah REAL DEFAULT 0, purchase_cost_uah REAL DEFAULT 0, delivery_cost_uah REAL DEFAULT 0,
      customs_cost_uah REAL DEFAULT 0, processing_cost_uah REAL DEFAULT 0, ad_cost_uah REAL DEFAULT 0,
      other_cost_uah REAL DEFAULT 0);
    CREATE TABLE ad_costs (cost_date TEXT, source TEXT, campaign TEXT, spend_uah REAL, clicks INTEGER, impressions INTEGER);
    INSERT INTO leads VALUES ('2026-11-05','google','101','new','unknown');
    INSERT INTO ad_costs VALUES ('2026-11-05','google','101',600,20,200);`);
  const insert = db.prepare('INSERT INTO orders(created_at,source,campaign,status,payment_status) VALUES (?,?,?,?,?)');
  for (const [status, payment, source = 'google'] of rows) insert.run('2026-11-05', source, '101', status, payment);
  const env = { DB: { prepare(sql) {
    const stmt = db.prepare(sql); let binds = [];
    return { bind(...args) { binds = args; return this; },
      async first() { return stmt.get(...binds); }, async all() { return { results: stmt.all(...binds) }; } };
  } } };
  try {
    return await (await onRequestGet({ request: new Request('https://example.test/api?range=all'), env })).json();
  } finally { db.close(); }
}

test('campaign and total paid counts use full customer payment, not supplier or workflow status', async () => {
  const data = await summaryFor([
    ['paid','unknown'], ['sourcing_china','unknown'], ['completed','unknown'],
    ['new','paid'], ['sourcing_china','paid'], ['canceled','paid'], ['new','partial'],
  ]);
  assert.equal(data.totals.orders, 7);
  assert.equal(data.totals.completed_orders, 1);
  assert.equal(data.totals.paid_orders, 2);
  assert.equal(data.campaigns[0].paid_orders, 2);
  assert.equal(data.totals.cpa_uah, 300);
  assert.equal(data.campaigns[0].cpa_uah, 300);
});

test('completed but unpaid and refunded orders do not become customer payments', async () => {
  const data = await summaryFor([['completed','unknown'], ['paid','refunded'], ['new','partial']]);
  assert.equal(data.totals.completed_orders, 1);
  assert.equal(data.totals.paid_orders, 0);
  assert.equal(data.campaigns[0].paid_orders, 0);
  assert.equal(data.totals.cpa_uah, 0);
});

test('synthetic QA source remains excluded even when its payment is marked paid', async () => {
  const data = await summaryFor([['new','paid','codex_qa'], ['new','paid']]);
  assert.equal(data.totals.orders, 1);
  assert.equal(data.totals.paid_orders, 1);
  assert.equal(data.campaigns[0].paid_orders, 1);
  assert.equal(data.campaigns.length, 1);
});
