/**
 * ONE-OFF EVLine Google Ads accounting history backfill. Not a daily replacement.
 * Temporarily call evlineAccountingHistory({mode:'discover'}) from a manual
 * script that already owns SYNC_TOKEN. Discovery and preview never POST.
 * Next preview with {mode:'preview'}. Only after reviewing its exact dates:
 * {mode:'apply',confirm_from:'2025-01-01',confirm_to:'YYYY-MM-DD'}.
 * Restore the manual script afterwards; do not add another scheduled job.
 *
 * All operations on Google Ads are read-only AdsApp.search/currentAccount.
 * The only write is the existing authenticated EVLine accounting endpoint.
 * Whole-customer daily totals, not campaign/keyword sum. Explicit zero days
 * are generated only after a successful whole-period query has been consumed.
 *
 * Since June 2026, Google daily reporting retention is 37 months; monthly is
 * 11 years: https://support.google.com/google-ads/answer/15188209 . Discovery
 * therefore uses segments.month from 2016. Older monthly-only history aborts
 * daily backfill instead of manufacturing zero days or claiming completeness.
 */
function evlineHistoryDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  var date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function evlineHistoryShift(date, days) {
  return new Date(Date.parse(date + 'T12:00:00.000Z') + days * 86400000).toISOString().slice(0, 10);
}

function evlineHistoryMonths(date, months) {
  var values = date.split('-').map(Number);
  // Overflow to the next month is conservative for the retention boundary.
  return new Date(Date.UTC(values[0], values[1] - 1 + months, values[2])).toISOString().slice(0, 10);
}

function evlineHistoryMicros(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') throw new Error('history_invalid_cost');
  var micros = Number(value);
  if (!Number.isSafeInteger(micros) || micros < 0) throw new Error('history_invalid_cost');
  return micros;
}

function evlineHistoryDiscover(account) {
  var today = Utilities.formatDate(new Date(), account.getTimeZone(), 'yyyy-MM-dd');
  if (!evlineHistoryDate(today)) throw new Error('history_invalid_clock');
  var to = evlineHistoryShift(today, -1);
  var firstMonth = null;
  var query = "SELECT segments.month, metrics.cost_micros FROM customer " +
    "WHERE segments.month BETWEEN '2016-01-01' AND '" + today.slice(0, 7) + "-01' " +
    "AND metrics.cost_micros > 0 ORDER BY segments.month ASC LIMIT 1";
  var rows = AdsApp.search(query);
  if (rows.hasNext()) {
    var row = rows.next();
    firstMonth = String(row.segments.month);
    if (!evlineHistoryDate(firstMonth) || firstMonth.slice(-2) !== '01' || firstMonth < '2016-01-01' || firstMonth > today || evlineHistoryMicros(row.metrics.costMicros) <= 0 || rows.hasNext()) {
      throw new Error('history_invalid_discovery');
    }
  }
  var wantedFrom = firstMonth && firstMonth < '2025-01-01' ? firstMonth : '2025-01-01';
  var retentionFloor = evlineHistoryMonths(today, -37);
  var result = { first_spend_month: firstMonth, from: wantedFrom, to: to,
    discovery_from: '2016-01-01', daily_retention_floor: retentionFloor,
    needs_monthly_history: wantedFrom < retentionFloor };
  Logger.log('EVLINE_HISTORY_DISCOVERY=' + JSON.stringify(result));
  return result;
}

function evlineHistoryChunks(from, to) {
  if (!evlineHistoryDate(from) || !evlineHistoryDate(to) || from > to) throw new Error('history_invalid_range');
  var chunks = [];
  for (var start = from; start <= to; start = evlineHistoryShift(end, 1)) {
    var end = evlineHistoryShift(start, 365);
    if (end > to) end = to;
    chunks.push({ from: start, to: end });
    if (chunks.length > 4) throw new Error('history_range_exceeds_daily_retention');
  }
  return chunks;
}

