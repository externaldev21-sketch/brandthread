# Observability: crash reporting and product analytics

Two optional services, both **off until Dev supplies a key**. With no key set nothing is initialised, no timer runs, no network call is made, and nothing can throw.

| Service | What it is for | Mobile / web app | API |
| --- | --- | --- | --- |
| Sentry | Crashes and errors | `EXPO_PUBLIC_SENTRY_DSN` | `SENTRY_DSN` |
| PostHog | Funnel analytics | `EXPO_PUBLIC_POSTHOG_KEY` | `POSTHOG_API_KEY` |

## Where Dev signs up

1. **Sentry** (sentry.io): create two projects, one "React Native" for the app and one "Node.js" for the API. Put the React Native project DSN in `EXPO_PUBLIC_SENTRY_DSN` (expo.dev environment variables, production and preview, plus the web deployment) and the Node project DSN in `SENTRY_DSN` on the API host. Source-map upload (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) is already covered in `docs/app-store/release-flow.md`.
2. **PostHog** (posthog.com): create one project. Copy its **Project API key** (starts with `phc_`). Use the same key for both variables below. Project API keys are write-only and safe to ship in the app.

| Variable | Where | Required | Notes |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_POSTHOG_KEY` | expo.dev env vars + web deployment | no | Turns on app analytics |
| `EXPO_PUBLIC_POSTHOG_HOST` | same | no | Default `https://us.i.posthog.com`; use `https://eu.i.posthog.com` for an EU project |
| `POSTHOG_API_KEY` | API host | no | Turns on server events |
| `POSTHOG_HOST` | API host | no | Same default |
| `SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_DSN` | see above | no | Already supported |

The API lists `SENTRY_DSN` and `POSTHOG_API_KEY` in the optional-variable warning at start-up (`artifacts/api-server/src/lib/env.ts`).

**To turn everything off:** unset the variables and redeploy (app: rebuild or re-export, since `EXPO_PUBLIC_*` values are compiled in). Nothing else is needed. On the web, a visitor also turns app analytics off at any time with "Change cookie preferences".

## Sentry: what already existed (audited, unchanged)

- API (`lib/monitoring.ts`, `instrument.ts`): initialised from `SENTRY_DSN`; every error-level log line carrying an `err` (global Express error handler `apiErrorHandler`, route catch blocks, background jobs) is reported; expected client errors below 500 are skipped; tags `job`, `errorCode`, `status`, `request_id`, `method`, `path` (no query string); headers, cookies and bodies are stripped; unhandled exceptions and rejections are Sentry defaults; events are flushed on shutdown. A test asserts that no user id or email is ever sent, so the API deliberately does **not** tag the user.
- App (`lib/monitoring.ts`, `components/ErrorBoundary.tsx`): initialised first from `index.ts` through `lib/bootstrap.ts`; Expo config plugin `@sentry/react-native/expo` and `plugins/with-sentry-upload-guard` are registered in `app.json`; `sendDefaultPii: false`; query strings and non-dev console breadcrumbs are scrubbed; native crashes, `onerror` and unhandled promise rejections use the SDK defaults; release and dist come from the native app version and build number set by the SDK; environment comes from the EAS update channel.

## Sentry: gaps closed in this change

- The root layout is wrapped with `Sentry.wrap` (touch and navigation context) through `wrapRootComponent`, only when Sentry is on; with no DSN the component is returned untouched.
- API responses with status 500 and above are reported from `lib/api.ts` (through the dependency-free `lib/monitoringHooks.ts`, so tests do not load the SDK). The report carries method, status and a normalised path (ids and query strings removed), never the response body.
- Reports are tagged `account_role` (`buyer`, `seller` or `signed_out`) and `expo_update_id` (the running over-the-air bundle).
- By default the app does **not** attach the Clerk id to crash reports. `docs/app-store/privacy-labels.md` declares crash data as not linked to the user, and adding an id would make that answer wrong. `setMonitoringUser(userId)` (called from `components/AnalyticsBridge.tsx` on sign-in, sign-out and account switch) sets Sentry `user: { id }` (opaque id only, never name or email) **only** when the build sets `EXPO_PUBLIC_SENTRY_LINK_USER=1`. Update the privacy label first, then set that env var.
- Each route change leaves a `navigation` breadcrumb with the route pattern only (for example `/(tabs)/profile/[username]`), never the id or username in the URL.

