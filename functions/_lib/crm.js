import { number, text } from "./http.js";
import { queueGoogleAdsConversionsForOrder } from "./google-ads.js";

export const ORDER_STATUS_LABELS = {
  new: "Нова заявка",
  accepted: "Прийнято в роботу",
  proposal_sent: "Пропозицію відправлено",
  awaiting_payment: "Очікує оплати",
  paid: "Оплачено",
  sourcing_china: "Шукаємо / замовляємо в Китаї",
  china_warehouse: "На складі в Китаї",
  left_china: "Виїхало з Китаю",
  in_ukraine: "В Україні",
  ready_for_pickup: "Готово до видачі",
  completed: "Завершено",
  canceled: "Скасовано",
};

export const ORDER_STATUSES = new Set(Object.keys(ORDER_STATUS_LABELS));

const STATUS_TEMPLATE_KEYS = {
  new: "order_new",
  accepted: "order_accepted",
  proposal_sent: "order_proposal_sent",
  awaiting_payment: "order_awaiting_payment",
  paid: "order_paid",
  sourcing_china: "order_sourcing_china",
  china_warehouse: "order_china_warehouse",
  left_china: "order_left_china",
  in_ukraine: "order_in_ukraine",
  ready_for_pickup: "order_ready_for_pickup",
  completed: "order_completed",
  canceled: "order_canceled",
};

export function normalizeOrderStatus(value, fallback = "new") {
  const status = text(value);
  return ORDER_STATUSES.has(status) ? status : fallback;
}

export function mapLeadStatus(status) {
  return {
    in_progress: "accepted",
    quoted: "proposal_sent",
    ordered: "sourcing_china",
    won: "completed",
    lost: "canceled",
    spam: "canceled",
  }[status] || "new";
}

export function costTotal(row) {
  return (
    number(row.purchase_cost_uah) +
    number(row.delivery_cost_uah) +
    number(row.customs_cost_uah) +
    number(row.processing_cost_uah) +
    number(row.ad_cost_uah) +
    number(row.other_cost_uah)
  );
}

export function grossProfit(row) {
  return number(row.revenue_uah) - costTotal(row);
}

export function normalizeTelegram(value) {
  const cleaned = text(value).replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
  return cleaned ? `@${cleaned}` : "";
}

export function managerContactForType(type) {
  return text(type).toLowerCase() === "byd" ? "@evline_tech" : "@evline_support";
}

export function managerChatIdForType(env, type) {
  if (text(type).toLowerCase() === "byd") {
    return text(env.TELEGRAM_TECH_CHAT_ID || env.TELEGRAM_CHAT_ID);
  }
  return text(env.TELEGRAM_PARTS_CHAT_ID || env.TELEGRAM_CHAT_ID);
}

function orderRequestText(data) {
  const item = text(data.item_name || data.part);
  const details = text(data.request_text || data.details || data.message);
  return [item ? `Запчастина/послуга: ${item}` : "", details].filter(Boolean).join("\n");
}

function publicNumber(prefix, value) {
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? `${prefix}-${String(parsed).padStart(6, "0")}` : "";
}

export async function tableHasColumn(env, table, column) {
  try {
    const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    return (rows.results || []).some((row) => row.name === column);
  } catch {
    return false;
  }
}

async function tableColumnSet(env, table) {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((rows.results || []).map((row) => row.name));
}

async function insertKnownFields(env, table, fields) {
  const columns = await tableColumnSet(env, table);
  const available = fields.filter(([name]) => columns.has(name));
  await env.DB.prepare(
    `INSERT INTO ${table} (${available.map(([name]) => name).join(", ")})
    VALUES (${available.map(() => "?").join(", ")})`
  )
    .bind(...available.map(([, value]) => value))
    .run();
}

export async function nextPublicNumber(env, scope, prefix) {
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO crm_counters (scope, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(scope) DO NOTHING"
    )
      .bind(scope, 0, now)
      .run();
    try {
      const row = await env.DB.prepare(
        "UPDATE crm_counters SET value = value + 1, updated_at = ? WHERE scope = ? RETURNING value"
      )
        .bind(now, scope)
        .first();
      return publicNumber(prefix, row?.value);
    } catch {
      await env.DB.prepare("UPDATE crm_counters SET value = value + 1, updated_at = ? WHERE scope = ?")
        .bind(now, scope)
        .run();
      const row = await env.DB.prepare("SELECT value FROM crm_counters WHERE scope = ?").bind(scope).first();
      return publicNumber(prefix, row?.value);
    }
  } catch (error) {
    if (/no such table|no such column/i.test(error.message || String(error))) return "";
    throw error;
  }
}

