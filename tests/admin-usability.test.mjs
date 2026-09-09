import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { compareMarketCandidate, summarizeMarketItem, reviewMarketResult } from '../assets/js/market-comparison.js';
import { buildWhere } from '../functions/api/admin/orders.js';
import { businessWhere } from '../functions/api/admin/summary.js';

const item = { key: 'lamp', label: 'Фара права', part_numbers: ['13158405-00'] };
const offer = (price, overrides = {}) => ({ verified_product: true, currency: 'UAH', item_key: 'lamp', title: 'Фара права 13158405-00', part_number: '13158405-00', match_type: 'exact', part_type: 'original', availability: 'in_stock', price_uah: price, source_key: `seller-${price}`, ...overrides });

test('headlight request rejects wrong side, rear lights, DRLs and fog lights', () => {
  for (const title of ['Фара ліва', 'Левый дневной ходовой огонь', 'Фонарь правый', 'Ліхтар задній правий', 'Фара права протитуманна', 'Фара права ДХО']) {
    assert.equal(compareMarketCandidate({ title }, item), 'irrelevant', title);
  }
  assert.equal(compareMarketCandidate({ title: 'Фара права галоген' }, item), 'probable');
});
test('OEM must come from the product, not adjacent catalogue context or a longer code', () => {
  assert.equal(compareMarketCandidate({ title: 'Фара права', context: '13158405-00' }, item), 'probable');
  assert.equal(compareMarketCandidate({ title: 'Фара права 13158405-001' }, item), 'probable');
  assert.equal(compareMarketCandidate({ title: 'Фара права 13158405-00-A' }, item), 'probable');
  assert.equal(compareMarketCandidate({ title: 'Фара права 13158405 00', verified_product: true }, item), 'exact');
});
test('filters drive displayed and copied statistics, and empty groups clear prices', () => {
  const rows = [offer(100), offer(200), offer(800, { availability: 'order_needed' }), offer(20, { match_type: 'probable' })];
  const selected = summarizeMarketItem(item, rows, { availability: 'in_stock' });
  assert.equal(selected.median_uah, 150);
  assert.equal(selected.offer_count, 3);
  assert.equal(selected.exact_offer_count, 2);
  assert.equal(selected.probable_offer_count, 1);
  assert.equal(summarizeMarketItem(item, rows, { partType: 'oem' }).median_uah, 0);
});
test('unlike types, availability and lamp technologies never share a price corridor', () => {
  for (const extra of [{ part_type: 'oem' }, { availability: 'order_needed' }, { title: 'Фара права матрична 13158405-00' }]) {
    const summary = summarizeMarketItem(item, [offer(100), offer(200, extra)]);
    assert.equal(summary.groups.length, 2);
    assert.equal(summary.median_uah, 0);
  }
  const summary = summarizeMarketItem(item, [offer(10, { match_type: 'probable' })]);
  assert.equal(summary.groups.length, 0);
  assert.equal(summary.min_uah, 0);
});
test('multiple listings by the same seller do not imply three independent sources', () => {
  assert.equal(summarizeMarketItem(item, [100, 200, 300].map((p) => offer(p, { source_key: 'one' }))).confidence, 'low');
});
test('cached unsafe summaries are reclassified without modifying the database', () => {
  const reviewed = reviewMarketResult({ manual_query: true, items: [{ ...item, median_uah: 999 }] }, [offer(100), offer(500, { title: 'Ліва фара 13158405-00' })]);
  assert.equal(reviewed.offers.length, 2);
  assert.equal(reviewed.offers[1].match_type, 'irrelevant');
  assert.equal(reviewed.summary.items[0].median_uah, 100);
  assert.equal(reviewed.summary.manual_query, true);
});
test('work filters execute in SQL before pagination and combine with other filters', () => {
  const { where, binds } = buildWhere(new URL('https://example.test/?range=all&work=overdue&type=parts'));
  assert.match(where, /orders.next_action_at/);
  assert.match(where, /orders.status NOT IN/);
  assert.match(where, /orders.type = \?/);
  assert.match(binds[0], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(binds[1], 'parts');
});
test('only explicitly marked QA sources are excluded from CRM aggregates', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE orders (source TEXT, created_at TEXT)');
  const insert = db.prepare('INSERT INTO orders VALUES (?, ?)');
  for (const source of ['codex_qa', 'CODEX_QA', 'google', 'manual', null]) insert.run(source, '2026-09-06');
  assert.equal(db.prepare(`SELECT count(*) AS n FROM orders ${businessWhere(null)}`).get().n, 3);
  assert.equal(db.prepare(`SELECT count(*) AS n FROM orders ${businessWhere('2026-09-01')}`).get('2026-09-01').n, 3);
  db.close();
});
