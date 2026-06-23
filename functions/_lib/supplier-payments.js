import { number, text } from "./http.js";
import { loadOrder, nextPublicNumber, sendTelegramMessageDetailed } from "./crm.js";

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
    "CRM прив'яже скрин до цієї оплати та внесе підсумкову суму, якщо її вдасться розпізнати.",
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

  const telegramResult = await sendTelegramMessageDetailed(env, chatId, payment.request_text);

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
      telegramResult.chat_id,
      telegramResult.message_id,
      payment.request_text,
      payment.notes,
      payment.requested_at
    )
    .run();

  return {
    ...payment,
    request_chat_id: telegramResult.chat_id,
    request_message_id: telegramResult.message_id,
    migrated_from_chat_id: telegramResult.migrated_from_chat_id,
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

function aiText(value) {
  if (!value) return "";
  if (typeof value === "string") return text(value);
  if (typeof value.response === "string") return text(value.response);
  if (typeof value.text === "string") return text(value.text);
  if (typeof value.description === "string") return text(value.description);
  if (Array.isArray(value.result)) return text(value.result.map(aiText).filter(Boolean).join("\n"));
  return text(JSON.stringify(value));
}

async function downloadTelegramFile(env, fileId) {
  if (!env.TELEGRAM_BOT_TOKEN || !fileId) return null;

  const fileResponse = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const fileData = await fileResponse.json().catch(() => ({}));
  const filePath = text(fileData.result?.file_path);
  if (!fileResponse.ok || !fileData.ok || !filePath) return null;

  const imageResponse = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!imageResponse.ok) return null;

  return {
    bytes: new Uint8Array(await imageResponse.arrayBuffer()),
    content_type: text(imageResponse.headers.get("content-type")),
    file_path: filePath,
  };
}

async function recognizePaymentScreenshot(env, fileId) {
  if (!env.AI?.run || !fileId) return { text: "", source: "" };

  const image = await downloadTelegramFile(env, fileId);
  if (!image?.bytes?.length) return { text: "", source: "" };

  const result = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
    image: Array.from(image.bytes),
    max_tokens: 256,
    prompt: [
      "Read this Chinese payment confirmation screenshot.",
      "Extract only payment amounts and labels.",
      "Return plain text. Include total paid amount, supplier amount, commission amount, and currency if visible.",
      "Do not invent values. Prefer the large top amount as total paid.",
    ].join(" "),
  });

  return {
    text: aiText(result),
    source: "workers_ai",
  };
}

function paymentAmountCandidates(value) {
  const input = text(value).replace(/\s+/g, " ");
  if (!input) return [];

  const matches = [...input.matchAll(/([¥￥])?\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*(?:([¥￥])|(cny|rmb|yuan|юан(?:ів|ей|я)?))?/gi)];
  return matches
    .map((match) => {
      const rawNumber = String(match[2] || "");
      const numberOffset = String(match[0]).indexOf(rawNumber);
      const start = match.index + Math.max(0, numberOffset);
      const end = start + rawNumber.length;
      const before = input[start - 1] || "";
      const after = input[end] || "";
      const hasCurrency = Boolean(match[1] || match[3] || match[4]);
      const amount = Number(rawNumber.replace(",", "."));
      const context = input.slice(Math.max(0, start - 30), Math.min(input.length, end + 30)).toLowerCase();
      return { amount, hasCurrency, context, raw: match[0], before, after, rawNumber };
    })
    .filter((candidate) => {
      if (!Number.isFinite(candidate.amount) || candidate.amount <= 0) return false;
      if (candidate.before === ":" || candidate.after === ":") return false;
      if (!candidate.hasCurrency && /^0\d+$/.test(candidate.rawNumber)) return false;
      return true;
    });
}

export function parsePaymentAmount(value, { requestedAmount = 0 } = {}) {
  const candidates = paymentAmountCandidates(value);
  if (!candidates.length) return { amount: 0, currency: "CNY" };

  const withCurrency = candidates.filter((candidate) => candidate.hasCurrency);
  const pool = withCurrency.length ? withCurrency : candidates;
  const requested = number(requestedAmount);

  if (withCurrency.length) {
    const chosen = [...withCurrency].sort((a, b) => b.amount - a.amount)[0];
    return { amount: chosen?.amount || 0, currency: "CNY" };
  }

  if (requested > 0) {
    const plausibleWithCommission = pool
      .filter((candidate) => candidate.amount >= requested && candidate.amount <= requested * 1.2)
      .sort((a, b) => b.amount - a.amount);
    if (plausibleWithCommission.length) return { amount: plausibleWithCommission[0].amount, currency: "CNY" };

    const aboveRequested = pool
      .filter((candidate) => candidate.amount >= requested)
      .sort((a, b) => Math.abs(a.amount - requested) - Math.abs(b.amount - requested));
    if (aboveRequested.length) return { amount: aboveRequested[0].amount, currency: "CNY" };
  }

  const chosen = [...pool].sort((a, b) => b.amount - a.amount)[0];
  return { amount: chosen?.amount || 0, currency: "CNY" };
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
  const amountBelowRequest = parsedPaid > 0 && requestedAmount > 0 && parsedPaid < requestedAmount * 0.95;
  const nextStatus = parsedPaid > 0 && !amountBelowRequest ? "paid" : "needs_review";

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
  let parsed = parsePaymentAmount(caption);

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

  let receiptText = caption;
  let ocrResult = { text: "", source: "" };
  if (fileId && !receiptText) {
    ocrResult = await recognizePaymentScreenshot(env, fileId).catch((error) => ({
      text: "",
      source: "workers_ai_failed",
      error: error.message || String(error),
    }));
    receiptText = text(ocrResult.text);
  }

  parsed = parsePaymentAmount(receiptText, { requestedAmount: payment.requested_amount });

  const result = await attachPaymentReceipt(env, payment, {
    chatId,
    messageId,
    fileId,
    caption: receiptText,
    paidAmount: parsed.amount,
    paidCurrency: parsed.currency,
    matchedBy,
    matchConfidence,
  });

  const orderNumber = result.order?.order_number || result.order?.id || payment.order_id;
  const paymentStatus = text(result.payment?.status);
  const lines = [
    parsed.amount > 0 && paymentStatus === "paid"
      ? "✅ Оплату постачальнику зафіксовано."
      : parsed.amount > 0
        ? "✅ Суму знайдено, оплату зафіксовано."
        : "🧾 Скрин оплати прив'язано, суму треба внести вручну.",
    `Оплата: ${payment.payment_number || payment.id}`,
    `Замовлення: ${orderNumber}`,
    parsed.amount > 0 ? `Підсумкова сума: ${formatAmount(parsed.amount, parsed.currency)}` : "",
    ocrResult.source ? `Розпізнавання: ${ocrResult.source}` : "",
    "Адмінка: https://evline.com.ua/admin/",
  ];

  return {
    handled: true,
    payment: result.payment,
    order: result.order,
    message: lines.filter(Boolean).join("\n"),
  };
}
