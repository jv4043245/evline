# Market research quality revision

Extends the approved admin usability revision, based on production `a95547f`.

## Manager workflow

- Green: an exact article or explicit product cross-number was verified on the product page, with no detected conflict. This is evidence of an article match, not a VIN fitment guarantee.
- Amber: plausible descriptions or incomplete product evidence. Reasons and optional quoted AI concerns are visible; prices are excluded from the market average.
- Red: conflicting component, vehicle, side, position, technology, condition, or a manager rejection. Collapsed by default, never averaged.
- All colors have labels and counts. The order tab and standalone search share rendering and comparison rules.
- "Not this part" records a request-scoped rejection, reason and authenticated admin identity. Undo restores algorithmic classification. Rejections do not train an external model or silently blacklist all offers from a seller.

## Evidence and pricing

Structured HTML parsing binds each price to its own card. Detail-page verification adds explicit cross-numbers, fitment and attributes. Article suffixes are preserved. Aggregate prices, neighboring products, unknown currencies and unrelated Prom merchants cannot establish a confirmed UAH offer.

Statistics use only verified exact UAH offers, grouped by comparable type, condition, stock and component traits. Each seller contributes its minimum comparable offer once. Stock is not inferred from missing data. Conflicts between visible delivery terms and structured stock are shown as uncertain, retaining the visible lead time.

The eleven approved sources remain the starting set. MAHINA requires the explicit empty `filters={}` query argument used by its own search form; without it the page repeats the query in its heading but returns unrelated catalogue items. Fetching has HTTPS same-host redirect checks, time/byte/request limits and no challenge bypass. A protected or unreadable source is not reported as a successful empty search. At most three requested items and one detail candidate per source/item are checked per run; incomplete coverage is an explicit limitation.

## AI and privacy

The existing Workers AI binding is optional. `MARKET_AI_ENABLED=false` disables it; `MARKET_AI_MODEL` can override the default `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

AI can extract verbatim spans from long requests and downgrade a candidate to manual review only with quotes found on both sides. It cannot invent an OEM, price, compatibility or stock, or promote an offer. Missing binding, timeout or invalid output falls back to deterministic rules. VINs, contact handles, phone numbers and emails are removed from outbound request text. No VIN decoding or new external search subscription is introduced.

## Storage and verification

`0025_market_feedback.sql` adds an independent feedback table; runtime initialization is idempotent. Existing order/payment data is untouched. Product evidence is retained in existing research JSON. Matching version 4 invalidates old classification/source-query caches.

Cloudflare Pages must run `npm ci --ignore-scripts --omit=dev` as its build command. An empty command skips dependency installation; Functions then cannot resolve the HTML parser. This command was configured on the existing production Pages project without changing bindings or secrets.

Local verification: automated Node tests; D1-compatible SQLite round trips; four Playwright widths (1440, 1024, 768, 390); public form/link audits; Cloudflare Functions compilation. Public read-only probes verify MAHINA cross-number/price and the schema-versus-visible-stock conflict, and retain failures for protected/unreadable sources. Browser tests mock every admin API: they create no live orders, payments or Telegram messages.

Live source markup and inventory can change. Green matches still require seller confirmation of availability and equipment; unsupported or ambiguous fitment remains a manager decision.
