# In-app purchase products (App Store Connect, Google Play, RevenueCat)

Every product the iOS / Android apps sell. The source of truth is
`artifacts/api-server/src/lib/storeProducts.ts`; `storeProducts.test.ts` fails if a
product id there is missing from this page. Prices come from the existing config
(`PLAN_CATALOGUE`, `CREDIT_PACKS`, `FEATURED_PRICE_LIST`, Boost / Create-ad budget
tiers). In App Store Connect, pick the nearest price point to the amount shown.

Web keeps Stripe Checkout for all of these. Native builds never open Stripe for a
digital purchase.

## Products

| Product id | Type | Reference name | Price (USD) | RevenueCat |
|---|---|---|---|---|
| `brandthread_starter_monthly` | Auto-renewable subscription | Brandthread Starter Plan | $29.00 | offering package $bt_starter |
| `brandthread_growth_monthly` | Auto-renewable subscription | Brandthread Growth Plan | $79.00 | offering package $bt_growth |
| `brandthread_pro_monthly` | Auto-renewable subscription | Brandthread Pro Plan | $199.00 | offering package $bt_pro |
| `brandthread_ai_credits_500` | Consumable | AI credits · 500 credits | $5.99 |  |
| `brandthread_ai_credits_1500` | Consumable | AI credits · 1,500 credits | $14.99 |  |
| `brandthread_ai_credits_5000` | Consumable | AI credits · 5,000 credits | $44.99 |  |
| `brandthread_boost_5` | Consumable | Boost · $5 budget | $5.00 |  |
| `brandthread_boost_10` | Consumable | Boost · $10 budget | $10.00 |  |
| `brandthread_boost_25` | Consumable | Boost · $25 budget | $25.00 |  |
| `brandthread_boost_50` | Consumable | Boost · $50 budget | $50.00 |  |
| `brandthread_boost_100` | Consumable | Boost · $100 budget | $100.00 |  |
| `brandthread_boost_250` | Consumable | Boost · $250 budget | $250.00 |  |
| `brandthread_boost_500` | Consumable | Boost · $500 budget | $500.00 |  |
| `brandthread_ad_5` | Consumable | Ad campaign · $5 budget | $5.00 |  |
| `brandthread_ad_10` | Consumable | Ad campaign · $10 budget | $10.00 |  |
| `brandthread_ad_25` | Consumable | Ad campaign · $25 budget | $25.00 |  |
| `brandthread_ad_50` | Consumable | Ad campaign · $50 budget | $50.00 |  |
| `brandthread_ad_100` | Consumable | Ad campaign · $100 budget | $100.00 |  |
| `brandthread_ad_250` | Consumable | Ad campaign · $250 budget | $250.00 |  |
| `brandthread_ad_500` | Consumable | Ad campaign · $500 budget | $500.00 |  |
| `brandthread_featured_3d` | Consumable | Featured on Discover · 3 days | $29.00 |  |
| `brandthread_featured_7d` | Consumable | Featured on Discover · 7 days | $59.00 |  |
| `brandthread_featured_14d` | Consumable | Featured on Discover · 14 days | $99.00 |  |

The product id is what the server trusts: `brandthread_boost_25` always buys 5 of
reach, `brandthread_featured_7d` always buys a 7-day Featured slot.

## Seller plans: subscription group + 7-day free trial

App Store Connect → your app → Subscriptions:

1. Create one subscription group, **Brandthread Seller Plans**. Put all three plans in it,
   ranked Pro (1), Growth (2), Starter (3), so upgrades and downgrades work.
2. For each plan: duration **1 Month**, the price above.
3. For each plan: **Subscription Prices → Introductory Offers → +**. Pick all territories,
   **Free**, duration **1 Week**, eligibility new subscribers. This is the 7-day free trial.
   App Store Connect offers 3 days, 1 week, 2 weeks or 1 month. 1 week is the only option that matches the app's
   "Free for 7 days" copy. Apple enforces one introductory offer per Apple ID per
   subscription group.

Google Play Console → Monetize → Subscriptions:

1. Create the three subscriptions with the same ids. Each gets one base plan with id
   `monthly` (auto-renewing, 1 month). The server already maps `<id>:monthly`.
2. On each base plan add an offer, `free-trial-7d`: eligibility "New customer
   acquisition → never had this subscription", phase **Free trial, 7 days**.

## Consumables

Create every Consumable row above in App Store Connect (In-App Purchases → +
→ Consumable) and in Play Console (Monetize → In-app products), each with the same id.

## RevenueCat

1. Project → Products: import every id above from both stores.
2. Offerings → `default`: packages `$bt_starter`, `$bt_growth`, `$bt_pro` (custom identifiers),
   each holding the matching iOS + Android subscription. The app only shows these three packages.
   Consumables need no offering. The app loads them with `getProducts`.
3. Integrations → Webhooks: `https://<api-domain>/api/webhooks/revenuecat`, with the
   Authorization header value set to `REVENUECAT_WEBHOOK_AUTHORIZATION`.
4. Replit: connect the **RevenueCat** connector (the server reads purchases through it).

## Environment variables

| Where | Name | Value |
|---|---|---|
| EAS (build env) | `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | RevenueCat → API keys → Apple public key |
| EAS (build env) | `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | RevenueCat → API keys → Google public key |
| API (Replit secrets) | `REVENUECAT_PROJECT_ID` | RevenueCat project id |
| API (Replit secrets) | `REVENUECAT_WEBHOOK_AUTHORIZATION` | Any long random string, same as in the webhook |
| API (optional) | `IAP_PROMOTIONS_ENABLED` | Leave unset (on). `false` pauses promotion grants; RevenueCat retries until it's on again |
| EAS (optional) | `EXPO_PUBLIC_IAP_PROMOTIONS` | Leave unset (on). `0` is for local debugging only and must never ship |

## Purchases that could not be applied

A Boost, ad or Featured purchase that cannot be applied is never dropped. Examples: the
post was removed, the budget changed, or the promotion was rejected or cancelled before it ran.
The purchase stays on the seller's account as credit, and their next promotion of the
same kind and amount uses it instead of charging again. Apple and Google handle actual
refunds of store purchases.

## Sandbox check before submitting

With a sandbox Apple ID on a TestFlight build, do the following:
1. Start a plan. The sheet shows "1 week free".
2. Boost a post at 5.
3. Buy a 7-day Featured slot.
4. Buy a credit pack.
Each should appear in RevenueCat → Customers, and the boost or slot should move to "In review".
