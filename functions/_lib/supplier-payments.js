import { number, text } from "./http.js";
import { loadOrder, nextPublicNumber, sendTelegramMessage } from "./crm.js";

export const SUPPLIER_PAYMENT_STATUS_LABELS = {
  requested: "Очікує оплати",
  needs_review: "Потрібна перевірка",
  paid: "Оплачено",
  canceled: "Скасовано",
};

function normalizeCurrency(value, fallback = "CNY") {
  const currency = text(value).toUpperCase();
  return currency || fallback;
}

function paymentChatId(env) {
  return text(env.TELEGRAM_PAYMENTS_CHAT_ID || env.TELEGRAM_PARTS_CHAT_ID || env.TELEGRAM_CHAT_ID);
}

function publicPaymentNumber(value) {
  return text(value) || "без номера";
}

function formatAmount(amount, currency = "CNY") {
  const value = number(amount);
  const formatted = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: value % 1 ? 2 : 0,
  }).format(value);
  return `${formatted} ${normalizeCurrency(currency)}`;
}

function buildPaymentRequestMessage(order, payment) {
  const lines = [
    "💳 Оплата постачальнику EVLine",
    `Оплата: ${publicPaymentNumber(payment.payment_number)}`,
    `Замовлення: ${order.order_number || order.id || "-"}`,
    payment.supplier_name ? `Постачальник: ${payment.supplier_name}` : "",
    `Сума до оплати: ${formatAmount(payment.requested_amount, payment.requested_currency)}`,
    "",
    `Клієнт: ${order.customer_name || "-"} · ${order.customer_phone || order.customer_telegram || "-"}`,
    order.car ? `Авто: ${order.car}` : "",
    order.vin ? `VIN: ${order.vin}` : "",
    order.item_name ? `Запчастина: ${order.item_name}` : order.service_name ? `Послуга: ${order.service_name}` : "",
    payment.notes ? `Коментар: ${payment.notes}` : "",
    "",
    "Після оплати надішліть скрин відповіддю на це повідомлення.",
    "Якщо в підписі до скрина буде сума з комісією, CRM внесе її автоматично.",
    "Адмінка: https://evline.com.ua/admin/",
  ];
  return lines.filter(Boolean).join("\n");
}

export async function listSupplierPayments(env, orderId) {
  try {
    const rows = await env.DB.prepare(
      `SELECT *
      FROM supplier_payments
      WHERE order_id = ?
      ORDER BY created_at DESC`
    )
      .bind(orderId)
      .all();
    return rows.results || [];
  } catch (error) {
    if (/no such table/i.test(error.message || String(error))) return [];
    throw error;
  }
}

