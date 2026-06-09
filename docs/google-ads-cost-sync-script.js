/**
 * EVLine Google Ads cost sync.
 *
 * Google Ads:
 * Tools -> Bulk actions -> Scripts -> + -> paste this file.
 *
 * Replace SYNC_TOKEN with either GOOGLE_ADS_SYNC_TOKEN or ADMIN_TOKEN from Cloudflare.
 * The script sends campaign-level costs for the last LOOKBACK_DAYS to EVLine CRM.
 */

var CRM_ENDPOINT = "https://evline.com.ua/api/google-ads/costs";
var SYNC_TOKEN = "PASTE_SYNC_TOKEN_HERE";
var LOOKBACK_DAYS = 14;

function main() {
  var account = AdsApp.currentAccount();
  var customerId = String(account.getCustomerId()).replace(/-/g, "");
  var currencyCode = account.getCurrencyCode();
  var dateRange = lastNDays(LOOKBACK_DAYS);

  var query = [
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
  ].join(" ");

  var rows = [];
  var result = AdsApp.search(query);

  while (result.hasNext()) {
    var row = result.next();
    rows.push({
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
    });
  }

  var response = UrlFetchApp.fetch(CRM_ENDPOINT, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + SYNC_TOKEN,
    },
    payload: JSON.stringify({
      customerId: customerId,
      currencyCode: currencyCode,
      rows: rows,
    }),
    muteHttpExceptions: true,
  });

  var code = response.getResponseCode();
  var body = response.getContentText();
  Logger.log("EVLine CRM response " + code + ": " + body);

  if (code < 200 || code >= 300) {
    throw new Error("EVLine CRM sync failed: " + code + " " + body);
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
