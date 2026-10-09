# In-app purchase rails audit (App Store 3.1.1 / Play Payments)

Scope: every place money changes hands in `artifacts/mobile` and `artifacts/api-server`, which rail it uses today, and which rail the stores require. Builds on `docs/launch/app-store-readiness.md` rows 8-11.

Rule applied: digital goods or features consumed inside the app, bought on native iOS/Android, must use StoreKit / Play Billing (here through RevenueCat). Physical goods and real-world services may use Stripe (3.1.3(e) and the Play equivalent). Web builds are not store-distributed, so Stripe stays there.

## Purchase paths

| # | Path | What is bought | Digital / physical | Rail today | Required rail | Status |
|---|------|----------------|--------------------|------------|---------------|--------|
| 1 | Seller plans (Starter / Growth / Pro) - `app/plans.tsx:230`, `app/subscription.tsx:183`, `lib/revenueCat.native.tsx`, `lib/sellerBilling.ts`, API `routes/webhooks.ts` `/revenuecat`, `lib/nativeEntitlements.ts` | Subscription unlocking in-app tools | Digital | Native: RevenueCat. Web: Stripe Checkout (`routes/subscription.ts:396`) | RevenueCat on native | PASS. Native code never reaches Stripe. Server still serves `POST /seller/subscription/checkout` to any authenticated caller; the native client does not call it (see "Hardening left" below). |
| 2 | Boost a post - `app/boost.tsx`, API `routes/boosts.ts` | Paid reach for a post | Digital | Stripe Checkout on every platform | RevenueCat consumable on native | FIXED (on by default). Native buys `brandthread_boost_<tier>` through the store sheet; web unchanged. |
| 3 | Create ad (Brandthread Ads) - `app/design-campaign.tsx`, API `routes/ad-campaigns.ts` | Paid in-app ad placement | Digital | Stripe Checkout on every platform | RevenueCat consumable on native | FIXED (on by default). Native buys `brandthread_ad_<tier>`; web unchanged. |
| 4 | Meta Ads - `app/meta-ads-*.tsx`, `routes/meta-ads.ts` | Ads on Facebook/Instagram | n/a | Meta bills the seller's own Meta ad account; Brandthread takes no payment | none | PASS. Not a Brandthread sale. |
| 5 | AI credits / AI tool packs | - | - | No credit or pay-per-use AI product exists. AI tools are gated by seller plan (`requirePlan("growth")`, `routes/index.ts:149-154`) | Plan via RevenueCat (row 1) | PASS. If credit packs are ever added they must be RevenueCat consumables. |
| 6 | Thread Cash top-up / buying Thread Cash | - | - | No such path. Balance sources are daily check-in, streak bonus, refund credit, peer transfer (`lib/threadCash/wallet.ts` `source:` values). No Stripe or RevenueCat code credits it. `drop-wallet` deposits return 410 (`routes/drop-wallet.ts:124`) | Not sellable for money unless spent only on physical goods | PASS. Verified server and UI (no buy button in `app/thread-cash.tsx`, `components/live/LiveThreadCashSheet.tsx`). Stale comment in `lib/threadCash/cashOut.ts` claimed buyers buy it via Apple IAP; corrected. |
| 3b | Spending Thread Cash at checkout - `components/checkout/ThreadCashSection.tsx`, `lib/threadCashCheckout.ts` | Discount on a physical order | Physical | Balance (platform funded) + Stripe card | As is | PASS. Discount on physical goods only; server-enforced ceiling (`routes/buyer.ts`). |
| 7 | Live gifts / tips - `components/live/LiveThreadCashSheet.tsx`, `POST /thread-cash/live-gift` | Gift to a streamer, paid from Thread Cash balance | Digital (virtual gift) | Thread Cash balance only, never money | If Thread Cash is never bought, no IAP needed | PASS today. Risk to keep in mind: gifts land as cashable seller value (`cashOut.ts`), so the moment Thread Cash becomes purchasable, gifts must be IAP. Keep it non-purchasable. |
| 8 | Featured on Discover - `app/featured-slot.tsx`, API `routes/featured-slots.ts` | A time-boxed Featured slot on Discover | Digital | Native: RevenueCat consumable `brandthread_featured_<3|7|14>d`. Web: Stripe Checkout | RevenueCat consumable on native | FIXED (on by default). |
| 9 | Freelancer jobs - `app/freelancer-profile.tsx:122`, `routes/freelancer-jobs.ts:203` | Paid services from a human freelancer (escrow) | Service, performed outside the app | Stripe Checkout | Stripe allowed if reviewed as a real-world service (3.1.3(d)/(e)) | RISK (unchanged). Deliverables can be digital files; call it a person-to-person service marketplace in review notes (already in `docs/launch/app-store-metadata.md`). No code change. |
| 10 | Sample orders / production orders - `app/sample-detail.tsx`, `components/manufacturer/useOrderCardPayment.ts`, `routes/sample-orders.ts` | Physical samples / manufactured goods | Physical | Stripe Checkout | Stripe | PASS. |
| 11 | Shop checkout (cart, buy-now, one-page, guest) - `app/buyer-checkout.tsx`, `components/buy-now/BuyNowFlow.tsx`, `routes/buyer.ts`, `checkout-intent.ts`, `guest-checkout.ts` | Physical products from sellers | Physical | Stripe (PaymentIntent / Checkout) | Stripe | PASS. |
| 12 | Drop pre-orders - `lib/money/dropLifecycle.ts` | Physical pre-orders | Physical | Stripe | Stripe | PASS. |
| 13 | Shipping labels - `routes/shipping-labels.ts` | Postage for physical orders | Physical service | Paid from order's held funds | As is | PASS. |
| 14 | Seller identity check - `app/seller-verification.tsx` | Stripe Identity (free to the seller) | n/a | No charge | - | PASS. |
| 15 | Seller payouts / cash-out - `app/payouts.tsx`, `lib/threadCash/cashOut.ts` | Money going out, not in | n/a | Stripe Connect | As is | PASS. |

