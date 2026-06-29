/**
 * EVLine Google Ads cost sync.
 *
 * Google Ads:
 * Tools -> Bulk actions -> Scripts -> + -> paste this file.
 *
 * Replace SYNC_TOKEN with either GOOGLE_ADS_SYNC_TOKEN or ADMIN_TOKEN from Cloudflare.
 * The script sends campaign, keyword, and search-term costs for the last LOOKBACK_DAYS
 * to EVLine CRM.
 */

var CRM_ENDPOINT = "https://evline.com.ua/api/google-ads/costs";
var SYNC_TOKEN = "PASTE_SYNC_TOKEN_HERE";
var LOOKBACK_DAYS = 30;
var IMPORT_BATCH_SIZE = 500;
var ENABLE_KEYWORD_SYNC = true;
var ENABLE_SEARCH_TERM_SYNC = true;

function main() {
  var account = AdsApp.currentAccount();
  var customerId = String(account.getCustomerId()).replace(/-/g, "");
  var currencyCode = account.getCurrencyCode();
  var dateRange = lastNDays(LOOKBACK_DAYS);
  var rows = [];

  rows = rows.concat(campaignRows(dateRange, customerId, currencyCode));

  if (ENABLE_KEYWORD_SYNC) {
    rows = rows.concat(collectRows("keyword_view", keywordQuery(dateRange), function(row) {
      return {
        level: "keyword",
        date: row.segments.date,
        customerId: customerId,
        currencyCode: currencyCode,
        campaignId: String(row.campaign.id),
        campaignName: row.campaign.name,
        adGroupId: String(row.adGroup.id),
        adGroupName: row.adGroup.name,
        criterionId: String(row.adGroupCriterion.criterionId || ""),
        keywordText: row.adGroupCriterion.keyword.text || "",
        matchType: row.adGroupCriterion.keyword.matchType || "",
        costMicros: Number(row.metrics.costMicros || 0),
        clicks: Number(row.metrics.clicks || 0),
        impressions: Number(row.metrics.impressions || 0),
        conversions: Number(row.metrics.conversions || 0),
        conversionValue: Number(row.metrics.conversionsValue || 0),
      };
    }));
  }

  if (ENABLE_SEARCH_TERM_SYNC) {
    rows = rows.concat(collectRows("search_term_view", searchTermQuery(dateRange), function(row) {
      return {
        level: "search_term",
        date: row.segments.date,
        customerId: customerId,
        currencyCode: currencyCode,
        campaignId: String(row.campaign.id),
        campaignName: row.campaign.name,
        adGroupId: String(row.adGroup.id),
        adGroupName: row.adGroup.name,
        keywordText: "",
        matchType: row.segments.searchTermMatchType || "",
        searchTerm: row.searchTermView.searchTerm || "",
        costMicros: Number(row.metrics.costMicros || 0),
        clicks: Number(row.metrics.clicks || 0),
        impressions: Number(row.metrics.impressions || 0),
        conversions: Number(row.metrics.conversions || 0),
        conversionValue: Number(row.metrics.conversionsValue || 0),
      };
    }));
  }

  Logger.log("EVLine total rows: " + rows.length);
  sendRowsInBatches(rows, customerId, currencyCode);
}

function campaignRows(dateRange, customerId, currencyCode) {
  return collectRows("campaign", [
    "SELECT",
    "segments.date,",
    "campaign.id,",
    "campaign.name,",
    "metrics.cost_micros,",
    "metrics.clicks,",
    "metrics.impressions,",
    "metrics.conversions,",
    "metrics.conversions_value",
    "FROM campaign",
    "WHERE segments.date BETWEEN '" + dateRange.start + "' AND '" + dateRange.end + "'",
    "ORDER BY segments.date DESC",
  ].join(" "), function(row) {
    return {
      level: "campaign",
      date: row.segments.date,
      customerId: customerId,
      currencyCode: currencyCode,
      campaignId: String(row.campaign.id),
      campaignName: row.campaign.name,
      costMicros: Number(row.metrics.costMicros || 0),
      clicks: Number(row.metrics.clicks || 0),
      impressions: Number(row.metrics.impressions || 0),
      conversions: Number(row.metrics.conversions || 0),
      conversionValue: Number(row.metrics.conversionsValue || 0),
    };
  });
}

function keywordQuery(dateRange) {
  return [
    "SELECT",
    "segments.date,",
    "campaign.id,",
    "campaign.name,",
    "ad_group.id,",
    "ad_group.name,",
    "ad_group_criterion.criterion_id,",
    "ad_group_criterion.keyword.text,",
    "ad_group_criterion.keyword.match_type,",
    "metrics.cost_micros,",
    "metrics.clicks,",
    "metrics.impressions,",
    "metrics.conversions,",
    "metrics.conversions_value",
    "FROM keyword_view",
    "WHERE segments.date BETWEEN '" + dateRange.start + "' AND '" + dateRange.end + "'",
    "AND metrics.impressions > 0",
    "ORDER BY segments.date DESC",
  ].join(" ");
}

function searchTermQuery(dateRange) {
  return [
    "SELECT",
    "segments.date,",
    "campaign.id,",
    "campaign.name,",
    "ad_group.id,",
    "ad_group.name,",
    "search_term_view.search_term,",
    "segments.search_term_match_type,",
    "metrics.cost_micros,",
    "metrics.clicks,",
    "metrics.impressions,",
    "metrics.conversions,",
    "metrics.conversions_value",
    "FROM search_term_view",
    "WHERE segments.date BETWEEN '" + dateRange.start + "' AND '" + dateRange.end + "'",
    "AND metrics.impressions > 0",
    "ORDER BY segments.date DESC",
  ].join(" ");
}

function collectRows(label, query, mapper) {
  var rows = [];
  try {
    var result = AdsApp.search(query);
    while (result.hasNext()) {
      rows.push(mapper(result.next()));
    }
    Logger.log("EVLine " + label + " rows: " + rows.length);
  } catch (error) {
    Logger.log("EVLine " + label + " sync skipped: " + error);
  }
  return rows;
}

function sendRowsInBatches(rows, customerId, currencyCode) {
  if (!rows.length) {
    Logger.log("EVLine CRM sync skipped: no rows");
    return;
  }

  for (var offset = 0; offset < rows.length; offset += IMPORT_BATCH_SIZE) {
    var batchRows = rows.slice(offset, offset + IMPORT_BATCH_SIZE);
    var response = UrlFetchApp.fetch(CRM_ENDPOINT, {
      method: "post",
      contentType: "application/json",
      headers: {
        Authorization: "Bearer " + SYNC_TOKEN,
      },
      payload: JSON.stringify({
        customerId: customerId,
        currencyCode: currencyCode,
        rows: batchRows,
      }),
      muteHttpExceptions: true,
    });

    var code = response.getResponseCode();
    var body = response.getContentText();
    var start = offset + 1;
    var end = offset + batchRows.length;
    Logger.log("EVLine CRM batch " + start + "-" + end + "/" + rows.length + " response " + code + ": " + body);

    if (code < 200 || code >= 300) {
      throw new Error("EVLine CRM sync failed for batch " + start + "-" + end + ": " + code + " " + body);
    }
  }
}

function lastNDays(days) {
  var end = new Date();
  var start = new Date();
  start.setDate(end.getDate() - days + 1);
  return {
    start: formatDate(start),
    end: formatDate(end),
  };
}

function formatDate(date) {
  return Utilities.formatDate(date, AdsApp.currentAccount().getTimeZone(), "yyyy-MM-dd");
}
