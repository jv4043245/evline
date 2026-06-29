# Google Ads integration

EVLine CRM prepares offline conversion events for Google Ads from site leads and order status changes.

## Current phase

The site stores Google click identifiers from forms:

- `gclid`
- `gbraid`
- `wbraid`

The site and CRM also preserve attribution context:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_term`
- `utm_content`
- `fbclid`
- `landing_page`
- `page_url`
- `referrer`
- `form_id`
- `form_name`
- `submitted_at`
- `tracking_captured_at`
- `attribution_type`

The CRM queues conversion events in `google_ads_conversion_events`:

- `lead` when a site lead becomes a CRM order
- `paid` when an order reaches paid or later statuses
- `completed` when an order is completed

Conversion value is `0` for leads. For paid/completed orders the default value is gross profit:

```text
revenue_uah - purchase_cost_uah - delivery_cost_uah - customs_cost_uah - processing_cost_uah - ad_cost_uah - other_cost_uah
```

Negative gross profit is sent as `0` because Google Ads conversion values must not be negative. The raw gross profit is still stored in `google_ads_conversion_events.gross_profit_uah` and shown in the CRM.

If Google Ads should receive revenue instead of profit, set:

```text
GOOGLE_ADS_CONVERSION_VALUE_MODE=revenue
```

or update `google_ads_settings.conversion_value_mode` to `revenue`.

When a manager edits finance fields on an already paid/completed order, queued or failed conversion rows are recalculated before upload. Uploaded conversions are kept as the already-sent historical payload; if a value must be changed after upload, handle that as a manual Google Ads adjustment.

## Google Ads account

Customer ID:

```text
4028488894
```

Default conversion action names:

- `EVLine Lead`
- `EVLine Paid Order`
- `EVLine Completed Order`

The real Google Ads API upload needs the final conversion action resource names, for example:

```text
customers/4028488894/conversionActions/123456789
```

## Required secrets for API upload

CSV/export and queue work without these. Direct upload to Google Ads API needs Cloudflare secrets:

- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`
- `GOOGLE_ADS_CUSTOMER_ID`
- optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
- `GOOGLE_ADS_LEAD_CONVERSION_ACTION`
- `GOOGLE_ADS_PAID_CONVERSION_ACTION`
- `GOOGLE_ADS_COMPLETED_CONVERSION_ACTION`
- optional `GOOGLE_ADS_API_VERSION`, defaults to `v24`
- optional `GOOGLE_ADS_AD_USER_DATA_CONSENT`, allowed values: `GRANTED` or `DENIED`
- optional `GOOGLE_ADS_CONVERSION_VALUE_MODE`, allowed values: `gross_profit` or `revenue`, defaults to `gross_profit`
- optional `GOOGLE_ADS_CONVERSION_ENVIRONMENT`, defaults to `WEB`

`GOOGLE_ADS_*_CONVERSION_ACTION` can be either the numeric conversion action ID or the full resource name:

```text
customers/4028488894/conversionActions/123456789
```

Until these are configured, the admin panel shows the queue and exports CSV. After they are configured:

- `Перевірити API` sends the queued conversions with `validateOnly=true`, so Google Ads validates the payload without importing conversions.
- `Відправити в Google Ads` uploads queued/failed conversions and marks rows as `uploaded` or `failed`.

The upload uses the official Google Ads API `uploadClickConversions` method with `partialFailure=true`. Rows with `gclid`, `gbraid`, or `wbraid` are sent with the click ID. Rows without click IDs can still be sent as enhanced conversions when email or phone is available; email and phone are normalized and SHA-256 hashed before upload.

Important 2026 limitation: Google Ads API no longer accepts new offline conversion import adopters after June 15, 2026. If upload returns `CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE`, keep using the CRM queue/CSV export and switch the direct upload path to Google Data Manager API or ask Google for the required access.

## Migration

Apply:

```sql
migrations/0006_google_ads_integration.sql
migrations/0011_google_ads_margin_value.sql
```

After applying the migration, open `/admin/`, go to `Аналітика і реклама`, and click `Підготувати з CRM` to backfill conversion events from existing orders.

## CRM path

1. Google Ads click lands on the site with auto-tagging (`gclid`, `gbraid`, or `wbraid`) and UTM suffix.
2. Frontend stores attribution in browser storage for 90 days and submits it with the form.
3. `/api/leads` writes the lead and creates an order with the same attribution.
4. Manager updates order status and fills revenue/cost fields.
5. CRM calculates margin and campaign performance in `/api/admin/summary`.
6. Google Ads queue prepares `lead`, `paid`, and `completed` conversion events.
7. Admin validates/uploads queued events from `/admin/` or exports CSV if API secrets are not configured.

## Keyword profitability

The admin panel has a `Прибутковість ключів` report. It combines:

- Google Ads keyword/search-term costs from `google_ads_keyword_stats`;
- CRM leads/orders matched by `utm_campaign + utm_term`;
- uploaded Google Ads conversion value for search-term rows when Google Ads attributes offline conversions back to search terms.

Recommended interpretation:

- `Масштабувати` - value/profit ROAS is strong enough to increase attention or budget.
- `Кандидат у мінус-слова` - clicks and spend exist, but CRM/Google value is still zero.
- `Перевірити` - there is value, but it does not cover spend.
- `Спостерігати` - not enough data yet.

Important nuance: `utm_term={keyword}` stores the matched keyword, not always the exact user search phrase. Exact search-term profitability becomes available after Google Ads receives offline conversions and reports `metrics.conversions_value` in `search_term_view`; Google may hide some low-volume search terms for privacy reasons.

Apply the keyword stats migration before using the report:

```sql
migrations/0012_google_ads_keyword_stats.sql
```
