import { csv, escapeCsv, integer, json, rangeStart, readPayload, text } from "../../../_lib/http.js";
import {
  GOOGLE_ADS_CUSTOMER_ID,
  googleAdsEventTypesForStatus,
  queueGoogleAdsConversionsForOrder,
} from "../../../_lib/google-ads.js";
import { googleAdsApiConfigStatus, uploadGoogleAdsConversions } from "../../../_lib/google-ads-api.js";

const TABLE_MISSING = "google_ads_conversion_events_missing";
const DEFAULT_IMPORT_START_AT = "2026-07-01T09:37:02Z";

function isMissingTableError(error) {
  return /no such table|no such column/i.test(error?.message || String(error));
}

function emptyPayload(migrationRequired = false) {
  return {
    migration_required: migrationRequired,
    settings: {},
    api_ready: false,
    api_missing: [],
    summary: { total: 0, queued: 0, skipped: 0, uploaded: 0, failed: 0 },
    by_event_type: [],
    conversions: [],
  };
}

function whereFor(url) {
  const clauses = [];
  const binds = [];
  const start = rangeStart(url.searchParams.get("range") || "30d");
  const status = url.searchParams.get("status");

  if (start) {
    clauses.push("e.created_at >= ?");
    binds.push(start);
  }
  if (status && status !== "all") {
    clauses.push("e.status = ?");
    binds.push(status);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    binds,
  };
}

async function loadSettings(env) {
  const rows = await env.DB.prepare("SELECT key, value FROM google_ads_settings").all();
  return Object.fromEntries((rows.results || []).map((row) => [row.key, row.value]));
}

function conversionSelect() {
  return `
    SELECT
      e.*,
      o.customer_name,
      o.customer_phone,
      o.customer_email,
      o.customer_telegram,
      o.car,
      o.vin,
      o.item_name,
      o.service_name,
      o.revenue_uah,
      o.purchase_cost_uah,
      o.delivery_cost_uah,
      o.customs_cost_uah,
      o.processing_cost_uah,
      o.ad_cost_uah,
      o.other_cost_uah,
      o.manager_contact
    FROM google_ads_conversion_events e
    LEFT JOIN orders o ON o.id = e.order_id
  `;
}

function importStart(env) {
  return text(env.GOOGLE_ADS_OFFLINE_IMPORT_START_AT) || DEFAULT_IMPORT_START_AT;
}

async function loadUploadCandidates(env, limit) {
  const rows = await env.DB.prepare(
    `${conversionSelect()}
    WHERE e.status IN ('queued', 'failed')
      AND e.event_type IN ('lead', 'paid')
      AND e.conversion_time >= ?
      AND (
        e.event_type = 'lead'
        OR o.revenue_uah > 0
        OR o.purchase_cost_uah > 0
        OR o.delivery_cost_uah > 0
        OR o.customs_cost_uah > 0
        OR o.processing_cost_uah > 0
        OR o.ad_cost_uah > 0
        OR o.other_cost_uah > 0
      )
    ORDER BY e.created_at ASC
    LIMIT ?`
  )
    .bind(importStart(env), limit)
    .all();
  return rows.results || [];
}

