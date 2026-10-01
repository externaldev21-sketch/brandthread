# Push consent (4.5.4) and guest browsing (5.1.1(v))

Builds on `docs/launch/app-store-readiness.md`. Scope: items 6 and 8 of the review-readiness list.

## 6. Guideline 4.5.4 - promotional push needs an explicit opt-in

### Sender audit (api-server)

Every push reaches a device through one function, `sendPushToUser` in `artifacts/api-server/src/lib/push.ts`. `publishNotification` (`routes/notifications-feed.ts`) writes the in-app feed row and then calls it. `lib/sendPush.ts` (`sendPushNotifications`, raw tokens, no user) has no callers; do not use it for new senders.

| Sender | Type | Class | Result |
|---|---|---|---|
| Orders, order status, delivery, refunds, returns (`orderNotifications`, `delivery/*`, `orders.ts`, `returns.ts`, `sample-orders.ts`, Shopify order webhooks) | `order_*`, `return_*` | Transactional | Unchanged |
| Messages, calls (`conversations.ts`, `call.ts`) | message / call | Transactional | Unchanged |
| Payouts, payments, disputes, production (`finance.ts`, `webhooks.ts`, `manufacturer*.ts`) | payout, payment, production | Transactional | Unchanged |
| Subscription and trial (`sellerTrialReminder`, `webhooks.ts`) | trial, billing | Transactional (account) | Unchanged |
| Low-stock alert to the seller (`notifyStockLevelChanged`) | `low_stock` | Transactional (own inventory) | Unchanged |
| Likes, comments, mentions, reposts, story mentions, follows, Thread Cash received (`activityEvents`, `posts.ts`, `social.ts`) | social | Transactional (activity on your content) | Unchanged |
| Community chat (`communityPush`) | community | Transactional | Unchanged |
| Seller drop broadcast to followers (`dropBroadcast`, `scheduledDropBroadcasts`) | `drop_live` | **Promotional** | Blocked unless promo opt-in, or the user subscribed to that drop ("Notify me") |
| New product from a followed brand (`notifyNewProduct`) | `new_product` | **Promotional** | Blocked unless promo opt-in |
| Price drop on a saved item (`notifyPriceDrop`) | `price_drop` | **Promotional** | Blocked unless promo opt-in |
| Back in stock on a saved item (`notifyBackInStock`) | `back_in_stock` | **Promotional** | Blocked unless promo opt-in |
| Abandoned cart (`jobs/abandonedCartRecovery`) | `abandoned_cart` | **Promotional** | Feed row only today, never pushed. The type is on the promo list so a future push is gated |
| Digest | - | - | No push sender exists (`notification_digest` is stored only) |
| Klaviyo (`lib/klaviyo.ts`) | email | Out of scope (email) | See owner actions |

### Enforcement

- `users.promo_push_opt_in BOOLEAN NOT NULL DEFAULT FALSE` (migration `260_promotional_push_opt_in.sql`, drizzle `lib/db/src/schema/index.ts`). Every existing user is false after migration.
- `lib/pushPolicy.ts` holds the classification (`PROMOTIONAL_PUSH_TYPES`, or `kind: "promotional"` on the payload) and `promoConsentAllows`.
- `sendPushToUser` calls `promoConsentAllows` right after the master switch and before quiet hours, category toggles and token lookup. A promotional push returns `false` without touching tokens. Transactional pushes never reach that branch.
- The existing category toggles (`new_drops`, `price_alerts`, ...) still apply on top, so a promo push needs both the promo opt-in and its category on.
- `GET/PUT /api/notification-prefs` (and `/api/seller/notification-prefs`) now carry `promotionalPush` (boolean, default false). The existing `categories` map is untouched; promo consent is a separate column so it cannot be flipped by a category write.
- Tests: `artifacts/api-server/src/lib/pushPolicy.test.ts` proves default-off blocks promo (even with the category toggle on), opt-in allows it, transactional is never blocked, and the master switch and category toggles still win.

### UI (additive)

One row in the existing Settings > Notifications screen (`app/notifications-settings.tsx`): "Promotions & offers", toggle OFF by default, own card under the category list. No pop-up, no new screen.

### OS permission prompt

`lib/contextualPushPermission.ts` asks only after a real value event (first order, first message, etc.), once per user, and the app shows no pre-prompt copy. Nothing asks for permission with promotional wording. Unchanged.

### Not changed

The buyer-only toggles in `app/buyer-settings-detail.tsx` (section `notifications`) still write the same categories. The promo row lives in `notifications-settings.tsx`, which is the screen linked from More and Profile.

## 8. Guideline 5.1.1(v) - guests browse without an account

### Audit

| Item | Before | After |
|---|---|---|
| Launch when signed out | `/` -> splash -> onboarding, or `/sign-in`. No way to browse | "Browse as a guest" link on the welcome screen and on sign-in, opens Discover |
| AuthGate allow-list | Only discover, search, cart, product detail, checkout, seller profile, profile videos/products | `lib/guestRoutes.ts`: adds the buyer home feed, discover feed, buyer search, post viewer/comments, drops, store product, public profile, public collection. Inbox, orders, settings, seller tabs stay behind sign-in |
| Browse APIs signed out | `/api/public/*` (products, search, drops, posts, profiles, discover feed, trending, collections) have no `requireAuth` | PASS, unchanged |
| Account APIs signed out | The buyer tab bar polled `/api/conversations` and `/api/buyer/notifications` every 30s with no token (server 401) | `lib/guestApiPolicy.ts`: `lib/api.ts` and `lib/serviceConfig.ts` short-circuit paid and account-scoped paths locally when there is no token. No request leaves the device |
| Buy | Product detail already sent guests to `/sign-in` (no return) | Same gate, now with `returnTo`. Guest checkout (`/api/guest/checkout`) is unchanged |
| Follow, message (seller profile) | No gate | Inline gate -> `/sign-in?returnTo=` |
| Like, save, repost, follow (feed) | Optimistic then 401 | Inline gate -> `/sign-in?returnTo=` |
| Post | Reachable only from signed-in areas | Unchanged (AuthGate) |
| After sign-in | Always landed on the dashboard | `sign-in` and AuthGate honour a validated `returnTo` (`safeReturnTo`: in-app paths only) |

The gate is the existing sign-in screen with a `returnTo` param. No new sheet or interstitial. Dev/screenshot previews (`bt_preview`, `DEV_BYPASS_ROLE`) are never gated.

### Known limits

- `app/(buyer)/inbox`, `orders`, `profile` still bounce a guest to sign-in by design (account-only).
- Live viewing (`buyer-live`, `live-feed`) is not on the guest list: joining a stream needs an account token.
- `POST /api/onboarding-sample/logo` is reachable signed out by design (onboarding sample, rate limited server side). Flagged for the owner.
- Tests that assert source text of unrelated screens (e.g. `tests/buyer-screens-bar-inset.test.ts`) and several mock-based suites (`react-native-svg`, syntax errors) already fail in this checkout; they do not touch these files.

### Verification

See the PR body for what was run at 393x852 and the screenshots under `docs/pr-assets/claude-review-ready-push-guest/`.

## Owner actions

1. Apply migration `260_promotional_push_opt_in.sql` before or with the api-server deploy. The server reads `users.promo_push_opt_in`; without the column the recipient lookup in `sendPushToUser` throws and every push, transactional included, is skipped until the column exists.
2. If Klaviyo marketing email is enabled, confirm it has its own consent capture; it is outside this push audit.
3. App Store Connect review notes: state that the app can be browsed as a guest and that promotional notifications are off until turned on in Settings > Notifications.
