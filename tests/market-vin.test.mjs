import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applyVinModel, marketVinKey, parseVin17Result, planVinLookup, requestVin17, resolveMarketVin, validVin } from '../functions/_lib/market-vin.js';
import { continueMarketLookup, continueMarketResearch, getLatestMarketResearch, runMarketLookup, runMarketResearch, splitRequestedItems } from '../functions/_lib/market-research.js';
import { assessMarketCandidate, canSearchMarketItem, hasMarketIdentity, partTraits, summarizeMarketItem } from '../assets/js/market-comparison.js';
import { marketProgressText } from '../assets/js/market-progress.js';

// Synthetic identifier and credentials; all provider requests are mocked.
const VIN = 'LTEST0000R0000001';
const config = { VIN_LOOKUP_ENABLED: 'true', VIN17_API_USER: 'test-user', VIN17_API_PASSWORD: 'synthetic-only' };
const payload = (models = ['001'], matching = 'exact_match') => ({ code: 1, data: {
  matching_mode: matching, model_year_from_vin: '2024',
  model_list: models.map(model => ({ Brand_en: 'ZEEKR', Series_en: model, Model_en: model })),
} });

function database(t) {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys = ON; CREATE TABLE orders (id TEXT PRIMARY KEY); INSERT INTO orders VALUES ('test')");
  t.after(() => db.close());
  const DB = { prepare(sql) {
    const statement = db.prepare(sql);
    let values = [];
    return { bind(...args) { values = args; return this; },
      async run() { return statement.run(...values); },
      async first() { return statement.get(...values) || null; },
      async all() { return { results: statement.all(...values) }; } };
  }, async batch(statements) { const rows = []; for (const statement of statements) rows.push(await statement.run()); return rows; } };
  return { DB, db };
}

function mockMd5(t) {
  const original = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'digest', (algorithm, data) => {
    if (algorithm !== 'MD5') return original(algorithm, data);
    return Promise.resolve(Uint8Array.from(createHash('md5').update(data).digest()).buffer);
  });
}

test('VIN planning never guesses from a prefix, silently repairs letters or overrides explicit identity', async t => {
  const items = splitRequestedItems({ car: 'ZEEKR', item_name: 'Бампер передній' });
  assert.equal(validVin(VIN.toLowerCase()), true);
  for (const vin of [VIN.slice(0, 8), VIN + '1', VIN.replace('0', 'O'), VIN.replace('0', 'I'), VIN.replace('0', 'Q')]) {
    assert.equal(validVin(vin), false);
    assert.equal(planVinLookup(config, { vin }, items).status, 'invalid_vin');
  }
  assert.equal(planVinLookup(config, {}, items).status, 'missing_vin');
  assert.equal(planVinLookup({}, { vin: VIN }, items).status, 'not_configured');
  assert.equal(planVinLookup(config, { vin: VIN }, items).status, 'pending');
  assert.equal(planVinLookup(config, { vin: VIN }, [{ car: 'ZEEKR 001' }]).status, 'not_needed');
  assert.equal(planVinLookup(config, { vin: VIN }, [{ label: 'Бампер ZEEKR 001' }]).status, 'not_needed');
  assert.equal(planVinLookup(config, { vin: VIN }, [{ part_numbers: ['13158405-00'] }]).status, 'not_needed');
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected external request'); });
  assert.equal((await resolveMarketVin({}, VIN)).status, 'not_configured');
  assert.equal((await resolveMarketVin(config, 'INVALID')).status, 'invalid_vin');
  assert.equal(fetch.mock.callCount(), 0);
});

test('only unanimous exact full-VIN model responses are accepted; trim does not imply equipment', () => {
  const resolved = parseVin17Result(payload(['001', '001']));
  assert.deepEqual(resolved, { status: 'resolved', source: '17VIN', model: 'ZEEKR 001', car: 'ZEEKR 001 2024', year: '2024' });
  assert.equal(parseVin17Result(payload(['001', '007'])).status, 'ambiguous');
  assert.equal(parseVin17Result(payload(['001'], 'inexact_match')).status, 'ambiguous');
  assert.equal(parseVin17Result(payload([])).status, 'not_found');
  assert.equal(parseVin17Result({ code: 1, data: { matching_mode: 'exact_match', model_list: [null] } }).status, 'ambiguous');
  assert.equal(parseVin17Result({ code: 0, msg: 'secret' }).status, 'provider_error');
  assert.equal(parseVin17Result(payload(['001', ''])).status, 'ambiguous');
  const noYear = payload(); delete noYear.data.model_year_from_vin;
  assert.equal(parseVin17Result(noYear).car, 'ZEEKR 001');
  const explicit = { car: 'ZEEKR 007', label: 'Бампер', query: 'ZEEKR 007 Бампер' };
  assert.deepEqual(applyVinModel([explicit], resolved), [explicit]);
});

