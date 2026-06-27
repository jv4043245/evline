import { integer, number, text } from "./http.js";
import { insertStatusEvent, loadOrder, managerChatIdForType, nextPublicNumber, sendTelegramMessageDetailed, tableHasColumn } from "./crm.js";
import { createSupplierPaymentRequest } from "./supplier-payments.js";
import { supplierTranslationDirections, translateSupplierText } from "./supplier-translation.js";

export const SUPPLIER_REQUEST_STATUS_LABELS = {
  draft: "Чернетка",
  sent: "Надіслано",
  viewed: "Переглянуто",
  quoted: "Є пропозиція",
  needs_info: "Потрібно уточнення",
  no_stock: "Немає в наявності",
  accepted: "Варіант обрано",
  purchased: "Викуплено",
  china_tracking: "Доставка по Китаю",
  china_warehouse: "На складі в Китаї",
  problem: "Проблема",
  closed: "Закрито",
  canceled: "Скасовано",
};

const REQUEST_STATUSES = new Set(Object.keys(SUPPLIER_REQUEST_STATUS_LABELS));
const QUOTE_TYPES = new Set(["original", "oem", "aftermarket", "used"]);
const AVAILABILITY = new Set(["in_stock", "order_needed", "no_stock"]);
const QUOTE_STATUSES = new Set(["new", "selected", "rejected", "expired"]);
const SUPPLIER_EVENT_STATUSES = new Set([
  "needs_info",
  "no_stock",
  "purchased",
  "china_tracking",
  "china_warehouse",
  "problem",
]);
const TERMINAL_REQUEST_STATUSES = new Set(["closed", "canceled"]);
const PRE_ACCEPTANCE_STATUSES = new Set(["sent", "viewed", "quoted", "needs_info", "no_stock"]);
const POST_QUOTE_MESSAGE_STATUSES = new Set(["quoted", "accepted", "purchased", "needs_info", "no_stock", "problem"]);
const NO_STOCK_SOURCE_STATUSES = new Set(["sent", "viewed", "quoted", "needs_info", "no_stock", "accepted", "purchased"]);
const DELIVERY_COST_SOURCE_STATUSES = new Set(["sent", "viewed", "quoted", "needs_info", "no_stock", "accepted", "purchased", "china_tracking", "china_warehouse", "problem"]);
const LOGISTICS_SOURCE_STATUSES = new Set(["accepted", "purchased", "china_tracking", "china_warehouse", "problem"]);
const LOGISTICS_STATUSES = new Set(["purchased", "china_tracking", "china_warehouse", "problem"]);
const PAID_LOGISTICS_STATUSES = new Set(["purchased", "china_tracking", "china_warehouse"]);
const SUPPLIER_STATUS_PROGRESS = {
  sent: 1,
  viewed: 1,
  quoted: 2,
  needs_info: 2,
  no_stock: 2,
  accepted: 3,
  purchased: 4,
  china_tracking: 5,
  china_warehouse: 6,
  closed: 7,
};
const MAX_PUBLIC_QUOTES_PER_REQUEST = 5;
const MAX_PUBLIC_EVENTS_PER_REQUEST = 30;
const DIRECTORY_SUPPLIERS = new Map([
  ["zeekr", { id: "supplier_zeekr", name: "Zeekr" }],
  ["byd", { id: "supplier_byd", name: "BYD" }],
  ["buble", { id: "supplier_buble", name: "Buble" }],
]);

function normalizeStatus(value, fallback = "") {
  const status = text(value);
  if (!status && fallback) return fallback;
  if (REQUEST_STATUSES.has(status)) return status;
  const error = new Error("Unsupported supplier status");
  error.status = 400;
  throw error;
}

function normalizeQuoteType(value) {
  const quoteType = text(value).toLowerCase();
  return QUOTE_TYPES.has(quoteType) ? quoteType : "original";
}

function normalizeAvailability(value) {
  const availability = text(value).toLowerCase();
  return AVAILABILITY.has(availability) ? availability : "in_stock";
}

function normalizeQuoteStatus(value, fallback = "new") {
  const status = text(value).toLowerCase();
  return QUOTE_STATUSES.has(status) ? status : fallback;
}

function normalizeSupplierName(value) {
  return text(value).replace(/\s+/g, " ").slice(0, 80);
}

function normalizeCarYear(value) {
  const digits = text(value).replace(/\D/g, "").slice(0, 4);
  return digits.length === 4 ? digits : "";
}

function normalizeOptionalAmount(value) {
  if (value === null || value === undefined) return null;
  const raw = text(value);
  if (!raw) return null;
  const parsed = number(raw.replace(",", "."));
  return Math.max(0, Math.round(parsed * 100) / 100);
}

function hasDeliveryCostPayload(payload = {}) {
  return Object.prototype.hasOwnProperty.call(payload, "delivery_cost_cny") && text(payload.delivery_cost_cny);
}

async function saveSupplierDeliveryCostPayload(env, supplierRequest, payload = {}, now = new Date().toISOString()) {
  if (!hasDeliveryCostPayload(payload)) return false;
  if (!DELIVERY_COST_SOURCE_STATUSES.has(supplierRequest.status)) {
    const error = new Error("Delivery cost is not available for this supplier request");
    error.status = 400;
    throw error;
  }
  if (!(await tableHasColumn(env, "supplier_requests", "delivery_cost_cny"))) {
    const error = new Error("D1 migration 0015_supplier_delivery_cost.sql is required");
    error.status = 409;
    throw error;
  }

  await env.DB.prepare(
    `UPDATE supplier_requests
    SET delivery_cost_cny = ?, delivery_cost_updated_at = ?, updated_at = ?
    WHERE id = ?`
  )
    .bind(normalizeOptionalAmount(payload.delivery_cost_cny), now, now, supplierRequest.id)
    .run();
  return true;
}

function supplierDirectoryEntry(value) {
  return DIRECTORY_SUPPLIERS.get(normalizeSupplierName(value).toLowerCase()) || null;
}

async function tableExists(env, table) {
  try {
    await env.DB.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first();
    return true;
  } catch (error) {
    if (/no such table/i.test(error.message || String(error))) return false;
    throw error;
  }
}

async function ensureSupplier(env, supplierName) {
  const directory = supplierDirectoryEntry(supplierName);
  const now = new Date().toISOString();
  if (!(await tableExists(env, "suppliers"))) {
    return {
      id: directory?.id || `supplier_custom_${crypto.randomUUID()}`,
      display_name: directory?.name || supplierName,
      dashboard_access_token: "",
    };
  }

  if (directory) {
    await env.DB.prepare(
      `INSERT INTO suppliers (id, display_name, dashboard_access_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`
    )
      .bind(directory.id, directory.name, randomToken(), now, now)
      .run();
    return env.DB.prepare("SELECT * FROM suppliers WHERE id = ?").bind(directory.id).first();
  }

  const existing = await env.DB.prepare("SELECT * FROM suppliers WHERE display_name = ? COLLATE NOCASE LIMIT 1")
    .bind(supplierName)
    .first();
  if (existing) return existing;

  const id = `supplier_custom_${crypto.randomUUID()}`;
  const supplier = {
    id,
    display_name: supplierName,
    dashboard_access_token: randomToken(),
  };
  await env.DB.prepare(
    `INSERT INTO suppliers (id, display_name, dashboard_access_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)`
  )
    .bind(supplier.id, supplier.display_name, supplier.dashboard_access_token, now, now)
    .run();
  return supplier;
}

function normalizeQuantity(value, fallback = 1) {
  const parsed = integer(value);
  return parsed > 0 ? parsed : fallback;
}

function publicOrigin(requestUrl) {
  try {
    return new URL(requestUrl).origin;
  } catch {
    return "https://evline.com.ua";
  }
}

function randomToken(bytes = 32) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function assertUrlLike(value) {
  const url = text(value);
  if (!url) return "";
  if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(url)) {
    if (url.length > 1_250_000) {
      const error = new Error("image_url is too large");
      error.status = 400;
      throw error;
    }
    return url;
  }
  if (!/^https:\/\//i.test(url)) {
    const error = new Error("image_url must be an HTTPS or uploaded image");
    error.status = 400;
    throw error;
  }
  return url.slice(0, 1000);
}

