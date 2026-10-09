# Daily Meta accounting collector

Prepared, not activated: production has no Meta Insights credential as of 2026-10-09.

`workers/accounting-meta` reads the entire ad account `1354524650161143`, not a
single experimental campaign. It makes GET requests only, never edits advertising.
The UI label Meta includes Facebook and Instagram placements billed to this account.
Account currency must be UAH; account timezone must be Europe/Kyiv (the historical
Europe/Kiev alias is accepted). A foreign account/currency/timezone aborts import.

## Before activation

1. Apply and verify the reviewed accounting schema. Preserve existing CRM tables.
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
   least one complete day with the account-level Meta Ads Manager expense total.
   Do not claim activation from a local test, a successful deployment alone, or
   credential installation alone.

Cron: **05:45 UTC daily** (08:45 Kyiv during daylight saving; 07:45 in winter).
It reconciles the preceding 30 completed Kyiv calendar days, including later
provider adjustments. No HTTP/manual trigger is exposed and workers.dev is disabled.
On initial run older history remains missing, not zero; deliberate historical
backfill is separate. `is_final` means a completed-day snapshot, not an immutable
invoice. Meta reporting spend excludes any extra taxes, top-ups or bank fees.

## Completeness and safety

- Metadata identity, UAH and timezone are checked before requesting insights.
- Insights use `level=account`, `time_increment=1`, a fixed full date range and no
  campaign/ad-set/ad filters or breakdowns. Facebook plus Instagram total is not
  added to any old campaign-specific feed.
- Pagination is bounded. Every next link must use the same Graph origin and exact
  account endpoint. Only its validated cursor is used; request parameters are
  rebuilt locally, and redirects are forbidden. The token stays in a Bearer header.
- All rows must have the expected account/currency and one unique in-range date.
  Malformed spend, duplicate dates, incomplete pages or any upstream error abort the
  entire snapshot. Only after all pages succeed are omitted days recorded as zero.
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
