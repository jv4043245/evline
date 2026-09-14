# VIN lookup for market research

## Activation

The integration is disabled by default. A normal 17VIN website login is not an
API account. Ask 17VIN support for an API trial, current pricing and coverage of
Chinese-market ZEEKR, BYD, Geely and Toyota vehicles before purchasing access.

- [API account opening](https://www.17vin.com/faq/purchase_17vin_api.html)
- [VIN decoding API 3001](https://www.17vin.com/doc/3001.html)
- [Authentication](https://en.17vin.com/doc/1003.html)

Suggested support request:

> Hello. We operate EVLine, a Ukrainian auto-parts business. We would like a trial
> API account for endpoint 3001, VIN-to-model decoding, including Chinese-market
> ZEEKR, BYD, Geely and Toyota. Please confirm coverage, English model fields,
> HTTPS POST support, trial credit, current per-query pricing and account limits.
> We need make, model and model year; we do not need vehicle-owner information.

In Cloudflare Pages, project `evline`, Settings, Variables and secrets, add in
Production:

- `VIN17_API_USER`: Secret, API username supplied by 17VIN.
- `VIN17_API_PASSWORD`: Secret, API password supplied by 17VIN.
- `VIN_LOOKUP_ENABLED`: text variable `true`, only after approval to use the API.

Redeploy after configuration changes. Keep credentials out of Git, browser code,
chat transcripts and screenshots. To disable decoding, set
`VIN_LOOKUP_ENABLED=false` and redeploy. Existing manual model and article search
continues to work without these settings.

Before enabling for daily use, check authorized sample VINs with known models.
Test exact matches, ambiguous results, account errors and a manually specified
model. Automated tests use synthetic VINs and mocked API responses: they do not
validate the provider's live coverage or commercial account.

## Behavior

- No paid VIN calls during lead submission, seed preparation or a read-only GET.
  The authenticated admin continuation performs VIN decoding as its own step
  before the per-source competitor requests.
- An explicit model or article takes precedence. Only a valid full 17-character
  VIN is sent. No prefix-based guessing or silent O/I/Q corrections.
- Only `exact_match` with one unanimous make/model across all returned variants
  supplies the search model. Trim, generation and part compatibility are not
  inferred. Conflicts with the supplied brand require manual clarification.
- The model is used in market research, not written over the order's vehicle,
  customer information, prices or status.
- Without decoding, a known brand and recognizable component can still yield
  unconfirmed offers. They never contribute to the confirmed price corridor.
- An authenticated manual search refresh uses the cached decoding. After API
  activation, old results marked `not_configured` are refreshed automatically
  when the market tab is opened.

## Data and reliability

VIN is sent only to `https://api.17vin.com:8443/` in a POST body; redirects are
forbidden. Competitors receive model/part/article queries, never the VIN.
The response is bounded to 1 MB and 5 seconds. Provider errors are sanitized.
MD5 is used solely for the provider's required signature protocol; Cloudflare
Workers supports this legacy digest. Cache identifiers use SHA-256 of the full
normalized VIN, not its prefix or MD5.

`market_vin_cache` is created additively with D1 `prepare().run()`. It stores a
hashed key and a minimal decoded model result, not raw VINs or API responses.
Resolved results are reused for 30 days, uncertain results for one day and
transient failures for five minutes. A 30-second lease coalesces overlapping
requests. No manual D1 migration is required.

Checks: `npm test` and `scripts/admin-usability-smoke.mjs` cover decoding,
authentication shape, fail-safe responses, cache behavior, incremental workflow,
brand-only fallback and desktop/mobile presentation.
