import { csv, escapeCsv, integer, number, rangeStart, text } from "../../_lib/http.js";

const DEFAULT_IMPORT_START_AT = "2026-07-01T09:37:02Z";
const DEFAULT_LIMIT = 1000;

function tokenFromBasicAuth(request) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Basic ")) return "";
  try {
    const decoded = atob(auth.slice(6).trim());
    const separator = decoded.indexOf(":");
    return separator >= 0 ? decoded.slice(separator + 1) : decoded;
  } catch {
    return "";
  }
}

function isAuthorized(request, env, url) {
  const expected = text(env.GOOGLE_ADS_UPLOAD_TOKEN) || text(env.GOOGLE_ADS_SYNC_TOKEN);
  if (!expected) return false;
  return text(url.searchParams.get("token")) === expected || tokenFromBasicAuth(request) === expected;
}

function importStart(env) {
  return text(env.GOOGLE_ADS_OFFLINE_IMPORT_START_AT) || DEFAULT_IMPORT_START_AT;
}

function financeIsReady(row) {
  return (
    number(row.revenue_uah) > 0 ||
    number(row.purchase_cost_uah) > 0 ||
    number(row.delivery_cost_uah) > 0 ||
    number(row.customs_cost_uah) > 0 ||
    number(row.processing_cost_uah) > 0 ||
    number(row.ad_cost_uah) > 0 ||
    number(row.other_cost_uah) > 0
  );
}

function formatConversionTime(value) {
  const raw = text(value);
  const date = new Date(raw.replace(" ", "T"));
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 19).replace("T", " ") + "+0000";
  }
  return raw.replace(/([+-]\d{2}):?(\d{2})$/, "$1$2");
}

function rowToCsv(row) {
  const conversionName = row.event_type === "paid" ? "EVLine Paid Order" : "EVLine Lead";
  return [
    row.gclid,
    conversionName,
    formatConversionTime(row.conversion_time),
    number(row.conversion_value).toFixed(2),
    text(row.currency_code) || "UAH",
    text(row.order_id_for_google || `${row.order_id}_${row.event_type}`),
  ].map(escapeCsv).join(",");
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!isAuthorized(request, env, url)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "www-authenticate": 'Basic realm="EVLine Google Ads"',
        "cache-control": "no-store",
      },
    });
  }

  const start = rangeStart(url.searchParams.get("range") || "90d");
  const startAt = importStart(env);
  const limit = Math.min(Math.max(integer(url.searchParams.get("limit")) || DEFAULT_LIMIT, 1), 5000);
  const binds = [startAt];
  const clauses = [
    "e.status IN ('queued', 'failed')",
    "e.event_type IN ('lead', 'paid')",
    "e.gclid <> ''",
    "e.conversion_time >= ?",
  ];

  if (start) {
    clauses.push("e.created_at >= ?");
    binds.push(start);
  }

  const rows = await env.DB.prepare(
    `SELECT
      e.*,
      o.revenue_uah,
      o.purchase_cost_uah,
      o.delivery_cost_uah,
      o.customs_cost_uah,
      o.processing_cost_uah,
      o.ad_cost_uah,
      o.other_cost_uah
    FROM google_ads_conversion_events e
    LEFT JOIN orders o ON o.id = e.order_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY e.conversion_time ASC
    LIMIT ?`
  )
    .bind(...binds, limit)
    .all();

  const exportRows = (rows.results || []).filter((row) => row.event_type !== "paid" || financeIsReady(row));
  const body = [
    "Parameters:TimeZone=+0000",
    ["Google Click ID", "Conversion Name", "Conversion Time", "Conversion Value", "Conversion Currency", "Order ID"].join(","),
    ...exportRows.map(rowToCsv),
  ].join("\n");

  return csv(body, "evline-google-ads-offline-conversions.csv");
}
