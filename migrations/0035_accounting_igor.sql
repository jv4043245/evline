-- Romania reimbursement is a separate business scope. No campaign is enrolled
-- by this migration; activation needs reviewed provider/account/campaign IDs.
CREATE TABLE accounting_igor_campaigns (
  provider TEXT NOT NULL CHECK(provider IN ('google','meta')),
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL CHECK(length(campaign_id) BETWEEN 1 AND 30 AND campaign_id NOT GLOB '*[^0-9]*'),
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY(provider,account_id,campaign_id),
  CHECK((provider='google' AND account_id='4028488894') OR (provider='meta' AND account_id='1354524650161143')),
  -- Neither the existing Ukrainian campaign nor the unrelated shared-account
  -- business may be reassigned through this Romania-specific foundation.
  CHECK(provider<>'meta' OR campaign_id NOT IN ('120251518463770454','120252865188010454')),
  CHECK(length(starts_on)=10 AND date(starts_on,'+0 days') IS NOT NULL AND date(starts_on,'+0 days')=starts_on),
  CHECK(ends_on IS NULL OR (length(ends_on)=10 AND date(ends_on,'+0 days') IS NOT NULL AND date(ends_on,'+0 days')=ends_on AND ends_on>=starts_on))
);

-- A provider with no campaign is UNKNOWN, not free. Only an explicit reviewed
-- no-spend period may establish zero (for example, a not-yet-launched provider).
CREATE TABLE accounting_igor_no_spend_periods (
  provider TEXT NOT NULL CHECK(provider IN ('google','meta')),
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  PRIMARY KEY(provider,date_from,date_to),
  CHECK(length(date_from)=10 AND date(date_from,'+0 days') IS NOT NULL AND date(date_from,'+0 days')=date_from),
  CHECK(length(date_to)=10 AND date(date_to,'+0 days') IS NOT NULL AND date(date_to,'+0 days')=date_to AND date_to>=date_from)
);

CREATE TABLE accounting_igor_import_runs (
  run_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  coverage TEXT NOT NULL CHECK(coverage IN ('complete','partial')),
  source TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  FOREIGN KEY(provider,account_id,campaign_id) REFERENCES accounting_igor_campaigns(provider,account_id,campaign_id)
);
CREATE TRIGGER accounting_igor_import_runs_no_update BEFORE UPDATE ON accounting_igor_import_runs BEGIN SELECT RAISE(ABORT,'igor_receipt_immutable'); END;
CREATE TRIGGER accounting_igor_import_runs_no_delete BEFORE DELETE ON accounting_igor_import_runs BEGIN SELECT RAISE(ABORT,'igor_receipt_immutable'); END;

CREATE TABLE accounting_igor_campaign_daily (
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  stat_date TEXT NOT NULL,
  spend_minor INTEGER NOT NULL CHECK(typeof(spend_minor)='integer' AND spend_minor BETWEEN 0 AND 100000000000),
  coverage TEXT NOT NULL CHECK(coverage IN ('complete','partial')),
  is_final INTEGER NOT NULL CHECK(is_final IN (0,1)),
  fetched_at TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES accounting_igor_import_runs(run_id),
  PRIMARY KEY(provider,account_id,campaign_id,stat_date),
  FOREIGN KEY(provider,account_id,campaign_id) REFERENCES accounting_igor_campaigns(provider,account_id,campaign_id),
  CHECK(length(stat_date)=10 AND date(stat_date,'+0 days') IS NOT NULL AND date(stat_date,'+0 days')=stat_date)
);
CREATE INDEX idx_accounting_igor_daily_date ON accounting_igor_campaign_daily(stat_date);

CREATE TABLE accounting_igor_drafts (
  month TEXT PRIMARY KEY CHECK(length(month)=7 AND month>='2020-01' AND date(month||'-01','+0 days') IS NOT NULL AND date(month||'-01','+0 days')=month||'-01'),
  fees_minor INTEGER CHECK(fees_minor IS NULL OR (typeof(fees_minor)='integer' AND fees_minor BETWEEN 0 AND 100000000000)),
  fees_note TEXT NOT NULL DEFAULT '' CHECK(length(fees_note)<=500),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  save_id TEXT NOT NULL UNIQUE,
  CHECK(fees_minor IS NULL OR fees_minor=0 OR length(trim(fees_note))>0)
);
CREATE TABLE accounting_igor_revisions (
  month TEXT NOT NULL REFERENCES accounting_igor_drafts(month),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0),
  save_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  PRIMARY KEY(month,revision)
);
CREATE TRIGGER accounting_igor_revisions_no_update BEFORE UPDATE ON accounting_igor_revisions BEGIN SELECT RAISE(ABORT,'igor_revision_immutable'); END;
CREATE TRIGGER accounting_igor_revisions_no_delete BEFORE DELETE ON accounting_igor_revisions BEGIN SELECT RAISE(ABORT,'igor_revision_immutable'); END;