function assertSupplierTextSafe(...values) {
  const content = values.map(text).filter(Boolean).join("\n");
  if (!content) return;
  const patterns = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /(?:^|\s)@\w{4,}/,
    /\b(?:telegram|телеграм|tg|phone|телефон|номер клиента)\b/i,
    /\+[\d\s().-]{8,}\d/,
    /\b(?:uah|грн|гривн|марж|нацен|прибыл|profit|внутренн|себестоим)\w*\b/i,
  ];
  if (patterns.some((pattern) => pattern.test(content))) {
    const error = new Error("Текст поставщику содержит контактные или внутренние данные");
    error.status = 400;
    throw error;
  }
}

async function assertSupplierTables(env) {
  try {
    await env.DB.prepare("SELECT id FROM supplier_requests LIMIT 1").first();
  } catch (error) {
    if (/no such table/i.test(error.message || String(error))) {
      const migrationError = new Error("D1 migration 0011_supplier_portal.sql is required");
      migrationError.status = 409;
      throw migrationError;
    }
    throw error;
  }
}

async function safeSelect(env, sql, ...binds) {
  try {
    const rows = await env.DB.prepare(sql).bind(...binds).all();
    return rows.results || [];
  } catch (error) {
    if (/no such table/i.test(error.message || String(error))) return [];
    throw error;
  }
}

async function safeDelete(env, sql, ...binds) {
  try {
    await env.DB.prepare(sql).bind(...binds).run();
  } catch (error) {
    if (!/no such table|no such column/i.test(error.message || String(error))) throw error;
  }
}

async function insertSupplierEvent(env, supplierRequest, payload = {}) {
  const status = normalizeStatus(payload.status, supplierRequest.status);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO supplier_tracking_events (
      id, supplier_request_id, order_id, supplier_id, status, tracking_number,
      comment_cn, comment_translated, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      supplierRequest.id,
      supplierRequest.order_id,
      supplierRequest.supplier_id,
      status,
      text(payload.tracking_number),
      text(payload.comment_cn),
      text(payload.comment_translated),
      now
    )
    .run();
}

function normalizeSupplierChatKey(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9а-яёіїєґ]+/gi, "");
}

function parseSupplierChatMap(env) {
  const raw = text(env.TELEGRAM_SUPPLIER_CHAT_IDS);
  if (!raw) return new Map();
  const map = new Map();
  const add = (key, value) => {
    const normalizedKey = normalizeSupplierChatKey(key);
    const chatId = text(value);
    if (normalizedKey && chatId) map.set(normalizedKey, chatId);
  };

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      Object.entries(parsed).forEach(([key, value]) => add(key, value));
      return map;
    }
  } catch {
    // Allow a compact env value like "Zeekr=-100...,BYD=-100..." for quick setup.
  }

  raw.split(/[\n,;]+/).forEach((entry) => {
    const separator = entry.includes("=") ? "=" : ":";
    const [key, ...valueParts] = entry.split(separator);
    add(key, valueParts.join(separator));
  });
  return map;
}

function supplierChatKeys(supplierRequest = {}) {
  const supplierId = text(supplierRequest.supplier_id);
  const supplierName = text(supplierRequest.supplier_name);
  return [
    supplierId,
    supplierId.replace(/^supplier[_-]/i, ""),
    supplierName,
  ].map(normalizeSupplierChatKey).filter(Boolean);
}

function supplierSpecificChatId(env, supplierRequest = {}) {
  const map = parseSupplierChatMap(env);
  for (const key of supplierChatKeys(supplierRequest)) {
    const chatId = map.get(key);
    if (chatId) return chatId;
  }
  return "";
}

function supplierManagerChatIds(env) {
  return new Set([
    text(env.TELEGRAM_CHINA_CHAT_ID),
    ...parseSupplierChatMap(env).values(),
  ].filter(Boolean).map(String));
}

function chinaManagerChatId(env, supplierRequest = {}, order = null) {
  return supplierSpecificChatId(env, supplierRequest)
    || text(env.TELEGRAM_CHINA_CHAT_ID)
    || (order ? managerChatIdForType(env, order.type) : "")
    || text(env.TELEGRAM_PARTS_CHAT_ID || env.TELEGRAM_CHAT_ID);
}