## PostHog: how it is built

- **App** (`lib/analytics/`): a small `fetch` client posting batches to `{host}/batch/`. No SDK and no native module were added, so there is nothing to crash at start-up and no lockfile change. Events queue in memory (20 per batch or every 10 seconds, at most 200 queued) and a failed batch is dropped.
- **API** (`artifacts/api-server/src/lib/analytics.ts`): the same design, fire-and-forget from a timer, unref'd so it never holds the process open, flushed on graceful shutdown. It is a no-op with no key and always a no-op when `NODE_ENV=test`.
- `components/AnalyticsBridge.tsx` (renders nothing, mounted in `RootLayoutNav`) keeps consent, the signed-in account and preview state in sync and sends `app_opened`.

### Consent and identity

| Situation | Behaviour |
| --- | --- |
| Web, no cookie choice or "Necessary only" | Nothing is sent |
| Web, Analytics category granted (`lib/cookieConsent.ts`) | Events are sent; withdrawing consent stops sending and clears the queue. Events from before consent are dropped, never replayed |
| iOS / Android | The app has no cookie banner or tracking prompt (`docs/app-store/privacy-labels.md`), so events are sent, but only the events below and only opaque values |
| `?bt_preview=` sessions and `EXPO_PUBLIC_DEV_BYPASS_ROLE` | Never send |
| Signed out | Anonymous per-launch id, no person profile |
| Signed in | The opaque Clerk user id is the only identifier. Email, name and phone are never sent |

IP-based geolocation is disabled on every event (`$geoip_disable`).

### PII rules (enforced in code and tested)

Every event name and property key is in an allow-list (`lib/analytics/events.ts`, `api-server/src/lib/analytics.ts`). An unknown event is dropped, an unknown property is dropped, and a value is kept only if it is a boolean, a finite number, or a short token (letters, digits, `_ . : -`, at most 48 characters). That rejects free text, email addresses, addresses, message text and search text even under an allowed key. Order values are sent as a bucket (`0-25`, `25-50`, `50-100`, `100-250`, `250-500`, `500-1000`, `1000-plus`), never the exact amount.

### Events

