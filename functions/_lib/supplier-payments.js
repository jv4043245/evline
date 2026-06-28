import { number, text } from "./http.js";
import {
  buildCustomerMessage,
  insertStatusEvent,
  loadOrder,
  nextPublicNumber,
  queueOrderNotification,
  sendTelegramMessageDetailed,
  tableHasColumn,
} from "./crm.js";
import { queueGoogleAdsConversionsForStatus } from "./google-ads.js";

const PAYMENT_OCR_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

export const SUPPLIER_PAYMENT_STATUS_LABELS = {
  requested: "Очікує оплати",
  partial: "Частково оплачено",
  needs_review: "Потрібна перевірка",
  paid: "Оплачено",
  canceled: "Скасовано",
};

const SUPPLIER_PAYMENT_QR_IMAGES = [
  {
    aliases: ["byd", "b y d", "біді", "бид", "bioid", "biod"],
    url: "https://evline.com.ua/assets/images/suppliers/byd-payment-qr.jpg",
    caption: "QR для оплати постачальнику BYD",
  },
  {
    aliases: ["zeekr", "ziker", "z e e k r", "зікр", "зікер", "зикр", "зикер"],
    url: "https://evline.com.ua/assets/images/suppliers/zeekr-payment-qr.jpg",
    caption: "QR для оплати постачальнику Zeekr",
  },
];

const ORDER_STATUS_RANK = {
  new: 0,
  accepted: 1,
  proposal_sent: 2,
  awaiting_payment: 3,
  paid: 4,
  sourcing_china: 5,
  china_warehouse: 6,
  left_china: 7,
  in_ukraine: 8,
  ready_for_pickup: 9,
  completed: 10,
  canceled: 10,
};

function normalizeCurrency(value, fallback = "CNY") {
  const currency = text(value).toUpperCase();
  return currency || fallback;
}

