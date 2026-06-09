import { csv, escapeCsv, integer, json, number, readPayload, rangeStart, text } from "../../_lib/http.js";
import {
  createOrderFromLead,
  loadOrder,
  managerContactForType,
  nextPublicNumber,
  normalizeOrderStatus,
  tableHasColumn,
  upsertCustomer,
} from "../../_lib/crm.js";
import { googleAdsEventTypesForStatus, queueGoogleAdsConversionsForOrder } from "../../_lib/google-ads.js";

function orderSelect(options = {}) {
  return `
    SELECT
      orders.*,
      ${options.hasCustomerNumber ? "customers.customer_number" : "NULL"} AS customer_number,
      ${options.hasLeadNumber ? "leads.lead_number" : "NULL"} AS lead_number,
      (
        COALESCE(orders.revenue_uah, 0)
        - COALESCE(orders.purchase_cost_uah, 0)
        - COALESCE(orders.delivery_cost_uah, 0)
        - COALESCE(orders.customs_cost_uah, 0)
        - COALESCE(orders.processing_cost_uah, 0)
        - COALESCE(orders.ad_cost_uah, 0)
        - COALESCE(orders.other_cost_uah, 0)
      ) AS gross_profit_uah
    FROM orders
    LEFT JOIN customers ON customers.id = orders.customer_id
    LEFT JOIN leads ON leads.id = orders.lead_id
  `;
}

