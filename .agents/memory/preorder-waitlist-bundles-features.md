---
name: Pre-order / Waitlist / Bundles / Size Charts / Abandoned Cart / Share Store
description: Architecture for 6 seller-side features added in the same batch as Stripe Identity. Covers DB schema, API routes, and mobile screens.
---

## DB Changes (migration 016)
New columns on `products`: `is_pre_order`, `pre_order_closing_date`, `pre_order_est_ship_date`, `drop_id` (FK→drops), `size_chart` (JSONB), `demand_count`.
New column on `cart_items`: `notified_abandoned_at`.
New tables: `product_reserves`, `waitlist_entries`, `product_bundles`, `bundle_items`.

## API Routes
- `waitlist.ts` → mounted at `/api/waitlist` (buyer join/leave/check + seller demand + seller notify)
- `bundles.ts` → mounted at `/api/bundles` (includes public `GET /public/:sellerId` + seller CRUD)
- `buyer-products.ts` → mounted at `/api/buyer/products` (before /buyer catch-all; handles reserve/unreserve/checkReservation)

**Why buyer/products must be before /buyer catch-all:** Drizzle ORM router order matters — the `/buyer/products` prefix would be swallowed by an earlier `/buyer` catch-all.

## Abandoned Cart Job
`artifacts/api-server/src/jobs/abandonedCartRecovery.ts` — `startAbandonedCartJob()` called in `index.ts` after server starts. Scans every 30 min, 24h window. Uses `notifiedAbandonedAt` to prevent repeat notifications.

**Why updatedAt is safe as the abandonment signal:** cartItems.updatedAt refreshes every time the cart is synced (on every app open), so 24h gap = buyer hasn't opened the app in 24h with items in cart.

## Mobile Screens
- `product-size-chart.tsx` — seller editor; takes `productId`+`productName` query params; saves to `PUT /api/products/:id` with `sizeChart` field
- `product-bundles.tsx` — seller bundle list; uses `api.bundles.list()`
- `product-bundle-edit.tsx` — create/edit bundle; takes optional `bundleId`; must save bundle BEFORE adding items (items need bundleId FK)
- `share-store.tsx` — now loads real seller profile for dynamic URL/handle

## buyer-product-detail.tsx Additions
- State: `waitlistJoined`, `waitlistLoading`, `reserved`, `reserveLoading`, `sizeChartOpen`
- Waitlist button: appears when `allSelected && variant && !variant.isAvailable && !product.isPreOrder`
- Size chart: expandable `SizeChartViewer` component after policies, shown when `(product as any).sizeChart` truthy
- Reserve button: shown instead of Buy Now when `product.isPreOrder`; calls `(api as any).buyer.reserve(productId)`

## api.ts Additions (after shippingRates)
Groups added: `products` (CRUD), `waitlist`, `bundles`, `buyer` (reserve/unreserve/checkReservation).

## Size Chart JSON shape
`{ columns: string[], rows: [{size: string, values: string[]}], unit?: 'inches'|'cm', notes?: string }`

## Settings Entry Point
"Bundles" added to Store settings section → `/product-bundles`.
Size chart is accessed from the product-size-chart screen directly (linked from product editor or navigation).