async function saveSupplierTelegramMessage(env, supplierRequest, telegram = {}, options = {}) {
  if (!telegram?.chat_id || !telegram?.message_id) return { saved: false };
  if (!(await tableExists(env, "supplier_telegram_messages"))) return { saved: false, skipped: "migration_required" };
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO supplier_telegram_messages (
      id, created_at, updated_at, supplier_request_id, order_id, supplier_id,
      chat_id, message_id, direction, source, text_ru, text_cn
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, message_id) DO UPDATE SET
      updated_at = excluded.updated_at,
      supplier_request_id = excluded.supplier_request_id,
      order_id = excluded.order_id,
      supplier_id = excluded.supplier_id,
      direction = excluded.direction,
      source = excluded.source,
      text_ru = excluded.text_ru,
      text_cn = excluded.text_cn`
  )
    .bind(
      crypto.randomUUID(),
      now,
      now,
      supplierRequest.id,
      supplierRequest.order_id,
      supplierRequest.supplier_id,
      String(telegram.chat_id),
      String(telegram.message_id),
      text(options.direction),
      text(options.source),
      text(options.text_ru),
      text(options.text_cn)
    )
    .run();
  return { saved: true };
}

async function supplierTelegramMessageByReply(env, chatId, messageIds = []) {
  if (!(await tableExists(env, "supplier_telegram_messages"))) return null;
  const ids = messageIds.map(text).filter(Boolean);
  for (const messageId of ids) {
    const row = await env.DB.prepare(
      "SELECT * FROM supplier_telegram_messages WHERE chat_id = ? AND message_id = ? LIMIT 1"
    )
      .bind(String(chatId), String(messageId))
      .first();
    if (row) return row;
  }
  return null;
}

async function syncSupplierTrackingToOrder(env, supplierRequest, payload = {}) {
  const trackingNumber = text(payload.tracking_number).toUpperCase();
  if (!trackingNumber) return { updated: false };

  const order = await loadOrder(env, supplierRequest.order_id).catch(() => null);
  if (!order) return { updated: false };
  const now = new Date().toISOString();
  const nextOrderStatus = ["china_warehouse"].includes(text(payload.status)) ? "china_warehouse" : "sourcing_china";

  await env.DB.prepare(
    `UPDATE orders SET
      updated_at = ?,
      tracking_number = CASE
        WHEN COALESCE(NULLIF(tracking_number, ''), '') = '' OR UPPER(tracking_number) = ? THEN ?
        ELSE tracking_number
      END,
      tracking_carrier = COALESCE(NULLIF(tracking_carrier, ''), ?),
      tracking_url = COALESCE(NULLIF(tracking_url, ''), ?),
      status = CASE
        WHEN status IN ('new', 'accepted', 'proposal_sent', 'awaiting_payment', 'paid') THEN ?
        ELSE status
      END
    WHERE id = ?`
  )
    .bind(
      now,
      trackingNumber,
      trackingNumber,
      "China domestic",
      "",
      nextOrderStatus,
      supplierRequest.order_id
    )
    .run();

  await insertStatusEvent(env, {
    order_id: supplierRequest.order_id,
    previous_status: order.status,
    status: nextOrderStatus,
    actor: "supplier",
    comment: `Поставщик добавил китайский трек ${trackingNumber} для ${supplierRequest.public_number || supplierRequest.id}`,
    notify_customer: false,
    notification_status: "not_queued",
  }).catch(() => null);

  return { updated: true, tracking_number: trackingNumber };
}

function attachImages(quotes, images) {
  const quoteImages = new Map();
  for (const image of images) {
    if (!image.quote_id) continue;
    const rows = quoteImages.get(image.quote_id) || [];
    rows.push(image);
    quoteImages.set(image.quote_id, rows);
  }
  return quotes.map((quote) => ({
    ...quote,
    images: quoteImages.get(quote.id) || [],
  }));
}

async function loadSupplierBundle(env, supplierRequest) {
  if (!supplierRequest) return null;
  const [quotes, images, trackingEvents] = await Promise.all([
    safeSelect(env, "SELECT * FROM supplier_quotes WHERE supplier_request_id = ? ORDER BY created_at DESC", supplierRequest.id),
    safeSelect(env, "SELECT * FROM supplier_request_images WHERE supplier_request_id = ? ORDER BY created_at ASC", supplierRequest.id),
    safeSelect(env, "SELECT * FROM supplier_tracking_events WHERE supplier_request_id = ? ORDER BY created_at DESC", supplierRequest.id),
  ]);
  const supplier = (await tableExists(env, "suppliers"))
    ? await env.DB.prepare("SELECT dashboard_access_token FROM suppliers WHERE id = ?").bind(supplierRequest.supplier_id).first()
    : null;
  const payment = await loadSupplierPaymentForRequest(env, supplierRequest);

  return {
    request: supplierRequest,
    request_images: images.filter((image) => !image.quote_id),
    quotes: attachImages(quotes, images),
    tracking_events: trackingEvents,
    payment,
    supplier_link: `/supplier/request/${supplierRequest.access_token}`,
    dashboard_link: supplier?.dashboard_access_token ? `/supplier/dashboard/${supplier.dashboard_access_token}` : "",
  };
}

async function loadSupplierPaymentForRequest(env, supplierRequest) {
  if (!supplierRequest || !(await tableExists(env, "supplier_payments"))) return null;
  const hasSupplierRequestId = await tableHasColumn(env, "supplier_payments", "supplier_request_id");
  const hasPaymentId = await tableHasColumn(env, "supplier_requests", "payment_id");
  if (hasPaymentId && supplierRequest.payment_id) {
    return env.DB.prepare("SELECT * FROM supplier_payments WHERE id = ?")
      .bind(supplierRequest.payment_id)
      .first();
  }
  if (hasSupplierRequestId) {
    return env.DB.prepare(
      `SELECT * FROM supplier_payments
      WHERE supplier_request_id = ?
      ORDER BY created_at DESC
      LIMIT 1`
    )
      .bind(supplierRequest.id)
      .first();
  }
  return null;
}

function publicImage(image) {
  return {
    image_url: image.image_url,
    image_type: image.image_type,
    created_at: image.created_at,
  };
}

function publicQuote(quote) {
  return {
    id: quote.id,
    supplier_request_id: quote.supplier_request_id,
    quote_type: quote.quote_type,
    availability: quote.availability,
    price_cny: quote.price_cny,
    purchase_days: quote.purchase_days,
    china_delivery_days: quote.china_delivery_days,
    quantity: quote.quantity,
    part_number: quote.part_number,
    comment_cn: quote.comment_cn,
    comment_translated: quote.comment_ru || quote.comment_translated,
    status: quote.status,
    created_at: quote.created_at,
    updated_at: quote.updated_at,
    images: (quote.images || []).map(publicImage),
  };
}

function publicPayment(payment) {
  if (!payment) return null;
  return {
    status: payment.status,
    requested_amount: payment.requested_amount,
    requested_currency: payment.requested_currency,
    paid_amount: payment.paid_amount,
    paid_currency: payment.paid_currency,
    paid_at: payment.paid_at,
    receipt_present: Boolean(payment.receipt_telegram_file_id || payment.receipt_message_id),
    receipt_url: payment.receipt_telegram_file_id ? "payment-receipt" : "",
    updated_at: payment.updated_at,
  };
}

function publicEvent(event) {
  return {
    status: event.status,
    tracking_number: event.tracking_number,
    comment_cn: event.comment_cn,
    comment_translated: event.comment_translated,
    created_at: event.created_at,
  };
}

export function publicSupplierBundle(bundle) {
  if (!bundle) return null;
  const request = bundle.request || {};
  return {
    request: {
      public_number: request.public_number,
      status: request.status,
      supplier_name: request.supplier_name,
      car: request.car,
      car_year: request.car_year,
      vin: request.vin,
      item_name: request.item_name,
      quantity: request.quantity,
      request_text: request.request_text_cn || request.request_text || request.request_text_ru,
      supplier_note: request.manager_comment_cn || request.manager_comment,
      delivery_cost_cny: request.delivery_cost_cny,
      delivery_cost_updated_at: request.delivery_cost_updated_at,
      created_at: request.created_at,
      updated_at: request.updated_at,
      sent_at: request.sent_at,
      closed_at: request.closed_at,
    },
    request_images: (bundle.request_images || []).map(publicImage),
    quotes: (bundle.quotes || []).map(publicQuote),
    tracking_events: (bundle.tracking_events || []).map(publicEvent),
    payment: publicPayment(bundle.payment),
  };
}

function publicDashboardRequest(row, payment = null, bundle = null) {
  const detail = bundle ? publicSupplierBundle(bundle) : null;
  return {
    public_number: row.public_number,
    status: row.status,
    supplier_name: row.supplier_name,
    car: row.car,
    car_year: row.car_year,
    vin: row.vin,
    item_name: row.item_name,
    quantity: row.quantity,
    request_text: row.request_text_cn || row.request_text || row.request_text_ru,
    supplier_note: row.manager_comment_cn || row.manager_comment,
    delivery_cost_cny: row.delivery_cost_cny,
    delivery_cost_updated_at: row.delivery_cost_updated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    supplier_link: `/supplier/request/${row.access_token}`,
    request_images: detail?.request_images || [],
    quotes: detail?.quotes || [],
    tracking_events: detail?.tracking_events || [],
    payment: publicPayment(payment),
  };
}

function dashboardAmount(value) {
  return Math.round(number(value) * 100) / 100;
}

function publicDashboardPayment(row = {}) {
  const accessToken = text(row.request_access_token);
  return {
    payment_number: row.payment_number || row.id,
    status: row.status,
    amount: dashboardAmount(row.paid_amount || row.requested_amount),
    currency: row.paid_currency || row.requested_currency || "CNY",
    paid_at: row.paid_at,
    updated_at: row.updated_at,
    request_public_number: row.request_public_number,
    item_name: row.request_item_name,
    supplier_link: accessToken ? `/supplier/request/${accessToken}` : "",
    receipt_present: Boolean(row.receipt_telegram_file_id || row.receipt_message_id),
  };
}

function supplierDashboardWorkSummary(requests = []) {
  const needAnswer = requests.filter((request) => ["sent", "viewed"].includes(request.status)).length;
  const waitingPayment = requests.filter((request) => (
    ["quoted", "accepted"].includes(request.status) && request.payment?.status !== "paid"
  )).length;
  const paidNeedsTracking = requests.filter((request) => (
    request.payment?.status === "paid" && ["accepted", "purchased"].includes(request.status)
  )).length;
  const problem = requests.filter((request) => ["problem", "no_stock"].includes(request.status)).length;
  return { need_answer: needAnswer, waiting_payment: waitingPayment, paid_needs_tracking: paidNeedsTracking, problem };
}

async function supplierDashboardPaymentSummary(env, supplierId) {
  const empty = {
    paid_30_amount: 0,
    paid_30_count: 0,
    paid_total_amount: 0,
    paid_total_count: 0,
    waiting_amount: 0,
    waiting_count: 0,
    currency: "CNY",
  };
  if (!(await tableExists(env, "supplier_payments"))) return empty;
  if (!(await tableHasColumn(env, "supplier_payments", "supplier_request_id"))) return empty;

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const row = await env.DB.prepare(
    `SELECT
      SUM(CASE WHEN supplier_payments.status = 'paid'
        THEN COALESCE(NULLIF(supplier_payments.paid_amount, 0), supplier_payments.requested_amount, 0)
        ELSE 0 END) AS paid_total_amount,
      SUM(CASE WHEN supplier_payments.status = 'paid' THEN 1 ELSE 0 END) AS paid_total_count,
      SUM(CASE WHEN supplier_payments.status = 'paid'
          AND COALESCE(supplier_payments.paid_at, supplier_payments.updated_at, supplier_payments.created_at) >= ?
        THEN COALESCE(NULLIF(supplier_payments.paid_amount, 0), supplier_payments.requested_amount, 0)
        ELSE 0 END) AS paid_30_amount,
      SUM(CASE WHEN supplier_payments.status = 'paid'
          AND COALESCE(supplier_payments.paid_at, supplier_payments.updated_at, supplier_payments.created_at) >= ?
        THEN 1 ELSE 0 END) AS paid_30_count,
      SUM(CASE WHEN supplier_payments.status IN ('requested', 'needs_review')
        THEN COALESCE(supplier_payments.requested_amount, 0)
        ELSE 0 END) AS waiting_amount,
      SUM(CASE WHEN supplier_payments.status IN ('requested', 'needs_review') THEN 1 ELSE 0 END) AS waiting_count,
      COALESCE(MAX(NULLIF(supplier_payments.paid_currency, '')), MAX(NULLIF(supplier_payments.requested_currency, '')), 'CNY') AS currency
    FROM supplier_payments
    INNER JOIN supplier_requests ON supplier_requests.id = supplier_payments.supplier_request_id
    WHERE supplier_requests.supplier_id = ?`
  )
    .bind(since30, since30, supplierId)
    .first();

  return {
    paid_30_amount: dashboardAmount(row?.paid_30_amount),
    paid_30_count: integer(row?.paid_30_count),
    paid_total_amount: dashboardAmount(row?.paid_total_amount),
    paid_total_count: integer(row?.paid_total_count),
    waiting_amount: dashboardAmount(row?.waiting_amount),
    waiting_count: integer(row?.waiting_count),
    currency: text(row?.currency) || "CNY",
  };
}

async function listSupplierDashboardPayments(env, supplierId) {
  if (!(await tableExists(env, "supplier_payments"))) return [];
  if (!(await tableHasColumn(env, "supplier_payments", "supplier_request_id"))) return [];
  const rows = await safeSelect(
    env,
    `SELECT supplier_payments.*,
      supplier_requests.public_number AS request_public_number,
      supplier_requests.item_name AS request_item_name,
      supplier_requests.access_token AS request_access_token
    FROM supplier_payments
    INNER JOIN supplier_requests ON supplier_requests.id = supplier_payments.supplier_request_id
    WHERE supplier_requests.supplier_id = ?
    ORDER BY COALESCE(supplier_payments.paid_at, supplier_payments.updated_at, supplier_payments.created_at) DESC
    LIMIT 12`,
    supplierId
  );
  return rows.map(publicDashboardPayment);
}

export async function listSupplierRequests(env, orderId) {
  const requests = await safeSelect(
    env,
    "SELECT * FROM supplier_requests WHERE order_id = ? ORDER BY created_at DESC",
    orderId
  );
  const bundles = [];
  for (const supplierRequest of requests) {
    bundles.push(await loadSupplierBundle(env, supplierRequest));
  }
  return bundles.filter(Boolean);
}

export async function createSupplierRequest(env, orderId, payload = {}, options = {}) {
  await assertSupplierTables(env);

  const order = await loadOrder(env, orderId);
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }

  const supplierName = normalizeSupplierName(payload.supplier_name);
  if (!supplierName) {
    const error = new Error("supplier_name is required");
    error.status = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const token = randomToken();
  const imageUrl = assertUrlLike(payload.image_url);
  const supplier = await ensureSupplier(env, supplierName);
  const requestTextRu = text(payload.request_text_ru ?? payload.request_text) || text(order.request_text);
  const requestTextCn = text(payload.request_text_cn)
    || await translateSupplierText(env, requestTextRu, supplierTranslationDirections().managerToSupplier);
  const managerCommentRu = text(payload.manager_comment);
  const managerCommentCn = managerCommentRu
    ? await translateSupplierText(env, managerCommentRu, supplierTranslationDirections().managerToSupplier)
    : "";
  const carYear = normalizeCarYear(payload.car_year) || normalizeCarYear(order.car_year);
  assertSupplierTextSafe(requestTextRu, managerCommentRu);
  const supplierRequest = {
    id: crypto.randomUUID(),
    public_number: await nextPublicNumber(env, "supplier_request", "SR"),
    order_id: orderId,
    supplier_id: supplier.id,
    supplier_name: supplier.display_name || supplierName,
    access_token: token,
    status: normalizeStatus(payload.status, "sent"),
    car: text(payload.car) || text(order.car),
    car_year: carYear,
    vin: (text(payload.vin) || text(order.vin)).toUpperCase(),
    item_name: text(payload.item_name) || text(order.item_name) || text(order.service_name),
    quantity: normalizeQuantity(payload.quantity, 1),
    request_text: requestTextCn,
    request_text_ru: requestTextRu,
    request_text_cn: requestTextCn,
    manager_comment: managerCommentRu,
    manager_comment_ru: managerCommentRu,
    manager_comment_cn: managerCommentCn,
    created_at: now,
    updated_at: now,
    sent_at: now,
    closed_at: "",
  };

  const requestFields = [
    ["id", supplierRequest.id],
    ["public_number", supplierRequest.public_number],
    ["order_id", supplierRequest.order_id],
    ["supplier_id", supplierRequest.supplier_id],
    ["supplier_name", supplierRequest.supplier_name],
    ["access_token", supplierRequest.access_token],
    ["status", supplierRequest.status],
    ["car", supplierRequest.car],
    ["vin", supplierRequest.vin],
    ["item_name", supplierRequest.item_name],
    ["quantity", supplierRequest.quantity],
    ["request_text", supplierRequest.request_text],
    ["manager_comment", supplierRequest.manager_comment],
    ["created_at", supplierRequest.created_at],
    ["updated_at", supplierRequest.updated_at],
    ["sent_at", supplierRequest.sent_at],
    ["closed_at", supplierRequest.closed_at],
  ];
  if (await tableHasColumn(env, "supplier_requests", "car_year")) {
    requestFields.splice(8, 0, ["car_year", supplierRequest.car_year]);
  }

  await env.DB.prepare(
    `INSERT INTO supplier_requests (
      ${requestFields.map(([name]) => name).join(", ")}
    ) VALUES (${requestFields.map(() => "?").join(", ")})`
  )
    .bind(...requestFields.map(([, value]) => value))
    .run();

  if (await tableHasColumn(env, "supplier_requests", "request_text_ru")) {
    await env.DB.prepare(
      `UPDATE supplier_requests
      SET request_text_ru = ?, request_text_cn = ?
      WHERE id = ?`
    )
      .bind(supplierRequest.request_text_ru, supplierRequest.request_text_cn, supplierRequest.id)
      .run();
  }
  if (await tableHasColumn(env, "supplier_requests", "manager_comment_ru")) {
    await env.DB.prepare(
      `UPDATE supplier_requests
      SET manager_comment_ru = ?, manager_comment_cn = ?
      WHERE id = ?`
    )
      .bind(supplierRequest.manager_comment_ru, supplierRequest.manager_comment_cn, supplierRequest.id)
      .run();
  }

  if (imageUrl) {
    await env.DB.prepare(
      `INSERT INTO supplier_request_images (
        id, supplier_request_id, quote_id, image_url, image_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), supplierRequest.id, null, imageUrl, "request", now)
      .run();
  }

  await insertStatusEvent(env, {
    order_id: orderId,
    previous_status: order.status,
    status: order.status,
    actor: "manager",
    comment: `Створено запит постачальнику ${supplierName}: ${supplierRequest.public_number}`,
    notify_customer: false,
    notification_status: "not_queued",
  });

  const bundle = await loadSupplierBundle(env, supplierRequest);
  const origin = options.origin || "https://evline.com.ua";
  return {
    ...bundle,
    supplier_url: `${origin}/supplier/request/${token}`,
    dashboard_url: supplier.dashboard_access_token ? `${origin}/supplier/dashboard/${supplier.dashboard_access_token}` : "",
  };
}

