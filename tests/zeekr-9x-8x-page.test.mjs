import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const root = process.cwd();
const html = readFileSync("ru/zeekr-9x-8x/index.html", "utf8");
const script = readFileSync("assets/js/zeekr-9x-8x.js", "utf8");
function setup(fetch) {
  const dom = new JSDOM(html, { url: "https://evline.com.ua/ru/zeekr-9x-8x/?utm_source=test&gclid=test-click", runScripts: "outside-only" });
  const { window } = dom;
  window.fetch = fetch;
  window.AbortController = AbortController;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
  window.eval(script);
  const form = window.document.querySelector("form");
  form.elements.contact.value = "+380000000126";
  return { dom, window, form, submit: () => form.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true })) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("page is Russian, unlisted, and uses real local model/video assets", () => {
  const { document } = new JSDOM(html).window;
  assert.equal(document.documentElement.lang, "ru");
  assert.equal(document.querySelector('meta[name="robots"]').content, "noindex,nofollow");
  assert.ok(!readFileSync("sitemap.xml", "utf8").includes("zeekr-9x-8x"));
  for (const node of document.querySelectorAll("[src],link[href],use[href]")) {
    const url = node.getAttribute("src") || node.getAttribute("href");
    if (url.startsWith("/")) assert.ok(existsSync(path.join(root, url.split(/[?#]/)[0])), url);
  }
  const video = document.querySelector("video");
  assert.equal(video.hasAttribute("autoplay"), false);
  assert.equal(video.getAttribute("preload"), "none");
  assert.ok(video.hasAttribute("controls") && video.hasAttribute("playsinline"));
  assert.ok(statSync("assets/video/zeekr-9x-8x/evline-demo.mp4").size < 25 * 1024 * 1024);
  assert.equal(document.querySelectorAll("h1").length, 1);
});

test("all direct contacts go to programming, not parts", () => {
  const { document } = new JSDOM(html).window;
  for (const node of document.querySelectorAll('a[href^="tel:"]')) assert.equal(node.getAttribute("href"), "tel:+380630630304");
  for (const node of document.querySelectorAll('a[href^="https://t.me/"]')) assert.equal(node.getAttribute("href"), "https://t.me/evline_tech");
  assert.ok(!html.includes("evline_support"));
});

test("model and service CTA prefill one accessible dialog", () => {
  const { window, dom, form } = setup();
  window.document.querySelector('[data-model="Zeekr 8X"]').click();
  assert.equal(form.elements.model.value, "Zeekr 8X");
  assert.equal(window.document.querySelector("dialog").open, true);
  window.document.getElementById("close-contact").click();
  assert.equal(window.document.body.classList.contains("modal-open"), false);
  window.document.querySelector('[data-service="SIM-карта и интернет"]').click();
  assert.equal(form.elements.service.value, "SIM-карта и интернет");
  dom.window.close();
});

test("valid submission creates a programming lead with attribution and normalized VIN", async () => {
  let request;
  const ctx = setup(async (url, options) => { request = { url, payload: JSON.parse(options.body) }; return { ok: true, json: async () => ({ ok: true }) }; });
  ctx.form.elements.vin.value = "l6t12345678901234";
  ctx.form.elements.model.value = "Zeekr 8X";
  ctx.form.elements.message.value = "Проверить приложения";
  ctx.submit(); await settle();
  assert.equal(request.url, "/api/leads");
  assert.equal(request.payload.type, "byd");
  assert.equal(request.payload.car, "Zeekr 8X");
  assert.equal(request.payload.vin, "L6T12345678901234");
  assert.equal(request.payload.gclid, "test-click");
  assert.match(request.payload.message, /Проверить приложения/);
  assert.ok(request.payload.meta_event_id);
  assert.equal(ctx.form.hidden, true);
  assert.equal(ctx.window.document.getElementById("form-success").hidden, false);
  ctx.dom.window.close();
});

test("HTML error is not exposed, failed form retains values and retry is deduplicated", async () => {
  const sent = [];
  const ctx = setup(async (url, options) => {
    sent.push(JSON.parse(options.body));
    if (sent.length === 1) return { ok: false, json: async () => { throw new SyntaxError("<html>Cloudflare error</html>"); } };
    return { ok: true, json: async () => ({ ok: true }) };
  });
  ctx.submit(); await settle();
  assert.equal(ctx.form.hidden, false);
  assert.equal(ctx.form.elements.contact.value, "+380000000126");
  const message = ctx.window.document.getElementById("form-status").textContent;
  assert.match(message, /Не удалось подтвердить/);
  assert.ok(!message.includes("Cloudflare"));
  ctx.submit(); await settle();
  assert.equal(sent[0].meta_event_id, sent[1].meta_event_id);
  ctx.dom.window.close();
});

test("double submit sends once; invalid phone and VIN send nothing", async () => {
  let calls = 0;
  let resolve;
  const ctx = setup(() => { calls++; return new Promise(done => { resolve = done; }); });
  ctx.form.elements.vin.value = "INVALID";
  ctx.submit(); assert.equal(calls, 0);
  ctx.form.elements.vin.value = "";
  ctx.form.elements.contact.value = "+( ) ....";
  ctx.submit(); assert.equal(calls, 0);
  ctx.form.elements.contact.value = "+380000000126";
  ctx.submit(); ctx.submit(); assert.equal(calls, 1);
  resolve({ ok: true, json: async () => ({ ok: true }) }); await settle();
  ctx.dom.window.close();
});

test("editing a failed request creates a new deduplication ID", async () => {
  const ids = [];
  const ctx = setup(async (url, options) => { ids.push(JSON.parse(options.body).meta_event_id); return { ok: false, json: async () => ({ error: "failed" }) }; });
  ctx.submit(); await settle();
  ctx.form.elements.model.value = "Zeekr 8X";
  ctx.submit(); await settle();
  assert.notEqual(ids[0], ids[1]);
  ctx.dom.window.close();
});
