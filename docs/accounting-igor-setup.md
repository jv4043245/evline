# Romania advertising reimbursement — preparatory state

The owner confirmed that the Romanian campaigns do not yet exist. Migration
0035 creates an empty, isolated accounting scope. It does not create campaigns,
enroll existing campaigns, start exporters, change budgets or invent expenses.
`Розрахунок Ігоря` is a monthly **100% cost-reimbursement draft**, not the 15%
profit calculation used for André. The two calculations do not share manual
inputs or saved revisions.

Confirmed target page: `https://evline.com.ua/ro/zeekr-9x-8x/` (Romanian
programming/configuration services). It shares a CRM topic with other language
versions, so the topic alone cannot allocate advertising expenses either.

## Monthly draft contract

Authenticated administrator GET and PUT:
`/api/admin/accounting/igor?month=YYYY-MM`

PUT body:

```json
{
  "month": "2026-10",
  "expected_revision": 0,
  "inputs": { "fees_minor": null, "fees_note": "" }
}
```

All money is integer UAH kopecks. `fees_minor` means **actual incremental charges
not already included in platform advertising spend**: supported bank/card fees,
currency-conversion charges or taxes attributable to this Romanian advertising.
It is not the full card debit, advance payment, arbitrary percentage, foreign
currency amount, or a second copy of the platform cost. Shared-account charges
must be allocated on an evidenced basis; do not assign unrelated charges to Igor.
A positive amount requires a short explanation. `null` is unreconciled; an explicit
`0` confirms no additional charges. No bank credentials are collected.

`reimbursement = verified Google campaign cost + verified Meta campaign cost + actual incremental charges`

The result stays incomplete until both providers and the fees are known. With no
mapped campaigns or confirmed zero periods, advertising is `not_configured`,
not settled zero. The current month ends at yesterday in Europe/Kyiv and is
provisional. Saving creates an immutable snapshot and uses optimistic revision
control (409 on conflict). Saving is not a payment, settlement approval or invoice.

## Activation after campaigns are created

1. Verify the exact Google customer/account and Meta account, campaign IDs,
   landing page, currency and timezone. Campaign names, Romanian text, geography
   and UTM tags alone do not establish ownership. Keep Romania in dedicated
   campaigns; a campaign mixing unrelated landing pages cannot be fully assigned.
2. Enroll reviewed IDs with effective start/end dates in
   `accounting_igor_campaigns`, including the responsible administrator/time.
   There is deliberately no public or administrator mapping-write endpoint in
   this preparatory release. Future activation must be an explicitly reviewed
   migration/configuration change, with historical receipts reconciled first.
3. Wire separate **campaign/day** exports to
   `persistIgorCampaignSnapshot` in `functions/_lib/accounting-igor.js`. No HTTP
   ingestion endpoint or live exporter is enabled today. Future routing must
   authenticate the integration and preserve the current exact scope validation.
   Google must continue using Ads Scripts, not a developer-token/API workflow.
4. Each campaign receipt declares provider/account/campaign, UAH, Kyiv timezone,
   inclusive dates, source, fresh UTC `fetched_at`, coverage and daily integer
   costs. Complete means every requested day, including verified zeros. Campaign
   lifecycle must include paused/removed historical objects; query failure or a
   missing campaign must never turn into zeros. Dates must lie inside the reviewed
   assignment. Partial/older/nonfinal receipts cannot replace complete final facts.
5. If a provider has not launched or some dates genuinely have no campaign cost,
   record a reviewed date-bounded confirmation in
   `accounting_igor_no_spend_periods`. These confirmations are never inferred from
   missing exports. Any mapped active campaign takes precedence and requires its
   own receipt even if a zero period overlaps it.
6. Reconcile each campaign/day against source exports. Google Romania costs must
   not exceed the inclusive Google account/day totals. Confirm actual additional
   charges from the billing/bank evidence before settling the month.
7. Before activating the new imports, include verified Romania Meta spend once
   in the combined advertising overview/history, without feeding it into
   Andrii's scope. Google overview already includes Romania. Otherwise the
   overview would incorrectly include Igor's Google but omit his Meta costs.
   Preserve correctly scoped private source archives; do not accept the shared
   Meta account total. Activate daily updates with trailing corrections only
   after a complete first-day reconciliation.

Snapshot example (illustrative IDs, never ready to import):

```json
{
  "provider": "google", "account_id": "4028488894", "campaign_id": "REVIEWED_NUMERIC_ID",
  "currency": "UAH", "timezone": "Europe/Kyiv",
  "from": "2026-10-09", "to": "2026-10-09",
  "fetched_at": "2026-10-10T05:00:00.000Z", "coverage": "complete",
  "source": "google_ads_script",
  "days": [{ "date": "2026-10-09", "spend_minor": 0, "is_final": true }]
}
```

## Isolation and reconciliation

`accounting_ad_daily` and its immutable original-report archive remain unchanged.
Google's existing total includes all campaigns in customer4028488894, so André's
live monthly calculation subtracts the verified Romanian Google share once.
The read-only `Реклама за період` block in Andrii's calculation uses
`/api/admin/accounting/andrii?from=YYYY-MM-DD&to=YYYY-MM-DD` and applies the same
business exclusion by day. It never uses the general overview total as an
Andrii total. Bounds are inclusive Kyiv calendar dates, with today explicitly
excluded as unfinished; requested and effective dates are returned separately.
Calendar shortcuts cover 1/2/3 months ending in the selected settlement month.
Arbitrary ranges are supported up to 1827 days. The read-only selection cannot
change monthly commission drafts, their manual inputs, or the fixed 15% policy.
Final provider/combined totals are null when coverage is incomplete; known
subtotals are separately labelled and cannot become settlement inputs.
An active mapping with missing/partial campaign data or daily cost above the
inclusive account total makes André's calculation incomplete instead of charging
Igor's cost to André or producing negative advertising cost. No mappings means
the previous André calculation is unchanged.

The existing Meta scope includes only EVLine Ukraine campaign120251518463770454
in shared account1354524650161143. New Romanian campaigns are outside that scope,
so they are not subtracted from it. Both that existing campaign and unrelated
campaign120252865188010454 are forbidden in this Romania-specific mapping table.
The other business's expenses must never enter either settlement. The general
advertising overview retains its existing scope; any future combined overview
must avoid adding Romania Google costs twice and must explicitly label expanded
Meta scope.

Campaign receipts are separately immutable in `accounting_igor_import_runs`.
Original archive schema0034 is not weakened or reused for arbitrary account data.
Later exports affect the current preview but never rewrite saved André or Igor
revision snapshots. Existing order data, recognition basis and payout workflows
are not changed.

Apply additive migration0035 before deploying code that reads the new tables.
No existing business facts are copied, deleted, reclassified or backfilled by it.
Record a D1 recovery bookmark and inspect live table names first. Apply only this
new migration, not all historical migrations: some were applied outside the
tracker. A code rollback can safely leave unused additive tables in place.
