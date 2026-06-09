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

The script sends the last 30 days. This intentionally rewrites synced Google Ads rows for the same date/campaign, because Google Ads can adjust recent statistics after clicks and conversions settle.
