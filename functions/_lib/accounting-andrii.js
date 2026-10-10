import { ACCOUNTING_TIMEZONE, accountingDay, accountingRange, readAccounting } from './accounting.js';
import { readIgorGoogleAllocation } from './accounting-igor.js';

const PROVIDERS = ['google', 'meta'];
const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const sum = values => {
  const result = values.reduce((total, value) => total + BigInt(value), 0n);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw fail('accounting_andrii_total_out_of_range', 503);
  return Number(result);
};

function minorAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const minor = Math.round(value * 100);
  if (!Number.isSafeInteger(minor)) throw fail('accounting_andrii_invalid_amount', 503);
  return minor;
}

function summarize(daily) {
  const result = { providers: {} };
  for (const provider of PROVIDERS) {
    const present = daily.filter(row => row[`${provider}_minor`] !== null);
    const complete = daily.filter(row => row[`${provider}_coverage`] === 'complete');
    const status = daily.length && complete.length === daily.length ? 'complete' : present.length ? 'partial' : 'missing';
    const known = present.length ? sum(present.map(row => row[`${provider}_minor`])) : null;
    result.providers[provider] = { status, days_present: present.length, days_complete: complete.length, days_expected: daily.length };
    result[`${provider}_known_minor`] = known;
    result[`${provider}_minor`] = status === 'complete' ? known : null;
  }
  result.coverage = PROVIDERS.every(provider => result.providers[provider].status === 'complete') ? 'complete'
    : PROVIDERS.every(provider => result.providers[provider].status === 'missing') ? 'missing' : 'partial';
  result.total_minor = result.coverage === 'complete' ? sum(PROVIDERS.map(provider => result[`${provider}_minor`])) : null;
  const known = PROVIDERS.map(provider => result[`${provider}_known_minor`]).filter(value => value !== null);
  result.known_total_minor = known.length ? sum(known) : null;
  return result;
}

/** Read-only advertising report, not a multi-month commission calculation.
 * Selected bounds are inclusive Kyiv dates; unfinished today is explicitly
 * clipped. Google account facts include Romania, so mapped Romanian costs are
 * removed only on fully reconciled days. Meta facts already belong solely to
 * the approved EVLine campaign and never include Romania's separate campaigns.
 * Missing/partial shares never become zero or a falsely definitive total.
 */
export async function readAndriiAdvertising(db, { from, to, now = new Date(), accountingReader = readAccounting, allocationReader = readIgorGoogleAllocation } = {}) {
  if (!from || !to) throw fail('accounting_range_requires_both_dates');
  const requested = accountingRange(from, to, now, { maxDays: 1827 });
  const today = accountingDay(now);
  const yesterday = new Date(Date.parse(`${today}T00:00:00.000Z`) - 86400000).toISOString().slice(0, 10);
  const end = to < yesterday ? to : yesterday;
  const hasCompletedDays = from <= end;
  const range = hasCompletedDays ? accountingRange(from, end, now, { maxDays: 1827 }) : { dates: [] };
  let daily = [], allocationStatus = 'not_active', excluded = 0;
  if (hasCompletedDays) {
    const [report, allocation] = await Promise.all([
      accountingReader(db, { from, to: end, now }),
      allocationReader(db, { from, to: end, now }),
    ]);
    const mainDays = new Map(report.daily.map(row => [row.date, row]));
    const allocationRows = Array.isArray(allocation.daily) ? allocation.daily : [];
    const allocationDays = new Map(allocationRows.map(row => [row.date, row]));
    const emptyActiveAllocation = allocation.active && allocationRows.length === 0;
    const validCompleteShares = allocationRows.every(row => row.coverage === 'complete'
      && Number.isSafeInteger(row.spend_minor) && row.spend_minor >= 0);
    const contradictoryCompleteAllocation = allocation.active && allocation.coverage === 'complete'
      && (!validCompleteShares || allocationDays.size !== allocationRows.length
        || !Number.isSafeInteger(allocation.total_minor) || allocation.total_minor < 0
        || allocation.total_minor !== sum(allocationRows.map(row => row.spend_minor)));
    let allocationValid = allocation.coverage === 'complete';
    const excludedDays = [];
    daily = range.dates.map(date => {
      const source = mainDays.get(date), row = { date };
      for (const provider of PROVIDERS) {
        row[`${provider}_minor`] = minorAmount(source?.[`${provider}_uah`]);
        row[`${provider}_coverage`] = row[`${provider}_minor`] === null ? 'missing'
          : source?.[`${provider}_coverage`] === 'complete' ? 'complete' : 'partial';
      }
      const share = allocationDays.get(date);
      if (allocation.active && share) {
        const reconciled = row.google_coverage === 'complete' && share.coverage === 'complete'
          && Number.isSafeInteger(share.spend_minor) && share.spend_minor >= 0 && share.spend_minor <= row.google_minor;
        if (reconciled) {
          row.google_minor -= share.spend_minor;
          excludedDays.push(share.spend_minor);
        } else {
          row.google_minor = null;
          row.google_coverage = 'missing';
          allocationValid = false;
        }
      }
      return row;
    });
    if (allocation.active) {
      // The allocation reader emits every active campaign day, including null
      // placeholders for missing receipts. Require a consistent total as well.
      excluded = sum(excludedDays);
      allocationValid &&= Number.isSafeInteger(allocation.total_minor) && allocation.total_minor === excluded;
      allocationStatus = allocationValid ? 'complete' : 'incomplete';
      if (!allocationValid) {
        excluded = null;
      }
      // An active allocation without daily rows gives no trustworthy dates to
      // exempt, so all Google days fail closed. A contradictory complete total
      // invalidates every mapped day, even if unrelated days were also missing.
      // Ordinary partial receipts can retain individually reconciled days.
      if (emptyActiveAllocation || contradictoryCompleteAllocation) {
        allocationStatus = 'incomplete'; excluded = null;
        for (const row of daily) if (emptyActiveAllocation || allocationDays.has(row.date)) {
          row.google_minor = null; row.google_coverage = 'missing';
        }
      }
    }
  }
  const months = new Map();
  for (const row of daily) {
    const key = row.date.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(row);
  }
  return {
    scope: 'andrii', currency: 'UAH', timezone: ACCOUNTING_TIMEZONE,
    from: requested.from, to: requested.to, requested_from: requested.from, requested_to: requested.to,
    effective_from: hasCompletedDays ? from : null, effective_to: hasCompletedDays ? end : null,
    through: hasCompletedDays ? end : null,
    is_provisional: requested.to === today,
    ...summarize(daily), igor_allocation: allocationStatus, igor_google_excluded_minor: excluded,
    daily, monthly: [...months].map(([month, rows]) => ({ month, from: rows[0].date, to: rows.at(-1).date, ...summarize(rows) })),
  };
}