function supplierNameKey(value) {
  return text(value)
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function supplierPaymentQrImage(supplierName) {
  const key = supplierNameKey(supplierName);
  if (!key) return null;
  return SUPPLIER_PAYMENT_QR_IMAGES.find((item) =>
    item.aliases.some((alias) => key.includes(alias))
  ) || null;
}

function canAdvanceOrderStatus(currentStatus, targetStatus) {
  const current = text(currentStatus) || "new";
  const target = text(targetStatus);
  if (!target || current === "completed" || current === "canceled") return false;
  return (ORDER_STATUS_RANK[target] ?? -1) > (ORDER_STATUS_RANK[current] ?? -1);
}

function autoStatusDates(status, now) {
  return {
    paid: { paid_at: now },
    sourcing_china: { ordered_at: now },
    ready_for_pickup: { delivered_at: now },
    completed: { completed_at: now },
    canceled: { canceled_at: now },
  }[status] || {};
}

async function advanceOrderStatus(env, orderId, targetStatus, {
  actor = "system",
  comment = "",
  notifyCustomer = false,
  customerMessage = "",
} = {}) {
  const current = await loadOrder(env, orderId).catch(() => null);
  if (!current || !canAdvanceOrderStatus(current.status, targetStatus)) {
    return { advanced: false, order: current, event_id: "" };
  }

  const now = new Date().toISOString();
  const dates = autoStatusDates(targetStatus, now);
  await env.DB.prepare(
    `UPDATE orders SET
      updated_at = ?,
      status = ?,
      paid_at = COALESCE(NULLIF(?, ''), paid_at),
      ordered_at = COALESCE(NULLIF(?, ''), ordered_at),
      delivered_at = COALESCE(NULLIF(?, ''), delivered_at),
      completed_at = COALESCE(NULLIF(?, ''), completed_at),
      canceled_at = COALESCE(NULLIF(?, ''), canceled_at)
    WHERE id = ?`
  )
    .bind(
      now,
      targetStatus,
      text(dates.paid_at || ""),
      text(dates.ordered_at || ""),
      text(dates.delivered_at || ""),
      text(dates.completed_at || ""),
      text(dates.canceled_at || ""),
      orderId
    )
    .run();

  const updated = await loadOrder(env, orderId);
  await queueGoogleAdsConversionsForStatus(env, updated, targetStatus).catch((error) => {
    console.error("Failed to queue Google Ads conversion for auto status", error);
  });

  const shouldNotify = Boolean(notifyCustomer);
  const eventId = await insertStatusEvent(env, {
    order_id: orderId,
    previous_status: current.status,
    status: targetStatus,
    actor,
    comment,
    notify_customer: shouldNotify,
    notification_status: shouldNotify ? "queued" : "not_queued",
  });

  if (shouldNotify) {
    try {
      const message = customerMessage || await buildCustomerMessage(env, updated, targetStatus);
      await queueOrderNotification(env, {
        order: updated,
        eventId,
        status: targetStatus,
        message,
      });
    } catch (error) {
      console.error("Failed to queue customer notification for auto status", error);
    }
  }

  return { advanced: true, order: updated, event_id: eventId };
}

async function insertSupplierPayment(env, payment) {
  const fields = [
    ["id", payment.id],
    ["payment_number", payment.payment_number],
    ["created_at", payment.created_at],
    ["updated_at", payment.updated_at],
    ["order_id", payment.order_id],
    ["status", payment.status],
    ["supplier_name", payment.supplier_name],
    ["requested_amount", payment.requested_amount],
    ["requested_currency", payment.requested_currency],
    ["paid_currency", payment.paid_currency],
    ["request_chat_id", payment.request_chat_id],
    ["request_message_id", payment.request_message_id],
    ["request_text", payment.request_text],
    ["notes", payment.notes],
    ["requested_at", payment.requested_at],
  ];

  if (await tableHasColumn(env, "supplier_payments", "supplier_request_id")) {
    fields.push(["supplier_request_id", payment.supplier_request_id]);
  }
  if (await tableHasColumn(env, "supplier_payments", "supplier_quote_id")) {
    fields.push(["supplier_quote_id", payment.supplier_quote_id]);
  }

  await env.DB.prepare(
    `INSERT INTO supplier_payments (${fields.map(([name]) => name).join(", ")})
    VALUES (${fields.map(() => "?").join(", ")})`
  )
    .bind(...fields.map(([, value]) => value))
    .run();
}

function paymentChatId(env) {
  return text(env.TELEGRAM_PAYMENTS_CHAT_ID);
}

async function validateSupplierPaymentLinks(env, orderId, payment) {
  if (payment.supplier_request_id && await tableHasColumn(env, "supplier_requests", "id")) {
    const supplierRequest = await env.DB.prepare("SELECT id, order_id FROM supplier_requests WHERE id = ?")
      .bind(payment.supplier_request_id)
      .first();
    if (!supplierRequest || supplierRequest.order_id !== orderId) {
      const error = new Error("Supplier request does not belong to this order");
      error.status = 400;
      throw error;
    }
  }

  if (payment.supplier_quote_id && await tableHasColumn(env, "supplier_quotes", "id")) {
    const supplierQuote = await env.DB.prepare("SELECT id, supplier_request_id, order_id FROM supplier_quotes WHERE id = ?")
      .bind(payment.supplier_quote_id)
      .first();
    if (!supplierQuote || supplierQuote.order_id !== orderId) {
      const error = new Error("Supplier quote does not belong to this order");
      error.status = 400;
      throw error;
    }
    if (payment.supplier_request_id && supplierQuote.supplier_request_id !== payment.supplier_request_id) {
      const error = new Error("Supplier quote does not belong to this supplier request");
      error.status = 400;
      throw error;
    }
  }
}

async function telegramSendPhoto(env, chatId, photo, { caption = "", replyToMessageId = "" } = {}) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const payload = {
    chat_id: chatId,
    photo,
    caption,
  };
  if (replyToMessageId) {
    payload.reply_parameters = {
      message_id: Number(replyToMessageId),
      allow_sending_without_reply: true,
    };
  }

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  return {
    ...data,
    http_ok: response.ok,
    requested_chat_id: String(chatId),
  };
}

