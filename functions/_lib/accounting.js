import { buildAccountingReportStatements } from './accounting-reports.js';

export const ACCOUNTING_TIMEZONE = 'Europe/Kyiv';
export const ACCOUNTING_ACCOUNTS = Object.freeze({ google: '4028488894', meta: '1354524650161143' });
// This Meta account is shared with another business. Its full-account total is
// NEVER EVLine expense. Expand this explicit policy only after owner review.
export const ACCOUNTING_META_SCOPE = Object.freeze({
  account_id: '1354524650161143', scope: 'campaign',
  campaign_ids: Object.freeze(['120251518463770454']),
  source_ref: 'evline_campaign_120251518463770454',
});
const META_ACCOUNTING_SOURCES = new Set(['meta_insights', 'meta_ads_manager_csv']);
const MAX_DAYS = 366;
const MAX_REPORT_DAYS = 1827;
const MAX_MINOR = 100000000000; // 1 billion UAH per account/day; fail on unsafe inputs.
const DAY_MS = 86400000;

function fail(code, status = 400) {
  const error = new Error(code);
  error.status = status;
  return error;
}

export function validAccountingDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function accountingDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw fail('invalid_accounting_time');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ACCOUNTING_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function shiftDay(value, offset) {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

function dateSequence(from, to, maxDays = MAX_DAYS) {
  if (!validAccountingDate(from) || !validAccountingDate(to) || from > to) throw fail('invalid_accounting_range');
  const length = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
  if (length > maxDays) throw fail('accounting_range_too_large');
  return Array.from({ length }, (_, index) => shiftDay(from, index));
}

export function accountingRange(from, to, now = new Date(), { maxDays = MAX_DAYS } = {}) {
  if ((from == null) !== (to == null)) throw fail('accounting_range_requires_both_dates');
  const today = accountingDay(now);
  const end = to ?? shiftDay(today, -1);
  const start = from ?? shiftDay(end, -29);
  const dates = dateSequence(start, end, maxDays);
  if (end > today) throw fail('future_accounting_date');
  return { from: start, to: end, dates };
}

function isoTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw fail('invalid_fetched_at');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw fail('invalid_fetched_at');
  return value;
}

function safeSource(value, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(value)) throw fail('invalid_import_source');
  return value;
}

/** Canonical integration contract: provider/account, UAH, Kyiv account timezone,
 * inclusive from/to, fetched_at ISO UTC, scope account|campaign, coverage
 * complete|partial, source safe identifier, optional source_ref safe identifier,
 * and days [{date,spend_minor,is_final}]. Money is integer kopecks, never float.
 * Complete means every requested day including explicit zeros and the approved
 * BUSINESS scope: all of Google account4028488894, but only the fixed EVLine
 * campaign in shared Meta account1354524650161143. Meta account totals are
 * rejected, not merely marked partial. A current day is permitted only as
 * nonfinal. No names, tokens or raw payloads accepted.
 */
