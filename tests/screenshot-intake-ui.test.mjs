import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../admin/screenshot-intake/index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../admin/screenshot-intake/intake.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const flush = async () => { for (let index = 0; index < 8; index++) await tick(); };
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const draft = (extra = {}) => ({
  id: "draft-a", manager_id: "10001", channel: "viber", status: "ready", revision: 2,
  created_at: "2026-10-05T09:00:00Z", updated_at: "2026-10-05T09:10:00Z", order_id: "", blocking: false,
  fields: { customer_name: "Synthetic", customer_phone: "+380000000001", car: "BYD Yuan Plus 2023", vin: "", item_name: "Двері, 1 шт.", request_text: "Ліві двері" },
  warnings: [], evidence: { item_name: [{ message_id: 42, quote: "двері" }] },
  sources: [{ kind: "photo", text: "Synthetic caption", extracted_text: "Потрібні двері", message_id: 42, created_at: "2026-10-05T09:00:00Z", file_unique_id: "PRIVATE_FILE_ID", url: "https://private.invalid/image.jpg" }],
  ...extra,
});
const order = (extra = {}) => ({ id: "order-a", order_number: "O-000001", car: "BYD Yuan Plus", item_name: "Наявний запит", updated_at: "2026-10-05T08:00:00Z", ...extra });

async function page(t, options = {}) {
  const dom = new JSDOM(html, { url: `https://fixture.local/admin/screenshot-intake/${options.open === false ? "" : "?draft=draft-a"}`, runScripts: "outside-only" });
  const w = dom.window, calls = [], confirmations = [];
  t.after(() => { w.dispatchEvent(new w.Event("pagehide")); w.close(); });
  const state = {
    drafts: options.drafts || [draft(), draft({ id: "draft-b", channel: "whatsapp", fields: { ...draft().fields, car: "Zeekr 001" } })],
    managers: options.managers || [{ telegram_id: "10001", username: "evline_support", display_name: "Synthetic manager", status: "pending" }],
    duplicates: options.duplicates || [], ai_available: options.ai !== false,
  };
  if (options.auth !== false) w.localStorage.setItem("evline_admin_token", "SYNTHETIC_ADMIN_TOKEN");
  w.confirm = message => { confirmations.push(message); return options.confirm !== false; };
  w.fetch = async (url, request = {}) => {
    assert.ok(url.startsWith("/api/admin/screenshot-intake"), "No external/live requests");
    assert.doesNotMatch(url, /SYNTHETIC_ADMIN_TOKEN/);
    assert.equal(request.headers.authorization, `Bearer ${w.localStorage.getItem("evline_admin_token")}`);
    assert.equal(request.credentials, "same-origin"); assert.equal(request.redirect, "error");
    const body = request.body ? JSON.parse(request.body) : null;
    calls.push({ url, request, body });
    const custom = await options.handle?.({ url, request, body, state });
    if (custom !== undefined) return custom;
    const query = new URL(url, w.location.origin).searchParams;
    if (query.has("setup")) return reply({ username: "synthetic_bot", webhook_matches: true, manager_username_hint: "evline_support" });
    if (query.has("order")) return reply({ order: order({ id: "order-lookup", order_number: query.get("order") }) });
    if (query.has("id")) return reply({ draft: state.drafts.find(d => d.id === query.get("id")), duplicates: state.duplicates });
    if (!body) return reply(state);
    if (body.action === "test_analysis") return reply({ checks: { phone: true, parts: true, car: true } });
    if (body.action === "manager_status") { state.managers.find(m => m.telegram_id === body.telegram_id).status = body.status; return reply({ ok: true }); }
    const current = state.drafts.find(d => d.id === body.id);
    assert.equal(body.revision, current.revision, "Every mutation includes the current revision");
    if (body.action === "save") { current.fields = body.fields; current.status = "ready"; current.blocking = false; }
    if (body.action === "analyze") current.status = "ready";
    if (body.action === "confirm") { current.status = "applied"; current.order_id = body.order_id || "order-created"; current.order_number = "O-000100"; }
    if (body.action === "cancel") current.status = "canceled";
    current.revision++;
    return reply({ draft: current });
  };
  w.eval(script);
  await flush();
  const $ = selector => w.document.querySelector(selector);
  const click = async selector => { assert.ok($(selector), selector); $(selector).click(); await flush(); };
  const set = (name, value) => { const element = $(`[name="${name}"]`); element.value = value; element.dispatchEvent(new w.Event("input", { bubbles: true })); };
  const posts = () => calls.filter(c => c.body).map(c => c.body);
  return { w, $, calls, posts, confirmations, state, click, set };
}

