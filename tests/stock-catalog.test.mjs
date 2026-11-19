import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const stock = JSON.parse(await read("scripts/stock-catalog.json"));
const script = await read("assets/js/main.js");
const sitemap = await read("sitemap.xml");
const denza = await read("zapchastyny-denza/index.html");
const catalog = "/v-nayavnosti/";
const site = "https://evline.com.ua";
const money = (price) => new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(price) + " грн";
const pathFor = ({ brand, model, sku }) => `${catalog}${brand.toLowerCase()}/${model.toLowerCase()}/${sku.toLowerCase()}/`;
const pathHtml = (path) => read(`.${path}index.html`);

test("catalog is reachable only from the homepage footer and lists every product", async () => {
  const homepage = await read("index.html");
  const catalogHtml = await pathHtml(catalog);
  const { window } = new JSDOM(homepage);
  try {
    const links = [...window.document.querySelectorAll(`a[href="${catalog}"]`)];
    assert.equal(links.length, 1);
    assert.ok(links[0].closest("footer"));
  } finally { window.close(); }
  assert.ok(sitemap.includes(`<loc>${site + catalog}</loc>`));
  for (const item of stock) {
    assert.ok(catalogHtml.includes(`href="${pathFor(item)}"`));
    assert.ok(catalogHtml.includes(money(item.price)));
    if (item.thumbnail) assert.ok(catalogHtml.includes(`src="${item.thumbnail}"`));
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
      assert.ok(document.title.includes(item.sku));
      const summary = document.querySelector('meta[name="description"]').content;
      assert.ok(summary.includes(item.sku));
      assert.ok(summary.includes(item.cross));
      assert.ok(summary.includes(money(item.price)));
      assert.equal(product.additionalProperty.find((p) => p.name === "Крос-номер")?.value, item.cross);
      assert.equal(product.offers.priceCurrency, "UAH");
      assert.equal(product.offers.price, item.price.toFixed(2));
      assert.equal(product.offers.availability, `https://schema.org/${item.inStock ? "InStock" : "OutOfStock"}`);
      assert.equal(product.offers.itemCondition, item.isNew ? "https://schema.org/NewCondition" : undefined);
      const badges = [...document.querySelectorAll(".stock-badges .stock-badge--attribute")].map((badge) => badge.textContent);
      assert.deepEqual(badges, [item.isGenuine && "Оригінал", item.isNew && "Нова"].filter(Boolean));
      assert.equal(document.querySelector(".stock-placement strong").textContent, item.position);
      const activeWheels = document.querySelectorAll(".stock-placement-car .car-wheel.is-active").length;
      assert.equal(activeWheels, item.placement?.side === "both" ? 2 : 1);
      const copies = [...document.querySelectorAll(".stock-numbers [data-copy]")].map((b) => b.dataset.copy);
      assert.deepEqual(copies, [item.sku, item.cross]);
      const fit = [...document.querySelectorAll(".stock-fit li strong")].map((li) => li.textContent);
      assert.deepEqual(fit, [`${item.brand} ${item.model}`, ...(item.alsoListedFor || [])]);
      assert.ok(document.querySelector(".stock-about p").textContent.includes(item.description));
      assert.ok(document.querySelector('script[src^="/assets/js/stock-card.js"]'));
      if (item.image) {
        assert.equal(product.image, site + item.image);
        assert.equal(document.querySelector("meta[property='og:image']").content, product.image);
        assert.equal(document.querySelector(".stock-stage a").getAttribute("href"), item.image);
        assert.equal(document.querySelector(".stock-stage .stock-image").getAttribute("src"), item.image);
        assert.notEqual(document.querySelector(".stock-vehicle img")?.getAttribute("src"), item.image);
        for (const path of [item.image, item.thumbnail].filter(Boolean)) {
          const png = await readFile(new URL(`.${path}`, root));
          assert.equal(png.subarray(1, 4).toString(), "PNG");
          assert.equal(png[25], 6, "product image has an alpha channel");
        }
        const markingImage = document.querySelector(".stock-marking img");
        assert.equal(markingImage?.getAttribute("src"), item.marking?.src);
        if (item.marking) {
          assert.equal(markingImage.alt, item.marking.alt);
          assert.equal(markingImage.closest("a").getAttribute("href"), item.marking.src);
          assert.equal(markingImage.closest("a").classList.contains("stock-marking-crop"), Boolean(item.marking.tightCrop));
          const jpg = await readFile(new URL(`.${item.marking.src}`, root));
          assert.equal(jpg.readUInt16BE(0), 0xffd8);
        }
      }
      assert.equal(document.querySelector(".stock-badge").textContent, item.inStock ? "В наявності" : "Немає в наявності");
      assert.equal(document.querySelector(".stock-total").textContent, money(item.price));
      assert.ok(document.querySelector("dl").textContent.includes(item.cross));
      assert.equal(document.querySelector('link[rel="canonical"]').href, site + path);
      const sitemapEntry = [...sitemap.matchAll(/<url>[\s\S]*?<\/url>/g)]
        .find(([block]) => block.includes(`<loc>${site + path}</loc>`))?.[0];
      assert.ok(sitemapEntry);
      if (item.image) assert.ok(sitemapEntry.includes(`<image:loc>${site + item.image}</image:loc>`));
      assert.ok(denza.includes(`href="${path}"`));
      assert.equal(product.brand?.name, item.partBrand);
      assert.equal(product.isAccessoryOrSparePartFor?.name, `${item.brand} ${item.model}`);
      assert.match(document.querySelector(".stock-h1-code").textContent, new RegExp(item.sku));
      for (const key of item.demandPages || []) {
        const demand = { "song-l": "zapchastyny-byd/song-l/index.html", suspension: "zapchastyny-byd/pidviska-kermove/index.html" }[key];
        assert.ok((await read(demand)).includes(`href="${path}"`), `${key} links ${item.sku}`);
      }
    } finally { dom.window.close(); }
  });
  if (!item.inStock) continue;
  test(`${item.sku}: buy-now checkout sends item and delivery details without VIN`, async () => {
    const path = pathFor(item);
    const { window } = new JSDOM(await pathHtml(path), { url: site + path, runScripts: "outside-only" });
    try {
      const requests = [];
      window.fetch = async (url, options) => {
        requests.push({ url, payload: JSON.parse(options.body) });
        return { ok: true, json: async () => ({ ok: true, lead_id: "mock-stock-lead" }) };
      };
      window.eval(script);
      const checkout = window.document.querySelector(".stock-checkout");
      assert.equal(checkout.open, false);
      assert.equal(checkout.querySelector("summary").textContent, "Купити");
      const sticky = window.document.querySelector(".stock-sticky");
      assert.ok(sticky.hidden);
      assert.equal(sticky.querySelector("[data-open-checkout]").getAttribute("href"), "#buy");
      assert.ok(sticky.textContent.includes(money(item.price)));
      const terms = window.document.querySelector(".stock-terms");
      assert.match(terms.textContent, /Доставка по всій Україні/);
      assert.match(terms.textContent, /Відправлення завтра/);
      assert.match(terms.textContent, /фізичними та юридичними особами/);
      assert.doesNotMatch(terms.textContent, /Оплата|Рахунок/);
      const call = terms.querySelector(".stock-call");
      assert.equal(call.getAttribute("href"), "tel:+380935251024");
      assert.match(call.getAttribute("aria-label"), /Зателефонувати/);
      assert.equal(call.textContent.trim(), "");
      const form = checkout.querySelector("form[data-lead-form]");
      assert.equal(form.elements.namedItem("vin"), null);
      assert.equal(form.elements.name.required, true);
      assert.equal(form.elements.phone.required, true);
      assert.equal(form.elements.message.required, false);
      form.elements.name.value = "Тест";
      form.elements.phone.value = "+380000000000";
      form.elements.message.value = "Львів, відділення № 12";
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      assert.doesNotMatch(form.querySelector("[data-form-message]").textContent, /Замовлення прийнято/);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(requests.length, 1);
      const [{ url, payload }] = requests;
      assert.equal(url, "/api/leads");
      assert.equal(payload.type, "parts");
      assert.equal(payload.car, `${item.brand} ${item.model}`);
      assert.equal(payload.part, `${item.name} · ${item.sku}`);
      assert.equal(payload.form_name, `Склад: ${item.sku}`);
      assert.equal(payload.name, "Тест");
      assert.equal(payload.message, "Львів, відділення № 12");
      assert.equal(payload.vin, undefined);
      assert.match(form.querySelector("[data-form-message]").textContent, /Замовлення прийнято.*доставку/);
    } finally { window.close(); }
  });
}