async function sendTelegramPhotoDetailed(env, chatId, photo, options = {}) {
  let data = await telegramSendPhoto(env, chatId, photo, options);
  let effectiveChatId = String(chatId);
  let migratedFromChatId = "";

  if ((!data.http_ok || !data.ok) && data.parameters?.migrate_to_chat_id) {
    migratedFromChatId = String(chatId);
    effectiveChatId = String(data.parameters.migrate_to_chat_id);
    data = await telegramSendPhoto(env, effectiveChatId, photo, options);
  }

  if (!data.http_ok || !data.ok) {
    const error = new Error(data.description || "Telegram sendPhoto failed");
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

function paymentAmountDelta(payment = {}, paidAmount = 0, paidCurrency = "CNY") {
  const requested = number(payment.requested_amount);
  const paid = number(paidAmount);
  const requestedCurrency = normalizeCurrency(payment.requested_currency);
  const currency = normalizeCurrency(paidCurrency || requestedCurrency);
  if (!requested || !paid || requestedCurrency !== currency) {
    return { amount: 0, currency, significant: false, state: "none" };
  }
  const amount = Math.round((paid - requested) * 100) / 100;
  return {
    amount,
    currency,
    significant: Math.abs(amount) > Math.max(5, requested * 0.05),
    state: amount > 0 ? "overpaid" : amount < 0 ? "underpaid" : "exact",
  };
}

function paymentAmountDeltaText(payment = {}, paidAmount = 0, paidCurrency = "CNY") {
  const delta = paymentAmountDelta(payment, paidAmount, paidCurrency);
  if (!delta.amount) return "";
  if (delta.state === "overpaid") {
    return delta.significant
      ? `Увага: оплачено більше рахунку на +${formatAmount(delta.amount, delta.currency)}`
      : `Різниця/комісія: +${formatAmount(delta.amount, delta.currency)}`;
  }
  return `Увага: оплачено менше рахунку на ${formatAmount(Math.abs(delta.amount), delta.currency)}`;
}

async function markSupplierRequestPaymentPaid(env, payment, now = new Date().toISOString()) {
  if (!payment?.supplier_request_id || !(await tableHasColumn(env, "supplier_requests", "payment_id"))) return;
  await env.DB.prepare(
    `UPDATE supplier_requests
    SET payment_id = ?,
      status = CASE WHEN status IN ('accepted', 'purchased') THEN 'purchased' ELSE status END,
      updated_at = ?
    WHERE id = ?`
  )
    .bind(payment.id, now, payment.supplier_request_id)
    .run();
}

async function supplierPaymentReceiptsReady(env) {
  try {
    await env.DB.prepare("SELECT id FROM supplier_payment_receipts LIMIT 1").first();
    return true;
  } catch (error) {
    if (/no such table/i.test(error.message || String(error))) return false;
    throw error;
  }
}

export async function listSupplierPaymentReceipts(env, paymentId) {
  if (!paymentId || !(await supplierPaymentReceiptsReady(env))) return [];
  const rows = await env.DB.prepare(
    `SELECT *
    FROM supplier_payment_receipts
    WHERE supplier_payment_id = ?
    ORDER BY created_at DESC`
  )
    .bind(paymentId)
    .all();
  return rows.results || [];
}

export async function hydrateSupplierPayment(env, payment) {
  if (!payment) return null;
  const receipts = await listSupplierPaymentReceipts(env, payment.id);
  const total = receipts.reduce((sum, receipt) => {
    const sameCurrency = normalizeCurrency(receipt.currency || payment.paid_currency || payment.requested_currency)
      === normalizeCurrency(payment.paid_currency || payment.requested_currency);
    return sameCurrency ? sum + number(receipt.amount) : sum;
  }, 0);
  return {
    ...payment,
    receipts,
    receipt_count: receipts.length,
    paid_amount: total > 0 ? Math.round(total * 100) / 100 : payment.paid_amount,
  };
}

async function insertSupplierPaymentReceipt(env, payment, payload = {}) {
  if (!(await supplierPaymentReceiptsReady(env))) return { inserted: false, available: false };
  const now = payload.created_at || new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO supplier_payment_receipts (
      id, created_at, supplier_payment_id, order_id, supplier_request_id, supplier_quote_id,
      amount, currency, chat_id, message_id, telegram_file_id, caption, matched_by,
      match_confidence, ocr_source, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      now,
      payment.id,
      payment.order_id,
      payment.supplier_request_id || "",
      payment.supplier_quote_id || "",
      number(payload.amount),
      normalizeCurrency(payload.currency || payment.requested_currency),
      text(payload.chat_id),
      text(payload.message_id),
      text(payload.telegram_file_id),
      text(payload.caption),
      text(payload.matched_by),
      text(payload.match_confidence),
      text(payload.ocr_source),
      text(payload.source || "telegram")
    )
    .run();
  return {
    inserted: Number(result?.meta?.changes || 0) > 0,
    available: true,
  };
}

async function supplierPaymentReceiptSummary(env, payment) {
  const receipts = await listSupplierPaymentReceipts(env, payment.id);
  const currency = normalizeCurrency(payment.paid_currency || payment.requested_currency);
  const paidAmount = receipts.reduce((sum, receipt) => (
    normalizeCurrency(receipt.currency) === currency ? sum + number(receipt.amount) : sum
  ), 0);
  const latestWithFile = receipts.find((receipt) => text(receipt.telegram_file_id));
  return {
    receipts,
    receipt_count: receipts.length,
    paid_amount: Math.round(paidAmount * 100) / 100,
    currency,
    latest_file_id: latestWithFile?.telegram_file_id || "",
  };
}

function buildPaymentRequestMessage(order, payment) {
  const lines = [
    "💳 Оплата постачальнику EVLine",
    `Оплата: ${publicPaymentNumber(payment.payment_number)}`,
    `Замовлення: ${order.order_number || order.id || "-"}`,
    payment.supplier_name ? `Постачальник: ${payment.supplier_name}` : "",
    `Сума: ${formatAmount(payment.requested_amount, payment.requested_currency)}`,
    "",
    order.car ? `Авто: ${order.car}` : "",
    order.vin ? `VIN: ${order.vin}` : "",
    "",
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
    const payments = [];
    for (const payment of rows.results || []) {
      payments.push(await hydrateSupplierPayment(env, payment));
    }
    return payments;
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
    supplier_request_id: text(payload.supplier_request_id),
    supplier_quote_id: text(payload.supplier_quote_id),
  };
  await validateSupplierPaymentLinks(env, orderId, payment);
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
  const qrImage = supplierPaymentQrImage(payment.supplier_name);
  const qrTelegramResult = qrImage
    ? await sendTelegramPhotoDetailed(env, telegramResult.chat_id, qrImage.url, {
      caption: qrImage.caption,
      replyToMessageId: telegramResult.message_id,
    }).catch((error) => ({
      error: error.message || String(error),
    }))
    : null;

  payment.request_chat_id = telegramResult.chat_id;
  payment.request_message_id = telegramResult.message_id;
  await insertSupplierPayment(env, payment);

  if (payment.supplier_request_id && await tableHasColumn(env, "supplier_requests", "payment_id")) {
    await env.DB.prepare("UPDATE supplier_requests SET payment_id = ?, updated_at = ? WHERE id = ?")
      .bind(payment.id, now, payment.supplier_request_id)
      .run();
  }

  const statusAdvance = await advanceOrderStatus(env, orderId, "awaiting_payment", {
    actor: "system",
    comment: `Сформовано запит на оплату постачальнику ${payment.supplier_name || "без назви"}: ${formatAmount(payment.requested_amount, payment.requested_currency)}`,
    notifyCustomer: false,
  });

  return {
    ...payment,
    request_chat_id: telegramResult.chat_id,
    request_message_id: telegramResult.message_id,
    migrated_from_chat_id: telegramResult.migrated_from_chat_id,
    qr_photo_sent: Boolean(qrTelegramResult?.message_id),
    qr_photo_message_id: qrTelegramResult?.message_id || "",
    qr_photo_error: qrTelegramResult?.error || "",
    order_status_advanced: statusAdvance.advanced,
    order_status_event_id: statusAdvance.event_id,
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

  const updated = await env.DB.prepare("SELECT * FROM supplier_payments WHERE id = ?").bind(paymentId).first();

  if (updated?.status === "paid") {
    await markSupplierRequestPaymentPaid(env, updated, now);
    await advanceOrderStatus(env, updated.order_id, "paid", {
      actor: "manager",
      comment: `Оплату постачальнику ${updated.supplier_name || "без назви"} позначено як оплачену в CRM${number(updated.paid_amount) > 0 ? `: ${formatAmount(updated.paid_amount, updated.paid_currency)}` : ""}`,
      notifyCustomer: false,
    });
  }

  return updated;
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

async function runPaymentOcrModel(env, image) {
  return env.AI.run(PAYMENT_OCR_MODEL, {
    image: Array.from(image.bytes),
    max_tokens: 256,
    prompt: [
      "Read this Chinese payment confirmation screenshot.",
      "Extract only payment amounts and labels.",
      "Return plain text. Include total paid amount, supplier amount, commission amount, and currency if visible.",
      "Do not invent values. Prefer the large top amount as total paid.",
    ].join(" "),
  });
}

async function acceptPaymentOcrModelLicense(env) {
  await env.AI.run(PAYMENT_OCR_MODEL, { prompt: "agree", max_tokens: 1 });
}

function shortOcrError(error) {
  return text(error?.message || error).replace(/\s+/g, " ").slice(0, 140);
}

async function recognizePaymentScreenshot(env, fileId) {
  if (!env.AI?.run || !fileId) return { text: "", source: "" };

  const image = await downloadTelegramFile(env, fileId);
  if (!image?.bytes?.length) return { text: "", source: "" };

  let result;
  try {
    result = await runPaymentOcrModel(env, image);
  } catch (error) {
    await acceptPaymentOcrModelLicense(env).catch(() => {});
    try {
      result = await runPaymentOcrModel(env, image);
    } catch (retryError) {
      throw new Error(`${shortOcrError(retryError)}; first attempt: ${shortOcrError(error)}`);
    }
  }

  return {
    text: aiText(result),
    source: "workers_ai",
  };
}

function parsePaymentNumber(rawNumber) {
  const raw = text(rawNumber);
  if (!raw) return 0;
  const compact = raw.replace(/\s+/g, "");
  const separators = compact.match(/[.,]/g) || [];
  if (!separators.length) return number(compact);

  if (separators.length === 1) {
    const [whole, fraction = ""] = compact.split(/[.,]/);
    if (fraction.length === 3 && whole.length <= 3) return number(`${whole}${fraction}`);
    if (fraction.length >= 1 && fraction.length <= 2) return number(`${whole}.${fraction}`);
    return number(`${whole}${fraction}`);
  }

  const lastSeparatorIndex = Math.max(compact.lastIndexOf("."), compact.lastIndexOf(","));
  const decimalTail = compact.slice(lastSeparatorIndex + 1);
  const hasDecimalTail = decimalTail.length >= 1 && decimalTail.length <= 2;
  if (hasDecimalTail) {
    const whole = compact.slice(0, lastSeparatorIndex).replace(/[.,]/g, "");
    return number(`${whole}.${decimalTail}`);
  }
  return number(compact.replace(/[.,]/g, ""));
}

function paymentAmountCandidates(value) {
  const input = text(value).replace(/\s+/g, " ");
  if (!input) return [];

  const matches = [...input.matchAll(/([¥￥])?\s*((?:\d{1,3}(?:[\s,.]\d{3})+(?:[.,]\d{1,2})?)|\d{1,7}(?:[.,]\d{1,2})?)\s*(?:(cny|rmb|yuan|юан(?:ів|ей|я)?))?/gi)];
  return matches
    .map((match) => {
      const rawNumber = String(match[2] || "");
      const numberOffset = String(match[0]).indexOf(rawNumber);
      const start = match.index + Math.max(0, numberOffset);
      const end = start + rawNumber.length;
      const before = input[start - 1] || "";
      const after = input[end] || "";
      const hasCurrency = Boolean(match[1] || match[3]);
      const amount = parsePaymentNumber(rawNumber);
      const context = input.slice(Math.max(0, start - 30), Math.min(input.length, end + 30)).toLowerCase();
      const beforeContext = input.slice(Math.max(0, start - 22), start).toLowerCase();
      const afterContext = input.slice(end, Math.min(input.length, end + 18)).toLowerCase();
      const hasPaymentContext = /оплач|сплач|paid|付款|支付|实付|фактич|actual/.test(`${beforeContext} ${afterContext}`);
      const hasInvoiceContext = /(?:рахунок|сч[её]т|invoice|request|заявк|замовл|заказ)\s*[:#№-]?\s*$/i.test(beforeContext.trim());
      const isDateFragment = !hasCurrency && /[-/]/.test(`${before}${after}`);
      return { amount, hasCurrency, context, raw: match[0], before, after, rawNumber, hasPaymentContext, hasInvoiceContext, isDateFragment };
    })
    .filter((candidate) => {
      if (!Number.isFinite(candidate.amount) || candidate.amount <= 0) return false;
      if (candidate.isDateFragment) return false;
      if ((candidate.before === ":" || candidate.after === ":") && !candidate.hasCurrency && !candidate.hasPaymentContext) return false;
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

  const paymentContextCandidates = candidates.filter((candidate) => candidate.hasPaymentContext && !candidate.hasInvoiceContext);
  if (paymentContextCandidates.length) {
    const aboveRequested = requested > 0
      ? paymentContextCandidates.filter((candidate) => candidate.amount >= requested * 0.95)
      : [];
    const targetPool = aboveRequested.length ? aboveRequested : paymentContextCandidates;
    const chosen = [...targetPool].sort((a, b) => b.amount - a.amount)[0];
    return { amount: chosen?.amount || 0, currency: "CNY" };
  }

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

async function paymentByReceiptReply(env, chatId, replyMessageId) {
  if (!chatId || !replyMessageId || !(await supplierPaymentReceiptsReady(env))) return null;
  return env.DB.prepare(
    `SELECT supplier_payments.*
    FROM supplier_payment_receipts
    INNER JOIN supplier_payments ON supplier_payments.id = supplier_payment_receipts.supplier_payment_id
    WHERE supplier_payment_receipts.chat_id = ? AND supplier_payment_receipts.message_id = ?
    ORDER BY supplier_payment_receipts.created_at DESC
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
      AND status IN ('requested', 'needs_review', 'partial')
      AND requested_amount > 0
      AND (
        (
          status = 'partial'
          AND CASE
            WHEN requested_amount - COALESCE(paid_amount, 0) > 0
            THEN requested_amount - COALESCE(paid_amount, 0)
            ELSE requested_amount
          END <= ?
          AND CASE
            WHEN requested_amount - COALESCE(paid_amount, 0) > 0
            THEN requested_amount - COALESCE(paid_amount, 0)
            ELSE requested_amount
          END >= ?
        )
        OR (
          status <> 'partial'
          AND requested_amount <= ?
          AND requested_amount >= ?
        )
      )
      AND datetime(COALESCE(requested_at, created_at)) >= datetime('now', '-7 days')
    ORDER BY CASE
      WHEN status = 'partial'
      THEN ABS((CASE
        WHEN requested_amount - COALESCE(paid_amount, 0) > 0
        THEN requested_amount - COALESCE(paid_amount, 0)
        ELSE requested_amount
      END) - ?)
      ELSE ABS(requested_amount - ?)
    END ASC
    LIMIT 2`
  )
    .bind(chatId, paidAmount, minRequested, paidAmount, minRequested, paidAmount, paidAmount)
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
  ocrSource,
}) {
  const now = new Date().toISOString();
  const requestedAmount = number(payment.requested_amount);
  const currency = normalizeCurrency(paidCurrency || payment.requested_currency);
  const parsedPaid = number(paidAmount);
  await insertSupplierPaymentReceipt(env, payment, {
    created_at: now,
    amount: parsedPaid,
    currency,
    chat_id: chatId,
    message_id: messageId,
    telegram_file_id: fileId,
    caption,
    matched_by: matchedBy,
    match_confidence: matchConfidence,
    ocr_source: ocrSource,
  });

  const receiptSummary = await supplierPaymentReceiptSummary(env, payment);
  const totalPaid = receiptSummary.receipt_count ? receiptSummary.paid_amount : parsedPaid;
  const totalCurrency = receiptSummary.currency || currency;
  const commissionAmount = totalPaid > 0 && totalCurrency === normalizeCurrency(payment.requested_currency)
    ? Math.max(0, totalPaid - requestedAmount)
    : 0;
  const commissionPercent = requestedAmount > 0 && commissionAmount > 0
    ? (commissionAmount / requestedAmount) * 100
    : 0;
  const trustedPaymentMatch = [
    "telegram_reply",
    "telegram_nested_reply",
    "telegram_receipt_reply",
    "telegram_receipt_nested_reply",
  ].includes(text(matchedBy));
  const amountCoversRequest = totalPaid > 0 && requestedAmount > 0 && totalPaid >= requestedAmount * 0.95;
  const nextStatus = totalPaid > 0 && trustedPaymentMatch
    ? (amountCoversRequest ? "paid" : "partial")
    : "needs_review";
  const latestFileId = fileId || receiptSummary.latest_file_id || "";

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
      paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END,
      matched_by = ?,
      match_confidence = ?
    WHERE id = ?`
  )
    .bind(
      now,
      nextStatus,
      totalPaid,
      totalPaid,
      totalCurrency,
      totalPaid,
      commissionAmount,
      totalPaid,
      commissionPercent,
      chatId,
      String(messageId || ""),
      latestFileId,
      caption,
      nextStatus,
      now,
      matchedBy,
      matchConfidence,
      payment.id
    )
    .run();

  const updated = await env.DB.prepare("SELECT * FROM supplier_payments WHERE id = ?").bind(payment.id).first();
  const hydrated = await hydrateSupplierPayment(env, updated);
  let order = await loadOrder(env, payment.order_id).catch(() => null);
  let statusAdvance = { advanced: false, event_id: "" };

  if (nextStatus === "paid") {
    await markSupplierRequestPaymentPaid(env, { ...payment, id: updated.id }, now);

    const deltaText = paymentAmountDeltaText(payment, totalPaid, totalCurrency);
    statusAdvance = await advanceOrderStatus(env, payment.order_id, "paid", {
      actor: "telegram",
      comment: [
        `Скрин оплати постачальнику ${payment.supplier_name || "без назви"} прив'язано`,
        parsedPaid > 0 ? `новий скрин ${formatAmount(parsedPaid, currency)}` : "",
        totalPaid > 0 ? `разом оплачено ${formatAmount(totalPaid, totalCurrency)}` : "",
        totalPaid > 0 ? `рахунок ${formatAmount(payment.requested_amount, payment.requested_currency)}` : "",
        deltaText,
      ].filter(Boolean).join("; "),
      notifyCustomer: false,
    });
    order = statusAdvance.order || order;
  }

  return {
    payment: hydrated || updated,
    order,
    paid_amount_delta: parsedPaid,
    paid_total_amount: totalPaid,
    paid_currency: totalCurrency,
    order_status_advanced: statusAdvance.advanced,
    order_status_event_id: statusAdvance.event_id,
  };
}

export async function handleSupplierPaymentTelegramUpdate(env, message = {}) {
  const chatId = text(message.chat?.id);
  const messageId = text(message.message_id);
  const caption = text(message.caption || message.text);
  const fileId = telegramFileId(message);
  const replyMessageId = text(message.reply_to_message?.message_id);
  const parentReplyMessageId = text(message.reply_to_message?.reply_to_message?.message_id);
  if (!chatId || (!replyMessageId && !parentReplyMessageId && !caption && !fileId)) return { handled: false };

  let payment = await paymentByReply(env, chatId, replyMessageId).catch((error) => {
    if (/no such table/i.test(error.message || String(error))) return null;
    throw error;
  });
  let matchedBy = payment ? "telegram_reply" : "";
  let matchConfidence = payment ? "high" : "";
  let parsed = parsePaymentAmount(caption);

  if (!payment && parentReplyMessageId) {
    payment = await paymentByReply(env, chatId, parentReplyMessageId).catch((error) => {
      if (/no such table/i.test(error.message || String(error))) return null;
      throw error;
    });
    matchedBy = payment ? "telegram_nested_reply" : "";
    matchConfidence = payment ? "high" : "";
  }

  if (!payment && replyMessageId) {
    payment = await paymentByReceiptReply(env, chatId, replyMessageId).catch((error) => {
      if (/no such table/i.test(error.message || String(error))) return null;
      throw error;
    });
    matchedBy = payment ? "telegram_receipt_reply" : "";
    matchConfidence = payment ? "high" : "";
  }

  if (!payment && parentReplyMessageId) {
    payment = await paymentByReceiptReply(env, chatId, parentReplyMessageId).catch((error) => {
      if (/no such table/i.test(error.message || String(error))) return null;
      throw error;
    });
    matchedBy = payment ? "telegram_receipt_nested_reply" : "";
    matchConfidence = payment ? "high" : "";
  }

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
    ocrSource: ocrResult.source,
  });

  const orderNumber = result.order?.order_number || result.order?.id || payment.order_id;
  const paymentStatus = text(result.payment?.status);
  const totalPaid = number(result.paid_total_amount || result.payment?.paid_amount);
  const deltaText = totalPaid > 0 ? paymentAmountDeltaText(payment, totalPaid, result.paid_currency || parsed.currency) : "";
  const remainingAmount = paymentStatus === "partial"
    ? Math.max(0, number(payment.requested_amount) - totalPaid)
    : 0;
  const lines = [
    parsed.amount > 0 && paymentStatus === "paid"
      ? "✅ Оплату постачальнику зафіксовано."
      : paymentStatus === "partial"
        ? "🧾 Часткову оплату постачальнику зафіксовано. Очікуємо доплату."
        : parsed.amount > 0
          ? "🧾 Суму знайдено, скрин прив'язано. Потрібна перевірка: надсилайте скрин відповіддю на повідомлення потрібної оплати."
        : "🧾 Скрин оплати прив'язано, суму треба внести вручну.",
    `Оплата: ${payment.payment_number || payment.id}`,
    `Замовлення: ${orderNumber}`,
    parsed.amount > 0 ? `Рахунок: ${formatAmount(payment.requested_amount, payment.requested_currency)}` : "",
    parsed.amount > 0 ? `Новий скрин: ${formatAmount(parsed.amount, parsed.currency)}` : "",
    totalPaid > 0 ? `Разом оплачено: ${formatAmount(totalPaid, result.paid_currency || parsed.currency)}` : "",
    remainingAmount > 0 ? `Залишок до оплати: ${formatAmount(remainingAmount, payment.requested_currency)}` : "",
    deltaText,
    ocrResult.source
      ? `Розпізнавання: ${ocrResult.source}${ocrResult.error ? ` (${shortOcrError(ocrResult.error)})` : ""}`
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
