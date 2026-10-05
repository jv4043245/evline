import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { buildWhere, onRequestGet } from "../functions/api/admin/orders.js";

function fixture(t, { history = true, extraOrders = 0 } = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE customers (id TEXT PRIMARY KEY, customer_number TEXT);
    CREATE TABLE leads (id TEXT PRIMARY KEY, lead_number TEXT);
    CREATE TABLE orders (
      id TEXT PRIMARY KEY, order_number TEXT, created_at TEXT, customer_id TEXT, lead_id TEXT,
      status TEXT, type TEXT, source TEXT, next_action_at TEXT, payment_status TEXT, paid_at TEXT,
      shipping_mode TEXT, customer_name TEXT, customer_phone TEXT, customer_email TEXT,
      customer_telegram TEXT, car TEXT, vin TEXT, item_name TEXT, service_name TEXT,
      request_text TEXT, campaign TEXT, tracking_number TEXT, tracking_status_text TEXT,
      tracking_status_location TEXT, revenue_uah REAL, purchase_cost_uah REAL,
      delivery_cost_uah REAL, customs_cost_uah REAL, processing_cost_uah REAL,
      ad_cost_uah REAL, other_cost_uah REAL
    );
  `);
  if (history) db.exec("CREATE TABLE order_status_events (id TEXT PRIMARY KEY, order_id TEXT, status TEXT)");
  const rows = [
    { id: "paid-later", status: "left_china", payment_status: "paid", shipping_mode: "sea" },
    { id: "supplier-paid", status: "paid", payment_status: "unknown", shipping_mode: "sea", paid_at: new Date().toISOString() },
    { id: "partial-air", status: "accepted", payment_status: "partial", shipping_mode: "air" },
    { id: "refunded-air", status: "in_ukraine", payment_status: "refunded", shipping_mode: "air" },
    { id: "planned-sea", status: "ordered", payment_status: "unpaid", shipping_mode: "sea", tracking_number: "PLANNED123" },
    { id: "no-mode", status: "left_china", payment_status: "paid", shipping_mode: null },
    { id: "blank-mode", status: "left_china", payment_status: null, shipping_mode: "   " },
    { id: "completed-shipped", status: "completed", payment_status: "paid", shipping_mode: "sea" },
    { id: "completed-pickup", status: "completed", payment_status: "paid", shipping_mode: "air" },
    { id: "completed-local", status: "completed", payment_status: "paid", shipping_mode: "sea" },
    { id: "canceled-shipped", status: "canceled", payment_status: "paid", shipping_mode: "sea" },
    { id: "explicit-unknown", status: "accepted", payment_status: "unknown", shipping_mode: "unknown" },
    { id: "blank-payment", status: "accepted", payment_status: "  ", shipping_mode: "sea" },
    { id: "search-match", status: "left_china", payment_status: "paid", shipping_mode: "sea", item_name: "Unique headlight", source: "google", next_action_at: "2000-01-01" },
    { id: "type-mismatch", status: "left_china", payment_status: "paid", shipping_mode: "sea", type: "byd", item_name: "Unique headlight", source: "google", next_action_at: "2000-01-01" },
    { id: "irrelevant-history", status: "completed", payment_status: "unpaid", shipping_mode: null },
    { id: "old-paid", status: "left_china", payment_status: "paid", shipping_mode: "sea", created_at: "2000-01-01T00:00:00.000Z" },
  ];
  for (let i = 0; i < extraOrders; i += 1) rows.push({ id: `extra-${i}`, status: "left_china", payment_status: "paid", shipping_mode: "sea" });
  rows.forEach((row, i) => {
    const fields = { created_at: new Date(Date.now() - i * 60000).toISOString(), type: "parts", order_number: `O-${i + 1}`, ...row };
    db.prepare(`INSERT INTO orders (${Object.keys(fields).join(", ")}) VALUES (${Object.keys(fields).map(() => "?").join(", ")})`).run(...Object.values(fields));
  });
  if (history) {
    const event = db.prepare("INSERT INTO order_status_events VALUES (?, ?, ?)");
    event.run("event-1", "completed-shipped", "left_china");
    event.run("event-2", "completed-shipped", "in_ukraine");
    event.run("event-3", "completed-pickup", "ready_for_pickup");
    event.run("event-4", "canceled-shipped", "left_china");
    event.run("event-5", "irrelevant-history", "accepted");
  }
  const statements = [];
  const env = {
    DB: {
      prepare(sql) {
        const statement = db.prepare(sql);
        let values = [];
        statements.push({ sql, values });
        return {
          bind(...bindings) { values.push(...bindings); return this; },
          async all() { return { results: statement.all(...values) }; },
          async first() { return statement.get(...values) || null; },
        };
      },
    },
  };
  const response = (query = "") => {
    const params = new URLSearchParams(query);
    if (!params.has("range")) params.set("range", "all");
    return onRequestGet({ request: new Request(`https://example.test/api/admin/orders?${params}`), env });
  };
  const get = async (query) => (await response(query)).json();
  const select = (query) => {
    const { where, binds } = buildWhere(new URL(`https://example.test/?range=all&${query}`), { hasOrderStatusEvents: history });
    return db.prepare(`SELECT orders.id FROM orders LEFT JOIN customers ON customers.id = orders.customer_id LEFT JOIN leads ON leads.id = orders.lead_id ${where} ORDER BY orders.id`).all(...binds).map((row) => row.id);
  };
  return { db, rows, statements, select, get, response };
}

