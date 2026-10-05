import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { readOrderFilters, orderQuery, selectOrderFilter, resetOrderFilters, createOrderLoader } from "../admin/order-filters.js";

const html = readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
const source = readFileSync(new URL("../admin/admin.js", import.meta.url), "utf8");
const dom = (t) => {
  const window = new JSDOM(html).window;
  t.after(() => window.close());
  return window.document;
};
const choose = (root, group, value) => selectOrderFilter(root, root.querySelector(`[data-order-filter="${group}"][value="${value}"]`));

test("payment and delivery controls are independent; shipped-only combines with search and stage", (t) => {
  const root = dom(t);
  choose(root, "payment", "paid");
  choose(root, "shipping", "sea");
  root.querySelector("[data-shipped-only]").checked = true;
  root.querySelector("#search").value = "BYD & door";
  root.querySelector("#status-filter").value = "left_china";
  const filters = readOrderFilters(root, "all");
  assert.deepEqual(filters, { range: "all", work: "all", status: "left_china", type: "all", q: "BYD & door", payment_status: "paid", shipping_mode: "sea", shipped_only: "1" });
  for (const group of ["payment", "shipping"]) assert.equal(root.querySelectorAll(`[data-order-filter="${group}"][aria-pressed="true"]`).length, 1);
  assert.equal(new URLSearchParams(String(orderQuery(filters))).get("q"), "BYD & door");
});

test("CSV uses exactly the same filters without visible-page limit or offset", (t) => {
  const root = dom(t);
  choose(root, "payment", "partial");
  choose(root, "shipping", "air");
  const filters = readOrderFilters(root, "90d");
  const page = orderQuery(filters, { offset: 100 });
  const csv = orderQuery(filters, { csv: true, offset: 100 });
  assert.equal(csv.get("format"), "csv");
  assert.equal(csv.has("limit"), false);
  assert.equal(csv.has("offset"), false);
  for (const key of Object.keys(filters)) assert.equal(csv.get(key), page.get(key));
  assert.match(source, /const csv = await api\(orderExportUrl\(\)/);
});

test("reset clears all order filters and search while preserving the visible global period", (t) => {
  const root = dom(t);
  choose(root, "payment", "paid"); choose(root, "shipping", "sea");
  root.querySelector("[data-shipped-only]").checked = true;
  root.querySelector("#search").value = "door";
  root.querySelector("#status-filter").value = "completed";
  root.querySelector("#type-filter").value = "parts";
  root.querySelector("#range").value = "all";
  root.querySelectorAll("[data-work-filter]").forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.workFilter === "overdue")));
  resetOrderFilters(root);
  assert.deepEqual(readOrderFilters(root, root.querySelector("#range").value), { range: "all", work: "all", status: "all", type: "all", q: "", payment_status: "all", shipping_mode: "all", shipped_only: "0" });
});

test("all filter choices, reset, pagination and live result count are accessible", (t) => {
  const root = dom(t);
  assert.deepEqual([...root.querySelectorAll('[data-order-filter="payment"]')].map((item) => item.value), ["all", "paid", "partial", "unpaid", "unknown", "refunded"]);
  assert.deepEqual([...root.querySelectorAll('[data-order-filter="shipping"]')].map((item) => item.value), ["all", "sea", "air", "unknown"]);
  for (const button of root.querySelectorAll("[data-order-filter]")) {
    assert.equal(button.type, "button");
    assert.ok(button.closest("fieldset").querySelector("legend").textContent.trim());
  }
  assert.equal(root.querySelector("[data-orders-visible-count]").getAttribute("role"), "status");
  assert.ok(root.querySelector("[data-orders-more]"));
  assert.ok(root.querySelector("[data-order-filters-reset]").title.includes("період"));
});

test("unknown delivery remains unknown when opening the editor (no implicit air)", () => {
  assert.match(source, /const selectedMode = order.shipping_mode \|\| "";/);
  assert.match(source, /const selectedRate = selectedMode \? selectRate/);
  assert.match(source, /const mode = form.elements.shipping_mode\?\.value \|\| "";/);
  assert.match(source, /<option value="" \$\{!selectedMode \? "selected" : ""\}>Не вказано/);
});

