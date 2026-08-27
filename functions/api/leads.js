import { json, leadCorsHeaders, readPayload, text } from "../_lib/http.js";
import { inferAttribution } from "../_lib/attribution.js";
import { linkContactEventsToLead } from "../_lib/contact-events.js";
import { runMarketResearch } from "../_lib/market-research.js";
import {
  createOrderFromLead,
  loadOrder,
  managerChatIdForType,
  managerContactForType,
  nextPublicNumber,
  sendManagerOrderNotification,
} from "../_lib/crm.js";

const ALLOWED_TYPES = new Set(["parts", "byd", "other"]);

function booleanFlag(value) {
  if (value === true || value === 1) return 1;
  return ["1", "true", "yes", "on"].includes(text(value).toLowerCase()) ? 1 : 0;
}

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

export function normalizeLead(payload, request) {
  const now = new Date().toISOString();
  const url = new URL(request.url);
  const type = detectType(payload, request);
  const part = text(payload.part || payload.item_name || payload.need || payload.requested_part);
  const details = text(payload.message || payload.request_text || payload.details || payload.comment);
  const requestLabel = type === "byd" ? "Запит" : "Запчастина";
  const distinctDetails = details && details !== part ? details : "";
  const message = [part ? `${requestLabel}: ${part}` : "", distinctDetails].filter(Boolean).join("\n");
  const attribution = inferAttribution(payload, request);
  const marketingConsent = booleanFlag(payload.marketing_consent);

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
    visitor_id: text(payload.visitor_id),
    session_id: text(payload.session_id),
    fbp: marketingConsent ? text(payload.fbp).slice(0, 500) : "",
    fbc: marketingConsent ? text(payload.fbc).slice(0, 500) : "",
    meta_event_id: text(payload.meta_event_id || payload.event_id).slice(0, 160),
    marketing_consent: marketingConsent,
    marketing_consent_at: text(payload.marketing_consent_at).slice(0, 80),
    consent_version: text(payload.consent_version).slice(0, 80),
    user_agent: text(request.headers.get("user-agent")),
    ip_country: text(request.headers.get("cf-ipcountry")),
  };
}

async function tableColumns(env, table) {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((rows.results || []).map((row) => row.name));
}

async function optionalTableColumns(env, table) {
  try {
    return await tableColumns(env, table);
  } catch (error) {
    if (/no such table/i.test(error.message || String(error))) return new Set();
    throw error;
  }
}

export async function findExistingLeadByMetaEventId(env, value) {
  const metaEventId = text(value);
  if (!metaEventId) return null;

  const leadColumns = await tableColumns(env, "leads");
  if (!leadColumns.has("meta_event_id")) return null;

  const leadNumberSelect = leadColumns.has("lead_number") ? "leads.lead_number" : "'' AS lead_number";
  const orderColumns = await optionalTableColumns(env, "orders");
  const canJoinOrder = orderColumns.has("id") && orderColumns.has("lead_id");

  if (!canJoinOrder) {
    return env.DB.prepare(
      `SELECT leads.id, ${leadNumberSelect}, '' AS order_id
       FROM leads
       WHERE leads.meta_event_id = ?
       LIMIT 1`
    )
      .bind(metaEventId)
      .first();
  }

  return env.DB.prepare(
    `SELECT leads.id, ${leadNumberSelect}, orders.id AS order_id
     FROM leads
     LEFT JOIN orders ON orders.lead_id = leads.id
     WHERE leads.meta_event_id = ?
     LIMIT 1`
  )
    .bind(metaEventId)
    .first();
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
    `Менеджер: ${managerContactForType(lead.type)}`,
    ...(lead.phone ? [`Телефон: ${lead.phone}`] : []),
    ...(lead.name ? [`Ім'я: ${lead.name}`] : []),
    ...(lead.telegram ? [`Telegram: ${lead.telegram}`] : []),
    ...(lead.car ? [`Авто: ${lead.car}`] : []),
    ...(lead.vin ? [`VIN: ${lead.vin}`] : []),
    ...(lead.part ? [`${lead.type === "byd" ? "Запит" : "Запчастина"}: ${lead.part}`] : []),
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

export async function onRequestPost(context) {
  const { request, env } = context;
  const payload = await readPayload(request);
  const lead = normalizeLead(payload, request);

  if (!lead.phone && !lead.email && !lead.telegram) {
    return json({ error: "Phone, email or Telegram is required" }, { status: 400, headers: leadCorsHeaders(request) });
  }

  if (lead.meta_event_id) {
    const existing = await findExistingLeadByMetaEventId(env, lead.meta_event_id);
    if (existing) {
      return json(
        {
          ok: true,
          duplicate: true,
          lead_id: existing.id,
          lead_number: existing.lead_number || "",
          order_id: existing.order_id || "",
          meta_event_id: lead.meta_event_id,
        },
        { headers: leadCorsHeaders(request) }
      );
    }
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
      ["visitor_id", lead.visitor_id],
      ["session_id", lead.session_id],
      ["fbp", lead.fbp],
      ["fbc", lead.fbc],
      ["meta_event_id", lead.meta_event_id],
      ["marketing_consent", lead.marketing_consent],
      ["marketing_consent_at", lead.marketing_consent_at],
      ["consent_version", lead.consent_version],
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

  await linkContactEventsToLead(env, lead, orderId).catch((error) => {
    console.error("Failed to link contact events to lead", error);
  });

  await notifyTelegram(env, lead, orderId, request).catch((error) => {
    console.error("Failed to notify manager Telegram chat", error);
  });

  if (orderId && lead.type === "parts" && (lead.part || lead.details) && typeof context.waitUntil === "function") {
    context.waitUntil(
      loadOrder(env, orderId)
        .then((order) => (order ? runMarketResearch(env, order) : null))
        .catch((error) => console.error("Failed to prepare market research", error))
    );
  }

  return json(
    {
      ok: true,
      lead_id: lead.id,
      lead_number: lead.lead_number || "",
      order_id: orderId,
      meta_event_id: lead.meta_event_id,
    },
    { headers: leadCorsHeaders(request) }
  );
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: leadCorsHeaders(request),
  });
}