test("initial auth: no token makes no request; rejected auth reveals no private data", async t => {
  const p = await page(t, { auth: false });
  assert.equal(p.calls.length, 0); assert.equal(p.$("[data-auth]").hidden, false); assert.equal(p.$("[data-private]").hidden, true);
  const rejected = await page(t, { handle: () => reply({ error: "Unauthorized" }, 401) });
  assert.equal(rejected.$("[data-auth]").hidden, false); assert.equal(rejected.$("[data-private]").hidden, true);
  assert.equal(rejected.$("[data-detail]").textContent, "");
});

test("deep link opens draft with actual channel, no mutation, private images or exposed identifiers", async t => {
  const p = await page(t);
  assert.match(p.$("[data-detail]").textContent, /Viber/);
  assert.equal(p.$('[name="car"]').value, "BYD Yuan Plus 2023");
  assert.equal(p.posts().length, 0);
  assert.equal(p.$("[data-detail]").querySelectorAll("img").length, 0);
  assert.doesNotMatch(p.$("[data-detail]").innerHTML, /PRIVATE_FILE_ID|private\.invalid/);
  assert.match(p.$(".privacy-note").textContent, /7 днів/);
  assert.match(p.$(".privacy-note").textContent, /Cloudflare Workers AI/);
  assert.match(p.$(".privacy-note").textContent, /24 години/);
  await p.click('[data-draft="draft-b"]');
  assert.match(p.$("[data-detail]").textContent, /WhatsApp/);
  assert.equal(new URL(p.w.location.href).searchParams.get("draft"), "draft-b");
});

test("all draft, source, warning and evidence strings render as text, never markup", async t => {
  const hostile = '<img src=x onerror="window.BAD=1">';
  const p = await page(t, { drafts: [draft({ fields: { ...draft().fields, customer_name: hostile, item_name: hostile }, warnings: [hostile], sources: [{ kind: "photo", text: hostile, extracted_text: hostile }], evidence: { item_name: [{ quote: hostile }] } })] });
  assert.equal(p.$('[name="customer_name"]').value, hostile);
  assert.equal(p.$("[data-detail]").querySelectorAll("img,script,iframe").length, 0);
  assert.equal(p.w.BAD, undefined);
  await p.click("[data-review-create]");
  assert.equal(p.$("[data-confirm-panel]").querySelectorAll("img,script,iframe").length, 0);
});

test("manager approval shows exact numeric ID and username, requires confirmation, refuses other account", async t => {
  const p = await page(t, { open: false, managers: [
    { telegram_id: "10001", username: "evline_support", display_name: "Synthetic", status: "pending" },
    { telegram_id: "10002", username: "different_manager", display_name: "Other", status: "pending" },
  ] });
  assert.equal(p.$('[data-manager="1"]').disabled, true);
  await p.click('[data-manager="0"]');
  assert.match(p.confirmations[0], /Username: @evline_support/); assert.match(p.confirmations[0], /Telegram ID: 10001/);
  assert.deepEqual(p.posts()[0], { action: "manager_status", telegram_id: "10001", status: "approved" });
  const canceled = await page(t, { open: false, confirm: false });
  await canceled.click('[data-manager="0"]'); assert.equal(canceled.posts().length, 0);
});

test("setup offers a safe bot invite and AI synthetic check never submits a CRM action", async t => {
  const p = await page(t);
  await p.click("[data-check-setup]");
  assert.equal(p.$("[data-bot-link]").getAttribute("href"), "https://t.me/synthetic_bot?start=intake");
  assert.match(p.$("[data-setup]").textContent, /Webhook: готовий/);
  await p.click("[data-test-analysis]");
  assert.deepEqual(p.posts(), [{ action: "test_analysis" }]);
  assert.match(p.$("[data-ai-test-result]").textContent, /Телефон: OK · Запчастини: OK · Авто: OK/);
  await p.click("[data-test-vision]");
  assert.deepEqual(p.posts()[1], { action: "test_analysis", vision: true });
  const hostile = await page(t, { handle: ({ url }) => url.includes("setup=") ? reply({ username: "bad/../outside", start_url: "javascript:alert(1)" }) : undefined });
  await hostile.click("[data-check-setup]");
  assert.equal(hostile.$("[data-bot-link]").hidden, true); assert.equal(hostile.$("[data-bot-link]").hasAttribute("href"), false);
});

