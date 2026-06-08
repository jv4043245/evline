import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const root = process.cwd();
const dataRoot = path.resolve(".local-data");
const leadsFile = path.join(dataRoot, "leads.json");
const costsFile = path.join(dataRoot, "ad-costs.json");
const customersFile = path.join(dataRoot, "customers.json");
const ordersFile = path.join(dataRoot, "orders.json");
const eventsFile = path.join(dataRoot, "order-events.json");
const notificationsFile = path.join(dataRoot, "notifications.json");
const shippingFile = path.join(dataRoot, "shipping.json");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function send(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function sendCsv(res, body, filename = "evline-leads.csv") {
  res.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readJsonList(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return [];
  }
}

async function writeJsonList(file, rows) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(rows, null, 2)}\n`);
}

function defaultShippingData() {
  const now = new Date().toISOString();
  return {
    carriers: [
      {
        id: "mist-china",
        created_at: now,
        updated_at: now,
        name: "Meest China",
        code: "meest-china",
        active: 1,
        tracking_url_template: "https://cab.meest.cn/",
        notes: "Комерційне карго з Китаю: авіа від 11.3 USD/кг, море від 2.5 USD/кг. Партії від 150 EUR та 30 кг.",
      },
      {
        id: "ukr-china",
        created_at: now,
        updated_at: now,
        name: "Ukr-China",
        code: "ukr-china",
        active: 1,
        tracking_url_template: "https://ukr-china.com",
        notes: "Вартість розраховується менеджером під конкретний вантаж. Сроки: авіа від 14 днів, море 55-60 днів.",
      },
    ],
    rates: [
      {
        id: "mist-china-air",
        created_at: now,
        updated_at: now,
        carrier_id: "mist-china",
        mode: "air",
        currency: "USD",
        rate: 11.3,
        unit: "kg",
        min_charge: 0,
        min_weight_kg: 30,
        min_volume_m3: 0,
        exchange_rate_uah: 42,
        estimated_days_min: 12,
        estimated_days_max: 15,
        active: 1,
        notes: "Meest China: авіа комерційних збірних вантажів, від 11.3 USD/кг, 12-15 днів.",
      },
      {
        id: "mist-china-sea",
        created_at: now,
        updated_at: now,
        carrier_id: "mist-china",
        mode: "sea",
        currency: "USD",
        rate: 2.5,
        unit: "kg",
        min_charge: 0,
        min_weight_kg: 0,
        min_volume_m3: 0,
        exchange_rate_uah: 42,
        estimated_days_min: 60,
        estimated_days_max: 65,
        active: 1,
        notes: "Meest China: море комерційних збірних вантажів, від 2.5 USD/кг, 60-65 днів.",
      },
      {
        id: "ukr-china-air",
        created_at: now,
        updated_at: now,
        carrier_id: "ukr-china",
        mode: "air",
        currency: "UAH",
        rate: 0,
        unit: "kg",
        min_charge: 0,
        min_weight_kg: 0,
        min_volume_m3: 0,
        exchange_rate_uah: 0,
        estimated_days_min: 14,
        estimated_days_max: 14,
        active: 1,
        notes: "Ukr-China: точна вартість розраховується менеджером, авіа від 14 днів.",
      },
      {
        id: "ukr-china-sea",
        created_at: now,
        updated_at: now,
        carrier_id: "ukr-china",
        mode: "sea",
        currency: "UAH",
        rate: 0,
        unit: "kg",
        min_charge: 0,
        min_weight_kg: 0,
        min_volume_m3: 0,
        exchange_rate_uah: 0,
        estimated_days_min: 55,
        estimated_days_max: 60,
        active: 1,
        notes: "Ukr-China: точна вартість розраховується менеджером, море 55-60 днів.",
      },
    ],
  };
}

async function readShippingData() {
  try {
    const data = JSON.parse(await readFile(shippingFile, "utf8"));
    return {
      carriers: Array.isArray(data.carriers) ? data.carriers : [],
      rates: Array.isArray(data.rates) ? data.rates : [],
    };
  } catch {
    const data = defaultShippingData();
    await mkdir(path.dirname(shippingFile), { recursive: true });
    await writeFile(shippingFile, `${JSON.stringify(data, null, 2)}\n`);
    return data;
  }
}

async function writeShippingData(data) {
  await mkdir(path.dirname(shippingFile), { recursive: true });
  await writeFile(shippingFile, `${JSON.stringify(data, null, 2)}\n`);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

function text(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rangeStart(range = "30d") {
  if (range === "all") return null;
  const days = {
    "1d": 1,
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "365d": 365,
  }[range] || 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function inRange(row, range, field = "created_at") {
  const start = rangeStart(range);
  if (!start) return true;
  return String(row[field] || "") >= start;
}

function escapeCsv(value) {
  const output = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(output) ? `"${output.replace(/"/g, '""')}"` : output;
}