async function persistUploadResult(env, uploadResult) {
  const response = JSON.stringify(uploadResult.google_response || {});
  const now = new Date().toISOString();
  for (const row of uploadResult.rows || []) {
    if (!row?.id) continue;
    const status = row.status === "uploaded" ? "uploaded" : "failed";
    await env.DB.prepare(
      `UPDATE google_ads_conversion_events SET
        updated_at = ?,
        attempts = COALESCE(attempts, 0) + 1,
        status = ?,
        uploaded_at = CASE WHEN ? = 'uploaded' THEN ? ELSE uploaded_at END,
        google_upload_response = ?,
        last_error = ?
      WHERE id = ?`
    )
      .bind(now, status, status, now, response, text(row.error), row.id)
      .run();
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const wantsCsv = url.searchParams.get("format") === "csv";
  const limit = Math.min(Math.max(integer(url.searchParams.get("limit")) || 100, 1), 500);
  const offset = Math.max(integer(url.searchParams.get("offset")) || 0, 0);
  const { where, binds } = whereFor(url);

  try {
    const settings = await loadSettings(env);
    const apiStatus = googleAdsApiConfigStatus(env);
    const rows = await env.DB.prepare(`${conversionSelect()} ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset)
      .all();

    if (wantsCsv) {
      const columns = [
        "created_at",
        "event_type",
        "status",
        "conversion_action_name",
        "conversion_time",
        "conversion_value",
        "gross_profit_uah",
        "currency_code",
        "order_id_for_google",
        "google_ads_customer_id",
        "gclid",
        "gbraid",
        "wbraid",
        "has_click_id",
        "has_customer_identifier",
        "source",
        "medium",
        "campaign",
        "customer_name",
        "customer_phone",
        "customer_telegram",
        "car",
        "vin",
        "item_name",
        "service_name",
        "skip_reason",
        "last_error",
      ];
      const body = [
        columns.join(","),
        ...rows.results.map((row) => columns.map((column) => escapeCsv(row[column])).join(",")),
      ].join("\n");
      return csv(body, "evline-google-ads-conversions.csv");
    }

    const summary = await env.DB.prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
        SUM(CASE WHEN status = 'uploaded' THEN 1 ELSE 0 END) AS uploaded,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM google_ads_conversion_events e ${where}`
    )
      .bind(...binds)
      .first();

    const byEventType = await env.DB.prepare(
      `SELECT event_type, COUNT(*) AS total,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'uploaded' THEN 1 ELSE 0 END) AS uploaded
      FROM google_ads_conversion_events e ${where}
      GROUP BY event_type
      ORDER BY total DESC`
    )
      .bind(...binds)
      .all();

    return json({
      migration_required: false,
      settings: {
        customer_id: text(settings.customer_id) || text(env.GOOGLE_ADS_CUSTOMER_ID) || GOOGLE_ADS_CUSTOMER_ID,
        currency_code: text(settings.currency_code) || text(env.GOOGLE_ADS_CURRENCY_CODE) || "UAH",
        lead_conversion_action_name: settings.lead_conversion_action_name || "EVLine Lead",
        paid_conversion_action_name: settings.paid_conversion_action_name || "EVLine Paid Order",
        conversion_value_mode: text(env.GOOGLE_ADS_CONVERSION_VALUE_MODE) || settings.conversion_value_mode || "gross_profit",
      },
      api_ready: apiStatus.ready,
      api_missing: apiStatus.missing,
      api_version: apiStatus.api_version,
      summary,
      by_event_type: byEventType.results,
      conversions: rows.results,
      limit,
      offset,
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      return json({ ...emptyPayload(true), error: TABLE_MISSING });
    }
    throw error;
  }
}

export async function onRequestPost({ request, env }) {
  const payload = await readPayload(request);
  const action = text(payload.action) || "backfill";
  if (!["backfill", "validate", "upload"].includes(action)) return json({ error: "Unsupported action" }, { status: 400 });

  if (action === "validate" || action === "upload") {
    const limit = Math.min(Math.max(integer(payload.limit) || 50, 1), 500);
    try {
      const rows = await loadUploadCandidates(env, limit);
      const result = await uploadGoogleAdsConversions(env, rows, { validateOnly: action === "validate" });
      if (result.missing_config?.length) {
        return json(
          {
            ok: false,
            action,
            candidates: rows.length,
            missing_config: result.missing_config,
            error: "Google Ads API secrets are incomplete.",
          },
          { status: 409 }
        );
      }
      if (action === "upload") {
        await persistUploadResult(env, result);
      }
      return json({ ok: result.ok, action, candidates: rows.length, ...result });
    } catch (error) {
      if (isMissingTableError(error)) {
        return json({ ok: false, migration_required: true, error: TABLE_MISSING }, { status: 409 });
      }
      return json({ ok: false, action, error: error.message || String(error) }, { status: 502 });
    }
  }

  const range = text(payload.range) || "365d";
  const start = rangeStart(range);
  const limit = Math.min(Math.max(integer(payload.limit) || 500, 1), 1000);
  const where = start ? "WHERE created_at >= ?" : "";
  const binds = start ? [start] : [];
  let processed = 0;
  let queued = 0;
  const statuses = {};

  try {
    const orders = await env.DB.prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ?`)
      .bind(...binds, limit)
      .all();

    for (const order of orders.results || []) {
      processed += 1;
      const results = await queueGoogleAdsConversionsForOrder(env, order, googleAdsEventTypesForStatus(order.status));
      queued += results.length;
      for (const result of results) {
        statuses[result.status || "unknown"] = (statuses[result.status || "unknown"] || 0) + 1;
      }
    }

    return json({ ok: true, processed, queued, statuses, range, limit });
  } catch (error) {
    if (isMissingTableError(error)) {
      return json({ ok: false, migration_required: true, error: TABLE_MISSING }, { status: 409 });
    }
    throw error;
  }
}
