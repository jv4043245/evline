import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { accountingPeriod, renderAccounting, createAccountingView } from "../admin/accounting.js";

const html = readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
const source = readFileSync(new URL("../admin/admin.js", import.meta.url), "utf8");
const now = () => new Date("2026-10-09T10:00:00Z");
const documentFor = t => {
  const window = new JSDOM(html).window;
  t.after(() => window.close());
  return window.document;
};
const fixture = () => ({
  currency: "UAH", timezone: "Europe/Kyiv",
  totals: { google_uah: 125.45, meta_uah: null, orders: 4 },
  sources: { google: { status: "partial", updated_at: "2026-10-09T05:12:00Z", days_present: 2, days_expected: 3 }, meta: { status: "missing", days_present: 0, days_expected: 3 } },
  daily: [
    { date: "2026-10-06", google_uah: 125.45, meta_uah: null, orders: 1 },
    { date: "2026-10-07", google_uah: null, meta_uah: null, orders: 1 },
    { date: "2026-10-08", google_uah: 0, meta_uah: null, orders: 2 },
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
  assert.match(source, /state\.activeTab === "accounting" \? accountingView\.load\(state\.range\)/);
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

test("separate chart units share time, and missing costs break the line rather than implying zero", t => {
  const root = documentFor(t);
  renderAccounting(root, fixture());
  const svg = root.querySelector("[data-accounting-chart] svg");
  assert.equal(svg.getAttribute("role"), "img");
  assert.ok(svg.querySelector("title").textContent);
  assert.match(svg.querySelector("desc").textContent, /Два окремі графіки/);
  assert.equal(svg.querySelectorAll("polyline.accounting-chart__google").length, 2);
  assert.equal(svg.querySelectorAll("polyline.accounting-chart__meta").length, 0);
  assert.equal(svg.querySelectorAll("polyline.accounting-chart__orders").length, 1);
  assert.match(svg.querySelector(".accounting-chart__label").textContent, /^Google, грн$/);
});

test("chart uses the container width on a phone rather than shrinking 800px labels", t => {
  const root = documentFor(t);
  Object.defineProperty(root.querySelector("[data-accounting-chart]"), "clientWidth", { value: 330 });
  renderAccounting(root, fixture());
  assert.equal(root.querySelector("[data-accounting-chart] svg").getAttribute("viewBox"), "0 0 330 260");
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
