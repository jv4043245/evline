import { json, rangeStart, text } from "../../_lib/http.js";
import { contactEventsUnavailable } from "../../_lib/contact-events.js";

const CHANNELS = new Set(["telegram", "phone", "email", "whatsapp", "viber"]);
const INTENT_TYPES = new Set(["parts", "byd", "to", "sto", "general"]);

function emptyResponse(range, migrationRequired = false) {
  return json({
    range,
    migration_required: migrationRequired,
    totals: { clicks: 0, unique_intents: 0, converted_leads: 0, conversion_rate: 0 },
    channels: [],
    pages: [],
    events: [],
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "30d";
  const start = rangeStart(range);
  const channel = text(url.searchParams.get("channel")).toLowerCase();
  const intentType = text(url.searchParams.get("intent_type")).toLowerCase();
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit"), 10) || 80, 1), 200);
  const filters = [];
  const bindings = [];
  if (start) {
    filters.push("ce.created_at >= ?");
    bindings.push(start);
  }
  if (CHANNELS.has(channel)) {
    filters.push("ce.channel = ?");
    bindings.push(channel);
  }
  if (INTENT_TYPES.has(intentType)) {
    filters.push("ce.intent_type = ?");
    bindings.push(intentType);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  try {
    const totals = await env.DB.prepare(
      `SELECT
        COUNT(*) AS clicks,
        COALESCE(SUM(ce.is_unique), 0) AS unique_intents,
        COUNT(DISTINCT CASE WHEN ce.is_unique = 1 THEN ce.lead_id END) AS converted_leads
       FROM contact_events ce ${where}`
    )
      .bind(...bindings)
      .first();

    const channels = await env.DB.prepare(
      `SELECT ce.channel, COUNT(*) AS clicks, COALESCE(SUM(ce.is_unique), 0) AS unique_intents,
        COUNT(DISTINCT CASE WHEN ce.is_unique = 1 THEN ce.lead_id END) AS converted_leads
       FROM contact_events ce ${where}
       GROUP BY ce.channel
       ORDER BY clicks DESC`
    )
      .bind(...bindings)
      .all();

    const pages = await env.DB.prepare(
      `SELECT ce.page_url, ce.cta_text, ce.intent_type, COUNT(*) AS clicks,
        COALESCE(SUM(ce.is_unique), 0) AS unique_intents,
        COUNT(DISTINCT CASE WHEN ce.is_unique = 1 THEN ce.lead_id END) AS converted_leads
       FROM contact_events ce ${where}
       GROUP BY ce.page_url, ce.cta_text, ce.intent_type
       ORDER BY clicks DESC
       LIMIT 30`
    )
      .bind(...bindings)
      .all();

    const events = await env.DB.prepare(
      `SELECT ce.*, l.lead_number, o.order_number
       FROM contact_events ce
       LEFT JOIN leads l ON l.id = ce.lead_id
       LEFT JOIN orders o ON o.id = ce.order_id
       ${where}
       ORDER BY ce.created_at DESC
       LIMIT ?`
    )
      .bind(...bindings, limit)
      .all();

    const clicks = Number(totals?.clicks || 0);
    const uniqueIntents = Number(totals?.unique_intents || 0);
    const convertedLeads = Number(totals?.converted_leads || 0);
    return json({
      range,
      migration_required: false,
      totals: {
        clicks,
        unique_intents: uniqueIntents,
        converted_leads: convertedLeads,
        conversion_rate: uniqueIntents ? convertedLeads / uniqueIntents : 0,
      },
      channels: channels.results || [],
      pages: pages.results || [],
      events: events.results || [],
    });
  } catch (error) {
    if (contactEventsUnavailable(error)) return emptyResponse(range, true);
    throw error;
  }
}