export async function loadSupplierRequestByToken(env, token, options = {}) {
  await assertSupplierTables(env);
  const accessToken = text(token);
  if (!accessToken) return null;

  let supplierRequest = await env.DB.prepare("SELECT * FROM supplier_requests WHERE access_token = ?")
    .bind(accessToken)
    .first();

  if (!supplierRequest) return null;

  if (options.markViewed && ["sent", "draft"].includes(supplierRequest.status)) {
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE supplier_requests SET status = ?, updated_at = ? WHERE id = ?")
      .bind("viewed", now, supplierRequest.id)
      .run();
    supplierRequest = { ...supplierRequest, status: "viewed", updated_at: now };
  }

  return loadSupplierBundle(env, supplierRequest);
}

export async function listSupplierDashboardByToken(env, token) {
  await assertSupplierTables(env);
  if (!(await tableExists(env, "suppliers"))) return null;
  const dashboardToken = text(token);
  if (!dashboardToken) return null;

  const supplier = await env.DB.prepare("SELECT * FROM suppliers WHERE dashboard_access_token = ?")
    .bind(dashboardToken)
    .first();
  if (!supplier) return null;

  const rows = await safeSelect(
    env,
    `SELECT * FROM supplier_requests
    WHERE supplier_id = ?
      AND status NOT IN ('closed', 'canceled')
    ORDER BY created_at DESC
    LIMIT 80`,
    supplier.id
  );
  const requests = [];
  for (const row of rows) {
    const bundle = await loadSupplierBundle(env, row);
    if (!bundle) continue;
    requests.push(publicDashboardRequest(row, bundle.payment, bundle));
  }
  const [paymentSummary, payments] = await Promise.all([
    supplierDashboardPaymentSummary(env, supplier.id),
    listSupplierDashboardPayments(env, supplier.id),
  ]);

  return {
    supplier: {
      name: supplier.display_name,
    },
    summary: {
      ...supplierDashboardWorkSummary(requests),
      ...paymentSummary,
      active_count: requests.length,
    },
    requests,
    payments,
  };
}

