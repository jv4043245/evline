# Organic search baseline — 2026-08-24

## Measurement window

Google Search Console currently contains three complete days of performance data: 2026-08-20 through 2026-08-22. This is enough to identify early opportunities, but not enough to judge long-term demand or declare a page successful.

## Baseline

- 18 clicks
- 307 impressions
- 5.9% CTR
- 8.9 average position
- 92 indexed pages
- 104 pages not indexed
- 124 pages discovered through the sitemap

The 43 `www` canonical variants were addressed with the Cloudflare redirect. Five advertising landing pages are intentionally `noindex`. Expected technical URLs such as `/api/leads` and `/cdn-cgi/l/email-protection` are not organic landing pages.

## Early winners

| Page | Clicks | Impressions | Average position |
| --- | ---: | ---: | ---: |
| `/ru/carplay-android-auto-byd/` | 2 | 16 | 6.44 |
| `/ru/zapchasti-zeekr/x/` | 2 | 8 | 10.25 |
| `/ru/byd` | 2 | 4 | 2.50 |
| `/ru/klimat-byd-ne-rabotaet/` | 1 | 15 | 3.40 |
| `/ukrainizatsiya-byd/` | 1 | 10 | 4.90 |
| `/ru/zapchasti-xiaomi/yu7/` | 1 | 6 | 3.83 |
| `/zapchastyny-xiaomi/su7/` | 1 | 5 | 2.40 |
| `/zapchastyny-zeekr/7x/` | 1 | 4 | 7.25 |

The query `запчасти на zeekr 001` received 9 impressions at average position 16.67 and led to `/ru/zapchasti-zeekr/001/`. It is the clearest early model-level opportunity.

## Decisions implemented

- The Ukrainian and Russian home pages target the generic intent “parts for Chinese cars from China”.
- The brand hubs prioritize modern Chinese makes and link directly to BYD, ZEEKR, Xiaomi and AVATR model pages.
- Zeekr 001 titles and headings use the exact commercial query pattern.
- Priority model pages focus on high-value bodywork, lighting, glass, ADAS, electronics and suspension.
- Low-margin filters, pads and individual maintenance consumables are removed from organic commercial targeting.
- Real differentiators are explicit: VIN matching, physical inspection in China, original/OEM choice, five logistics partners and packaging without unnecessary weight.
- The advertising landing page remains `noindex, follow` with its canonical on the organic home page.
- `scripts/build-sitemap.mjs` remains the only sitemap authority; the Russian-page generator cannot overwrite it.

## Review cadence

Do not judge the changes by daily movement. Review after 14 complete days for crawl/indexing and after 28 complete days for query and conversion direction.

At each review compare:

- clicks and impressions for non-brand parts queries;
- page-one visibility for Zeekr 001, Zeekr X, Zeekr 7X, Xiaomi SU7/YU7 and BYD model pages;
- indexed count and the `Crawled — currently not indexed` group;
- CTR for pages with at least 30 impressions;
- qualified parts leads and revenue by landing page, not traffic alone.

Avoid creating hundreds of thin model × part pages until Search Console shows real impressions for those combinations. Expand only from validated queries and pages with enough unique, useful content.