export function validateAdSpendSnapshot(input, { now = new Date() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('invalid_snapshot');
  const account = ACCOUNTING_ACCOUNTS[input.provider];
  if (!account || input.account_id !== account) throw fail('invalid_ads_account');
  if (input.currency !== 'UAH') throw fail('invalid_ads_currency');
  if (!['Europe/Kyiv', 'Europe/Kiev'].includes(input.timezone)) throw fail('invalid_ads_timezone');
  if (!['account', 'campaign'].includes(input.scope) || !['complete', 'partial'].includes(input.coverage)) throw fail('invalid_ads_coverage');
  if (input.provider === 'meta') {
    if (input.scope !== ACCOUNTING_META_SCOPE.scope || input.source_ref !== ACCOUNTING_META_SCOPE.source_ref || !META_ACCOUNTING_SOURCES.has(input.source)) throw fail('invalid_meta_business_scope');
  } else if (input.coverage === 'complete' && input.scope !== 'account') throw fail('complete_requires_account_scope');
  const { dates } = accountingRange(input.from, input.to, now);
  // Unlike read defaults, imports must always declare an explicit period.
  if (!input.from || !input.to) throw fail('snapshot_period_required');
  const fetchedAt = isoTime(input.fetched_at);
  if (Date.parse(fetchedAt) > new Date(now).getTime() + 300000) throw fail('future_fetched_at');
  if (Date.parse(fetchedAt) < new Date(now).getTime() - 3 * DAY_MS) throw fail('stale_snapshot');
  if (!Array.isArray(input.days) || input.days.length < 1 || input.days.length > MAX_DAYS) throw fail('invalid_snapshot_days');
  const allowed = new Set(dates);
  const seen = new Set();
  const today = accountingDay(now);
  const fetchedDay = accountingDay(fetchedAt);
  const days = input.days.map(row => {
    if (!row || typeof row !== 'object' || !allowed.has(row.date) || seen.has(row.date)) throw fail('invalid_or_duplicate_snapshot_day');
    if (!Number.isSafeInteger(row.spend_minor) || row.spend_minor < 0 || row.spend_minor > MAX_MINOR) throw fail('invalid_spend_minor');
    if (typeof row.is_final !== 'boolean' || (row.date === today && row.is_final)) throw fail('invalid_final_day');
    if (row.date > fetchedDay || (row.is_final && row.date >= fetchedDay)) throw fail('snapshot_precedes_data');
    seen.add(row.date);
    return { date: row.date, spend_minor: row.spend_minor, is_final: row.is_final };
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (input.coverage === 'complete' && seen.size !== allowed.size) throw fail('incomplete_account_snapshot');
  return {
    provider: input.provider, account_id: account, currency: 'UAH', timezone: ACCOUNTING_TIMEZONE,
    from: input.from, to: input.to, fetched_at: fetchedAt, scope: input.scope,
    coverage: input.coverage, source: safeSource(input.source), source_ref: safeSource(input.source_ref, true), days,
  };
}

async function snapshotId(snapshot) {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}

/** Atomic bounded import, duplicate retry safe, stale/equal timestamps never
 * overwrite a stored day. A partial/campaign snapshot cannot downgrade a
 * complete account fact even when fetched later. Returns actual changed days.
 */
export async function persistAdSpendSnapshot(db, input, { now = new Date() } = {}) {
  const snapshot = validateAdSpendSnapshot(input, { now });
  if (!db || typeof db.batch !== 'function') throw fail('accounting_storage_unavailable', 503);
  const runId = await snapshotId(snapshot);
  const statements = [db.prepare(`INSERT INTO accounting_import_runs
    (run_id, provider, account_id, date_from, date_to, fetched_at, imported_at, scope, coverage, source, source_ref, days_received, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted') ON CONFLICT(run_id) DO NOTHING`)
    .bind(runId, snapshot.provider, snapshot.account_id, snapshot.from, snapshot.to, snapshot.fetched_at, new Date(now).toISOString(), snapshot.scope, snapshot.coverage, snapshot.source, snapshot.source_ref, snapshot.days.length)];
  for (const day of snapshot.days) {
    statements.push(db.prepare(`INSERT INTO accounting_ad_daily
      (provider, account_id, stat_date, spend_minor, currency, timezone, scope, coverage, is_final, fetched_at, source, source_ref, run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, account_id, stat_date) DO UPDATE SET
        spend_minor=excluded.spend_minor, currency=excluded.currency, timezone=excluded.timezone,
        scope=excluded.scope, coverage=excluded.coverage, is_final=excluded.is_final,
        fetched_at=excluded.fetched_at, source=excluded.source, source_ref=excluded.source_ref, run_id=excluded.run_id
      WHERE excluded.fetched_at > accounting_ad_daily.fetched_at
        AND NOT (accounting_ad_daily.coverage='complete' AND excluded.coverage='partial')
        AND NOT (accounting_ad_daily.is_final=1 AND excluded.is_final=0)`)
      .bind(snapshot.provider, snapshot.account_id, day.date, day.spend_minor, 'UAH', ACCOUNTING_TIMEZONE,
        snapshot.scope, snapshot.coverage, day.is_final ? 1 : 0, snapshot.fetched_at, snapshot.source, snapshot.source_ref, runId));
  }
  // Archive only the validated, allowlisted data—not arbitrary request fields
  // or credentials. Evidence and spend are saved in the same transaction.
  const report = await buildAccountingReportStatements(db, snapshot, runId, { now });
  statements.push(...report.statements);
  const results = await db.batch(statements);
  return { ok: true, run_id: runId, days_received: snapshot.days.length,
    days_imported: results.slice(1, 1 + snapshot.days.length).reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0) };
}

/** A sanitized failed attempt never changes known spend or invents a zero day. */
export async function recordAdSpendImportFailure(db, input, { now = new Date() } = {}) {
  const account = ACCOUNTING_ACCOUNTS[input?.provider];
  if (!account) throw fail('invalid_ads_account');
  if (!input.from || !input.to) throw fail('snapshot_period_required');
  accountingRange(input.from, input.to, now);
  const source = safeSource(input.source);
  if (input.provider === 'meta' && !META_ACCOUNTING_SOURCES.has(source)) throw fail('invalid_meta_business_scope');
  const code = String(input.error_code || 'import_failed');
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(code)) throw fail('invalid_import_error');
  const timestamp = new Date(now).toISOString();
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO accounting_import_runs
    (run_id, provider, account_id, date_from, date_to, fetched_at, imported_at, scope, coverage, source, source_ref, days_received, status, error_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'partial', ?, ?, 0, 'failed', ?)`)
    .bind(id, input.provider, account, input.from, input.to, timestamp, timestamp,
      input.provider === 'meta' ? ACCOUNTING_META_SCOPE.scope : 'account', source,
      input.provider === 'meta' ? ACCOUNTING_META_SCOPE.source_ref : '', code).run();
  return { ok: true, run_id: id };
}

function finiteMinor(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value * 100 > MAX_MINOR) return null;
  return Math.round((value + Number.EPSILON) * 100);
}

/** Historical campaign rows only. Manual rows and keyword/search-term grains
 * never enter accounting. Exact provider/customer/currency notes are required.
 * Dedupe each date/campaign to newest import; the result remains partial because
 * historical rows have no whole-account coverage receipt. */
export function legacyGoogleDays(rows) {
  const campaigns = new Map();
  for (const row of rows) {
    const notes = typeof row.notes === 'string' ? row.notes : '';
    if (row.platform !== 'google' || row.source !== 'google' || row.medium !== 'cpc' || !notes.startsWith('Google Ads sync: ')) continue;
    // Account and campaign are the fixed leading fields. Never let a campaign
    // name containing semicolons impersonate or override the account field.
    const identity = /^Google Ads sync: customerId=([0-9-]+); campaignId=(\d+); campaignName=/.exec(notes);
    if (!identity || identity[1].replace(/-/g, '') !== ACCOUNTING_ACCOUNTS.google) continue;
    const fields = Object.fromEntries(notes.slice(17).split('; ').map(part => {
      const index = part.indexOf('=');
      return index >= 0 ? [part.slice(0, index), part.slice(index + 1)] : ['', ''];
    }));
    if (fields.currency !== 'UAH') continue;
    if (fields.adGroupId !== '-' || fields.criterionId !== '-' || fields.keyword !== '-' || fields.searchTerm !== '-') continue;
    if (!validAccountingDate(row.cost_date)) continue;
    const spendMinor = finiteMinor(row.spend_uah);
    if (spendMinor === null) continue;
    const timestamp = row.updated_at || row.created_at;
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) continue;
    const key = `${row.cost_date}:${identity[2]}`;
    const previous = campaigns.get(key);
    if (!previous || timestamp > previous.updated_at) campaigns.set(key, { date: row.cost_date, spend_minor: spendMinor, updated_at: timestamp });
    else if (timestamp === previous.updated_at && spendMinor !== previous.spend_minor) previous.ambiguous = true;
  }
  const days = new Map();
  for (const item of campaigns.values()) {
    const day = days.get(item.date) || { spend_minor: 0, updated_at: null, ambiguous: false };
    day.spend_minor += item.spend_minor;
    day.ambiguous ||= Boolean(item.ambiguous);
    if (!day.updated_at || item.updated_at > day.updated_at) day.updated_at = item.updated_at;
    days.set(item.date, day);
  }
  return days;
}

/** Output contains aggregates only. Incoming orders include subsequently
 * canceled orders: this is intake volume, never payments or causal attribution.
 * Existing synthetic source codex_qa is excluded. No revenue/profit is guessed.
 */
export function buildAccountingReport({ from, to, canonical = [], legacy = [], orders = [], runs = [], now = new Date() }) {
  const range = accountingRange(from, to, now, { maxDays: MAX_REPORT_DAYS });
  const dates = new Set(range.dates);
  const byProvider = { google: new Map(), meta: new Map() };
  for (const row of canonical) {
    if (row.account_id !== ACCOUNTING_ACCOUNTS[row.provider] || !byProvider[row.provider] || !dates.has(row.stat_date)) continue;
    if (row.currency !== 'UAH' || row.timezone !== ACCOUNTING_TIMEZONE || !Number.isSafeInteger(row.spend_minor) || row.spend_minor < 0) continue;
    if (row.provider === 'meta' && !isMetaBusinessRow(row)) continue;
    byProvider[row.provider].set(row.stat_date, row);
  }
  const fallback = legacyGoogleDays(legacy);
  const counts = new Map();
  for (const order of orders) {
    if (String(order.source || '').trim().toLowerCase() === 'codex_qa') continue;
    let date;
    try { date = accountingDay(order.created_at); } catch { continue; }
    if (dates.has(date)) counts.set(date, (counts.get(date) || 0) + 1);
  }
  const totalsMinor = { google: 0, meta: 0 };
  const sources = Object.fromEntries(['google', 'meta'].map(provider => [provider, { status: 'missing', updated_at: null, days_present: 0, days_expected: range.dates.length, days_complete: 0 }]));
  sources.google.scope = 'account';
  sources.meta.scope = ACCOUNTING_META_SCOPE.scope;
  sources.meta.source_ref = ACCOUNTING_META_SCOPE.source_ref;
  sources.meta.campaign_ids = [...ACCOUNTING_META_SCOPE.campaign_ids];
  const daily = range.dates.map(date => {
    const result = { date, google_uah: null, meta_uah: null,
      google_coverage: 'missing', meta_coverage: 'missing', orders: counts.get(date) || 0 };
    for (const provider of ['google', 'meta']) {
      const row = byProvider[provider].get(date);
      const historic = !row && provider === 'google' ? fallback.get(date) : null;
      if (!row && (!historic || historic.ambiguous)) continue;
      const minor = row ? row.spend_minor : historic.spend_minor;
      const updatedAt = row ? row.fetched_at : historic.updated_at;
      result[`${provider}_uah`] = minor / 100;
      const complete = row?.coverage === 'complete' && Number(row.is_final) === 1 &&
        (provider === 'meta' ? isMetaBusinessRow(row) : row.scope === 'account');
      result[`${provider}_coverage`] = complete ? 'complete' : 'partial';
      totalsMinor[provider] += minor;
      sources[provider].days_present += 1;
      if (complete) sources[provider].days_complete += 1;
      if (!sources[provider].updated_at || updatedAt > sources[provider].updated_at) sources[provider].updated_at = updatedAt;
    }
    return result;
  });
  for (const source of Object.values(sources)) {
    source.status = source.days_complete === source.days_expected ? 'complete' : source.days_present ? 'partial' : 'missing';
  }
  for (const provider of ['google', 'meta']) {
    const latest = runs.filter(run => run.provider === provider && run.account_id === ACCOUNTING_ACCOUNTS[provider] &&
      (provider !== 'meta' || isMetaBusinessRow(run)))
      .sort((a, b) => String(b.imported_at).localeCompare(String(a.imported_at)))[0];
    sources[provider].last_attempt_at = latest?.imported_at || null;
    sources[provider].last_error = latest?.status === 'failed' && /^[a-z][a-z0-9_]{0,63}$/.test(latest.error_code || '') ? latest.error_code : null;
  }
  return { currency: 'UAH', timezone: ACCOUNTING_TIMEZONE, from: range.from, to: range.to, daily,
    monthly: aggregateAccountingMonths(daily),
    totals: { google_uah: sources.google.days_present ? totalsMinor.google / 100 : null,
      meta_uah: sources.meta.days_present ? totalsMinor.meta / 100 : null,
      orders: daily.reduce((sum, day) => sum + day.orders, 0) }, sources };
}

function isMetaBusinessRow(row) {
  return row.scope === ACCOUNTING_META_SCOPE.scope && row.source_ref === ACCOUNTING_META_SCOPE.source_ref && META_ACCOUNTING_SOURCES.has(row.source);
}

/** Calendar-month rollup over the selected days only. An incomplete first/last
 * calendar month has explicit from/to boundaries; days_expected counts those
 * selected days, not days outside the requested window. Unknown is never zero,
 * and a known partial sum is accompanied by coverage and day counters.
 */
export function aggregateAccountingMonths(daily) {
  const months = new Map();
  for (const day of daily) {
    const month = day.date.slice(0, 7);
    let row = months.get(month);
    if (!row) {
      row = { month, from: day.date, to: day.date, google_minor: 0, meta_minor: 0,
        google_days_present: 0, google_days_complete: 0, meta_days_present: 0,
        meta_days_complete: 0, days_expected: 0, orders: 0 };
      months.set(month, row);
    }
    if (day.date < row.from) row.from = day.date;
    if (day.date > row.to) row.to = day.date;
    row.days_expected += 1;
    row.orders += day.orders;
    for (const provider of ['google', 'meta']) {
      const amount = day[`${provider}_uah`];
      if (amount === null || amount === undefined) continue;
      row[`${provider}_minor`] += Math.round(amount * 100);
      row[`${provider}_days_present`] += 1;
      if (day[`${provider}_coverage`] === 'complete') row[`${provider}_days_complete`] += 1;
    }
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map(row => {
    const result = { ...row };
    for (const provider of ['google', 'meta']) {
      result[`${provider}_uah`] = row[`${provider}_days_present`] ? row[`${provider}_minor`] / 100 : null;
      result[`${provider}_coverage`] = row[`${provider}_days_complete`] === row.days_expected
        ? 'complete' : row[`${provider}_days_present`] ? 'partial' : 'missing';
      delete result[`${provider}_minor`];
    }
    return result;
  });
}

export async function readAccounting(db, { from, to, range: selection, now = new Date() } = {}) {
  let rangeLimited = false;
  if (selection === 'all') {
    if (from != null) throw fail('all_range_does_not_accept_from');
    to = to ?? shiftDay(accountingDay(now), -1);
    accountingRange(to, to, now);
    // Only the lower bound is discovered; no personal values leave this helper.
    const first = await db.prepare(`SELECT MIN(day) AS day FROM (
      SELECT MIN(stat_date) AS day FROM accounting_ad_daily WHERE provider='google' OR
        (provider='meta' AND scope='campaign' AND source_ref='evline_campaign_120251518463770454' AND source IN ('meta_insights','meta_ads_manager_csv'))
      UNION ALL SELECT MIN(cost_date) AS day FROM ad_costs WHERE platform='google' AND source='google' AND medium='cpc' AND notes LIKE 'Google Ads sync:%'
      UNION ALL SELECT substr(MIN(created_at), 1, 10) AS day FROM orders WHERE lower(trim(COALESCE(source, ''))) <> 'codex_qa'
    )`).all();
    const earliest = first.results?.[0]?.day;
    const floor = shiftDay(to, -(MAX_REPORT_DAYS - 1));
    rangeLimited = Boolean(validAccountingDate(earliest) && earliest < floor);
    from = validAccountingDate(earliest) ? (earliest < floor ? floor : earliest) : shiftDay(to, -29);
    if (from > to) from = to;
  }
  const range = accountingRange(from, to, now, { maxDays: MAX_REPORT_DAYS });
  // Wide UTC prefilter, then exact DST-aware Kyiv day grouping in JS. Select no
  // CRM personal fields. No LIMIT 200 truncation of campaign rows or orders.
  const utcFrom = `${shiftDay(range.from, -1)}T00:00:00.000Z`;
  const utcTo = `${shiftDay(range.to, 1)}T00:00:00.000Z`;
  const [canonical, legacy, orders, runs] = await Promise.all([
    db.prepare('SELECT provider, account_id, stat_date, spend_minor, currency, timezone, scope, coverage, is_final, fetched_at, source, source_ref FROM accounting_ad_daily WHERE stat_date >= ? AND stat_date <= ?').bind(range.from, range.to).all(),
    db.prepare("SELECT cost_date, platform, source, medium, spend_uah, notes, updated_at, created_at FROM ad_costs WHERE cost_date >= ? AND cost_date <= ? AND platform='google' AND source='google' AND medium='cpc' AND notes LIKE 'Google Ads sync:%'").bind(range.from, range.to).all(),
    db.prepare("SELECT created_at FROM orders WHERE created_at >= ? AND created_at < ? AND lower(trim(COALESCE(source, ''))) <> 'codex_qa'").bind(utcFrom, utcTo).all(),
    db.prepare(`SELECT r.provider, r.account_id, r.imported_at, r.status, r.error_code, r.scope, r.source, r.source_ref FROM accounting_import_runs r
      WHERE r.date_from <= ? AND r.date_to >= ? AND r.run_id = (
        SELECT latest.run_id FROM accounting_import_runs latest WHERE latest.provider=r.provider AND latest.account_id=r.account_id
        AND (latest.provider <> 'meta' OR (latest.scope='campaign' AND latest.source_ref='evline_campaign_120251518463770454' AND latest.source IN ('meta_insights', 'meta_ads_manager_csv')))
        AND latest.date_from <= ? AND latest.date_to >= ? ORDER BY latest.imported_at DESC, latest.rowid DESC LIMIT 1
      )`).bind(range.to, range.from, range.to, range.from).all(),
  ]);
  return { ...buildAccountingReport({ ...range, canonical: canonical.results || [], legacy: legacy.results || [], orders: orders.results || [], runs: runs.results || [], now }), range_limited: rangeLimited };
}