test("editing tracking with unknown delivery mode does not erase a manually entered cost", (t) => {
  const window = new JSDOM(`<form>
    <input name="shipping_carrier_id" value="carrier-1">
    <input name="shipping_mode" value="">
    <input name="shipping_rate_id" value="">
    <input name="tracking_number" value="TRACK-TEST">
    <input data-delivery-cost value="1234">
  </form>`).window;
  t.after(() => window.close());
  const body = source.slice(source.indexOf("function applyShippingSelection("), source.indexOf("function renderOrderEditor("));
  const apply = new Function("selectRate", "carrierById", "rateLabel", "calculateDeliveryCost", "numeric", "plainText", `${body}; return applyShippingSelection;`)(
    () => { throw new Error("Should not look up an air tariff for unknown delivery"); },
    () => null, () => "", () => 0, Number, String,
  );
  const form = window.document.querySelector("form");
  apply(form, { overwriteCost: true });
  assert.equal(form.querySelector("[data-delivery-cost]").value, "1234");
  assert.equal(form.elements.shipping_mode.value, "");
});

test("loader requests subsequent pages and resets offset when filters change", async () => {
  let filters = { range: "all", payment_status: "paid" };
  const queries = [], snapshots = [];
  const loader = createOrderLoader({
    readFilters: () => filters,
    fetchPage: async (params) => {
      queries.push(params);
      return { orders: Array.from({ length: params.get("offset") === "0" ? 100 : 4 }, (_, i) => ({ id: Number(params.get("offset")) + i })), total: 104 };
    },
    onUpdate: (value) => snapshots.push(value),
  });
  await loader(); await loader({ append: true });
  assert.equal(queries[1].get("offset"), "100");
  assert.equal(snapshots.at(-1).orders.length, 104);
  filters = { ...filters, shipping_mode: "sea" };
  await loader({ append: true });
  assert.equal(queries[2].get("offset"), "0");
  assert.equal(snapshots.at(-1).orders.length, 100);
});

test("slow previous request cannot overwrite a newer filter result", async () => {
  let filters = { payment_status: "paid" };
  const pending = [], snapshots = [];
  const loader = createOrderLoader({ readFilters: () => filters, fetchPage: () => new Promise((resolve) => pending.push(resolve)), onUpdate: (value) => snapshots.push(value) });
  const old = loader();
  filters = { payment_status: "partial" };
  const current = loader();
  pending[1]({ orders: [{ id: "partial" }], total: 1 }); await current;
  pending[0]({ orders: [{ id: "paid" }], total: 1 }); await old;
  assert.deepEqual(snapshots.at(-1).orders, [{ id: "partial" }]);
});

test("zero results stay zero; load failures restore loading state and permit retry", async () => {
  let fail = true;
  const snapshots = [];
  const loader = createOrderLoader({ readFilters: () => ({ range: "all" }), fetchPage: async () => { if (fail) throw new Error("Test failure"); return { orders: [], total: 0 }; }, onUpdate: (value) => snapshots.push(value) });
  await assert.rejects(loader(), /Test failure/);
  assert.equal(snapshots.at(-1).loading, false);
  fail = false; await loader();
  assert.equal(snapshots.at(-1).total, 0);
  assert.equal(snapshots.at(-1).error, null);
});

test("repeated load-more clicks do not append the same page twice", async () => {
  let resolve;
  let calls = 0;
  let snapshot;
  const loader = createOrderLoader({ readFilters: () => ({ range: "all" }), fetchPage: async () => {
    calls++;
    if (calls === 1) return { orders: [{ id: 1 }], total: 2 };
    return new Promise((done) => { resolve = done; });
  }, onUpdate: (value) => { snapshot = value; } });
  await loader();
  const next = loader({ append: true });
  await loader({ append: true });
  resolve({ orders: [{ id: 2 }], total: 2 }); await next;
  assert.equal(calls, 2);
  assert.deepEqual(snapshot.orders.map((order) => order.id), [1, 2]);
});