export async function upsertCustomer(env, data) {
  const now = new Date().toISOString();
  const phone = text(data.phone || data.customer_phone);
  const email = text(data.email || data.customer_email);
  const telegram = normalizeTelegram(data.telegram || data.customer_telegram || data.telegram_username);

  const existing = await env.DB.prepare(
    `SELECT * FROM customers
    WHERE (? <> '' AND phone = ?)
      OR (? <> '' AND email = ?)
      OR (? <> '' AND telegram_username = ?)
    LIMIT 1`
  )
    .bind(phone, phone, email, email, telegram, telegram)
    .first();

  if (existing) {
    const customerNumber = existing.customer_number ? "" : await nextPublicNumber(env, "customer", "C");
    try {
      await env.DB.prepare(
        `UPDATE customers SET
          updated_at = ?,
          customer_number = COALESCE(NULLIF(customer_number, ''), NULLIF(?, ''), customer_number),
          name = COALESCE(NULLIF(?, ''), name),
          phone = COALESCE(NULLIF(?, ''), phone),
          email = COALESCE(NULLIF(?, ''), email),
          telegram_username = COALESCE(NULLIF(?, ''), telegram_username)
        WHERE id = ?`
      )
        .bind(now, customerNumber, text(data.name || data.customer_name), phone, email, telegram, existing.id)
        .run();
    } catch (error) {
      if (!/customer_number|no such column/i.test(error.message || String(error))) throw error;
      await env.DB.prepare(
        `UPDATE customers SET
          updated_at = ?,
          name = COALESCE(NULLIF(?, ''), name),
          phone = COALESCE(NULLIF(?, ''), phone),
          email = COALESCE(NULLIF(?, ''), email),
          telegram_username = COALESCE(NULLIF(?, ''), telegram_username)
        WHERE id = ?`
      )
        .bind(now, text(data.name || data.customer_name), phone, email, telegram, existing.id)
        .run();
    }
    return existing.id;
  }

  const id = crypto.randomUUID();
  const customerNumber = await nextPublicNumber(env, "customer", "C");
  try {
    await env.DB.prepare(
      `INSERT INTO customers (
        id, customer_number, created_at, updated_at, name, phone, email, telegram_username, preferred_channel
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, customerNumber, now, now, text(data.name || data.customer_name), phone, email, telegram, "telegram")
      .run();
  } catch (error) {
    if (!/customer_number|no such column/i.test(error.message || String(error))) throw error;
    await env.DB.prepare(
      `INSERT INTO customers (
        id, created_at, updated_at, name, phone, email, telegram_username, preferred_channel
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, now, now, text(data.name || data.customer_name), phone, email, telegram, "telegram")
      .run();
  }
  return id;
}

export async function createOrderFromLead(env, lead) {
  const customerId = await upsertCustomer(env, lead);
  const now = lead.created_at || new Date().toISOString();
  const orderId = crypto.randomUUID();
  const orderNumber = await nextPublicNumber(env, "order", "O");
  const itemName = text(lead.part || lead.item_name);
  const serviceName = lead.type === "byd" ? "Програмування BYD" : "";

  await insertKnownFields(env, "orders", [
    ["id", orderId],
    ["order_number", orderNumber],
    ["created_at", now],
    ["updated_at", now],
    ["lead_id", lead.id],
    ["customer_id", customerId],
    ["type", lead.type || "parts"],
    ["status", "new"],
    ["manager_contact", managerContactForType(lead.type)],
    ["customer_name", text(lead.name)],
    ["customer_phone", text(lead.phone)],
    ["customer_email", text(lead.email)],
    ["customer_telegram", normalizeTelegram(lead.telegram)],
    ["car", text(lead.car)],
    ["vin", text(lead.vin).toUpperCase()],
    ["item_name", itemName],
    ["service_name", serviceName],
    ["request_text", orderRequestText(lead)],
    ["source", text(lead.source)],
    ["medium", text(lead.medium)],
    ["campaign", text(lead.campaign)],
    ["term", text(lead.term)],
    ["content", text(lead.content)],
    ["gclid", text(lead.gclid)],
    ["gbraid", text(lead.gbraid)],
    ["wbraid", text(lead.wbraid)],
    ["fbclid", text(lead.fbclid)],
    ["landing_page", text(lead.landing_page)],
    ["referrer", text(lead.referrer)],
    ["page_url", text(lead.page_url)],
    ["form_id", text(lead.form_id)],
    ["form_name", text(lead.form_name)],
    ["submitted_at", text(lead.submitted_at)],
    ["tracking_captured_at", text(lead.tracking_captured_at)],
    ["attribution_type", text(lead.attribution_type)],
  ]);

  await insertStatusEvent(env, {
    order_id: orderId,
    status: "new",
    actor: "site",
    comment: "Заявка створена на сайті",
  });

  await queueGoogleAdsConversionsForOrder(env, { ...lead, id: orderId, lead_id: lead.id, status: "new" }, ["lead"]);

  return orderId;
}

export async function insertStatusEvent(env, event) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO order_status_events (
      id, created_at, order_id, previous_status, status, actor, comment, notify_customer, notification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      now,
      event.order_id,
      event.previous_status || "",
      event.status,
      event.actor || "manager",
      text(event.comment),
      event.notify_customer ? 1 : 0,
      event.notification_status || "not_queued"
    )
    .run();
  return id;
}

