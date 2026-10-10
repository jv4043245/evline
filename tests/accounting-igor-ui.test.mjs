import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { calculateIgorPreview, createAccountingIgorView, defaultIgorMonth, parseIgorAmount, validIgorMonth } from "../admin/accounting-igor.js";

const now = () => new Date("2026-10-10T10:00:00Z");
const blank = () => ({ fees_minor: null, fees_note: "" });
const noCampaigns = () => ({ google_minor: null, meta_minor: null, total_minor: null, coverage: "not_configured", through: "2026-10-09" });
const completeAds = () => ({ google_minor: 12500, meta_minor: 20000, total_minor: 32500, coverage: "complete", through: "2026-10-09" });
const fixture = (inputs = blank(), advertising = noCampaigns(), extra = {}) => ({ month: "2026-10", revision: 0, basis: "advertising_reimbursement", currency: "UAH", timezone: "Europe/Kyiv", inputs, advertising, calculation: calculateIgorPreview(inputs, advertising), campaigns: [], current_month: true, is_provisional: true, updated_at: null, ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));
function mount(t, api, options = {}) {
  const window = new JSDOM('<section id="igor"></section>').window;
  t.after(() => window.close());
  const container = window.document.querySelector("#igor");
  const controller = createAccountingIgorView(container, api, { now, confirmDiscard: () => true, ...options });
  return { window, container, controller, form: container.querySelector("form"), message: container.querySelector("[data-igor-message]"), save: container.querySelector("[data-igor-save]") };
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

test("Igor opens current Kyiv month and forbids malformed historical month values", () => {
  assert.equal(defaultIgorMonth(now()), "2026-10");
  assert.equal(defaultIgorMonth(new Date("2026-09-30T21:30:00Z")), "2026-10");
  assert.equal(defaultIgorMonth(new Date("2025-12-31T22:30:00Z")), "2026-01");
  assert.equal(validIgorMonth("2019-12"), false);
  assert.equal(validIgorMonth("2020-01"), true);
  for (const value of [null, "2026-13", "2026-1", "26-10"]) assert.equal(validIgorMonth(value), false);
});

test("Igor amount parsing distinguishes absent fees from confirmed zero and uses integer kopecks", () => {
  assert.equal(parseIgorAmount(""), null);
  assert.equal(parseIgorAmount("  "), null);
  assert.equal(parseIgorAmount("0"), 0);
  assert.equal(parseIgorAmount("1 234,56"), 123456);
  assert.equal(parseIgorAmount("1\u202f234.5"), 123450);
  assert.equal(parseIgorAmount("1000000000.00"), 100000000000);
  for (const value of ["1000000000.01", "0.001", "-1", "+1", "1e3", "NaN", "Infinity", "1,2.3", "12грн", "9".repeat(100)]) assert.throws(() => parseIgorAmount(value));
});

test("reimbursement is 100% of verified spend plus actual fees, without a profit commission", () => {
  const calculation = calculateIgorPreview({ fees_minor: 1300, fees_note: "Комісія банку" }, completeAds());
  assert.deepEqual(calculation, { status: "draft", reimbursement_minor: 33800, missing_keys: [] });
  assert.equal(calculateIgorPreview({ fees_minor: 0, fees_note: "" }, completeAds()).reimbursement_minor, 32500);
  assert.equal(calculateIgorPreview(blank(), completeAds()).reimbursement_minor, null);
  assert.ok(calculateIgorPreview(blank(), completeAds()).missing_keys.includes("fees_minor"));
  assert.equal(calculateIgorPreview({ fees_minor: 10, fees_note: "" }, completeAds()).status, "incomplete");
  assert.equal(calculateIgorPreview({ fees_minor: 10, fees_note: "x".repeat(501) }, completeAds()).status, "incomplete");
  for (const coverage of ["partial", "missing"]) assert.equal(calculateIgorPreview({ fees_minor: 0, fees_note: "" }, { ...completeAds(), coverage }).reimbursement_minor, null);
  assert.equal(calculateIgorPreview({ fees_minor: 0, fees_note: "" }, noCampaigns()).status, "not_configured");
  assert.equal(calculateIgorPreview({ fees_minor: 1, fees_note: "Банк" }, { coverage: "complete", total_minor: Number.MAX_SAFE_INTEGER }).status, "incomplete");
});

test("unconfigured campaigns render as unknown, not zero, with the dedicated current-month route", async t => {
  const requests = [], view = mount(t, async (...args) => { requests.push(args); return fixture(); });
  assert.equal(view.form.elements.fees_minor.disabled, true);
  await view.controller.load();
  assert.equal(requests[0][0], "/api/admin/accounting/igor?month=2026-10");
  assert.equal(view.container.querySelector("h1").textContent, "Розрахунок Ігоря");
  assert.match(view.container.textContent, /Румунія · компенсація реклами 100%/);
  assert.match(view.container.textContent, /Комісії та доплати, грн/);
  assert.match(view.container.textContent, /лише фактична частка Ігоря, ще не врахована в рекламі/);
  assert.match(view.container.textContent, /Кампанії ще не підключені/);
  assert.doesNotMatch(view.container.textContent, /15%|Виручка|Прибуток|Закупівля|Андрі/);
  assert.equal(view.container.querySelector('[data-igor-ad="google_minor"]').textContent, "—");
  assert.equal(view.container.querySelector('[data-igor-ad="meta_minor"]').textContent, "—");
  assert.equal(view.container.querySelector("[data-igor-result]").textContent, "—");
  assert.equal(view.form.elements.fees_minor.value, "");
  assert.equal(view.container.querySelector('input[name="total_minor"]'), null);
  assert.equal(view.controller.hasChanges(), false);
  assert.equal(view.controller.isBusy(), false);
  assert.equal(view.save.disabled, true);
  assert.equal(view.container.querySelector("[data-igor-month]").max, "2026-10");
  assert.equal(view.container.querySelector("[data-igor-month]").min, "2020-01");
});

test("fee edits preview and save only month, revision and explicit fee inputs", async t => {
  const writes = [], view = mount(t, async (url, options) => {
    if (!options) return fixture(blank(), completeAds(), { revision: 2 });
    writes.push({ url, ...options });
    return fixture(JSON.parse(options.body).inputs, completeAds(), { revision: 3 });
  });
  await view.controller.load();
  input(view, "fees_minor", "12,50"); input(view, "fees_note", "  Банк, 09.10, конвертація  ");
  assert.match(view.container.querySelector("[data-igor-result]").textContent, /337,50/);
  assert.equal(view.controller.hasChanges(), true);
  await submit(view);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, "/api/admin/accounting/igor?month=2026-10");
  assert.equal(writes[0].method, "PUT");
  assert.deepEqual(JSON.parse(writes[0].body), { month: "2026-10", expected_revision: 2, inputs: { fees_minor: 1250, fees_note: "Банк, 09.10, конвертація" } });
  assert.equal(view.controller.hasChanges(), false);
  assert.equal(view.save.disabled, true);
  assert.equal(view.message.textContent, "Збережено");
});

