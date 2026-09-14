import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adminApiError } from '../assets/js/admin-api-errors.js';
import { calculateAirFreight, airFreightRates, renderAirFreight } from '../assets/js/shipping-air-estimate.js';
import { parseMarketProducts } from '../functions/_lib/market-products.js';

test('Cloudflare 1102 becomes a short actionable error without HTML or visitor data', async () => {
  const response = new Response('<!DOCTYPE html><html><title>Worker exceeded resource limits</title><body>Ray ID: abcdef0123456789-VIE Your IP: 192.0.2.1</body></html>', { status: 500 });
  const message = await adminApiError(response);
  assert.match(message, /ліміт ресурсів/);
  assert.match(message, /abcdef0123456789-VIE/);
  assert.doesNotMatch(message, /<|DOCTYPE|192\.0\.2\.1/);
  assert.ok(message.length < 260);
});

test('API errors preserve business messages but never arbitrary HTML or unbounded bodies', async () => {
  assert.match(await adminApiError(new Response('', { status: 401 })), /токен/);
  assert.match(await adminApiError(new Response('', { status: 429 })), /Забагато/);
  assert.match(await adminApiError(new Response('<html>unavailable</html>', { status: 502 })), /тимчасово/);
  assert.equal(await adminApiError(Response.json({ error: 'Вкажіть запчастину' }, { status: 400 })), 'Вкажіть запчастину');
  const malicious = await adminApiError(Response.json({ error: '<html>secret</html>' }, { status: 500 }));
  assert.doesNotMatch(malicious, /html|secret/);
  assert.ok((await adminApiError(new Response('x'.repeat(50000), { status: 500 }))).length < 200);
});

const rate = { id: 'air', carrier_id: 'carrier', mode: 'air', active: 1, unit: 'kg', currency: 'USD', rate: 11.3, min_weight_kg: 30, min_charge: 0 };
const shipping = { carriers: [{ id: 'carrier', name: 'Test carrier', active: 1 }], rates: [rate] };

test('air freight uses chargeable shipment weight and minimum without sea volume or currency mixing', () => {
  assert.deepEqual(calculateAirFreight(rate, '20'), { billedKg: 30, minimumApplied: true, freight: 339, currency: 'USD' });
  assert.equal(calculateAirFreight(rate, '40.5').freight, 457.65);
  assert.deepEqual(calculateAirFreight({ ...rate, currency: 'UAH', min_charge: 1000 }, 40), { billedKg: 40, minimumApplied: true, freight: 1000, currency: 'UAH' });
  for (const weight of ['', 0, -1, 'x', Infinity, 100001]) assert.equal(calculateAirFreight(rate, weight), null);
  for (const patch of [{ rate: 0 }, { rate: -1 }, { rate: Infinity }, { active: 0 }, { mode: 'sea' }, { unit: 'm3' }, { currency: 'unknown' }, { min_weight_kg: -1 }, { min_charge: -1 }]) assert.equal(calculateAirFreight({ ...rate, ...patch }, 40), null);
});

test('air UI excludes inactive carriers, shows missing tariffs and escapes directory fields', () => {
  assert.equal(airFreightRates(shipping).length, 1);
  assert.equal(airFreightRates({ ...shipping, carriers: [{ ...shipping.carriers[0], active: 0 }] }).length, 0);
  assert.match(renderAirFreight({ carriers: [], rates: [] }), /Немає активного/);
  assert.match(renderAirFreight({ ...shipping, rates: [{ ...rate, rate: 0 }] }, { airWeight: 40 }), /Нульова ставка/);
  const html = renderAirFreight({ ...shipping, carriers: [{ ...shipping.carriers[0], name: '<script>bad</script>' }] }, { airWeight: '" onfocus="bad' });
  assert.doesNotMatch(html, /<script>|value="" onfocus=/);
  assert.match(html, /не на кожну деталь/);
});

test('malformed catalogue containers preserve isolated product prices', () => {
  const cards = Array.from({ length: 100 }, (_, i) => `<article><h2><a href="/part-${i}/">Крило ${i}</a></h2><span class="price">${1000 + i} грн</span></article>`).join('');
  const html = '<div><section>'.repeat(100) + cards;
  const products = parseMarketProducts('test', html, 'https://example.test/');
  assert.equal(products.length, 100);
  products.forEach((row, i) => assert.equal(row.price_uah, 1000 + i));
});

test('catalogue parsing disables costly unclosed-tag reparenting', async () => {
  const code = await readFile(new URL('../functions/_lib/market-products.js', import.meta.url), 'utf8');
  assert.match(code, /parseNoneClosedTags:\s*true/);
});