test("partial draft save permits missing fields and sends only allowed fields with current revision", async t => {
  const p = await page(t);
  p.set("item_name", ""); p.set("customer_phone", "");
  assert.equal(p.$("[data-review-create]").disabled, true);
  assert.match(p.$("[data-validation]").textContent, /обов'язковий телефон/);
  await p.click("[data-save]");
  assert.equal(p.posts().length, 1); assert.equal(p.posts()[0].action, "save"); assert.equal(p.posts()[0].revision, 2);
  assert.deepEqual(Object.keys(p.posts()[0].fields).sort(), ["car", "customer_name", "customer_phone", "item_name", "request_text", "vin"]);
  assert.equal(p.posts()[0].fields.customer_phone, "");
  await p.click("[data-review-create]"); assert.equal(p.$("[data-confirm-panel]").hidden, true);
  assert.match(p.$("[data-error]").textContent, /телефон/);
});

test("optional VIN accepts valid seventeen symbols and rejects malformed VIN without writes", async t => {
  const p = await page(t);
  p.set("vin", "INVALID"); await p.click("[data-save]");
  assert.equal(p.posts().length, 0); assert.match(p.$("[data-error]").textContent, /17/);
  p.set("vin", "ltest123456789012"); await p.click("[data-save]");
  assert.equal(p.posts()[0].fields.vin, "LTEST123456789012");
});

test("dirty fields cannot create, analyze or be discarded by navigation without approval", async t => {
  const p = await page(t, { confirm: false });
  p.set("item_name", "Незбережена правка");
  assert.equal(p.$("[data-review-create]").disabled, true); assert.equal(p.$("[data-analyze]").disabled, true);
  await p.click('[data-draft="draft-b"]');
  assert.equal(p.$('[name="item_name"]').value, "Незбережена правка");
  assert.equal(p.calls.filter(c => c.url.includes("id=draft-b")).length, 0);
  const event = new p.w.Event("beforeunload", { cancelable: true }); p.w.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
});

test("possible duplicate needs separate checkbox and explicit final create confirmation", async t => {
  const p = await page(t, { duplicates: [order()] });
  await p.click("[data-review-create]");
  assert.equal(p.posts().length, 0); assert.equal(p.$("[data-confirm-final]").disabled, true);
  p.$("[data-allow-duplicate]").checked = true;
  p.$("[data-allow-duplicate]").dispatchEvent(new p.w.Event("change", { bubbles: true }));
  await p.click("[data-confirm-final]");
  assert.deepEqual(p.posts()[0], { action: "confirm", id: "draft-a", revision: 2, mode: "create", allow_duplicate: true });
  assert.match(p.$("[data-detail]").textContent, /Внесено до CRM/);
  assert.equal(p.$('[href="/admin/?order=order-created"]').textContent, "O-000100");
  assert.equal(p.$("[data-review-create]").disabled, true);
});

test("create without duplicates still requires preview then explicit confirmation; repeated clicks do not duplicate", async t => {
  const pending = defer();
  const p = await page(t, { handle: ({ body }) => body?.action === "confirm" ? pending.promise : undefined });
  await p.click("[data-review-create]"); assert.equal(p.posts().length, 0);
  p.$("[data-confirm-final]").click(); p.$("[data-confirm-final]").click(); await flush();
  assert.equal(p.posts().length, 1); assert.equal(p.posts()[0].allow_duplicate, false);
  assert.equal(p.$("[data-refresh]").disabled, true);
  pending.resolve(reply({ error: "Synthetic failure" }, 500)); await flush();
  assert.equal(p.$("[data-refresh]").disabled, false);
});

test("append previews exact target and sends versioned notes-only mode, never fields or finances", async t => {
  const p = await page(t, { duplicates: [order()] });
  p.$("[data-target]").value = "0"; p.$("[data-target]").dispatchEvent(new p.w.Event("change", { bubbles: true }));
  assert.match(p.$("[data-target-summary]").textContent, /O-000001/);
  await p.click("[data-review-append]");
  assert.match(p.$("[data-confirm-panel]").textContent, /Доповнити O-000001/);
  assert.match(p.$("[data-confirm-panel]").textContent, /Етап, фінанси/);
  assert.equal(p.posts().length, 0);
  await p.click("[data-confirm-final]");
  assert.deepEqual(p.posts()[0], { action: "confirm", id: "draft-a", revision: 2, mode: "append", allow_duplicate: false, order_id: "order-a", order_updated_at: "2026-10-05T08:00:00Z" });
});

test("manual public-number lookup selects exact order and invalid numbers never request backend", async t => {
  const p = await page(t);
  p.$("[data-order-number]").value = "not-an-order"; await p.click("[data-order-lookup]");
  assert.equal(p.calls.filter(c => c.url.includes("?order=")).length, 0);
  p.$("[data-order-number]").value = "o-000099"; await p.click("[data-order-lookup]");
  assert.match(p.$("[data-target-summary]").textContent, /O-000099/);
  await p.click("[data-review-append]"); await p.click("[data-confirm-final]");
  assert.equal(p.posts()[0].order_id, "order-lookup");
});

test("blocking mixed-client draft requires correction and checked review before save unlocks confirmation", async t => {
  const p = await page(t, { drafts: [draft({ blocking: true, warnings: ["Кілька клієнтів"] })] });
  assert.equal(p.$("[data-review-create]").disabled, true); assert.equal(p.$("[data-save]").disabled, true);
  p.set("item_name", "Перевірені двері одного клієнта"); assert.equal(p.$("[data-save]").disabled, true);
  p.$("[data-reviewed]").checked = true; p.$("[data-reviewed]").dispatchEvent(new p.w.Event("change", { bubbles: true }));
  await p.click("[data-save]");
  assert.equal(p.posts()[0].action, "save"); assert.equal(p.state.drafts[0].blocking, false);
  assert.equal(p.$("[data-review-create]").disabled, false);
});

test("409 leaves unsaved fields intact and requires refreshed revision before confirming", async t => {
  const p = await page(t, { handle: ({ body }) => body?.action === "save" ? reply({ error: "Revision conflict" }, 409) : undefined });
  p.set("item_name", "Keep my changes"); await p.click("[data-save]");
  assert.equal(p.$('[name="item_name"]').value, "Keep my changes");
  assert.equal(p.$("[data-review-create]").disabled, true);
  assert.match(p.$("[data-error]").textContent, /вже змінилися/);
});

test("late draft response cannot overwrite newer selected draft", async t => {
  const pending = defer();
  const p = await page(t, { open: false, handle: ({ url }) => url.endsWith("?id=draft-a") ? pending.promise : undefined });
  p.$('[data-draft="draft-a"]').click(); await flush();
  await p.click('[data-draft="draft-b"]');
  assert.equal(p.$('[name="car"]').value, "Zeekr 001");
  pending.resolve(reply({ draft: draft(), duplicates: [] })); await flush();
  assert.equal(p.$('[name="car"]').value, "Zeekr 001");
});

test("late order lookup cannot replace target after switching drafts", async t => {
  const pending = defer();
  const p = await page(t, { handle: ({ url }) => url.includes("?order=") ? pending.promise : undefined });
  p.$("[data-order-number]").value = "O-000099"; p.$("[data-order-lookup]").click(); await flush();
  await p.click('[data-draft="draft-b"]');
  pending.resolve(reply({ order: order() })); await flush();
  assert.equal(p.$("[data-target-summary]").hidden, true);
  assert.equal(p.$("[data-target]").options.length, 1);
});

test("late failed order lookup cannot show an error on a different draft", async t => {
  const pending = defer();
  const p = await page(t, { handle: ({ url }) => url.includes("?order=") ? pending.promise : undefined });
  p.$("[data-order-number]").value = "O-000099"; p.$("[data-order-lookup]").click(); await flush();
  await p.click('[data-draft="draft-b"]');
  pending.resolve(reply({ error: "Old order not found" }, 404)); await flush();
  assert.equal(p.$("[data-error]").hidden, true);
});

test("auth changes and pagehide discard pending private results", async t => {
  for (const action of ["auth", "close"]) {
    const pending = defer();
    const p = await page(t, { open: false, handle: ({ url }) => url.includes("?id=") ? pending.promise : undefined });
    p.$('[data-draft="draft-a"]').click(); await flush();
    if (action === "auth") p.w.localStorage.setItem("evline_admin_token", "DIFFERENT_TOKEN");
    else p.w.dispatchEvent(new p.w.Event("pagehide"));
    pending.resolve(reply({ draft: draft(), duplicates: [] })); await flush();
    assert.equal(p.$('[name="customer_phone"]'), null);
    if (action === "auth") { assert.equal(p.$("[data-private]").hidden, true); assert.equal(p.$("[data-auth]").hidden, false); }
  }
});

test("AI unavailable keeps manual editing usable; terminal drafts disable mutations", async t => {
  const p = await page(t, { ai: false });
  assert.equal(p.$("[data-ai-warning]").hidden, false); assert.equal(p.$("[data-analyze]").disabled, true); assert.equal(p.$("[data-save]").disabled, false);
  const expired = await page(t, { drafts: [draft({ status: "expired" })] });
  for (const selector of ["[data-save]", "[data-analyze]", "[data-review-create]", "[data-cancel]", '[name="item_name"]']) assert.equal(expired.$(selector).disabled, true);
});

test("existing admin pages link to screenshot intake without changing ordinary Telegram intake script", () => {
  for (const path of ["../admin/index.html", "../admin/telegram/index.html"]) {
    assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), /href="\/admin\/screenshot-intake\/"/);
  }
  assert.match(html, /noindex, nofollow/);
});