function buildWhere(url, options = {}) {
  const clauses = [];
  const binds = [];
  const start = rangeStart(url.searchParams.get("range") || "30d");
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("type");
  const source = url.searchParams.get("source");
  const q = url.searchParams.get("q");

  if (start) {
    clauses.push("orders.created_at >= ?");
    binds.push(start);
  }
  if (status && status !== "all") {
    clauses.push("orders.status = ?");
    binds.push(status);
  }
  if (type && type !== "all") {
    clauses.push("orders.type = ?");
    binds.push(type);
  }
  if (source && source !== "all") {
    clauses.push("COALESCE(NULLIF(orders.source, ''), 'direct') = ?");
    binds.push(source);
  }
  if (q) {
    const searchColumns = [
      ...(options.hasOrderNumber ? ["orders.order_number"] : []),
      ...(options.hasCustomerNumber ? ["customers.customer_number"] : []),
      ...(options.hasLeadNumber ? ["leads.lead_number"] : []),
      "orders.customer_name",
      "orders.customer_phone",
      "orders.customer_email",
      "orders.customer_telegram",
      "orders.car",
      "orders.vin",
      "orders.item_name",
      "orders.service_name",
      "orders.request_text",
      "orders.campaign",
      "orders.tracking_number",
      "orders.tracking_status_text",
      "orders.tracking_status_location",
    ];
    clauses.push(`(
      ${searchColumns.map((column) => `${column} LIKE ?`).join(" OR ")}
    )`);
    const like = `%${q}%`;
    binds.push(...searchColumns.map(() => like));
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    binds,
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const options = {
    hasOrderNumber: await tableHasColumn(env, "orders", "order_number"),
    hasCustomerNumber: await tableHasColumn(env, "customers", "customer_number"),
    hasLeadNumber: await tableHasColumn(env, "leads", "lead_number"),
  };
  const { where, binds } = buildWhere(url, options);
  const limit = Math.min(Math.max(integer(url.searchParams.get("limit")) || 100, 1), 500);
  const offset = Math.max(integer(url.searchParams.get("offset")) || 0, 0);
  const wantsCsv = url.searchParams.get("format") === "csv";

  const rows = await env.DB.prepare(`${orderSelect(options)} ${where} ORDER BY orders.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all();

  if (wantsCsv) {
    const columns = [
      "order_number",
      "created_at",
      "type",
      "status",
      "customer_number",
      "lead_number",
      "customer_name",
      "customer_phone",
      "customer_telegram",
      "car",
      "vin",
      "item_name",
      "service_name",
      "tracking_carrier",
      "tracking_number",
      "tracking_status_code",
      "tracking_status_text",
      "tracking_status_location",
      "tracking_status_at",
      "tracking_last_checked_at",
      "carrier_estimated_delivery_at",
      "shipping_carrier_id",
      "shipping_mode",
      "shipping_weight_kg",
      "shipping_volume_m3",
      "shipping_rate",
      "shipping_rate_currency",
      "shipping_rate_unit",
      "shipping_exchange_rate_uah",
      "source",
      "medium",
      "campaign",
      "gclid",
      "gbraid",
      "wbraid",
      "revenue_uah",
      "purchase_cost_uah",
      "delivery_cost_uah",
      "customs_cost_uah",
      "processing_cost_uah",
      "ad_cost_uah",
      "other_cost_uah",
      "gross_profit_uah",
      "manager_notes",
    ];
    const body = [
      columns.join(","),
      ...rows.results.map((row) => columns.map((column) => escapeCsv(row[column])).join(",")),
    ].join("\n");
    return csv(body, "evline-orders.csv");
  }

  const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM orders LEFT JOIN customers ON customers.id = orders.customer_id LEFT JOIN leads ON leads.id = orders.lead_id ${where}`)
    .bind(...binds)
    .first();
  return json({ orders: rows.results, total: count.count, limit, offset });
}

export async function onRequestPost({ request, env }) {
  const payload = await readPayload(request);
  const now = new Date().toISOString();
  const customerId = await upsertCustomer(env, payload);
  const orderId = crypto.randomUUID();
  const orderNumber = await nextPublicNumber(env, "order", "O");
  const status = normalizeOrderStatus(payload.status);

  const orderFields = [
    ["id", orderId],
    ["order_number", orderNumber],
    ["created_at", now],
    ["updated_at", now],
    ["customer_id", customerId],
    ["type", text(payload.type) || "parts"],
    ["status", status],
    ["manager_contact", text(payload.manager_contact) || managerContactForType(payload.type)],
    ["customer_name", text(payload.customer_name || payload.name)],
    ["customer_phone", text(payload.customer_phone || payload.phone)],
    ["customer_email", text(payload.customer_email || payload.email)],
    ["customer_telegram", text(payload.customer_telegram || payload.telegram)],
    ["telegram_chat_id", text(payload.telegram_chat_id)],
    ["car", text(payload.car)],
    ["vin", text(payload.vin).toUpperCase()],
    ["item_name", text(payload.item_name || payload.part)],
    ["service_name", text(payload.service_name)],
    ["request_text", text(payload.request_text || payload.message)],
    ["tracking_carrier", text(payload.tracking_carrier)],
    ["tracking_number", text(payload.tracking_number)],
    ["tracking_url", text(payload.tracking_url)],
    ["source", text(payload.source)],
    ["medium", text(payload.medium)],
    ["campaign", text(payload.campaign)],
    ["term", text(payload.term)],
    ["content", text(payload.content)],
    ["gclid", text(payload.gclid)],
    ["gbraid", text(payload.gbraid)],
    ["wbraid", text(payload.wbraid)],
    ["fbclid", text(payload.fbclid)],
    ["landing_page", text(payload.landing_page)],
    ["referrer", text(payload.referrer)],
    ["shipping_carrier_id", text(payload.shipping_carrier_id)],
    ["shipping_rate_id", text(payload.shipping_rate_id)],
    ["shipping_mode", text(payload.shipping_mode)],
    ["shipping_weight_kg", number(payload.shipping_weight_kg)],
    ["shipping_volume_m3", number(payload.shipping_volume_m3)],
    ["shipping_rate", number(payload.shipping_rate)],
    ["shipping_rate_currency", text(payload.shipping_rate_currency)],
    ["shipping_rate_unit", text(payload.shipping_rate_unit)],
    ["shipping_exchange_rate_uah", number(payload.shipping_exchange_rate_uah)],
    ["revenue_uah", number(payload.revenue_uah)],
    ["purchase_cost_uah", number(payload.purchase_cost_uah)],
    ["delivery_cost_uah", number(payload.delivery_cost_uah)],
    ["customs_cost_uah", number(payload.customs_cost_uah)],
    ["processing_cost_uah", number(payload.processing_cost_uah)],
    ["ad_cost_uah", number(payload.ad_cost_uah)],
    ["other_cost_uah", number(payload.other_cost_uah)],
    ["payment_status", text(payload.payment_status) || "unknown"],
    ["manager_notes", text(payload.manager_notes)],
    ["client_notes", text(payload.client_notes)],
    ["next_action_at", text(payload.next_action_at)],
  ];
  const insertOrder = (fields) =>
    env.DB.prepare(
      `INSERT INTO orders (${fields.map(([name]) => name).join(", ")})
      VALUES (${fields.map(() => "?").join(", ")})`
    )
      .bind(...fields.map(([, value]) => value))
      .run();

  try {
    await insertOrder(orderFields);
  } catch (error) {
    if (!/gbraid|wbraid|order_number|no such column/i.test(error.message || String(error))) throw error;
    await insertOrder(orderFields.filter(([name]) => !["gbraid", "wbraid", "order_number"].includes(name)));
  }

  await env.DB.prepare(
    `INSERT INTO order_status_events (
      id, created_at, order_id, previous_status, status, actor, comment, notify_customer, notification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), now, orderId, "", status, "manager", "Замовлення створено вручну", 0, "not_queued")
    .run();

  const order = await loadOrder(env, orderId);
  const google_ads_conversions = await queueGoogleAdsConversionsForOrder(
    env,
    order,
    googleAdsEventTypesForStatus(order.status)
  );
  return json({ ok: true, order, google_ads_conversions });
}

export async function onRequestPut({ request, env }) {
  const payload = await readPayload(request);
  if (!payload.lead_id) return json({ error: "lead_id is required" }, { status: 400 });
  const lead = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(text(payload.lead_id)).first();
  if (!lead) return json({ error: "Lead not found" }, { status: 404 });
  const existing = await env.DB.prepare("SELECT * FROM orders WHERE lead_id = ? LIMIT 1").bind(lead.id).first();
  if (existing) return json({ ok: true, order: existing });
  const orderId = await createOrderFromLead(env, lead);
  const order = await loadOrder(env, orderId);
  return json({ ok: true, order });
}
