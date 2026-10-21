# Priority parts SEO and mobile delivery, 2026-10-21

## Scope and baseline

Baseline: `c9e2fa3` on `main`. Work is isolated in `codex/seo-byd-zeekr-20261021`.

- Enrich existing BYD and ZEEKR hubs plus ZEEKR 001, X and 7X in Ukrainian and Russian; no new indexable URLs.
- Add model-specific selection details, contextual links, and an existing EVLine gallery photo clearly not presented as proof of fitment or a model-specific order.
- Retain all canonical/hreflang, paid landing URLs, noindex policies, forms, contact destinations and tracking scripts.
- Serve responsive WebP derivatives at quality 95; original photo files and gallery enlargement remain unchanged. High-density displays can still select the full original.
- Inline the existing small footer stylesheet on the two organic home pages only. Other layout rules and analytics loading are unchanged.
- Update sitemap lastmod for the 12 edited public pages only.

## Maintenance

`node scripts/sync-priority-parts.mjs` regenerates the ten guide sections. Content is in `scripts/lib/parts-priority-content.mjs`; the Russian brand generator also applies it.

`node scripts/sync-responsive-parts-images.mjs` updates only the two organic homes and ten priority pages. `--check` reports drift without writes. Image generation is optional: `SHARP_MODULE=/absolute/path/to/sharp node scripts/build-responsive-parts-images.mjs`. The deployment uses committed assets and does not require sharp.

The footer synchronizer recognizes `data-footer-contacts-inline` and keeps the inline copy identical to the shared stylesheet.

For a scoped sitemap refresh use `node scripts/build-sitemap.mjs --changed-only` before committing; this preserves lastmod on untouched pages.

## Validation before publication

- Full suite with the local Node 22 runtime: 852 tests passed.
- 24 offline JSDOM form-submission tests across 12 pages: correct parts routing, UTM/gclid preservation, exactly one CRM POST, conversion only after success, correct Telegram recipient; no real leads were sent.
- `node scripts/audit-seo-change-safety.mjs c9e2fa3`: forms, scripts, canonical, hreflang and contact intent match baseline; API, CRM, ads and original images unchanged.
- Public form audit: 158 forms across 148 HTML files, passed.
- Internal-link audit: 5,776 references across 156 HTML files, passed.
- Browser checks: 33 page/viewport combinations at 320, 390, 768 and 1440 pixels, no horizontal overflow or clipped checked fields/headings.

After publication, verify live assets, the sitemap and primary landing URLs before requesting Search Console indexing. A request is not a guarantee of indexing or ranking. Do not submit noindex advertising pages for indexing.

## Rollback

Revert this change's commit or merged PR if required. Do not reset main to the baseline: unrelated later CRM work must be preserved. The new derivative assets are additive and the original photos remain intact.
