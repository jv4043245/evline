import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet } from '../functions/api/admin/google-ads/keywords.js';

const keyword = (extra = {}) => ({
  level: 'keyword', campaign: '101', campaign_id: '101', campaign_name: 'RU',
  ad_group_id: '201', criterion_id: '301', keyword_text: 'byd запчасти', match_type: 'PHRASE',
  spend_uah: 600, clicks: 20, impressions: 200, google_conversion_value: 0, ...extra,
});
const lead = (extra = {}) => ({ source: 'google', campaign: '101', term: 'byd запчасти', leads: 12, ...extra });
const order = (extra = {}) => ({ source: 'google', campaign: '101', term: 'byd запчасти', orders: 12,
  paid_orders: 1, completed_orders: 0, revenue_uah: 0, gross_profit_uah: 0, ...extra });

async function report({ stats = [keyword()], leads = [lead()], orders = [order()], candidates = stats,
  params = 'range=all', format } = {}) {
  const queries = [];
  const env = { DB: { prepare(sql) {
    const query = { sql, binds: [] }; queries.push(query);
    return { bind(...binds) { query.binds = binds; return this; }, async all() {
      if (/SELECT DISTINCT/.test(sql)) return { results: candidates.filter(row => row.level === 'keyword') };
      if (/FROM google_ads_keyword_stats/.test(sql)) return { results: stats };
      if (/FROM leads/.test(sql)) return { results: leads };
      if (/FROM orders/.test(sql)) return { results: orders };
      throw new Error('unexpected query');
    } };
  } } };
  const response = await onRequestGet({ request: new Request(`https://example.test/api?${params}${format ? '&format='+format : ''}`), env });
  return { data: format === 'csv' ? await response.text() : await response.json(), queries };
}

test('paid customer with unfilled financials is never a negative candidate', async () => {
  const { data } = await report();
  const row = data.keywords[0];
  assert.equal(row.paid_orders, 1);
  assert.equal(row.recommendation.code, 'review');
  assert.equal(row.recommendation.label, 'Перевірити економіку');
  assert.equal(row.value_uah, null);
  assert.equal(row.profit_roas, null);
  assert.equal(data.summary.negative_candidates, 0);
});

test('unknown outcomes and lost tracking are not zero-quality evidence', async () => {
  const { data } = await report({ leads: [], orders: [] });
  assert.equal(data.keywords[0].leads, null);
  assert.equal(data.keywords[0].paid_orders, null);
  assert.equal(data.keywords[0].crm_metrics_available, false);
  assert.equal(data.keywords[0].recommendation.code, 'review');
  assert.equal(data.summary.negative_candidates, 0);
});

test('Google value never substitutes for unknown or zero CRM margin', async () => {
  const { data } = await report({ stats: [keyword({ google_conversion_value: 10000 })] });
  assert.equal(data.keywords[0].google_conversion_value, 10000);
  assert.equal(data.keywords[0].gross_profit_uah, 0);
  assert.equal(data.keywords[0].value_uah, null);
  assert.equal(data.summary.scale_candidates, 0);
});

test('positive recorded profit cannot trigger scaling without verified completeness', async () => {
  const { data } = await report({ orders: [order({ revenue_uah: 10000, gross_profit_uah: 9000 })] });
  assert.equal(data.keywords[0].gross_profit_uah, 9000);
  assert.equal(data.keywords[0].recommendation.code, 'review');
  assert.equal(data.summary.scale_candidates, 0);
});

test('different campaigns with identical text never borrow one another’s CRM results', async () => {
  const { data } = await report({ leads: [lead({ campaign: '102' })], orders: [order({ campaign: '102' })] });
  assert.equal(data.keywords[0].crm_metrics_available, false);
  assert.equal(data.keywords[0].leads, null);
  const crm = data.keywords.find(row => row.level === 'utm_term');
  assert.equal(crm.campaign, '102'); assert.equal(crm.leads, 12);
  assert.equal(data.summary.leads, 12);
});

test('an actual search query does not inherit the purchased keyword’s enquiries', async () => {
  const { data } = await report({ stats: [keyword({ level: 'search_term', search_term: 'фара byd song plus' })],
    candidates: [keyword()], params: 'range=all&level=search_term' });
  assert.equal(data.keywords[0].leads, null);
  assert.equal(data.keywords[0].crm_match, 'search_query_unavailable');
  assert.equal(data.keywords.filter(row => row.level === 'utm_term').length, 1);
  assert.equal(data.summary.leads, 12);
  assert.equal(data.summary.spend_uah, 600);
});

test('Exact and Phrase siblings retain one separate CRM aggregate without duplicate totals', async () => {
  const stats = [keyword(), keyword({ criterion_id: '302', match_type: 'EXACT', spend_uah: 100 })];
  const { data } = await report({ stats });
  assert.ok(data.keywords.filter(row => row.level === 'keyword').every(row => row.leads === null));
  assert.equal(data.keywords.filter(row => row.level === 'utm_term').length, 1);
  assert.equal(data.summary.leads, 12);
  assert.equal(data.summary.paid_orders, 1);
  assert.equal(data.summary.spend_uah, 700);
});

test('hidden sibling beyond display limit still blocks false criterion-level attribution', async () => {
  const { data, queries } = await report({ candidates: [keyword(), keyword({ ad_group_id: '202', criterion_id: '302' })],
    params: 'range=all&q=RU&limit=1' });
  assert.equal(data.keywords[0].leads, null);
  const inventory = queries.find(query => /SELECT DISTINCT/.test(query.sql));
  assert.doesNotMatch(inventory.sql, /LIKE|LIMIT/);
});

