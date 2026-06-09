import { integer, json, number, readPayload, text } from "../../_lib/http.js";

function syncToken(request, env, payload) {
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return (
    bearer ||
    request.headers.get("x-sync-token") ||
    text(payload.token)
  );
}

function isAuthorized(request, env, payload) {
  const expected = text(env.GOOGLE_ADS_SYNC_TOKEN) || text(env.ADMIN_TOKEN);
  return Boolean(expected && syncToken(request, env, payload) === expected);
}

function normalizedDate(value) {
  const candidate = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : "";
}

function rowSpend(row) {
  if (row.costMicros !== undefined || row.cost_micros !== undefined) {
    return number(row.costMicros ?? row.cost_micros) / 1000000;
  }
  return number(row.spendUah ?? row.spend_uah ?? row.costUah ?? row.cost_uah ?? row.cost);
}

function notesForRow(row, payload, batchId) {
  const parts = [
    `customerId=${text(row.customerId || payload.customerId || payload.customer_id) || "-"}`,
    `campaignId=${text(row.campaignId || row.campaign_id) || "-"}`,
    `currency=${text(row.currencyCode || payload.currencyCode || payload.currency_code) || "UAH"}`,
    `conversions=${number(row.conversions)}`,
    `conversionValue=${number(row.conversionValue ?? row.conversion_value)}`,
    `batch=${batchId}`,
  ];
  return `Google Ads sync: ${parts.join("; ")}`;
}

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestPost({ request, env }) {
  const payload = await readPayload(request);
  if (!isAuthorized(request, env, payload)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) {
    return json({ error: "No rows to import" }, { status: 400 });
  }
  if (rows.length > 1000) {
    return json({ error: "Too many rows in one import" }, { status: 413 });
  }

  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();
  let imported = 0;
  let skipped = 0;
  let spendTotal = 0;
  let clicksTotal = 0;
  let impressionsTotal = 0;

  for (const row of rows) {
    const costDate = normalizedDate(row.date || row.cost_date || row.segmentsDate);
    const campaign = text(row.campaignName || row.campaign_name || row.campaign) || "без кампанії";
    if (!costDate) {
      skipped += 1;
      continue;
    }

    const spend = rowSpend(row);
    const clicks = integer(row.clicks);
    const impressions = integer(row.impressions);
    const notes = notesForRow(row, payload, batchId);

    await env.DB.prepare(
      `DELETE FROM ad_costs
       WHERE cost_date = ?
         AND platform = 'google'
         AND source = 'google'
         AND medium = 'cpc'
         AND campaign = ?
         AND notes LIKE 'Google Ads sync:%'`
    )
      .bind(costDate, campaign)
      .run();

    await env.DB.prepare(
      `INSERT INTO ad_costs (
        id, created_at, updated_at, cost_date, platform, source, medium, campaign, spend_uah, clicks, impressions, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        now,
        now,
        costDate,
        "google",
        "google",
        "cpc",
        campaign,
        spend,
        clicks,
        impressions,
        notes
      )
      .run();

    imported += 1;
    spendTotal += spend;
    clicksTotal += clicks;
    impressionsTotal += impressions;
  }

  return json({
    ok: true,
    imported,
    skipped,
    spend_uah: spendTotal,
    clicks: clicksTotal,
    impressions: impressionsTotal,
    batch_id: batchId,
  });
}
