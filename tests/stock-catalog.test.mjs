import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const stock = JSON.parse(await read("scripts/stock-catalog.json"));
const script = await read("assets/js/main.js");
const sitemap = await read("sitemap.xml");
const catalog = "/v-nayavnosti/";
const site = "https://evline.com.ua";
const money = (price) => new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(price) + " грн";
const pathFor = ({ brand, model, sku }) => `${catalog}${brand.toLowerCase()}/${model.toLowerCase()}/${sku.toLowerCase()}/`;
const pathHtml = (path) => read(`.${path}index.html`);

test("catalog is reachable from the home page and lists every product", async () => {
  const homepage = await read("index.html");
  const catalogHtml = await pathHtml(catalog);
  assert.ok(homepage.includes(`href="${catalog}"`));
  assert.ok(sitemap.includes(`<loc>${site + catalog}</loc>`));
  for (const item of stock) {
    assert.ok(catalogHtml.includes(`href="${pathFor(item)}"`));
    assert.ok(catalogHtml.includes(money(item.price)));
  }
});

for (const item of stock) {
  test(`${item.sku}: visible offer matches structured data and canonical URL`, async () => {
    const path = pathFor(item);
    const dom = new JSDOM(await pathHtml(path));
    try {
      const document = dom.window.document;
      const data = JSON.parse(document.querySelector("script[type='application/ld+json']").textContent);
      const product = data["@graph"].find((node) => node["@type"] === "Product");
      assert.equal(product.mpn, item.sku);
      assert.equal(product.offers.priceCurrency, "UAH");
      assert.equal(product.offers.price, item.price.toFixed(2));
      assert.equal(product.offers.availability, `https://schema.org/${item.inStock ? "InStock" : "OutOfStock"}`);
      assert.equal(document.querySelector(".stock-badge").textContent, item.inStock ? "В наявності" : "Немає в наявності");
      assert.equal(document.querySelector(".stock-total").textContent, money(item.price));
      assert.ok(document.querySelector("dl").textContent.includes(item.cross));
      assert.equal(document.querySelector('link[rel="canonical"]').href, site + path);
      assert.ok(sitemap.includes(`<loc>${site + path}</loc>`));
    } finally { dom.window.close(); }
  });
  if (!item.inStock) continue;
  test(`${item.sku}: order form sends the exact part and reports a confirmed CRM save`, async () => {
    const path = pathFor(item);
    const { window } = new JSDOM(await pathHtml(path), { url: site + path, runScripts: "outside-only" });
    try {
      const requests = [];
      window.fetch = async (url, options) => {
        requests.push({ url, payload: JSON.parse(options.body) });
        return { ok: true, json: async () => ({ ok: true, lead_id: "mock-stock-lead" }) };
      };
      window.eval(script);
      const form = window.document.querySelector("form[data-lead-form]");
      form.elements.phone.value = "+380000000000";
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(requests.length, 1);
      const [{ url, payload }] = requests;
      assert.equal(url, "/api/leads");
      assert.equal(payload.type, "parts");
      assert.equal(payload.car, `${item.brand} ${item.model}`);
      assert.equal(payload.part, `${item.name} · ${item.sku}`);
      assert.equal(payload.form_name, `Склад: ${item.sku}`);
      assert.match(form.querySelector("[data-form-message]").textContent, /Заявку збережено/);
    } finally { window.close(); }
  });
}
