# Brandthread web deployment configuration

The static web export uses `https://brandthread.app` as its canonical production
origin. It generates `robots.txt`, `sitemap.xml`, route metadata, social tags,
and JSON-LD during `pnpm --filter @workspace/mobile run build`.

Optional advertising measurement is disabled by default. To enable a provider,
set its real production ID in the deployment environment:

- `EXPO_PUBLIC_META_PIXEL_ID` — numeric Meta Pixel ID.
- `EXPO_PUBLIC_TIKTOK_PIXEL_ID` — alphanumeric TikTok Pixel ID.

Do not commit either ID to source control. Missing, malformed, or placeholder
values are ignored. Even with a configured ID, scripts are not loaded and no
pixel event is sent until the browser user explicitly grants the Marketing
category in Brandthread's cookie preferences.

Supported event names are `PageView`, `ViewContent`, `AddToCart`,
`InitiateCheckout`, `Purchase`, and `CompleteRegistration`. Add new event names
only after reviewing the consent and data-minimization implications.