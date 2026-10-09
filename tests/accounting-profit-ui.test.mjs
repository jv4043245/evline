import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { calculateProfitPreview, createAccountingProfitView, defaultProfitMonth, parseProfitAmount, validProfitMonth } from "../admin/accounting-profit.js";

const now = () => new Date("2026-10-09T10:00:00Z");
const blank = () => ({ revenue_minor: null, purchase_minor: null, shipping_minor: null, other_minor: null, other_note: "" });
const complete = () => ({ revenue_minor: 1000000, purchase_minor: 400000, shipping_minor: 100000, other_minor: 0, other_note: "" });
const advertising = () => ({ google_minor: 1000, meta_minor: 2000, total_minor: 3000, coverage: "complete", through: "2026-09-30" });
const fixture = (inputs = blank(), extra = {}) => ({ month: "2026-09", revision: 0, basis: "paid_and_delivered", currency: "UAH", timezone: "Europe/Kyiv", inputs, advertising: advertising(), calculation: calculateProfitPreview(inputs, advertising()), updated_at: null, current_month: false, is_provisional: false, ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));
function mount(t, api, options = {}) {
  const window = new JSDOM('<section id="profit"></section>').window;
  t.after(() => window.close());
  const container = window.document.querySelector("#profit");
  const controller = createAccountingProfitView(container, api, { now, confirmDiscard: () => true, ...options });
  return { window, container, controller, form: container.querySelector("form"), message: container.querySelector("[data-profit-message]"), save: container.querySelector("[data-profit-save]") };
}
function input(view, name, value) {
  const field = view.form.elements.namedItem(name);
  field.value = value;
  field.dispatchEvent(new view.window.Event("input", { bubbles: true }));
}
async function submit(view) {
  view.form.dispatchEvent(new view.window.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
}

test("default is previous completed Kyiv month, including year and UTC boundary", () => {
  assert.equal(defaultProfitMonth(now()), "2026-09");
  assert.equal(defaultProfitMonth(new Date("2026-01-01T00:00:00Z")), "2025-12");
  assert.equal(defaultProfitMonth(new Date("2026-09-30T21:30:00Z")), "2026-09");
  assert.equal(validProfitMonth("2019-12"), false);
  assert.equal(validProfitMonth("2020-01"), true);
  assert.equal(validProfitMonth("2026-13"), false);
});

test("money parsing preserves unknown and zero, accepts Ukrainian decimals and rejects unsafe coercions", () => {
  assert.equal(parseProfitAmount(""), null);
  assert.equal(parseProfitAmount("  "), null);
  assert.equal(parseProfitAmount("0"), 0);
  assert.equal(parseProfitAmount("1 234,56"), 123456);
  assert.equal(parseProfitAmount("1\u202f234.5"), 123450);
  assert.equal(parseProfitAmount("1000000000,00"), 100000000000);
  for (const value of ["1000000000.01", "0.001", "-1", "+1", "1e3", "NaN", "Infinity", "1,2.3", "12грн"]) assert.throws(() => parseProfitAmount(value));
});

test("fixed 15% is based on profit after all costs once; missing values and ads prevent calculation", () => {
  const result = calculateProfitPreview(complete(), advertising());
  assert.equal(result.profit_before_manager_minor, 497000);
  assert.equal(result.manager_minor, 74550);
  assert.equal(result.owner_remaining_minor, 422450);
  assert.equal(result.status, "draft");
  assert.equal(calculateProfitPreview(blank(), advertising()).status, "incomplete");
  for (const coverage of ["partial", "missing"]) {
    const missing = calculateProfitPreview(complete(), { ...advertising(), coverage });
    assert.equal(missing.manager_minor, null);
    assert.ok(missing.missing_keys.includes("advertising"));
  }
  assert.equal(calculateProfitPreview({ ...complete(), other_minor: 100 }, advertising()).manager_minor, null);
  assert.equal(calculateProfitPreview({ ...complete(), other_minor: 100, other_note: "Пакування" }, advertising()).status, "draft");
});

test("negative monthly profit has zero provisional manager reward, with loss preserved; rounding uses kopecks", () => {
  const negative = calculateProfitPreview({ ...complete(), revenue_minor: 0 }, advertising());
  assert.equal(negative.profit_before_manager_minor, -503000);
  assert.equal(negative.manager_minor, 0);
  assert.equal(negative.owner_remaining_minor, -503000);
  const zeroCosts = { revenue_minor: 10, purchase_minor: 0, shipping_minor: 0, other_minor: 0, other_note: "" };
  const zeroAds = { coverage: "complete", total_minor: 0 };
  assert.equal(calculateProfitPreview(zeroCosts, zeroAds).manager_minor, 2);
});

test("blank draft shows no imaginary profit, keeps ads read-only and exposes cohort and draft labels", async t => {
  const requests = [], view = mount(t, async (...args) => { requests.push(args); return fixture(); });
  await view.controller.load();
  assert.equal(requests[0][0], "/api/admin/accounting/profit?month=2026-09");
  assert.equal(view.form.elements.revenue_minor.value, "");
  assert.equal(view.container.querySelector('[data-profit-result="manager_minor"]').textContent, "—");
  assert.match(view.container.textContent, /Лише повністю оплачені й видані замовлення/);
  assert.match(view.container.textContent, /Чернетка/);
  assert.match(view.container.textContent, /Попередній розрахунок/);
  assert.equal(view.container.querySelector('h1').textContent, 'Розрахунок Андрія');
  assert.match(view.container.textContent, /Андрію · 15%/);
  assert.doesNotMatch(view.container.textContent, /Розрахунок менеджера|Менеджеру · 15%/);
  assert.equal(view.container.querySelector('input[name="total_minor"]'), null);
  assert.equal(view.controller.hasChanges(), false);
  assert.equal(view.controller.isBusy(), false);
  assert.equal(view.save.disabled, true);
  assert.equal(view.container.querySelector("[data-profit-month]").min, "2020-01");
});

test("manual inputs preview live and PUT carries only draft inputs, month and CAS revision", async t => {
  const writes = [];
  const view = mount(t, async (url, options) => {
    if (!options) return fixture(complete(), { revision: 2 });
    writes.push({ url, ...options });
    const body = JSON.parse(options.body);
    return fixture(body.inputs, { revision: 3 });
  });
  await view.controller.load();
  input(view, "revenue_minor", "12000,00");
  assert.match(view.container.querySelector('[data-profit-result="profit_before_manager_minor"]').textContent, /6\s970,00/);
  assert.equal(view.controller.hasChanges(), true);
  await submit(view);
  assert.equal(writes.length, 1);
  const body = JSON.parse(writes[0].body);
  assert.deepEqual(Object.keys(body).sort(), ["expected_revision", "inputs", "month"]);
  assert.equal(body.expected_revision, 2);
  assert.equal(body.inputs.revenue_minor, 1200000);
  assert.equal(writes[0].method, "PUT");
  assert.equal(view.controller.hasChanges(), false);
  assert.equal(view.save.disabled, true);
  assert.equal(view.message.textContent, "Збережено");
});

test("other expenses require a description; unknown fields can still be saved as an incomplete draft", async t => {
  let writes = 0;
  const view = mount(t, async (url, options) => {
    if (!options) return fixture();
    writes += 1;
    return fixture(JSON.parse(options.body).inputs, { revision: 1 });
  });
  await view.controller.load();
  input(view, "other_minor", "500");
  assert.equal(view.container.querySelector("[data-profit-note-wrap]").hidden, false);
  await submit(view);
  assert.equal(writes, 0);
  assert.match(view.message.textContent, /розшифровку/);
  input(view, "other_note", "Комісія банку");
  await submit(view);
  assert.equal(writes, 1);
  assert.equal(view.container.querySelector('[data-profit-result="manager_minor"]').textContent, "—");
});

test("invalid decimals cannot be saved and remain intact for correction", async t => {
  let writes = 0;
  const view = mount(t, async (url, options) => { if (options) writes += 1; return fixture(); });
  await view.controller.load(); input(view, "shipping_minor", "10.001");
  await submit(view);
  assert.equal(writes, 0);
  assert.equal(view.form.elements.shipping_minor.value, "10.001");
  assert.equal(view.form.elements.shipping_minor.getAttribute("aria-invalid"), "true");
});

test("month switch and refresh protect dirty inputs; confirmed leave resets only the local draft", async t => {
  let approved = false, calls = 0;
  const view = mount(t, async url => { calls += 1; return fixture(complete(), { month: new URL(url, "https://example.test").searchParams.get("month") }); }, { confirmDiscard: () => approved });
  await view.controller.load(); input(view, "revenue_minor", "25000");
  assert.equal(await view.controller.load("2026-08"), false);
  assert.equal(view.controller.getMonth(), "2026-09");
  assert.equal(view.form.elements.revenue_minor.value, "25000");
  assert.equal(await view.controller.load(), false);
  assert.equal(calls, 1);
  assert.equal(view.controller.canLeave(), false);
  approved = true;
  assert.equal(view.controller.canLeave(), true);
  assert.equal(view.form.elements.revenue_minor.value, "10000,00");
  assert.equal(view.controller.hasChanges(), false);
  await view.controller.load("2026-08");
  assert.equal(calls, 2);
  assert.equal(view.controller.getMonth(), "2026-08");
});

test("409 retains edits, disables retry until confirmed reload and never silently overwrites newer state", async t => {
  let writes = 0, gets = 0;
  const view = mount(t, async (url, options) => {
    if (!options) { gets += 1; return fixture(complete(), { revision: gets }); }
    writes += 1;
    throw Object.assign(new Error("private conflict contents"), { status: 409 });
  });
  await view.controller.load(); input(view, "revenue_minor", "25000");
  await submit(view);
  assert.equal(view.form.elements.revenue_minor.value, "25000");
  assert.equal(view.controller.hasChanges(), true);
  assert.equal(view.save.disabled, true);
  assert.match(view.message.textContent, /іншому вікні/);
  assert.doesNotMatch(view.message.textContent, /private/);
  await submit(view);
  assert.equal(writes, 1);
  await view.controller.load();
  assert.equal(gets, 2);
  assert.equal(view.controller.hasChanges(), false);
});

test("busy guards prevent duplicate saves and navigation, and a transient error preserves a retryable draft", async t => {
  let rejectSave, writes = 0;
  const view = mount(t, async (url, options) => {
    if (!options) return fixture(complete());
    writes += 1;
    return new Promise((resolve, reject) => { rejectSave = reject; });
  });
  await view.controller.load(); input(view, "revenue_minor", "25000");
  await submit(view);
  assert.equal(view.controller.isBusy(), true);
  assert.equal(view.controller.canLeave(), false);
  assert.equal(view.form.elements.revenue_minor.disabled, true);
  await submit(view);
  assert.equal(writes, 1);
  rejectSave(new Error("database secret details")); await tick();
  assert.equal(view.controller.isBusy(), false);
  assert.equal(view.save.disabled, false);
  assert.equal(view.form.elements.revenue_minor.value, "25000");
  assert.doesNotMatch(view.message.textContent, /secret/);
});

test("partial advertising keeps known costs visible but every calculated result unknown", async t => {
  const ad = { google_minor: 12000, meta_minor: null, total_minor: null, coverage: "partial", through: "2026-10-08" };
  const view = mount(t, async () => fixture(complete(), { month: "2026-10", current_month: true, is_provisional: true, advertising: ad, calculation: { status: "draft", profit_before_manager_minor: 999999, manager_minor: 999, owner_remaining_minor: 999 } }));
  await view.controller.load("2026-10");
  assert.match(view.container.querySelector('[data-profit-ad="google_minor"]').textContent, /120,00/);
  assert.equal(view.container.querySelector('[data-profit-ad="meta_minor"]').textContent, "—");
  assert.equal(view.container.querySelector('[data-profit-result="manager_minor"]').textContent, "—");
  assert.match(view.container.querySelector("[data-profit-ad-status]").textContent, /Неповні дані.*реклама по 08\.10/);
});

test("current month is explicitly provisional even when every completed ad day is available", async t => {
  const view = mount(t, async () => fixture(complete(), { month: "2026-10", current_month: true, is_provisional: true, advertising: { ...advertising(), through: "2026-10-08" } }));
  await view.controller.load("2026-10");
  assert.equal(view.container.querySelector("[data-profit-ad-status]").textContent, "Попередньо · реклама по 08.10");
});

test("auth errors propagate through existing API helper without exposing backend details; malformed responses stay unusable", async t => {
  const unauthorized = mount(t, async () => { throw Object.assign(new Error("private"), { status: 401 }); });
  await assert.rejects(unauthorized.controller.load(), { status: 401 });
  assert.match(unauthorized.message.textContent, /Увійдіть/);
  for (const data of [fixture(complete(), { basis: "created_orders" }), fixture(complete(), { currency: "USD" }), fixture(complete(), { advertising: { ...advertising(), total_minor: 100 } })]) {
    const view = mount(t, async () => data);
    assert.equal(await view.controller.load(), false);
    assert.equal(view.form.elements.revenue_minor.disabled, true);
    assert.equal(view.container.querySelector('[data-profit-result="manager_minor"]').textContent, "—");
  }
});
