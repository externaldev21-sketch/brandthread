# Route map: old → new

Screens that were merged or removed no longer have a file in `app/`. Their old
paths still work: `app/+not-found.tsx` looks them up in
`lib/navigation/legacyRoutes/` and replaces the URL with the new home (the old
query string is carried over). In-app links point straight at the new home;
`tests/legacy-routes.test.ts` fails if anything links to an old path, if a
target is missing, or if this file falls out of date.

Screens in `app/` now: **354** (route files, excluding layouts and tests).

| Old route | New home | Why |
|---|---|---|
| `/ai-assistant` | `/ai-brain` | Was a redirect stub to the AI chat. |
| `/bg-removal` | `/design-bg-removal` | Was a redirect stub to Remove Background. |
| `/buyer-account-control` | `/delete-account` | Was a re-export of Delete account. |
| `/app-icon` | `/appearance` | App icon lives in Appearance. |
| `/app-theme` | `/appearance` | App theme lives in Appearance. |
| `/shipping-label` | `/fulfill-order?orderId=ORDER_ID&step=3` (without params: `/(tabs)/orders`) | Buying a label is step 3 of Fulfill order. |
| `/buyer-refund-request` | `/buyer-return-request?orderId=ORDER_ID` (without params: `/(buyer)/orders`) | Unlinked duplicate of the Return / refund request. |
| `/drafts` | `/(tabs)/products?filter=draft` | Drafts is a filter on the Products tab. |
| `/automation` | `/(tabs)/marketing` | Unlinked "coming" placeholder; Marketing holds the real tools. |
| `/metafields` | `/store-settings` | Unlinked placeholder; rows were no-ops. |
| `/ai-brand-memory` | `/ai-settings` | Brand Memory removed from the app (server + data kept). |
| `/seller-drops` | `/(tabs)/products` | Drops removed from the seller app (server + data kept). |
| `/seller-drop-create` | `/(tabs)/products` | Drops removed from the seller app (server + data kept). |
| `/seller-drop-preview` | `/(tabs)/products` | Drops removed from the seller app (server + data kept). |
| `/buyer-drops` | `/(buyer)/discover` | Unlinked drops browse list; drop cards in Discover/feed still open a drop. |
| `/inventory` | `/(tabs)/products?filter=low-stock` | AI help link; stock lives on the Products tab. |
| `/shipping-rates` | `/shipping` | AI help link; rates live in Shipping & Fulfillment. |
| `/discount-codes` | `/discounts` | AI help link; codes live in Discounts. |
