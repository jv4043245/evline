import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { assessMarketCandidate, summarizeMarketItem, reviewMarketResult } from '../assets/js/market-comparison.js';
import { splitRequestedItems } from '../functions/_lib/market-research.js';
import { parseMarketProducts, safeProductUrl, parseMarketPrice } from '../functions/_lib/market-products.js';
import { redactMarketText, enrichMarketItems, reviewMarketCandidates } from '../functions/_lib/market-query.js';
import { fetchMarketPage, researchMarketItems } from '../functions/_lib/market-fetch.js';
import { saveMarketFeedback, hydrateMarketResult, offerIdentity } from '../functions/_lib/market-feedback.js';

const item = { key: 'one', label: 'Фара передня права', car: 'BYD Yuan Pro 2023', part_numbers: ['13158405-00'] };
const product = extra => ({ item_key: item.key, title: 'Фара передня права BYD Yuan Pro', article: '13158405-00', part_number: '13158405-00', source_key: 'seller', product_url: 'https://shop.example/part', verified_product: true, currency: 'UAH', price_uah: 10000, part_type: 'original', availability: 'in_stock', ...extra });
for (const [label, title, field] of [
  ['wrong side', 'Фара передня ліва BYD Yuan Pro', 'side'], ['same brand wrong model', 'Фара права BYD Song Plus', 'model'],
  ['wrong brand', 'Фара права BMW X5', 'brand'], ['rear light', 'Ліхтар задній правий BYD Yuan Pro', 'category'],
  ['glass only', 'Скло фари праве BYD Yuan Pro', 'category'], ['bracket only', 'Кронштейн фари правий BYD Yuan Pro', 'category'],
  ['fog lamp', 'Фара протитуманна права BYD Yuan Pro', 'category'], ['pair', 'Комплект фар правих BYD Yuan Pro', 'quantity'],
]) test(`rejects ${label} even when a code matches`, () => {
  const result = assessMarketCandidate(product({ title }), item);
  assert.equal(result.match_type, 'irrelevant'); assert.ok(result.conflicts.includes(field));
});
test('trim is not the parent bumper and lamp module is not a headlamp', () => {
  assert.equal(assessMarketCandidate(product({ title: 'Бампер передній BYD Yuan Plus' }), { ...item, car: 'BYD Yuan Plus', label: 'Накладка переднього бампера' }).match_type, 'irrelevant');
  assert.equal(assessMarketCandidate(product({ title: 'Блок розпалу фари BYD Yuan Pro' }), item).match_type, 'irrelevant');
});
test('exact code requires product-page evidence; title boundaries preserve suffix', () => {
  assert.equal(assessMarketCandidate(product({ verified_product: false }), item).match_type, 'probable');
  for (const code of ['13158405-001', '13158405-00-A']) assert.equal(assessMarketCandidate(product({ article: code, part_number: code, title: `Фара права BYD Yuan Pro ${code}` }), item).match_type, 'probable');
  assert.equal(assessMarketCandidate(product({ article: 'OTHER123', part_number: 'OTHER123', context: '13158405-00' }), item).match_type, 'probable');
  assert.equal(assessMarketCandidate(product({ article: 'SC2E-4121020', cross_numbers: ['13158405-00'] }), item).match_type, 'exact');
});
test('fitment range rejects a different year while unknown fitment is not invented', () => {
  assert.equal(assessMarketCandidate(product({ fitment: 'BYD Yuan Pro 2019-2021' }), item).match_type, 'irrelevant');
  assert.equal(assessMarketCandidate(product({ article: '', part_number: '', fitment: '' }), item).match_type, 'probable');
});
test('structured used condition and attribute-only technology affect comparison', () => {
  assert.equal(assessMarketCandidate(product({ condition: 'used' }), { ...item, label: 'Нова фара права' }).match_type, 'irrelevant');
  const rows = [product({ match_type: 'exact', attributes_text: 'LED' }), product({ match_type: 'exact', attributes_text: 'Matrix', source_key: 'other' })];
  assert.equal(summarizeMarketItem(item, rows).groups.length, 2);
});
test('price is scoped to its card and unknown currency is never UAH', () => {
  const rows = parseMarketProducts('generic', '<article><a href="/lamp">Фара BYD</a><span>20000 грн</span></article><article><a href="/clip">Кліпса BYD</a><span>50 грн</span></article>', 'https://shop.example/search');
  assert.equal(rows.find(row => row.product_url.endsWith('/clip')).price_uah, 50);
  for (const curr of ['USD', 'EUR', '']) {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Фара","offers":{"price":500,"priceCurrency":"${curr}"}}</script>`;
    const row = parseMarketProducts('generic', html, 'https://shop.example/part', { productPage: true })[0];
    assert.equal(row.price_uah, 0);
  }
  for (const [s, n] of [['1,500.50', 1500.5], ['1.500,50', 1500.5], ['1 500 грн', 1500]]) assert.equal(parseMarketPrice(s), n);
});
test('missing inventory does not promise made-to-order; script prices need currency', () => {
  const row = parseMarketProducts('evox', '<script>var products = [{"title":"Фара BYD","article":"ABC12345","price":1500,"url":"/part"}];</script>', 'https://shop.example/search')[0];
  assert.equal(row.availability_text, ''); assert.equal(row.price_uah, 0); assert.equal(row.verified_product, false);
});
test('cross references are read from product properties, not neighboring cards', () => {
  const html = '<h1>Фара права BYD Yuan Pro</h1><script type="application/ld+json">{"@type":"Product","name":"Фара права BYD Yuan Pro","sku":"SC2E-4121020","url":"https://shop.example/part","offers":{"price":10000,"priceCurrency":"UAH"}}</script><table><tr><td>Кросномер</td><td>13158405-00</td></tr></table><article><a href="/other">Кліпса</a><table><tr><td>Кросномер</td><td>UNRELATED123</td></tr></table><span>50 грн</span></article>';
  const row = parseMarketProducts('generic', html, 'https://shop.example/part', { productPage: true })[0];
  assert.deepEqual(row.cross_numbers, ['13158405-00']);
  assert.equal(assessMarketCandidate(row, item).match_type, 'exact');
});
test('visible delivery terms cannot be overwritten by contradictory structured stock', async () => {
  const html = '<h1>Фара права BYD Yuan Pro</h1><script type="application/ld+json">{"@type":"Product","name":"Фара права BYD Yuan Pro","sku":"13158405-00","url":"https://shop.example/part","offers":{"price":10000,"priceCurrency":"UAH","availability":"https://schema.org/InStock"}}</script><div class="detail__availability-txt">Поставка 90 днів</div><div class="detail__info-item"><div class="detail__info-item-title">Якість</div><div class="detail__info-item-desc">Оригінал</div></div>';
  const row = parseMarketProducts('mahina', html, 'https://shop.example/part', { productPage: true })[0];
  assert.equal(row.availability_conflict, true);
  assert.equal(row.availability_text, 'Поставка 90 днів');
  assert.equal(row.attributes_text, 'Оригінал');
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(html);
  try {
    const { offers } = await researchMarketItems([item], [{ key: 'mahina', name: 'Mahina', home: 'https://shop.example/', search: () => 'https://shop.example/search' }]);
    assert.equal(offers[0].availability, 'unknown');
    assert.equal(offers[0].lead_time_min, 90);
    assert.equal(offers[0].part_type, 'original');
  } finally { globalThis.fetch = fetch; }
});
test('unknown Prom merchant is not attributed to ZEVS', () => {
  assert.equal(parseMarketProducts('zevs', '<article><a href="/other">Фара</a><span>1500 грн</span></article>', 'https://prom.ua/ua/search').length, 0);
});
test('private text is removed without destroying the article or multiple requested parts', () => {
  const vin = 'LCOCH4SDXR6014628';
  const source = `13158405-00 ${vin} +380960515443 test@example.org @person`;
  assert.equal(redactMarketText(source).trim(), '13158405-00');
  const rows = splitRequestedItems({ car: 'BYD Yuan Plus', item_name: 'Бампер і дві передні фари' });
  assert.equal(rows.length, 2);
  const unknownVin = splitRequestedItems({ item_name: 'Фара', request_text: vin });
  assert.deepEqual(unknownVin[0].part_numbers, []);
});
test('currency, uncertain matches and duplicate sellers cannot distort the median', () => {
  const rows = [product({ match_type: 'exact' }), product({ match_type: 'exact', price_uah: 20000 }), product({ match_type: 'probable', price_uah: 1 }), product({ match_type: 'exact', currency: 'USD', price_uah: 100 })];
  const result = summarizeMarketItem(item, rows);
  assert.equal(result.median_uah, 10000); assert.equal(result.groups[0].seller_count, 1); assert.equal(result.confidence, 'low');
  assert.equal(summarizeMarketItem(item, rows, { partType: 'oem' }).median_uah, 0);
});
test('old cache loses green status but rejected evidence remains inspectable', () => {
  const result = reviewMarketResult({ items: [item] }, [product({ verified_product: false, match_type: 'exact' }), product({ title: 'Фара ліва', match_type: 'exact' })]);
  assert.deepEqual(result.offers.map(row => row.match_type), ['probable', 'irrelevant']);
  assert.equal(result.summary.items[0].median_uah, 0);
});
test('AI cannot invent item names and degrades safely on failure', async () => {
  const rows = [{ ...item, label: 'Потрібна допомога з визначенням невідомої деталі для автомобіля, яка не має назви у заявці' }];
  const out = await enrichMarketItems({ AI: { run: async () => ({ response: JSON.stringify({ items: [{ key: item.key, spans: ['Фара BMW X5'] }] }) }) } }, rows);
  assert.deepEqual(out.items, rows);
  const failed = await enrichMarketItems({ AI: { run: async () => { throw Error('offline'); } } }, rows);
  assert.equal(failed.ai_status, 'unavailable'); assert.deepEqual(failed.items, rows);
});
test('AI conflicts need verbatim evidence and can only downgrade, not confirm', async () => {
  const rows = [product()];
  const fake = await reviewMarketCandidates({ AI: { run: async () => ({ response: JSON.stringify({ reviews: [{ index: 0, reason: 'fitment', request_quote: 'BMW', product_quote: 'Toyota' }] }) }) } }, [item], rows);
  assert.deepEqual(fake, rows);
  const real = await reviewMarketCandidates({ AI: { run: async () => ({ response: JSON.stringify({ reviews: [{ index: 0, reason: 'equipment', request_quote: 'BYD Yuan Pro', product_quote: 'Фара передня' }] }) }) } }, [item], rows);
  assert.equal(real[0].match_type, 'probable'); assert.equal(assessMarketCandidate(real[0], item).match_type, 'probable');
});
test('external redirects and private URLs are rejected without a follow-up request', async () => {
  assert.equal(safeProductUrl('http://127.0.0.1/admin', 'https://shop.example'), '');
  assert.equal(safeProductUrl('https://other.example/part', 'https://shop.example'), '');
  const fetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => { count++; return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } }); };
  try { await assert.rejects(fetchMarketPage('https://shop.example/search', { home: 'https://shop.example/' }, { requests: 0, deadline: Date.now() + 10000 }), /foreign_redirect/); assert.equal(count, 1); }
  finally { globalThis.fetch = fetch; }
});
test('protected and unreadable sources never look like a successful empty search', async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = async url => new Response(String(url).includes('protected') ? '<title>Just a moment</title>' : '<html><h1>Welcome</h1></html>');
  try {
    const result = await researchMarketItems([item], [{ key: 'a', name: 'A', home: 'https://shop.example', search: () => 'https://shop.example/protected' }, { key: 'b', name: 'B', home: 'https://shop.example', search: () => 'https://shop.example/unknown' }]);
    assert.deepEqual(result.sources.map(row => row.status), ['failed', 'unreadable']);
  } finally { globalThis.fetch = fetch; }
});
test('manager rejection is persisted, scoped to the request, audited and reversible', async () => {
  const db = new DatabaseSync(':memory:');
  const env = { DB: { prepare(sql) { let values = []; const s = db.prepare(sql); return { bind(...v) { values = v; return this; }, async run() { return s.run(...values); }, async all() { return { results: s.all(...values) }; } }; } } };
  const result = { run: { id: 'test' }, summary: { items: [item] }, offers: [product()] };
  const key = offerIdentity(result.offers[0]);
  const marked = await saveMarketFeedback(env, result, { offer_key: key, reason: 'model' }, 'ihor');
  assert.equal(marked.offers[0].match_type, 'irrelevant');
  assert.equal(marked.offers[0].feedback.actor, 'ihor');
  assert.equal((await hydrateMarketResult(env, { items: [{ ...item, car: 'Another car' }] }, result.offers)).offers[0].feedback, null);
  const restored = await saveMarketFeedback(env, result, { offer_key: key, undo: true }, 'owner');
  assert.equal(restored.offers[0].match_type, 'exact');
  await assert.rejects(saveMarketFeedback(env, result, { offer_key: 'fake' }, 'owner'));
  db.close();
});
