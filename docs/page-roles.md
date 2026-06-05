# EVLine Page Roles

This file documents an intentional split between the main parts funnel and the paid-traffic landing page. Do not remove either version as a duplicate without a conversion review.

## Parts funnel pages

| Role | Ukrainian URL | Russian URL | Main use |
| --- | --- | --- | --- |
| Organic home / main funnel | `/` | `/ru/` | Direct visits, brand traffic, organic search, general site entry |
| Paid traffic landing | `/запчастини-з-китаю/` | `/ru/zapchasti-iz-kitaya/` | Google Ads, Telegram ads, campaign traffic, A/B conversion testing |

## Current decision

Both versions stay live.

The home pages and paid landing pages can differ in layout and copy while we compare which funnel produces better business results. The winning result should be measured by paid orders and profit, not only by lead count.

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

The sitemap includes both page pairs with `hreflang`:

- `/` <-> `/ru/`
- `/запчастини-з-китаю/` <-> `/ru/zapchasti-iz-kitaya/`

The paid landing pages are valid indexable pages, not temporary redirects. If we later merge funnels, update sitemap, canonical tags, ad final URLs, and internal links together.
