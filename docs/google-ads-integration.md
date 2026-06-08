# Google Ads integration

EVLine CRM prepares offline conversion events for Google Ads from site leads and order status changes.

## Current phase

The site stores Google click identifiers from forms:

- `gclid`
- `gbraid`
- `wbraid`

The CRM queues conversion events in `google_ads_conversion_events`:

- `lead` when a site lead becomes a CRM order
- `paid` when an order reaches paid or later statuses
- `completed` when an order is completed

Conversion value is currently `0` for leads and `orders.revenue_uah` for paid/completed orders. Gross profit is stored separately for CRM analysis.

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

CSV/export and queue work without these. Direct upload to Google Ads API will need:

- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`
- `GOOGLE_ADS_CUSTOMER_ID`
- optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
- `GOOGLE_ADS_LEAD_CONVERSION_ACTION`
- `GOOGLE_ADS_PAID_CONVERSION_ACTION`
- `GOOGLE_ADS_COMPLETED_CONVERSION_ACTION`

Until these are configured, the admin panel shows the queue and exports CSV.

## Migration

Apply:

```sql
migrations/0006_google_ads_integration.sql
```

After applying the migration, open `/admin/`, go to `Аналітика і реклама`, and click `Підготувати з CRM` to backfill conversion events from existing orders.
