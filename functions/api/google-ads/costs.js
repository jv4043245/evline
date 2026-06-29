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

function normalizedLevel(value) {
  const level = text(value).toLowerCase();
  return ["campaign", "keyword", "search_term"].includes(level) ? level : "campaign";
}

function rowSpend(row) {
  if (row.costMicros !== undefined || row.cost_micros !== undefined) {
    return number(row.costMicros ?? row.cost_micros) / 1000000;
  }
  return number(row.spendUah ?? row.spend_uah ?? row.costUah ?? row.cost_uah ?? row.cost);
}

function compactKeyPart(value) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function keywordStatKey(row, payload) {
  return [
    normalizedLevel(row.level),
    normalizedDate(row.date || row.cost_date || row.segmentsDate),
    text(row.customerId || payload.customerId || payload.customer_id),
    text(row.campaignId || row.campaign_id),
    text(row.adGroupId || row.ad_group_id),
    text(row.criterionId || row.criterion_id),
    compactKeyPart(row.keywordText || row.keyword_text || row.keyword),
    compactKeyPart(row.matchType || row.match_type),
    compactKeyPart(row.searchTerm || row.search_term),
  ].join("|");
}

function notesForRow(row, payload, batchId) {
  const parts = [
    `customerId=${text(row.customerId || payload.customerId || payload.customer_id) || "-"}`,
    `campaignId=${text(row.campaignId || row.campaign_id) || "-"}`,
    `campaignName=${text(row.campaignName || row.campaign_name || row.campaign) || "-"}`,
    `adGroupId=${text(row.adGroupId || row.ad_group_id) || "-"}`,
    `adGroupName=${text(row.adGroupName || row.ad_group_name) || "-"}`,
    `criterionId=${text(row.criterionId || row.criterion_id) || "-"}`,
    `keyword=${text(row.keywordText || row.keyword_text || row.keyword) || "-"}`,
    `searchTerm=${text(row.searchTerm || row.search_term) || "-"}`,
    `currency=${text(row.currencyCode || payload.currencyCode || payload.currency_code) || "UAH"}`,
    `conversions=${number(row.conversions)}`,
    `conversionValue=${number(row.conversionValue ?? row.conversion_value)}`,
    `batch=${batchId}`,
  ];
  return `Google Ads sync: ${parts.join("; ")}`;
}

function isMissingKeywordStatsTable(error) {
  return /no such table: google_ads_keyword_stats/i.test(error?.message || String(error));
}

async function importKeywordStat(env, row, payload, now, batchId) {
  const level = normalizedLevel(row.level);
  if (level === "campaign") return false;

  const costDate = normalizedDate(row.date || row.cost_date || row.segmentsDate);
  if (!costDate) return false;

  const campaignId = text(row.campaignId || row.campaign_id);
  const campaignName = text(row.campaignName || row.campaign_name || row.campaign);
  const adGroupId = text(row.adGroupId || row.ad_group_id);
  const adGroupName = text(row.adGroupName || row.ad_group_name);
  const keywordText = text(row.keywordText || row.keyword_text || row.keyword);
  const searchTerm = text(row.searchTerm || row.search_term);
  const statKey = keywordStatKey(row, payload);
  const spend = rowSpend(row);
  const clicks = integer(row.clicks);
  const impressions = integer(row.impressions);
  const notes = notesForRow(row, payload, batchId);

  await env.DB.prepare(
    `INSERT INTO google_ads_keyword_stats (
      id, stat_key, created_at, updated_at, stat_date, google_ads_customer_id, level,
      source, medium, campaign, campaign_id, campaign_name, ad_group_id, ad_group_name,
      criterion_id, keyword_text, match_type, search_term, spend_uah, clicks,
      impressions, google_conversions, google_conversion_value, currency_code, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stat_key) DO UPDATE SET
      updated_at = excluded.updated_at,
      google_ads_customer_id = excluded.google_ads_customer_id,
      source = excluded.source,
      medium = excluded.medium,
      campaign = excluded.campaign,
      campaign_id = excluded.campaign_id,
      campaign_name = excluded.campaign_name,
      ad_group_id = excluded.ad_group_id,
      ad_group_name = excluded.ad_group_name,
      criterion_id = excluded.criterion_id,
      keyword_text = excluded.keyword_text,
      match_type = excluded.match_type,
      search_term = excluded.search_term,
      spend_uah = excluded.spend_uah,
      clicks = excluded.clicks,
      impressions = excluded.impressions,
      google_conversions = excluded.google_conversions,
      google_conversion_value = excluded.google_conversion_value,
      currency_code = excluded.currency_code,
      notes = excluded.notes`
  )
    .bind(
      crypto.randomUUID(),
      statKey,
      now,
      now,
      costDate,
      text(row.customerId || payload.customerId || payload.customer_id),
      level,
      "google",
      "cpc",
      campaignId || campaignName || "без кампанії",
      campaignId,
      campaignName,
      adGroupId,
      adGroupName,
      text(row.criterionId || row.criterion_id),
      keywordText,
      text(row.matchType || row.match_type),
      searchTerm,
      spend,
      clicks,
      impressions,
      number(row.conversions),
      number(row.conversionValue ?? row.conversion_value),
      text(row.currencyCode || payload.currencyCode || payload.currency_code) || "UAH",
      notes
    )
    .run();

  return true;
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
    return json({
      ok: true,
      imported: 0,
      skipped: 0,
      spend_uah: 0,
      clicks: 0,
      impressions: 0,
      message: "No Google Ads rows to import for this period.",
    });
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
  let keywordStatsImported = 0;
  let keywordStatsSkipped = 0;
  let keywordStatsTableMissing = false;

  for (const row of rows) {
    const level = normalizedLevel(row.level);
    if (level !== "campaign") {
      try {
        const importedKeywordStat = await importKeywordStat(env, row, payload, now, batchId);
        if (importedKeywordStat) {
          imported += 1;
          keywordStatsImported += 1;
          spendTotal += rowSpend(row);
          clicksTotal += integer(row.clicks);
          impressionsTotal += integer(row.impressions);
        } else {
          skipped += 1;
          keywordStatsSkipped += 1;
        }
      } catch (error) {
        if (isMissingKeywordStatsTable(error)) {
          skipped += 1;
          keywordStatsSkipped += 1;
          keywordStatsTableMissing = true;
          continue;
        }
        throw error;
      }
      continue;
    }

    const costDate = normalizedDate(row.date || row.cost_date || row.segmentsDate);
    const campaignId = text(row.campaignId || row.campaign_id);
    const campaignName = text(row.campaignName || row.campaign_name || row.campaign);
    const campaign = campaignId || campaignName || "без кампанії";
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
         AND (
           campaign = ?
           OR campaign = ?
           OR notes LIKE ?
         )
         AND notes LIKE 'Google Ads sync:%'`
    )
      .bind(costDate, campaign, campaignName, campaignId ? `%campaignId=${campaignId};%` : "__no_campaign_id__")
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
    keyword_stats_imported: keywordStatsImported,
    keyword_stats_skipped: keywordStatsSkipped,
    keyword_stats_migration_required: keywordStatsTableMissing,
    spend_uah: spendTotal,
    clicks: clicksTotal,
    impressions: impressionsTotal,
    batch_id: batchId,
  });
}
