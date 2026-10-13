# Seller "cooler" batch: WIP plan (paused)

Status: research done, no feature code written yet. Paused at Dev's request until the merge queue clears.

## Overlap with open PRs (reuse, don't duplicate)
- #1009 customers by lifetime spend + Top 20 (`lib/sellerCustomers.ts`). Superfans will stack on it.
- #1003 Close Friends for top buyers, #900 1-hour follower early access. Superfans "Give early access" should reuse #900's early-access mechanism.
- #961 drop waitlist page. The drop hype page reads the same `drop_alert_subscriptions`.
- #983 dashboard rewrite (Shopify-style home). Dashboard cards slot in under the top bar, one promo card at a time.
- #990 / #942 story cards. Milestone card reuses `lib/shareCard.ts` (`captureShareCard`, `shareCardToInstagramStories`).

## Items, references, plan
1. **Milestone cards.** Ref: Hevy "1st workout" share (`refs/ref-hevy-first-workout-share.jpg`), without the confetti. Derive milestones server-side from paid orders. Store "seen" in a new `seller_milestones` table so each card shows once. The card is plain type on black, the top product photo and the store name. One tap opens IG Stories.
2. **Live map.** Shopify Live View is not on Mobbin. Visual ref: Citizen dark map (`refs/ref-citizen-dark-map.jpg`). No map lib is installed, so use `react-native-svg` with an equirectangular world outline. Geocode at city level from a bundled city table on the server; addresses never leave the server. There is no realtime order channel yet, so add `/ws/seller` (pattern: `ws/liveHub.ts`) or a 15s poll.
3. **Morning brief.** Ref: Apple Fitness Summary dismissible card (`refs/ref-apple-fitness-summary-card.jpg`). `GET /api/seller/morning-brief?tz=` returns yesterday's sales, orders to ship and one suggestion (sold-out bestseller → restock). Dismiss is keyed per local date in AsyncStorage `bt:morning-brief:dismissed:<userId>`.
4. **Superfans.** Ref: Shopify Segments (`refs/ref-shopify-segments.jpg`). Add a "Superfans" segment tab to `app/customers.tsx` (top 1% by spend/orders, minimum 1 person). "Give early access" grants per-buyer access to the next drop.
5. **Rising brands.** Ref: Doji "Top Creators · Last 7 Days" (`refs/ref-doji-top-creators-7d.jpg`). Opt-in column `users.rising_leaderboard_opt_in`. The ranking is week-over-week order growth, with a minimum order floor. One section in Discover > Brands.
6. **Lookbook mode.** Ref: GOAT Styles full-screen (`refs/ref-goat-styles-fullscreen.jpg`). `storefronts.theme.layout = 'lookbook'` is toggled in `app/store-settings.tsx` and renders a vertical paged full-bleed view in `app/seller-profile.tsx` visitor mode.
7. **Drop hype page.** A seller-only screen from `app/seller-drops.tsx` showing the cumulative notify count by day from `drop_alert_subscriptions.created_at`, using the dashboard's one-line chart.

## Codebase anchors
- Dashboard: `components/SellerHomeCommerceDashboard.tsx` (top-card slot after the top bar, about line 773).
- Paid order hook: `api-server/src/routes/webhooks.ts` `handleCheckoutPaid` → `publishNotification(new_order_received)`.
- Orders: `orders.shipping_address` json has `{city,state,country}` and no lat/lng.
- Flags: `feature_flags` table + `contexts/FeatureFlagContext.tsx`.
- Migrations: next free number is above 271 (#1009 uses 271), with unique names.