test("positive fees require a note, whereas confirmed zero and incomplete drafts can be saved", async t => {
  const writes = [], view = mount(t, async (url, options) => {
    if (!options) return fixture();
    const inputs = JSON.parse(options.body).inputs; writes.push(inputs);
    return fixture(inputs, noCampaigns(), { revision: writes.length });
  });
  await view.controller.load();
  input(view, "fees_minor", "5");
  assert.equal(view.container.querySelector("[data-igor-note-wrap]").hidden, false);
  await submit(view);
  assert.equal(writes.length, 0);
  assert.equal(view.form.elements.fees_note.getAttribute("aria-invalid"), "true");
  assert.match(view.message.textContent, /розшифровку/);
  input(view, "fees_minor", "0");
  await submit(view);
  assert.equal(writes[0].fees_minor, 0);
  assert.equal(view.container.querySelector("[data-igor-result]").textContent, "—");
  input(view, "fees_minor", "");
  await submit(view);
  assert.equal(writes[1].fees_minor, null);
});

test("invalid decimals remain for correction and never reach the API", async t => {
  let writes = 0;
  const view = mount(t, async (url, options) => { if (options) writes += 1; return fixture(); });
  await view.controller.load(); input(view, "fees_minor", "10.001");
  await submit(view);
  assert.equal(writes, 0);
  assert.equal(view.form.elements.fees_minor.value, "10.001");
  assert.equal(view.form.elements.fees_minor.getAttribute("aria-invalid"), "true");
  assert.equal(view.container.querySelector("[data-igor-result]").textContent, "—");
});