export async function loadOrder(env, id) {
  const hasCustomerNumber = await tableHasColumn(env, "customers", "customer_number");
  const hasLeadNumber = await tableHasColumn(env, "leads", "lead_number");
  return env.DB.prepare(
    `SELECT
      orders.*,
      ${hasCustomerNumber ? "customers.customer_number" : "NULL"} AS customer_number,
      ${hasLeadNumber ? "leads.lead_number" : "NULL"} AS lead_number,
      customers.telegram_chat_id AS customer_telegram_chat_id,
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
    WHERE orders.id = ?`
  )
    .bind(id)
    .first();
}

async function templateForStatus(env, status) {
  const key = STATUS_TEMPLATE_KEYS[status] || "order_new";
  const template = await env.DB.prepare("SELECT * FROM message_templates WHERE template_key = ?").bind(key).first();
  return template || { template_key: key, body: ORDER_STATUS_LABELS[status] || "Оновлення статусу замовлення" };
}

async function telegramSendMessage(env, chatId, body) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: body,
      disable_web_page_preview: true,
    }),
  });
  const data = await response.json().catch(() => ({}));
  return {
    ...data,
    http_ok: response.ok,
    requested_chat_id: String(chatId),
  };
}

export async function sendTelegramMessageDetailed(env, chatId, body) {
  let data = await telegramSendMessage(env, chatId, body);
  let effectiveChatId = String(chatId);
  let migratedFromChatId = "";

  if ((!data.http_ok || !data.ok) && data.parameters?.migrate_to_chat_id) {
    migratedFromChatId = String(chatId);
    effectiveChatId = String(data.parameters.migrate_to_chat_id);
    data = await telegramSendMessage(env, effectiveChatId, body);
  }

  if (!data.http_ok || !data.ok) {
    const error = new Error(data.description || "Telegram sendMessage failed");
    if (data.parameters?.migrate_to_chat_id) {
      error.migrate_to_chat_id = String(data.parameters.migrate_to_chat_id);
    }
    throw error;
  }

  return {
    chat_id: effectiveChatId,
    message_id: String(data.result?.message_id || ""),
    migrated_from_chat_id: migratedFromChatId,
  };
}

export async function sendTelegramMessage(env, chatId, body) {
  const result = await sendTelegramMessageDetailed(env, chatId, body);
  return result.message_id;
}

