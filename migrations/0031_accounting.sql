-- One provider-account-day fact, not a sum of keyword/campaign/ad grains.
CREATE TABLE IF NOT EXISTS accounting_ad_daily (
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
  CHECK(coverage <> 'complete' OR scope = 'account'),
  CHECK((provider = 'google' AND account_id = '4028488894') OR (provider = 'meta' AND account_id = '1354524650161143')),
  CHECK(stat_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(stat_date, '+0 days') IS NOT NULL AND date(stat_date, '+0 days') = stat_date)
);
CREATE INDEX IF NOT EXISTS idx_accounting_ad_daily_date ON accounting_ad_daily(stat_date);

-- Successful import attempts are content addressed: retries do not multiply runs.
-- No customer data, raw API responses, tokens or URLs belong in this table.
CREATE TABLE IF NOT EXISTS accounting_import_runs (
  run_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  scope TEXT NOT NULL,
  coverage TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL DEFAULT '',
  days_received INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted', 'failed')),
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_accounting_import_runs_provider ON accounting_import_runs(provider, fetched_at);

-- Additive accounting foundation only. No old order values are backfilled or
-- certified. Future cash and accrual views must deliberately select basis and
-- category, and never subtract both an allocated order cost and its ad fact.
CREATE TABLE IF NOT EXISTS accounting_entries (
  id TEXT PRIMARY KEY,
  entry_date TEXT NOT NULL,
  category TEXT NOT NULL,
  basis TEXT NOT NULL CHECK(basis IN ('cash', 'accrual')),
  direction TEXT NOT NULL CHECK(direction IN ('income', 'expense')),
  amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor) = 'integer' AND amount_minor >= 0),
  currency TEXT NOT NULL CHECK(currency = 'UAH'),
  order_id TEXT REFERENCES orders(id),
  external_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(entry_date, '+0 days') IS NOT NULL AND date(entry_date, '+0 days') = entry_date)
);
CREATE INDEX IF NOT EXISTS idx_accounting_entries_date ON accounting_entries(entry_date, category);
CREATE INDEX IF NOT EXISTS idx_accounting_entries_order ON accounting_entries(order_id);
