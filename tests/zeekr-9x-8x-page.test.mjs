import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const root = process.cwd();
const html = readFileSync("ru/zeekr-9x-8x/index.html", "utf8");
const script = readFileSync("assets/js/zeekr-9x-8x.js", "utf8");
function setup(fetch, configure = () => {}) {
  const dom = new JSDOM(html, { url: "https://evline.com.ua/ru/zeekr-9x-8x/?utm_source=test&gclid=test-click", runScripts: "outside-only" });
  const { window } = dom;
  window.fetch = fetch;
  window.AbortController = AbortController;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
  configure(window);
  window.eval(script);
  const form = window.document.querySelector("form");
  form.elements.contact.value = "+380000000126";
  return { dom, window, form, submit: () => form.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true })) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("video overlay progressively enhances native playback and follows play, pause and end", async () => {
  const initial = new JSDOM(html);
  assert.equal(initial.window.document.getElementById("video-play").hidden, true);
  assert.equal(initial.window.document.querySelector("video").controls, true);
  initial.window.close();
  let calls = 0;
  const ctx = setup(undefined, window => {
    window.HTMLMediaElement.prototype.play = function () {
      calls++;
      this.dispatchEvent(new window.Event("play"));
      return Promise.resolve();
    };
  });
  const { document, Event } = ctx.window;
  const button = document.getElementById("video-play");
  const video = document.getElementById("work-video");
  assert.equal(button.hidden, false);
  assert.equal(calls, 0, "initialization must not load or autoplay the video");
  assert.equal(button.getAttribute("aria-controls"), video.id);
  button.focus();
  button.click();
  await settle();
  assert.equal(calls, 1);
  assert.equal(button.hidden, true);
  assert.equal(document.activeElement, video);
  video.currentTime = 12;
  video.dispatchEvent(new Event("pause"));
  assert.equal(button.hidden, false);
  assert.equal(button.getAttribute("aria-label"), "Продолжить видео");
  button.click(); await settle();
  assert.equal(button.hidden, true);
  Object.defineProperty(video, "ended", { value: true });
  video.dispatchEvent(new Event("ended"));
  assert.equal(button.hidden, false);
  assert.equal(button.getAttribute("aria-label"), "Смотреть видео ещё раз");
  assert.equal(video.controls, true);
  ctx.dom.window.close();
});

test("video rejects duplicate starts and allows retry after playback errors", async () => {
  let rejectStart;
  let calls = 0;
  const ctx = setup(undefined, window => {
    window.HTMLMediaElement.prototype.play = function () {
      calls++;
      if (calls === 1) return new Promise((_, reject) => { rejectStart = reject; });
      this.dispatchEvent(new window.Event("play"));
      return Promise.resolve();
    };
  });
  const button = ctx.window.document.getElementById("video-play");
  const status = ctx.window.document.getElementById("video-status");
  button.click(); button.click();
  assert.equal(calls, 1);
  rejectStart(new Error("media unavailable"));
  await settle();
  assert.equal(button.disabled, false);
  assert.equal(button.hidden, false);
  assert.match(status.textContent, /Не удалось запустить/);
  button.click(); await settle();
  assert.equal(calls, 2);
  assert.equal(button.hidden, true);
  assert.equal(status.textContent, "");
  ctx.window.document.getElementById("work-video").dispatchEvent(new ctx.window.Event("error"));
  assert.equal(button.hidden, false);
  assert.match(status.textContent, /Не удалось запустить/);
  ctx.dom.window.close();
});

test("a native pause during startup does not report a playback failure", async () => {
  const ctx = setup(undefined, window => {
    window.HTMLMediaElement.prototype.play = function () {
      this.dispatchEvent(new window.Event("play"));
      this.dispatchEvent(new window.Event("pause"));
      return Promise.reject(new window.DOMException("Interrupted", "AbortError"));
    };
  });
  const button = ctx.window.document.getElementById("video-play");
  button.click(); await settle();
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(ctx.window.document.getElementById("video-status").textContent, "");
  ctx.dom.window.close();
});

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

test("compact page keeps model frames and native FAQ without the removed process section", () => {
  const { document } = new JSDOM(html).window;
  assert.equal(document.querySelector("#services-title").textContent, "Возможности вашего Zeekr");
  assert.equal(document.querySelector("#work-title").textContent, "Ваш Zeekr может так же");
  assert.equal(document.querySelector("#process-title"), null);
  assert.equal(document.querySelectorAll(".model-media > img").length, 2);
  for (const model of document.querySelectorAll(".model")) {
    assert.ok(model.querySelector(".model-media"));
    assert.ok(model.querySelector("[data-model]"));
  }
  const faq = document.querySelector("#questions");
  assert.equal(faq.querySelectorAll("details > summary").length, 4);
  for (const details of faq.querySelectorAll("details")) {
    assert.ok(details.querySelector("p").textContent.trim());
    assert.equal(details.hasAttribute("open"), false);
  }
});

test("all direct contacts go to programming, not parts", () => {
  const { document } = new JSDOM(html).window;
  for (const node of document.querySelectorAll('a[href^="tel:"]')) assert.equal(node.getAttribute("href"), "tel:+380630630304");
  for (const node of document.querySelectorAll('a[href^="https://t.me/"]')) assert.equal(node.getAttribute("href"), "https://t.me/evline_tech");
  assert.ok(!html.includes("evline_support"));
});

test("model and service CTA prefill one accessible dialog", () => {
  const { window, dom, form } = setup();
  for (const button of window.document.querySelectorAll("[data-model], [data-service]")) {
    button.click();
    if (button.dataset.model) assert.equal(form.elements.model.value, button.dataset.model);
    if (button.dataset.service) assert.equal(form.elements.service.value, button.dataset.service);
    assert.equal(window.document.querySelector("dialog").open, true);
    window.document.getElementById("close-contact").click();
    assert.equal(window.document.body.classList.contains("modal-open"), false);
    assert.equal(window.document.activeElement, button);
  }
  dom.window.close();
});

test("native selects reserve space for a local centered chevron without shrinking touch targets", () => {
  const css = readFileSync("assets/css/zeekr-9x-8x.css", "utf8");
  const dom = new JSDOM(html.replace("</head>", `<style>${css}</style></head>`));
  const { window } = dom;
  const selectRule = [...window.document.styleSheets[0].cssRules].find(rule => rule.selectorText === "form select");
  // JSDOM does not compute three-value background positions; browser checks cover rendering.
  assert.equal(selectRule.style.getPropertyValue("background-position"), "right 12px center");
  for (const select of window.document.querySelectorAll("select")) {
    const style = window.getComputedStyle(select);
    assert.ok(Number.parseFloat(style.minHeight) >= 44);
    assert.ok(Number.parseFloat(style.paddingRight) >= 36);
    assert.match(style.backgroundImage, /chevron-down\.svg/);
    assert.ok(select.labels.length);
  }
  assert.ok(existsSync("assets/images/zeekr-9x-8x/chevron-down.svg"));
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
