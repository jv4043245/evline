import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  COMPETITOR_SOURCES,
  classifyAvailability,
  classifyMatch,
  extractLeadTime,
  parseSourceHtml,
  attachMarketLookupToOrder,
  listMarketLookups,
  runMarketLookup,
  runMarketResearch,
  splitRequestedItems,
  summarizeOffers,
} from "../functions/_lib/market-research.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const adminJs = await readFile(path.join(root, "admin/admin.js"), "utf8");
const adminCss = await readFile(path.join(root, "admin/admin.css"), "utf8");
const adminHtml = await readFile(path.join(root, "admin/index.html"), "utf8");
const routeJs = await readFile(path.join(root, "functions/api/admin/orders/[id]/market-research.js"), "utf8");
const lookupRouteJs = await readFile(path.join(root, "functions/api/admin/market-search.js"), "utf8");
const lookupMigration = await readFile(path.join(root, "migrations/0024_market_lookup.sql"), "utf8");
const leadsRouteJs = await readFile(path.join(root, "functions/api/leads.js"), "utf8");

class D1Statement {
  constructor(statement) {
    this.statement = statement;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    return this.statement.run(...this.values);
  }

  async first() {
    return this.statement.get(...this.values) || null;
  }

  async all() {
    return { results: this.statement.all(...this.values) };
  }
}