export async function createSupplierPaymentRequest(env, orderId, payload = {}) {
  const order = await loadOrder(env, orderId);
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }

  const requestedAmount = number(payload.requested_amount);
  if (requestedAmount <= 0) {
    const error = new Error("requested_amount is required");
    error.status = 400;
    throw error;
  }

  const chatId = paymentChatId(env);
  if (!chatId) {
    const error = new Error("TELEGRAM_PAYMENTS_CHAT_ID is not configured");
    error.status = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const payment = {
    id: crypto.randomUUID(),
    payment_number: await nextPublicNumber(env, "supplier_payment", "P"),
    created_at: now,
    updated_at: now,
    order_id: orderId,
    status: "requested",
    supplier_name: text(payload.supplier_name),
    requested_amount: requestedAmount,
    requested_currency: normalizeCurrency(payload.requested_currency),
    paid_currency: normalizeCurrency(payload.requested_currency),
    notes: text(payload.notes),
    requested_at: now,
  };
  payment.request_text = buildPaymentRequestMessage(order, payment);

  try {
    await env.DB.prepare("SELECT id FROM supplier_payments LIMIT 1").first();
  } catch (error) {
    if (/no such table/i.test(error.message || String(error))) {
      const migrationError = new Error("D1 migration 0009_supplier_payments.sql is required");
      migrationError.status = 409;
      throw migrationError;
    }
    throw error;
  }

  const telegramMessageId = await sendTelegramMessage(env, chatId, payment.request_text);

  await env.DB.prepare(
    `INSERT INTO supplier_payments (
      id, payment_number, created_at, updated_at, order_id, status, supplier_name,
      requested_amount, requested_currency, paid_currency, request_chat_id,
      request_message_id, request_text, notes, requested_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      payment.id,
      payment.payment_number,
      payment.created_at,
      payment.updated_at,
      payment.order_id,
      payment.status,
      payment.supplier_name,
      payment.requested_amount,
      payment.requested_currency,
      payment.paid_currency,
      chatId,
      telegramMessageId,
      payment.request_text,
      payment.notes,
      payment.requested_at
    )
    .run();

  return {
    ...payment,
    request_chat_id: chatId,
    request_message_id: telegramMessageId,
  };
}

export async function updateSupplierPayment(env, paymentId, payload = {}) {
  const current = await env.DB.prepare("SELECT * FROM supplier_payments WHERE id = ?").bind(paymentId).first();
  if (!current) {
    const error = new Error("Supplier payment not found");
    error.status = 404;
    throw error;
  }

  const now = new Date().toISOString();
  const status = text(payload.status || current.status) || "requested";
  const paidAmount = number(payload.paid_amount ?? current.paid_amount);
  const paidCurrency = normalizeCurrency(payload.paid_currency ?? current.paid_currency ?? current.requested_currency);
  const requestedAmount = number(current.requested_amount);
  const commissionAmount = paidAmount > 0 && paidCurrency === normalizeCurrency(current.requested_currency)
    ? Math.max(0, paidAmount - requestedAmount)
    : number(payload.commission_amount ?? current.commission_amount);
  const commissionPercent = requestedAmount > 0 && commissionAmount > 0
    ? (commissionAmount / requestedAmount) * 100
    : number(payload.commission_percent ?? current.commission_percent);
  const paidAt = status === "paid" && !current.paid_at ? now : text(payload.paid_at ?? current.paid_at);

  await env.DB.prepare(
    `UPDATE supplier_payments SET
      updated_at = ?,
      status = ?,
      supplier_name = ?,
      requested_amount = ?,
      requested_currency = ?,
      paid_amount = ?,
      paid_currency = ?,
      commission_amount = ?,
      commission_percent = ?,
      notes = ?,
      paid_at = COALESCE(NULLIF(?, ''), paid_at)
    WHERE id = ?`
  )
    .bind(
      now,
      status,
      text(payload.supplier_name ?? current.supplier_name),
      number(payload.requested_amount ?? current.requested_amount),
      normalizeCurrency(payload.requested_currency ?? current.requested_currency),
      paidAmount,
      paidCurrency,
      commissionAmount,
      commissionPercent,
      text(payload.notes ?? current.notes),
      paidAt,
      paymentId
    )
    .run();

  return env.DB.prepare("SELECT * FROM supplier_payments WHERE id = ?").bind(paymentId).first();
}

function telegramFileId(message = {}) {
  const photos = Array.isArray(message.photo) ? message.photo : [];
  if (photos.length) return text(photos[photos.length - 1]?.file_id);
  return text(message.document?.file_id || message.photo?.file_id);
}

export function parsePaymentAmount(value) {
  const input = text(value).replace(/\s+/g, " ");
  if (!input) return { amount: 0, currency: "CNY" };
  const currency = /(?:cny|rmb|yuan|юан|¥)/i.test(input) ? "CNY" : "CNY";
  const matches = [...input.matchAll(/(?:^|[^\d])(\d{2,7}(?:[.,]\d{1,2})?)(?:\s*(?:cny|rmb|yuan|юан(?:ів|ей|я)?|¥))?/gi)];
  const amounts = matches
    .map((match) => Number(String(match[1]).replace(",", ".")))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  return { amount: amounts[0] || 0, currency };
}

async function paymentByReply(env, chatId, replyMessageId) {
  if (!chatId || !replyMessageId) return null;
  return env.DB.prepare(
    `SELECT *
    FROM supplier_payments
    WHERE request_chat_id = ? AND request_message_id = ?
    ORDER BY created_at DESC
    LIMIT 1`
  )
    .bind(chatId, String(replyMessageId))
    .first();
}

async function paymentByAmount(env, chatId, paidAmount) {
  if (!chatId || paidAmount <= 0) return { payment: null, ambiguous: false };
  const minRequested = paidAmount * 0.9;
  const rows = await env.DB.prepare(
    `SELECT *
    FROM supplier_payments
    WHERE request_chat_id = ?
      AND status IN ('requested', 'needs_review')
      AND requested_amount > 0
      AND requested_amount <= ?
      AND requested_amount >= ?
      AND datetime(COALESCE(requested_at, created_at)) >= datetime('now', '-7 days')
    ORDER BY ABS(requested_amount - ?) ASC
    LIMIT 2`
  )
    .bind(chatId, paidAmount, minRequested, paidAmount)
    .all();
  const matches = rows.results || [];
  return { payment: matches[0] || null, ambiguous: matches.length > 1 };
}

async function attachPaymentReceipt(env, payment, {
  chatId,
  messageId,
  fileId,
  caption,
  paidAmount,
  paidCurrency,
  matchedBy,
  matchConfidence,
}) {
  const now = new Date().toISOString();
  const requestedAmount = number(payment.requested_amount);
  const currency = normalizeCurrency(paidCurrency || payment.requested_currency);
  const parsedPaid = number(paidAmount);
  const commissionAmount = parsedPaid > 0 && currency === normalizeCurrency(payment.requested_currency)
    ? Math.max(0, parsedPaid - requestedAmount)
    : 0;
  const commissionPercent = requestedAmount > 0 && commissionAmount > 0
    ? (commissionAmount / requestedAmount) * 100
    : 0;
  const nextStatus = parsedPaid > 0 ? "paid" : "needs_review";

  await env.DB.prepare(
    `UPDATE supplier_payments SET
      updated_at = ?,
      status = ?,
      paid_amount = CASE WHEN ? > 0 THEN ? ELSE paid_amount END,
      paid_currency = ?,
      commission_amount = CASE WHEN ? > 0 THEN ? ELSE commission_amount END,
      commission_percent = CASE WHEN ? > 0 THEN ? ELSE commission_percent END,
      receipt_chat_id = ?,
      receipt_message_id = ?,
      receipt_telegram_file_id = COALESCE(NULLIF(?, ''), receipt_telegram_file_id),
      receipt_caption = COALESCE(NULLIF(?, ''), receipt_caption),
      paid_at = CASE WHEN ? > 0 THEN ? ELSE paid_at END,
      matched_by = ?,
      match_confidence = ?
    WHERE id = ?`
  )
    .bind(
      now,
      nextStatus,
      parsedPaid,
      parsedPaid,
      currency,
      parsedPaid,
      commissionAmount,
      parsedPaid,
      commissionPercent,
      chatId,
      String(messageId || ""),
      fileId,
      caption,
      parsedPaid,
      now,
      matchedBy,
      matchConfidence,
      payment.id
    )
    .run();

  const updated = await env.DB.prepare("SELECT * FROM supplier_payments WHERE id = ?").bind(payment.id).first();
  const order = await loadOrder(env, payment.order_id).catch(() => null);
  return { payment: updated, order };
}

export async function handleSupplierPaymentTelegramUpdate(env, message = {}) {
  const chatId = text(message.chat?.id);
  const messageId = text(message.message_id);
  const caption = text(message.caption || message.text);
  const fileId = telegramFileId(message);
  const replyMessageId = text(message.reply_to_message?.message_id);
  if (!chatId || (!replyMessageId && !caption && !fileId)) return { handled: false };

  let payment = await paymentByReply(env, chatId, replyMessageId).catch((error) => {
    if (/no such table/i.test(error.message || String(error))) return null;
    throw error;
  });
  let matchedBy = payment ? "telegram_reply" : "";
  let matchConfidence = payment ? "high" : "";
  const parsed = parsePaymentAmount(caption);

  if (!payment && parsed.amount > 0) {
    const byAmount = await paymentByAmount(env, chatId, parsed.amount);
    if (byAmount.ambiguous) {
      return {
        handled: true,
        needsReply: true,
        message: "Знайшли кілька схожих оплат. Будь ласка, надішліть скрин відповіддю саме на повідомлення потрібної оплати.",
      };
    }
    payment = byAmount.payment;
    matchedBy = payment ? "amount_window" : "";
    matchConfidence = payment ? "medium" : "";
  }

  if (!payment) return { handled: false };

  const result = await attachPaymentReceipt(env, payment, {
    chatId,
    messageId,
    fileId,
    caption,
    paidAmount: parsed.amount,
    paidCurrency: parsed.currency,
    matchedBy,
    matchConfidence,
  });

  const orderNumber = result.order?.order_number || result.order?.id || payment.order_id;
  const lines = [
    parsed.amount > 0 ? "✅ Оплату постачальнику зафіксовано." : "🧾 Скрин оплати прив'язано, суму треба перевірити вручну.",
    `Оплата: ${payment.payment_number || payment.id}`,
    `Замовлення: ${orderNumber}`,
    parsed.amount > 0 ? `Сума зі скрина/підпису: ${formatAmount(parsed.amount, parsed.currency)}` : "",
    parsed.amount > 0 && result.payment?.commission_amount > 0
      ? `Комісія: ${formatAmount(result.payment.commission_amount, parsed.currency)} (${Number(result.payment.commission_percent || 0).toFixed(1)}%)`
      : "",
    "Адмінка: https://evline.com.ua/admin/",
  ];

  return {
    handled: true,
    payment: result.payment,
    order: result.order,
    message: lines.filter(Boolean).join("\n"),
  };
}
