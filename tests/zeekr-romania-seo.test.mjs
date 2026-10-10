import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const origin = "https://evline.com.ua";
const route = "/ro/zeekr-9x-8x/";
const url = `${origin}${route}`;
const hero = `${origin}/assets/images/zeekr-9x-8x/9x-interior.webp`;
const html = readFileSync("ro/zeekr-9x-8x/index.html", "utf8");
const sitemap = readFileSync("sitemap.xml", "utf8");

function page(t) {
  const dom = new JSDOM(html, { url });
  t.after(() => dom.window.close());
  return dom.window.document;
}

function meta(document, key) {
  return document.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.content;
}

test("Romanian SEO names the programming service, supported models and intended market", t => {
  const document = page(t);
  assert.equal(document.documentElement.lang, "ro");
  assert.match(document.title, /Zeekr.*9X.*8X/i);
  assert.match(document.title, /România/);
  assert.match(document.title, /programare|configurare/i);
  const description = meta(document, "description");
  assert.match(description, /Zeekr/);
  assert.match(description, /România/);
  assert.match(description, /aplicații/i);
  assert.match(description, /SIM/);
  assert.match(description, /aplicația Zeekr/);
  assert.equal(document.querySelectorAll("h1").length, 1);
  const heading = document.querySelector("h1").innerHTML.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.equal(heading, "Programare software Zeekr 9X / 8X");
  assert.match(document.querySelector("main").textContent, /România/);
});

test("only the Romanian landing becomes indexable and advertises eligible language alternatives", t => {
  const document = page(t);
  assert.deepEqual(new Set(meta(document, "robots").split(/\s*,\s*/)), new Set(["index", "follow", "max-image-preview:large"]));
  assert.equal(document.querySelector('link[rel="canonical"]').href, url);
  const alternates = [...document.querySelectorAll('head link[rel="alternate"][hreflang]')].map(link => [link.hreflang, link.href]).sort();
  assert.deepEqual(alternates, [["ro", url], ["ro-RO", url]]);
  for (const file of ["zeekr-9x-8x/index.html", "ru/zeekr-9x-8x/index.html"]) {
    const other = new JSDOM(readFileSync(file, "utf8"));
    assert.equal(meta(other.window.document, "robots"), "noindex,nofollow");
    assert.equal(other.window.document.querySelectorAll('head link[rel="alternate"][hreflang]').length, 4);
    other.window.close();
  }
  assert.equal(document.querySelectorAll(".language-switch a").length, 3, "Visitor language navigation remains available independently of SEO alternatives");
});

test("Romanian social previews use this page and the genuine shared hero image", t => {
  const document = page(t);
  assert.equal(meta(document, "og:locale"), "ro_RO");
  assert.equal(meta(document, "og:url"), url);
  assert.equal(meta(document, "og:image"), hero);
  assert.equal(meta(document, "twitter:image"), hero);
  assert.equal(meta(document, "og:title"), document.title);
  assert.equal(meta(document, "og:description"), meta(document, "description"));
  assert.equal(meta(document, "twitter:title"), document.title);
  assert.equal(meta(document, "twitter:description"), meta(document, "description"));
  assert.equal(meta(document, "twitter:card"), "summary_large_image");
});

test("Romanian structured data describes an offered service, not an invented local workshop", t => {
  const document = page(t);
  const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')].map(node => JSON.parse(node.textContent));
  const graph = blocks.flatMap(block => block["@graph"] || []);
  const types = node => [].concat(node["@type"] || []);
  const webpage = graph.find(node => types(node).includes("WebPage"));
  const service = graph.find(node => types(node).includes("Service"));
  assert.ok(webpage, "Expected WebPage in the JSON-LD graph");
  assert.ok(service, "Expected Service in the JSON-LD graph");
  assert.equal(webpage.url, url);
  assert.equal(webpage.inLanguage, "ro-RO");
  const areas = [].concat(service.areaServed || []);
  assert.ok(areas.some(area => area["@type"] === "Country" && /^(?:Romania|România|RO)$/.test(area.name)), "Romania is the intended service market, not a fabricated address");
  const encoded = JSON.stringify(blocks);
  for (const key of ["address", "streetAddress", "geo", "aggregateRating", "review", "ratingValue", "price", "priceRange"]) {
    assert.doesNotMatch(encoded, new RegExp(`"${key}"\\s*:`), `Unverified ${key} must not be invented for the Romanian service`);
  }
  assert.doesNotMatch(encoded, /"AutoRepair"|"LocalBusiness"/);
  assert.doesNotMatch(encoded, /dealer oficial|service autorizat|reprezentanță oficială/i);
  assert.match(JSON.stringify(service), /aplicații/i);
  assert.match(JSON.stringify(service), /SIM/);
  assert.match(JSON.stringify(service), /MA\/FA/);
});

test("Romanian sitemap entry is self-canonical and matches the page language alternatives", t => {
  const document = page(t);
  const xml = new JSDOM(sitemap, { contentType: "application/xml" });
  t.after(() => xml.window.close());
  const entries = [...xml.window.document.querySelectorAll("url")];
  const entry = entries.find(node => node.querySelector("loc")?.textContent === url);
  assert.ok(entry, "Romanian page must be discoverable in the sitemap");
  assert.equal(entries.filter(node => node.querySelector("loc")?.textContent === url).length, 1);
  const alternatives = node => [...node.querySelectorAll('[rel="alternate"][hreflang]')].map(link => [link.getAttribute("hreflang"), link.getAttribute("href")]).sort();
  assert.deepEqual(alternatives(entry), alternatives(document.head));
  assert.match(entry.querySelector("lastmod")?.textContent || "", /^\d{4}-\d{2}-\d{2}$/);
  for (const other of ["/zeekr-9x-8x/", "/ru/zeekr-9x-8x/"]) {
    assert.equal(entries.some(node => node.querySelector("loc")?.textContent === `${origin}${other}`), false);
  }
});

test("Romanian content adds audience and scope FAQs without changing the programming contact path", t => {
  const document = page(t);
  const faq = [...document.querySelectorAll(".faq-list details")];
  assert.equal(faq.length, 6);
  assert.ok(faq.some(node => /România/.test(node.textContent)));
  assert.ok(faq.some(node => /programare|software/i.test(node.querySelector("summary").textContent)));
  for (const item of faq) assert.ok(item.querySelector("p")?.textContent.trim());
  assert.equal(document.querySelector('input[name="contact"]').placeholder, "+40…");
  for (const contact of document.querySelectorAll('a[href^="tel:"]')) assert.equal(contact.getAttribute("href"), "tel:+380630630304");
  for (const contact of document.querySelectorAll('a[href^="https://t.me/"]')) assert.equal(contact.getAttribute("href"), "https://t.me/evline_tech");
  const form = document.querySelector("form");
  assert.equal(form.getAttribute("action"), "/api/leads");
  assert.equal(form.elements.type.value, "byd");
  assert.equal(form.elements.topic.value, "programming-zeekr-9x-8x");
  assert.deepEqual([...form.elements.model.options].map(option => option.value), ["Zeekr 9X", "Zeekr 8X"]);
});
