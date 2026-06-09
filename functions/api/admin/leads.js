import { csv, escapeCsv, integer, json, rangeStart } from "../../_lib/http.js";
import { tableHasColumn } from "../../_lib/crm.js";

function buildWhere(url, options = {}) {
  const clauses = [];
  const binds = [];
  const start = rangeStart(url.searchParams.get("range") || "30d");
  const status = url.searchParams.get("status");
  const quality = url.searchParams.get("quality");
  const source = url.searchParams.get("source");
  const type = url.searchParams.get("type");
  const q = url.searchParams.get("q");

  if (start) {
    clauses.push("created_at >= ?");
    binds.push(start);
  }
  if (status && status !== "all") {
    clauses.push("status = ?");
    binds.push(status);
  }
  if (quality && quality !== "all") {
    clauses.push("quality = ?");
    binds.push(quality);
  }
  if (source && source !== "all") {
    clauses.push("COALESCE(NULLIF(source, ''), 'direct') = ?");
    binds.push(source);
  }
  if (type && type !== "all") {
    clauses.push("type = ?");
    binds.push(type);
  }
  if (q) {
    const searchColumns = [
      ...(options.hasLeadNumber ? ["lead_number"] : []),
      "name",
      "phone",
      "car",
      "vin",
      "message",
      "campaign",
    ];
    clauses.push(`(${searchColumns.map((column) => `${column} LIKE ?`).join(" OR ")})`);
    const like = `%${q}%`;
    binds.push(...searchColumns.map(() => like));
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    binds,
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const options = {
    hasLeadNumber: await tableHasColumn(env, "leads", "lead_number"),
  };
  const { where, binds } = buildWhere(url, options);
  const limit = Math.min(Math.max(integer(url.searchParams.get("limit")) || 100, 1), 500);
  const offset = Math.max(integer(url.searchParams.get("offset")) || 0, 0);
  const wantsCsv = url.searchParams.get("format") === "csv";

  const rows = await env.DB.prepare(
    `SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all();

  if (wantsCsv) {
    const columns = [
      "lead_number",
      "created_at",
      "type",
      "status",
      "quality",
      "name",
      "phone",
      "email",
      "telegram",
      "car",
      "vin",
      "message",
      "source",
      "medium",
      "campaign",
      "term",
      "revenue_uah",
      "cost_uah",
      "processing_cost_uah",
      "manager_notes",
    ];
    const body = [
      columns.join(","),
      ...rows.results.map((row) => columns.map((column) => escapeCsv(row[column])).join(",")),
    ].join("\n");
    return csv(body, "evline-leads.csv");
  }

  const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM leads ${where}`).bind(...binds).first();
  return json({ leads: rows.results, total: count.count, limit, offset });
}