test("dirty guards protect edits across refresh, month changes and top-level navigation", async t => {
  let approved = false, calls = 0;
  const view = mount(t, async url => { calls += 1; return fixture({ fees_minor: 0, fees_note: "" }, completeAds(), { month: new URL(url, "https://example.test").searchParams.get("month") }); }, { confirmDiscard: () => approved });
  await view.controller.load(); input(view, "fees_minor", "50");
  assert.equal(await view.controller.load("2026-09"), false);
  assert.equal(view.controller.getMonth(), "2026-10");
  assert.equal(view.form.elements.fees_minor.value, "50");
  assert.equal(await view.controller.load(), false);
  assert.equal(calls, 1);
  assert.equal(view.controller.canLeave(), false);
  approved = true;
  assert.equal(view.controller.canLeave(), true);
  assert.equal(view.form.elements.fees_minor.value, "0,00");
  assert.equal(view.controller.hasChanges(), false);
  await view.controller.load("2026-09");
  assert.equal(calls, 2);
  assert.equal(view.controller.getMonth(), "2026-09");
});

test("optimistic concurrency conflicts preserve edits and block retries until a confirmed fresh read", async t => {
  let writes = 0, gets = 0;
  const view = mount(t, async (url, options) => {
    if (!options) { gets += 1; return fixture(blank(), completeAds(), { revision: gets }); }
    writes += 1; throw Object.assign(new Error("private database details"), { status: 409 });
  });
  await view.controller.load(); input(view, "fees_minor", "0");
  await submit(view);
  assert.equal(view.form.elements.fees_minor.value, "0");
  assert.equal(view.controller.hasChanges(), true);
  assert.equal(view.save.disabled, true);
  assert.match(view.message.textContent, /іншому вікні/);
  assert.doesNotMatch(view.message.textContent, /private/);
  await submit(view); assert.equal(writes, 1);
  await view.controller.load();
  assert.equal(gets, 2);
  assert.equal(view.controller.hasChanges(), false);
});

test("busy saves prevent duplicate writes/navigation; failures preserve retryable inputs", async t => {
  let rejectSave, writes = 0;
  const view = mount(t, async (url, options) => {
    if (!options) return fixture();
    writes += 1; return new Promise((resolve, reject) => { rejectSave = reject; });
  });
  await view.controller.load(); input(view, "fees_minor", "0");
  await submit(view);
  assert.equal(view.controller.isBusy(), true);
  assert.equal(view.controller.canLeave(), false);
  assert.equal(view.form.elements.fees_minor.disabled, true);
  assert.equal(await view.controller.load("2026-09"), false);
  await submit(view); assert.equal(writes, 1);
  rejectSave(new Error("secret error contents")); await tick();
  assert.equal(view.controller.isBusy(), false);
  assert.equal(view.save.disabled, false);
  assert.equal(view.form.elements.fees_minor.value, "0");
  assert.doesNotMatch(view.message.textContent, /secret/);
});

test("concurrent reads share a single request and cannot change the loading month", async t => {
  let resolveRead, reads = 0;
  const view = mount(t, () => { reads += 1; return new Promise(resolve => { resolveRead = resolve; }); });
  const first = view.controller.load(), second = view.controller.load();
  await tick();
  assert.equal(reads, 1);
  assert.equal(await view.controller.load("2026-09"), false);
  resolveRead(fixture());
  assert.equal(await first, true); assert.equal(await second, true);
  assert.equal(view.controller.getMonth(), "2026-10");
});

