# EVLine Page Roles

This file documents the intentional split between the organic funnels and paid-traffic landing pages. Do not remove either version without a conversion review, because ad performance and organic SEO are measured differently.

## Parts funnel pages

| Role | Ukrainian URL | Russian URL | Main use |
| --- | --- | --- | --- |
| Organic home / main funnel | `/` | `/ru/` | Direct visits, brand traffic, organic search, general site entry |
| Paid traffic landing | `/запчастини-з-китаю/` | `/ru/zapchasti-iz-kitaya/` | Google Ads, Telegram ads, campaign traffic, A/B conversion testing |

## Current decision

Both versions stay live, but they do not have the same SEO role.

The home pages are the canonical organic pages. Paid landing pages can differ in layout and copy while we compare which funnel produces better business results. The winning result should be measured by paid orders and profit, not only by lead count.

## Analytics rule

Every lead should preserve:

- `landing_page`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `gclid` / `fbclid` when present

This lets us compare:

- home funnel vs paid landing funnel;
- Ukrainian vs Russian language traffic;
- lead quantity vs order quality;
- ad spend vs paid order profit.

## SEO notes

The sitemap should include canonical organic pages and SEO cluster pages:

- `/` <-> `/ru/`
- `/byd` <-> `/ru/byd`
- brand/model parts pages
- BYD programming service, symptom and model pages

Paid landing pages are intentionally excluded from organic indexing:

- `/запчастини-з-китаю/`
- `/ru/zapchasti-iz-kitaya/`

They should keep:

- `meta name="robots" content="noindex, follow"`;
- canonical to the organic home page in the same language;
- no sitemap entry.

This prevents Google from treating the ad landing pages as organic duplicates while preserving their value for Google Ads and conversion testing. If we later decide to index a paid landing page as a separate organic page, update the canonical, robots tag, sitemap, hreflang, ad final URLs and internal links together.