class D1Database {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec("PRAGMA foreign_keys = ON; CREATE TABLE orders (id TEXT PRIMARY KEY);");
  }

  prepare(sql) {
    return new D1Statement(this.database.prepare(sql));
  }

  async exec(sql) {
    // Cloudflare D1 exec() treats each newline-delimited line as a separate query.
    // Keep the test double strict so multiline DDL cannot pass locally and fail in production.
    for (const line of String(sql).split("\n").map((value) => value.trim()).filter(Boolean)) {
      this.database.exec(line);
    }
    return { count: 0, duration: 0 };
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

test("market research starts from all approved competitor sources", () => {
  assert.equal(COMPETITOR_SOURCES.length, 11);
  assert.deepEqual(
    COMPETITOR_SOURCES.map((source) => source.name),
    ["MAHINA", "NCARS", "EVOX", "Kitaec", "Auto-China", "AutoAsia", "EVparts", "Panda Auto Parts", "AsiaParts", "EMOBIL", "ZEVS PARTS"],
  );
  const mahina = new URL(COMPETITOR_SOURCES[0].search('11515426-00'));
  assert.equal(mahina.searchParams.get('query'), '11515426-00');
  assert.equal(mahina.searchParams.get('filters'), '{}');
});

test("AI-cleaned request keeps a stable cache fingerprint", async () => {
  const DB = new D1Database();
  DB.database.exec("INSERT INTO orders (id) VALUES ('qa-cache')");
  const order = { id: 'qa-cache', car: 'BYD Yuan Pro', item_name: 'Добрий день, підкажіть будь ласка ціну і наявність на запчастину: передній бампер для мого автомобіля' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<p>Нічого не знайдено</p>');
  try {
    const AI = { run: async () => ({ response: JSON.stringify({ items: [{ key: 'item-1', spans: ['передній бампер'] }] }) }) };
    const result = await runMarketResearch({ DB, AI }, order);
    assert.equal(result.summary.items[0].label, 'передній бампер');
    assert.equal(result.should_refresh, false);
  } finally { globalThis.fetch = originalFetch; DB.database.close(); }
});

test("search items are separated and VIN identifiers never leave the CRM", () => {
  const vin = "LCOCH4SDXR6014628";
  const items = splitRequestedItems({
    vin,
    car: "BYD Yuan Pro",
    item_name: `Бампер ${vin}; ліва фара; крило`,
  });
  assert.equal(items.length, 3);
  assert.ok(items.every((item) => !item.query.includes(vin)));
  assert.ok(items.every((item) => !item.label.includes(vin)));
});

test("exact OEM match is separated from a probable text match", () => {
  const item = {
    part_numbers: ["11515426-00"],
    item_tokens: ["bumper"],
    car_tokens: ["byd", "yuan", "pro"],
  };
  assert.equal(classifyMatch({ title: "Бампер BYD Yuan Pro", article: "11515426-00", context: "", verified_product: true }, item), "exact");
  assert.equal(classifyMatch({ title: "Бампер BYD Yuan Pro", article: "", context: "" }, item), "probable");
  assert.equal(classifyMatch({ title: "Фара Zeekr 001", article: "", context: "" }, item), "irrelevant");
});

test("three exact offers are required for a confident price corridor", () => {
  const item = { key: "item-1", label: "Бампер", query: "11515426-00", part_numbers: ["11515426-00"] };
  const offer = (price, matchType = "exact") => ({ verified_product: true, currency: "UAH", item_key: item.key, source_key: `seller-${price}`, price_uah: price, match_type: matchType });
  const low = summarizeOffers([item], [offer(1000), offer(1200)]);
  const high = summarizeOffers([item], [offer(1000), offer(1200), offer(1400), offer(900, "probable")]);
  assert.equal(low.items[0].confidence, "low");
  assert.equal(high.items[0].confidence, "high");
  assert.equal(high.items[0].median_uah, 1200);
});

test("availability and promised delivery terms are normalized", () => {
  assert.equal(classifyAvailability("В наявності"), "in_stock");
  assert.equal(classifyAvailability("Під замовлення, 60-90 днів"), "order_needed");
  assert.deepEqual(extractLeadTime("Термін 60-90 днів"), [60, 90]);
});

test("structured competitor payloads yield source-backed offers", () => {
  const html = `
    <meta itemprop="priceCurrency" content="UAH"><script>var products = [{"title":"Бампер BYD Yuan Pro","article_for_display":"11515426-00","price":"18400","url":"/bumper","in_stock":true}];</script>
  `;
  const offers = parseSourceHtml("evox", html, "https://evox.com.ua/search/");
  assert.equal(offers.length, 1);
  assert.equal(offers[0].price_uah, 18400);
  assert.equal(offers[0].article, "11515426-00");
  assert.equal(offers[0].product_url, "https://evox.com.ua/bumper");
});

test("order card exposes the market tab and its protected admin endpoint", () => {
  assert.match(adminJs, /data-order-tab="market"/);
  assert.match(adminJs, /Ринок України/);
  assert.match(adminJs, /\/market-research/);
  assert.match(adminJs, /shipping-pricelist\/pricelist\.json/);
  assert.match(routeJs, /loadOrder/);
  assert.doesNotMatch(routeJs, /recordAuditEvent/);
  assert.match(leadsRouteJs, /context\.waitUntil/);
  assert.match(leadsRouteJs, /runMarketResearch\(env, order\)/);
});

test("market workspace fits the order card without nested tab or shipping overflow", () => {
  assert.match(adminCss, /\.order-detail\s*{[^}]*width:\s*min\(1120px,/s);
  assert.match(adminCss, /\.order-editor__tabs\s*{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)[^}]*overflow:\s*visible/s);
  assert.match(adminCss, /\.market-panel\s*{[^}]*padding:\s*18px/s);
  assert.match(adminCss, /\.shipping-estimate__controls select\s*{[^}]*width:\s*100%[^}]*min-width:\s*0/s);
});

test("manager can launch a market lookup without creating an order", () => {
  assert.match(adminHtml, /data-market-lookup-open/);
  assert.match(adminHtml, /data-market-lookup-panel/);
  assert.match(adminJs, /\/api\/admin\/market-search/);
  assert.match(adminJs, /data-market-lookup-create-order/);
  assert.match(adminJs, /data-market-lookup-attach/);
  assert.match(lookupRouteJs, /runMarketLookup/);
  assert.match(lookupRouteJs, /attachMarketLookupToOrder/);
  assert.match(lookupMigration, /CREATE TABLE IF NOT EXISTS market_lookup_runs/);
  assert.match(adminCss, /\.market-lookup-detail\s*{[^}]*width:\s*min\(1120px,/s);
  assert.match(adminJs, /Артикул[\s\S]*13158405-00/);
  assert.doesNotMatch(adminJs, /назва запчастини необов'язкова/);
});

test("standalone lookup can search by article without a part name", async () => {
  const env = { DB: new D1Database() };
  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(`<div data-company-id="4149823"></div><script type="application/ld+json">{
      "@type":"Product",
      "name":"Верхня накладка переднього бампера BYD Yuan Plus",
      "sku":"13158405-00",
      "url":"${new URL('/13158405-00', url).href}",
      "offers":{"price":"4950","priceCurrency":"UAH","availability":"https://schema.org/InStock"}
    }</script>`, { status: 200, headers: { "content-type": "text/html" } });
  };
  try {
    const lookup = await runMarketLookup(env, { part_number: "13158405-00" });
    assert.equal(lookup.run.status, "complete");
    assert.equal(lookup.run.query, "");
    assert.equal(lookup.run.part_number, "13158405-00");
    assert.equal(lookup.summary.exact_offer_count, 11);
    assert.ok(requestedUrls.length > 0);
    assert.ok(requestedUrls.every((url) => url.includes("13158405-00")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("research persists source-backed offers in D1 and keeps VIN out of outbound URLs", async () => {
  const env = { DB: new D1Database() };
  const order = {
    id: "order-market-test",
    vin: "LCOCH4SDXR6014628",
    car: "BYD Yuan Pro",
    item_name: "Бампер 11515426-00 LCOCH4SDXR6014628",
  };
  await env.DB.prepare("INSERT INTO orders (id) VALUES (?)").bind(order.id).run();
  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(`<div data-company-id="4149823"></div><script type="application/ld+json">{
      "@type":"Product",
      "name":"Бампер BYD Yuan Pro",
      "sku":"11515426-00",
      "url":"${new URL('/11515426-00', url).href}",
      "offers":{"price":"18000","priceCurrency":"UAH","availability":"https://schema.org/InStock"}
    }</script>`, { status: 200, headers: { "content-type": "text/html" } });
  };
  try {
    const result = await runMarketResearch(env, order);
    assert.equal(result.run.status, "complete");
    assert.equal(result.offers.length, 11);
    assert.equal(result.summary.exact_offer_count, 11, JSON.stringify(result.offers));
    assert.equal(result.summary.items[0].confidence, "high");
    assert.ok(requestedUrls.every((url) => !url.includes(order.vin)));
    const runCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM market_research_runs").first();
    const offerCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM market_research_offers").first();
    assert.equal(runCount.count, 1);
    assert.equal(offerCount.count, 11);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("standalone lookup keeps separate history and can be attached to an order", async () => {
  const env = { DB: new D1Database() };
  const order = {
    id: "order-lookup-attach",
    vin: "LCOCH4SDXR6014628",
    car: "BYD Yuan Pro",
    item_name: "Передній бампер",
  };
  await env.DB.prepare("INSERT INTO orders (id) VALUES (?)").bind(order.id).run();
  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(`<div data-company-id="4149823"></div><script type="application/ld+json">{
      "@type":"Product",
      "name":"Передній бампер BYD Yuan Pro",
      "sku":"11515426-00",
      "url":"${new URL('/11515426-00', url).href}",
      "offers":{"price":"18000","priceCurrency":"UAH","availability":"https://schema.org/InStock"}
    }</script>`, { status: 200, headers: { "content-type": "text/html" } });
  };
  try {
    const lookup = await runMarketLookup(env, {
      car: order.car,
      vin: order.vin,
      query: "Передній бампер",
      part_number: "11515426-00",
    });
    assert.equal(lookup.run.status, "complete");
    assert.equal(lookup.offers.length, 11);
    assert.ok(requestedUrls.every((url) => !url.includes(order.vin)));
    const history = await listMarketLookups(env, 12);
    assert.equal(history.length, 1);
    assert.equal(history[0].query, "Передній бампер");

    const attached = await attachMarketLookupToOrder(env, lookup.run.id, order);
    assert.equal(attached.offers.length, 11);
    const linked = await env.DB.prepare("SELECT linked_order_id FROM market_lookup_runs WHERE id = ?").bind(lookup.run.id).first();
    assert.equal(linked.linked_order_id, order.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
