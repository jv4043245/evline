import { number, text } from "./http.js";

export const ORDER_STATUS_LABELS = {
  new: "Нова заявка",
  accepted: "Прийнято в роботу",
  proposal_sent: "Пропозицію відправлено",
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
    return existing.id;
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO customers (
      id, created_at, updated_at, name, phone, email, telegram_username, preferred_channel
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, now, now, text(data.name || data.customer_name), phone, email, telegram, "telegram")
    .run();
  return id;
}

export async function createOrderFromLead(env, lead) {
  const customerId = await upsertCustomer(env, lead);
  const now = lead.created_at || new Date().toISOString();
  const orderId = crypto.randomUUID();
  const itemName = text(lead.part || lead.item_name);
  const serviceName = lead.type === "byd" ? "Програмування BYD" : "";

  await env.DB.prepare(
    `INSERT INTO orders (
      id, created_at, updated_at, lead_id, customer_id, type, status, manager_contact,
      customer_name, customer_phone, customer_email, customer_telegram, car, vin, item_name,
      service_name, request_text, source, medium, campaign, term, content, gclid, fbclid,
      landing_page, referrer
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      orderId,
      now,
      now,
      lead.id,
      customerId,
      lead.type || "parts",
      "new",
      managerContactForType(lead.type),
      text(lead.name),
      text(lead.phone),
      text(lead.email),
      normalizeTelegram(lead.telegram),
      text(lead.car),
      text(lead.vin).toUpperCase(),
      itemName,
      serviceName,
      orderRequestText(lead),
      text(lead.source),
      text(lead.medium),
      text(lead.campaign),
      text(lead.term),
      text(lead.content),
      text(lead.gclid),
      text(lead.fbclid),
      text(lead.landing_page),
      text(lead.referrer)
    )
    .run();

  await insertStatusEvent(env, {
    order_id: orderId,
    status: "new",
    actor: "site",
    comment: "Заявка створена на сайті",
  });

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
  return env.DB.prepare(
    `SELECT
      orders.*,
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

async function sendTelegramMessage(env, chatId, body) {
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
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || "Telegram sendMessage failed");
  return String(data.result?.message_id || "");
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