async function notifyManagerSupplierQuote(env, supplierRequest, quote, requestUrl = "https://evline.com.ua", options = {}) {
  const order = await loadOrder(env, supplierRequest.order_id).catch(() => null);
  const chatId = chinaManagerChatId(env, supplierRequest, order);
  if (!chatId || !env.TELEGRAM_BOT_TOKEN) return { skipped: true };

  const origin = publicOrigin(requestUrl);
  const messageRu = text(options.messageRu || quote?.comment_ru || quote?.comment_translated || "");
  const deliveryCost = Object.prototype.hasOwnProperty.call(options, "deliveryCostCny")
    ? normalizeOptionalAmount(options.deliveryCostCny)
    : normalizeOptionalAmount(supplierRequest.delivery_cost_cny);
  const lines = [
    `🇨🇳 Поставщик ${supplierRequest.supplier_name} ответил`,
    `Запрос: ${supplierRequest.public_number || supplierRequest.id}`,
    order ? `Заказ CRM: ${order.order_number || order.id}` : "",
    supplierRequest.item_name ? `Позиция: ${supplierRequest.item_name}` : "",
    supplierRequest.vin ? `VIN: ${supplierRequest.vin}` : "",
    quote && Number(quote.price_cny || 0) > 0 ? `Цена: ${quote.price_cny || 0} CNY` : "",
    quote?.purchase_days ? `Срок поставки: ${quote.purchase_days} дн.` : "",
    deliveryCost !== null ? `Доставка: ${deliveryCost} CNY` : "",
    "",
    messageRu ? `Сообщение: ${messageRu}` : "",
    "",
    "Ответьте reply на это сообщение, чтобы отправить ответ китайцу.",
    `CRM: ${origin}/admin/`,
  ];

  const telegram = await sendTelegramMessageDetailed(env, chatId, lines.filter(Boolean).join("\n"));
  await saveSupplierTelegramMessage(env, supplierRequest, telegram, {
    direction: "supplier_to_manager",
    source: options.source || (quote ? "supplier_quote" : "supplier_message"),
    text_ru: messageRu,
    text_cn: options.messageCn || quote?.comment_cn || "",
  }).catch(() => null);

  return { skipped: false, telegram };
}

export async function createSupplierQuoteByToken(env, token, payload = {}, options = {}) {
  const bundle = await loadSupplierRequestByToken(env, token, { markViewed: false });
  if (!bundle) {
    const error = new Error("Supplier request not found");
    error.status = 404;
    throw error;
  }

  const supplierRequest = bundle.request;
  if (TERMINAL_REQUEST_STATUSES.has(supplierRequest.status)) {
    const error = new Error("Supplier request is closed");
    error.status = 400;
    throw error;
  }
  if (!PRE_ACCEPTANCE_STATUSES.has(supplierRequest.status)) {
    const error = new Error("Supplier request already has an accepted quote");
    error.status = 400;
    throw error;
  }
  const existingSelected = await env.DB.prepare(
    "SELECT id FROM supplier_quotes WHERE supplier_request_id = ? AND status = 'selected' LIMIT 1"
  )
    .bind(supplierRequest.id)
    .first();
  if (existingSelected) {
    const error = new Error("Supplier request already has a selected quote");
    error.status = 400;
    throw error;
  }
  const quoteCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM supplier_quotes WHERE supplier_request_id = ?")
    .bind(supplierRequest.id)
    .first();
  if (number(quoteCount?.count) >= MAX_PUBLIC_QUOTES_PER_REQUEST) {
    const error = new Error("Supplier quote limit reached");
    error.status = 429;
    throw error;
  }

  const availability = normalizeAvailability(payload.availability);
  const price = number(payload.price_cny);
  if (availability !== "no_stock" && price <= 0) {
    const error = new Error("price_cny is required");
    error.status = 400;
    throw error;
  }
  const imageUrl = assertUrlLike(payload.image_url);
  const commentCn = text(payload.comment_cn);
  const commentRu = commentCn
    ? await translateSupplierText(env, commentCn, supplierTranslationDirections().supplierToManager)
    : "";

  const now = new Date().toISOString();
  const quote = {
    id: crypto.randomUUID(),
    supplier_request_id: supplierRequest.id,
    order_id: supplierRequest.order_id,
    supplier_id: supplierRequest.supplier_id,
    quote_type: normalizeQuoteType(payload.quote_type),
    availability,
    price_cny: availability === "no_stock" ? 0 : price,
    purchase_days: Math.max(integer(payload.purchase_days), 0),
    china_delivery_days: Math.max(integer(payload.china_delivery_days), 0),
    quantity: normalizeQuantity(payload.quantity, supplierRequest.quantity || 1),
    part_number: text(payload.part_number),
    comment_cn: commentCn,
    comment_translated: commentRu,
    comment_ru: commentRu,
    status: "new",
    created_at: now,
    updated_at: now,
  };

  await env.DB.prepare(
    `INSERT INTO supplier_quotes (
      id, supplier_request_id, order_id, supplier_id, quote_type, availability,
      price_cny, purchase_days, china_delivery_days, quantity, part_number,
      comment_cn, comment_translated, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      quote.id,
      quote.supplier_request_id,
      quote.order_id,
      quote.supplier_id,
      quote.quote_type,
      quote.availability,
      quote.price_cny,
      quote.purchase_days,
      quote.china_delivery_days,
      quote.quantity,
      quote.part_number,
      quote.comment_cn,
      quote.comment_translated,
      quote.status,
      quote.created_at,
      quote.updated_at
    )
    .run();

  if (await tableHasColumn(env, "supplier_quotes", "comment_ru")) {
    await env.DB.prepare("UPDATE supplier_quotes SET comment_ru = ? WHERE id = ?")
      .bind(quote.comment_ru, quote.id)
      .run();
  }

  if (imageUrl) {
    await env.DB.prepare(
      `INSERT INTO supplier_request_images (
        id, supplier_request_id, quote_id, image_url, image_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), supplierRequest.id, quote.id, imageUrl, "quote", now)
      .run();
  }

  const nextStatus = availability === "no_stock" ? "no_stock" : "quoted";
  await env.DB.prepare(
    `UPDATE supplier_requests
    SET status = CASE
        WHEN status IN ('sent', 'viewed', 'quoted', 'needs_info', 'no_stock') THEN ?
        ELSE status
      END,
      updated_at = CASE
        WHEN status IN ('sent', 'viewed', 'quoted', 'needs_info', 'no_stock') THEN ?
        ELSE updated_at
      END
    WHERE id = ?`
  )
    .bind(nextStatus, now, supplierRequest.id)
    .run();
  await insertSupplierEvent(env, { ...supplierRequest, status: nextStatus }, {
    status: nextStatus,
    comment_cn: quote.comment_cn,
    comment_translated: quote.comment_ru || quote.comment_translated,
  });

  await saveSupplierDeliveryCostPayload(env, supplierRequest, payload, now);

  await notifyManagerSupplierQuote(env, supplierRequest, quote, options.requestUrl, {
    messageRu: quote.comment_ru || quote.comment_translated,
    messageCn: quote.comment_cn,
    deliveryCostCny: payload.delivery_cost_cny,
    source: "supplier_quote",
  }).catch(() => null);

  return loadSupplierRequestByToken(env, token, { markViewed: false });
}

