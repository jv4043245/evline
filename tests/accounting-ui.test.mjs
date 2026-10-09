import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { accountingPeriod, accountingMonths, accountingChartMonths, accountingSpendTotal, createAccountingPeriodState, renderAccounting, createAccountingView } from "../admin/accounting.js";

const html = readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
const source = readFileSync(new URL("../admin/admin.js", import.meta.url), "utf8");
const now = () => new Date("2026-10-09T10:00:00Z");
const documentFor = t => {
  const window = new JSDOM(html).window;
  t.after(() => window.close());
  return window.document;
};
const daysMode = root => root.querySelectorAll("[data-accounting-granularity]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.accountingGranularity === "days")));
const fixture = () => ({
  currency: "UAH", timezone: "Europe/Kyiv",
  totals: { google_uah: 125.45, meta_uah: null, orders: 4 },
  sources: { google: { status: "partial", updated_at: "2026-10-09T05:12:00Z", days_present: 2, days_expected: 3 }, meta: { status: "missing", days_present: 0, days_expected: 3 } },
  daily: [
    { date: "2026-10-06", google_uah: 125.45, meta_uah: null, google_coverage: "complete", meta_coverage: "missing", orders: 1 },
    { date: "2026-10-07", google_uah: null, meta_uah: null, google_coverage: "missing", meta_coverage: "missing", orders: 1 },
    { date: "2026-10-08", google_uah: 0, meta_uah: null, google_coverage: "complete", meta_coverage: "missing", orders: 2 },
  ],
});

test("accounting adds one primary section without removing existing admin features", t => {
  const root = documentFor(t);
  assert.equal(root.querySelectorAll('.admin-tabs [data-admin-tab="accounting"]').length, 1);
  assert.equal(root.querySelectorAll('[data-admin-view="accounting"]').length, 1);
  assert.ok(root.querySelector('[data-admin-view="analytics"] [data-cost-form]'));
  assert.ok(root.querySelector('[data-admin-view="contacts"]'));
  assert.ok(root.querySelector('[data-admin-view="accounting"]').hidden);
  assert.equal(root.querySelector("#range").getAttribute("aria-label"), "Період звіту");
  assert.match(source, /createAccountingView\(document, api\)/);
  assert.match(source, /state\.activeTab === "accounting" \? loadAccountingPanel\(\)/);
  assert.equal(root.querySelectorAll('[data-accounting-tab]').length, 2);
  assert.ok(root.querySelector('[data-accounting-panel="advertising"] [data-accounting-content]'));
  assert.ok(root.querySelector('[data-accounting-panel="profit"] [data-accounting-profit]'));
  assert.ok(root.querySelector('[data-accounting-panel="profit"]').hidden);
  assert.match(source, /accountingProfitView\.hasChanges\(\)/);
  assert.match(source, /accountingProfitView\.canLeave\(\)/);
});

test("period includes completed Kyiv days only, including UTC boundary and both DST changes", () => {
  assert.deepEqual(accountingPeriod("30d", now()), { from: "2026-09-09", to: "2026-10-08" });
  assert.deepEqual(accountingPeriod("7d", new Date("2026-10-08T22:30:00Z")), { from: "2026-10-02", to: "2026-10-08" });
  assert.deepEqual(accountingPeriod("7d", new Date("2026-03-29T22:30:00Z")), { from: "2026-03-23", to: "2026-03-29" });
  assert.deepEqual(accountingPeriod("7d", new Date("2026-10-25T22:30:00Z")), { from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(accountingPeriod("90d", now()), { from: "2026-07-11", to: "2026-10-08" });
  assert.deepEqual(accountingPeriod("365d", now()), { from: "2025-10-09", to: "2026-10-08" });
  assert.deepEqual(accountingPeriod("all", now()), { range: "all", to: "2026-10-08" });
  assert.deepEqual(accountingPeriod("unknown", now()), accountingPeriod("30d", now()));
});

test("missing spend is a dash while confirmed zero remains zero; partial totals are marked", t => {
  const root = documentFor(t);
  daysMode(root);
  renderAccounting(root, fixture());
  assert.match(root.querySelector('[data-accounting-total="google"]').textContent, /125,45/);
  assert.equal(root.querySelector('[data-accounting-total="meta"]').textContent, "—");
  assert.equal(root.querySelector('[data-accounting-source="google"]').textContent, "Неповні дані · 2/3 днів");
  assert.equal(root.querySelector('[data-accounting-total="orders"]').textContent, "4");
  const rows = [...root.querySelectorAll("[data-accounting-daily] tr")];
  assert.equal(rows[0].querySelector("th").textContent, "08.10.2026");
  assert.equal(rows[0].querySelector("td").textContent, "0,00");
  assert.equal(rows[1].querySelector("td").textContent, "—");
  assert.equal(rows[1].querySelector("td").getAttribute("aria-label"), "Немає даних");
  assert.equal(root.querySelector('.accounting-card--orders small').textContent, "Усі джерела");
});

test("missing or unrecognized source never turns an accidental numeric total into available spend", t => {
  const root = documentFor(t);
  for (const status of ["missing", "error", undefined]) {
    const data = fixture(); data.sources.google.status = status;
    renderAccounting(root, data);
    assert.equal(root.querySelector('[data-accounting-total="google"]').textContent, "—");
  }
});

test("latest import failure is visible without discarding known costs or exposing error details", t => {
  const root = documentFor(t), data = fixture();
  data.sources.google.status = "complete";
  data.sources.google.last_error = "upstream_unavailable";
  data.sources.google.last_attempt_at = "2026-10-09T08:00:00Z";
  renderAccounting(root, data);
  assert.match(root.querySelector('[data-accounting-total="google"]').textContent, /125,45/);
  const status = root.querySelector('[data-accounting-source="google"]');
  assert.equal(status.textContent, "Не вдалося оновити");
  assert.equal(status.dataset.status, "error");
  assert.match(status.title, /Останні отримані дані: 2026-10-09T05:12:00Z/);
  assert.doesNotMatch(root.querySelector('[data-admin-view="accounting"]').textContent, /upstream_unavailable/);
});

test("three lines use explicit separate units, and missing costs break the line rather than implying zero", t => {
  const root = documentFor(t);
  daysMode(root);
  renderAccounting(root, fixture());
  const svg = root.querySelector("[data-accounting-chart] svg");
  assert.equal(svg.getAttribute("role"), "group");
  assert.ok(svg.querySelector("title").textContent);
  assert.match(svg.querySelector("desc").textContent, /Ліва шкала.*гривнях; права.*штуках/);
  assert.equal(svg.querySelectorAll("polyline.accounting-chart__google").length, 2);
  assert.equal(svg.querySelectorAll("polyline.accounting-chart__meta").length, 0);
  assert.equal(svg.querySelectorAll("polyline.accounting-chart__orders").length, 1);
  assert.equal(svg.querySelector('[data-chart-axis="spend"]').textContent, "Реклама, грн");
  assert.equal(svg.querySelector('[data-chart-axis="orders"]').textContent, "Замовлення, шт.");
});

test("chart uses the container width on a phone rather than shrinking 800px labels", t => {
  const root = documentFor(t);
  daysMode(root);
  Object.defineProperty(root.querySelector("[data-accounting-chart]"), "clientWidth", { value: 330 });
  renderAccounting(root, fixture());
  assert.equal(root.querySelector("[data-accounting-chart] svg").getAttribute("viewBox"), "0 0 330 270");
});

test("empty data and invalid rows are safe and never invent zero balances or display a chart", t => {
  const root = documentFor(t);
  renderAccounting(root, { daily: [{ date: '<img src=x onerror=alert(1)>', google_uah: 3 }, { date: '2026-02-31', google_uah: 5 }] });
  assert.equal(root.querySelector('[data-accounting-total="google"]').textContent, "—");
  assert.equal(root.querySelector('[data-accounting-total="orders"]').textContent, "—");
  assert.equal(root.querySelector("[data-accounting-trend]").hidden, true);
  assert.equal(root.querySelectorAll("[data-accounting-daily] tr").length, 1);
  assert.equal(root.querySelector("[data-accounting-daily] img"), null);
  assert.match(root.querySelector("[data-accounting-daily]").textContent, /даних немає/);
});

test("accounting loader reuses the authenticated helper, deduplicates concurrent same-period requests and clears old values", async t => {
  const root = documentFor(t);
  let done; const urls = [];
  const view = createAccountingView(root, url => { urls.push(url); return new Promise(resolve => { done = resolve; }); }, now);
  const first = view.load("7d");
  assert.equal(view.load("7d"), first);
  await Promise.resolve();
  assert.deepEqual(urls, ["/api/admin/accounting?from=2026-10-02&to=2026-10-08"]);
  assert.equal(root.querySelector("[data-accounting-content]").getAttribute("aria-busy"), "true");
  done(fixture()); await first;
  assert.equal(root.querySelector("[data-accounting-content]").getAttribute("aria-busy"), "false");
  assert.equal(root.querySelector("[data-accounting-message]").hidden, true);
  const next = view.load("30d"); await Promise.resolve();
  assert.equal(root.querySelector('[data-accounting-total="google"]').textContent, "—");
  done(fixture()); await next;
});

test("a stale request cannot overwrite a newer date selection", async t => {
  const root = documentFor(t), pending = [];
  const view = createAccountingView(root, () => new Promise(resolve => pending.push(resolve)), now);
  const old = view.load("30d"), current = view.load("7d");
  await Promise.resolve();
  const data = fixture(); data.totals.orders = 8;
  pending[1](data); await current;
  pending[0](fixture()); await old;
  assert.equal(root.querySelector('[data-accounting-total="orders"]').textContent, "8");
  assert.match(root.querySelector("[data-accounting-period]").textContent, /02\.10\.2026/);
});

test("all-time asks the server for actual history and labels any retention bound", async t => {
  const root = documentFor(t), urls = [];
  const view = createAccountingView(root, async url => {
    urls.push(url);
    return { ...fixture(), from: "2021-10-09", to: "2026-10-08", range_limited: true };
  }, now);
  await view.load("all");
  assert.deepEqual(urls, ["/api/admin/accounting?range=all&to=2026-10-08"]);
  assert.match(root.querySelector("[data-accounting-period]").textContent, /09\.10\.2021 — 08\.10\.2026/);
  assert.match(root.querySelector("[data-accounting-period]").textContent, /Останні 5 років/);
});

test("failure shows a concise retry message, auth failure propagates, and neither leaks error details", async t => {
  const root = documentFor(t);
  for (const status of [500, 401]) {
    const view = createAccountingView(root, async () => { throw Object.assign(new Error("private_backend_details"), { status }); }, now);
    if (status === 401) await assert.rejects(view.load(), { status: 401 });
    else await view.load();
    assert.equal(root.querySelector('[data-accounting-total="google"]').textContent, "—");
    assert.equal(root.querySelector("[data-accounting-message]").hidden, false);
    assert.doesNotMatch(root.querySelector("[data-accounting-message]").textContent, /private_backend_details/);
    assert.equal(root.querySelector("[data-accounting-content]").getAttribute("aria-busy"), "false");
  }
});

test("accounting period starts all-time and remains independent from operational reports", () => {
  const store = new Map();
  const storage = { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) };
  const periods = createAccountingPeriodState(storage);
  assert.equal(periods.enter("orders", "30d"), "30d");
  periods.remember("orders", "90d");
  assert.equal(periods.enter("accounting", "90d"), "all");
  periods.remember("accounting", "365d");
  assert.equal(periods.enter("orders", "365d"), "90d");
  assert.equal(periods.enter("accounting", "90d"), "365d");
  assert.equal(createAccountingPeriodState(storage).enter("accounting", "30d"), "365d");
  store.set("evline_accounting_range", "malformed");
  assert.equal(createAccountingPeriodState(storage).enter("accounting", "30d"), "all");
  assert.match(source, /if \(state\.activeTab !== "accounting"\) state\.range = visibleRange/);
});

test("monthly sums integer kopecks across years and distinguishes incomplete data, absent data and explicit zero", () => {
  const daily = [
    { date: "2025-12-30", google_uah: .1, google_coverage: "complete", meta_uah: null, orders: 1 },
    { date: "2025-12-31", google_uah: .2, google_coverage: "complete", meta_uah: null, orders: 2 },
    { date: "2026-01-01", google_uah: null, meta_uah: null, orders: 0 },
    { date: "2026-01-02", google_uah: 0, google_coverage: "complete", meta_uah: null, orders: 1 },
  ];
  const months = accountingMonths(daily, { from: "2025-12-30", to: "2026-01-02" });
  assert.equal(months.length, 2);
  assert.equal(months[0].month, "2025-12");
  assert.equal(months[0].google_uah, .3);
  assert.equal(months[0].google_coverage, "complete");
  assert.equal(months[0].orders, 3);
  assert.equal(months[1].google_uah, 0);
  assert.equal(months[1].google_coverage, "partial");
  assert.equal(months[1].google_days_present, 1);
  assert.equal(months[1].days_expected, 2);
  assert.equal(months[1].meta_uah, null);
  assert.equal(months[1].meta_coverage, "missing");
});

test("monthly fallback fills a missing calendar day as unknown, not certified zero", () => {
  const [month] = accountingMonths([
    { date: "2026-09-01", google_uah: 1, google_coverage: "complete", orders: 1 },
    { date: "2026-09-03", google_uah: 2, google_coverage: "complete", orders: 1 },
  ]);
  assert.equal(month.days_expected, 3);
  assert.equal(month.google_uah, 3);
  assert.equal(month.google_coverage, "partial");
  assert.equal(month.orders, null);
});

test("combined advertising sums integer kopecks, preserving zero, partial coverage and missing channels", () => {
  const row = { google_uah: .1, meta_uah: .2, google_coverage: "complete", meta_coverage: "complete" };
  assert.deepEqual(accountingSpendTotal(row), { total_uah: .3, total_coverage: "complete" });
  assert.deepEqual(accountingSpendTotal({ ...row, google_uah: 0, meta_uah: 0 }), { total_uah: 0, total_coverage: "complete" });
  assert.deepEqual(accountingSpendTotal({ ...row, meta_coverage: "partial" }), { total_uah: .3, total_coverage: "partial" });
  for (const value of [null, undefined, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(accountingSpendTotal({ ...row, meta_uah: value }), { total_uah: null, total_coverage: "missing" });
  }
  for (const coverage of [undefined, "missing", "error"]) assert.equal(accountingSpendTotal({ ...row, meta_coverage: coverage }).total_uah, null);
  assert.equal(accountingSpendTotal({ ...row, google_uah: 60000000000000, meta_uah: 60000000000000 }).total_uah, null);
});

test("combined column matches the displayed month or day and never replaces a missing channel with zero", t => {
  const root = documentFor(t), data = fixture();
  assert.deepEqual([...root.querySelectorAll('.accounting-table thead th')].map(node => node.textContent), ["Місяць", "Google, грн", "Meta, грн", "Разом, грн", "Замовлення"]);
  data.daily = [
    { date: "2026-09-29", google_uah: .1, meta_uah: .2, google_coverage: "complete", meta_coverage: "complete", orders: 1 },
    { date: "2026-09-30", google_uah: 1, meta_uah: 2, google_coverage: "complete", meta_coverage: "partial", orders: 2 },
  ];
  renderAccounting(root, data);
  const total = () => root.querySelector('[data-accounting-cell="total_uah"]');
  assert.match(total().textContent, /^3,30/);
  assert.equal(total().querySelector('small').textContent, 'Неповні дані');
  assert.equal(root.querySelector('[data-accounting-cell="orders"]').textContent, "3");
  data.monthly = [{ month: "2026-09", from: "2026-09-01", to: "2026-09-30", google_uah: 5774.67, meta_uah: 12406.57, google_coverage: "complete", meta_coverage: "complete", orders: 106 }];
  renderAccounting(root, data);
  assert.match(total().textContent, /^18\s181,24$/);
  assert.equal(total().querySelector('small'), null);
  daysMode(root); renderAccounting(root, data);
  assert.match(total().textContent, /^3,00/);
  data.daily[1].meta_uah = null;
  renderAccounting(root, data);
  assert.equal(total().textContent, '—');
  assert.equal(total().getAttribute('aria-label'), 'Немає даних');
  renderAccounting(root, {});
  assert.equal(root.querySelector('[data-accounting-daily] td').colSpan, 5);
});

test("monthly is the default, partial coverage is explicit and granularity changes never refetch or change totals", async t => {
  const root = documentFor(t), urls = [];
  const view = createAccountingView(root, async url => { urls.push(url); return fixture(); }, now);
  await view.load("all");
  assert.equal(root.querySelector('[data-accounting-granularity="months"]').getAttribute("aria-pressed"), "true");
  assert.equal(root.querySelector("#accounting-history-title").textContent, "За місяцями");
  assert.equal(root.querySelectorAll("[data-accounting-daily] tr").length, 1);
  assert.match(root.querySelector("[data-accounting-daily] th").textContent, /жовтень 2026/);
  assert.match(root.querySelector("[data-accounting-daily] .accounting-period-note").textContent, /06\.10–08\.10/);
  assert.equal(root.querySelector("[data-accounting-daily] .accounting-coverage-note").textContent, "Неповні дані");
  root.querySelector('[data-accounting-granularity="days"]').click();
  assert.equal(root.querySelectorAll("[data-accounting-daily] tr").length, 3);
  assert.equal(root.querySelector("#accounting-history-title").textContent, "За днями");
  root.querySelector('[data-accounting-granularity="months"]').click();
  assert.equal(root.querySelectorAll("[data-accounting-daily] tr").length, 1);
  assert.equal(urls.length, 1);
  assert.match(root.querySelector('[data-accounting-total="google"]').textContent, /125,45/);
});

test("server monthly rows drive history; charts mark an unfinished month instead of implying a full-month decline", t => {
  const root = documentFor(t), data = fixture();
  data.monthly = [
    { month: "2026-09", from: "2026-09-01", to: "2026-09-30", days_expected: 30, google_uah: 600, google_coverage: "complete", google_days_present: 30, google_days_complete: 30, meta_uah: null, meta_coverage: "missing", orders: 5 },
    { month: "2026-10", from: "2026-10-01", to: "2026-10-08", days_expected: 8, google_uah: 200, google_coverage: "complete", google_days_present: 8, google_days_complete: 8, meta_uah: null, meta_coverage: "missing", orders: 2 },
  ];
  renderAccounting(root, data);
  assert.equal(root.querySelectorAll("[data-accounting-daily] tr").length, 2);
  assert.equal(root.querySelector("[data-accounting-daily] td").textContent, "200,00");
  assert.equal(root.querySelector("polyline.accounting-chart__google").getAttribute("stroke-dasharray"), "4 4");
  assert.match(root.querySelector("[data-accounting-chart] title").textContent, /за місяцями/);
});

const yearlyFixture = () => ({ ...fixture(), monthly: [
  { month: "2025-09", from: "2025-09-01", to: "2025-09-30", google_uah: 0, meta_uah: 0, orders: 0, google_coverage: "complete", meta_coverage: "complete" },
  { month: "2026-08", from: "2026-08-01", to: "2026-08-31", google_uah: 30573.71, meta_uah: 6753.04, orders: 49, google_coverage: "complete", meta_coverage: "complete" },
  { month: "2026-09", from: "2026-09-01", to: "2026-09-30", google_uah: 5774.67, meta_uah: 12406.57, orders: 106, google_coverage: "complete", meta_coverage: "complete" },
  { month: "2026-10", from: "2026-10-01", to: "2026-10-08", google_uah: 3348.19, meta_uah: 3646.34, orders: 35, google_coverage: "complete", meta_coverage: "complete" },
] });

test("calendar contains exactly Jan–Dec of selected year; absent months stay unknown while confirmed zero survives", () => {
  const data = yearlyFixture();
  const rows = accountingChartMonths(data.monthly, "2026");
  assert.equal(rows.length, 12);
  assert.equal(rows[0].month, "2026-01");
  assert.equal(rows[11].month, "2026-12");
  assert.equal(rows[9].google_uah, 3348.19);
  assert.equal(rows[9].to, "2026-10-08");
  for (const index of [0, 10, 11]) for (const key of ["google_uah", "meta_uah", "orders"]) assert.equal(rows[index][key], null);
  assert.equal(accountingChartMonths(data.monthly, "2025")[8].orders, 0);
});

test("chart year defaults to latest and switches without changing table, cards or refetching", async t => {
  const root = documentFor(t), urls = [];
  const view = createAccountingView(root, async url => { urls.push(url); return yearlyFixture(); }, now);
  await view.load("all");
  const select = root.querySelector('[data-accounting-chart-year]');
  assert.equal(select.value, "2026");
  assert.deepEqual([...select.options].map(option => option.value), ["2026", "2025"]);
  assert.equal(root.querySelectorAll('[data-chart-month]').length, 12);
  assert.equal(root.querySelector('[data-chart-month="2026-01"]').textContent, "Січ");
  assert.equal(root.querySelector('[data-chart-month="2026-10"]').textContent, "Жов*");
  assert.equal(root.querySelectorAll('[data-chart-point$="2026-11"]').length, 0);
  const table = root.querySelector('[data-accounting-daily]').textContent;
  select.value = "2025"; select.dispatchEvent(new root.defaultView.Event('change'));
  assert.equal(root.querySelectorAll('[data-chart-point]').length, 3);
  assert.ok(root.querySelector('[data-chart-point="orders:2025-09"]'));
  assert.equal(root.querySelector('[data-accounting-daily]').textContent, table);
  assert.equal(root.querySelector('[data-accounting-total="orders"]').textContent, "4");
  assert.equal(urls.length, 1);
  root.querySelector('[data-accounting-granularity="days"]').click();
  assert.equal(select.hidden, true);
  root.querySelector('[data-accounting-granularity="months"]').click();
  assert.equal(select.value, "2025");
});

test("all three series share calendar positions and spending shares one scale; order ticks are exact integers", t => {
  const root = documentFor(t), data = yearlyFixture();
  data.monthly = [{ ...data.monthly[1], google_uah: 9, meta_uah: 9, orders: 9 }];
  renderAccounting(root, data);
  const google = root.querySelector('[data-chart-point="google:2026-08"]');
  const meta = root.querySelector('[data-chart-point="meta:2026-08"]');
  const orders = root.querySelector('[data-chart-point="orders:2026-08"]');
  assert.equal(Number(google.getAttribute('cx')), Number(meta.getAttribute('x')) + 3);
  assert.equal(Number(google.getAttribute('cy')), Number(meta.getAttribute('y')) + 3);
  assert.equal(google.getAttribute('cx'), orders.getAttribute('cx'));
  assert.deepEqual([...root.querySelectorAll('[data-chart-tick="orders"]')].map(el => el.textContent), ['0', '3', '6', '9', '12']);
  assert.deepEqual([...root.querySelectorAll('[data-chart-tick="spend"]')].map(el => el.textContent), ['0', '2,5', '5', '7,5', '10']);
});

test("tooltips show exact monthly values, all-source orders and partial dates through tap and keyboard", t => {
  const root = documentFor(t); renderAccounting(root, yearlyFixture());
  const october = root.querySelector('[data-chart-date="2026-10"]');
  assert.match(october.getAttribute('aria-label'), /Замовлення з усіх джерел/);
  assert.equal(root.querySelectorAll('.accounting-chart__hit[tabindex="0"]').length, 1);
  october.dispatchEvent(new root.defaultView.Event('click'));
  const tooltip = root.querySelector('[role="tooltip"]');
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.textContent, /3\s348,19/);
  assert.match(tooltip.textContent, /3\s646,34/);
  assert.match(tooltip.textContent, /01\.10–08\.10/);
  const leave = new root.defaultView.Event('pointerleave'); Object.defineProperty(leave, 'pointerType', { value: 'touch' });
  root.querySelector('[data-accounting-chart] svg').dispatchEvent(leave);
  assert.equal(tooltip.hidden, false);
  october.dispatchEvent(new root.defaultView.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  assert.equal(root.activeElement.getAttribute('data-chart-date'), '2026-09');
  assert.match(tooltip.textContent, /5\s774,67/);
  assert.match(tooltip.textContent, /106/);
  root.activeElement.dispatchEvent(new root.defaultView.KeyboardEvent('keydown', { key: 'End' }));
  assert.equal(root.activeElement.getAttribute('data-chart-date'), '2026-12');
  assert.match(tooltip.textContent, /Немає даних/);
  root.activeElement.dispatchEvent(new root.defaultView.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(tooltip.hidden, true);
});

test("all twelve mobile month labels remain visible without extending lines into missing months", t => {
  const root = documentFor(t);
  Object.defineProperty(root.querySelector('[data-accounting-chart]'), 'clientWidth', { value: 330 });
  renderAccounting(root, yearlyFixture());
  assert.deepEqual([...root.querySelectorAll('[data-chart-month]')].map(el => el.textContent), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10*', '11', '12']);
  assert.equal(root.querySelectorAll('[data-chart-point]').length, 9);
  assert.match(root.querySelector('[data-accounting-chart-note]').textContent, /неповний період/);
});
