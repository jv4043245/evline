# Admin workspace density audit, 2026-09-24

Goal: reduce scanning and scrolling effort, not maximize information per pixel.
Baseline: isolated browser walkthrough at 1440, 1024, 768 and 390 px. All admin
API calls were mocked; no customer records, messages or payments were modified.

| Surface | Finding | Decision |
| --- | --- | --- |
| Orders and main navigation | Header, panel headings and stacked panel margins consume space; rows already distinguish the customer, request, money and actions. | Reduce surrounding chrome; preserve table type, row spacing, status colors and action placement. |
| Order: request | Workflow, customer contacts and vehicle/request fields form one uninterrupted grid. Empty grid slots add scrolling. | Three flat labeled bands: neutral workflow, white customer, pale blue request. Four workflow fields and three contacts share rows on wide screens; narrow screens stack. |
| Order: payments | Supplier form and customer finances look similar; receipt amounts occupy a narrow vertical column. | Blue supplier-payment form stays open and first. Green UAH finances stay separate. Two-column receipt breakdown on larger screens, one on narrow phones. Keep commission/principal/total distinct and all correction actions. |
| Order: suppliers / China | Primary actions need to remain visible. Product photos and quotes require room for inspection. | Group request/payment actions in a compact blue band, reduce form gaps. Preserve photos, quote details, upload controls and Chinese workflow. |
| Order: delivery | Tracking fields and China shipping calculation are visually mixed. | White tracking band and blue shipping band; preserve calculator, tariffs, errors and disabled tracking states. |
| Ukraine market / standalone search | Large repeated gaps obscure the connection between filters, price range and offers. | Compact search strip and summary bands. Preserve offer type, font size, source links, green confirmed / amber review colors and uncertainty warnings. No search or pricing changes. |
| Shipping calculator | Intro, panel header and nested result tiles make a short form tall. | Compact intro/fields and flat blue inputs / green results; remove decorative dark result tile. Keep sea/air calculations, packaging caveats and full reference tables. |
| Analytics / website contacts | Dense comparison tables and charts benefit from their existing row/plot spacing. | Only shared header/panel and form spacing changes; preserve chart sizes, statistics, filters and exports. |
| Telegram intake | Already a focused conversation/review split with collapsed setup. Transcript needs line spacing and separate messages. | Leave unchanged. |
| Customer documents | Already compact and visually grouped in the preceding changes. Printable artifacts have different spacing needs. | Leave editor, invoice, agreement and print/PDF layout unchanged. |

## Guardrails

- No fields, actions, confirmations or permissions removed; data attributes and form names retained.
- Flat section backgrounds, not nested floating cards. Color supplements visible headings.
- Keep 14 px desktop form values and 16 px phone inputs; phone action targets at least 44 px.
- Keep request text editable in full, and all payment/receipt amounts readable.
- Do not let the sticky save bar cover the final field at maximum scroll.
- Regression checks cover all order tabs, status notification, saving across groups,
  supplier payment submission/retry, standalone search, China request/photo, delivery,
  analytics/contacts, overflow and sea/air calculations on desktop and phone widths.

## Verification

- 216/216 unit and integration tests passed.
- Isolated browser scenarios passed at 1440, 1024, 768, 390 and 320 px, including
  field geometry, readable phone inputs, touch targets, saving across all three
  request groups and delivery settings, failure recovery and supplier payment retries.
- Public forms audit: 155 forms passed. Link audit: all 5,565 references resolved.
- Production deployment includes UI/templates and regression tests only; no database
  migration, financial formula, search algorithm, customer document or bot change.