test("customer payment filter is independent of workflow and supplier-paid timestamps", (t) => {
  const { select } = fixture(t);
  const paid = select("payment_status=paid");
  assert.ok(paid.includes("paid-later"));
  assert.ok(paid.includes("completed-shipped"));
  assert.ok(!paid.includes("supplier-paid"));
  assert.ok(!paid.includes("partial-air"));
  assert.ok(!paid.includes("refunded-air"));
  assert.deepEqual(select("payment_status=partial"), ["partial-air"]);
  assert.deepEqual(select("payment_status=refunded"), ["refunded-air"]);
  assert.deepEqual(select("payment_status=unpaid"), ["irrelevant-history", "planned-sea"]);
  assert.deepEqual(select("payment_status=unknown"), ["blank-mode", "blank-payment", "explicit-unknown", "supplier-paid"]);
});

test("shipping mode filters distinguish air, sea and missing values without claiming dispatch", (t) => {
  const { select } = fixture(t);
  assert.deepEqual(select("shipping_mode=air"), ["completed-pickup", "partial-air", "refunded-air"]);
  assert.ok(select("shipping_mode=sea").includes("planned-sea"));
  assert.deepEqual(select("shipping_mode=unknown"), ["blank-mode", "explicit-unknown", "irrelevant-history", "no-mode"]);
});

test("shipped-only requires shipping progress and completed orders require matching history", (t) => {
  const { select } = fixture(t);
  assert.deepEqual(select("shipped_only=1"), [
    "blank-mode", "completed-pickup", "completed-shipped", "no-mode", "old-paid", "paid-later", "refunded-air", "search-match", "type-mismatch",
  ]);
  assert.deepEqual(select("shipping_mode=sea&shipped_only=1"), ["completed-shipped", "old-paid", "paid-later", "search-match", "type-mismatch"]);
  assert.deepEqual(select("shipping_mode=air&shipped_only=true"), ["completed-pickup", "refunded-air"]);
  assert.deepEqual(select("status=canceled&shipped_only=1"), []);
});

test("all new filters compose with range, stage, type, work, source and search before pagination", async (t) => {
  const { get, statements } = fixture(t);
  const filters = "payment_status=paid&shipping_mode=sea&shipped_only=1&range=30d&status=left_china&type=parts&work=overdue&source=google&q=Unique&limit=1";
  const result = await get(filters);
  assert.equal(result.total, 1);
  assert.deepEqual(result.orders.map((row) => row.id), ["search-match"]);
  const listing = statements.find(({ sql }) => sql.includes("LIMIT ? OFFSET ?"));
  const count = statements.find(({ sql }) => sql.startsWith("SELECT COUNT(*)"));
  assert.ok(listing.sql.indexOf("orders.payment_status") < listing.sql.indexOf("LIMIT"));
  assert.ok(listing.sql.indexOf("orders.shipping_mode") < listing.sql.indexOf("LIMIT"));
  assert.equal(listing.sql.slice(listing.sql.indexOf("WHERE orders.status NOT"), listing.sql.lastIndexOf(" ORDER BY")), count.sql.slice(count.sql.indexOf("WHERE orders.status NOT")));
  assert.deepEqual(listing.values.slice(0, -2), count.values);
});

test("count uses the full filtered set and history joins do not duplicate completed orders", async (t) => {
  const { get, select } = fixture(t, { extraOrders: 105 });
  const filters = "payment_status=paid&shipping_mode=sea&shipped_only=1";
  const expected = select(filters);
  const pageOne = await get(`${filters}&limit=2`);
  const pageTwo = await get(`${filters}&limit=2&offset=2`);
  assert.equal(pageOne.total, expected.length);
  assert.equal(pageTwo.total, expected.length);
  assert.equal(pageOne.limit, 2);
  assert.equal(pageTwo.offset, 2);
  assert.equal(new Set([...pageOne.orders, ...pageTwo.orders].map((row) => row.id)).size, 4);
  const emptyPage = await get(`${filters}&offset=999`);
  assert.deepEqual(emptyPage.orders, []);
  assert.equal(emptyPage.total, expected.length);
});

