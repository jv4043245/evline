import { ACCOUNTING_ACCOUNTS, ACCOUNTING_TIMEZONE, accountingDay, accountingRange, validAccountingDate } from './accounting.js';

export const IGOR_MAX_MINOR = 100000000000;
const DAY_MS = 86400000;
const PROVIDERS = ['google', 'meta'];
const SOURCE_BY_PROVIDER = { google: ['google_ads_script'], meta: ['meta_insights', 'meta_ads_manager_csv'] };
const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const safeSum = values => {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw fail('accounting_igor_total_out_of_range', 503);
  return Number(total);
};
const identity = row => `${row.provider}:${row.account_id}:${row.campaign_id}`;
const active = (campaign, date) => campaign.starts_on <= date && (!campaign.ends_on || campaign.ends_on >= date);

function validCampaign(row) {
  return PROVIDERS.includes(row.provider) && row.account_id === ACCOUNTING_ACCOUNTS[row.provider]
    && /^\d{1,30}$/.test(row.campaign_id) && validAccountingDate(row.starts_on)
    && (row.ends_on === null || validAccountingDate(row.ends_on) && row.ends_on >= row.starts_on)
    && (row.provider !== 'meta' || !['120251518463770454', '120252865188010454'].includes(row.campaign_id));
}

/** Isolated campaign receipt. It is NEVER inserted into or added onto the
 * account-total ledger. Credentials, URL heuristics, PII and arbitrary request
 * fields are not retained. A missing day is only zero when explicitly exported.
 */
export function validateIgorCampaignSnapshot(input, { now = new Date() } = {}) {
  if (!exactKeys(input, ['provider', 'account_id', 'campaign_id', 'currency', 'timezone', 'from', 'to', 'fetched_at', 'coverage', 'source', 'days'])) throw fail('accounting_igor_invalid_snapshot');
  if (!PROVIDERS.includes(input.provider) || input.account_id !== ACCOUNTING_ACCOUNTS[input.provider]
      || typeof input.campaign_id !== 'string' || !/^\d{1,30}$/.test(input.campaign_id)
      || input.currency !== 'UAH' || !['Europe/Kyiv', 'Europe/Kiev'].includes(input.timezone)
      || !['complete', 'partial'].includes(input.coverage) || !SOURCE_BY_PROVIDER[input.provider].includes(input.source)) throw fail('accounting_igor_invalid_snapshot');
  if (!input.from || !input.to) throw fail('accounting_igor_invalid_range');
  let range;
  try { range = accountingRange(input.from, input.to, now); } catch { throw fail('accounting_igor_invalid_range'); }
  const fetched = new Date(input.fetched_at);
  if (typeof input.fetched_at !== 'string' || !Number.isFinite(fetched.getTime()) || fetched.toISOString() !== input.fetched_at
      || fetched.getTime() > new Date(now).getTime() + 300000 || fetched.getTime() < new Date(now).getTime() - 3 * DAY_MS) throw fail('accounting_igor_invalid_fetched_at');
  if (!Array.isArray(input.days) || !input.days.length || input.days.length > 366) throw fail('accounting_igor_invalid_days');
  const seen = new Set(), allowed = new Set(range.dates), fetchedDay = accountingDay(fetched), today = accountingDay(now);
  const days = input.days.map(row => {
    if (!exactKeys(row, ['date', 'spend_minor', 'is_final']) || !allowed.has(row.date) || seen.has(row.date)
        || !Number.isSafeInteger(row.spend_minor) || row.spend_minor < 0 || row.spend_minor > IGOR_MAX_MINOR
        || typeof row.is_final !== 'boolean' || row.date > fetchedDay || row.is_final && (row.date >= fetchedDay || row.date >= today)) throw fail('accounting_igor_invalid_days');
    seen.add(row.date);
    return { date: row.date, spend_minor: row.spend_minor, is_final: row.is_final };
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (input.coverage === 'complete' && seen.size !== allowed.size) throw fail('accounting_igor_incomplete_snapshot');
  return { ...input, timezone: ACCOUNTING_TIMEZONE, days };
}

export async function persistIgorCampaignSnapshot(db, input, { now = new Date() } = {}) {
  const snapshot = validateIgorCampaignSnapshot(input, { now });
  const found = await db.prepare('SELECT provider,account_id,campaign_id,starts_on,ends_on FROM accounting_igor_campaigns WHERE provider=? AND account_id=? AND campaign_id=?')
    .bind(snapshot.provider, snapshot.account_id, snapshot.campaign_id).all();
  const campaign = found.results?.[0];
  if (!campaign || !validCampaign(campaign)) throw fail('accounting_igor_campaign_not_configured');
  if (!active(campaign, snapshot.from) || !active(campaign, snapshot.to)) throw fail('accounting_igor_outside_campaign_period');
  const snapshotJson = JSON.stringify(snapshot);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshotJson)));
  const runId = [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
  const statements = [db.prepare(`INSERT INTO accounting_igor_import_runs
    (run_id,provider,account_id,campaign_id,date_from,date_to,fetched_at,imported_at,coverage,source,snapshot_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO NOTHING`).bind(runId, snapshot.provider, snapshot.account_id,
      snapshot.campaign_id, snapshot.from, snapshot.to, snapshot.fetched_at, new Date(now).toISOString(), snapshot.coverage, snapshot.source, snapshotJson)];
  for (const day of snapshot.days) statements.push(db.prepare(`INSERT INTO accounting_igor_campaign_daily
    (provider,account_id,campaign_id,stat_date,spend_minor,coverage,is_final,fetched_at,run_id)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,account_id,campaign_id,stat_date) DO UPDATE SET
      spend_minor=excluded.spend_minor,coverage=excluded.coverage,is_final=excluded.is_final,fetched_at=excluded.fetched_at,run_id=excluded.run_id
    WHERE excluded.fetched_at>accounting_igor_campaign_daily.fetched_at
      AND NOT(accounting_igor_campaign_daily.coverage='complete' AND excluded.coverage='partial')
      AND NOT(accounting_igor_campaign_daily.is_final=1 AND excluded.is_final=0)`)
    .bind(snapshot.provider, snapshot.account_id, snapshot.campaign_id, day.date, day.spend_minor, snapshot.coverage, day.is_final ? 1 : 0, snapshot.fetched_at, runId));
  const results = await db.batch(statements);
  return { ok: true, run_id: runId, days_received: snapshot.days.length, days_imported: results.slice(1).reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0) };
}

