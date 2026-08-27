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
  runMarketResearch,
  splitRequestedItems,
  summarizeOffers,
} from "../functions/_lib/market-research.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const adminJs = await readFile(path.join(root, "admin/admin.js"), "utf8");
const routeJs = await readFile(path.join(root, "functions/api/admin/orders/[id]/market-research.js"), "utf8");
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
    this.database.exec(sql);
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
  assert.equal(classifyMatch({ title: "Бампер BYD Yuan Pro", article: "11515426-00", context: "" }, item), "exact");
  assert.equal(classifyMatch({ title: "Бампер BYD Yuan Pro", article: "", context: "" }, item), "probable");
  assert.equal(classifyMatch({ title: "Фара Zeekr 001", article: "", context: "" }, item), "irrelevant");
});

test("three exact offers are required for a confident price corridor", () => {
  const item = { key: "item-1", label: "Бампер", query: "11515426-00", part_numbers: ["11515426-00"] };
  const offer = (price, matchType = "exact") => ({ item_key: item.key, price_uah: price, match_type: matchType });
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
    <script>var products = [{"title":"Бампер BYD Yuan Pro","article_for_display":"11515426-00","price":"18400","url":"/bumper","in_stock":true}];</script>
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
    return new Response(`<script type="application/ld+json">{
      "@type":"Product",
      "name":"Бампер BYD Yuan Pro",
      "sku":"11515426-00",
      "url":"https://seller.example/11515426-00",
      "offers":{"price":"18000","availability":"in stock"}
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
