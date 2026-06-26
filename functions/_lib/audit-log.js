import { integer, text } from "./http.js";

const MAX_DETAILS_LENGTH = 6000;

async function ensureAuditLogTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS admin_audit_log (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      actor TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      entity_label TEXT,
      order_id TEXT,
      details_json TEXT
    )`
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log(created_at)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_admin_audit_log_entity ON admin_audit_log(entity_type, entity_id)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_admin_audit_log_order_id ON admin_audit_log(order_id)").run();
}

function truncateDetailText(value, limit = 1400) {
  const valueText = text(value);
  return valueText.length > limit ? `${valueText.slice(0, limit)}...` : value;
}

function compactDetails(details = {}) {
  return {
    _truncated: true,
    order_number: details.order_number,
    public_number: details.public_number,
    supplier_name: details.supplier_name,
    customer_name: details.customer_name,
    customer_phone: details.customer_phone,
    car: details.car,
    vin: details.vin,
    item_name: details.item_name || details.service_name,
    status: details.status,
    status_from: details.status_from,
    status_to: details.status_to,
    requested_amount: details.requested_amount,
    requested_currency: details.requested_currency,
    price_cny: details.price_cny,
  };
}

function safeDetails(details = {}) {
  try {
    const normalized = {
      ...(details || {}),
      request_text: truncateDetailText(details?.request_text),
      message: truncateDetailText(details?.message),
      notes: truncateDetailText(details?.notes),
    };
    const json = JSON.stringify(normalized);
    return json.length > MAX_DETAILS_LENGTH ? JSON.stringify(compactDetails(normalized)) : json;
  } catch {
    return "{}";
  }
}

function parseDetails(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function auditActor(request) {
  const headers = request?.headers;
  return (
    text(headers?.get?.("x-admin-actor")) ||
    text(headers?.get?.("cf-access-authenticated-user-email")) ||
    text(headers?.get?.("x-forwarded-email")) ||
    "admin"
  );
}

export async function recordAuditEvent(env, event = {}) {
  if (!env?.DB || !event.action || !event.entity_type) return { ok: false };
  try {
    await ensureAuditLogTable(env);
    const row = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      actor: text(event.actor) || "admin",
      action: text(event.action),
      entity_type: text(event.entity_type),
      entity_id: text(event.entity_id),
      entity_label: text(event.entity_label),
      order_id: text(event.order_id),
      details_json: safeDetails(event.details),
    };
    await env.DB.prepare(
      `INSERT INTO admin_audit_log (
        id, created_at, actor, action, entity_type, entity_id, entity_label, order_id, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.created_at,
        row.actor,
        row.action,
        row.entity_type,
        row.entity_id,
        row.entity_label,
        row.order_id,
        row.details_json
      )
      .run();
    return { ok: true, event: row };
  } catch (error) {
    console.warn("admin audit log failed", error?.message || String(error));
    return { ok: false, error: error?.message || String(error) };
  }
}

export async function listAuditEvents(env, options = {}) {
  await ensureAuditLogTable(env);
  const limit = Math.min(Math.max(integer(options.limit) || 80, 1), 200);
  const q = text(options.q);
  const clauses = [];
  const binds = [];
  if (q) {
    clauses.push(`(
      action LIKE ?
      OR entity_type LIKE ?
      OR entity_id LIKE ?
      OR entity_label LIKE ?
      OR order_id LIKE ?
      OR actor LIKE ?
      OR details_json LIKE ?
    )`);
    binds.push(...Array(7).fill(`%${q}%`));
  }
  const rows = await env.DB.prepare(
    `SELECT *
    FROM admin_audit_log
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY created_at DESC
    LIMIT ?`
  )
    .bind(...binds, limit)
    .all();
  return (rows.results || []).map((row) => ({
    ...row,
    details: parseDetails(row.details_json),
  }));
}
