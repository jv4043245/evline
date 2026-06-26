import { integer, json, number, readPayload, rangeStart, text } from "../../_lib/http.js";
import { auditActor, recordAuditEvent } from "../../_lib/audit-log.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const start = rangeStart(url.searchParams.get("range") || "30d")?.slice(0, 10);
  const where = start ? "WHERE cost_date >= ?" : "";
  const rows = await env.DB.prepare(`SELECT * FROM ad_costs ${where} ORDER BY cost_date DESC, created_at DESC LIMIT 200`)
    .bind(...(start ? [start] : []))
    .all();
  return json({ costs: rows.results });
}

export async function onRequestPost({ request, env }) {
  const payload = await readPayload(request);
  const now = new Date().toISOString();
  const cost = {
    id: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
    cost_date: text(payload.cost_date) || now.slice(0, 10),
    platform: text(payload.platform) || "google",
    source: text(payload.source) || "google",
    medium: text(payload.medium) || "cpc",
    campaign: text(payload.campaign),
    spend_uah: number(payload.spend_uah),
    clicks: integer(payload.clicks),
    impressions: integer(payload.impressions),
    notes: text(payload.notes),
  };

  await env.DB.prepare(
    `INSERT INTO ad_costs (
      id, created_at, updated_at, cost_date, platform, source, medium, campaign, spend_uah, clicks, impressions, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      cost.id,
      cost.created_at,
      cost.updated_at,
      cost.cost_date,
      cost.platform,
      cost.source,
      cost.medium,
      cost.campaign,
      cost.spend_uah,
      cost.clicks,
      cost.impressions,
      cost.notes
    )
    .run();

  await recordAuditEvent(env, {
    actor: auditActor(request),
    action: "ad_cost.create",
    entity_type: "ad_cost",
    entity_id: cost.id,
    entity_label: `${cost.platform} ${cost.cost_date}`,
    details: {
      cost_date: cost.cost_date,
      platform: cost.platform,
      source: cost.source,
      campaign: cost.campaign,
      spend_uah: cost.spend_uah,
      clicks: cost.clicks,
      impressions: cost.impressions,
    },
  });

  return json({ ok: true, cost });
}
