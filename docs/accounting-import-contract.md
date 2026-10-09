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

## Monthly manager calculation

`/api/admin/accounting/profit?month=YYYY-MM` reads a monthly draft. Authenticated
PUT saves explicit manual inputs with `expected_revision`; concurrent edits
return 409 instead of replacing another administrator's values. Migration0033
adds draft and immutable revision tables without changing orders or payments.

The owner confirmed recognition after **both full customer payment and actual
handover to the customer**. Revenue, purchase and shipping must describe those
same recognized orders, regardless of when a supplier was paid. Advertising is
the entire selected month's verified EVLine cost, subtracted once. Other costs
are entered with a description. Values are UAH integer kopecks, not CNY totals
or supplier receipt amounts without actual exchange-rate evidence.

`profit = revenue - purchase - shipping - advertising - other`

Manager estimate is 15% of positive profit, rounded half-up to one kopeck;
otherwise zero. Remaining profit is profit less that estimate. Missing inputs
or incomplete advertising coverage leave the result unknown, never zero.
Current-month advertising stops at yesterday and is explicitly provisional.
Saved drafts are not approved payroll, payouts, or a month-closing ledger.

Initial CRM audit found zero/default revenue and cost fields, unknown customer
payment statuses, and supplier-payment workflow dates rather than reliable
customer-payment/handover events. Therefore no historical order profit is
inferred automatically. Confirmed monthly totals are manual until those events
and costs become reliable. Do not subtract legacy per-order `ad_cost` again.

Advertising cadence: refresh completed days daily with a trailing correction
window, then reconcile the whole month before settlement. Google already has
the daily script. Meta daily ingestion remains pending the dedicated read
credentials described above; historical imported facts remain usable.
