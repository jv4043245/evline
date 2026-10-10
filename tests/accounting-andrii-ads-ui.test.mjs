import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { andriiAdvertisingRange, validAndriiAdvertisingRange, createAndriiAdvertisingView } from "../admin/accounting-andrii-ads.js";

const now = () => new Date("2026-10-10T10:00:00Z");
const tick = () => new Promise(resolve => setImmediate(resolve));
const report = (url, extra = {}) => {
  const params = new URL(url, "https://example.test").searchParams;
  return { scope: "andrii", currency: "UAH", timezone: "Europe/Kyiv", from: params.get("from"), to: params.get("to"), effective_to: params.get("to"),
    coverage: "complete", google_minor: 1000, meta_minor: 2000, total_minor: 3000, google_known_minor: 1000, meta_known_minor: 2000, known_total_minor: 3000, is_provisional: false, monthly: [], ...extra };
};
function mount(t, api = async url => report(url), options = {}) {
  const window = new JSDOM('<div class="accounting-profit"><div id="ads"></div></div>').window;
  t.after(() => window.close());
  const root = window.document.querySelector("#ads");
  const view = createAndriiAdvertisingView(root, api, { now, getMonth: () => "2026-09", ...options });
  const details = root.querySelector("details"), form = root.querySelector("form");
  return { window, root, details, form, view, from: root.querySelector("[data-andrii-from]"), to: root.querySelector("[data-andrii-to]"), status: root.querySelector("[data-andrii-ads-status]") };
}
async function open(view) { view.details.open = true; await view.view.load(); await tick(); }
function dates(view, from, to) {
  view.from.value = from; view.to.value = to;
  view.from.dispatchEvent(new view.window.Event("input", { bubbles: true }));
}