test('Ads row limit never hides the separate CRM aggregate and missing cost stays unknown', async () => {
  const { data } = await report({ candidates: [keyword(), keyword({ criterion_id: '302', match_type: 'EXACT' })],
    params: 'range=all&limit=1' });
  assert.equal(data.keywords.length, 2);
  const crm = data.keywords.find(row => row.level === 'utm_term');
  assert.equal(crm.leads, 12);
  for (const field of ['spend_uah', 'clicks', 'impressions', 'google_conversions', 'google_conversion_value']) {
    assert.equal(crm[field], null, field);
  }
  assert.equal(data.summary.rows, 2);
  assert.equal(data.summary.stats_limit_reached, true);
  assert.equal(data.limit_applies_to, 'ads_rows');
});

test('all levels summary does not add search-query cost to overlapping keyword cost', async () => {
  const { data } = await report({ stats: [keyword(), keyword({ level: 'search_term', search_term: 'фара byd', spend_uah: 150 })] });
  assert.equal(data.summary.spend_uah, 600);
  assert.equal(data.summary.clicks, 20);
  assert.equal(data.summary.leads, 12);
  assert.equal(data.summary.traffic_level, 'keyword');
  assert.equal(data.summary.coverage, 'loaded_rows');
});

test('paid count uses customer payment_status, not supplier/pipeline milestones', async () => {
  const { queries } = await report();
  const sql = queries.find(query => /FROM orders/.test(query.sql)).sql;
  assert.match(sql, /payment_status = 'paid'/);
  assert.doesNotMatch(sql, /status IN/);
});

test('CRM source predicate requires paid evidence and excludes source-only guesses', async () => {
  const { queries } = await report();
  for (const query of queries.filter(item => /FROM (leads|orders)/.test(item.sql))) {
    assert.match(query.sql, /gclid/); assert.match(query.sql, /gbraid/); assert.match(query.sql, /wbraid/);
    assert.match(query.sql, /LOWER\(COALESCE\(medium/);
    assert.match(query.sql, /COALESCE\(campaign, ''\) <> ''/);
  }
});

test('CSV unknown economics remain empty rather than fabricated zero or Google value', async () => {
  const { data } = await report({ format: 'csv' });
  assert.match(data, /google_conversion_value,value_uah,profit_roas/);
  assert.match(data, /Перевірити економіку/);
  assert.doesNotMatch(data, /Масштабувати|Кандидат у мінус-слова/);
});

test('actual SQL counts customer payment, filters organic guesses and preserves ambiguous CRM totals', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE google_ads_keyword_stats (
    level TEXT, stat_date TEXT, campaign TEXT, campaign_id TEXT, campaign_name TEXT,
    ad_group_id TEXT, ad_group_name TEXT, criterion_id TEXT, keyword_text TEXT, match_type TEXT,
    search_term TEXT, spend_uah REAL, clicks INTEGER, impressions INTEGER, google_conversions REAL,
    google_conversion_value REAL, currency_code TEXT);
    CREATE TABLE leads (created_at TEXT, source TEXT, medium TEXT, campaign TEXT, term TEXT,
      gclid TEXT, gbraid TEXT, wbraid TEXT);
    CREATE TABLE orders (created_at TEXT, source TEXT, medium TEXT, campaign TEXT, term TEXT,
      gclid TEXT, gbraid TEXT, wbraid TEXT, status TEXT, payment_status TEXT,
      revenue_uah REAL, purchase_cost_uah REAL, delivery_cost_uah REAL, customs_cost_uah REAL,
      processing_cost_uah REAL, ad_cost_uah REAL, other_cost_uah REAL);
    INSERT INTO google_ads_keyword_stats VALUES
      ('keyword','2026-11-05','101','101','RU','201','RU group','301','byd запчасти','PHRASE','',600,20,200,0,0,'UAH'),
      ('keyword','2026-11-05','101','101','RU','201','RU group','302','byd запчасти','EXACT','',100,5,50,0,0,'UAH'),
      ('search_term','2026-11-05','101','101','RU','201','RU group','301','byd запчасти','PHRASE','фара byd',150,7,60,0,0,'UAH');
    INSERT INTO leads VALUES
      ('2026-11-05','google','cpc','101','byd запчасти','synthetic-click',NULL,NULL),
      ('2026-11-05','google','organic','101','byd запчасти',NULL,NULL,NULL);
    INSERT INTO orders VALUES
      ('2026-11-05','google','cpc','101','byd запчасти','synthetic-click',NULL,NULL,'paid','unknown',0,0,0,0,0,0,0),
      ('2026-11-05','google','cpc','101','byd запчасти','synthetic-click',NULL,NULL,'new','paid',1000,500,0,0,0,0,0);`);
  const env = { DB: { prepare(sql) { const stmt = db.prepare(sql); let binds = [];
    return { bind(...args) { binds = args; return this; }, async all() { return { results: stmt.all(...binds) }; } };
  } } };
  try {
    const response = await onRequestGet({ request: new Request('https://example.test/api?range=all'), env });
    const data = await response.json();
    assert.equal(data.migration_required, false);
    assert.equal(data.summary.spend_uah, 700);
    assert.equal(data.summary.leads, 1);
    assert.equal(data.summary.paid_orders, 1);
    assert.equal(data.keywords.filter(row => row.level === 'utm_term').length, 1);
    assert.ok(data.keywords.filter(row => row.level !== 'utm_term').every(row => row.leads === null));
  } finally { db.close(); }
});