export function buildManagerOrderMessage(order, origin = "https://evline.com.ua", prefix = "") {
  const lines = [
    prefix,
    order.type === "byd" ? "Нова заявка EVLine: програмування BYD" : "Нова заявка EVLine: запчастини",
    `Замовлення CRM: ${order.order_number || order.id || "-"}`,
    ...(order.customer_number ? [`Клієнт CRM: ${order.customer_number}`] : []),
    ...(order.lead_number ? [`Лід CRM: ${order.lead_number}`] : []),
    `Менеджер: ${text(order.manager_contact) || managerContactForType(order.type)}`,
    `Тип: ${order.type || "parts"}`,
    `Ім'я: ${order.customer_name || "-"}`,
    `Телефон: ${order.customer_phone || "-"}`,
    `Telegram: ${order.customer_telegram || "-"}`,
    `Авто: ${order.car || "-"}`,
    `VIN: ${order.vin || "-"}`,
    ...(order.item_name ? [`Запчастина: ${order.item_name}`] : []),
    ...(order.service_name ? [`Послуга: ${order.service_name}`] : []),
    `Джерело: ${order.source || "-"} / ${order.campaign || "-"}`,
    `Атрибуція: ${order.attribution_type || "-"}${order.gclid ? " / gclid" : order.gbraid ? " / gbraid" : order.wbraid ? " / wbraid" : ""}`,
    ...(order.form_name || order.form_id ? [`Форма: ${order.form_name || order.form_id}`] : []),
    `Запит: ${order.request_text || "-"}`,
    `Адмінка: ${origin}/admin/`,
  ];
  return lines.filter(Boolean).join("\n");
}

export async function sendManagerOrderNotification(env, order, { origin = "https://evline.com.ua", prefix = "" } = {}) {
  const managerChatId = managerChatIdForType(env, order.type);
  if (!managerChatId) throw new Error("Manager Telegram chat ID is not configured");
  const body = buildManagerOrderMessage(order, origin, prefix);
  const telegramMessageId = await sendTelegramMessage(env, managerChatId, body);
  return { ok: true, chat_id: managerChatId, telegram_message_id: telegramMessageId };
}

