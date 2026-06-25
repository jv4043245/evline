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
      ${options.hasSupplierPayments ? "COALESCE(supplier_summary.supplier_payment_count, 0)" : "0"} AS supplier_payment_count,
      ${options.hasSupplierPayments ? "COALESCE(supplier_summary.supplier_payment_paid_count, 0)" : "0"} AS supplier_payment_paid_count,
      ${options.hasSupplierPayments ? "COALESCE(supplier_summary.supplier_payment_open_count, 0)" : "0"} AS supplier_payment_open_count,
      ${options.hasSupplierPayments ? "COALESCE(supplier_summary.supplier_payment_review_count, 0)" : "0"} AS supplier_payment_review_count,
      ${options.hasSupplierPayments ? "COALESCE(supplier_summary.supplier_payment_requested_amount, 0)" : "0"} AS supplier_payment_requested_amount,
      ${options.hasSupplierPayments ? "COALESCE(supplier_summary.supplier_payment_paid_amount, 0)" : "0"} AS supplier_payment_paid_amount,
      ${options.hasSupplierPayments ? "COALESCE(supplier_summary.supplier_payment_currency, 'CNY')" : "'CNY'"} AS supplier_payment_currency,
      ${options.hasSupplierRequests ? "COALESCE(supplier_request_summary.supplier_request_count, 0)" : "0"} AS supplier_request_count,
      ${options.hasSupplierRequests ? "COALESCE(supplier_request_summary.supplier_request_quoted_count, 0)" : "0"} AS supplier_request_quoted_count,
      ${options.hasSupplierRequests ? "COALESCE(supplier_request_summary.supplier_request_accepted_count, 0)" : "0"} AS supplier_request_accepted_count,
      ${options.hasSupplierRequests ? "COALESCE(supplier_request_summary.supplier_request_problem_count, 0)" : "0"} AS supplier_request_problem_count,
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
    ${options.hasSupplierPayments ? `
      LEFT JOIN (
        SELECT
          order_id,
          COUNT(*) AS supplier_payment_count,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS supplier_payment_paid_count,
          SUM(CASE WHEN status IN ('requested', 'needs_review') THEN 1 ELSE 0 END) AS supplier_payment_open_count,
          SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END) AS supplier_payment_review_count,
          SUM(COALESCE(requested_amount, 0)) AS supplier_payment_requested_amount,
          SUM(COALESCE(paid_amount, 0)) AS supplier_payment_paid_amount,
          COALESCE(MAX(NULLIF(paid_currency, '')), MAX(NULLIF(requested_currency, '')), 'CNY') AS supplier_payment_currency
        FROM supplier_payments
        WHERE status != 'canceled'
        GROUP BY order_id
      ) supplier_summary ON supplier_summary.order_id = orders.id
    ` : ""}
    ${options.hasSupplierRequests ? `
      LEFT JOIN (
        SELECT
          order_id,
          COUNT(*) AS supplier_request_count,
          SUM(CASE WHEN status IN ('quoted', 'accepted', 'purchased', 'china_tracking', 'china_warehouse') THEN 1 ELSE 0 END) AS supplier_request_quoted_count,
          SUM(CASE WHEN status IN ('accepted', 'purchased', 'china_tracking', 'china_warehouse') THEN 1 ELSE 0 END) AS supplier_request_accepted_count,
          SUM(CASE WHEN status IN ('needs_info', 'no_stock', 'problem') THEN 1 ELSE 0 END) AS supplier_request_problem_count
        FROM supplier_requests
        WHERE status NOT IN ('closed', 'canceled')
        GROUP BY order_id
      ) supplier_request_summary ON supplier_request_summary.order_id = orders.id
    ` : ""}
  `;
}

async function tableColumns(env, table) {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((rows.results || []).map((row) => row.name));
}

async function insertKnownFields(env, table, fields) {
  const columns = await tableColumns(env, table);
  const available = fields.filter(([name]) => columns.has(name));
  if (!available.length) return;
  await env.DB.prepare(
    `INSERT INTO ${table} (${available.map(([name]) => name).join(", ")})
    VALUES (${available.map(() => "?").join(", ")})`
  )
    .bind(...available.map(([, value]) => value))
    .run();
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
    hasSupplierPayments: await tableHasColumn(env, "supplier_payments", "id"),
    hasSupplierRequests: await tableHasColumn(env, "supplier_requests", "id"),
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
      "term",
      "content",
      "gclid",
      "gbraid",
      "wbraid",
      "landing_page",
      "page_url",
      "form_id",
      "form_name",
      "submitted_at",
      "attribution_type",
      "revenue_uah",
      "purchase_cost_uah",
      "delivery_cost_uah",
      "customs_cost_uah",
      "processing_cost_uah",
      "ad_cost_uah",
      "other_cost_uah",
      "gross_profit_uah",
      "supplier_payment_count",
      "supplier_payment_paid_count",
      "supplier_payment_open_count",
      "supplier_payment_review_count",
      "supplier_payment_requested_amount",
      "supplier_payment_paid_amount",
      "supplier_payment_currency",
      "supplier_request_count",
      "supplier_request_quoted_count",
      "supplier_request_accepted_count",
      "supplier_request_problem_count",
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
  const type = text(payload.type) || "parts";
  const leadId = crypto.randomUUID();
  const leadNumber = await nextPublicNumber(env, "lead", "L");
  const orderId = crypto.randomUUID();
  const orderNumber = await nextPublicNumber(env, "order", "O");
  const status = normalizeOrderStatus(payload.status);
  const orderItem = text(payload.item_name || payload.part);
  const orderService = text(payload.service_name);
  const leadTopic = text(orderItem || orderService);
  const leadDetails = text(payload.request_text || payload.message);
  const leadMessage = [
    leadTopic ? `${type === "byd" ? "Послуга" : "Запчастина"}: ${leadTopic}` : "",
    leadDetails,
  ].filter(Boolean).join("\n");

  await insertKnownFields(env, "leads", [
    ["id", leadId],
    ["lead_number", leadNumber],
    ["created_at", now],
    ["updated_at", now],
    ["type", type],
    ["status", "new"],
    ["quality", "unknown"],
    ["name", text(payload.customer_name || payload.name)],
    ["phone", text(payload.customer_phone || payload.phone)],
    ["email", text(payload.customer_email || payload.email)],
    ["telegram", text(payload.customer_telegram || payload.telegram)],
    ["car", text(payload.car)],
    ["vin", text(payload.vin).toUpperCase()],
    ["message", leadMessage],
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
    ["page_url", text(payload.page_url)],
    ["form_id", text(payload.form_id)],
    ["form_name", text(payload.form_name)],
    ["submitted_at", text(payload.submitted_at || now)],
    ["attribution_type", text(payload.attribution_type) || "manual"],
    ["manager_notes", text(payload.manager_notes)],
  ]);

  const orderFields = [
    ["id", orderId],
    ["order_number", orderNumber],
    ["created_at", now],
    ["updated_at", now],
    ["lead_id", leadId],
    ["customer_id", customerId],
    ["type", type],
    ["status", status],
    ["manager_contact", text(payload.manager_contact) || managerContactForType(type)],
    ["customer_name", text(payload.customer_name || payload.name)],
    ["customer_phone", text(payload.customer_phone || payload.phone)],
    ["customer_email", text(payload.customer_email || payload.email)],
    ["customer_telegram", text(payload.customer_telegram || payload.telegram)],
    ["telegram_chat_id", text(payload.telegram_chat_id)],
    ["car", text(payload.car)],
    ["vin", text(payload.vin).toUpperCase()],
    ["item_name", orderItem],
    ["service_name", orderService],
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
    ["page_url", text(payload.page_url)],
    ["form_id", text(payload.form_id)],
    ["form_name", text(payload.form_name)],
    ["submitted_at", text(payload.submitted_at || now)],
    ["attribution_type", text(payload.attribution_type) || "manual"],
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
  await insertKnownFields(env, "orders", orderFields);

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