test('17VIN uses the documented signature over HTTPS POST without VIN or token in URL', async t => {
  mockMd5(t);
  const md5 = value => createHash('md5').update(value).digest('hex');
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.17vin.com:8443/');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['content-type'], 'application/x-www-form-urlencoded');
    const body = new URLSearchParams(options.body);
    assert.deepEqual([...body.keys()].sort(), ['token', 'user', 'vin']);
    assert.equal(body.get('vin'), VIN);
    assert.equal(body.get('user'), config.VIN17_API_USER);
    assert.equal(body.get('token'), md5(md5(config.VIN17_API_USER) + md5(config.VIN17_API_PASSWORD) + `/?vin=${VIN}`));
    assert.ok(!options.body.includes(config.VIN17_API_PASSWORD));
    return Response.json(payload());
  });
  assert.equal((await requestVin17(config, VIN)).status, 'resolved');
});

test('provider errors and oversized responses never expose VIN, credentials or raw HTML', async t => {
  mockMd5(t);
  for (const response of [() => new Response(`<html>${VIN} ${config.VIN17_API_PASSWORD}</html>`), () => new Response('x'.repeat(1000001)), () => new Response(VIN, { status: 500 }), () => { throw new Error(VIN); }]) {
    t.mock.method(globalThis, 'fetch', async () => response());
    assert.deepEqual(await requestVin17(config, VIN), { status: 'provider_error', source: '17VIN' });
  }
});

test('VIN cache keys use the full VIN, reuse results, and detect brand conflicts', async t => {
  mockMd5(t);
  const { DB, db } = database(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(payload()));
  const env = { ...config, DB };
  assert.equal((await resolveMarketVin(env, VIN, 'ZEEKR')).status, 'resolved');
  assert.equal((await resolveMarketVin(env, VIN, 'ZEEKR')).cached, true);
  assert.equal((await resolveMarketVin(env, VIN, 'BYD')).status, 'conflict');
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal((await resolveMarketVin(env, VIN.slice(0, -1) + '2')).status, 'resolved');
  assert.equal(fetch.mock.callCount(), 2);
  const rows = db.prepare('SELECT * FROM market_vin_cache').all();
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.vin_key.length === 64));
  assert.ok(!JSON.stringify(rows).includes(VIN));
  assert.ok(!JSON.stringify(rows).includes(config.VIN17_API_PASSWORD));
});

test('concurrent VIN lookups coalesce and transient failures can recover after expiry', async t => {
  mockMd5(t);
  const { DB, db } = database(t);
  const env = { ...config, DB };
  let release, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  t.mock.method(globalThis, 'fetch', async () => { entered(); return new Promise(resolve => { release = resolve; }); });
  const first = resolveMarketVin(env, VIN);
  await enteredPromise;
  assert.equal((await resolveMarketVin(env, VIN)).status, 'pending');
  release(new Response('Temporary error', { status: 503 }));
  assert.equal((await first).status, 'provider_error');
  assert.equal((await resolveMarketVin(env, VIN)).cached, true);
  db.prepare('UPDATE market_vin_cache SET expires_at = 0').run();
  t.mock.method(globalThis, 'fetch', async () => Response.json(payload()));
  assert.equal((await resolveMarketVin(env, VIN)).status, 'resolved');
});

test('brand-only split requests admit only the correct component as unconfirmed offers without a price aggregate', () => {
  const items = splitRequestedItems({ car: 'ZEEKR', item_name: 'бампер передний, подкрылки 2 шт перед' });
  assert.equal(items.length, 2);
  assert.equal(partTraits(items[0].label).category, 'bumper');
  assert.equal(partTraits(items[1].label).category, 'fender_liner');
  assert.equal(partTraits(items[1].label).quantity, 'set');
  assert.equal(partTraits(items[1].label).position, 'front');
  assert.equal(hasMarketIdentity(items[0]), false); assert.equal(canSearchMarketItem(items[0]), true);
  assert.equal(canSearchMarketItem({ label: 'Бампер' }), false);
  const offer = { title: 'Бампер передній ZEEKR 001', verified_product: true, price_uah: 5000, item_key: items[0].key };
  const classified = { ...offer, ...assessMarketCandidate(offer, items[0]) };
  assert.equal(classified.match_type, 'probable'); assert.equal(classified.match_basis, 'brand_only');
  assert.deepEqual(summarizeMarketItem(items[0], [classified]).groups, []);
  for (const title of ['Ручка передньої двері ZEEKR 001', 'Кронштейн переднього бампера ZEEKR 001', 'Бампер задній ZEEKR 001', 'Бампер передній BYD Yuan Plus']) {
    assert.equal(assessMarketCandidate({ title }, items[0]).match_type, 'irrelevant', title);
  }
  assert.equal(assessMarketCandidate({ title: 'Крило переднє ZEEKR 001' }, items[1]).match_type, 'irrelevant');
});