export async function createSupplierMessageByToken(env, token, payload = {}, options = {}) {
  const bundle = await loadSupplierRequestByToken(env, token, { markViewed: false });
  if (!bundle) {
    const error = new Error("Supplier request not found");
    error.status = 404;
    throw error;
  }

  const supplierRequest = bundle.request;
  if (TERMINAL_REQUEST_STATUSES.has(supplierRequest.status)) {
    const error = new Error("Supplier request is closed");
    error.status = 400;
    throw error;
  }
  if (!POST_QUOTE_MESSAGE_STATUSES.has(supplierRequest.status) || !(bundle.quotes || []).length) {
    const error = new Error("Supplier message is available only after quote");
    error.status = 400;
    throw error;
  }

  const comment = text(payload.comment_cn || payload.comment_translated).slice(0, 2000);
  const commentRu = comment
    ? await translateSupplierText(env, comment, supplierTranslationDirections().supplierToManager)
    : "";
  const hasDeliveryUpdate = hasDeliveryCostPayload(payload);
  if (!comment && !hasDeliveryUpdate) {
    const error = new Error("Message text is required");
    error.status = 400;
    throw error;
  }
  if (comment) assertSupplierTextSafe(comment);

  if (comment) {
    const eventCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM supplier_tracking_events WHERE supplier_request_id = ?")
      .bind(supplierRequest.id)
      .first();
    if (number(eventCount?.count) >= MAX_PUBLIC_EVENTS_PER_REQUEST) {
      const error = new Error("Supplier event limit reached");
      error.status = 429;
      throw error;
    }
  }

  const now = new Date().toISOString();
  if (hasDeliveryUpdate) {
    await saveSupplierDeliveryCostPayload(env, supplierRequest, payload, now);
  } else {
    await env.DB.prepare("UPDATE supplier_requests SET updated_at = ? WHERE id = ?")
      .bind(now, supplierRequest.id)
      .run();
  }

  if (comment) {
    await insertSupplierEvent(env, supplierRequest, {
      status: "quoted",
      comment_cn: comment,
      comment_translated: commentRu,
    });

    await notifyManagerSupplierQuote(env, supplierRequest, null, options.requestUrl, {
      messageRu: commentRu,
      messageCn: comment,
      deliveryCostCny: payload.delivery_cost_cny,
      source: "supplier_message",
    }).catch(() => null);
  }

  return loadSupplierRequestByToken(env, token, { markViewed: false });
}

