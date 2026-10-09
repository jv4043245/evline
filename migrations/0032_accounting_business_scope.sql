-- Execute once through the migration runner/atomic D1 batch after a verified
-- backup. The existing table is retained intact as a recoverable checkpoint.
-- Precondition: no shared-account Meta rows in the current table. If such rows
-- exist, INSERT below fails closed; do not weaken the policy to copy them.
ALTER TABLE accounting_ad_daily RENAME TO accounting_ad_daily_pre_business_scope;

CREATE TABLE accounting_ad_daily (
  provider TEXT NOT NULL CHECK(provider IN ('google', 'meta')),
  account_id TEXT NOT NULL,
  stat_date TEXT NOT NULL,
  spend_minor INTEGER NOT NULL CHECK(typeof(spend_minor) = 'integer' AND spend_minor >= 0),
  currency TEXT NOT NULL CHECK(currency = 'UAH'),
  timezone TEXT NOT NULL CHECK(timezone = 'Europe/Kyiv'),
  scope TEXT NOT NULL CHECK(scope IN ('account', 'campaign')),
  coverage TEXT NOT NULL CHECK(coverage IN ('complete', 'partial')),
  is_final INTEGER NOT NULL CHECK(is_final IN (0, 1)),
  fetched_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL DEFAULT '',
  run_id TEXT NOT NULL,
  PRIMARY KEY(provider, account_id, stat_date),
  CHECK(coverage <> 'complete' OR
    (provider='google' AND scope='account') OR
    (provider='meta' AND scope='campaign' AND source_ref='evline_campaign_120251518463770454')),
  CHECK(provider <> 'meta' OR (scope='campaign' AND source_ref='evline_campaign_120251518463770454' AND source IN ('meta_insights', 'meta_ads_manager_csv'))),
  CHECK((provider = 'google' AND account_id = '4028488894') OR (provider = 'meta' AND account_id = '1354524650161143')),
  CHECK(stat_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(stat_date, '+0 days') IS NOT NULL AND date(stat_date, '+0 days') = stat_date)
);
INSERT INTO accounting_ad_daily
  (provider,account_id,stat_date,spend_minor,currency,timezone,scope,coverage,is_final,fetched_at,source,source_ref,run_id)
SELECT provider,account_id,stat_date,spend_minor,currency,timezone,scope,coverage,is_final,fetched_at,source,source_ref,run_id
FROM accounting_ad_daily_pre_business_scope;
CREATE INDEX idx_accounting_ad_daily_date_v2 ON accounting_ad_daily(stat_date);