export async function notifyManagerTrackingUpdate(env, { order, latest, previousStatus, nextStatus, tracking, customerNotification, isFirstSync = false }) {
  const managerChatId = managerChatIdForType(env, order.type);
  if (!managerChatId || !latest) return { ok: false, skipped: !managerChatId ? "no_manager_chat" : "no_event" };

  const customerLine = (() => {
    if (!customerNotification) return "Клієнта не повідомлено (подію без сповіщення)";
    if (customerNotification.status === "sent") return "Клієнта повідомлено в Telegram ✓";
    if (customerNotification.status === "skipped") return `Клієнта НЕ повідомлено: ${customerNotification.error || "Telegram не прив'язаний"}`;
    if (customerNotification.status === "failed") return `Помилка надсилання клієнту: ${customerNotification.error || "невідома"}`;
    return `Сповіщення клієнту: ${customerNotification.status}`;
  })();

  const lines = [
    isFirstSync ? "📦 Трек підключено · Meest China" : "📦 Оновлення треку · Meest China",
    `Замовлення: ${order.order_number || order.id || "-"}`,
    `Клієнт: ${order.customer_name || "-"} · ${order.customer_phone || order.customer_telegram || "-"}`,
    ...(order.item_name ? [`Запчастина: ${order.item_name}`] : []),
    ...(order.car ? [`Авто: ${order.car}`] : []),
    `Статус: ${latest.status_text}${latest.location ? ` (${latest.location})` : ""}`,
    ...(latest.occurred_at ? [`Дата події: ${new Date(latest.occurred_at).toLocaleString("uk-UA")}`] : []),
    ...(previousStatus && nextStatus && previousStatus !== nextStatus
      ? [`Статус CRM: ${ORDER_STATUS_LABELS[previousStatus] || previousStatus} → ${ORDER_STATUS_LABELS[nextStatus] || nextStatus}`]
      : []),
    `Трек: ${tracking?.tracking_number || order.tracking_number || "-"}`,
    ...(tracking?.estimated_delivery_at
      ? [`Орієнтовна доставка: ${new Date(tracking.estimated_delivery_at).toLocaleDateString("uk-UA")}`]
      : []),
    customerLine,
    "Адмінка: https://evline.com.ua/admin/",
  ];

  try {
    const telegramMessageId = await sendTelegramMessage(env, managerChatId, lines.filter(Boolean).join("\n"));
    return { ok: true, chat_id: managerChatId, telegram_message_id: telegramMessageId };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

export async function buildCustomerMessage(env, order, status, customMessage = "") {
  const manual = text(customMessage);
  if (manual) return manual;

  const template = await templateForStatus(env, status);
  const lines = [template.body];
  const item = text(order.item_name || order.service_name);
  if (item) lines.push(`Замовлення: ${item}`);
  if (order.car) lines.push(`Авто: ${order.car}`);
  if (order.tracking_number) {
    lines.push(`Трек-номер: ${order.tracking_number}`);
    if (order.tracking_url) lines.push(`Посилання: ${order.tracking_url}`);
  }
  lines.push(`Менеджер EVLine: ${text(order.manager_contact) || managerContactForType(order.type)}`);
  return lines.join("\n");
}

export async function queueOrderNotification(env, { order, eventId, status, message }) {
  const now = new Date().toISOString();
  const notificationId = crypto.randomUUID();
  const templateKey = STATUS_TEMPLATE_KEYS[status] || "order_new";
  const recipientChatId = text(order.telegram_chat_id || order.customer_telegram_chat_id);
  const recipientContact = text(order.customer_telegram || order.customer_phone || order.customer_email);
  const body = text(message) || (await buildCustomerMessage(env, order, status));
  let queueStatus = recipientChatId ? "pending" : "skipped";
  let attempts = 0;
  let sentAt = "";
  let telegramMessageId = "";
  let error = recipientChatId ? "" : "Telegram chat_id клієнта ще не прив'язаний";

  if (recipientChatId && env.TELEGRAM_BOT_TOKEN) {
    attempts = 1;
    try {
      telegramMessageId = await sendTelegramMessage(env, recipientChatId, body);
      queueStatus = "sent";
      sentAt = now;
    } catch (sendError) {
      queueStatus = "failed";
      error = sendError.message || String(sendError);
    }
  }

  await env.DB.prepare(
    `INSERT INTO notification_queue (
      id, created_at, updated_at, order_id, event_id, channel, recipient_chat_id, recipient_contact,
      template_key, message, status, attempts, sent_at, telegram_message_id, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      notificationId,
      now,
      now,
      order.id,
      eventId,
      "telegram",
      recipientChatId,
      recipientContact,
      templateKey,
      body,
      queueStatus,
      attempts,
      sentAt,
      telegramMessageId,
      error
    )
    .run();

  await env.DB.prepare("UPDATE order_status_events SET notification_status = ? WHERE id = ?")
    .bind(queueStatus, eventId)
    .run();

  return { id: notificationId, status: queueStatus, error };
}

export async function retryOrderNotification(env, notificationId) {
  const notification = await env.DB.prepare("SELECT * FROM notification_queue WHERE id = ?")
    .bind(notificationId)
    .first();
  if (!notification) return { ok: false, status: "not_found", error: "Notification not found" };

  const order = await loadOrder(env, notification.order_id);
  if (!order) return { ok: false, status: "order_not_found", error: "Order not found" };

  const now = new Date().toISOString();
  const recipientChatId = text(notification.recipient_chat_id || order.telegram_chat_id || order.customer_telegram_chat_id);
  const recipientContact = text(notification.recipient_contact || order.customer_telegram || order.customer_phone || order.customer_email);
  const attempts = number(notification.attempts) + 1;
  let status = "pending";
  let sentAt = "";
  let telegramMessageId = "";
  let error = "";

  if (!recipientChatId) {
    status = "skipped";
    error = "Telegram chat_id клієнта ще не прив'язаний";
  } else {
    try {
      telegramMessageId = await sendTelegramMessage(env, recipientChatId, notification.message);
      status = "sent";
      sentAt = now;
    } catch (sendError) {
      status = "failed";
      error = sendError.message || String(sendError);
    }
  }

  await env.DB.prepare(
    `UPDATE notification_queue SET
      updated_at = ?,
      recipient_chat_id = ?,
      recipient_contact = ?,
      status = ?,
      attempts = ?,
      sent_at = COALESCE(NULLIF(?, ''), sent_at),
      telegram_message_id = COALESCE(NULLIF(?, ''), telegram_message_id),
      error = ?
    WHERE id = ?`
  )
    .bind(now, recipientChatId, recipientContact, status, attempts, sentAt, telegramMessageId, error, notificationId)
    .run();

  if (notification.event_id) {
    await env.DB.prepare("UPDATE order_status_events SET notification_status = ? WHERE id = ?")
      .bind(status, notification.event_id)
      .run();
  }

  return { ok: status === "sent", id: notificationId, status, error };
}

export async function retryLatestOrderNotification(env, orderId) {
  const notification = await env.DB.prepare(
    `SELECT * FROM notification_queue
    WHERE order_id = ? AND status IN ('pending', 'failed', 'skipped')
    ORDER BY created_at DESC
    LIMIT 1`
  )
    .bind(orderId)
    .first();

  if (!notification) return { ok: true, status: "nothing_to_retry" };
  return retryOrderNotification(env, notification.id);
}
