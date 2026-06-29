# Google Ads tracking setup

## Account tracking

Use Google Ads account-level tracking suffix so every ad click carries the same CRM identifiers.

Recommended final URL suffix:

```text
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}-{creative}&utm_term={keyword}
```

Keep Google Ads auto-tagging enabled. Google adds `gclid`, `gbraid`, or `wbraid`; the EVLine site stores those identifiers together with UTM fields.

Where to add it in Google Ads:

1. Admin / Settings.
2. Account settings.
3. Tracking.
4. Final URL suffix.
5. Save.

The CRM uses `utm_campaign={campaignid}` because campaign names can change, while campaign ids are stable. Google Ads cost sync stores costs by the same campaign id and keeps the readable campaign name in the row notes.

`utm_term={keyword}` stores the matched keyword in the CRM. This is enough to connect many orders back to keyword-level Google Ads cost. The exact user search phrase is synced separately from Google Ads `search_term_view`; that report becomes strongest after offline conversions with margin value have been uploaded back to Google Ads.

## Cost sync script

Google Ads:

1. Tools.
2. Bulk actions.
3. Scripts.
4. `+` new script.
5. Paste `docs/google-ads-cost-sync-script.js`.
6. Replace `SYNC_TOKEN`.
7. Run once manually and approve access.
8. Set schedule: daily, morning.

The script sends the last 30 days. It now sends:

- campaign-level costs into `ad_costs`;
- keyword-level stats into `google_ads_keyword_stats`;
- search-term stats into `google_ads_keyword_stats`.

This intentionally rewrites/upserts synced Google Ads rows for the same period, because Google Ads can adjust recent statistics after clicks and conversions settle.