test("partial advertising shows only known provider sums and no total; current periods are provisional", async t => {
  const ad = { google_minor: 12000, meta_minor: null, total_minor: null, coverage: "partial", through: "2026-10-09" };
  const view = mount(t, async () => fixture({ fees_minor: 0, fees_note: "" }, ad));
  await view.controller.load();
  assert.match(view.container.querySelector('[data-igor-ad="google_minor"]').textContent, /120,00/);
  assert.equal(view.container.querySelector('[data-igor-ad="meta_minor"]').textContent, "—");
  assert.equal(view.container.querySelector("[data-igor-result]").textContent, "—");
  assert.equal(view.container.querySelector("[data-igor-ad-status]").textContent, "Неповні дані за місяць · реклама по 09.10");
  const complete = mount(t, async () => fixture({ fees_minor: 0, fees_note: "" }, completeAds()));
  await complete.controller.load();
  assert.equal(complete.container.querySelector("[data-igor-ad-status]").textContent, "Попередньо · реклама по 09.10");
});

test("future/invalid months do not call the API or corrupt the selected month", async t => {
  let calls = 0;
  const view = mount(t, async () => { calls += 1; return fixture(); });
  await view.controller.load();
  for (const value of ["2026-11", "2026-13", "2019-12", "garbage"]) assert.equal(await view.controller.load(value), false);
  assert.equal(calls, 1);
  assert.equal(view.controller.getMonth(), "2026-10");
  assert.equal(view.container.querySelector("[data-igor-month]").value, "2026-10");
});

test("auth errors propagate without exposing private details and stale amounts disappear on a failed new month", async t => {
  const unauthorized = mount(t, async () => { throw Object.assign(new Error("private"), { status: 401 }); });
  await assert.rejects(unauthorized.controller.load(), { status: 401 });
  assert.match(unauthorized.message.textContent, /Увійдіть/);
  assert.doesNotMatch(unauthorized.message.textContent, /private/);
  let calls = 0;
  const view = mount(t, async () => { if (++calls > 1) throw new Error("private"); return fixture({ fees_minor: 0, fees_note: "" }, completeAds()); });
  await view.controller.load();
  assert.match(view.container.querySelector("[data-igor-result]").textContent, /325,00/);
  assert.equal(await view.controller.load("2026-09"), false);
  assert.equal(view.container.querySelector("[data-igor-result]").textContent, "—");
  assert.equal(view.form.elements.fees_minor.disabled, true);
});

test("malformed and inconsistent financial responses cannot display a payable figure", async t => {
  const good = fixture({ fees_minor: 0, fees_note: "" }, completeAds());
  for (const data of [
    { ...good, basis: "paid_and_delivered" }, { ...good, currency: "USD" }, { ...good, timezone: "UTC" },
    { ...good, campaigns: null }, { ...good, month: "2026-09" },
    { ...good, advertising: { ...completeAds(), total_minor: 1 } },
    { ...good, advertising: { ...completeAds(), through: "2026-02-30" } },
    { ...good, advertising: { ...completeAds(), coverage: "partial" } },
    { ...good, advertising: { ...noCampaigns(), google_minor: 0 } },
    { ...good, calculation: { status: "draft", reimbursement_minor: 1, missing_keys: [] } },
    { ...good, inputs: { fees_minor: 10, fees_note: "" } },
  ]) {
    const view = mount(t, async () => data);
    assert.equal(await view.controller.load(), false);
    assert.equal(view.form.elements.fees_minor.disabled, true);
    assert.equal(view.container.querySelector("[data-igor-result]").textContent, "—");
  }
});

test("blank container integration is a safe no-op", async () => {
  const view = createAccountingIgorView(null, () => { throw new Error("must not call"); }, { now });
  await view.load();
  assert.equal(view.getMonth(), "2026-10");
  assert.equal(view.hasChanges(), false); assert.equal(view.isDirty(), false);
  assert.equal(view.isBusy(), false); assert.equal(view.canLeave(), true);
});
