import { json, leadCorsHeaders, readPayload, text } from "../_lib/http.js";
import { inferAttribution } from "../_lib/attribution.js";
import {
  createOrderFromLead,
  loadOrder,
  managerChatIdForType,
  managerContactForType,
  nextPublicNumber,
  sendManagerOrderNotification,
} from "../_lib/crm.js";

const ALLOWED_TYPES = new Set(["parts", "byd", "other"]);

function detectType(payload, request) {
  const explicitType = text(payload.type).toLowerCase();
  if (ALLOWED_TYPES.has(explicitType)) return explicitType;

  const topic = text(payload.topic || payload.service || payload.form_type).toLowerCase();
  if (topic.includes("byd") || topic.includes("програм") || topic.includes("оновлен")) return "byd";

  const url = new URL(request.url);
  const referrer = text(request.headers.get("referer")).toLowerCase();
  const pathSignal = `${url.pathname} ${text(payload.landing_page).toLowerCase()} ${referrer}`;
  if (
    pathSignal.includes("програмування") ||
    pathSignal.includes("programuv") ||
    pathSignal.includes("programming") ||
    pathSignal.includes("/byd") ||
    pathSignal.includes("/byd.html")
  ) {
    return "byd";
  }

  return "parts";
}

function normalizeLead(payload, request) {
  const now = new Date().toISOString();
  const url = new URL(request.url);
  const type = detectType(payload, request);
  const part = text(payload.part || payload.item_name || payload.need || payload.requested_part);
  const details = text(payload.message || payload.request_text || payload.details || payload.comment);
  const message = [part ? `Запчастина: ${part}` : "", details].filter(Boolean).join("\n");
  const attribution = inferAttribution(payload, request);

  return {
    id: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
    type: ALLOWED_TYPES.has(type) ? type : "parts",
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
    source: attribution.source,
    medium: attribution.medium,
    campaign: attribution.campaign,
    term: attribution.term,
    content: attribution.content,
    gclid: attribution.gclid,
    gbraid: attribution.gbraid,
    wbraid: attribution.wbraid,
    fbclid: attribution.fbclid,
    landing_page: attribution.landing_page || url.origin,
    referrer: attribution.referrer,
    page_url: attribution.page_url || attribution.landing_page || url.origin,
    form_id: attribution.form_id,
    form_name: attribution.form_name,
    submitted_at: attribution.submitted_at || now,
    tracking_captured_at: attribution.tracking_captured_at,
    attribution_type: attribution.attribution_type,
    user_agent: text(request.headers.get("user-agent")),
    ip_country: text(request.headers.get("cf-ipcountry")),
  };
}

async function tableColumns(env, table) {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((rows.results || []).map((row) => row.name));
}

async function insertKnownFields(env, table, fields) {
  const columns = await tableColumns(env, table);
  const available = fields.filter(([name]) => columns.has(name));
  await env.DB.prepare(
    `INSERT INTO ${table} (${available.map(([name]) => name).join(", ")})
    VALUES (${available.map(() => "?").join(", ")})`
  )
    .bind(...available.map(([, value]) => value))
    .run();
}

async function notifyTelegram(env, lead, orderId, request) {
  const managerChatId = managerChatIdForType(env, lead.type);
  if (!env.TELEGRAM_BOT_TOKEN || !managerChatId) return;

  const url = new URL(request.url);
  if (orderId) {
    const order = await loadOrder(env, orderId);
    if (order) {
      await sendManagerOrderNotification(env, order, { origin: url.origin });
      return;
    }
  }

  const lines = [
    lead.type === "byd" ? "Нова заявка EVLine: програмування BYD" : "Нова заявка EVLine: запчастини",
    ...(lead.lead_number ? [`Лід CRM: ${lead.lead_number}`] : []),
    `Замовлення CRM: ${orderId || "-"}`,
    `Менеджер: ${managerContactForType(lead.type)}`,
    `Тип: ${lead.type}`,
    `Ім'я: ${lead.name || "-"}`,
    `Телефон: ${lead.phone || "-"}`,
    `Telegram: ${lead.telegram || "-"}`,
    `Авто: ${lead.car || "-"}`,
    `VIN: ${lead.vin || "-"}`,
    ...(lead.part ? [`Запчастина: ${lead.part}`] : []),
    `Джерело: ${lead.source || "-"} / ${lead.campaign || "-"}`,
    `Атрибуція: ${lead.attribution_type || "-"}${lead.gclid ? " / gclid" : lead.gbraid ? " / gbraid" : lead.wbraid ? " / wbraid" : ""}`,
    ...(lead.form_name || lead.form_id ? [`Форма: ${lead.form_name || lead.form_id}`] : []),
    `Запит: ${lead.details || (lead.part ? "" : lead.message) || "-"}`,
    `Адмінка: ${url.origin}/admin/`,
  ];

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: managerChatId,
      text: lines.join("\n"),
      disable_web_page_preview: true,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.description || "Telegram sendMessage failed");
  }
}

export async function onRequestPost({ request, env }) {
  const payload = await readPayload(request);
  const lead = normalizeLead(payload, request);

  if (!lead.phone && !lead.email && !lead.telegram) {
    return json({ error: "Phone, email or Telegram is required" }, { status: 400, headers: leadCorsHeaders(request) });
  }

  try {
    lead.lead_number = await nextPublicNumber(env, "lead", "L");
    await insertKnownFields(env, "leads", [
      ["id", lead.id],
      ["lead_number", lead.lead_number],
      ["created_at", lead.created_at],
      ["updated_at", lead.updated_at],
      ["type", lead.type],
      ["status", lead.status],
      ["quality", lead.quality],
      ["name", lead.name],
      ["phone", lead.phone],
      ["email", lead.email],
      ["telegram", lead.telegram],
      ["car", lead.car],
      ["vin", lead.vin],
      ["message", lead.message],
      ["source", lead.source],
      ["medium", lead.medium],
      ["campaign", lead.campaign],
      ["term", lead.term],
      ["content", lead.content],
      ["gclid", lead.gclid],
      ["gbraid", lead.gbraid],
      ["wbraid", lead.wbraid],
      ["fbclid", lead.fbclid],
      ["landing_page", lead.landing_page],
      ["referrer", lead.referrer],
      ["page_url", lead.page_url],
      ["form_id", lead.form_id],
      ["form_name", lead.form_name],
      ["submitted_at", lead.submitted_at],
      ["tracking_captured_at", lead.tracking_captured_at],
      ["attribution_type", lead.attribution_type],
      ["user_agent", lead.user_agent],
      ["ip_country", lead.ip_country],
    ]);
  } catch (error) {
    throw error;
  }

  let orderId = "";
  try {
    orderId = await createOrderFromLead(env, lead);
  } catch (error) {
    console.error("Failed to create order from lead", error);
  }

  await notifyTelegram(env, lead, orderId, request).catch((error) => {
    console.error("Failed to notify manager Telegram chat", error);
  });

  return json(
    { ok: true, lead_id: lead.id, lead_number: lead.lead_number || "", order_id: orderId },
    { headers: leadCorsHeaders(request) }
  );
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: leadCorsHeaders(request),
  });
}
