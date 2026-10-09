/**
 * Append to the existing EVLine cost sync script; call evlineAccountingSync()
 * from main(). Reuses its existing SYNC_TOKEN, never puts a secret in this file.
 * Google Ads Scripts only; no developer token / external Google Ads API client.
 * No campaigns, budgets, bids, keywords or other advertising objects are changed.
 * Customer-level daily totals avoid campaign/keyword/search-term double counting.
 */
function evlineAccountingShift(date, days) {
  return new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

function evlineAccountingSync() {
  try {
    evlineAccountingSyncChecked();
  } catch (error) {
    if (!AdsApp.getExecutionInfo().isPreview()) {
      try {
        var day = Utilities.formatDate(new Date(), "Europe/Kyiv", "yyyy-MM-dd");
        UrlFetchApp.fetch("https://evline.com.ua/api/google-ads/accounting", {
          method: "post", contentType: "application/json", followRedirects: false,
          headers: { Authorization: "Bearer " + SYNC_TOKEN },
          payload: JSON.stringify({status:"failed", provider:"google", account_id:"4028488894",
            source:"google_ads_script", from:evlineAccountingShift(day,-30), to:evlineAccountingShift(day,-1)}),
          muteHttpExceptions: true
        });
      } catch (_) { /* Original failure remains visible in the Google Script log. */ }
    }
    throw error;
  }
}

function evlineAccountingSyncChecked() {
  var account = AdsApp.currentAccount();
  var customer = String(account.getCustomerId()).replace(/-/g, "");
  var timezone = account.getTimeZone();
  if (customer !== "4028488894" || account.getCurrencyCode() !== "UAH" ||
      ["Europe/Kyiv", "Europe/Kiev"].indexOf(timezone) < 0) {
    throw new Error("EVLine accounting: unexpected account, currency or timezone");
  }
  var fetchedAt = new Date().toISOString();
  var today = Utilities.formatDate(new Date(), timezone, "yyyy-MM-dd");
  var from = evlineAccountingShift(today, -30);
  var to = evlineAccountingShift(today, -1);
  var totals = {};
  // Query failure deliberately aborts: it must never turn into a zero-cost day.
  var result = AdsApp.search("SELECT segments.date, metrics.cost_micros FROM customer " +
    "WHERE segments.date BETWEEN '" + from + "' AND '" + to + "'");
  while (result.hasNext()) {
    var row = result.next();
    var date = String(row.segments.date);
    var micros = Number(row.metrics.costMicros);
    if (date < from || date > to || !Number.isSafeInteger(micros) || micros < 0 ||
        Object.prototype.hasOwnProperty.call(totals, date)) {
      throw new Error("EVLine accounting: invalid daily total");
    }
    totals[date] = Math.round(micros / 10000);
  }
  var days = [];
  for (var date = from; date <= to; date = evlineAccountingShift(date, 1)) {
    days.push({ date: date, spend_minor: totals[date] || 0, is_final: true });
  }
  var payload = {
    provider: "google", account_id: customer, currency: "UAH", timezone: timezone,
    from: from, to: to, fetched_at: fetchedAt, scope: "account", coverage: "complete",
    source: "google_ads_script", days: days
  };
  if (AdsApp.getExecutionInfo().isPreview()) {
    Logger.log("EVLine accounting preview: " + days.length + " complete days; " +
      days.reduce(function(sum, day) { return sum + day.spend_minor; }, 0) / 100 + " UAH. No import.");
    return;
  }
  var response = UrlFetchApp.fetch("https://evline.com.ua/api/google-ads/accounting", {
    method: "post", contentType: "application/json", followRedirects: false,
    headers: { Authorization: "Bearer " + SYNC_TOKEN },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error("EVLine accounting import: HTTP " + response.getResponseCode());
  }
  var receipt = JSON.parse(response.getContentText());
  if (!receipt.ok) throw new Error("EVLine accounting: missing success receipt");
  Logger.log("EVLine accounting saved: " + days.length + " days, receipt " + receipt.run_id);
}