test('without an account brand search continues, and enabling VIN later invalidates the old result', async t => {
  const { DB } = database(t);
  const order = { id: 'test', car: 'ZEEKR', vin: VIN, item_name: 'бампер передний, подкрылки 2 шт перед' };
  const fetch = t.mock.method(globalThis, 'fetch', async url => {
    assert.ok(!url.includes('17vin.com')); assert.ok(!url.includes(VIN));
    return new Response('<p>Нічого не знайдено</p>');
  });
  assert.equal((await getLatestMarketResearch({ DB }, order)).can_search, true);
  let result = await runMarketResearch({ DB }, order, { incremental: true });
  assert.equal(result.summary.vehicle_lookup.status, 'not_configured');
  assert.equal(result.summary.work.total, 22); assert.equal(fetch.mock.callCount(), 0);
  for (let i = 0; i < 23; i++) result = await continueMarketResearch({ DB }, order, result.run.id);
  assert.equal(result.run.status, 'complete'); assert.equal(result.should_refresh, false);
  assert.equal(fetch.mock.callCount(), 22);
  assert.equal((await getLatestMarketResearch({ ...config, DB }, order)).should_refresh, true);
});

test('VIN resolution is a separate persisted step before competitor queries and never edits the order', async t => {
  mockMd5(t);
  const { DB, db } = database(t);
  const env = { ...config, DB };
  const order = { id: 'test', car: '', vin: VIN, item_name: 'Бампер передній' };
  const before = structuredClone(order);
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(url);
    if (url.includes('17vin.com')) return Response.json(payload());
    assert.ok(!url.includes(VIN));
    assert.match(decodeURIComponent(url), /ZEEKR 001/);
    assert.ok(!url.includes('2024'), 'A catalogue need not put the model year in every product title');
    return new Response('<p>Нічого не знайдено</p>');
  });
  const available = await getLatestMarketResearch(env, order);
  assert.equal(available.can_search, true); assert.equal(urls.length, 0);
  let result = await runMarketResearch(env, order, { incremental: true });
  assert.equal(result.summary.vehicle_lookup.status, 'pending');
  assert.match(marketProgressText(result), /VIN/);
  assert.equal(urls.length, 0, 'Lead seeding must never call the paid VIN API');
  result = await continueMarketResearch(env, order, result.run.id);
  assert.equal(urls.length, 1); assert.equal(result.summary.work.next, 0); assert.equal(result.summary.work.total, 11);
  assert.equal(result.summary.items[0].car, 'ZEEKR 001 2024');
  assert.ok(!JSON.stringify(result.summary).includes(VIN));
  assert.equal(result.summary.vehicle_lookup.source, '17VIN');
  result = await continueMarketResearch(env, order, result.run.id);
  assert.equal(urls.length, 2); assert.equal(result.summary.work.next, 1);
  assert.deepEqual(order, before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 1);
  const changed = await getLatestMarketResearch(env, { ...order, vin: VIN.slice(0, -1) + '2' });
  assert.equal(changed.should_refresh, true);
  assert.notEqual(await marketVinKey(VIN), await marketVinKey(VIN.slice(0, -1) + '2'));
});

test('standalone lookup shares VIN cache; known models and changed VINs do not call the decoder', async t => {
  mockMd5(t);
  const { DB } = database(t);
  const env = { ...config, DB };
  const fetch = t.mock.method(globalThis, 'fetch', async url => url.includes('17vin.com') ? Response.json(payload()) : new Response('<p>Порожньо</p>'));
  for (let i = 0; i < 2; i++) {
    let result = await runMarketLookup(env, { car: 'ZEEKR', vin: VIN, query: 'Бампер', incremental: true });
    result = await continueMarketLookup(env, result.run.id);
    assert.equal(result.summary.vehicle_lookup.status, 'resolved');
    assert.equal(result.summary.items[0].car, 'ZEEKR 001 2024');
  }
  assert.equal(fetch.mock.callCount(), 1);
  const known = await runMarketLookup(env, { car: 'ZEEKR 007', vin: VIN, query: 'Бампер', incremental: true });
  assert.equal(known.summary.vehicle_lookup.status, 'not_needed');
  const order = { id: 'test', car: 'ZEEKR', vin: VIN, item_name: 'Бампер' };
  const pending = await runMarketResearch(env, order, { incremental: true });
  const changed = await continueMarketResearch(env, { ...order, vin: VIN.slice(0, -1) + '2' }, pending.run.id);
  assert.equal(changed.summary.vehicle_lookup.status, 'input_changed');
  assert.equal(fetch.mock.callCount(), 1);
});
