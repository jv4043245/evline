# Accounting import scope

`persistAdSpendSnapshot(db, snapshot, { now })` accepts a fresh, explicit daily
snapshot, UAH integer kopecks and Europe/Kyiv account dates. Every completed day,
including verified zero-delivery days, must be represented for complete coverage.
No keyword/ad-set/campaign subtotals may be added to an overlapping account total.

## Google

- provider: `google`; account: `4028488894`.
- Complete scope: `account`; source: `google_ads_script`.
- The complete customer-level daily cost query includes all campaigns, including
  historical paused/removed objects. Account currency and timezone are checked.

## Meta: shared account, EVLine campaign only

Account `1354524650161143` also contains another business. Its account total is
not EVLine expense and is rejected at validation, database and report boundaries.

- provider: `meta`; account_id: `1354524650161143`.
- scope: `campaign`; source_ref: `evline_campaign_120251518463770454`.
- The only approved campaign is `120251518463770454`.
- source: `meta_insights` or `meta_ads_manager_csv`.
- coverage: `complete` means all requested days and all ads/placements within
  this reviewed EVLine campaign, not the shared ad account.
- Campaign `120252865188010454` belongs to the other business and must not be
  included. Future campaigns are not auto-enrolled by name or account membership.
- A CSV importer must verify account, campaign ID, currency, date granularity,
  full requested date range, absence of summary rows and duplicate days before
  setting complete coverage. A readable filename alone is not provenance.

Daily and monthly `*_coverage` fields represent the approved business scope.
Old Meta account-level rows are ignored by reporting, even if labeled complete.

## Deployment and recovery

Migration0032 replaces the daily table's scope constraint and retains the exact
old table as `accounting_ad_daily_pre_business_scope`. It must run atomically,
after a backup and a read-only check that no old shared-account Meta rows exist.
Google rows are copied unchanged. The backup is not queried or double-counted.
The migration deliberately fails if incompatible Meta rows exist; first reconcile
those rows, never relabel account totals as EVLine campaign costs.

The prepared Meta Worker is not activated until dedicated read credentials,
campaign parent identity, UAH/Kyiv settings, exact campaign scope and one live
daily reconciliation have been verified. It never writes advertising settings.