test("presets mean complete calendar months, with leap years and January boundaries", () => {
  assert.deepEqual(andriiAdvertisingRange("2026-09", 1, now()), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(andriiAdvertisingRange("2026-09", 2, now()), { from: "2026-08-01", to: "2026-09-30" });
  assert.deepEqual(andriiAdvertisingRange("2026-09", 3, now()), { from: "2026-07-01", to: "2026-09-30" });
  assert.deepEqual(andriiAdvertisingRange("2026-01", 3, now()), { from: "2025-11-01", to: "2026-01-31" });
  assert.deepEqual(andriiAdvertisingRange("2024-02", 1, now()), { from: "2024-02-01", to: "2024-02-29" });
  assert.deepEqual(andriiAdvertisingRange("2026-10", 1, now()), { from: "2026-10-01", to: "2026-10-10" });
  assert.deepEqual(andriiAdvertisingRange("2026-10", 1, new Date("2026-09-30T21:30:00Z")), { from: "2026-10-01", to: "2026-10-01" });
  for (const month of ["2026-13", "2026-11", "2019-12", "invalid"]) assert.throws(() => andriiAdvertisingRange(month, 1, now()));
  assert.throws(() => andriiAdvertisingRange("2020-01", 2, now()));
});

test("inclusive custom date validation rejects impossible/future/inverted/oversized ranges", () => {
  assert.equal(validAndriiAdvertisingRange("2026-08-15", "2026-09-12", now()), true);
  assert.equal(validAndriiAdvertisingRange("2026-10-10", "2026-10-10", now()), true);
  for (const [from, to] of [["2026-02-30", "2026-03-01"], ["2026-10-11", "2026-10-11"], ["2026-09-12", "2026-08-15"], ["2019-01-01", "2019-01-02"], ["2020-01-01", "2026-10-01"]]) assert.equal(validAndriiAdvertisingRange(from, to, now()), false);
});

test("collapsed module is read-only and lazy; first open defaults to selected monthly draft", async t => {
  const requests = [];
  const ui = mount(t, async (url, options) => { requests.push({ url, options }); return report(url); });
  assert.equal(ui.details.open, false);
  assert.equal(await ui.view.load(), false);
  assert.equal(requests.length, 0);
  await open(ui);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/admin/accounting/andrii?from=2026-09-01&to=2026-09-30");
  assert.equal(requests[0].options.method, undefined);
  assert.equal(ui.from.value, "2026-09-01");
  assert.equal(ui.to.value, "2026-09-30");
  assert.match(ui.root.textContent, /Без румунської реклами/);
  assert.match(ui.root.querySelector("[data-andrii-ads-anchor]").textContent, /вересень 2026/);
  assert.match(ui.root.querySelector('[data-andrii-ads-total="total_minor"]').textContent, /30,00/);
  assert.equal(ui.root.querySelector('[name="revenue_minor"]'), null);
  assert.equal(ui.root.querySelector('[data-profit-save]'), null);
});

test("one/two/three month buttons and custom dates use only dedicated Andrii endpoint", async t => {
  const requests = [], ui = mount(t, async url => { requests.push(url); return report(url); });
  await open(ui);
  for (const count of [2, 3, 1]) { ui.root.querySelector(`[data-andrii-months="${count}"]`).click(); await tick(); }
  dates(ui, "2026-08-15", "2026-09-12");
  ui.form.dispatchEvent(new ui.window.Event("submit", { cancelable: true })); await tick();
  assert.deepEqual(requests, ["/api/admin/accounting/andrii?from=2026-09-01&to=2026-09-30", "/api/admin/accounting/andrii?from=2026-08-01&to=2026-09-30", "/api/admin/accounting/andrii?from=2026-07-01&to=2026-09-30", "/api/admin/accounting/andrii?from=2026-09-01&to=2026-09-30", "/api/admin/accounting/andrii?from=2026-08-15&to=2026-09-12"]);
});

test("custom changes clear old figures and invalid dates never load", async t => {
  let calls = 0; const ui = mount(t, async url => { calls++; return report(url); });
  await open(ui); dates(ui, "2026-09-15", "2026-09-12");
  assert.equal(ui.root.querySelector('[data-andrii-ads-total="total_minor"]').textContent, "—");
  assert.equal(await ui.view.load(true), false);
  assert.equal(calls, 1); assert.match(ui.status.textContent, /коректні дати/);
});

test("incomplete data never appears as zero or complete total and known subtotal is explicit", async t => {
  const ui = mount(t, async url => report(url, { coverage: "partial", google_minor: null, total_minor: null, google_known_minor: 500, known_total_minor: 2500, igor_allocation: "incomplete" }));
  await open(ui);
  assert.equal(ui.root.querySelector('[data-andrii-ads-total="google_minor"]').textContent, "—");
  assert.equal(ui.root.querySelector('[data-andrii-ads-total="total_minor"]').textContent, "—");
  assert.match(ui.root.querySelector("[data-andrii-ads-known]").textContent, /25,00.*не повний підсумок/);
  assert.match(ui.status.textContent, /Румунські витрати ще не звірені/);
});

test("current period discloses yesterday cap; a today-only response remains missing", async t => {
  const ui = mount(t, async url => report(url, { effective_to: "2026-10-09", is_provisional: true }), { getMonth: () => "2026-10" });
  await open(ui); assert.match(ui.status.textContent, /реклама по 09\.10\.2026/);
  const empty = mount(t, async url => report(url, { effective_to: null, is_provisional: true, coverage: "missing", google_minor: null, meta_minor: null, total_minor: null, google_known_minor: null, meta_known_minor: null, known_total_minor: null }));
  await open(empty); dates(empty, "2026-10-10", "2026-10-10"); await empty.view.load(true);
  assert.match(empty.status.textContent, /поточний день ще не завершено/);
  assert.equal(empty.root.querySelector("[data-andrii-ads-known]").hidden, true);
});

test("slower stale response cannot overwrite newer selected dates and old request is aborted", async t => {
  const requests = []; const ui = mount(t, (url, options) => new Promise(resolve => requests.push({ url, options, resolve })));
  ui.details.open = true; const first = ui.view.load(); await tick();
  dates(ui, "2026-08-15", "2026-09-12"); const second = ui.view.load(true); await tick();
  assert.equal(requests[0].options.signal.aborted, true);
  requests[1].resolve(report(requests[1].url, { google_minor: 4000, total_minor: 6000 })); await second;
  requests[0].resolve(report(requests[0].url)); await first;
  assert.match(ui.root.querySelector('[data-andrii-ads-total="total_minor"]').textContent, /60,00/);
  assert.match(ui.status.textContent, /15\.08\.2026/);
  assert.equal(ui.view.isBusy(), false);
});

test("server errors and malformed responses show no stale amount or private details", async t => {
  for (const api of [async () => { throw Object.assign(new Error("private database secret"), { status: 503 }); }, async url => report(url, { scope: "igor" }), async url => report(url, { total_minor: 1 }), async url => report(url, { monthly: [{ month: '<img onerror="alert(1)">', from: "2026-09-01", to: "2026-09-30" }] })]) {
    const ui = mount(t, api); await open(ui);
    assert.equal(ui.root.querySelector('[data-andrii-ads-total="total_minor"]').textContent, "—");
    assert.match(ui.status.textContent, /Не вдалося/); assert.doesNotMatch(ui.root.textContent, /private|secret/); assert.equal(ui.root.querySelector("img"), null);
  }
});

test("multi-month table shows only scoped monthly amounts and no monetary inputs", async t => {
  const ui = mount(t, async url => report(url, { monthly: [{ month: "2026-08", from: "2026-08-01", to: "2026-08-31", google_minor: 500, meta_minor: 1000, total_minor: 1500, coverage: "complete" }, { month: "2026-09", from: "2026-09-01", to: "2026-09-30", google_minor: 500, meta_minor: 1000, total_minor: 1500, coverage: "complete" }] }));
  ui.details.open = true; ui.from.value = "2026-08-01"; await ui.view.load();
  ui.root.querySelector('[data-andrii-months="2"]').click(); await tick();
  assert.equal(ui.root.querySelector("[data-andrii-ads-months-wrap]").hidden, false);
  assert.equal(ui.root.querySelectorAll("tbody tr").length, 2);
  assert.match(ui.root.querySelector("tbody").textContent, /серпень 2026.*вересень 2026/);
  assert.equal(ui.root.querySelectorAll('input:not([type="date"])').length, 0);
});

test("monthly table identifies partial calendar slices and rejects month/date disagreement", async t => {
  const rows = [{ month: "2026-08", from: "2026-08-15", to: "2026-08-31", google_minor: 500, meta_minor: 1000, total_minor: 1500, coverage: "complete" }, { month: "2026-09", from: "2026-09-01", to: "2026-09-12", google_minor: 500, meta_minor: 1000, total_minor: 1500, coverage: "complete" }];
  let malformed = false;
  const ui = mount(t, async url => report(url, { monthly: rows.map((row, index) => ({ ...row, ...(malformed && index === 0 ? { month: "2026-07" } : {}) })) }));
  await open(ui); dates(ui, "2026-08-15", "2026-09-12"); await ui.view.load(true);
  assert.match(ui.root.querySelector("tbody").textContent, /15\.08\.2026–31\.08\.2026/);
  assert.match(ui.root.querySelector("tbody").textContent, /01\.09\.2026–12\.09\.2026/);
  malformed = true; assert.equal(await ui.view.load(true), false);
  assert.equal(ui.root.querySelector("[data-andrii-ads-months-wrap]").hidden, true);
});

test("preset context follows selected draft month without silently changing an independent custom period", async t => {
  let month = "2026-09";
  const ui = mount(t, async url => report(url), { getMonth: () => month });
  await open(ui); dates(ui, "2026-08-15", "2026-09-12"); await ui.view.load(true);
  month = "2026-08"; await ui.view.load();
  assert.match(ui.root.querySelector("[data-andrii-ads-anchor]").textContent, /серпень 2026/);
  assert.equal(ui.from.value, "2026-08-15"); assert.equal(ui.to.value, "2026-09-12");
  ui.root.querySelector('[data-andrii-months="2"]').click(); await tick();
  assert.equal(ui.from.value, "2026-07-01"); assert.equal(ui.to.value, "2026-08-31");
});
