import { json, number, readPayload, text } from "../../../_lib/http.js";

const ALLOWED_STATUS = new Set(["new", "in_progress", "quoted", "ordered", "won", "lost", "spam"]);
const ALLOWED_QUALITY = new Set(["unknown", "low", "medium", "high"]);

export async function onRequestGet({ params, env }) {
  const lead = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(params.id).first();
  if (!lead) return json({ error: "Lead not found" }, { status: 404 });
  return json({ lead });
}

export async function onRequestPatch({ request, params, env }) {
  const payload = await readPayload(request);
  const current = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(params.id).first();
  if (!current) return json({ error: "Lead not found" }, { status: 404 });

  const status = ALLOWED_STATUS.has(text(payload.status)) ? text(payload.status) : current.status;
  const quality = ALLOWED_QUALITY.has(text(payload.quality)) ? text(payload.quality) : current.quality;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE leads SET
      updated_at = ?,
      status = ?,
      quality = ?,
      revenue_uah = ?,
      cost_uah = ?,
      processing_cost_uah = ?,
      manager_notes = ?,
      loss_reason = ?,
      next_action_at = ?
    WHERE id = ?`
  )
    .bind(
      now,
      status,
      quality,
      number(payload.revenue_uah ?? current.revenue_uah),
      number(payload.cost_uah ?? current.cost_uah),
      number(payload.processing_cost_uah ?? current.processing_cost_uah),
      text(payload.manager_notes ?? current.manager_notes),
      text(payload.loss_reason ?? current.loss_reason),
      text(payload.next_action_at ?? current.next_action_at),
      params.id
    )
    .run();

  const lead = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(params.id).first();
  return json({ ok: true, lead });
}