function filterLeads(leads, params) {
  const range = params.get("range") || "30d";
  const status = params.get("status") || "all";
  const type = params.get("type") || "all";
  const q = (params.get("q") || "").toLowerCase();

  return leads
    .filter((lead) => inRange(lead, range))
    .filter((lead) => status === "all" || lead.status === status)
    .filter((lead) => type === "all" || lead.type === type)
    .filter((lead) => {
      if (!q) return true;
      return [lead.name, lead.phone, lead.email, lead.telegram, lead.car, lead.vin, lead.message, lead.campaign]
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

const orderStatuses = new Set([
  "new",
  "accepted",
  "proposal_sent",
  "paid",
  "sourcing_china",
  "china_warehouse",
  "left_china",
  "in_ukraine",
  "ready_for_pickup",
  "completed",
  "canceled",
]);

function normalizeOrderStatus(value, fallback = "new") {
  const status = text(value);
  return orderStatuses.has(status) ? status : fallback;
}

function normalizeTelegram(value) {
  const cleaned = text(value).replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
  return cleaned ? `@${cleaned}` : "";
}

function managerContactForType(type) {
  return text(type).toLowerCase() === "byd" ? "@evline_tech" : "@evline_support";
}

function detectLeadType(payload, pathname = "") {
  const explicitType = text(payload.type).toLowerCase();
  if (["parts", "byd", "other"].includes(explicitType)) return explicitType;
  const topic = text(payload.topic || payload.service || payload.form_type).toLowerCase();
  if (topic.includes("byd") || topic.includes("програм") || topic.includes("оновлен")) return "byd";
  const signal = `${pathname} ${text(payload.landing_page)} ${text(payload.referrer)}`.toLowerCase();
  return signal.includes("програмування") || signal.includes("programuv") || signal.includes("programming") || signal.includes("/byd.html") ? "byd" : "parts";
}

function extractOrderId(value) {
  const input = text(value);
  const match = input.match(/(?:^|\s)(?:\/start\s+)?order[_:-]([0-9a-fA-F-]{36})(?:\s|$)/);
  return match ? match[1] : "";
}

function orderCost(order) {
  return (
    number(order.purchase_cost_uah) +
    number(order.delivery_cost_uah) +
    number(order.customs_cost_uah) +
    number(order.processing_cost_uah) +
    number(order.ad_cost_uah) +
    number(order.other_cost_uah)
  );
}

function withProfit(order) {
  return {
    ...order,
    gross_profit_uah: number(order.revenue_uah) - orderCost(order),
  };
}

async function retryLocalNotification(notificationId) {
  const notifications = await readJsonList(notificationsFile);
  const index = notifications.findIndex((notification) => notification.id === notificationId);
  if (index === -1) return { ok: false, status: "not_found", error: "Notification not found" };

  const orders = await readJsonList(ordersFile);
  const order = orders.find((item) => item.id === notifications[index].order_id);
  if (!order) return { ok: false, status: "order_not_found", error: "Order not found" };

  const now = new Date().toISOString();
  const recipientChatId = text(notifications[index].recipient_chat_id || order.telegram_chat_id);
  const attempts = number(notifications[index].attempts) + 1;
  const status = recipientChatId ? "sent" : "skipped";
  const error = recipientChatId ? "" : "Telegram chat_id клієнта ще не прив'язаний";

  notifications[index] = {
    ...notifications[index],
    updated_at: now,
    recipient_chat_id: recipientChatId,
    recipient_contact: notifications[index].recipient_contact || order.customer_telegram || order.customer_phone || order.customer_email,
    status,
    attempts,
    sent_at: recipientChatId ? now : notifications[index].sent_at || "",
    telegram_message_id: recipientChatId ? `local-${Date.now()}` : notifications[index].telegram_message_id || "",
    error,
  };
  await writeJsonList(notificationsFile, notifications);

  if (notifications[index].event_id) {
    const events = await readJsonList(eventsFile);
    await writeJsonList(
      eventsFile,
      events.map((event) =>
        event.id === notifications[index].event_id ? { ...event, notification_status: status } : event
      )
    );
  }

  return { ok: status === "sent", id: notificationId, status, error };
}

async function retryLatestLocalNotification(orderId) {
  const notifications = (await readJsonList(notificationsFile))
    .filter((notification) => notification.order_id === orderId && ["pending", "failed", "skipped"].includes(notification.status))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (!notifications.length) return { ok: true, status: "nothing_to_retry" };
  return retryLocalNotification(notifications[0].id);
}

function filterOrders(orders, params) {
  const range = params.get("range") || "30d";
  const status = params.get("status") || "all";
  const type = params.get("type") || "all";
  const q = (params.get("q") || "").toLowerCase();

  return orders
    .filter((order) => inRange(order, range))
    .filter((order) => status === "all" || order.status === status)
    .filter((order) => type === "all" || order.type === type)
    .filter((order) => {
      if (!q) return true;
      return [
        order.customer_name,
        order.customer_phone,
        order.customer_email,
        order.customer_telegram,
        order.car,
        order.vin,
        order.item_name,
        order.service_name,
        order.request_text,
        order.campaign,
        order.tracking_number,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .map(withProfit)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function upsertLocalCustomer(payload) {
  const customers = await readJsonList(customersFile);
  const phone = text(payload.phone || payload.customer_phone);
  const email = text(payload.email || payload.customer_email);
  const telegram = normalizeTelegram(payload.telegram || payload.customer_telegram);
  let customer = customers.find(
    (item) => (phone && item.phone === phone) || (email && item.email === email) || (telegram && item.telegram_username === telegram)
  );
  const now = new Date().toISOString();
  if (customer) {
    customer = {
      ...customer,
      updated_at: now,
      name: text(payload.name || payload.customer_name) || customer.name,
      phone: phone || customer.phone,
      email: email || customer.email,
      telegram_username: telegram || customer.telegram_username,
    };
    await writeJsonList(
      customersFile,
      customers.map((item) => (item.id === customer.id ? customer : item))
    );
    return customer.id;
  }
  customer = {
    id: randomUUID(),
    created_at: now,
    updated_at: now,
    name: text(payload.name || payload.customer_name),
    phone,
    email,
    telegram_username: telegram,
    telegram_chat_id: "",
    preferred_channel: "telegram",
    notes: "",
  };
  customers.push(customer);
  await writeJsonList(customersFile, customers);
  return customer.id;
}

async function createLocalOrderFromLead(lead) {
  const orders = await readJsonList(ordersFile);
  const existing = orders.find((order) => order.lead_id === lead.id);
  if (existing) return existing.id;

  const customerId = await upsertLocalCustomer(lead);
  const order = {
    id: randomUUID(),
    created_at: lead.created_at,
    updated_at: lead.updated_at,
    lead_id: lead.id,
    customer_id: customerId,
    type: lead.type || "parts",
    status: "new",
    manager_contact: managerContactForType(lead.type),
    customer_name: lead.name,
    customer_phone: lead.phone,
    customer_email: lead.email,
    customer_telegram: normalizeTelegram(lead.telegram),
    telegram_chat_id: "",
    car: lead.car,
    vin: lead.vin,
    item_name: lead.part || "",
    service_name: lead.type === "byd" ? "Програмування BYD" : "",
    request_text: lead.message || "",
    tracking_carrier: "",
    tracking_number: "",
    tracking_url: "",
    china_warehouse: "",
    shipping_carrier_id: "",
    shipping_rate_id: "",
    shipping_mode: "",
    shipping_weight_kg: 0,
    shipping_volume_m3: 0,
    shipping_rate: 0,
    shipping_rate_currency: "",
    shipping_rate_unit: "",
    shipping_exchange_rate_uah: 0,
    source: lead.source,
    medium: lead.medium,
    campaign: lead.campaign,
    term: lead.term,
    content: lead.content,
    gclid: lead.gclid,
    fbclid: lead.fbclid,
    landing_page: lead.landing_page,
    referrer: lead.referrer,
    revenue_uah: 0,
    purchase_cost_uah: 0,
    delivery_cost_uah: 0,
    customs_cost_uah: 0,
    processing_cost_uah: 0,
    ad_cost_uah: 0,
    other_cost_uah: 0,
    payment_status: "unknown",
    manager_notes: "",
    client_notes: "",
    loss_reason: "",
    next_action_at: "",
  };
  orders.push(order);
  await writeJsonList(ordersFile, orders);

  const events = await readJsonList(eventsFile);
  events.push({
    id: randomUUID(),
    created_at: lead.created_at,
    order_id: order.id,
    previous_status: "",
    status: "new",
    actor: "site",
    comment: "Заявка створена на сайті",
    notify_customer: 0,
    notification_status: "not_queued",
  });
  await writeJsonList(eventsFile, events);
  return order.id;
}

function slug(value) {
  const cleaned = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9а-яіїєґ_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return cleaned || randomUUID();
}

function normalizeShippingRate(rate, carrierId, now) {
  const mode = ["air", "sea"].includes(text(rate.mode).toLowerCase()) ? text(rate.mode).toLowerCase() : "air";
  const unit = ["kg", "m3", "item"].includes(text(rate.unit).toLowerCase()) ? text(rate.unit).toLowerCase() : "kg";
  const currency = ["UAH", "USD", "EUR"].includes(text(rate.currency).toUpperCase()) ? text(rate.currency).toUpperCase() : "UAH";
  return {
    id: text(rate.id) || `${carrierId}-${mode}`,
    created_at: rate.created_at || now,
    updated_at: now,
    carrier_id: carrierId,
    mode,
    currency,
    rate: number(rate.rate),
    unit,
    min_charge: number(rate.min_charge),
    min_weight_kg: number(rate.min_weight_kg),
    min_volume_m3: number(rate.min_volume_m3),
    exchange_rate_uah: number(rate.exchange_rate_uah),
    estimated_days_min: integer(rate.estimated_days_min),
    estimated_days_max: integer(rate.estimated_days_max),
    active: text(rate.active) === "0" ? 0 : 1,
    notes: text(rate.notes),
  };
}

function normalizeShippingCarrier(payload, existing = {}) {
  const now = new Date().toISOString();
  const id = text(payload.id) || slug(payload.code || payload.name);
  return {
    carrier: {
      id,
      created_at: existing.created_at || now,
      updated_at: now,
      name: text(payload.name),
      code: text(payload.code) || id,
      active: text(payload.active) === "0" ? 0 : 1,
      tracking_url_template: text(payload.tracking_url_template),
      notes: text(payload.notes),
    },
    rates: Array.isArray(payload.rates) ? payload.rates.map((rate) => normalizeShippingRate(rate, id, now)) : [],
  };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/telegram/webhook" && req.method === "POST") {
    const payload = await readBody(req);
    const message = payload.message || payload.edited_message || payload.callback_query?.message || {};
    const chatId = text(message.chat?.id);
    const incomingText = text(payload.message?.text || payload.callback_query?.data);
    const orderId = extractOrderId(incomingText);

    if (!chatId) return sendJson(res, 200, { ok: true, skipped: "no_chat_id" });
    if (!orderId) return sendJson(res, 200, { ok: true, skipped: "no_order_id" });

    const orders = await readJsonList(ordersFile);
    const orderIndex = orders.findIndex((order) => order.id === orderId);
    if (orderIndex === -1) return sendJson(res, 200, { ok: true, skipped: "order_not_found" });

    const now = new Date().toISOString();
    const username = text(message.chat?.username || payload.message?.from?.username);
    const telegramUsername = username ? `@${username.replace(/^@/, "")}` : orders[orderIndex].customer_telegram || "";
    orders[orderIndex] = {
      ...orders[orderIndex],
      updated_at: now,
      telegram_chat_id: chatId,
      customer_telegram: telegramUsername || orders[orderIndex].customer_telegram,
    };
    await writeJsonList(ordersFile, orders);

    if (orders[orderIndex].customer_id) {
      const customers = await readJsonList(customersFile);
      await writeJsonList(
        customersFile,
        customers.map((customer) =>
          customer.id === orders[orderIndex].customer_id
            ? {
                ...customer,
                updated_at: now,
                telegram_chat_id: chatId,
                telegram_username: telegramUsername || customer.telegram_username,
              }
            : customer
        )
      );
    }

    const retry = await retryLatestLocalNotification(orderId);
    return sendJson(res, 200, { ok: true, order_id: orderId, retry });
  }

  if (url.pathname === "/api/leads" && req.method === "POST") {
    const payload = await readBody(req);
    if (!payload.phone && !payload.email && !payload.telegram) {
      return sendJson(res, 400, { error: "Phone, email or Telegram is required" });
    }
    const now = new Date().toISOString();
    const part = text(payload.part || payload.item_name || payload.need || payload.requested_part);
    const details = text(payload.message || payload.request_text || payload.details || payload.comment);
    const message = [part ? `Запчастина: ${part}` : "", details].filter(Boolean).join("\n");
    const lead = {
      id: randomUUID(),
      created_at: now,
      updated_at: now,
      type: detectLeadType(payload, url.pathname),
      status: "new",
      quality: "unknown",
      name: text(payload.name || payload.customer_name),
      phone: text(payload.phone || payload.customer_phone || payload.tel || payload.contact),
      email: text(payload.email || payload.customer_email),
      telegram: text(payload.telegram || payload.customer_telegram || payload.telegram_username || payload.tg),
      car: text(payload.car || payload.model || payload.auto),
      vin: text(payload.vin).toUpperCase(),
      part,
      details,
      message,
      source: text(payload.utm_source || payload.source) || "site",
      medium: text(payload.utm_medium || payload.medium),
      campaign: text(payload.utm_campaign || payload.campaign),
      term: text(payload.utm_term || payload.term),
      content: text(payload.utm_content || payload.content),
      gclid: text(payload.gclid),
      fbclid: text(payload.fbclid),
      landing_page: text(payload.landing_page),
      referrer: text(payload.referrer || req.headers.referer),
      user_agent: text(req.headers["user-agent"]),
      revenue_uah: 0,
      cost_uah: 0,
      processing_cost_uah: 0,
      manager_notes: "",
      loss_reason: "",
      next_action_at: "",
    };
    const leads = await readJsonList(leadsFile);
    leads.push(lead);
    await writeJsonList(leadsFile, leads);
    const orderId = await createLocalOrderFromLead(lead);
    return sendJson(res, 200, { ok: true, lead_id: lead.id, order_id: orderId });
  }

  if (url.pathname === "/api/admin/shipping" && req.method === "GET") {
    return sendJson(res, 200, await readShippingData());
  }

  if (url.pathname === "/api/admin/shipping" && ["POST", "PATCH"].includes(req.method)) {
    const payload = await readBody(req);
    const data = await readShippingData();
    const existing = data.carriers.find((carrier) => carrier.id === text(payload.id));
    const { carrier, rates } = normalizeShippingCarrier(payload, existing || {});
    if (!carrier.name) return sendJson(res, 400, { error: "Carrier name is required" });
    const carrierExists = data.carriers.some((item) => item.id === carrier.id);
    const next = {
      carriers: carrierExists
        ? data.carriers.map((item) => (item.id === carrier.id ? carrier : item))
        : [...data.carriers, carrier],
      rates: [
        ...data.rates.filter((rate) => rate.carrier_id !== carrier.id),
        ...rates,
      ],
    };
    await writeShippingData(next);
    return sendJson(res, 200, { ok: true, ...next });
  }

  if (url.pathname === "/api/admin/orders" && req.method === "GET") {
    const orders = filterOrders(await readJsonList(ordersFile), url.searchParams);
    const limit = Math.min(Math.max(integer(url.searchParams.get("limit")) || 100, 1), 500);
    const offset = Math.max(integer(url.searchParams.get("offset")) || 0, 0);
    const rows = orders.slice(offset, offset + limit);
    if (url.searchParams.get("format") === "csv") {
      const columns = [
        "created_at",
        "type",
        "status",
        "customer_name",
        "customer_phone",
        "customer_telegram",
        "car",
        "vin",
        "item_name",
        "service_name",
        "tracking_carrier",
        "tracking_number",
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
      const body = [columns.join(","), ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(","))].join("\n");
      return sendCsv(res, body, "evline-orders.csv");
    }
    return sendJson(res, 200, { orders: rows, total: orders.length, limit, offset });
  }

  const orderMatch = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (orderMatch && req.method === "GET") {
    const order = (await readJsonList(ordersFile)).find((item) => item.id === orderMatch[1]);
    if (!order) return sendJson(res, 404, { error: "Order not found" });
    const events = (await readJsonList(eventsFile))
      .filter((event) => event.order_id === order.id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const notifications = (await readJsonList(notificationsFile))
      .filter((item) => item.order_id === order.id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return sendJson(res, 200, { order: withProfit(order), events, notifications });
  }

  if (orderMatch && req.method === "PATCH") {
    const payload = await readBody(req);
    const orders = await readJsonList(ordersFile);
    const index = orders.findIndex((order) => order.id === orderMatch[1]);
    if (index === -1) return sendJson(res, 404, { error: "Order not found" });
    const current = orders[index];
    const nextStatus = normalizeOrderStatus(payload.status, current.status);
    const statusChanged = nextStatus !== current.status;
    const now = new Date().toISOString();
    const updated = {
      ...current,
      updated_at: now,
      status: nextStatus,
      type: text(payload.type) || current.type,
      manager_contact: text(payload.manager_contact) || current.manager_contact || managerContactForType(text(payload.type) || current.type),
      customer_name: text(payload.customer_name),
      customer_phone: text(payload.customer_phone),
      customer_email: text(payload.customer_email),
      customer_telegram: normalizeTelegram(payload.customer_telegram),
      telegram_chat_id: text(payload.telegram_chat_id),
      car: text(payload.car),
      vin: text(payload.vin).toUpperCase(),
      item_name: text(payload.item_name),
      service_name: text(payload.service_name),
      request_text: text(payload.request_text),
      tracking_carrier: text(payload.tracking_carrier),
      tracking_number: text(payload.tracking_number),
      tracking_url: text(payload.tracking_url),
      china_warehouse: text(payload.china_warehouse),
      shipping_carrier_id: text(payload.shipping_carrier_id),
      shipping_rate_id: text(payload.shipping_rate_id),
      shipping_mode: text(payload.shipping_mode),
      shipping_weight_kg: number(payload.shipping_weight_kg),
      shipping_volume_m3: number(payload.shipping_volume_m3),
      shipping_rate: number(payload.shipping_rate),
      shipping_rate_currency: text(payload.shipping_rate_currency),
      shipping_rate_unit: text(payload.shipping_rate_unit),
      shipping_exchange_rate_uah: number(payload.shipping_exchange_rate_uah),
      revenue_uah: number(payload.revenue_uah),
      purchase_cost_uah: number(payload.purchase_cost_uah),
      delivery_cost_uah: number(payload.delivery_cost_uah),
      customs_cost_uah: number(payload.customs_cost_uah),
      processing_cost_uah: number(payload.processing_cost_uah),
      ad_cost_uah: number(payload.ad_cost_uah),
      other_cost_uah: number(payload.other_cost_uah),
      payment_status: text(payload.payment_status) || current.payment_status || "unknown",
      manager_notes: text(payload.manager_notes),
      client_notes: text(payload.client_notes),
      loss_reason: text(payload.loss_reason),
      next_action_at: text(payload.next_action_at),
    };
    if (statusChanged && nextStatus === "paid") updated.paid_at = updated.paid_at || now;
    if (statusChanged && nextStatus === "sourcing_china") updated.ordered_at = updated.ordered_at || now;
    if (statusChanged && nextStatus === "ready_for_pickup") updated.delivered_at = updated.delivered_at || now;
    if (statusChanged && nextStatus === "completed") updated.completed_at = updated.completed_at || now;
    if (statusChanged && nextStatus === "canceled") updated.canceled_at = updated.canceled_at || now;
    orders[index] = updated;
    await writeJsonList(ordersFile, orders);

    const events = await readJsonList(eventsFile);
    if (statusChanged) {
      const event = {
        id: randomUUID(),
        created_at: now,
        order_id: updated.id,
        previous_status: current.status,
        status: nextStatus,
        actor: "manager",
        comment: text(payload.status_comment),
        notify_customer: payload.notify_customer === "0" ? 0 : 1,
        notification_status: payload.notify_customer === "0" ? "not_queued" : updated.telegram_chat_id ? "pending" : "skipped",
      };
      events.push(event);
      await writeJsonList(eventsFile, events);
      if (event.notify_customer) {
        const notifications = await readJsonList(notificationsFile);
        notifications.push({
          id: randomUUID(),
          created_at: now,
          updated_at: now,
          order_id: updated.id,
          event_id: event.id,
          channel: "telegram",
          recipient_chat_id: updated.telegram_chat_id,
          recipient_contact: updated.customer_telegram || updated.customer_phone || updated.customer_email,
          template_key: `order_${nextStatus}`,
          message: text(payload.customer_message),
          status: updated.telegram_chat_id ? "pending" : "skipped",
          attempts: 0,
          sent_at: "",
          telegram_message_id: "",
          error: updated.telegram_chat_id ? "" : "Telegram chat_id клієнта ще не прив'язаний",
        });
        await writeJsonList(notificationsFile, notifications);
      }
    }

    return sendJson(res, 200, {
      ok: true,
      order: withProfit(updated),
      events: events.filter((event) => event.order_id === updated.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
      notifications: (await readJsonList(notificationsFile))
        .filter((item) => item.order_id === updated.id)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    });
  }

  const notificationRetryMatch = url.pathname.match(/^\/api\/admin\/notifications\/([^/]+)\/retry$/);
  if (notificationRetryMatch && req.method === "POST") {
    const result = await retryLocalNotification(notificationRetryMatch[1]);
    return sendJson(res, result.status === "not_found" ? 404 : 200, result);
  }

  if (url.pathname === "/api/admin/leads" && req.method === "GET") {
    const leads = filterLeads(await readJsonList(leadsFile), url.searchParams);
    const limit = Math.min(Math.max(integer(url.searchParams.get("limit")) || 100, 1), 500);
    const offset = Math.max(integer(url.searchParams.get("offset")) || 0, 0);
    const rows = leads.slice(offset, offset + limit);
    if (url.searchParams.get("format") === "csv") {
      const columns = ["created_at", "type", "status", "quality", "name", "phone", "email", "telegram", "car", "vin", "message", "source", "medium", "campaign", "term", "revenue_uah", "cost_uah", "processing_cost_uah", "manager_notes"];
      const body = [columns.join(","), ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(","))].join("\n");
      return sendCsv(res, body);
    }
    return sendJson(res, 200, { leads: rows, total: leads.length, limit, offset });
  }

  const leadMatch = url.pathname.match(/^\/api\/admin\/leads\/([^/]+)$/);
  if (leadMatch && req.method === "PATCH") {
    const payload = await readBody(req);
    const leads = await readJsonList(leadsFile);
    const index = leads.findIndex((lead) => lead.id === leadMatch[1]);
    if (index === -1) return sendJson(res, 404, { error: "Lead not found" });
    leads[index] = {
      ...leads[index],
      updated_at: new Date().toISOString(),
      status: text(payload.status) || leads[index].status,
      quality: text(payload.quality) || leads[index].quality,
      revenue_uah: number(payload.revenue_uah),
      cost_uah: number(payload.cost_uah),
      processing_cost_uah: number(payload.processing_cost_uah),
      manager_notes: text(payload.manager_notes),
      loss_reason: text(payload.loss_reason),
      next_action_at: text(payload.next_action_at),
    };
    await writeJsonList(leadsFile, leads);
    return sendJson(res, 200, { ok: true, lead: leads[index] });
  }

  if (url.pathname === "/api/admin/costs" && req.method === "GET") {
    const range = url.searchParams.get("range") || "30d";
    const start = rangeStart(range)?.slice(0, 10);
    const costs = (await readJsonList(costsFile))
      .filter((cost) => !start || String(cost.cost_date || "") >= start)
      .sort((a, b) => String(b.cost_date).localeCompare(String(a.cost_date)));
    return sendJson(res, 200, { costs });
  }

  if (url.pathname === "/api/admin/costs" && req.method === "POST") {
    const payload = await readBody(req);
    const now = new Date().toISOString();
    const cost = {
      id: randomUUID(),
      created_at: now,
      updated_at: now,
      cost_date: text(payload.cost_date) || now.slice(0, 10),
      platform: text(payload.platform) || "google",
      source: text(payload.source) || "google",
      medium: text(payload.medium) || "cpc",
      campaign: text(payload.campaign),
      spend_uah: number(payload.spend_uah),
      clicks: integer(payload.clicks),
      impressions: integer(payload.impressions),
      notes: text(payload.notes),
    };
    const costs = await readJsonList(costsFile);
    costs.push(cost);
    await writeJsonList(costsFile, costs);
    return sendJson(res, 200, { ok: true, cost });
  }

  if (url.pathname === "/api/admin/summary" && req.method === "GET") {
    const range = url.searchParams.get("range") || "30d";
    const leads = (await readJsonList(leadsFile)).filter((lead) => inRange(lead, range));
    const orders = (await readJsonList(ordersFile)).filter((order) => inRange(order, range)).map(withProfit);
    const startDate = rangeStart(range)?.slice(0, 10);
    const costs = (await readJsonList(costsFile)).filter((cost) => !startDate || String(cost.cost_date || "") >= startDate);
    const completed = orders.filter((order) => order.status === "completed");
    const adSpend = costs.reduce((sum, cost) => sum + number(cost.spend_uah), 0);
    const revenue = orders.reduce((sum, order) => sum + number(order.revenue_uah), 0);
    const grossProfit = orders.reduce((sum, order) => sum + number(order.gross_profit_uah), 0);
    const bySource = new Map();
    const byCampaign = new Map();
    const byDay = new Map();
    for (const order of orders) {
      const source = order.source || "direct";
      const campaign = order.campaign || "без кампанії";
      const day = String(order.created_at || "").slice(0, 10);
      const sourceRow = bySource.get(source) || { source, orders: 0, completed_orders: 0, revenue_uah: 0, gross_profit_uah: 0 };
      sourceRow.orders += 1;
      sourceRow.completed_orders += order.status === "completed" ? 1 : 0;
      sourceRow.revenue_uah += number(order.revenue_uah);
      sourceRow.gross_profit_uah += number(order.gross_profit_uah);
      bySource.set(source, sourceRow);
      const campaignRow = byCampaign.get(`${source}/${campaign}`) || { source, campaign, orders: 0, completed_orders: 0, revenue_uah: 0, gross_profit_uah: 0 };
      campaignRow.orders += 1;
      campaignRow.completed_orders += order.status === "completed" ? 1 : 0;
      campaignRow.revenue_uah += number(order.revenue_uah);
      campaignRow.gross_profit_uah += number(order.gross_profit_uah);
      byCampaign.set(`${source}/${campaign}`, campaignRow);
      const dayRow = byDay.get(day) || { day, orders: 0, completed_orders: 0, revenue_uah: 0, gross_profit_uah: 0 };
      dayRow.orders += 1;
      dayRow.completed_orders += order.status === "completed" ? 1 : 0;
      dayRow.revenue_uah += number(order.revenue_uah);
      dayRow.gross_profit_uah += number(order.gross_profit_uah);
      byDay.set(day, dayRow);
    }
    const totals = {
      leads: leads.length,
      new_leads: leads.filter((lead) => lead.status === "new").length,
      orders: orders.length,
      active_orders: orders.filter((order) => !["completed", "canceled"].includes(order.status)).length,
      completed_orders: completed.length,
      canceled_orders: orders.filter((order) => order.status === "canceled").length,
      high_quality: leads.filter((lead) => lead.quality === "high").length,
      revenue_uah: revenue,
      purchase_cost_uah: orders.reduce((sum, order) => sum + number(order.purchase_cost_uah), 0),
      delivery_cost_uah: orders.reduce((sum, order) => sum + number(order.delivery_cost_uah), 0),
      customs_cost_uah: orders.reduce((sum, order) => sum + number(order.customs_cost_uah), 0),
      processing_cost_uah: orders.reduce((sum, order) => sum + number(order.processing_cost_uah), 0),
      attributed_ad_cost_uah: orders.reduce((sum, order) => sum + number(order.ad_cost_uah), 0),
      other_cost_uah: orders.reduce((sum, order) => sum + number(order.other_cost_uah), 0),
      total_order_cost_uah: orders.reduce((sum, order) => sum + orderCost(order), 0),
      gross_profit_uah: grossProfit,
      avg_order_uah: orders.length ? orders.reduce((sum, order) => sum + number(order.revenue_uah), 0) / orders.length : 0,
      avg_processing_cost_uah: orders.length ? orders.reduce((sum, order) => sum + number(order.processing_cost_uah), 0) / orders.length : 0,
      ad_spend_uah: adSpend,
      clicks: costs.reduce((sum, cost) => sum + integer(cost.clicks), 0),
      impressions: costs.reduce((sum, cost) => sum + integer(cost.impressions), 0),
      close_rate: leads.length ? completed.length / leads.length : 0,
      order_completion_rate: orders.length ? completed.length / orders.length : 0,
      cpl_uah: leads.length && adSpend ? adSpend / leads.length : 0,
      cpa_uah: completed.length && adSpend ? adSpend / completed.length : 0,
      roas: adSpend ? revenue / adSpend : 0,
      profit_roas: adSpend ? grossProfit / adSpend : 0,
    };
    return sendJson(res, 200, {
      range,
      totals,
      sources: [...bySource.values()].sort((a, b) => b.orders - a.orders).slice(0, 12),
      campaigns: [...byCampaign.values()].sort((a, b) => b.orders - a.orders).slice(0, 20),
      daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-30),
    });
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${host}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (handled !== false) return;
    }

    const pathname = decodeURIComponent(url.pathname);
    let file = path.resolve(root, `.${pathname}`);

    if (!file.startsWith(root)) return send(res, 403, "forbidden");
    if (!existsSync(file)) return send(res, 404, "not found");
    if (statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!existsSync(file)) return send(res, 404, "not found");

    res.writeHead(200, {
      "content-type": contentTypes.get(path.extname(file).toLowerCase()) || "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  } catch (error) {
    send(res, 500, error.stack || String(error));
  }
});

server.listen(port, host, () => {
  console.log(`EVLine static clone: http://${host}:${port}/`);
});
