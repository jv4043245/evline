import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { partsMobilePages, partsMobileStylesheet, withPartsMobileFunnel } from "../scripts/lib/parts-mobile-funnel.mjs";

const root = new URL("../", import.meta.url);
const mainSource = await readFile(new URL("assets/js/main.js", root), "utf8");
const nextSource = await readFile(new URL("assets/js/lead-next-steps.js", root), "utf8");

test("mobile funnel scope includes the 28 advertising brand/model pages only", async () => {
  assert.equal(partsMobilePages.length, 28);
  assert.equal(new Set(partsMobilePages).size, 28);
  for (const page of ["index.html", "ru/index.html", "byd.html", "diagnostyka-byd/index.html", "spivpratsya-sto/index.html", "zapchastyny-xiaomi/index.html", "zapchastyny-byd/song-l/index.html"]) {
    const html = await readFile(new URL(page, root), "utf8");
    assert.equal(withPartsMobileFunnel(html), html, page);
    assert.doesNotMatch(html, /data-parts-mobile-style/, page);
  }
});

test("mobile styles leave desktop and page content intact", async () => {
  const css = await readFile(new URL("assets/css/parts-brand-mobile.css", root), "utf8");
  const dom = new JSDOM(`<style>${css}</style>`);
  try {
    const rules = dom.window.document.styleSheets[0].cssRules;
    assert.equal(rules.length, 3);
    assert.equal(rules[0].selectorText, ".parts-brand-contactbar");
    assert.equal(rules[0].style.display, "none");
    assert.equal(rules[1].conditionText, "(max-width: 700px)");
    assert.equal(rules[2].conditionText, "(max-width: 360px)");
    for (const media of [...rules].slice(1)) {
      for (const rule of media.cssRules) assert.ok(rule.selectorText.startsWith(".parts-page.brand-seo-page"));
    }
  } finally { dom.window.close(); }
});

test("Russian brand generator keeps the scoped mobile enhancement", async () => {
  const source = await readFile(new URL("scripts/build-ru-version.mjs", root), "utf8");
  assert.match(source, /import \{ withPartsMobileFunnel \} from "\.\/lib\/parts-mobile-funnel\.mjs"/);
  assert.match(source, /withPartsMobileFunnel\(withPriorityPartsContent\(currentDeliveryCopy\(brandPageRu\(brand\)\)\)\)/);
});

for (const page of partsMobilePages) {
  test(`${page}: one versioned stylesheet, idempotent generator, preserved lead fields`, async () => {
    const html = await readFile(new URL(`${page.slice(1)}index.html`, root), "utf8");
    const dom = new JSDOM(html);
    try {
      const d = dom.window.document;
      const links = d.querySelectorAll("[data-parts-mobile-style]");
      assert.equal(links.length, 1);
      assert.equal(links[0].getAttribute("href"), partsMobileStylesheet);
      assert.equal(d.querySelectorAll("[data-parts-mobile-contactbar]").length, 1);
      const bar = d.querySelector("[data-parts-mobile-contactbar]");
      assert.equal(bar.querySelector('a[href^="tel:"]').getAttribute("href"), "tel:+380935251024");
      assert.equal(bar.querySelector('a[href^="https:"]').getAttribute("href"), "https://t.me/evline_support");
      for (const a of bar.querySelectorAll("a")) assert.equal(a.dataset.contactIntent, "parts");
      assert.equal(d.querySelector('link[rel="canonical"]').getAttribute("href"), `https://evline.com.ua${page}`);
      assert.equal(d.querySelectorAll("h1").length, 1);
      const form = d.querySelector("form[data-telegram-parts-form]");
      assert.ok(form);
      assert.deepEqual([...form.querySelectorAll("input")].map(e => e.name), ["car", "vin", "part", "phone"]);
      assert.ok(form.querySelector("[name=part]").required);
      assert.ok(form.querySelector("[name=phone]").required);
      const isModel = page.replace(/^\/ru\//, "/").split("/").filter(Boolean).length === 2;
      assert.equal(!!form.querySelector("[name=car]").value, isModel);
      assert.ok(d.querySelector(".brand-seo-lead").textContent.trim());
      assert.ok(d.querySelector(".brand-seo-tags").textContent.trim());
      assert.equal(withPartsMobileFunnel(html), html);
      const withoutStyle = html.replace(/<link[^>]+data-parts-mobile-style>\n/, "");
      assert.equal(withPartsMobileFunnel(withoutStyle), html);
    } finally { dom.window.close(); }
  });

  for (const accepted of [true, false]) {
    test(`${page}/${accepted}: CRM acknowledgment and attribution survive mobile changes`, async () => {
      const html = await readFile(new URL(`${page.slice(1)}index.html`, root), "utf8");
      const dom = new JSDOM(html, { url: `https://evline.com.ua${page}?gclid=synthetic-brand-mobile&utm_source=google&utm_medium=cpc`, runScripts: "outside-only", pretendToBeVisual: true });
      try {
        const w = dom.window, requests = [];
        w.dataLayer = [];
        w.open = () => null;
        w.matchMedia = () => ({ matches: false, addEventListener() {} });
        w.fetch = async (url, options) => {
          requests.push({ url, payload: JSON.parse(options.body) });
          return { ok: true, json: async () => ({ ok: accepted, lead_id: accepted ? "synthetic-brand-mobile" : "" }) };
        };
        w.eval(nextSource);
        w.eval(mainSource);
        const form = w.document.querySelector("form[data-telegram-parts-form]");
        const carField = form.querySelector("[name=car]");
        const car = carField.value || "SYNTHETIC MODEL";
        carField.value = car;
        form.querySelector("[name=vin]").value = "TESTVIN1234567890";
        form.querySelector("[name=part]").value = "SYNTHETIC LOCAL ONLY";
        form.querySelector("[name=phone]").value = "+380000000000";
        form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, "/api/leads");
        assert.equal(requests[0].payload.car, car);
        assert.equal(requests[0].payload.type, "parts");
        assert.equal(requests[0].payload.gclid, "synthetic-brand-mobile");
        assert.equal(requests[0].payload.utm_source, "google");
        assert.equal(requests[0].payload.utm_medium, "cpc");
        assert.equal(w.dataLayer.filter(e => e.event === "evline_lead_submit").length, accepted ? 1 : 0);
        assert.equal(form.querySelector("[name=phone]").value, accepted ? "" : "+380000000000");
        assert.ok(form.querySelector("[data-payment-note]"));
        const status = form.querySelector("[data-form-message]");
        if (accepted) assert.equal(status.querySelector("a").dataset.contactIntent, "parts");
        else assert.doesNotMatch(status.textContent, /Заявку (отримали|получили)/);
      } finally { dom.window.close(); }
    });
  }
}