function evlineHistoryPayload(chunk, account, fetchedAt) {
  var query = "SELECT segments.date, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '" + chunk.from + "' AND '" + chunk.to + "'";
  var rows = AdsApp.search(query);
  var totals = {};
  while (rows.hasNext()) {
    var row = rows.next();
    var date = String(row.segments.date);
    if (!evlineHistoryDate(date) || date < chunk.from || date > chunk.to || Object.prototype.hasOwnProperty.call(totals, date)) throw new Error('history_invalid_daily_row');
    var minor = Math.round(evlineHistoryMicros(row.metrics.costMicros) / 10000);
    if (!Number.isSafeInteger(minor) || minor > 100000000000) throw new Error('history_cost_exceeds_bound');
    totals[date] = minor;
  }
  var days = [];
  for (var date = chunk.from; date <= chunk.to; date = evlineHistoryShift(date, 1)) {
    days.push({ date: date, spend_minor: totals[date] || 0, is_final: true });
  }
  return { provider: 'google', account_id: '4028488894', currency: 'UAH', timezone: account.getTimeZone(),
    from: chunk.from, to: chunk.to, fetched_at: fetchedAt, scope: 'account', coverage: 'complete',
    source: 'google_ads_script', source_ref: 'history_' + chunk.from + '_' + chunk.to, days: days };
}

function evlineAccountingHistory(options) {
  options = options || {};
  var mode = options.mode || 'discover';
  if (['discover', 'preview', 'apply'].indexOf(mode) < 0) throw new Error('history_invalid_mode');
  var account = AdsApp.currentAccount();
  if (String(account.getCustomerId()).replace(/-/g, '') !== '4028488894' ||
      account.getCurrencyCode() !== 'UAH' || ['Europe/Kiev', 'Europe/Kyiv'].indexOf(account.getTimeZone()) < 0) {
    throw new Error('history_wrong_account_currency_timezone');
  }
  var discovery = evlineHistoryDiscover(account);
  if (mode === 'discover') return discovery;
  if (discovery.needs_monthly_history) throw new Error('history_requires_monthly_storage_do_not_zero_fill');
  if (mode === 'apply' && (options.confirm_from !== discovery.from || options.confirm_to !== discovery.to)) throw new Error('history_exact_range_confirmation_required');
  var chunks = evlineHistoryChunks(discovery.from, discovery.to);
  var fetchedAt = new Date().toISOString();
  // Finish every source query before the first write. A later HTTP error may
  // leave earlier chunks accepted; each chunk is independently safe to retry.
  var payloads = chunks.map(function(chunk) { return evlineHistoryPayload(chunk, account, fetchedAt); });
  var totalMinor = payloads.reduce(function(total, payload) {
    return total + payload.days.reduce(function(sum, day) { return sum + day.spend_minor; }, 0);
  }, 0);
  var totalDays = payloads.reduce(function(total, payload) { return total + payload.days.length; }, 0);
  var summary = { from: discovery.from, to: discovery.to, chunks: payloads.length, days: totalDays, spend_minor: totalMinor };
  if (mode !== 'apply' || AdsApp.getExecutionInfo().isPreview()) {
    Logger.log('EVLINE_HISTORY_PREVIEW=' + JSON.stringify(summary));
    return summary;
  }
  if (typeof SYNC_TOKEN !== 'string' || !SYNC_TOKEN.trim()) throw new Error('history_sync_token_missing');
  var receipts = [];
  payloads.forEach(function(payload) {
    var response = UrlFetchApp.fetch('https://evline.com.ua/api/google-ads/accounting', {
      method: 'post', contentType: 'application/json', followRedirects: false,
      headers: { Authorization: 'Bearer ' + SYNC_TOKEN }, payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) throw new Error('history_import_http_' + response.getResponseCode());
    var receipt;
    try { receipt = JSON.parse(response.getContentText()); } catch (_) { throw new Error('history_invalid_receipt'); }
    if (receipt.ok !== true || !/^[a-f0-9]{64}$/.test(receipt.run_id || '') || receipt.days_received !== payload.days.length || !Number.isInteger(receipt.days_imported) || receipt.days_imported < 0 || receipt.days_imported > payload.days.length) throw new Error('history_invalid_receipt');
    var safe = { from: payload.from, to: payload.to, run_id: receipt.run_id, days_received: receipt.days_received, days_imported: receipt.days_imported };
    receipts.push(safe);
    Logger.log('EVLINE_HISTORY_SAVED=' + JSON.stringify(safe));
  });
  summary.receipts = receipts;
  Logger.log('EVLINE_HISTORY_COMPLETE=' + JSON.stringify(summary));
  return summary;
}