export async function updateSupplierDeliveryCostByToken(env, token, payload = {}) {
  const bundle = await loadSupplierRequestByToken(env, token, { markViewed: false });
  if (!bundle) {
    const error = new Error("Supplier request not found");
    error.status = 404;
    throw error;
  }

  const supplierRequest = bundle.request;
  if (TERMINAL_REQUEST_STATUSES.has(supplierRequest.status)) {
    const error = new Error("Supplier request is closed");
    error.status = 400;
    throw error;
  }
  if (!DELIVERY_COST_SOURCE_STATUSES.has(supplierRequest.status)) {
    const error = new Error("Delivery cost is not available for this supplier request");
    error.status = 400;
    throw error;
  }
  if (!(await tableHasColumn(env, "supplier_requests", "delivery_cost_cny"))) {
    const error = new Error("D1 migration 0015_supplier_delivery_cost.sql is required");
    error.status = 409;
    throw error;
  }

  const deliveryCost = normalizeOptionalAmount(payload.delivery_cost_cny);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE supplier_requests
    SET delivery_cost_cny = ?, delivery_cost_updated_at = ?, updated_at = ?
    WHERE id = ?`
  )
    .bind(deliveryCost, now, now, supplierRequest.id)
    .run();

  return loadSupplierRequestByToken(env, token, { markViewed: false });
}

export async function updateSupplierRequestByToken(env, token, payload = {}, options = {}) {
  const bundle = await loadSupplierRequestByToken(env, token, { markViewed: false });
  if (!bundle) {
    const error = new Error("Supplier request not found");
    error.status = 404;
    throw error;
  }

  const supplierRequest = bundle.request;
  if (TERMINAL_REQUEST_STATUSES.has(supplierRequest.status)) {
    const error = new Error("Supplier request is closed");
    error.status = 400;
    throw error;
  }

  const nextStatus = normalizeStatus(payload.status);
  if (!SUPPLIER_EVENT_STATUSES.has(nextStatus)) {
    const error = new Error("Unsupported supplier status");
    error.status = 400;
    throw error;
  }
  if (nextStatus === "needs_info" && !PRE_ACCEPTANCE_STATUSES.has(supplierRequest.status)) {
    const error = new Error("This supplier action is no longer available after acceptance");
    error.status = 400;
    throw error;
  }
  if (nextStatus === "no_stock" && !NO_STOCK_SOURCE_STATUSES.has(supplierRequest.status)) {
    const error = new Error("This supplier action is no longer available after acceptance");
    error.status = 400;
    throw error;
  }
  if (nextStatus === "needs_info" && !text(payload.comment_cn || payload.comment_translated)) {
    const error = new Error("Clarification text is required");
    error.status = 400;
    throw error;
  }
  if (LOGISTICS_STATUSES.has(nextStatus) && !LOGISTICS_SOURCE_STATUSES.has(supplierRequest.status)) {
    const error = new Error("Logistics status is available only after manager accepts a quote");
    error.status = 400;
    throw error;
  }
  if (PAID_LOGISTICS_STATUSES.has(nextStatus) && bundle.payment?.status !== "paid") {
    const error = new Error("Payment receipt is required before supplier tracking");
    error.status = 400;
    throw error;
  }
  if (
    PAID_LOGISTICS_STATUSES.has(nextStatus) &&
    (SUPPLIER_STATUS_PROGRESS[nextStatus] || 0) < (SUPPLIER_STATUS_PROGRESS[supplierRequest.status] || 0)
  ) {
    const error = new Error("Supplier logistics status cannot move backwards");
    error.status = 400;
    throw error;
  }
  if (["china_tracking", "china_warehouse"].includes(nextStatus)) {
    const trackingNumber = text(payload.tracking_number).toUpperCase();
    if (!trackingNumber) {
      const error = new Error("Tracking number is required");
      error.status = 400;
      throw error;
    }
    const order = await loadOrder(env, supplierRequest.order_id).catch(() => null);
    const currentTracking = text(order?.tracking_number).toUpperCase();
    if (currentTracking && currentTracking !== trackingNumber) {
      const error = new Error("CRM already has another tracking number");
      error.status = 409;
      throw error;
    }
  }
  const eventCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM supplier_tracking_events WHERE supplier_request_id = ?")
    .bind(supplierRequest.id)
    .first();
  if (number(eventCount?.count) >= MAX_PUBLIC_EVENTS_PER_REQUEST) {
    const error = new Error("Supplier event limit reached");
    error.status = 429;
    throw error;
  }

  const eventCommentCn = text(payload.comment_cn);
  const eventCommentRu = eventCommentCn
    ? await translateSupplierText(env, eventCommentCn, supplierTranslationDirections().supplierToManager)
    : "";
  const now = new Date().toISOString();
  await saveSupplierDeliveryCostPayload(env, supplierRequest, payload, now);
  await env.DB.prepare(
    `UPDATE supplier_requests
    SET status = ?, updated_at = ?, closed_at = CASE WHEN ? IN ('closed') THEN ? ELSE closed_at END
    WHERE id = ?`
  )
    .bind(nextStatus, now, nextStatus, now, supplierRequest.id)
    .run();

  await insertSupplierEvent(env, { ...supplierRequest, status: nextStatus }, {
    status: nextStatus,
    tracking_number: text(payload.tracking_number),
    comment_cn: eventCommentCn,
    comment_translated: eventCommentRu,
  });

  if (["china_tracking", "china_warehouse"].includes(nextStatus)) {
    await syncSupplierTrackingToOrder(env, { ...supplierRequest, status: nextStatus }, {
      status: nextStatus,
      tracking_number: payload.tracking_number,
    });
  }

  if (["no_stock", "needs_info", "problem", "china_tracking", "china_warehouse", "purchased"].includes(nextStatus)) {
    await notifyManagerSupplierQuote(env, { ...supplierRequest, status: nextStatus }, null, options.requestUrl, {
      messageRu: eventCommentRu,
      messageCn: eventCommentCn,
      deliveryCostCny: payload.delivery_cost_cny,
      source: `supplier_${nextStatus}`,
    }).catch(() => null);
  }

  return loadSupplierRequestByToken(env, token, { markViewed: false });
}

export async function replySupplierRequestClarification(env, supplierRequestId, payload = {}) {
  await assertSupplierTables(env);
  const supplierRequest = await env.DB.prepare("SELECT * FROM supplier_requests WHERE id = ?")
    .bind(text(supplierRequestId))
    .first();
  if (!supplierRequest) {
    const error = new Error("Supplier request not found");
    error.status = 404;
    throw error;
  }
  if (TERMINAL_REQUEST_STATUSES.has(supplierRequest.status)) {
    const error = new Error("Supplier request is closed");
    error.status = 400;
    throw error;
  }

  const commentRu = text(payload.manager_comment || payload.comment || payload.comment_ru || payload.comment_cn).slice(0, 2000);
  if (!commentRu) {
    const error = new Error("Clarification text is required");
    error.status = 400;
    throw error;
  }
  assertSupplierTextSafe(commentRu);
  const commentCn = text(payload.comment_cn) && !text(payload.manager_comment || payload.comment || payload.comment_ru)
    ? text(payload.comment_cn).slice(0, 2000)
    : await translateSupplierText(env, commentRu, supplierTranslationDirections().managerToSupplier);

  const eventCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM supplier_tracking_events WHERE supplier_request_id = ?")
    .bind(supplierRequest.id)
    .first();
  if (number(eventCount?.count) >= MAX_PUBLIC_EVENTS_PER_REQUEST) {
    const error = new Error("Supplier event limit reached");
    error.status = 429;
    throw error;
  }

  const now = new Date().toISOString();
  const nextStatus = supplierRequest.status === "needs_info" ? "sent" : supplierRequest.status;
  const fields = [
    ["manager_comment", commentRu],
    ["status", nextStatus],
    ["updated_at", now],
  ];
  if (await tableHasColumn(env, "supplier_requests", "manager_comment_ru")) {
    fields.push(["manager_comment_ru", commentRu], ["manager_comment_cn", commentCn]);
  }

  await env.DB.prepare(
    `UPDATE supplier_requests
    SET ${fields.map(([name]) => `${name} = ?`).join(", ")}
    WHERE id = ?`
  )
    .bind(...fields.map(([, value]) => value), supplierRequest.id)
    .run();

  await insertSupplierEvent(env, { ...supplierRequest, status: nextStatus }, {
    status: "sent",
    comment_cn: commentCn,
    comment_translated: commentRu,
  });

  const updated = await env.DB.prepare("SELECT * FROM supplier_requests WHERE id = ?")
    .bind(supplierRequest.id)
    .first();
  return loadSupplierBundle(env, updated || { ...supplierRequest, status: nextStatus, manager_comment: commentRu, updated_at: now });
}

export async function handleSupplierTelegramUpdate(env, message = {}) {
  const chatId = text(message.chat?.id);
  const incoming = text(message.text || message.caption).slice(0, 2000);
  const messageId = text(message.message_id);
  const replyMessageId = text(message.reply_to_message?.message_id);
  const parentReplyMessageId = text(message.reply_to_message?.reply_to_message?.message_id);
  if (!chatId || !incoming) return { handled: false };
  const inChinaChat = supplierManagerChatIds(env).has(String(chatId));
  if (!replyMessageId && !parentReplyMessageId) {
    return inChinaChat
      ? { handled: true, message: "Чтобы отправить ответ китайцу, нажмите reply на сообщение по нужному запросу." }
      : { handled: false };
  }

  const linked = await supplierTelegramMessageByReply(env, chatId, [replyMessageId, parentReplyMessageId]);
  if (!linked) {
    return inChinaChat
      ? { handled: true, message: "Не нашёл запрос для этого reply. Ответьте на сообщение бота с конкретным запросом поставщика." }
      : { handled: false };
  }

  const bundle = await replySupplierRequestClarification(env, linked.supplier_request_id, {
    manager_comment: incoming,
  });
  const request = bundle.request || {};
  const latestSent = (bundle.tracking_events || [])
    .filter((event) => event.status === "sent")
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || {};

  await saveSupplierTelegramMessage(env, request, { chat_id: chatId, message_id: messageId }, {
    direction: "manager_to_supplier",
    source: "telegram_reply",
    text_ru: incoming,
    text_cn: latestSent.comment_cn || "",
  }).catch(() => null);

  return {
    handled: true,
    supplier_request: request,
    message: `Отправил китайцу по запросу ${request.public_number || request.id}: ${incoming}`,
  };
}

export async function deleteSupplierRequest(env, supplierRequestId) {
  await assertSupplierTables(env);
  const id = text(supplierRequestId);
  const supplierRequest = await env.DB.prepare("SELECT * FROM supplier_requests WHERE id = ?")
    .bind(id)
    .first();
  if (!supplierRequest) {
    const error = new Error("Supplier request not found");
    error.status = 404;
    throw error;
  }

  await safeDelete(env, "DELETE FROM supplier_request_images WHERE supplier_request_id = ?", id);
  await safeDelete(env, "DELETE FROM supplier_tracking_events WHERE supplier_request_id = ?", id);
  await safeDelete(env, "DELETE FROM supplier_payments WHERE supplier_request_id = ?", id);
  await safeDelete(
    env,
    "DELETE FROM supplier_payments WHERE supplier_quote_id IN (SELECT id FROM supplier_quotes WHERE supplier_request_id = ?)",
    id
  );
  await safeDelete(env, "DELETE FROM supplier_quotes WHERE supplier_request_id = ?", id);
  await safeDelete(env, "DELETE FROM supplier_requests WHERE id = ?", id);

  return supplierRequest;
}

export async function selectSupplierQuote(env, quoteId) {
  await assertSupplierTables(env);

  const quote = await env.DB.prepare("SELECT * FROM supplier_quotes WHERE id = ?")
    .bind(text(quoteId))
    .first();
  if (!quote) {
    const error = new Error("Supplier quote not found");
    error.status = 404;
    throw error;
  }

  const supplierRequest = await env.DB.prepare("SELECT * FROM supplier_requests WHERE id = ?")
    .bind(quote.supplier_request_id)
    .first();
  if (!supplierRequest) {
    const error = new Error("Supplier request not found");
    error.status = 404;
    throw error;
  }
  if (TERMINAL_REQUEST_STATUSES.has(supplierRequest.status)) {
    const error = new Error("Supplier request is closed");
    error.status = 400;
    throw error;
  }
  if (quote.availability === "no_stock" || number(quote.price_cny) <= 0) {
    const error = new Error("Cannot select quote without stock or price");
    error.status = 400;
    throw error;
  }
  if (quote.status === "selected") {
    return {
      request: await loadSupplierBundle(env, supplierRequest),
      quote,
    };
  }
  if (quote.status !== "new") {
    const error = new Error("Only new supplier quotes can be selected");
    error.status = 400;
    throw error;
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE supplier_quotes
    SET status = CASE WHEN id = ? THEN 'selected' ELSE 'rejected' END,
      updated_at = ?
    WHERE supplier_request_id = ?`
  )
    .bind(quote.id, now, quote.supplier_request_id)
    .run();

  await env.DB.prepare("UPDATE supplier_requests SET status = ?, updated_at = ? WHERE id = ?")
    .bind("accepted", now, supplierRequest.id)
    .run();

  if (await tableHasColumn(env, "supplier_requests", "selected_quote_id")) {
    await env.DB.prepare("UPDATE supplier_requests SET selected_quote_id = ? WHERE id = ?")
      .bind(quote.id, supplierRequest.id)
      .run();
  }

  await insertSupplierEvent(env, { ...supplierRequest, status: "accepted" }, {
    status: "accepted",
    comment_translated: `Менеджер обрав пропозицію ${quote.price_cny || 0} CNY`,
  });

  const order = await loadOrder(env, supplierRequest.order_id).catch(() => null);
  await insertStatusEvent(env, {
    order_id: supplierRequest.order_id,
    previous_status: order?.status || "",
    status: order?.status || "proposal_sent",
    actor: "manager",
    comment: `Обрано пропозицію постачальника ${supplierRequest.supplier_name}: ${quote.price_cny || 0} CNY`,
    notify_customer: false,
    notification_status: "not_queued",
  }).catch(() => null);

  return {
    request: await loadSupplierBundle(env, { ...supplierRequest, status: "accepted", updated_at: now }),
    quote: { ...quote, status: "selected", updated_at: now },
  };
}

