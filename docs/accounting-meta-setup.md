# Daily Meta accounting collector

Prepared, not activated: production has no Meta Insights credential as of 2026-10-09.

`workers/accounting-meta` reads only the approved EVLine campaign
`120251518463770454` in ad account `1354524650161143`. This account is shared with
another business: the BB campaign `120252865188010454` is **not** EVLine expense.
Never import the full account total into EVLine accounting. Identity is determined
by stable IDs, not campaign names. The reviewed scope is shared with the backend
through `ACCOUNTING_META_SCOPE`; new campaigns need explicit review and an updated
aggregation policy before inclusion.

The reader makes GET requests only, never edits advertising. Meta includes the
Facebook and Instagram placements of the approved EVLine campaign only.
Account currency must be UAH; account timezone must be Europe/Kyiv (the historical
Europe/Kiev alias is accepted). A foreign account/currency/timezone aborts import.

## Before activation

1. Apply and verify the reviewed accounting schema, including campaign-complete
   coverage support. Preserve existing CRM tables. The original account-only
   completeness constraint is not sufficient; never relabel this data as account-wide.
2. Obtain owner-authorized account-wide read access. Create a dedicated Meta system
   user token with `ads_read` for this account, not `ads_management`. Never place it
   in source files, browser storage, logs, URLs or a Pages public variable.
3. Install Worker secret `META_ADS_INSIGHTS_ACCESS_TOKEN`. If app-secret proof is
   required/configured, also install `META_ADS_INSIGHTS_APP_SECRET` for that app.
   The reader computes HMAC-SHA256 proof locally. Existing bot tokens are untouched.
4. Explicitly set `META_GRAPH_API_VERSION` to a supported version reviewed at actual
   activation. There is deliberately no guessed/default version; missing/invalid
   configuration fails closed. Do not use unversioned endpoints or an auto-latest alias.
5. Dry-run and review the worker bundle, then deploy this exact worker configuration
   after credentials and authorization are ready. This enables its daily cron.
6. Confirm the first successful run in accounting import receipts and compare at
   least one complete day with the **EVLine campaign's** Meta Ads Manager spend.
   The shared-account total is useful only for reconciliation, not as an EVLine total.
   Do not claim activation from a local test, a successful deployment alone, or
   credential installation alone.

Cron: **05:45 UTC daily** (08:45 Kyiv during daylight saving; 07:45 in winter).
It reconciles the preceding 30 completed Kyiv calendar days, including later
provider adjustments. No HTTP/manual trigger is exposed and workers.dev is disabled.
On initial run older history remains missing, not zero; deliberate historical
backfill is separate. `is_final` means a completed-day snapshot, not an immutable
invoice. Meta reporting spend excludes any extra taxes, top-ups or bank fees.

## Completeness and safety

- Account metadata identity, UAH and timezone are checked before requesting insights.
  The campaign's own metadata must also confirm its exact ID and parent account,
  including when the Insights result is empty.
- Insights use `level=campaign`, `time_increment=1`, a fixed full date range and
  exactly `campaign.id IN [120251518463770454]`. There are no ad-set/ad filters or
  breakdowns, so all spend in the approved campaign is included. The payload uses
  `scope=campaign`, `coverage=complete`, and
  `source_ref=evline_campaign_120251518463770454`; complete means this approved
  business scope, not the whole shared Meta account.
- Pagination is bounded. Every next link must use the same Graph origin and exact
  account endpoint. Only its validated cursor is used; request parameters are
  rebuilt locally, and redirects are forbidden. The token stays in a Bearer header.
- All rows must have the expected account/currency/campaign and one unique in-range date.
  Malformed spend, duplicate dates, incomplete pages or any upstream error abort the
  entire snapshot. Only after all pages succeed are omitted days recorded as zero
  **for this campaign**. A missing, foreign or BB campaign ID aborts the whole snapshot.
- Failure records contain only fixed error codes. Previous valid costs remain
  intact. The backend owns idempotency and rejects inappropriate overwrites.
- No full Graph responses, request URLs, credentials or customer fields are logged.

## Reference check

The official documentation endpoints returned HTTP429 during implementation; no
version number was inferred from that failure. Request fields and account Insights
edge were checked against Meta's own SDK sources:

- [Meta AdAccount source](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ad-account.js)
- [Meta AdsInsights source](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ads-insights.js)
- [Meta Python cursor implementation](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/api.py)
- [Insights reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/)
- [Secure server requests](https://developers.facebook.com/docs/graph-api/guides/secure-requests/)

Recheck supported Graph versions and the app's required proof settings when access
is granted. Mock tests do not establish real token permission or account coverage.