/** This reports only reviewed Romania campaign facts. With no configuration,
 * null means not launched/configured, never an assumed zero reimbursement.
 */
export async function readIgorAdvertising(db, { from, to, now = new Date() }) {
  // Read-only range reports may span the same five-year window as the main
  // ledger. Snapshot imports still retain their independent 366-day limit.
  const range = accountingRange(from, to, now, { maxDays: 1827 });
  const [mapped, confirmed, facts] = await Promise.all([
    db.prepare('SELECT provider,account_id,campaign_id,starts_on,ends_on FROM accounting_igor_campaigns ORDER BY provider,campaign_id').all(),
    db.prepare('SELECT provider,date_from,date_to FROM accounting_igor_no_spend_periods WHERE date_from<=? AND date_to>=?').bind(to, from).all(),
    db.prepare('SELECT provider,account_id,campaign_id,stat_date,spend_minor,coverage,is_final FROM accounting_igor_campaign_daily WHERE stat_date>=? AND stat_date<=?').bind(from, to).all(),
  ]);
  const campaigns = mapped.results || [], noSpend = confirmed.results || [];
  if (campaigns.some(row => !validCampaign(row))) throw fail('accounting_igor_configuration_invalid', 503);
  const factMap = new Map((facts.results || []).map(row => [`${identity(row)}:${row.stat_date}`, row]));
  const daily = range.dates.map(date => {
    const result = { date };
    for (const provider of PROVIDERS) {
      const relevant = campaigns.filter(row => row.provider === provider && active(row, date));
      const zeroConfirmed = noSpend.some(row => row.provider === provider && row.date_from <= date && row.date_to >= date);
      let coverage = 'missing', amount = null;
      if (relevant.length) {
        const rows = relevant.map(row => factMap.get(`${identity(row)}:${date}`));
        const known = rows.filter(row => row && Number.isSafeInteger(row.spend_minor) && row.spend_minor >= 0 && row.spend_minor <= IGOR_MAX_MINOR);
        if (known.length === rows.length && rows.every(row => row.coverage === 'complete' && Number(row.is_final) === 1)) {
          amount = safeSum(known.map(row => row.spend_minor)); coverage = 'complete';
        } else if (known.length) coverage = 'partial';
        // An active campaign always takes precedence over a no-spend statement.
      } else if (zeroConfirmed) { amount = 0; coverage = 'complete'; }
      result[`${provider}_minor`] = amount; result[`${provider}_coverage`] = coverage;
    }
    return result;
  });
  const providerStatus = {}, totals = {};
  for (const provider of PROVIDERS) {
    const configured = campaigns.some(row => row.provider === provider) || noSpend.some(row => row.provider === provider);
    const all = daily.every(row => row[`${provider}_coverage`] === 'complete');
    providerStatus[provider] = !configured ? 'not_configured' : all ? 'complete' : daily.some(row => row[`${provider}_coverage`] !== 'missing') ? 'partial' : 'missing';
    totals[`${provider}_minor`] = all ? safeSum(daily.map(row => row[`${provider}_minor`])) : null;
  }
  const complete = PROVIDERS.every(provider => providerStatus[provider] === 'complete');
  const coverage = complete ? 'complete' : PROVIDERS.every(provider => providerStatus[provider] === 'not_configured') ? 'not_configured'
    : PROVIDERS.some(provider => ['complete', 'partial'].includes(providerStatus[provider])) ? 'partial' : 'missing';
  return { ...totals, total_minor: complete ? safeSum(Object.values(totals)) : null, coverage, through: to,
    providers: providerStatus, campaigns, daily };
}

/** Google account totals already include Igor. Subtract his mapped share only
 * once, with complete campaign coverage. No mapping means no exclusion, leaving
 * all existing André months unchanged. Meta's separate campaign is not included
 * in the legacy EVLine Meta scope and must not be subtracted from that scope.
 */
export async function readIgorGoogleAllocation(db, { from, to, now = new Date() }) {
  const mapped = await db.prepare(`SELECT provider,account_id,campaign_id,starts_on,ends_on FROM accounting_igor_campaigns
    WHERE provider='google' AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?)`).bind(to, from).all();
  const campaigns = mapped.results || [];
  if (!campaigns.length) return { active: false, coverage: 'complete', total_minor: 0, daily: [] };
  if (campaigns.some(row => !validCampaign(row))) throw fail('accounting_igor_configuration_invalid', 503);
  const report = await readIgorAdvertising(db, { from, to, now });
  const daily = report.daily.filter(row => campaigns.some(campaign => active(campaign, row.date)))
    .map(row => ({ date: row.date, spend_minor: row.google_minor, coverage: row.google_coverage }));
  const complete = daily.every(row => row.coverage === 'complete');
  return { active: true, coverage: complete ? 'complete' : daily.some(row => row.coverage !== 'missing') ? 'partial' : 'missing',
    total_minor: complete ? safeSum(daily.map(row => row.spend_minor)) : null, daily };
}