Stripe object-creation sites in the API (complete list): `freelancer-jobs.ts:203`, `buyer.ts:1145`, `subscription.ts:396/443`, `boosts.ts:522`, `ad-campaigns.ts:559`, `checkout-intent.ts:332`, `sample-orders.ts:318`, `guest-checkout.ts:290`. Only `subscription.ts`, `boosts.ts` and `ad-campaigns.ts` are digital.

## Decision for Boost and Create ad

- Native iOS/Android: RevenueCat consumables, through the store's own purchase sheet. No new screens, dialogs or confirmations.
- Web: Stripe Checkout stays. A web build is not distributed through the stores, so 3.1.1 does not apply, and the existing flow already works. (Note for Dev: Apple's anti-steering rules differ by storefront; the app must not link out from native to the web purchase. It does not.)
- Why consumables with fixed tiers: a store product has a fixed price, but Boost/Create-ad budgets are a slider ($5-$1000). On native the budget is snapped to the nearest sellable tier when the buyer taps the button (the price on the button follows). Apple's highest consumable tier is $999.99, so $1000 is not sellable; the top native tier is $500.
- Server grants from RevenueCat, never from a device claim:
  - `POST /api/webhooks/revenuecat` handles `NON_RENEWING_PURCHASE` for these product ids (`routes/webhooks.ts`).
  - `POST /api/iap-promotions/{boost|campaign}/:id/verify` re-reads the purchase from RevenueCat (REST, through the existing connector) and grants. The client retries briefly, and if RevenueCat is slow the webhook grants it; the screen's existing "Payment pending" state covers the gap.
  - Both go through `lib/iapPromotions.ts` `grantPromotionPurchase`, idempotent on the store transaction id (`iap_promotion_purchases`, migration `230_iap_promotion_purchases.sql`). Rules covered by `lib/__tests__/iapPromotions.test.ts`: double delivery, amount mismatch, another account claiming a transaction, non-promotion products, ineligible post, team member buying for the owner.
- Feature flags: both default ON, so a store build never reaches Stripe for a digital purchase.
  - Mobile build env `EXPO_PUBLIC_IAP_PROMOTIONS`: unset or `1` means the store sheet on iOS/Android; `0` is for local debugging only.
  - API env `IAP_PROMOTIONS_ENABLED`: unset means on. `false` pauses grants: verify returns 503 and the RevenueCat webhook answers 503 (the event is not recorded), so RevenueCat retries once it is back on.
- Purchases that could not be applied are never dropped (BT-022). These include nothing pending, a budget mismatch, a post that is no longer eligible, and a promotion that was rejected or cancelled before it ran. The `iap_promotion_purchases` row stays ungranted and becomes credit. The app calls `POST /api/iap-promotions/{boost|campaign|featured}/:id/apply-credit` before opening the store sheet, so the seller's next promotion of the same kind and amount uses it instead of charging again. `refund_status = 'credited'` marks those promotions. A purchase only becomes credit 5 minutes after it was bought, so it can't be spent while its own grant is still running. Undelivered results are logged at error level.
- Store-paid boosts go through the same admin review gate as Stripe ones (`in_review` until approved).

The complete product list (subscriptions, credit packs, Boost, Create ad, Featured) with the App Store Connect / Play / RevenueCat steps is in `docs/app-store/iap-products.md`.

### What Dev must create

Seven budget tiers for each of two features. Create each as a **Consumable** in App Store Connect and Google Play, then add each to RevenueCat (Products, same identifier) and attach to an offering (not required for `getProducts`, but keeps the dashboard tidy). Price tier = the dollar amount in the id.

| Boost | Create ad | Price (USD) |
|-------|-----------|-------------|
| `brandthread_boost_5` | `brandthread_ad_5` | 4.99 (nearest store tier to $5; see note) |
| `brandthread_boost_10` | `brandthread_ad_10` | 9.99 |
| `brandthread_boost_25` | `brandthread_ad_25` | 24.99 |
| `brandthread_boost_50` | `brandthread_ad_50` | 49.99 |
| `brandthread_boost_100` | `brandthread_ad_100` | 99.99 |
| `brandthread_boost_250` | `brandthread_ad_250` | 249.99 |
| `brandthread_boost_500` | `brandthread_ad_500` | 499.99 |

Note on pricing: the product id tier drives the budget the seller receives ($25 of reach for `..._25`). Store prices cannot be exactly $5/$10/..., so either price at the nearest store tier and accept the small gap, or price each tier higher to cover Apple/Google's 15-30% cut (recommended: decide before creating the products; ids do not change).

Also in RevenueCat: webhook to `https://<api>/api/webhooks/revenuecat` with `REVENUECAT_WEBHOOK_AUTHORIZATION` (already required for plans), `REVENUECAT_PROJECT_ID` set (already required). Sandbox test with a sandbox Apple ID before flipping either flag.

### Touches existing UI

Only when `EXPO_PUBLIC_IAP_PROMOTIONS=1` on iOS/Android. With the flag unset (default) there is no visible change.

- `app/boost.tsx`: the small "Secure payment via Stripe. You'll be redirected..." caption under the CTA is hidden; tapping "Boost post" opens the store purchase sheet instead of the Stripe browser sheet; the slider value/price shown on the button snaps to the nearest sellable tier on tap.
- `app/design-campaign.tsx`: same store sheet instead of Stripe; the "confirming with Stripe now" sub-line on the verifying stage is hidden; budget snaps the same way.
- No new screens, modals, alerts or restyling. A cancelled store sheet is silent; a failure reuses the existing "Payment failed" alert.

Not verified here: no device or store sandbox is available in this environment, so the purchase sheet itself, RevenueCat ingestion delay, and the REST `purchases` response shape (`store_purchase_identifier`, `product_id`) are unverified against the live API. The matcher accepts `store_purchase_identifier`, `transaction_id` or `id` to tolerate shape differences; confirm with one sandbox purchase.

## Hardening left (not done, needs a product call)

1. The server does not refuse Stripe digital checkouts from native clients (`POST /seller/subscription/checkout`, `/boosts/:id/pay`, `/ad-campaigns/:id/pay`). The shipped apps never call them on native, so review risk is nil, but a modified client could. Enforcing it needs a reliable platform signal (for example an app-attest header); left alone to avoid breaking web and preview flows.
2. Team members buying for the owner: verify supports it (target owned by the store owner, purchase by the member). The webhook backstop only matches purchases by the store owner's own account.
3. Refunds of consumables (Apple/Google refund notices): not wired to revoke an active boost. Low volume; revisit with `REFUND` webhook events.