test("terms page, return policy and Merchant Center feed match the stock data", async () => {
  const termsHtml = await pathHtml(`${catalog}umovy/`);
  assert.match(termsHtml, /Новою поштою/);
  assert.match(termsHtml, /Накладений платіж/);
  assert.match(termsHtml, /протягом 14 днів/);
  assert.ok(sitemap.includes(`<loc>${site}${catalog}umovy/</loc>`));
  const feed = await read("merchant-feed.xml");
  const { window } = new JSDOM(feed, { contentType: "text/xml" });
  try {
    const items = [...window.document.getElementsByTagName("item")];
    assert.equal(items.length, stock.length);
    for (const item of stock) {
      const node = items.find((el) => el.getElementsByTagName("g:id")[0].textContent === item.sku);
      const field = (name) => node.getElementsByTagName("g:" + name)[0]?.textContent;
      assert.equal(field("link"), site + pathFor(item));
      assert.equal(field("price"), `${item.price.toFixed(2)} UAH`);
      assert.equal(field("availability"), item.inStock ? "in_stock" : "out_of_stock");
      assert.equal(field("mpn"), item.sku);
      if (item.image) assert.equal(field("image_link"), site + item.image);
      const html = await pathHtml(pathFor(item));
      assert.ok(html.includes(`href="${catalog}umovy/"`));
      const product = JSON.parse(html.match(/ld\+json">(.*?)<\/script>/s)[1])["@graph"].find((n) => n["@type"] === "Product");
      assert.equal(product.offers.hasMerchantReturnPolicy.merchantReturnDays, 14);
      assert.equal(product.offers.hasMerchantReturnPolicy.applicableCountry, "UA");
    }
  } finally { window.close(); }
});