export async function listChinaPreorders(env, options = {}) {
  await assertSupplierTables(env);
  const status = text(options.status || "active");
  const q = text(options.q);
  const orderId = text(options.order_id || options.orderId);
  const limit = Math.min(Math.max(integer(options.limit) || 120, 1), 300);
  const hasPaymentRequestId = await tableHasColumn(env, "supplier_payments", "supplier_request_id");
  const hasCarYear = await tableHasColumn(env, "supplier_requests", "car_year");
  const clauses = [];
  const binds = [];

  if (status === "active") {
    clauses.push("supplier_requests.status NOT IN ('closed', 'canceled')");
  } else if (status === "purchased" && hasPaymentRequestId) {
    clauses.push(`(
      supplier_requests.status = ?
      OR EXISTS (
        SELECT 1
        FROM supplier_payments
        WHERE supplier_payments.supplier_request_id = supplier_requests.id
          AND supplier_payments.status = 'paid'
      )
    )`);
    binds.push(status);
  } else if (status && status !== "all") {
    clauses.push("supplier_requests.status = ?");
    binds.push(status);
  }
  if (q) {
    clauses.push(`(
      supplier_requests.public_number LIKE ?
      OR supplier_requests.supplier_name LIKE ?
      OR supplier_requests.car LIKE ?
      ${hasCarYear ? "OR supplier_requests.car_year LIKE ?" : ""}
      OR supplier_requests.vin LIKE ?
      OR supplier_requests.item_name LIKE ?
      OR orders.order_number LIKE ?
      OR orders.customer_name LIKE ?
      OR orders.customer_phone LIKE ?
    )`);
    binds.push(...Array(hasCarYear ? 9 : 8).fill(`%${q}%`));
  }
  if (orderId) {
    clauses.push("supplier_requests.order_id = ?");
    binds.push(orderId);
  }

  const rows = await safeSelect(
    env,
    `SELECT supplier_requests.*
    FROM supplier_requests
    LEFT JOIN orders ON orders.id = supplier_requests.order_id
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY supplier_requests.updated_at DESC, supplier_requests.created_at DESC
    LIMIT ?`,
    ...binds,
    limit
  );

  const bundles = [];
  for (const row of rows) {
    const bundle = await loadSupplierBundle(env, row);
    const order = await loadOrder(env, row.order_id).catch(() => null);
    if (bundle) bundles.push({ ...bundle, order });
  }
  return bundles;
}

export async function sendSupplierRequestToPayment(env, supplierRequestId, payload = {}) {
  await assertSupplierTables(env);
  const supplierRequest = await env.DB.prepare("SELECT * FROM supplier_requests WHERE id = ?")
    .bind(text(supplierRequestId))
    .first();
  if (!supplierRequest) {
    const error = new Error("Supplier request not found");
    error.status = 404;
    throw error;
  }
  if (TERMINAL_REQUEST_STATUSES.has(supplierRequest.status)) {
    const error = new Error("Supplier request is closed");
    error.status = 400;
    throw error;
  }
  if (payload.client_approved !== true) {
    const error = new Error("Client approval is required before payment");
    error.status = 400;
    throw error;
  }
  const existingPayment = await loadSupplierPaymentForRequest(env, supplierRequest);
  if (existingPayment && existingPayment.status !== "canceled") {
    return {
      payment: existingPayment,
      request: await loadSupplierBundle(env, supplierRequest),
    };
  }

  let quoteId = text(payload.quote_id || supplierRequest.selected_quote_id);
  let selected = quoteId
    ? await env.DB.prepare("SELECT * FROM supplier_quotes WHERE id = ? AND supplier_request_id = ?")
      .bind(quoteId, supplierRequest.id)
      .first()
    : null;
  if (!selected) {
    selected = await env.DB.prepare(
      `SELECT * FROM supplier_quotes
      WHERE supplier_request_id = ? AND status = 'selected'
      ORDER BY updated_at DESC
      LIMIT 1`
    )
      .bind(supplierRequest.id)
      .first();
  }
  if (!selected) {
    selected = await env.DB.prepare(
      `SELECT * FROM supplier_quotes
      WHERE supplier_request_id = ? AND status = 'new' AND availability != 'no_stock' AND price_cny > 0
      ORDER BY created_at DESC
      LIMIT 1`
    )
      .bind(supplierRequest.id)
      .first();
  }
  if (!selected) {
    const error = new Error("Supplier quote is required before payment");
    error.status = 400;
    throw error;
  }
  const payment = await createSupplierPaymentRequest(env, supplierRequest.order_id, {
    supplier_name: supplierRequest.supplier_name,
    requested_amount: number(payload.requested_amount || selected.price_cny),
    requested_currency: text(payload.requested_currency || "CNY"),
    supplier_request_id: supplierRequest.id,
    supplier_quote_id: selected.id,
    notes: text(payload.notes) || [
      `Запрос: ${supplierRequest.public_number || supplierRequest.id}`,
      supplierRequest.item_name ? `Позиция: ${supplierRequest.item_name}` : "",
      selected.purchase_days ? `Срок: ${selected.purchase_days} дн.` : "",
      selected.comment_ru || selected.comment_translated || selected.comment_cn ? `Комментарий: ${selected.comment_ru || selected.comment_translated || selected.comment_cn}` : "",
    ].filter(Boolean).join("\n"),
  });

  if (selected.status !== "selected") {
    const result = await selectSupplierQuote(env, selected.id);
    selected = result.quote;
  }

  const updated = await env.DB.prepare("SELECT * FROM supplier_requests WHERE id = ?")
    .bind(supplierRequest.id)
    .first();
  return {
    payment,
    request: await loadSupplierBundle(env, updated || supplierRequest),
  };
}
