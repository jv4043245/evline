import { json, leadCorsHeaders, readPayload, text } from "../_lib/http.js";
import { createOrderFromLead, managerChatIdForType, managerContactForType } from "../_lib/crm.js";

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
    source: text(payload.utm_source || payload.source) || "site",
    medium: text(payload.utm_medium || payload.medium),
    campaign: text(payload.utm_campaign || payload.campaign),
    term: text(payload.utm_term || payload.term),
    content: text(payload.utm_content || payload.content),
    gclid: text(payload.gclid),
    gbraid: text(payload.gbraid),
    wbraid: text(payload.wbraid),
    fbclid: text(payload.fbclid),
    landing_page: text(payload.landing_page) || url.origin,
    referrer: text(payload.referrer) || text(request.headers.get("referer")),
    user_agent: text(request.headers.get("user-agent")),
    ip_country: text(request.headers.get("cf-ipcountry")),
  };
}

async function notifyTelegram(env, lead, orderId, request) {
  const managerChatId = managerChatIdForType(env, lead.type);
  if (!env.TELEGRAM_BOT_TOKEN || !managerChatId) return;

  const url = new URL(request.url);

  const lines = [
    lead.type === "byd" ? "Нова заявка EVLine: програмування BYD" : "Нова заявка EVLine: запчастини",
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
    `Запит: ${lead.details || (lead.part ? "" : lead.message) || "-"}`,
    `Адмінка: ${url.origin}/admin/`,
  ];

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: managerChatId,
      text: lines.join("\n"),
      disable_web_page_preview: true,
    }),
  });
}

export async function onRequestPost({ request, env }) {
  const payload = await readPayload(request);
  const lead = normalizeLead(payload, request);

  if (!lead.phone && !lead.email && !lead.telegram) {
    return json({ error: "Phone, email or Telegram is required" }, { status: 400, headers: leadCorsHeaders(request) });
  }

  try {
    await env.DB.prepare(
      `INSERT INTO leads (
        id, created_at, updated_at, type, status, quality, name, phone, email, telegram, car, vin, message,
        source, medium, campaign, term, content, gclid, gbraid, wbraid, fbclid, landing_page, referrer, user_agent, ip_country
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        lead.id,
        lead.created_at,
        lead.updated_at,
        lead.type,
        lead.status,
        lead.quality,
        lead.name,
        lead.phone,
        lead.email,
        lead.telegram,
        lead.car,
        lead.vin,
        lead.message,
        lead.source,
        lead.medium,
        lead.campaign,
        lead.term,
        lead.content,
        lead.gclid,
        lead.gbraid,
        lead.wbraid,
        lead.fbclid,
        lead.landing_page,
        lead.referrer,
        lead.user_agent,
        lead.ip_country
      )
      .run();
  } catch (error) {
    if (!/gbraid|wbraid|no such column/i.test(error.message || String(error))) throw error;
    await env.DB.prepare(
      `INSERT INTO leads (
        id, created_at, updated_at, type, status, quality, name, phone, email, telegram, car, vin, message,
        source, medium, campaign, term, content, gclid, fbclid, landing_page, referrer, user_agent, ip_country
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        lead.id,
        lead.created_at,
        lead.updated_at,
        lead.type,
        lead.status,
        lead.quality,
        lead.name,
        lead.phone,
        lead.email,
        lead.telegram,
        lead.car,
        lead.vin,
        lead.message,
        lead.source,
        lead.medium,
        lead.campaign,
        lead.term,
        lead.content,
        lead.gclid,
        lead.fbclid,
        lead.landing_page,
        lead.referrer,
        lead.user_agent,
        lead.ip_country
      )
      .run();
  }

  let orderId = "";
  try {
    orderId = await createOrderFromLead(env, lead);
  } catch (error) {
    console.error("Failed to create order from lead", error);
  }

  await notifyTelegram(env, lead, orderId, request).catch(() => {});

  return json({ ok: true, lead_id: lead.id, order_id: orderId }, { headers: leadCorsHeaders(request) });
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: leadCorsHeaders(request),
  });
}