test("omitted and explicit all filters preserve baseline queries and pagination", async (t) => {
  const { get, rows } = fixture(t);
  const baseline = await get("");
  assert.deepEqual(await get("payment_status=all&shipping_mode=all&shipped_only=all"), baseline);
  assert.deepEqual(await get("payment_status=&shipping_mode=&shipped_only="), baseline);
  assert.deepEqual(await get("shipped_only=0"), baseline);
  assert.deepEqual(await get("shipped_only=false"), baseline);
  assert.equal(baseline.total, rows.length);
  assert.equal(baseline.limit, 100);
  assert.equal(baseline.offset, 0);
});

test("pagination has deterministic ID ordering when creation timestamps tie", async (t) => {
  const { db, get, select } = fixture(t);
  db.prepare("UPDATE orders SET created_at = ?").run(new Date().toISOString());
  const filters = "payment_status=paid&shipping_mode=sea&shipped_only=1";
  const expected = select(filters).reverse();
  const first = await get(`${filters}&limit=2`);
  const second = await get(`${filters}&limit=2&offset=2`);
  const third = await get(`${filters}&limit=2&offset=4`);
  assert.deepEqual([...first.orders, ...second.orders, ...third.orders].map((row) => row.id), expected);
});

test("invalid filter values fail with status 400 and never become SQL", async (t) => {
  const { response, statements } = fixture(t);
  for (const query of ["payment_status=complete", "shipping_mode=boat", "shipped_only=maybe", "payment_status=paid%27%20OR%201%3D1--", "shipping_mode=air%27%3BDROP%20TABLE%20orders--"]) {
    assert.throws(() => buildWhere(new URL(`https://example.test/?${query}`)), (error) => error.status === 400 && /^Invalid .* filter$/.test(error.message));
    await assert.rejects(response(query), (error) => error.status === 400);
  }
  assert.ok(statements.every(({ sql }) => sql.startsWith("PRAGMA table_info(")));
});

test("legacy database without status events still filters current shipping stages safely", async (t) => {
  const { get } = fixture(t, { history: false });
  const result = await get("shipped_only=1");
  assert.ok(result.orders.some((row) => row.id === "paid-later"));
  assert.ok(result.orders.every((row) => row.status !== "completed" && row.status !== "canceled"));
});

test("a recent range excludes old paid shipments", (t) => {
  const { db } = fixture(t);
  const { where, binds } = buildWhere(new URL("https://example.test/?range=30d&payment_status=paid&shipping_mode=sea&shipped_only=1"));
  const rows = db.prepare(`SELECT orders.id FROM orders ${where}`).all(...binds);
  assert.ok(rows.some((row) => row.id === "paid-later"));
  assert.ok(rows.every((row) => row.id !== "old-paid"));
});

test("CSV exports every filtered order beyond the first 100 and ignores UI pagination", async (t) => {
  const { response, get } = fixture(t, { extraOrders: 105 });
  const filters = "payment_status=paid&shipping_mode=sea&shipped_only=1";
  const count = (await get(filters)).total;
  const result = await response(`${filters}&format=csv&limit=1&offset=999`);
  assert.equal(result.status, 200);
  assert.match(result.headers.get("content-type"), /^text\/csv/);
  const [header, ...rows] = (await result.text()).split("\n").map((line) => line.split(","));
  assert.equal(rows.length, count);
  assert.ok(rows.length > 100);
  assert.ok(rows.every((row) => row[header.indexOf("payment_status")] === "paid"));
  assert.ok(rows.every((row) => row[header.indexOf("shipping_mode")] === "sea"));
  assert.ok(rows.every((row) => row[header.indexOf("status")] !== "canceled"));
});

test("CSV allows exactly 10,000 matching orders", async (t) => {
  const { response } = fixture(t, { extraOrders: 9995 });
  const result = await response("payment_status=paid&shipping_mode=sea&shipped_only=1&format=csv");
  assert.equal(result.status, 200);
  assert.equal((await result.text()).split("\n").length, 10001);
});

test("CSV refuses oversized selections explicitly instead of silently truncating", async (t) => {
  const { response } = fixture(t, { extraOrders: 9996 });
  const result = await response("payment_status=paid&shipping_mode=sea&shipped_only=1&format=csv");
  assert.equal(result.status, 413);
  assert.match(result.headers.get("content-type"), /^application\/json/);
  assert.match((await result.json()).error, /10000/);
});
