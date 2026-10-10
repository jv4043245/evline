# Zeekr 9X / 8X service pages

Routes: `/zeekr-9x-8x/` (Ukrainian), `/ru/zeekr-9x-8x/` (Russian),
and `/ro/zeekr-9x-8x/` (Romanian). UA/RU remain intentionally unlisted,
outside the sitemap, with `noindex,nofollow`. On 2026-10-10 the owner requested
organic SEO for Romanian clients: RO is now indexable and included in the sitemap.
These are public URLs, not access-controlled pages.
The language menu links the three versions and preserves ad attribution.
Russian is the layout source. After editing it, update the translation table in
`scripts/build-zeekr-translations.mjs` and run `npm run build:zeekr-languages`.
Tests check generated pages for drift. Scripts, styles and media are shared.
The RO-only override in `scripts/lib/zeekr-ro-seo.mjs` runs after translation:
Romania-focused title/description/headings, six FAQs, self-canonical, Romanian
`ro`/`ro-RO` alternatives, social metadata and fact-based WebPage/Service JSON-LD.
No noindexed sibling is advertised as an indexed alternate in the RO head.
Normal language-menu links and attribution are unchanged. The Service targets
Romanian clients; it does not claim a Romanian workshop, address, official dealer
relationship or remote performance of all services. Operating format/location
still needs the owner's confirmation. The Kyiv AutoRepair schema is not inherited
by RO. No BYD VDS/calibration/pricing promises are transferred to Zeekr.
No search-volume or ranking claims are made for the selected phrases. They
describe the actual services in Romanian; they are not a Keyword Planner export.
Google references checked for this change:
https://developers.google.com/search/docs/specialty/international/localized-versions
and https://developers.google.com/search/docs/crawling-indexing/block-indexing .
The Ukrainian country domain remains unchanged; Romanian annotations do not
guarantee Romanian rankings or immediate indexing. No Search Console submission
is claimed unless separately verified.
Visible copy and dynamic form/video/cookie states are localized; internal service
values retain the original CRM labels. Romanian privacy links explicitly lead
to the existing Ukrainian policy. These service pages intentionally omit the
parts seller's identity at the owner's request: a different entity will operate
this service. `data-seller-identity-policy="omit"` prevents the shared footer sync
and translation build from restoring that identity. Other public pages are unchanged.

The four services are supplied by the owner. No prices, turnaround guarantees,
testimonials, or features from older Zeekr models have been carried over.
The existing `/api/leads` endpoint uses historical type `byd` to route programming
requests to the technical manager, with topic `programming-zeekr-9x-8x`.
Telephone: +380630630304. Telegram: @evline_tech.

## Media provenance

- `9x-interior.webp`: hero photograph by AutoLab, actual Zeekr 9X interior.
  Source: https://commons.wikimedia.org/wiki/File:2025_Zeekr_9X_interior.png
  Original: https://upload.wikimedia.org/wikipedia/commons/9/9b/2025_Zeekr_9X_interior.png
  Commons identifies the license as CC BY 3.0: https://creativecommons.org/licenses/by/3.0/
  Resized to 1920px, converted to WebP; responsive cropping is done in CSS.
  Visible author, source, license and crop credit is present in all three languages.
  The photo shows the original interface, not EVLine-installed apps. No display
  contents were replaced. The separate owner-supplied video demonstrates our work.
  Installer portfolio pictures found online were not reused as our own work.
- `9x-hero.webp`: official Zeekr 9X page, https://www.zeekrlife.com/zh-cn/zeekr9x
  Source: https://zeekrlife-oss.zeekrlife.com/frontend/atom/atom_json/JSON-1745306191548/Banner2-a319e6f62f9e9ff781ef230eab1c1234.jpg
- `9x.webp`: body-proportions photo from the same official 9X page.
  Source: https://zeekrlife-oss.zeekrlife.com/frontend/atom/atom_json/JSON-1745306191548/%C3%A5%C2%A5%C2%A2%C3%A9%C2%98%C2%94%C3%A8%C2%BD%C2%A6%C3%A8%C2%BA%C2%AB%C3%A6%C2%AF%C2%94%C3%A4%C2%BE%C2%8B-79e2821544ef3bcf7b3978c21e208671.jpg
- `8x.webp`: Zeekr/Geely press release dated 2026-04-17,
  https://www.globenewswire.com/news-release/2026/04/17/3276357/0/en/Zeekr-8X-Where-Super-Hybrid-Power-Meets-Super-Intelligence.html
  Source: https://ml.globenewswire.com/Resource/Download/4e4c09ec-9d82-4dee-bf10-fdf548ad790f/image1.jpeg
- `evline-demo.mp4`: owner-supplied `IMG_5175.MOV`, 85.43 seconds, 720x1280.
  Locally transcoded H.264/AAC, CRF 25, faststart, metadata removed; original unchanged.
  `video-poster.webp` is the 40-second frame. No autoplay, preload none.
  The clip demonstrates multimedia apps, maps and switching applications, not
  SIM activation, regional protection or MA/FA configuration. No intelligible
  explanatory speech was recovered by local transcription; no spoken claims added.
- `icons.svg`: selected Lucide v1.8.0 icon paths, generated from the installed package.
  License alongside at `LUCIDE-LICENSE.txt`.

Source identity is recorded here; no claim of exclusive rights to manufacturer
photos is made. Only the supplied EVLine video is described as our own work.
