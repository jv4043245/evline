import { inferAttribution } from "../_lib/attribution.js";
import { contactEventsUnavailable, findRecentLeadForContact } from "../_lib/contact-events.js";
import { json, leadCorsHeaders, readPayload, text } from "../_lib/http.js";

const CHANNELS = new Set(["telegram", "phone", "email", "whatsapp", "viber"]);
const INTENT_TYPES = new Set(["parts", "byd", "to", "sto", "general"]);

function clipped(value, max = 500) {
  return text(value).slice(0, max);
}

function normalizeEvent(payload, request) {
  const now = new Date().toISOString();
  const attribution = inferAttribution(payload, request);
  const channel = clipped(payload.channel, 24).toLowerCase();
  const intentType = clipped(payload.intent_type, 24).toLowerCase();
  return {
    id: clipped(payload.id || payload.event_id, 80) || crypto.randomUUID(),
    created_at: now,
    event_type: "contact_click",
    channel: CHANNELS.has(channel) ? channel : "telegram",
    intent_type: INTENT_TYPES.has(intentType) ? intentType : "general",
    cta_id: clipped(payload.cta_id, 160),
    cta_text: clipped(payload.cta_text, 240),
    destination: clipped(payload.destination, 240),
    visitor_id: clipped(payload.visitor_id, 100),
    session_id: clipped(payload.session_id, 100),
    source: clipped(attribution.source, 160),
    medium: clipped(attribution.medium, 160),
    campaign: clipped(attribution.campaign, 240),
    term: clipped(attribution.term, 500),
    content: clipped(attribution.content, 500),
    gclid: clipped(attribution.gclid, 500),
    gbraid: clipped(attribution.gbraid, 500),
    wbraid: clipped(attribution.wbraid, 500),
    fbclid: clipped(attribution.fbclid, 500),
    landing_page: clipped(attribution.landing_page, 1200),
    page_url: clipped(attribution.page_url, 1200),
    referrer: clipped(attribution.referrer, 1200),
    attribution_type: clipped(attribution.attribution_type, 40),
    language: clipped(payload.language, 20),
    user_agent: clipped(request.headers.get("user-agent"), 500),
    ip_country: clipped(request.headers.get("cf-ipcountry"), 10),
  };
}

async function isUniqueIntent(env, event) {
  if (!event.visitor_id && !event.session_id) return 1;
  const since = new Date(new Date(event.created_at).getTime() - 30 * 60 * 1000).toISOString();
  const row = await env.DB.prepare(
    `SELECT id FROM contact_events
     WHERE created_at >= ?
       AND channel = ?
       AND intent_type = ?
       AND (
         (? <> '' AND visitor_id = ?)
         OR (? <> '' AND session_id = ?)
       )
     LIMIT 1`
  )
    .bind(since, event.channel, event.intent_type, event.visitor_id, event.visitor_id, event.session_id, event.session_id)
    .first();
  return row ? 0 : 1;
}

export async function onRequestPost({ request, env }) {
  const headers = leadCorsHeaders(request);
  try {
    const payload = await readPayload(request);
    const channel = clipped(payload.channel, 24).toLowerCase();
    const intentType = clipped(payload.intent_type, 24).toLowerCase();
    const hasContactTarget = Boolean(clipped(payload.destination, 240) || clipped(payload.cta_id, 160));

    if (!CHANNELS.has(channel) || (intentType && !INTENT_TYPES.has(intentType)) || !hasContactTarget) {
      return json({ ok: false, error: "invalid_contact_event" }, { status: 400, headers });
    }

    const event = normalizeEvent(payload, request);
    event.is_unique = await isUniqueIntent(env, event);
    const linked = await findRecentLeadForContact(env, event);
    const leadId = text(linked?.lead_id);
    const orderId = text(linked?.order_id);
    const convertedAt = leadId ? event.created_at : "";

    await env.DB.prepare(
      `INSERT OR IGNORE INTO contact_events (
        id, created_at, event_type, channel, intent_type, cta_id, cta_text, destination,
        visitor_id, session_id, is_unique, source, medium, campaign, term, content,
        gclid, gbraid, wbraid, fbclid, landing_page, page_url, referrer, attribution_type,
        language, user_agent, ip_country, lead_id, order_id, converted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        event.id, event.created_at, event.event_type, event.channel, event.intent_type,
        event.cta_id, event.cta_text, event.destination, event.visitor_id, event.session_id,
        event.is_unique, event.source, event.medium, event.campaign, event.term, event.content,
        event.gclid, event.gbraid, event.wbraid, event.fbclid, event.landing_page, event.page_url,
        event.referrer, event.attribution_type, event.language, event.user_agent, event.ip_country,
        leadId || null, orderId || null, convertedAt || null
      )
      .run();

    return json(
      { ok: true, event_id: event.id, is_unique: Boolean(event.is_unique), linked: Boolean(leadId) },
      { headers }
    );
  } catch (error) {
    if (contactEventsUnavailable(error)) {
      return json({ ok: false, migration_required: true }, { status: 202, headers });
    }
    throw error;
  }
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: leadCorsHeaders(request) });
}
