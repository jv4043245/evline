import { text } from "./http.js";

function missingContactTable(error) {
  return /no such table:\s*contact_events|no such column:\s*(visitor_id|session_id)/i.test(error?.message || String(error));
}

export function contactEventsUnavailable(error) {
  return missingContactTable(error);
}

export async function findRecentLeadForContact(env, event) {
  const visitorId = text(event.visitor_id);
  const sessionId = text(event.session_id);
  if (!visitorId && !sessionId) return null;

  const createdAt = text(event.created_at) || new Date().toISOString();
  const earliest = new Date(new Date(createdAt).getTime() - 10 * 60 * 1000).toISOString();
  try {
    return await env.DB.prepare(
      `SELECT l.id AS lead_id, o.id AS order_id, l.created_at
       FROM leads l
       LEFT JOIN orders o ON o.lead_id = l.id
       WHERE l.created_at BETWEEN ? AND ?
         AND (
           (? <> '' AND l.visitor_id = ?)
           OR (? <> '' AND l.session_id = ?)
         )
       ORDER BY l.created_at DESC
       LIMIT 1`
    )
      .bind(earliest, createdAt, visitorId, visitorId, sessionId, sessionId)
      .first();
  } catch (error) {
    if (missingContactTable(error)) return null;
    throw error;
  }
}

export async function linkContactEventsToLead(env, lead, orderId = "") {
  const visitorId = text(lead.visitor_id);
  const sessionId = text(lead.session_id);
  if (!visitorId && !sessionId) return 0;

  const createdAt = text(lead.created_at) || new Date().toISOString();
  const earliest = new Date(new Date(createdAt).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const latest = new Date(new Date(createdAt).getTime() + 10 * 60 * 1000).toISOString();
  try {
    const result = await env.DB.prepare(
      `UPDATE contact_events
       SET lead_id = ?, order_id = ?, converted_at = ?
       WHERE lead_id IS NULL
         AND created_at BETWEEN ? AND ?
         AND (
           (? <> '' AND visitor_id = ?)
           OR (? <> '' AND session_id = ?)
         )`
    )
      .bind(lead.id, text(orderId), createdAt, earliest, latest, visitorId, visitorId, sessionId, sessionId)
      .run();
    return Number(result.meta?.changes || 0);
  } catch (error) {
    if (missingContactTable(error)) return 0;
    throw error;
  }
}