| Event | Fires when | Where | Properties |
| --- | --- | --- | --- |
| `app_opened` | Once per launch, as soon as sending is allowed | `AnalyticsBridge` | `platform` |
| `signup_started` | Email sign-up accepted, code sent | `app/onboarding.tsx` | `method` |
| `signup_completed` | Email code verified; or a new Google/Apple account created | `app/onboarding.tsx`, `app/sign-in.tsx` | `method` |
| `onboarding_completed` | The API confirms onboarding for a buyer or seller | `api.auth.completeOnboarding` | `account_type` |
| `seller_onboarding_completed` | Same call, seller accounts | `api.auth.completeOnboarding` | none |
| `product_viewed` | Product detail loaded | `app/buyer-product-detail.tsx` | `surface` |
| `add_to_cart` | An item is saved to the cart | `services/cartService.ts` | `quantity` |
| `checkout_started` | A checkout session or payment intent is created (signed in or guest) | `api.buyer.checkout.createSession`, `...paymentIntent.create`, `api.guest.checkout.createSession` | `flow`, `item_count` |
| `post_viewed` | A post opens in the post viewer | `app/buyer-post-viewer.tsx` | `post_type` |
| `video_watched` | About 2 seconds of real playback (`useMeaningfulVideoWatch`), when the watch is recorded | `api.posts.recordWatchedVideo` (feed and post viewer) | `surface` |
| `follow` | The follow request succeeds | `api.social.follow` | `surface` |
| `message_sent` | A direct message is accepted by the API | `api.conversations.send` | `surface`, `has_attachment` |
| `live_joined` | Joining a live stream succeeds | `api.live.join` | `surface` |
| `product_published` | The product create request succeeds | `api.products.create` | none |
| `first_product_published` | The first successful product create for the account (de-duplicated per account on the device) | `api.products.create` via `lib/analytics/firstEvents.ts` | none |
| `first_sale` | The seller's order list goes from empty (seen earlier on this device) to non-empty; never fires for a seller first seen with orders | `api.orders.list` via `lib/analytics/firstEvents.ts` | none |
| `checkout_completed` | Payment confirmed in the app (one-page, hosted, guest, buy now, live). Named apart from the server's `purchase_completed` so the two never double count | `app/buyer-checkout.tsx`, `components/buy-now/BuyNowFlow.tsx`, `app/buyer-live.tsx` | `flow`, `item_count` |
| `purchase_completed` | **Server-side.** Stripe confirms payment and the order row is created (not for oversold, auto-refunded orders, and only once per order) | `api-server/src/routes/webhooks.ts`, `handleCheckoutPaid` | `amount_bucket`, `currency`, `item_count`, `charge_model`, `is_guest` |

Client events that hang off an API call fire only after it succeeds; a failure is left exactly as it was.

### Not instrumented

- `design_created`: the only hook points are in Design Studio files, which are owned by another workstream. Add `track('design_created')` there once that work has landed. The event is not in the allow-list yet, so it must be added to `lib/analytics/events.ts` at the same time.
- `video_watched` for stories and live replays: they do not use `useMeaningfulVideoWatch`.

## Tests

- App: `lib/analytics/analytics.test.ts` (allow-list, PII scrubbing, config, consent gate, no-key no-op, batching, failure swallow), `lib/monitoringApiPath.test.ts`.
- API: `src/lib/__tests__/analytics.test.ts` (same, plus `NODE_ENV=test` no-op).
- `scripts/observability-preview-check.mjs` builds the web preview and checks, at 393x852, for page errors and any PostHog or Sentry request, with no keys and with a dummy PostHog key and no consent.

## Release controls

- **Release flags** (`lib/featureFlags.ts`): a typed registry of flags (name, default, description). Each resolves from a remote override (`flags` in `GET /api/v1/app/config`, server env `APP_FLAGS`, cached in AsyncStorage), then the build env `EXPO_PUBLIC_FLAG_<NAME>`, then the default. Unfinished work defaults to off. Use `isFeatureEnabled(name)` or the `useFeatureFlag(name)` hook. These are separate from the operator kill switches in `contexts/FeatureFlagContext.tsx` (`/api/config/features`, signed-in only).
- **Force update** (`components/ForceUpdateGate.tsx`, `lib/forceUpdate.ts`): `GET /api/v1/app/config` (public, env only, no database) returns `minSupportedVersion` per platform from `MIN_APP_VERSION_IOS` / `MIN_APP_VERSION_ANDROID`. When the running native version is older and a store URL is known (`APP_STORE_URL_IOS` / `APP_STORE_URL_ANDROID`, or `EXPO_PUBLIC_IOS_APP_STORE_ID` / the Android package), a blocking "Update Brandthread" screen opens the store. Never on web, in development, or when the endpoint fails. Kill switch: release flag `force_update_gate`.
- **Critical OTA updates** (`lib/otaUpdates.ts`): an update whose id is in `OTA_CRITICAL_UPDATE_IDS` (or whose app config has `extra.critical: true`) is applied when the app returns from at least 5 minutes in the background, instead of waiting for the next cold start. Kill switch: release flag `critical_ota_reload`.
