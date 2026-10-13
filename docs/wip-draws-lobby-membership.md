# WIP: draws, drop lobby, Day 1 badge, brand levels, unlockable icons

Paused at Dev's request while the merge queue clears. No code has been written yet. This file is the design so far. It gets deleted when the feature PRs go up.

## Overlap with open PRs (reuse, don't duplicate)
- #943 iOS 18 dark/tinted icons: item 5 builds on it. `users.appIconId` and `app/app-icon.tsx` already exist.
- #900 follower early access and past-buyers-only drops: item 4's Inner Circle early access extends the same check in `lib/money/checkoutPlan.ts`.
- #982 drop calendar notify bell and #961 waitlist page: item 2 reuses `product_launch_alerts` and does not add a new subscription table.
- #1009 customers by lifetime spend: item 4 should share its spend query.
- #872/#874 haptics service and Haptics-off toggle: use them once merged.

## 1. Draws (one PR)
- Key draws by product (`product_draws`: productId, entryClosesAt, drawnAt, seed hash). The entry window opens at the existing `product_launches.launchAt`. The seller picks "First come / Draw" in `app/product-launches.tsx`.
- Entry: price with `priceCartGroup` + `calculateGroupTax`, then create a PaymentIntent with `capture_method: 'manual'` and `metadata.kind = cart_checkout` plus the drawEntryId. The app confirms it with the existing `PaymentController.confirmSaved`/`confirmCard`; `fromIntent` already treats `RequiresCapture` as success. Store the priced snapshot on the entry row.
- `resolveChargePlan` throws `DRAW_ONLY` for draw products unless called with `viaDraw`, so normal checkout stays blocked.
- Draw job: a server-side CSPRNG shuffle per variant, winners capped at stock. For each winner, insert a `checkoutSessions` row from the snapshot with `stripePaymentIntentId` = the entry's intent, reserve stock, then capture. The existing `handleCartPaymentSucceeded` webhook creates the order. If a capture fails, the next alternate gets the unit. Losers' intents are cancelled; `handleCartPaymentEnded` finds no rows and does nothing.
- Card authorisations expire after about 7 days, so the entry window is capped at 5 days.
- Audit log: `product_draw_events` (opened, entry counts, seed hash, winners, captures, releases).
- Results screen: "You got it" / "Not this time".

## 2. Drop lobby
- `GET /api/product-launches/:id` adds `notifyCount`, the real count of `product_launch_alerts` rows.
- `LaunchCountdown` turns Buy on at the exact second, using the server-skew-corrected clock, with no reload. The server still enforces launch time. It refreshes the count every 30s while visible.

## 3–5
- Day 1: `brand_day_one_buyers` (sellerId, buyerId, rank ≤ 100) filled when an order is paid. A small badge in comments and the profile brand list.
- Levels: `brand_membership_thresholds` per seller (defaults Insider $250, Inner Circle $1,000). Lifetime spend comes from paid orders.
- Icons: chrome/silver alternate icons on top of #943, unlocked by Insider or above with any brand, picked in Settings > App icon.
